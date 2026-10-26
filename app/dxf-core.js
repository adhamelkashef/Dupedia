/* DXF processing core (shared by the worker and the main-thread fallback).
   Parses with dxf-parser (MIT) and normalises to a compact editing representation.
   The source file text is never modified; this produces a separate normalised copy.
   Output coordinates are in DRAWING UNITS with the y axis flipped (DXF is y-up, the planner is y-down). */
/* global DxfParser */
(function (root) {
"use strict";
const MAX_POINTS = 1500000;          // guard against pathological drawings
const ARC_SEG = 72;                  // segments per full circle

function process(text, name, emit) {
  const post = (type, data) => emit({ type, ...data });
  try {
    post("progress", { stage: "Reading drawing", pct: 10 });
    if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error("This is a binary DXF. Save it as ASCII DXF from AutoCAD (SAVEAS → DXF, ASCII) and upload again.");
    if (!/\bSECTION\b/.test(text.slice(0, 4000)) || !/\bENTITIES\b/.test(text)) throw new Error("The file has no DXF ENTITIES section. It may be corrupted or not a DXF file.");
    const Parser = root.DxfParser.default || root.DxfParser;
    let dxf;
    try { dxf = new Parser().parseSync(text); } catch (e) { throw new Error("The DXF could not be read (" + (e && e.message ? e.message : "parse error") + "). It may be corrupted."); }
    if (!dxf || !dxf.entities) throw new Error("The DXF could not be read.");
    post("progress", { stage: "Converting geometry", pct: 45 });
    const out = normalise(dxf);
    out.fileName = name;
    post("progress", { stage: "Finding closed shapes", pct: 85 });
    out.candidates = candidates(out.paths);
    if (!out.paths.length) throw new Error("The DXF contains no drawable geometry in model space.");
    post("done", out);
  } catch (e) {
    post("error", { message: e && e.message ? e.message : String(e) });
  }
}

function normalise(dxf) {
  const layerNames = [], layerIndex = {}, layers = [];
  const lt = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
  const addLayer = (n) => {
    if (n in layerIndex) return layerIndex[n];
    const L = lt[n] || {};
    layerIndex[n] = layers.length; layerNames.push(n);
    layers.push({ name: n, color: typeof L.color === "number" ? L.color : null, frozen: !!L.frozen, visible: L.visible !== false && !L.frozen, count: 0 });
    return layerIndex[n];
  };
  Object.keys(lt).forEach(addLayer);
  const paths = [], texts = [], counts = {}, skipped = {};
  let points = 0;
  const pushPath = (layer, pts, closed, approx) => {
    if (pts.length < 2) return;
    points += pts.length;
    if (points > MAX_POINTS) throw new Error("The drawing is too large to process in the browser (more than 1.5 million points). Remove unneeded layers (e.g. hatches, details) and export again.");
    const flat = new Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) { flat[2 * i] = round(pts[i][0]); flat[2 * i + 1] = round(-pts[i][1]); }
    const li = addLayer(layer || "0"); layers[li].count++;
    paths.push({ l: li, p: flat, c: !!closed, a: approx ? 1 : 0 });
  };
  const blocks = dxf.blocks || {};
  const walk = (ents, T, depth, inheritedLayer) => {
    for (const e of ents) {
      const layer = (e.layer === "0" && inheritedLayer) ? inheritedLayer : (e.layer || "0");
      counts[e.type] = (counts[e.type] || 0) + 1;
      switch (e.type) {
        case "LINE": pushPath(layer, e.vertices.map(T), false); break;
        case "LWPOLYLINE": case "POLYLINE": {
          if (!e.vertices || !e.vertices.length) break;
          const closed = !!e.shape || !!e.closed;
          pushPath(layer, bulgeLine(e.vertices, closed).map(T), closed); break;
        }
        case "CIRCLE": pushPath(layer, arcPts(e.center, e.radius, 0, 2 * Math.PI).map(T), true); break;
        case "ARC": {
          let a0 = e.startAngle, a1 = e.endAngle; if (a1 <= a0) a1 += 2 * Math.PI;
          pushPath(layer, arcPts(e.center, e.radius, a0, a1).map(T), false); break;
        }
        case "ELLIPSE": {
          const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y, R = Math.hypot(mx, my), r = R * e.axisRatio, rot = Math.atan2(my, mx);
          let a0 = e.startAngle || 0, a1 = e.endAngle || 2 * Math.PI; if (a1 <= a0) a1 += 2 * Math.PI;
          const n = Math.max(8, Math.ceil(ARC_SEG * (a1 - a0) / (2 * Math.PI))), pts = [];
          for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n, x = R * Math.cos(t), y = r * Math.sin(t);
            pts.push({ x: e.center.x + x * Math.cos(rot) - y * Math.sin(rot), y: e.center.y + x * Math.sin(rot) + y * Math.cos(rot) }); }
          pushPath(layer, pts.map(T), Math.abs(a1 - a0 - 2 * Math.PI) < 1e-6); break;
        }
        case "SPLINE": {
          const src = (e.fitPoints && e.fitPoints.length > 1) ? e.fitPoints : e.controlPoints;
          if (src && src.length > 1) pushPath(layer, src.map(T), !!e.closed, true); break;   // approximation, flagged
        }
        case "SOLID": case "3DFACE": case "TRACE": {
          const v = e.points || e.vertices; if (v && v.length >= 3) pushPath(layer, v.map(T), true); break;
        }
        case "TEXT": case "MTEXT": case "ATTRIB": {
          const pos = e.startPoint || e.position; if (!pos || !e.text) break;
          const p = T(pos), q = T({ x: pos.x + 1, y: pos.y });
          const sc = Math.hypot(q[0] - p[0], q[1] - p[1]);
          texts.push({ l: addLayer(layer), x: round(p[0]), y: round(-p[1]), h: (e.textHeight || e.height || 1) * sc,
                       t: String(e.text).replace(/\\P/g, " ").replace(/\{\\[^;]*;|\}|\\[A-Za-z][^;]*;/g, "").slice(0, 200), r: (e.rotation || 0) });
          break;
        }
        case "INSERT": case "DIMENSION": {
          const b = blocks[e.name || e.block]; if (!b || !b.entities || depth > 8) { if (e.type === "INSERT") skipped.INSERT = (skipped.INSERT || 0) + 1; break; }
          const base = b.position || { x: 0, y: 0 }, pos = e.position || { x: 0, y: 0 };
          const sx = e.xScale || 1, sy = e.yScale || 1, rot = (e.rotation || 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
          const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
          for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
            const offx = ci * (e.columnSpacing || 0), offy = ri * (e.rowSpacing || 0);
            const T2 = (p) => { const x = (p.x - base.x) * sx + offx, y = (p.y - base.y) * sy + offy; return T({ x: pos.x + x * c - y * s, y: pos.y + x * s + y * c }); };
            walk(b.entities, T2, depth + 1, layer);
          }
          break;
        }
        default: skipped[e.type] = (skipped[e.type] || 0) + 1;
      }
    }
  };
  // T maps a DXF point to [x, y] in drawing units (before the y flip done in pushPath)
  walk(dxf.entities, (p) => [p.x, p.y], 0, null);
  const hdr = dxf.header || {};
  let bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const P of paths) for (let i = 0; i < P.p.length; i += 2) { const x = P.p[i], y = P.p[i + 1];
    if (x < bb.x0) bb.x0 = x; if (y < bb.y0) bb.y0 = y; if (x > bb.x1) bb.x1 = x; if (y > bb.y1) bb.y1 = y; }
  return { layers, paths, texts, bbox: bb, insunits: typeof hdr.$INSUNITS === "number" ? hdr.$INSUNITS : null,
           measurement: typeof hdr.$MEASUREMENT === "number" ? hdr.$MEASUREMENT : null,
           acadver: hdr.$ACADVER || null, counts, skipped, points };
}

