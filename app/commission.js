/* X FORCE 1.0 — commission engine. Pure functions, no DOM, no storage.
   Money in integer minor units (piastres). Rates in basis points (1% = 100 bp). Nothing is rounded until the final amount.

   Default rule (version C2, 26 Oct 2026 — X FORCE 1.0), contiguous bands on the ELIGIBLE ORDER VALUE:
     below EGP 500,000                0%
     EGP 500,000   – 999,999.99       3%
     EGP 1,000,000 – 2,999,999.99     5%
     EGP 3,000,000 and above          7%
   Every band excludes its upper limit ("below"), so 1,000,000 is 5% and 3,000,000 is 7% — no gap, no overlap.
   CALCULATION BASIS (shown in Admin › Commission):
     WHOLE-ORDER (default for X FORCE 1.0): the rate of the band the whole eligible value falls in applies to the whole value.
       1,200,000 → 5% × 1,200,000 = 60,000.
     MARGINAL (selectable): each band's rate applies only to the part of the value inside that band (like tax brackets).
       1,200,000 → 0 + 3% × 500,000 + 5% × 200,000 = 25,000.
   No commission configuration had been saved on the live system when X FORCE 1.0 was installed, so whole-order is the initial
   default as instructed. An administrator can change the basis at any time by creating a new rule version; existing records
   keep the rule they were calculated with. The legacy 2.1 default (C1, marginal) is kept below for reference. */
