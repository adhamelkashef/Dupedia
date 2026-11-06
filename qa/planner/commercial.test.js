/* Phase 8: measured quantities, commission on new items, margin costs, the handover list.
   Every price, cost and rate here is made up to exercise the arithmetic. None is a real Dupedia figure. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..", ".."), APP = path.join(ROOT, "app");
const load = (files) => { const c = { console }; c.self = c; c.window = c; vm.createContext(c); for (const f of files) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), c, { filename: f + ".js" }); return c; };
const BASE = ["products", "geom", "catalogue", "pen", "symbols", "model", "pricing", "commission"];
const ctx = load(BASE.concat(["terrain"]));
const { DPModel: M, DPCat: CAT, DPPricing: PR, DPCommission: C, DPTerrain: T } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v)), near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m || ""} ${a} vs ${b}`);
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const A = (id, type, poly, terrain, extra) => Object.assign({ id, kind: "area", type, poly }, terrain ? { terrain } : {}, extra || {}), L = (id, type, pts, width, terrain, extra) => Object.assign({ id, kind: "line", type, pts, width }, terrain ? { terrain } : {}, extra || {}), P = (id, type, x, y, l, w, rot, terrain, extra) => Object.assign({ id, kind: "point", type, x, y, l, w, rot }, terrain ? { terrain } : {}, extra || {});
const IN = { costable: true };
const project = (objects) => { const p = M.newProject(); p.site = { poly: rect(0, 0, 80, 60), north: 0 }; p.objects = objects; M.load(p); T.measureProject(M.S.project); return M.S.project; };
const row = (p, key) => M.takeoff(p).find((r) => r.key === key);
const SET = { taxPct: 14, taxLabel: "VAT" };
const price = (p, items, opts = {}) => PR.compute(Object.assign({ project: p, takeoff: M.takeoff(p), pricebook: { currency: "EGP", items }, settings: SET, siteArea: 0, productCount: 0 }, opts));
const code = CAT.PRODUCTS[0].code, prod = (id = "p1", x = 5, y = 5) => ({ id, kind: "product", code, x, y, rot: 0 });
const E = (v) => Math.round(v * 100);

/* ---------------- quantities, against hand figures ---------------- */
t("A platform's volume is its plan area times its height: 10 × 10 × 0.6 = 60 m³", () => { const r = row(project([A("a", "platform", rect(10, 10, 10, 10), { height: 0.6 }, IN)]), "el:platform"); assert.strictEqual(r.unit, "m3"); near(r.qty, 60, 0.3); assert.strictEqual(r.cat, "landscape"); });
t("A straight-sided level: 20 × 20 m, 2 m high, 4 m sides. Hand figure from the frustum, (400 + 144 + √(400×144)) × 2 / 3 = 522.67 m³", () => { const r = row(project([A("a", "level", rect(10, 10, 20, 20), { height: 2, run: 4, profile: "straight" }, IN)]), "el:level"); near(r.qty, 522.67, 5); });
t("A sunken level goes on its own excavation row, as a positive quantity", () => { const p = project([A("a", "level", rect(10, 10, 20, 20), { height: -2, run: 4, profile: "straight" }, IN)]), r = row(p, "el:level-cut"); assert.ok(r); near(r.qty, 522.67, 5); assert.ok(!row(p, "el:level")); });
t("Raised and sunken levels on one plan stay on separate rows", () => { const p = project([A("a", "level", rect(5, 5, 10, 10), { height: 1 }, IN), A("b", "level", rect(30, 5, 10, 10), { height: -1 }, IN)]); assert.ok(row(p, "el:level") && row(p, "el:level-cut")); });
t("Stairs are priced per step, and two flights add up: 5 + 7 = 12", () => { const r = row(project([P("a", "stairs", 10, 10, 2.4, 1.2, 0, { rise: 0.9, steps: 5 }, IN), P("b", "stairs", 20, 10, 2.4, 1.2, 0, { rise: 0.9, steps: 7 }, IN)]), "el:stairs"); assert.strictEqual(r.qty, 12); assert.strictEqual(r.unit, "each"); });
t("A wall on flat ground: 10 m long and 1.5 m high is 15 m² of face", () => { const r = row(project([L("a", "retaining-wall", [[10, 10], [20, 10]], 0.25, { height: 1.5 }, IN)]), "el:retaining-wall"); assert.strictEqual(r.unit, "m2"); near(r.qty, 15, 0.1); });
t("A wall into a 1 m platform shows less face where the ground is higher", () => { const r = row(project([A("pf", "platform", rect(15, 5, 10, 10), { height: 1 }), L("a", "retaining-wall", [[10, 10], [20, 10]], 0.25, { height: 1.5 }, IN)]), "el:retaining-wall"); near(r.qty, 10, 0.3); });
t("A tunnel is priced per metre along its line: 3 + 4 = 7 m bend", () => { const r = row(project([L("a", "tunnel", [[10, 10], [13, 10], [13, 14]], 1.4, { clear: 1.2 }, IN)]), "el:tunnel"); assert.strictEqual(r.unit, "m"); near(r.qty, 7, 0.001); });
t("A surface on a straight 45% slope: true area is plan × √(1 + 0.45²)", () => { const p = project([A("h", "hill", rect(0, 0, 60, 40), { height: 9, run: 20, profile: "straight" }), A("s", "rubber", rect(2, 15, 10, 10))]), r = row(p, "el:rubber"); near(r.qty, 100 * Math.sqrt(1 + 0.45 * 0.45), 1); assert.ok(/100\.00 m² on plan/.test(r.basis), r.basis); });
t("A surface beside the terrain keeps its plan area, and no second figure is shown", () => { const p = project([A("h", "hill", rect(40, 10, 20, 20), { height: 3 }), A("s", "rubber", rect(2, 2, 10, 10))]), r = row(p, "el:rubber"); assert.strictEqual(r.qty, 100); assert.strictEqual(r.basis || null, null); });
t("Overlapping hills say that shared earth is counted twice", () => { const p = project([A("a", "hill", rect(10, 10, 20, 20), { height: 2 }, IN), A("b", "hill", rect(20, 10, 20, 20), { height: 2 }, IN)]), r = row(p, "el:hill"); assert.ok(/counted twice/.test(r.basis), r.basis); });
t("Separate hills don't carry that note", () => { const r = row(project([A("a", "hill", rect(5, 5, 10, 10), { height: 2 }, IN), A("b", "hill", rect(40, 5, 10, 10), { height: 2 }, IN)]), "el:hill"); assert.ok(!/counted twice/.test(r.basis), r.basis); });

