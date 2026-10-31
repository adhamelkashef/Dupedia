/* X FORCE 1.3 (Dupedia) — product entry and the "Dupedia Products" catalogue.

     prod/cat/p/<code>               product record: classification, description, dimensions, specifications, status, images
                                   and technical files (no price, no cost)                  staff read · administrators write
     prod/cat/p/<code>/f/img-<fid>/c/…  product photos (chunked)       prod/cat/p/<code>/f/file-<fid>/c/… technical files
     prodx/cost/p/<code>             internal costing, supplier and import terms             administrators (Finance reads)
     config/pricebook              the APPROVED SELLING PRICE (unchanged 1.x source of truth for quotations); every change
                                   is logged with who, when, old value, new value and the reason. Sales read their own
                                   copy (pb/<uid>) and can never write it — the Worker refuses, whatever the browser sends.
   Published products also appear in the Site Planner (as catalogue products with their real dimensions).
   Quotations already issued and booked orders keep the prices they were issued with (they store their own lines). */
/* global DPUI, DPShell, DPStore, DPAuth, DPCat, DPOrders, DPPrice */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, DS = () => root.DPStore;
  const CATS = { equipment: "Outdoor playground equipment", indoor: "Indoor playground equipment", softplay: "Soft play", arcade: "Arcade & entertainment machines", water: "Water park & aquatic", amusement: "Amusement rides & attractions", flooring: "Safety flooring & surfaces", landscape: "Landscape & site furniture", other: "Other" };
  const STATUS = { draft: "Draft (not in the catalogue)", published: "Published", discontinued: "Discontinued" };
  const ORIGIN = { manufactured: "Manufactured by Dupedia", imported: "Imported" };
  const adm = () => U.isAdmin(), now = () => new Date().toISOString();
  const products = async () => (await DS().tryList("prod/cat/p")).map((x) => Object.assign({ code: x.id }, x.data));
  /** The price book stores selling prices in currency units (EGP), as the quotation engine reads them; screens work in piastres. */
  const priceOf = (code) => { const it = ((App.config.pricebook || {}).items || {})[code]; return it && it.sell != null && it.sell !== "" && isFinite(it.sell) ? Math.round(+it.sell * 100) : null; };

  async function saveProduct(p, { price = null, reason = "" } = {}) {
    if (!adm()) throw new Error("Only administrators create and edit products.");
    const code = String(p.code || "").trim().toUpperCase(); if (!/^[A-Z0-9][A-Z0-9._-]{1,30}$/.test(code)) throw new Error("Product code: 2–31 letters, digits, dot, dash or underscore.");
    if (!String(p.name || "").trim()) throw new Error("Enter the product name."); if (!ORIGIN[p.origin]) throw new Error("Choose Manufactured or Imported."); if (!CATS[p.category]) throw new Error("Choose the category.");
    const path = `prod/cat/p/${code}`, prev = await DS().tryGet(path);
    if (!p._edit && (prev || (root.DPCat && DPCat.BY[code]))) throw new Error(`Product code ${code} already exists.`);
    const d = p.dims || {}; if (p.status === "published" && !(+d.l > 0 && +d.w > 0)) throw new Error("A published product needs its length and width (the Site Planner uses them).");
    const rec = Object.assign({}, prev || {}, { name: p.name.trim(), category: p.category, origin: p.origin, description: String(p.description || "").slice(0, 3000), dims: { l: +d.l || null, w: +d.w || null, h: +d.h || null, unit: "m" }, zone: p.zone && +p.zone.l > 0 ? { l: +p.zone.l, w: +p.zone.w, source: p.zone.source || "" } : null,
      weightKg: +p.weightKg || null, colors: p.colors || "", materials: p.materials || "", age: p.age || "", status: STATUS[p.status] ? p.status : "draft", notes: p.notes || "",
      mfg: p.origin === "manufactured" ? { specs: p.mfgSpecs || "", leadDays: +p.leadDays || null } : null, imp: p.origin === "imported" ? { countryOfOrigin: p.countryOfOrigin || "", hsCode: p.hsCode || "", specs: p.importSpecs || "" } : null,
      images: (prev && prev.images) || [], files: (prev && prev.files) || [], createdAt: (prev && prev.createdAt) || now(), createdBy: (prev && prev.createdBy) || DPAuth.A.me.id, updatedAt: now(), updatedBy: DPAuth.A.me.id });
    await DS().set(path, rec);
    if (p.internal) await DS().set(`prodx/cost/p/${code}`, Object.assign({}, p.internal, { updatedAt: now(), updatedBy: DPAuth.A.me.id }));
    if (price != null && price !== priceOf(code)) await setPrice(code, price, reason || (prev ? "" : "Price set when the product was created"));
    else await refreshCatalog();
    return Object.assign({ code }, rec);
  }
  /** Change the approved selling price (administrators). Logged with the reason; sales copies refresh; quotations already issued keep theirs. */
  async function setPrice(code, sellMinor, reason) {
    if (!adm()) throw new Error("Only administrators change prices."); if (!(Number.isInteger(sellMinor) && sellMinor >= 0)) throw new Error("Enter a valid price.");
    const pb = JSON.parse(JSON.stringify(App.config.pricebook || { currency: "EGP", items: {} })); pb.items = pb.items || {}; pb.log = pb.log || [];
    const old = priceOf(code), sell = sellMinor / 100; if (old === sellMinor) return;
    if (old != null && !String(reason || "").trim()) throw new Error("Give the reason for the price change.");
    pb.items[code] = Object.assign({}, pb.items[code] || {}, { sell });
    pb.log.push({ at: now(), by: U.userInfo().name || "administrator", uid: DPAuth.A.me.id, code, before: old == null ? null : old / 100, after: sell, reason: String(reason || "").slice(0, 300), detail: `${code} sell: ${old == null ? "—" : old / 100} → ${sell}${reason ? " — " + reason : ""}` }); pb.log = pb.log.slice(-500); pb.updatedAt = now();
    await DS().setConfig("pricebook", pb); App.config.pricebook = pb; await DPPrice.syncCopies();
    await DPAuth.auditLog("Selling price changed", { kind: "finance", target: code, reason, before: { sellMinor: old }, after: { sellMinor } }).catch(() => {});
    await refreshCatalog(); if (U.pricing) try { U.pricing(); } catch (e) {}
  }
  async function addFile(code, file, kind = "img") { if (!adm()) throw new Error("Administrators only."); const fid = "f" + Date.now().toString(36); await DPOrders.putFile(`prod/cat/p/${code}/f/${kind}-${fid}`, file);
    const p = await DS().get(`prod/cat/p/${code}`), k = kind === "img" ? "images" : "files"; p[k] = (p[k] || []).concat([{ id: fid, name: file.name, type: file.type, size: file.size, at: now() }]); await DS().set(`prod/cat/p/${code}`, p); return p; }
  const getFile = (code, kind, fid) => DPOrders.getFile(`prod/cat/p/${code}/f/${kind}-${fid}`);
  const thumbs = {};
  async function thumb(code, p) { if (thumbs[code] !== undefined) return thumbs[code]; const im = p && (p.images || [])[0]; thumbs[code] = im ? ((await getFile(code, "img", im.id).catch(() => null)) || {}).dataUrl || null : null; return thumbs[code]; }
  /** Published products join the Site Planner catalogue (as custom products with their dimensions). */
  async function refreshCatalog(list) {
    const l = list || (await products()), cat = App.config.catalog || { overrides: {}, custom: [] };
    const extra = l.filter((p) => p.status === "published" && p.dims && p.dims.l > 0 && p.dims.w > 0 && !(cat.custom || []).some((c) => c.code === p.code))
      .map((p) => ({ code: p.code, name: p.name, collection: "dupedia", collectionName: "Dupedia Products", description: p.description, dims: { l: p.dims.l, w: p.dims.w, h: p.dims.h }, zone: p.zone ? { l: p.zone.l, w: p.zone.w } : null, sym: "generic", age: p.age || "", product13: true }));
    DPCat.setCatalogConfig({ overrides: cat.overrides || {}, custom: (cat.custom || []).concat(extra) }); return extra.length;
  }

  /* ---------------- Dupedia Products catalogue (admin, sales; engineers see it without prices) ---------------- */
  const CF = { q: "", cat: "", origin: "" };
  async function renderCatalog() {
    const V = $("#view-catalog"), showPrice = ["admin", "employee"].includes(U.role());
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Products</span><h1>Dupedia <em>Products</em></h1><p class="lead small">Every product we sell, with its photos, dimensions and specifications${showPrice ? " and the current approved selling price" : ""}. ${showPrice && !adm() ? "Prices are set by administration and cannot be edited here." : ""}</p></div>${adm() ? `<div class="row"><button class="btn ghost sm" id="ct-m">Manage products</button></div>` : ""}</div><div id="ct-b"><div class="empty"><div class="spinner"></div></div></div></div>`;
    const m = $("#ct-m"); if (m) m.onclick = () => U.go("products");
    const own = await products().catch(() => []), O = Object.fromEntries(own.map((p) => [p.code, p])); await refreshCatalog(own);
    const all = DPCat.PRODUCTS.filter((p) => !p.inactive && (!O[p.code] || O[p.code].status === "published")).map((p) => Object.assign({}, p, { rec: O[p.code] || null, category: (O[p.code] || {}).category || (p.collection === "landscape" ? "landscape" : "equipment"), origin: (O[p.code] || {}).origin || null }));
    const draw = async () => { const q = CF.q.toLowerCase(), l = all.filter((p) => (!CF.cat || p.category === CF.cat) && (!CF.origin || p.origin === CF.origin) && (!q || [p.code, p.displayCode, p.name, p.description].join(" ").toLowerCase().includes(q)));
      $("#ct-b").innerHTML = `<div class="card row fin-filt"><input class="in sm" id="ct-q" placeholder="Search by name or code…" value="${esc(CF.q)}"><select class="in sm" id="ct-c"><option value="">All categories</option>${Object.entries(CATS).map(([k, x]) => `<option value="${k}"${CF.cat === k ? " selected" : ""}>${esc(x)}</option>`).join("")}</select><select class="in sm" id="ct-o"><option value="">Manufactured and imported</option>${Object.entries(ORIGIN).map(([k, x]) => `<option value="${k}"${CF.origin === k ? " selected" : ""}>${esc(x)}</option>`).join("")}</select><span class="tiny muted">${l.length} product(s)</span></div>
        <div class="pgrid">${l.map((p) => { const pr = showPrice ? priceOf(p.code) : null; return `<button type="button" class="pcard" data-c="${esc(p.code)}"><span class="pimg" data-th="${esc(p.code)}">${p.thumb ? `<img alt="" loading="lazy" src="${esc(p.thumb)}">` : `<span class="tiny muted">No photo</span>`}</span><span class="pbody"><b>${esc(p.name)}</b><span class="tiny muted">${esc(p.displayCode || p.code)} · ${esc(CATS[p.category] || "")}</span>
          ${p.origin ? `<span class="pill">${p.origin === "imported" ? "Imported" : "Manufactured"}</span>` : ""}<span class="tiny">${esc(p.dims && p.dims.text ? p.dims.text : p.dims ? `L ${p.dims.l} × W ${p.dims.w} m` : "")}</span>${showPrice ? `<b class="num">${pr != null ? esc(H.money2(pr, (App.config.pricebook || {}).currency || "EGP")) : `<span class="tiny muted">price on request</span>`}</b>` : ""}</span></button>`; }).join("") || `<div class="empty">No products match.</div>`}</div>`;
      const B = $("#ct-b"); $("#ct-q", B).onchange = (e) => { CF.q = e.target.value; draw(); }; $("#ct-c", B).onchange = (e) => { CF.cat = e.target.value; draw(); }; $("#ct-o", B).onchange = (e) => { CF.origin = e.target.value; draw(); };
      $$("[data-c]", B).forEach((b) => (b.onclick = () => detail(all.find((p) => p.code === b.dataset.c), showPrice)));
      for (const el of $$("[data-th]", B)) { const p = all.find((x) => x.code === el.dataset.th); if (p && !p.thumb && p.rec && (p.rec.images || []).length) thumb(p.code, p.rec).then((u) => { if (u) el.innerHTML = `<img alt="" src="${esc(u)}">`; }); }
    };
    draw();
  }
  async function detail(p, showPrice) {
    const r = p.rec, pr = showPrice ? priceOf(p.code) : null, img = r ? await thumb(p.code, r) : p.thumb;
    U.openModal(`<div class="row between"><div><span class="eyebrow">${esc(p.displayCode || p.code)} · ${esc(CATS[p.category] || "")}</span><h2>${esc(p.name)}</h2></div>${showPrice ? `<b class="num">${pr != null ? esc(H.money2(pr, "EGP")) : "price on request"}</b>` : ""}</div>
      ${img ? `<img class="pdimg" alt="" src="${esc(img)}">` : ""}<p class="small">${esc(p.description || "")}</p>
      <dl class="kv small"><dt>Dimensions</dt><dd>${esc(p.dims ? (p.dims.text || `L ${p.dims.l} × W ${p.dims.w}${p.dims.h ? " × H " + p.dims.h : ""} m`) : "—")}</dd><dt>Safety zone</dt><dd>${esc(p.zone ? p.zone.text || `${p.zone.l} × ${p.zone.w} m` : "—")}</dd>${p.age ? `<dt>Age</dt><dd>${esc(p.age)}</dd>` : ""}
        ${r ? `<dt>Type</dt><dd>${esc(ORIGIN[r.origin])}</dd>${r.materials ? `<dt>Materials</dt><dd>${esc(r.materials)}</dd>` : ""}${r.colors ? `<dt>Colours / variations</dt><dd>${esc(r.colors)}</dd>` : ""}${r.weightKg ? `<dt>Weight</dt><dd>${esc(r.weightKg)} kg</dd>` : ""}${r.imp && r.imp.countryOfOrigin ? `<dt>Origin</dt><dd>${esc(r.imp.countryOfOrigin)}</dd>` : ""}${r.mfg && r.mfg.specs ? `<dt>Manufacturing</dt><dd>${esc(r.mfg.specs)}</dd>` : ""}${r.imp && r.imp.specs ? `<dt>Specifications</dt><dd>${esc(r.imp.specs)}</dd>` : ""}` : ""}</dl>
      ${r && (r.files || []).length ? `<div class="row" style="gap:6px;flex-wrap:wrap">${r.files.map((f) => `<button class="btn ghost xs" data-f="${esc(f.id)}">${U.svg("clip")} ${esc(f.name)}</button>`).join("")}</div>` : ""}<div class="acts"><button class="btn ghost" id="pd-x">Close</button></div>`, (m) => {
      $("#pd-x", m).onclick = () => U.closeModal(); $$("[data-f]", m).forEach((b) => (b.onclick = async () => root.DPPayUI.showFile(await getFile(p.code, "f", b.dataset.f), "Technical file")));
    }, { wide: true });
  }

  /* ---------------- product management (administrators) ---------------- */
  const PF = { origin: "" };
  async function renderProducts() {
    const V = $("#view-products");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Products</span><h1>Product <em>management</em></h1><p class="lead small">Create manufactured and imported products, attach photos and technical files, set the approved selling price and publish them to the Dupedia Products catalogue. Cost and supplier terms stay internal.</p></div>
      <div class="row"><button class="btn ghost sm" id="pm-c">Open catalogue</button><button class="btn lime sm" id="pm-n">${U.svg("plus")} New product</button></div></div>
      <div class="seg">${[["", "All"], ["manufactured", "Manufactured"], ["imported", "Imported"]].map(([k, l]) => `<button type="button" data-o="${k}" class="${PF.origin === k ? "is-on" : ""}">${l}</button>`).join("")}</div><div id="pm-b"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $$("[data-o]", V).forEach((b) => (b.onclick = () => { PF.origin = b.dataset.o; renderProducts(); }));
    $("#pm-c").onclick = () => U.go("catalog"); $("#pm-n").onclick = () => form(null);
    const l = (await products()).filter((p) => !PF.origin || p.origin === PF.origin).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), log = ((App.config.pricebook || {}).log || []).filter((x) => x.code).slice(-30).reverse();
    $("#pm-b").innerHTML = `<div class="card"><div class="tablewrap"><table class="mtable"><thead><tr><th>Code</th><th>Product</th><th>Type</th><th>Category</th><th>Dimensions</th><th class="r">Selling price</th><th>Status</th><th></th></tr></thead><tbody>
      ${l.map((p) => `<tr><td class="small"><b>${esc(p.code)}</b></td><td class="small">${esc(p.name)}<div class="tiny muted">${(p.images || []).length} photo(s) · ${(p.files || []).length} file(s)</div></td><td class="small">${p.origin === "imported" ? "Imported" : "Manufactured"}</td><td class="small">${esc(CATS[p.category])}</td><td class="small">${p.dims && p.dims.l ? `${p.dims.l} × ${p.dims.w}${p.dims.h ? " × " + p.dims.h : ""} m` : "—"}</td><td class="r num">${priceOf(p.code) != null ? esc(H.money2(priceOf(p.code), "EGP")) : "—"}</td><td><span class="pill ${p.status === "published" ? "ok" : ""}">${esc(STATUS[p.status])}</span></td><td><button class="btn ghost xs" data-e="${esc(p.code)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="8" class="muted small">No products created here yet. The ${DPCat.PRODUCTS.filter((p) => !p.product13).length} verified catalogue products are already in the catalogue and the price book.</td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Price changes</h3><div class="tablewrap"><table class="mtable"><tbody>${log.map((x) => `<tr><td class="tiny">${esc(new Date(x.at).toLocaleString())}</td><td class="small"><b>${esc(x.code)}</b></td><td class="r num">${x.before == null ? "—" : esc(H.money2(x.before, "EGP"))} → ${esc(H.money2(x.after, "EGP"))}</td><td class="small">${esc(x.reason || "")}</td><td class="tiny">${esc(x.by || "")}</td></tr>`).join("") || `<tr><td class="muted small">No logged price changes yet.</td></tr>`}</tbody></table></div></div>`;
    $$("[data-e]", $("#pm-b")).forEach((b) => (b.onclick = () => form(l.find((p) => p.code === b.dataset.e))));
  }
  async function form(p) {
    const ix = p ? await DS().tryGet(`prodx/cost/p/${p.code}`) : null, pr = p ? priceOf(p.code) : null, d = (p && p.dims) || {};
    U.openModal(`<h2>${p ? "Edit product " + esc(p.code) : "New product"}</h2><div class="seg" id="pf-o">${Object.entries(ORIGIN).map(([k, l]) => `<button type="button" data-v="${k}" class="${(p ? p.origin : "manufactured") === k ? "is-on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div class="grid2"><label class="field"><span>Product code / SKU *</span><input class="in" id="pf-code" value="${esc(p ? p.code : "")}" ${p ? "disabled" : ""}></label><label class="field"><span>Name *</span><input class="in" id="pf-name" value="${esc(p ? p.name : "")}"></label></div>
      <div class="grid2"><label class="field"><span>Category *</span><select class="in" id="pf-cat">${Object.entries(CATS).map(([k, l]) => `<option value="${k}"${p && p.category === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="field"><span>Status</span><select class="in" id="pf-st">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${(p ? p.status : "draft") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>
      <label class="field"><span>Description</span><textarea class="in" rows="3" id="pf-desc">${esc(p ? p.description : "")}</textarea></label>
      <div class="grid3"><label class="field"><span>Length (m)</span><input class="in num" type="number" step="0.01" id="pf-l" value="${esc(d.l || "")}"></label><label class="field"><span>Width (m)</span><input class="in num" type="number" step="0.01" id="pf-w" value="${esc(d.w || "")}"></label><label class="field"><span>Height (m)</span><input class="in num" type="number" step="0.01" id="pf-h" value="${esc(d.h || "")}"></label></div>
      <div class="grid3"><label class="field"><span>Safety zone L (m)</span><input class="in num" type="number" step="0.01" id="pf-zl" value="${esc((p && p.zone && p.zone.l) || "")}"></label><label class="field"><span>Safety zone W (m)</span><input class="in num" type="number" step="0.01" id="pf-zw" value="${esc((p && p.zone && p.zone.w) || "")}"></label><label class="field"><span>Zone source (manufacturer data)</span><input class="in" id="pf-zs" value="${esc((p && p.zone && p.zone.source) || "")}"></label></div>
      <div class="grid3"><label class="field"><span>Weight (kg)</span><input class="in num" type="number" id="pf-kg" value="${esc((p && p.weightKg) || "")}"></label><label class="field"><span>Colours / variations</span><input class="in" id="pf-col" value="${esc((p && p.colors) || "")}"></label><label class="field"><span>Age group</span><input class="in" id="pf-age" value="${esc((p && p.age) || "")}"></label></div>
      <label class="field"><span>Materials</span><input class="in" id="pf-mat" value="${esc((p && p.materials) || "")}"></label>
      <div id="pf-man"><label class="field"><span>Manufacturing specifications (BOM summary, manufacturing dimensions, finishes)</span><textarea class="in" rows="2" id="pf-ms">${esc((p && p.mfg && p.mfg.specs) || "")}</textarea></label><label class="field"><span>Typical manufacturing lead time (days)</span><input class="in num" type="number" id="pf-ld" value="${esc((p && p.mfg && p.mfg.leadDays) || "")}"></label></div>
      <div id="pf-imp"><div class="grid2"><label class="field"><span>Country of origin</span><input class="in" id="pf-co" value="${esc((p && p.imp && p.imp.countryOfOrigin) || "")}"></label><label class="field"><span>HS code</span><input class="in" id="pf-hs" value="${esc((p && p.imp && p.imp.hsCode) || "")}"></label></div><label class="field"><span>Import specifications</span><textarea class="in" rows="2" id="pf-is">${esc((p && p.imp && p.imp.specs) || "")}</textarea></label></div>
      <div class="card stack"><b class="small">Selling price and internal costing (administrators; sales see only the approved selling price)</b><div class="grid3"><label class="field"><span>Approved selling price (EGP, excl. VAT)</span><input class="in num" type="number" step="0.01" id="pf-pr" value="${pr != null ? pr / 100 : ""}"></label><label class="field"><span>Reason for a price change</span><input class="in" id="pf-why"></label><label class="field"><span>Internal cost (EGP)</span><input class="in num" type="number" step="0.01" id="pf-cost" value="${ix && ix.costMinor != null ? ix.costMinor / 100 : ""}"></label></div>
        <div class="grid2"><label class="field"><span>Supplier / manufacturer (internal)</span><input class="in" id="pf-sup" value="${esc((ix && ix.supplier) || "")}"></label><label class="field"><span>Supplier terms (internal)</span><input class="in" id="pf-ter" value="${esc((ix && ix.terms) || "")}"></label></div></div>
      <label class="field"><span>Notes</span><input class="in" id="pf-n" value="${esc((p && p.notes) || "")}"></label>
      ${p ? `<div class="row"><button class="btn ghost xs" id="pf-img">${U.svg("clip")} Add photo</button><button class="btn ghost xs" id="pf-file">${U.svg("clip")} Add drawing / technical file</button><span class="tiny muted">${(p.images || []).length} photo(s), ${(p.files || []).length} file(s)</span></div>` : `<p class="tiny muted">Save the product first, then add photos and files.</p>`}
      <p class="small fin-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="pf-x">Cancel</button><button class="btn lime" id="pf-ok">Save product</button></div>`, (m) => {
      let origin = p ? p.origin : "manufactured"; const sync = () => { $("#pf-man", m).hidden = origin !== "manufactured"; $("#pf-imp", m).hidden = origin !== "imported"; $$("#pf-o [data-v]", m).forEach((b) => b.classList.toggle("is-on", b.dataset.v === origin)); };
      $$("#pf-o [data-v]", m).forEach((b) => (b.onclick = () => { origin = b.dataset.v; sync(); })); sync();
      const v = (id) => $("#" + id, m).value.trim();
      $("#pf-x", m).onclick = () => U.closeModal();
      $("#pf-ok", m).onclick = async () => { try { const prv = v("pf-pr"); await saveProduct({ _edit: !!p, code: p ? p.code : v("pf-code"), name: v("pf-name"), category: v("pf-cat"), status: v("pf-st"), origin, description: v("pf-desc"), dims: { l: v("pf-l"), w: v("pf-w"), h: v("pf-h") }, zone: { l: v("pf-zl"), w: v("pf-zw"), source: v("pf-zs") },
          weightKg: v("pf-kg"), colors: v("pf-col"), age: v("pf-age"), materials: v("pf-mat"), mfgSpecs: v("pf-ms"), leadDays: v("pf-ld"), countryOfOrigin: v("pf-co"), hsCode: v("pf-hs"), importSpecs: v("pf-is"), notes: v("pf-n"),
          internal: { costMinor: v("pf-cost") ? Math.round(+v("pf-cost") * 100) : null, supplier: v("pf-sup"), terms: v("pf-ter") } }, { price: prv === "" ? null : Math.round(+prv * 100), reason: v("pf-why") }); U.closeModal(); U.toast("Product saved."); renderProducts(); } catch (e) { $(".fin-err", m).textContent = e.message; } };
      const up = (kind, accept) => () => U.pickFile(accept, async (f) => { try { const pf = await DPOrders.prepareFile(f); await addFile(p.code, pf, kind); delete thumbs[p.code]; U.toast("Added."); U.closeModal(); renderProducts(); } catch (e) { $(".fin-err", m).textContent = e.message; } });
      const a = $("#pf-img", m); if (a) a.onclick = up("img", ".jpg,.jpeg,.png,.webp"); const b = $("#pf-file", m); if (b) b.onclick = up("f", ".pdf,.jpg,.jpeg,.png,.webp");
    }, { wide: true });
  }

  U.register("catalog", renderCatalog); U.register("products", renderProducts);
  root.DPProd = { CATS, STATUS, ORIGIN, products, saveProduct, setPrice, addFile, getFile, refreshCatalog, priceOf };
})(typeof self !== "undefined" ? self : this);
