/* Commission engine tests: the X FORCE 1.0 commission bands at every boundary, both methods, exact rounding, pass-through base. */
const C = require("../../app/commission.js"), PR = require("../../app/pricing.js");
let n = 0, fail = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL - " + m); } else console.log("ok - " + m); };
const E = (egp) => Math.round(egp * 100), egp = (m) => m / 100;
const MARG = Object.assign({}, C.DEFAULT_RULE, { method: "marginal" });
const marg = (v) => egp(C.calculate(E(v), MARG).amountMinor), whole = (v) => egp(C.calculate(E(v), C.DEFAULT_RULE).amountMinor), rate = (v) => C.calculate(E(v), C.DEFAULT_RULE).rateBp;
// X FORCE 1.0 boundaries (contiguous bands, whole-order default). Expected values computed by hand.
const cases = [ // value, rate bp (whole), whole-order expected, marginal expected
  [499999, 0, 0, 0], [500000, 300, 15000, 0], [999999, 300, 29999.97, 14999.97], [1000000, 500, 50000, 15000], [1000001, 500, 50000.05, 15000.05],
  [1200000, 500, 60000, 25000], [2999999, 500, 149999.95, 114999.95], [3000000, 700, 210000, 115000], [3000001, 700, 210000.07, 115000.07]];
for (const [v, bp, w, m] of cases) { ok(rate(v) === bp, `rate at ${v.toLocaleString()} is ${bp / 100}% (got ${rate(v) / 100}%)`); ok(whole(v) === w, `whole-order ${v.toLocaleString()} → ${w} (got ${whole(v)})`); ok(marg(v) === m, `marginal ${v.toLocaleString()} → ${m} (got ${marg(v)})`); }
ok(C.DEFAULT_RULE.method === "whole" && C.DEFAULT_RULE.id === "C2", "X FORCE 1.0 default: rule C2, whole-order basis");
ok(C.DEFAULT_RULE.bands.slice(0, 3).every((b) => b.below), "every bounded band excludes its upper limit (no gap at 1,000,000 or 3,000,000)");
ok(egp(C.calculate(E(1000000), C.LEGACY_C1).amountMinor) === 15000, "legacy 2.1 rule C1 still calculates as before (marginal)");
// breakdown of 1.2M marginal
const b = C.calculate(E(1200000), MARG).breakdown; ok(b.length === 3 && b[1].portionMinor === E(500000) && b[2].portionMinor === E(200000), "1.2M breakdown: 500k@0, 500k@3%, 200k@5%");
// single rounding: 1,000,000.50 → 0.5 × 5% = 0.025 → total 15000.025 → 15000.03 (half-up once)
ok(C.calculate(100000050, MARG).amountMinor === 1500003, "single half-up rounding of the exact sum (marginal)");
ok(C.calculate(99999950).amountMinor === 2999999, "single half-up rounding: 999,999.50 × 3% = 29,999.985 → 29,999.99");
// invalid rules rejected
ok(C.validateRule({ method: "marginal", bands: [{ upTo: 100, rateBp: 100 }, { upTo: 50, rateBp: 200 }, { upTo: null, rateBp: 1 }] }).length > 0, "non-increasing bands rejected");
ok(C.validateRule({ method: "x", bands: [{ upTo: null, rateBp: 1 }] }).length > 0, "unknown method rejected");
// commission base: excludes VAT and delivery, discount pro-rated
const project = { pricing: { discountPct: 10, extras: [{ id: "e1", label: "Customs clearance", method: "fixed", value: 10000, cat: "additional", passThrough: true }] } };
const takeoff = [{ key: "SW-1", kind: "product", name: "Tower", unit: "each", cat: "equipment", qty: 2, ids: [] }];
const pricebook = { currency: "EGP", items: { "SW-1": { sell: 500000, install: 20000, delivery: 15000 } } };
const r = PR.compute({ project, takeoff, pricebook, settings: { taxPct: 14 } });
const cb = C.base(r, {});
// subtotal = 1,000,000 + 40,000 + 30,000 + 10,000 = 1,080,000 ; discount 10% = 108,000 ; pass = 40,000 ; discount on pass = 4,000
ok(r.subtotal === E(1080000) && r.discount === E(108000), "pricing subtotal and discount");
ok(cb.passThroughMinor === E(40000) && cb.discountOnPassMinor === E(4000), "pass-through 40,000 with 4,000 of the discount");
ok(cb.eligibleMinor === E(1080000 - 40000 - 104000), "eligible = 936,000 (no VAT, no delivery, no pass-through)");
ok(cb.eligibleMinor < r.afterDiscount && r.tax > 0, "VAT is excluded from the commission base");
const st = C.triggerMet("full", { totalMinor: 100, payments: [{ amountMinor: 60 }] }) === false && C.triggerMet("full", { totalMinor: 100, payments: [{ amountMinor: 60 }, { amountMinor: 40 }] }) && C.triggerMet("deposit", { payments: [{ amountMinor: 1 }] }) && !C.triggerMet("manual", {});
ok(st, "payable triggers: approval / deposit / full / manual");
ok(C.total({ amountMinor: 1000, adjustments: [{ amountMinor: -300 }] }) === 700, "adjustments are added to, not written over, the amount");
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`); process.exit(fail ? 1 : 0);
