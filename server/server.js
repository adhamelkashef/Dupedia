#!/usr/bin/env node
/* X FORCE 1.1 (Dupedia) — self-hosted server. Zero dependencies (Node.js 18+ standard library only).

   What it does
   • Serves the X FORCE app unchanged and gives it the same shared-database and user capabilities it uses on claude.ai,
     through a small browser shim (server/shim.js) that talks to this server.
   • Sign-in with username + password (scrypt hashes, HttpOnly session cookie, login rate limiting). No public registration:
     the first administrator is created once with a one-time setup code; everyone else is created by an administrator.
   • Enforces the app's own access rules (DPStore.RULES — the same table published on claude.ai) on every read and write,
     keyed on the account's level: owner / admin (Dupedia administrators) or interact (sales, engineers, data entry).
     Deactivated accounts cannot sign in and their sessions end immediately.
   • Stores documents in DATA_DIR as a snapshot + append-only journal (crash-safe, compacted automatically), with daily
     backups (BACKUP_KEEP, default 7) and an administrator backup download.
   • Runs the hourly server sweep (ops/sweep.py: 24-hour lead release, follow-up reminders, overdue payments) when Python 3
     is installed, and offers an authenticated ingest endpoint for Market Intelligence research results (ops/intel.py).

   Commands
     node server/server.js                      start (PORT, default 8080)
     node server/server.js import <dir|file>    load a claude.ai database export (ArtifactData out_dir dump or backup JSON)
     node server/server.js reset-password <username> <new password>
   Configuration: environment variables, see server/README.md. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process"), os = require("os");
global.self = global; require("../app/store.js"); const RULES = global.DPStore;

const ROOT = path.resolve(__dirname, "..");
const ENV = process.env;
const CFG = {
  port: +ENV.PORT || 8080, host: ENV.HOST || "0.0.0.0",
  data: path.resolve(ENV.DATA_DIR || path.join(ROOT, "server", "var")),
  secureCookie: ENV.COOKIE_SECURE === "1" || ENV.COOKIE_SECURE === "true",
  trustProxy: ENV.TRUST_PROXY === "1", sessionDays: +ENV.SESSION_DAYS || 14,
  maxBody: (+ENV.MAX_BODY_MB || 4) * 1048576, backupKeep: +ENV.BACKUP_KEEP || 7,
  python: ENV.PYTHON || "python3", sweep: ENV.SWEEP !== "0", researchToken: ENV.RESEARCH_TOKEN || "",
  warnMb: +ENV.STORAGE_WARN_MB || 400, quotaMb: +ENV.STORAGE_QUOTA_MB || 500, tz: ENV.TZ_COMPANY || "Africa/Cairo",
};
const DOC_MAX = 256 * 1024;
const PATH_RE = /^(?!\.\.?(?:\/|$))[A-Za-z0-9_\-.~:@+]{1,200}(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9_\-.~:@+]{1,200}){0,14}$/;
const now = () => new Date().toISOString();
const log = (...a) => console.log(new Date().toISOString(), ...a);
fs.mkdirSync(CFG.data, { recursive: true }); fs.mkdirSync(path.join(CFG.data, "backups"), { recursive: true });

/* ======================= document store (snapshot + journal) ======================= */
const Store = {
  docs: new Map(), meta: new Map(), kids: new Map(), ops: 0,
  snapFile: path.join(CFG.data, "db.json"), jFile: path.join(CFG.data, "journal.jsonl"),
  parent(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); },
  index(p, add) { const c = this.parent(p); let s = this.kids.get(c); if (add) { if (!s) this.kids.set(c, (s = new Set())); s.add(p); } else if (s) { s.delete(p); if (!s.size) this.kids.delete(c); } },
  apply(e) {
    if (e.op === "set") { this.docs.set(e.p, e.d); this.meta.set(e.p, { v: e.v, at: e.at }); this.index(e.p, true); }
    else if (e.op === "del") { this.docs.delete(e.p); this.meta.delete(e.p); this.index(e.p, false); }
  },
  load() {
    if (fs.existsSync(this.snapFile)) { const s = JSON.parse(fs.readFileSync(this.snapFile, "utf8")); for (const [p, x] of Object.entries(s.docs || {})) this.apply({ op: "set", p, d: x.d, v: x.v, at: x.at }); }
    if (fs.existsSync(this.jFile)) { const lines = fs.readFileSync(this.jFile, "utf8").split("\n"); let bad = 0;
      for (const l of lines) { if (!l.trim()) continue; try { this.apply(JSON.parse(l)); } catch (e) { bad++; } }
      if (bad) log(`journal: ${bad} incomplete line(s) ignored (interrupted write)`); }
    this.compact(); log(`store: ${this.docs.size} documents loaded from ${CFG.data}`);
  },
  write(e) { e.at = now(); fs.appendFileSync(this.jFile, JSON.stringify(e) + "\n"); this.apply(e); if (++this.ops >= 2000) this.compact(); },
  set(p, d) { const v = ((this.meta.get(p) || {}).v || 0) + 1; this.write({ op: "set", p, d, v }); return v; },
  del(p) { if (this.docs.has(p)) this.write({ op: "del", p }); },
  compact() {
    const out = { format: "xforce-server-db-1", at: now(), docs: {} };
    for (const [p, d] of this.docs) { const m = this.meta.get(p) || {}; out.docs[p] = { d, v: m.v || 1, at: m.at || null }; }
    const tmp = this.snapFile + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, this.snapFile); fs.writeFileSync(this.jFile, ""); this.ops = 0;
  },
  children(coll) { return [...(this.kids.get(coll) || [])].filter((p) => p.split("/").length === coll.split("/").length + 1); },
};

