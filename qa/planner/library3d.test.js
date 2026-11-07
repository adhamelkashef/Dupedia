/* Site Planner 3D library: every shipped model must match the catalogue, and the checker must refuse what doesn't. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..", ".."), APP = path.join(ROOT, "app");
const ctx = { console, DataView, Uint8Array, ArrayBuffer }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "scene3d"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "models", "manifest.js"), "utf8"), ctx, { filename: "manifest.js" });
const { DPModel: M, DPCat: CAT, DPScene3D: S3, DP_MODELS: SHIPPED } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const toBuf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), plain = (v) => JSON.parse(JSON.stringify(v));

/** A tiny GLB around one triangle, with whatever nodes and accessor bounds a test needs. */
function makeGlb({ min = [-1, 0, -1], max = [1, 2, 1], node = {}, extras = {}, count = 3 } = {}) {
  const json = Object.assign({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [Object.assign({ mesh: 0 }, node)], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ componentType: 5126, count, type: "VEC3", min, max }], buffers: [{ byteLength: 0 }] }, extras);
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(20); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + js.length, 8); h.writeUInt32LE(js.length, 12); h.writeUInt32LE(0x4E4F534A, 16);
  return toBuf(Buffer.concat([h, js]));
}
const PRODUCT = { dims: { l: 2, w: 2, h: 2 }, collection: "tower" };

for (const [code, rec] of Object.entries(SHIPPED)) t(`shipped model passes the check: ${code}`, () => {
  const p = CAT.BY[code]; assert.ok(p && p.dims, "in the catalogue, with dimensions"); const info = S3.glbInfo(toBuf(fs.readFileSync(path.join(ROOT, rec.file)))), c = S3.checkModel(info, p);
  assert.deepStrictEqual(plain(c.problems), []); assert.deepStrictEqual(plain(c.notes), [], "within its size targets"); assert.ok(Math.abs(info.l - p.dims.l) < 0.001 && Math.abs(info.w - p.dims.w) < 0.001 && Math.abs(info.h - p.dims.h) < 0.001, "exactly the published size"); assert.ok(info.triangles > 0); assert.strictEqual(info.textures, 0);
});
t("shipped models never claim more than they are", () => { for (const r of Object.values(SHIPPED)) { assert.strictEqual(r.accuracy, "approximate"); assert.ok(r.source.length > 10); assert.ok(!r.reviewedBy); } });
t("every shipped file is listed, and every listed file exists", () => { const files = fs.readdirSync(path.join(ROOT, "models")).filter((f) => f.endsWith(".glb")).map((f) => "models/" + f).sort(); assert.deepStrictEqual(Object.values(SHIPPED).map((r) => r.file).sort(), files); });

t("library covers every referenced product except the two paused references", () => { assert.strictEqual(Object.keys(SHIPPED).length, 57); assert.deepStrictEqual(Object.keys(CAT.BY).filter(c => !SHIPPED[c]).sort(), ["SW-A411", "SW-E110"]); });

t("a good model passes", () => { const c = S3.checkModel(S3.glbInfo(makeGlb()), PRODUCT); assert.strictEqual(c.ok, true); });
t("one that is too long, wide or tall is refused, naming the difference", () => {
  for (const [args, word] of [[{ min: [-1.2, 0, -1], max: [1.2, 2, 1] }, "Length"], [{ min: [-1, 0, -1.2], max: [1, 2, 1.2] }, "Width"], [{ min: [-1, 0, -1], max: [1, 2.2, 1] }, "Height"]]) { const c = S3.checkModel(S3.glbInfo(makeGlb(args)), PRODUCT); assert.strictEqual(c.ok, false); assert.ok(c.problems[0].startsWith(word), c.problems[0]); }
});
t("a difference within 5 cm is accepted, just beyond it is not", () => { assert.ok(S3.checkModel(S3.glbInfo(makeGlb({ min: [-1.02, 0, -1], max: [1.02, 2, 1] })), PRODUCT).ok); assert.ok(!S3.checkModel(S3.glbInfo(makeGlb({ min: [-1.03, 0, -1], max: [1.03, 2, 1] })), PRODUCT).ok); });
t("a model off-centre or off the ground is refused, because it would stand in the wrong place", () => { assert.ok(/centred/.test(S3.checkModel(S3.glbInfo(makeGlb({ min: [0, 0, -1], max: [2, 2, 1] })), PRODUCT).problems[0])); assert.ok(/ground/.test(S3.checkModel(S3.glbInfo(makeGlb({ min: [-1, 0.5, -1], max: [1, 2.5, 1] })), PRODUCT).problems[0])); });
t("sizes come from the whole node tree: a model built in centimetres is caught", () => { const c = S3.checkModel(S3.glbInfo(makeGlb({ min: [-100, 0, -100], max: [100, 200, 100] })), PRODUCT); assert.ok(!c.ok); const scaled = S3.glbInfo(makeGlb({ min: [-100, 0, -100], max: [100, 200, 100], node: { scale: [0.01, 0.01, 0.01] } })); assert.ok(Math.abs(scaled.l - 2) < 1e-9); assert.ok(S3.checkModel(scaled, PRODUCT).ok); });
t("a node's rotation and position count too", () => { const turned = S3.glbInfo(makeGlb({ min: [-2, 0, -1], max: [2, 1, 1], node: { rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } })); assert.ok(Math.abs(turned.l - 2) < 1e-9 && Math.abs(turned.w - 4) < 1e-9); const moved = S3.glbInfo(makeGlb({ node: { translation: [5, 0, 0] } })); assert.ok(Math.abs(moved.cx - 5) < 1e-9); });
t("a model that needs a blocked decoder is refused, with the reason", () => { const c = S3.checkModel(S3.glbInfo(makeGlb({ extras: { extensionsRequired: ["KHR_draco_mesh_compression"] } })), PRODUCT); assert.ok(!c.ok); assert.ok(/security policy/.test(c.problems[0])); });
t("over the size target is advice, not a refusal", () => { const c = S3.checkModel(S3.glbInfo(makeGlb({ count: 300000 })), PRODUCT); assert.ok(c.ok); assert.ok(/triangles/.test(c.notes[0])); });
t("a product with no dimensions can't pass", () => { assert.ok(!S3.checkModel(S3.glbInfo(makeGlb()), { collection: "tower" }).ok); });
t("broken files are refused with a clear message, never crash", () => { assert.throws(() => S3.glbInfo(new ArrayBuffer(4)), /too small/); assert.throws(() => S3.glbInfo(new ArrayBuffer(64)), /not a GLB/); const b = Buffer.from(makeGlb()); b.writeUInt32LE(1, 4); assert.throws(() => S3.glbInfo(toBuf(b)), /version 2/); const c = Buffer.from(makeGlb()); c.writeUInt32LE(c.length * 2, 12); assert.throws(() => S3.glbInfo(toBuf(c)), /cut short/); });

