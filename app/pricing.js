/* Dupedia Site Planner 2.0 — pricing engine. Pure functions, no DOM, no storage.
   Money is computed in integer minor units (piastres/cents) so totals never drift.
   Single source of truth: quantities come from the plan take-off; prices from the admin price book;
   anything else (overrides, exceptions, extra charges, discount) is stored on the project with who/when/why. */
(function (root) {
  "use strict";
  const DISCOUNTS = [0, 5, 10];
  const ROLE_RANK = { viewer: 0, employee: 1, admin: 2 };
  const CAT_ORDER = ["equipment", "landscape", "flooring", "installation", "services", "additional"];
  const CAT_LABEL = { equipment: "Playground equipment", landscape: "Landscape & infrastructure", flooring: "Safety flooring & surfaces", installation: "Installation", services: "Other services", additional: "Additional charges" };
  const UNIT_LABEL = { each: "each", m: "m", m2: "m²", lot: "lot", pct: "%" };

  const toMinor = (v) => Math.round((+v || 0) * 100);
  const fromMinor = (m) => m / 100;
  function fmtMoney(minor, currency, { symbol = true, dp = 2 } = {}) {
    const v = fromMinor(minor || 0), neg = v < 0, s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (neg ? "−" : "") + (symbol && currency ? currency + " " : "") + s;
  }
  const fmtQty = (q, unit) => (unit === "each" ? String(Math.round(q)) : (+q).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  function allowedDiscounts(role, settings) {
    const req = (settings && settings.discountRoles) || { 5: "employee", 10: "employee" };
    return DISCOUNTS.filter((d) => d === 0 || (ROLE_RANK[role] || 0) >= (ROLE_RANK[req[d] || "admin"] || 2));
  }
  const canOverride = (role, settings) => role === "admin" || !!(settings && settings.employeeOverrides);

  /**
   * compute({project, takeoff, pricebook, settings, costs, siteArea, productCount})
   * pricebook: {currency, items:{key:{sell, install, delivery, unit, cat, name, code}}}
   * settings:  {taxPct, taxLabel, discountEligible:{cat:bool}, discountRoles, employeeOverrides}
   */
  function compute({ project, takeoff, pricebook, settings = {}, costs = null, siteArea = 0, productCount = 0 }) {
    const pr = project.pricing || {}, pb = pricebook || { currency: "EGP", items: {} }, items = pb.items || {};
    const currency = pr.currency || pb.currency || "EGP", fxNeeded = currency !== (pb.currency || "EGP");
    const fx = fxNeeded ? (pr.fx && pr.fx.rate > 0 ? +pr.fx.rate : null) : 1;
    const issues = [], lines = [];
    const issue = (sev, msg, key, code) => issues.push({ sev, msg, key, code });
    const conv = (v) => (fx == null ? null : Math.round(toMinor(v) * fx));

    for (const r of takeoff) {
      const base = items[r.key] || null, ov = (pr.overrides || {})[r.key] || null, ex = (pr.exceptions || {})[r.key] || null;
      const custom = r.kind === "custom" ? (pr.customPrices || {})[r.key] : null;
      const planQty = r.qty;
      const qty = ov && ov.qty != null && isFinite(ov.qty) ? +ov.qty : planQty;
      const cat = (base && base.cat) || r.cat;
      let unitMinor = null, status = "priced", source = "price book";
      if (ov && ov.unitPrice != null && isFinite(ov.unitPrice)) { unitMinor = toMinor(ov.unitPrice); status = "override"; source = `override by ${ov.by || "?"}`; }
      else if (custom && custom.unitPrice != null && isFinite(custom.unitPrice)) { unitMinor = toMinor(custom.unitPrice); status = "override"; source = `custom item price by ${custom.by || "?"}`; }
      else if (base && base.sell != null && base.sell !== "" && isFinite(base.sell)) { unitMinor = conv(base.sell); if (unitMinor == null) { status = "unpriced"; source = "exchange rate missing"; } }
      else { status = "unpriced"; source = "no price in price book"; }
      const line = { key: r.key, kind: r.kind, code: r.displayCode || r.code || null, name: r.name, unit: r.unit, cat, qty, planQty, unitMinor, totalMinor: 0, status, source, ids: r.ids, basis: r.basis || null,
        qtyOverridden: !!(ov && ov.qty != null && Math.abs(+ov.qty - planQty) > 1e-9), override: ov, exception: ex, derived: false };
      if (ex) {
        line.status = "exception"; line.exMode = ex.mode;
        line.totalMinor = ex.mode === "included" ? 0 : 0;
        line.counted = ex.mode === "included";
      } else if (unitMinor != null) { line.totalMinor = Math.round(qty * unitMinor); line.counted = true; }
      else { line.counted = false; issue("error", `${line.code ? line.code + " " : ""}${line.name}: ${source}. Enter a price, or record an exception, before publishing.`, r.key, "unpriced"); }
      if (line.qtyOverridden) issue("warning", `${line.code ? line.code + " " : ""}${line.name}: quotation quantity ${fmtQty(qty, r.unit)} differs from the plan (${fmtQty(planQty, r.unit)}).`, r.key, "qty-diff");
      if (status === "override" && !ex) issue("info", `${line.code ? line.code + " " : ""}${line.name}: price overridden (${source}${ov && ov.reason ? ` — ${ov.reason}` : ""}).`, r.key, "override");
      if (qty <= 0 && !ex) issue("warning", `${line.name}: quantity is zero.`, r.key, "zero");
      lines.push(line);
      // derived per-unit installation and delivery from the price book (only when the item itself is counted at a price)
      if (base && !ex && line.counted && line.status !== "unpriced") {
        for (const [field, dcat, label] of [["install", "installation", "Installation"], ["delivery", "services", "Delivery"]]) {
          const v = base[field]; if (v == null || v === "" || !(+v > 0)) continue; const u = conv(v); if (u == null) continue;
          lines.push({ key: r.key + "#" + field, kind: "derived", parent: r.key, code: line.code, name: `${label} — ${r.name}`, unit: r.unit, cat: dcat, qty, planQty: qty, unitMinor: u, totalMinor: Math.round(qty * u), status: "priced", source: "price book", counted: true, derived: true, ids: r.ids });
        }
      }
    }
    if (fxNeeded && fx == null) issue("error", `Project currency ${currency} differs from the price book (${pb.currency}). Enter an exchange rate.`, null, "fx");

    // subtotal of goods before percentage charges
    const sumCats = (cats) => lines.filter((l) => l.counted && cats.includes(l.cat)).reduce((a, l) => a + l.totalMinor, 0);
    for (const x of pr.extras || []) {
      const v = +x.value; if (!isFinite(v)) { issue("error", `Extra charge "${x.label}": invalid value.`, x.id, "extra"); continue; }
      let qty = 1, unit = "lot", unitMinor = 0, basis = null;
      if (x.method === "fixed") unitMinor = toMinor(v);
      else if (x.method === "percent") { const baseCats = x.base === "equipment" ? ["equipment"] : x.base === "goods" ? ["equipment", "landscape", "flooring"] : ["equipment", "landscape", "flooring", "installation", "services"];
        const b = sumCats(baseCats); unitMinor = Math.round(b * v / 100); basis = `${v}% of ${x.base === "equipment" ? "equipment" : x.base === "goods" ? "equipment, landscape & flooring" : "items above"}`; }
      else if (x.method === "perItem") { qty = productCount; unit = "each"; unitMinor = toMinor(v); basis = "per product placed"; }
      else if (x.method === "perM2") { qty = Math.round(siteArea * 100) / 100; unit = "m2"; unitMinor = toMinor(v); basis = "per m² of site"; }
      lines.push({ key: "x:" + x.id, kind: "extra", name: x.label || "Additional charge", unit, cat: x.cat || "additional", qty, planQty: qty, unitMinor, totalMinor: Math.round(qty * unitMinor), status: "priced", source: x.by ? `added by ${x.by}` : "added", counted: true, basis, extra: x });
    }

    const cats = {};
    for (const c of CAT_ORDER) cats[c] = { key: c, label: CAT_LABEL[c], totalMinor: 0, lines: 0 };
    for (const l of lines) { const c = cats[l.cat] || (cats[l.cat] = { key: l.cat, label: l.cat, totalMinor: 0, lines: 0 }); c.lines++; if (l.counted) c.totalMinor += l.totalMinor; }
    const subtotal = Object.values(cats).reduce((a, c) => a + c.totalMinor, 0);
    const elig = (settings.discountEligible) || {};
    const eligible = Object.values(cats).filter((c) => elig[c.key] !== false).reduce((a, c) => a + c.totalMinor, 0);
    let pct = +pr.discountPct || 0;
    if (!DISCOUNTS.includes(pct)) { issue("error", `Discount ${pct}% is not an approved level; it has been ignored.`, null, "discount"); pct = 0; }
    const discount = Math.round(eligible * pct / 100);
    const afterDiscount = subtotal - discount;
    const taxPct = pr.taxEnabled !== false && +settings.taxPct > 0 ? +settings.taxPct : 0;
    const tax = Math.round(afterDiscount * taxPct / 100);
    const total = afterDiscount + tax;
    if (!(+settings.taxPct > 0)) issue("info", "Tax is not configured in Settings, so no tax is added.", null, "tax");

    let margin = null;
    if (costs) {
      let cost = 0, missing = 0;
      for (const l of lines) { if (!l.counted || l.kind === "extra") continue; const k = l.derived ? null : l.key; if (!k) continue;
        const c = costs[k]; if (c == null || c === "" || !isFinite(c)) { missing++; continue; } cost += Math.round(l.qty * (conv(c) || 0)); }
      margin = { costMinor: cost, revenueMinor: afterDiscount, marginMinor: afterDiscount - cost, pct: afterDiscount ? (afterDiscount - cost) / afterDiscount * 100 : 0, missing };
    }
    const blocking = issues.some((i) => i.sev === "error");
    return { currency, fx, lines, cats, subtotal, eligible, discountPct: pct, discount, afterDiscount, taxPct, taxLabel: settings.taxLabel || "VAT", tax, total, issues, blocking, margin };
  }

  root.DPPricing = { compute, toMinor, fromMinor, fmtMoney, fmtQty, allowedDiscounts, canOverride, DISCOUNTS, CAT_ORDER, CAT_LABEL, UNIT_LABEL, ROLE_RANK };
  if (typeof module === "object" && module.exports) module.exports = root.DPPricing;
})(typeof self !== "undefined" ? self : this);