/* ======================= accounts, sessions, rate limits ======================= */
const AFILE = path.join(CFG.data, "accounts.json");
const Acc = {
  d: { users: {}, setupDone: false },
  load() { if (fs.existsSync(AFILE)) this.d = JSON.parse(fs.readFileSync(AFILE, "utf8")); },
  save() { const t = AFILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(this.d, null, 1), { mode: 0o600 }); fs.renameSync(t, AFILE); },
  byName(u) { u = String(u || "").trim().toLowerCase(); return Object.values(this.d.users).find((x) => x.username === u) || null; },
  pub(x) { return { uid: x.uid, username: x.username, name: x.name, level: x.level, active: x.active !== false, owner: !!x.owner, mustChange: !!x.mustChange, createdAt: x.createdAt, lastLogin: x.lastLogin || null }; },
};
function hashPw(pw, salt = crypto.randomBytes(16)) { const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }); return { salt: salt.toString("base64"), hash: h.toString("base64"), alg: "scrypt-16384-8-1" }; }
function checkPw(pw, rec) { if (!rec || !rec.hash) return false; const h = crypto.scryptSync(String(pw), Buffer.from(rec.salt, "base64"), 64, { N: 16384, r: 8, p: 1 }); return crypto.timingSafeEqual(h, Buffer.from(rec.hash, "base64")); }
function pwProblem(pw) { pw = String(pw || ""); if (pw.length < 10) return "Use at least 10 characters."; if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letters and at least one digit."; if (pw.length > 200) return "Too long."; return null; }
const uidNew = () => "u_" + crypto.randomBytes(16).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 22);
const sessions = new Map();   // token-hash → {uid, exp}
const SFILE = path.join(CFG.data, "sessions.json");
function loadSessions() { try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SFILE, "utf8")))) if (v.exp > Date.now()) sessions.set(k, v); } catch (e) {} }
function saveSessions() { try { const t = SFILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 }); fs.renameSync(t, SFILE); } catch (e) {} }
const th = (t) => crypto.createHash("sha256").update(t).digest("hex");
function newSession(uid) { const t = crypto.randomBytes(32).toString("base64url"); sessions.set(th(t), { uid, exp: Date.now() + CFG.sessionDays * 864e5 }); saveSessions(); return t; }
const fails = new Map();      // key → {n, until}
function limited(key) { const f = fails.get(key); return f && f.until > Date.now(); }
// 5 failures lock a username for 15 minutes; an address (an office may share one) is locked after 30
function failed(key, max = 5) { const f = fails.get(key) || { n: 0, until: 0 }; f.n++; if (f.n >= max) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(key, f); }

