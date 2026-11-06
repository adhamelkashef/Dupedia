/* Site Planner design elements: each one must appear in the 2D plan, the 3D scene and the take-off, and stay within its footprint. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app");
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "terrain", "scene3d", "pricing"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPCat: CAT, DPTerrain: T, DPScene3D: S3, DPSymbols: SY, DPPricing: PR, DPGeom: G } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what || "value"}: got ${got}, expected ${want} ± ${tol}`);
const plain = (v) => JSON.parse(JSON.stringify(v)), rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const project = (objects) => { const p = M.newProject(); p.site = { poly: rect(0, 0, 60, 40), north: 0 }; p.objects = objects; M.load(p); return M.S.project; };
const make = (e, id = "e", rot = 0) => (e.kind === "point" ? { id, kind: "point", type: e.id, x: 20, y: 20, l: e.l || e.d, w: e.w || e.d, rot } : e.kind === "line" ? { id, kind: "line", type: e.id, pts: [[5, 5], [15, 5], [15, 10]], width: e.width } : { id, kind: "area", type: e.id, poly: rect(10, 10, 8, 6) });
const NEW = CAT.ELEMENTS.filter((e) => e.added3d);

/* The brief's list, checked by name. If any of these disappears, this fails. */
const BRIEF = { "Trees": ["tree", "palm"], "Bushes and plants": ["shrub", "hedge", "planter", "planting"], "Fences and gates": ["fence", "gate", "gate-double"], "Benches and furniture": ["bench", "picnic", "bin"], "Pergolas and umbrellas": ["pergola", "umbrella", "shade"], "Rubber and EPDM": ["rubber", "epdm"], "Artificial grass and sand": ["turf", "sand"], "Water play": ["splash-pad", "water-jet", "water-table"], "Climbing": ["climb-wall", "climb-net", "boulder"], "Bridges and tunnels": ["bridge", "tunnel"], "Custom shapes": ["custom-area", "custom-object", "custom-structure", "custom-line"] };
for (const [item, ids] of Object.entries(BRIEF)) t(`brief: ${item} exist`, () => { for (const id of ids) assert.ok(CAT.EL[id], id); });

for (const e of NEW) t(`${e.id}: appears in 2D, in 3D and, once included, in the take-off`, () => {
  const o = make(e), p = project([o]); // 2D: a real symbol or style of its own, not the fallback
  if (e.kind === "point") assert.ok(SY.ELEMENT_SYM[e.sym], "has a 2D symbol"); else if (e.kind === "line") assert.ok(SY.LINE_STYLE[e.sym], "has a 2D line style"); else assert.ok(SY.AREA_STYLE[e.sym], "has a 2D area style");
  const sc = plain(S3.buildScene(p)); assert.ok(sc.items.filter((i) => i.id === "e").length > 0, "drawn in 3D"); assert.strictEqual(sc.skipped.length, 0);
  for (const i of sc.items) { for (const k of ["y", "y0", "y1", "x", "d", "cy"]) if (i[k] != null) assert.ok(isFinite(i[k]), k); for (const v of i.positions || []) assert.ok(isFinite(v)); }
  const rows = plain(M.takeoff(p)); assert.strictEqual(rows.length, 1, "in the take-off"); const r = rows[0]; assert.ok(r.qty > 0); assert.ok(PR.CAT_ORDER.includes(r.cat), "a category the quote screen shows");
  assert.strictEqual(r.unit, e.kind === "point" ? "each" : e.kind === "line" ? "m" : "m2");
});
t("take-off quantities are right: 15 m bridge, 48 m² splash pad, 48 m² EPDM, 2 jets", () => {
  const q = plain(M.takeoff(project([make(CAT.EL.bridge, "b"), make(CAT.EL["splash-pad"], "s"), make(CAT.EL.epdm, "d"), make(CAT.EL["water-jet"], "j"), make(CAT.EL["water-jet"], "k")]))), by = Object.fromEntries(q.map((r) => [r.key, r]));
  assert.strictEqual(by["el:bridge"].qty, 15); assert.strictEqual(by["el:splash-pad"].qty, 48); assert.strictEqual(by["el:epdm"].qty, 48); assert.strictEqual(by["el:epdm"].cat, "flooring"); assert.strictEqual(by["el:water-jet"].qty, 2);
});
t("marked out of the quotation, an item is left out of the take-off", () => { const o = make(CAT.EL.umbrella); o.costable = false; assert.deepStrictEqual(plain(M.takeoff(project([o]))), []); });
t("with a price they quote normally; with no price and left in, the existing rule still blocks", () => {
  const o = make(CAT.EL.epdm), p = project([o]), to = M.takeoff(p), price = PR.compute({ project: p, takeoff: to, pricebook: { currency: "EGP", items: { "el:epdm": { sell: 100 } } }, settings: {} }); assert.strictEqual(price.subtotal, 480000); assert.strictEqual(price.blocking, false); assert.strictEqual(PR.compute({ project: p, takeoff: to, pricebook: { currency: "EGP", items: {} }, settings: {} }).blocking, true);
  o.costable = false; assert.strictEqual(PR.compute({ project: p, takeoff: M.takeoff(p), pricebook: { currency: "EGP", items: {} }, settings: {} }).blocking, false);
});
t("EPDM counts as safety surfacing in the existing check, like rubber", () => { const zone = { id: "a", kind: "product", code: "SW-A409", x: 20, y: 20, rot: 0 }, cover = { id: "d", kind: "area", type: "epdm", poly: rect(5, 5, 30, 30) }; assert.ok(M.validate(project([zone])).issues.some((i) => i.code === "surfacing")); assert.ok(!M.validate(project([zone, cover])).issues.some((i) => i.code === "surfacing")); });
t("generic items say so in the existing check: they aren't Dupedia products", () => { for (const id of ["umbrella", "water-jet", "water-table", "climb-wall", "climb-net", "boulder"]) assert.ok(M.validate(project([make(CAT.EL[id])])).issues.some((i) => i.code === "generic"), id); });

