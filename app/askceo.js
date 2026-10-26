/* X FORCE 1.1 (Dupedia) — Ask CEO: a private, persistent channel between each employee and the CEO.

   askceo/<uid>/m/<mid>            messages of the conversation between employee <uid> and the CEO (both directions)
   askceo/<uid>/f/<fid>/c/<n>      attachments (chunked, like every other private file)
   askceo/<uid>/meta/emp|ceo       read markers (last read time) for each side

   Database rules: askceo is readable and writable only by administrators; askceo/{self} by its employee. No other employee
   can read it, and nothing from it is posted to the Company Wall. The CEO account (and any other administrators allowed to
   read it) is chosen in Admin › Settings; the app shows the inbox only to them. Limitation: the platform cannot tell one
   administrator from another, so every Editor/Owner of the page could technically read the documents — see the README. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, NT = () => root.DPNotify;
  const now = () => new Date().toISOString();
  const me = () => AU().A.me || {};
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const S = { threads: [], at: 0, listeners: [] };
  const cfg = () => ((root.DPUI && root.DPUI.App.config.settings.askCeo) || {});
  /** The CEO's account: the one chosen in Settings, else the page owner if they are in the directory, else the first active administrator. */
  function ceoUid() {
    const dir = AU().A.directory.filter((r) => r.uid && r.active !== false), c = cfg().ceo;
    if (c && dir.some((r) => r.uid === c)) return c;
    const owner = dir.find((r) => r.bootstrap && AU().baseOf(r.role) === "admin"); if (owner) return owner.uid;
    const adm = dir.find((r) => AU().baseOf(r.role) === "admin"); return adm ? adm.uid : null;
  }
  const isCeo = () => !!me().id && me().id === ceoUid();
  /** May this person open the CEO inbox? The CEO and the administrators named in Settings. */
  const canReadInbox = () => AU().isAdmin() && (isCeo() || (cfg().readers || []).includes(me().id));
  const ceoName = () => AU().nameSync(ceoUid()) || "the CEO";
  const MAXLEN = 2000;

  async function load(uid, { limit = 60 } = {}) {
    const db = DS().st.db; let rows;
    if (db && db.collection) { try { const s = await db.collection(`askceo/${uid}/m`).orderBy("at", "desc").limit(limit).get(); rows = s.docs.map((d) => Object.assign({ id: d.id }, d.data())); } catch (e) { rows = null; } }
    if (!rows) rows = (await DS().tryList(`askceo/${uid}/m`)).map((x) => Object.assign({ id: x.id }, x.data));
    return rows.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-limit);
  }
  const marker = (uid, side) => DS().tryGet(`askceo/${uid}/meta/${side}`).then((x) => (x && x.lastRead) || "");
  /** Employee → CEO, or CEO (and authorised administrators) → employee. */
  async function send(uid, text, file = null) {
    text = String(text || "").trim().slice(0, MAXLEN); if (!text && !file) throw new Error("Write a message or attach a file.");
    const mine = me().id, toCeo = uid === mine;
    if (!toCeo && !canReadInbox()) throw new Error("Only the CEO answers in this channel.");
    if (toCeo && !ceoUid()) throw new Error("No CEO account is set up yet. Ask an administrator to choose one in Settings.");
    const mid = rid("m-"), msg = { from: mine, text, at: now(), toCeo };
    if (file) { const fid = rid("f-"); await root.DPOrders.putFile(`askceo/${uid}/f/${fid}`, file); msg.file = { fid, name: file.name, type: file.type, size: file.size }; }
    await DS().set(`askceo/${uid}/m/${mid}`, msg);
    await DS().set(`askceo/${uid}/meta/${toCeo ? "emp" : "ceo"}`, { lastRead: msg.at }).catch(() => {});
    const short = text ? (text.length > 120 ? text.slice(0, 117) + "…" : text) : `Attachment: ${file.name}`;
    if (NT()) {
      if (toCeo) { const to = [ceoUid()].concat((cfg().readers || []).filter((x) => x !== ceoUid())); await NT().deliver(to, { id: `askceo-${mid}`, type: "message", priority: "high", title: `Ask CEO — ${me().name || "an employee"}`, body: short, link: { askceo: uid }, ref: null }).catch(() => {}); }
      else await NT().deliver(uid, { id: `askceo-r-${mid}`, type: "message", priority: "high", title: `${ceoName()} replied`, body: short, link: { assist: "ceo" }, ref: null }).catch(() => {});
    }
    return Object.assign({ id: mid }, msg);
  }
  async function file(uid, m) { return m && m.file ? root.DPOrders.getFile(`askceo/${uid}/f/${m.file.fid}`) : null; }
  async function markRead(uid, side) { await DS().set(`askceo/${uid}/meta/${side}`, { lastRead: now() }).catch(() => {}); }
  /** Unread for the employee: CEO replies after their read marker. */
  async function unreadMine() { const uid = me().id; if (!uid) return 0; const [l, mk] = await Promise.all([load(uid, { limit: 40 }), marker(uid, "emp")]); return l.filter((m) => m.from !== uid && m.at > mk).length; }
  /** CEO inbox: one thread per employee who has written, newest first, with unread counts. */
  async function threads() {
    if (!canReadInbox()) return [];
    const dir = AU().A.directory.filter((r) => r.uid && r.uid !== ceoUid());
    const out = await Promise.all(dir.map(async (r) => { const l = await load(r.uid, { limit: 30 }); if (!l.length) return null; const mk = await marker(r.uid, "ceo"); const last = l[l.length - 1];
      return { uid: r.uid, name: AU().nameSync(r.uid), last, unread: l.filter((m) => m.from === r.uid && m.at > mk).length }; }));
    S.threads = out.filter(Boolean).sort((a, b) => String(b.last.at).localeCompare(String(a.last.at))); S.at = Date.now(); return S.threads;
  }
  const inboxUnread = () => (S.threads || []).reduce((a, t) => a + t.unread, 0);
  root.DPAskCeo = { ceoUid, isCeo, canReadInbox, ceoName, load, send, file, markRead, unreadMine, threads, inboxUnread, marker, MAXLEN, S };
})(typeof self !== "undefined" ? self : this);
