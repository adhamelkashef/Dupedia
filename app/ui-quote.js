/* Dupedia Site Planner 2.0 — quotation (pricing, overrides, exceptions, extra charges, discount, tax, currency) and review (plan vs quote, checks, issue). */
/* global DPSales, DPLeads, DPCommission, DPStore, DPUI, DPModel, DPCat, DPPricing, DPStore, DPIO, DPCanvas, DPProposal */
(function (root) {
  "use strict";
  const U = DPUI, M = DPModel, S = M.S, { $, $$, esc, App } = U, PR = DPPricing;
  const ro = () => !U.canWrite();
  const pb = () => (App.sample && App.samplePrices ? App.samplePrices : App.config.pricebook);

  function setDiscount(pct) {
    if (ro()) return; const allowed = PR.allowedDiscounts(U.role(), App.config.settings);
    if (!allowed.includes(pct)) return U.toast(`A ${pct}% discount needs administrator approval.`, { err: true });
    const old = S.project.pricing.discountPct || 0; if (old === pct) return;
    S.project.pricing.discountPct = pct; M.commit("Discount", { audit: { action: "Discount changed", detail: `${old}% → ${pct}%` } });
    U.pricing(); if (App.view === "quote") renderQuote(); else if (DPUI.refreshPlan) DPUI.refreshPlan(); U.scheduleAutosave();
  }

  /* ---------------- quotation ---------------- */
  function renderQuote() {
    const r = U.pricing(), pr = S.project.pricing, w = !ro(), canOv = PR.canOverride(U.role(), App.config.settings) && w;
    const allowed = PR.allowedDiscounts(U.role(), App.config.settings), book = pb();
    const lines = r.lines; const byCat = {}; lines.forEach((l) => (byCat[l.cat] = byCat[l.cat] || []).push(l));
    const cur = r.currency;
    const row = (l) => {
      const unpriced = l.status === "unpriced", ex = l.status === "exception";
      const unitCell = l.kind === "derived" || l.kind === "extra" ? `<span class="num">${l.unitMinor == null ? "—" : esc(PR.fmtMoney(l.unitMinor, cur, { symbol: false }))}</span>`
        : canOv && !ex ? `<input class="in sm num" data-up="${esc(l.key)}" type="number" min="0" step="0.01" value="${l.unitMinor == null ? "" : (l.unitMinor / 100).toFixed(2)}" placeholder="price" aria-label="Unit price for ${esc(l.name)}">`
        : `<span class="num">${l.unitMinor == null ? '<span class="pill err">No price</span>' : esc(PR.fmtMoney(l.unitMinor, cur, { symbol: false }))}</span>`;
      const qtyCell = l.kind === "derived" || l.kind === "extra" || !canOv || ex ? `${esc(PR.fmtQty(l.qty, l.unit))}` : `<input class="in sm num qin" data-qty="${esc(l.key)}" type="number" min="0" step="${l.unit === "each" ? 1 : 0.01}" value="${l.unit === "each" ? Math.round(l.qty) : l.qty}" aria-label="Quantity">`;
      const statusCell = ex ? `<span class="pill ${l.exMode === "included" ? "ok" : "info"}">${l.exMode === "included" ? "Included" : l.exMode === "separate" ? "Priced separately" : "Excluded"}</span>`
        : unpriced ? `<span class="pill err">Not priced</span>` : l.status === "override" ? `<span class="pill warn" title="${esc(l.source)}">Manual price</span>` : l.qtyOverridden ? `<span class="pill warn">Qty differs from plan</span>` : "";
      const acts = l.kind === "derived" || l.kind === "extra" ? (l.kind === "extra" && w ? `<button class="btn ghost xs" data-xdel="${esc(l.extra.id)}">Remove</button>` : "")
        : w ? `${(l.override && canOv) ? `<button class="btn ghost xs" data-clr="${esc(l.key)}">Clear manual</button>` : ""}${ex ? `<button class="btn ghost xs" data-unex="${esc(l.key)}">Undo exception</button>` : `<button class="btn ghost xs" data-ex="${esc(l.key)}">${unpriced ? "Resolve…" : "Exception…"}</button>`}` : "";
      return `<tr class="${unpriced ? "unpriced" : ""} ${l.status === "override" ? "override" : ""}"><td><span class="code">${esc(l.code || "")}</span></td><td>${esc(l.name)}${l.basis ? `<div class="sub">${esc(l.basis)}</div>` : ""}${l.override && l.override.reason ? `<div class="sub">Manual: ${esc(l.override.reason)} (${esc(l.override.by || "")})</div>` : ""}${ex && l.exception.reason ? `<div class="sub">${esc(l.exception.reason)} (${esc(l.exception.by || "")})</div>` : ""}</td>
        <td class="r">${qtyCell}</td><td>${esc(PR.UNIT_LABEL[l.unit] || l.unit)}</td><td class="r">${unitCell}</td><td class="r"><b>${l.counted ? esc(PR.fmtMoney(l.totalMinor, cur, { symbol: false })) : "—"}</b></td><td>${statusCell}</td><td style="white-space:nowrap" class="rowact">${acts}</td></tr>`;
    };
    const charges = (App.config.settings.charges || []);
    $("#view-quote").innerHTML = `<div class="page">
      <div class="phead"><div><span class="eyebrow">Step 3 · Quotation</span><h1>${esc(S.project.meta.name)}</h1><p class="lead small">Quantities come from the plan; prices from the ${App.sample ? "<b>illustrative sample price list</b>" : "Dupedia price book"}. Every manual change is recorded with your name.</p></div>
        <div class="row"><button class="btn ghost" id="q-plan">← Back to the plan</button><button class="btn ghost" id="q-csv">Export CSV</button><button class="btn ghost" id="q-pdf">Printable quotation (PDF)</button><button class="btn lime" id="q-next">Next: Review &amp; Submit →</button></div></div>
      ${App.sample ? `<div class="note warn">Sample project: prices are illustrative only and are not Dupedia prices.</div>` : ""}
      ${!Object.keys(book.items || {}).length && !App.sample ? `<div class="note err">The price book is empty, so nothing is priced. ${U.isAdmin() ? "Add prices in Admin › Price book." : "Ask an administrator to fill in the price book."}</div>` : ""}
      <div class="qgrid"><div class="card" style="padding:0;overflow:hidden"><div class="tablewrap"><table class="qtable"><thead><tr><th>Code</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit price (${esc(cur)})</th><th class="r">Total (${esc(cur)})</th><th>Status</th><th></th></tr></thead><tbody>
        ${PR.CAT_ORDER.filter((c) => byCat[c]).map((c) => `<tr class="cat"><td colspan="5">${esc(PR.CAT_LABEL[c])}</td><td class="r">${esc(PR.fmtMoney(r.cats[c].totalMinor, cur, { symbol: false }))}</td><td colspan="2"></td></tr>${byCat[c].map(row).join("")}`).join("") || `<tr><td colspan="8"><div class="empty small">Nothing to price yet. Place products and elements on the plan.</div></td></tr>`}
      </tbody></table></div>
      <div class="stack" style="padding:14px;border-top:1px solid var(--line)"><div class="row between"><h3>Additional charges</h3>
        ${w ? `<div class="row">${charges.length ? `<select class="in sm" id="q-chg" style="width:auto"><option value="">Add a standard charge…</option>${charges.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("")}</select>` : ""}${canOv ? `<button class="btn ghost sm" id="q-xadd">Custom charge…</button>` : ""}</div>` : ""}</div>
        <p class="small muted">${charges.length ? "Standard charges are set by administrators." : "No standard charges configured yet (Admin › Commercial)."} ${canOv ? "" : "Custom charges need override permission."}</p></div></div>
      <aside class="summary">
        <div class="card stack"><h3>Summary</h3>
          <div class="discount stack"><span class="lbl">Discount</span><div class="seg" role="group" aria-label="Discount">${[0, 5, 10].map((p) => `<button type="button" data-dpct="${p}" class="${r.discountPct === p ? "is-on" : ""}" ${allowed.includes(p) && w ? "" : "disabled"} title="${allowed.includes(p) ? "" : "Needs administrator approval"}">${p ? p + "%" : "None"}</button>`).join("")}</div>
            <span class="tiny muted">Applied once, to the pre-tax subtotal of eligible categories.</span></div>
          <div class="sumrows">${PR.CAT_ORDER.filter((c) => r.cats[c] && r.cats[c].lines).map((c) => `<div class="r"><span>${esc(PR.CAT_LABEL[c])}</span><span>${esc(PR.fmtMoney(r.cats[c].totalMinor, cur, { symbol: false }))}</span></div>`).join("")}
            <div class="r" style="border-top:1px solid var(--line);padding-top:6px"><span>Subtotal before discount</span><b>${esc(PR.fmtMoney(r.subtotal, cur))}</b></div>
            <div class="r disc"><span>Discount ${r.discountPct}%${r.eligible !== r.subtotal ? ` <span class="tiny">(on ${esc(PR.fmtMoney(r.eligible, cur, { symbol: false }))})</span>` : ""}</span><span>− ${esc(PR.fmtMoney(r.discount, cur, { symbol: false }))}</span></div>
            <div class="r"><span>Subtotal after discount</span><span>${esc(PR.fmtMoney(r.afterDiscount, cur, { symbol: false }))}</span></div>
            <div class="r"><span>${r.taxPct ? `${esc(r.taxLabel)} ${r.taxPct}%` : "Tax"}</span><span>${r.taxPct ? esc(PR.fmtMoney(r.tax, cur, { symbol: false })) : '<span class="muted">not configured</span>'}</span></div>
            <div class="r big"><span>Total</span><span>${esc(PR.fmtMoney(r.total, cur))}</span></div></div>
          ${+App.config.settings.taxPct > 0 ? `<label class="check small"><input type="checkbox" id="q-tax" ${pr.taxEnabled !== false ? "checked" : ""} ${w ? "" : "disabled"}> Apply ${esc(App.config.settings.taxLabel)} to this project</label>` : ""}
        </div>
        <div class="card stack"><h4>Currency</h4><div class="grid2"><label class="field"><span>Project currency</span><select class="in sm" id="q-cur" ${w ? "" : "disabled"}>${["EGP", "USD", "EUR", "SAR", "AED", "QAR", "KWD", "GBP"].map((c) => `<option${c === cur ? " selected" : ""}>${c}</option>`).join("")}</select></label>
          ${cur !== book.currency ? `<label class="field"><span>1 ${esc(book.currency)} =</span><div class="unit"><input class="in sm num" id="q-fx" type="number" step="any" min="0" value="${pr.fx && pr.fx.rate || ""}" ${w ? "" : "disabled"}><em>${esc(cur)}</em></div></label>` : `<div class="field"><span class="lbl">Price book</span><span class="small">${esc(book.currency)}</span></div>`}</div>
          ${cur !== book.currency ? `<p class="tiny muted">Price book prices are converted at this rate${pr.fx && pr.fx.by ? ` (set by ${esc(pr.fx.by)})` : ""}. Manual prices are entered in ${esc(cur)}.</p>` : ""}</div>
        ${r.margin ? `<div class="card stack" style="border-color:var(--fg)"><div class="row between"><h4>Margin</h4><span class="pill dark">Administrators only</span></div><div class="sumrows"><div class="r"><span>Revenue after discount</span><span>${esc(PR.fmtMoney(r.margin.revenueMinor, cur, { symbol: false }))}</span></div><div class="r"><span>Cost</span><span>${esc(PR.fmtMoney(r.margin.costMinor, cur, { symbol: false }))}</span></div><div class="r"><b>Gross margin</b><b>${esc(PR.fmtMoney(r.margin.marginMinor, cur, { symbol: false }))} · ${r.margin.pct.toFixed(1)}%</b></div></div>${r.margin.missing ? `<p class="tiny muted">${r.margin.missing} lines have no cost price, so margin is overstated.</p>` : ""}<p class="tiny muted">Never printed on client documents.</p></div>` : ""}
        <div class="card stack"><h4>Open points (${r.issues.filter((i) => i.sev !== "info").length})</h4><div class="issues">${r.issues.map((i) => `<div class="iss ${i.sev}"><i></i><span>${esc(i.msg)}</span></div>`).join("") || `<div class="note ok small">Nothing open.</div>`}</div></div>
      </aside></div></div>`;
    const V = $("#view-quote");
    $("#q-plan").onclick = () => U.go("plan"); $("#q-next").onclick = () => U.go("review");
    $("#q-csv").onclick = () => U.downloadOut(DPIO.exportQuoteCsv(U.pricing()), "Quotation");
    $("#q-pdf").onclick = async () => { const b = U.busy("Building the quotation…"); try { const out = await DPProposal.quotation(); b.done(); U.downloadOut(out, "Quotation"); } catch (e) { b.done(); U.toast(e.message, { err: true }); } };
    $$("[data-dpct]", V).forEach((b) => (b.onclick = () => setDiscount(+b.dataset.dpct)));
    const tx = $("#q-tax"); if (tx) tx.onchange = () => { pr.taxEnabled = tx.checked; M.commit("Tax", { audit: { action: tx.checked ? "Tax applied" : "Tax not applied", detail: "" } }); renderQuote(); U.scheduleAutosave(); };
    $("#q-cur").onchange = (e) => { const old = r.currency; pr.currency = e.target.value; if (pr.currency === book.currency) pr.fx = null; M.commit("Currency", { audit: { action: "Currency changed", detail: `${old} → ${pr.currency}` } }); renderQuote(); U.scheduleAutosave(); };
    const fx = $("#q-fx"); if (fx) fx.onchange = () => { const v = +fx.value; pr.fx = v > 0 ? { rate: v, base: book.currency, by: U.userInfo().name || "", at: new Date().toISOString() } : null; M.commit("Exchange rate", { audit: { action: "Exchange rate set", detail: `1 ${book.currency} = ${v} ${pr.currency}` } }); renderQuote(); U.scheduleAutosave(); };
    $$("[data-up]", V).forEach((inp) => (inp.onchange = () => manual(inp.dataset.up, "unitPrice", inp.value)));
    $$("[data-qty]", V).forEach((inp) => (inp.onchange = () => manual(inp.dataset.qty, "qty", inp.value)));
    $$("[data-clr]", V).forEach((b) => (b.onclick = () => { delete pr.overrides[b.dataset.clr]; M.commit("Clear manual", { audit: { action: "Manual price/qty cleared", detail: b.dataset.clr } }); renderQuote(); U.scheduleAutosave(); }));
    $$("[data-ex]", V).forEach((b) => (b.onclick = () => exception(b.dataset.ex)));
    $$("[data-unex]", V).forEach((b) => (b.onclick = () => { delete pr.exceptions[b.dataset.unex]; M.commit("Undo exception", { audit: { action: "Exception removed", detail: b.dataset.unex } }); renderQuote(); U.scheduleAutosave(); }));
    $$("[data-xdel]", V).forEach((b) => (b.onclick = () => { const x = pr.extras.find((e) => e.id === b.dataset.xdel); pr.extras = pr.extras.filter((e) => e.id !== b.dataset.xdel); M.commit("Remove charge", { audit: { action: "Charge removed", detail: x ? x.label : "" } }); renderQuote(); U.scheduleAutosave(); }));
    const chg = $("#q-chg"); if (chg) chg.onchange = () => { const c = charges.find((x) => x.id === chg.value); if (!c) return; pr.extras = (pr.extras || []).concat([Object.assign({}, c, { id: M.uid("x"), std: c.id, by: U.userInfo().name || "" })]); M.commit("Add charge", { audit: { action: "Charge added", detail: c.label } }); renderQuote(); U.scheduleAutosave(); };
    const xa = $("#q-xadd"); if (xa) xa.onclick = customCharge;
  }
  async function manual(key, field, raw) {
    const pr = S.project.pricing, line = App.pricing.lines.find((l) => l.key === key); if (!line) return;
    const v = raw === "" ? null : +raw;
    if (v != null && !(v >= 0)) { U.toast("Enter a value of zero or more.", { err: true }); return renderQuote(); }
    const cur = pr.overrides[key] || {};
    if (field === "qty" && v != null && Math.abs(v - line.planQty) < 1e-9) { delete cur.qty; }
    else if (field === "unitPrice" && v != null && line.status !== "override") { const base = pb().items[key]; if (base && base.sell != null && base.sell !== "" && Math.abs(DPPricing.toMinor(base.sell) - DPPricing.toMinor(v)) === 0 && pr.currency === pb().currency) { return renderQuote(); } }
    if (v == null) delete cur[field];
    else {
      const r = await U.form(field === "qty" ? "Change the quantity" : "Set a manual price", [{ id: "reason", label: "Reason (recorded in the change log)", required: true, placeholder: field === "qty" ? "e.g. client supplies 2 benches" : "e.g. negotiated price, supplier quote 12 Oct" }],
        { intro: `${esc(line.name)}: ${field === "qty" ? `plan quantity ${DPPricing.fmtQty(line.planQty, line.unit)} → ${DPPricing.fmtQty(v, line.unit)}` : `unit price → ${DPPricing.fmtMoney(DPPricing.toMinor(v), App.pricing.currency)}`}. The change is shown as manual in the quotation.`, submit: "Apply" });
      if (!r) return renderQuote();
      cur[field] = v; cur.reason = r.reason; }
    cur.by = U.userInfo().name || "local user"; cur.at = new Date().toISOString();
    if (cur.qty == null && cur.unitPrice == null) delete pr.overrides[key]; else pr.overrides[key] = cur;
    M.commit("Manual " + field, { audit: { action: field === "qty" ? "Quantity changed" : "Price overridden", detail: `${line.code || ""} ${line.name}: ${v == null ? "cleared" : v}${cur.reason ? " — " + cur.reason : ""}` } });
    renderQuote(); U.scheduleAutosave();
  }
  async function exception(key) {
    const line = App.pricing.lines.find((l) => l.key === key); if (!line) return;
    const canFree = PR.canOverride(U.role(), App.config.settings);
    const r = await U.form("Record an exception", [{ id: "mode", label: "How this item is handled", type: "select", value: "separate", options: [{ value: "separate", label: "Priced separately (not in this total)" }, { value: "excluded", label: "Excluded from this proposal" }].concat(canFree ? [{ value: "included", label: "Included at no charge" }] : []) },
      { id: "reason", label: "Reason (recorded in the change log)", required: true }], { intro: `${esc(line.name)}. The item stays on the plan and the proposal shows how it is handled.${canFree ? "" : " Including items at no charge needs administrator permission."}`, submit: "Record exception" });
    if (!r) return;
    S.project.pricing.exceptions[key] = { mode: r.mode, reason: r.reason, by: U.userInfo().name || "local user", at: new Date().toISOString() };
    M.commit("Exception", { audit: { action: "Exception recorded", detail: `${line.code || ""} ${line.name}: ${r.mode} — ${r.reason}` } }); renderQuote(); U.scheduleAutosave();
  }
  async function customCharge() {
    const r = await U.form("Add a custom charge", [{ id: "label", label: "Description", required: true, placeholder: "e.g. Night installation surcharge" },
      { id: "cat", label: "Category", type: "select", value: "services", options: ["installation", "services", "additional"].map((c) => ({ value: c, label: PR.CAT_LABEL[c] })) },
      { id: "method", label: "Calculation", type: "select", value: "fixed", options: [{ value: "fixed", label: "Fixed amount" }, { value: "percent", label: "Percentage of equipment" }, { value: "perItem", label: "Per product placed" }, { value: "perM2", label: "Per m² of site" }] },
      { id: "value", label: "Amount or percentage", type: "number", step: "any", min: 0, required: true },
      { id: "pass", label: "Pass-through cost paid on the client's behalf (excluded from the commission value)", type: "check", value: false }], { submit: "Add charge" });
    if (!r) return; const x = { id: M.uid("x"), label: r.label, cat: r.cat, method: r.method, value: r.value, base: r.method === "percent" ? "equipment" : undefined, by: U.userInfo().name || "", custom: true, passThrough: !!r.pass };
    S.project.pricing.extras = (S.project.pricing.extras || []).concat([x]); M.commit("Add charge", { audit: { action: "Custom charge added", detail: `${r.label}: ${r.method} ${r.value}` } }); renderQuote(); U.scheduleAutosave();
  }

  /* ---------------- review ---------------- */
  function checks() {
    const v = M.validate(), r = U.pricing(), m = S.project.meta, rv = S.project.review || {}, prop = S.project.proposal;
    const terms = ["payment", "validity", "warranty", "delivery"].filter((k) => !prop[k] || /\[to be completed/i.test(prop[k]));
    const list = [
      { k: "details", ok: !!(m.name && m.client && m.date && m.preparedBy), label: "Project details complete", detail: !(m.name && m.client && m.date && m.preparedBy) ? `Missing: ${[!m.client && "client", !m.preparedBy && "prepared by", !m.date && "date"].filter(Boolean).join(", ")}` : `${m.client} · ${m.ref || "no reference"}`, go: "setup", block: true },
      { k: "site", ok: !!S.project.site, label: "Site boundary defined", detail: S.project.site ? `${M.metrics().siteArea.toFixed(1)} m²` : "Define the site in Site & design", go: "plan", block: true },
      { k: "scale", ok: DPIO.scaleVerified(), label: "Drawing scale verified", detail: DPIO.scaleSourceText(), go: "plan", block: false },
      { k: "geo", ok: v.counts.error === 0 || !!(rv.ackErrors && rv.ackErrors.count === v.counts.error), warn: v.counts.error > 0 && rv.ackErrors && rv.ackErrors.count === v.counts.error, label: "No geometry errors", detail: v.counts.error ? (rv.ackErrors && rv.ackErrors.count === v.counts.error ? `${v.counts.error} errors acknowledged by ${rv.ackErrors.by}: ${rv.ackErrors.reason}` : `${v.counts.error} errors: overlaps, items outside the site or on restricted ground`) : "Footprints, zones, boundary and restricted areas checked", go: "plan", block: true, ack: v.counts.error ? "errors" : null },
      { k: "warn", ok: v.counts.warning === 0 || !!(rv.ackWarnings && rv.ackWarnings.count === v.counts.warning), warn: v.counts.warning > 0, label: "Warnings reviewed", detail: v.counts.warning ? `${v.counts.warning} warnings${rv.ackWarnings && rv.ackWarnings.count === v.counts.warning ? ` · reviewed by ${rv.ackWarnings.by}` : ""}` : "None", go: "plan", block: false, ack: v.counts.warning ? "warnings" : null },
      { k: "price", ok: !r.blocking, label: "Every item priced or resolved", detail: r.blocking ? r.issues.filter((i) => i.sev === "error").map((i) => i.msg).slice(0, 3).join(" · ") : `${r.lines.length} lines · total ${DPPricing.fmtMoney(r.total, r.currency)}`, go: "quote", block: true },
      { k: "terms", ok: terms.length === 0, warn: terms.length > 0, label: "Commercial terms completed", detail: terms.length ? `Still to complete: ${terms.join(", ")}` : "Payment, validity, warranty and delivery filled in", go: "proposal", block: false },
    ];
    return { list, blocking: list.some((c) => c.block && !c.ok), v, r };
  }
  function renderReview() {
    const { list, blocking, r } = checks(), w = !ro(), to = M.takeoff();
    const st = S.project.meta.status || "draft", locked = ["submitted", "won", "accepted", "cancelled"].includes(st);
    $("#view-review").innerHTML = `<div class="page">
      <div class="phead"><div><span class="eyebrow">Step 4 · Review &amp; Submit</span><h1>Ready to <em>issue</em>?</h1><p class="lead small">Check the plan against the quotation, clear anything that blocks it, then submit. Submitting issues the quotation — it gets its reference and appears in My Orders &amp; Proposals. The PDF is optional and can be downloaded any time.</p></div>
        <div class="row"><button class="btn ghost" id="r-quote">← Quotation</button><button class="btn ghost" id="r-next">Proposal PDF (optional)</button>${locked || App.sample ? "" : `<button class="btn lime" id="r-issue-top" ${blocking || !w ? "disabled" : ""}>${st === "issued" ? "Submit new revision" : "Submit &amp; issue quotation"}</button>`}</div></div>
      <div class="qgrid"><div class="stack">
        <div class="checklist">${list.map((c) => `<div class="ck ${c.ok ? (c.warn ? "warn" : "ok") : c.block ? "bad" : "warn"}"><span class="s">${c.ok ? (c.warn ? "!" : "✓") : c.block ? "✕" : "!"}</span><div><b>${esc(c.label)}</b><div class="small muted">${esc(c.detail)}</div></div>
          <div class="row">${c.ack && w && !(c.ok && !c.warn) ? `<button class="btn ghost xs" data-ack="${c.ack}">Acknowledge…</button>` : ""}<button class="btn ghost xs" data-go="${c.go}">Open</button></div></div>`).join("")}</div>
        <div class="card" style="padding:0"><div style="padding:14px 14px 6px"><h3>Plan against quotation</h3><p class="small muted">Quantities measured on the plan and the quantities quoted. Any difference is a manual change and is listed in the change log.</p></div>
          <div class="tablewrap"><table class="qtable"><thead><tr><th>Item</th><th class="r">On plan</th><th class="r">Quoted</th><th>Unit</th><th>Status</th></tr></thead><tbody>
          ${to.map((t) => { const l = r.lines.find((x) => x.key === t.key) || {}; const diff = l.qty != null && Math.abs(l.qty - t.qty) > 1e-9; return `<tr class="${l.status === "unpriced" ? "unpriced" : ""}"><td><span class="code">${esc(t.displayCode || t.code || "")}</span> ${esc(t.name)}</td><td class="r">${esc(PR.fmtQty(t.qty, t.unit))}</td><td class="r">${l.status === "exception" ? "—" : esc(PR.fmtQty(l.qty, t.unit))}</td><td>${esc(PR.UNIT_LABEL[t.unit])}</td>
            <td>${l.status === "unpriced" ? '<span class="pill err">Not priced</span>' : l.status === "exception" ? `<span class="pill info">${esc(l.exMode)}</span>` : diff ? '<span class="pill warn">Differs</span>' : l.status === "override" ? '<span class="pill warn">Manual price</span>' : '<span class="pill ok">Matches</span>'}</td></tr>`; }).join("") || `<tr><td colspan="5"><div class="empty small">Nothing on the plan yet.</div></td></tr>`}</tbody></table></div></div>
      </div>
      <aside class="summary"><div class="card stack corner"><h3>Status</h3><div class="row"><span class="pill ${U.STATUS_PILL[st] || ""}">${esc(U.STATUS_LABEL[st] || "Draft")}</span>${S.project.meta.issuedAt ? `<span class="small muted">Issued ${esc(new Date(S.project.meta.issuedAt).toLocaleString())} by ${esc(S.project.meta.issuedBy || "")}</span>` : ""}</div>
        <div class="sumrows"><div class="r"><span>Subtotal</span><span>${esc(DPPricing.fmtMoney(r.subtotal, r.currency))}</span></div><div class="r disc"><span>Discount ${r.discountPct}%</span><span>− ${esc(DPPricing.fmtMoney(r.discount, r.currency, { symbol: false }))}</span></div>${r.taxPct ? `<div class="r"><span>${esc(r.taxLabel)} ${r.taxPct}%</span><span>${esc(DPPricing.fmtMoney(r.tax, r.currency, { symbol: false }))}</span></div>` : ""}<div class="r big"><span>Total</span><span>${esc(DPPricing.fmtMoney(r.total, r.currency))}</span></div></div>
        ${locked ? `<div class="note small">${st === "submitted" ? "Waiting for an administrator to approve the order. The quotation is locked meanwhile; withdraw the request to change it." : ["won", "accepted"].includes(st) ? `The client accepted this quotation${S.project.meta.orderId ? " — order " + esc(S.project.meta.orderId) : ""}. Plan and prices are locked; changes need a new project or an administrator.` : "This project is cancelled."}</div>`
          : blocking ? `<div class="note err small">Clear the items marked ✕ before submitting the quotation.</div>` : `<div class="note ok small">Nothing blocks this quotation.</div>`}
        ${locked ? "" : `<button class="btn block ${blocking ? "" : "lime"}" id="r-issue" ${blocking || !w || App.sample ? "disabled" : ""}>${st === "issued" ? "Submit new revision" : "Submit &amp; issue quotation"}</button>
        <p class="tiny muted">${App.sample ? "The sample project cannot be issued. Save it as your own project first." : "Submitting saves a locked version of the plan, quotation and proposal text, assigns the reference and records who issued it and when. No PDF is needed."}</p>`}</div>
        ${App.sample ? "" : `<div class="card stack" id="r-order"><h3>Client decision</h3>${orderBox(st, r, w)}</div>`}</aside></div></div>`;
    const V = $("#view-review");
    $("#r-quote").onclick = () => U.go("quote"); $("#r-next").onclick = () => U.go("proposal");
    $$("[data-go]", V).forEach((b) => (b.onclick = () => U.go(b.dataset.go)));
    $$("[data-ack]", V).forEach((b) => (b.onclick = async () => {
      const kind = b.dataset.ack, cnt = checks().v.counts[kind === "errors" ? "error" : "warning"];
      const r2 = await U.form(`Acknowledge ${cnt} ${kind}`, [{ id: "reason", label: "Why the proposal can go out with these open", required: true }], { intro: kind === "errors" ? "Geometry errors usually mean the layout cannot be built as drawn. Acknowledging records your name and reason in the change log; it does not fix the layout." : "Record that you reviewed the warnings.", submit: "Acknowledge" });
      if (!r2) return; S.project.review = S.project.review || {}; S.project.review[kind === "errors" ? "ackErrors" : "ackWarnings"] = { count: cnt, reason: r2.reason, by: U.userInfo().name || "local user", at: new Date().toISOString() };
      M.commit("Acknowledge", { audit: { action: `Acknowledged ${cnt} ${kind}`, detail: r2.reason } }); U.scheduleAutosave(); renderReview(); }));
    const iss = $("#r-issue"); if (iss) iss.onclick = issue; const iss2 = $("#r-issue-top"); if (iss2) iss2.onclick = issue;
    const sb = $("#r-submit"); if (sb) sb.onclick = () => DPUI.acceptDialog(S.project.meta.id, S.project.meta.ownerId || DPStore.st.userId, () => renderReview());
    const rj = $("#r-reject"); if (rj) rj.onclick = () => DPUI.rejectDialog(S.project.meta.id, S.project.meta.ownerId || DPStore.st.userId, () => renderReview());
    const wd = $("#r-withdraw"); if (wd) wd.onclick = async () => { await DPSales.withdraw(S.project.meta.id); setStatus("issued", "Approval request withdrawn"); };
    const lo = $("#r-lost"); if (lo) lo.onclick = async () => { const f = await U.form("Mark as lost", [{ id: "reason", label: "Why was it lost?", required: true, type: "textarea" }], { submit: "Mark lost" }); if (!f) return;
      if (st === "submitted") await DPSales.withdraw(S.project.meta.id); setStatus("lost", f.reason); if (S.project.meta.leadId) DPLeads.updateCrm(S.project.meta.leadId, { stage: "lost", lostReason: f.reason }, { stageNote: f.reason }).catch(() => {}); };
    const ro2 = $("#r-reopen"); if (ro2) ro2.onclick = () => setStatus("issued", "Reopened");
  }
  /** What the owner can do once the proposal is out; shows their own estimated commission (never cost or margin). */
  function orderBox(st, r, w) {
    const cfg = App.commissionCfg, base = DPCommission.base(r, App.config.settings), est = cfg ? DPSales.estimate(base.eligibleMinor, cfg) : null;
    const mine = !S.project.meta.ownerId || S.project.meta.ownerId === DPStore.st.userId;
    const estHtml = est && mine ? `<div class="kv"><span>Commission value</span><b class="num">${esc(DPPricing.fmtMoney(base.eligibleMinor, r.currency))}</b><span>Estimated commission</span><b class="num">${esc(DPPricing.fmtMoney(est.amountMinor, r.currency))}</b></div>
      <p class="tiny muted">An estimate, not a promise: the commission value excludes ${esc(r.taxLabel)}, delivery and pass-through charges, and the amount you earn is the one an administrator approves after the order.</p>` : "";
    if (st === "draft" || !st) return `<p class="small muted">After you submit the quotation, record the client's decision here or in My Orders &amp; Proposals.</p>${estHtml}`;
    if (st === "issued") return `${estHtml}<button class="btn block" id="r-submit" ${w && mine ? "" : "disabled"}>Client accepted…</button><button class="btn ghost block sm" id="r-reject" ${w && mine ? "" : "disabled"}>Client rejected…</button>`;
    if (st === "accepted") return `<span class="pill ok">Accepted — order ${esc(S.project.meta.orderId || "")}</span><p class="small">Engineering has the order. Follow production and payments in <b>My Orders &amp; Proposals</b>.</p>`;
    if (st === "submitted") return `${estHtml}<span class="pill warn">Awaiting approval</span><button class="btn ghost block sm" id="r-withdraw" ${w ? "" : "disabled"}>Withdraw the request</button><button class="btn ghost block sm" id="r-lost" ${w ? "" : "disabled"}>Mark as lost</button>`;
    if (st === "won") return `<span class="pill ok">Won</span><p class="small">See the commission under <b>My Commissions</b>.</p>`;
    if (st === "lost") return `<span class="pill err">Lost</span><button class="btn ghost block sm" id="r-reopen" ${w ? "" : "disabled"}>Reopen</button>`;
    return `<span class="pill err">${esc(U.STATUS_LABEL[st] || st)}</span>`;
  }
  async function setStatus(status, note) { S.project.meta.status = status; M.commit("Status", { audit: { action: "Status: " + (U.STATUS_LABEL[status] || status), detail: note || "" } }); await U.save(); renderReview(); }
  async function submitOrder() {
    const r = U.pricing(); if (r.blocking) return U.toast("The quotation has unresolved issues.", { err: true });
    const f = await U.form("Request order approval", [{ id: "note", label: "Note for the administrator (client confirmation, PO number, payment received…)", type: "textarea", required: true }],
      { intro: `An administrator checks the saved project and approves the order. Only approved orders count towards your target and commission. Total ${esc(DPPricing.fmtMoney(r.total, r.currency))}.`, submit: "Send for approval" });
    if (!f) return;
    if (M.S.dirty) { const ok = await U.save(); if (!ok) return; }
    try { await DPSales.submit(S.project, r, App.config.settings, f.note); S.project.meta.status = "submitted"; S.project.meta.submittedAt = new Date().toISOString();
      M.commit("Submit", { audit: { action: "Requested order approval", detail: f.note } }); await U.save();
      if (S.project.meta.leadId) DPLeads.syncStage(S.project.meta.leadId, "negotiation", "Client accepted; order approval requested");
      U.toast("Sent for approval."); renderReview(); }
    catch (e) { U.toast("Could not send: " + (e.message || e.code), { err: true }); }
  }
  /** Submit = issue. Saves the project, assigns the revision and timestamp, stores a locked version, then closes the workflow
   *  and opens My Orders & Proposals with the new quotation at the top. Nothing here depends on building a PDF.
   *  If saving fails the user stays on this page with their work intact. */
  async function issue() {
    const c = checks(); if (c.blocking) return U.toast("Clear the blocking items first.", { err: true });
    const m = S.project.meta; if (["submitted", "won", "accepted", "cancelled"].includes(m.status)) return U.toast("This quotation is locked.", { err: true });
    const again = m.status === "issued";
    const ok = await U.ask(again ? "Submit a new revision?" : "Submit and issue this quotation?", `<p>${esc(m.ref || "")} · ${esc(DPPricing.fmtMoney(c.r.total, c.r.currency))}. A locked version of the plan, quotation and proposal text is saved and the quotation appears in My Orders &amp; Proposals.</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: again ? "Submit revision" : "Submit & issue", value: true }]);
    if (!ok) return;
    const before = { status: m.status, rev: m.rev, issuedAt: m.issuedAt, issuedBy: m.issuedBy };
    m.status = "issued"; m.rev = (m.rev || 0) + 1; m.issuedAt = new Date().toISOString(); m.issuedBy = U.userInfo().name || "local user"; if (!m.ref) m.ref = U.nextRef();
    M.commit("Issue", { audit: { action: "Quotation issued", detail: `Revision ${m.rev} · ${DPPricing.fmtMoney(c.r.total, c.r.currency)}` } });
    const b = U.busy("Saving and issuing…");
    const saved = await U.save();
    if (!saved) { b.done(); Object.assign(m, before); M.S.dirty = true; U.toast("The quotation was not issued because saving failed. Your work is still here — try again.", { err: true, ms: 9000 }); renderReview(); return; }
    let vNote = ""; try { await DPStore.saveVersion(S.project, `Issued revision ${m.rev}`, U.userInfo()); } catch (e) { vNote = " (the locked copy could not be stored: " + e.message + ")"; }
    if (m.leadId) DPLeads.syncStage(m.leadId, "proposal_issued", `Revision ${m.rev} issued`);
    if (root.DPAuth) DPAuth.logActivity("Issued quotation", `${m.ref} rev ${m.rev}`).catch(() => {});
    if (root.DPNotify && !U.isAdmin()) DPNotify.deliver("@admins", { id: `quote-${m.id}-r${m.rev}`, type: "quote", title: "Quotation issued", body: `${m.ref} · ${m.name}${m.client ? " — " + m.client : ""} (${U.userInfo().name || "sales"}).`, link: { view: "register", opts: { pid: m.id, owner: m.ownerId } }, ref: m.id }).catch(() => {});
    b.done();
    const pid = m.id, ref = m.ref, rev = m.rev; App.open = false; M.S.dirty = false;
    U.go("proposals", { highlight: pid });
    U.toast(`Quotation ${ref} issued (revision ${rev}).${vNote} It is at the top of My Orders & Proposals.`, { ms: 7000 });
  }

  U.register("quote", renderQuote); U.register("review", renderReview);
  Object.assign(DPUI, { setDiscount, renderQuote, renderReview, reviewChecks: checks });
})(typeof self !== "undefined" ? self : this);