/* Forms: display only, and never bigger than what the 2D plan and the overlap checks use */
const FORMED = ["bench", "picnic", "planter", "gate", "gate-exit", "gate-double", "g-swing", "g-basket", "g-slide", "g-seesaw", "g-spring", "water-table", "climb-wall", "climb-net"];
for (const id of FORMED) t(`${id}: every part stays inside its real footprint, at any turn`, () => { for (const rot of [0, 33, 90]) { const e = CAT.EL[id], o = make(e, "e", rot), sc = plain(S3.buildScene(project([o]))), parts = sc.items.filter((i) => i.id === "e"), a = -rot * Math.PI / 180, hl = o.l / 2 + 1e-6, hw = o.w / 2 + 1e-6; assert.ok(parts.length >= 2, "more than one part");
  for (const i of parts) { const pts = i.poly || [[i.x - i.d / 2, i.y], [i.x + i.d / 2, i.y]]; if (i.t === "ball") continue; for (const p of pts) { const dx = p[0] - o.x, dy = p[1] - o.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a); assert.ok(Math.abs(lx) <= hl && Math.abs(ly) <= hw, `${id} part outside at rot ${rot}: ${lx}, ${ly}`); } } } });
t("forms resize with the object", () => { const o = make(CAT.EL.bench); o.l = 3.6; const parts = plain(S3.buildScene(project([o]))).items.filter((i) => i.id === "e"), xs = parts.flatMap((p) => p.poly.map((q) => q[0])); near(Math.max(...xs) - Math.min(...xs), 3.6, 1e-9); });
t("an element given its own colour keeps the plain solid, so the colour shows", () => { const o = make(CAT.EL.bench); o.color = "#FF0000"; const parts = plain(S3.buildScene(project([o]))).items.filter((i) => i.id === "e"); assert.strictEqual(parts.length, 1); assert.strictEqual(parts[0].color, "#FF0000"); });
t("forms stand on the ground", () => { const o = make(CAT.EL.bench), items = plain(S3.buildScene(project([{ id: "pf", kind: "area", type: "platform", poly: rect(10, 10, 20, 20), terrain: { height: 1 } }, o]))).items.filter((i) => i.id === "e"); assert.ok(items.every((i) => i.y0 >= 1 - 1e-9)); near(Math.min(...items.map((i) => i.y0)), 1, 1e-9); });
t("fences have posts every 2.5 m and at the end: 10 m gives 5 posts; existing panel height unchanged", () => { const items = plain(S3.buildScene(project([{ id: "f", kind: "line", type: "fence", pts: [[0, 0], [10, 0]], width: 0.08 }]))).items.filter((i) => i.id === "f"); assert.strictEqual(items.filter((i) => i.t === "cyl").length, 5); assert.strictEqual(items.find((i) => i.t === "prism").y1, 1.2); });
t("posts stop at a gate: no post inside the opening", () => { const items = plain(S3.buildScene(project([{ id: "f", kind: "line", type: "fence", pts: [[0, 0], [20, 0]], width: 0.08 }, { id: "g", kind: "point", type: "gate", x: 10, y: 0, l: 2, w: 0.12, rot: 0 }]))).items.filter((i) => i.id === "f" && i.t === "cyl"); assert.ok(!items.some((i) => i.x > 9.01 && i.x < 10.99)); });
t("an umbrella's canopy is exactly its 2D circle, and doesn't count as an obstacle", () => { const o = make(CAT.EL.umbrella), parts = plain(S3.buildScene(project([o]))).items.filter((i) => i.id === "e"), m = parts.find((i) => i.t === "mesh"); let r = 0; for (let i = 3; i < m.positions.length; i += 3) r = Math.max(r, Math.hypot(m.positions[i] - 20, m.positions[i + 2] - 20)); near(r, 1.5, 1e-9); assert.strictEqual(CAT.EL.umbrella.blocks, false); });

