/* X FORCE 1.4.6 (Dupedia) — messaging UI, redesigned: one conversation list (Company Wall, groups, colleagues; pinned first,
   search, unread badges, "active now" where people allow it) and a conversation screen with day separators, grouped bubbles,
   replies, emoji reactions, edit/delete of your own messages, image and document attachments, real read receipts, paging
   ("Load earlier messages"), offline and error states. A compact side panel on every page; the Messages page shows both panes.
   Data and encryption live in chat.js — this file only presents them. */
/* global DPUI, DPShell, DPStore, DPAuth, DPChat, DPOrders */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U;
  const S = { sel: null, q: "", panel: null, pics: {}, file: null, busy: false, reply: null, editing: null, seen: new Set(), host: null, imgs: {}, menu: null, lastSig: {} };
  const QUICK = ["👍", "❤️", "😂", "🎉", "👏", "🔥"], EMOJI = ["😀", "😄", "😂", "😊", "😍", "🤝", "👍", "👏", "🙏", "🎉", "🔥", "💪", "✅", "📌", "📎", "📞", "🚚", "🏗️", "🛝", "🎢", "💧", "⭐", "❤️", "👀"];
  const SYS_PIC = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#262626"/><path d="M18 22h10l8 10-8 10H18l8-10z" fill="#B8D241"/><path d="M34 22h12l-8 10 8 10H34l8-10z" fill="#fff"/></svg>`);
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function pic(uid) { if (uid === "system") return SYS_PIC; if (!S.pics[uid]) S.pics[uid] = await DPAuth.avatarUrl(uid).catch(() => DPAuth.initialsAvatar(DPAuth.nameSync(uid) || "?")); return S.pics[uid]; }
  const me = () => DPStore.st.userId;
  const nameOf = (uid) => (uid === me() ? "You" : DPAuth.nameSync(uid) || "Colleague");
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const when = (iso) => { if (!iso) return ""; const d = new Date(iso), t = new Date(); if (d.toDateString() === t.toDateString()) return time(iso); const y = new Date(t); y.setDate(t.getDate() - 1); if (d.toDateString() === y.toDateString()) return "Yesterday"; return Math.abs(t - d) < 6 * 864e5 ? d.toLocaleDateString([], { weekday: "short" }) : d.toLocaleDateString([], { day: "numeric", month: "short" }); };
  const dayLabel = (iso) => { const d = new Date(iso), t = new Date(), y = new Date(t); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" }); };
  const linkify = (t) => esc(t).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, "<br>");
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(iso); };
  const initials = (n) => String(n || "?").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  const groupPic = (name) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="#B8D241"/><path d="M44 0h20v20A20 20 0 0 1 44 0z" fill="#262626" opacity=".85"/><text x="32" y="40" font-family="Arial" font-weight="700" font-size="22" text-anchor="middle" fill="#262626">${initials(name).replace(/[<&>]/g, "")}</text></svg>`);

  function init() {
    const b = $("#btn-chat"); if (!b) return;
    b.hidden = !DPStore.st.userId || U.role() === "viewer";
    b.onclick = () => (S.panel ? close() : open());
    DPChat.on(() => { badge(); const h = S.panel || (App.view === "messages" ? $("#msg-host") : null); if (h) update(h); });
    DPChat.start().catch((e) => console.warn("chat", e));
  }
  function badge() { const u = DPChat.unread(), e = $("#chat-n"); if (e) { e.hidden = !u.total; e.textContent = u.total > 99 ? "99+" : String(u.total); } App.badges = App.badges || {}; App.badges.messages = u.total || 0; }
  function open(opts = {}) {
    if (opts.dm) S.sel = String(opts.dm).startsWith("dm:") ? opts.dm.slice(3) : opts.dm;
    if (App.view === "messages") { const c = $("#msg-host"); if (c) draw(c); return; }
    let p = $("#chatpanel"); if (!p) { p = document.createElement("aside"); p.id = "chatpanel"; p.className = "chatpanel xc-panel"; p.setAttribute("aria-label", "Messages"); document.body.appendChild(p); }
    S.panel = p; p.hidden = false; DPChat.setOpen(true); draw(p); DPChat.refresh().catch(() => {});
  }
  function close() { if (S.panel) { S.panel.hidden = true; S.panel = null; } DPChat.setOpen(false); const b = $("#btn-chat"); b && b.focus(); }

  /* ---------------- conversations list model ---------------- */
  async function model() {
    const ps = await DPChat.people().catch(() => []), u = DPChat.unread(), pinned = new Set(DPChat.CH.prefs.pinned || []), out = [];
    const last = (list) => { for (let i = list.length - 1; i >= 0; i--) if (!list[i].deleted || i === list.length - 1) return list[i]; return null; };
    const wl = last(DPChat.CH.wall);
    out.push({ key: "wall", kind: "wall", name: "Company Wall", sub: "Everyone at Dupedia", pic: SYS_PIC, last: wl, unread: u.wall, pinned: true, fixed: true });
    for (const [gid, g] of Object.entries(DPChat.CH.groups)) if (!g.left) { const c = DPChat.CH.convs["g:" + gid]; out.push({ key: "g:" + gid, kind: "group", name: g.name, sub: `${(g.members || []).length} members`, pic: groupPic(g.name), last: c ? last(c.list) : null, unread: u.dms["g:" + gid] || 0, pinned: pinned.has("g:" + gid) }); }
    for (const p of ps) { const c = DPChat.CH.convs[p.uid]; out.push({ key: p.uid, kind: "dm", name: p.name, sub: p.title, uid: p.uid, hasKey: p.hasKey, last: c ? last(c.list) : null, unread: u.dms[p.uid] || 0, pinned: pinned.has(p.uid), pres: DPChat.presenceOf(p.uid) }); }
    return out;
  }
  const preview = (it) => { const m = it.last; if (!m) return it.kind === "dm" ? (it.hasKey ? "Start a conversation" : "Not signed in to X FORCE yet") : it.sub;
    const who = m.from === me() ? "You: " : it.kind !== "dm" && !m.system && !m.sys ? (DPAuth.nameSync(m.from) || "").split(" ")[0] + ": " : "";
    return who + (m.deleted ? "Message deleted" : m.text ? m.text : m.file ? "📎 " + m.file.name : ""); };

  /* ---------------- drawing ---------------- */
  async function draw(host) {
    S.host = host; const full = host.id === "msg-host", theme = DPChat.CH.prefs.theme || "lime";
    host.innerHTML = `<div class="xc ${full ? "xc-full" : "xc-one"}" data-theme="${esc(theme)}" data-pane="${S.sel ? "conv" : "list"}">
      <section class="xc-side" aria-label="Conversations"><div class="xc-sh"><h2>Messages</h2><div class="xc-acts">
          <button class="xc-ib" id="xc-new" title="New group" aria-label="New group chat">${U.svg("plus")}</button><button class="xc-ib" id="xc-set" title="Chat settings" aria-label="Chat settings" aria-haspopup="true">⋯</button>
          ${full ? "" : `<button class="xc-ib" id="xc-exp" title="Open the Messages page" aria-label="Open the Messages page">⤢</button><button class="xc-ib" id="xc-x" aria-label="Close messages">✕</button>`}</div></div>
        <label class="xc-search"><svg viewBox="0 0 24 24" aria-hidden="true">${U.ICON.search}</svg><input id="xc-q" type="search" placeholder="Search people, groups and messages" value="${esc(S.q)}" autocomplete="off"></label>
        <div class="xc-net" id="xc-net" hidden></div><div class="xc-list" id="xc-list" role="list"><div class="xc-skel"></div><div class="xc-skel"></div><div class="xc-skel"></div></div></section>
      <section class="xc-main" id="xc-main" aria-label="Conversation">${S.sel ? "" : `<div class="xc-empty"><div class="xc-blk"></div><h3>Pick a conversation</h3><p class="small muted">Private messages are end-to-end encrypted: only the people in a conversation can read it.</p></div>`}</section></div>`;
    $("#xc-new", host).onclick = newGroup; $("#xc-set", host).onclick = (e) => settings(e.currentTarget);
    const x = $("#xc-x", host); if (x) x.onclick = close;
    const ex = $("#xc-exp", host); if (ex) ex.onclick = () => { close(); U.go("messages"); };
    $("#xc-q", host).oninput = (e) => { S.q = e.target.value; drawList(host); };
    net(host); await drawList(host);
    if (S.sel) await openConv(host, S.sel);
  }
  function net(host) {
    const n = $("#xc-net", host); if (!n) return; const CH = DPChat.CH;
    n.hidden = CH.online && !CH.lastErr; n.className = "xc-net" + (CH.online ? " err" : "");
    n.textContent = !CH.online ? "You're offline. New messages will appear when the connection returns." : CH.lastErr ? "Messages could not be refreshed. Retrying…" : "";
  }
  async function drawList(host) {
    const box = $("#xc-list", host); if (!box) return;
    const items = await model(), q = S.q.trim().toLowerCase();
    const match = (it) => { if (!q) return true; if ((it.name + " " + (it.sub || "")).toLowerCase().includes(q)) return true; const c = DPChat.convOf(it.key); return !!(c && c.list.some((m) => !m.deleted && String(m.text || "").toLowerCase().includes(q))); };
    const hit = (it) => { if (!q) return ""; const c = DPChat.convOf(it.key); const m = c && [...c.list].reverse().find((x) => !x.deleted && String(x.text || "").toLowerCase().includes(q)); return m ? m.text : ""; };
    const rows = items.filter(match), active = rows.filter((it) => it.fixed || it.pinned || it.last || it.kind === "group"), rest = rows.filter((it) => !active.includes(it));
    active.sort((a, b) => (+!!b.fixed - +!!a.fixed) || (+!!b.pinned - +!!a.pinned) || String((b.last || {}).at || "").localeCompare(String((a.last || {}).at || "")));
    rest.sort((a, b) => a.name.localeCompare(b.name));
    const row = async (it) => { const h = hit(it), pr = it.pres;
      return `<button type="button" class="xc-it${it.key === S.sel ? " is-on" : ""}${it.unread ? " unread" : ""}" data-k="${esc(it.key)}" role="listitem" aria-label="${esc(it.name)}${it.unread ? `, ${it.unread} unread` : ""}">
        <span class="xc-av"><img alt="" src="${esc(it.pic || (await pic(it.uid)))}" width="42" height="42">${pr && pr.now ? '<i class="xc-on" title="Active now"></i>' : ""}</span>
        <span class="xc-tx"><span class="xc-l1"><b>${esc(it.name)}</b>${it.pinned && !it.fixed ? '<span class="xc-pin" title="Pinned">📌</span>' : ""}<small>${esc(it.last ? when(it.last.at) : "")}</small></span>
          <span class="xc-l2"><span>${esc(h || preview(it))}</span>${it.unread ? `<em>${it.unread > 99 ? "99+" : it.unread}</em>` : ""}</span></span></button>`; };
    let html = (await Promise.all(active.map(row))).join("");
    if (rest.length) html += `<div class="xc-lh">Colleagues</div>` + (await Promise.all(rest.map(row))).join("");
    if (!rows.length) html = `<div class="xc-none">No conversation matches “${esc(S.q)}”.</div>`;
    box.innerHTML = html;
    $$(".xc-it", box).forEach((b) => (b.onclick = () => { S.sel = b.dataset.k; S.reply = null; S.editing = null; const x = b.closest(".xc"); x.dataset.pane = "conv"; $$(".xc-it", box).forEach((y) => y.classList.toggle("is-on", y === b)); openConv(S.host, S.sel); }));
  }

  /* ---------------- one conversation ---------------- */
  async function head(key) {
    if (key === "wall") return { name: "Company Wall", sub: "Team-wide news and Dupedia Updates", pic: SYS_PIC };
    if (key.startsWith("g:")) { const g = DPChat.CH.groups[key.slice(2)] || {}; return { name: g.name || "Group", sub: (g.members || []).map((u) => nameOf(u)).join(", "), pic: groupPic(g.name), group: true }; }
    const pr = DPChat.presenceOf(key); return { name: nameOf(key), sub: pr ? (pr.now ? "Active now" : "Active " + ago(pr.at)) : "", pic: await pic(key), on: pr && pr.now };
  }
  async function openConv(host, key) {
    const main = $("#xc-main", host); if (!main) return; const h = await head(key), pinned = (DPChat.CH.prefs.pinned || []).includes(key);
    main.innerHTML = `<div class="xc-mh"><button class="xc-ib xc-back" id="xc-back" aria-label="Back to conversations">←</button><span class="xc-av sm"><img alt="" src="${esc(h.pic)}" width="36" height="36">${h.on ? '<i class="xc-on"></i>' : ""}</span>
        <div class="xc-mt"><b>${esc(h.name)}</b><small>${esc(h.sub || "")}</small></div><div class="xc-acts">
        ${key !== "wall" ? `<button class="xc-ib${pinned ? " is-on" : ""}" id="xc-pinb" title="${pinned ? "Unpin" : "Pin"}" aria-pressed="${pinned}">📌</button>` : ""}
        ${h.group ? `<button class="xc-ib" id="xc-gadd" title="Add people" aria-label="Add people">${U.svg("plus")}</button><button class="xc-ib" id="xc-gleave" title="Leave group" aria-label="Leave group">Leave</button>` : ""}</div></div>
      <div class="xc-msgs" id="xc-msgs" role="log" aria-live="polite" aria-label="Messages with ${esc(h.name)}"><div class="xc-loading"><span></span><span></span><span></span></div></div>
      ${composer()}`;
    $("#xc-back", main).onclick = () => { S.sel = null; const x = main.closest(".xc"); x.dataset.pane = "list"; drawList(host); };
    const pb = $("#xc-pinb", main); if (pb) pb.onclick = async () => { await DPChat.togglePin(key); openConv(host, key); drawList(host); };
    const ga = $("#xc-gadd", main); if (ga) ga.onclick = () => addPeople(key.slice(2));
    const gl = $("#xc-gleave", main); if (gl) gl.onclick = async () => { if (!(await U.ask("Leave this group?", "You will no longer receive its messages.", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Leave group", value: true, cls: "danger" }]))) return; await DPChat.leaveGroup(key.slice(2)); S.sel = null; draw(host); };
    const box = $("#xc-msgs", main);
    if (key !== "wall" && !key.startsWith("g:") && !DPChat.CH.convs[key] && !(await DPChat.hasKey(key)) && !(await DPChat.pairFor(key))) { box.innerHTML = `<div class="xc-empty"><h3>Not yet</h3><p class="small muted">${esc(nameOf(key))} has not opened X FORCE yet, so a private conversation cannot be started. Try again after they sign in.</p></div>`; $(".xc-comp", main).hidden = true; return; }
    if (key !== "wall") { try { await DPChat.loadConv(key); if (key.startsWith("g:")) DPChat.refreshMeta(key.slice(2)); } catch (e) { box.innerHTML = `<div class="xc-empty"><h3>Could not load messages</h3><p class="small muted">${esc(e.message || "")}</p><button class="btn ghost sm" id="xc-retry">Try again</button></div>`; $("#xc-retry", box).onclick = () => openConv(host, key); return; } }
    S.lastSig[key] = null; S.seen = new Set(); await fillMsgs(box, key, true);
    bindComposer(main, key);
    if (key !== "wall") DPChat.loadReceipts(key).then(() => fillMsgs(box, key, false, true)).catch(() => {});
  }
  function sigOf(c) { return (c.list || []).map((m) => m.id + (m.edited || "") + (m.deleted ? "d" : "") + JSON.stringify(m.reactions || {})).join("|") + "|" + JSON.stringify(c.receipts || {}) + (c.more ? "+" : ""); }
  async function fillMsgs(box, key, first = false, force = false) {
    const c = DPChat.convOf(key); if (!c) return; const sig = sigOf(c); if (!force && S.lastSig[key] === sig) return; S.lastSig[key] = sig;
    const list = c.list || [], atEnd = first || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (!list.length) { box.innerHTML = `<div class="xc-empty"><div class="xc-blk"></div><h3>${key === "wall" ? "No posts yet" : "No messages yet"}</h3><p class="small muted">${key === "wall" ? "Say hello to the team." : "Say hello — your messages are end-to-end encrypted."}</p></div>`; return; }
    const lastMine = [...list].reverse().find((m) => m.from === me() && !m.deleted);
    const frag = document.createDocumentFragment();
    if (c.more && key !== "wall") { const b = document.createElement("button"); b.type = "button"; b.className = "xc-more"; b.textContent = "Load earlier messages"; b.onclick = async () => { b.disabled = true; b.textContent = "Loading…"; const h0 = box.scrollHeight; await DPChat.loadConv(key, { older: true }); await fillMsgs(box, key, false, true); box.scrollTop = box.scrollHeight - h0; }; frag.appendChild(b); }
    let prev = null, day = "";
    for (const m of list) {
      const d = new Date(m.at).toDateString(); if (d !== day) { day = d; const s = document.createElement("div"); s.className = "xc-day"; s.innerHTML = `<span>${esc(dayLabel(m.at))}</span>`; frag.appendChild(s); prev = null; }
      if (m.system || m.sys) { const s = document.createElement("div"); s.className = "xc-sys"; s.innerHTML = `${m.system ? `<img alt="" src="${SYS_PIC}" width="18" height="18"><b>${esc(DPChat.SYSTEM.name)}</b> ` : ""}<span></span>${m.system && m.link && m.link.view && U.allowedView(m.link.view) ? ` <button class="linkbtn small" data-go="1">Open →</button>` : ""}<small>${esc(time(m.at))}</small>`; s.querySelector("span").textContent = m.text || ""; const g = s.querySelector("[data-go]"); if (g) g.onclick = () => { close(); U.go(m.link.view, m.link.opts || {}); }; frag.appendChild(s); prev = null; continue; }
      const mine = m.from === me(), cont = prev && prev.from === m.from && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60000;
      const el = document.createElement("div"); el.className = "xc-m" + (mine ? " mine" : "") + (cont ? " cont" : "") + (m.deleted ? " del" : ""); el.dataset.id = m.id;
      if (!first && !S.seen.has(m.id) && !reduce()) el.classList.add("xc-in"); S.seen.add(m.id);
      const showName = !mine && !cont && key !== m.from;
      el.innerHTML = `${!mine ? `<span class="xc-av xs">${cont ? "" : `<img alt="" src="${esc(await pic(m.from))}" width="28" height="28">`}</span>` : ""}<div class="xc-col">
        ${showName ? `<span class="xc-who">${esc(nameOf(m.from))}</span>` : ""}
        <div class="xc-b" tabindex="0">${m.replyTo && !m.deleted ? `<button type="button" class="xc-q" data-jump="${esc(m.replyTo.id)}"><b>${esc(nameOf(m.replyTo.from))}</b><span></span></button>` : ""}<div class="xc-t"></div>${m.file && !m.deleted ? fileHtml(m) : ""}
          <span class="xc-meta">${esc(time(m.at))}${m.edited && !m.deleted ? " · edited" : ""}${mine && lastMine && lastMine.id === m.id && key !== "wall" ? " · " + esc(status(c, m)) : ""}</span></div>
        ${Object.keys(m.reactions || {}).length ? `<div class="xc-rx">${Object.entries(m.reactions).map(([e, us]) => `<button type="button" class="${us.includes(me()) ? "mine" : ""}" data-rx="${esc(e)}" title="${esc(us.map(nameOf).join(", "))}">${esc(e)} <b>${us.length}</b></button>`).join("")}</div>` : ""}
        ${m.deleted ? "" : `<div class="xc-tools" role="toolbar" aria-label="Message actions">${QUICK.map((e) => `<button type="button" data-rx="${esc(e)}" aria-label="React ${esc(e)}">${esc(e)}</button>`).join("")}<button type="button" data-act="reply" title="Reply" aria-label="Reply">↩</button>${DPChat.canEdit(m) ? `<button type="button" data-act="edit" title="Edit" aria-label="Edit">✎</button>` : ""}${DPChat.canDelete(m) ? `<button type="button" data-act="del" title="Delete" aria-label="Delete">🗑</button>` : ""}</div>`}</div>`;
      el.querySelector(".xc-t").innerHTML = m.deleted ? "<i>This message was deleted</i>" : linkify(m.text || "");
      const q = el.querySelector(".xc-q span"); if (q) q.textContent = m.replyTo.text || "";
      bindMsg(el, m, key, box); frag.appendChild(el); prev = m;
    }
    box.innerHTML = ""; box.appendChild(frag);
    if (atEnd) box.scrollTop = box.scrollHeight;
    loadImages(box, key);
    const u = DPChat.unread(); if ((key === "wall" ? u.wall : u.dms[key]) && document.visibilityState !== "hidden") DPChat.markRead(key);
  }
  function status(c, m) {
    if (c.kind === "group") { const n = Object.entries(c.receipts || {}).filter(([u, at]) => at >= m.at).length; return n ? `Seen by ${n}` : "Sent"; }
    const r = (c.receipts || {})[c.other]; return r && r >= m.at ? "Seen" : "Sent";
  }
  const isImg = (f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type || "");
  function fileHtml(m) {
    const kb = Math.max(1, Math.round((m.file.size || 0) / 1024)), sz = kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " kB";
    if (isImg(m.file)) return `<button type="button" class="xc-img" data-img="${esc(m.id)}" aria-label="Open image ${esc(m.file.name)}"><span class="xc-ph">${U.svg("eye")} ${esc(m.file.name)} · ${esc(sz)}</span></button>`;
    return `<button type="button" class="xc-doc" data-doc="${esc(m.id)}"><span class="xc-dt">${esc((m.file.name.split(".").pop() || "file").toUpperCase().slice(0, 4))}</span><span><b></b><small>${esc(sz)} · open</small></span></button>`;
  }
  async function fetchFile(key, m) { return key === "wall" ? DPChat.wallFile(Object.assign({}, m, { author: m.from })) : DPChat.dmFile(key, m.file); }
  function loadImages(box, key) {
    // images under ~1.5 MB load by themselves once visible; bigger ones on a click
    const c = DPChat.convOf(key); const io = "IntersectionObserver" in root ? new IntersectionObserver((es) => es.forEach(async (en) => { if (!en.isIntersecting) return; io.unobserve(en.target); const m = c.list.find((x) => x.id === en.target.dataset.img); if (m && (m.file.size || 0) < 1.5e6) show(en.target, m); }), { root: box }) : null;
    const show = async (b, m) => { try { const f = S.imgs[m.id] || (S.imgs[m.id] = await fetchFile(key, m)); if (f && f.dataUrl) { b.innerHTML = `<img alt="${esc(m.file.name)}" src="${f.dataUrl}">`; b.onclick = () => DPUI.showFile(f, "Attachment"); } } catch (e) { b.querySelector(".xc-ph") && (b.querySelector(".xc-ph").textContent = "Image could not be loaded — tap to retry"); } };
    $$("[data-img]", box).forEach((b) => { const m = c.list.find((x) => x.id === b.dataset.img); if (!m) return; if (S.imgs[m.id]) show(b, m); else if (io) io.observe(b); b.onclick = () => show(b, m); });
    $$("[data-doc]", box).forEach((b) => { const m = c.list.find((x) => x.id === b.dataset.doc); if (!m) return; b.querySelector("b").textContent = m.file.name; b.onclick = async () => { b.disabled = true; try { DPUI.showFile(await fetchFile(key, m), "Attachment"); } catch (e) { U.toast("The attachment could not be opened.", { err: true }); } finally { b.disabled = false; } }; });
  }
  function bindMsg(el, m, key, box) {
    const bub = el.querySelector(".xc-b");
    // touch / keyboard: tap or Enter shows the actions for this message
    bub.onclick = (e) => { if (e.target.closest("a,button")) return; $$(".xc-m.act", box).forEach((x) => x !== el && x.classList.remove("act")); el.classList.toggle("act"); };
    bub.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); el.classList.toggle("act"); } };
    $$("[data-rx]", el).forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); el.classList.remove("act"); b.disabled = true; try { await DPChat.react(key, m.id, b.dataset.rx); if (!reduce()) el.classList.add("xc-pop"); } catch (x) { U.toast(x.message || "Not sent.", { err: true }); } finally { b.disabled = false; } refreshConv(key); }));
    const jump = el.querySelector("[data-jump]"); if (jump) jump.onclick = () => { const t = box.querySelector(`[data-id="${CSS.escape(jump.dataset.jump)}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: reduce() ? "auto" : "smooth" }); t.classList.add("xc-hl"); setTimeout(() => t.classList.remove("xc-hl"), 1600); } };
    $$("[data-act]", el).forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); el.classList.remove("act"); const a = b.dataset.act, comp = $(".xc-comp", S.host);
      if (a === "reply") { S.reply = { id: m.id, from: m.from, text: m.text || (m.file ? "📎 " + m.file.name : "") }; S.editing = null; bar(comp); $("#xc-text", comp).focus(); }
      if (a === "edit") { S.editing = { id: m.id }; S.reply = null; const ta = $("#xc-text", comp); ta.value = m.text || ""; grow(ta); bar(comp); ta.focus(); }
      if (a === "del") { if (!(await U.ask("Delete this message?", "It is removed for everyone in the conversation.", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Delete", value: true, cls: "danger" }]))) return; try { await DPChat.remove(key, m.id); } catch (x) { U.toast(x.message, { err: true }); } refreshConv(key); }
    }));
  }
  async function refreshConv(key) { const box = S.host && $("#xc-msgs", S.host); if (box && S.sel === key) await fillMsgs(box, key); if (S.host) drawList(S.host); }

  /* ---------------- composer ---------------- */
  function composer() {
    return `<form class="xc-comp" id="xc-form"><div class="xc-bar" id="xc-bar" hidden></div><div class="xc-att" id="xc-att" hidden></div>
      <div class="xc-row"><button type="button" class="xc-ib" id="xc-file" title="Attach a photo or document (JPG, PNG, WebP or PDF, max 6 MB)" aria-label="Attach a file">${U.svg("clip")}</button>
        <button type="button" class="xc-ib" id="xc-emo" title="Emoji" aria-label="Insert emoji" aria-haspopup="true">☺</button>
        <textarea id="xc-text" rows="1" placeholder="Write a message…" maxlength="4000" aria-label="Message"></textarea>
        <button class="xc-send" id="xc-send" aria-label="Send">${U.svg("send")}</button></div>
      <div class="xc-emos" id="xc-emos" hidden role="menu">${EMOJI.map((e) => `<button type="button" role="menuitem">${e}</button>`).join("")}</div><p class="xc-err" id="xc-err" role="alert"></p></form>`;
  }
  const grow = (ta) => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
  function bar(f) {
    const b = $("#xc-bar", f); if (!b) return;
    if (S.editing) { b.hidden = false; b.innerHTML = `<span><b>Editing your message</b></span><button type="button" class="xc-ib" aria-label="Cancel editing">✕</button>`; b.querySelector("button").onclick = () => { S.editing = null; $("#xc-text", f).value = ""; bar(f); }; }
    else if (S.reply) { b.hidden = false; b.innerHTML = `<span><b>Replying to ${esc(nameOf(S.reply.from))}</b><small></small></span><button type="button" class="xc-ib" aria-label="Cancel reply">✕</button>`; b.querySelector("small").textContent = String(S.reply.text || "").slice(0, 120); b.querySelector("button").onclick = () => { S.reply = null; bar(f); }; }
    else b.hidden = true;
  }
  function bindComposer(main, key) {
    const f = $("#xc-form", main); if (!f) return; const ta = $("#xc-text", f), att = $("#xc-att", f), err = $("#xc-err", f), emos = $("#xc-emos", f);
    const showAtt = () => { att.hidden = !S.file; att.innerHTML = S.file ? `<span>📎 <b></b></span><button type="button" class="xc-ib" aria-label="Remove attachment">✕</button>` : ""; if (S.file) { att.querySelector("b").textContent = S.file.name; att.querySelector("button").onclick = () => { S.file = null; showAtt(); }; } };
    showAtt(); bar(f);
    $("#xc-file", f).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (file) => { err.textContent = ""; try { S.file = await DPOrders.prepareFile(file); showAtt(); } catch (e) { err.textContent = e.message; } });
    $("#xc-emo", f).onclick = () => { emos.hidden = !emos.hidden; };
    $$("button", emos).forEach((b) => (b.onclick = () => { const p = ta.selectionStart || ta.value.length; ta.value = ta.value.slice(0, p) + b.textContent + ta.value.slice(p); emos.hidden = true; ta.focus(); grow(ta); }));
    ta.oninput = () => grow(ta);
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } else if (e.key === "Escape") { S.reply = null; S.editing = null; bar(f); } };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (S.busy) return; err.textContent = ""; const text = ta.value; if (!text.trim() && !S.file) return;
      if (!DPChat.CH.online) { err.innerHTML = "You're offline — the message was not sent. It is still in the box; send it again when you're back online."; return; }
      const btn = $("#xc-send", f); S.busy = true; btn.disabled = true; btn.classList.add("busy"); f.classList.add("sending");
      try {
        if (S.editing) await DPChat.edit(key, S.editing.id, text);
        else if (key === "wall") await DPChat.post(text, S.file, { replyTo: S.reply });
        else await DPChat.send(key, text, S.file, { replyTo: S.reply });
        S.file = null; S.reply = null; S.editing = null; ta.value = ""; grow(ta); showAtt(); bar(f);
        await refreshConv(key); const box = $("#xc-msgs", main); if (box) box.scrollTop = box.scrollHeight;
      } catch (x) { err.innerHTML = `${esc(x.message || "Not sent.")} <button type="button" class="linkbtn" id="xc-again">Try again</button>`; $("#xc-again", err).onclick = () => f.requestSubmit(); }
      finally { S.busy = false; btn.disabled = false; btn.classList.remove("busy"); f.classList.remove("sending"); }
    };
    if (matchMedia("(pointer:fine)").matches) setTimeout(() => ta.focus(), 30);
  }

  /* ---------------- live update ---------------- */
  let upd = false;
  async function update(host) {
    if (upd) return; upd = true;
    try {
      net(host);
      if (document.activeElement !== $("#xc-q", host)) await drawList(host);
      const box = $("#xc-msgs", host); if (box && S.sel) await fillMsgs(box, S.sel);
    } finally { upd = false; }
  }

  /* ---------------- groups and settings ---------------- */
  async function pickPeople(title, intro, submit, exclude = []) {
    const ps = (await DPChat.people()).filter((p) => !exclude.includes(p.uid));
    return new Promise((res) => U.openModal(`<h2>${esc(title)}</h2><p class="small muted">${esc(intro)}</p>${submit === "Create group" ? `<label class="field"><span>Group name</span><input class="in" id="ng-n" maxlength="60" placeholder="e.g. Palm Hills project team"></label>` : ""}
      <label class="xc-search"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input id="ng-q" type="search" placeholder="Search colleagues"></label>
      <div class="xc-pick" id="ng-l">${ps.map((p) => `<label class="xc-pk${p.hasKey ? "" : " off"}"><input type="checkbox" value="${esc(p.uid)}" ${p.hasKey ? "" : "disabled"}><span><b>${esc(p.name)}</b><small>${esc(p.hasKey ? p.title : "has not opened X FORCE yet")}</small></span></label>`).join("") || '<p class="small muted">No colleagues to add.</p>'}</div>
      <p class="small" id="ng-e" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="ng-x">Cancel</button><button class="btn lime" id="ng-ok">${esc(submit)}</button></div>`, (m) => {
      $("#ng-q", m).oninput = (e) => { const q = e.target.value.toLowerCase(); $$(".xc-pk", m).forEach((l) => (l.hidden = !l.textContent.toLowerCase().includes(q))); };
      $("#ng-x", m).onclick = () => { U.closeModal(); res(null); };
      $("#ng-ok", m).onclick = () => { const sel = $$("input[type=checkbox]:checked", m).map((c) => c.value), n = $("#ng-n", m); res({ name: n ? n.value : "", members: sel, err: $("#ng-e", m), btn: $("#ng-ok", m) }); };
    }, { wide: false }));
  }
  async function newGroup() {
    const r = await pickPeople("New group chat", "Choose at least two colleagues. Group messages are end-to-end encrypted for the members.", "Create group"); if (!r) return;
    try { r.btn.disabled = true; const gid = await DPChat.createGroup(r.name, r.members); U.closeModal(); S.sel = "g:" + gid; draw(S.host || S.panel || $("#msg-host")); } catch (e) { r.err.textContent = e.message; r.btn.disabled = false; }
  }
  async function addPeople(gid) {
    const g = DPChat.CH.groups[gid]; const r = await pickPeople("Add people", `They will see messages sent from now on in “${g.name}”.`, "Add", g.members); if (!r) return;
    try { await DPChat.addMembers(gid, r.members); U.closeModal(); openConv(S.host, "g:" + gid); } catch (e) { r.err.textContent = e.message; }
  }
  function settings(btn) {
    const P = DPChat.CH.prefs;
    U.openModal(`<h2>Chat settings</h2>
      <label class="check"><input type="checkbox" id="cs-pr" ${P.hidePresence ? "" : "checked"}> Show colleagues when I'm active</label><p class="tiny muted">When this is off, nobody sees "Active now" or when you were last active — and you still see others who allow it.</p>
      <h4>Theme</h4><div class="xc-themes">${[["lime", "Lime"], ["charcoal", "Charcoal"], ["stone", "Stone"]].map(([k, l]) => `<label class="xc-th" data-theme="${k}"><input type="radio" name="cs-th" value="${k}" ${(P.theme || "lime") === k ? "checked" : ""}><span class="xc-sw"></span>${l}</label>`).join("")}</div>
      <div class="acts"><button class="btn lime" id="cs-ok">Done</button></div>`, (m) => {
      $("#cs-ok", m).onclick = async () => { const th = ($("input[name=cs-th]:checked", m) || {}).value || "lime"; await DPChat.savePrefs({ theme: th }); await DPChat.setPresenceHidden(!$("#cs-pr", m).checked); U.closeModal(); const h = S.host || S.panel || $("#msg-host"); if (h) draw(h); };
    });
  }

  /* ---------------- full page ---------------- */
  function renderMessages(opts = {}) {
    if (opts.dm) S.sel = opts.dm;
    $("#view-messages").innerHTML = `<div class="page xc-page"><div class="phead"><div><span class="eyebrow">Messages</span><h1>Company <em>chat</em></h1><p class="lead small">Private and group conversations, and the Company Wall for team-wide news from <b>Dupedia Updates</b>.</p></div></div><div id="msg-host" class="xc-host"></div></div>`;
    draw($("#msg-host")); DPChat.setOpen(true); DPChat.refresh().catch(() => {});
  }
  U.register("messages", renderMessages);
  root.DPChatUI = { init, open, close, badge };
})(typeof self !== "undefined" ? self : this);
