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
import { computeSweep } from "./sweep.js";

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
  const base = await staffRoleBase(env, acc.uid), kind = base === "employee" ? "sales" : base === "dataentry" ? "dataentry" : null;
  if (!kind) return "Your role cannot add leads.";
  if (d.createdBy !== acc.uid || d.originKind !== kind) return "A new lead must be recorded as created by you, with your role as its origin.";
  if (!String(d.name || "").trim()) return "Enter the organisation name.";
  if (d.assignedTo || d.assignedBy || d.extensions || d.releases || d.mergedInto) return "A new lead cannot be assigned, extended or merged by its creator.";
  if (!["available", "research"].includes(d.status)) return "A new lead starts as Available or Under Research.";
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
const PRE_APPROVED = [["commission", (l) => l.commission && `commissions/${l.commission.uid}/r/${l.commission.oid}`, (d) => ["approved", "paid"].includes(d.status)],
  ["payroll", (l) => l.payroll && `fin/payroll/r/${l.payroll}`, (d) => ["approved", "partly_paid"].includes(d.status)],
  ["wdue", (l) => l.wdue && `fin/wdue/d/${l.wdue}`, (d) => ["approved", "partly_paid"].includes(d.status)],
  ["purchase", (l) => l.purchase && `fin/purch/p/${l.purchase}`, (d) => ["approved", "received"].includes(d.status)]];
