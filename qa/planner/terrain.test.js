/* Site Planner terrain: every expected figure below is worked out by hand from standard geometry, not taken from the code.
   Shapes on a 40 × 30 m site, in metres. Tolerances say how close a calculated estimate must be. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app");
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "terrain", "scene3d"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPCat: CAT, DPTerrain: T, DPScene3D: S3, DPGeom: G } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const near = (got, want, pct, what) => assert.ok(Math.abs(got - want) <= Math.abs(want) * pct / 100 + 1e-9, `${what || "value"}: got ${got}, expected ${want} within ${pct}%`);
const plain = (v) => JSON.parse(JSON.stringify(v));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const circle = (cx, cy, r, k = 96) => Array.from({ length: k }, (_, i) => [cx + Math.cos(i / k * 2 * Math.PI) * r, cy + Math.sin(i / k * 2 * Math.PI) * r]);
const A = (id, type, poly, terrain) => ({ id, kind: "area", type, poly, terrain });
const project = (objects) => { const p = M.newProject(); p.site = { poly: rect(0, 0, 40, 30), north: 0 }; p.objects = objects; M.load(p); return M.S.project; };
const FS = (...objs) => T.features(project(objs));

/* ---------------- volumes against hand calculation ---------------- */
t("platform 10 × 6, 1.2 high: 10 × 6 × 1.2 = 72 m³", () => { const f = FS(A("a", "platform", rect(5, 5, 10, 6), { height: 1.2 })); near(T.stats(f[0]).volume, 72, 0.1); near(T.volumes(f).fill, 72, 0.5); assert.strictEqual(T.stats(f[0]).slope, Infinity); });
t("flat-topped level, 20 m square, 2 high, 4 m slope: frustum h/3 × (400 + 144 + 240) = 522.67 m³", () => { const f = FS(A("a", "level", rect(5, 5, 20, 20), { height: 2, run: 4 })); near(T.stats(f[0]).volume, 2 / 3 * (400 + 144 + 20 * 12), 0.3); });
t("that level's slope: rises 2 m over 4 m = 1 in 2 = 50%", () => { const s = T.stats(FS(A("a", "level", rect(5, 5, 20, 20), { height: 2, run: 4 }))[0]); near(s.slopePct, 50, 0.01); near(s.slopeRatio, 2, 0.01); assert.ok(s.reachesHeight); });
t("pointed square hill, 20 m square, 3 high, straight sides: pyramid a²h/3 = 400 m³", () => { const s = T.stats(FS(A("a", "hill", rect(5, 5, 20, 20), { height: 3, profile: "straight" }))[0]); near(s.volume, 400, 0.3); near(s.peak, 3, 0.1); });
t("cone, radius 8, 3 high: πr²h/3 = 201.06 m³", () => { const s = T.stats(FS(A("a", "hill", circle(15, 15, 8), { height: 3, profile: "straight" }))[0]); near(s.volume, Math.PI * 64 * 3 / 3, 1); near(s.peak, 3, 0.2); });
t("rounded hill, radius 8, 3 high: profile 3t²−2t³ integrates to 0.3πr²h = 180.96 m³", () => { const s = T.stats(FS(A("a", "hill", circle(15, 15, 8), { height: 3 }))[0]); near(s.volume, 0.3 * Math.PI * 64 * 3, 1); });
t("a rounded hill's steepest slope is 1.5 × height ÷ run: 1.5 × 3 ÷ 8 = 56%", () => { const s = T.stats(FS(A("a", "hill", circle(15, 15, 8), { height: 3 }))[0]); near(s.slopePct, 56.25, 1); });
t("roof-shaped hill, 20 × 10, 2 high: middle prism 10 × (10 × 2 ÷ 2) = 100, plus end pyramids 10 × 10 × 2 ÷ 3 = 66.67, total 166.67 m³", () => {
  near(T.stats(FS(A("a", "hill", rect(5, 5, 20, 10), { height: 2, profile: "straight" }))[0]).volume, 100 + 200 / 3, 0.4);
});
t("sunken level, 10 m square, −1 deep, 2 m slope: frustum cut = 1/3 × (100 + 36 + 60) = 65.33 m³", () => { const f = FS(A("a", "level", rect(5, 5, 10, 10), { height: -1, run: 2 })), v = T.volumes(f); near(v.cut, 196 / 3, 0.5); assert.strictEqual(v.fill, 0); near(v.low, -1, 0.5); });
t("a slanted platform outline is exact too: triangle 12 × 8 ÷ 2 × 1.5 = 72 m³", () => { near(T.stats(FS(A("a", "platform", [[5, 5], [17, 5], [5, 13]], { height: 1.5 }))[0]).volume, 72, 1); });
t("separate shapes add up", () => { const f = FS(A("a", "platform", rect(1, 1, 5, 5), { height: 2 }), A("b", "platform", rect(10, 10, 4, 5), { height: 1 })); near(T.volumes(f).fill, 50 + 20, 0.5); });
t("overlaps count once: a 1 m platform inside a 2 m one is 2 m high there, not 3", () => { const f = FS(A("a", "platform", rect(5, 5, 10, 10), { height: 2 }), A("b", "platform", rect(7, 7, 4, 4), { height: 1 })); near(T.volumes(f).fill, 200, 0.5); near(T.elevAt(f, 8, 8), 2, 0); });
t("a sunken area cut into a platform lowers it", () => { const f = FS(A("a", "platform", rect(5, 5, 10, 10), { height: 2 }), A("b", "level", rect(7, 7, 4, 4), { height: -0.5, run: 0 })); near(T.elevAt(f, 9, 9), 1.5, 0.01); near(T.elevAt(f, 6, 6), 2, 0.01); });