/* Bridges */
const two = (a = 1, b = 1) => [{ id: "p1", kind: "area", type: "platform", poly: rect(5, 5, 10, 10), terrain: { height: a } }, { id: "p2", kind: "area", type: "platform", poly: rect(25, 5, 10, 10), terrain: { height: b } }];
const span = (terrain) => ({ id: "b", kind: "line", type: "bridge", pts: [[15, 10], [25, 10]], width: 1.2, terrain });
t("bridge between two 1 m platforms 10 m apart: 10 m long, level, deck 1 m above the ground below", () => { const objs = [...two(), span()], f = T.features(project(objs)), r = T.bridgeInfo(objs[2], f); near(r.ya, 1, 1e-9); near(r.yb, 1, 1e-9); near(r.length, 10, 1e-9); near(r.slopePct, 0, 1e-9); near(r.clearance, 1, 1e-9); });
t("between 1 m and 2 m platforms: rises 1 m over 10 m, 10%", () => { const objs = [...two(1, 2), span()], f = T.features(project(objs)), r = T.bridgeInfo(objs[2], f); near(r.ya, 1, 1e-9); near(r.yb, 2, 1e-9); near(r.slopePct, 10, 1e-9); near(r.clearance, 2, 0.02); });
t("raising the deck lifts both ends", () => { const objs = [...two(), span({ lift: 0.5 })], f = T.features(project(objs)), r = T.bridgeInfo(objs[2], f); near(r.ya, 1.5, 1e-9); near(r.clearance, 1.5, 1e-9); });
t("the deck is the right width and spans the route; rails stand 1 m above it", () => { const m = T.bridgeMesh(T.bridgeInfo(span({ lift: 1 }), [])); let zs = [], xs = [], top = 0; for (let i = 0; i < m.positions.length; i += 3) { xs.push(m.positions[i]); top = Math.max(top, m.positions[i + 1]); zs.push(m.positions[i + 2]); } near(Math.max(...xs) - Math.min(...xs), 10.05, 0.06); near(Math.max(...zs) - Math.min(...zs), 1.2, 1e-9); near(top, 2, 1e-9); for (const i of m.indices) assert.ok(i < m.positions.length / 3); });
t("a bridge doesn't count as an obstacle for what's beneath it", () => { const v = M.validate(project([{ id: "a", kind: "product", code: "SW-A409", x: 20, y: 10, rot: 0 }, span()])); assert.ok(!v.issues.some((i) => i.code === "line-foot")); });

/* Custom */
t("custom object: 1 m unless set, then your height", () => { const o = { id: "e", kind: "point", type: "custom-object", x: 5, y: 5, l: 1, w: 1, rot: 0 }; assert.strictEqual(plain(S3.buildScene(project([o]))).items.find((i) => i.id === "e").y1, 1); o.terrain = { height: 3.2 }; assert.strictEqual(plain(S3.buildScene(project([o]))).items.find((i) => i.id === "e").y1, 3.2); });
t("custom structure: any outline built up to your height, standing on the ground, with its plan area in the take-off", () => { const poly = [[5, 5], [15, 5], [15, 9], [9, 9], [9, 15], [5, 15]], o = { id: "e", kind: "area", type: "custom-structure", poly, terrain: { height: 3 } }, p = project([{ id: "pf", kind: "area", type: "platform", poly: rect(0, 0, 30, 30), terrain: { height: 1 } }, o]), it = plain(S3.buildScene(p)).items.find((i) => i.id === "e"); assert.strictEqual(it.t, "prism"); assert.deepStrictEqual(it.poly, poly); near(it.y0, 1, 1e-9); near(it.y1, 4, 1e-9); const q = plain(M.takeoff(p)).find((r) => r.key === "obj:e"); near(q.qty, 64, 1e-9); });

/* Everything old stays the same */
t("the original elements keep their order and price book rows", () => { const first = CAT.ELEMENTS.findIndex((e) => e.id === "stairs"); assert.ok(CAT.ELEMENTS.slice(first).every((e) => e.group === "terrain" || e.added3d), "new ones come last"); assert.ok(CAT.ELEMENTS.slice(0, first).every((e) => !e.added3d && e.group !== "terrain")); });
t("a plain custom object still prices through its own custom price", () => { const o = { id: "e", kind: "point", type: "custom-object", x: 5, y: 5, l: 1, w: 1, rot: 0 }, r = plain(M.takeoff(project([o])))[0]; assert.strictEqual(r.key, "obj:e"); assert.strictEqual(r.kind, "custom"); });
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
