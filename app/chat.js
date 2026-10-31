/* X FORCE 1.0 → 1.4.6 (Dupedia) — company messaging: Company Wall, "Dupedia Updates" system posts, private chat, group chat.

   COMPANY WALL   wall/<uid>/m/<id>  (+ /f/<fid>/c/<n> attachments)
     Every active employee reads the wall. Each person can only write under their own id, so the author of a post is the
     path it is stored at — nobody can post in someone else's name. System posts ("Dupedia Updates") are written by the
     person whose action caused the event, under their own id, with system:true and a deterministic event key
     (wall/<uid>/m/sys-<event>), shown once per event key however many times the event is retried. They never carry money,
     commission, ID documents or personal contact details.

   PRIVATE CHAT   dmx/<conversation>/m/<id>  (+ /f/<fid>/c/<n>)
     The database can only say "administrators" or "everyone at Contributor level" — it cannot say "these two people". So
     private messages are END-TO-END ENCRYPTED in the browser (Web Crypto):
       • each person has an ECDH P-256 key pair; the private key is kept in their own data/users/<id>/ area (private even
         from the artifact's owner), the public key at keys/<id>;
       • two people derive the same shared secret; from it HKDF gives (a) the conversation path, which nobody else can
         compute, and (b) an AES-GCM key. Messages and attachments are stored only as ciphertext;
       • only the two participants can read a conversation. Administrators cannot read private chats either.

   1.4.6 — GROUP CHAT   dmx/<gid>/m/<id>, members' keys at dmx/<gid>/k/<member uid>, encrypted name/members at dmx/<gid>/x/meta
     A random AES-GCM group key is wrapped for each member with the private-chat key that member shares with whoever added
     them (so only members can unwrap it). Members learn about a new group from an inbox notification that carries only the
     group id — never its name, members or messages. Each member keeps their own list of groups (data/users/<id>/chatgroups).

   1.4.6 — MESSAGE EVENTS (stored as messages in the same conversation, encrypted the same way; older messages are unchanged)
     kind "react" {target, emoji, on}   kind "edit" {target, text}   kind "del" {target}   reply: {replyTo:{id, from, text}}
     An edit or deletion only counts when it comes from the author of the original message (on the Wall: the path proves it).
     Read receipts: dmx/<conv>/r/<hash> — "seen up to" written by the reader's own app; nothing is shown that was not written.
     Paging: conversations load the latest 40 messages, then only newer ones; "Load earlier" pages backwards.
   1.4.6 — PRESENCE  presence/<uid> {at, hidden} — a heartbeat while X FORCE is open; "Active now" means a heartbeat in the last
     2 minutes. Anyone can switch it off (hidden), and then nothing about their activity is shown. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth;
  const now = () => new Date().toISOString();
  const meId = () => (AU().A.me || {}).id;
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const PAGE = 40, EDIT_HOURS = 24;
  const CH = { notified: new Set(), wall: [], wallRaw: {}, wallNewest: {}, convs: {}, keys: {}, pair: {}, priv: null, pub: null, read: {}, ready: null, listeners: [], timer: null, open: false,
    cryptoOk: !!(root.crypto && root.crypto.subtle), groups: {}, prefs: { pinned: [], theme: "lime" }, presence: {}, online: true, lastBeat: 0, lastErr: null };
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  const SYSTEM = { id: "dupedia-updates", name: "Dupedia Updates" };
  const wallOn = () => { const s = (root.DPUI && root.DPUI.App.config.settings) || {}; return !(s.wall && s.wall.systemPosts === false); };

  /* ---------------- keys ---------------- */
  async function ensureKeys() {
    if (!CH.cryptoOk) return false; const me = meId(); if (!me) return false;
    if (CH.priv) return true;
    const kp = `data/users/${me}/chatkey`;
    let saved = await DS().tryGet(kp);
    if (saved && saved.priv && saved.pub) {
      CH.priv = await crypto.subtle.importKey("jwk", saved.priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      CH.pub = saved.pub;
    } else {
      const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const priv = await crypto.subtle.exportKey("jwk", k.privateKey), pub = await crypto.subtle.exportKey("jwk", k.publicKey);
      await DS().set(kp, { priv, pub, at: now() });
      CH.priv = await crypto.subtle.importKey("jwk", priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]); CH.pub = pub;
    }
    const pubDoc = await DS().tryGet(`keys/${me}`);
    if (!pubDoc || !pubDoc.jwk || pubDoc.jwk.x !== CH.pub.x) await DS().set(`keys/${me}`, { jwk: { kty: CH.pub.kty, crv: CH.pub.crv, x: CH.pub.x, y: CH.pub.y }, at: now() });
    return true;
  }
  async function pairFor(other) {
    if (CH.pair[other]) return CH.pair[other];
    const me = meId(); if (!(await ensureKeys())) return null;
    const pd = await DS().tryGet(`keys/${other}`); if (!pd || !pd.jwk) return null;
    const pk = await crypto.subtle.importKey("jwk", Object.assign({ ext: true }, pd.jwk), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pk }, CH.priv, 256);
    const ikm = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveBits", "deriveKey"]), salt = enc.encode([me, other].sort().join("|"));
    const pathBits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("xforce-dm-path-v1") }, ikm, 256);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("xforce-dm-key-v1") }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    CH.keys[other] = true; CH.pair[other] = { conv: "c" + hex(pathBits).slice(0, 40), key, other }; return CH.pair[other];
  }
  async function seal(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))); return { iv: b64(iv), ct: b64(ct) }; }
  async function open(key, d) { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(d.iv) }, key, unb64(d.ct)); return JSON.parse(dec.decode(pt)); }
  // a colleague who has no key yet is asked again after a minute (they may sign in for the first time while we chat)
  async function hasKey(uid) { const k = CH.keys[uid]; if (k === true || (typeof k === "number" && Date.now() - k < 15000)) return k === true; const d = await DS().tryGet(`keys/${uid}`); CH.keys[uid] = d && d.jwk ? true : Date.now(); return CH.keys[uid] === true; }

  /* ---------------- my own read markers and preferences (private to me) ---------------- */
  async function loadRead() { const me = meId(); if (!me) return; CH.read = (await DS().tryGet(`data/users/${me}/chatread`)) || {}; CH.prefs = Object.assign({ pinned: [], theme: "lime" }, (await DS().tryGet(`data/users/${me}/chatprefs`)) || {}); }
  const readKey = (key) => (key === "wall" ? "wall" : String(key).startsWith("g:") || String(key).startsWith("dm:") ? key : "dm:" + key);
  async function markRead(key) {
    if (String(key).startsWith("dm:")) key = key.slice(3);
    const me = meId(); const c = convOf(key), last = c && c.list.length ? c.list[c.list.length - 1].at : now(), t = now();
    CH.read[readKey(key)] = last > t ? last : t; emit(); await DS().set(`data/users/${me}/chatread`, CH.read).catch(() => {});
    if (c && c.kind !== "wall") receipt(c).catch(() => {});
  }
  async function savePrefs(patch) { Object.assign(CH.prefs, patch); emit(); await DS().set(`data/users/${meId()}/chatprefs`, CH.prefs).catch(() => {}); }
  function togglePin(key) { const p = new Set(CH.prefs.pinned || []); p.has(key) ? p.delete(key) : p.add(key); return savePrefs({ pinned: [...p] }); }

  /* ---------------- folding raw messages: edits, deletions, reactions, replies ---------------- */
  /** raw: [{id, at, from, text, file, kind, target, emoji, on, replyTo}] in time order → displayed messages. */
  function fold(raw) {
    const msgs = [], byId = {};
    const sorted = raw.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));
    for (const m of sorted) if (!m.kind || m.kind === "msg") { const x = Object.assign({ reactions: {}, edited: null, deleted: false }, m); msgs.push(x); byId[m.id] = x; }
    for (const e of sorted) {
      if (!e.kind || e.kind === "msg") continue; const t = byId[e.target]; if (!t) continue;
      if (e.kind === "edit" && e.from === t.from && !t.deleted) { t.text = String(e.text || "").slice(0, 4000); t.edited = e.at; }
      else if (e.kind === "del" && e.from === t.from) { t.deleted = true; t.text = ""; t.file = null; }
      else if (e.kind === "react" && e.emoji) { const s = new Set(t.reactions[e.emoji] || []); if (e.on === false) s.delete(e.from); else s.add(e.from); if (s.size) t.reactions[e.emoji] = [...s]; else delete t.reactions[e.emoji]; }
    }
    for (const x of msgs) if (x.replyTo && byId[x.replyTo.id]) { const o = byId[x.replyTo.id]; x.replyTo = { id: o.id, from: o.from, text: o.deleted ? "Message deleted" : String(o.text || (o.file ? "📎 " + o.file.name : "")).slice(0, 140) }; }
    return msgs;
  }

  /* ---------------- company wall ---------------- */
  async function loadWall() {
    const dir = AU().A.directory.filter((r) => r.uid); const ids = [...new Set(dir.map((r) => r.uid).concat(meId() ? [meId()] : []))];
    await Promise.all(ids.map(async (u) => {
      // wall ids are not in time order (m-…, e-…, sys-…), so later reads ask only for what was written since the last read
      const since = CH.wallNewest[u], l = await DS().page(`wall/${u}/m`, { since: since || "", limit: 500 });
      for (const x of l) { CH.wallRaw[u + ":" + x.id] = Object.assign({ id: x.id, author: u, from: u }, x.data); if (x.at && (!CH.wallNewest[u] || x.at > CH.wallNewest[u])) CH.wallNewest[u] = x.at; }
    }));
    const seen = new Map();
    for (const m of Object.values(CH.wallRaw).sort((a, b) => String(a.at).localeCompare(String(b.at)))) { const k = m.system ? "sys:" + m.event : m.author + ":" + m.id; if (!seen.has(k)) seen.set(k, m); }
    // events refer to a post by "<author>:<id>"; fold() matches on id, so give every post its global key
    const raw = [...seen.values()].map((m) => Object.assign({}, m, { id: m.author + ":" + m.id, target: m.target || null, pid: m.id }));
    CH.wall = fold(raw).slice(-300); emit(); return CH.wall;
  }
  async function post(text, file, opts = {}) {
    const me = meId(); text = String(text || "").trim(); if (!text && !file) throw new Error("Write a message or attach a file.");
    if (text.length > 4000) throw new Error("Messages are limited to 4,000 characters.");
    const id = rid("m-"), doc = { text, at: now(), by: me, system: false };
    if (opts.replyTo) doc.replyTo = { id: opts.replyTo.id };
    if (file) { const fid = rid("f-"); await root.DPOrders.putFile(`wall/${me}/f/${fid}`, file); doc.file = { fid, name: file.name, type: file.type, size: file.size }; }
    await DS().set(`wall/${me}/m/${id}`, doc); await loadWall(); return id;
  }
  async function wallEvent(ev) { const me = meId(), id = rid("e-"); await DS().set(`wall/${me}/m/${id}`, Object.assign({ at: now(), by: me, system: false }, ev)); await loadWall(); return id; }
  async function wallFile(m) { return m.file ? root.DPOrders.getFile(`wall/${m.author}/f/${m.file.fid}`) : null; }
  /** Dupedia Updates: post once per event key. Text must never contain money, commission or personal data. */
  async function system(event, text, link) {
    const me = meId(); if (!me || !wallOn()) return false;
    if (/\b(EGP|USD|EUR|commission|salary|national id)\b|\d{3,}[,.]\d{3}/i.test(text)) throw new Error("System posts must not contain financial or personal details.");
    const id = "sys-" + String(event).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 150), path = `wall/${me}/m/${id}`;
    if (await DS().tryGet(path)) return false;
    if (CH.wall.some((m) => m.system && m.event === event)) return false;
    const doc = { system: true, event, text: String(text).slice(0, 400), link: link || null, at: now(), by: me };
    await DS().set(path, doc); CH.wallRaw[me + ":" + id] = Object.assign({ id, author: me, from: me }, doc); loadWall().catch(() => {}); return true;
  }

  /* ---------------- people and presence ---------------- */
  async function people() {
    const me = meId(), dir = AU().A.directory.filter((r) => r.uid && r.uid !== me && r.active !== false);
    await Promise.all(dir.map((r) => hasKey(r.uid)));
    return dir.map((r) => ({ uid: r.uid, name: AU().fullName(r) || r.displayName || "Colleague", title: r.title || (AU().roleOf(r.role) || {}).label || "", hasKey: CH.keys[r.uid] === true }));
  }
  async function beat(force = false) {
    const me = meId(); if (!me || (!force && Date.now() - CH.lastBeat < 55000)) return; CH.lastBeat = Date.now();
    await DS().set(`presence/${me}`, { at: now(), hidden: !!CH.prefs.hidePresence }).catch(() => {});
  }
  async function loadPresence() { const l = await DS().tryList("presence"); CH.presence = Object.fromEntries(l.map((x) => [x.id, x.data])); }
  /** "now" (heartbeat in the last 2 minutes), a time it was last seen, or null when unknown or switched off. */
  function presenceOf(uid) { const p = CH.presence[uid]; if (!p || p.hidden || !p.at) return null; const age = Date.now() - Date.parse(p.at); return age < 120000 ? { now: true, at: p.at } : { now: false, at: p.at }; }

  /* ---------------- conversations (private and group) ---------------- */
  // key: "<uid>" for a private conversation, "g:<gid>" for a group
  const convOf = (key) => (key === "wall" ? { kind: "wall", key, list: CH.wall } : CH.convs[key]);
  async function cryptOf(key) {
    if (key.startsWith("g:")) { const g = CH.groups[key.slice(2)]; if (!g) return null; if (!g.cryptoKey) g.cryptoKey = await crypto.subtle.importKey("raw", unb64(g.key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); return { conv: key.slice(2), key: g.cryptoKey, group: g }; }
    return pairFor(key);
  }
  /** Load the newest page (first time), only newer messages (later), or one page of older ones ({older:true}). */
  async function loadConv(key, { older = false } = {}) {
    const p = await cryptOf(key); if (!p) return null;
    const c = CH.convs[key] || { key, kind: key.startsWith("g:") ? "group" : "dm", other: key.startsWith("g:") ? null : key, raw: {}, list: [], newest: null, oldest: null, more: true, receipts: {} };
    const opt = older ? { before: c.oldest, limit: PAGE } : c.newest ? { after: c.newest, limit: 200 } : { limit: PAGE };
    if (older && !c.oldest) return c; const firstLoad = !older && !c.newest;
    const l = await DS().page(`dmx/${p.conv}/m`, opt);
    for (const x of l) {
      if (!c.newest || x.id > c.newest) c.newest = x.id; if (!c.oldest || x.id < c.oldest) c.oldest = x.id;
      if (c.raw[x.id]) continue;
      try { const m = await open(p.key, x.data); const members = p.group ? p.group.members || [] : [meId(), key];
        if (m.from !== x.data.from || (!p.group && !members.includes(m.from))) continue; c.raw[x.id] = Object.assign({ id: x.id, at: x.data.at }, m); }
      catch (e) { /* not decryptable with our key: ignore */ }
    }
    if (older || firstLoad) c.more = l.length >= PAGE;
    c.list = fold(Object.values(c.raw)); CH.convs[key] = c; return c;
  }
  async function sendRaw(key, body) {
    const me = meId(), p = await cryptOf(key);
    if (!p) throw new Error(key.startsWith("g:") ? "This group is not available on this device." : "This colleague has not opened X FORCE yet, so a private conversation cannot be started. Try again after they sign in.");
    const id = rid("m-"), at = now(); body = Object.assign({ from: me, at }, body); if (!key.startsWith("g:")) body.to = key;
    const sealed = await seal(p.key, body);
    await DS().set(`dmx/${p.conv}/m/${id}`, { from: me, at, iv: sealed.iv, ct: sealed.ct });
    const c = CH.convs[key] || (await loadConv(key)) || { key, raw: {}, list: [] }; c.raw[id] = Object.assign({ id }, body); if (!c.newest || id > c.newest) c.newest = id; if (!c.oldest) c.oldest = id;
    c.list = fold(Object.values(c.raw)); CH.convs[key] = c; return id;
  }
  async function send(key, text, file, opts = {}) {
    text = String(text || "").trim(); if (!text && !file) throw new Error("Write a message or attach a file.");
    if (text.length > 4000) throw new Error("Messages are limited to 4,000 characters.");
    const p = await cryptOf(key); if (!p) return sendRaw(key, {});
    const body = { text };
    if (opts.replyTo) body.replyTo = { id: opts.replyTo.id };
    if (file) {
      const fid = rid("f-"), sealed = await seal(p.key, { dataUrl: file.dataUrl }), parts = [];
      for (let i = 0; i < sealed.ct.length; i += 180000) parts.push(sealed.ct.slice(i, i + 180000));
      for (let i = 0; i < parts.length; i++) await DS().set(`dmx/${p.conv}/f/${fid}/c/${String(i).padStart(3, "0")}`, { n: i, total: parts.length, iv: sealed.iv, part: parts[i] });
      body.file = { fid, name: file.name, type: file.type, size: file.size };
    }
    const id = await sendRaw(key, body); await markRead(key); emit(); return id;
  }
  const isWall = (key) => key === "wall";
  /** Emoji reaction (toggle). */
  async function react(key, target, emoji) {
    const c = convOf(key), t = c && c.list.find((m) => m.id === target); const on = !(t && (t.reactions[emoji] || []).includes(meId()));
    if (isWall(key)) await wallEvent({ kind: "react", target, emoji, on }); else await sendRaw(key, { kind: "react", target, emoji, on });
    emit();
  }
  function canEdit(m) { return m && m.from === meId() && !m.deleted && !m.system && Date.now() - Date.parse(m.at) < EDIT_HOURS * 3600e3; }
  function canDelete(m) { return m && m.from === meId() && !m.deleted && !m.system; }
  async function edit(key, target, text) {
    const c = convOf(key), t = c && c.list.find((m) => m.id === target); if (!canEdit(t)) throw new Error(`You can edit your own messages for ${EDIT_HOURS} hours.`);
    text = String(text || "").trim(); if (!text) throw new Error("A message cannot be empty — delete it instead."); if (text.length > 4000) throw new Error("Messages are limited to 4,000 characters.");
    if (isWall(key)) await wallEvent({ kind: "edit", target, text }); else await sendRaw(key, { kind: "edit", target, text }); emit();
  }
  async function remove(key, target) {
    const c = convOf(key), t = c && c.list.find((m) => m.id === target); if (!canDelete(t)) throw new Error("You can only delete your own messages.");
    if (isWall(key)) await wallEvent({ kind: "del", target }); else await sendRaw(key, { kind: "del", target }); emit();
  }
  async function dmFile(key, f) {
    const p = await cryptOf(key); if (!p) return null;
    const l = (await DS().tryList(`dmx/${p.conv}/f/${f.fid}/c`)).sort((a, b) => a.data.n - b.data.n); if (!l.length || l.length !== l[0].data.total) return null;
    const o = await open(p.key, { iv: l[0].data.iv, ct: l.map((x) => x.data.part).join("") }); return { name: f.name, type: f.type, size: f.size, dataUrl: o.dataUrl };
  }

  /* ---------------- read receipts (written by the reader's own app) ---------------- */
  async function receipt(c) {
    const p = await cryptOf(c.key); if (!p) return; const me = meId(), h = (await sha("rcpt|" + p.conv + "|" + me)).slice(0, 24);
    const sealed = await seal(p.key, { uid: me, at: CH.read[c.key] || now() }); await DS().set(`dmx/${p.conv}/r/${h}`, { at: now(), iv: sealed.iv, ct: sealed.ct });
  }
  async function loadReceipts(key) {
    const p = await cryptOf(key), c = CH.convs[key]; if (!p || !c) return {};
    const l = await DS().tryList(`dmx/${p.conv}/r`), out = {};
    for (const x of l) { try { const r = await open(p.key, x.data); if (r.uid && r.uid !== meId()) out[r.uid] = r.at; } catch (e) {} }
    c.receipts = out; return out;
  }

  /* ---------------- groups ---------------- */
  async function loadGroups() { const d = await DS().tryGet(`data/users/${meId()}/chatgroups`); CH.groups = Object.assign({}, (d && d.groups) || {}); }
  async function saveGroups() { const g = {}; for (const [k, v] of Object.entries(CH.groups)) g[k] = { key: v.key, name: v.name, members: v.members, by: v.by, at: v.at, left: !!v.left }; await DS().set(`data/users/${meId()}/chatgroups`, { groups: g }); }
  async function wrapFor(gid, gkeyB64, member) { const pr = await pairFor(member); if (!pr) return false; const s = await seal(pr.key, { gid, gkey: gkeyB64 }); await DS().set(`dmx/${gid}/k/${member}`, { by: meId(), at: now(), iv: s.iv, ct: s.ct }); return true; }
  async function writeMeta(gid) { const g = CH.groups[gid], k = (await cryptOf("g:" + gid)).key, s = await seal(k, { name: g.name, members: g.members, by: g.by, at: g.at, updatedAt: now(), updatedBy: meId() }); await DS().set(`dmx/${gid}/x/meta`, { at: now(), iv: s.iv, ct: s.ct }); }
  async function createGroup(name, members) {
    name = String(name || "").trim().slice(0, 60); if (!name) throw new Error("Name the group."); if (!(await ensureKeys())) throw new Error("Group chat needs the browser's encryption support.");
    const me = meId(), uniq = [...new Set([me].concat(members || []))]; if (uniq.length < 3) throw new Error("A group needs at least two colleagues besides you.");
    const missing = []; for (const u of uniq) if (u !== me && !(await hasKey(u))) missing.push(AU().nameSync(u) || u);
    if (missing.length) throw new Error(`Not yet possible for ${missing.join(", ")} — they have not opened X FORCE yet.`);
    const gid = "g" + hex(crypto.getRandomValues(new Uint8Array(12))), raw = crypto.getRandomValues(new Uint8Array(32)), gkey = b64(raw);
    CH.groups[gid] = { key: gkey, name, members: uniq, by: me, at: now() };
    for (const u of uniq) if (u !== me) await wrapFor(gid, gkey, u);
    await writeMeta(gid); await saveGroups();
    await sendRaw("g:" + gid, { kind: "msg", text: `${(AU().A.me || {}).name || "Someone"} created the group “${name}”.`, sys: true });
    for (const u of uniq) if (u !== me && root.DPNotify) await root.DPNotify.deliver(u, { id: `grp-${gid}-${u}`, type: "message", title: "You were added to a group chat", body: "Open Messages to see it.", link: { view: "messages" }, data: { gid, by: me } }).catch(() => {});
    emit(); return gid;
  }
  async function addMembers(gid, members) {
    const g = CH.groups[gid]; if (!g) throw new Error("Group not found."); const add = (members || []).filter((u) => !g.members.includes(u)); if (!add.length) return;
    for (const u of add) { if (!(await hasKey(u))) throw new Error(`${AU().nameSync(u) || u} has not opened X FORCE yet.`); await wrapFor(gid, g.key, u); }
    g.members = g.members.concat(add); await writeMeta(gid); await saveGroups();
    await sendRaw("g:" + gid, { kind: "msg", text: `${(AU().A.me || {}).name || "Someone"} added ${add.map((u) => AU().nameSync(u) || "a colleague").join(", ")}.`, sys: true });
    for (const u of add) if (root.DPNotify) await root.DPNotify.deliver(u, { id: `grp-${gid}-${u}`, type: "message", title: "You were added to a group chat", body: "Open Messages to see it.", link: { view: "messages" }, data: { gid, by: meId() } }).catch(() => {});
    emit();
  }
  async function leaveGroup(gid) { const g = CH.groups[gid]; if (!g) return; await sendRaw("g:" + gid, { kind: "msg", text: `${(AU().A.me || {}).name || "Someone"} left the group.`, sys: true }).catch(() => {}); g.left = true; await saveGroups(); delete CH.convs["g:" + gid]; emit(); }
  /** Groups I was added to (from my inbox) → unwrap the key with the private-chat key I share with whoever added me. */
  async function discoverGroups() {
    if (!root.DPNotify) return; const me = meId();
    for (const n of (root.DPNotify.N.items || []).filter((x) => x.data && x.data.gid && /^g[0-9a-f]{24}$/.test(x.data.gid))) {
      const gid = n.data.gid; if (CH.groups[gid]) continue;
      try { const k = await DS().tryGet(`dmx/${gid}/k/${me}`); if (!k) continue; const pr = await pairFor(k.by); if (!pr) continue; const w = await open(pr.key, k); if (w.gid !== gid) continue;
        CH.groups[gid] = { key: w.gkey, name: "Group", members: [], by: k.by, at: k.at };
        const meta = await DS().tryGet(`dmx/${gid}/x/meta`); if (meta) { const md = await open((await cryptOf("g:" + gid)).key, meta); Object.assign(CH.groups[gid], { name: md.name, members: md.members || [], by: md.by, at: md.at }); }
        await saveGroups(); } catch (e) { console.warn("group", e); }
    }
  }
  async function refreshMeta(gid) { try { const meta = await DS().tryGet(`dmx/${gid}/x/meta`); if (!meta) return; const md = await open((await cryptOf("g:" + gid)).key, meta); const g = CH.groups[gid]; if (g && JSON.stringify(g.members) !== JSON.stringify(md.members)) { g.name = md.name; g.members = md.members || g.members; await saveGroups(); } } catch (e) {} }

  /* ---------------- unread, polling ---------------- */
  function unread() {
    const me = meId(), wr = CH.read.wall || "";
    const wall = CH.wall.filter((m) => m.from !== me && !m.deleted && String(m.at) > wr).length;
    const dms = {}; let dm = 0;
    for (const [key, c] of Object.entries(CH.convs)) { if (key.startsWith("g:") && CH.groups[key.slice(2)] && CH.groups[key.slice(2)].left) continue; const r = CH.read[key.startsWith("g:") ? key : "dm:" + key] || CH.read[key] || ""; dms[key] = c.list.filter((m) => m.from !== me && !m.deleted && String(m.at) > r).length; dm += dms[key]; }
    return { wall, dm, dms, total: wall + dm };
  }
  async function refresh({ dms = true } = {}) {
    if (!CH.online) return;
    try {
      await loadWall().catch(() => {}); beat().catch(() => {}); loadPresence().catch(() => {});
      if (dms && CH.cryptoOk) {
        await discoverGroups().catch(() => {});
        const ps = await people().catch(() => []), recent = new Date(Date.now() - 7 * 864e5).toISOString();
        const keys = ps.filter((x) => x.hasKey).map((x) => x.uid).concat(Object.keys(CH.groups).filter((g) => !CH.groups[g].left).map((g) => "g:" + g));
        for (const key of keys) {
          const c = await loadConv(key).catch(() => null); if (!c || !root.DPNotify) continue;
          const nm = key.startsWith("g:") ? (CH.groups[key.slice(2)] || {}).name || "a group" : (ps.find((p) => p.uid === key) || {}).name || "a colleague";
          const rk = key.startsWith("g:") ? key : "dm:" + key;
          for (const m of c.list) if (m.from !== meId() && !m.sys && String(m.at) > (CH.read[rk] || "") && String(m.at) > recent && !CH.notified.has(m.id)) {
            CH.notified.add(m.id); root.DPNotify.toSelf({ id: `dm-${m.id}`, type: "message", title: key.startsWith("g:") ? `New message in ${nm}` : `New message from ${nm}`, body: m.file ? "Sent a file." : "Open the chat to read it.", link: { chat: key } }).catch(() => {});
          }
        }
      }
      CH.lastErr = null;
    } catch (e) { CH.lastErr = e.message || String(e); }
    emit();
  }
  function on(fn) { CH.listeners.push(fn); }
  function emit() { for (const f of CH.listeners) try { f(); } catch (e) {} }
  function onLine() { CH.online = true; emit(); refresh().catch(() => {}); }
  function offLine() { CH.online = false; emit(); }
  async function start() {
    stop(); await loadRead().catch(() => {}); await loadGroups().catch(() => {}); await ensureKeys().catch((e) => { console.warn("chat keys", e); CH.cryptoOk = false; });
    CH.online = typeof navigator === "undefined" || navigator.onLine !== false; addEventListener("online", onLine); addEventListener("offline", offLine);
    await refresh().catch(() => {}); CH.ready = true; beat(true).catch(() => {});
    const tick = () => { refresh({ dms: true }).catch(() => {}); CH.timer = setTimeout(tick, CH.open ? 15000 : 60000); };
    CH.timer = setTimeout(tick, CH.open ? 15000 : 60000);
  }
  function stop() { clearTimeout(CH.timer); CH.timer = null; CH.ready = null; CH.notified = new Set(); CH.pair = {}; CH.priv = null; CH.convs = {}; CH.wall = []; CH.wallRaw = {}; CH.wallNewest = {}; CH.keys = {}; CH.groups = {}; CH.presence = {};
    try { removeEventListener("online", onLine); removeEventListener("offline", offLine); } catch (e) {} }
  function setOpen(v) { CH.open = !!v; if (v) { clearTimeout(CH.timer); const tick = () => { refresh().catch(() => {}); CH.timer = setTimeout(tick, CH.open ? 15000 : 60000); }; CH.timer = setTimeout(tick, 15000); } }
  async function setPresenceHidden(hidden) { await savePrefs({ hidePresence: !!hidden }); await beat(true); }

  root.DPChat = { CH, SYSTEM, PAGE, EDIT_HOURS, ensureKeys, pairFor, hasKey, loadWall, post, wallFile, system, people, loadConv, send, react, edit, remove, canEdit, canDelete, dmFile, unread, refresh, markRead, readKey,
    loadReceipts, createGroup, addMembers, leaveGroup, refreshMeta, togglePin, savePrefs, presenceOf, setPresenceHidden, fold, on, start, stop, setOpen, convOf };
})(typeof self !== "undefined" ? self : this);