/* ---------------- heights, exact points ---------------- */
t("heights at known points on a level", () => { const f = FS(A("a", "level", rect(10, 10, 20, 10), { height: 2, run: 2 })); near(T.elevAt(f, 20, 15), 2, 0.001); near(T.elevAt(f, 11, 15), 1, 0.001); assert.strictEqual(T.elevAt(f, 5, 5), 0); });
t("outlines stay true: the ground outside an outline isn't touched", () => { const f = FS(A("a", "hill", rect(10, 10, 10, 10), { height: 3 })); assert.strictEqual(T.elevAt(f, 9.99, 15), 0); assert.ok(T.elevAt(f, 10.5, 15) > 0); });
t("a slope too long for the shape can't reach its height, and says so", () => { const s = T.stats(FS(A("a", "level", rect(5, 5, 8, 8), { height: 4, run: 8 }))[0]); near(s.peak, 2, 0.5); assert.strictEqual(s.reachesHeight, false); });
t("a hidden shape has no effect", () => { const o = A("a", "platform", rect(5, 5, 10, 10), { height: 2 }); o.hidden = true; assert.strictEqual(T.features(project([o])).length, 0); });
t("heights are held to the limits, and a broken value falls back to the default", () => { const p = (terrain, type = "platform") => T.params({ type, terrain }); assert.strictEqual(p({ height: 99 }).height, 6); assert.strictEqual(p({ height: -5 }).height, 0.05); assert.strictEqual(p({ height: "x" }).height, CAT.EL.platform.terrainDefaults.height); assert.strictEqual(T.params({ type: "rubber" }), null); });

/* ---------------- true surface areas ---------------- */
t("flat ground: true area equals plan area", () => { const r = T.surfaceArea(FS(A("a", "platform", rect(5, 5, 20, 20), { height: 1 })), rect(10, 10, 5, 5)); near(r.actual, 25, 0.01); });
t("no terrain at all: exactly the plan area", () => { const r = T.surfaceArea([], rect(0, 0, 3, 4)); assert.strictEqual(r.actual, 12); assert.strictEqual(r.plan, 12); });
t("rubber over that 20 m level: sides 256 × √1.25 + top 144 = 430.22 m², against 400 on plan", () => { const f = FS(A("a", "level", rect(5, 5, 20, 20), { height: 2, run: 4 })), r = T.surfaceArea(f, rect(5, 5, 20, 20)); assert.strictEqual(r.plan, 400); near(r.actual, 256 * Math.sqrt(1.25) + 144, 0.4); });
t("rubber over a pyramid hill 20 m square, 3 high: four faces, each 20 × √(10² + 3²) ÷ 2, total 417.61 m²", () => { const f = FS(A("a", "hill", rect(5, 5, 20, 20), { height: 3, profile: "straight" })), r = T.surfaceArea(f, rect(5, 5, 20, 20)); near(r.actual, 4 * (20 * Math.sqrt(100 + 9) / 2), 0.5); });
t("a surface across a platform's edge doesn't count the vertical face as surface", () => { const f = FS(A("a", "platform", rect(10, 10, 10, 10), { height: 2 })), r = T.surfaceArea(f, rect(5, 10, 10, 10)); near(r.actual, 100, 1); });