t("records: no record means no model", () => { assert.strictEqual(S3.libraryRecord("SW-E101", {}, {}), null); });
t("records: a shipped file is approximate unless someone says otherwise", () => { assert.strictEqual(S3.libraryRecord("X", { X: { file: "models/x.glb", source: "s" } }, {}).accuracy, "approximate"); });
t("records: reviewed needs a named person and a named source, or it stays approximate", () => {
  const base = { file: "models/x.glb", accuracy: "reviewed" }; assert.strictEqual(S3.libraryRecord("X", { X: base }, {}).accuracy, "approximate"); assert.strictEqual(S3.libraryRecord("X", { X: Object.assign({ source: "drawing" }, base) }, {}).accuracy, "approximate");
  assert.strictEqual(S3.libraryRecord("X", { X: Object.assign({ source: "drawing", reviewedBy: "Eng" }, base) }, {}).accuracy, "reviewed");
});
t("records: what administrators recorded overrides the shipped entry; removing the file means block-out", () => { const r = S3.libraryRecord("X", { X: { file: "a.glb", source: "s" } }, { X: { materials: ["Timber"] } }); assert.strictEqual(r.file, "a.glb"); assert.strictEqual(r.materials[0], "Timber"); assert.strictEqual(S3.libraryRecord("X", { X: { file: "a.glb" } }, { X: { file: null } }).accuracy, "block-out"); });

const project = (objects) => { const p = M.newProject(); p.site = { poly: [[0, 0], [40, 0], [40, 30], [0, 30]], north: 0 }; p.objects = objects; M.load(p); return M.S.project; };
t("the scene hands the 3D view a model, its exact position and turn, and keeps the catalogue footprint", () => {
  const o = { id: "a", kind: "product", code: "SW-A409", x: 12, y: 9, rot: 30, z: 0.5 }, sc = plain(S3.buildScene(project([o]), { modelFor: (c) => S3.libraryRecord(c, SHIPPED, {}) })), it = sc.items.find((i) => i.role === "product");
  assert.strictEqual(it.model.file, "models/SW-A409.glb"); assert.strictEqual(it.accuracy, "approximate"); assert.deepStrictEqual([it.x, it.y, it.rot, it.y0], [12, 9, 30, 0.5]); assert.deepStrictEqual(it.poly, plain(M.shapes(o).foot));
});
t("a product with no model stays a block-out, and says so", () => { const it = plain(S3.buildScene(project([{ id: "a", kind: "product", code: "SW-E101", x: 12, y: 12, rot: 0 }]), { modelFor: (c) => S3.libraryRecord(c, {}, {}) })).items.find((i) => i.role === "product"); assert.strictEqual(it.model, null); assert.strictEqual(it.accuracy, "block-out"); });
t("a chosen colour reaches the block-out only if the library really lists it", () => {
  const rec = { file: null, accuracy: "block-out", colours: [{ id: "red", name: "Red", hex: "#FF0000" }], materials: [] }, one = (finish) => plain(S3.buildScene(project([Object.assign({ id: "a", kind: "product", code: "SW-A409", x: 12, y: 12, rot: 0 }, finish ? { finish } : {})]), { modelFor: () => rec })).items.find((i) => i.role === "product").color;
  assert.strictEqual(one("red"), "#FF0000"); assert.notStrictEqual(one("green"), "#FF0000"); assert.strictEqual(one(null), one("green"));
});
t("library details never reach quantities or prices", () => { const p = project([{ id: "a", kind: "product", code: "SW-A409", x: 12, y: 12, rot: 0 }]), before = plain(M.takeoff()); p.objects[0].finish = "red"; S3.buildScene(p, { modelFor: (c) => S3.libraryRecord(c, SHIPPED, {}) }); assert.deepStrictEqual(plain(M.takeoff()), before); });
t("every budget and label the app quotes is defined", () => { for (const c of ["estate", "tower", "adventure", "early", "landscape", "custom"]) assert.ok(S3.BUDGET[c].kb > 0 && S3.BUDGET[c].tris > 0); assert.ok(S3.ACCURACY["block-out"] && S3.ACCURACY.approximate && S3.ACCURACY.reviewed); });
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
