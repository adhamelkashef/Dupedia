/* Site Planner 3D: the shapes handed to the 3D view must match the 2D plan, and building them must never touch the project. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app");
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "terrain", "scene3d"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPCat: CAT, DPGeom: G, DPScene3D: S3 } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v));
const SITE = { poly: [[0, 0], [60, 0], [60, 40], [0, 40]], north: 0 };
const project = (objects, site = SITE) => { const p = M.newProject(); p.site = site; p.objects = objects; M.load(p); return M.S.project; };
const of = (sc, id) => sc.items.filter((i) => i.id === id);

t("an empty project builds without error", () => { const sc = plain(S3.buildScene(M.newProject())); assert.deepStrictEqual(sc.items, []); assert.strictEqual(sc.bounds, null); });
t("the site is drawn with its real boundary", () => { const sc = plain(S3.buildScene(project([]))); assert.deepStrictEqual(sc.items[0].poly, SITE.poly); assert.strictEqual(sc.bounds.w, 60); assert.strictEqual(sc.bounds.h, 40); });

t("every placeable product uses its exact 2D footprint and published height", () => {
  for (const [i, p] of CAT.PRODUCTS.filter((x) => x.dims).entries()) { const rot = (i * 37) % 360, o = { id: "p", kind: "product", code: p.code, x: 20, y: 15, rot };
    const it = of(plain(S3.buildScene(project([o]))), "p").find((x) => x.role === "product");
    assert.deepStrictEqual(it.poly, plain(M.shapes(o).foot), p.code); assert.strictEqual(it.y0, 0); assert.strictEqual(it.y1, p.dims.h, p.code); assert.strictEqual(it.accuracy, "block-out"); }
});
t("a product with no dimensions is listed as not shown, never given a made-up size", () => {
  const p = CAT.PRODUCTS.find((x) => !x.dims); assert.ok(p, "the catalogue has one (SW-E110)");
  const sc = plain(S3.buildScene(project([{ id: "x", kind: "product", code: p.code, x: 5, y: 5, rot: 0 }])));
  assert.strictEqual(of(sc, "x").length, 0); assert.strictEqual(sc.skipped[0].id, "x"); assert.strictEqual(sc.skipped[0].why, "no published dimensions");
});
t("unknown products and elements are listed, not silently dropped", () => {
  const sc = plain(S3.buildScene(project([{ id: "a", kind: "product", code: "SW-NOPE", x: 1, y: 1, rot: 0 }, { id: "b", kind: "point", type: "nope", x: 2, y: 2, l: 1, w: 1 }, { id: "c", kind: "area", type: "nope", poly: [[0, 0], [1, 0], [1, 1]] }, { id: "d", kind: "line", type: "nope", pts: [[0, 0], [1, 0]] }])));
  assert.deepStrictEqual(sc.skipped.map((s) => s.id).sort(), ["a", "b", "c", "d"]); assert.strictEqual(sc.items.filter((i) => i.role !== "site").length, 0);
});
t("hidden objects are left out, as in 2D", () => { const sc = plain(S3.buildScene(project([{ id: "h", kind: "product", code: "SW-A409", x: 9, y: 9, rot: 0, hidden: true }]))); assert.strictEqual(of(sc, "h").length, 0); assert.strictEqual(sc.skipped.length, 0); });
t("a drawn safety zone matches the 2D zone; products with no drawable zone get none", () => {
  const withZone = CAT.PRODUCTS.find((p) => p.dims && p.zone && p.zone.kind === "rect"), noZone = CAT.PRODUCTS.find((p) => p.dims && (!p.zone || p.zone.kind !== "rect"));
  const a = { id: "a", kind: "product", code: withZone.code, x: 20, y: 20, rot: 30 }, b = { id: "b", kind: "product", code: noZone.code, x: 40, y: 20, rot: 0 }, sc = plain(S3.buildScene(project([a, b])));
  assert.deepStrictEqual(of(sc, "a").find((i) => i.role === "zone").poly, plain(M.shapes(a).zone)); assert.strictEqual(of(sc, "b").find((i) => i.role === "zone"), undefined);
});
t("an optional base height lifts an object and nothing else", () => {
  const code = "SW-A409", h = CAT.BY[code].dims.h, it = of(plain(S3.buildScene(project([{ id: "a", kind: "product", code, x: 9, y: 9, rot: 0, z: 1.5 }]))), "a").find((x) => x.role === "product");
  assert.strictEqual(it.y0, 1.5); assert.strictEqual(it.y1, 1.5 + h);
});
t("a fence has a real gap where a gate stands, same as its quoted length", () => {
  const f = { id: "f", kind: "line", type: "fence", pts: [[0, 0], [30, 0]], width: 0.08 }, g = { id: "g", kind: "point", type: "gate", x: 10, y: 0, l: 1.2, w: 0.12, rot: 0 }, sc = plain(S3.buildScene(project([f, g])));
  const quads = of(sc, "f").filter((i) => i.t === "prism"); assert.strictEqual(quads.length, 2);
  const run = quads.map((q) => G.bbox(q.poly).w).reduce((a, b) => a + b, 0); assert.ok(Math.abs(run - 28.8) < 1e-9, run);
  assert.ok(Math.abs(M.takeoff().find((r) => r.key === "el:fence").qty - run) < 1e-9);
});
t("surfaces keep their exact outline and stay flat on the ground", () => {
  const poly = [[2, 3], [10, 3], [12, 9], [2, 9]], sc = plain(S3.buildScene(project([{ id: "r", kind: "area", type: "rubber", poly }]))), it = of(sc, "r")[0];
  assert.strictEqual(it.t, "flat"); assert.deepStrictEqual(it.poly, poly); assert.ok(it.y > 0 && it.y < 0.1); assert.ok(G.area(it.poly) === M.takeoff()[0].qty);
});
t("later surfaces sit above earlier ones, so they never flicker", () => {
  const sc = plain(S3.buildScene(project([{ id: "a", kind: "area", type: "rubber", poly: [[0, 0], [9, 0], [9, 9]] }, { id: "b", kind: "area", type: "turf", poly: [[0, 0], [9, 0], [9, 9]] }]))); assert.ok(of(sc, "b")[0].y > of(sc, "a")[0].y);
});
t("every library element either draws or is an annotation, with no errors", () => {
  for (const e of CAT.ELEMENTS) { const id = "e", o = e.kind === "point" ? { id, kind: "point", type: e.id, x: 9, y: 9, l: e.l || e.d || 1, w: e.w || e.d || 1, rot: 0 } : e.kind === "line" ? { id, kind: "line", type: e.id, pts: [[1, 1], [9, 1]], width: e.width } : { id, kind: "area", type: e.id, poly: [[1, 1], [9, 1], [9, 9]] };
    const sc = plain(S3.buildScene(project([o]))); assert.strictEqual(sc.skipped.length, 0, e.id);
    if (!e.annotation && e.id !== "opening") assert.ok(of(sc, "e").length > 0, e.id + " draws nothing");
    if (e.annotation && e.kind !== "area") assert.strictEqual(of(sc, "e").length, 0, e.id + " is an annotation");   // annotated areas (clearance) are drawn in 2D too
    for (const i of sc.items) for (const k of ["y", "y0", "y1", "x", "d", "cy"]) if (i[k] != null) assert.ok(isFinite(i[k]), e.id + " " + k); }
});
t("a pergola stands on four posts at its real corners, with its roof over its footprint", () => {
  const o = { id: "g", kind: "point", type: "pergola", x: 20, y: 20, l: 4, w: 4, rot: 30 }, sc = plain(S3.buildScene(project([o]))), foot = plain(M.shapes(o).foot), parts = of(sc, "g");
  assert.deepStrictEqual(parts.filter((i) => i.t === "cyl").map((i) => [i.x, i.y]), foot); assert.deepStrictEqual(parts.find((i) => i.t === "prism").poly, foot);
});
t("display heights never reach quantities or prices: elements have no effect on the take-off", () => {
  const objs = [{ id: "w", kind: "line", type: "wall", pts: [[0, 0], [10, 0]], width: 0.25 }, { id: "t", kind: "point", type: "tree", x: 5, y: 5, l: 4, w: 4 }]; const p = project(objs); const before = plain(M.takeoff()); S3.buildScene(p); assert.deepStrictEqual(plain(M.takeoff()), before);
});
t("building a scene never changes the project, the undo history or the unsaved flag", () => {
  const p = project([{ id: "a", kind: "product", code: "SW-A409", x: 9, y: 9, rot: 20 }, { id: "f", kind: "line", type: "fence", pts: [[0, 0], [9, 0]] }, { id: "r", kind: "area", type: "rubber", poly: [[0, 0], [5, 0], [5, 5]] }]);
  const a = JSON.stringify(p), d = M.S.dirty, past = M.hist.past.length; S3.buildScene(p); assert.strictEqual(JSON.stringify(p), a); assert.strictEqual(M.S.dirty, d); assert.strictEqual(M.hist.past.length, past);
});
t("a CAD or reference underlay is mentioned instead of silently missing", () => { const p = project([]); p.ref = { offset: [0, 0], w: 1, h: 1, mpp: 1 }; assert.ok(S3.buildScene(p).notes[0].includes("2D plan only")); });
t("camera presets stay above the ground, see the whole site and aim at its centre", () => {
  const b = S3.boundsOf(plain(S3.buildScene(project([]))).items);
  for (const v of ["top", "front", "back", "left", "right", "corner"]) for (const a of [0.5, 1, 2]) { const c = S3.cameraFor(v, b, 40, a); assert.ok(c.pos[1] > 0, v); assert.strictEqual(c.target[0], 30); assert.strictEqual(c.target[2], 20); const dd = Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]); assert.ok(dd >= Math.hypot(60, 40) / 2, v + " too close"); }
  assert.ok(S3.cameraFor("front", b, 40, 1.5).pos[2] > 20); assert.ok(S3.cameraFor("back", b, 40, 1.5).pos[2] < 20); assert.ok(S3.cameraFor("left", b, 40, 1.5).pos[0] < 30); assert.ok(S3.cameraFor("right", b, 40, 1.5).pos[0] > 30);
});
t("saved cameras: added, listed and removed, with the list gone when empty", () => {
  const p = M.newProject(), v = S3.addView(p, "  Entrance  ", [1.23456, 2, 3], [0, 0, 0]); assert.strictEqual(v.name, "Entrance"); assert.deepStrictEqual(plain(v.pos), [1.235, 2, 3]); assert.strictEqual(S3.savedViews(p).length, 1);
  S3.removeView(p, v.id); assert.strictEqual(S3.savedViews(p).length, 0); assert.strictEqual(p.views3d, undefined);
});
t("saved cameras: refuses a blank name, a broken position and too many views", () => {
  const p = M.newProject(); assert.throws(() => S3.addView(p, "  ", [1, 2, 3], [0, 0, 0]), /name/); assert.throws(() => S3.addView(p, "x", [1, NaN, 3], [0, 0, 0]), /camera/);
  for (let i = 0; i < S3.MAX_VIEWS; i++) S3.addView(p, "v" + i, [1, 2, 3], [0, 0, 0]); assert.throws(() => S3.addView(p, "extra", [1, 2, 3], [0, 0, 0]), /Delete one/);
});
t("saved cameras: damaged entries from a file are ignored, never used", () => {
  const p = M.newProject(); p.views3d = [{ name: "ok", pos: [1, 2, 3], target: [0, 0, 0] }, { name: "bad", pos: [1, 2], target: [0, 0, 0] }, { pos: [1, 2, 3], target: [0, 0, 0] }, null, "x"];
  assert.deepStrictEqual(S3.savedViews(p).map((v) => v.name), ["ok"]); p.views3d = "broken"; assert.deepStrictEqual(plain(S3.savedViews(p)), []);
});
t("saved cameras: never reach the take-off or the undo history, and survive saving", () => {
  const p = project([{ id: "a", kind: "product", code: "SW-A409", x: 9, y: 9, rot: 0 }]), to = plain(M.takeoff()), past = M.hist.past.length; S3.addView(p, "Entrance", [1, 2, 3], [0, 0, 0]);
  assert.deepStrictEqual(plain(M.takeoff()), to); assert.strictEqual(M.hist.past.length, past); assert.strictEqual(JSON.parse(JSON.stringify(p)).views3d[0].name, "Entrance");
});
t("a project with nothing drawn still gets a usable camera", () => { const c = S3.cameraFor("corner", null, 40, 1.5); assert.ok(isFinite(c.pos[0]) && c.dist > 0); });
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
