/* Dupedia planner placement engine: fit assistant and automatic layout alternatives.
   Pure functions (no DOM). Conservative rules: a new product's published safety zone (or its footprint when no
   drawable zone is published) must lie inside the site and must not overlap obstacles, other footprints or other zones. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./geom.js"));
  else root.DPFit = factory(root.DPGeom);
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";
  /** Outline used for clearance checks: the drawable published zone, else the footprint (flagged by `zoneUsed:false`). */
  function shapesFor(p, x, y, rot) {
    const foot = G.rectCorners(x, y, p.dims.l, p.dims.w, rot);
    const zone = p.zone && p.zone.kind === "rect" ? G.rectCorners(x, y, p.zone.l, p.zone.w, rot) : null;
    return { foot, zone, outer: zone || foot, zoneUsed: !!zone };
  }
  function bb(poly) { return G.bbox(poly); }
  const bbHit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  /** blockers: [{poly, bb, convex}] */
  function canPlace(outer, site, blockers) {
    const ob = bb(outer);
    if (site && !G.polygonInside(outer, site)) return false;
    for (const b of blockers) { if (!bbHit(ob, b.bb)) continue; if (b.convex ? G.convexOverlap(outer, b.poly) : G.polygonsOverlap(outer, b.poly)) return false; }
    return true;
  }
  function blockersFrom(items, byCode, obstacles) {
    const out = [];
    for (const o of obstacles || []) out.push({ poly: o.poly, bb: bb(o.poly), convex: false });
    for (const it of items || []) { const p = byCode[it.code]; if (!p || !p.dims) continue; const s = shapesFor(p, it.x, it.y, it.rot);
      out.push({ poly: s.foot, bb: bb(s.foot), convex: true }); if (s.zone) out.push({ poly: s.zone, bb: bb(s.zone), convex: true }); }
    return out;
  }
  function scanStep(site, p, step) {
    if (step) return step;
    const sb = bb(site), mn = Math.min(sb.w, sb.h);
    return Math.max(0.25, mn / 40);
  }
  /** Find a position for product p. near = preferred point (closest valid position wins); otherwise first in reading order. */
  function findSpot(p, site, blockers, { near = null, step = null, rotations = [0, 90], extra = [45, 135], maxTests = 60000 } = {}) {
    if (!p || !p.dims || !site || site.length < 3) return null;
    const sb = bb(site), st = scanStep(site, p, step);
    let tests = 0;
    const tryRots = (rots) => {
      let best = null;
      for (const rot of rots) {
        const probe = shapesFor(p, 0, 0, rot), pb = bb(probe.outer);
        if (pb.w > sb.w + 1e-9 || pb.h > sb.h + 1e-9) continue;
        const xs = [], ys = [];
        for (let x = sb.x0 - pb.x0; x <= sb.x1 - pb.x1 + 1e-9; x += st) xs.push(+x.toFixed(6));
        for (let y = sb.y0 - pb.y0; y <= sb.y1 - pb.y1 + 1e-9; y += st) ys.push(+y.toFixed(6));
        let order = [];
        for (const y of ys) for (const x of xs) order.push([x, y]);
        if (near) order.sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1]));
        for (const [x, y] of order) {
          if (++tests > maxTests) return best;
          const s = shapesFor(p, x, y, rot);
          if (canPlace(s.outer, site, blockers)) {
            const cand = { x, y, rot, zoneUsed: s.zoneUsed, d: near ? Math.hypot(x - near[0], y - near[1]) : 0 };
            if (!near) return cand;
            if (!best || cand.d < best.d) best = cand;
            break;   // sorted by distance: the first valid one is the nearest for this rotation
          }
        }
      }
      return best;
    };
    return tryRots(rotations) || tryRots(extra);
  }
  /** Same-collection products that are smaller and fit (alternatives when p does not fit). */
  function alternatives(p, all, site, blockers, n = 3) {
    const area = (q) => (q.zone && q.zone.kind === "rect" ? q.zone.l * q.zone.w : q.dims.l * q.dims.w);
    const pool = all.filter((q) => q.plannerReady && q.code !== p.code && area(q) < area(p))
      .sort((a, b) => (a.collection === p.collection ? 0 : 1) - (b.collection === p.collection ? 0 : 1) || area(b) - area(a));
    const out = [];
    for (const q of pool) { const s = findSpot(q, site, blockers, { step: Math.max(0.5, scanStep(site) * 1.5), maxTests: 15000 }); if (s) out.push({ p: q, spot: s }); if (out.length >= n) break; }
    return out;
  }
  /** Minimum clearance of an outline to blockers and site boundary (used by the balanced strategy). */
  function clearance(outer, site, blockers) {
    let d = G.boundaryDistance(outer, site);
    for (const b of blockers) d = Math.min(d, G.boundaryDistance(outer, b.poly));
    return d;
  }
  function positions(p, site, rot, st) {
    const sb = bb(site), probe = shapesFor(p, 0, 0, rot), pb = bb(probe.outer), out = [];
    if (pb.w > sb.w || pb.h > sb.h) return out;
    for (let y = sb.y0 - pb.y0; y <= sb.y1 - pb.y1 + 1e-9; y += st) for (let x = sb.x0 - pb.x0; x <= sb.x1 - pb.x1 + 1e-9; x += st) out.push([+x.toFixed(6), +y.toFixed(6)]);
    return out;
  }
  const ageGroup = (p) => (p.ageMax <= 6 ? "early" : p.ageMin >= 5 ? "junior" : "mixed");
  /**
   * Three layout alternatives. opts: {collections:Set|null, ageMin, ageMax, maxItems, existing:[items], obstacles, step}
   * Products considered: planner-ready AND with a drawable published safety zone (others need manual verification).
   */
  function layouts(products, byCode, site, opts = {}) {
    const max = Math.max(1, Math.min(20, opts.maxItems || 6));
    const pool = products.filter((p) => p.plannerReady && p.zone && p.zone.kind === "rect"
      && (!opts.collections || !opts.collections.size || opts.collections.has(p.collection))
      && (opts.ageMin == null || p.ageMax >= opts.ageMin) && (opts.ageMax == null || p.ageMin <= opts.ageMax));
    const za = (p) => p.zone.l * p.zone.w;
    const sb = bb(site), st = opts.step || Math.max(0.5, Math.min(sb.w, sb.h) / 30);
    const siteArea = G.area(site);
    const base = blockersFrom(opts.existing || [], byCode, opts.obstacles || []);
    const build = (key, title, desc, order, placeMode) => {
      const blockers = base.slice(), items = [], skipped = [];
      for (const p of order) {
        if (items.length >= max) break;
        let spot = null;
        if (placeMode === "pack") spot = findSpot(p, site, blockers, { step: st, maxTests: 40000 });
        else {
          let best = null;
          for (const rot of [0, 90]) for (const [x, y] of positions(p, site, rot, st * 1.5)) {
            const s = shapesFor(p, x, y, rot); if (!canPlace(s.outer, site, blockers)) continue;
            const c = clearance(s.outer, site, blockers); if (!best || c > best.c) best = { x, y, rot, c };
          }
          spot = best;
        }
        if (!spot) { skipped.push(p.code); continue; }
        const it = { id: "a" + key[0] + items.length + Math.random().toString(36).slice(2, 7), code: p.code, x: spot.x, y: spot.y, rot: spot.rot };
        items.push(it); const s = shapesFor(p, it.x, it.y, it.rot);
        blockers.push({ poly: s.foot, bb: bb(s.foot), convex: true }, { poly: s.zone, bb: bb(s.zone), convex: true });
      }
      const zoneArea = items.reduce((a, it) => a + za(byCode[it.code]), 0);
      const colls = new Set(items.map((it) => byCode[it.code].collection)).size;
      return { key, title, desc, items, skipped, metrics: { count: items.length, zoneArea, coverage: siteArea ? zoneArea / siteArea : 0, collections: colls } };
    };
    // 1 space-efficient: largest first, packed in reading order; repeats allowed only when the pool is smaller than max
    const bySize = pool.slice().sort((a, b) => za(b) - za(a));
    const eff = build("efficient", "Space-efficient", "Largest equipment first, packed tightly to use the most of the site.", fill(bySize, max), "pack");
    // 2 balanced: alternate large/small, placed for the most open space around each item
    const alt = []; for (let i = 0, j = bySize.length - 1; i <= j; i++, j--) { alt.push(bySize[i]); if (i !== j) alt.push(bySize[j]); }
    const bal = build("balanced", "Balanced", "A mix of sizes spread evenly, keeping the widest gaps between items.", fill(alt, max), "spread");
    // 3 play variety: one per collection and age group first, then the rest
    const seen = new Set(), first = [], rest = [];
    for (const p of bySize) { const k = p.collection + ":" + ageGroup(p); (seen.has(k) ? rest : first).push(p); seen.add(k); }
    const varr = build("variety", "Play variety", "Different collections, play types and age groups for the widest range of play.", first.concat(rest), "spread");
    return [eff, bal, varr];
  }
  function fill(list, max) { if (list.length >= max || !list.length) return list; const out = list.slice(); let i = 0; while (out.length < max * 2) out.push(list[i++ % list.length]); return out; }

  return { shapesFor, canPlace, blockersFrom, findSpot, alternatives, layouts, scanStep };
});