/* ---------------- every screen reads the same figure ---------------- */
t("A saved project gives the same take-off and total on a screen without the terrain code", () => {
  const p = project([A("h", "hill", rect(0, 0, 60, 40), { height: 9, run: 20, profile: "straight" }, IN), A("s", "rubber", rect(2, 15, 10, 10))]), saved = plain(p), items = { "el:hill": { sell: 100 }, "el:rubber": { sell: 50 } };
  const a = price(p, items), other = load(BASE); assert.strictEqual(other.DPTerrain, undefined, "no terrain code here");
  other.DPModel.load(plain(saved)); const q = other.DPModel.S.project, b = other.DPPricing.compute({ project: q, takeoff: other.DPModel.takeoff(q), pricebook: { currency: "EGP", items }, settings: SET, siteArea: 0, productCount: 0 });
  assert.strictEqual(b.total, a.total); assert.strictEqual(b.blocking, false);
});
t("Moving a hill makes every figure it touches out of date, and that blocks the quote instead of using the old number", () => {
  const p = project([A("h", "hill", rect(0, 0, 60, 40), { height: 9, run: 20, profile: "straight" }, IN), A("s", "rubber", rect(2, 15, 10, 10))]); p.objects[0].poly = rect(5, 0, 60, 40);
  assert.strictEqual(M.staleMeasures(p), 2); const r = price(p, { "el:hill": { sell: 100 }, "el:rubber": { sell: 50 } }); assert.ok(r.blocking); assert.ok(r.issues.some((i) => i.code === "stale-measure"));
  T.measureProject(p); assert.strictEqual(M.staleMeasures(p), 0); assert.strictEqual(price(p, { "el:hill": { sell: 100 }, "el:rubber": { sell: 50 } }).blocking, false);
});
t("Commit re-measures before the snapshot, so undo restores the figure with the shape", () => {
  const p = project([A("a", "platform", rect(10, 10, 10, 10), { height: 1 }, IN)]); M.commit("first"); const before = row(p, "el:platform").qty; near(before, 100, 0.5);
  M.S.project.objects[0].terrain = { height: 2 }; M.commit("taller"); near(row(M.S.project, "el:platform").qty, 200, 1); M.undo(); assert.strictEqual(M.staleMeasures(M.S.project), 0); assert.strictEqual(row(M.S.project, "el:platform").qty, before);
});
t("Removing the last terrain shape returns surfaces to plan area with nothing left out of date", () => { const p = project([A("h", "hill", rect(0, 0, 60, 40), { height: 9, run: 20, profile: "straight" }), A("s", "rubber", rect(2, 15, 10, 10))]); p.objects.shift(); assert.strictEqual(M.staleMeasures(p), 0); assert.strictEqual(row(p, "el:rubber").qty, 100); T.measureProject(p); assert.strictEqual(p.objects[0].measured, undefined); });
t("A project with no terrain gets no new field and no new work", () => { const p = project([A("s", "rubber", rect(2, 2, 10, 10)), L("f", "fence", [[1, 1], [9, 1]], 0.1), prod()]); assert.ok(p.objects.every((o) => !("measured" in o))); assert.strictEqual(M.terrainKey(p), ""); assert.strictEqual(M.staleMeasures(p), 0); });
t("A figure carries no money", () => { const p = project([A("a", "platform", rect(10, 10, 10, 10), { height: 1 }, IN)]); assert.deepStrictEqual(Object.keys(p.objects[0].measured).sort(), ["q", "sig"]); });

