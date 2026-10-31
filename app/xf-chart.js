/* X FORCE 2.0 "Snap" — chart primitives (Session 2). Inline SVG, no library.
   Colour: stone for ordinary marks, the page's ONE department colour for the key mark, charcoal for lines.
   Charts only draw values the caller passes in — they never invent, smooth or extrapolate data. */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (isFinite(+v) ? +v : 0);
  const fmt0 = (v) => Math.round(v).toLocaleString("en-US");
  /** A "nice" axis maximum and tick step for values up to max. */
  function niceMax(max, ticks = 4) {
    if (!(max > 0)) return { max: 1, step: 1 };
    const raw = max / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    return { max: Math.ceil(max / step) * step, step };
  }
  const animateIn = (svg) => { if (!svg) return; svg.classList.remove("is-in"); void svg.getBoundingClientRect(); svg.classList.add("is-in"); };

  /** Vertical bars. data: [{ label, value, key? }]. opts: { height, fmt, label (accessible title), showValues } */
  function bars(el, data, opts = {}) {
    if (!el) return;
    if (!el.clientWidth && !opts._later && root.requestAnimationFrame) { requestAnimationFrame(() => bars(el, data, Object.assign({}, opts, { _later: 1 }))); return; }   // not laid out yet: draw at its real width
    if (opts.empty && !data.some((d) => num(d.value) > 0)) { el.innerHTML = `<div class="x-state x-state--compact"><p>${esc(opts.empty)}</p></div>`; return; } const W = Math.max(280, Math.round(el.clientWidth || 560)), H = opts.height || 220, padL = 44, padB = 26, padT = 14, padR = 8, f = opts.fmt || fmt0;
    const vals = data.map((d) => num(d.value)), ax = niceMax(Math.max(0, ...vals)), iw = W - padL - padR, ih = H - padT - padB;
    const bw = data.length ? iw / data.length : iw, gap = Math.min(14, bw * .28), y = (v) => padT + ih - (v / ax.max) * ih;
    let g = ""; for (let v = 0; v <= ax.max + 1e-9; v += ax.step) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(f(v))}</text>`;
    const b = data.map((d, i) => { const v = Math.max(0, num(d.value)), x = padL + i * bw + gap / 2, h = Math.max(v > 0 ? 2 : 0, padT + ih - y(v));
      return `<g><title>${esc(d.label)}: ${esc(f(v))}</title><rect class="bar${d.key ? " is-key" : ""}" x="${x}" y="${padT + ih - h}" width="${Math.max(2, bw - gap)}" height="${h}" rx="3" style="animation-delay:${i * 40}ms"/>`
        + (opts.showValues ? `<text class="val" x="${x + (bw - gap) / 2}" y="${padT + ih - h - 6}" text-anchor="middle">${esc(f(v))}</text>` : "")
        + `<text x="${x + (bw - gap) / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text></g>`; }).join("");
    el.innerHTML = `<svg class="x-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Bar chart")}">${g}${b}</svg>`;
    animateIn(el.firstChild);
  }

  /** Paired bars per period (e.g. money in vs money out). data: [{ label, a, b }]; opts: { la, lb, fmt, label, empty } */
  function pairs(el, data, opts = {}) {
    if (!el) return;
    if (!el.clientWidth && !opts._later && root.requestAnimationFrame) { requestAnimationFrame(() => pairs(el, data, Object.assign({}, opts, { _later: 1 }))); return; }   // not laid out yet: draw at its real width
    if (opts.empty && !data.some((d) => num(d.a) > 0 || num(d.b) > 0)) { el.innerHTML = `<div class="x-state x-state--compact"><p>${esc(opts.empty)}</p></div>`; return; }
    const W = Math.max(280, Math.round(el.clientWidth || 560)), H = opts.height || 220, padL = 48, padB = 26, padT = 14, padR = 8, f = opts.fmt || fmt0;
    const ax = niceMax(Math.max(0, ...data.map((d) => Math.max(num(d.a), num(d.b))))), iw = W - padL - padR, ih = H - padT - padB, y = (v) => padT + ih - (v / ax.max) * ih;
    const gw = data.length ? iw / data.length : iw, bw = Math.max(3, Math.min(22, (gw - 12) / 2));
    let g = ""; for (let v = 0; v <= ax.max + 1e-9; v += ax.step) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(f(v))}</text>`;
    const b = data.map((d, i) => { const cx = padL + i * gw + gw / 2, A = Math.max(0, num(d.a)), B = Math.max(0, num(d.b)), ha = padT + ih - y(A), hb = padT + ih - y(B);
      return `<g><title>${esc(d.label)}: ${esc(opts.la || "A")} ${esc(f(A))} · ${esc(opts.lb || "B")} ${esc(f(B))}</title><rect class="bar is-key" x="${cx - bw - 1}" y="${padT + ih - ha}" width="${bw}" height="${Math.max(A > 0 ? 2 : 0, ha)}" rx="2" style="animation-delay:${i * 40}ms"/><rect class="bar bar--b" x="${cx + 1}" y="${padT + ih - hb}" width="${bw}" height="${Math.max(B > 0 ? 2 : 0, hb)}" rx="2" style="animation-delay:${i * 40 + 20}ms"/><text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text></g>`; }).join("");
    el.innerHTML = `<svg class="x-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Chart")}">${g}${b}</svg><ul class="x-legend"><li><i style="background:var(--x-dept)"></i>${esc(opts.la || "A")}</li><li><i style="background:var(--x-charcoal)"></i>${esc(opts.lb || "B")}</li></ul>`;
    animateIn(el.firstChild);
  }

  /** Line with a soft department area and an emphasised last point. data: [{ label, value }]. */
  function line(el, data, opts = {}) {
    if (!el) return;
    if (!el.clientWidth && !opts._later && root.requestAnimationFrame) { requestAnimationFrame(() => line(el, data, Object.assign({}, opts, { _later: 1 }))); return; }   // not laid out yet: draw at its real width
    if (opts.empty && !data.some((d) => num(d.value) > 0)) { el.innerHTML = `<div class="x-state x-state--compact"><p>${esc(opts.empty)}</p></div>`; return; } const W = Math.max(280, Math.round(el.clientWidth || 560)), H = opts.height || 200, padL = 44, padB = 26, padT = 16, padR = 14, f = opts.fmt || fmt0;
    if (!data.length) { el.innerHTML = ""; return; }
    const vals = data.map((d) => num(d.value)), ax = niceMax(Math.max(0, ...vals)), iw = W - padL - padR, ih = H - padT - padB;
    const x = (i) => padL + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw), y = (v) => padT + ih - (v / ax.max) * ih;
    let g = ""; for (let v = 0; v <= ax.max + 1e-9; v += ax.step) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(f(v))}</text>`;
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`), last = data.length - 1;
    const every = Math.ceil(data.length / 8), labels = data.map((d, i) => (i % every === 0 || i === last ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : "")).join("");
    el.innerHTML = `<svg class="x-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Line chart")}">${g}
      <path class="area" d="M${pts.join("L")}L${x(last)},${padT + ih}L${x(0)},${padT + ih}Z"/><path class="line" d="M${pts.join("L")}"/>
      <circle class="end" cx="${x(last)}" cy="${y(vals[last])}" r="5"><title>${esc(data[last].label)}: ${esc(f(vals[last]))}</title></circle>${labels}</svg>`;
    const p = el.querySelector(".line"); if (p && p.getTotalLength) p.style.setProperty("--_len", Math.ceil(p.getTotalLength()));
    animateIn(el.firstChild);
  }

  /** Small sparkline (no axes) for a metric tile. values: number[] */
  function spark(el, values, opts = {}) {
    if (!el || !values || values.length < 2) { if (el) el.innerHTML = ""; return; }
    const W = 120, H = 32, max = Math.max(...values.map(num)), min = Math.min(...values.map(num)), span = max - min || 1;
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((num(v) - min) / span) * (H - 6)).toFixed(1)}`);
    const [lx, ly] = pts[pts.length - 1].split(",");
    el.innerHTML = `<svg class="x-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.label || "Trend")}"><path class="line" d="M${pts.join("L")}" style="stroke-width:1.75"/><circle class="end" cx="${lx}" cy="${ly}" r="3"/></svg>`;
  }

  /** Donut for a share of a whole. segs: [{ label, value, color? }]; first segment uses the department colour unless given. */
  function donut(el, segs, opts = {}) {
    if (!el) return; const size = opts.size || 140, r = 15.9155, total = segs.reduce((s, x) => s + Math.max(0, num(x.value)), 0);
    const col = (s, i) => s.color || (i === 0 ? "var(--x-dept)" : i === 1 ? "var(--x-charcoal)" : i === 2 ? "var(--x-line-strong)" : "var(--x-stone)");
    let off = 0; const arcs = total > 0 ? segs.map((s, i) => { const p = (Math.max(0, num(s.value)) / total) * 100; const a = `<circle class="seg" r="${r}" cx="21" cy="21" stroke="${col(s, i)}" stroke-width="6" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${-off}"><title>${esc(s.label)}: ${esc((opts.fmt || fmt0)(num(s.value)))}</title></circle>`; off += p; return a; }).join("") : "";
    el.innerHTML = `<div class="x-donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 42 42" width="${size}" height="${size}" role="img" aria-label="${esc(opts.label || "Share")}"><circle r="${r}" cx="21" cy="21" stroke="var(--x-stone)" stroke-width="6"/>${arcs}</svg><b>${esc(opts.center != null ? opts.center : total > 0 ? Math.round((num(segs[0].value) / total) * 100) + "%" : "—")}</b></div>
      <ul class="x-legend">${segs.map((s, i) => `<li><i style="background:${col(s, i)}"></i>${esc(s.label)} · <span class="x-num">${esc((opts.fmt || fmt0)(num(s.value)))}</span></li>`).join("")}</ul>`;
  }

  /** Stage flow (pipeline / production): counts per stage in sequence. stages: [{ label, value, key? }] */
  function flow(el, stages, opts = {}) {
    if (!el) return;
    el.innerHTML = `<div class="x-flow" role="list" aria-label="${esc(opts.label || "Stages")}">${stages.map((s) => `<div role="listitem" class="${s.key ? "is-key" : ""}"><b class="x-num">${esc((opts.fmt || fmt0)(num(s.value)))}</b><span>${esc(s.label)}</span></div>`).join("")}</div>`;
  }

  const XF = (root.XF = root.XF || {});
  XF.chart = { bars, pairs, line, spark, donut, flow, niceMax };
})(typeof self !== "undefined" ? self : this);
