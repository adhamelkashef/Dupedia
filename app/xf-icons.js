/* X FORCE 2.0 "Snap" — icons and division marks (Session 2).
   Icons: 24 px grid, 2 px stroke, round ends, currentColor (brand book p.5). XF.icon() draws the existing 1.x set
   (DPUI.ICON) plus the additions below, so every screen uses one family.
   Division marks: traced from brand book p.5 on a 40-unit tile — a 2×2 grid of 15-unit blocks inside a 5-unit margin.
   Blocks are never rotated, outlined or shaded; they only snap into place (class is-snap). */
(function (root) {
  "use strict";
  const ADD = {
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
    warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>', minus: '<path d="M5 12h14"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>', arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>', chevronRight: '<path d="m9 6 6 6-6 6"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>', sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>', download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    payroll: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.5M18 14.5v.5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>', trendDown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4a4 4 0 0 1 3 3l-2.5 2.5"/>',
    quality: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    gearTurn: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    idcard: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    location: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>', attach: '<path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7"/>',
    react: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>',
    pin: '<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 15v6"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    shieldLock: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/>',
    building: '<path d="M4 21V5l8-2v18M12 9h8v12M4 21h16M8 8v.5M8 12v.5M8 16v.5M16 13v.5M16 17v.5"/>',
    play: '<path d="M7 5v14l11-7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  };

  /* Division marks (brand book p.5). k = brand division; the X FORCE departments map onto them below. */
  const B = {   // the four blocks inside the 40-unit tile
    q_tl: 'M20 5A15 15 0 0 0 5 20H20Z', sq_bl: 'M5 20H20V35H5Z', q_br: 'M20 20H35A15 15 0 0 1 20 35Z',
  };
  const MARKS = {
    playgrounds: { bg: "#B8D241", fg: "#262626", d: [B.q_tl, B.sq_bl, B.q_br] },
    softplay: { bg: "#F2643D", fg: "#262626", c: [[12.5, 12.5], [27.5, 12.5], [12.5, 27.5]] },
    arcades: { bg: "#F7B32B", fg: "#262626", d: ["M5 5H20V20H35V35H5Z"], c: [[27.5, 12.5]] },
    water: { bg: "#1E9FB0", fg: "#262626", d: ["M5 5H20V12.5A7.5 7.5 0 0 1 5 12.5Z", "M20 5H35V12.5A7.5 7.5 0 0 1 20 12.5Z", "M5 35V27.5A7.5 7.5 0 0 1 20 27.5V35Z", "M20 35V27.5A7.5 7.5 0 0 1 35 27.5V35Z"] },
    amusement: { bg: "#6C5CE7", fg: "#FFFFFF", d: ["M5 35V20A15 15 0 0 1 35 20V35Z"] },
  };
  /** X FORCE department → brand division mark (same colours as the 1.4.3 department signals). */
  const DEPT_MARK = { planner: "playgrounds", sales: "softplay", factory: "arcades", finance: "water", strategic: "amusement" };
  const DEPT_LABEL = { strategic: "Strategic", sales: "Sales & growth", finance: "Finance", factory: "Factory & engineering", planner: "Site Planner & products" };

  /** Icons that point along the reading direction; they mirror in right-to-left mode. */
  const DIRECTIONAL = ["arrowRight", "arrowLeft", "chevronRight", "send", "out"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const paths = (k) => ADD[k] || (root.DPUI && root.DPUI.ICON && root.DPUI.ICON[k]) || "";

  /** One icon as SVG markup. opts: { size: "sm"|"md"|"xl", cls, label } — without a label it is decorative. */
  function icon(k, opts = {}) {
    const cls = ["x-ic", opts.size ? "x-ic--" + opts.size : "", DIRECTIONAL.includes(k) ? "x-ic--dir" : "", opts.cls || ""].filter(Boolean).join(" ");
    const a11y = opts.label ? `role="img" aria-label="${esc(opts.label)}"` : 'aria-hidden="true"';
    return `<svg class="${cls}" viewBox="0 0 24 24" ${a11y}>${paths(k)}</svg>`;
  }
  /** A division mark. k: a department (strategic, sales, finance, factory, planner) or a brand division. opts: { size, snap, label, plain } —
      plain draws only the blocks in currentColor (for use on the department switcher). */
  function mark(k, opts = {}) {
    const m = MARKS[DEPT_MARK[k] || k]; if (!m) return "";
    const fg = opts.plain ? "currentColor" : m.fg;
    const shapes = (m.d || []).map((d) => `<path class="bk" d="${d}" fill="${fg}"/>`).concat((m.c || []).map(([x, y]) => `<circle class="bk" cx="${x}" cy="${y}" r="7.5" fill="${fg}"/>`)).join("");
    const cls = ["x-mark", opts.size ? "x-mark--" + opts.size : "", opts.snap ? "is-snap" : "", opts.cls || ""].filter(Boolean).join(" ");
    const label = opts.label || DEPT_LABEL[k];
    const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg class="${cls}" viewBox="0 0 40 40" ${a11y}>${opts.plain ? "" : `<rect width="40" height="40" fill="${m.bg}"/>`}${shapes}</svg>`;
  }
  /** Play a one-off icon state on an element that holds an .x-ic: ring (bell), draw (check), pop, turn. */
  function animate(el, state) {
    const ic = el && (el.classList && el.classList.contains("x-ic") ? el : el.querySelector(".x-ic, .x-mark")); if (!ic) return;
    const c = state === "snap" ? "is-snap" : "is-" + state;
    ic.classList.remove(c); void ic.getBoundingClientRect(); ic.classList.add(c);
    if (state !== "snap") setTimeout(() => ic.classList.remove(c), 900);
  }

  const XF = (root.XF = root.XF || {});
  Object.assign(XF, { icon, mark, animateIcon: animate, ICONS_ADDED: Object.keys(ADD), DEPT_MARK, DEPT_LABEL, DEPTS: Object.keys(DEPT_MARK) });
})(typeof self !== "undefined" ? self : this);