/* ---------------- staying out of the quote until priced ---------------- */
t("Terrain placed without the box ticked stays out of the quote, can't block it, and is listed as left out", () => { const p = project([A("a", "hill", rect(10, 10, 20, 20), { height: 2 }), P("s", "stairs", 40, 10, 2.4, 1.2, 0, { rise: 0.9, steps: 5 })]); assert.strictEqual(M.takeoff(p).length, 0); assert.strictEqual(price(p, {}).blocking, false); const l = M.notQuoted(p); assert.deepStrictEqual(plain(l.map((x) => x.key)).sort(), ["el:hill", "el:stairs"]); });
t("Included with no price: blocks with the existing message, and never reads as zero", () => { const r = price(project([A("a", "hill", rect(10, 10, 20, 20), { height: 2 }, IN)]), {}); assert.ok(r.blocking); assert.ok(r.issues.some((i) => i.code === "unpriced")); assert.strictEqual(r.total, 0); });
t("Every new row's category appears in the quote's category list, so its money can't be hidden", () => { const cats = PR.CAT_ORDER; for (const e of CAT.ELEMENTS) if (e.priced3d) assert.ok(cats.includes(e.cat), e.id); });
t("Every unit in use has a label", () => { for (const e of CAT.ELEMENTS) for (const r of e.priced3d || []) assert.ok(PR.UNIT_LABEL[r.unit], r.key); });
t("Price rows are unique and don't collide with anything", () => { const keys = CAT.ELEMENTS.flatMap((e) => (e.priced3d || []).map((r) => r.key)); assert.strictEqual(new Set(keys).size, keys.length); assert.strictEqual(keys.length, 7); });
t("The PDF prints m3 because its fonts have no ³, and row names and notes only use characters the fonts have", () => {
  const c = {}; c.self = c; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(APP, "fontcover.js"), "utf8"), c); const has = (ch) => c.DP_FONT_COVER.sans.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);
  assert.ok(!has("³"), "if the fonts gain ³ the special case can go"); assert.ok(/l\.unit === "m3" \? "m3"/.test(fs.readFileSync(path.join(APP, "proposal.js"), "utf8")));
  for (const e of CAT.ELEMENTS) for (const r of e.priced3d || []) for (const ch of r.name + (r.basis || "")) assert.ok(has(ch), `${r.key}: ${ch}`);
  for (const ch of "Area on the ground. 100.00 m² on plan. Shapes overlap, so shared earth is counted twice") assert.ok(has(ch), ch);
});
t("Discount and tax apply to a new line like any other: 100 m³ at 100, 10% off, 14% tax", () => { const p = project([A("a", "platform", rect(10, 10, 10, 10), { height: 1 }, IN)]); p.pricing.discountPct = 10; const r = price(p, { "el:platform": { sell: 100 } }, { settings: SET }); const line = r.lines[0], sub = line.totalMinor; assert.strictEqual(r.discount, Math.round(sub * 0.1)); assert.strictEqual(r.tax, Math.round((sub - r.discount) * 0.14)); assert.strictEqual(r.total, sub - r.discount + r.tax); });
t("Labour and transport on a new row become Installation and Delivery lines in the existing categories", () => { const r = price(project([A("a", "platform", rect(10, 10, 10, 10), { height: 1 }, IN)]), { "el:platform": { sell: 100, install: 10, delivery: 5 } }); const by = Object.fromEntries(r.lines.map((l) => [l.key, l])); assert.strictEqual(by["el:platform#install"].cat, "installation"); assert.strictEqual(by["el:platform#delivery"].cat, "services"); assert.strictEqual(by["el:platform#install"].qty, by["el:platform"].qty); });
t("A manual quantity is honoured and flagged like any other line", () => { const p = project([A("a", "platform", rect(10, 10, 10, 10), { height: 1 }, IN)]); p.pricing.overrides = { "el:platform": { qty: 90, by: "t", reason: "r" } }; const r = price(p, { "el:platform": { sell: 100 } }); assert.strictEqual(r.lines[0].qty, 90); assert.ok(r.lines[0].qtyOverridden); assert.ok(r.issues.some((i) => i.code === "qty-diff")); });