/* ---------------- standing on terrain ---------------- */
t("an object stands on the highest ground under it, and reports how much the ground varies", () => { const f = FS(A("a", "level", rect(10, 10, 20, 10), { height: 2, run: 2 })), u = T.under(f, rect(10.5, 14, 3, 2)); near(u.max, 2, 0.01); near(u.min, 0.5, 0.5); near(u.varies, 1.5, 0.5); });
t("a product on a platform gets the platform's height, plus its own base height", () => {
  const p = project([A("a", "platform", rect(5, 5, 20, 20), { height: 1.5 }), { id: "b", kind: "product", code: "SW-A409", x: 15, y: 15, rot: 0, z: 0.25 }]), it = plain(S3.buildScene(p)).items.find((i) => i.role === "product"); near(it.y0, 1.75, 0.001); near(it.y1, 1.75 + CAT.BY["SW-A409"].dims.h, 0.001);
});
t("a safety zone and surfaces follow the ground", () => {
  const p = project([A("a", "platform", rect(5, 5, 20, 20), { height: 1.5 }), A("r", "rubber", rect(8, 8, 5, 5)), { id: "b", kind: "product", code: "SW-E101", x: 15, y: 15, rot: 0 }]), its = plain(S3.buildScene(p)).items;
  assert.ok(its.find((i) => i.id === "r").drape > 0, "surface follows"); assert.ok(its.find((i) => i.role === "zone").drape > 0, "zone follows");
});
t("the site stays flat under raised ground, and sunken shapes cut a hole in it", () => {
  const raised = plain(S3.buildScene(project([A("h", "hill", rect(10, 10, 8, 8), { height: 2 })]))).items.find((i) => i.role === "site"); assert.ok(!raised.drape && !raised.holes);
  const sunk = plain(S3.buildScene(project([A("p", "level", rect(10, 10, 8, 8), { height: -1, run: 1 })]))).items.find((i) => i.role === "site"); assert.ok(!sunk.drape); assert.deepStrictEqual(sunk.holes, [rect(10, 10, 8, 8)]);
});
t("fences follow the ground in short steps", () => { const p = project([A("a", "level", rect(10, 10, 20, 10), { height: 2, run: 2 }), { id: "f", kind: "line", type: "fence", pts: [[5, 15], [25, 15]], width: 0.08 }]), q = plain(S3.buildScene(p)).items.filter((i) => i.id === "f" && i.t === "prism"); assert.ok(q.length >= 10); assert.ok(Math.max(...q.map((i) => i.y0)) >= 1.9); assert.strictEqual(Math.min(...q.map((i) => i.y0)), 0); });
t("with no terrain, the scene is exactly what it was: nothing draped, everything at its old height", () => { const its = plain(S3.buildScene(project([A("r", "rubber", rect(8, 8, 5, 5)), { id: "b", kind: "product", code: "SW-A409", x: 15, y: 15, rot: 0 }]))).items; assert.ok(its.every((i) => !i.drape)); assert.strictEqual(its.find((i) => i.role === "product").y0, 0); });
t("terrain draws: platforms stand as solids, hills and levels as surfaces with their height labelled", () => {
  const its = plain(S3.buildScene(project([A("p", "platform", rect(1, 1, 5, 5), { height: 1 }), A("h", "hill", rect(10, 10, 8, 8), { height: 2.5 }), A("l", "level", rect(20, 10, 8, 8), { height: -1 })]))).items;
  assert.strictEqual(its.find((i) => i.id === "p").t, "prism"); assert.strictEqual(its.find((i) => i.id === "p").y1 > 1, true); const h = its.find((i) => i.id === "h"); assert.strictEqual(h.t, "flat"); assert.strictEqual(h.label, "+2.5 m"); assert.strictEqual(its.find((i) => i.id === "l").label, "−1 m");
});
t("the view's bounds include the top of a hill", () => { assert.ok(plain(S3.buildScene(project([A("h", "hill", rect(10, 10, 8, 8), { height: 3 })]))).bounds.top >= 2.9); });

