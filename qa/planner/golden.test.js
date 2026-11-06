/* Site Planner golden tests (3D Phase 0). They record what take-off, pricing, commission, validation and the engineering
   handover produce today, so every later 3D phase can prove that existing projects still give the same numbers.

     node qa/planner/golden.test.js            compare with qa/planner/golden.json
     node qa/planner/golden.test.js --update   rewrite golden.json (only for a change you approved, and say why in the commit)

   All prices and costs here are made up: this repository is public, so the real price book must never be copied into it.
   Two existing behaviours are recorded as they are, not as they should be. If you approve fixing them, update the baseline:
     - margin counts installation and delivery revenue but not their cost
     - the handover's items list kept only products. Fixed in Phase 8 with the owner's approval: everything quoted is now listed.
       The baseline file is unchanged, so its products are still compared exactly. commercial.test.js covers the rest. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app"), GOLD = path.join(__dirname, "golden.json");

const ctx = { console, Intl }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "model", "pricing", "commission", "orders"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPPricing: PR, DPCommission: C, DPCat: CAT, DPOrders: O } = ctx;

/* ---------------- made-up price book: every product and every costable element gets a price ---------------- */
function book() {
  const items = {}, costs = {};
  CAT.PRODUCTS.forEach((p, i) => { items[p.code] = { sell: 10000 + i * 1000, install: 500 + i * 10, delivery: i % 3 === 0 ? 250 : "" }; costs[p.code] = 6000 + i * 600; });
  CAT.ELEMENTS.filter((e) => e.costable && e.group !== "custom").forEach((e, i) => { items["el:" + e.id] = { sell: 100 + i * 25 }; if (i % 2 === 0) costs["el:" + e.id] = 60 + i * 15; });
  return { pb: { currency: "EGP", items }, costs };
}
const SETTINGS = { taxPct: 14, taxLabel: "VAT", discountEligible: { installation: false, services: false }, discountRoles: { 5: "employee", 10: "employee" } };

/* ---------------- fixtures ---------------- */
const SITE = (w, h) => ({ poly: [[0, 0], [w, 0], [w, h], [0, h]], north: 0 });
const place = (id, code, x, y, rot = 0) => ({ id, kind: "product", code, x, y, rot });
const rect = (id, type, x, y, w, h) => ({ id, kind: "area", type, poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });

