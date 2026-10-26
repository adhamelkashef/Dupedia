/* Dupedia Site Planner 2.0 — editor canvas: view, tools, hit testing, selection, drawing and editing.
   Rendering is delegated to DPPlan (shared with exports). Adapted from the v1 planner canvas (pan/zoom/pinch, snapping, alignment guides). */
/* global DPGeom, DPModel, DPCat, DPPlan, DPPen */
(function (root) {
  "use strict";
  const G = DPGeom, M = DPModel, S = M.S;
  const C = {
    cv: null, ctx: null, W: 0, H: 0, dpr: 1, v: { scale: 20, ox: 60, oy: 60 },
    tool: "select", mode: null, modeData: null, modeCb: null,
    show: { grid: true, labels: true, dims: true, zones: true, ref: true, cad: true }, displayMode: "design",
    snap: true, step: 0.5, angle: 15, guides: true, ortho: false,
    editVerts: null,   // id of line/area being vertex-edited, or "site"
    selVertex: -1, guidesNow: [], measure: null, marquee: null, ghost: null, hoverId: null,
    validation: { issues: [], per: {}, counts: { error: 0, warning: 0, info: 0 } },
    refImg: null, refSrc: null, clipboard: null, readOnly: false,
  };
  let dirty = false;
  const req = () => { if (!dirty) { dirty = true; requestAnimationFrame(frame); } };
  function frame() { if (!dirty) return; dirty = false; render(); M.emit("view", C.v); }
  const toS = (p, v = C.v) => [p[0] * v.scale + v.ox, p[1] * v.scale + v.oy];
  const toW = (s, v = C.v) => [(s[0] - v.ox) / v.scale, (s[1] - v.oy) / v.scale];
  function evtPt(e) { const r = C.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  /* ---------------- render ---------------- */
  function render() {
    const ctx = C.ctx, d = C.dpr; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = C.displayMode === "presentation" ? "#EFEDE6" : "#F3F2EC"; ctx.fillRect(0, 0, C.W, C.H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);   // the pen emits device pixels itself
    if (S.refImage && C.refSrc !== S.refImage) { C.refImg = new Image(); C.refImg.onload = req; C.refImg.src = S.refImage; C.refSrc = S.refImage; }
    const P = new DPPen({ kind: "canvas", ctx, minLine: 0.5 });
    P.setMatrix([C.v.scale * d, 0, 0, C.v.scale * d, C.v.ox * d, C.v.oy * d]);
    const w0 = toW([0, 0]), w1 = toW([C.W, C.H]);
    const k = C.v.scale; // px per metre for LOD (CSS px)
    // pen.k returns device units (×dpr); text sizes are in device units on canvas — scale them by dpr
    DPPlan.draw(P, { project: S.project, cadData: S.cadData, refImg: C.refImg, mode: C.displayMode, show: C.show, per: C.validation.per, selection: S.selection, ts: d,
      view: { x0: w0[0], y0: w0[1], x1: w1[0], y1: w1[1] }, hiddenIds: null });
    overlays(P, ctx, d, k);
  }
  function overlays(P, ctx, d) {
    const blue = "#1F5FA8";
    // vertex editing handles
    const ev = editTarget();
    if (ev) { const pts = ev.pts; pts.forEach((p, i) => { P.begin().circle(p[0], p[1], (i === C.selVertex ? 6.5 : 5) / C.v.scale).paint({ fill: i === C.selVertex ? "#B8D241" : "#FFFFFF", stroke: "#262626", px: 2 * d }); }); }
    // selection handles
    if (!C.mode) {
      const sel = M.selected();
      if (sel.length === 1 && (sel[0].kind === "product" || sel[0].kind === "point") && !sel[0].locked) {
        const o = sel[0], h = rotHandle(o); const c = [o.x, o.y];
        P.begin().line(c[0], c[1], h[0], h[1]).paint({ stroke: "#262626", px: 1 * d, dashPx: [3 * d, 3 * d] });
        P.begin().circle(h[0], h[1], 7 / C.v.scale).paint({ fill: "#B8D241", stroke: "#262626", px: 2 * d });
        if (o.kind === "point" && DPCat.EL[o.type] && DPCat.EL[o.type].resizable) { const rh = resizeHandle(o); P.begin().rect(rh[0] - 5 / C.v.scale, rh[1] - 5 / C.v.scale, 10 / C.v.scale, 10 / C.v.scale).paint({ fill: "#FFFFFF", stroke: "#262626", px: 2 * d }); }
        // distance to boundary
        const site = S.project.site && S.project.site.poly; const s = M.shapes(o);
        if (site && C.show.dims && !s.missing) { const nb = nearestBetween(s.zone || s.foot, site); if (nb) dimLine(P, nb.a, nb.b, `${s.zone ? "zone" : "edge"} to boundary ${DPPlan.fmtM(nb.d)}`, d, blue); }
      }
      if (sel.length > 1) { const b = G.bbox(sel.flatMap((o) => M.outline(o).flat())); P.begin().rect(b.x0 - 6 / C.v.scale, b.y0 - 6 / C.v.scale, b.w + 12 / C.v.scale, b.h + 12 / C.v.scale).paint({ stroke: blue, px: 1 * d, dashPx: [4 * d, 4 * d] }); }
      for (const o of sel) if (o.kind === "line" || o.kind === "area") { const pts = o.kind === "line" ? o.pts : o.poly; P.begin().poly(pts, o.kind === "area").paint({ stroke: blue, px: 2 * d, dashPx: [5 * d, 3 * d] }); }
    }
    for (const g of C.guidesNow) { P.begin(); const w0 = toW([0, 0]), w1 = toW([C.W, C.H]); if (g.axis === "x") P.line(g.v, w0[1], g.v, w1[1]); else P.line(w0[0], g.v, w1[0], g.v); P.paint({ stroke: "#E0329B", px: 1 * d, dashPx: [5 * d, 3 * d] }); }
    if (C.marquee) { const m = C.marquee, a = toW([m.x0, m.y0]), b = toW([m.x1, m.y1]); P.begin().rect(a[0], a[1], b[0] - a[0], b[1] - a[1]).paint({ fill: "#B8D241", fillAlpha: 0.15, stroke: "#5B6B12", px: 1 * d, dashPx: [4 * d, 3 * d] }); }
    if (C.measure) dimLine(P, C.measure.a, C.measure.b, DPPlan.fmtM(G.dist(C.measure.a, C.measure.b)), d, blue);
    if (C.mode && C.modeData) modeOverlay(P, d);
    if (C.ghost) { const g = C.ghost; P.save().translate(g.x, g.y).rotateDeg(g.rot || 0);
      if (g.kind === "product") { const p = DPCat.BY[g.code]; if (p && p.dims) { if (p.zone && p.zone.kind === "rect") P.begin().rect(-p.zone.l / 2, -p.zone.w / 2, p.zone.l, p.zone.w).paint({ stroke: "#5B6B12", px: 1.3 * d, dashPx: [6 * d, 4 * d] }); P.b.ctx.globalAlpha = 0.75; DPSymbols.drawProduct(P, p, { lod: C.v.scale * d }); P.b.ctx.globalAlpha = 1; } }
      else { const el = DPCat.EL[g.type]; P.b.ctx.globalAlpha = 0.75; DPSymbols.drawPointElement(P, el, g.l, g.w, { lod: C.v.scale * d }); P.b.ctx.globalAlpha = 1; }
      P.restore(); }
  }
  function dimLine(P, a, b, text, d, color) {
    P.begin().line(a[0], a[1], b[0], b[1]).paint({ stroke: color, px: 1.2 * d, dashPx: [4 * d, 3 * d] });
    for (const p of [a, b]) P.begin().circle(p[0], p[1], 3 / C.v.scale).fill(color);
    P.text(text, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 12 / C.v.scale, { size: 11 * d, align: "center", baseline: "middle", color, font: "sansBold", halo: 3 * d });
  }
  function modeOverlay(P, d) {
    const md = C.modeData, lime = "#5B6B12";
    if (["draw-site", "draw-line", "draw-area", "calibrate", "draw-obstacle"].includes(C.mode)) {
      const pts = md.pts.concat(md.cursor ? [md.cursor] : []);
      if (pts.length) {
        P.begin().poly(pts, false).paint({ stroke: C.mode === "calibrate" ? "#1F5FA8" : lime, px: 2.5 * d });
        if (C.mode === "draw-area" && pts.length >= 3) P.begin().poly(pts).paint({ fill: "#B8D241", fillAlpha: 0.18 });
        md.pts.forEach((p, i) => P.begin().circle(p[0], p[1], (i === 0 ? 7 : 4.5) / C.v.scale).paint({ fill: i === 0 ? "#B8D241" : "#FFFFFF", stroke: "#262626", px: 1.5 * d }));
        if (md.cursor && md.pts.length) { const a = md.pts[md.pts.length - 1]; const tot = G.polylineLength(md.pts.concat([md.cursor]));
          P.text(`${DPPlan.fmtM(G.dist(a, md.cursor))}${md.pts.length > 1 && C.mode !== "calibrate" ? `  ·  total ${DPPlan.fmtM(tot)}` : ""}${C.mode === "draw-area" && md.pts.length >= 2 ? `  ·  ${G.area(md.pts.concat([md.cursor])).toFixed(1)} m²` : ""}`,
            md.cursor[0] + 14 / C.v.scale, md.cursor[1] - 14 / C.v.scale, { size: 11 * d, color: "#262626", font: "sansBold", halo: 3 * d }); }
      }
    }
    if (C.mode === "draw-rect" && md.a && md.cursor) { const a = md.a, b = md.cursor; P.begin().rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])).paint({ fill: "#B8D241", fillAlpha: 0.18, stroke: lime, px: 2 * d });
      P.text(`${Math.abs(b[0] - a[0]).toFixed(2)} × ${Math.abs(b[1] - a[1]).toFixed(2)} m`, b[0] + 12 / C.v.scale, b[1] - 12 / C.v.scale, { size: 11 * d, font: "sansBold", halo: 3 * d }); }
    if (C.mode === "pick-boundary" && C.highlight) P.begin().poly(C.highlight).paint({ fill: "#B8D241", fillAlpha: 0.3, stroke: lime, px: 3 * d });
    if (md.snapAt) P.begin().rect(md.snapAt[0] - 6 / C.v.scale, md.snapAt[1] - 6 / C.v.scale, 12 / C.v.scale, 12 / C.v.scale).paint({ stroke: "#E0329B", px: 2 * d });
  }

  /* ---------------- view ---------------- */
  function resize() { const r = C.cv.getBoundingClientRect(); C.dpr = Math.min(window.devicePixelRatio || 1, 2); C.W = Math.max(1, r.width); C.H = Math.max(1, r.height); C.cv.width = Math.round(C.W * C.dpr); C.cv.height = Math.round(C.H * C.dpr); req(); }
  function contentBox() {
    const pts = [];
    if (S.project.site && S.project.site.poly) pts.push(...S.project.site.poly);
    for (const o of S.project.objects) { const s = M.shapes(o); if (s.missing) continue; if (s.zone) pts.push(...s.zone); pts.push(...M.outline(o).flat()); }
    if (!pts.length && S.cadData && S.project.cad) { const b = S.cadData.bbox, { scale, offset } = S.project.cad; pts.push([b.x0 * scale + offset[0], b.y0 * scale + offset[1]], [b.x1 * scale + offset[0], b.y1 * scale + offset[1]]); }
    if (!pts.length && S.project.ref && S.refImage) { const r = S.project.ref; pts.push(r.offset, [r.offset[0] + r.w * r.mpp, r.offset[1] + r.h * r.mpp]); }
    return pts.length ? G.bbox(pts) : null;
  }
  const clampScale = (s) => Math.max(0.05, Math.min(1500, s));
  function fit(box = contentBox(), pad = 60) {
    if (!box || !(box.w > 0 || box.h > 0)) { C.v = { scale: 20, ox: C.W / 2 - 15 * 20, oy: C.H / 2 - 10 * 20 }; req(); return; }
    const s = clampScale(Math.min((C.W - 2 * pad) / Math.max(box.w, 1e-6), (C.H - 2 * pad) / Math.max(box.h, 1e-6)));
    C.v = { scale: s, ox: C.W / 2 - (box.x0 + box.w / 2) * s, oy: C.H / 2 - (box.y0 + box.h / 2) * s }; req();
  }
  function zoomAt(f, sx = C.W / 2, sy = C.H / 2) { const w = toW([sx, sy]); C.v.scale = clampScale(C.v.scale * f); C.v.ox = sx - w[0] * C.v.scale; C.v.oy = sy - w[1] * C.v.scale; req(); }
  function centerOn(w) { C.v.ox = C.W / 2 - w[0] * C.v.scale; C.v.oy = C.H / 2 - w[1] * C.v.scale; req(); }

  /* ---------------- hit testing ---------------- */
  function hitObject(w) {
    const objs = S.project.objects; const tol = 5 / C.v.scale;
    // top-most first: points/products (reverse), then lines, then areas
    const order = [...objs].reverse(); const pass = [(o) => o.kind === "product" || o.kind === "point", (o) => o.kind === "line", (o) => o.kind === "area"];
    for (const f of pass) for (const o of order) {
      if (o.hidden || !f(o)) continue;
      if (o.kind === "line") { const pr = G.projectOnPolyline(o.pts, w); if (pr && pr.d <= Math.max(tol, (o.width || 0.1) / 2 + tol * 0.4)) return o; continue; }
      if (o.kind === "area") { if (G.pointInPolygon(w, o.poly)) return o; continue; }
      const s = M.shapes(o); if (s.missing) { if (G.dist([o.x, o.y], w) < 0.6) return o; continue; }
      if (G.pointInPolygon(w, s.foot)) return o;
    }
    return null;
  }
  function editTarget() {
    if (!C.editVerts) return null;
    if (C.editVerts === "site") return S.project.site ? { pts: S.project.site.poly, closed: true, obj: null } : null;
    const o = M.byId(C.editVerts); if (!o || o.locked) return null;
    return { pts: o.kind === "line" ? o.pts : o.poly, closed: o.kind === "area", obj: o };
  }
  function vertexAt(sp) { const t = editTarget(); if (!t) return -1; for (let i = 0; i < t.pts.length; i++) { const s = toS(t.pts[i]); if (Math.hypot(s[0] - sp[0], s[1] - sp[1]) < 10) return i; } return -1; }
  function edgeAt(sp) { const t = editTarget(); if (!t) return -1; const w = toW(sp), n = t.pts.length;
    for (let i = 0; i < (t.closed ? n : n - 1); i++) if (G.distPointSeg(w, t.pts[i], t.pts[(i + 1) % n]) * C.v.scale < 7) return i; return -1; }
  function rotHandle(o) { const s = M.shapes(o); const r = s.missing ? 1 : Math.max(...s.foot.map((p) => G.dist(p, [o.x, o.y]))); const len = r + 26 / C.v.scale, a = (o.rot || 0) * Math.PI / 180; return [o.x + Math.cos(a) * len, o.y + Math.sin(a) * len]; }
  function resizeHandle(o) { const a = (o.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hx = o.l / 2, hy = (DPCat.EL[o.type].shape === "circle" ? o.l : o.w) / 2; return [o.x + hx * c - hy * s, o.y + hx * s + hy * c]; }
  function nearestBetween(P, Q) {
    let best = null; const near = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return [a[0] + t * dx, a[1] + t * dy]; };
    for (const p of P) for (let j = 0; j < Q.length; j++) { const q = near(p, Q[j], Q[(j + 1) % Q.length]), dd = G.dist(p, q); if (!best || dd < best.d) best = { d: dd, a: p, b: q }; }
    for (const q of Q) for (let j = 0; j < P.length; j++) { const p = near(q, P[j], P[(j + 1) % P.length]), dd = G.dist(p, q); if (!best || dd < best.d) best = { d: dd, a: p, b: q }; }
    return best;
  }

  /* ---------------- snapping ---------------- */
  function cadSnap(w, px = 10) {
    const d = S.cadData, c = S.project.cad; if (!d || !c || !C.show.cad) return null;
    const r = px / C.v.scale; let best = null, bd = r; const { scale, offset, hidden = {} } = c;
    if (!d._idx) { const idx = new Map(), b = d.bbox, cw = Math.max((b.x1 - b.x0) / 256, (b.y1 - b.y0) / 256, 1e-9);
      d.paths.forEach((P) => { for (let k = 0; k < P.p.length; k += 2) { const key = Math.floor((P.p[k] - b.x0) / cw) + ":" + Math.floor((P.p[k + 1] - b.y0) / cw); let a = idx.get(key); if (!a) idx.set(key, a = []); if (a.length < 64) a.push(P.p[k], P.p[k + 1], P.l); } });
      Object.defineProperty(d, "_idx", { value: { idx, cw, b }, enumerable: false, configurable: true }); }
    const { idx, cw, b } = d._idx, du = [(w[0] - offset[0]) / scale, (w[1] - offset[1]) / scale], rr = r / scale;
    const cx = Math.floor((du[0] - b.x0) / cw), cy = Math.floor((du[1] - b.y0) / cw), n = Math.min(4, Math.ceil(rr / cw));
    for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) { const a = idx.get(i + ":" + j); if (!a) continue;
      for (let q = 0; q < a.length; q += 3) { if (hidden[a[q + 2]]) continue; const dd = Math.hypot(a[q] - du[0], a[q + 1] - du[1]) * scale; if (dd < bd) { bd = dd; best = [a[q] * scale + offset[0], a[q + 1] * scale + offset[1]]; } } }
    return best;
  }
  function vertexSnap(w) {
    const r = 9 / C.v.scale; let best = null, bd = r;
    const consider = (p) => { const dd = G.dist(p, w); if (dd < bd) { bd = dd; best = p.slice(); } };
    if (S.project.site && S.project.site.poly) S.project.site.poly.forEach(consider);
    for (const o of S.project.objects) { if (o.kind === "line") o.pts.forEach(consider); else if (o.kind === "area") o.poly.forEach(consider); }
    return best;
  }
  function snapPoint(w, { skipCad = false } = {}) {
    const c = !skipCad && cadSnap(w); if (c) return { p: c, kind: "cad" };
    const v = vertexSnap(w); if (v) return { p: v, kind: "vertex" };
    if (C.snap) return { p: [G.snap(w[0], C.step), G.snap(w[1], C.step)], kind: "grid" };
    return { p: w, kind: null };
  }
  const orth = (a, w) => (Math.abs(w[0] - a[0]) > Math.abs(w[1] - a[1]) ? [w[0], a[1]] : [a[0], w[1]]);
  function alignSnap(lead, nx, ny, skip) {
    const tmp = Object.assign({}, lead, { x: nx, y: ny }), b = G.bbox(M.outline(tmp).flat());
    const mine = { x: [b.x0, nx, b.x1], y: [b.y0, ny, b.y1] }, tol = 7 / C.v.scale, targets = { x: [], y: [] };
    if (C.guides) {
      for (const o of S.project.objects) { if (skip.has(o.id) || o.hidden || !(o.kind === "product" || o.kind === "point")) continue; const ob = M.bounds(o); if (!ob) continue; targets.x.push(ob.x0, o.x, ob.x1); targets.y.push(ob.y0, o.y, ob.y1); }
      if (S.project.site && S.project.site.poly) for (const p of S.project.site.poly) { targets.x.push(p[0]); targets.y.push(p[1]); }
    }
    const guides = []; let x = nx, y = ny;
    for (const ax of ["x", "y"]) { let best = null;
      for (const m of mine[ax]) for (const t of targets[ax]) { const dd = t - m; if (Math.abs(dd) < tol && (!best || Math.abs(dd) < Math.abs(best.d))) best = { d: dd, t }; }
      if (best) { if (ax === "x") x += best.d; else y += best.d; guides.push({ axis: ax, v: best.t }); }
      else if (C.snap) { if (ax === "x") x = G.snap(nx, C.step); else y = G.snap(ny, C.step); } }
    return { x, y, guides };
  }

  /* ---------------- interaction ---------------- */
  let drag = null, spaceDown = false; const pointers = new Map();
  function onDown(e) {
    C.cv.focus({ preventScroll: true }); pointers.set(e.pointerId, evtPt(e));
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]), s0: C.v.scale, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...C.v } }; return; }
    const sp = evtPt(e), w = toW(sp); C.cv.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || C.tool === "pan" || spaceDown) { drag = { kind: "pan", sp, v0: { ...C.v } }; C.cv.style.cursor = "grabbing"; return; }
    if (C.mode) return modeDown(sp, w, e);
    if (C.tool === "measure") { const p = snapPoint(w).p; C.measure = { a: p, b: p }; drag = { kind: "measure" }; req(); return; }
    if (C.readOnly) { const hit = hitObject(w); S.selection.clear(); if (hit) S.selection.add(hit.id); M.emit("select"); req(); return; }
    // vertex editing
    if (C.editVerts) { const vi = vertexAt(sp); if (vi >= 0) { C.selVertex = vi; drag = { kind: "vertex", i: vi, moved: false }; req(); return; } }
    const sel = M.selected();
    if (sel.length === 1 && (sel[0].kind === "product" || sel[0].kind === "point") && !sel[0].locked) {
      const o = sel[0], h = toS(rotHandle(o)); if (Math.hypot(h[0] - sp[0], h[1] - sp[1]) < 11) { drag = { kind: "rotate", o, r0: o.rot || 0, moved: false }; return; }
      if (o.kind === "point" && DPCat.EL[o.type] && DPCat.EL[o.type].resizable) { const rh = toS(resizeHandle(o)); if (Math.hypot(rh[0] - sp[0], rh[1] - sp[1]) < 10) { drag = { kind: "resize", o, moved: false }; return; } }
    }
    const hit = hitObject(w);
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { S.selection.has(hit.id) ? S.selection.delete(hit.id) : S.selection.add(hit.id); }
      else if (!S.selection.has(hit.id)) { S.selection.clear(); S.selection.add(hit.id); }
      if (C.editVerts && C.editVerts !== hit.id && C.editVerts !== "site") { C.editVerts = null; C.selVertex = -1; }
      const movers = M.selected().filter((o) => !o.locked);
      drag = { kind: "move", w0: w, lead: hit, start: movers.map((o) => ({ o, snap: JSON.stringify({ x: o.x, y: o.y, pts: o.pts, poly: o.poly }) })), moved: false };
      M.emit("select"); req(); return;
    }
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) && S.selection.size) { S.selection.clear(); M.emit("select"); }
    if (C.editVerts && C.editVerts !== "site") { C.editVerts = null; C.selVertex = -1; M.emit("select"); }
    drag = { kind: "marquee", sp, add: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(S.selection) }; req();
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, evtPt(e));
    const sp = evtPt(e), w = toW(sp); hud(w);
    if (drag && drag.kind === "pinch" && pointers.size === 2) { const [a, b] = [...pointers.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const wm = [(drag.mid[0] - drag.v0.ox) / drag.v0.scale, (drag.mid[1] - drag.v0.oy) / drag.v0.scale]; C.v.scale = clampScale(drag.s0 * dd / drag.d0); C.v.ox = mid[0] - wm[0] * C.v.scale; C.v.oy = mid[1] - wm[1] * C.v.scale; req(); return; }
    if (C.mode) return modeMove(sp, w, e);
    if (!drag) { hoverCursor(sp, w); return; }
    if (drag.kind === "pan") { C.v.ox = drag.v0.ox + sp[0] - drag.sp[0]; C.v.oy = drag.v0.oy + sp[1] - drag.sp[1]; req(); return; }
    if (drag.kind === "measure") { C.measure.b = e.shiftKey ? orth(C.measure.a, w) : snapPoint(w).p; req(); return; }
    if (drag.kind === "vertex") { const t = editTarget(); if (!t) return; let p = cadSnap(w) || (C.snap ? [G.snap(w[0], C.step), G.snap(w[1], C.step)] : w);
      if (e.shiftKey) { const n = t.pts.length; p = orth(t.pts[(drag.i - 1 + n) % n], w); }
      t.pts[drag.i] = p; drag.moved = true; if (C.editVerts === "site") { S.project.site.source = S.project.site.source === "cad" ? "cad-edited" : S.project.site.source; S.project.site.cadPath = null; } M.emit("live"); req(); return; }
    if (drag.kind === "rotate") { const o = drag.o; let a = Math.atan2(w[1] - o.y, w[0] - o.x) * 180 / Math.PI; if (!e.altKey) a = Math.round(a / C.angle) * C.angle; o.rot = G.normAngle(a); drag.moved = true; M.emit("live"); req(); return; }
    if (drag.kind === "resize") { const o = drag.o, a = -(o.rot || 0) * Math.PI / 180, dx = w[0] - o.x, dy = w[1] - o.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const snapv = (v) => (C.snap && !e.altKey ? Math.max(C.step / 2, G.snap(v, Math.min(C.step, 0.1))) : Math.max(0.05, v));
      if (DPCat.EL[o.type].shape === "circle") { const d2 = snapv(Math.hypot(lx, ly) * 2 / Math.SQRT2); o.l = o.w = Math.max(0.1, d2); } else { o.l = Math.max(0.05, snapv(Math.abs(lx) * 2)); o.w = Math.max(0.05, snapv(Math.abs(ly) * 2)); }
      drag.moved = true; M.emit("live"); req(); return; }
    if (drag.kind === "move") {
      let dx = w[0] - drag.w0[0], dy = w[1] - drag.w0[1];
      if (!drag.moved && Math.hypot(dx, dy) * C.v.scale < 3) return;
      if (!drag.start.length) return; drag.moved = true;
      for (const s of drag.start) { const o0 = JSON.parse(s.snap); s.o.x = o0.x; s.o.y = o0.y; if (o0.pts) s.o.pts = o0.pts; if (o0.poly) s.o.poly = o0.poly; }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const lead = drag.lead;
      if ((lead.kind === "product" || lead.kind === "point") && !lead.locked && !e.altKey) { const g = alignSnap(lead, lead.x + dx, lead.y + dy, new Set(drag.start.map((s) => s.o.id))); dx = g.x - lead.x; dy = g.y - lead.y; C.guidesNow = g.guides; }
      else if (C.snap && !e.altKey) { dx = G.snap(dx, C.step); dy = G.snap(dy, C.step); }
      for (const s of drag.start) M.translateObj(s.o, dx, dy);
      M.emit("live"); req(); return;
    }
    if (drag.kind === "marquee") {
      C.marquee = { x0: Math.min(drag.sp[0], sp[0]), y0: Math.min(drag.sp[1], sp[1]), x1: Math.max(drag.sp[0], sp[0]), y1: Math.max(drag.sp[1], sp[1]) };
      const a = toW([C.marquee.x0, C.marquee.y0]), b = toW([C.marquee.x1, C.marquee.y1]);
      S.selection.clear(); drag.base.forEach((id) => drag.add && S.selection.add(id));
      for (const o of S.project.objects) { if (o.hidden) continue; const bb = M.bounds(o); if (bb && bb.x0 >= a[0] && bb.x1 <= b[0] && bb.y0 >= a[1] && bb.y1 <= b[1]) S.selection.add(o.id); }
      req();
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (C.mode) return;
    if (!drag) return; const d = drag; drag = null; C.cv.style.cursor = ""; C.guidesNow = [];
    if (d.kind === "move" && d.moved) M.commit("Move");
    if (d.kind === "rotate" && d.moved) M.commit("Rotate");
    if (d.kind === "resize" && d.moved) M.commit("Resize");
    if (d.kind === "vertex" && d.moved) M.commit("Edit outline");
    if (d.kind === "marquee") { C.marquee = null; M.emit("select"); }
    if (d.kind === "measure" && C.measure && G.dist(C.measure.a, C.measure.b) < 1e-9) C.measure = null;
    req();
  }
  function hoverCursor(sp, w) {
    let cur = "";
    if (C.tool === "pan" || spaceDown) cur = "grab"; else if (C.tool === "measure") cur = "crosshair";
    else if (C.editVerts && vertexAt(sp) >= 0) cur = "move";
    else { const sel = M.selected(); if (sel.length === 1 && (sel[0].kind === "product" || sel[0].kind === "point") && !sel[0].locked) { const h = toS(rotHandle(sel[0])); if (Math.hypot(h[0] - sp[0], h[1] - sp[1]) < 11) cur = "grab";
        if (!cur && sel[0].kind === "point" && DPCat.EL[sel[0].type] && DPCat.EL[sel[0].type].resizable) { const r = toS(resizeHandle(sel[0])); if (Math.hypot(r[0] - sp[0], r[1] - sp[1]) < 10) cur = "nwse-resize"; } }
      if (!cur) { const h = hitObject(w); if (h) cur = h.locked ? "not-allowed" : "move"; } }
    C.cv.style.cursor = cur;
  }
  function hud(w) { const el = document.getElementById("hud"); if (!el) return; el.textContent = `x ${w[0].toFixed(2)} m · y ${(-w[1]).toFixed(2)} m${S.selection.size ? ` · ${S.selection.size} selected` : ""}`; }

  /* ---------------- modes ---------------- */
  function setMode(mode, data, cb) { C.mode = mode; C.modeCb = cb || null; C.modeData = Object.assign({ pts: [], cursor: null, snapAt: null }, data || {}); C.ghost = null; C.highlight = null; C.cv.style.cursor = mode ? "crosshair" : ""; M.emit("mode", mode); req(); }
  function endMode(result) { const cb = C.modeCb, m = C.mode, md = C.modeData; C.mode = null; C.modeCb = null; C.modeData = null; C.ghost = null; C.highlight = null; C.cv.style.cursor = ""; M.emit("mode", null); req(); if (cb) cb(result, m, md); }
  function modeDown(sp, w, e) {
    const md = C.modeData;
    if (["draw-site", "draw-line", "draw-area", "draw-obstacle"].includes(C.mode)) {
      const p = md.cursor || snapPoint(w).p, minPts = C.mode === "draw-line" ? 2 : 3;
      if (C.mode !== "draw-line" && md.pts.length >= 3 && G.dist(toS(md.pts[0]), sp) < 11) return endMode(md.pts.slice());
      if (C.mode === "draw-line" && md.pts.length >= 2 && G.dist(toS(md.pts[md.pts.length - 1]), sp) < 8) return endMode(md.pts.slice());
      if (e.detail === 2 && md.pts.length >= minPts) return endMode(md.pts.slice());
      if (md.pts.length && G.dist(p, md.pts[md.pts.length - 1]) < 1e-9) return;
      md.pts.push(p); if (md.maxPts && md.pts.length >= md.maxPts) return endMode(md.pts.slice()); req(); return;
    }
    if (C.mode === "draw-rect") { const p = snapPoint(w).p; if (!md.a) { md.a = p; md.cursor = p; req(); } else { const a = md.a, b = p; if (Math.abs(b[0] - a[0]) < 1e-6 || Math.abs(b[1] - a[1]) < 1e-6) return; endMode([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]); } return; }
    if (C.mode === "calibrate") { const p = cadSnap(w) || w; md.pts.push(p); req(); if (md.pts.length === 2) { const r = md.pts.slice(); setTimeout(() => endMode(r), 60); } return; }
    if (C.mode === "pick-boundary") { const c = candidateAt(w); if (c) endMode(c.i); return; }
    if (C.mode === "place") { const g = placeGhost(w, e); endMode(g); return; }
    if (C.mode === "pick-point") { endMode(snapPoint(w).p); return; }
  }
  function modeMove(sp, w, e) {
    const md = C.modeData; if (!md) return;
    if (["draw-site", "draw-line", "draw-area", "draw-obstacle"].includes(C.mode)) { let sn = snapPoint(w); if ((e.shiftKey || C.ortho) && md.pts.length) sn = { p: orth(md.pts[md.pts.length - 1], sn.p), kind: null }; md.cursor = sn.p; md.snapAt = sn.kind === "cad" || sn.kind === "vertex" ? sn.p : null; req(); return; }
    if (C.mode === "draw-rect") { md.cursor = snapPoint(w).p; req(); return; }
    if (C.mode === "calibrate") { const c = cadSnap(w); md.cursor = c || w; md.snapAt = c; req(); return; }
    if (C.mode === "pick-boundary") { const c = candidateAt(w); C.highlight = c ? c.poly : null; C.cv.style.cursor = c ? "pointer" : "crosshair"; req(); return; }
    if (C.mode === "place") { C.ghost = placeGhost(w, e); req(); return; }
    if (C.mode === "pick-point") { md.snapAt = snapPoint(w).p; req(); }
  }
  function placeGhost(w, e) {
    const md = C.modeData, x = C.snap && !(e && e.altKey) ? G.snap(w[0], C.step) : w[0], y = C.snap && !(e && e.altKey) ? G.snap(w[1], C.step) : w[1];
    if (md.code) return { kind: "product", code: md.code, x, y, rot: md.rot || 0 };
    const el = DPCat.EL[md.type]; let rot = md.rot || 0;
    // gates align to the nearest fence/wall automatically
    if (el.gate) { let best = null; for (const o of S.project.objects) { if (o.kind !== "line" || !["fence", "wall", "hedge"].includes(o.type)) continue; const pr = G.projectOnPolyline(o.pts, [x, y]); if (pr && pr.d < 1.2 && (!best || pr.d < best.pr.d)) best = { o, pr }; }
      if (best) { const a = G.pointAlong(best.o.pts, best.pr.t); return { kind: "point", type: el.id, x: best.pr.p[0], y: best.pr.p[1], rot: a.ang * 180 / Math.PI, l: md.l || el.l, w: md.w || el.w, snapped: best.o.id }; } }
    return { kind: "point", type: el.id, x, y, rot, l: md.l || el.l || el.d, w: md.w || el.w || el.d };
  }
  function candidateAt(w) {
    const d = S.cadData; if (!d || !d.candidates || !S.project.cad) return null; let best = null;
    for (const c of d.candidates) { const P = d.paths[c.i]; if (!P || (S.project.cad.hidden && S.project.cad.hidden[P.l])) continue; const poly = cadPathWorld(c.i); if (poly && G.pointInPolygon(w, poly) && (!best || c.area < best.area)) best = { i: c.i, area: c.area, poly }; }
    return best;
  }
  function cadPathWorld(i) { const P = S.cadData && S.cadData.paths[i]; if (!P || !S.project.cad) return null; const { scale, offset } = S.project.cad, pts = [];
    for (let k = 0; k < P.p.length; k += 2) pts.push([P.p[k] * scale + offset[0], P.p[k + 1] * scale + offset[1]]); if (pts.length > 2 && G.dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop(); return pts; }
  function modeKey(e) {
    if (!C.mode) return false; const md = C.modeData;
    if (e.key === "Escape") { endMode(null); return true; }
    if (["draw-site", "draw-line", "draw-area", "draw-obstacle"].includes(C.mode)) {
      if (e.key === "Enter" && md.pts.length >= (C.mode === "draw-line" ? 2 : 3)) { endMode(md.pts.slice()); return true; }
      if (e.key === "Backspace" || (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey))) { md.pts.pop(); req(); return true; }
    }
    if (C.mode === "place" && e.key.toLowerCase() === "r") { md.rot = ((md.rot || 0) + (e.shiftKey ? 90 : C.angle)) % 360; if (C.ghost) C.ghost.rot = md.rot; req(); return true; }
    if (C.mode === "calibrate" && e.key === "Backspace") { md.pts.pop(); req(); return true; }
    return false;
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing && !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === " " && !spaceDown && document.activeElement === C.cv) { spaceDown = true; e.preventDefault(); C.cv.style.cursor = "grab"; return; }
    if (modeKey(e)) { e.preventDefault(); return; }
    M.emit("key", e);
  }
  function onKeyUp(e) { if (e.key === " ") { spaceDown = false; C.cv.style.cursor = ""; } }

  /* ---------------- library drag & drop ---------------- */
  function initDrop() {
    const wrap = C.cv.parentElement, hint = document.getElementById("drop-hint");
    wrap.addEventListener("dragover", (e) => { if (![...(e.dataTransfer.types || [])].includes("text/dp-item")) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (hint) hint.hidden = false; });
    wrap.addEventListener("dragleave", (e) => { if (!wrap.contains(e.relatedTarget) && hint) hint.hidden = true; });
    wrap.addEventListener("drop", (e) => { if (hint) hint.hidden = true; const v = e.dataTransfer.getData("text/dp-item"); if (!v) return; e.preventDefault(); const w = toW(evtPt(e)); M.emit("drop-item", { item: JSON.parse(v), w: [C.snap ? G.snap(w[0], C.step) : w[0], C.snap ? G.snap(w[1], C.step) : w[1]] }); });
  }

  function init(cv) {
    C.cv = cv; C.ctx = cv.getContext("2d");
    new ResizeObserver(resize).observe(cv); resize();
    cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp); cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("dblclick", (e) => {
      if (C.mode || C.readOnly) return; const sp = evtPt(e);
      if (C.editVerts) { const ei = edgeAt(sp); if (ei >= 0 && vertexAt(sp) < 0) { const t = editTarget(), w = toW(sp); t.pts.splice(ei + 1, 0, C.snap ? [G.snap(w[0], C.step), G.snap(w[1], C.step)] : w); C.selVertex = ei + 1; M.commit("Add corner"); req(); } return; }
      const hit = hitObject(toW(sp)); if (hit && (hit.kind === "line" || hit.kind === "area") && !hit.locked) { C.editVerts = hit.id; S.selection.clear(); S.selection.add(hit.id); M.emit("select"); req(); }
    });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const sp = evtPt(e);
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), sp[0], sp[1]); else { C.v.ox -= e.deltaX; C.v.oy -= e.deltaY; req(); } }, { passive: false });
    cv.addEventListener("pointerleave", () => { if (C.modeData) { C.modeData.cursor = null; req(); } });
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKeyUp);
    initDrop();
    M.on("change", () => { C.validation = M.validate(); req(); });
    M.on("live", () => { req(); });
    M.on("loaded", () => { C.editVerts = null; C.selVertex = -1; C.validation = M.validate(); req(); });
  }

  Object.assign(C, { init, req, fit, zoomAt, centerOn, toS, toW, setMode, endMode, contentBox, cadPathWorld, snapPoint, render: () => render() });
  root.DPCanvas = C;
})(typeof self !== "undefined" ? self : this);
