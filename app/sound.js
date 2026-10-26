/* X FORCE 1.1 (Dupedia) — notification sound. A short two-note chime synthesised with Web Audio (no audio file to download).
   Browsers only allow audio after the person has interacted with the page, so the audio context is created on the first
   click or key press; until then (or when the browser refuses) the app stays silent and relies on the visual indicators.
   Each notification id chimes at most once, minor updates never chime, and bursts are rate-limited to one chime per 4 s.
   Preferences (on/off, volume, which kinds chime) are kept per person in this browser. */
(function (root) {
  "use strict";
  const KEY = "xf.sound";
  const DEF = { on: true, volume: 0.5, kinds: { message: true, payment: true, order: true, engineering: true, followup: true, lead: false, commission: true, other: false } };
  let ctx = null, unlocked = false, last = 0; const played = new Set();
  function prefs() { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v ? Object.assign({}, DEF, v, { kinds: Object.assign({}, DEF.kinds, v.kinds || {}) }) : JSON.parse(JSON.stringify(DEF)); } catch (e) { return JSON.parse(JSON.stringify(DEF)); } }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} for (const f of listeners) try { f(p); } catch (e) {} }
  const listeners = [];
  function unlock() {
    if (unlocked) return; try { const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; ctx = ctx || new AC(); if (ctx.state === "suspended") ctx.resume().catch(() => {}); unlocked = true; } catch (e) { ctx = null; }
  }
  if (root.addEventListener) { root.addEventListener("pointerdown", unlock, { once: false, passive: true }); root.addEventListener("keydown", unlock, { once: false }); }
  function chime(kind = "normal", volume) {
    if (!ctx || ctx.state !== "running") return false;
    const v = Math.max(0, Math.min(1, volume == null ? prefs().volume : volume)) * 0.22, t = ctx.currentTime;
    const notes = kind === "high" ? [[880, 0], [1175, 0.12], [1397, 0.24]] : [[784, 0], [1047, 0.13]];
    for (const [f, d] of notes) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(v, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.32); o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.35); }
    return true;
  }
  const kindOf = (n) => ({ message: "message", chat: "message", payment: "payment", order: "order", deal: "order", engineering: "engineering", followup: "followup", lead: "lead", commission: "commission" }[n.type] || "other");
  /** Called for each NEW notification (never for the ones already there when the app opened). */
  function notify(n) {
    if (!n || played.has(n.id)) return false; played.add(n.id);
    const p = prefs(); if (!p.on || !p.kinds[kindOf(n)]) return false;
    if (Date.now() - last < 4000) return false; last = Date.now();
    return chime(n.priority === "high" ? "high" : "normal");
  }
  function seen(ids) { for (const id of ids) played.add(id); }
  function test() { unlock(); const ok = chime("normal"); return ok; }
  root.DPSound = { prefs, save, notify, seen, test, unlock, kindOf, on: (f) => listeners.push(f), get ready() { return !!(ctx && ctx.state === "running"); } };
})(typeof self !== "undefined" ? self : this);