/* ---------------- commission ---------------- */
// One product sold at 999,000 (made up) sits just under the 1,000,000 band; a made-up 20 per m³ on 100 m³ adds 2,000 and would cross it.
const band = (items, extra = []) => { const p = project([prod()].concat(extra)); const r = price(p, Object.assign({ [code]: { sell: 999000 } }, items), { settings: {} }); return { r, b: C.base(r, {}) }; };
const plat = () => A("a", "platform", rect(30, 30, 10, 10), { height: 1 }, IN), plat2 = (items) => { const r = band(items, [plat()]), q = r.r.lines.find((l) => l.key === "el:platform").totalMinor; return Object.assign(r, { q }); };
t("A new item stays out of the commission value by default, so crossing a band changes nothing", () => { const { b, q } = plat2({ "el:platform": { sell: 20 } }); assert.ok(q > 0); assert.strictEqual(b.eligibleMinor, E(999000)); assert.strictEqual(C.calculate(b.eligibleMinor, C.RULE_C3).amountMinor, E(29970)); assert.strictEqual(b.noCommissionMinor, q); });
t("The client still pays for it: it's in the subtotal", () => { const { r, q } = plat2({ "el:platform": { sell: 20 } }); assert.strictEqual(r.subtotal, E(999000) + q); });
t("An administrator including the item adds it to the value, and the existing bands apply", () => { const { b, q } = plat2({ "el:platform": { sell: 20, commission: true } }); assert.strictEqual(b.eligibleMinor, E(999000) + q); assert.ok(!("noCommissionMinor" in b)); assert.ok(b.eligibleMinor > E(1000000)); assert.strictEqual(C.calculate(b.eligibleMinor, C.RULE_C3).rateBp, 500); });
t("Its installation follows the item's setting; delivery stays out either way", () => { const off = plat2({ "el:platform": { sell: 20, install: 1, delivery: 1 } }); assert.strictEqual(off.b.eligibleMinor, E(999000)); const on = plat2({ "el:platform": { sell: 20, install: 1, delivery: 1, commission: true } }), l = on.r.lines.find((x) => x.key === "el:platform#install").totalMinor; assert.strictEqual(on.b.eligibleMinor, E(999000) + on.q + l); });
t("With a 10% discount, the discount on an excluded item doesn't reduce the commission value: hand figure", () => { const p = project([prod(), A("a", "platform", rect(30, 30, 10, 10), { height: 1 }, IN)]); p.pricing.discountPct = 10; const r = price(p, { [code]: { sell: 1000 }, "el:platform": { sell: 10 } }, { settings: {} }), b = C.base(r, {}); assert.strictEqual(b.eligibleMinor, E(900)); });
t("Existing items are untouched: the setting has no effect on a product or an old element", () => { const p = project([prod(), A("s", "rubber", rect(30, 30, 10, 10))]), r = price(p, { [code]: { sell: 1000, commission: false }, "el:rubber": { sell: 10, commission: false } }, { settings: {} }); assert.ok(r.lines.every((l) => !l.noCommission)); assert.strictEqual(C.base(r, {}).eligibleMinor, r.subtotal); });
t("Phase 6 items such as a splash pad are also new items, and stay out too", () => { const p = project([prod(), A("w", "splash-pad", rect(30, 30, 10, 10))]), r = price(p, { [code]: { sell: 1000 }, "el:splash-pad": { sell: 10 } }, { settings: {} }); assert.strictEqual(C.base(r, {}).eligibleMinor, E(1000)); });
t("A surface on a slope is an existing item, so its higher true area does count", () => { const p = project([A("h", "hill", rect(0, 0, 60, 40), { height: 9, run: 20, profile: "straight" }), A("s", "rubber", rect(2, 15, 10, 10))]), r = price(p, { "el:rubber": { sell: 10 } }, { settings: {} }); assert.strictEqual(C.base(r, {}).eligibleMinor, r.subtotal); assert.ok(r.subtotal > E(1000)); });

