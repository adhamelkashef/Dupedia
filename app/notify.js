/* X FORCE 1.0 (Dupedia) — notification center and deal celebration.

   Inbox   notif/<uid>/n/<id>     persistent, per person (read/unread). Only the person and administrators can read it.
   Outbox  outbox/<uid>/e/<id>    events written by a non-administrator for other people (e.g. an engineer's status update
                                  for the sales owner). Outbox events NEVER carry money: amounts, payments and commission
                                  are delivered by administrators straight into the recipient's inbox.
   Each signed-in person's app copies the outbox events addressed to them into their own inbox, using a deterministic id
   (<author>-<event>), so repeated processing never creates duplicates. Administrators' writes land in the inbox directly. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth;
  const now = () => new Date().toISOString();
  const N = { items: [], unsub: null, timer: null, listeners: [], celebrating: false };
  const meId = () => (AU().A.me || {}).id;
  const safeId = (s) => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 180);

  /** Deliver a notification. Administrators write to the recipient's inbox; others post to their outbox (no money!). */
  async function deliver(to, n) {
    const tos = [].concat(to).filter(Boolean); if (!tos.length) return;
    const id = safeId(n.id || ("n-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)));
    const doc = { id, type: n.type || "info", title: n.title || "", body: n.body || "", link: n.link || null, ref: n.ref || null, at: now(), from: meId() || null, read: false, celebrate: !!n.celebrate, data: n.data || null, priority: n.priority || null };
    if (AU().isAdmin()) {
      const ids = new Set(); for (const t of tos) { if (t === "@admins") AU().A.directory.filter((r) => r.uid && r.active !== false && AU().baseOf(r.role) === "admin").forEach((r) => ids.add(r.uid)); else ids.add(t); }
      for (const u of ids) { const path = `notif/${u}/n/${id}`; if (!(await DS().tryGet(path))) await DS().set(path, doc); }
    } else {
      if (n.data && /amount|minor|total|price|commission/i.test(JSON.stringify(n.data))) throw new Error("Outbox events must not carry financial data.");
      await DS().set(`outbox/${meId()}/e/${id}`, Object.assign({}, doc, { to: tos }));
    }
  }
  /** Write a notification into my own inbox (allowed for everyone: notif/{self}). Deterministic ids make it idempotent. */
  async function toSelf(n) {
    const me = meId(); if (!me) return; const id = safeId(n.id || ("n-" + Date.now().toString(36)));
    const path = `notif/${me}/n/${id}`; if (await DS().tryGet(path)) return false;
    await DS().set(path, { id, type: n.type || "info", title: n.title || "", body: n.body || "", link: n.link || null, ref: n.ref || null, at: n.at || now(), from: me, read: false, celebrate: !!n.celebrate, data: n.data || null, priority: n.priority || null });
    if (!N.items.some((x) => x.id === id)) { N.items.unshift({ id, type: n.type || "info", title: n.title, body: n.body, link: n.link || null, at: n.at || now(), read: false, celebrate: !!n.celebrate, data: n.data || null }); emit(); }
    return true;
  }
  /** Categories shown as filters in the Notification Center. */
  const CATEGORIES = { all: "All", order: "Orders & quotations", payment: "Payments", engineering: "Engineering", commission: "Commission", lead: "Leads & follow-ups", message: "Messages", access: "Access & admin" };
  const categoryOf = (n) => ({ deal: "order", order: "order", quote: "order", payment: "payment", engineering: "engineering", commission: "commission", lead: "lead", followup: "lead", message: "message", chat: "message", access: "access", info: "access" }[n.type] || "access");
  /** Copy outbox events addressed to me into my inbox (idempotent), then load my inbox. */
  async function pull() {
    const me = meId(); if (!me) return [];
    const admin = AU().isAdmin(), dir = AU().A.directory.filter((r) => r.uid && r.uid !== me);
    const inbox = await DS().tryList(`notif/${me}/n`), have = new Set(inbox.map((x) => x.id));
    const lists = await Promise.all(dir.map((r) => DS().tryList(`outbox/${r.uid}/e`).then((l) => l.map((x) => Object.assign({ author: r.uid }, x)))));
    const since = Date.now() - 45 * 864e5;
    for (const ev of lists.flat()) {
      const d = ev.data; if (!d || !Array.isArray(d.to)) continue;
      if (!(d.to.includes(me) || (admin && d.to.includes("@admins")))) continue;
      if (Date.parse(d.at) < since) continue;
      const id = safeId(`${ev.author}-${ev.id}`); if (have.has(id)) continue;
      const copy = Object.assign({}, d, { id, from: ev.author, read: false }); delete copy.to;
      await DS().set(`notif/${me}/n/${id}`, copy).catch(() => {}); inbox.push({ id, data: copy }); have.add(id);
    }
    // tidy my own old outbox events (older than 45 days)
    for (const x of await DS().tryList(`outbox/${me}/e`)) if (Date.parse(x.data.at) < since) await DS().del(`outbox/${me}/e/${x.id}`).catch(() => {});
    N.items = inbox.map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!N.primed) { N.primed = true; if (root.DPSound) root.DPSound.seen(N.items.map((x) => x.id)); }
    emit(); return N.items;
  }
  const unread = () => N.items.filter((x) => !x.read).length;
  async function markRead(ids) { const me = meId(); for (const id of ids) { const it = N.items.find((x) => x.id === id); if (!it || it.read) continue; it.read = true; it.readAt = now(); const copy = Object.assign({}, it); delete copy.id; await DS().set(`notif/${me}/n/${id}`, Object.assign(copy, { id })).catch(() => {}); } emit(); }
  async function markCelebrated(id) { const it = N.items.find((x) => x.id === id); if (!it) return; it.celebrated = now(); const copy = Object.assign({}, it); await DS().set(`notif/${meId()}/n/${id}`, copy).catch(() => {}); }
  function on(fn) { N.listeners.push(fn); }
  function emit() { for (const f of N.listeners) try { f(N.items); } catch (e) {} chimeNew(); checkCelebration(); }
  /** 1.1: a chime for notifications that arrive while the app is open — never for the backlog present at sign-in, never twice. */
  function chimeNew() {
    if (!root.DPSound || !N.primed) return;
    for (const n of N.items.filter((x) => !x.read)) root.DPSound.notify(n);
  }
  /** Start: live updates through the database subscription when the platform offers it, plus a polling fallback. */
  function start() {
    stop(); pull().catch(() => {});
    const db = DS().st.db, me = meId();
    if (db && db.collection && me) { try { N.unsub = db.collection(`notif/${me}/n`).onSnapshot((snap) => { N.items = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => String(b.at).localeCompare(String(a.at))); emit(); }, () => {}); } catch (e) { N.unsub = null; } }
    N.timer = setInterval(() => pull().catch(() => {}), 45000);
    root.addEventListener && root.addEventListener("focus", focusPull);
  }
  const focusPull = () => pull().catch(() => {});
  function stop() { N.primed = false; if (N.unsub) try { N.unsub(); } catch (e) {} N.unsub = null; clearInterval(N.timer); root.removeEventListener && root.removeEventListener("focus", focusPull); }

  /* ---------------- deal celebration ----------------
     Shown once per approval event: the inbox item "deal-<orderId>" carries celebrate:true; after it is shown it is stamped
     `celebrated`, so a reload or a later update never repeats it. */
  async function checkCelebration() {
    if (N.celebrating) return; const it = N.items.find((x) => x.celebrate && !x.celebrated); if (!it) return;
    N.celebrating = true; await markCelebrated(it.id);
    try { await celebrate(it); } finally { N.celebrating = false; }
  }
  async function celebrate(it) {
    const me = AU().A.me || {}, pic = await AU().avatarUrl(me.id), esc = root.DPUI.esc;
    // a modal <dialog> sits in the browser's top layer, above any dialog that is already open
    const el = document.createElement("dialog"); el.className = "celebrate"; el.setAttribute("aria-label", "Deal closed");
    const d = it.data || {};
    el.innerHTML = `<div class="cel-card"><canvas class="cel-fx" aria-hidden="true"></canvas><img class="cel-pic" alt="" src="${esc(pic)}">
      <div class="cel-txt"><span class="eyebrow">Order approved</span><h2>Congratulations, <em>${esc(me.firstName || "")}</em>!</h2><p>You just closed a deal${d.project ? ` — <b>${esc(d.project)}</b>` : ""}${d.client ? ` for ${esc(d.client)}` : ""}.</p>
      ${d.value ? `<p class="cel-val">${esc(d.value)}</p>` : ""}<button class="btn lime" id="cel-ok">Thank you</button></div></div>`;
    document.body.appendChild(el); try { el.showModal(); } catch (e) { el.setAttribute("open", ""); }
    const close = () => { el.classList.add("out"); setTimeout(() => { try { el.close(); } catch (e) {} el.remove(); }, 260); markRead([it.id]); };
    el.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    el.querySelector("#cel-ok").onclick = close; el.onclick = (e) => { if (e.target === el) close(); }; setTimeout(() => el.querySelector("#cel-ok").focus(), 50);
    confetti(el.querySelector(".cel-fx"));
  }
  /** Brief, restrained confetti in brand colours; skipped when the person prefers reduced motion. */
  function confetti(cv) {
    if (root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1); cv.width = box.width * dpr; cv.height = box.height * dpr;
    const ctx = cv.getContext("2d"), cols = ["#B8D241", "#262626", "#DCDAD2", "#B8D241"], P = [];
    for (let i = 0; i < 70; i++) P.push({ x: cv.width * (0.2 + Math.random() * 0.6), y: -10 * dpr - Math.random() * 60 * dpr, vx: (Math.random() - 0.5) * 3 * dpr, vy: (1.5 + Math.random() * 2.5) * dpr, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, w: (4 + Math.random() * 5) * dpr, h: (6 + Math.random() * 8) * dpr, c: cols[i % cols.length] });
    const t0 = performance.now();
    (function frame(t) { const k = t - t0; ctx.clearRect(0, 0, cv.width, cv.height); ctx.globalAlpha = Math.max(0, 1 - k / 2600);
      for (const p of P) { p.x += p.vx; p.y += p.vy; p.vy += 0.03 * dpr; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
      if (k < 2600 && cv.isConnected) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height); })(t0);
  }

  root.DPNotify = { N, deliver, toSelf, pull, unread, markRead, on, start, stop, celebrate, CATEGORIES, categoryOf };
})(typeof self !== "undefined" ? self : this);
