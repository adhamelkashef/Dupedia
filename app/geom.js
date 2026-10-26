/* Dupedia planner geometry engine. Pure functions, no DOM.
   Coordinates are physical metres in a y-down plane (x right, y down), independent of screen pixels.
   Rotation is in degrees, clockwise on screen (positive angle with y-down axes). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DPGeom = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const EPS = 1e-9;
  const TOL = 1e-6; // metres: shapes that merely touch (within a micrometre) do not count as overlapping

  /** Corners of a rectangle of length l (along x before rotation) and width w, centred at (cx, cy). */
  function rectCorners(cx, cy, l, w, rotDeg) {
    const a = (rotDeg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hl = l / 2, hw = w / 2;
    return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }

  /** Axis-aligned bounding box of points. */
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  /** Signed area (shoelace). Positive or negative depending on winding; use Math.abs for area. */
  function signedArea(poly) {
    let a = 0;
    for (let i = 0, n = poly.length; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
    return a / 2;
  }
  const area = poly => Math.abs(signedArea(poly));
  function perimeter(poly) { let p = 0; for (let i = 0; i < poly.length; i++) p += dist(poly[i], poly[(i + 1) % poly.length]); return p; }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function centroid(poly) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n], f = x1 * y2 - x2 * y1;
      cx += (x1 + x2) * f; cy += (y1 + y2) * f; a += f;
    }
    if (Math.abs(a) < EPS) { const b = bbox(poly); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
    return [cx / (3 * a), cy / (3 * a)];
  }

  /** Point in polygon (even-odd ray casting). Points ON the boundary count as inside when onBoundary=true. */
  function pointInPolygon(pt, poly, onBoundary = true) {
    const [px, py] = pt;
    for (let i = 0, n = poly.length; i < n; i++) if (distPointSeg(pt, poly[i], poly[(i + 1) % n]) <= TOL) return onBoundary;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function distPointSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  /** Proper crossing of segments ab and cd (interiors intersect at a single point, not merely touching). */
  function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    const s = v => (Math.abs(v) < 1e-12 ? 0 : Math.sign(v));
    return s(d1) * s(d2) < 0 && s(d3) * s(d4) < 0;
  }

  /** Convex polygons: separating-axis test. True when interiors overlap by more than TOL. */
  function convexOverlap(A, B) {
    for (const P of [A, B]) {
      for (let i = 0; i < P.length; i++) {
        const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length], nx = y1 - y2, ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, y] of A) { const v = (x * nx + y * ny) / nl; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
        for (const [x, y] of B) { const v = (x * nx + y * ny) / nl; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
        if (a1 <= b0 + TOL || b1 <= a0 + TOL) return false;
      }
    }
    return true;
  }

  /** Clip convex subject by convex clip polygon (Sutherland–Hodgman). Returns intersection polygon. */
  function clipConvex(subject, clip) {
    let out = subject.slice();
    const ccw = signedArea(clip) > 0;
    for (let i = 0; i < clip.length && out.length; i++) {
      const A = clip[i], B = clip[(i + 1) % clip.length], inp = out; out = [];
      const side = p => { const v = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]); return ccw ? v >= -EPS : v <= EPS; };
      for (let j = 0; j < inp.length; j++) {
        const P = inp[j], Q = inp[(j + 1) % inp.length], pin = side(P), qin = side(Q);
        if (pin) out.push(P);
        if (pin !== qin) out.push(lineIntersect(P, Q, A, B));
      }
    }
    return out;
  }
  function lineIntersect(p, q, a, b) {
    const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < EPS) return [x2, y2];
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }
  /** Overlap area of two convex polygons (m²). */
  const convexOverlapArea = (A, B) => { const c = clipConvex(A, B); return c.length >= 3 ? area(c) : 0; };

  /** General polygons (either may be concave): do their interiors overlap? */
  function polygonsOverlap(A, B) {
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++)
      if (segmentsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
    // no proper crossings: one may contain the other, or they touch only
    const strictlyInside = (P, Q) => P.some(p => pointInPolygon(p, Q, false));
    if (strictlyInside(A, B) || strictlyInside(B, A)) return true;
    // identical/coincident shapes: test centroids
    return pointInPolygon(centroid(A), B, false) && pointInPolygon(centroid(B), A, false);
  }

  /** Is polygon P (e.g. a product rectangle) entirely within polygon Q (site, may be concave)? */
  function polygonInside(P, Q) {
    if (!P.every(p => pointInPolygon(p, Q, true))) return false;
    for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++)
      if (segmentsCross(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length])) return false;
    // a concave site vertex poking into P without crossing edges
    for (let j = 0; j < Q.length; j++) if (pointInPolygon(Q[j], P, false)) return false;
    return true;
  }

  /** Minimum distance between the boundaries of two polygons (0 if they intersect). */
  function boundaryDistance(P, Q) {
    let d = Infinity;
    for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++) {
      const a = P[i], b = P[(i + 1) % P.length], c = Q[j], e = Q[(j + 1) % Q.length];
      if (segmentsCross(a, b, c, e)) return 0;
      d = Math.min(d, distPointSeg(a, c, e), distPointSeg(c, a, b));
    }
    return d;
  }

  /** Douglas–Peucker simplification of an open polyline (tolerance in metres). */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop(); let idx = -1, dmax = tol;
      for (let i = s + 1; i < e; i++) { const d = distPointSeg(pts[i], pts[s], pts[e]); if (d > dmax) { dmax = d; idx = i; } }
      if (idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  /** DXF $INSUNITS code → metres per drawing unit. null = unitless/unknown. */
  const INSUNITS = { 1: ["inches", 0.0254], 2: ["feet", 0.3048], 3: ["miles", 1609.344], 4: ["millimetres", 0.001], 5: ["centimetres", 0.01], 6: ["metres", 1], 7: ["kilometres", 1000], 8: ["microinches", 2.54e-8], 9: ["mils", 2.54e-5], 10: ["yards", 0.9144], 14: ["decimetres", 0.1] };
  function unitsFactor(code) { const u = INSUNITS[code]; return u ? { name: u[0], factor: u[1] } : null; }

  /** Calibration: drawing distance between two picked points vs the real distance the user typed. */
  function calibrationFactor(p1, p2, realMetres) {
    const d = dist(p1, p2);
    if (!(d > EPS) || !(realMetres > 0)) throw new Error("Pick two distinct points and enter a distance greater than zero.");
    return realMetres / d; // metres per current unit
  }

  /** Snap a value to a grid step. */
  const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
  const normAngle = a => ((a % 360) + 360) % 360;

  /** Screen <-> world transform helpers. view = {scale: px per metre, ox, oy}: screen = world*scale + o */
  const toScreen = (v, p) => [p[0] * v.scale + v.ox, p[1] * v.scale + v.oy];
  const toWorld = (v, s) => [(s[0] - v.ox) / v.scale, (s[1] - v.oy) / v.scale];


  /* ---- Site Planner 2.0 additions: polylines (fences, paths), circles, rotation helpers ---- */
  /** Total length of an open (or closed) polyline in metres. */
  function polylineLength(pts, closed = false) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]); return L; }
  /** Point and direction at distance t along a polyline. */
  function pointAlong(pts, t, closed = false) {
    const segs = closed ? pts.concat([pts[0]]) : pts; let acc = 0;
    for (let i = 1; i < segs.length; i++) { const a = segs[i - 1], b = segs[i], L = dist(a, b);
      if (t <= acc + L || i === segs.length - 1) { const u = L ? Math.max(0, Math.min(1, (t - acc) / L)) : 0; return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], ang: Math.atan2(b[1] - a[1], b[0] - a[0]), seg: i - 1 }; }
      acc += L; }
    return { p: segs[0].slice(), ang: 0, seg: 0 };
  }
  /** Nearest point on a polyline: {t (distance along), d (distance away), p, seg}. */
  function projectOnPolyline(pts, q, closed = false) {
    const segs = closed ? pts.concat([pts[0]]) : pts; let best = null, acc = 0;
    for (let i = 1; i < segs.length; i++) { const a = segs[i - 1], b = segs[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      let u = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
      const p = [a[0] + u * dx, a[1] + u * dy], d = dist(p, q);
      if (!best || d < best.d) best = { t: acc + u * L, d, p, seg: i - 1 };
      acc += L; }
    return best;
  }
  /** Sub-polyline between distances t0 and t1 along pts. */
  function slicePolyline(pts, t0, t1, closed = false) {
    const segs = closed ? pts.concat([pts[0]]) : pts, out = []; let acc = 0;
    for (let i = 1; i < segs.length; i++) { const a = segs[i - 1], b = segs[i], L = dist(a, b), s0 = acc, s1 = acc + L;
      if (s1 >= t0 && s0 <= t1 && L > 0) { const u0 = Math.max(0, (t0 - s0) / L), u1 = Math.min(1, (t1 - s0) / L);
        const p0 = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0], p1 = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1];
        if (!out.length || dist(out[out.length - 1], p0) > 1e-9) out.push(p0); out.push(p1); }
      acc = s1; }
    return out;
  }
  /** Polygon approximating a circle (for overlap tests). */
  function circlePoly(cx, cy, r, n = 24) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }
  /** Band polygon around a polyline segment-wise (convex quads), used for overlap tests of fences/paths. */
  function bandQuads(pts, width) {
    const hw = Math.max(width, 0.02) / 2, out = [];
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = dist(a, b); if (L < 1e-9) continue;
      const nx = -(b[1] - a[1]) / L * hw, ny = (b[0] - a[0]) / L * hw;
      out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]); }
    return out;
  }
  const rotPt = (p, c, deg) => { const a = deg * Math.PI / 180, s = Math.sin(a), k = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * k - y * s, c[1] + x * s + y * k]; };
  /** Is polygon convex? */
  function isConvex(poly) { let sign = 0; for (let i = 0, n = poly.length; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(z) < 1e-12) continue; const s = Math.sign(z); if (sign && s !== sign) return false; sign = s; } return true; }
  /** Overlap area of polygon A (convex) with polygon B (any): exact when B is convex, else sampled. */
  function overlapArea(A, B) {
    if (isConvex(B)) return convexOverlapArea(A, B);
    const bb = bbox(A), n = 40, dx = bb.w / n, dy = bb.h / n; let hit = 0, tot = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const p = [bb.x0 + (i + 0.5) * dx, bb.y0 + (j + 0.5) * dy]; if (pointInPolygon(p, A, false)) { tot++; if (pointInPolygon(p, B, false)) hit++; } }
    return tot ? area(A) * hit / tot : 0;
  }
  /** Approximate area of polygon A covered by a union of polygons (sampled), m². */
  function coveredArea(A, polys, n = 48) {
    if (!polys.length) return 0; const bb = bbox(A), dx = bb.w / n, dy = bb.h / n; let hit = 0, tot = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const p = [bb.x0 + (i + 0.5) * dx, bb.y0 + (j + 0.5) * dy]; if (!pointInPolygon(p, A, false)) continue; tot++; if (polys.some((P) => pointInPolygon(p, P, false))) hit++; }
    return tot ? area(A) * hit / tot : 0;
  }
  /** Self-intersection check for a simple polygon. */
  function selfIntersects(poly) { const n = poly.length; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true; } return false; }

  return { polylineLength, pointAlong, projectOnPolyline, slicePolyline, circlePoly, bandQuads, rotPt, isConvex, overlapArea, coveredArea, selfIntersects,
           EPS, TOL, rectCorners, bbox, signedArea, area, perimeter, dist, centroid, pointInPolygon, distPointSeg, segmentsCross,
           convexOverlap, clipConvex, convexOverlapArea, polygonsOverlap, polygonInside, boundaryDistance, simplify,
           INSUNITS, unitsFactor, calibrationFactor, snap, normAngle, toScreen, toWorld };
});
