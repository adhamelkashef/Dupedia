/* X FORCE 1.1 (Dupedia) — Cloudflare Worker backend.
   Gives the unchanged X FORCE app a shared, signed-in, permission-checked backend on Cloudflare:
   • Sign-in with username + password (PBKDF2-SHA256 hashes, HttpOnly + Secure + SameSite=Strict session cookie,
     5 failed attempts lock a username for 15 minutes). No public registration: the first administrator is created once
     with the SETUP_CODE secret; afterwards setup is closed for good. Everyone else is created by an administrator.
   • One shared D1 database for every record. Every read and write is checked HERE against the app's own access rules
     (DPStore.RULES in app/store.js — the same table published on claude.ai), by account level: owner / admin / staff.
   • The same HTTP API as server/server.js, so the app's browser shim (xf-shim.js) works unchanged.
   • Cron: the hourly sweep (worker/sweep.js, a tested port of ops/sweep.py): 24-hour lead release, follow-up reminders,
     overdue customer payments.
   Static files are served by Cloudflare's asset service; this Worker runs first only for "/", the sign-in/setup pages,
   the shim and /api/* (see wrangler.jsonc → assets.run_worker_first). */
import "../app/store.js";
import "../app/fincalc.js";
import "../app/fab.js";
import "../app/holidays.js";
import "../app/jobs13.js";
import { computeSweep } from "./sweep.js";
import { researchConfig, runRequestJob, researchTick } from "./research.js";
import { mailConfigured, sendMail, resetEmail, tempEmail, securityEmail } from "./mail.js";

const RULES = globalThis.DPStore, FC = globalThis.DPFinCalc;
const DOC_MAX = 256 * 1024, BODY_MAX = 4 * 1048576;
const PATH_RE = /^(?!\.\.?(?:\/|$))[A-Za-z0-9_\-.~:@+]{1,200}(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9_\-.~:@+]{1,200}){0,14}$/;
const now = () => new Date().toISOString();
const enc = new TextEncoder();

