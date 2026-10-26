/* X FORCE 1.0 (Dupedia) — company messaging: Company Wall, "Dupedia Updates" system posts, private chat.

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
       • only the two participants can read a conversation. Administrators cannot read private chats either (the platform
         offers no way to grant them access without also granting every employee) — see README › Messaging.
     If a person has never opened X FORCE 1.0 they have no key yet, and the app says so instead of sending. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth;
  const now = () => new Date().toISOString();
  const meId = () => (AU().A.me || {}).id;
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CH = { notified: new Set(), wall: [], convs: {}, keys: {}, pair: {}, priv: null, pub: null, read: {}, ready: null, listeners: [], timer: null, open: false, lastSeenDm: {}, cryptoOk: !!(root.crypto && root.crypto.subtle) };
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    CH.pair[other] = { conv: "c" + hex(pathBits).slice(0, 40), key, other }; return CH.pair[other];
  }
  async function seal(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))); return { iv: b64(iv), ct: b64(ct) }; }
  async function open(key, d) { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(d.iv) }, key, unb64(d.ct)); return JSON.parse(dec.decode(pt)); }
  async function hasKey(uid) { if (CH.keys[uid] !== undefined) return CH.keys[uid]; const d = await DS().tryGet(`keys/${uid}`); CH.keys[uid] = !!(d && d.jwk); return CH.keys[uid]; }

  /* ---------------- read markers (private to me) ---------------- */
  async function loadRead() { const me = meId(); if (!me) return; CH.read = (await DS().tryGet(`data/users/${me}/chatread`)) || {}; }
  async function markRead(key) { const me = meId(); CH.read[key] = now(); emit(); await DS().set(`data/users/${me}/chatread`, CH.read).catch(() => {}); }

  /* ---------------- company wall ---------------- */
  async function loadWall() {
    const dir = AU().A.directory.filter((r) => r.uid); const ids = [...new Set(dir.map((r) => r.uid).concat(meId() ? [meId()] : []))];
    const lists = await Promise.all(ids.map((u) => DS().tryList(`wall/${u}/m`).then((l) => l.map((x) => Object.assign({ id: x.id, author: u }, x.data)))));
    const all = lists.flat(), seen = new Map();
    for (const m of all.sort((a, b) => String(a.at).localeCompare(String(b.at)))) { const k = m.system ? "sys:" + m.event : m.author + ":" + m.id; if (!seen.has(k)) seen.set(k, m); }
    CH.wall = [...seen.values()].slice(-300); emit(); return CH.wall;
  }
  async function post(text, file) {
    const me = meId(); text = String(text || "").trim(); if (!text && !file) throw new Error("Write a message or attach a file.");
    if (text.length > 4000) throw new Error("Messages are limited to 4,000 characters.");
    const id = rid("m-"), doc = { text, at: now(), by: me, system: false };
    if (file) { const fid = rid("f-"); await root.DPOrders.putFile(`wall/${me}/f/${fid}`, file); doc.file = { fid, name: file.name, type: file.type, size: file.size }; }
    await DS().set(`wall/${me}/m/${id}`, doc); CH.wall.push(Object.assign({ id, author: me }, doc)); emit(); return id;
  }
  async function wallFile(m) { return m.file ? root.DPOrders.getFile(`wall/${m.author}/f/${m.file.fid}`) : null; }
  /** Dupedia Updates: post once per event key. Text must never contain money, commission or personal data. */
  async function system(event, text, link) {
    const me = meId(); if (!me || !wallOn()) return false;
    if (/\b(EGP|USD|EUR|commission|salary|national id)\b|\d{3,}[,.]\d{3}/i.test(text)) throw new Error("System posts must not contain financial or personal details.");
    const id = "sys-" + String(event).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 150), path = `wall/${me}/m/${id}`;
    if (await DS().tryGet(path)) return false;
    if (CH.wall.some((m) => m.system && m.event === event)) return false;
    const doc = { system: true, event, text: String(text).slice(0, 400), link: link || null, at: now(), by: me };
    await DS().set(path, doc); CH.wall.push(Object.assign({ id, author: me }, doc)); emit(); return true;
  }

  /* ---------------- private chat ---------------- */
  async function people() {
    const me = meId(), dir = AU().A.directory.filter((r) => r.uid && r.uid !== me && r.active !== false);
    await Promise.all(dir.map((r) => hasKey(r.uid)));
    return dir.map((r) => ({ uid: r.uid, name: AU().fullName(r) || r.displayName || "Colleague", title: r.title || (AU().roleOf(r.role) || {}).label || "", hasKey: CH.keys[r.uid] }));
  }
  async function loadConv(other) {
    const p = await pairFor(other); if (!p) return null;
    const l = await DS().tryList(`dmx/${p.conv}/m`), c = CH.convs[other] || { other, msgs: {}, list: [] };
    for (const x of l) {
      if (c.msgs[x.id]) continue;
      try { const m = await open(p.key, x.data); if (m.from !== x.data.from || ![meId(), other].includes(m.from)) continue; c.msgs[x.id] = Object.assign({ id: x.id, at: x.data.at }, m); }
      catch (e) { /* not decryptable with our key: ignore */ }
    }
    c.list = Object.values(c.msgs).sort((a, b) => String(a.at).localeCompare(String(b.at))); CH.convs[other] = c; return c;
  }
  async function send(other, text, file) {
    const me = meId(); text = String(text || "").trim(); if (!text && !file) throw new Error("Write a message or attach a file.");
    if (text.length > 4000) throw new Error("Messages are limited to 4,000 characters.");
    const p = await pairFor(other); if (!p) throw new Error("This colleague has not opened X FORCE yet, so a private conversation cannot be started. Try again after they sign in.");
    const id = rid("m-"), at = now(), body = { from: me, to: other, text, at };
    if (file) {
      const fid = rid("f-"), sealed = await seal(p.key, { dataUrl: file.dataUrl }), parts = [];
      for (let i = 0; i < sealed.ct.length; i += 180000) parts.push(sealed.ct.slice(i, i + 180000));
      for (let i = 0; i < parts.length; i++) await DS().set(`dmx/${p.conv}/f/${fid}/c/${String(i).padStart(3, "0")}`, { n: i, total: parts.length, iv: sealed.iv, part: parts[i] });
      body.file = { fid, name: file.name, type: file.type, size: file.size };
    }
    const sealed = await seal(p.key, body);
    await DS().set(`dmx/${p.conv}/m/${id}`, { from: me, at, iv: sealed.iv, ct: sealed.ct });
    const c = CH.convs[other] || { other, msgs: {}, list: [] }; c.msgs[id] = Object.assign({ id }, body); c.list = Object.values(c.msgs).sort((a, b) => String(a.at).localeCompare(String(b.at))); CH.convs[other] = c;
    await markRead("dm:" + other); emit(); return id;
  }
  async function dmFile(other, f) {
    const p = await pairFor(other); if (!p) return null;
    const l = (await DS().tryList(`dmx/${p.conv}/f/${f.fid}/c`)).sort((a, b) => a.data.n - b.data.n); if (!l.length || l.length !== l[0].data.total) return null;
    const o = await open(p.key, { iv: l[0].data.iv, ct: l.map((x) => x.data.part).join("") }); return { name: f.name, type: f.type, size: f.size, dataUrl: o.dataUrl };
  }

  /* ---------------- unread, polling ---------------- */
  function unread() {
    const me = meId(), wr = CH.read.wall || "";
    const wall = CH.wall.filter((m) => m.author !== me && String(m.at) > wr).length;
    const dms = {}; let dm = 0;
    for (const [other, c] of Object.entries(CH.convs)) { const r = CH.read["dm:" + other] || ""; dms[other] = c.list.filter((m) => m.from !== me && String(m.at) > r).length; dm += dms[other]; }
    return { wall, dm, dms, total: wall + dm };
  }
  async function refresh({ dms = true } = {}) {
    await loadWall().catch(() => {});
    if (dms && CH.cryptoOk) {
      const ps = await people().catch(() => []);
      const recent = new Date(Date.now() - 7 * 864e5).toISOString();
      for (const p of ps.filter((x) => x.hasKey)) {
        const c = await loadConv(p.uid).catch(() => null); if (!c || !root.DPNotify) continue;
        // unread messages from the colleague → one notification each (deterministic id; remembered so it is created once)
        for (const m of c.list) if (m.from !== meId() && String(m.at) > (CH.read["dm:" + p.uid] || "") && String(m.at) > recent && !CH.notified.has(m.id)) {
          CH.notified.add(m.id); root.DPNotify.toSelf({ id: `dm-${m.id}`, type: "message", title: `New message from ${p.name}`, body: m.file ? "Sent you a file." : "Open the chat to read it.", link: { chat: p.uid } }).catch(() => {});
        }
      }
    }
    emit();
  }
  function on(fn) { CH.listeners.push(fn); }
  function emit() { for (const f of CH.listeners) try { f(); } catch (e) {} }
  async function start() {
    stop(); await loadRead().catch(() => {}); await ensureKeys().catch((e) => { console.warn("chat keys", e); CH.cryptoOk = false; });
    await refresh().catch(() => {}); CH.ready = true;
    const tick = () => { refresh({ dms: true }).catch(() => {}); CH.timer = setTimeout(tick, CH.open ? 15000 : 60000); };
    CH.timer = setTimeout(tick, CH.open ? 15000 : 60000);
  }
  function stop() { clearTimeout(CH.timer); CH.timer = null; CH.ready = null; CH.notified = new Set(); CH.pair = {}; CH.priv = null; CH.convs = {}; CH.wall = []; CH.keys = {}; }
  function setOpen(v) { CH.open = !!v; if (v) { clearTimeout(CH.timer); const tick = () => { refresh().catch(() => {}); CH.timer = setTimeout(tick, CH.open ? 15000 : 60000); }; CH.timer = setTimeout(tick, 15000); } }

  root.DPChat = { CH, SYSTEM, ensureKeys, pairFor, hasKey, loadWall, post, wallFile, system, people, loadConv, send, dmFile, unread, refresh, markRead, on, start, stop, setOpen };
})(typeof self !== "undefined" ? self : this);
