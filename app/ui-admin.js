/* Dupedia Site Planner 2.1 — administration: price book (with restricted cost prices), catalogue, commercial settings, access. */
/* global DPUI, DPStore, DPCat, DPPricing, DPIO, DPSymbols */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, PR = DPPricing;
  const A = { tab: "prices", q: "", dirty: {}, costDirty: {}, cat: null };

  function renderAdmin(opts = {}) {
    if (!U.isAdmin()) { U.go("dash"); return; }
    if (opts && opts.tab && ["prices", "catalog", "commercial", "access"].includes(opts.tab)) { A.tab = opts.tab; opts.tab = null; }
    $("#view-admin").innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>${A.tab === "prices" ? "Product pricing" : A.tab === "catalog" ? "Catalogue" : "Settings"}</h1><p class="lead small">${DPStore.st.mode === "cloud" ? "Changes apply to every employee immediately. Cost prices are stored separately and only administrators can read them." : "Local mode: settings are stored in this browser."}</p></div>
      <div class="row"><button class="btn ghost" id="ad-close">Close</button></div></div>
      <div class="atabs seg">${[["prices", "Price book"], ["catalog", "Catalogue"], ["commercial", "Commercial & terms"], ["access", "Access & backup"]].map(([k, l]) => `<button type="button" data-at="${k}" class="${A.tab === k ? "is-on" : ""}">${l}</button>`).join("")}</div><div id="ad-body"></div></div>`;
    $("#ad-close").onclick = () => U.go(App.open ? "plan" : "dash");
    $$("[data-at]").forEach((b) => (b.onclick = () => { if (Object.keys(A.dirty).length || Object.keys(A.costDirty).length) { if (!confirmLeave()) return; } A.tab = b.dataset.at; App.viewOpts = { tab: A.tab }; if (root.DPShell) root.DPShell.rail(); renderAdmin(); }));
    ({ prices, catalog, commercial, access })[A.tab]($("#ad-body"));
  }
  function confirmLeave() { U.toast("Save or discard the price book changes first.", { err: true }); return false; }

  /* ---------------- price book ---------------- */
  function pbRows() {
    const rows = DPCat.PRODUCTS.map((p) => ({ key: p.code, code: p.displayCode || p.code, name: p.name, group: p.collectionName || "Products", unit: "each", cat: DPCat.productCat(p) }));
    for (const e of DPCat.ELEMENTS) if (e.costable && e.group !== "custom") rows.push({ key: "el:" + e.id, code: "", name: e.name, group: (DPCat.GROUPS.find((g) => g.key === e.group) || {}).label, unit: e.kind === "area" ? "m2" : e.kind === "line" ? (e.unit === "m2" ? "m2" : "m") : "each", cat: e.cat });
    return rows;
  }
  function prices(B) {
    const pb = App.config.pricebook, items = pb.items || {}, costs = App.costs || {};
    const q = A.q.toLowerCase(), rows = pbRows().filter((r) => !q || [r.code, r.name, r.group].join(" ").toLowerCase().includes(q));
    const v = (k, f) => { const d = A.dirty[k]; const val = d && f in d ? d[f] : (items[k] || {})[f]; return val == null ? "" : val; };
    const cv = (k) => { const val = k in A.costDirty ? A.costDirty[k] : costs[k]; return val == null ? "" : val; };
    const priced = pbRows().filter((r) => items[r.key] && items[r.key].sell != null && items[r.key].sell !== "").length;
    B.innerHTML = `<div class="card stack"><div class="row between"><div class="row"><div class="search" style="width:280px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="pb-q" placeholder="Search code or item" value="${esc(A.q)}"></div>
        <label class="field" style="flex-direction:row;align-items:center;gap:6px"><span>Currency</span><select class="in sm" id="pb-cur" style="width:auto">${["EGP", "USD", "EUR", "SAR", "AED"].map((c) => `<option${c === pb.currency ? " selected" : ""}>${c}</option>`).join("")}</select></label>
        <span class="small muted">${priced} of ${pbRows().length} items priced</span></div>
        <div class="row"><button class="btn ghost sm" id="pb-exp">Export CSV</button><button class="btn ghost sm" id="pb-imp">Import CSV…</button><button class="btn ghost sm" id="pb-discard" ${Object.keys(A.dirty).length || Object.keys(A.costDirty).length ? "" : "disabled"}>Discard</button><button class="btn lime sm" id="pb-save" ${Object.keys(A.dirty).length || Object.keys(A.costDirty).length ? "" : "disabled"}>Save price book</button></div></div>
      <p class="tiny muted">Selling, installation and delivery prices are per unit, excluding tax, in ${esc(pb.currency)}. Leave a price empty when it is not set: the quotation flags it instead of using zero. Cost prices are never shown to employees or printed.</p>
      <div class="pbwrap"><table class="pbtable"><thead><tr><th>Code</th><th>Item</th><th>Group</th><th>Category</th><th>Unit</th><th>Selling price</th><th>Install / unit</th><th>Delivery / unit</th><th>Cost (restricted)</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${A.dirty[r.key] || r.key in A.costDirty ? "dirty" : ""}"><td class="num"><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td class="small muted">${esc(r.group || "")}</td>
        <td><select class="in sm" data-k="${esc(r.key)}" data-f="cat">${PR.CAT_ORDER.filter((c) => c !== "additional").map((c) => `<option value="${c}"${(v(r.key, "cat") || r.cat) === c ? " selected" : ""}>${esc(PR.CAT_LABEL[c])}</option>`).join("")}</select></td>
        <td class="small">${esc(PR.UNIT_LABEL[r.unit])}</td>${["sell", "install", "delivery"].map((f) => `<td><input class="in num" type="number" min="0" step="0.01" data-k="${esc(r.key)}" data-f="${f}" value="${esc(v(r.key, f))}" aria-label="${f} ${esc(r.name)}"></td>`).join("")}
        <td><input class="in num" type="number" min="0" step="0.01" data-cost="${esc(r.key)}" value="${esc(cv(r.key))}" aria-label="cost ${esc(r.name)}"></td></tr>`).join("")}</tbody></table></div>
      <details><summary class="small"><b>Price book change log</b></summary><div class="tablewrap" style="max-height:240px">${(pb.log || []).slice().reverse().slice(0, 100).map((l) => `<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)"><b>${esc(new Date(l.at).toLocaleString())}</b> · ${esc(l.by || "")} · ${esc(l.detail)}</div>`).join("") || `<p class="small muted">No changes yet.</p>`}</div></details></div>`;
    $("#pb-q", B).oninput = (e) => { A.q = e.target.value; const pos = e.target.selectionStart; prices(B); const i = $("#pb-q", B); i.focus(); i.setSelectionRange(pos, pos); };
    $("#pb-cur", B).onchange = (e) => { A.dirty.__currency = e.target.value; prices(B); };
    $$("[data-k]", B).forEach((inp) => (inp.onchange = () => { const k = inp.dataset.k, f = inp.dataset.f; const d = A.dirty[k] = A.dirty[k] || {}; d[f] = inp.tagName === "SELECT" ? inp.value : inp.value === "" ? null : +inp.value; if (f !== "cat" && d[f] != null && !(d[f] >= 0)) { U.toast("Prices must be zero or more.", { err: true }); delete d[f]; } inp.closest("tr").classList.add("dirty"); $("#pb-save", B).disabled = false; $("#pb-discard", B).disabled = false; }));
    $$("[data-cost]", B).forEach((inp) => (inp.onchange = () => { A.costDirty[inp.dataset.cost] = inp.value === "" ? null : +inp.value; inp.closest("tr").classList.add("dirty"); $("#pb-save", B).disabled = false; $("#pb-discard", B).disabled = false; }));
    $("#pb-discard", B).onclick = () => { A.dirty = {}; A.costDirty = {}; prices(B); };
    $("#pb-save", B).onclick = () => savePB(B);
    $("#pb-exp", B).onclick = () => exportPB();
    $("#pb-imp", B).onclick = () => U.pickFile(".csv", (f) => importPB(f, B));
  }
  async function savePB(B) {
    const pb = JSON.parse(JSON.stringify(App.config.pricebook)); pb.items = pb.items || {}; pb.log = pb.log || []; const changes = [];
    if (A.dirty.__currency && A.dirty.__currency !== pb.currency) { changes.push(`currency ${pb.currency} → ${A.dirty.__currency}`); pb.currency = A.dirty.__currency; }
    for (const [k, d] of Object.entries(A.dirty)) { if (k === "__currency") continue; const it = pb.items[k] = Object.assign({}, pb.items[k] || {});
      for (const [f, val] of Object.entries(d)) { if (it[f] !== val) changes.push(`${k} ${f}: ${it[f] == null ? "—" : it[f]} → ${val == null ? "—" : val}`); if (val == null) delete it[f]; else it[f] = val; } }
    const who = U.userInfo().name || "administrator";
    if (changes.length) pb.log.push({ at: new Date().toISOString(), by: who, detail: changes.join("; ").slice(0, 900) }); pb.log = pb.log.slice(-300); pb.updatedAt = new Date().toISOString(); pb.updatedBy = who;
    try {
      await DPStore.setConfig("pricebook", pb); App.config.pricebook = pb; await root.DPPrice.syncCopies();
      if (Object.keys(A.costDirty).length) { const c = Object.assign({}, App.costs || {}); for (const [k, val] of Object.entries(A.costDirty)) { if (val == null) delete c[k]; else c[k] = val; } await DPStore.setRestricted("costs", { items: c, updatedAt: new Date().toISOString(), updatedBy: who }); App.costs = c; }
      A.dirty = {}; A.costDirty = {}; U.toast(`Price book saved${changes.length ? ` (${changes.length} changes)` : ""}.`); prices(B); U.pricing();
    } catch (e) { U.toast("The price book could not be saved: " + (e.message || e.code) + (DPStore.st.mode === "cloud" ? " Only Editors and the owner can change it." : ""), { err: true, ms: 9000 }); }
  }
  function csvParse(text) { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c; } if (f || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => x !== "")); }
  function exportPB() {
    const pb = App.config.pricebook, costs = App.costs || {}, q = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["key", "code", "item", "unit", "category", "sell", "install", "delivery", "cost"].join(",")];
    for (const r of pbRows()) { const it = pb.items[r.key] || {}; lines.push([r.key, r.code, r.name, r.unit, it.cat || r.cat, it.sell, it.install, it.delivery, costs[r.key]].map(q).join(",")); }
    U.downloadOut({ blob: new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), filename: `dupedia-price-book_${pb.currency}_${DPIO.stamp()}.csv` }, "Price book (includes cost prices — keep internal)");
  }
  async function importPB(file, B) {
    try { const rows = csvParse((await file.text()).replace(/^﻿/, "")); const head = rows.shift().map((h) => h.trim().toLowerCase()); const ix = (n) => head.indexOf(n);
      if (ix("key") < 0 || ix("sell") < 0) throw new Error("The CSV needs at least the columns key and sell (export the price book to get the template).");
      const keys = new Set(pbRows().map((r) => r.key)); let n = 0, skipped = 0;
      for (const r of rows) { const k = (r[ix("key")] || "").trim(); if (!keys.has(k)) { skipped++; continue; } const d = A.dirty[k] = A.dirty[k] || {};
        for (const f of ["sell", "install", "delivery"]) if (ix(f) >= 0) { const s = (r[ix(f)] || "").trim().replace(/,/g, ""); d[f] = s === "" ? null : +s; if (d[f] != null && !(d[f] >= 0)) throw new Error(`Row ${k}: ${f} is not a valid number.`); }
        if (ix("category") >= 0 && PR.CAT_ORDER.includes((r[ix("category")] || "").trim())) d.cat = r[ix("category")].trim();
        if (ix("cost") >= 0) { const s = (r[ix("cost")] || "").trim().replace(/,/g, ""); A.costDirty[k] = s === "" ? null : +s; } n++; }
      prices(B); U.toast(`${n} rows loaded${skipped ? `, ${skipped} unknown keys skipped` : ""}. Review the highlighted rows, then save.`, { ms: 7000 });
    } catch (e) { U.toast(e.message, { err: true, ms: 8000 }); }
  }

  /* ---------------- catalogue ---------------- */
  function catalog(B) {
    const cfg = A.cat || (A.cat = JSON.parse(JSON.stringify(App.config.catalog)));
    const ov = (code, f, sub) => { const o = cfg.overrides[code] || {}; const v = sub ? (o[f] || {})[sub] : o[f]; return v == null ? "" : v; };
    const base = (DPCat.PRODUCTS || []).filter((p) => !p.custom);
    const syms = Object.keys(DPSymbols.ELEMENT_SYM).filter((k) => !["label"].includes(k));
    B.innerHTML = `<div class="card stack"><div class="row between"><h3>Catalogue products</h3><div class="row"><button class="btn ghost sm" id="ct-discard">Discard</button><button class="btn lime sm" id="ct-save">Save catalogue</button></div></div>
      <p class="small muted">The published manufacturer data stays untouched; values entered here override it for planning, pricing and proposals, and are marked as Dupedia data. Changing dimensions updates every project that uses the product.</p>
      <div class="pbwrap"><table class="pbtable"><thead><tr><th>Code</th><th>Published</th><th>Display code</th><th>Name</th><th>L (m)</th><th>W (m)</th><th>H (m)</th><th>Zone L</th><th>Zone W</th><th>Active</th></tr></thead><tbody>
      ${base.map((p) => { const raw = (root.DP_PRODUCTS || []).find((x) => x.code === p.code) || p; return `<tr><td class="num"><b>${esc(p.code)}</b></td><td class="tiny muted">${esc(raw.dims ? raw.dims.text : "no dims")}<br>${esc(raw.zone ? raw.zone.text : "")}</td>
        <td><input class="in" style="width:90px" data-co="${p.code}" data-f="displayCode" value="${esc(ov(p.code, "displayCode"))}" placeholder="${esc(p.code)}"></td><td><input class="in" style="width:190px" data-co="${p.code}" data-f="name" value="${esc(ov(p.code, "name"))}" placeholder="${esc(raw.name)}"></td>
        ${[["dims", "l"], ["dims", "w"], ["dims", "h"], ["zone", "l"], ["zone", "w"]].map(([f, s]) => `<td><input class="in num" style="width:70px" type="number" min="0" step="0.01" data-co="${p.code}" data-f="${f}" data-s="${s}" value="${esc(ov(p.code, f, s))}"></td>`).join("")}
        <td><input type="checkbox" data-co="${p.code}" data-f="active" ${(cfg.overrides[p.code] || {}).active === false ? "" : "checked"}></td></tr>`; }).join("")}</tbody></table></div></div>
      <div class="card stack"><div class="row between"><h3>Custom products (${cfg.custom.length})</h3><button class="btn sm" id="ct-add">Add custom product…</button></div>
        <p class="small muted">For equipment Dupedia supplies outside the catalogue (other manufacturers, bespoke builds). Enter real dimensions and the supplier's safety zone.</p>
        ${cfg.custom.length ? `<table class="pbtable"><thead><tr><th>Code</th><th>Name</th><th>L × W × H</th><th>Zone</th><th>Symbol</th><th></th></tr></thead><tbody>${cfg.custom.map((c, i) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td class="num">${c.dims.l} × ${c.dims.w}${c.dims.h ? " × " + c.dims.h : ""} m</td><td class="num">${c.zone && c.zone.l ? `${c.zone.l} × ${c.zone.w} m` : "not set"}</td><td>${esc(c.sym || "generic")}</td><td><button class="btn ghost xs" data-cdel="${i}">Remove</button></td></tr>`).join("")}</tbody></table>` : ""}</div>`;
    $$("[data-co]", B).forEach((inp) => (inp.onchange = () => { const code = inp.dataset.co, f = inp.dataset.f, s = inp.dataset.s, o = cfg.overrides[code] = cfg.overrides[code] || {};
      if (f === "active") { if (inp.checked) delete o.active; else o.active = false; }
      else if (s) { o[f] = o[f] || {}; if (inp.value === "") delete o[f][s]; else o[f][s] = +inp.value; if (!Object.keys(o[f]).length) delete o[f]; }
      else { if (inp.value.trim()) o[f] = inp.value.trim(); else delete o[f]; }
      if (!Object.keys(o).length) delete cfg.overrides[code]; }));
    $("#ct-discard", B).onclick = () => { A.cat = null; catalog(B); };
    $("#ct-save", B).onclick = async () => {
      for (const [code, o] of Object.entries(cfg.overrides)) { if (o.dims && !(o.dims.l > 0 && o.dims.w > 0)) return U.toast(`${code}: enter both length and width, or neither.`, { err: true }); if (o.zone && !(o.zone.l > 0 && o.zone.w > 0)) return U.toast(`${code}: enter both zone length and width, or neither.`, { err: true }); }
      try { cfg.updatedAt = new Date().toISOString(); cfg.updatedBy = U.userInfo().name || "administrator"; await DPStore.setConfig("catalog", cfg); App.config.catalog = cfg; DPCat.setCatalogConfig(cfg); A.cat = null; U.toast("Catalogue saved."); catalog(B); }
      catch (e) { U.toast("The catalogue could not be saved: " + (e.message || e.code), { err: true }); }
    };
    $$("[data-cdel]", B).forEach((b) => (b.onclick = () => { cfg.custom.splice(+b.dataset.cdel, 1); catalog(B); }));
    $("#ct-add", B).onclick = async () => {
      const r = await U.form("Add a custom product", [{ id: "code", label: "Product code", required: true }, { id: "name", label: "Name", required: true },
        { id: "l", label: "Length", type: "number", unit: "m", min: 0.05, step: "any", required: true }, { id: "w", label: "Width", type: "number", unit: "m", min: 0.05, step: "any", required: true }, { id: "h", label: "Height", type: "number", unit: "m", min: 0, step: "any" },
        { id: "zl", label: "Safety zone length (supplier)", type: "number", unit: "m", min: 0, step: "any" }, { id: "zw", label: "Safety zone width (supplier)", type: "number", unit: "m", min: 0, step: "any" },
        { id: "sym", label: "Plan symbol", type: "select", value: "customObject", options: syms.map((s) => ({ value: s, label: s.replace(/([A-Z])/g, " $1").toLowerCase() })) },
        { id: "age", label: "Age range" }, { id: "description", label: "Description", type: "textarea" }], { submit: "Add product" });
      if (!r) return; if (DPCat.BY[r.code] && !DPCat.BY[r.code].custom) return U.toast("That code is already a catalogue product.", { err: true });
      cfg.custom = cfg.custom.filter((c) => c.code !== r.code).concat([{ code: r.code, name: r.name, dims: { l: r.l, w: r.w, h: r.h || null }, zone: r.zl > 0 && r.zw > 0 ? { l: r.zl, w: r.zw } : null, sym: r.sym, age: r.age, description: r.description, collectionName: "Custom products" }]);
      catalog(B); U.toast("Added. Save the catalogue to make it available.");
    };
  }

  /* ---------------- commercial ---------------- */
  function commercial(B) {
    const s = JSON.parse(JSON.stringify(App.config.settings));
    const T = s.terms || {}, co = s.company || {};
    B.innerHTML = `<form class="stack" id="cm-form"><div class="card stack"><h3>Tax, discounts and permissions</h3>
      <div class="grid3"><label class="field"><span>Tax rate</span><div class="unit"><input class="in num" id="cm-tax" type="number" min="0" max="100" step="0.01" value="${s.taxPct || 0}"><em>%</em></div><small>0 = tax not added. Applied after the discount.</small></label>
        <label class="field"><span>Tax label</span><input class="in" id="cm-taxl" value="${esc(s.taxLabel || "VAT")}"></label><label class="field"><span>Reference prefix</span><input class="in" id="cm-ref" value="${esc(s.refPrefix || "DUP")}"></label></div>
      <div class="grid3"><label class="field"><span>5% discount may be applied by</span><select class="in" id="cm-d5"><option value="employee"${s.discountRoles[5] === "employee" ? " selected" : ""}>Employees and administrators</option><option value="admin"${s.discountRoles[5] === "admin" ? " selected" : ""}>Administrators only</option></select></label>
        <label class="field"><span>10% discount may be applied by</span><select class="in" id="cm-d10"><option value="employee"${s.discountRoles[10] === "employee" ? " selected" : ""}>Employees and administrators</option><option value="admin"${s.discountRoles[10] === "admin" ? " selected" : ""}>Administrators only</option></select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="cm-ov" ${s.employeeOverrides ? "checked" : ""}> Employees may enter manual prices, quantities and custom charges</label></div>
      <div class="field"><span class="lbl">Categories the discount applies to</span><div class="row">${PR.CAT_ORDER.map((c) => `<label class="check small"><input type="checkbox" data-elig="${c}" ${s.discountEligible[c] !== false ? "checked" : ""}> ${esc(PR.CAT_LABEL[c])}</label>`).join("")}</div></div>
      <p class="tiny muted">${DPStore.st.mode === "cloud" ? "Discount and override permissions are enforced by the app; every change is logged with the employee's name. Prices, settings and cost data are protected by the shared database's access rules." : "Local mode: permissions are not enforced on this device."}</p></div>
      <div class="card stack"><h3>Sales targets and Lead Mine</h3><div class="grid3"><label class="field"><span>Default monthly target per employee</span><div class="unit"><input class="in num" id="cm-tgt" type="number" min="0" step="1000" value="${esc((s.sales || {}).monthlyTarget || 500000)}"><em>EGP</em></div><small>Commission value of approved orders. Individual targets are set in Employees.</small></label>
        <label class="field"><span>High priority from score</span><input class="in num" id="cm-ph" type="number" min="0" max="100" value="${esc((s.leadPriority || {}).high || 75)}"></label><label class="field"><span>Medium priority from score</span><input class="in num" id="cm-pm" type="number" min="0" max="100" value="${esc((s.leadPriority || {}).medium || 60)}"></label></div>
        <p class="tiny muted">Commission bands, method and the eligibility milestone are set in Commission Management.</p></div>
      <div class="card stack"><h3>Lead Mine rules</h3><div class="grid3"><label class="field"><span>Release a claimed lead after</span><div class="unit"><input class="in num" id="cm-lt" type="number" min="1" max="336" value="${esc((s.leadTimer || {}).hours || 24)}"><em>h</em></div><small>without qualifying activity by its owner</small></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="cm-ltde" ${(s.leadTimer || {}).dataEntryCounts ? "checked" : ""}> Data-entry research resets the owner's timer</label>
        <label class="field"><span>Data entry: completed leads per month</span><input class="in num" id="cm-det" type="number" min="0" value="${esc((s.dataEntry || {}).monthlyTarget || 30)}"></label></div>
        <div class="field"><span class="lbl">A lead is “complete” when it has</span><div class="row">${[["orgType", "customer category"], ["location", "location"], ["source", "website or source"], ["fit", "Dupedia product fit"], ["qualified", "status “Qualified”"], ["contactName", "contact person's name"], ["phone", "verified phone"], ["email", "verified e-mail"]].map(([k, l]) => `<label class="check small"><input type="checkbox" data-lc="${k}" ${((s.leadComplete || {})[k] != null ? (s.leadComplete || {})[k] : ["orgType", "location", "source", "fit", "qualified"].includes(k)) ? "checked" : ""}> ${l}</label>`).join("")}
          <label class="field" style="flex-direction:row;align-items:center;gap:6px"><span>and at least</span><input class="in num sm" id="cm-lcv" type="number" min="0" max="2" style="width:60px" value="${esc((s.leadComplete || {}).verifiedMethods != null ? s.leadComplete.verifiedMethods : 1)}"><span>verified contact method(s)</span></label></div></div></div>
      <div class="card stack"><h3>X FORCE operations</h3>
        <div class="grid3"><label class="field"><span>Company time zone</span><input class="in" id="cm-tz" value="${esc(s.timezone || "Africa/Cairo")}"><small>Used by the server's follow-up reminders. Each person sees times in their own device's zone.</small></label>
          <label class="field"><span>Follow-up advance reminder</span><div class="unit"><input class="in num" id="cm-fa" type="number" min="0" max="1440" value="${esc((s.followUps || {}).advanceMin != null ? s.followUps.advanceMin : 60)}"><em>min</em></div></label>
          <label class="field"><span>Overdue reminder after</span><div class="unit"><input class="in num" id="cm-fo" type="number" min="1" max="72" value="${esc((s.followUps || {}).overdueHours || 2)}"><em>h</em></div></label></div>
        <div class="grid3"><label class="field"><span>Payment methods (one per line)</span><textarea class="in" id="cm-pm2" rows="4">${esc((s.paymentMethods || DPOrders.PAY_METHODS).join("\n"))}</textarea></label>
          <label class="field"><span>CEO alert: large quotation from</span><div class="unit"><input class="in num" id="cm-big" type="number" min="0" step="10000" value="${esc((s.ceo || {}).largeQuote || 1000000)}"><em>EGP</em></div><small>Quotations above this, waiting more than 7 days, are flagged.</small></label>
          <label class="check" style="align-self:end"><input type="checkbox" id="cm-wall" ${!(s.wall && s.wall.systemPosts === false) ? "checked" : ""}> Post “Dupedia Updates” to the Company Wall</label></div></div>
      <div class="card stack"><h3>X FORCE 1.1 — payments, engineering, Ask CEO</h3>
        <div class="grid3"><label class="field"><span>Initial deposit on every accepted order</span><div class="unit"><input class="in num" id="cm-dep" type="number" min="1" max="100" step="1" value="${esc((s.payTerms || {}).depositPct || 50)}"><em>%</em></div><small>Created as a payment obligation due on the acceptance date — never as a payment.</small></label>
          <label class="field"><span>Escalate overdue payments after</span><div class="unit"><input class="in num" id="cm-esc" type="number" min="1" max="60" value="${esc((s.payTerms || {}).escalateDays || 7)}"><em>days</em></div></label>
          <label class="field"><span>Default engineer for accepted orders</span><select class="in" id="cm-deng"><option value="">None — orders wait in the Unassigned queue</option>${root.DPAuth.A.directory.filter((r) => r.uid && r.active !== false && root.DPAuth.baseOf(r.role) === "engineer").map((r) => `<option value="${esc(r.uid)}"${(s.engineering || {}).defaultEngineer === r.uid ? " selected" : ""}>${esc(root.DPAuth.nameSync(r.uid))}</option>`).join("")}</select><small>Accepted orders are assigned to this engineer automatically; you can change the engineer on any order.</small></label></div>
        <div class="grid2"><label class="field"><span>Ask CEO — the CEO's account</span><select class="in" id="cm-ceo"><option value="">The page owner (default)</option>${root.DPAuth.A.directory.filter((r) => r.uid && r.active !== false && root.DPAuth.baseOf(r.role) === "admin").map((r) => `<option value="${esc(r.uid)}"${(s.askCeo || {}).ceo === r.uid ? " selected" : ""}>${esc(root.DPAuth.nameSync(r.uid))}</option>`).join("")}</select></label>
          <div class="field"><span class="lbl">Other administrators allowed to read and answer Ask CEO</span><div class="row">${root.DPAuth.A.directory.filter((r) => r.uid && r.active !== false && root.DPAuth.baseOf(r.role) === "admin").map((r) => `<label class="check small"><input type="checkbox" data-ceor="${esc(r.uid)}" ${((s.askCeo || {}).readers || []).includes(r.uid) ? "checked" : ""}> ${esc(root.DPAuth.nameSync(r.uid))}</label>`).join("") || `<span class="small muted">No other administrators.</span>`}</div></div></div></div>
      <div class="card stack"><h3>Market Intelligence</h3>
        <div class="grid3"><label class="field"><span>Research task id</span><input class="in" id="cm-trig" value="${esc((s.intel || {}).triggerId || "")}" placeholder="trig_…"><small>The scheduled task that runs research on request (set up by Claude). Not a secret.</small></label>
          <label class="field"><span>Target gross margin (pricing report)</span><div class="unit"><input class="in num" id="cm-tm" type="number" min="1" max="90" value="${esc((U.App.intelCfg || {}).targetMargin || 40)}"><em>%</em></div></label>
          <label class="field"><span>Stale after</span><div class="row" style="flex-wrap:nowrap"><div class="unit"><input class="in num sm" id="cm-fxs" type="number" min="6" max="720" value="${esc((s.intel || {}).fxStaleHours || 36)}"><em>h FX</em></div><div class="unit"><input class="in num sm" id="cm-mts" type="number" min="1" max="365" value="${esc((s.intel || {}).materialStaleDays || 45)}"><em>d materials</em></div></div></label></div>
        <div class="row"><button type="button" class="btn ghost sm" id="cm-cmi">Import product cost model (JSON)…</button><span class="small muted" id="cm-cmn">Loading…</span></div></div>
      <div class="card stack"><div class="row between"><h3>Storage</h3><button type="button" class="btn ghost sm" id="cm-sto">Analyse storage use</button></div><p class="small muted">${root.XFServer ? "Self-hosted server: documents and files are stored on the server's disk (files in 180 kB pieces inside the database). Daily backups are kept on the server. Nothing here deletes financial evidence." : "The shared database of this page holds up to 25,000 documents (each up to 256 kB). Files are stored inside it in 180 kB pieces. Nothing here deletes financial evidence."}</p><div id="cm-stob"></div></div>
      <div class="card stack"><div class="row between"><h3>Standard additional charges</h3><button type="button" class="btn ghost sm" id="cm-addc">Add charge</button></div><p class="small muted">Employees can add these to a quotation. Nothing is added automatically.</p>
        <div class="stack" id="cm-charges">${(s.charges || []).map((c, i) => chargeRow(c, i)).join("") || `<p class="small muted">None yet.</p>`}</div></div>
      <div class="card stack"><h3>Default proposal terms</h3><p class="small muted">Approved wording that employees can apply to a proposal. Leave empty where Dupedia has no approved wording yet; the proposal then prints “To be confirmed”.</p>
        <div class="grid2">${[["scope", "Scope of work"], ["assumptions", "Assumptions"], ["exclusions", "Exclusions"], ["installation", "Installation notes"], ["payment", "Payment terms"], ["delivery", "Delivery estimate"], ["validity", "Proposal validity"], ["warranty", "Warranty terms"], ["acceptance", "Acceptance wording"]].map(([k, l]) => `<label class="field"><span>${l}</span><textarea class="in" data-term="${k}" rows="3">${esc(T[k] || "")}</textarea></label>`).join("")}</div></div>
      <div class="card stack"><h3>Company details on proposals</h3><div class="grid3">${[["name", "Company name"], ["address", "Address"], ["phone", "Phone"], ["email", "Email"], ["web", "Website"], ["reg", "Commercial registration"], ["taxNo", "Tax number"]].map(([k, l]) => `<label class="field"><span>${l}</span><input class="in" data-co="${k}" value="${esc(co[k] || "")}"></label>`).join("")}</div></div>
      <div class="row"><button class="btn lime">Save settings</button></div></form>`;
    function chargeRow(c, i) { return `<div class="grid3" data-ci="${i}" style="grid-template-columns:2fr 1.3fr 1.3fr 1fr 1.3fr auto auto;align-items:end"><label class="field"><span>Description</span><input class="in sm" data-cf="label" value="${esc(c.label || "")}"></label>
      <label class="field"><span>Category</span><select class="in sm" data-cf="cat">${["installation", "services", "additional"].map((k) => `<option value="${k}"${c.cat === k ? " selected" : ""}>${esc(PR.CAT_LABEL[k])}</option>`).join("")}</select></label>
      <label class="field"><span>Method</span><select class="in sm" data-cf="method">${[["fixed", "Fixed amount"], ["percent", "% of base"], ["perItem", "Per product"], ["perM2", "Per m² of site"]].map(([k, l]) => `<option value="${k}"${c.method === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Value</span><input class="in sm num" type="number" step="any" min="0" data-cf="value" value="${c.value == null ? "" : c.value}"></label>
      <label class="field"><span>Base (for %)</span><select class="in sm" data-cf="base">${[["equipment", "Equipment"], ["goods", "Equipment, landscape, flooring"], ["all", "All items above"]].map(([k, l]) => `<option value="${k}"${(c.base || "equipment") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="check tiny" title="Pass-through charges (customs, third-party fees) are excluded from the commission value"><input type="checkbox" data-cf="pass" ${c.passThrough ? "checked" : ""}> Pass-through</label>
      <button type="button" class="btn ghost xs" data-crm="${i}">Remove</button></div>`; }
    const readCharges = () => $$("[data-ci]", B).map((row, i) => { const g = (f) => $(`[data-cf="${f}"]`, row).value; return { id: (s.charges[i] && s.charges[i].id) || "c" + Date.now().toString(36) + i, label: g("label").trim(), cat: g("cat"), method: g("method"), value: g("value") === "" ? null : +g("value"), base: g("base"), passThrough: $('[data-cf="pass"]', row).checked }; });
    $("#cm-addc", B).onclick = () => { s.charges = readCharges().concat([{ id: "c" + Date.now().toString(36), label: "", cat: "services", method: "fixed", value: null, base: "equipment" }]); $("#cm-charges", B).innerHTML = s.charges.map(chargeRow).join(""); bindRm(); };
    // cost model status / import (administrators only; the model holds costs, so it is never published as a page file)
    DPStore.tryGet("mix/costmodel").then((m) => { const n = $("#cm-cmn", B); if (n) n.textContent = m ? `Imported: ${Object.keys(m.products || {}).length} products, ${Object.keys(m.materials || {}).length} materials · ${m.source && m.source.file ? m.source.file : ""} (${m.source && m.source.prepared ? m.source.prepared : "date unknown"})` : "No cost model imported."; });
    $("#cm-cmi", B).onclick = () => U.pickFile(".json", async (f) => { try { const m = JSON.parse(await f.text()); if (m.format !== "xforce-costmodel-1" || !m.products || !m.materials) throw new Error("This is not an X FORCE cost-model file.");
      if (JSON.stringify(m).length > 240000) throw new Error("The model is too large for one record.");
      const ok = await U.ask("Import the cost model?", `<p>${Object.keys(m.products).length} products and ${Object.keys(m.materials).length} materials. Materials that do not exist yet are created with the model's base price as a <b>model estimate</b>; existing price histories are kept.</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Import", value: true }]); if (!ok) return;
      await DPStore.set("mix/costmodel", Object.assign(m, { importedAt: new Date().toISOString(), importedBy: U.userInfo().name || "" }));
      let made = 0; for (const [id, x] of Object.entries(m.materials)) { if (!Object.values(m.products).some((p) => (p.lines || {})[id])) continue; if (await DPStore.tryGet(`mix/mat/m/${id}`)) continue;
        await DPStore.set(`mix/mat/m/${id}`, { id, group: x.group, desc: x.desc, spec: x.spec, unit: x.unit, origin: x.origin, usd: x.usd || null, landed: x.landed || null, cls: x.cls, prices: [{ egpPerUnit: x.base, price: x.base, currency: "EGP", unit: x.unit, type: "estimate", source: `Cost model (${m.source.prepared}): ${String(x.source || x.basis || "").slice(0, 300)}`, url: null, publishedAt: m.source.prepared, retrievedAt: new Date().toISOString(), status: "ok", confidence: String(x.confidence || "low").toLowerCase(), note: `Model base price (${x.basis || ""}); source date ${x.sourceDate || "?"}` }] }); made++; }
      await root.DPAuth.adminLog("Imported product cost model", { detail: `${Object.keys(m.products).length} products, ${made} new materials` }); U.toast(`Cost model imported (${made} new materials).`); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); } });
    $("#cm-sto", B).onclick = async () => { const box = $("#cm-stob", B); box.innerHTML = `<div class="small muted"><div class="spinner"></div> Counting documents…</div>`; try { box.innerHTML = await storageReport(); } catch (e) { box.innerHTML = `<div class="note err small">${esc(e.message || e.code)}</div>`; } };
    const bindRm = () => $$("[data-crm]", B).forEach((b) => (b.onclick = () => { s.charges = readCharges(); s.charges.splice(+b.dataset.crm, 1); $("#cm-charges", B).innerHTML = s.charges.map(chargeRow).join("") || `<p class="small muted">None yet.</p>`; bindRm(); }));
    bindRm();
    $("#cm-form", B).onsubmit = async (e) => {
      e.preventDefault(); const tax = +$("#cm-tax", B).value; if (!(tax >= 0 && tax <= 100)) return U.toast("Tax must be between 0 and 100%.", { err: true });
      const charges = readCharges(); for (const c of charges) if (!c.label || !(c.value >= 0)) return U.toast("Every standard charge needs a description and a value.", { err: true });
      const tgt = +$("#cm-tgt", B).value, ph = +$("#cm-ph", B).value, pm = +$("#cm-pm", B).value;
      if (!(tgt >= 0)) return U.toast("Enter a valid monthly target.", { err: true }); if (!(ph > pm && pm >= 0 && ph <= 100)) return U.toast("High priority must start above medium priority (0–100).", { err: true });
      const lt = +$("#cm-lt", B).value; if (!(lt >= 1 && lt <= 336)) return U.toast("The lead timer must be between 1 and 336 hours.", { err: true });
      const lc = Object.fromEntries($$("[data-lc]", B).map((c) => [c.dataset.lc, c.checked])); lc.verifiedMethods = Math.max(0, Math.min(2, +$("#cm-lcv", B).value || 0));
      const pms = $("#cm-pm2", B).value.split(/\n+/).map((x) => x.trim()).filter(Boolean); if (!pms.length) return U.toast("Keep at least one payment method.", { err: true });
      const tz = $("#cm-tz", B).value.trim() || "Africa/Cairo"; try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch (x) { return U.toast("Unknown time zone. Use a name such as Africa/Cairo.", { err: true }); }
      const dep = +$("#cm-dep", B).value; if (!(dep >= 1 && dep <= 100)) return U.toast("The deposit must be between 1 and 100%.", { err: true });
      Object.assign(s, { payTerms: { depositPct: dep, escalateDays: Math.max(1, +$("#cm-esc", B).value || 7) }, engineering: { defaultEngineer: $("#cm-deng", B).value || null },
        askCeo: { ceo: $("#cm-ceo", B).value || null, readers: $$("[data-ceor]", B).filter((c) => c.checked).map((c) => c.dataset.ceor) },
        intel: Object.assign({}, s.intel || {}, { triggerId: $("#cm-trig", B).value.trim(), fxStaleHours: Math.max(6, +$("#cm-fxs", B).value || 36), materialStaleDays: Math.max(1, +$("#cm-mts", B).value || 45) }) });
      Object.assign(s, { timezone: tz, followUps: { advanceMin: Math.max(0, +$("#cm-fa", B).value || 0), overdueHours: Math.max(1, +$("#cm-fo", B).value || 2) }, paymentMethods: pms, ceo: { largeQuote: Math.max(0, +$("#cm-big", B).value || 0) }, wall: { systemPosts: $("#cm-wall", B).checked } });
      const ns = Object.assign(s, { leadTimer: { hours: lt, dataEntryCounts: $("#cm-ltde", B).checked }, dataEntry: { monthlyTarget: Math.max(0, +$("#cm-det", B).value || 0) }, leadComplete: lc, sales: Object.assign({}, s.sales, { monthlyTarget: tgt }), leadPriority: { high: ph, medium: pm }, taxPct: tax, taxLabel: $("#cm-taxl", B).value.trim() || "VAT", refPrefix: $("#cm-ref", B).value.trim() || "DUP", discountRoles: { 5: $("#cm-d5", B).value, 10: $("#cm-d10", B).value }, employeeOverrides: $("#cm-ov", B).checked, charges,
        discountEligible: Object.fromEntries($$("[data-elig]", B).map((c) => [c.dataset.elig, c.checked])), terms: Object.fromEntries($$("[data-term]", B).map((t) => [t.dataset.term, t.value.trim()])), company: Object.fromEntries($$("[data-co]", B).map((t) => [t.dataset.co, t.value.trim()])),
        updatedAt: new Date().toISOString(), updatedBy: U.userInfo().name || "administrator" });
      delete ns.payments; if (ns.intel) delete ns.intel.targetMargin;
      try { const tmv = Math.max(1, Math.min(90, +$("#cm-tm", B).value || 40)); await DPStore.set("mix/intelcfg", Object.assign({}, U.App.intelCfg || {}, { targetMargin: tmv, updatedAt: new Date().toISOString() })); U.App.intelCfg = Object.assign({}, U.App.intelCfg || {}, { targetMargin: tmv });
        await DPStore.setConfig("settings", ns); root.DPAuth.adminLog("Updated settings", { detail: "tax, discounts, targets, terms" }).catch(() => {}); App.config.settings = U.deepMerge(JSON.parse(JSON.stringify(U.DEFAULT_SETTINGS)), ns); U.toast("Settings saved."); U.pricing(); }
      catch (e2) { U.toast("Settings could not be saved: " + (e2.message || e2.code), { err: true }); }
    };
  }

  /* ---------------- access & data ---------------- */
  function access(B) {
    const st = DPStore.st;
    B.innerHTML = `<div class="card stack"><h3>Permissions</h3>
      <p class="small">${root.XFServer ? "Self-hosted server: the server enforces these rules on every read and write, by each account's level (administrator or staff)." : st.mode === "cloud" ? "People are added in <b>User Management</b>. What the database lets each person read and write follows their sharing level on this page, so keep it in step with their Dupedia role." : "Local demonstration mode: accounts are managed in User Management; nothing is enforced on this device."}</p>
      <div class="tablewrap"><table class="plist"><thead><tr><th></th><th>Employee (Contributor)</th><th>Administrator (Editor / Owner)</th></tr></thead><tbody>
      ${[["Own projects, proposals, quotations", "Create, edit, issue", "All employees' projects"], ["Selling prices", "Read", "Read and edit"], ["Cost prices, gross profit, margins", "No access (database)", "Read and edit"],
        ["Lead Mine", "Read, claim, release own", "Edit, import, reassign, release, merge, archive"], ["Pipeline notes (My Leads)", "Own only (database)", "All"], ["Commission records", "Own only, read-only (database)", "All; approve, pay, adjust"],
        ["Orders, payments, selling expenses", "No access (database)", "Full"], ["Targets", "Own, read-only", "Set for everyone"], ["Users and roles", "No access", "Full"], ["Settings, commission rule", "Read", "Edit"]].map((r) => `<tr><td><b>${r[0]}</b></td><td class="small">${r[1]}</td><td class="small">${r[2]}</td></tr>`).join("")}</tbody></table></div>
      <p class="small">${root.XFServer ? "Engineers and data entry staff are staff accounts." : "Engineers and data entry staff are also Contributors on the share menu."} They receive no price-book copy, no order or commission records and no payment evidence, so the database has nothing financial to return to them. The full matrix is in the README.</p></div>
      <div class="card stack"><h3>Move to the self-hosted server</h3><p class="small muted">Download every record X FORCE keeps (orders, payments and their proofs, leads, commissions, engineering, messages on the wall, Ask CEO, Market Intelligence) as one file. On the server run <code>node server/server.js import &lt;file&gt;</code>. Private chats are end-to-end encrypted and are not included. Keep this file safe: it contains costs, payments and ID documents.</p><div class="row"><button class="btn ghost sm" id="bk-full">${U.svg("export")} Download full database export</button></div></div>
      <div class="card stack"><h3>Back up configuration</h3><p class="small muted">Download the price book, catalogue and settings as one file, or restore them from a backup.</p><div class="row"><button class="btn ghost sm" id="bk-exp">Download configuration backup</button><button class="btn ghost sm" id="bk-imp">Restore from backup…</button></div></div>`;
    const fx = $("#bk-full", B); if (fx) fx.onclick = async () => { fx.disabled = true; const t0 = fx.textContent; try { const out = await DPExport.full({ onProgress: (n) => { fx.textContent = `Exporting… ${n} documents`; } });
        await U.downloadOut({ blob: new Blob([JSON.stringify(out)], { type: "application/json" }), filename: `xforce-full-export-${new Date().toISOString().slice(0, 10)}.json` }, "Full database export"); root.DPAuth.adminLog("Full database export", { detail: `${Object.keys(out.docs).length} documents` }).catch(() => {}); }
      catch (e) { U.toast(e.message, { err: true }); } finally { fx.disabled = false; fx.textContent = t0; } };
    $("#bk-exp", B).onclick = () => U.downloadOut({ blob: new Blob([JSON.stringify({ format: "dupedia-sp2-config", at: new Date().toISOString(), settings: App.config.settings, pricebook: App.config.pricebook, catalog: App.config.catalog, costs: App.costs })], { type: "application/json" }), filename: `dupedia-planner-config_${DPIO.stamp()}.json` }, "Configuration backup (includes cost prices — keep internal)");
    $("#bk-imp", B).onclick = () => U.pickFile(".json", async (f) => {
      try { const o = JSON.parse(await f.text()); if (o.format !== "dupedia-sp2-config") throw new Error("This is not a Site Planner configuration backup.");
        if (!(await U.ask("Restore configuration?", "<p>The current price book, catalogue and settings are replaced for everyone.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Restore", value: true, cls: "danger" }]))) return;
        await DPStore.setConfig("settings", o.settings); await DPStore.setConfig("pricebook", o.pricebook); await DPStore.setConfig("catalog", o.catalog); if (o.costs) await DPStore.setRestricted("costs", { items: o.costs, updatedAt: new Date().toISOString() }); await root.DPPrice.syncCopies();
        await U.loadConfig(); U.toast("Configuration restored."); renderAdmin(); } catch (e) { U.toast(e.message, { err: true }); } });
  }

  /** Approximate storage use by area (on demand; reads document lists, never file contents beyond counting). */
  async function storageReport() {
    if (root.XFServer) { const s = await root.XFServer.storage(), mb = (n) => n == null ? "—" : (n / 1048576).toFixed(1) + " MB", pct = s.quotaBytes ? Math.round(s.usedBytes / s.quotaBytes * 100) : null;
      return `<div class="tablewrap"><table class="mtable"><tbody><tr><td class="small">Database (documents, incl. file pieces)</td><td class="r num">${s.documents.toLocaleString()} docs · ${mb(s.databaseBytes)}</td></tr><tr><td class="small">  of which stored files (payment proofs, IDs, pictures, attachments)</td><td class="r num">${s.fileChunks.toLocaleString()} pieces · ${mb(s.fileChunkBytes)}</td></tr>
        <tr><td class="small">Backups (kept on the server)</td><td class="r num">${mb(s.backupsBytes)}</td></tr><tr><td class="small">Application files</td><td class="r num">${mb(s.appBytes)}</td></tr><tr><td class="small"><b>Total used</b> / test quota</td><td class="r num"><b>${mb(s.usedBytes)}</b> / ${mb(s.quotaBytes)}${pct != null ? ` (${pct}%)` : ""}</td></tr>
        <tr><td class="small">Free space on the server disk</td><td class="r num">${mb(s.diskFreeBytes)}</td></tr><tr><td class="small">Hourly server sweep</td><td class="r small">${s.jobs.sweep.enabled ? (s.jobs.sweep.last ? "last run " + esc(new Date(s.jobs.sweep.last).toLocaleString()) : "not run yet") : "disabled"}${s.jobs.sweep.error ? ` · <span class="pill err">${esc(s.jobs.sweep.error.slice(0, 120))}</span>` : ""}</td></tr></tbody></table></div>
        <p class="small"><span class="pill ${s.warning ? "warn" : "ok"}">${s.warning ? "Storage is getting full — download a backup and plan the server upgrade" : "Storage OK"}</span> · <a href="${root.XFServer.backupUrl}">Download a full backup</a> (administrators only). Nothing here deletes financial evidence.</p>`; }
    const ids = root.DPAuth.A.directory.filter((r) => r.uid).map((r) => r.uid), L = (c) => DPStore.tryList(c);
    const size = (l) => l.reduce((a, x) => a + JSON.stringify(x.data).length, 0), rows = [];
    const add = async (label, colls) => { let n = 0, b = 0; for (const c of colls) { const l = await L(c); n += l.length; b += size(l); } rows.push([label, n, b]); };
    const orders = (await L("orders")).map((x) => x.id);
    await add("Orders and payment proofs", ["orders"].concat(orders.map((o) => `orders/${o}/files`)));
    let chunks = 0, cb = 0; for (const o of orders) { const fl = await L(`orders/${o}/files`); for (const f of fl) { const c = await L(`orders/${o}/files/${f.id}/c`); chunks += c.length; cb += size(c); } } rows.push(["  of which file pieces", chunks, cb]);
    await add("Payments reported by sales", ids.map((u) => `paysub/${u}/p`));
    await add("Projects", ids.map((u) => `projects/${u}/p`));
    await add("Leads and contacts", ["leads", "leadcontact"]);
    await add("Notifications", ids.map((u) => `notif/${u}/n`));
    await add("Chat (wall + private)", ids.map((u) => `wall/${u}/m`));
    await add("Market Intelligence", ["mi/opps/o", "mi/runs/r", "mix/news/n", "mix/mat/m", "mix/fx/r", "mix/reports/w", "mix/reports/p"]);
    const tn = rows.filter((r) => !r[0].startsWith("  ")).reduce((a, r) => a + r[1], 0), tb = rows.filter((r) => !r[0].startsWith("  ")).reduce((a, r) => a + r[2], 0);
    const warn = tn > 20000 ? "err" : tn > 15000 ? "warn" : "ok";
    return `<div class="tablewrap"><table class="mtable"><thead><tr><th>Area</th><th class="r">Documents</th><th class="r">Approx. size</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="small">${esc(r[0])}</td><td class="r num">${r[1].toLocaleString()}</td><td class="r num">${(r[2] / 1048576).toFixed(2)} MB</td></tr>`).join("")}</tbody></table></div>
      <p class="small"><span class="pill ${warn}">${tn.toLocaleString()} of 25,000 documents counted</span> · ≈ ${(tb / 1048576).toFixed(1)} MB in the areas listed (sub-collections such as chat attachments and engineering files are not all counted).</p>`;
  }
  U.register("admin", renderAdmin);
  Object.assign(DPUI, { renderAdmin });
})(typeof self !== "undefined" ? self : this);