const FIX = {
  empty: () => M.newProject(),
  noSite: () => { const p = M.newProject(); p.objects.push(place("a", "SW-A409", 5, 5)); return p; },
  small: () => { const p = M.newProject(); p.site = SITE(30, 20);
    p.objects.push(place("a", "SW-A409", 6, 6), place("b", "SW-A409", 20, 6, 90), place("c", "SW-L501", 15, 16),
      { id: "f", kind: "line", type: "fence", pts: [[0, 0], [30, 0], [30, 20]], width: 0.08 }, { id: "g", kind: "point", type: "gate", x: 10, y: 0, l: 1.2, w: 0.12, rot: 0 },
      rect("r", "rubber", 2, 3, 8, 6), { id: "t", kind: "point", type: "tree", x: 26, y: 16, l: 4, w: 4 });
    return p; },
  discounted: () => { const p = FIX.small(); p.pricing.discountPct = 10; return p; },
  /* every pricing route: manual price and quantity, exceptions, custom item, every kind of extra charge */
  commercial: () => { const p = FIX.small(); p.pricing.discountPct = 5;
    p.objects.push({ id: "cu", kind: "point", type: "custom-object", x: 3, y: 17, l: 1, w: 1, label: "Client sign", costable: true },
      { id: "x1", kind: "point", type: "bench", x: 12, y: 18, l: 1.8, w: 0.6, excludeFromQuote: true }, { id: "pa", kind: "line", type: "path", pts: [[1, 19], [29, 19]], width: 1.5 });
    p.pricing.overrides = { "SW-L501": { unitPrice: 15000, by: "Test", reason: "Agreed" }, "el:rubber": { qty: 50, by: "Test" } };
    p.pricing.exceptions = { "el:tree": { mode: "included" } };
    p.pricing.customPrices = { "obj:cu": { unitPrice: 2200, by: "Test" } };
    p.pricing.extras = [{ id: "e1", label: "Site survey", method: "fixed", value: 3000, cat: "services" }, { id: "e2", label: "Contingency", method: "percent", value: 5, base: "goods", cat: "additional" },
      { id: "e3", label: "Per item", method: "perItem", value: 100 }, { id: "e4", label: "Per m2", method: "perM2", value: 2 }, { id: "e5", label: "Crane hire", method: "fixed", value: 8000, cat: "services", passThrough: true }];
    return p; },
  foreignCurrency: () => { const p = FIX.small(); p.pricing.currency = "USD"; p.pricing.fx = { rate: 0.02 }; return p; },
  missingFx: () => { const p = FIX.small(); p.pricing.currency = "USD"; return p; },
  taxOff: () => { const p = FIX.small(); p.pricing.taxEnabled = false; return p; },
  /* validation paths: overlap, outside the site, inside a zone, no-build area, unknown items */
  conflicts: () => { const p = M.newProject(); p.site = SITE(40, 30);
    p.objects.push(place("a", "SW-E101", 12, 12), place("b", "SW-E103", 14, 13), place("c", "SW-A409", 39, 29), place("u", "SW-NOPE", 5, 5), { id: "v", kind: "point", type: "nope", x: 6, y: 6, l: 1, w: 1 },
      rect("nb", "restricted", 20, 20, 8, 8), place("d", "SW-L501", 24, 24), { id: "w", kind: "line", type: "wall", pts: [[10, 0], [10, 30]], width: 0.25 }, { id: "pg", kind: "point", type: "pergola", x: 12, y: 12, l: 4, w: 4, rot: 0 });
    return p; },
  /* every element in the library at once */
  allElements: () => { const p = M.newProject(); p.site = SITE(200, 200);
    CAT.ELEMENTS.filter((e) => e.group !== "terrain" && !e.added3d).forEach((e, i) => { const x = 5 + (i % 9) * 20, y = 5 + Math.floor(i / 9) * 20, id = "el" + i;
      if (e.kind === "point") p.objects.push({ id, kind: "point", type: e.id, x, y, l: e.l || e.d || 1, w: e.w || e.d || 1, rot: 0 });
      else if (e.kind === "line") p.objects.push({ id, kind: "line", type: e.id, pts: [[x, y], [x + 10, y], [x + 10, y + 5]], width: e.width });
      else p.objects.push(rect(id, e.id, x, y, 10, 6)); });
    return p; },
  /* one of every placeable product, rotated */
  allProducts: () => { const p = M.newProject(); p.site = SITE(400, 400);
    CAT.PRODUCTS.filter((x) => x.dims).forEach((x, i) => p.objects.push(place("p" + i, x.code, 25 + (i % 8) * 45, 25 + Math.floor(i / 8) * 45, (i * 15) % 360)));
    return p; },
  /* quotes on each side of the commission bands */
  commissionBands: () => { const p = M.newProject(); p.site = SITE(100, 100); p.objects.push(rect("r", "rubber", 0, 0, 10, 10)); p.pricing.overrides = { "el:rubber": { unitPrice: 9990, by: "Test" } }; return p; },
};

/* ---------------- what gets recorded ---------------- */
const num = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
const clean = (v) => JSON.parse(JSON.stringify(v, (k, x) => num(x)));
function snapshot(make) {
  const { pb, costs } = book(), project = JSON.parse(JSON.stringify(make()));
  M.load(project); const p = M.S.project;
  const takeoff = M.takeoff(p), met = M.metrics(p), val = M.validate(p);
  const pricing = PR.compute({ project: p, takeoff, pricebook: pb, settings: SETTINGS, costs, siteArea: met.siteArea, productCount: met.products });
  const base = C.base(pricing, SETTINGS);
  const rules = Object.fromEntries([C.DEFAULT_RULE, C.RULE_C3].map((r) => [r.id, C.calculate(base.eligibleMinor, r).amountMinor]));
  const ho = O.handoverFrom(JSON.parse(JSON.stringify(p)), { oid: "O1", ref: "R1", name: "N", client: "C" }); delete ho.at;
  return clean({
    takeoff: takeoff.map((r) => ({ key: r.key, kind: r.kind, unit: r.unit, qty: r.qty, cat: r.cat, n: r.ids.length })),
    pricing: { lines: pricing.lines.map((l) => ({ key: l.key, cat: l.cat, qty: l.qty, unit: l.unitMinor, total: l.totalMinor, status: l.status, counted: !!l.counted })),
      cats: Object.fromEntries(Object.values(pricing.cats).map((c) => [c.key, c.totalMinor])), subtotal: pricing.subtotal, eligible: pricing.eligible, discount: pricing.discount, afterDiscount: pricing.afterDiscount,
      tax: pricing.tax, total: pricing.total, blocking: pricing.blocking, issues: pricing.issues.map((i) => i.sev + ":" + i.code), margin: pricing.margin },
    commission: { base, rules },
    metrics: { siteArea: met.siteArea, perimeter: met.perimeter, products: met.products, productTypes: met.productTypes, footArea: met.footArea, zoneArea: met.zoneArea, allocated: met.allocated, usable: met.usable, blocked: met.blocked, flooring: met.flooring, objects: met.objects },
    validation: { counts: val.counts, codes: val.issues.map((i) => i.sev + ":" + i.code).sort() },
    handover: { items: ho.items.filter((i) => !/^(el|obj):/.test(i.key)), keys: Object.keys(ho).sort(), projectKeys: Object.keys(ho.project).sort(), objects: ho.project.objects.length },
  });
}

