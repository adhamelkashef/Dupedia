/* X FORCE 1.0 (Dupedia) — messaging UI: a compact side panel available on every page (expands to the Messages page),
   with the Company Wall and private conversations. Data and encryption live in chat.js. */
/* global DPUI, DPShell, DPStore, DPAuth, DPChat, DPOrders */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U;
  const S = { tab: "dm", dm: null, q: "", panel: null, pics: {}, file: null, busy: false };
  const SYS_PIC = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#262626"/><path d="M18 22h10l8 10-8 10H18l8-10z" fill="#B8D241"/><path d="M34 22h12l-8 10 8 10H34l8-10z" fill="#fff"/></svg>`);
  async function pic(uid) { if (uid === "system") return SYS_PIC; if (!S.pics[uid]) S.pics[uid] = await DPAuth.avatarUrl(uid).catch(() => DPAuth.initialsAvatar(DPAuth.nameSync(uid) || "?")); return S.pics[uid]; }
  const fmt = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
  const linkify = (t) => esc(t).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, "<br>");

  function init() {
    const b = $("#btn-chat"); if (!b) return;
    b.hidden = !DPStore.st.userId || U.role() === "viewer";
    b.onclick = () => (S.panel ? close() : open());
    DPChat.on(() => { badge(); const h = S.panel || (App.view === "messages" ? $("#msg-host") : null); if (h) update(h); });
    DPChat.start().catch((e) => console.warn("chat", e));
  }
  function badge() { const u = DPChat.unread(), e = $("#chat-n"); if (e) { e.hidden = !u.total; e.textContent = u.total > 99 ? "99+" : String(u.total); } App.badges = App.badges || {}; App.badges.messages = u.total || 0; }
  function open(opts = {}) {
    if (opts.dm) { S.tab = "dm"; S.dm = opts.dm; }
    if (App.view === "messages") { const c = $("#msg-host"); if (c) draw(c); return; }
    let p = $("#chatpanel"); if (!p) { p = document.createElement("aside"); p.id = "chatpanel"; p.className = "chatpanel"; p.setAttribute("aria-label", "Messages"); document.body.appendChild(p); }
    S.panel = p; p.hidden = false; DPChat.setOpen(true); draw(p); DPChat.refresh().catch(() => {});
  }
  function close() { if (S.panel) { S.panel.hidden = true; S.panel = null; } DPChat.setOpen(false); const b = $("#btn-chat"); b && b.focus(); }

  /** Live update without touching the composer (so typing is never interrupted). */
  let upd = false;
  async function update(host) {
    if (upd) return; upd = true;
    try {
      const u = DPChat.unread(); const tw = $('[data-tab="wall"]', host), td = $('[data-tab="dm"]', host);
      if (tw) tw.innerHTML = `Company Wall${u.wall && S.tab !== "wall" ? ` <em>${u.wall}</em>` : ""}`; if (td) td.innerHTML = `Private messages${u.dm ? ` <em>${u.dm}</em>` : ""}`;
      const box = $("#ch-msgs", host);
      if (box && S.tab === "wall") await fillWall(box);
      else if (box && S.dm) await fillConv(box, S.dm);
      else if (S.tab === "dm" && !S.dm && $("#ch-pl", host) && document.activeElement !== $("#ch-q", host)) { const b = $("#ch-body", host); if (b) await peopleList(b); }
    } finally { upd = false; }
  }
  async function draw(host) {
    const full = host.id === "msg-host", u = DPChat.unread(), cryptoOk = DPChat.CH.cryptoOk;
    host.innerHTML = `<div class="chat ${full ? "full" : ""}"><div class="chat-head"><div class="seg" role="tablist"><button type="button" data-tab="dm" class="${S.tab === "dm" ? "is-on" : ""}">Private messages${u.dm ? ` <em>${u.dm}</em>` : ""}</button><button type="button" data-tab="wall" class="${S.tab === "wall" ? "is-on" : ""}">Company Wall${u.wall ? ` <em>${u.wall}</em>` : ""}</button></div>
      <div class="row">${full ? "" : `<button class="btn ghost xs" id="ch-exp" title="Open the Messages page">Expand</button><button class="btn ghost xs" id="ch-x" aria-label="Close messages">✕</button>`}</div></div>
      <div class="chat-body" id="ch-body"></div></div>`;
    $$("[data-tab]", host).forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; draw(host); }));
    const x = $("#ch-x", host); if (x) x.onclick = close;
    const ex = $("#ch-exp", host); if (ex) ex.onclick = () => { close(); U.go("messages"); };
    const body = $("#ch-body", host);
    if (S.tab === "wall") return wall(body);
    if (!cryptoOk) { body.innerHTML = `<div class="note warn small">Private chat needs the browser's encryption support, which is not available here. The Company Wall still works.</div>`; return; }
    if (!S.dm) return peopleList(body);
    return conversation(body, S.dm);
  }

  /* ---------------- wall ---------------- */
  async function wall(body) {
    body.innerHTML = `<div class="msgs" id="ch-msgs" aria-live="polite"></div>${composer()}`;
    await fillWall($("#ch-msgs", body));
    bindComposer(body, (text, file) => DPChat.post(text, file));
  }
  async function fillWall(box) {
    const me = DPStore.st.userId, list = DPChat.CH.wall.slice(-120), sig = list.map((m) => m.id).join("|");
    if (box.dataset.sig === sig) return; box.dataset.sig = sig;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60, frag = document.createDocumentFragment();
    if (!list.length) { box.innerHTML = `<div class="empty small">No posts yet. Say hello to the team.</div>`; return; }
    for (const m of list) {
      const sys = !!m.system, mine = !sys && m.author === me, name = sys ? DPChat.SYSTEM.name : DPAuth.nameSync(m.author) || "Colleague";
      const el = document.createElement("div"); el.className = "msg" + (mine ? " mine" : "") + (sys ? " sys" : "");
      el.innerHTML = `<img class="pic" alt="" width="30" height="30" src="${esc(await pic(sys ? "system" : m.author))}"><div class="bub"><div class="mh"><b></b><small>${esc(fmt(m.at))}${sys ? " · automated" : ""}</small></div><div class="mt"></div>${m.file ? `<button class="att" data-f="${esc(m.id)}">${U.svg("clip")} <span></span></button>` : ""}${sys && m.link && m.link.view && U.allowedView(m.link.view) ? `<button class="linkbtn small" data-go="${esc(m.id)}">Open the record →</button>` : ""}</div>`;
      el.querySelector(".mh b").textContent = name; el.querySelector(".mt").innerHTML = linkify(m.text || "");
      if (m.file) el.querySelector(".att span").textContent = `${m.file.name} · ${Math.round((m.file.size || 0) / 1024)} kB`;
      frag.appendChild(el);
      const fb = el.querySelector("[data-f]"); if (fb) fb.onclick = async () => { fb.disabled = true; try { DPUI.showFile(await DPChat.wallFile(m), "Attachment"); } finally { fb.disabled = false; } };
      const gb = el.querySelector("[data-go]"); if (gb) gb.onclick = () => { close(); U.go(m.link.view, m.link.opts || {}); };
    }
    box.innerHTML = ""; box.appendChild(frag); if (atEnd || !box.dataset.done) box.scrollTop = box.scrollHeight; box.dataset.done = "1";
    if (DPChat.unread().wall) DPChat.markRead("wall");
  }
  /* ---------------- private ---------------- */
  async function peopleList(body) {
    body.innerHTML = `<div class="search" style="margin:8px 0"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="ch-q" placeholder="Search colleagues" value="${esc(S.q)}"></div><div class="plist2" id="ch-pl"><div class="empty small"><div class="spinner"></div></div></div>
      <p class="tiny muted">Private messages are end-to-end encrypted: only you and the colleague can read them.</p>`;
    const ps = await DPChat.people(), u = DPChat.unread(), q = () => S.q.trim().toLowerCase();
    const drawList = async () => { const box = $("#ch-pl", body); if (!box) return; const rows = ps.filter((p) => !q() || [p.name, p.title].join(" ").toLowerCase().includes(q()));
      box.innerHTML = ""; if (!rows.length) { box.innerHTML = `<div class="empty small">No colleagues found.</div>`; return; }
      for (const p of rows) { const b = document.createElement("button"); b.type = "button"; b.className = "pperson";
        b.innerHTML = `<img class="pic" alt="" width="34" height="34" src="${esc(await pic(p.uid))}"><span><b></b><small></small></span>${u.dms[p.uid] ? `<em>${u.dms[p.uid]}</em>` : p.hasKey ? "" : `<span class="tiny muted">not signed in yet</span>`}`;
        b.querySelector("b").textContent = p.name; b.querySelector("small").textContent = p.title; b.onclick = () => { S.dm = p.uid; draw(body.closest(".chatpanel, #msg-host")); }; box.appendChild(b); } };
    $("#ch-q", body).oninput = (e) => { S.q = e.target.value; drawList(); }; drawList();
  }
  async function conversation(body, other) {
    const me = DPStore.st.userId, name = DPAuth.nameSync(other) || "Colleague";
    body.innerHTML = `<div class="row between" style="padding:6px 0"><button class="linkbtn small" id="ch-back">← All colleagues</button><b class="small">${esc(name)}</b></div><div class="msgs" id="ch-msgs"><div class="empty small"><div class="spinner"></div></div></div>${composer()}`;
    $("#ch-back", body).onclick = () => { S.dm = null; draw(body.closest(".chatpanel, #msg-host")); };
    if (!(await DPChat.hasKey(other))) { $("#ch-msgs", body).innerHTML = `<div class="note small">${esc(name)} has not opened X FORCE yet, so a private conversation cannot be started. Try again after they sign in.</div>`; $(".composer", body).hidden = true; return; }
    await fillConv($("#ch-msgs", body), other);
    bindComposer(body, (text, file) => DPChat.send(other, text, file));
  }
  async function fillConv(box, other) {
    const me = DPStore.st.userId, name = DPAuth.nameSync(other) || "Colleague", c = DPChat.CH.convs[other] || (await DPChat.loadConv(other)), list = (c && c.list) || [], sig = list.map((m) => m.id).join("|");
    if (box.dataset.sig === sig) return; box.dataset.sig = sig;
    if (!list.length) { box.innerHTML = `<div class="empty small">No messages yet.</div>`; return; }
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60, frag = document.createDocumentFragment();
    for (const m of list) {
      const mine = m.from === me, el = document.createElement("div"); el.className = "msg" + (mine ? " mine" : "");
      el.innerHTML = `<img class="pic" alt="" width="30" height="30" src="${esc(await pic(m.from))}"><div class="bub"><div class="mh"><b></b><small>${esc(fmt(m.at))}</small></div><div class="mt"></div>${m.file ? `<button class="att">${U.svg("clip")} <span></span></button>` : ""}</div>`;
      el.querySelector(".mh b").textContent = mine ? "You" : name; el.querySelector(".mt").innerHTML = linkify(m.text || "");
      if (m.file) { el.querySelector(".att span").textContent = `${m.file.name} · ${Math.round((m.file.size || 0) / 1024)} kB`; el.querySelector(".att").onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { DPUI.showFile(await DPChat.dmFile(other, m.file), "Attachment"); } finally { b.disabled = false; } }; }
      frag.appendChild(el);
    }
    box.innerHTML = ""; box.appendChild(frag); if (atEnd || !box.dataset.done) box.scrollTop = box.scrollHeight; box.dataset.done = "1";
    if (DPChat.unread().dms[other]) DPChat.markRead("dm:" + other);
  }
  /* ---------------- composer ---------------- */
  function composer() { return `<form class="composer" id="ch-form"><div id="ch-att" class="tiny muted" hidden></div><div class="row" style="flex-wrap:nowrap;align-items:flex-end"><button type="button" class="btn ghost sm" id="ch-file" title="Attach a file (JPG, PNG, WebP or PDF, max 6 MB)" aria-label="Attach a file">${U.svg("clip")}</button>
    <textarea class="in" id="ch-text" rows="2" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" maxlength="4000"></textarea><button class="btn lime sm" id="ch-send" aria-label="Send">${U.svg("send")}</button></div><p class="tiny" id="ch-err" style="color:var(--red)"></p></form>`; }
  function bindComposer(body, sendFn) {
    const f = $("#ch-form", body); if (!f) return; const ta = $("#ch-text", f), att = $("#ch-att", f), err = $("#ch-err", f);
    const showAtt = () => { att.hidden = !S.file; att.innerHTML = S.file ? `Attached: <b></b> <button type="button" class="linkbtn" id="ch-rm">remove</button>` : ""; if (S.file) { att.querySelector("b").textContent = S.file.name; $("#ch-rm", att).onclick = () => { S.file = null; showAtt(); }; } };
    showAtt();
    $("#ch-file", f).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (file) => { err.textContent = ""; try { S.file = await DPOrders.prepareFile(file); showAtt(); } catch (e) { err.textContent = e.message; } });
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => { e.preventDefault(); if (S.busy) return; err.textContent = ""; const text = ta.value; if (!text.trim() && !S.file) return;
      const btn = $("#ch-send", f); S.busy = true; btn.disabled = true; btn.textContent = S.file ? "Uploading…" : "Sending…";
      try { await sendFn(text, S.file); S.file = null; ta.value = ""; } catch (x) { err.textContent = x.message || "Not sent."; } finally { S.busy = false; btn.disabled = false; btn.innerHTML = U.svg("send"); } };
    setTimeout(() => ta.focus(), 30);
  }
  /* ---------------- full page ---------------- */
  function renderMessages(opts = {}) {
    if (opts.dm) { S.tab = "dm"; S.dm = opts.dm; }
    $("#view-messages").innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Messages</span><h1>Company <em>chat</em></h1><p class="lead small">Private conversations with any colleague, and the Company Wall for team-wide news (new leads, deals closed, milestones) from <b>Dupedia Updates</b>.</p></div></div><div class="card" id="msg-host" style="padding:12px"></div></div>`;
    draw($("#msg-host")); DPChat.setOpen(true); DPChat.refresh().catch(() => {});
  }
  U.register("messages", renderMessages);
  root.DPChatUI = { init, open, close, badge };
})(typeof self !== "undefined" ? self : this);
