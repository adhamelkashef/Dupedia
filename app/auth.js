/* Dupedia Site Planner 2.1 — sign-in, user directory, roles.

   HOW AUTHENTICATION WORKS
   Cloud (published on claude.ai — the supported way to run 2.1):
     • Identity is the person's claude.ai account, verified by claude.ai before the page opens. The app never sees or stores
       a password; password resets and two-step sign-in are handled by claude.ai.
     • Authorisation has two layers:
         1. The database rules (DPStore.RULES), enforced by the platform on every read and write, keyed on the person's sharing
            level: Editor/Owner = administrator data, Contributor = employee data, each employee limited to their own subtree.
         2. The Dupedia user directory (directory/<id>), written only by administrators: who may use the app at all, their
            Dupedia role and whether the account is active. The sign-in gate refuses anyone not active in the directory.
       Layer 1 is the security boundary. Layer 2 is an application gate: a person removed from the directory but still on the
       share menu keeps database access to what their sharing level allows, so deactivating someone must be followed by removing
       them from the share menu (the app reminds the administrator).
     • No public registration: a person who is not in the directory can only send an access request.
   Local / self-hosted (static web server, no claude.ai):
     • A demonstration sign-in with e-mail and password. Passwords are hashed with PBKDF2-SHA-256 (310,000 iterations, random
       16-byte salt) through the browser's Web Crypto API; no plaintext password is stored.
     • It is NOT secure: everything lives in this browser's storage, which anyone using the device (or its developer tools) can
       read or change, and no server checks any rule. The sign-in screen says so. For real self-hosting, put the app behind an
       authentication provider and a server-side database with equivalent rules (see README › Self-hosting). */