/* ---------------- margin ---------------- */
const mgn = (costs) => { const p = project([prod()]); return price(p, { [code]: { sell: 1000, install: 100, delivery: 50 } }, { costs }); };
t("Margin now counts installation and delivery costs: 1,150 revenue − 600 − 40 − 20 = 490", () => { const r = mgn({ [code]: 600, [code + "#install"]: 40, [code + "#delivery"]: 20 }); assert.strictEqual(r.margin.costMinor, E(660)); assert.strictEqual(r.margin.marginMinor, E(490)); assert.strictEqual(r.margin.missing, 0); assert.strictEqual(r.serviceCostsMissing, 0); });
t("With those costs blank the figure is as before, and the gap is reported instead of hidden", () => { const r = mgn({ [code]: 600 }); assert.strictEqual(r.margin.costMinor, E(600)); assert.strictEqual(r.serviceCostsMissing, 2); });
t("An entered cost of zero is a cost of zero, not a missing one", () => { assert.strictEqual(mgn({ [code]: 600, [code + "#install"]: 0, [code + "#delivery"]: 0 }).serviceCostsMissing, 0); });
t("Client total and commission don't move when costs do", () => { const a = mgn({ [code]: 600 }), b = mgn({ [code]: 600, [code + "#install"]: 40, [code + "#delivery"]: 20 }); assert.strictEqual(a.total, b.total); assert.strictEqual(C.base(a, {}).eligibleMinor, C.base(b, {}).eligibleMinor); });
t("Someone with no access to costs gets no margin figures at all", () => { const r = mgn(null); assert.strictEqual(r.margin, null); assert.strictEqual(r.serviceCostsMissing, 0); });

/* ---------------- handover ---------------- */
const hoCtx = () => { const c = load(BASE.concat(["terrain", "orders"])); return c; };
const handover = () => { const c = hoCtx(), p = c.DPModel.newProject(); p.site = { poly: rect(0, 0, 80, 60), north: 0 }; p.objects = [prod(), A("s", "rubber", rect(30, 30, 10, 10)), L("f", "fence", [[1, 50], [9, 50]], 0.1), A("a", "platform", rect(50, 30, 10, 10), { height: 1 }, IN), A("c", "custom-area", rect(60, 5, 5, 5), null, { label: "Mosaic" })]; c.DPModel.load(p); c.DPTerrain.measureProject(c.DPModel.S.project); return c.DPOrders.handoverFrom(plain(c.DPModel.S.project), { oid: "O1", ref: "R1", name: "N", client: "C" }); };
t("Engineering's list now has every quoted item, not just products", () => { const keys = plain(handover().items.map((i) => i.key)).sort(); assert.deepStrictEqual(keys, [code, "el:fence", "el:platform", "el:rubber", "obj:c"].sort()); });
t("Engineering's list and its plan carry no money, costs or commission setting", () => { const s = JSON.stringify(handover()); for (const w of ["sell", "unitPrice", "unitMinor", "totalMinor", "\"cost\"", "commission", "pricing"]) assert.ok(!s.includes(w), w); });
t("The on-screen totals of an open project don't travel with a handover", () => { const c = hoCtx(), p = c.DPModel.newProject(); p.site = { poly: rect(0, 0, 80, 60), north: 0 }; p.objects = [prod()]; p._summaryTotal = 123; p._summaryCurrency = "EGP"; p._summaryBase = { totalMinor: 123, eligibleMinor: 123 }; const ho = c.DPOrders.handoverFrom(p, { oid: "O1", ref: "R1", name: "N", client: "C" }), s = JSON.stringify(ho); assert.ok(!s.includes("_summary") && !s.includes("totalMinor")); });
t("The list's measured quantities match the plan's", () => { const ho = handover(); near(ho.items.find((i) => i.key === "el:platform").qty, 100, 0.5); });
t("Manufacturing jobs still take products only, so flooring and terrain don't reach the shop floor or its weights", () => { const src = fs.readFileSync(path.join(APP, "factory.js"), "utf8"); assert.ok(/items\.filter\(\(i\) => i\.qty > 0 && !\/\^\(el\|obj\):\/\.test\(i\.key \|\| ""\)\)/.test(src)); const ho = handover(); const kept = ho.items.filter((i) => i.qty > 0 && !/^(el|obj):/.test(i.key || "")); assert.deepStrictEqual(plain(kept.map((i) => i.key)), [code]); });

console.log(`${n - fail} of ${n} tests passed`.replace(/^(\d+) of \1 tests passed$/, "$1 tests passed"));
if (fail) process.exit(1);
