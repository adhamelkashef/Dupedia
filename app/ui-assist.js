/* X FORCE 1.1 (Dupedia) — floating Sales Assistant (Dupedia mark, bottom right) with two tabs: Sales Pitches and Ask CEO.
   It opens over the current page without leaving it (the open project stays open). A red dot on the icon means an unread
   reply from the CEO; a lime dot means a plan-specific pitch is ready. The CEO (and administrators allowed in Settings)
   read and answer Ask CEO messages in the Ask CEO Inbox page, with an unread badge in the navigation. */
/* global DPUI, DPShell, DPStore, DPAuth, DPAskCeo, DPCoach, DPOrders */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U;
  const A = { tab: "pitch", open: false, unread: 0, tip: false, file: null, busy: false, unsub: null, timer: null, inbox: { sel: null, file: null } };
  const MARK = `<svg viewBox="0 0 880 825" aria-hidden="true" class="dmark"><path fill="#B8D241" d="M217 137 482 0 873 195v97L487 218 217 268zM217 557l270 49 386-74v98L482 825 217 687z"/><path fill="#B8D241" d="M88 370 482 300 640 330v170L482 525 88 460z"/><path fill="currentColor" d="M0 202h100c110 0 199 89 199 199S210 600 100 600H0z"/></svg>`;
  const fmt = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
  const pics = {}; async function pic(uid) { if (!pics[uid]) pics[uid] = await DPAuth.avatarUrl(uid).catch(() => DPAuth.initialsAvatar(DPAuth.nameSync(uid) || "?")); return pics[uid]; }
  const linkify = (t) => esc(t).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, "<br>");
  const eligible = () => ["employee", "admin"].includes(U.role()) && !!DPStore.st.userId;

  function init() {
    let b = $("#assist-fab");
    if (!b) { b = document.createElement("button"); b.id = "assist-fab"; b.type = "button"; b.className = "assist-fab"; b.setAttribute("aria-label", "Sales Assistant — pitches and Ask CEO"); b.title = "Sales Assistant: pitches and Ask CEO"; b.innerHTML = `${MARK}<i class="dot red" hidden></i><i class="dot tip" hidden></i>`; document.body.appendChild(b); b.onclick = () => (A.open ? close() : open()); }
    b.hidden = !eligible(); if (!eligible()) return;
    subscribe(); refresh();
  }
  function stop() { if (A.unsub) try { A.unsub(); } catch (e) {} A.unsub = null; clearInterval(A.timer); const b = $("#assist-fab"); if (b) b.hidden = true; close(); }
  /** Live updates of my own Ask CEO thread (database subscription where offered; polling every 30 s as fallback). */
  function subscribe() {
    if (A.unsub) return; const db = DPStore.st.db, uid = DPStore.st.userId;
    if (db && db.collection && uid) { try { A.unsub = db.collection(`askceo/${uid}/m`).onSnapshot(() => refresh(), () => {}); } catch (e) { A.unsub = null; } }
    clearInterval(A.timer); A.timer = setInterval(refresh, 30000);
  }
  let busyR = false;
  async function refresh() {
    if (busyR || !eligible()) return; busyR = true;
    try {
      const n = await DPAskCeo.unreadMine();
      A.unread = n; badge();
      if (A.open && A.tab === "ceo") { const box = $("#as-msgs"); if (box) await fill(box, DPStore.st.userId); }
    } catch (e) {} finally { busyR = false; }
  }
  function badge() { const b = $("#assist-fab"); if (!b) return; const n = A.unread || (U.isAdmin() && DPAskCeo.canReadInbox() ? DPAskCeo.inboxUnread() : 0);
    b.querySelector(".dot.red").hidden = !n; b.querySelector(".dot.tip").hidden = !A.tip || !!n; b.classList.toggle("has-unread", !!n); b.title = n ? `Sales Assistant — ${n} unread from ${U.isAdmin() && DPAskCeo.canReadInbox() ? "employees (Ask CEO)" : "the CEO"}` : "Sales Assistant: pitches and Ask CEO"; }
  function tip(on) { A.tip = !!on; badge(); }
  function open(tab) {
    if (tab) A.tab = tab; A.open = true;
    let p = $("#assist-panel"); if (!p) { p = document.createElement("aside"); p.id = "assist-panel"; p.className = "assist-panel"; p.setAttribute("aria-label", "Sales Assistant"); document.body.appendChild(p); }
    p.hidden = false; draw(p); $("#assist-fab").classList.add("is-open");
  }
  function close() { A.open = false; const p = $("#assist-panel"); if (p) p.hidden = true; const b = $("#assist-fab"); if (b) b.classList.remove("is-open"); }
  function draw(p) {
    const admin = U.isAdmin(), inbox = admin && DPAskCeo.canReadInbox();
    p.innerHTML = `<div class="as-head"><div class="row" style="gap:8px">${MARK}<b>Sales Assistant</b></div><button class="btn ghost xs" id="as-x" aria-label="Close the assistant">✕</button></div>
      <div class="seg as-tabs" role="tablist"><button type="button" data-t="pitch" class="${A.tab === "pitch" ? "is-on" : ""}">Sales Pitches${A.tip ? ' <i class="mini lime"></i>' : ""}</button><button type="button" data-t="ceo" class="${A.tab === "ceo" ? "is-on" : ""}">${inbox ? "CEO Inbox" : "Ask CEO"}${A.unread ? ` <em>${A.unread}</em>` : ""}</button></div>
      <div class="as-body" id="as-body"></div>`;
    $("#as-x", p).onclick = close;
    $$("[data-t]", p).forEach((b) => (b.onclick = () => { A.tab = b.dataset.t; draw(p); }));
    const body = $("#as-body", p);
    if (A.tab === "pitch") return DPCoach.renderInto(body);
    if (inbox) { body.innerHTML = `<p class="small">You are the CEO in this channel. Conversations with employees are in the Ask CEO Inbox.</p><button class="btn lime sm" id="as-inbox">Open the Ask CEO Inbox${DPAskCeo.inboxUnread() ? ` (${DPAskCeo.inboxUnread()} unread)` : ""}</button>`; $("#as-inbox", body).onclick = () => { close(); U.go("askceo"); }; return; }
    askTab(body);
  }
  async function askTab(body) {
    const uid = DPStore.st.userId, ceo = DPAskCeo.ceoUid();
    if (!ceo) { body.innerHTML = `<div class="note warn small">No CEO account is set up yet. An administrator chooses it in Admin › Settings › Ask CEO.</div>`; return; }
    body.innerHTML = `<div class="row as-who"><img class="pic" alt="" width="34" height="34" src="${esc(await pic(ceo))}"><div><b>${esc(DPAskCeo.ceoName())}</b><div class="tiny muted">Private: only you and the CEO's office can read this. Never posted to the wall.</div></div></div>
      <div class="msgs" id="as-msgs"><div class="empty small"><div class="spinner"></div></div></div>${composer("as")}`;
    await fill($("#as-msgs", body), uid);
    bindComposer(body, "as", (text, file) => DPAskCeo.send(uid, text, file), () => fill($("#as-msgs", body), uid, true));
  }
  async function fill(box, uid, force) {
    const me = DPStore.st.userId, list = await DPAskCeo.load(uid), sig = list.map((m) => m.id).join("|");
    if (box.dataset.sig === sig && !force) return; box.dataset.sig = sig;
    if (!list.length) box.innerHTML = `<div class="empty small">${me === uid ? "Ask the CEO anything about a deal, a price exception or a client. Your current page stays open." : "No messages."}</div>`;
    else {
      const frag = document.createDocumentFragment();
      for (const m of list) { const mine = m.from === me, el = document.createElement("div"); el.className = "msg" + (mine ? " mine" : "");
        el.innerHTML = `<img class="pic" alt="" width="30" height="30" src="${esc(await pic(m.from))}"><div class="bub"><div class="mh"><b></b><small>${esc(fmt(m.at))}</small></div><div class="mt"></div>${m.file ? `<button class="att">${U.svg("clip")} <span></span></button>` : ""}</div>`;
        el.querySelector(".mh b").textContent = mine ? "You" : DPAuth.nameSync(m.from) || "—"; el.querySelector(".mt").innerHTML = linkify(m.text || "");
        if (m.file) { el.querySelector(".att span").textContent = `${m.file.name} · ${Math.round((m.file.size || 0) / 1024)} kB`; el.querySelector(".att").onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { DPUI.showFile(await DPAskCeo.file(uid, m), "Attachment"); } finally { b.disabled = false; } }; }
        frag.appendChild(el); }
      box.innerHTML = ""; box.appendChild(frag); box.scrollTop = box.scrollHeight;
    }
    const side = me === uid ? "emp" : "ceo"; await DPAskCeo.markRead(uid, side);
    if (side === "emp") { A.unread = 0; badge(); const t = $('#assist-panel [data-t="ceo"] em'); if (t) t.remove(); }
  }
  function composer(k) { return `<form class="composer" id="${k}-form"><div id="${k}-att" class="tiny muted" hidden></div><div class="row" style="flex-wrap:nowrap;align-items:flex-end"><button type="button" class="btn ghost sm" id="${k}-file" title="Attach a file (JPG, PNG, WebP or PDF, max 6 MB)" aria-label="Attach a file">${U.svg("clip")}</button>
    <textarea class="in" id="${k}-text" rows="2" placeholder="Write to the CEO… (Enter to send, Shift+Enter for a new line)" maxlength="${DPAskCeo.MAXLEN}"></textarea><button class="btn lime sm" id="${k}-send" aria-label="Send">${U.svg("send")}</button></div><p class="tiny" id="${k}-err" style="color:var(--red)"></p></form>`; }
  function bindComposer(body, k, sendFn, after) {
    const f = $(`#${k}-form`, body); if (!f) return; const ta = $(`#${k}-text`, f), att = $(`#${k}-att`, f), err = $(`#${k}-err`, f), st = { file: null, busy: false };
    if (k !== "as") ta.placeholder = "Reply… (Enter to send, Shift+Enter for a new line)";
    const showAtt = () => { att.hidden = !st.file; att.innerHTML = st.file ? `Attached: <b></b> <button type="button" class="linkbtn">remove</button>` : ""; if (st.file) { att.querySelector("b").textContent = st.file.name; att.querySelector("button").onclick = () => { st.file = null; showAtt(); }; } };
    $(`#${k}-file`, f).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (file) => { err.textContent = ""; try { st.file = await DPOrders.prepareFile(file); showAtt(); } catch (e) { err.textContent = e.message; } });
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => { e.preventDefault(); if (st.busy) return; err.textContent = ""; const text = ta.value; if (!text.trim() && !st.file) return;
      const btn = $(`#${k}-send`, f); st.busy = true; btn.disabled = true; btn.textContent = st.file ? "Uploading…" : "Sending…";
      try { await sendFn(text, st.file); st.file = null; showAtt(); ta.value = ""; after && (await after()); } catch (x) { err.textContent = x.message || "Not sent."; } finally { st.busy = false; btn.disabled = false; btn.innerHTML = U.svg("send"); } };
    setTimeout(() => ta.focus(), 30);
  }

  /* ---------------- CEO inbox page ---------------- */
  async function renderInbox(opts = {}) {
    const V = $("#view-askceo");
    if (!DPAskCeo.canReadInbox()) { V.innerHTML = `<div class="page"><div class="card note">The Ask CEO Inbox is for the CEO and the administrators named in Settings › Ask CEO.</div></div>`; return; }
    if (opts.uid) A.inbox.sel = opts.uid;
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Private channel</span><h1>Ask CEO <em>Inbox</em></h1><p class="lead small">Questions sent by employees from the Sales Assistant. Private to each employee and the CEO's office — never on the wall.</p></div></div>
      <div class="card inbox2"><div class="ib-list" id="ib-list"><div class="empty small"><div class="spinner"></div></div></div><div class="ib-conv" id="ib-conv"><div class="empty small">Choose a conversation.</div></div></div></div>`;
    await list();
    if (A.inbox.sel) conv(A.inbox.sel);
  }
  async function list() {
    const box = $("#ib-list"); if (!box) return; const th = await DPAskCeo.threads();
    App.badges = Object.assign(App.badges || {}, { askceo: DPAskCeo.inboxUnread() }); root.DPShell && DPShell.rail();
    if (!th.length) { box.innerHTML = `<div class="empty small">No questions yet.</div>`; return; }
    box.innerHTML = ""; for (const t of th) { const b = document.createElement("button"); b.type = "button"; b.className = "pperson" + (A.inbox.sel === t.uid ? " is-on" : "");
      b.innerHTML = `<img class="pic" alt="" width="34" height="34" src="${esc(await pic(t.uid))}"><span><b></b><small></small></span>${t.unread ? `<em>${t.unread}</em>` : ""}`;
      b.querySelector("b").textContent = t.name; b.querySelector("small").textContent = `${fmt(t.last.at)} · ${(t.last.text || (t.last.file ? "Attachment" : "")).slice(0, 60)}`;
      b.onclick = () => { A.inbox.sel = t.uid; $$(".pperson", box).forEach((x) => x.classList.remove("is-on")); b.classList.add("is-on"); conv(t.uid); }; box.appendChild(b); }
  }
  async function conv(uid) {
    const box = $("#ib-conv"); if (!box) return;
    box.innerHTML = `<div class="row between" style="padding:4px 0 8px"><div class="row" style="gap:8px"><img class="pic" alt="" width="30" height="30" src="${esc(await pic(uid))}"><b>${esc(DPAuth.nameSync(uid) || "Employee")}</b></div><span class="tiny muted">Private conversation</span></div>
      <div class="msgs" id="ib-msgs"><div class="empty small"><div class="spinner"></div></div></div>${composer("ib")}`;
    await fill($("#ib-msgs", box), uid, true); list();
    bindComposer(box, "ib", (text, file) => DPAskCeo.send(uid, text, file), () => fill($("#ib-msgs", box), uid, true));
  }
  /** CEO side: refresh the inbox badge (called from the shell's loop). */
  async function refreshInbox() {
    if (!U.isAdmin() || !DPAskCeo.canReadInbox()) return 0; await DPAskCeo.threads().catch(() => []); const n = DPAskCeo.inboxUnread();
    const changed = (App.badges || {}).askceo !== n; App.badges = Object.assign(App.badges || {}, { askceo: n });
    badge(); if (changed && root.DPShell) DPShell.rail();
    if (App.view === "askceo") { await list(); if (A.inbox.sel) { const m = $("#ib-msgs"); if (m) fill(m, A.inbox.sel); } }
    return n;
  }
  U.register("askceo", renderInbox);
  root.DPAssist = { init, stop, open, close, tip, refresh, refreshInbox, MARK, state: A };
})(typeof self !== "undefined" ? self : this);
