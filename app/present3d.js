/* X FORCE Site Planner 3D — what the client documents say about the site. Pure: no drawing, no storage, and loaded only when a
   document needs it. The site schedule carries dimensions only, because the same page goes to engineering, who must never see money.
   The breakdown carries only what the client is already shown: never a cost, a margin or a commission. PDF fonts have ² but not ³. */
/* global DPCat, DPGeom, DPTerrain, DPModel */
(function (root) {
  "use strict";
  const MAX_SHOTS = 8;
  const PRESETS = [["corner", "Corner view"], ["front", "Front view"], ["right", "Right view"], ["back", "Back view"], ["left", "Left view"], ["top", "Top view"]];
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === "number" && isFinite(v));
  const savedViews = (project) => (Array.isArray(project && project.views3d) ? project.views3d.filter((v) => v && typeof v.name === "string" && isPoint(v.pos) && isPoint(v.target)) : []);

  /* ---------------- camera views ---------------- */
  function availableShots(project) { return savedViews(project).map((v) => ({ id: "saved:" + v.id, name: v.name, pos: v.pos, target: v.target })).concat(PRESETS.map(([id, name]) => ({ id, name, view: id }))); }
  /** Views the salesperson saved come first, because they chose them. The rest make up four from different sides. */
  function defaultShots(project) { const saved = savedViews(project).slice(0, 4).map((v) => "saved:" + v.id), out = saved.slice(); for (const id of ["corner", "front", "right", "back"]) if (out.length < 4) out.push(id); return out; }
  function resolveShots(project, chosen) { const all = availableShots(project), ids = chosen && chosen.length ? chosen : chosen ? [] : defaultShots(project); return ids.map((id) => all.find((s) => s.id === id)).filter(Boolean).slice(0, MAX_SHOTS); }

  /** The wording that must travel with a render: no picture may pass for an engineering drawing or an exact product. */
  function renderNote(info) {
    const parts = ["Illustrative 3D views, for discussing the design. Not for construction."], p = (n, one, many) => (n === 1 ? one : many.replace("#", n));
    if (info.blockouts) parts.push(`${p(info.blockouts, "One product is shown", "# products are shown")} as a plain block at catalogue size, not its real shape.`);
    if (info.approx) parts.push(`${p(info.approx, "One product uses an approximate model", "# products use approximate models")}: catalogue size, details interpreted.`);
    if (info.reviewed) parts.push(`${p(info.reviewed, "One product uses a reviewed model", "# products use reviewed models")}, which is not an engineering drawing.`);
    parts.push("Colours and finishes are indicative. Heights not in the catalogue are illustrative.");
    return parts.join(" ");
  }

  /* ---------------- site schedule: dimensions only ---------------- */
  /** Where a tag goes: the middle of an area, and halfway along a line, because a wall's outer corners can surround something else. */
  function centre(o) {
    if (o.poly && o.poly.length) { const b = root.DPGeom.bbox(o.poly); return [b.x0 + b.w / 2, b.y0 + b.h / 2]; }
    if (o.pts && o.pts.length > 1) { const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]); let left = root.DPGeom.polylineLength(o.pts) / 2; for (let i = 1; i < o.pts.length; i++) { const L = seg(o.pts[i - 1], o.pts[i]); if (left <= L && L > 0) { const k = left / L; return [o.pts[i - 1][0] + (o.pts[i][0] - o.pts[i - 1][0]) * k, o.pts[i - 1][1] + (o.pts[i][1] - o.pts[i - 1][1]) * k]; } left -= L; } return o.pts[0].slice(); }
    return [o.x, o.y];
  }
  /** Tags that would land on each other slide apart, nearest free spot first, so every number stays readable. Sizes are in page units. */
  function spreadTags(points, radius) {
    const placed = [], clear = radius * 2.3, free = (p) => placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= clear);
    return points.map((p) => { let at = p.slice(); for (let ring = 1; ring <= 6 && !free(at); ring++) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, q = [p[0] + Math.cos(a) * clear * ring, p[1] + Math.sin(a) * clear * ring]; if (free(q)) { at = q; break; } } placed.push(at); return at; });
  }
  const volumeOf = (o, tk) => { const T = root.DPTerrain, M = root.DPModel, m = o.measured; return m && m.sig === M.measureSig(o, tk) ? m.q : T.volumeOf(o); };
  function figures(o, el, fs, tk) {
    const T = root.DPTerrain, G = root.DPGeom;
    if (el.terrain) { const f = T.features({ objects: [Object.assign({}, o, { hidden: false })] })[0]; if (!f) return []; const out = [["Plan area", `${f2(G.area(o.poly))} m²`], [f.h < 0 ? "Depth" : "Height", `${f2(Math.abs(f.h))} m`]], steep = T.steepness(f); if (isFinite(steep)) out.push(["Steepest slope", `${f1(steep * 100)}%`]); out.push(["Volume, about", `${f1(volumeOf(o, tk))} m3`]); return out; }
    if (el.structure === "ramp") { const r = T.rampInfo(o, fs); return [["Rise", `${f2(r.rise)} m`], ["Length", `${f2(r.run)} m`], ["Width", `${f2(o.w)} m`], ["Slope", `${f1(r.slopePct)}%`]]; }
    if (el.structure === "stairs") { const r = T.stairInfo(o); return [["Rise", `${f2(r.rise)} m`], ["Steps", `${r.steps}`], ["Each step", `${f1(r.riser * 100)} cm high, ${f1(r.going * 100)} cm deep`], ["Width", `${f2(o.w)} m`]]; }
    if (el.structure === "retaining") { const r = T.wallInfo(o, fs); return [["Height", `${f2(r.height)} m`], ["Length", `${f2(r.length)} m`], ["Thickness", `${f2(r.width)} m`], ["Face, about", `${f1(r.face)} m²`]]; }
    if (el.structure === "tunnel") { const r = T.tunnels({ objects: [o] }, fs)[0]; if (!r) return []; const out = [["Length", `${f2(r.length)} m`], ["Width", `${f2(r.width)} m`], ["Clear height", `${f2(r.clear)} m`]]; if (Math.abs(r.gradePct) > 0.01) out.push(["Floor slope", `${f1(Math.abs(r.gradePct))}%`]); return out; }
    if (el.structure === "bridge") { const r = T.bridgeInfo(o, fs), out = [["Length", `${f2(r.length)} m`], ["Width", `${f2(r.width)} m`], ["Highest above the ground", `${f2(r.clearance)} m`]]; if (Math.abs(r.slopePct) > 0.01) out.push(["Deck slope", `${f1(Math.abs(r.slopePct))}%`]); return out; }
    const size = o.kind === "area" ? [["Plan area", `${f2(G.area(o.poly))} m²`]] : o.kind === "line" ? [["Length", `${f2(G.polylineLength(o.pts))} m`], ["Width", `${f2(o.width || el.width || 0)} m`]] : el.shape === "circle" ? [["Diameter", `${f2(o.l || el.d || 0)} m`]] : [["Size", `${f2(o.l || el.l || 0)} × ${f2(o.w || el.w || 0)} m`]];
    if (el.structure === "custom") size.push(["Height", `${f2(T.structureParams(o).height)} m`]);
    return size;
  }
  /** Every shaped site item, tagged so it can be found on the key plan. Items with no height of their own stay on the plan page. */
  function siteItems(project) {
    const T = root.DPTerrain, CAT = root.DPCat, fs = T.features(project), tk = root.DPModel.terrainKey(project), out = [];
    for (const o of project.objects || []) { if (o.kind === "product" || o.hidden) continue; const el = CAT.EL[o.type]; if (!el || el.annotation || !(el.terrain || el.structure || el.added3d)) continue;
      out.push({ id: o.id, type: el.id, name: o.label || el.name, at: centre(o), figures: figures(o, el, fs, tk), confirm: !!el.generic, engineer: el.structure === "tunnel" || el.structure === "retaining" }); }
    const rank = (r) => { const el = CAT.EL[r.type]; return el.terrain ? 0 : el.structure ? 1 : 2; };
    out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)); out.forEach((r, i) => { r.tag = String(i + 1); });
    return out;
  }
  const SCHEDULE_NOTE = "Figures come from the drawn shapes and are for planning. They are not a survey, an engineering design or an approval.";
  const ENGINEER_NOTE = "Tunnels and retaining walls must be designed by a qualified engineer.";
  const CONFIRM_NOTE = "Generic item. Confirm its size with the supplier.";

  /* ---------------- price breakdown ---------------- */
  /** Built field by field from the client's own figures, so nothing internal can come along for the ride. */
  function breakdown(r, order, labels) {
    const cats = order.filter((c) => r.cats[c] && r.cats[c].lines).map((c) => ({ key: c, label: labels[c], totalMinor: r.cats[c].totalMinor, share: r.subtotal ? r.cats[c].totalMinor / r.subtotal : 0 }));
    return { currency: r.currency, cats, subtotal: r.subtotal, discountPct: r.discountPct, discount: r.discount, afterDiscount: r.afterDiscount, taxPct: r.taxPct, taxLabel: r.taxLabel, tax: r.tax, total: r.total,
      excluded: r.lines.filter((l) => l.status === "exception" && l.exMode === "excluded").map((l) => l.name), separate: r.lines.filter((l) => l.status === "exception" && l.exMode === "separate").map((l) => l.name), included: r.lines.filter((l) => l.status === "exception" && l.exMode === "included").map((l) => l.name), unpriced: r.lines.filter((l) => l.status === "unpriced").map((l) => l.name),
      largest: r.lines.filter((l) => l.counted && !l.derived && l.kind !== "extra" && l.totalMinor > 0 && l.status !== "exception").sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 6).map((l) => ({ name: l.name, totalMinor: l.totalMinor })) };
  }

  root.DPPresent = { MAX_SHOTS, PRESETS, availableShots, defaultShots, resolveShots, renderNote, siteItems, spreadTags, breakdown, SCHEDULE_NOTE, ENGINEER_NOTE, CONFIRM_NOTE };
})(typeof self !== "undefined" ? self : this);
