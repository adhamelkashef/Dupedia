/* X FORCE Site Planner 3D — engineering review prompts. Pure functions: no DOM, no storage, and it never changes the project.
   Loaded only with the 3D view.

   This file prompts people to look. It is not engineering: it holds NO limits of its own, because a limit that nobody chose could
   read as a safety approval. Every limit is blank until an administrator enters it (Admin > Engineering limits), with its source.

     warning   a measured figure is beyond a limit that was entered, or two things physically clash.
     review    a figure someone must judge: no limit has been entered, or the data can't be read.
     within    inside an entered limit. Counted only. Never shown as approved, passed or compliant.

   Never add a built-in limit here. Never use the words pass, approved, compliant or certified in a message. */
/* global DPModel, DPCat, DPGeom, DPTerrain, DPScene3D */
(function (root) {
  "use strict";
  const DISCLAIMER = "These are automated prompts for review, using limits entered by your administrator. They are not engineering approval, a certification or proof of compliance with any standard. A qualified engineer must review the design.";
  /* Every limit the checks can use. All blank by default. */
  const LIMITS = [
    { group: "Slopes", key: "terrainSlopeMaxPct", label: "Steepest slope on hills and levels", unit: "%" },
    { group: "Slopes", key: "rampSlopeMaxPct", label: "Steepest ramp", unit: "%" },
    { group: "Slopes", key: "bridgeSlopeMaxPct", label: "Steepest bridge deck", unit: "%" },
    { group: "Slopes", key: "tunnelSlopeMaxPct", label: "Steepest tunnel floor", unit: "%" },
    { group: "Accessibility", key: "accessSlopeMaxPct", label: "Steepest accessible path", unit: "%" },
    { group: "Accessibility", key: "accessWidthMin", label: "Narrowest accessible path", unit: "m" },
    { group: "Accessibility", key: "rampWidthMin", label: "Narrowest ramp", unit: "m" },
    { group: "Accessibility", key: "gateWidthMin", label: "Narrowest gate", unit: "m" },
    { group: "Stairs", key: "stairRiserMax", label: "Highest step", unit: "m" },
    { group: "Stairs", key: "stairRiserMin", label: "Lowest step", unit: "m" },
    { group: "Stairs", key: "stairGoingMin", label: "Shortest step going", unit: "m" },
    { group: "Height and clearance", key: "headroomMin", label: "Least headroom under anything overhead or in a tunnel", unit: "m" },
    { group: "Height and clearance", key: "tunnelCoverMin", label: "Least earth above a tunnel", unit: "m" },
    { group: "Height and clearance", key: "edgeDropMax", label: "Highest unguarded drop at a platform edge", unit: "m" },
    { group: "Height and clearance", key: "retainingHeightMax", label: "Tallest retaining wall without separate design", unit: "m" },
    { group: "Height and clearance", key: "groundVaryMax", label: "Most the ground may vary under a product", unit: "m" },
    { group: "Height and clearance", key: "zoneVaryMax", label: "Most the ground may vary across a safety zone", unit: "m" },
    { group: "Fall height: highest fall each surface is rated for", key: "fall_rubber", label: "Rubber safety flooring", unit: "m", surface: "rubber" },
    { group: "Fall height: highest fall each surface is rated for", key: "fall_epdm", label: "EPDM rubber surface", unit: "m", surface: "epdm" },
    { group: "Fall height: highest fall each surface is rated for", key: "fall_sand", label: "Sand zone", unit: "m", surface: "sand" },
    { group: "Fall height: highest fall each surface is rated for", key: "fall_turf", label: "Artificial grass", unit: "m", surface: "turf" },
    { group: "Fall height: highest fall each surface is rated for", key: "fall_safety-floor", label: "Safety flooring zone", unit: "m", surface: "safety-floor" },
  ];
  const SURFACE_KEYS = Object.fromEntries(LIMITS.filter((l) => l.surface).map((l) => [l.surface, l.key]));
  /* How high the overhead items are drawn. These are display values, so a clash with them is a prompt to confirm the real height. */
  const OVERHEAD = { pergola: 2.6, shade: 3, umbrella: 2.05 };
  const m = (v) => `${(Math.round(v * 100) / 100).toLocaleString("en-US")} m`, pct = (v) => `${Math.round(v * 10) / 10}%`;

  /** Reads a catalogue "platform" text honestly: a height only when it plainly states one. "Platform 1.15 × 1.15 m" is a plan size. */
  function readFall(text) {
    const t = String(text == null ? "" : text).trim();
    if (!t || t === "—") return { kind: "none", height: 0 };
    if (/^ground level$/i.test(t)) return { kind: "ground", height: 0 };
    if (/×/.test(t) || /(level|deck|floor|pivot)/i.test(t)) return { kind: "unknown", height: null };
    const hits = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(cm|m)\b/gi)].map((h) => +h[1] / (h[2].toLowerCase() === "cm" ? 100 : 1));
    if (!hits.length) return { kind: "unknown", height: null };
    return { kind: /seat/i.test(t) ? "seat" : "platform", height: Math.max(...hits) };
  }

  function run(project, limits = {}, { record = null } = {}) {
    const M = root.DPModel, CAT = root.DPCat, G = root.DPGeom, T = root.DPTerrain;
    const issues = [], per = {}, counts = { warning: 0, review: 0, within: 0 }, fs = T.features(project), tunnels = T.tunnels(project, fs), objs = (project.objects || []).filter((o) => !o.hidden);
    const lim = (k) => { const v = limits[k]; return typeof v === "number" && isFinite(v) ? v : null; }, unset = (k) => `No limit has been entered for this, so ${k}. Ask your engineer.`;
    const add = (sev, group, code, msg, ids) => { const i = { sev, group, code, msg, ids }; issues.push(i); counts[sev]++; for (const id of ids) (per[id] = per[id] || []).push(i); };
    /** One figure against one limit. dir "max": it mustn't exceed it. "min": it mustn't fall below it. */
    const measure = (group, code, what, value, key, dir, fmt, ids, needsLook = "someone needs to judge this figure") => { const L = lim(key); if (L == null) return add("review", group, code, `${what}: ${fmt(value)}. ${unset(needsLook)}`, ids);
      if (dir === "max" ? value > L + 1e-9 : value < L - 1e-9) return add("warning", group, code, `${what}: ${fmt(value)}, ${dir === "max" ? "above" : "below"} the ${fmt(L)} limit entered.`, ids); counts.within++; };
    const name = (o) => M.shortName(o), base = (o, foot) => (typeof o.z === "number" ? o.z : 0) + (fs.length ? T.under(fs, foot).max : 0);
    const prods = objs.filter((o) => o.kind === "product").map((o) => ({ o, s: M.shapes(o) })).filter((x) => !x.s.missing && x.s.p.dims && x.s.p.dims.h > 0);

    /* ---------------- height and clearance ---------------- */
    for (const c of objs) { if (c.kind !== "point" || !(c.type in OVERHEAD)) continue; const sc = M.shapes(c); if (sc.missing) continue; const under = base(c, sc.foot) + OVERHEAD[c.type]; let any = false;
      for (const { o, s } of prods) { if (!G.convexOverlap(sc.foot, s.foot)) continue; any = true; const top = base(o, s.foot) + s.p.dims.h; if (top > under) add("warning", "Height and clearance", "overhead-clash", `${name(o)} reaches ${m(top)}, but ${name(c)} is drawn with its underside at ${m(under)}. Its drawn height is only illustrative, so confirm the real one.`, [o.id, c.id]); }
      const L = lim("headroomMin"); if (L != null && OVERHEAD[c.type] < L) add("warning", "Height and clearance", "headroom", `${name(c)}: drawn ${m(OVERHEAD[c.type])} above the ground, below the ${m(L)} limit entered. Its drawn height is only illustrative, so confirm the real one.`, [c.id]); else if (L != null) counts.within++; }
    for (const b of objs) { if (b.kind !== "line" || b.type !== "bridge") continue; const info = T.bridgeInfo(b, fs), quads = G.bandQuads(b.pts, info.width), L0 = info.length;
      for (const { o, s } of prods) { if (!quads.some((q) => G.convexOverlap(q, s.foot))) continue; const pr = G.projectOnPolyline(b.pts, [o.x, o.y]), deck = info.ya + (info.yb - info.ya) * (L0 > 0 ? pr.t / L0 : 0) - 0.1, top = base(o, s.foot) + s.p.dims.h; if (top > deck) add("warning", "Height and clearance", "bridge-clash", `${name(o)} reaches ${m(top)}, but the bridge above it has its underside at ${m(deck)}.`, [o.id, b.id]); } }
    for (const t of tunnels) { measure("Height and clearance", "tunnel-headroom", "Tunnel clear height", t.clear, "headroomMin", "min", m, [t.id]);
      if (t.covered > 0) measure("Height and clearance", "tunnel-cover", "Least earth above the tunnel, away from its mouths", t.leastCover, "tunnelCoverMin", "min", m, [t.id]);
      if (Math.abs(t.gradePct) > 0.01) measure("Slopes", "tunnel-slope", "Tunnel floor slope", Math.abs(t.gradePct), "tunnelSlopeMaxPct", "max", pct, [t.id]);
      for (const { o, s } of prods) { const pr = G.projectOnPolyline(t.pts, [o.x, o.y]); if (t.pts.some((p, i) => i > 0 && G.convexOverlap(G.bandQuads([t.pts[i - 1], p], t.width)[0], s.foot))) add("review", "Height and clearance", "over-tunnel", `${name(o)} stands over a tunnel. An engineer needs to check what the ground can carry here.`, [o.id, t.id]); }
      add("review", "Height and clearance", "tunnel-design", "Tunnels need structural design by an engineer. This is a planning shape only.", [t.id]); }
    for (const w of objs) { if (w.kind !== "line" || w.type !== "retaining-wall") continue; const i = T.wallInfo(w, fs); measure("Height and clearance", "wall-height", "Retaining wall height", i.height, "retainingHeightMax", "max", m, [w.id], "assume it needs separate structural design"); if (i.overtop > 0.01) add("warning", "Height and clearance", "wall-overtop", `The ground rises ${m(i.overtop)} above the top of this retaining wall.`, [w.id]); }
    for (const f of fs) if (f.kind === "platform") measure("Height and clearance", "edge-drop", `Platform edge drop, with no guarding drawn`, f.h, "edgeDropMax", "max", m, [f.id]);
    for (const { o, s } of prods) { if (!fs.length) continue; const u = T.under(fs, s.foot); if (u.varies > 0.02) measure("Height and clearance", "ground-vary", `Ground varies under ${name(o)}`, u.varies, "groundVaryMax", "max", m, [o.id]);
      if (s.zone) { const z = T.under(fs, s.zone); if (z.varies > 0.02) measure("Height and clearance", "zone-vary", `Ground varies across the safety zone of ${name(o)}`, z.varies, "zoneVaryMax", "max", m, [o.id]); } }

    /* ---------------- slopes ---------------- */
    for (const f of fs) { if (f.kind === "platform") continue; const steep = T.steepness(f); if (isFinite(steep)) measure("Slopes", "terrain-slope", `Steepest slope on this ${f.kind === "hill" ? "hill" : "level"}`, steep * 100, "terrainSlopeMaxPct", "max", pct, [f.id]); }
    for (const o of objs) { if (o.kind === "point" && o.type === "ramp") { const r = T.rampInfo(o, fs); if (r.rise > 0) measure("Slopes", "ramp-slope", "Ramp slope", r.slopePct, "rampSlopeMaxPct", "max", pct, [o.id]); measure("Accessibility", "ramp-width", "Ramp width", o.w, "rampWidthMin", "min", m, [o.id]); }
      if (o.kind === "line" && o.type === "bridge") { const b = Math.abs(T.bridgeInfo(o, fs).slopePct); if (b > 0.01) measure("Slopes", "bridge-slope", "Bridge deck slope", b, "bridgeSlopeMaxPct", "max", pct, [o.id]); } }

    /* ---------------- accessibility ---------------- */
    const access = objs.filter((o) => o.kind === "line" && o.type === "path-accessible"), raised = fs.some((f) => Math.abs(f.h) > 0.02) || objs.some((o) => o.type === "stairs");
    for (const o of access) { measure("Accessibility", "access-width", "Accessible path width", o.width || CAT.EL[o.type].width, "accessWidthMin", "min", m, [o.id]); if (fs.length) { let steep = 0; for (let i = 1; i < o.pts.length; i++) { const a = o.pts[i - 1], b = o.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.5)); for (let k = 0; k < n; k++) { const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], q = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n], d = Math.abs(T.elevAt(fs, q[0], q[1]) - T.elevAt(fs, p[0], p[1])) / (L / n); if (d < 5) steep = Math.max(steep, d * 100); } } if (steep > 0.01) measure("Accessibility", "access-slope", "Steepest part of this accessible path", steep, "accessSlopeMaxPct", "max", pct, [o.id]); } }
    if (raised && !access.length) add("review", "Accessibility", "no-access-path", "This design changes level, but no accessible path is drawn. Check how a wheelchair or pram reaches each area.", []);
    for (const o of objs) { if (o.kind === "point" && o.type === "stairs") { const s = T.stairInfo(o); measure("Stairs", "stair-riser-high", "Step rise", s.riser, "stairRiserMax", "max", m, [o.id]); if (lim("stairRiserMin") != null) measure("Stairs", "stair-riser-low", "Step rise", s.riser, "stairRiserMin", "min", m, [o.id]); measure("Stairs", "stair-going", "Step going", s.going, "stairGoingMin", "min", m, [o.id]); }
      if (o.kind === "point" && CAT.EL[o.type] && CAT.EL[o.type].gate) measure("Accessibility", "gate-width", "Gate width", o.l, "gateWidthMin", "min", m, [o.id]); }

    /* ---------------- fall height ---------------- */
    const surfaces = objs.filter((o) => o.kind === "area" && CAT.EL[o.type] && CAT.EL[o.type].surface);
    for (const { o, s } of prods) { const rec = record ? record(o.code) : null, own = rec && typeof rec.fallHeight === "number" ? rec.fallHeight : null, read = own != null ? { kind: "recorded", height: own } : readFall(s.p.platform);
      if (read.kind === "none" || read.kind === "ground") continue;
      if (read.height == null) { add("review", "Fall height", "fall-unknown", `${name(o)}: the catalogue says "${s.p.platform}", which doesn't give a fall height. Enter a confirmed figure in Admin > 3D library.`, [o.id]); continue; }
      const area = s.zone || s.foot, seen = []; for (const type of Object.keys(SURFACE_KEYS)) { const polys = surfaces.filter((x) => x.type === type).map((x) => x.poly); if (polys.length && G.coveredArea(area, polys, 24) / Math.max(1e-9, G.area(area)) > 0.05) seen.push(type); }
      const what = read.kind === "seat" ? `seat height ${m(read.height)}` : read.kind === "recorded" ? `recorded fall height ${m(read.height)}` : `published platform height ${m(read.height)}`, caveat = read.kind === "recorded" ? "" : " That figure is a guide: your engineer sets the real fall height.";
      if (!seen.length) { add("review", "Fall height", "fall-no-surface", `${name(o)}: ${what}, with no rated surface drawn under it.${caveat}`, [o.id]); continue; }
      for (const type of seen) { const r = lim(SURFACE_KEYS[type]), label = CAT.EL[type].name; if (r == null) add("review", "Fall height", "fall-unrated", `${name(o)}: ${what}, on ${label}. No fall rating has been entered for this surface.${caveat}`, [o.id]); else if (read.height > r + 1e-9) add("warning", "Fall height", "fall-over", `${name(o)}: ${what}, above the ${m(r)} rating entered for ${label}.${caveat}`, [o.id]); else counts.within++; } }

    const order = { warning: 0, review: 1 }; issues.sort((a, b) => order[a.sev] - order[b.sev]);
    return { issues, per, counts, limitsSet: LIMITS.filter((l) => lim(l.key) != null).length, limitsTotal: LIMITS.length, source: { standard: limits.standard || "", suppliedBy: limits.suppliedBy || "" } };
  }

  root.DPChecks3D = { run, readFall, LIMITS, DISCLAIMER, OVERHEAD };
})(typeof self !== "undefined" ? self : this);