(function (root) {
  "use strict";
  const ST = () => root.DPStore.st;
  const A = { me: null, record: null, directory: [], roles: null, warnings: [], ready: false, local: false };
  /** Access levels ("bases"). Every role maps to one; the base decides screens and which data copies the person receives.
   *  The database distinguishes administrators (Editor) from everyone else (Contributor); sales / engineer / data entry are
   *  separated by giving each person only their own subtrees and only the data copies their base needs (see store.js RULES). */
  const BASES = { admin: "Administrator access", employee: "Sales access", engineer: "Engineering access", dataentry: "Data entry access", accountant: "Finance access" };
  const DEFAULT_ROLES = [
    { id: "admin", label: "Administrator", base: "admin", builtIn: true, description: "Full access: prices and costs, users, commissions, orders, all leads and reports." },
    { id: "employee", label: "Sales Employee", base: "employee", builtIn: true, description: "Own projects, proposals, leads, orders and commissions. No cost, margin or other employees' data." },
    { id: "engineer", label: "Engineer", base: "engineer", builtIn: true, description: "Assigned orders from manufacturing to installation: specifications, plans, status, deadlines, teams. No prices, totals, payments or commissions." },
    { id: "dataentry", label: "Data Entry", base: "dataentry", builtIn: true, description: "Lead research: contact details, sources, verification, duplicates, research calls. No prices, orders or commissions." },
    // 1.2 — department Finance. Server level "finance": ledger, payments, payroll, purchases, invoices, taxes; approvals only as the Administrator allows
    { id: "accountant", label: "Accountant", base: "accountant", builtIn: true, department: "Finance", description: "Finance: transfers, bank and wallet accounts, payment verification, salaries and worker payments, purchases, invoices, taxes and reports. Approvals only where the Administrator allows. No user management or company settings." },
  ];
  /** 1.2 — the server account level for a role: administrators "admin", accountants "finance", everyone else "interact". */
  const levelFor = (roleId) => { const b = baseOf(roleId); return b === "admin" ? "admin" : b === "accountant" ? "finance" : "interact"; };
  const now = () => new Date().toISOString();
  const normEmail = (e) => String(e || "").trim().toLowerCase();
  const rid = (p) => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  async function loadRoles() { const r = await root.DPStore.tryGet("config/roles"); A.roles = (r && Array.isArray(r.roles) && r.roles.length) ? mergeRoles(r.roles) : DEFAULT_ROLES.slice(); return A.roles; }
  function mergeRoles(list) { const out = DEFAULT_ROLES.map((d) => Object.assign({}, d, (list.find((x) => x.id === d.id) || {}), { builtIn: true, base: d.base })); for (const x of list) if (!out.some((o) => o.id === x.id)) out.push(x); return out; }
  const roleOf = (id) => (A.roles || DEFAULT_ROLES).find((r) => r.id === id) || null;
  const baseOf = (roleId) => (roleOf(roleId) || { base: "employee" }).base;
  const isSalesRole = (roleId) => baseOf(roleId) === "employee" || baseOf(roleId) === "admin";
  const fullName = (r) => (r ? ([r.firstName, r.lastName].filter(Boolean).join(" ") || r.displayName || r.email || "") : "");
  async function listDirectory() { const l = await root.DPStore.tryList("directory"); A.directory = l.map((x) => Object.assign({ docId: x.id }, x.data)); return A.directory; }

  /* ---------------- local password hashing ---------------- */
  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
  async function pbkdf2(password, saltHex, iter) {
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: iter }, key, 256));
  }
  async function hashPassword(password) { const salt = hex(crypto.getRandomValues(new Uint8Array(16))), iter = 310000; return { alg: "PBKDF2-SHA256", salt, iter, hash: await pbkdf2(password, salt, iter) }; }
  async function verifyPassword(password, cred) { if (!cred || !cred.hash) return false; const h = await pbkdf2(password, cred.salt, cred.iter); let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ cred.hash.charCodeAt(i); return d === 0 && h.length === cred.hash.length; }
  function passwordProblem(p) { if (!p || p.length < 10) return "Use at least 10 characters."; if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Use letters and at least one number."; return null; }
  const LS = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: (k) => { try { sessionStorage.removeItem(k); } catch (e) {} } };
  const local = () => root.DPStore.local;   // credentials are kept in IndexedDB on this device only, never in the shared data

  /* ---------------- session ---------------- */
  /** Resolve who is signed in. → {state:'ok'|'signin'|'request'|'pending'|'inactive'|'setup'|'nouser', ...} */
  async function resolve() {
    const st = ST(); A.local = st.mode !== "cloud"; A.warnings = [];
    await loadRoles(); await listDirectory();
    if (A.local) {
      const anyAdmin = A.directory.some((r) => r.active !== false && baseOf(r.role) === "admin");
      if (!A.directory.length || !anyAdmin) return { state: "setup" };
      const s = LS.get("dp.sp21.session"); if (!s) return { state: "signin" };
      let ses; try { ses = JSON.parse(s); } catch (e) { return { state: "signin" }; }
      if (!ses || Date.now() - ses.at > 12 * 3600e3) { LS.del("dp.sp21.session"); return { state: "signin", note: "Your session expired. Sign in again." }; }
      const rec = A.directory.find((r) => r.uid === ses.id); if (!rec) return { state: "signin" };
      if (rec.active === false) { LS.del("dp.sp21.session"); return { state: "inactive", record: rec }; }
      return finish(rec, { level: levelFor(rec.role) });
    }
    if (!st.userId) return { state: "nouser" };
    let rec = A.directory.find((r) => r.uid === st.userId);
    if (!rec && !A.directory.some((r) => r.active !== false && baseOf(r.role) === "admin") && st.isOwner) {
      // first run: the artifact's owner becomes the first administrator
      rec = { uid: st.userId, email: st.email || "", displayName: st.userName || "", role: "admin", active: true, createdAt: now(), createdBy: st.userId, bootstrap: true };
      await root.DPStore.set(`directory/${st.userId}`, rec); A.directory.push(Object.assign({ docId: st.userId }, rec));
      await adminLog("Bootstrapped first administrator", { target: st.userId, reason: "Owner of the page, first sign-in" });
    }
    if (!rec) { const req = await root.DPStore.tryGet(`requests/${st.userId}`); return { state: req ? "pending" : "request", request: req }; }
    if (rec.active === false) return { state: "inactive", record: rec };
    return finish(rec, { level: st.level });
  }
  function finish(rec, { level }) {
    const st = ST(), base = baseOf(rec.role);
    // effective role: never above what the database grants (sharing level), never above the directory role
    let eff = base;
    if (base === "admin" && level !== "admin") { eff = "employee"; A.warnings.push("Your Dupedia role is Administrator, but this page is shared with you as Contributor, so the database only gives you employee access. Ask the owner to make you an Editor."); }
    if (base === "accountant" && level !== "finance" && level !== "admin") { eff = "viewer"; A.warnings.push("Your Dupedia role is Accountant, but your sign-in does not have Finance access yet. Ask the administrator to save your user again."); }
    if (base === "accountant" && level === "admin") eff = "accountant";
    if (base !== "admin" && base !== "accountant" && level === "admin") A.warnings.push("This page is shared with you as Editor. The app shows you employee screens, but Editor access lets the database return administrator data. Ask an administrator to change your sharing level to Contributor.");
    if (level === "view") eff = "viewer";
    A.record = rec; A.me = { id: rec.uid || st.userId, name: fullName(rec) || st.userName || "", firstName: rec.firstName || (fullName(rec) || st.userName || "").split(" ")[0], email: rec.email || st.email || "",
      title: rec.title || "", department: rec.department || "", role: eff, roleId: rec.role, roleLabel: (roleOf(rec.role) || {}).label || rec.role, level };
    root.DPStore.setIdentity({ id: A.me.id, name: A.me.name, role: eff });
    A.ready = true;
    return { state: "ok", me: A.me };
  }
  /** Record a sign-in (one write per session) so administrators can see activity and sharing-level problems. */
  async function touchActivity() {
    if (!A.me || !A.me.id) return;
    const path = `activity/${A.me.id}`, prev = (await root.DPStore.tryGet(path)) || { log: [] };
    const log = (prev.log || []).slice(-49); log.push({ at: now(), what: "Signed in", level: A.me.level });
    await root.DPStore.set(path, { uid: A.me.id, lastSeen: now(), level: A.me.level, log }).catch(() => {});
  }
  async function logActivity(what, detail) {
    if (!A.me || !A.me.id) return;
    const path = `activity/${A.me.id}`, prev = (await root.DPStore.tryGet(path)) || { log: [] };
    const log = (prev.log || []).slice(-49); log.push({ at: now(), what, detail: detail || "" });
    await root.DPStore.set(path, Object.assign({}, prev, { uid: A.me.id, lastSeen: now(), log })).catch(() => {});
  }
  /** Append to the administrator log (one document per day, capped). */
  async function adminLog(action, { target = "", reason = "", detail = "" } = {}) {
    const day = now().slice(0, 10), path = `adminlog/${day}`, prev = (await root.DPStore.tryGet(path)) || { entries: [] };
    const entries = (prev.entries || []).slice(-400); entries.push({ at: now(), by: (A.me && A.me.id) || ST().userId || "", action, target, reason, detail });
    if (!root.XFServer || isAdmin()) await root.DPStore.set(path, { day, entries });
    // 1.2 — append-only audit trail on the Cloudflare server: the server stamps who and when, and nobody can edit or erase it
    if (root.XFServer) await auditLog(action, { target, reason, detail });
  }
  /** 1.2 — one append-only audit entry (previous/new values for financial changes). Never throws into the caller's workflow. */
  async function auditLog(action, { target = "", reason = "", detail = "", before = null, after = null, kind = "" } = {}) {
    if (!root.XFServer) return null;
    const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + Math.random().toString(36).slice(2, 8);
    try { await root.DPStore.create(`audit/${id}`, { action, target, reason, detail: String(detail || "").slice(0, 600), before, after, kind }); } catch (e) { console.warn("audit", e && e.message); }
    return id;
  }

  /* ---------------- local accounts ---------------- */
  async function localSetup({ name, email, password }) {
    const prob = passwordProblem(password); if (prob) throw new Error(prob);
    const id = rid("lu_"), cred = await hashPassword(password);
    await local().set(`localauth/${id}`, cred);
    await root.DPStore.set(`directory/${id}`, { uid: id, email: normEmail(email), displayName: name, role: "admin", active: true, createdAt: now(), createdBy: id, bootstrap: true });
    LS.set("dp.sp21.session", JSON.stringify({ id, at: Date.now() }));
  }
  async function localSignIn(email, password) {
    await listDirectory();
    const rec = A.directory.find((r) => normEmail(r.email) === normEmail(email));
    // same message for unknown e-mail and wrong password
    const fail = () => { throw Object.assign(new Error("The e-mail or password is not correct."), { code: "bad" }); };
    if (!rec) { await pbkdf2(password || "x", "00".repeat(16), 1000); fail(); }
    const cred = await local().get(`localauth/${rec.uid}`);
    if (!(await verifyPassword(password || "", cred))) fail();
    if (rec.active === false) throw Object.assign(new Error("This account has been deactivated. Contact your administrator."), { code: "inactive" });
    LS.set("dp.sp21.session", JSON.stringify({ id: rec.uid, at: Date.now() }));
    return { mustChange: !!cred.mustChange };
  }
  async function localChangePassword(id, current, next) {
    const cred = await local().get(`localauth/${id}`);
    if (current != null && !(await verifyPassword(current, cred))) throw new Error("The current password is not correct.");
    const prob = passwordProblem(next); if (prob) throw new Error(prob);
    await local().set(`localauth/${id}`, Object.assign(await hashPassword(next), { mustChange: false, changedAt: now() }));
  }
  function signOut() { LS.del("dp.sp21.session"); A.me = null; A.record = null; A.ready = false; }

  /* ---------------- administration ---------------- */
  /** Create a user. Cloud: a colleague picked from the organisation directory (opaque id from user.search), or the id of a person
   *  who sent an access request. People are always identified by their claude.ai account id, never by an e-mail they typed.
   *  Local: e-mail + temporary password, to be changed at first sign-in. */
  async function createUser({ uid = null, email = "", displayName = "", firstName = "", lastName = "", role = "employee", tempPassword = null, title = "", department = "", employeeId = "", mobile = "", hireDate = "" }) {
    if (!isAdmin()) throw new Error("Only administrators can create users.");
    email = normEmail(email);
    if (!firstName && displayName) { const p = displayName.trim().split(/\s+/); firstName = p.shift(); lastName = lastName || p.join(" "); }
    if (!firstName) throw new Error("Enter the first name.");
    await listDirectory();
    if (uid && A.directory.some((r) => r.uid === uid)) throw new Error("This person already has an account.");
    if (email && A.directory.some((r) => normEmail(r.email) === email)) throw new Error("An account with this e-mail already exists.");
    if (!roleOf(role)) throw new Error("Unknown role.");
    if (employeeId) await checkEmployeeId(employeeId, null);
    let docId = uid;
    if (A.local) {
      if (!email) throw new Error("Enter the e-mail address (used to sign in).");
      const prob = passwordProblem(tempPassword); if (prob) throw new Error("Temporary password: " + prob);
      docId = uid = rid("lu_"); await local().set(`localauth/${uid}`, Object.assign(await hashPassword(tempPassword), { mustChange: true }));
    } else if (!uid) throw new Error("Choose the person from your organisation, or approve their access request.");
    const rec = { uid: uid || null, email, firstName: firstName.trim(), lastName: lastName.trim(), displayName: [firstName, lastName].filter(Boolean).join(" ").trim(), title, department, role, active: true, createdAt: now(), createdBy: A.me.id };
    await root.DPStore.set(`directory/${docId}`, rec);
    await saveHr(uid, { employeeId: employeeId.trim(), mobile: mobile.trim(), hireDate: hireDate || "", email });
    await adminLog("Created user", { target: docId, detail: `${rec.displayName} · ${(roleOf(role) || {}).label}${employeeId ? " · ID " + employeeId : ""}` });
    if (root.DPPrice) await root.DPPrice.syncCopies().catch(() => {});
    return docId;
  }
  /** Employee IDs are unique: an administrator-only index maps each ID to one account. */
  async function checkEmployeeId(id, uid) {
    id = String(id || "").trim(); if (!id) return;
    if (!/^[A-Za-z0-9._-]{1,24}$/.test(id)) throw new Error("Employment ID: letters, digits, dot, dash or underscore (max 24).");
    const idx = (await root.DPStore.tryGet("restricted/empids")) || { map: {} };
    const holder = idx.map[id.toUpperCase()]; if (holder && holder !== uid) throw new Error(`Employment ID ${id} is already used by ${nameSync(holder) || "another employee"}.`);
  }
  /** HR fields live in staff/<uid> (readable only by that person and administrators), next to targets. */
  async function saveHr(uid, hr) {
    if (!uid) return;
    const prev = (await root.DPStore.tryGet(`staff/${uid}`)) || { targets: {} };
    const oldId = (prev.hr && prev.hr.employeeId) || "";
    await checkEmployeeId(hr.employeeId, uid);
    const next = Object.assign({}, prev, { hr: Object.assign({}, prev.hr || {}, hr, { updatedAt: now() }) });
    await root.DPStore.set(`staff/${uid}`, next);
    const idx = (await root.DPStore.tryGet("restricted/empids")) || { map: {} };
    if (oldId && oldId.toUpperCase() !== String(hr.employeeId || "").toUpperCase()) delete idx.map[oldId.toUpperCase()];
    if (hr.employeeId) idx.map[hr.employeeId.toUpperCase()] = uid;
    await root.DPStore.set("restricted/empids", idx);
  }
  /* ---------------- profile pictures ----------------
     Display copy (256 px, square, centre-cropped) at avatars/<uid> — readable by staff, written by administrators.
     The original upload is kept unchanged, split into ≤180 kB chunks at avatarorig/<uid>/c/<n> (administrators only). */
  const PIC_TYPES = ["image/jpeg", "image/png", "image/webp"], PIC_MAX = 8 * 1024 * 1024;
  async function setPicture(uid, file) {
    if (!isAdmin()) throw new Error("Only administrators can change profile pictures.");
    if (!file || !PIC_TYPES.includes(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
    if (file.size > PIC_MAX) throw new Error("The picture is larger than 8 MB.");
    const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) throw new Error("This file could not be read as an image.");
    const side = Math.min(bmp.width, bmp.height), cv = document.createElement("canvas"); cv.width = cv.height = 256;
    cv.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
    const disp = cv.toDataURL("image/jpeg", 0.86);
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
    const parts = []; for (let i = 0; i < b64.length; i += 180000) parts.push(b64.slice(i, i + 180000));
    for (const x of await root.DPStore.tryList(`avatarorig/${uid}/c`)) await root.DPStore.del(`avatarorig/${uid}/c/${x.id}`);
    for (let i = 0; i < parts.length; i++) await root.DPStore.set(`avatarorig/${uid}/c/${String(i).padStart(3, "0")}`, { n: i, total: parts.length, part: parts[i], name: file.name, type: file.type, size: file.size, at: now() });
    await root.DPStore.set(`avatars/${uid}`, { dataUrl: disp, w: bmp.width, h: bmp.height, updatedAt: now(), by: A.me.id });
    delete PICS[uid];
    await adminLog("Changed profile picture", { target: uid, detail: `${file.name} · ${Math.round(file.size / 1024)} kB` });
  }
  async function removePicture(uid) {
    for (const x of await root.DPStore.tryList(`avatarorig/${uid}/c`)) await root.DPStore.del(`avatarorig/${uid}/c/${x.id}`);
    await root.DPStore.del(`avatars/${uid}`); delete PICS[uid]; await adminLog("Removed profile picture", { target: uid });
  }
  async function originalPicture(uid) { const l = (await root.DPStore.tryList(`avatarorig/${uid}/c`)).sort((a, b) => a.data.n - b.data.n); return l.length ? { dataUrl: l.map((x) => x.data.part).join(""), name: l[0].data.name } : null; }
  const PICS = {};
  async function picture(uid) { if (!uid) return null; if (!(uid in PICS)) PICS[uid] = (await root.DPStore.tryGet(`avatars/${uid}`)) || null; return PICS[uid] && PICS[uid].dataUrl; }
  /** Default avatar: initials on a brand colour (lime on charcoal). */
  function initialsAvatar(name) {
    const ini = String(name || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase() || "?";
    return "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#262626"/><text x="32" y="41" text-anchor="middle" font-family="Georgia,serif" font-size="26" font-weight="600" fill="#B8D241">${ini.replace(/[<&>]/g, "")}</text></svg>`);
  }
  async function avatarUrl(uid) { return (await picture(uid)) || initialsAvatar(nameSync(uid) || "?"); }
  async function updateUser(docId, patch, reason) {
    if (!isAdmin()) throw new Error("Only administrators can change users.");
    const prev = await root.DPStore.get(`directory/${docId}`); if (!prev) throw new Error("User not found.");
    if (patch.role && !roleOf(patch.role)) throw new Error("Unknown role.");
    if ((patch.active === false || (patch.role && baseOf(patch.role) !== "admin")) && baseOf(prev.role) === "admin") {
      await listDirectory(); const admins = A.directory.filter((r) => r.active !== false && baseOf(r.role) === "admin" && r.docId !== docId);
      if (!admins.length) throw new Error("At least one active administrator must remain.");
    }
    const next = Object.assign({}, prev, patch, { updatedAt: now(), updatedBy: A.me.id });
    if ("firstName" in patch || "lastName" in patch) next.displayName = [next.firstName, next.lastName].filter(Boolean).join(" ").trim();
    if (patch.active === false && prev.active !== false) { next.deactivatedAt = now(); next.deactivatedBy = A.me.id; next.deactivationReason = reason || ""; }
    if (patch.active === true && prev.active === false) { next.reactivatedAt = now(); next.reactivatedBy = A.me.id; }
    await root.DPStore.set(`directory/${docId}`, next);
    // self-hosted: the server account follows the directory (level for admin vs staff; deactivation ends sign-in and sessions)
    if (root.XFServer && next.uid && ("role" in patch || "active" in patch)) await root.XFServer.updateAccount(next.uid, { level: levelFor(next.role), active: next.active !== false, name: next.displayName || undefined }).catch((e) => { throw new Error("Saved in X FORCE, but the server account could not be updated: " + e.message); });
    const what = Object.keys(patch).map((k) => `${k}: ${JSON.stringify(prev[k] == null ? "" : prev[k])} → ${JSON.stringify(patch[k])}`).join("; ");
    await adminLog(patch.active === false ? "Deactivated user" : patch.active === true ? "Reactivated user" : "Updated user", { target: docId, reason, detail: what });
    await listDirectory();
    if ((patch.role || "active" in patch) && root.DPPrice) await root.DPPrice.syncCopies().catch(() => {});
    if (patch.role && root.DPNotify && prev.uid) root.DPNotify.deliver(prev.uid, { id: "role-" + Date.now().toString(36), type: "access", title: "Your role changed", body: `You now have the role ${(roleOf(patch.role) || {}).label}.`, link: "profile" }).catch(() => {});
    return next;
  }
  async function resetLocalPassword(docId, tempPassword) {
    if (!isAdmin()) throw new Error("Only administrators can reset passwords.");
    if (!A.local) throw new Error("Passwords are managed by claude.ai accounts in the published app.");
    const prob = passwordProblem(tempPassword); if (prob) throw new Error(prob);
    const rec = await root.DPStore.get(`directory/${docId}`);
    await local().set(`localauth/${rec.uid}`, Object.assign(await hashPassword(tempPassword), { mustChange: true }));
    await adminLog("Reset password", { target: docId, reason: "Temporary password issued; must be changed at next sign-in" });
  }
  /** Open access requests (administrators). */
  async function processRequests() {
    if (!isAdmin() || A.local) return { open: [] };
    const reqs = await root.DPStore.tryList("requests"), known = new Set(A.directory.map((r) => r.uid));
    const open = []; for (const r of reqs) { const q = r.data; if (!q || !q.uid) continue; if (known.has(q.uid)) { await root.DPStore.del(`requests/${r.id}`).catch(() => {}); continue; } open.push(Object.assign({ id: r.id }, q)); }
    return { open };
  }
  async function requestAccess(message) {
    const st = ST(); if (!st.userId) throw new Error("Sign in to claude.ai first.");
    await root.DPStore.set(`requests/${st.userId}`, { uid: st.userId, kind: "access", message: String(message || "").slice(0, 400), at: now() });
  }
  async function saveRoles(roles) {
    if (!isAdmin()) throw new Error("Only administrators can change roles.");
    for (const r of roles) if (!r.id || !r.label || !BASES[r.base]) throw new Error("Each role needs a name and an access level.");
    await root.DPStore.set("config/roles", { roles, updatedAt: now(), updatedBy: A.me.id }); await adminLog("Updated roles", { detail: roles.map((r) => `${r.label} (${r.base})`).join(", ") }); await loadRoles();
  }
  const isAdmin = () => !!(A.me && A.me.role === "admin");
  const isFinance = () => !!(A.me && A.me.role === "accountant");
  /** Display name for a user id: directory name (admin-entered) → platform profile name → fallback. */
  async function names(ids) {
    const out = {}, missing = [];
    for (const id of ids) { const r = A.directory.find((x) => x.uid === id || x.docId === id); if (r && (fullName(r) || r.email)) out[id] = fullName(r) || r.email; else missing.push(id); }
    const user = ST().user;
    if (missing.length && user && user.profiles) { try { const ps = await user.profiles(missing); for (const id of missing) out[id] = (ps[id] && ps[id].name) || "Unknown person"; } catch (e) { for (const id of missing) out[id] = "Unknown user"; } }
    for (const id of missing) if (!out[id]) out[id] = id === "local" ? "Local user" : "Unknown user";
    return out;
  }
  const nameSync = (id) => { const r = A.directory.find((x) => x.uid === id || x.docId === id); return (r && (fullName(r) || r.email)) || ""; };

  const roleBase = () => (A.me ? A.me.role : null);
  root.DPAuth = { A, BASES, DEFAULT_ROLES, levelFor, isFinance, auditLog, isSalesRole, fullName, roleBase, saveHr, checkEmployeeId, setPicture, removePicture, originalPicture, picture, avatarUrl, initialsAvatar, PIC_TYPES, resolve, touchActivity, logActivity, adminLog, localSetup, localSignIn, localChangePassword, signOut, createUser, updateUser, resetLocalPassword,
    processRequests, requestAccess, saveRoles, loadRoles, listDirectory, roleOf, baseOf, isAdmin, names, nameSync, passwordProblem, hashPassword, verifyPassword, normEmail };
})(typeof self !== "undefined" ? self : this);
