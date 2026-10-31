/* X FORCE 1.3 — self-hosted mode. Gives the app the same `claude.use("db" | "user" | "downloads")` capabilities it uses on
   claude.ai, backed by the X FORCE server (/api/*). The server — not this file — decides what each signed-in person may read
   or write, using the app's own access rules. Served only to signed-in sessions. */
(function () {
  "use strict";
  const H = { "content-type": "application/json", "x-xf": "1" };
  const toLogin = () => { try { location.href = "/login"; } catch (e) {} };
  async function api(url, opts = {}) {
    const r = await fetch(url, Object.assign({ credentials: "same-origin", headers: H }, opts));
    if (r.status === 401) { toLogin(); const e = new Error("Signed out — sign in again."); e.code = "unauthenticated"; throw e; }
    const j = await r.json().catch(() => ({ error: "server", message: `Server error (${r.status}).` }));
    if (j.error === "must_change") { try { location.replace("/login?change=1"); } catch (x) {} }   // 1.4.5: a temporary password must be replaced before anything else
    if (j.error) { const e = new Error(j.message || j.error); e.code = j.error; throw e; } return j;
  }
  const call = (b) => api("/api/db", { method: "POST", body: JSON.stringify(b) });
  const snap = (id, r) => ({ id, exists: !!r.exists, data: () => r.data, metadata: { version: r.version } });
  const doc = (path) => ({ id: path.split("/").pop(), path, get: () => call({ op: "get", path }).then((r) => snap(path.split("/").pop(), r)),
    set: (data) => call({ op: "set", path, data }).then(() => {}), update: (data) => call({ op: "update", path, data }).then(() => {}), delete: () => call({ op: "delete", path }).then(() => {}),
    acquire: (o) => call(Object.assign({ op: "acquire", path }, o)), create: (data) => call({ op: "create", path, data }).then((r) => ({ created: !!r.created })), collection: (c) => coll(path + "/" + c), onSnapshot: () => () => {} });
  const query = (path, ord, lim) => ({ orderBy: (f, dir = "asc") => query(path, [f, dir], lim), limit: (n) => query(path, ord, n), onSnapshot: () => () => {},
    get: () => call({ op: "list", path }).then((r) => { let l = r.docs.slice(); if (ord) l.sort((a, b) => { const x = a.data[ord[0]], y = b.data[ord[0]]; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (ord[1] === "desc" ? -1 : 1); });
      if (lim) l = l.slice(0, lim); return { docs: l.map((d) => snap(d.id, { exists: true, data: d.data })), size: l.length, empty: !l.length }; }) });
  const coll = (path) => Object.assign(query(path), { path, doc: (id) => doc(path + "/" + (id || Math.random().toString(36).slice(2))) });
  const db = { doc, collection: coll, page: (path, o) => call(Object.assign({ op: "list", path }, o || {})).then((r) => r.docs.map((d) => ({ id: d.id, data: d.data, at: d.at }))) };   // 1.4.6 chat paging
  let meP = null; const me = () => (meP = meP || api("/api/me"));
  const names = {};
  const prof = (id, isMe) => ({ id, name: names[id] || "", email: null, avatarUrl: "", color: "#888", isMe: !!isMe, guest: false });
  const user = {
    isOwner: async () => !!(await me()).owner, canEdit: async () => ["admin", "owner"].includes((await me()).level), can: async (n) => (n === "data.write" ? true : null),
    id: async () => (await me()).uid,
    me: async () => { const m = await me(); names[m.uid] = m.name; return { id: m.uid, name: m.name, email: null, avatarUrl: "", color: "#888", isOwner: !!m.owner, canEdit: ["admin", "owner"].includes(m.level) }; },
    profiles: async (ids) => { ids = [].concat(ids).filter(Boolean); const miss = ids.filter((i) => !(i in names)); if (miss.length) { const r = await api("/api/people?ids=" + encodeURIComponent(miss.join(","))).catch(() => ({ people: [] })); for (const p of r.people) names[p.id] = p.name; for (const i of miss) if (!(i in names)) names[i] = ""; }
      const m = await me(); return Object.fromEntries(ids.map((i) => [i, prof(i, i === m.uid)])); },
    search: async (q) => { const r = await api("/api/people?q=" + encodeURIComponent(q || "")).catch(() => ({ people: [] })); for (const p of r.people) names[p.id] = p.name; return r.people.map((p) => prof(p.id)); },
  };
  const downloads = { save: async ({ filename, data }) => { const blob = data instanceof Blob ? data : new Blob([data]); const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = filename || "download"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 2000); return true; } };
  window.claude = { use: async (n) => ({ db, user, downloads }[n] || null) };
  /* Server-only extras used by the app when it runs here (accounts, storage, backup, sign-out). */
  window.XFServer = {
    me, api,
    createAccount: (b) => api("/api/accounts", { method: "POST", body: JSON.stringify(b) }),
    updateAccount: (uid, b) => api("/api/accounts/" + encodeURIComponent(uid), { method: "POST", body: JSON.stringify(b) }),
    accounts: () => api("/api/accounts"),
    storage: () => api("/api/storage"),
    backupUrl: "/api/backup",
    changePassword: (old, password) => api("/api/password", { method: "POST", body: JSON.stringify({ old, password }) }),
    runSweep: () => api("/api/jobs/sweep", { method: "POST", body: "{}" }),
    changes: (since) => api("/api/changes?since=" + encodeURIComponent(since || "")),
    notif: (b) => api("/api/notif", { method: "POST", body: JSON.stringify(b) }),
    researchStatus: () => api("/api/research/status"),
    resetAccount: (uid, mode, o) => api("/api/accounts/" + encodeURIComponent(uid) + "/reset", { method: "POST", body: JSON.stringify(Object.assign({ mode }, o || {})) }),
    researchRun: (id, job) => api("/api/research/run", { method: "POST", body: JSON.stringify({ id, job: job || null }) }),
    logout: () => api("/api/logout", { method: "POST", body: "{}" }).finally(toLogin),
  };
})();
