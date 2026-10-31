/* X FORCE 1.3 (Dupedia) — live updates, pop-up notifications, follow-up reminders and notification preferences.

   LIVE UPDATES  The Cloudflare Worker keeps a change feed (/api/changes): which records the signed-in person may read have
   changed since a moment in server time (deleted records included). The page asks every 8 s while visible (every 60 s in a
   background tab, at once when the tab comes back), with back-off and a quiet "reconnecting" marker when the server cannot
   be reached. Only what changed is re-read: my inbox → the bell and pop-ups; records shown on the current page → that page is
   redrawn — but never while a dialog is open, a field has focus or the person typed in the last few seconds; scroll position
   is kept. Changes made by one person therefore appear for everyone allowed to see them, without reloading.

   REMINDERS     rem/<uid>/r/<id> — title, notes, related record, due time, priority, repeat, status, snooze, history.
   Stored on the server: they pop up on any device where the person is signed in, stay in the list (and in "Needs your
   attention") while overdue, and the hourly server job also drops a notification into the inbox when one falls due. */
/* global DPUI, DPStore, DPAuth, DPNotify, DPShell */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, U = () => root.DPUI, me = () => (root.DPAuth && DPAuth.A.me) || {};
  const now = () => new Date().toISOString(), esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const L = { cursor: null, timer: null, fails: 0, typedAt: 0, handlers: [], popped: new Set(), remPopped: new Set(), prefs: null, state: "idle", reminders: [] };

  /* ---------------- which page depends on which records ---------------- */
  const VIEW_DEPS = {
    dash: ["orders", "salesorders", "submissions", "assign", "eng", "fac", "leads", "claims", "commissions", "rem", "fin", "paysub"],
    finance: ["fin", "orders", "paysub", "commissions"], transfers: ["fin"], finaccounts: ["fin"], salaries: ["fin", "payslips"], purchases: ["fin"], invoices: ["fin", "requests"], taxes: ["fin"],
    payverify: ["paysub", "orders"], approvals: ["submissions", "paysub"], approvecomm: ["commissions"], mycomm: ["commissions"],
    leads: ["leads", "claims", "leadcontact"], myleads: ["leads", "claims", "crm", "acts"], allleads: ["leads", "claims", "crm"], calls: ["acts", "crm"], research: ["leads", "leadprop"],
    proposals: ["salesorders", "submissions", "assign", "eng", "fac"], register: ["orders", "assign", "eng", "fac"], tracking: ["salesorders", "assign", "eng", "fac"],
    engorders: ["assign", "eng", "engx", "handoff", "fac"], engqueue: ["assign", "eng", "handoff", "fac"], factory: ["assign", "eng", "fac"], workers: ["workers"],
    facjobs: ["fac", "assign", "eng"], facdash: ["fac", "assign", "eng"], equipment: ["fac"], products: ["prod"], catalog: ["prod"], reminders: ["rem"], holidays: ["hol"], growth: ["mkt", "leads", "submissions", "orders"], campaigns: ["mkt"], radar: ["mkt"], partners: ["mkt"],
  };
  const busyEditing = () => { const a = document.activeElement, m = document.querySelector("#modal[open], dialog[open]");
    return !!m || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox") || Date.now() - L.typedAt < 4000 || String(root.getSelection ? root.getSelection() : "").length > 0; };
  let pendingView = false;
  function softRefresh() {
    const App = U().App, v = App.view; if (!v || U().PROJECT_VIEWS.includes(v)) return;
    if (busyEditing()) { pendingView = true; marker("updated"); return; }
    pendingView = false; marker("");
    const box = document.querySelector("#view-" + v), y = box ? box.scrollTop : 0, wy = root.scrollY;
    const o = Object.assign({}, App.viewOpts || {}, { _live: true }); delete o.ref; delete o.new; try { U().go(v, o); } catch (e) { return; }
    for (const t of [0, 250, 800]) setTimeout(() => { const b = document.querySelector("#view-" + v); if (b && b.scrollTop !== y) b.scrollTop = y; if (root.scrollY !== wy) root.scrollTo(0, wy); }, t);
  }
  /* ---------------- the change feed ---------------- */
  async function poll() {
    clearTimeout(L.timer); if (!root.XFServer || !me().id) return schedule();
    try {
      const r = await root.XFServer.changes(L.cursor); L.fails = 0; setState("ok");
      if (r.reset || !L.cursor) { L.cursor = r.now; return schedule(); }
      L.cursor = r.now; if (r.paths && r.paths.length) dispatch(r.paths, r.more);
    } catch (e) { L.fails++; setState(e && e.code === "unauthenticated" ? "signedout" : "retry"); }
    schedule();
  }
  function schedule() { clearTimeout(L.timer); const hidden = document.hidden, base = hidden ? 60000 : 8000, back = Math.min(60000, base * Math.pow(2, Math.min(L.fails, 3))); L.timer = setTimeout(poll, L.fails ? back : base); }
  function dispatch(paths, more) {
    const uid = me().id, segs = new Set(paths.map((p) => p.split("/")[0]));
    if (paths.some((p) => p.startsWith(`notif/${uid}`))) DPNotify.pull().catch(() => {});
    if (paths.some((p) => p.startsWith(`rem/${uid}`))) loadReminders().catch(() => {});
    for (const h of L.handlers) if ([...segs].some((s) => h.segs.includes(s))) try { h.fn(paths); } catch (e) {}
    const deps = VIEW_DEPS[U().App.view] || [];
    if (more || deps.some((d) => segs.has(d))) softRefresh();
    if (U().isAdmin() && root.DPShell && [...segs].some((s) => ["submissions", "paysub", "assign", "commissions", "requests", "fac"].includes(s))) DPShell.refreshBadges().catch(() => {});
  }
  /** Other modules: run fn when records under any of these top-level collections change. */
  const on = (segs, fn) => L.handlers.push({ segs: [].concat(segs), fn });
  function setState(s) { if (L.state === s) return; L.state = s; marker(s === "retry" ? "retry" : pendingView ? "updated" : ""); }
  function marker(kind) {
    let m = document.getElementById("xf-live"); if (!kind) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement("button"); m.id = "xf-live"; m.type = "button"; document.body.appendChild(m); }
    m.className = "xf-live " + kind; m.textContent = kind === "retry" ? "Reconnecting…" : "New updates — show";
    m.onclick = () => { if (kind === "updated") { pendingView = false; marker(""); const v = U().App.view; U().go(v, U().App.viewOpts || {}); } else poll(); };
  }
  function start() {
    stop(); L.cursor = null; poll(); loadReminders().catch(() => {}); loadPrefs().catch(() => {});
    L.remTimer = setInterval(checkReminders, 30000);
    document.addEventListener("visibilitychange", onVis); root.addEventListener("keydown", typed, true); root.addEventListener("input", typed, true);
  }
  const typed = () => { L.typedAt = Date.now(); };
  const onVis = () => { if (!document.hidden) { poll(); if (pendingView && !busyEditing()) softRefresh(); } };
  function stop() { clearTimeout(L.timer); clearInterval(L.remTimer); document.removeEventListener("visibilitychange", onVis); root.removeEventListener("keydown", typed, true); root.removeEventListener("input", typed, true); marker(""); }
  // apply a held-back refresh as soon as the person stops editing
  setInterval(() => { if (pendingView && !busyEditing() && !document.hidden) softRefresh(); }, 3000);

  /* ---------------- pop-up notifications ---------------- */
  const ICON = { deal: "★", order: "◆", quote: "◆", payment: "¤", commission: "%", engineering: "⚙", factory: "⚙", lead: "◎", followup: "⏰", reminder: "⏰", message: "✉", chat: "✉", access: "⚿", info: "•", product: "▣", holiday: "☼", finance: "¤" };
  const KIND = (n) => n.priority === "urgent" ? "urgent" : n.priority === "warning" || /overdue|delay|fail|blocked|exceed|missed/i.test(n.title || "") ? "warning" : /verified|completed|paid|approved|assigned to you|accepted/i.test(n.title || "") ? "success" : "info";
  const MANDATORY = (n) => n.priority === "urgent" || n.mandatory === true;
  function wrap() { let w = document.getElementById("xf-toasts"); if (!w) { w = document.createElement("div"); w.id = "xf-toasts"; w.setAttribute("aria-live", "polite"); document.body.appendChild(w); } return w; }
  function popNew(items) {
    const P = L.prefs || {}, fresh = items.filter((n) => !L.popped.has(n.id) && Date.now() - Date.parse(n.at || 0) < 6 * 3600e3);
    for (const n of items) L.popped.add(n.id);
    const show = fresh.filter((n) => MANDATORY(n) || (P.popups || {})[root.DPNotify.categoryOf(n)] !== false);
    if (!show.length || P.dnd && !show.some(MANDATORY)) return;
    // a burst (several at once) shows the most important one and a single summary, never a wall of pop-ups
    const rank = (n) => ({ urgent: 0, warning: 1, success: 2, info: 3 }[KIND(n)] ?? 3); show.sort((a, b) => rank(a) - rank(b));
    const w = wrap(), solo = show.length > 2 ? 1 : show.length; show.slice(0, solo).forEach((n) => toast(w, n)); if (show.length > solo) toast(w, { id: "more-" + Date.now(), title: `${show.length - solo} more notification(s)`, body: "Open the Notification Center to see them all.", type: "info", at: now(), _more: true });
  }
  function toast(w, n, { actions = null, sticky = false } = {}) {
    while (w.children.length >= 4) w.firstChild.remove();
    const k = n._kind || KIND(n), el = document.createElement("div"); el.className = `xt ${k}`; el.setAttribute("role", k === "urgent" ? "alert" : "status");
    const ref = n.ref || (n.link && n.link.opts && (n.link.opts.oid || n.link.opts.ref)) || "";
    el.innerHTML = `<span class="xt-i" aria-hidden="true">${ICON[n.type] || "•"}</span><div class="xt-b"><b></b><span class="xt-d"></span><small>${ref ? `<em>${esc(ref)}</em> · ` : ""}${esc(new Date(n.at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small>
      <div class="xt-a">${(actions || (n._more ? [["open", "Open all"]] : n.link || n.ref ? [["open", "Open"]] : [])).map(([a, l]) => `<button type="button" class="btn ${a === "open" || a === "done" ? "lime" : "ghost"} xs" data-a="${a}">${esc(l)}</button>`).join("")}</div></div><button type="button" class="xt-x" aria-label="Dismiss">✕</button>`;
    el.querySelector("b").textContent = n.title || ""; el.querySelector(".xt-d").textContent = n.body || "";
    const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 220); };
    el.querySelector(".xt-x").onclick = () => { close(); if (!n._more && !n._rem && root.DPNotify.N.items.some((x) => x.id === n.id)) DPNotify.markRead([n.id]).catch(() => {}); };
    el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { close(); if (n._onAction) return n._onAction(b.dataset.a); if (n._more) return DPShell.notifPanel(); if (root.DPShell.openNotif) DPShell.openNotif(n); }));
    if (n._rem) el.dataset.rem = n._remId || "";
    w.appendChild(el); requestAnimationFrame(() => el.classList.add("in"));
    // a reminder that stays on screen shrinks to a one-line chip after 20 s so it never covers the page's buttons for long
    if (sticky) { let mt = setTimeout(() => el.classList.add("mini"), 20000); el.onmouseenter = () => { clearTimeout(mt); el.classList.remove("mini"); }; el.onmouseleave = () => (mt = setTimeout(() => el.classList.add("mini"), 6000)); }
    if (!sticky && k !== "urgent") { let t = setTimeout(close, 8000); el.onmouseenter = () => clearTimeout(t); el.onmouseleave = () => (t = setTimeout(close, 4000)); }
    return el;
  }
  /* ---------------- preferences ---------------- */
  const PREF_PATH = () => `data/users/${me().id}/np`;
  async function loadPrefs() { L.prefs = (await DS().tryGet(PREF_PATH()).catch(() => null)) || { popups: {}, dnd: false }; return L.prefs; }
  async function savePrefs(p) { L.prefs = Object.assign({ popups: {}, dnd: false }, p, { at: now() }); await DS().set(PREF_PATH(), L.prefs); return L.prefs; }

  /* ---------------- reminders ---------------- */
  const REPEAT = { none: "Does not repeat", daily: "Every day", weekdays: "Every working day", weekly: "Every week", monthly: "Every month" };
  const PRIORITY = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
  const KINDS = { callback: "Customer callback", followup: "Sales follow-up", delivery: "Promised delivery date", factory: "Manufacturing update", collection: "Payment collection", supplier: "Supplier payment", approval: "Missing approval", maintenance: "Maintenance", other: "Other" };
  const remPath = (uid, id) => `rem/${uid}/r/${id}`;
  async function loadReminders(uid = me().id) { const l = (await DS().tryList(`rem/${uid}/r`)).map((x) => Object.assign({ id: x.id, uid }, x.data)); if (uid === me().id) { L.reminders = l; clearStale(); checkReminders(); } return l; }
  /** Remove the pop-up of a reminder that was completed, snoozed or cancelled (here or on another device). */
  function clearStale() { const w = document.getElementById("xf-toasts"); if (!w) return; for (const el of w.querySelectorAll(".xt[data-rem]")) { const r = L.reminders.find((x) => x.id === el.dataset.rem); if (!r || !isOverdue(r)) { el.classList.add("out"); setTimeout(() => el.remove(), 220); } } }
  const dueAt = (r) => r.snoozedUntil && r.snoozedUntil > r.due ? r.snoozedUntil : r.due;
  const isOverdue = (r) => r.status === "open" && dueAt(r) <= now();
  function nextDue(r) { const d = new Date(r.due), step = { daily: 1, weekly: 7 }[r.repeat];
    if (step) d.setDate(d.getDate() + step); else if (r.repeat === "monthly") d.setMonth(d.getMonth() + 1);
    else if (r.repeat === "weekdays") { do d.setDate(d.getDate() + 1); while (root.DPHol ? !DPHol.isWorkingDay(d.toISOString().slice(0, 10)) : [5, 6].includes(d.getDay())); }
    return d.toISOString(); }
  async function saveReminder(r) {
    const u = me(); if (!u.id || u.role === "viewer") throw new Error("View-only access cannot create reminders.");
    const uid = r.uid || u.id; if (uid !== u.id && !U().isAdmin()) throw new Error("Only an administrator can set a reminder for someone else.");
    if (!String(r.title || "").trim()) throw new Error("Give the reminder a title."); if (!r.due || isNaN(Date.parse(r.due))) throw new Error("Choose the date and time.");
    const id = r.id || "rm-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path = remPath(uid, id), prev = await DS().tryGet(path);
    const rec = Object.assign({}, prev || {}, { title: r.title.trim().slice(0, 160), notes: String(r.notes || "").slice(0, 1000), kind: KINDS[r.kind] ? r.kind : "other", ref: r.ref || (prev && prev.ref) || null, due: new Date(r.due).toISOString(),
      priority: PRIORITY[r.priority] ? r.priority : "normal", repeat: REPEAT[r.repeat] ? r.repeat : "none", status: (prev && prev.status) || "open", snoozedUntil: prev && prev.due !== new Date(r.due).toISOString() ? null : (prev && prev.snoozedUntil) || null,
      createdBy: (prev && prev.createdBy) || u.id, createdAt: (prev && prev.createdAt) || now(), updatedAt: now(), history: ((prev && prev.history) || []).concat([{ at: now(), by: u.id, action: prev ? (prev.due !== new Date(r.due).toISOString() ? `Rescheduled to ${new Date(r.due).toLocaleString()}` : "Edited") : "Created" }]).slice(-60) });
    await DS().set(path, rec);
    if (uid !== u.id) await DPNotify.deliver(uid, { id: `rem-new-${id}`, type: "reminder", title: "Reminder set for you", body: `${rec.title} — due ${new Date(rec.due).toLocaleString()}`, link: { view: "reminders" }, mandatory: true }).catch(() => {});
    if (uid === u.id) await loadReminders(); return Object.assign({ id, uid }, rec);
  }
  async function actOn(r, action, arg) {
    const path = remPath(r.uid || me().id, r.id), cur = await DS().get(path); if (!cur) throw new Error("Reminder not found."); const by = me().id;
    if (action === "done") { if (cur.repeat && cur.repeat !== "none") { cur.history.push({ at: now(), by, action: "Completed (repeats)" }); cur.due = nextDue(cur); cur.snoozedUntil = null; } else { cur.status = "done"; cur.doneAt = now(); cur.history.push({ at: now(), by, action: "Completed" }); } }
    else if (action === "snooze") { const mins = +arg || 15; cur.snoozedUntil = new Date(Date.now() + mins * 60000).toISOString(); cur.history.push({ at: now(), by, action: `Snoozed ${mins >= 1440 ? Math.round(mins / 1440) + " day(s)" : mins >= 60 ? Math.round(mins / 60) + " hour(s)" : mins + " min"}` }); }
    else if (action === "cancel") { cur.status = "cancelled"; cur.history.push({ at: now(), by, action: "Cancelled", detail: arg || "" }); }
    else if (action === "reopen") { cur.status = "open"; cur.history.push({ at: now(), by, action: "Reopened" }); }
    cur.history = cur.history.slice(-60); cur.updatedAt = now(); await DS().set(path, cur); await loadReminders(); return cur;
  }
  function checkReminders() {
    if (!me().id || !L.reminders) return; const w = wrap();
    for (const r of L.reminders.filter(isOverdue)) { const key = r.id + "|" + dueAt(r); if (L.remPopped.has(key)) continue; L.remPopped.add(key);
      toast(w, { id: "rem-" + key, _remId: r.id, type: "reminder", title: r.title, body: (r.notes || KINDS[r.kind] || "").slice(0, 140), ref: r.ref && r.ref.label, at: dueAt(r), _kind: r.priority === "urgent" ? "urgent" : "warning", _rem: true,
        _onAction: (a) => (a === "open" ? U().go("reminders") : actOn(r, a === "done" ? "done" : "snooze", a === "s15" ? 15 : a === "s60" ? 60 : 1440).catch((e) => U().toast(e.message, { err: true }))) },
      { actions: [["done", "Done"], ["s15", "15 min"], ["s60", "1 hour"], ["s1d", "Tomorrow"]], sticky: true }); }
  }
  root.DPLive = { L, VIEW_DEPS, start, stop, poll, on, popNew, toast: (n, o) => toast(wrap(), n, o), loadPrefs, savePrefs, REPEAT, PRIORITY, KINDS, loadReminders, saveReminder, actOn, isOverdue, dueAt, nextDue, softRefresh };
})(typeof self !== "undefined" ? self : this);
