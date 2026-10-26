/* Dupedia Site Planner 2.0 — plan renderer shared by the editor canvas, PNG export and the PDF proposal.
   Draws through DPPen, so the editor and the client documents use exactly the same geometry and symbols. */
/* global DPGeom, DPCat, DPModel, DPSymbols */
(function (root) {
  "use strict";
  const G = DPGeom, SY = DPSymbols, PAL = SY.PAL;

  /** Numbered keys for products (same code → same number), used in presentation mode and the proposal legend. */
  function legend(project) {
    const codes = [...new Set(project.objects.filter((o) => o.kind === "product" && !o.hidden).map((o) => o.code))].sort();
    const map = {}; codes.forEach((c, i) => (map[c] = i + 1));
    const els = [...new Set(project.objects.filter((o) => o.kind !== "product" && !o.hidden && DPCat.EL[o.type] && !DPCat.EL[o.type].annotation).map((o) => o.type))];
    return { map, codes, els };
  }
  const fmtM = (m) => (Math.abs(m) >= 100 ? m.toFixed(1) : m.toFixed(2)).replace(/\.00$/, "") + " m";

  /**
   * draw(P, o)
   * P: DPPen with world→device matrix already set (metres → px or mm)
   * o: {project, cadData, refImg, mode, show:{grid,labels,dims,zones,ref,cad}, per (validation per id), selection, pdf, ts (text scale), view:{x0,y0,x1,y1} world bbox for culling, hidden:Set}
   */
  function draw(P, o) {
    const pr = o.project, mode = o.mode || "design", show = Object.assign({ grid: true, labels: true, dims: true, zones: true, ref: true, cad: true }, o.show || {});
    const pdf = !!o.pdf, ts = o.ts || 1, k = P.k, kp = P.kpx, per = o.per || {}, sel = o.selection || new Set();
    const site = pr.site && pr.site.poly && pr.site.poly.length >= 3 ? pr.site.poly : null;
    const pres = mode === "presentation";
    const vis = pr.objects.filter((x) => !x.hidden && !(o.hiddenIds && o.hiddenIds.has(x.id)));
    const inView = (b) => !o.view || !b || !(b.x1 < o.view.x0 || b.x0 > o.view.x1 || b.y1 < o.view.y0 || b.y0 > o.view.y1);

    // site ground
    if (site) P.begin().poly(site).fill(pres ? "#F7F5EE" : "#FFFFFF");
    // grid (design, screen only)
    if (show.grid && !pdf && mode === "design" && o.view) {
      const minor = niceStep(k, 14), major = minor * 5, v = o.view;
      for (const [st, col, a] of [[minor, "#262626", 0.06], [major, "#262626", 0.12]]) {
        P.begin(); let n = 0;
        for (let x = Math.floor(v.x0 / st) * st; x <= v.x1 && n < 800; x += st, n++) P.line(x, v.y0, x, v.y1);
        for (let y = Math.floor(v.y0 / st) * st; y <= v.y1 && n < 1600; y += st, n++) P.line(v.x0, y, v.x1, y);
        P.paint({ stroke: col, px: 1, alpha: a });
      }
    }
    // reference raster
    if (show.ref && pr.ref && o.refImg && (o.refImg.complete !== false)) {
      const r = pr.ref; P.save(); if (P.b.kind === "canvas") P.b.ctx.globalAlpha = r.opacity == null ? 0.6 : r.opacity;
      P.image(o.refImg, r.offset[0], r.offset[1], r.w * r.mpp, r.h * r.mpp, "PNG");
      if (P.b.kind === "canvas") P.b.ctx.globalAlpha = 1; P.restore();
    }
    // CAD linework
    if (show.cad && o.cadData && pr.cad) {
      const { scale, offset, hidden = {} } = pr.cad, d = o.cadData;
      P.save().translate(offset[0], offset[1]).scale(scale);
      const byLayer = {};
      for (const path of d.paths) { if (!path || hidden[path.l]) continue; (byLayer[path.l] = byLayer[path.l] || []).push(path); }
      for (const l in byLayer) { P.begin(); for (const path of byLayer[l]) { const p = path.p; P.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) P.lineTo(p[i], p[i + 1]); if (path.c) P.close(); }
        P.paint({ stroke: pdf ? "#9A9A94" : "#7A7A72", px: pdf ? 0.12 : 1, alpha: pdf ? 1 : 0.85 }); }
      P.restore();
    }
    // areas
    for (const x of vis) { if (x.kind !== "area") continue; const el = DPCat.EL[x.type]; if (!el) continue; if (!inView(G.bbox(x.poly))) continue;
      SY.drawArea(P, el, x.poly, { sel: sel.has(x.id), pdf, color: x.color, mode: pres ? "presentation" : "design" });
      if (show.labels && (x.label || el.noBuild || el.existing) && G.area(x.poly) * kp * kp > 2500) { const bb = G.bbox(x.poly), c = G.pointInPolygon([bb.x0 + 0.6, bb.y0 + 0.6], x.poly) ? [bb.x0 + (pdf ? 1.2 : 6) / k, bb.y0 + (pdf ? 1.2 : 6) / k] : G.centroid(x.poly); const tl = c !== null && G.pointInPolygon([bb.x0 + 0.6, bb.y0 + 0.6], x.poly); P.text(x.label || el.name, c[0], c[1], { size: 10 * ts, align: tl ? "left" : "center", baseline: tl ? "top" : "middle", color: el.noBuild ? PAL.red : PAL.graphite, font: "sansBold", halo: pdf ? 0 : 3 }); }
    }
    // site outline
    if (site) {
      P.begin().poly(site).paint({ stroke: PAL.ink, px: pdf ? 0.45 : 2.4, join: "miter" });
      if (show.dims) edgeLabels(P, site, ts, pdf);
    }
    // lines (with gate gaps)
    const { gaps } = DPModel.gateHosts(vis);
    for (const x of vis) { if (x.kind !== "line") continue; const el = DPCat.EL[x.type]; if (!el) continue;
      SY.drawLine(P, el, x.pts, { width: x.width, gaps: gaps[x.id] ? gaps[x.id].map(([a, b]) => [a, b]) : null, pdf, textSize: 10.5 * ts, color: x.color });
      if (show.labels && x.label && !pdf || (pdf && x.label && show.labels)) { const L = G.polylineLength(x.pts); if (L * kp > 80) { const a = G.pointAlong(x.pts, L / 2); let r = a.ang; if (r > Math.PI / 2) r -= Math.PI; if (r < -Math.PI / 2) r += Math.PI;
        P.text(x.label, a.p[0] - Math.sin(a.ang) * ((x.width || el.width) / 2 + 0.4), a.p[1] + Math.cos(a.ang) * ((x.width || el.width) / 2 + 0.4), { size: 10 * ts, align: "center", baseline: "middle", rot: r, color: PAL.graphite, halo: pdf ? 0 : 3 }); } }
    }
    // safety zones
    const prods = vis.filter((x) => x.kind === "product");
    if (show.zones) for (const x of vis) {
      if (x.kind !== "product" && !(x.kind === "point" && x.zoneEntered)) continue;
      const s = DPModel.shapes(x); if (s.missing || !s.zone) continue;
      const bad = (per[x.id] || []).some((i) => i.sev !== "info");
      P.begin().poly(s.zone).paint({ fill: bad ? PAL.amber : PAL.lime, fillAlpha: pres ? 0.12 : bad ? 0.1 : 0.13, stroke: bad ? PAL.amber : PAL.limeInk, px: pdf ? 0.22 : 1.3, dashPx: pdf ? [1.4, 0.9] : [6, 4] });
    }
    // point elements and products in layer order
    for (const x of vis) {
      if (x.kind !== "product" && x.kind !== "point") continue;
      const s = DPModel.shapes(x); if (s.missing) { if (x.x != null) { P.begin().circle(x.x, x.y, 0.5).paint({ fill: PAL.red, fillAlpha: 0.2, stroke: PAL.red, px: 1.5 }); } continue; }
      if (!inView(G.bbox(s.foot))) continue;
      const iss = per[x.id] || [], err = iss.some((i) => i.sev === "error"), warn = iss.some((i) => i.sev === "warning");
      P.save().translate(x.x, x.y).rotateDeg(x.rot || 0);
      if (x.kind === "product") SY.drawProduct(P, s.p, { lod: kp, mode: pres ? "presentation" : "design" });
      else { const el = s.el; if (el.id === "label") { /* text only */ } else SY.drawPointElement(P, el, x.l, x.w, { lod: kp }); }
      P.restore();
      if (!pdf && (err || warn) && mode === "design") P.begin().poly(s.foot).paint({ stroke: err ? PAL.red : PAL.amber, px: 2.2 });
      if (!pdf && sel.has(x.id)) P.begin().poly(s.foot).paint({ stroke: "#1F5FA8", px: 2, dashPx: [5, 3] });
    }
    // labels
    if (show.labels) {
      for (const x of vis) {
        if (x.kind === "point" && x.type === "label") { P.text(x.label || "Label", x.x, x.y, { size: Math.max(8, Math.min(40, (x.w || 0.6) * k * 0.8)) * (pdf ? 1 : 1), local: false, align: "center", baseline: "middle", color: PAL.ink, font: "sansBold", rot: (x.rot || 0) * Math.PI / 180 }); continue; }
        if (x.kind === "point" && x.label && (x.l * kp > 30 || pdf)) P.text(x.label, x.x, x.y + Math.max(x.l, x.w) / 2 + 0.35, { size: 9.5 * ts, align: "center", baseline: "top", color: PAL.graphite, halo: pdf ? 0 : 3 });
      }
      if (pres) numberBadges(P, prods, o.legend || legend(pr), ts, pdf);
      else for (const x of prods) { const s = DPModel.shapes(x); if (s.missing) continue; productLabel(P, x, s, k, ts, pdf, show.dims, kp); }
    }
    // north arrow inside plan (screen design mode draws it in the overlay instead)
    if (o.north && site) northArrow(P, o.north.at, o.north.size, pr.site.north || 0, pdf);
  }
  function niceStep(pxPerM, minPx) { const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]; return steps.find((s) => s * pxPerM >= minPx) || 2000; }
  function edgeLabels(P, poly, ts, pdf) {
    const cw = G.signedArea(poly) > 0 ? -1 : 1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], L = G.dist(a, b); if (L * P.k < 46) continue;
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, off = (pdf ? 3.2 : 13) / P.k * cw;
      let r = ang; if (r > Math.PI / 2 + 1e-9) r -= Math.PI; if (r < -Math.PI / 2 - 1e-9) r += Math.PI;
      P.text(fmtM(L), (a[0] + b[0]) / 2 - nx * off, (a[1] + b[1]) / 2 - ny * off, { size: 10.5 * ts, align: "center", baseline: "middle", rot: r + P.angle, color: PAL.ink, font: "sansBold", halo: pdf ? 0 : 3 });
    }
  }
  function productLabel(P, x, s, k, ts, pdf, dims, kp) {
    const p = s.p, wpx = Math.min(p.dims.l, p.dims.w) * (kp || k); if (wpx < 18 && !pdf) return;
    let r = (x.rot || 0) * Math.PI / 180; while (r > Math.PI / 2) r -= Math.PI; while (r < -Math.PI / 2) r += Math.PI;
    if (p.dims.w > p.dims.l) r += r > 0 ? -Math.PI / 2 : Math.PI / 2;
    // label sits just outside the footprint (below), so it never hides the drawing
    const bb = G.bbox(s.foot), cx = (bb.x0 + bb.x1) / 2, y = bb.y1 + (pdf ? 1.6 : 7) / k;
    const code = p.displayCode || p.code;
    P.text(dims ? `${code} · ${fmt2(p.dims.l)} × ${fmt2(p.dims.w)} m` : code, cx, y, { size: 10 * ts, align: "center", baseline: "top", color: PAL.ink, font: "sansBold", halo: pdf ? 0 : 3.5 });
  }
  const fmt2 = (n) => String(Math.round(n * 100) / 100);
  function numberBadges(P, prods, lg, ts, pdf) {
    for (const x of prods) { const s = DPModel.shapes(x); if (s.missing) continue; const n = lg.map[x.code]; if (!n) continue;
      const r = (pdf ? 2.1 : 9) / P.k * (ts > 0.5 || !pdf ? 1 : 1);
      const bb = G.bbox(s.foot), c = [bb.x1 - r * 0.2, bb.y0 + r * 0.2];
      P.begin().circle(c[0], c[1], r).paint({ fill: PAL.ink, stroke: PAL.white, px: pdf ? 0.3 : 1.5 });
      P.text(String(n), c[0], c[1], { size: (pdf ? 2.3 : 10) * (pdf ? 1 : ts), align: "center", baseline: "middle", color: PAL.white, font: "sansBold" });
    }
  }
  function northArrow(P, at, size, deg, pdf) {
    P.save().translate(at[0], at[1]).rotateDeg(deg || 0);
    const r = size;
    P.begin().circle(0, 0, r).paint({ fill: PAL.white, stroke: PAL.ink, px: pdf ? 0.25 : 1.2 });
    P.begin().moveTo(0, -r * 0.82).lineTo(r * 0.36, r * 0.45).lineTo(0, r * 0.2).close().fill(PAL.ink);
    P.begin().moveTo(0, -r * 0.82).lineTo(-r * 0.36, r * 0.45).lineTo(0, r * 0.2).close().paint({ fill: PAL.white, stroke: PAL.ink, px: pdf ? 0.2 : 1 });
    P.restore();
    const p = P.T(at[0], at[1]); void p;
  }

  root.DPPlan = { draw, legend, niceStep, northArrow, fmtM };
})(typeof self !== "undefined" ? self : this);