const GUARDS = [
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
      if (old && L.includes(old.status)) { const f = frozen(old, next, ["uid", "period", "baseMinor", "allowances", "bonuses", "deductions", "recoveries", "adjustments", "grossMinor", "netMinor", "approvedBy", "approvedAt"]);
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
    const rs = (await env.DB.prepare("SELECT path, data FROM docs WHERE parent = ?").bind(p).all()).results || [];
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
      await env.DB.prepare("DELETE FROM docs WHERE path = ?").bind(p).run(); return { ok: true };
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
    return { ok: true, version: await setDoc(env, p, s) };
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
const PAGE = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="/app/fonts.css"><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1a14;color:#eef3e6;font:16px/1.5 "Instrument Sans",system-ui,sans-serif;padding:16px}
form{width:min(380px,100%);background:#16241c;border:1px solid #2c4033;border-radius:16px;padding:28px;display:grid;gap:14px}h1{font:600 26px "Fraunces",Georgia,serif;margin:0}img{height:34px}label{display:grid;gap:4px;font-size:13px;color:#b9c7b0}
input{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #3a5242;background:#0f1a14;color:inherit}button{font:inherit;font-weight:600;padding:11px;border:0;border-radius:10px;background:#B8D241;color:#0f1a14;cursor:pointer}
.err{color:#ff8a7a;font-size:14px;min-height:1.2em}.tiny{font-size:12px;color:#8fa287}</style></head><body>${inner}</body></html>`;
const LOGIN = PAGE("Sign in · X FORCE", `<form id="f"><img src="/brand/logo_compact.png" alt="Dupedia"><h1>X FORCE</h1><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button><div class="err" id="e" role="alert"></div><p class="tiny">Accounts are created by your administrator. Five failed attempts lock the account for 15 minutes.</p></form>
<script src="/xf-login.js"></script>`);
const SETUP = PAGE("Set up · X FORCE", `<form id="f" data-setup="1"><img src="/brand/logo_compact.png" alt="Dupedia"><h1>First administrator</h1><p class="tiny">Enter the one-time setup code you saved in Cloudflare as the secret SETUP_CODE, then create the owner account. This page closes for good afterwards.</p>
<label>Setup code<input name="code" required autocomplete="off"></label><label>Your name<input name="name" required></label><label>Username<input name="username" required autocomplete="username"></label><label>Password (10+ characters, letters and a digit)<input name="password" type="password" required autocomplete="new-password"></label><button>Create owner account</button><div class="err" id="e" role="alert"></div></form><script src="/xf-login.js"></script>`);
const NOSETUP = PAGE("Not set up · X FORCE", `<form><img src="/brand/logo_compact.png" alt="Dupedia"><h1>Almost there</h1><p>X FORCE has no administrator yet, and no setup code is configured.</p><p class="tiny">In Cloudflare: Workers &amp; Pages → this project → Settings → Variables and Secrets → add a <b>Secret</b> named <b>SETUP_CODE</b> (a long random code only you know), then reload this page.</p></form>`);
const LOGIN_JS = `document.getElementById("f").onsubmit=async(e)=>{e.preventDefault();const f=e.target,b=f.querySelector("button"),er=document.getElementById("e");er.textContent="";b.disabled=true;
const d=Object.fromEntries(new FormData(f));const r=await fetch(f.dataset.setup?"/api/setup":"/api/login",{method:"POST",headers:{"content-type":"application/json","x-xf":"1"},body:JSON.stringify(d)}).then(r=>r.json()).catch(()=>({error:"The server cannot be reached."}));
b.disabled=false;if(r.error){er.textContent=r.message||r.error;return;}location.href="/";};`;
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
  try { o = computeSweep(docs, Date.now()); }
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
  return { ok: true, releases: o.releases.length, reminders: o.reminders.length, overdue: o.overdue.length, researchQueued: o.researchFire };
}

/* ======================= router ======================= */
async function route(req, env) {
  const u = new URL(req.url), p = decodeURIComponent(u.pathname), M = req.method;
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
    await env.DB.batch([env.DB.prepare("DELETE FROM fails WHERE k = ?").bind(k1), env.DB.prepare("UPDATE users SET last_login = ? WHERE uid = ?").bind(now(), a.uid)]);
    return json(200, { ok: true, mustChange: !!a.must_change }, { "Set-Cookie": cookie(req, await newSession(env, a.uid), sessionDays(env) * 86400) });
  }
  // ---- everything below needs a session
  const acc = await account(env, req);
  if (p === "/" || p === "/index.html") { if (!(await setupDone(env))) return redirect("/setup"); if (!acc) return redirect("/login"); return indexHtml(env, req); }
  if (p === "/xf-shim.js") return acc ? env.ASSETS.fetch(req) : respond(401, "", "text/plain");
  if (!p.startsWith("/api/")) return respond(404, "Not found", "text/plain");
  if (p.startsWith("/api/ingest/")) return json(501, { error: "not_available", message: "Research ingest is not available on the Cloudflare version yet. Market Intelligence research runs on claude.ai." });
  if (!acc) return json(401, { error: "unauthenticated", message: "Signed out — sign in again." });
  if (M !== "GET" && !csrfOk(req)) return json(403, { error: "forbidden" });
  const admin = isAdminAcc(acc);
  if (p === "/api/me") return json(200, { uid: acc.uid, name: acc.name, username: acc.username, level: levelOf(acc), owner: !!acc.owner, mustChange: !!acc.must_change });
  if (p === "/api/logout" && M === "POST") { const t = cookies(req).xf_s; if (t) await env.DB.prepare("DELETE FROM sessions WHERE th = ?").bind(await sha256(t)).run(); return json(200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) }); }
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
    const h = await hashPw(env, b.password), keep = await sha256(cookies(req).xf_s || "");
    await env.DB.batch([env.DB.prepare("UPDATE users SET salt = ?, hash = ?, iter = ?, must_change = 0 WHERE uid = ?").bind(h.salt, h.hash, h.iter, acc.uid),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ? AND th <> ?").bind(acc.uid, keep)]);
    return json(200, { ok: true });
  }
  // ---- administrators
  if (!admin) return json(403, { error: "forbidden", message: "Administrators only." });
  if (p === "/api/accounts" && M === "GET") return json(200, { accounts: ((await env.DB.prepare("SELECT * FROM users ORDER BY created_at").all()).results || []).map(pubAcc) });
  if (p === "/api/accounts" && M === "POST") {
    const b = await body(req), un = String(b.username || "").trim().toLowerCase();
    if (!UNAME.test(un)) return json(400, { error: "username", message: "Username: 3–40 letters, digits, dot, dash or underscore." });
    if (await env.DB.prepare("SELECT uid FROM users WHERE username = ?").bind(un).first()) return json(409, { error: "exists", message: "This username is taken." });
    const prob = pwProblem(b.password); if (prob) return json(400, { error: "password", message: "Temporary password: " + prob });
    const uid = uidNew(), h = await hashPw(env, b.password);
    await env.DB.prepare("INSERT INTO users (uid, username, name, level, owner, active, must_change, salt, hash, iter, created_at, created_by) VALUES (?, ?, ?, ?, 0, 1, 1, ?, ?, ?, ?, ?)")
      .bind(uid, un, String(b.name || un).slice(0, 80), ACC_LEVELS[b.level] || "interact", h.salt, h.hash, h.iter, now(), acc.uid).run();
    return json(200, { uid });
  }
  const m = p.match(/^\/api\/accounts\/(u_[A-Za-z0-9]{10,40})$/);
  if (m && M === "POST") {
    const a = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(m[1]).first(); if (!a) return json(404, { error: "not_found" });
    const b = await body(req);
    if (a.owner && (b.active === false || (b.level && b.level !== "admin"))) return json(400, { error: "owner", message: "The owner account cannot be deactivated or demoted." });
    if (b.level) a.level = ACC_LEVELS[b.level] || "interact"; if (b.active != null) a.active = b.active ? 1 : 0; if (b.name) a.name = String(b.name).slice(0, 80);
    const st = [];
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
  return json(404, { error: "not_found" });
}

export default {
  async fetch(req, env) {
    try { return await route(req, env); }
    catch (e) { console.error("error:", e && (e.stack || e)); return json(e.http || 500, { error: "server", message: e.http ? e.message : "Server error." }); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env).then((r) => console.log("sweep:", JSON.stringify(r))).catch((e) => console.error("sweep failed:", e && (e.stack || e))));
  },
};
export { sweep };