function round(v) { return Math.round(v * 1e6) / 1e6; }
function arcPts(c, r, a0, a1) {
  const n = Math.max(4, Math.ceil(ARC_SEG * (a1 - a0) / (2 * Math.PI))), pts = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }); }
  return pts;
}
/** Expand polyline bulges (arc segments) into points. */
function bulgeLine(v, closed) {
  const out = [], n = v.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = v[i], b = v[(i + 1) % n], bulge = a.bulge || 0;
    out.push({ x: a.x, y: a.y });
    if (Math.abs(bulge) > 1e-9) {
      const theta = 4 * Math.atan(bulge), dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
      if (chord > 0) {
        const r = chord / (2 * Math.sin(Math.abs(theta) / 2)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
        const cx = mx - h * dy / chord, cy = my + h * dx / chord;
        let a0 = Math.atan2(a.y - cy, a.x - cx);
        const steps = Math.max(2, Math.ceil(ARC_SEG * Math.abs(theta) / (2 * Math.PI)));
        for (let k = 1; k < steps; k++) { const t = a0 + theta * k / steps; out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }); }
      }
    }
  }
  if (!closed) out.push({ x: v[n - 1].x, y: v[n - 1].y });
  return out;
}
/** Closed paths (≥ 3 points) ranked by area: candidates for the site boundary or obstacles. */
function candidates(paths) {
  const res = [];
  paths.forEach((P, i) => {
    if (!P.c || P.p.length < 6) return;
    let a = 0; const n = P.p.length / 2;
    for (let k = 0; k < n; k++) { const j = (k + 1) % n; a += P.p[2 * k] * P.p[2 * j + 1] - P.p[2 * j] * P.p[2 * k + 1]; }
    a = Math.abs(a / 2); if (a > 0) res.push({ i, area: a, n });
  });
  return res.sort((x, y) => y.area - x.area).slice(0, 80);
}

root.DPDxf = { process, normalise, candidates };
})(typeof self !== "undefined" ? self : this);