/* ---------------- run ---------------- */
const update = process.argv.includes("--update");
const now = Object.fromEntries(Object.keys(FIX).map((k) => [k, snapshot(FIX[k])]));
let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + String(e.message).split("\n").slice(0, 12).join("\n     ")); } };

if (update) { fs.writeFileSync(GOLD, JSON.stringify(now, null, 1) + "\n"); console.log(`Baseline written for ${Object.keys(now).length} projects.`); }
const gold = JSON.parse(fs.readFileSync(GOLD, "utf8"));
for (const k of Object.keys(FIX)) t(`existing behaviour unchanged: ${k}`, () => assert.deepStrictEqual(now[k], gold[k]));
t("no fixture was dropped from the baseline", () => assert.deepStrictEqual(Object.keys(gold).sort(), Object.keys(FIX).sort()));

/* The rule every 3D phase relies on: optional 3D fields never change a quantity, a price, a commission or a check. */
const with3D = (make) => () => { const p = make(); p.objects.forEach((o, i) => { o.z = (i % 4) * 0.5; }); p.views3d = [{ name: "Entrance", pos: [1, 2, 3], target: [0, 0, 0], fov: 40 }]; return p; };
for (const k of ["small", "commercial", "conflicts"]) t(`optional 3D fields leave the numbers alone: ${k}`, () => {
  const a = snapshot(with3D(FIX[k])), b = gold[k];
  assert.deepStrictEqual({ takeoff: a.takeoff, pricing: a.pricing, commission: a.commission, metrics: a.metrics, validation: a.validation, items: a.handover.items }, { takeoff: b.takeoff, pricing: b.pricing, commission: b.commission, metrics: b.metrics, validation: b.validation, items: b.handover.items });
});
t("optional 3D fields pass the project file check and survive saving, undo and copying", () => {
  M.load(with3D(FIX.small)()); assert.strictEqual(M.checkProject(JSON.parse(JSON.stringify(M.projectFile(false)))), "v2");
  const a = M.S.project.objects[1]; assert.strictEqual(a.z, 0.5); assert.strictEqual(M.cloneObj(a, 1, 1).z, 0.5);
  M.resetHistory(); a.z = 2; M.commit("raise"); a.z = 3; M.commit("raise more"); M.undo(); assert.strictEqual(M.S.project.objects[1].z, 2); M.redo(); assert.strictEqual(M.S.project.objects[1].z, 3);
  assert.strictEqual(JSON.parse(JSON.stringify(M.S.project)).views3d[0].name, "Entrance");
});
t("a new object kind is still refused: 3D must keep using product, point, line and area", () => {
  M.load(FIX.small()); const f = JSON.parse(JSON.stringify(M.projectFile(false))); f.project.objects.push({ id: "t", kind: "terrain", x: 1, y: 1 }); assert.throws(() => M.checkProject(f), /invalid object/);
});
t("every pricing category is one the quote screen shows", () => {
  for (const k of Object.keys(FIX)) for (const l of now[k].pricing.lines) assert.ok(PR.CAT_ORDER.includes(l.cat), `${k}: ${l.key} is in "${l.cat}"`);
  for (const e of CAT.ELEMENTS) assert.ok(PR.CAT_ORDER.includes(e.cat), `element ${e.id} is in "${e.cat}"`);
});
t("the shown categories add up to the subtotal", () => { for (const k of Object.keys(FIX)) { const p = now[k].pricing; assert.strictEqual(PR.CAT_ORDER.reduce((a, c) => a + (p.cats[c] || 0), 0), p.subtotal, k); } });
t("the handover carries no money", () => {
  const { pb } = book(); assert.ok(pb); M.load(FIX.commercial()); const ho = JSON.stringify(O.handoverFrom(JSON.parse(JSON.stringify(M.S.project)), { oid: "O1", ref: "R1", name: "N", client: "C" }));
  for (const w of ["unitPrice", "pricing", "customPrices", "discountPct", "overrides"]) assert.ok(!ho.includes(w), w);
});
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
