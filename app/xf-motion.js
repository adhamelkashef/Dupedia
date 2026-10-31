/* X FORCE 2.0 "Snap" — motion helpers (Session 2). Motion answers an event: something arrived, changed, succeeded or failed.
   One snap per action; nothing loops while people work. With the system's reduced-motion setting every helper still
   updates the content but skips the movement. */
(function (root) {
  "use strict";
  const doc = root.document;
  const mq = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const reduced = () => !!mq.matches;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Replay a one-off state class (is-in, is-pop, is-changed, is-new, is-done…) on an element. */
  function play(el, cls = "is-in", ms = 900) {
    if (!el) return; el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls);
    if (ms) clearTimeout(el._xfT), (el._xfT = setTimeout(() => el.classList.remove(cls), ms));
  }

  /** Count a number up from 0 (or `from`) to `to` once, e.g. when a metric first appears. fmt formats the shown value.
      The final text is always exactly fmt(to); the animation is skipped with reduced motion or when the value is not a number. */
  function countUp(el, to, { from = 0, ms = 650, fmt = (v) => Math.round(v).toLocaleString("en-US") } = {}) {
    if (!el) return; const n = Number(to);
    if (!isFinite(n) || reduced() || !root.requestAnimationFrame) { el.textContent = isFinite(n) ? fmt(n) : String(to); return; }
    const t0 = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (t) => { const p = Math.min(1, (t - t0) / ms); el.textContent = fmt(p < 1 ? from + (n - from) * ease(p) : n); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  /** FLIP: animate children of `box` from their old to their new positions after `mutate()` re-orders or filters them.
      Children need a stable data-key. */
  function flip(box, mutate) {
    if (!box) return mutate && mutate();
    const first = new Map([...box.children].map((c) => [c.dataset.key, c.getBoundingClientRect()]));
    mutate && mutate();
    if (reduced()) return;
    [...box.children].forEach((c) => {
      const a = first.get(c.dataset.key), b = c.getBoundingClientRect();
      if (!a) { c.animate([{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.3,1.3,.5,1)" }); return; }
      const dx = a.left - b.left, dy = a.top - b.top; if (!dx && !dy) return;
      c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
  }

  /** Reveal a group of children one after another (cards arriving on a dashboard). Visible at rest; only the arrival moves. */
  function stagger(box, { sel = ":scope > *", step = 40, max = 10 } = {}) {
    if (!box || reduced()) return;
    [...box.querySelectorAll(sel)].slice(0, max).forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: i * step, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" }));
  }

  /** Tabs with a sliding department-coloured underline. Markup: .x-tabs > button.x-tab[aria-selected] …; returns a setter. */
  function tabs(box, onChange) {
    if (!box) return () => {};
    let ink = box.querySelector(".x-tabs__ink"); if (!ink) { ink = doc.createElement("span"); ink.className = "x-tabs__ink"; box.appendChild(ink); }
    const all = () => [...box.querySelectorAll(".x-tab")];
    const place = () => { const on = all().find((t) => t.getAttribute("aria-selected") === "true"); if (!on) return; ink.style.width = on.offsetWidth + "px"; ink.style.transform = `translateX(${on.offsetLeft}px)`; };
    const set = (tab) => { all().forEach((t) => { const s = t === tab; t.setAttribute("aria-selected", s); t.tabIndex = s ? 0 : -1; }); place(); onChange && onChange(tab.dataset.tab, tab); };
    box.setAttribute("role", "tablist");
    all().forEach((t) => { t.setAttribute("role", "tab"); t.onclick = () => set(t); });
    box.addEventListener("keydown", (e) => {
      const list = all(), i = list.findIndex((t) => t === doc.activeElement); if (i < 0) return;
      const rtl = getComputedStyle(box).direction === "rtl", next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
      if (next) { e.preventDefault(); const t = list[(i + next + list.length) % list.length]; t.focus(); set(t); }
    });
    if (root.ResizeObserver) new ResizeObserver(place).observe(box);
    requestAnimationFrame(place);
    return (key) => { const t = all().find((x) => x.dataset.tab === key); t && set(t); };
  }

  /** Short toast in the new style. kind: "ok" | "err" | "info" | "warn". action: { label, fn }. Returns a close function. */
  function toast(msg, { kind = "ok", action = null, ms = 4200 } = {}) {
    const box = root.XF.load && root.XF.load.toastBox ? root.XF.load.toastBox() : (doc.querySelector(".x-toasts") || doc.body.appendChild(Object.assign(doc.createElement("div"), { className: "x-toasts" })));
    const t = doc.createElement("div"); t.className = "x-toast"; t.setAttribute("role", kind === "err" ? "alert" : "status");
    t.innerHTML = `<span class="x-ball x-ball--${esc(kind)}"></span><span>${esc(msg)}</span>`;
    const close = () => { if (!t.isConnected) return; if (reduced()) return t.remove(); t.classList.add("is-leaving"); setTimeout(() => t.remove(), 220); };
    if (action) { const b = doc.createElement("button"); b.type = "button"; b.textContent = action.label; b.onclick = () => { close(); action.fn(); }; t.appendChild(b); }
    box.appendChild(t); setTimeout(close, action ? ms * 2 : ms);
    return close;
  }

  /** Button feedback for an async action: busy while it runs, a snap when it succeeds. Resolves with the action's result. */
  async function busy(btn, fn) {
    if (!btn) return fn();
    btn.classList.add("is-busy"); btn.setAttribute("aria-busy", "true"); btn.disabled = true;
    try { const r = await fn(); btn.classList.remove("is-busy"); play(btn, "is-done", 400); return r; }
    finally { btn.classList.remove("is-busy"); btn.removeAttribute("aria-busy"); btn.disabled = false; }
  }

  /** Show/hide a password field. Markup: .x-input-wrap > input.x-input[type=password] + button.x-reveal */
  function reveal(wrap) {
    const inp = wrap && wrap.querySelector("input"), b = wrap && wrap.querySelector(".x-reveal"); if (!inp || !b) return;
    const sync = () => { const shown = inp.type === "text"; b.setAttribute("aria-pressed", shown); b.innerHTML = (root.XF.icon ? root.XF.icon(shown ? "eyeOff" : "eye", { size: "sm" }) : "") + `<span>${shown ? "Hide" : "Show"}</span>`; b.setAttribute("aria-label", shown ? "Hide password" : "Show password"); };
    b.type = "button"; b.onclick = () => { inp.type = inp.type === "password" ? "text" : "password"; sync(); inp.focus(); }; sync();
  }

  /** Employee ID card: click or Enter/Space flips between the warm back (details) and the quiet front (logo). */
  function idcard(el) {
    if (!el) return;
    const sync = () => el.setAttribute("aria-label", (el.dataset.name || "Employee") + " ID card, " + (el.classList.contains("is-front") ? "logo side" : "details side") + ". Activate to flip.");
    el.onclick = () => { el.classList.toggle("is-front"); sync(); }; sync();
  }

  /** Success moment inside a dialog or panel: a lime ball with a check that draws itself, a title and one line.
      Resolves after `ms` (shorter with reduced motion) so the caller can close the dialog afterwards. */
  function confirm(box, { title = "Done", body = "", ms = 1300 } = {}) {
    if (!box) return Promise.resolve();
    const ic = root.XF && root.XF.icon ? root.XF.icon("check", { cls: "is-draw" }) : "";
    box.innerHTML = `<div class="x-state x-state--success is-in" role="status"><div class="x-state__glyph">${ic}</div><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}</div>`;
    return new Promise((r) => setTimeout(r, reduced() ? 600 : ms));
  }

  const XF = (root.XF = root.XF || {});
  XF.motion = { reduced, play, countUp, flip, stagger, tabs, toast, busy, reveal, idcard, confirm };
})(typeof self !== "undefined" ? self : this);
