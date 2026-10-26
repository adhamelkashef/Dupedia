/* X FORCE 1.0 (Dupedia) — storage.
   Cloud mode (published on claude.ai): the artifact's shared database. Access is enforced by the database itself through
   the rules in RULES below (declared when the page is published), keyed on the viewer's sharing level:
     admin    = Editor / Owner on the share menu  → Dupedia administrators
     interact = Contributor                       → Dupedia employees
   `{self}` paths are each person's own subtree: nobody below admin can read or write another person's.
   Local mode (self-hosted / offline): the browser's IndexedDB. Nothing can be enforced locally and the app says so. */
(function (root) {
  "use strict";
  const capability = (name) => (root.claude && typeof root.claude.use === "function") ? Promise.race([root.claude.use(name).catch(() => null), new Promise((r) => setTimeout(() => r(null), 11000))]) : Promise.resolve(null);
  const st = { mode: null, db: null, user: null, ready: null, role: "employee", userId: null, userName: "" };

  /* ---------------- IndexedDB ---------------- */
  let idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise((res, rej) => { try { const r = indexedDB.open("dupedia-sp2", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
    return idbP;
  }
  const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", mode), s = t.objectStore("kv"); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  const local = {
    get: async (path) => { const v = await tx("readonly", (s) => s.get(path)); return v == null ? null : v; },
    /** Same semantics as the shared database's lease: set-if-not-busy, expires on its own. Atomic within this browser. */
    acquire: async (path, { holder, ttlMs = 30000 } = {}) => {
      // one IndexedDB read-write transaction = atomic across every tab of this browser
      const db = await idb(), key = "lease/" + path, now = Date.now();
      return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"), s = t.objectStore("kv"); let out = null;
        const g = s.get(key); g.onsuccess = () => { const l = g.result;
          if (l && l.exp > now && l.holder !== holder) out = { acquired: false, expiresAt: new Date(l.exp).toISOString() };
          else { const v = ((l && l.version) || 0) + 1; s.put({ holder, exp: now + Math.max(1000, Math.min(600000, ttlMs)), version: v }, key); out = { acquired: true, holder, version: v }; } };
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); },
    set: (path, data) => tx("readwrite", (s) => s.put(JSON.parse(JSON.stringify(data)), path)),
    del: (path) => tx("readwrite", (s) => s.delete(path)),
    list: async (coll) => {
      const keys = await tx("readonly", (s) => s.getAllKeys()), depth = coll.split("/").length + 1, out = [];
      for (const k of keys) if (typeof k === "string" && k.startsWith(coll + "/") && k.split("/").length === depth) out.push({ id: k.split("/").pop(), data: await local.get(k) });
      return out;
    },
  };
  /* ---------------- shared database ---------------- */
  const cloud = {
    get: async (path) => { const s = await st.db.doc(path).get(); return s.exists ? s.data() : null; },
    set: (path, data) => st.db.doc(path).set(JSON.parse(JSON.stringify(data))),
    del: (path) => st.db.doc(path).delete(),
    list: async (coll) => { const s = await st.db.collection(coll).get(); return s.docs.map((d) => ({ id: d.id, data: d.data() })); },
    acquire: (path, opts) => st.db.doc(path).acquire(opts),
  };
  const B = () => (st.mode === "cloud" ? cloud : local);

  async function init({ forceLocal = false } = {}) {
    if (st.ready) return st.ready;
    st.ready = (async () => {
      const [db, user] = forceLocal ? [null, null] : await Promise.all([capability("db"), capability("user")]);
      if (db) {
        st.mode = "cloud"; st.db = db; st.user = user;
        // The sharing level is the database's own authority; DPAuth combines it with the Dupedia user directory.
        st.level = "interact";
        try {
          if (user) {
            st.userId = await user.id();
            const me = await user.me().catch(() => null); st.userName = (me && me.name) || ""; st.email = (me && me.email) || null; st.isOwner = !!(me && me.isOwner);
            const admin = await user.canEdit().catch(() => false), w = await user.can("data.write").catch(() => null);
            st.level = admin ? "admin" : w === false ? "view" : "interact";
          }
        } catch (e) { st.level = "interact"; }
        st.role = st.level === "admin" ? "admin" : st.level === "view" ? "viewer" : "employee";
      } else {
        st.mode = "local"; st.role = "employee"; st.level = "local";
        try { await idb(); } catch (e) { st.mode = "memory"; }
      }
      return st;
    })();
    return st.ready;
  }
  /** Signed-in identity (set by DPAuth after the sign-in gate). */
  function setIdentity({ id, name, role }) { st.userId = id; st.userName = name || ""; st.role = role; }

  /* ---------------- generic document API (both backends) ---------------- */
  const get = (path) => be().get(path);
  const set = (path, data) => be().set(path, data);
  const del = (path) => be().del(path);
  const list = (coll) => be().list(coll);
  const acquire = (path, opts) => be().acquire(path, opts);
  /** Read a document, tolerating "not visible" (the database answers those as absent). */
  const tryGet = (path) => be().get(path).catch(() => null);
  const tryList = (coll) => be().list(coll).catch(() => []);
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  const mem = {};
  const memLease = {}; const memB = { acquire: async (p, { holder, ttlMs = 30000 } = {}) => { const n = Date.now(), l = memLease[p]; if (l && l.exp > n && l.holder !== holder) return { acquired: false }; memLease[p] = { holder, exp: n + ttlMs }; return { acquired: true, holder }; }, get: async (p) => mem[p] || null, set: async (p, d) => { mem[p] = JSON.parse(JSON.stringify(d)); }, del: async (p) => { delete mem[p]; }, list: async (c) => Object.keys(mem).filter((k) => k.startsWith(c + "/") && k.split("/").length === c.split("/").length + 1).map((k) => ({ id: k.split("/").pop(), data: mem[k] })) };
  const be = () => (st.mode === "memory" ? memB : B());

  /* ---------------- high-level API ---------------- */
  const LIMIT = 230000;
  const size = (o) => JSON.stringify(o).length;
  /** Projects live in each owner's own subtree: projects/<ownerId>/p/<projectId> (+ /media, /cad, /versions below it).
   *  Employees can only reach their own subtree; administrators read and write every subtree (database rules). */
  const ownerOf = (project) => (project && project.meta && project.meta.ownerId) || st.userId || "local";
  const pbase = (owner, id) => `projects/${owner}/p/${id}`;
  async function saveProject(project, { cadData = null, baseRev = null, force = false, user = {} } = {}) {
    const id = project.meta.id; if (!project.meta.ownerId) project.meta.ownerId = st.userId || "local";
    const path = pbase(project.meta.ownerId, id);
    const prev = await be().get(path);
    if (prev && !force && baseRev != null && (prev.rev || 0) > baseRev && prev.savedById !== (user.id || null))
      return { ok: false, conflict: true, remote: prev };
    const rev = ((prev && prev.rev) || 0) + 1;
    const p = JSON.parse(JSON.stringify(project));
    const media = [];
    if (p.meta.clientLogo && p.meta.clientLogo.startsWith("data:")) { media.push(["logo", p.meta.clientLogo]); p.meta.clientLogo = "media:logo"; }
    if (p.proposal.coverImage && String(p.proposal.coverImage).startsWith("data:")) { media.push(["cover", p.proposal.coverImage]); p.proposal.coverImage = "media:cover"; }
    p.audit = (p.audit || []).slice(-150);
    delete p._summaryTotal; delete p._summaryCurrency; delete p._summaryBase;
    const doc = { project: p, rev, savedAt: new Date().toISOString(), savedBy: user.name || "", savedById: user.id || null, ownerId: project.meta.ownerId,
      summary: { name: p.meta.name, client: p.meta.client, ref: p.meta.ref, location: p.meta.location, type: p.meta.type, status: p.meta.status, objects: p.objects.length,
        total: project._summaryTotal || null, currency: project._summaryCurrency || null, base: project._summaryBase || null,
        issuedAt: p.meta.issuedAt || null, rev: p.meta.rev || 0, leadId: p.meta.leadId || null, ownerId: project.meta.ownerId, created: p.meta.created || null } };
    if (size(doc) > LIMIT) return { ok: false, tooLarge: true, bytes: size(doc) };
    for (const [k, v] of media) if (v.length < LIMIT) await be().set(`${path}/media/${k}`, { dataUrl: v });
    let cadNote = null;
    if (cadData) { const c = compactCad(cadData, project.cad, LIMIT - 2000); if (c.data) await be().set(`${path}/cad/main`, { cad: c.data }); cadNote = c.note; }
    await be().set(path, doc);
    return { ok: true, rev, cadNote };
  }
  async function loadProject(id, owner) {
    owner = owner || st.userId || "local"; const path = pbase(owner, id);
    const d = await be().get(path); if (!d) return null;
    const p = d.project; p.meta.ownerId = p.meta.ownerId || owner;
    if (p.meta.clientLogo === "media:logo") { const m = await be().get(`${path}/media/logo`); p.meta.clientLogo = m ? m.dataUrl : null; }
    if (p.proposal && p.proposal.coverImage === "media:cover") { const m = await be().get(`${path}/media/cover`); p.proposal.coverImage = m ? m.dataUrl : null; }
    let cadData = null; if (p.cad) { const c = await be().get(`${path}/cad/main`); cadData = c ? c.cad : null; }
    return { project: p, rev: d.rev, savedAt: d.savedAt, savedBy: d.savedBy, cadData };
  }
  /** owners: list of user ids whose projects to list (administrators: everyone in the directory; employees: themselves). */
  async function listProjects(owners) {
    owners = owners && owners.length ? owners : [st.userId || "local"];
    const all = await Promise.all(owners.map((o) => tryList(`projects/${o}/p`).then((l) => l.map((x) => Object.assign({ id: x.id, ownerId: o, rev: x.data.rev, savedAt: x.data.savedAt, savedBy: x.data.savedBy, savedById: x.data.savedById }, x.data.summary || {}, { ownerId: o })))));
    return all.flat().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }
  async function deleteProject(id, owner) {
    const path = pbase(owner || st.userId || "local", id);
    for (const sub of ["versions", "media", "cad"]) { const l = await tryList(`${path}/${sub}`); for (const x of l) await be().del(`${path}/${sub}/${x.id}`); }
    await be().del(path);
  }
  async function saveVersion(project, label, user = {}) {
    const vid = "v" + Date.now().toString(36), p = JSON.parse(JSON.stringify(project)); p.meta.clientLogo = null; if (p.proposal) p.proposal.coverImage = null; p.audit = (p.audit || []).slice(-40);
    const doc = { project: p, label: label || "", at: new Date().toISOString(), by: user.name || "", byId: user.id || null };
    if (size(doc) > LIMIT) throw new Error("This version is too large to store.");
    await be().set(`${pbase(ownerOf(project), project.meta.id)}/versions/${vid}`, doc); return vid;
  }
  async function listVersions(id, owner) { const l = await be().list(`${pbase(owner || st.userId || "local", id)}/versions`); return l.map((x) => ({ id: x.id, label: x.data.label, at: x.data.at, by: x.data.by, objects: x.data.project.objects.length })).sort((a, b) => b.at.localeCompare(a.at)); }
  async function getVersion(id, vid, owner) { const d = await be().get(`${pbase(owner || st.userId || "local", id)}/versions/${vid}`); return d && d.project; }

  /** 2.0 → 2.1 migration: 2.0 stored projects at projects/<projectId>. Move each one into its owner's subtree
   *  (the person who last saved it, else `fallbackOwner`). Runs for administrators (cloud) or on this device (local).
   *  Copies first, verifies, then deletes the old document, so an interrupted run loses nothing. */
  async function migrateLegacy(fallbackOwner, knownIds) {
    const legacy = (await tryList("projects")).filter((x) => x.data && x.data.project && x.data.project.meta);
    const moved = [];
    for (const x of legacy) {
      const pid = x.id, d = x.data, owner = (d.savedById && (!knownIds || knownIds.includes(d.savedById))) ? d.savedById : fallbackOwner;
      const to = pbase(owner, pid);
      d.project.meta.ownerId = owner; d.ownerId = owner; if (d.summary) d.summary.ownerId = owner;
      for (const sub of ["versions", "media", "cad"]) for (const y of await tryList(`projects/${pid}/${sub}`)) await be().set(`${to}/${sub}/${y.id}`, y.data);
      await be().set(to, d);
      const check = await be().get(to);
      if (check && check.rev === d.rev) { for (const sub of ["versions", "media", "cad"]) for (const y of await tryList(`projects/${pid}/${sub}`)) await be().del(`projects/${pid}/${sub}/${y.id}`); await be().del(`projects/${pid}`); moved.push({ pid, owner }); }
    }
    return moved;
  }
  async function listTemplates() { const l = await be().list("templates"); return l.map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  async function saveTemplate(t) { const id = t.id || "t" + Date.now().toString(36); const doc = Object.assign({}, t, { id }); if (size(doc) > LIMIT) throw new Error("This layout is too large for a template."); await be().set(`templates/${id}`, doc); return id; }
  const deleteTemplate = (id) => be().del(`templates/${id}`);
  const getConfig = (name) => be().get(`config/${name}`);
  const setConfig = (name, data) => be().set(`config/${name}`, data);
  const getRestricted = (name) => be().get(`restricted/${name}`).catch(() => null);
  const setRestricted = (name, data) => be().set(`restricted/${name}`, data);
  async function getPref(k) { if (st.mode === "cloud" && st.userId) { const d = await be().get(`data/users/${st.userId}/prefs`).catch(() => null); return d ? d[k] : null; } return localStorageGet("dp.sp2.pref." + k); }
  async function setPref(k, v) { if (st.mode === "cloud" && st.userId) { const d = (await be().get(`data/users/${st.userId}/prefs`).catch(() => null)) || {}; d[k] = v; return be().set(`data/users/${st.userId}/prefs`, d).catch(() => {}); } localStorageSet("dp.sp2.pref." + k, v); }

  /** Heavy local-only data (imported drawing source, reference raster) kept in IndexedDB on this device. */
  async function putLocalHeavy(id, data) { try { await local.set(`heavy/${id}`, data); return true; } catch (e) { return false; } }
  async function getLocalHeavy(id) { try { return await local.get(`heavy/${id}`); } catch (e) { return null; } }

  /** Reduce CAD geometry to a byte budget: visible layers only, Douglas–Peucker at growing tolerances. */
  function compactCad(cadData, cad, budget) {
    if (!cadData) return { data: null, note: null };
    const hidden = (cad && cad.hidden) || {}, scale = (cad && cad.scale) || 1, G = root.DPGeom;
    for (const tolM of [0, 0.02, 0.05, 0.1, 0.25, 0.5]) {
      const tol = tolM / scale;
      const paths = cadData.paths.map((P) => { if (hidden[P.l]) return null; if (!tol) return { l: P.l, p: P.p, c: P.c };
        const pts = []; for (let k = 0; k < P.p.length; k += 2) pts.push([P.p[k], P.p[k + 1]]); const s = G.simplify(pts, tol); return { l: P.l, p: s.flat().map((v) => Math.round(v * 1000) / 1000), c: P.c }; });
      const data = { layers: cadData.layers, paths, texts: [], bbox: cadData.bbox, insunits: cadData.insunits, fileName: cadData.fileName, candidates: cadData.candidates, simplified: tolM };
      if (size(data) < budget) return { data, note: tolM ? `Imported drawing simplified to ${tolM * 100} cm for shared storage; the project file keeps the full drawing.` : null };
    }
    return { data: null, note: "The imported drawing is too large for shared storage; plan geometry is saved. Keep the project file to reopen the full drawing." };
  }


  /** db rules declared when publishing (kept here so the README, the tests and the publish call agree).
   *  Levels: view < interact (Contributor = employee) < admin (Editor/Owner = administrator) < owner. */
  const RULES = [
    { path: "", read: "interact", write: "admin" },                        // default: staff read, administrators write
    { path: "config", read: "interact", write: "admin" },                  // catalogue, settings, roles (no money)
    { path: "config/pricebook", read: "admin", write: "admin" },           // master price book: administrators only…
    { path: "config/commission", read: "admin", write: "admin" },          // commission rule: administrators only
    { path: "pb", read: "admin", write: "admin" },                         // …sales staff read a copy written for them only
    { path: "pb/{self}", read: "interact", write: "admin" },               //   (engineers and data entry get none)
    { path: "restricted", read: "admin", write: "admin" },                 // cost prices
    { path: "templates", read: "interact", write: "interact" },
    { path: "directory", read: "interact", write: "admin" },               // who may use the app, role, name, title, department
    { path: "avatars", read: "interact", write: "admin" },                 // profile pictures (display size)
    { path: "avatarorig", read: "admin", write: "admin" },                 // original uploads
    { path: "staff", read: "admin", write: "admin" },                      // HR record (employee ID, mobile, hire date) and targets
    { path: "staff/{self}", read: "interact", write: "admin" },            //   each person reads only their own
    { path: "projects", read: "admin", write: "admin" },
    { path: "projects/{self}", read: "interact", write: "interact" },
    { path: "leads", read: "interact", write: "admin" },                   // lead record: ownership, status, qualification (admin)
    { path: "leadcontact", read: "interact", write: "interact" },          // shared contact data & research (data entry and sales)
    { path: "leadprop", read: "admin", write: "admin" },                   // new leads proposed by data entry
    { path: "leadprop/{self}", read: "interact", write: "interact" },
    { path: "claims", read: "interact", write: "admin" },
    { path: "claims/{self}", read: "interact", write: "interact" },
    { path: "acts", read: "interact", write: "admin" },                    // calls & activities: shared timeline…
    { path: "acts/{self}", read: "interact", write: "interact" },          //   …each person writes only their own
    { path: "crm", read: "admin", write: "admin" },
    { path: "crm/{self}", read: "interact", write: "interact" },
    { path: "locks", read: "interact", write: "interact" },
    { path: "submissions", read: "admin", write: "admin" },
    { path: "submissions/{self}", read: "interact", write: "interact" },
    { path: "orders", read: "admin", write: "admin" },                     // full order: values, cost, payments, receipts
    { path: "salesorders", read: "admin", write: "admin" },                // the sales owner's view of their order…
    { path: "salesorders/{self}", read: "interact", write: "admin" },      //   …values, payments and receipts, read-only
    { path: "paysub", read: "admin", write: "admin" },                     // payments reported by sales, awaiting verification
    { path: "paysub/{self}", read: "interact", write: "interact" },
    { path: "assign", read: "interact", write: "admin" },                  // order → sales owner, engineer, deadline (no money)
    { path: "eng", read: "interact", write: "admin" },                     // engineering status everyone involved can follow…
    { path: "eng/{self}", read: "interact", write: "interact" },           //   …written only by the engineer it belongs to
    { path: "engx", read: "admin", write: "admin" },                       // handover pack, internal notes, team, suppliers
    { path: "engx/{self}", read: "interact", write: "interact" },          //   private to the assigned engineer and administrators
    { path: "workers", read: "interact", write: "interact" },              // worker directory (no app access)
    { path: "commissions", read: "admin", write: "admin" },
    { path: "commissions/{self}", read: "interact", write: "admin" },
    { path: "notif", read: "admin", write: "admin" },                      // inbox: administrators deliver to anyone…
    { path: "notif/{self}", read: "interact", write: "interact" },         //   …each person reads and marks their own
    { path: "outbox", read: "interact", write: "admin" },                  // non-financial event messages between staff
    { path: "outbox/{self}", read: "interact", write: "interact" },
    { path: "activity", read: "admin", write: "admin" },
    { path: "activity/{self}", read: "interact", write: "interact" },
    { path: "requests", read: "admin", write: "admin" },
    { path: "requests/{self}", read: "interact", write: "interact" },
    { path: "adminlog", read: "admin", write: "admin" },
    { path: "sweep", read: "admin", write: "admin" },                      // server sweep runs (lead release log)
    // X FORCE 1.0
    { path: "handoff", read: "interact", write: "admin" },                 // accepted order → engineering: technical pack, NO money…
    { path: "handoff/{self}", read: "interact", write: "interact" },       //   …written by the sales owner the moment the client accepts
    { path: "wall", read: "interact", write: "admin" },                    // company wall: everyone reads…
    { path: "wall/{self}", read: "interact", write: "interact" },          //   …each person posts only under their own id (authorship = path)
    { path: "keys", read: "interact", write: "admin" },                    // public keys for private chat (end-to-end encrypted)
    { path: "keys/{self}", read: "interact", write: "interact" },
    { path: "dmx", read: "interact", write: "interact" },                  // private chat: encrypted, at paths only the two participants can derive
    // 1.1
    { path: "askceo", read: "admin", write: "admin" },                     // Ask CEO: the CEO's office reads and answers every conversation
    { path: "askceo/{self}", read: "interact", write: "interact" },       // … each employee only their own conversation with the CEO
    { path: "mi", read: "interact", write: "admin" },                      // Market Intelligence: opportunities, research history, job health (no money)
    { path: "mix", read: "admin", write: "admin" },                        // CEO-only intelligence: material prices, supplier quotes, pricing and weekly reports, news
    { path: "data/users/{self}", write: "interact" },
  ];
  /** Evaluate RULES for a path the way the database does (used by the tests and the local emulator).
   *  Returns true when a viewer with `level` (and id `uid`) may perform `op` ("read"|"write") on `path`. */
  const LV = { view: 0, interact: 1, admin: 2, owner: 3 };
  function allowed(path, op, level, uid) {
    const seg = path.split("/"); let need = { read: "view", write: "interact" }, privateSibling = false;
    const rules = RULES.slice().sort((a, b) => (a.path ? a.path.split("/").length : 0) - (b.path ? b.path.split("/").length : 0));
    const has = (p) => RULES.some((r) => r.path === p);
    for (const r of rules) {
      const rs = r.path ? r.path.split("/") : []; if (rs.length > seg.length) continue;
      const self = rs[rs.length - 1] === "{self}", pre = self ? rs.slice(0, -1) : rs;
      if (pre.some((x, i) => x !== seg[i])) continue;
      if (self) { if (seg[rs.length - 1] !== uid) { if (!has(pre.join("/"))) privateSibling = true; continue; } }
      need = { read: r.read || need.read, write: r.write || need.write };
      if (LV[need.write] < LV[need.read]) need.write = need.read;
    }
    if (privateSibling) return false;
    return LV[level] >= LV[need[op]];
  }
  root.DPStore = { st, init, setIdentity, capability, get, set, del, list, acquire, tryGet, tryList, saveProject, loadProject, listProjects, deleteProject, saveVersion, listVersions, getVersion,
    migrateLegacy, listTemplates, saveTemplate, deleteTemplate, getConfig, setConfig, getRestricted, setRestricted, getPref, setPref, putLocalHeavy, getLocalHeavy, compactCad,
    RULES, allowed, localStorageGet, localStorageSet, local };
})(typeof self !== "undefined" ? self : this);