/* ======================= access ======================= */
function levelOf(acc) { return acc.owner ? "owner" : acc.level === "admin" ? "admin" : "interact"; }
const can = (acc, p, op) => RULES.allowed(p, op, levelOf(acc), acc.uid);
function dbOp(acc, b) {
  const { op } = b, p = String(b.path || "");
  if (!PATH_RE.test(p)) return { error: "invalid_argument", message: "Invalid path." };
  if (op === "get") { if (!can(acc, p, "read") || !Store.docs.has(p)) return { exists: false }; return { exists: true, data: Store.docs.get(p), version: (Store.meta.get(p) || {}).v }; }
  if (op === "list") { const out = []; for (const k of Store.children(p)) if (can(acc, k, "read")) out.push({ id: k.slice(p.length + 1), data: Store.docs.get(k) }); out.sort((a, c) => a.id.localeCompare(c.id)); return { docs: out }; }
  if (op === "set" || op === "update" || op === "delete") {
    if (p.split("/").length % 2) return { error: "invalid_argument", message: "Not a document path." };
    if (!can(acc, p, "write")) return { error: "invalid_argument", message: "no such artifact, collection, or document (or no access)" };
    if (op === "delete") { Store.del(p); return { ok: true }; }
    let data = b.data; if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "invalid_argument", message: "Document data must be an object." };
    if (op === "update") { if (!Store.docs.has(p)) return { error: "not_found", message: "missing" }; data = Object.assign({}, Store.docs.get(p), data); }
    const s = JSON.stringify(data); if (Buffer.byteLength(s) > DOC_MAX) return { error: "invalid_argument", message: "Document larger than 256 KiB." };
    const v = Store.set(p, JSON.parse(s)); return { ok: true, version: v };
  }
  if (op === "acquire") {
    if (!can(acc, p, "write")) return { error: "invalid_argument", message: "lease refused" };
    const t = Date.now(), l = leases.get(p), ttl = Math.max(1000, Math.min(600000, +b.ttlMs || 30000)), holder = String(b.holder || "");
    if (l && l.exp > t && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.exp).toISOString() };
    leaseV++; leases.set(p, { holder, exp: t + ttl }); return { acquired: true, holder, version: leaseV };
  }
  return { error: "invalid_argument", message: "Unknown operation." };
}
const leases = new Map(); let leaseV = 0;

