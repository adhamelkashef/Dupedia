/* X FORCE Site Planner 3D — terrain maths. Pure functions: no DOM, no Three.js, no storage, and it never changes the project.
   Loaded only with the 3D view.

   Terrain is ordinary "area" objects with a few real-world dimensions, so undo, copying, saving and the 2D plan already work.
   The surface is calculated from those dimensions, never stored as a mesh:

     platform  flat top at its height, vertical sides.
     level     flat top at its height (below 0 for a sunken area), sloping down inside its outline over the given run.
     hill      rises from its outline to its height, over the given run (by default all the way to the middle).

   Every outline is the true plan footprint: slopes stay inside it, so plan area and footprint mean the same thing in 2D and 3D.
   Where shapes overlap, the higher ground wins and sunken areas cut into it. Volumes and sloped areas are worked out on a fine
   grid, so they are close estimates for planning, not survey figures. */
/* global DPCat, DPGeom */
(function (root) {
  "use strict";
  const CAT = () => root.DPCat, G = () => root.DPGeom;
  const LIMITS = { platform: { min: 0.05, max: 6 }, level: { min: -5, max: 6 }, hill: { min: 0.1, max: 12 } };
  const SURFACES = { grass: { name: "Grass", color: "#B7CF85" }, soil: { name: "Soil", color: "#B79B73" }, turf: { name: "Artificial grass", color: "#9FC463" }, rubber: { name: "Rubber", color: "#C9C2B2" }, concrete: { name: "Concrete", color: "#CFCCC3" }, timber: { name: "Timber deck", color: "#B98A52" } };

  /* ---------------- reading one object ---------------- */
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  /** The object's terrain settings, with the catalogue's defaults for anything not yet chosen. Null if it isn't terrain. */
  function params(o) {
    const el = CAT().EL[o.type]; if (!el || !el.terrain) return null;
    const d = el.terrainDefaults || {}, t = o.terrain || {}, lim = LIMITS[el.terrain], height = Math.max(lim.min, Math.min(lim.max, num(t.height, d.height || 1)));
    const run = t.run == null ? (d.run === undefined ? null : d.run) : Math.max(0, num(t.run, 0));
    return { kind: el.terrain, height, run, round: el.terrain === "hill" && (t.profile || d.profile || "round") === "round", surface: SURFACES[t.surface || d.surface] ? (t.surface || d.surface) : "grass" };
  }
  function insideDistance(p, poly) { const g = G(); if (!g.pointInPolygon(p, poly, false)) return 0; let best = Infinity; for (let i = 0, n = poly.length; i < n; i++) { const d = g.distPointSeg(p, poly[i], poly[(i + 1) % n]); if (d < best) best = d; } return best; }
  /** How far the middle of a shape is from its edge: the largest circle that fits, found by search with a fine final step. */
  function inradius(poly) {
    const b = G().bbox(poly); let best = 0, at = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const n = 24; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const p = [b.x0 + (i + 0.5) * b.w / n, b.y0 + (j + 0.5) * b.h / n], d = insideDistance(p, poly); if (d > best) { best = d; at = p; } }
    let step = Math.max(b.w, b.h) / n; for (let k = 0; k < 40 && step > 1e-4; k++) { let moved = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const p = [at[0] + dx * step, at[1] + dy * step], d = insideDistance(p, poly); if (d > best) { best = d; at = p; moved = true; } } if (!moved) step /= 2; }
    return best;
  }
  /** Prepares every visible terrain object for fast height look-ups. */
  function features(project) {
    const out = [], g = G();
    for (const o of (project && project.objects) || []) { if (o.kind !== "area" || o.hidden || !o.poly || o.poly.length < 3) continue; const t = params(o); if (!t) continue;
      const inr = inradius(o.poly); let run = t.run;
      if (t.kind === "platform") run = 0; else if (run == null) run = t.kind === "hill" ? inr : Math.abs(t.height) * 2;
      out.push({ id: o.id, poly: o.poly, bbox: g.bbox(o.poly), kind: t.kind, h: t.height, run, round: t.round, inr, surface: t.surface }); }
    return out;
  }
  const shape = (f, t) => (f.round ? t * t * (3 - 2 * t) : t);
  function heightOf(f, x, y) {
    const b = f.bbox; if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return 0;
    if (f.kind === "platform") return G().pointInPolygon([x, y], f.poly, false) ? f.h : 0;
    const d = insideDistance([x, y], f.poly); if (d <= 0) return 0; return f.h * shape(f, f.run > 0 ? Math.min(1, d / f.run) : 1);
  }
  /** Ground height at a plan point: 0 is the site's base level. Higher shapes win where they overlap; sunken ones cut in. */
  function elevAt(fs, x, y) { let up = 0, down = 0; for (const f of fs) { const v = heightOf(f, x, y); if (v > up) up = v; else if (v < down) down = v; } return up + down; }

  /* ---------------- dimensions ---------------- */
  /** Integrates over a plan box on a fine grid. fn gets a point inside; cells outside "inside" count for nothing. */
  function integrate(box, n, inside, fn) { const dx = box.w / n, dy = box.h / n, cell = dx * dy; let sum = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = box.x0 + (i + 0.5) * dx, y = box.y0 + (j + 0.5) * dy; if (inside(x, y)) sum += fn(x, y, dx, dy) * cell; } return sum; }
  /** A shape's steepest slope, as a fraction. Straight from its dimensions, so it costs nothing to ask. */
  const steepness = (f) => (f.kind === "platform" || !(f.run > 0) ? Infinity : Math.abs(f.h) / f.run * (f.round ? 1.5 : 1));
  /** One shape's own figures: volume above (or cut below) the base level, highest point and steepest slope. */
  function stats(f) {
    const reach = f.kind === "platform" ? 1 : f.run > 0 ? Math.min(1, f.inr / f.run) : 1, peak = f.h * shape(f, reach), vol = Math.abs(integrate(f.bbox, 240, (x, y) => G().pointInPolygon([x, y], f.poly, false), (x, y) => heightOf(f, x, y)));
    const steep = steepness(f);
    return { kind: f.kind, height: f.h, peak, reachesHeight: Math.abs(peak - f.h) < 1e-6, run: f.run, volume: vol, slope: steep, slopePct: isFinite(steep) ? steep * 100 : null, slopeRatio: isFinite(steep) && steep > 0 ? 1 / steep : null };
  }
  /** Earth the whole design adds and removes, with overlaps counted once. */
  function volumes(fs) {
    if (!fs.length) return { fill: 0, cut: 0, peak: 0, low: 0 }; const box = G().bbox(fs.flatMap((f) => f.poly)); let fill = 0, cut = 0, peak = 0, low = 0;
    const n = 240, dx = box.w / n, dy = box.h / n, cell = dx * dy; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const e = elevAt(fs, box.x0 + (i + 0.5) * dx, box.y0 + (j + 0.5) * dy); if (e > 0) { fill += e * cell; if (e > peak) peak = e; } else if (e < 0) { cut -= e * cell; if (e < low) low = e; } }
    return { fill, cut, peak, low };
  }
  /** True area of a surface laid over the terrain. A jump at a platform's edge is a vertical face, not part of the surface. */
  function surfaceArea(fs, poly) {
    const g = G(), plan = g.area(poly), box = g.bbox(poly), near = fs.filter((f) => overlaps(f, box)); if (!near.length) return { plan, actual: plan }; const N = 150, cell = Math.max(box.w, box.h) / N, e = cell / 2;
    const actual = integrate(box, N, (x, y) => g.pointInPolygon([x, y], poly, false), (x, y) => { const hx = (elevAt(near, x + e, y) - elevAt(near, x - e, y)) / (2 * e), hy = (elevAt(near, x, y + e) - elevAt(near, x, y - e)) / (2 * e), m = hx * hx + hy * hy; return m > 25 ? 1 : Math.sqrt(1 + m); });
    const scale = plan / Math.max(1e-9, integrate(box, N, (x, y) => g.pointInPolygon([x, y], poly, false), () => 1));   // corrects the grid's staircase at slanted edges
    return { plan, actual: actual * scale };
  }
  /** What's under a footprint: an object stands on the highest point, so it never sinks into the ground. */
  function under(fs, poly) {
    if (!fs.length) return { min: 0, max: 0, varies: 0 }; const b = G().bbox(poly); let min = Infinity, max = -Infinity; const see = (x, y) => { const e = elevAt(fs, x, y); if (e < min) min = e; if (e > max) max = e; };
    for (const p of poly) see(p[0], p[1]); for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const x = b.x0 + b.w * i / 6, y = b.y0 + b.h * j / 6; if (G().pointInPolygon([x, y], poly, true)) see(x, y); }
    return { min, max, varies: max - min };
  }
  const overlaps = (f, b) => !(b.x1 < f.bbox.x0 || b.x0 > f.bbox.x1 || b.y1 < f.bbox.y0 || b.y0 > f.bbox.y1);
  /** Mesh spacing for a surface over this terrain, or 0 when nothing here is touched and it can stay flat. */
  function drapeStep(fs, poly, ts = []) { const b = G().bbox(poly); let step = 0; for (const f of fs) { if (!overlaps(f, b)) continue; const s = f.kind === "platform" ? 1 : Math.max(0.2, Math.min(1, (f.run || f.inr || 1) / 6, (f.inr || 1) / 6)); step = step ? Math.min(step, s) : s; }
    if (step) for (const t of ts) if (!(b.x1 < t.bbox.x0 || b.x0 > t.bbox.x1 || b.y1 < t.bbox.y0 || b.y0 > t.bbox.y1)) step = Math.min(step, Math.max(0.2, t.width / 4)); return step; }
  /** Splits plan triangles until no edge is longer than step. The rule depends only on each edge, so neighbours never crack apart. */
  function subdivide(tris, step, maxTris = 90000) {
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (let s = step; ; s *= 1.5) { const out = [], st = tris.slice(); let over = false;
      while (st.length) { const [a, b, c] = st.pop(), ab = dist(a, b), bc = dist(b, c), ca = dist(c, a), m = Math.max(ab, bc, ca); if (m <= s) { out.push([a, b, c]); if (out.length > maxTris) { over = true; break; } continue; }
        if (ab === m) { const q = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; st.push([a, q, c], [q, b, c]); } else if (bc === m) { const q = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; st.push([b, q, a], [q, c, a]); } else { const q = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; st.push([c, q, b], [q, a, b]); } }
      if (!over) return { tris: out, step: s }; }
  }
  /** Mesh over the terrain: x and y in plan metres, height from the ground plus a small lift to stay above the layer below.
   *  open(x, y, ground) can leave holes, for tunnel mouths. */
  function draped(fs, tris, step, lift, open) {
    const { tris: small } = subdivide(tris, step), seen = new Map(), pos = [], idx = [];
    const at = (p) => { const k = Math.round(p[0] * 1e4) + "," + Math.round(p[1] * 1e4); let i = seen.get(k); if (i == null) { i = pos.length / 3; seen.set(k, i); pos.push(p[0], elevAt(fs, p[0], p[1]) + lift, p[1]); } return i; };
    for (const [a, b, c] of small) { if (open) { const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3; if (open(x, y, elevAt(fs, x, y))) continue; } idx.push(at(a), at(b), at(c)); } return { positions: pos, indices: idx };
  }

  /* ---------------- structures: ramps, stairs, retaining walls and tunnels ----------------
     These report figures and draw solids. They never judge: slope and accessibility limits belong to the engineering checks. */
  const STRUCTURE_LIMITS = { ramp: { rise: { min: 0, max: 6 } }, stairs: { rise: { min: 0.1, max: 6 }, steps: { min: 1, max: 40 } }, retaining: { height: { min: 0.1, max: 6 } }, tunnel: { clear: { min: 0.6, max: 4 } }, bridge: { lift: { min: 0, max: 6 } }, custom: { height: { min: 0.05, max: 20 } } };
  function structureParams(o) {
    const el = CAT().EL[o.type]; if (!el || !el.structure) return null; const d = el.structureDefaults || {}, t = o.terrain || {}, lim = STRUCTURE_LIMITS[el.structure], out = {};
    for (const k of Object.keys(lim)) out[k] = Math.max(lim[k].min, Math.min(lim[k].max, num(t[k], d[k])));
    if (el.structure === "stairs") out.steps = Math.round(out.steps); return out;
  }
  /** The end a ramp or stairs climbs from: it points along its own length, so turning it changes which way it climbs. */
  const local = (o, lx, ly) => { const a = (o.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [o.x + lx * c - ly * s, o.y + lx * s + ly * c]; };
  /* A ramp snapped to a platform's edge has its end exactly on the outline, where either side could be read. So the ground is
     read 2 cm past the high end, to meet what it climbs to, and 2 cm inside the low end, to stand on what is really under it. */
  const NUDGE = 0.02;
  const endGround = (o, fs, sign, shift) => { if (!fs.length) return 0; const a = (o.rot || 0) * Math.PI / 180, d = sign * (o.l / 2) + shift; return elevAt(fs, o.x + Math.cos(a) * d, o.y + Math.sin(a) * d); };
  function lowEndGround(o, fs) { return endGround(o, fs, -1, NUDGE); }
  function rampInfo(o, fs) { const { rise } = structureParams(o), lowY = lowEndGround(o, fs), highY = lowY + rise, groundHigh = endGround(o, fs, 1, NUDGE), slope = rise / o.l; return { rise, run: o.l, slope, slopePct: slope * 100, ratio: slope > 0 ? 1 / slope : null, lowY, highY, groundHigh, gap: highY - groundHigh }; }
  /** A solid wedge: flat underneath, sloping on top. */
  function rampMesh(o, y0) {
    const { rise } = structureParams(o), hl = o.l / 2, hw = o.w / 2, thin = 0.02, c = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([x, y]) => local(o, x, y)), pos = [];
    for (const p of c) pos.push(p[0], y0, p[1]); [thin, rise, rise, thin].forEach((h, i) => pos.push(c[i][0], y0 + h, c[i][1]));
    return { positions: pos, indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 5, 1, 0, 4, 5, 1, 6, 2, 1, 5, 6, 2, 7, 3, 2, 6, 7, 3, 4, 0, 3, 7, 4], top: y0 + rise };
  }
  function stairInfo(o) { const { rise, steps } = structureParams(o), riser = rise / steps, going = o.l / steps; return { rise, steps, riser, going, pitch: Math.atan2(riser, going) * 180 / Math.PI, run: o.l }; }
  /** One solid block per step, each reaching its own tread height, so the flight reads as real steps. */
  function stairTreads(o) { const { riser, steps, going } = stairInfo(o), hl = o.l / 2, hw = o.w / 2, out = []; for (let i = 0; i < steps; i++) { const x0 = -hl + i * going, x1 = x0 + going; out.push({ poly: [[x0, -hw], [x1, -hw], [x1, hw], [x0, hw]].map(([x, y]) => local(o, x, y)), top: riser * (i + 1) }); } return out; }
  /** Walks a route in short steps, handing each piece's middle and length to fn. */
  function along(pts, fn, step = 0.1) { let total = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; fn(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, L / n, total + L * t); } total += L; } return total; }
  /** A retaining wall is level along its top: its height is measured from the lowest ground it stands on. */
  function wallInfo(o, fs) {
    const { height } = structureParams(o), el = CAT().EL[o.type], width = o.width || el.width; let lo = Infinity, hi = -Infinity; const see = (x, y) => { const e = fs.length ? elevAt(fs, x, y) : 0; if (e < lo) lo = e; if (e > hi) hi = e; }; along(o.pts, see); o.pts.forEach((q) => see(q[0], q[1]));
    const top = lo + height; let face = 0; const length = along(o.pts, (x, y, ds) => { const e = fs.length ? elevAt(fs, x, y) : 0; face += Math.max(0, top - e) * ds; }); return { height, width, length, top, lo, hi, overtop: Math.max(0, hi - top), face, volume: face * width };
  }
  /** A bridge's deck runs straight between the ground at its ends. An end snapped to a platform's edge reads the platform it lands on. */
  function bridgeInfo(o, fs) {
    const { lift } = structureParams(o), el = CAT().EL[o.type], width = o.width || el.width, p = o.pts, n = p.length, past = (e, f) => { const L = Math.hypot(e[0] - f[0], e[1] - f[1]) || 1; return fs.length ? Math.max(elevAt(fs, e[0], e[1]), elevAt(fs, e[0] + (e[0] - f[0]) / L * NUDGE, e[1] + (e[1] - f[1]) / L * NUDGE)) : 0; };
    const ya = past(p[0], p[1]) + lift, yb = past(p[n - 1], p[n - 2]) + lift, length = G().polylineLength(p); let clearance = 0; along(p, (x, y, ds, s) => { const deck = ya + (yb - ya) * (length > 0 ? s / length : 0), g = fs.length ? elevAt(fs, x, y) : 0; clearance = Math.max(clearance, deck - g); });
    return { id: o.id, pts: p, width, lift, ya, yb, length, slopePct: length > 0 ? (yb - ya) / length * 100 : 0, clearance };
  }
  /** Deck, two rails and their posts, following the route. */
  function bridgeMesh(b) {
    const pos = [], idx = []; let top = 0, acc = 0; const hw = b.width / 2, RAIL = 1, boxAt = (ax, ay, az, bx, by, bz, nx, nz, hw2, h0, h1) => { const start = pos.length / 3; for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]]) for (const [u, v] of [[-hw2, h0], [hw2, h0], [hw2, h1], [-hw2, h1]]) { pos.push(x + nx * u, y + v, z + nz * u); top = Math.max(top, y + v); } for (let j = 0; j < 4; j++) { const q = (j + 1) % 4; idx.push(start + j, start + q, start + 4 + q, start + j, start + 4 + q, start + 4 + j); } idx.push(start, start + 2, start + 1, start, start + 3, start + 2, start + 4, start + 5, start + 6, start + 4, start + 6, start + 7); };
    for (let i = 1; i < b.pts.length; i++) { const a = b.pts[i - 1], c = b.pts[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-9) continue; const dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L, nx = -dz, nz = dx, at = (s) => b.ya + (b.yb - b.ya) * (b.length > 0 ? s / b.length : 0), y0 = at(acc), y1 = at(acc + L);
      boxAt(a[0], y0, a[1], c[0], y1, c[1], nx, nz, hw, -0.1, 0);
      for (const side of [-1, 1]) { const ox = nx * side * (hw - 0.03), oz = nz * side * (hw - 0.03); boxAt(a[0] + ox, y0, a[1] + oz, c[0] + ox, y1, c[1] + oz, nx, nz, 0.025, RAIL - 0.05, RAIL); const posts = Math.max(1, Math.round(L / 1.2)); for (let k = 0; k <= posts; k++) { const s = L * k / posts, x = a[0] + dx * s + ox, z = a[1] + dz * s + oz, y = at(acc + s); boxAt(x - dx * 0.025, y, z - dz * 0.025, x + dx * 0.025, y, z + dz * 0.025, nx, nz, 0.025, 0, RAIL); } }
      acc += L; }
    return { positions: pos, indices: idx, top };
  }
  /** Earth above a tunnel always thins to nothing where the hill meets its roof, so that figure says nothing. This reads each buried
   *  stretch away from its mouths, by twice the clear height. A stretch too short for that reports the most it has. */
  function leastCover(samples, clear) {
    if (!samples.length) return 0; const spans = []; let cur = [samples[0]]; for (let i = 1; i < samples.length; i++) { if (samples[i][0] - samples[i - 1][0] > (samples[i][2] + samples[i - 1][2]) * 0.75) { spans.push(cur); cur = []; } cur.push(samples[i]); } spans.push(cur);
    let least = Infinity; const margin = clear * 2; for (const sp of spans) { const a = sp[0][0] + margin, b = sp[sp.length - 1][0] - margin, inner = sp.filter((x) => x[0] >= a && x[0] <= b); least = Math.min(least, inner.length ? Math.min(...inner.map((x) => x[1])) : Math.max(...sp.map((x) => x[1]))); } return least;
  }
  /** Every tunnel, with its floor running straight between the ground at its two ends. */
  function tunnels(project, fs) {
    const out = [], g = G(); for (const o of (project && project.objects) || []) { if (o.kind !== "line" || o.hidden) continue; const el = CAT().EL[o.type]; if (!el || el.structure !== "tunnel" || !o.pts || o.pts.length < 2) continue;
      const { clear } = structureParams(o), width = o.width || el.width, a = o.pts[0], b = o.pts[o.pts.length - 1], ya = fs.length ? elevAt(fs, a[0], a[1]) : 0, yb = fs.length ? elevAt(fs, b[0], b[1]) : 0, length = g.polylineLength(o.pts), floorAt = (s) => ya + (yb - ya) * (length > 0 ? s / length : 0); let covered = 0, exposed = 0, removed = 0; const under = [];
      along(o.pts, (x, y, ds, s) => { const f = floorAt(s), crown = f + clear, e = fs.length ? elevAt(fs, x, y) : 0; if (e >= crown) { covered += ds; under.push([s, e - crown, ds]); } else exposed += ds; removed += Math.max(0, Math.min(e, crown) - f) * width * ds; });
      out.push({ id: o.id, pts: o.pts, width, clear, ya, yb, length, gradePct: length > 0 ? (yb - ya) / length * 100 : 0, covered, exposed, leastCover: leastCover(under, clear), removed, bbox: g.bbox(o.pts) }); }
    return out;
  }
  /** Is this spot in a tunnel's mouth? True where the ground lies below the tunnel's roof: the surface opens there, and stays whole over the buried part. */
  function tunnelOpen(ts, x, y, ground) { for (const t of ts) { const b = t.bbox, m = t.width / 2; if (x < b.x0 - m || x > b.x1 + m || y < b.y0 - m || y > b.y1 + m) continue; const pr = G().projectOnPolyline(t.pts, [x, y]); if (!pr || pr.d > m * 0.7) continue;   /* only ever inside the tube: the surface then meets its walls in a clean line */ const f = t.ya + (t.yb - t.ya) * (t.length > 0 ? pr.t / t.length : 0); if (ground < f + t.clear) return true; } return false; }
  /** Walls and arched roof, open at both ends, in short rings along the route. */
  function tunnelMesh(t) {
    const hw = t.width / 2, spring = t.clear - Math.min(hw, t.clear * 0.5), shape = [[-hw, 0], [-hw, spring]]; for (let i = 1; i < 6; i++) { const a = Math.PI - i / 6 * Math.PI; shape.push([Math.cos(a) * hw, spring + Math.sin(a) * (t.clear - spring)]); } shape.push([hw, spring], [hw, 0]);
    const pos = [], idx = []; let acc = 0, top = 0;
    for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], b = t.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue; const n = Math.max(1, Math.ceil(L / 1)), dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, nx = -dy, ny = dx, start = pos.length / 3;
      for (let k = 0; k <= n; k++) { const s = L * k / n, x = a[0] + dx * s, y = a[1] + dy * s, f = t.ya + (t.yb - t.ya) * (t.length > 0 ? (acc + s) / t.length : 0); for (const [u, v] of shape) { pos.push(x + nx * u, f + v, y + ny * u); top = Math.max(top, f + v); } }
      const r = shape.length; for (let k = 0; k < n; k++) for (let j = 0; j < r - 1; j++) { const p = start + k * r + j, q = p + r; idx.push(p, q, p + 1, p + 1, q, q + 1); } acc += L; }
    return { positions: pos, indices: idx, top };
  }

  /* ---------------- quantities for the quotation ---------------- */
  const volumeMemo = new Map();
  function volumeOf(o) { const k = JSON.stringify([o.poly, o.terrain || null]); if (volumeMemo.has(k)) return volumeMemo.get(k); const f = features({ objects: [Object.assign({}, o, { hidden: false })] })[0], v = f ? stats(f).volume : 0; if (volumeMemo.size > 400) volumeMemo.clear(); volumeMemo.set(k, v); return v; }
  /** True when another shape raising (or digging) the same way shares ground with this one, so adding their volumes counts it twice. */
  function sharesGround(f, fs) { const g = G(); for (const x of fs) { if (x.id === f.id || Math.sign(x.h) !== Math.sign(f.h) || !overlaps(x, { x0: f.bbox.x0, y0: f.bbox.y0, x1: f.bbox.x1, y1: f.bbox.y1 })) continue; for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { const p = [f.bbox.x0 + f.bbox.w * (i + 0.5) / 24, f.bbox.y0 + f.bbox.h * (j + 0.5) / 24]; if (g.pointInPolygon(p, f.poly, false) && g.pointInPolygon(p, x.poly, false)) return true; } } return false; }
  /** Stores each priced figure on its object with the fingerprint of the geometry it came from. Only out-of-date figures are worked out again. */
  function measureProject(project) {
    const M = root.DPModel, g = G(), tk = M.terrainKey(project); let fs = null, changed = 0; const ground = () => fs || (fs = features(project));
    for (const o of project.objects || []) {
      const kind = M.measureKind(o, tk); if (!kind) { if (o.measured) { delete o.measured; changed++; } continue; }
      const sig = M.measureSig(o, tk); if (o.measured && o.measured.sig === sig) continue;
      const el = CAT().EL[o.type], m = { sig }; let q = 0;
      if (kind === "surface") q = surfaceArea(ground(), o.poly).actual;
      else if (el.terrain) { q = volumeOf(o); const f = ground().find((x) => x.id === o.id); if (f && sharesGround(f, ground())) m.note = "overlap"; }
      else if (el.structure === "stairs") q = stairInfo(o).steps;
      else if (el.structure === "retaining") q = wallInfo(o, ground()).face;
      else q = g.polylineLength(o.pts);
      m.q = Math.round(q * 1000) / 1000; o.measured = m; changed++;
    }
    return changed;
  }

  root.DPTerrain = { measureProject, volumeOf, params, features, elevAt, stats, steepness, volumes, surfaceArea, under, drapeStep, subdivide, draped, inradius, insideDistance, LIMITS, SURFACES, STRUCTURE_LIMITS, structureParams, lowEndGround, rampInfo, rampMesh, stairInfo, stairTreads, wallInfo, tunnels, tunnelOpen, tunnelMesh, bridgeInfo, bridgeMesh };
})(typeof self !== "undefined" ? self : this);