/* ---------------- the mesh ---------------- */
const triArea = ([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
t("splitting triangles keeps the area exact and every edge within the limit", () => { const start = [[[0, 0], [10, 0], [10, 10]], [[0, 0], [10, 10], [0, 10]]], { tris } = T.subdivide(start, 1); near(tris.reduce((a, x) => a + triArea(x), 0), 100, 0.0001); for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1 + 1e-9); });
t("neighbours share every corner, so the surface has no cracks", () => { const start = [[[0, 0], [10, 0], [10, 10]], [[0, 0], [10, 10], [0, 10]]], m = T.draped([], start, 1, 0), edges = new Map(); const key = (i, j) => (i < j ? i + "-" + j : j + "-" + i); for (let k = 0; k < m.indices.length; k += 3) { const [a, b, c] = m.indices.slice(k, k + 3); for (const e of [key(a, b), key(b, c), key(c, a)]) edges.set(e, (edges.get(e) || 0) + 1); } const once = [...edges.entries()].filter(([, v]) => v === 1), bad = [...edges.values()].filter((v) => v > 2); assert.strictEqual(bad.length, 0); const px = (i) => [m.positions[i * 3], m.positions[i * 3 + 2]]; for (const [e] of once) { const [i, j] = e.split("-").map(Number), p = px(i), q = px(j), onEdge = (v) => Math.abs(v) < 1e-9 || Math.abs(v - 10) < 1e-9; assert.ok((onEdge(p[0]) && p[0] === q[0]) || (onEdge(p[1]) && p[1] === q[1]), "only the outer edge is open: " + e); } });
t("a huge surface coarsens rather than freezing the browser", () => { const r = T.subdivide([[[0, 0], [400, 0], [400, 400]], [[0, 0], [400, 400], [0, 400]]], 0.2, 20000); assert.ok(r.tris.length <= 20000); assert.ok(r.step > 0.2); });
t("the mesh takes its heights from the terrain", () => { const f = FS(A("a", "platform", rect(0, 0, 10, 10), { height: 2 })), m = T.draped(f, [[[1, 1], [9, 1], [9, 9]]], 2, 0.5); for (let i = 1; i < m.positions.length; i += 3) near(m.positions[i], 2.5, 0.001); });

/* ---------------- the commercial rule until Phase 8 ---------------- */
t("terrain never reaches the quotation yet: not costable, and no price book row", () => {
  for (const e of CAT.ELEMENTS.filter((x) => x.group === "terrain")) assert.strictEqual(e.costable, false, e.id);
  const p = project([A("h", "hill", rect(10, 10, 8, 8), { height: 3 }), A("q", "platform", rect(1, 1, 3, 3), { height: 1 })]); assert.deepStrictEqual(plain(M.takeoff(p)), []);
});
t("terrain is an ordinary object: undo, copy, move and the file check all work", () => {
  const o = A("h", "hill", rect(10, 10, 8, 8), { height: 3 }); project([o]); const live = M.S.project.objects[0]; M.resetHistory(); live.terrain.height = 4; M.commit("Edit terrain"); M.undo(); assert.strictEqual(M.S.project.objects[0].terrain.height, 3);
  const c = M.cloneObj(M.S.project.objects[0], 1, 1); assert.strictEqual(c.terrain.height, 3); assert.strictEqual(c.poly[0][0], 11); assert.strictEqual(M.checkProject(JSON.parse(JSON.stringify(M.projectFile(false)))), "v2");
});
t("terrain raises no false alarms in the existing checks", () => { const v = M.validate(project([A("h", "hill", rect(10, 10, 8, 8), { height: 3 }), { id: "b", kind: "product", code: "SW-A409", x: 14, y: 14, rot: 0 }])); assert.ok(!v.issues.some((i) => i.sev === "error" || i.sev === "warning"), JSON.stringify(v.issues.filter((i) => i.sev !== "info").map((i) => i.msg))); });
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