/* ======================= HTTP helpers ======================= */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
const STATIC_DIRS = ["app", "brand", "fonts", "img", "pdfassets", "vendor"];
const STATIC_FILES = { "data/leadseed.js": 1 };
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };
function send(res, code, body, type = "application/json", extra = {}) { res.writeHead(code, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, SEC, extra)); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
const json = (res, code, obj, extra) => send(res, code, obj, "application/json", extra);
function body(req) { return new Promise((ok, no) => { let n = 0; const ch = []; req.on("data", (c) => { n += c.length; if (n > CFG.maxBody) { no(Object.assign(new Error("Request too large."), { code: 413 })); req.destroy(); } else ch.push(c); }); req.on("end", () => { try { ok(ch.length ? JSON.parse(Buffer.concat(ch).toString("utf8")) : {}); } catch (e) { no(Object.assign(new Error("Invalid JSON."), { code: 400 })); } }); req.on("error", no); }); }
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; })); }
function isHttps(req) { return CFG.secureCookie || (CFG.trustProxy && req.headers["x-forwarded-proto"] === "https"); }
function setCookie(req, res, v, maxAge) { res.setHeader("Set-Cookie", `xf_s=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`); }
function account(req) {
  const t = cookies(req).xf_s; if (!t) return null; const s = sessions.get(th(t)); if (!s || s.exp < Date.now()) return null;
  const a = Acc.d.users[s.uid]; if (!a || a.active === false) { sessions.delete(th(t)); return null; } return a;
}
const ip = (req) => (CFG.trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
const csrfOk = (req) => req.headers["x-xf"] === "1";   // custom header: a cross-site form cannot send it; with SameSite=Strict cookies

/* ======================= pages ======================= */
const PAGE = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="/app/fonts.css"><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1a14;color:#eef3e6;font:16px/1.5 "Instrument Sans",system-ui,sans-serif;padding:16px}
form{width:min(380px,100%);background:#16241c;border:1px solid #2c4033;border-radius:16px;padding:28px;display:grid;gap:14px}h1{font:600 26px "Fraunces",Georgia,serif;margin:0}img{height:34px}label{display:grid;gap:4px;font-size:13px;color:#b9c7b0}
input{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #3a5242;background:#0f1a14;color:inherit}button{font:inherit;font-weight:600;padding:11px;border:0;border-radius:10px;background:#B8D241;color:#0f1a14;cursor:pointer}
.err{color:#ff8a7a;font-size:14px;min-height:1.2em}.tiny{font-size:12px;color:#8fa287}</style></head><body>${inner}</body></html>`;
const LOGIN = PAGE("Sign in · X FORCE", `<form id="f"><img src="/brand/logo_compact.png" alt="Dupedia"><h1>X FORCE</h1><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button><div class="err" id="e" role="alert"></div><p class="tiny">Accounts are created by your administrator. Five failed attempts lock the account for 15 minutes.</p></form>
<script src="/xf-login.js"></script>`);
const SETUP = PAGE("Set up · X FORCE", `<form id="f" data-setup="1"><img src="/brand/logo_compact.png" alt="Dupedia"><h1>First administrator</h1><p class="tiny">Enter the one-time setup code printed in the server log, then create the owner account. This page closes for good afterwards.</p>
<label>Setup code<input name="code" required autocomplete="off"></label><label>Your name<input name="name" required></label><label>Username<input name="username" required autocomplete="username"></label><label>Password (10+ characters, letters and a digit)<input name="password" type="password" required autocomplete="new-password"></label><button>Create owner account</button><div class="err" id="e" role="alert"></div></form><script src="/xf-login.js"></script>`);
const LOGIN_JS = `document.getElementById("f").onsubmit=async(e)=>{e.preventDefault();const f=e.target,b=f.querySelector("button"),er=document.getElementById("e");er.textContent="";b.disabled=true;
const d=Object.fromEntries(new FormData(f));const r=await fetch(f.dataset.setup?"/api/setup":"/api/login",{method:"POST",headers:{"content-type":"application/json","x-xf":"1"},body:JSON.stringify(d)}).then(r=>r.json()).catch(()=>({error:"The server cannot be reached."}));
b.disabled=false;if(r.error){er.textContent=r.message||r.error;return;}location.href="/";};`;
let setupCode = null;
function indexHtml() {
  const s = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return s.replace(/<script src="app\/products\.js"><\/script>/, `<script src="/xf-shim.js"></script>\n<script src="app/products.js"></script>`);
}

/* ======================= storage report & backups ======================= */
function dirSize(d) { let n = 0; try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); n += f.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch (e) {} return n; }
function storage() {
  const db = (fs.existsSync(Store.snapFile) ? fs.statSync(Store.snapFile).size : 0) + (fs.existsSync(Store.jFile) ? fs.statSync(Store.jFile).size : 0);
  const backups = dirSize(path.join(CFG.data, "backups")), app = dirSize(path.join(ROOT, "app")) + dirSize(path.join(ROOT, "pdfassets")) + dirSize(path.join(ROOT, "vendor")) + dirSize(path.join(ROOT, "img")) + dirSize(path.join(ROOT, "fonts")) + dirSize(path.join(ROOT, "brand"));
  let fsFree = null, fsTotal = null; try { const s = fs.statfsSync(CFG.data); fsFree = s.bavail * s.bsize; fsTotal = s.blocks * s.bsize; } catch (e) {}
  let fileBytes = 0, files = 0; for (const [p, d] of Store.docs) if (/\/c\/\d{3}$/.test(p)) { files++; fileBytes += Buffer.byteLength(JSON.stringify(d)); }
  const used = db + backups + app, warn = used / 1048576 >= CFG.warnMb || (fsFree != null && fsFree < 50 * 1048576);
  return { documents: Store.docs.size, databaseBytes: db, fileChunkBytes: fileBytes, fileChunks: files, backupsBytes: backups, appBytes: app, usedBytes: used, quotaBytes: CFG.quotaMb * 1048576, warnBytes: CFG.warnMb * 1048576, diskFreeBytes: fsFree, diskTotalBytes: fsTotal, warning: warn, at: now() };
}
function backup(tag = "daily") {
  Store.compact(); const day = now().slice(0, 10), f = path.join(CFG.data, "backups", `xforce-${day}-${tag}.json`);
  fs.copyFileSync(Store.snapFile, f);
  const list = fs.readdirSync(path.join(CFG.data, "backups")).filter((x) => x.startsWith("xforce-")).sort();
  while (list.length > CFG.backupKeep) fs.unlinkSync(path.join(CFG.data, "backups", list.shift()));   // backups only — live data is never deleted
  return f;
}

/* ======================= jobs: hourly sweep, research ingest ======================= */
const JOBS = { sweep: { running: false, last: null, error: null } };
function dumpTo(dir, prefixes) {
  for (const [p, d] of Store.docs) if (prefixes.some((x) => p === x || p.startsWith(x + "/"))) { const f = path.join(dir, ...p.split("/")) + ".json"; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); }
}
const sysAcc = { uid: "server", owner: true, level: "admin" };
function putIfAbsent(p, d) { if (!Store.docs.has(p)) Store.set(p, d); }
function runPy(script, args) { return new Promise((ok, no) => cp.execFile(CFG.python, ["-I", path.join(ROOT, "ops", script), ...args], { timeout: 120000, maxBuffer: 32 * 1048576 }, (e, out, err) => (e ? no(new Error((err || e.message).slice(0, 500))) : ok(JSON.parse(out))))); }
async function sweep() {
  if (JOBS.sweep.running) return { skipped: "already running" }; JOBS.sweep.running = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xf-sweep-"));
  try {
    dumpTo(dir, ["directory", "leads", "orders", "mi/req", "config/settings", "config/roles", "sweep/state", "claims", "acts"]);
    const o = await runPy("sweep.py", [dir]);
    for (const r of o.releases || []) {
      Store.del(`claims/${r.uid}/c/${r.lead}`);
      const lp = `leads/${r.lead}`; if (Store.docs.has(lp)) Store.set(lp, Object.assign({}, Store.docs.get(lp), r.leadPatch));
      putIfAbsent(`notif/${r.uid}/n/${r.notification.id}`, r.notification);
      const cp_ = `crm/${r.uid}/l/${r.lead}`; if (Store.docs.has(cp_)) Store.set(cp_, Object.assign({}, Store.docs.get(cp_), { stage: "released", releasedAt: o.now }));
      for (const [p, d] of Store.docs) if (p.startsWith("directory/") && d.role === "admin" && d.active !== false && d.uid) { const id = `release-adm-${r.lead}-${r.notification.id.split("-").pop()}`;
        putIfAbsent(`notif/${d.uid}/n/${id}`, { id, type: "lead", title: "Lead released for inactivity", body: `${r.leadName} (owner: ${r.ownerName}) went back to the Lead Mine.`, link: { view: "allleads" }, ref: r.lead, at: o.now, from: "server-sweep", read: false }); }
    }
    for (const m of o.reminders || []) { putIfAbsent(`notif/${m.uid}/n/${m.notification.id}`, m.notification); const ap = `acts/${m.actOwner}/a/${m.act}`, a = Store.docs.get(ap); if (a && !["done", "cancelled"].includes(a.followUpStatus)) Store.set(ap, Object.assign({}, a, m.actPatch)); }
    for (const p of o.overdue || []) for (const u of p.to || []) putIfAbsent(`notif/${u}/n/${p.notification.id}`, p.notification);
    Store.set("sweep/state", Object.assign({}, o.state, { host: "self-hosted" }));
    if ((o.releases || []).length) { const d = o.now.slice(0, 10); Store.set(`adminlog/${d}-sweep-${o.now.slice(11, 16).replace(":", "")}`, { day: d, entries: o.releases.map((r) => ({ at: o.now, by: "server-sweep", action: "Lead released (inactivity)", target: r.lead, reason: o.reason, detail: `${r.leadName} · ${r.ownerName}` })) }); }
    JOBS.sweep.last = now(); JOBS.sweep.error = null;
    log(`sweep: ${(o.releases || []).length} released, ${(o.reminders || []).length} reminders, ${(o.overdue || []).length} overdue notices`);
    return { ok: true, releases: (o.releases || []).length, reminders: (o.reminders || []).length, overdue: (o.overdue || []).length, researchQueued: o.researchFire };
  } catch (e) {
    JOBS.sweep.error = e.message; log("sweep failed:", e.message);
    const prev = Store.docs.get("sweep/state") || {}; Store.set("sweep/state", Object.assign({}, prev, { lastError: e.message.slice(0, 300), lastErrorAt: now() }));   // last good state kept
    return { ok: false, error: e.message };
  } finally { JOBS.sweep.running = false; fs.rmSync(dir, { recursive: true, force: true }); }
}
async function ingest(job, cands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xf-mi-"));
  try {
    dumpTo(dir, ["mi/opps", "mix/news", "mix/fx", "mix/mat", "mix/reports", "mi/state", "directory", "mi/schedule"]);
    fs.writeFileSync(path.join(dir, "candidates.json"), JSON.stringify(cands));
    const o = await runPy("intel.py", [job, dir, path.join(dir, "candidates.json")]);
    for (const w of o.writes || []) if (/^(mi|mix)\//.test(w.collection)) Store.set(`${w.collection}/${w.doc_id}`, w.data);
    const settings = Store.docs.get("config/settings") || {}, dirRows = [...Store.docs].filter(([p]) => p.startsWith("directory/")).map(([, d]) => d);
    const ceo = (settings.askCeo && settings.askCeo.ceo) || (dirRows.find((d) => d.bootstrap) || {}).uid;
    if (ceo) { for (const x of (o.notify || {}).highOpportunities || []) putIfAbsent(`notif/${ceo}/n/mi-${x.id}`, { id: `mi-${x.id}`, type: "lead", priority: "high", title: "High-priority opportunity found", body: x.title, link: { view: "intel", opts: { opp: x.id } }, at: now(), from: "research", read: false });
      for (const x of (o.notify || {}).highImpactNews || []) putIfAbsent(`notif/${ceo}/n/mi-${x.id}`, { id: `mi-${x.id}`, type: "lead", priority: "high", title: "Important industry/regulatory news", body: x.headline, link: { view: "mission", opts: { tab: "news" } }, at: now(), from: "research", read: false }); }
    return { ok: o.ok, error: o.error, stats: o.stats, notes: o.notes };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function scheduleLoops() {
  let lastBackupDay = null, lastSweepHour = null;
  setInterval(() => {
    const d = new Date(), day = d.toISOString().slice(0, 10), hr = d.toISOString().slice(0, 13);
    if (CFG.sweep && d.getUTCMinutes() >= 28 && lastSweepHour !== hr) { lastSweepHour = hr; sweep(); }
    if (lastBackupDay !== day && d.getUTCHours() >= 1) { lastBackupDay = day; try { log("backup:", backup()); } catch (e) { log("backup failed:", e.message); } }
    for (const [k, s] of sessions) if (s.exp < Date.now()) sessions.delete(k);
  }, 30000);
}

/* ======================= router ======================= */
async function route(req, res) {
  const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname);
  // ---- public: sign-in, setup, static assets needed by those pages
  if (p === "/xf-login.js") return send(res, 200, LOGIN_JS, TYPES[".js"]);
  if (p === "/setup") return Acc.d.setupDone ? send(res, 302, "", "text/plain", { Location: "/" }) : send(res, 200, SETUP, TYPES[".html"]);
  if (p === "/api/setup" && req.method === "POST") {
    if (!csrfOk(req)) return json(res, 403, { error: "forbidden" });
    if (Acc.d.setupDone) return json(res, 410, { error: "done", message: "Setup is already complete." });
    const b = await body(req); if (limited("setup:" + ip(req))) return json(res, 429, { error: "locked", message: "Too many attempts. Try again in 15 minutes." });
    if (!setupCode || !crypto.timingSafeEqual(Buffer.from(String(b.code || "").padEnd(64)), Buffer.from(setupCode.padEnd(64)))) { failed("setup:" + ip(req)); return json(res, 403, { error: "code", message: "The setup code is not correct." }); }
    const prob = pwProblem(b.password); if (prob) return json(res, 400, { error: "password", message: prob });
    const un = String(b.username || "").trim().toLowerCase(); if (!/^[a-z0-9._-]{3,40}$/.test(un)) return json(res, 400, { error: "username", message: "Username: 3–40 letters, digits, dot, dash or underscore." });
    const uid = uidNew(); Acc.d.users[uid] = Object.assign({ uid, username: un, name: String(b.name || un).slice(0, 80), level: "admin", owner: true, active: true, createdAt: now() }, hashPw(b.password));
    Acc.d.setupDone = true; Acc.save(); setupCode = null; setCookie(req, res, newSession(uid), CFG.sessionDays * 86400); log(`setup: owner account "${un}" created`);
    return json(res, 200, { ok: true });
  }
  if (p === "/login") return send(res, 200, LOGIN, TYPES[".html"]);
  if (p === "/api/login" && req.method === "POST") {
    if (!csrfOk(req)) return json(res, 403, { error: "forbidden" });
    const b = await body(req), un = String(b.username || "").trim().toLowerCase(), k1 = "u:" + un, k2 = "ip:" + ip(req);
    if (limited(k1) || limited(k2)) return json(res, 429, { error: "locked", message: "Too many failed attempts. Try again in 15 minutes." });
    const a = Acc.byName(un);
    if (!a || a.active === false || !checkPw(b.password, a)) { failed(k1); failed(k2, 30); return json(res, 401, { error: "credentials", message: "Wrong username or password, or the account is deactivated." }); }
    fails.delete(k1); a.lastLogin = now(); Acc.save(); setCookie(req, res, newSession(a.uid), CFG.sessionDays * 86400); return json(res, 200, { ok: true, mustChange: !!a.mustChange });
  }
  const STATIC = p === "/" || p === "/index.html" ? null : p.slice(1);
  // before sign-in only what the sign-in page needs (fonts, logo); everything else of the app needs a session
  const PUBLIC = STATIC && (STATIC === "app/fonts.css" || STATIC.startsWith("fonts/") || STATIC === "brand/logo_compact.png");
  if (STATIC && !PUBLIC && (STATIC_FILES[STATIC] || STATIC_DIRS.includes(STATIC.split("/")[0])) && !account(req)) return send(res, 401, "Sign in first.", "text/plain");
  if (STATIC && (STATIC_FILES[STATIC] || STATIC_DIRS.includes(STATIC.split("/")[0])) && !STATIC.includes("..")) {
    const f = path.join(ROOT, STATIC); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, Object.assign({ "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "public, max-age=3600" }, SEC)); return fs.createReadStream(f).pipe(res);
  }
  // ---- everything below needs a session
  const acc = account(req);
  if (p === "/" || p === "/index.html") { if (!Acc.d.setupDone) return send(res, 302, "", "text/plain", { Location: "/setup" }); if (!acc) return send(res, 302, "", "text/plain", { Location: "/login" }); return send(res, 200, indexHtml(), TYPES[".html"]); }
  if (p === "/xf-shim.js") return acc ? send(res, 200, fs.readFileSync(path.join(__dirname, "shim.js")), TYPES[".js"]) : send(res, 401, "", "text/plain");
  if (!p.startsWith("/api/")) return send(res, 404, "Not found", "text/plain");
  // research ingest: bearer token (for an external scheduler), no session
  if (p.startsWith("/api/ingest/") && req.method === "POST") {
    const tok = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!CFG.researchToken || !tok || tok.length !== CFG.researchToken.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(CFG.researchToken))) return json(res, 401, { error: "unauthorized" });
    const job = p.split("/").pop(); if (!["opportunities", "news", "fx", "materials", "weekly"].includes(job)) return json(res, 404, { error: "unknown job" });
    try { return json(res, 200, await ingest(job, await body(req))); } catch (e) { return json(res, 500, { error: "failed", message: e.message }); }
  }
  if (!acc) return json(res, 401, { error: "unauthenticated", message: "Signed out — sign in again." });
  if (req.method !== "GET" && !csrfOk(req)) return json(res, 403, { error: "forbidden" });
  const admin = levelOf(acc) !== "interact";
  if (p === "/api/me") return json(res, 200, { uid: acc.uid, name: acc.name, username: acc.username, level: levelOf(acc), owner: !!acc.owner, mustChange: !!acc.mustChange });
  if (p === "/api/logout" && req.method === "POST") { const t = cookies(req).xf_s; if (t) sessions.delete(th(t)); saveSessions(); setCookie(req, res, "", 0); return json(res, 200, { ok: true }); }
  if (p === "/api/db" && req.method === "POST") { const b = await body(req); return json(res, 200, dbOp(acc, b)); }
  if (p === "/api/people") { const ids = String(u.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 200), q = String(u.searchParams.get("q") || "").toLowerCase();
    const list = ids.length ? ids.map((i) => Acc.d.users[i]).filter(Boolean) : Object.values(Acc.d.users).filter((x) => x.active !== false && (!q || x.name.toLowerCase().includes(q) || x.username.includes(q))).slice(0, 50);
    return json(res, 200, { people: list.map((x) => ({ id: x.uid, name: x.name })) }); }
  if (p === "/api/password" && req.method === "POST") { const b = await body(req);
    if (!checkPw(b.old, acc)) return json(res, 403, { error: "old", message: "The current password is not correct." }); const prob = pwProblem(b.password); if (prob) return json(res, 400, { error: "password", message: prob });
    Object.assign(acc, hashPw(b.password), { mustChange: false }); Acc.save(); for (const [k, s] of sessions) if (s.uid === acc.uid && k !== th(cookies(req).xf_s || "")) sessions.delete(k); saveSessions(); return json(res, 200, { ok: true }); }
  // ---- administrators
  if (!admin) return json(res, 403, { error: "forbidden", message: "Administrators only." });
  if (p === "/api/accounts" && req.method === "GET") return json(res, 200, { accounts: Object.values(Acc.d.users).map(Acc.pub) });
  if (p === "/api/accounts" && req.method === "POST") { const b = await body(req), un = String(b.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(un)) return json(res, 400, { error: "username", message: "Username: 3–40 letters, digits, dot, dash or underscore." }); if (Acc.byName(un)) return json(res, 409, { error: "exists", message: "This username is taken." });
    const prob = pwProblem(b.password); if (prob) return json(res, 400, { error: "password", message: "Temporary password: " + prob });
    const uid = uidNew(); Acc.d.users[uid] = Object.assign({ uid, username: un, name: String(b.name || un).slice(0, 80), level: b.level === "admin" ? "admin" : "interact", active: true, mustChange: true, createdAt: now(), createdBy: acc.uid }, hashPw(b.password)); Acc.save();
    return json(res, 200, { uid }); }
  const m = p.match(/^\/api\/accounts\/(u_[A-Za-z0-9]{10,40})$/);
  if (m && req.method === "POST") { const a = Acc.d.users[m[1]]; if (!a) return json(res, 404, { error: "not_found" }); const b = await body(req);
    if (a.owner && (b.active === false || b.level === "interact")) return json(res, 400, { error: "owner", message: "The owner account cannot be deactivated or demoted." });
    if (b.level) a.level = b.level === "admin" ? "admin" : "interact"; if (b.active != null) a.active = !!b.active; if (b.name) a.name = String(b.name).slice(0, 80);
    if (b.password) { const prob = pwProblem(b.password); if (prob) return json(res, 400, { error: "password", message: prob }); Object.assign(a, hashPw(b.password), { mustChange: true }); }
    if (a.active === false || b.password) for (const [k, s] of sessions) if (s.uid === a.uid) sessions.delete(k);
    Acc.save(); saveSessions(); return json(res, 200, { ok: true, account: Acc.pub(a) }); }
  if (p === "/api/storage") return json(res, 200, Object.assign(storage(), { jobs: { sweep: { last: JOBS.sweep.last, error: JOBS.sweep.error, enabled: CFG.sweep } } }));
  if (p === "/api/backup") { Store.compact(); return send(res, 200, fs.readFileSync(Store.snapFile), "application/json", { "Content-Disposition": `attachment; filename="xforce-backup-${now().slice(0, 10)}.json"` }); }
  if (p === "/api/jobs/sweep" && req.method === "POST") return json(res, 200, await sweep());
  return json(res, 404, { error: "not_found" });
}

/* ======================= import & CLI ======================= */
function importFrom(src) {
  let n = 0; const st = fs.statSync(src);
  if (st.isFile()) { const j = JSON.parse(fs.readFileSync(src, "utf8")); for (const [p, x] of Object.entries(j.docs || {})) { if (!PATH_RE.test(p)) continue; Store.set(p, x.d !== undefined ? x.d : x); n++; } }
  else { const walk = (d, rel) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name), r = rel ? rel + "/" + f.name : f.name;
      if (f.isDirectory()) walk(fp, r); else if (f.name.endsWith(".json")) { const p = r.slice(0, -5); if (!PATH_RE.test(p) || p.split("/").length % 2) continue; const raw = JSON.parse(fs.readFileSync(fp, "utf8")); Store.set(p, raw); n++; } } };
    walk(src, ""); }
  Store.compact(); return n;
}
function main() {
  Acc.load(); Store.load(); loadSessions();
  const [cmd, a1, a2] = process.argv.slice(2);
  if (cmd === "import") { if (!a1) { console.error("usage: server.js import <dir|file>"); process.exit(2); } backup("before-import"); console.log(`imported ${importFrom(path.resolve(a1))} documents`); return; }
  if (cmd === "reset-password") { const a = Acc.byName(a1), prob = pwProblem(a2); if (!a) { console.error("no such user"); process.exit(1); } if (prob) { console.error(prob); process.exit(1); } Object.assign(a, hashPw(a2), { mustChange: true }); Acc.save(); console.log("password reset for", a.username); return; }
  if (cmd === "sweep") { sweep().then((r) => { console.log(JSON.stringify(r)); process.exit(0); }); return; }
  if (!Acc.d.setupDone) { setupCode = ENV.SETUP_CODE || crypto.randomBytes(6).toString("hex"); log(`FIRST RUN — open /setup and enter this one-time setup code: ${setupCode}`); }
  const srv = http.createServer((req, res) => route(req, res).catch((e) => { if (!res.headersSent) json(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: "server", message: e.code ? e.message : "Server error." }); if (!e.code) log("error:", e.stack || e); }));
  srv.headersTimeout = 30000; srv.requestTimeout = 120000;
  srv.listen(CFG.port, CFG.host, () => log(`X FORCE server on http://${CFG.host}:${CFG.port}  (data: ${CFG.data})`));
  scheduleLoops();
  const stop = () => { log("shutting down"); try { Store.compact(); saveSessions(); } catch (e) {} process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
if (require.main === module) main();
module.exports = { Store, Acc, dbOp, hashPw, checkPw, pwProblem, sweep, ingest, storage, importFrom, CFG };
