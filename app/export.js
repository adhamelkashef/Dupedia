/* X FORCE 1.1 (Dupedia) — full database export, used to move the company's data from claude.ai to the self-hosted server
   (server/server.js import <file>). Administrators only; it reads only what the administrator's own access allows.
   The shared database cannot list "every collection", so the export walks the collections X FORCE writes (WALK below,
   kept next to the code that writes them; qa/export.test checks it covers every document a full test run creates).
   Not exported: private chats (end-to-end encrypted at paths only the two participants can derive, and the keys are kept
   in each person's private area) and each person's private preferences. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore;
  // U = each user id in the directory; * = every document found in the collection above it
  const WALK = ["config", "restricted", "restricted/*/c", "templates", "directory", "avatars", "avatarorig", "avatarorig/U/c", "staff", "pb", "leads", "leadcontact", "leadcontact/*/log",
    "orders", "orders/*/files", "orders/*/files/*/c", "orders/*/handover", "assign", "workers", "workers/*/pic", "workers/*/pic/*/c", "adminlog", "sweep", "activity", "requests", "keys",
    "projects/U/p", "projects/U/p/*/media", "projects/U/p/*/cad", "projects/U/p/*/versions", "leadprop/U/p", "claims/U/c", "acts/U/a", "crm/U/l", "crm/U/mi",
    "submissions/U/s", "submissions/U/s/*/ev", "submissions/U/s/*/ev/*/c", "salesorders/U/o", "salesorders/U/o/*/f", "salesorders/U/o/*/f/*/c", "paysub/U/p", "paysub/U/p/*/c",
    "eng/U/o", "engx/U/o", "engx/U/o/*/f", "engx/U/o/*/f/*/c", "engx/U/o/*/h", "engx/U/wid", "engx/U/wid/*/c", "commissions/U/r", "commissions/U/r/*/po", "commissions/U/r/*/po/*/c",
    "notif/U/n", "outbox/U/e", "requests/U/cc", "handoff/U/o", "wall/U/m", "wall/U/f", "wall/U/f/*/c", "askceo/U/m", "askceo/U/f", "askceo/U/f/*/c", "askceo/U/meta",
    "mi", "mi/opps/o", "mi/state/jobs", "mi/req/r", "mi/runs/r", "mix", "mix/mat/m", "mix/quotes/q", "mix/quotes/q/*/c", "mix/fx/r", "mix/news/n", "mix/reports/w", "mix/reports/p"];
  async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
  async function full({ onProgress } = {}) {
    if (!root.DPAuth.isAdmin()) throw new Error("Administrators only.");
    const uids = (await root.DPAuth.listDirectory()).map((r) => r.uid).filter(Boolean), docs = {}; let lists = 0;
    const listed = {};   // collection → ids
    async function list(coll) { if (listed[coll]) return listed[coll]; const l = await DS().tryList(coll); lists++; listed[coll] = l.map((x) => x.id); for (const x of l) docs[`${coll}/${x.id}`] = { d: x.data }; if (onProgress && lists % 20 === 0) onProgress(Object.keys(docs).length, lists); return listed[coll]; }
    async function expand(segs, prefix) {
      if (!segs.length) return list(prefix);
      const [s, ...rest] = segs, base = prefix ? prefix + "/" : "";
      if (s === "U") return pool(uids, 6, (u) => expand(rest, base + u));
      if (s === "*") { const ids = await list(prefix); return pool(ids, 6, (id) => expand(rest, base + id)); }
      return expand(rest, base + s);
    }
    for (const w of WALK) {
      const segs = w.split("/"); if (segs.length === 1) { await list(w); continue; }
      // collection paths have an odd number of segments: walk them from the first segment
      await expand(segs.slice(1), segs[0]);
    }
    // files are stored as chunk documents (<file>/c/NNN) under a path that is not itself a document: find each file from the
    // record that refers to it, then read its chunks
    const ids = (d, re) => { const out = new Set(); const walk = (v) => { if (typeof v === "string") { if (re.test(v)) out.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); }; walk(d); return [...out]; };
    const workers = Object.keys(docs).filter((p) => /^workers\/[^/]+$/.test(p)).map((p) => p.split("/")[1]);
    const engs = uids;
    const FILES = [
      [/^orders\/[^/]+$/, (p, d) => ids(d, /^f-[a-z0-9]+$/).map((i) => `${p}/files/${i}`)],
      [/^salesorders\/[^/]+\/o\/[^/]+$/, (p, d) => ids(d, /^f-[a-z0-9]+$/).map((i) => `${p}/f/${i}`)],
      [/^paysub\/[^/]+\/p\/[^/]+$/, (p) => [p]],
      [/^askceo\/[^/]+\/m\/[^/]+$/, (p, d) => ids(d, /^f-[a-z0-9]+$/).map((i) => `${p.split("/").slice(0, 2).join("/")}/f/${i}`)],
      [/^wall\/[^/]+\/m\/[^/]+$/, (p, d) => ids(d, /^f-[a-z0-9]+$/).map((i) => `${p.split("/").slice(0, 2).join("/")}/f/${i}`)],
      [/^engx\/[^/]+\/o\/[^/]+$/, (p, d) => ids(d, /^tf-[a-z0-9]+$/).map((i) => `${p}/f/${i}`)],
      [/^commissions\/[^/]+\/r\/[^/]+$/, (p, d) => ids(d, /^po-[a-z0-9]+$/).map((i) => `${p}/po/${i}`)],
      [/^submissions\/[^/]+\/s\/[^/]+$/, (p) => [`${p}/ev/main`]],
      [/^mix\/quotes\/q\/[^/]+$/, (p) => [p]],
    ];
    const bases = new Set();
    for (const [p, x] of Object.entries(docs)) for (const [re, fn] of FILES) if (re.test(p)) for (const b of fn(p, x.d)) bases.add(b);
    for (const w of workers) { bases.add(`restricted/wid-${w}`); for (const e of engs) bases.add(`engx/${e}/wid/${w}`); }
    await pool([...bases], 6, (b) => list(`${b}/c`));
    if (onProgress) onProgress(Object.keys(docs).length, lists);
    return { format: "xforce-server-db-1", at: new Date().toISOString(), source: "claude.ai", note: "Private chats and personal preferences are not included (end-to-end encrypted / private).", docs };
  }
  root.DPExport = { WALK, full };
  if (typeof module !== "undefined") module.exports = root.DPExport;
})(typeof self !== "undefined" ? self : this);
