/* X FORCE Site Planner 3D — turns a project into simple shapes for the 3D view. Pure functions: no DOM, no Three.js, no storage,
   and it never changes the project. Loaded only when someone opens 3D.

   Footprints come from DPModel.shapes, the same geometry the 2D plan, the overlap checks and the PDF use, so the two views
   cannot disagree on where something stands or how much ground it covers.

   Plan (x, y) in metres becomes 3D (x, height, y). Heights:
     products   the catalogue's published height. Drawn as a block-out, which says nothing about the real shape.
     elements   the catalogue has no heights for them, so VIS below gives a size for display only. It is never used for a
                quantity, a price or a check, and the 3D view tells the reader these heights are illustrative. */
/* global DPModel, DPCat, DPGeom, DPSymbols */
(function (root) {
  "use strict";
  const COL = { block: "#E6DAC0", site: "#FFFFFF", zone: "#8FA82B", fence: "#45453F", wall: "#B9B6AB", hedge: "#7C9A26", trunk: "#6B5A3E", canopy: "#A9C64A", existing: "#7C9A26", wood: "#B9A784", metal: "#5E5E58", roof: "#D9D6CB", generic: "#EAE8E1", gate: "#262626" };
  /* Display sizes in metres, for elements only. kind: tree | prism | cyl | post | overhead | flat */
  const VIS = {
    tree: { kind: "tree", color: COL.canopy }, palm: { kind: "tree", color: COL.canopy }, "tree-existing": { kind: "tree", color: COL.existing },
    shrub: { kind: "ball", color: COL.hedge }, planter: { kind: "prism", h: 0.6, color: COL.wood },
    gate: { kind: "prism", h: 1.2, color: COL.gate }, "gate-exit": { kind: "prism", h: 1.2, color: COL.gate }, "gate-double": { kind: "prism", h: 1.5, color: COL.gate }, opening: { kind: "none" },
    ramp: { kind: "prism", h: 0.1, color: COL.roof }, bench: { kind: "prism", h: 0.45, color: COL.wood }, picnic: { kind: "prism", h: 0.75, color: COL.wood }, bin: { kind: "cyl", h: 0.9, color: COL.metal },
    pergola: { kind: "overhead", h: 2.6, color: COL.wood }, shade: { kind: "overhead", h: 3, color: COL.roof }, light: { kind: "post", h: 4, color: COL.metal }, bollard: { kind: "post", h: 1, color: COL.metal },
    "g-roundabout": { kind: "cyl", h: 0.6 }, "g-spring": { kind: "prism", h: 0.8 }, "g-trampoline": { kind: "prism", h: 0.1 }, "g-seesaw": { kind: "prism", h: 0.8 }, "g-swing": { kind: "prism", h: 2.2 }, "g-basket": { kind: "prism", h: 2.2 }, "g-slide": { kind: "prism", h: 1.8 }, "g-spinner": { kind: "cyl", h: 1.2 },
    "custom-object": { kind: "prism", h: 1 },
  };
  const LINE_H = { fence: { h: 1.2, color: COL.fence, alpha: 0.45 },wall: { h: 2, color: COL.wall }, hedge: { h: 1.2, color: COL.hedge } };
  const AREA_COLOR = (el, o) => { const st = root.DPSymbols && root.DPSymbols.AREA_STYLE[el.sym]; return { color: o.color || (st && st.fill) || COL.generic, alpha: st && st.fillAlpha != null ? Math.max(st.fillAlpha, 0.25) : 1, edge: st && st.edge || null }; };
  const LINE_COLOR = (el, o) => { const st = root.DPSymbols && root.DPSymbols.LINE_STYLE[el.sym]; return o.color || (st && st.fill) || COL.generic; };

  const localPt = (o, lx, ly) => { const a = (o.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [o.x + lx * c - ly * s, o.y + lx * s + ly * c]; };
  /** A shallow cone, for a parasol: rim at y0, tip at y1, always inside its circle. */
  function coneMesh(x, y, r, y0, y1, n = 14) { const pos = [x, y1, y], idx = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pos.push(x + Math.cos(a) * r, y0, y + Math.sin(a) * r); idx.push(0, 1 + i, 1 + (i + 1) % n); } return { positions: pos, indices: idx }; }
  /* Recognisable forms, built from simple parts inside the real footprint. Heights are for display only, like everything in VIS. */
  const box = (x0, x1, y0, y1, h0, h1, color, alpha) => ({ x0, x1, y0, y1, h0, h1, color, alpha });
  const WOOD = "#B9A784", STEEL = "#5E5E58", LIME = "#9CCB3B", BLUE = "#7FBFDD", SEAT = "#2B5D45";
  function aFrame(l, w, top) { const parts = [box(-l / 2, l / 2, -0.05, 0.05, top - 0.1, top, WOOD)]; for (const x of [-l / 2 + 0.05, l / 2 - 0.05]) parts.push(box(x - 0.05, x + 0.05, -w / 2 * 0.8, w / 2 * 0.8, 0, 0.1, WOOD), box(x - 0.05, x + 0.05, -0.05, 0.05, 0, top, WOOD)); return parts; }
  const FORMS = {
    bench: (l, w) => { const e = Math.min(0.05, l * 0.05), hw = w / 2; return [box(-l / 2, l / 2, -hw, hw * 0.4, 0.42, 0.47, WOOD), box(-l / 2, l / 2, hw * 0.6, hw, 0.47, 0.85, WOOD), box(-l / 2, -l / 2 + 2 * e, -hw, hw, 0, 0.42, STEEL), box(l / 2 - 2 * e, l / 2, -hw, hw, 0, 0.42, STEEL)]; },
    picnic: (l, w) => { const hw = w / 2, e = Math.min(0.05, l * 0.05); return [box(-l / 2, l / 2, -hw * 0.42, hw * 0.42, 0.72, 0.76, WOOD), box(-l / 2, l / 2, -hw, -hw * 0.65, 0.42, 0.46, WOOD), box(-l / 2, l / 2, hw * 0.65, hw, 0.42, 0.46, WOOD), box(-l / 2 + e, -l / 2 + 3 * e, -hw, hw, 0, 0.42, STEEL), box(l / 2 - 3 * e, l / 2 - e, -hw, hw, 0, 0.42, STEEL), box(-l / 2 + e, -l / 2 + 3 * e, -0.03, 0.03, 0.42, 0.72, STEEL), box(l / 2 - 3 * e, l / 2 - e, -0.03, 0.03, 0.42, 0.72, STEEL)]; },
    planter: (l, w) => [box(-l / 2, l / 2, -w / 2, w / 2, 0, 0.55, WOOD), { ball: true, d: Math.min(l, w) * 0.9, h: 0.75, color: COL.hedge }],
    gate: (l, w) => gateForm(l, w, 1.2), "gate-exit": (l, w) => gateForm(l, w, 1.2), "gate-double": (l, w) => gateForm(l, w, 1.5),
    "g-swing": (l, w) => aFrame(l, w, 2.2).concat([-l / 4, l / 4].map((x) => box(x - 0.2, x + 0.2, -0.1, 0.1, 0.42, 0.47, SEAT))),
    "g-basket": (l, w) => aFrame(l, w, 2.2).concat([box(-w * 0.3, w * 0.3, -w * 0.3, w * 0.3, 0.5, 0.56, SEAT)]),
    "g-slide": (l, w) => { const parts = [box(l / 2 - 0.35, l / 2, -w / 2, w / 2, 0, 1.8, WOOD)]; const n = 28; for (let i = 0; i < n; i++) { const a = -l / 2 + i * (l - 0.35) / n, b = a + (l - 0.35) / n, y = 0.08 + i * 1.6 / n; parts.push(box(a, b, -w / 2, w / 2, y, y + 0.05, LIME)); } return parts; },
    "g-seesaw": (l, w) => [box(-l / 2, l / 2, -w / 2, w / 2, 0.45, 0.5, LIME), box(-0.1, 0.1, -w / 2, w / 2, 0, 0.45, STEEL)],
    "g-spring": (l, w) => [box(-0.06, 0.06, -0.06, 0.06, 0, 0.42, STEEL), box(-l / 2, l / 2, -w / 2, w / 2, 0.42, 0.5, LIME)],
    "water-table": (l, w) => { const hl = l / 2, hw = w / 2, t = 0.05; return [box(-hl, -hl + t, -hw, hw, 0, 0.55, WOOD), box(hl - t, hl, -hw, hw, 0, 0.55, WOOD), box(-hl, hl, -hw, hw, 0.55, 0.62, WOOD), box(-hl + 0.08, hl - 0.08, -hw + 0.08, hw - 0.08, 0.62, 0.64, BLUE)]; },
    "climb-wall": (l, w) => { const t = Math.min(w * 0.3, 0.08), out = [box(-l / 2, l / 2, -t, t, 0, 2.4, WOOD), box(-l / 2, l / 2, -w / 2, -w / 2 + 0.05, 0, 0.08, WOOD), box(-l / 2, l / 2, w / 2 - 0.05, w / 2, 0, 0.08, WOOD)], cols = ["#2F8FC4", "#D8452F", "#2FB59A"], n = Math.max(3, Math.round(l / 0.45)); for (let i = 0; i < n; i++) { const x = -l / 2 + (i + 0.5) * l / n, y = 0.4 + (i % 4) * 0.48; out.push(box(x - 0.05, x + 0.05, t, Math.min(w / 2, t + 0.05), y, y + 0.1, cols[i % 3])); } return out; },
    "climb-net": (l, w) => { const out = aFrame(l, w, 2.4), hw = w / 2 * 0.8, nx = Math.max(2, Math.round(l / 0.5)), ROPE = "#C9B48A"; for (const side of [-1, 1]) { for (let i = 1; i < nx; i++) { const x = -l / 2 + i * l / nx; for (let k = 0; k < 8; k++) { const y0 = side * hw * (1 - k / 8), y1 = side * hw * (1 - (k + 1) / 8); out.push(box(x - 0.012, x + 0.012, Math.min(y0, y1), Math.max(y0, y1), k * 0.3, (k + 1) * 0.3, ROPE)); } } for (let k = 1; k < 8; k++) { const y = side * hw * (1 - k / 8); out.push(box(-l / 2, l / 2, y - 0.012, y + 0.012, k * 0.3 - 0.012, k * 0.3 + 0.012, ROPE)); } } return out; },
    boulder: (l) => [{ ball: true, d: l, h: l * 0.28, sy: 0.65, color: "#B9B6AB" }],
  };
  function gateForm(l, w, h) { const t = Math.min(w / 2, 0.05), hl = l / 2; return [box(-hl, -hl + 0.08, -t, t, 0, h, COL.gate), box(hl - 0.08, hl, -t, t, 0, h, COL.gate), box(-hl, hl, -t * 0.6, t * 0.6, 0.12, 0.2, COL.gate), box(-hl, hl, -t * 0.6, t * 0.6, h - 0.1, h - 0.02, COL.gate), box(-0.03, 0.03, -t * 0.6, t * 0.6, 0.2, h - 0.1, COL.gate)]; }
  /** Points along a route, every step metres and always at both ends. */
  function everyStep(pts, step) { const out = []; let carry = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = carry; for (; t < L; t += step) out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); carry = t - L; } out.push(pts[pts.length - 1]); return out; }
  /** Breaks a route into pieces no longer than step, so a fence can follow the ground. */
  function shortSteps(pts, step) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return out; }
  function buildScene(project, { modelFor = null } = {}) {
    const M = root.DPModel, CAT = root.DPCat, G = root.DPGeom;
    const items = [], skipped = [], notes = [], T = root.DPTerrain, terrain = T ? T.features(project) : [], tunnels = T ? T.tunnels(project, terrain) : [];
    const lift = (o) => (typeof o.z === "number" && isFinite(o.z) ? o.z : 0);
    /** Where something stands: on the highest ground under it, plus its own height above the ground. */
    const standing = (o, foot) => lift(o) + (terrain.length && foot ? T.under(terrain, foot).max : 0);
    const drapeOf = (poly) => (terrain.length ? T.drapeStep(terrain, poly, tunnels) : 0), peak = terrain.reduce((a, f) => Math.max(a, f.h), 0);
    const signed = (h) => `${h < 0 ? "−" : "+"}${Math.round(Math.abs(h) * 100) / 100} m`;
    const site = project.site && project.site.poly && project.site.poly.length >= 3 ? project.site.poly : null;
    if (site) { const holes = terrain.filter((f) => f.h < 0).map((f) => f.poly); items.push(Object.assign({ t: "flat", role: "site", id: "site", poly: site, y: 0, color: COL.site, edge: "#262626" }, holes.length ? { holes } : {})); }
    const vis = (project.objects || []).filter((o) => !o.hidden);
    let layer = 0; const nextY = () => 0.012 + (layer++) * 0.0015;
    const skip = (o, why) => skipped.push({ id: o.id, name: M.shortName(o), why });

    /* 0. terrain */
    for (const f of terrain) { const o = (project.objects || []).find((x) => x.id === f.id), color = (o && o.color) || T.SURFACES[f.surface].color, c = G.centroid(f.poly);
      if (f.kind === "platform") items.push({ t: "prism", role: "surface", id: f.id, type: "platform", poly: f.poly, y0: 0, y1: f.h + 0.004, color, edges: true, shadow: true, label: signed(f.h) });
      else { const y = nextY(); items.push({ t: "flat", role: "surface", id: f.id, type: f.kind, poly: f.poly, y, color, edge: "#6F8F3A", drape: T.drapeStep(terrain, f.poly, tunnels), top: f.h, label: signed(f.h), labelAt: c ? [c[0], T.elevAt(terrain, c[0], c[1]) + 0.4, c[1]] : null }); } }
    /* 1. ground surfaces, then routes, in the order the 2D plan paints them */
    for (const o of vis) { if (o.kind !== "area") continue; const el = CAT.EL[o.type]; if (!el) { skip(o, "not in the catalogue"); continue; } if (el.terrain) continue;
      if (el.structure === "custom") { const h = T ? T.structureParams(o).height : 2, y = standing(o, o.poly); items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: o.poly, y0: y, y1: y + h, color: o.color || COL.generic, edges: true, shadow: true }); continue; }
      const c = AREA_COLOR(el, o), d = drapeOf(o.poly); items.push(Object.assign({ t: "flat", role: "surface", id: o.id, type: o.type, poly: o.poly, y: lift(o) + nextY(), color: c.color, alpha: c.alpha, edge: c.edge }, d ? { drape: d, top: peak } : {})); }
    const { gaps } = M.gateHosts(project.objects || []);
    for (const o of vis) { if (o.kind !== "line") continue; const el = CAT.EL[o.type]; if (!el) { skip(o, "not in the catalogue"); continue; } if (el.annotation) continue;
      if (el.structure === "tunnel") { const m = T.tunnelMesh(tunnels.find((t) => t.id === o.id)); items.push({ t: "mesh", role: "element", id: o.id, type: o.type, poly: o.pts, positions: m.positions, indices: m.indices, y1: m.top, color: o.color || "#8C877A", shadow: true }); continue; }
      if (el.structure === "bridge") { const m = T.bridgeMesh(T.bridgeInfo(o, terrain)); items.push({ t: "mesh", role: "element", id: o.id, type: o.type, poly: o.pts, positions: m.positions, indices: m.indices, y1: m.top, color: o.color || COL.wood, shadow: true }); continue; }
      if (el.structure === "retaining") { const info = T.wallInfo(o, terrain); for (const q of G.bandQuads(terrain.length ? shortSteps(o.pts, 1) : o.pts, o.width || el.width)) items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: q, y0: lift(o) + (terrain.length ? T.under(terrain, q).min : 0), y1: lift(o) + info.top, color: o.color || COL.wall, shadow: true }); continue; }
      const w = o.width || el.width || 0.1, lh = LINE_H[o.type], runs = gaps[o.id] && gaps[o.id].length && root.DPSymbols ? root.DPSymbols.splitRuns(o.pts, gaps[o.id]) : [o.pts];
      for (const run0 of runs) { if (o.type === "fence") for (const p of everyStep(run0, 2.5)) { const py = lift(o) + (terrain.length ? T.elevAt(terrain, p[0], p[1]) : 0); items.push({ t: "cyl", role: "element", id: o.id, type: o.type, x: p[0], y: p[1], d: 0.09, y0: py, y1: py + 1.25, color: COL.fence, shadow: true }); }
        const run = terrain.length ? shortSteps(run0, 1) : run0; for (const q of G.bandQuads(run, w)) { const y0 = standing(o, terrain.length ? q : null);
        if (lh) items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: q, y0, y1: y0 + lh.h, color: o.color || lh.color, alpha: lh.alpha, shadow: true });
        else { const d = drapeOf(q); items.push(Object.assign({ t: "flat", role: "surface", id: o.id, type: o.type, poly: q, y: lift(o) + nextY(), color: LINE_COLOR(el, o) }, d ? { drape: d, top: peak } : {})); } } } }

    /* 2. placed elements */
    for (const o of vis) { if (o.kind !== "point") continue; const el = CAT.EL[o.type]; if (!el) { skip(o, "not in the catalogue"); continue; } if (el.annotation) continue;
      const s = M.shapes(o), v = VIS[o.type] || { kind: el.shape === "circle" ? "cyl" : "prism", h: 1 }, y0 = standing(o, s.foot), col = o.color || v.color || COL.generic, d = el.shape === "circle" ? o.l : Math.min(o.l, o.w);
      const round = (y, top, dia, color) => items.push({ t: "cyl", role: "element", id: o.id, type: o.type, x: o.x, y: o.y, d: dia, y0: y, y1: top, color, shadow: true });
      if (v.kind === "none") continue;
      if (el.structure === "custom") { const h = T ? T.structureParams(o).height : v.h; items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: s.foot, y0, y1: y0 + h, color: col, shadow: true }); continue; }
      const parts = FORMS[o.type] && !o.color ? FORMS[o.type](o.l, o.w) : null;
      if (parts) { for (const b of parts) { if (b.ball) { const c = localPt(o, b.x || 0, b.y || 0); items.push({ t: "ball", role: "element", id: o.id, type: o.type, x: c[0], y: c[1], d: b.d, cy: y0 + b.h, sy: b.sy || 0.8, color: b.color, shadow: true }); } else items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => localPt(o, x, y)), y0: y0 + b.h0, y1: y0 + b.h1, color: b.color, alpha: b.alpha, shadow: true }); } continue; }
      if (o.type === "umbrella") { round(y0, y0 + 2.3, 0.07, COL.metal); const m = coneMesh(o.x, o.y, o.l / 2, y0 + 2.05, y0 + 2.6); items.push({ t: "mesh", role: "element", id: o.id, type: o.type, poly: s.foot, positions: m.positions, indices: m.indices, y1: y0 + 2.6, color: col, shadow: true }); continue; }
      if (o.type === "water-jet") { round(y0, y0 + 0.05, o.l, "#3C8DB5"); round(y0, y0 + 1.1, 0.06, "#7FBFDD"); items.push({ t: "ball", role: "element", id: o.id, type: o.type, x: o.x, y: o.y, d: o.l, cy: y0 + 1.1, sy: 0.35, color: "#BFDDEB", alpha: 0.7, shadow: false }); continue; }
      if (el.structure === "stairs") { const y = lift(o) + T.lowEndGround(o, terrain); for (const st of T.stairTreads(o)) items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: st.poly, y0: y, y1: y + st.top, color: o.color || COL.roof, edges: true, shadow: true }); continue; }
      if (el.structure === "ramp" && T && T.structureParams(o).rise > 0) { const m = T.rampMesh(o, lift(o) + T.lowEndGround(o, terrain)); items.push({ t: "mesh", role: "element", id: o.id, type: o.type, poly: s.foot, positions: m.positions, indices: m.indices, y1: m.top, color: o.color || COL.roof, shadow: true }); continue; }
      if (v.kind === "tree") { const h = Math.max(1.5, o.l * 0.45); round(y0, y0 + h, Math.max(0.12, o.l * 0.07), COL.trunk); items.push({ t: "ball", role: "element", id: o.id, type: o.type, x: o.x, y: o.y, d: o.l, cy: y0 + h + o.l * 0.32, sy: 0.8, color: col, shadow: true }); }
      else if (v.kind === "ball") items.push({ t: "ball", role: "element", id: o.id, type: o.type, x: o.x, y: o.y, d: o.l, cy: y0 + o.l * 0.4, sy: 0.8, color: col, shadow: true });
      else if (v.kind === "post") round(y0, y0 + v.h, Math.max(0.1, Math.min(0.25, d)), col);
      else if (v.kind === "cyl") round(y0, y0 + v.h, d, col);
      else if (v.kind === "overhead") { for (const c of s.foot) items.push({ t: "cyl", role: "element", id: o.id, type: o.type, x: c[0], y: c[1], d: 0.2, y0, y1: y0 + v.h, color: COL.metal, shadow: true });
        items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: s.foot, y0: y0 + v.h, y1: y0 + v.h + 0.1, color: col, alpha: 0.75, shadow: true }); }
      else items.push({ t: "prism", role: "element", id: o.id, type: o.type, poly: s.foot, y0, y1: y0 + v.h, color: col, shadow: true });
    }

    /* 3. products: the real footprint and the published height, nothing more */
    let products = 0;
    for (const o of vis) { if (o.kind !== "product") continue; const s = M.shapes(o);
      if (s.missing) { skip(o, CAT.BY[o.code] ? "no published dimensions" : "not in the catalogue"); continue; }
      const h = s.p.dims.h; if (!(h > 0)) { skip(o, "no published height"); continue; }
      const y0 = standing(o, s.foot); products++;
      const rec = modelFor ? modelFor(o.code) : null, finish = rec && o.finish ? (rec.colours || []).find((c) => c.id === o.finish) : null;
      items.push({ t: "prism", role: "product", id: o.id, code: o.code, poly: s.foot, x: o.x, y: o.y, rot: o.rot || 0, y0, y1: y0 + h, color: o.color || (finish && finish.hex) || COL.block, edges: true, shadow: true, accuracy: rec ? rec.accuracy : "block-out", model: rec && rec.file ? rec : null, label: s.p.displayCode || s.p.code });
      if (s.zone) { const d = drapeOf(s.zone); items.push(Object.assign({ t: "flat", role: "zone", id: o.id, poly: s.zone, y: (d ? lift(o) : y0) + 0.008, color: COL.zone, alpha: 0.16, edge: COL.zone }, d ? { drape: d, top: peak } : {})); } }

    if (project.cad || project.ref) notes.push("CAD and reference images show in the 2D plan only.");
    return { items, skipped, notes, products, terrain, tunnels, bounds: boundsOf(items) };
  }

  /** World box in plan metres, plus the tallest point. Null when nothing is drawn. */
  function boundsOf(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = 0, n = 0;
    const pt = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); n++; };
    for (const it of items) {
      if (it.poly) it.poly.forEach((p) => pt(p[0], p[1]));
      else { const r = it.d / 2; pt(it.x - r, it.y - r); pt(it.x + r, it.y + r); }
      top = Math.max(top, it.y1 != null ? it.y1 : it.cy != null ? it.cy + it.d * it.sy / 2 : it.y || 0, it.top || 0);
    }
    return n ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, top, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } : null;
  }

  /** Where each camera preset stands. Front looks up the plan from its bottom edge; the rest follow from that. */
  function cameraFor(view, b, fovDeg, aspect) {
    const box = b || { cx: 0, cy: 0, w: 30, h: 20, top: 0 }, W = Math.max(box.w, 2), H = Math.max(box.h, 2), T = box.top || 0;
    const target = [box.cx, T * 0.3, box.cy];
    const dirs = { top: [0, 1, 0.0001], front: [0, 0.22, 1], back: [0, 0.22, -1], left: [-1, 0.22, 0], right: [1, 0.22, 0], corner: [0.62, 0.56, 0.55] };
    const raw = dirs[view] || dirs.corner, len = Math.hypot(...raw), d = raw.map((v) => v / len);
    // camera axes, then the nearest distance that keeps all eight corners of the project's box on screen
    const rl = Math.hypot(d[2], d[0]) || 1, right = [d[2] / rl, 0, -d[0] / rl], up = [d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0]];
    const tv = Math.tan(fovDeg * Math.PI / 360), th = tv * Math.max(aspect, 0.01), dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    let dist = 3;
    for (const x of [-W / 2, W / 2]) for (const z of [-H / 2, H / 2]) for (const y of [-target[1], T - target[1]]) { const c = [x, y, z]; dist = Math.max(dist, dot(d, c) + Math.max(Math.abs(dot(right, c)) / th, Math.abs(dot(up, c)) / tv)); }
    dist *= 1.08;
    return { target, pos: [target[0] + d[0] * dist, target[1] + d[1] * dist, target[2] + d[2] * dist], dist };
  }

  /* ---------------- product library: reading a GLB and judging it against the catalogue ---------------- */
  const SIZE_TOLERANCE = 0.05;   // metres. A model further than this from the catalogue is flagged and not shown as the product.
  const ACCURACY = { "block-out": "Block-out", approximate: "Approximate model", reviewed: "Reviewed model" };
  /* Size targets from the plan. A model over them still loads on a desktop, but is flagged so it can be slimmed. */
  const BUDGET = { estate: { kb: 3072, tris: 100000 }, tower: { kb: 1536, tris: 40000 }, adventure: { kb: 1024, tris: 30000 }, early: { kb: 512, tris: 15000 }, landscape: { kb: 205, tris: 6000 }, custom: { kb: 1536, tris: 40000 } };
  const multiply = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], [x, y, z, w] = q;
    return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
  }
  /** Reads a GLB's own header: overall size in metres, triangles, textures and file size. No graphics engine needed. */
  function glbInfo(buffer) {
    const bad = (m) => { throw new Error(m); };
    if (!buffer || buffer.byteLength < 20) bad("This file is too small to be a GLB model.");
    const dv = new DataView(buffer); if (dv.getUint32(0, true) !== 0x46546C67) bad("This file is not a GLB model."); if (dv.getUint32(4, true) !== 2) bad("Only GLB version 2 is supported.");
    if (dv.getUint32(16, true) !== 0x4E4F534A) bad("This GLB model has no description block.");
    const len = dv.getUint32(12, true); if (20 + len > buffer.byteLength) bad("This GLB model is cut short.");
    const bytes = new Uint8Array(buffer, 20, len); let text = ""; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    let g; try { g = JSON.parse(text); } catch (e) { bad("This GLB model's description can't be read."); }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; let triangles = 0, bounded = false;
    const sceneNodes = ((g.scenes || [])[g.scene || 0] || {}).nodes || [];
    const visit = (i, parent) => { const n = (g.nodes || [])[i]; if (!n) return; const m = multiply(parent, nodeMatrix(n));
      if (n.mesh != null) for (const p of ((g.meshes || [])[n.mesh] || {}).primitives || []) { const a = (g.accessors || [])[p.attributes && p.attributes.POSITION]; if (!a) continue;
        if ((p.mode == null || p.mode === 4)) { const ix = p.indices != null ? g.accessors[p.indices] : a; triangles += Math.floor((ix ? ix.count : 0) / 3); }
        if (a.min && a.max) { bounded = true; for (const x of [a.min[0], a.max[0]]) for (const y of [a.min[1], a.max[1]]) for (const z of [a.min[2], a.max[2]]) { const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } } } }
      for (const c of n.children || []) visit(c, m); };
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; sceneNodes.forEach((i) => visit(i, ident));
    if (!bounded) bad("This GLB model doesn't state its size.");
    return { l: mx[0] - mn[0], w: mx[2] - mn[2], h: mx[1] - mn[1], cx: (mx[0] + mn[0]) / 2, cz: (mx[2] + mn[2]) / 2, base: mn[1], triangles, textures: (g.textures || []).length, kb: Math.round(buffer.byteLength / 1024), needsDecoder: (g.extensionsRequired || []).filter((e) => /draco|meshopt|basisu/i.test(e)) };
  }
  /** Compares a model with the published size. Anything in problems means it is not shown as the product; notes are only advice. */
  function checkModel(info, product) {
    const problems = [], notes = [], d = product && product.dims, m = (v) => v.toFixed(2) + " m";
    if (!d) problems.push("The catalogue has no dimensions for this product, so the model can't be checked.");
    else for (const [k, label, have, want] of [["l", "Length", info.l, d.l], ["w", "Width", info.w, d.w], ["h", "Height", info.h, d.h]]) if (want > 0 && Math.abs(have - want) > SIZE_TOLERANCE) problems.push(`${label} is ${m(have)}, the catalogue says ${m(want)}.`);
    if (Math.abs(info.cx) > SIZE_TOLERANCE || Math.abs(info.cz) > SIZE_TOLERANCE) problems.push("The model isn't centred on its origin, so it would stand in the wrong place.");
    if (Math.abs(info.base) > SIZE_TOLERANCE) problems.push("The model doesn't stand on the ground: its base should be at height 0.");
    if (info.needsDecoder.length) problems.push(`This model needs ${info.needsDecoder.join(", ")}, which the app's security policy blocks. Export it without that compression.`);
    const b = BUDGET[product && product.collection] || BUDGET.custom;
    if (info.kb > b.kb) notes.push(`File is ${info.kb} KB, over the ${b.kb} KB target for this collection.`);
    if (info.triangles > b.tris) notes.push(`${info.triangles.toLocaleString("en-US")} triangles, over the ${b.tris.toLocaleString("en-US")} target for this collection.`);
    return { ok: !problems.length, problems, notes };
  }
  /** One product's library record: the file shipped with the app, plus what administrators recorded in the catalogue. */
  function libraryRecord(code, shipped, recorded) {
    const a = (shipped && shipped[code]) || null, b = (recorded && recorded[code]) || null; if (!a && !b) return null;
    const r = Object.assign({ file: null, accuracy: "approximate", source: "", colours: [], materials: [], reviewedBy: "", reviewedAt: "", note: "" }, a || {}, b || {});
    if (!r.file) r.accuracy = "block-out";
    else if (r.accuracy !== "reviewed" || !r.reviewedBy || !r.source) r.accuracy = "approximate";   // "reviewed" must name who and from what
    return r;
  }

  /* ---------------- saved cameras: project.views3d = [{ id, name, pos:[x,y,z], target:[x,y,z] }] ---------------- */
  const MAX_VIEWS = 20;
  const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === "number" && isFinite(v));
  /** The saved cameras that are safe to use; anything damaged is left out rather than aimed at nothing. */
  function savedViews(project) { const l = project && project.views3d; return Array.isArray(l) ? l.filter((v) => v && typeof v.name === "string" && isPoint(v.pos) && isPoint(v.target)) : []; }
  function addView(project, name, pos, target) {
    const clean = String(name || "").trim().slice(0, 40), l = savedViews(project);
    if (!clean) throw new Error("Give the view a name.");
    if (!isPoint(pos) || !isPoint(target)) throw new Error("This camera position can't be saved.");
    if (l.length >= MAX_VIEWS) throw new Error(`A project can keep ${MAX_VIEWS} saved views. Delete one first.`);
    const round = (p) => p.map((v) => Math.round(v * 1000) / 1000), v = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: clean, pos: round(pos), target: round(target) };
    project.views3d = l.concat([v]); return v;
  }
  function removeView(project, id) { project.views3d = savedViews(project).filter((v) => v.id !== id); if (!project.views3d.length) delete project.views3d; }

  root.DPScene3D = { buildScene, boundsOf, cameraFor, savedViews, addView, removeView, MAX_VIEWS, VIS, LINE_H, glbInfo, checkModel, libraryRecord, SIZE_TOLERANCE, ACCURACY, BUDGET };
})(typeof self !== "undefined" ? self : this);