(function (root) {
  "use strict";
  const DEFAULT_RULE = {
    id: "C2", label: "Standard sales commission", method: "whole", currency: "EGP", effectiveFrom: "2026-10-26",
    // upTo in major units; null = no upper limit; below:true = the limit itself belongs to the next band
    bands: [{ upTo: 500000, rateBp: 0, below: true }, { upTo: 1000000, rateBp: 300, below: true }, { upTo: 3000000, rateBp: 500, below: true }, { upTo: null, rateBp: 700 }],
    note: "X FORCE 1.0 contiguous bands on the eligible order value (subtotal after discount, excluding VAT, delivery and pass-through charges), whole-order basis.",
  };
  /* 1.4.6 — rule C3, the owner's approved bands (31 Oct 2026): the upper limit of each band now BELONGS to that band.
       below EGP 500,000            0%
       EGP 500,000 – 1,000,000      3%   (1,000,000 exactly → 3%)
       EGP 1,000,000.01 – 3,000,000 5%   (3,000,000 exactly → 5%)
       above EGP 3,000,000          7%
     Same eligible value and whole-order basis as C2. It applies to orders approved from 1.4.6 on; commissions already
     calculated keep the rule stored on their record (C2) — nothing is recalculated silently. */
  const RULE_C3 = { id: "C3", label: "Standard sales commission (1.4.6)", method: "whole", currency: "EGP", effectiveFrom: "2026-11-01",
    bands: [{ upTo: 500000, rateBp: 0, below: true }, { upTo: 1000000, rateBp: 300 }, { upTo: 3000000, rateBp: 500 }, { upTo: null, rateBp: 700 }],
    note: "1.4.6: 3% from EGP 500,000 up to and including 1,000,000; 5% above 1,000,000 up to and including 3,000,000; 7% above 3,000,000. Eligible order value (subtotal after discount, excluding VAT, delivery and pass-through charges), whole-order basis." };
  const LEGACY_C1 = { id: "C1", label: "Standard sales commission (2.1)", method: "marginal", currency: "EGP", effectiveFrom: "2026-10-25",
    bands: [{ upTo: 500000, rateBp: 0, below: true }, { upTo: 1000000, rateBp: 300 }, { upTo: 3000000, rateBp: 500 }, { upTo: null, rateBp: 700 }] };
  const BASIS_LABEL = { whole: "Whole-order tier (one rate on the whole eligible value)", marginal: "Marginal bands (each rate on its own band)" };
  const STATUSES = ["estimated", "calculated", "pending", "returned", "approved", "paid", "cancelled", "reversed"];
  const STATUS_LABEL = { estimated: "Estimated", calculated: "Calculated", pending: "Awaiting approval", returned: "Returned for review", approved: "Approved", paid: "Paid", cancelled: "Cancelled", reversed: "Reversed" };
  const TRIGGERS = {
    approval: "When the order is approved by an administrator",
    deposit: "When the first client payment is recorded",
    full: "When the client has paid the order in full",
    manual: "When an administrator approves the commission manually",
  };

  function validateRule(rule) {
    const errs = [];
    if (!rule || !Array.isArray(rule.bands) || !rule.bands.length) errs.push("At least one band is required.");
    else {
      let prev = 0;
      rule.bands.forEach((b, i) => {
        const last = i === rule.bands.length - 1;
        if (!(Number.isInteger(b.rateBp) && b.rateBp >= 0 && b.rateBp <= 10000)) errs.push(`Band ${i + 1}: rate must be between 0% and 100%.`);
        if (last) { if (b.upTo != null) errs.push("The last band must have no upper limit."); }
        else if (!(isFinite(b.upTo) && b.upTo > prev)) errs.push(`Band ${i + 1}: the upper limit must be greater than ${prev.toLocaleString("en-US")}.`);
        else prev = +b.upTo;
      });
    }
    if (!rule || !["marginal", "whole"].includes(rule.method)) errs.push("Method must be marginal or whole-order.");
    return errs;
  }

  /** calculate(eligibleMinor, rule) → {amountMinor, effectiveBp, breakdown:[{fromMinor,toMinor,rateBp,portionMinor,amountExact}], method, ruleId}
   *  Exact intermediate values: portions are integers (minor units) and each band's amount is kept as portion × rateBp (an integer
   *  in minor·bp); the sum is divided by 10,000 and rounded half-up exactly once. */
  function calculate(eligibleMinor, rule = DEFAULT_RULE) {
    const errs = validateRule(rule); if (errs.length) throw new Error("Invalid commission rule: " + errs.join(" "));
    const v = Math.max(0, Math.round(+eligibleMinor || 0));
    const breakdown = []; let sumMinorBp = 0, from = 0;
    if (rule.method === "whole") {
      let band = rule.bands[rule.bands.length - 1], lo = 0;
      for (const b of rule.bands) { const hi = b.upTo == null ? Infinity : Math.round(b.upTo * 100); if (b.below ? v < hi : v <= hi) { band = b; break; } lo = hi; }
      sumMinorBp = v * band.rateBp;
      breakdown.push({ fromMinor: 0, toMinor: v, rateBp: band.rateBp, portionMinor: v, amountMinorBp: sumMinorBp, band: { fromMinor: lo, toMinor: band.upTo == null ? null : Math.round(band.upTo * 100) } });
    } else {
      for (const b of rule.bands) {
        const hi = b.upTo == null ? Infinity : Math.round(b.upTo * 100);
        if (v > from) { const portion = Math.min(v, hi) - from; const amt = portion * b.rateBp; sumMinorBp += amt;
          breakdown.push({ fromMinor: from, toMinor: from + portion, rateBp: b.rateBp, portionMinor: portion, amountMinorBp: amt }); }
        from = hi; if (from === Infinity || v <= from) break;
      }
    }
    // single rounding, half-up, with integer arithmetic (sumMinorBp is an exact integer below 2^53 for orders under ~EGP 9 trillion)
    const amountMinor = Math.floor((sumMinorBp + 5000) / 10000);
    return { amountMinor, eligibleMinor: v, effectiveBp: v ? (sumMinorBp / v) : 0, rateBp: rule.method === "whole" ? breakdown[0].rateBp : null, breakdown, method: rule.method, ruleId: rule.id };
  }

  /** Commission base from a pricing result (DPPricing.compute):
   *  eligible = (subtotal − pass-through lines) − (discount − the part of the discount that fell on pass-through lines).
   *  Pass-through = derived delivery lines, and extra charges an administrator flagged as pass-through. Tax is never included. */
  function base(pricing, settings = {}) {
    if (!pricing) return null;
    const eligCats = (settings.discountEligible) || {};
    let pass = 0, passInDiscountable = 0;
    for (const l of pricing.lines || []) {
      if (!l.counted) continue;
      const isPass = (l.derived && /#delivery$/.test(l.key)) || (l.kind === "extra" && l.extra && l.extra.passThrough);
      if (!isPass) continue;
      pass += l.totalMinor; if (eligCats[l.cat] !== false) passInDiscountable += l.totalMinor;
    }
    const discountOnPass = pricing.eligible ? Math.round(pricing.discount * passInDiscountable / pricing.eligible) : 0;
    const eligibleMinor = Math.max(0, pricing.subtotal - pass - (pricing.discount - discountOnPass));
    return { currency: pricing.currency, subtotalMinor: pricing.subtotal, discountMinor: pricing.discount, afterDiscountMinor: pricing.afterDiscount, passThroughMinor: pass, discountOnPassMinor: discountOnPass, taxMinor: pricing.tax, totalMinor: pricing.total, eligibleMinor };
  }

  /** Commission currently owed on a record: base amount plus documented adjustments (never retroactive edits). */
  /** 2.2: once an administrator approves an exact amount, that amount (plus documented adjustments) is the commission;
   *  before approval it is the calculated amount plus adjustments (an estimate, not money owed). */
  const total = (rec) => (rec ? ((rec.approvedMinor != null ? rec.approvedMinor : (rec.calculatedMinor != null ? rec.calculatedMinor : rec.amountMinor)) || 0) + (rec.adjustments || []).reduce((a, x) => a + (x.amountMinor || 0), 0) : 0);
  /** Whether a commission record has reached its payable trigger, given the order's payments. */
  function triggerMet(trigger, order) {
    const paid = (order.payments || []).reduce((a, p) => a + (p.amountMinor || 0), 0);
    if (trigger === "approval") return true;
    if (trigger === "deposit") return paid > 0;
    if (trigger === "full") return paid >= (order.totalMinor || 0) && (order.totalMinor || 0) > 0;
    return false; // manual
  }
  const pct = (bp) => (bp / 100).toLocaleString("en-US", { maximumFractionDigits: 3 }) + "%";

  const sameBands = (a, b) => JSON.stringify((a || []).map((x) => [x.upTo, x.rateBp, !!x.below])) === JSON.stringify((b || []).map((x) => [x.upTo, x.rateBp, !!x.below]));
  root.DPCommission = { DEFAULT_RULE, RULE_C3, sameBands, LEGACY_C1, BASIS_LABEL, STATUSES, STATUS_LABEL, TRIGGERS, validateRule, calculate, base, total, triggerMet, pct };
  if (typeof module === "object" && module.exports) module.exports = root.DPCommission;
})(typeof self !== "undefined" ? self : this);