/* ======================= schema (created on first request; idempotent) ======================= */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, parent TEXT NOT NULL, data TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent)`,
  `CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, level TEXT NOT NULL, owner INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, salt TEXT NOT NULL, hash TEXT NOT NULL, iter INTEGER NOT NULL,
     created_at TEXT NOT NULL, created_by TEXT, last_login TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (th TEXT PRIMARY KEY, uid TEXT NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid)`,
  `CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leases (path TEXT PRIMARY KEY, holder TEXT NOT NULL, exp INTEGER NOT NULL)`,
  // 1.3 — change feed for live updates: documents changed since a moment (docs.at), plus deleted paths
  `CREATE INDEX IF NOT EXISTS docs_at ON docs(at)`,
  `CREATE TABLE IF NOT EXISTS gone (path TEXT PRIMARY KEY, at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS gone_at ON gone(at)`,
  // 1.4.4 — password resets: only a SHA-256 hash of each link token is kept; single use (used_at), expiry (exp, ms)
  `CREATE TABLE IF NOT EXISTS resets (th TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL, exp INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT, used_at TEXT, mail TEXT)`,
  `CREATE INDEX IF NOT EXISTS resets_uid ON resets(uid)`,
];
let schemaReady = null;
function ensureSchema(env) {
  if (!env.DB) throw Object.assign(new Error("The D1 database is not connected (binding DB). See CLOUDFLARE.md."), { http: 500 });
  return (schemaReady = schemaReady || env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { schemaReady = null; throw e; }));
}
const parentOf = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

/* ======================= crypto helpers ======================= */
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const iterations = (env) => Math.max(10000, Math.min(100000, parseInt(env.PBKDF2_ITERATIONS || "60000", 10) || 60000));
async function pbkdf2(pw, salt, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
}
async function hashPw(env, pw) { const salt = rand(16), iter = iterations(env); return { salt: b64(salt), hash: b64(await pbkdf2(pw, salt, iter)), iter }; }
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
async function checkPw(pw, rec) { if (!rec || !rec.hash) return false; return same(await pbkdf2(pw, unb64(rec.salt), rec.iter), unb64(rec.hash)); }
function pwProblem(pw) { pw = String(pw || ""); if (pw.length < 10) return "Use at least 10 characters."; if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letters and at least one digit."; if (pw.length > 200) return "Too long."; return null; }
const uidNew = () => "u_" + b64(rand(18)).replace(/[^A-Za-z0-9]/g, "").slice(0, 22);
const tokenNew = () => b64(rand(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const UNAME = /^[a-z0-9._-]{3,40}$/;

/* ======================= HTTP helpers ======================= */
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };
function respond(code, body, type = "application/json", extra = {}) {
  return new Response(typeof body === "string" || body instanceof Uint8Array || body instanceof ReadableStream ? body : JSON.stringify(body),
    { status: code, headers: Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, SEC, extra) });
}
const json = (code, obj, extra) => respond(code, obj, "application/json", extra);
const rawJson = (code, text) => respond(code, text, "application/json");
const redirect = (to) => new Response(null, { status: 302, headers: Object.assign({ Location: to, "Cache-Control": "no-store" }, SEC) });
async function body(req) {
  const t = await req.text(); if (t.length > BODY_MAX) throw Object.assign(new Error("Request too large."), { http: 413 });
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw Object.assign(new Error("Invalid JSON."), { http: 400 }); }
}
function cookies(req) { return Object.fromEntries(String(req.headers.get("cookie") || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; })); }
const isHttps = (req) => new URL(req.url).protocol === "https:";
const cookie = (req, v, maxAge) => `xf_s=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
const ip = (req) => req.headers.get("cf-connecting-ip") || "?";
const csrfOk = (req) => req.headers.get("x-xf") === "1";   // custom header: a cross-site form cannot send it (and cookies are SameSite=Strict)
const sessionDays = (env) => Math.max(1, Math.min(90, parseInt(env.SESSION_DAYS || "14", 10) || 14));

/* ======================= accounts & sessions ======================= */
const pubAcc = (x) => ({ uid: x.uid, username: x.username, name: x.name, level: x.level, active: !!x.active, owner: !!x.owner, mustChange: !!x.must_change, createdAt: x.created_at, lastLogin: x.last_login || null });
async function newSession(env, uid) { const t = tokenNew(); await env.DB.prepare("INSERT INTO sessions (th, uid, exp) VALUES (?, ?, ?)").bind(await sha256(t), uid, Date.now() + sessionDays(env) * 864e5).run(); return t; }
async function account(env, req) {
  const t = cookies(req).xf_s; if (!t) return null;
  const a = await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.th = ? AND s.exp > ?").bind(await sha256(t), Date.now()).first();
  if (!a || !a.active) return null; return a;
}
async function limited(env, k) { const f = await env.DB.prepare("SELECT until FROM fails WHERE k = ?").bind(k).first(); return !!(f && f.until > Date.now()); }
// 5 failures lock a username for 15 minutes; an address (an office may share one) after 30
async function failed(env, k, max = 5) {
  const f = (await env.DB.prepare("SELECT n, until FROM fails WHERE k = ?").bind(k).first()) || { n: 0, until: 0 };
  let n = f.n + 1, until = f.until; if (n >= max) { until = Date.now() + 15 * 60e3; n = 0; }
  await env.DB.prepare("INSERT INTO fails (k, n, until) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET n = excluded.n, until = excluded.until").bind(k, n, until).run();
}
const levelOf = (a) => (a.owner ? "owner" : a.level === "admin" ? "admin" : a.level === "finance" ? "finance" : "interact");
const isAdminAcc = (a) => ["owner", "admin"].includes(levelOf(a));
const can = (a, p, op) => (levelOf(a) === "finance" ? RULES.allowedFinance(p, op, a.uid) : RULES.allowed(p, op, levelOf(a), a.uid));
const ACC_LEVELS = { admin: "admin", finance: "finance", interact: "interact" };

/* 1.2 — a lead added by a sales or data-entry person: origin and creator must be theirs, nothing may pre-assign it. */
async function staffRoleBase(env, uid) {
  let d = await docOf(env, `directory/${uid}`);
  if (!d || d.uid !== uid) { const rs = (await env.DB.prepare("SELECT data FROM docs WHERE parent = 'directory'").all()).results || []; d = rs.map((r) => JSON.parse(r.data)).find((x) => x.uid === uid) || null; }
  if (!d || d.active === false) return null;
  const roles = ((await docOf(env, "config/roles")) || {}).roles || [], r = roles.find((x) => x.id === d.role);
  return (r && r.base) || d.role;
}
async function checkNewLead(env, acc, d) {
  if (!d || typeof d !== "object") return "Lead data missing.";
  const base = await staffRoleBase(env, acc.uid), kind = base === "employee" ? "sales" : base === "dataentry" ? "dataentry" : base === "marketing" ? "marketing" : null;
  if (!kind) return "Your role cannot add leads.";
  if (d.createdBy !== acc.uid || d.originKind !== kind) return "A new lead must be recorded as created by you, with your role as its origin.";
  if (!String(d.name || "").trim()) return "Enter the organisation name.";
  if (d.assignedTo || d.assignedBy || d.extensions || d.releases || d.mergedInto) return "A new lead cannot be assigned, extended or merged by its creator.";
  if (!["available", "research"].includes(d.status)) return "A new lead starts as Available or Under Research.";
  return null;
}
/* 1.4 — Growth & Marketing Center. Writers: administrators and the Marketing role; a Radar account's or partnership's
   owner (sales) may update only the follow-up fields; interactions are append-only and stamped with their author. */
const MKT_OWNER_FIELDS = ["nextAction", "nextDue", "notes", "qualification", "confirmedNeed", "confirmedNeedBy", "priorityOverride", "feedback", "feedbackLog", "history", "updatedAt", "updatedBy", "referrals", "meetings", "followUp"];
async function mktGuard(env, acc, p, old, next) {
  if (isAdminAcc(acc)) return null;
  if (p === "mkt/cfg") return "Only an administrator changes the marketing settings.";
  const base = await staffRoleBase(env, acc.uid), mkt = base === "marketing";
  if (/^mkt\/touch\/t\/[^/]+$/.test(p)) { if (old) return "Recorded interactions cannot be changed."; if (next.by !== acc.uid) return "An interaction must be recorded as yours."; if (next.data && MONEY.test(JSON.stringify(next.data))) return "No amounts here."; return null; }
  if (/^mkt\/camp\/c\/[^/]+$/.test(p)) {
    if (!mkt) return "Only Marketing and administrators manage campaigns.";
    // approvals belong to the administrator: Marketing cannot approve a campaign or approve / publish content itself
    if (["approved", "live"].includes(next.status) && !(old && ["approved", "live", "paused"].includes(old.status))) return "An administrator approves a campaign before it runs.";
    const was = Object.fromEntries(((old && old.content) || []).map((c) => [c.id, c.status]));
    for (const c of next.content || []) if (c.status === "approved" && was[c.id] !== "approved" && was[c.id] !== "published") return "An administrator approves content before it is published.";
    for (const c of next.content || []) if (c.status === "published" && !["approved", "published"].includes(was[c.id])) return "Only approved content can be recorded as published.";
    if (old && old.approvedBy !== next.approvedBy) return "The approval record cannot be changed.";
    return null; }
  if (/^mkt\/camp\/c\/[^/]+\/f\//.test(p)) return mkt ? null : "Only Marketing and administrators add campaign assets.";
  if (/^mkt\/(radar\/a|part\/p)\/[^/]+$/.test(p)) {
    if (mkt) return null;
    if (!old || old.ownerUid !== acc.uid) return "Only Marketing, administrators or the owner can change this record.";
    for (const k of new Set(Object.keys(old).concat(Object.keys(next)))) if (!MKT_OWNER_FIELDS.includes(k) && JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null)) return `As the owner you can update the follow-up and qualification only (not "${k}").`;
    return null; }
  return mkt ? null : "Only Marketing and administrators write here.";
}
/* 1.3 — notifications are delivered by the server: an event a person posts to their outbox is copied at once into each
   recipient's inbox (same id as the in-app copy, "<author>-<event>", so nothing is ever duplicated). Money never travels this way. */
const MONEY = /amount|minor|total|price|commission|salary|cost|margin/i;
async function fanOut(env, acc, p, d) {
  const evId = p.split("/")[3], to = Array.isArray(d.to) ? d.to.slice(0, 50) : []; if (!to.length) return;
  if (d.data && MONEY.test(JSON.stringify(d.data))) return;
  const ids = new Set();
  for (const t of to) {
    if (t === "@admins") { const rs = (await env.DB.prepare("SELECT uid FROM users WHERE active = 1 AND (level = 'admin' OR owner = 1)").all()).results || []; rs.forEach((r) => ids.add(r.uid)); }
    else if (t === "@finance") { const rs = (await env.DB.prepare("SELECT uid FROM users WHERE active = 1 AND level = 'finance'").all()).results || []; rs.forEach((r) => ids.add(r.uid)); }
    else if (typeof t === "string" && /^[A-Za-z0-9_\-.~:@+]{1,80}$/.test(t)) ids.add(t);
  }
  ids.delete(acc.uid);
  const copy = Object.assign({}, d, { id: `${acc.uid}-${evId}`.slice(0, 180), from: acc.uid, read: false }); delete copy.to;
  const t = now(), st = [...ids].map((u) => env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING").bind(`notif/${u}/n/${copy.id}`, `notif/${u}/n`, JSON.stringify(copy), t));
  if (st.length) await env.DB.batch(st);
}
/** Mark read / clear my own notifications in ONE statement (1.2 did one request per notification, so leaving the page
 *  half-way left most of them unread). Only the caller's inbox is touched; items newer than `before` are left alone. */
async function notifBulk(env, acc, b) {
  const parent = `notif/${acc.uid}/n`, t = now(), action = b.action;
  if (!["read", "clear", "unread"].includes(action)) return { error: "invalid_argument", message: "Unknown action." };
  const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === "string").slice(0, 2000) : null, before = typeof b.before === "string" ? b.before : null;
  const set = action === "read" ? "json_set(data, '$.read', json('true'), '$.readAt', ?)" : action === "unread" ? "json_set(data, '$.read', json('false'), '$.readAt', ?)" : "json_set(data, '$.read', json('true'), '$.cleared', json('true'), '$.clearedAt', ?)";
  let sql = `UPDATE docs SET data = ${set}, v = v + 1, at = ? WHERE parent = ?`; const args = [t, t, parent];
  if (ids) { sql += " AND path IN (SELECT ? || value FROM json_each(?))"; args.push(parent + "/", JSON.stringify(ids)); }
  if (before) { sql += " AND json_extract(data, '$.at') <= ?"; args.push(before); }
  if (action === "read") sql += " AND json_extract(data, '$.read') IS NOT 1";
  if (action === "clear") sql += " AND json_extract(data, '$.cleared') IS NOT 1";
  const r = await env.DB.prepare(sql).bind(...args).run();
  return { ok: true, changed: (r.meta && r.meta.changes) || 0, at: t };
}
/** Change feed: which records the caller may read changed since `since` (server time). The browser re-reads only those. */
async function changes(env, acc, since) {
  const t = now(); if (!since || !/^\d{4}-\d\d-\d\dT/.test(since)) return { now: t, paths: [], reset: true };
  const rs = ((await env.DB.prepare("SELECT path FROM docs WHERE at > ? ORDER BY at LIMIT 400").bind(since).all()).results || []).concat((await env.DB.prepare("SELECT path FROM gone WHERE at > ? ORDER BY at LIMIT 200").bind(since).all()).results || []);
  const out = new Set(); for (const r of rs) if (can(acc, r.path, "read")) out.add(r.path.split("/").slice(0, 4).join("/"));
  return { now: t, paths: [...out].slice(0, 300), more: rs.length >= 400 };
}

async function facGuard(env, acc, p, old, next) {
  if (isAdminAcc(acc)) return null;
  const seg = p.split("/"), base = await staffRoleBase(env, acc.uid), eng = base === "engineer";
  if (seg[1] === "asg" && !old) return next.by === acc.uid ? null : "The assignment record must be written by its author.";      // auto-assignment at acceptance (sales session)
  if (seg[1] === "jobs" && !old && ["employee", "engineer"].includes(base)) return next.stage && next.stage !== "review" ? "A new job starts in technical review." : null;
  if (!eng) return "Only engineers and administrators can change factory records.";
  if (["cfg", "prof", "mat"].includes(seg[1])) return "Only an administrator can change factory settings, engineer profiles and the material library.";
  if (seg[1] === "mov" || seg[1] === "asg") return old ? "Material movements and assignment history cannot be changed. Record a correcting movement." : next.by === acc.uid ? null : "A movement must be recorded by its author.";
  if (seg[1] === "jobs") {
    if (old && old.engineerUid && old.engineerUid !== acc.uid) return "Only the engineer assigned to this job (or an administrator) can change it.";
    if (old && (next.engineerUid || null) !== (old.engineerUid || null)) return "Only an administrator can reassign a job.";
    if (old && JSON.stringify(old.techApproved || null) !== JSON.stringify(next.techApproved || null)) return "Technical approval is given by an administrator.";
    if (old && JSON.stringify(old.override || null) !== JSON.stringify(next.override || null)) return "Exceptions are approved by an administrator.";
    const was = Object.fromEntries((old && old.bom || []).filter((b) => b.approvedQty != null).map((b) => [b.id, b]));
    for (const b of next.bom || []) { const w = was[b.id]; if (w && (b.approvedQty !== w.approvedQty || b.approvedBy !== w.approvedBy)) return "An approved material estimate cannot be changed; record the overrun with its reason instead."; }
    if (Object.keys(was).some((id) => !(next.bom || []).some((b) => b.id === id))) return "An approved BOM line cannot be removed.";
    if (old && next.stage !== old.stage) { const why = globalThis.DPFab.gate(old.stage ? Object.assign({}, next, { stage: old.stage }) : next, next.stage, { requireApproval: !!next.requireApproval, override: next.override }); if (why.length) return why[0]; }
    return null;
  }
  return null;
}

/* ======================= documents ======================= */
async function setDoc(env, p, data) {
  const r = await env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, v = docs.v + 1, at = excluded.at RETURNING v")
    .bind(p, parentOf(p), data, now()).first();
  return r ? r.v : 1;
}
/* ======================= 1.2 finance integrity (enforced here, whatever the browser sends) ======================= */
async function finCfg(env) { const r = await env.DB.prepare("SELECT data FROM docs WHERE path = 'fin/cfg'").first(); return FC.cfgOf(r ? JSON.parse(r.data) : null); }
const docOf = async (env, p) => { const r = await env.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(p).first(); return r ? JSON.parse(r.data) : null; };
const eqv = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const frozen = (old, next, fields) => fields.find((f) => !eqv(old[f], next[f]));
const who = (acc) => ({ uid: acc.uid, level: levelOf(acc) });
// which approved record lets a payout skip the approval step
const PRE_APPROVED = [["commission", (l) => l.commission && `commissions/${l.commission.uid}/r/${l.commission.oid}`, (d) => ["approved", "paid"].includes(d.status) && !(d.payrolls || []).some((x) => !x.paidAt && !x.removedAt)],   // 1.4.6: not while it is in payroll
  ["payroll", (l) => l.payroll && `fin/payroll/r/${l.payroll}`, (d) => ["approved", "partly_paid"].includes(d.status)],
  ["wdue", (l) => l.wdue && `fin/wdue/d/${l.wdue}`, (d) => ["approved", "partly_paid"].includes(d.status)],
  ["purchase", (l) => l.purchase && `fin/purch/p/${l.purchase}`, (d) => ["approved", "received"].includes(d.status)]];
const GUARDS = [
  // 1.4 — Growth & Marketing Center
  { re: /^mkt\//, del: (old, acc) => (isAdminAcc(acc) ? null : "Only an administrator can delete marketing records — set the status instead."), check: mktGuard },
  // 1.3 — factory records: written by engineers and administrators only; material movements and assignment history are
  // append-only; approved material estimates, technical approval and gate overrides need an administrator.
  { re: /^fac\//, del: (old, acc) => (isAdminAcc(acc) ? null : "Only an administrator can delete factory records."), check: facGuard },
  { re: /^leadx\/[^/]+\/files\/[^/]+$/, del: (old, acc) => (old && old.by !== acc.uid && !isAdminAcc(acc) ? "Only the person who attached the file or an administrator can remove it." : null),
    check: async (env, acc, p, old, next) => (old && old.by !== acc.uid && !isAdminAcc(acc) ? "Only the person who attached the file or an administrator can change it." : next.by !== acc.uid && !old ? "The file must be recorded as attached by you." : null) },
  { re: /^fin\/tx\/t\/[^/]+$/, del: (old) => (old && old.status !== "draft" ? "Only a draft transaction can be deleted. Cancel it or record a reversal." : null),
    check: async (env, acc, p, old, next) => {
      if (p.split("/")[3] !== next.ref) return "The document id must be the transaction reference.";
      const cfg = await finCfg(env), e = FC.guardTx(who(acc), old, next, cfg); if (e) return e;
      const ids = [next.fromAcct, next.toAcct].filter(Boolean), accounts = {};
      for (const id of ids) { const a = await docOf(env, `fin/accounts/a/${id}`); if (a) accounts[id] = Object.assign({ id }, a); }
      const e2 = FC.validateTx(next, accounts); if (e2) return e2;
      if (next.preApproved && !old) { const l = next.links || {}, hit = PRE_APPROVED.find(([k]) => l[k]);
        if (!hit) return "A payout without approval must be linked to an approved record.";
        const rec = await docOf(env, hit[1](l)); if (!rec || !hit[2](rec)) return "The linked record is not approved, so this payment needs approval."; }
      if (next.type === "reversal" && !old) {
        const o = await docOf(env, `fin/tx/t/${next.reversalOf}`);
        if (!o || !FC.POSTED(o)) return "Only a verified transaction can be reversed.";
        if (o.reversedBy) return "This transaction is already reversed.";
        if (o.amountMinor !== next.amountMinor || o.currency !== next.currency) return "A reversal must have the same amount and currency as the original.";
        const flip = { in: "out", out: "in", internal: "internal" }[o.direction];
        if (next.direction !== flip || (o.direction === "internal" ? next.fromAcct !== o.toAcct || next.toAcct !== o.fromAcct : (next.fromAcct || next.toAcct) !== (o.toAcct || o.fromAcct))) return "A reversal must undo the original movement on the same account(s).";
        if (!(next.reason && String(next.reason).trim().length >= 5)) return "A reversal needs a reason.";
      }
      if (old && FC.POSTED(old) && !eqv(old.reversedBy, next.reversedBy)) {   // marking the original as reversed: only by a verified reversal of it
        const r = await docOf(env, `fin/tx/t/${next.reversedBy}`); if (!r || r.reversalOf !== old.ref || !FC.POSTED(r)) return "Link a verified reversal first."; }
      return null;
    } },
  { re: /^fin\/inv\/i\/[^/]+$/, del: (old) => (old && old.status !== "draft" ? "An issued document is never deleted. Cancel it or issue a credit note." : null),
    check: async (env, acc, p, old, next) => {
      const cfg = await finCfg(env);
      if (levelOf(acc) === "finance" && next.status === "issued" && (!old || old.status !== "issued") && !cfg.accountant.finalizeInvoices) return "You are not authorised to issue invoices.";
      if (old && old.status === "issued") {
        const f = frozen(old, next, ["number", "kind", "orderId", "paymentId", "txRef", "date", "customer", "lines", "subtotalMinor", "discountMinor", "taxLines", "taxMinor", "totalMinor", "receivedMinor", "issuedBy", "issuedAt"]);
        if (f) return "An issued document cannot be changed (" + f + "). Cancel it or issue a credit note.";
        if (!["issued", "cancelled"].includes(next.status)) return "An issued document can only be cancelled.";
        if (next.status === "cancelled" && !(next.cancelReason && next.cancelledBy === acc.uid)) return "Cancelling needs a reason.";
      }
      if (old && old.status === "cancelled" && !eqv(old, next)) return "A cancelled document cannot be changed.";
      if (next.status === "issued" && next.kind === "receipt" && (!old || old.status !== "issued")) {   // the payment must REALLY be verified on the order
        const o = await docOf(env, `orders/${next.orderId}`), pay = o && (o.payments || []).find((x) => x.id === next.paymentId);
        if (!pay || pay.status !== "verified") return "A receipt can only be issued for a verified payment.";
        if (pay.amountMinor !== next.receivedMinor) return "The receipt amount must equal the verified payment.";
      }
      if (next.status === "issued" && (!old || old.status !== "issued") && next.issuedBy !== acc.uid) return "The issuer must be the person issuing.";
      return null;
    } },
  { re: /^fin\/payroll\/r\/[^/]+$/, del: (old) => (old && !["prepared", "pending_approval"].includes(old.status) ? "Approved payroll is never deleted." : null),
    check: async (env, acc, p, old, next) => {
      const L = ["approved", "partly_paid", "paid"];
      // 1.4.6 — every commission in a payroll line must match its commission record (no invented or doubled commission)
      if (!eqv(old && old.commissions, next.commissions)) for (const c of next.commissions || []) {
        const d = await docOf(env, `commissions/${next.uid}/r/${c.oid}`), e = d && (d.payrolls || []).find((x) => x.line === p.split("/").pop() && !x.removedAt);
        if (!d || !e || e.amountMinor !== c.amountMinor || d.approvedMinor == null) return `The commission ${c.oid} in this payroll does not match its approved commission record.`;
        if ((d.payrolls || []).some((x) => x.line !== e.line && !x.paidAt && !x.removedAt)) return `The commission ${c.oid} is already in another unpaid payroll.`;
      }
      if (old && L.includes(old.status)) { const f = frozen(old, next, ["uid", "period", "baseMinor", "allowances", "bonuses", "commissions", "commissionsMinor", "deductions", "recoveries", "adjustments", "grossMinor", "netMinor", "approvedBy", "approvedAt"]);
        if (f) return "Approved payroll cannot be changed (" + f + "). Record an adjustment in the next period."; }
      if (L.includes(next.status) && (!old || !L.includes(old.status))) {
        const cfg = await finCfg(env), fin = levelOf(acc) === "finance";
        if (fin && !cfg.accountant.approvePayroll) return "You are not authorised to approve payroll.";
        if (next.approvedBy !== acc.uid) return "The approver must be the person approving.";
        if (fin && cfg.sod && next.preparedBy === acc.uid) return "Separation of duties: you prepared this payroll, so another person must approve it.";
        const calc = FC.payroll(next); if (calc.netMinor !== next.netMinor || calc.grossMinor !== next.grossMinor) return "The payroll totals do not match their lines.";
      }
      return null;
    } },
  { re: /^fin\/(purch\/p|wdue\/d)\/[^/]+$/, del: (old) => (old && !["pending_approval", "draft"].includes(old.status) ? "Approved records are never deleted. Cancel them instead." : null),
    check: async (env, acc, p, old, next) => {
      const A = ["approved", "received", "partly_paid", "paid"];
      if (A.includes(next.status) && (!old || !A.includes(old.status))) {
        const cfg = await finCfg(env), fin = levelOf(acc) === "finance";
        if (fin && !cfg.accountant.approveExpenses) return "You are not authorised to approve this.";
        if (next.approvedBy !== acc.uid) return "The approver must be the person approving.";
        if (fin && cfg.sod && next.preparedBy === acc.uid) return "Separation of duties: another person must approve what you prepared.";
      }
      if (old && A.includes(old.status)) { const f = frozen(old, next, p.includes("/purch/") ? ["totalMinor", "lines", "supplierId", "approvedBy"] : ["amountDueMinor", "wid", "approvedBy"]); if (f) return "An approved record cannot be changed (" + f + "). Cancel it and record a new one."; }
      return null;
    } },
  // the Accountant may record and verify payments on orders, but never change what was sold or its value
  { re: /^orders\/[^/]+$/, levels: ["finance"], del: () => "Finance cannot delete orders.",
    check: async (env, acc, p, old, next) => { if (!old) return "Finance cannot create orders."; const f = frozen(old, next, ["ownerId", "pid", "items", "lines", "subtotalMinor", "discountMinor", "afterDiscountMinor", "taxMinor", "totalMinor", "costMinor", "valueAdjustments", "status", "client", "name", "ref"]); return f ? "Finance cannot change the order (" + f + ")." : null; } },
  { re: /^commissions\/[^/]+\/r\/[^/]+$/, levels: ["finance"], del: () => "Finance cannot delete commission records.",
    check: async (env, acc, p, old, next) => {
      if (!old) return "Commission records are created by the system.";
      const f = frozen(old, next, ["uid", "oid", "calculatedMinor", "rateBp", "basis", "eligibleMinor"]); if (f) return "The calculated commission cannot be changed (" + f + ").";
      if (!eqv(old.approvedMinor, next.approvedMinor) || !eqv(old.approvals, next.approvals)) { const cfg = await finCfg(env); if (!cfg.accountant.approveCommission) return "You are not authorised to approve commissions."; }
      return null;
    } },
  { re: /^fin\/cfg$/, check: async (env, acc) => (isAdminAcc(acc) ? null : "Only the administrator changes finance permissions.") },
];
async function dbOp(env, acc, b) {
  const { op } = b, p = String(b.path || "");
  if (!PATH_RE.test(p)) return { error: "invalid_argument", message: "Invalid path." };
  if (op === "get") {
    if (!can(acc, p, "read")) return { exists: false };
    const r = await env.DB.prepare("SELECT data, v FROM docs WHERE path = ?").bind(p).first();
    return r ? { raw: `{"exists":true,"data":${r.data},"version":${r.v}}` } : { exists: false };
  }
  if (op === "list") {
    // 1.4.6 — optional paging by document id (chat): {after} = newer than, {before} = older than, {limit} = at most n (newest
    // first when paging backwards or when only a limit is given). Without these the whole collection is returned as before.
    const lim = Math.max(1, Math.min(500, parseInt(b.limit, 10) || 0)), paged = b.after != null || b.before != null || b.limit != null;
    let rs;
    if (b.since != null) {   // {since}: documents written after this server time (any id) — with their write time, for incremental reads
      rs = (await env.DB.prepare("SELECT path, data, at FROM docs WHERE parent = ? AND at > ? ORDER BY at ASC LIMIT ?").bind(p, String(b.since), lim || 500).all()).results || [];
      const o2 = rs.filter((r) => can(acc, r.path, "read"));
      return { raw: `{"docs":[${o2.map((r) => `{"id":${JSON.stringify(r.path.slice(p.length + 1))},"at":${JSON.stringify(r.at)},"data":${r.data}}`).join(",")}],"until":${JSON.stringify(rs.length ? rs[rs.length - 1].at : String(b.since))}}` };
    }
    if (paged) {
      const asc = b.after != null && b.before == null, conds = ["parent = ?"], args = [p];
      if (b.after != null) { conds.push("path > ?"); args.push(p + "/" + String(b.after)); }
      if (b.before != null) { conds.push("path < ?"); args.push(p + "/" + String(b.before)); }
      rs = (await env.DB.prepare(`SELECT path, data FROM docs WHERE ${conds.join(" AND ")} ORDER BY path ${asc ? "ASC" : "DESC"} LIMIT ?`).bind(...args, lim || 200).all()).results || [];
    } else rs = (await env.DB.prepare("SELECT path, data FROM docs WHERE parent = ?").bind(p).all()).results || [];
    const out = rs.filter((r) => can(acc, r.path, "read")).map((r) => [r.path.slice(p.length + 1), r.data]).sort((a, c) => a[0].localeCompare(c[0]));
    // the stored JSON is passed through as is: no parsing on the hot path (Workers Free allows 10 ms of CPU per request)
    return { raw: `{"docs":[${out.map(([id, d]) => `{"id":${JSON.stringify(id)},"data":${d}}`).join(",")}]}` };
  }
  if (op === "set" || op === "update" || op === "delete" || op === "create") {
    if (p.split("/").length % 2) return { error: "invalid_argument", message: "Not a document path." };
    const audit = /^audit\/[^/]+$/.test(p);
    // 1.2: sales and data-entry staff may ADD a new lead (create only — never change or delete one); the server checks the fields
    const leadNew = op === "create" && /^leads\/[^/]+$/.test(p) && levelOf(acc) === "interact";
    if (leadNew) { const e = await checkNewLead(env, acc, b.data); if (e) return { error: "refused", message: e }; }
    // the audit trail is append-only for everyone: any signed-in person may ADD an entry about their own action
    if (!audit && !leadNew && !can(acc, p, "write")) return { error: "invalid_argument", message: "no such artifact, collection, or document (or no access)" };
    if (audit && op !== "create") return { error: "invalid_argument", message: "The audit trail cannot be changed or deleted." };
    const guarded = GUARDS.find((g) => g.re.test(p) && (!g.levels || g.levels.includes(levelOf(acc))));
    const curRow = op === "update" || guarded || op === "create" ? await env.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(p).first() : null;
    const old = curRow ? JSON.parse(curRow.data) : null;
    if (op === "delete") {
      if (guarded && guarded.del) { const e = guarded.del(old, acc); if (e) return { error: "refused", message: e }; }
      await env.DB.batch([env.DB.prepare("DELETE FROM docs WHERE path = ?").bind(p), env.DB.prepare("INSERT INTO gone (path, at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET at = excluded.at").bind(p, now())]); return { ok: true };
    }
    let data = b.data; if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "invalid_argument", message: "Document data must be an object." };
    if (op === "create" && old) return { ok: true, created: false };
    if (op === "update") { if (!old) return { error: "not_found", message: "missing" }; data = Object.assign({}, old, data); }
    if (audit) data = Object.assign({}, data, { by: acc.uid, at: now() });   // who and when are stamped by the server, never by the browser
    if (guarded) { const e = await guarded.check(env, acc, p, old, data); if (e) return { error: "refused", message: e }; }
    const s = JSON.stringify(data); if (enc.encode(s).length > DOC_MAX) return { error: "invalid_argument", message: "Document larger than 256 KiB." };
    if (op === "create") {
      const r = await env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING RETURNING v").bind(p, parentOf(p), s, now()).first();
      return { ok: true, created: !!r, version: r ? r.v : undefined };
    }
    const version = await setDoc(env, p, s);
    if (/^outbox\/[^/]+\/e\/[^/]+$/.test(p)) await fanOut(env, acc, p, data).catch(() => {});
    return { ok: true, version };
  }
  if (op === "acquire") {
    if (!can(acc, p, "write")) return { error: "invalid_argument", message: "lease refused" };
    const t = Date.now(), ttl = Math.max(1000, Math.min(600000, +b.ttlMs || 30000)), holder = String(b.holder || "");
    // atomic: take the lease only if it is free, expired or already ours
    const r = await env.DB.prepare("INSERT INTO leases (path, holder, exp) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET holder = excluded.holder, exp = excluded.exp WHERE leases.exp <= ?4 OR leases.holder = excluded.holder RETURNING holder")
      .bind(p, holder, t + ttl, t).first();
    if (r && r.holder === holder) return { acquired: true, holder, version: t };
    const l = await env.DB.prepare("SELECT exp FROM leases WHERE path = ?").bind(p).first();
    return { acquired: false, expiresAt: new Date(l ? l.exp : t).toISOString() };
  }
  return { error: "invalid_argument", message: "Unknown operation." };
}

/* ======================= pages ======================= */
/* 1.4.3 — sign-in, setup: a white "blueprint" scene built from the brand's building blocks (square, quarter-circle,
   half-circle, circle on one grid) beside the form. Same fields, same endpoints, same rules as before. */
const SCENE = `<svg class="scene" viewBox="0 0 640 520" aria-hidden="true" focusable="false">
<defs><pattern id="g8" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#E4E2DA" stroke-width=".6"/></pattern>
<pattern id="g80" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#D6D3C9" stroke-width=".8"/></pattern>
<linearGradient id="sweep" x1="0" x2="1"><stop offset="0" stop-color="#B8D241" stop-opacity="0"/><stop offset=".5" stop-color="#B8D241" stop-opacity=".22"/><stop offset="1" stop-color="#B8D241" stop-opacity="0"/></linearGradient></defs>
<rect class="sweep" x="-160" y="0" width="160" height="520" fill="url(#sweep)"/>
<g class="blk b1"><path d="M160 400V160a240 240 0 0 1 240 240z" fill="#262626"/></g>
<g class="blk b2"><path d="M400 400h160a80 80 0 0 0-160 0z" fill="#B8D241"/><rect x="400" y="400" width="160" height="80" fill="#EAE8E1"/></g>
<g class="blk b3"><rect x="400" y="160" width="160" height="160" fill="#FFFFFF" stroke="#262626" stroke-width="1.5"/><circle cx="480" cy="240" r="56" fill="#B8D241"/></g>
<g class="blk b4"><rect x="80" y="400" width="80" height="80" fill="#B8D241"/><path d="M160 400h80v80a80 80 0 0 1-80-80z" fill="#45453F"/></g>
<g class="dim" fill="none" stroke="#45453F" stroke-width="1"><path d="M160 136h240M160 130v12M400 130v12"/><path d="M584 160v160M578 160h12M578 320h12"/><path d="M56 400v80M50 400h12M50 480h12"/>
<path d="M400 400l42-42" stroke-dasharray="3 3"/><circle cx="160" cy="400" r="3" fill="#262626"/><circle cx="480" cy="240" r="2.5" fill="#262626"/></g>
<g class="lbl" font-family="Instrument Sans,Arial,sans-serif" font-size="11" fill="#45453F"><text x="280" y="126" text-anchor="middle">2400</text><text x="596" y="244" transform="rotate(90 596 244)" text-anchor="middle">1600</text>
<text x="44" y="444" transform="rotate(-90 44 444)" text-anchor="middle">800</text><text x="446" y="352">R 800</text><text x="80" y="504">Module X-01 · scale 1:10</text></g></svg>`;
const PAGE = (title, inner, { side = true } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#FBFAF6"><title>${title}</title>
<link rel="stylesheet" href="/app/fonts.css"><style>
:root{color-scheme:light;--ink:#262626;--g2:#45453F;--mut:#5E5E58;--line:#DCDAD2;--stone:#EAE8E1;--lime:#B8D241;--lime2:#A9C236;--cream:#FBFAF6;--red:#B3261E;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#fff;color:var(--ink);font:400 15px/1.5 "Instrument Sans",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{min-height:100%;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(380px,1fr)}
.stage{position:relative;overflow:hidden;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:28px;padding:44px 48px}
.stage::before{content:"";position:absolute;inset:0;background:linear-gradient(#D6D3C9 .8px,transparent .8px) 0 0/80px 80px,linear-gradient(90deg,#D6D3C9 .8px,transparent .8px) 0 0/80px 80px,linear-gradient(#ECEAE3 .6px,transparent .6px) 0 0/20px 20px,linear-gradient(90deg,#ECEAE3 .6px,transparent .6px) 0 0/20px 20px;
-webkit-mask-image:radial-gradient(120% 90% at 100% 100%,#000 35%,transparent 78%);mask-image:radial-gradient(120% 90% at 100% 100%,#000 35%,transparent 78%)}
.stage .logo{width:400px;max-width:100%;height:auto;position:relative;z-index:1}
.stage .scene{position:absolute;right:-24px;bottom:-24px;width:min(82%,720px);height:auto}
.stage .line{position:relative;z-index:1;font:600 26px/1.15 Fraunces,Georgia,serif;font-variation-settings:"SOFT" 100;letter-spacing:-.015em;max-width:22ch;margin:0}
.stage .line small{display:block;font:400 14px/1.5 "Instrument Sans",Arial,sans-serif;color:var(--mut);letter-spacing:0;margin-top:8px;max-width:40ch}
.panel{display:flex;align-items:center;justify-content:center;padding:40px 24px;background:var(--cream)}
form{position:relative;width:min(400px,100%);background:#fff;border:1px solid var(--line);border-radius:20px;padding:36px 32px 28px;display:grid;gap:16px;box-shadow:0 30px 60px -40px rgba(38,38,38,.45)}
form::after{content:"";position:absolute;top:-1px;right:-1px;width:44px;height:44px;background:var(--lime);border-radius:0 20px 0 44px}
.mlogo{display:none;width:150px;height:auto}
h1{font:600 30px/1.12 Fraunces,Georgia,serif;font-variation-settings:"SOFT" 100;letter-spacing:-.02em;margin:0;padding-right:24px}
.sub{margin:-8px 0 4px;color:var(--g2)}
label{display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--g2)}
.fld{position:relative}
input:not([type=checkbox]){width:100%;font:inherit;font-size:15px;padding:12px 14px;border-radius:12px;border:1.5px solid var(--line);background:#fff;color:var(--ink);transition:border-color .15s,box-shadow .15s}
input:not([type=checkbox]):hover{border-color:#C9C7BE}
input:not([type=checkbox]):focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 4px rgba(184,210,65,.45)}
form[data-bad] input:not([type=checkbox]){border-color:var(--red)}
.peek{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--g2);cursor:pointer;padding:6px 8px;border-radius:8px}
.peek:hover{background:var(--stone)}.peek input{accent-color:var(--ink);margin:0}
.fld input[type=password],.fld input[data-peek]{padding-right:84px}
button{position:relative;font:inherit;font-weight:600;font-size:15px;padding:13px;border:0;border-radius:999px;background:var(--lime);color:var(--ink);cursor:pointer;transition:background-color .15s,transform .1s;margin-top:4px}
button:hover{background:var(--lime2)}button:active{transform:scale(.985)}
button:focus-visible,.peek:focus-within{outline:3px solid var(--ink);outline-offset:2px}
button[disabled]{cursor:progress;color:transparent}
button[disabled]::after{content:"";position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2.5px solid rgba(38,38,38,.25);border-top-color:var(--ink);animation:spin .7s linear infinite}
.err{display:none;gap:10px;align-items:flex-start;background:#FBEAE8;color:#7A1A14;border-radius:12px;padding:10px 12px;font-size:14px}
.err.on{display:flex}.err::before{content:"!";flex:0 0 20px;height:20px;border-radius:50%;background:var(--red);color:#fff;font:700 13px/20px Arial;text-align:center}
.tiny{font-size:12.5px;color:var(--mut);margin:0}.help{border-top:1px solid var(--stone);padding-top:14px;display:grid;gap:6px}
.code{font-family:inherit;font-weight:600;background:var(--stone);padding:1px 6px;border-radius:6px}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes draw{from{stroke-dashoffset:300}to{stroke-dashoffset:0}}
@keyframes sweep{0%{transform:translateX(0)}100%{transform:translateX(960px)}}
.blk{animation:rise .7s var(--ease) both}.b2{animation-delay:.08s}.b3{animation-delay:.16s}.b4{animation-delay:.24s}
.dim path{stroke-dasharray:300;animation:draw 1.1s .35s var(--ease) both}.dim path[stroke-dasharray="3 3"]{animation:none}
.lbl{animation:rise .6s .6s both}.sweep{animation:sweep 9s 1.2s linear infinite}
form{animation:rise .6s .1s var(--ease) both}
body.leaving form{transition:opacity .3s,transform .3s var(--ease);opacity:0;transform:translateY(-8px) scale(.98)}
body.leaving .blk{transition:transform .45s var(--ease);transform:translateY(-12px)}
@media (max-width:900px){.wrap{grid-template-columns:1fr;grid-template-rows:auto 1fr}.stage{min-height:200px;padding:20px;border-right:0;border-bottom:1px solid var(--line)}
.stage .logo{width:150px}.stage .scene{width:min(62%,380px);right:-30px;bottom:-70px}.stage .line{display:none}.stage::before{-webkit-mask-image:linear-gradient(90deg,transparent 30%,#000 70%);mask-image:linear-gradient(90deg,transparent 30%,#000 70%)}.panel{padding:24px 16px 40px;align-items:flex-start}}
@media (max-width:480px){.stage{min-height:150px}.stage .logo{width:130px}form{padding:28px 20px 22px;border-radius:18px}h1{font-size:26px}}
.fgt{justify-self:center;font-size:13.5px;font-weight:600;color:var(--g2);text-decoration:underline;text-underline-offset:3px;padding:2px 6px;border-radius:6px}.fgt:hover{color:var(--ink)}.fgt:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.done{display:grid;gap:12px}.done .ic{width:44px;height:44px;border-radius:0 44px 0 0;background:var(--lime)}.done a.btn{display:block;text-align:center;font-weight:600;padding:13px;border-radius:999px;background:var(--lime);color:var(--ink);text-decoration:none}
/* 1.4.6 — "Signing in…": the official logo, revealed while the server checks the password (never before it answers) */
.sx{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:var(--cream);opacity:0;transition:opacity .25s var(--ease)}
.sx.on{opacity:1}.sx[hidden]{display:none}
.sx::before{content:"";position:absolute;inset:0;background:linear-gradient(#E3E0D7 .8px,transparent .8px) 0 0/80px 80px,linear-gradient(90deg,#E3E0D7 .8px,transparent .8px) 0 0/80px 80px;-webkit-mask-image:radial-gradient(70% 60% at 50% 50%,#000,transparent 75%);mask-image:radial-gradient(70% 60% at 50% 50%,#000,transparent 75%);opacity:.7}
.sx .in{position:relative;display:grid;justify-items:center;gap:16px;padding:24px;text-align:center}
.sx .lg{position:relative;width:min(340px,72vw)}
.sx .lg img{display:block;width:100%;height:auto;animation:reveal .9s .05s var(--ease) both}
.sx .lg::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.85) 50%,transparent 62%) no-repeat;background-size:250% 100%;background-position:120% 0;
-webkit-mask:url(/brand/logo_primary.png) center/100% 100% no-repeat;mask:url(/brand/logo_primary.png) center/100% 100% no-repeat;animation:sheen 1.8s .9s ease-in-out infinite}
.sx .bk{position:absolute;right:-18px;top:-14px;width:30px;height:30px;background:var(--lime);border-radius:0 20px 0 30px;animation:pop .5s .55s cubic-bezier(.3,1.6,.5,1) both,bob 1.3s 1.1s ease-in-out infinite alternate}
.sx .st{margin:6px 0 0;font:600 16px/1.3 "Instrument Sans",Arial,sans-serif;color:var(--ink);animation:rise .5s .35s var(--ease) both}
.sx .bar{width:200px;max-width:60vw;height:3px;border-radius:3px;background:var(--stone);overflow:hidden;animation:rise .5s .45s var(--ease) both}
.sx .bar i{display:block;height:100%;width:38%;border-radius:3px;background:var(--ink);animation:load 1.15s ease-in-out infinite}
.sx.ok .bar i{width:100%;animation:none;background:var(--lime2);transition:width .25s}
.sx .tag{margin:4px 0 0;font:italic 600 19px/1.2 Fraunces,Georgia,serif;font-variation-settings:"SOFT" 100;color:var(--g2);letter-spacing:-.01em;animation:rise .6s .6s var(--ease) both}
@keyframes reveal{from{clip-path:inset(0 100% 0 0);transform:scale(.97);filter:blur(3px)}to{clip-path:inset(0 0 0 0);transform:none;filter:none}}
@keyframes sheen{0%{background-position:120% 0}60%,100%{background-position:-20% 0}}
@keyframes pop{from{transform:scale(0) rotate(-30deg)}to{transform:none}}
@keyframes bob{to{transform:translateY(-5px) rotate(6deg)}}
@keyframes load{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.sx .lg::after{display:none}.sx .bar i{width:60%}}
</style></head><body><main class="wrap">${side ? `<section class="stage"><picture><source media="(max-width:900px)" srcset="/brand/logo_compact.png"><img class="logo" src="/brand/logo_primary.png" alt="Dupedia"></picture>${SCENE}
<p class="line">Serious about play.<small>Sales, site plans, factory, finance and market intelligence — one system for the whole company.</small></p></section>` : ""}
<section class="panel">${inner}</section></main></body></html>`;
const PEEK = `<label class="peek"><input type="checkbox" data-peek-for="pw"> Show</label>`;
const LOGIN = PAGE("Sign in · X FORCE", `<form id="f" novalidate><h1>Welcome to X&nbsp;FORCE</h1><p class="sub">Your intelligent operating system for everything Dupedia.</p>
<div class="err" id="e" role="alert"></div>
<label>Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
<label>Password<span class="fld"><input id="pw" name="password" type="password" autocomplete="current-password" required>${PEEK}</span></label>
<button>Sign in</button><a class="fgt" href="/forgot">Forgot your password?</a>
<div class="help"><p class="tiny">Accounts are created by an administrator. Five failed attempts lock the account for 15 minutes.</p></div></form>
<div class="sx" id="sx" hidden role="status" aria-live="polite"><div class="in"><div class="lg"><img src="/brand/logo_primary.png" alt="Dupedia" width="340" height="120"><span class="bk" aria-hidden="true"></span></div>
<p class="st" id="sx-t">Signing in…</p><div class="bar" aria-hidden="true"><i></i></div><p class="tag">serious about play</p></div></div>
<script src="/xf-login.js"></script>`);
const SETUP = PAGE("Set up · X FORCE", `<form id="f" data-setup="1" novalidate><h1>Set up X FORCE</h1><p class="sub">Create the owner account. This page closes for good afterwards.</p>
<div class="err" id="e" role="alert"></div>
<label>Setup code<input name="code" required autocomplete="off" spellcheck="false"><span class="tiny">The secret <span class="code">SETUP_CODE</span> you saved in Cloudflare.</span></label>
<label>Your name<input name="name" required autocomplete="name"></label><label>Username<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
<label>Password<span class="fld"><input id="pw" name="password" type="password" required autocomplete="new-password">${PEEK}</span><span class="tiny">10 or more characters, with letters and a digit.</span></label>
<button>Create owner account</button></form><script src="/xf-login.js"></script>`);
const FORGOT = PAGE("Forgot password · X FORCE", `<form id="f" data-mode="forgot" novalidate><h1>Forgot your password?</h1><p class="sub">Enter the e-mail address on your X FORCE account. We will send you a link to choose a new password.</p>
<div class="err" id="e" role="alert"></div>
<label>E-mail address<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required autofocus></label>
<button>Send the reset link</button><a class="fgt" href="/login">Back to sign in</a>
<div class="help"><p class="tiny">The link works once and expires after 30 minutes. No e-mail? Check spam, or ask an administrator to reset your password.</p></div></form>
<script src="/xf-login.js"></script>`);
const NOMAIL = PAGE("Forgot password · X FORCE", `<form><h1>Forgot your password?</h1><p class="sub">Password recovery by e-mail is not switched on for this company yet.</p>
<p class="tiny">Ask an administrator to reset your password: User Management → your name → Reset password.</p><a class="fgt" href="/login">Back to sign in</a></form>`);
const RESET = PAGE("Choose a new password · X FORCE", `<form id="f" data-mode="reset" novalidate><h1>Choose a new password</h1><p class="sub">This ends every other session on your account.</p>
<div class="err" id="e" role="alert"></div>
<label>New password<span class="fld"><input id="pw" name="password" type="password" autocomplete="new-password" required autofocus>${PEEK}</span><span class="tiny">10 or more characters, with letters and a digit.</span></label>
<label>Repeat the new password<input name="password2" type="password" autocomplete="new-password" required></label>
<button>Save the new password</button><a class="fgt" href="/forgot">Need a new link?</a></form>
<script src="/xf-login.js"></script>`);
const NOSETUP = PAGE("Not set up · X FORCE", `<form><h1>Almost there</h1><p class="sub">X FORCE has no administrator yet, and no setup code is configured.</p>
<p class="tiny">In Cloudflare: Workers &amp; Pages → this project → Settings → Variables and Secrets → add a <b>Secret</b> named <span class="code">SETUP_CODE</span> (a long random code only you know), then reload this page.</p></form>`);
const LOGIN_JS = `(function(){var f=document.getElementById("f");if(!f)return;var er=document.getElementById("e"),b=f.querySelector("button");
var mode=f.dataset.mode||"";var tok="";if(mode==="reset"){var m=/[#&]t=([A-Za-z0-9_-]{20,200})/.exec(location.hash);tok=m?m[1]:"";try{history.replaceState(null,"",location.pathname);}catch(x){}
if(!tok){f.innerHTML='<h1>This link is incomplete</h1><p class="sub">Open the link from your e-mail again, or ask for a new one.</p><a class="fgt" href="/forgot">Send a new link</a>';return;}}
function done(h,t,l,lt){f.innerHTML='<div class="done"><div class="ic"></div><h1>'+h+'</h1><p class="sub">'+t+'</p>'+(l?'<a class="btn" href="'+l+'">'+lt+'</a>':'')+'</div>';}
function peeks(){f.querySelectorAll("[data-peek-for]").forEach(function(c){c.onchange=function(){var i=document.getElementById(c.dataset.peekFor);i.type=c.checked?"text":"password";i.toggleAttribute("data-peek",c.checked);};});}peeks();
var oldpw="";function change(o){mode="change";oldpw=o||"";f.dataset.mode="change";
f.innerHTML='<h1>Choose your own password</h1><p class="sub">You signed in with a temporary password. Choose a new one to continue — the temporary password stops working as soon as you do.</p><div class="err" id="e" role="alert"></div>'+(oldpw?'':'<label>Temporary password<input name="old" type="password" autocomplete="current-password" required autofocus></label>')+'<label>New password<span class="fld"><input id="pw" name="password" type="password" autocomplete="new-password" required'+(oldpw?' autofocus':'')+'><label class="peek"><input type="checkbox" data-peek-for="pw"> Show</label></span><span class="tiny">10 or more characters, with letters and a digit.</span></label><label>Repeat the new password<input name="password2" type="password" autocomplete="new-password" required></label><button>Save and continue</button><a class="fgt" href="#" id="so">Sign out</a>';
er=document.getElementById("e");b=f.querySelector("button");peeks();var fi=f.querySelector("[autofocus]");if(fi)fi.focus();
document.getElementById("so").onclick=function(ev){ev.preventDefault();fetch("/api/logout",{method:"POST",headers:{"x-xf":"1"}}).finally(function(){location.href="/login";});};}
if(!mode&&/[?&]change=1/.test(location.search))change("");
function bad(m,el){er.textContent=m;er.classList.add("on");f.setAttribute("data-bad","");if(el)el.focus();}
f.addEventListener("input",function(){if(er.classList.contains("on")){er.classList.remove("on");f.removeAttribute("data-bad");}});
f.onsubmit=async function(e){e.preventDefault();er.classList.remove("on");f.removeAttribute("data-bad");
var miss=[].slice.call(f.querySelectorAll("input[required]")).find(function(i){return !i.value.trim();});
if(miss){return bad("Enter your "+(miss.closest("label").firstChild.textContent||"details").trim().toLowerCase()+".",miss);}
var d=Object.fromEntries(new FormData(f));
if(mode==="forgot"&&!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(d.email.trim()))return bad("Enter a valid e-mail address.",f.querySelector("input[name=email]"));
if(mode==="reset"||mode==="change"){if(d.password!==d.password2)return bad("The two passwords are not the same.",f.querySelector("input[name=password2]"));d=mode==="reset"?{token:tok,password:d.password}:{old:oldpw||d.old,password:d.password};}
b.disabled=true;b.setAttribute("aria-busy","true");
var sx=document.getElementById("sx"),signin=!mode&&!f.dataset.setup&&sx;if(signin){sx.classList.remove("ok");document.getElementById("sx-t").textContent="Signing in…";sx.hidden=false;requestAnimationFrame(function(){requestAnimationFrame(function(){sx.classList.add("on");});});}
var ac=window.AbortController?new AbortController():null,tm=setTimeout(function(){if(ac)ac.abort();},20000);
var r=await fetch(mode==="change"?"/api/password":mode==="forgot"?"/api/forgot":mode==="reset"?"/api/reset":f.dataset.setup?"/api/setup":"/api/login",{method:"POST",headers:{"content-type":"application/json","x-xf":"1"},body:JSON.stringify(d),signal:ac?ac.signal:undefined}).then(function(r){return r.json();}).catch(function(){return {error:"net",message:"The server did not answer. Check your connection and try again."};});clearTimeout(tm);
function unsx(){if(!signin)return;sx.classList.remove("on");setTimeout(function(){sx.hidden=true;},260);}
if(r.error||(!mode&&r.mustChange))unsx();
if(r.error){b.disabled=false;b.removeAttribute("aria-busy");if(mode==="change"&&r.error==="old"){if(oldpw){location.href="/login";return;}r.message="The temporary password is not correct.";}var pw=f.querySelector("input[name=password]");if(pw&&r.error==="credentials"){pw.value="";}return bad(r.message||r.error,r.error==="credentials"?pw:null);}
if(!mode&&r.mustChange){b.disabled=false;b.removeAttribute("aria-busy");return change(d.password);}
if(mode==="forgot")return done("Check your e-mail",r.message,"/login","Back to sign in");
if(mode==="reset")return done("Password changed","You can now sign in with your new password. Your other sessions were signed out.","/login","Sign in");
if(signin){sx.classList.add("ok");document.getElementById("sx-t").textContent="Signed in — opening your dashboard…";try{sessionStorage.setItem("xf.splash","1");}catch(x){}
setTimeout(function(){location.href="/";},matchMedia("(prefers-reduced-motion: reduce)").matches?0:220);return;}
document.body.classList.add("leaving");setTimeout(function(){location.href="/";},matchMedia("(prefers-reduced-motion: reduce)").matches?0:320);};
addEventListener("pageshow",function(e){var sx=document.getElementById("sx");if(e.persisted&&sx){sx.classList.remove("on");sx.hidden=true;if(b){b.disabled=false;b.removeAttribute("aria-busy");}}});})();`;
const setupDone = async (env) => !!(await env.DB.prepare("SELECT v FROM kv WHERE k = 'setup_done'").first()) || !!(await env.DB.prepare("SELECT uid FROM users LIMIT 1").first());
async function indexHtml(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL("/index.html", req.url)));
  let html = await r.text();
  if (!html.includes("app/products.js")) throw Object.assign(new Error("index.html is missing from the deployment."), { http: 500 });
  html = html.replace(/<script src="app\/products\.js"><\/script>/, `<script src="/xf-shim.js"></script>\n<script src="app/products.js"></script>`);
  return respond(200, html, "text/html; charset=utf-8");
}

/* ======================= storage report & backup ======================= */
async function storage(env) {
  const a = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM docs").first();
  const f = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM docs WHERE path GLOB '*/c/[0-9][0-9][0-9]'").first();
  const sz = await env.DB.prepare("SELECT 1").run(); const dbBytes = (sz.meta && sz.meta.size_after) || a.b;
  const quota = (parseInt(env.STORAGE_QUOTA_MB || "500", 10) || 500) * 1048576, warnAt = (parseInt(env.STORAGE_WARN_MB || "400", 10) || 400) * 1048576;
  return { documents: a.n, databaseBytes: dbBytes, fileChunkBytes: f.b, fileChunks: f.n, backupsBytes: 0, appBytes: 0, usedBytes: dbBytes, quotaBytes: quota, warnBytes: warnAt,
    diskFreeBytes: Math.max(0, quota - dbBytes), diskTotalBytes: quota, warning: dbBytes >= warnAt, at: now(), host: "cloudflare-d1" };
}
async function backupStream(env) {
  // streamed in pages so a large database never has to fit in memory at once
  const { readable, writable } = new TransformStream(); const w = writable.getWriter();
  (async () => {
    try {
      await w.write(enc.encode(`{"format":"xforce-server-db-1","at":${JSON.stringify(now())},"host":"cloudflare","docs":{`));
      let last = "", first = true;
      for (;;) {
        const rs = (await env.DB.prepare("SELECT path, data, v, at FROM docs WHERE path > ? ORDER BY path LIMIT 500").bind(last).all()).results || [];
        if (!rs.length) break;
        let chunk = ""; for (const r of rs) { chunk += `${first ? "" : ","}${JSON.stringify(r.path)}:{"d":${r.data},"v":${r.v},"at":${JSON.stringify(r.at)}}`; first = false; }
        await w.write(enc.encode(chunk)); last = rs[rs.length - 1].path;
      }
      await w.write(enc.encode("}}"));
    } catch (e) { await w.write(enc.encode(`}, "error": ${JSON.stringify(String(e.message || e))}}`)); }
    await w.close();
  })();
  return readable;
}

/* ======================= hourly sweep ======================= */
async function sweep(env) {
  await ensureSchema(env);
  const rs = (await env.DB.prepare(`SELECT path, data FROM docs WHERE parent IN ('directory','leads','orders','mi/req/r') OR parent GLOB 'claims/*/c' OR parent GLOB 'acts/*/a'
      OR path IN ('config/settings','config/roles','sweep/state')`).all()).results || [];
  const docs = {}; for (const r of rs) { try { docs[r.path] = JSON.parse(r.data); } catch (e) {} }
  const prevState = docs["sweep/state"] || {};
  let o;
  try { o = computeSweep(docs, Date.now());
    // 1.4.2: here the Worker itself runs research (researchTick, right after this sweep); no claude.ai task is started
    if (researchConfig(env).configured && o.state.research) for (const w of o.state.research.waiting) if (w.reason === "start-failed") {
      const t = "Not finished yet — the hourly research job on this site carries on with it (it may be waiting for today's limit or another run).";
      o.notes = o.notes.map((n) => (n.includes(w.id) && n.includes(w.detail) ? n.replace(w.detail, t) : n)); w.detail = t; }
  }
  catch (e) { await setDoc(env, "sweep/state", JSON.stringify(Object.assign({}, prevState, { lastError: String(e.message).slice(0, 300), lastErrorAt: now() }))); return { ok: false, error: e.message }; }
  const st = [], DB = env.DB, t = now();
  const put = (p, d) => st.push(DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, v = docs.v + 1, at = excluded.at").bind(p, parentOf(p), JSON.stringify(d), t));
  const putIfAbsent = (p, d) => st.push(DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING").bind(p, parentOf(p), JSON.stringify(d), t));
  const admins = Object.entries(docs).filter(([p, d]) => p.startsWith("directory/") && d.role === "admin" && d.active !== false && d.uid).map(([, d]) => d.uid);
  for (const r of o.releases) {
    st.push(DB.prepare("DELETE FROM docs WHERE path = ?").bind(`claims/${r.uid}/c/${r.lead}`));
    if (docs[`leads/${r.lead}`]) put(`leads/${r.lead}`, Object.assign({}, docs[`leads/${r.lead}`], r.leadPatch));
    putIfAbsent(`notif/${r.uid}/n/${r.notification.id}`, r.notification);
    const crm = await DB.prepare("SELECT data FROM docs WHERE path = ?").bind(`crm/${r.uid}/l/${r.lead}`).first();
    if (crm) put(`crm/${r.uid}/l/${r.lead}`, Object.assign(JSON.parse(crm.data), { stage: "released", releasedAt: o.now }));
    for (const a of admins) { const id = `release-adm-${r.lead}-${r.notification.id.split("-").pop()}`;
      putIfAbsent(`notif/${a}/n/${id}`, { id, type: "lead", title: "Lead released for inactivity", body: `${r.leadName} (owner: ${r.ownerName}) went back to the Lead Mine.`, link: { view: "allleads" }, ref: r.lead, at: o.now, from: "server-sweep", read: false }); }
  }
  for (const m of o.reminders) {
    putIfAbsent(`notif/${m.uid}/n/${m.notification.id}`, m.notification);
    const ap = `acts/${m.actOwner}/a/${m.act}`, a = docs[ap];
    if (a && !["done", "cancelled"].includes(a.followUpStatus)) { docs[ap] = Object.assign({}, a, m.actPatch); put(ap, docs[ap]); }
  }
  for (const p of o.overdue) for (const u of p.to || []) putIfAbsent(`notif/${u}/n/${p.notification.id}`, p.notification);
  put("sweep/state", Object.assign({}, o.state, { host: "cloudflare" }));
  if (o.releases.length) { const d = o.now.slice(0, 10); put(`adminlog/${d}-sweep-${o.now.slice(11, 16).replace(":", "")}`, { day: d, entries: o.releases.map((r) => ({ at: o.now, by: "server-sweep", action: "Lead released (inactivity)", target: r.lead, reason: o.reason, detail: `${r.leadName} · ${r.ownerName}` })) }); }
  await DB.batch(st);   // one atomic batch
  await DB.prepare("DELETE FROM sessions WHERE exp < ?").bind(Date.now()).run();
  const j13 = await alerts13(env).catch((e) => ({ error: String(e.message || e).slice(0, 200) }));
  return { ok: true, alerts: j13, releases: o.releases.length, reminders: o.reminders.length, overdue: o.overdue.length, researchQueued: o.researchFire };
}

/** 1.3 — reminders, factory deadlines, unassigned jobs, maintenance, payment dates near bank closures (see app/jobs13.js). */
async function alerts13(env) {
  const rs = (await env.DB.prepare(`SELECT path, data FROM docs WHERE parent IN ('assign','fac/jobs/j','fac/eq/e','fin/purch/p','orders','mkt/radar/a','mkt/part/p') OR parent GLOB 'rem/*/r' OR parent GLOB 'submissions/*/s' OR path IN ('hol/cal','mkt/cfg')`).all()).results || [];
  const docs = {}; for (const r of rs) { try { docs[r.path] = JSON.parse(r.data); } catch (e) {} }
  const list = globalThis.DPJobs13.plan(docs, Date.now()); if (!list.length) return { notifications: 0 };
  const lv = (q) => env.DB.prepare(q).all().then((x) => (x.results || []).map((r) => r.uid));
  const admins = await lv("SELECT uid FROM users WHERE active = 1 AND (level = 'admin' OR owner = 1)"), fin = await lv("SELECT uid FROM users WHERE active = 1 AND level = 'finance'");
  const t = now(), st = [];
  for (const { to, n } of list) { const ids = new Set(); for (const x of to) (x === "@admins" ? admins : x === "@finance" ? fin : [x]).forEach((u) => ids.add(u));
    for (const u of ids) st.push(env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING").bind(`notif/${u}/n/${n.id}`, `notif/${u}/n`, JSON.stringify(n), t)); }
  for (let i = 0; i < st.length; i += 80) await env.DB.batch(st.slice(i, i + 80));
  return { notifications: st.length };
}

/* ======================= router ======================= */
/* ======================= 1.4.4 password recovery ======================= */
const RESET_SELF_MIN = 30, RESET_ADMIN_MIN = 24 * 60;
/** 1.4.5 — temporary passwords expire: the administrator picks 1–168 hours (default and maximum from TEMP_PASSWORD_HOURS, default 24 / 168). */
const tempHours = (env, asked) => { const max = Math.max(1, Math.min(168, parseInt(env.TEMP_PASSWORD_MAX_HOURS || "168", 10) || 168)), def = Math.max(1, Math.min(max, parseInt(env.TEMP_PASSWORD_HOURS || "24", 10) || 24));
  const a = parseInt(asked, 10); return Number.isFinite(a) && a >= 1 ? Math.min(max, a) : def; };
const GENERIC_FORGOT = "If an account exists with this e-mail address, password recovery instructions have been sent.";
const tokenNew2 = () => b64(rand(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const appOrigin = (env, req) => String(env.APP_URL || new URL(req.url).origin).replace(/\/+$/, "");
/** Directory record (name, e-mail) of a login account. */
async function dirOf(env, uid) {
  const r = await env.DB.prepare("SELECT data FROM docs WHERE parent = 'directory' AND json_extract(data, '$.uid') = ? LIMIT 1").bind(uid).first();
  if (r) { try { return JSON.parse(r.data); } catch (e) {} } return null;
}
const emailOf = (d) => String((d && d.email) || "").trim().toLowerCase();
/** Create a single-use link for uid, e-mail it, record the attempt. The token itself is never stored or logged — only its hash. */
async function issueLink(env, req, uid, kind, by) {
  const a = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(uid).first(); if (!a) return { ok: false, error: "No such account." };
  const d = await dirOf(env, uid), to = emailOf(d); if (!to) return { ok: false, error: "This person has no e-mail address in X FORCE. Add one in their profile first." };
  const t = tokenNew2(), mins = kind === "self" ? RESET_SELF_MIN : RESET_ADMIN_MIN, th = await sha256("reset:" + t);
  await env.DB.batch([env.DB.prepare("UPDATE resets SET used_at = ? WHERE uid = ? AND used_at IS NULL AND kind IN ('self','admin-link')").bind("superseded " + now(), uid),
    env.DB.prepare("INSERT INTO resets (th, uid, kind, exp, created_at, created_by, mail) VALUES (?, ?, ?, ?, ?, ?, 'sending')").bind(th, uid, kind, Date.now() + mins * 60e3, now(), by || null)]);
  const origin = appOrigin(env, req), m = resetEmail({ name: (d && (d.firstName || d.displayName)) || a.name, link: `${origin}/reset#t=${t}`, minutes: mins, byAdmin: kind !== "self", origin });
  const r = await sendMail(env, { to, subject: m.subject, html: m.html, text: m.text });
  await env.DB.prepare("UPDATE resets SET mail = ? WHERE th = ?").bind(r.ok ? "sent " + now() : "failed: " + r.error, th).run();
  await auditSrv(env, by || uid, kind === "self" ? "Password reset requested (e-mail link)" : "Password reset link sent by an administrator", uid, r.ok ? "E-mail accepted by the provider" : r.error);
  return r.ok ? { ok: true, sentAt: now(), to: to.replace(/^(.).*(@.*)$/, "$1…$2") } : { ok: false, error: r.error };
}
async function auditSrv(env, by, action, target, detail) {
  const id = now().replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + tokenNew2().slice(0, 6).replace(/[^A-Za-z0-9]/g, "x");
  await env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, 'audit', ?, 1, ?) ON CONFLICT(path) DO NOTHING").bind("audit/" + id, JSON.stringify({ action, target, by, at: now(), kind: "security", detail: String(detail || "").slice(0, 300), server: true }), now()).run();
}
/** 1.4.6 — any administrator may reset the owner's password (recovery without the owner's approval). The owner is always
 *  told: an inbox alert (shown as urgent in "Needs your attention") and, when e-mail is set up, an e-mail to their address.
 *  Neither contains a password. */
async function ownerAlert(env, req, owner, by, what, { mail = true } = {}) {
  const when = now(), id = "sec-ownerreset-" + when.replace(/[^0-9]/g, "").slice(0, 14);
  const n = { id, type: "security", title: "Your password was reset by an administrator", body: `${by.name} (${by.username}) issued ${what} for your owner account on ${when.slice(0, 16).replace("T", " ")} UTC. If you did not arrange this, change your password and review the audit log.`, link: { view: "audit" }, at: when, from: by.uid, read: false, data: { by: by.uid, at: when, kind: "owner-reset" } };
  await env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING").bind(`notif/${owner.uid}/n/${id}`, `notif/${owner.uid}/n`, JSON.stringify(n), when).run();
  let sent = "not e-mailed";
  if (mail) { const d = await dirOf(env, owner.uid), to = emailOf(d);
    if (mailConfigured(env) && to) { const m = securityEmail({ name: (d && (d.firstName || d.displayName)) || owner.name, by: by.name, what, when, origin: appOrigin(env, req) }); const r = await sendMail(env, { to, subject: m.subject, html: m.html, text: m.text }); sent = r.ok ? "owner e-mailed" : "owner e-mail failed: " + r.error; }
    else sent = !to ? "owner has no e-mail on file" : "e-mail not set up"; }
  await auditSrv(env, by.uid, "Owner password reset — owner alerted", owner.uid, `${what}; inbox alert created; ${sent}`);
}
/** Generate a readable temporary password (letters and digits, no look-alikes). */
function tempPassword() { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = rand(16); let s = ""; for (const x of r) s += c[x % c.length]; return s.slice(0, 6) + "-" + s.slice(6, 12) + (2 + (r[0] % 8)); }

async function route(req, env, ctx) {
  const u = new URL(req.url), p = decodeURIComponent(u.pathname), M = req.method;
  // 1.3 — internal folders are never website files, whatever .assetsignore says (ops/ holds the manufacturing cost model)
  if (/^\/(ops|server|qa|worker|node_modules|\.git|\.github|\.wrangler)(\/|$)/i.test(p) || /^\/(\.dev\.vars|\.assetsignore|\.gitignore|wrangler\.jsonc|package(-lock)?\.json|[^/]*\.md|[^/]*-contents\.txt)$/i.test(p)) return respond(404, "Not found", "text/plain");
  if (p === "/xf-login.js") return respond(200, LOGIN_JS, "text/javascript; charset=utf-8");
  await ensureSchema(env);
  // ---- public: setup (once) and sign-in
  if (p === "/setup") return (await setupDone(env)) ? redirect("/") : respond(200, env.SETUP_CODE ? SETUP : NOSETUP, "text/html; charset=utf-8");
  if (p === "/api/setup" && M === "POST") {
    if (!csrfOk(req)) return json(403, { error: "forbidden" });
    if (await setupDone(env)) return json(410, { error: "done", message: "Setup is already complete." });
    if (!env.SETUP_CODE || String(env.SETUP_CODE).length < 8) return json(503, { error: "nocode", message: "No SETUP_CODE secret (8+ characters) is configured in Cloudflare." });
    const b = await body(req); if (await limited(env, "setup:" + ip(req))) return json(429, { error: "locked", message: "Too many attempts. Try again in 15 minutes." });
    if (!same(enc.encode(await sha256(String(b.code || ""))), enc.encode(await sha256(String(env.SETUP_CODE))))) { await failed(env, "setup:" + ip(req)); return json(403, { error: "code", message: "The setup code is not correct." }); }
    const prob = pwProblem(b.password); if (prob) return json(400, { error: "password", message: prob });
    const un = String(b.username || "").trim().toLowerCase(); if (!UNAME.test(un)) return json(400, { error: "username", message: "Username: 3–40 letters, digits, dot, dash or underscore." });
    const uid = uidNew(), h = await hashPw(env, b.password);
    // the setup flag is claimed atomically: two simultaneous setup attempts cannot both create an owner
    const claim = await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('setup_done', ?) ON CONFLICT(k) DO NOTHING RETURNING k").bind(now()).first();
    if (!claim) return json(410, { error: "done", message: "Setup is already complete." });
    await env.DB.prepare("INSERT INTO users (uid, username, name, level, owner, active, must_change, salt, hash, iter, created_at) VALUES (?, ?, ?, 'admin', 1, 1, 0, ?, ?, ?, ?)")
      .bind(uid, un, String(b.name || un).slice(0, 80), h.salt, h.hash, h.iter, now()).run();
    return json(200, { ok: true }, { "Set-Cookie": cookie(req, await newSession(env, uid), sessionDays(env) * 86400) });
  }
  if (p === "/login") return respond(200, LOGIN, "text/html; charset=utf-8");
  if (p === "/api/login" && M === "POST") {
    if (!csrfOk(req)) return json(403, { error: "forbidden" });
    const b = await body(req), un = String(b.username || "").trim().toLowerCase(), k1 = "u:" + un, k2 = "ip:" + ip(req);
    if ((await limited(env, k1)) || (await limited(env, k2))) return json(429, { error: "locked", message: "Too many failed attempts. Try again in 15 minutes." });
    const a = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(un).first();
    if (!a || !a.active || !(await checkPw(b.password, a))) { await failed(env, k1); await failed(env, k2, 30); return json(401, { error: "credentials", message: "Wrong username or password, or the account is deactivated." }); }
    if (a.must_change) { const te = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind("tempexp:" + a.uid).first();
      if (te && +te.v < Date.now()) { const x = await env.DB.prepare("UPDATE resets SET used_at = ? WHERE uid = ? AND kind = 'admin-temp' AND used_at IS NULL RETURNING th").bind("expired " + now(), a.uid).first();
        if (x) await auditSrv(env, a.uid, "Temporary password expired", a.uid, "Sign-in with an expired temporary password was refused; an administrator must issue a new one");
        return json(401, { error: "expired", message: "Your temporary password has expired. Ask an administrator for a new one, or use “Forgot your password?”." }); } }
    await env.DB.batch([env.DB.prepare("DELETE FROM fails WHERE k = ?").bind(k1), env.DB.prepare("UPDATE users SET last_login = ? WHERE uid = ?").bind(now(), a.uid)]);
    return json(200, { ok: true, mustChange: !!a.must_change }, { "Set-Cookie": cookie(req, await newSession(env, a.uid), sessionDays(env) * 86400) });
  }
  // ---- 1.4.4 public: forgotten password (e-mail link), choosing a new password
  if (p === "/forgot") return respond(200, mailConfigured(env) ? FORGOT : NOMAIL, "text/html; charset=utf-8");
  if (p === "/reset") return respond(200, RESET, "text/html; charset=utf-8");
  if (p === "/api/forgot" && M === "POST") {
    if (!csrfOk(req)) return json(403, { error: "forbidden" });
    if (!mailConfigured(env)) return json(503, { error: "not_configured", message: "Password recovery by e-mail is not switched on yet. Ask an administrator to reset your password." });
    const b = await body(req), email = String(b.email || "").trim().toLowerCase().slice(0, 200), ek = "fe:" + (await sha256(email)), ik = "fi:" + ip(req);
    const blocked = (await limited(env, ik)) || (await limited(env, ek));
    await failed(env, ik, 10); await failed(env, ek, 3);   // every request counts: 10 per address / 3 per e-mail, then 15 minutes' pause
    if (!blocked && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const work = (async () => {
        const rs = (await env.DB.prepare("SELECT data FROM docs WHERE parent = 'directory' AND LOWER(json_extract(data, '$.email')) = ?").bind(email).all()).results || [];
        for (const r of rs.slice(0, 3)) { let d; try { d = JSON.parse(r.data); } catch (e) { continue; } if (!d.uid || d.active === false) continue;
          const a = await env.DB.prepare("SELECT uid, active FROM users WHERE uid = ?").bind(d.uid).first(); if (a && a.active) await issueLink(env, req, a.uid, "self", null); }
      })().catch((e) => console.error("forgot: " + (e && e.message)));
      if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;   // the answer never waits for (or depends on) whether the address exists
    }
    return json(200, { ok: true, message: GENERIC_FORGOT });
  }
  if (p === "/api/reset" && M === "POST") {
    if (!csrfOk(req)) return json(403, { error: "forbidden" });
    const k = "rs:" + ip(req); if (await limited(env, k)) return json(429, { error: "locked", message: "Too many attempts. Try again in 15 minutes." });
    const b = await body(req), t = String(b.token || ""), prob = pwProblem(b.password);
    if (prob) return json(400, { error: "password", message: prob });
    const row = /^[A-Za-z0-9_-]{20,200}$/.test(t) ? await env.DB.prepare("UPDATE resets SET used_at = ? WHERE th = ? AND used_at IS NULL AND exp > ? AND kind IN ('self','admin-link') RETURNING uid").bind(now(), await sha256("reset:" + t), Date.now()).first() : null;
    if (!row) { await failed(env, k, 10); return json(400, { error: "token", message: "This link has expired or has already been used. Ask for a new one." }); }
    const a = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(row.uid).first();
    if (!a || !a.active) return json(400, { error: "token", message: "This account is deactivated. Contact an administrator." });
    const h = await hashPw(env, b.password);
    await env.DB.batch([env.DB.prepare("UPDATE users SET salt = ?, hash = ?, iter = ?, must_change = 0 WHERE uid = ?").bind(h.salt, h.hash, h.iter, a.uid),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(a.uid), env.DB.prepare("DELETE FROM fails WHERE k = ?").bind("u:" + a.username),
      env.DB.prepare("DELETE FROM kv WHERE k = ?").bind("tempexp:" + a.uid),
      env.DB.prepare("UPDATE resets SET used_at = ? WHERE uid = ? AND used_at IS NULL").bind("superseded " + now(), a.uid)]);
    await auditSrv(env, a.uid, "Password changed with a reset link", a.uid, "All sessions ended");
    return json(200, { ok: true });
  }
  // ---- everything below needs a session
  const acc = await account(env, req);
  if (p === "/" || p === "/index.html") { if (!(await setupDone(env))) return redirect("/setup"); if (!acc) return redirect("/login"); if (acc.must_change) return redirect("/login?change=1"); return indexHtml(env, req); }
  if (p === "/xf-shim.js") return acc ? env.ASSETS.fetch(req) : respond(401, "", "text/plain");
  if (!p.startsWith("/api/")) return respond(404, "Not found", "text/plain");
  if (p.startsWith("/api/ingest/")) return json(501, { error: "not_available", message: "Research results are not uploaded from outside on Cloudflare: research runs inside this Worker (Mission Control → Run research now)." });
  if (!acc) return json(401, { error: "unauthenticated", message: "Signed out — sign in again." });
  if (M !== "GET" && !csrfOk(req)) return json(403, { error: "forbidden" });
  // 1.4.5 — a temporary password only lets you choose your own: nothing else answers until it is changed
  if (acc.must_change && !["/api/me", "/api/password", "/api/logout"].includes(p)) return json(403, { error: "must_change", message: "Choose a new password first." });
  const admin = isAdminAcc(acc);
  if (p === "/api/me") return json(200, { uid: acc.uid, name: acc.name, username: acc.username, level: levelOf(acc), owner: !!acc.owner, mustChange: !!acc.must_change });
  if (p === "/api/logout" && M === "POST") { const t = cookies(req).xf_s; if (t) await env.DB.prepare("DELETE FROM sessions WHERE th = ?").bind(await sha256(t)).run(); return json(200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) }); }
  if (p === "/api/changes" && M === "GET") return json(200, await changes(env, acc, new URL(req.url).searchParams.get("since")));
  if (p === "/api/notif" && M === "POST") return json(200, await notifBulk(env, acc, await body(req)));
  if (p === "/api/db" && M === "POST") { const r = await dbOp(env, acc, await body(req)); return r.raw ? rawJson(200, r.raw) : json(200, r); }
  if (p === "/api/people") {
    const ids = String(u.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 100), q = String(u.searchParams.get("q") || "").toLowerCase();
    const rs = ids.length ? ((await env.DB.prepare(`SELECT uid, name FROM users WHERE uid IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results || [])
      : ((await env.DB.prepare("SELECT uid, name FROM users WHERE active = 1 AND (? = '' OR LOWER(name) LIKE ? OR username LIKE ?) LIMIT 50").bind(q, `%${q}%`, `%${q}%`).all()).results || []);
    return json(200, { people: rs.map((x) => ({ id: x.uid, name: x.name })) });
  }
  if (p === "/api/password" && M === "POST") {
    const b = await body(req);
    if (!(await checkPw(b.old, acc))) return json(403, { error: "old", message: "The current password is not correct." });
    const prob = pwProblem(b.password); if (prob) return json(400, { error: "password", message: prob });
    if (String(b.password) === String(b.old)) return json(400, { error: "password", message: "Choose a password different from the current one." });
    const h = await hashPw(env, b.password), keep = await sha256(cookies(req).xf_s || "");
    if (acc.must_change) { const u = await env.DB.prepare("UPDATE resets SET used_at = ? WHERE uid = ? AND kind = 'admin-temp' AND used_at IS NULL RETURNING th").bind(now(), acc.uid).first();
      await auditSrv(env, acc.uid, "Temporary password used", acc.uid, u ? "Signed in with the temporary password and replaced it with their own; the temporary password no longer works" : "First password replaced with their own"); }
    await env.DB.batch([env.DB.prepare("UPDATE users SET salt = ?, hash = ?, iter = ?, must_change = 0 WHERE uid = ?").bind(h.salt, h.hash, h.iter, acc.uid),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ? AND th <> ?").bind(acc.uid, keep), env.DB.prepare("DELETE FROM kv WHERE k = ?").bind("tempexp:" + acc.uid)]);
    return json(200, { ok: true });
  }
  // ---- administrators
  if (!admin) return json(403, { error: "forbidden", message: "Administrators only." });
  if (p === "/api/accounts" && M === "GET") {
    const last = {}; for (const r of ((await env.DB.prepare("SELECT uid, kind, created_at, used_at, mail, exp FROM resets ORDER BY created_at").all()).results || []))
      last[r.uid] = { kind: r.kind, at: r.created_at, mail: r.mail || null, used: r.used_at && !/^(superseded|expired)/.test(String(r.used_at)) ? r.used_at : null, expired: (!r.used_at && r.exp < Date.now()) || String(r.used_at || "").startsWith("expired"), exp: new Date(r.exp).toISOString(),
        state: !r.used_at ? (r.exp < Date.now() ? "expired" : "active") : String(r.used_at).startsWith("superseded") ? "superseded" : String(r.used_at).startsWith("expired") ? "expired" : "used" };
    const locks = new Set(((await env.DB.prepare("SELECT k FROM fails WHERE k LIKE 'u:%' AND until > ?").bind(Date.now()).all()).results || []).map((r) => r.k.slice(2)));
    return json(200, { mail: mailConfigured(env), accounts: ((await env.DB.prepare("SELECT * FROM users ORDER BY created_at").all()).results || []).map((x) => Object.assign(pubAcc(x), { lastReset: last[x.uid] || null, locked: locks.has(x.username) })) });
  }
  const mr = p.match(/^\/api\/accounts\/(u_[A-Za-z0-9]{10,40})\/reset$/);
  if (mr && M === "POST") {
    const b = await body(req), a = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(mr[1]).first();
    if (!a) return json(404, { error: "not_found", message: "No such account." });
    if (a.uid === acc.uid) { await auditSrv(env, acc.uid, "Password reset refused", a.uid, "Own account — use My Profile → Change password"); return json(400, { error: "self", message: "Change your own password in My Profile → Change password (or use “Forgot your password?” on the sign-in page)." }); }
    await env.DB.prepare("DELETE FROM fails WHERE k = ?").bind("u:" + a.username).run();   // a locked-out person can be helped at once
    if (b.mode === "link") {
      if (!mailConfigured(env)) return json(400, { error: "not_configured", message: "E-mail is not set up yet (RESEND_API_KEY and MAIL_FROM). Use a temporary password instead." });
      const r = await issueLink(env, req, a.uid, "admin-link", acc.uid);
      if (r.ok && a.owner) await ownerAlert(env, req, a, acc, "a reset link", { mail: false });
      return json(r.ok ? 200 : 400, r.ok ? { ok: true, mode: "link", sentAt: r.sentAt, to: r.to } : { error: "mail", message: r.error });
    }
    if (b.mode === "temp") {
      const hrs = tempHours(env, b.hours), pw = tempPassword(), h = await hashPw(env, pw), exp = Date.now() + hrs * 3600e3;
      await env.DB.batch([env.DB.prepare("UPDATE users SET salt = ?, hash = ?, iter = ?, must_change = 1 WHERE uid = ?").bind(h.salt, h.hash, h.iter, a.uid),
        env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(a.uid),
        env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("tempexp:" + a.uid, String(exp)),
        env.DB.prepare("UPDATE resets SET used_at = ? WHERE uid = ? AND used_at IS NULL").bind("superseded " + now(), a.uid),
        env.DB.prepare("INSERT INTO resets (th, uid, kind, exp, created_at, created_by, mail) VALUES (?, ?, 'admin-temp', ?, ?, ?, 'not e-mailed — given in person')").bind(await sha256("temp:" + tokenNew2()), a.uid, exp, now(), acc.uid)]);
      // optional: e-mail sign-in instructions — never the password itself
      let mail = { requested: !!b.notify, ok: false, error: null };
      if (b.notify) {
        const d = await dirOf(env, a.uid), to = emailOf(d);
        if (!mailConfigured(env)) mail.error = "E-mail is not set up on the server.";
        else if (!to) mail.error = "No e-mail address on file.";
        else { const m = tempEmail({ name: (d && (d.firstName || d.displayName)) || a.name, username: a.username, hours: hrs, origin: appOrigin(env, req) });
          const r = await sendMail(env, { to, subject: m.subject, html: m.html, text: m.text }); mail = { requested: true, ok: r.ok, error: r.ok ? null : r.error, to: to.replace(/^(.).*(@.*)$/, "$1…$2") }; }
        await env.DB.prepare("UPDATE resets SET mail = ? WHERE uid = ? AND kind = 'admin-temp' AND exp = ?").bind(mail.ok ? "instructions sent " + now() : "instructions NOT sent: " + mail.error, a.uid, exp).run();
      }
      await auditSrv(env, acc.uid, "Temporary password generated", a.uid, `Generated (${a.level === "admin" || a.owner ? "administrator" : a.level} account); sessions ended; must be changed at sign-in; expires in ${hrs} h; e-mail: ${b.notify ? (mail.ok ? "instructions sent" : "not sent — " + mail.error) : "not requested"}`);
      if (a.owner) await ownerAlert(env, req, a, acc, "a temporary password");
      return json(200, { ok: true, mode: "temp", tempPassword: pw, expiresAt: new Date(exp).toISOString(), hours: hrs, mail }, { "Cache-Control": "no-store" });
    }
    return json(400, { error: "invalid_argument", message: "Choose how to reset: e-mail link or temporary password." });
  }
  if (p === "/api/accounts" && M === "POST") {
    const b = await body(req), un = String(b.username || "").trim().toLowerCase();
    if (!UNAME.test(un)) return json(400, { error: "username", message: "Username: 3–40 letters, digits, dot, dash or underscore." });
    if (await env.DB.prepare("SELECT uid FROM users WHERE username = ?").bind(un).first()) return json(409, { error: "exists", message: "This username is taken." });
    const prob = pwProblem(b.password); if (prob) return json(400, { error: "password", message: "Temporary password: " + prob });
    const uid = uidNew(), h = await hashPw(env, b.password);
    await env.DB.prepare("INSERT INTO users (uid, username, name, level, owner, active, must_change, salt, hash, iter, created_at, created_by) VALUES (?, ?, ?, ?, 0, 1, 1, ?, ?, ?, ?, ?)")
      .bind(uid, un, String(b.name || un).slice(0, 80), ACC_LEVELS[b.level] || "interact", h.salt, h.hash, h.iter, now(), acc.uid).run();
    await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("tempexp:" + uid, String(Date.now() + tempHours(env, env.TEMP_PASSWORD_MAX_HOURS || 168) * 3600e3)).run();
    return json(200, { uid });
  }
  const m = p.match(/^\/api\/accounts\/(u_[A-Za-z0-9]{10,40})$/);
  if (m && M === "POST") {
    const a = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(m[1]).first(); if (!a) return json(404, { error: "not_found" });
    const b = await body(req);
    if (a.owner && (b.active === false || (b.level && b.level !== "admin"))) return json(400, { error: "owner", message: "The owner account cannot be deactivated or demoted." });
    if (b.level) a.level = ACC_LEVELS[b.level] || "interact"; if (b.active != null) a.active = b.active ? 1 : 0; if (b.name) a.name = String(b.name).slice(0, 80);
    const st = [];
    if (b.password && a.uid === acc.uid) return json(400, { error: "self", message: "Change your own password in My Profile." });
    if (b.password && a.owner) await ownerAlert(env, req, a, acc, "a password chosen by the administrator");
    if (b.password) { await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("tempexp:" + a.uid, String(Date.now() + tempHours(env) * 3600e3)).run(); await auditSrv(env, acc.uid, "Temporary password set by an administrator", a.uid, "Chosen by the administrator; must be changed at sign-in"); }
    if (b.password) { const prob = pwProblem(b.password); if (prob) return json(400, { error: "password", message: prob }); const h = await hashPw(env, b.password); Object.assign(a, { salt: h.salt, hash: h.hash, iter: h.iter, must_change: 1 }); }
    st.push(env.DB.prepare("UPDATE users SET level = ?, active = ?, name = ?, salt = ?, hash = ?, iter = ?, must_change = ? WHERE uid = ?").bind(a.level, a.active, a.name, a.salt, a.hash, a.iter, a.must_change, a.uid));
    if (!a.active || b.password) st.push(env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(a.uid));   // deactivation / reset ends their sessions at once
    await env.DB.batch(st);
    return json(200, { ok: true, account: pubAcc(a) });
  }
  if (p === "/api/storage") { const s = await storage(env), sw = await env.DB.prepare("SELECT data FROM docs WHERE path = 'sweep/state'").first(); const ss = sw ? JSON.parse(sw.data) : {};
    return json(200, Object.assign(s, { jobs: { sweep: { last: ss.lastRun || null, error: ss.lastError || null, enabled: true } } })); }
  if (p === "/api/backup") return respond(200, await backupStream(env), "application/json", { "Content-Disposition": `attachment; filename="xforce-backup-${now().slice(0, 10)}.json"` });
  if (p === "/api/jobs/sweep" && M === "POST") return json(200, await sweep(env));
  // 1.4.2 — Market Intelligence research run by Claude (Claude API + web search); the key stays in Cloudflare
  if (p === "/api/research/status" && M === "GET") { const c = researchConfig(env), k = "research:" + now().slice(0, 10), r = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first();
    return json(200, { configured: c.configured, model: c.model, maxSearches: c.maxSearches, dailyJobs: c.dailyJobs, usedToday: r ? parseInt(r.v, 10) || 0 : 0 }); }
  if (p === "/api/jobs/research" && M === "POST") return json(200, await researchTick(env));
  if (p === "/api/research/run" && M === "POST") { const b = await body(req); if (!/^[A-Za-z0-9_\-]{1,80}$/.test(String(b.id || ""))) return json(400, { error: "invalid_argument", message: "Request id missing." });
    return json(200, await runRequestJob(env, String(b.id), b.job ? String(b.job) : null, acc.uid)); }
  return json(404, { error: "not_found" });
}

export default {
  async fetch(req, env, ctx) {
    try { return await route(req, env, ctx); }
    catch (e) { console.error("error:", e && (e.stack || e)); return json(e.http || 500, { error: "server", message: e.http ? e.message : "Server error." }); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env).then((r) => console.log("sweep:", JSON.stringify(r))).catch((e) => console.error("sweep failed:", e && (e.stack || e)))
      .then(() => researchTick(env)).then((r) => console.log("research:", JSON.stringify(r).slice(0, 500))).catch((e) => console.error("research tick failed:", e && (e.stack || e))));
  },
};
export { sweep };
