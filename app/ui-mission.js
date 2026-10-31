/* X FORCE 1.1 (Dupedia) — CEO Mission Control: the executive Market Intelligence experience. Overview, Currency, Materials,
   Pricing Intelligence, Industry & Regulatory News, Weekly Reports and Automation Health. Every figure comes from a saved,
   sourced record and shows its age; when something is missing the window says so instead of filling the space.
   Each window loads its own data only when it is opened. */
/* global DPUI, DPShell, DPStore, DPAuth, DPIntel, DPIntelUI, DPCeo2, DPPricing, DPOrders */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, I = DPIntel;
  const M = { tab: "overview", pr: null, prMonth: null, prFilter: "", wk: null, newsF: "" };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  const ago = (iso) => DPIntelUI.ago(iso);
  const pct = (x, dp = 1) => (x == null || !isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(dp)}%`);
  const num = (x, dp = 2) => (x == null || !isFinite(x) ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const egp = (x) => (x == null ? "—" : "EGP " + Math.round(x).toLocaleString("en-US"));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const TABS = [["overview", "Overview"], ["fx", "Currency"], ["materials", "Materials"], ["pricing", "Pricing Intelligence"], ["news", "Industry & Regulatory News"], ["weekly", "Weekly Reports"], ["auto", "Automation Health"]];
  function spark(vals, w = 120, h = 30) {
    const v = vals.filter((x) => x != null && isFinite(x)); if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
    const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1, pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 4) + 2},${h - 3 - ((x - mn) / r) * (h - 6)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  const bars = (rows, unit = "") => rows.length ? `<div class="mc-bars">${rows.map(([l, v, max, tag]) => `<div><span class="small">${esc(l)}</span><span class="bar"><i style="width:${Math.max(3, Math.round(v / (max || 1) * 100))}%"></i></span><b class="num small">${v}${unit}</b>${tag ? `<span class="tiny muted">${esc(tag)}</span>` : ""}</div>`).join("")}</div>` : `<p class="small mc-muted">No data yet.</p>`;

  async function renderMission(opts = {}) {
    const V = $("#view-mission"); if (opts.tab) M.tab = opts.tab;
    V.innerHTML = `<div class="mc"><div class="mc-in"><div class="mc-head"><div><span class="mc-eye"><i class="pulse"></i> Mission Control · Market Intelligence</span><h1>Strategic <em>command center</em></h1>
        <p class="small mc-muted">Opportunities, currencies, materials, pricing and regulation — from saved, sourced records. Research runs on a schedule (and on request); every value shows when it was last updated.</p></div>
        <div class="row"><button class="btn ghost sm mc-btn" id="mc-intel">${U.svg("radar")} Opportunities radar</button><button class="btn lime sm" id="mc-run">${U.svg("refresh")} Run research now…</button></div></div>
      <div class="mc-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${M.tab === k}" class="${M.tab === k ? "is-on" : ""}" data-t="${k}">${esc(l)}</button>`).join("")}</div>
      <div id="mc-body"><div class="empty mc-muted"><div class="spinner"></div>Loading…</div></div></div></div>`;
    $$("[data-t]", V).forEach((b) => (b.onclick = () => { M.tab = b.dataset.t; renderMission(); }));
    $("#mc-intel").onclick = () => U.go("intel"); $("#mc-run").onclick = runDialog;
    const B = $("#mc-body");
    try { await ({ overview, fx: fxTab, materials: matTab, pricing: pricingTab, news: newsTab, weekly: weeklyTab, auto: autoTab }[M.tab] || overview)(B); }
    catch (e) { console.error(e); B.innerHTML = `<div class="note err">This window could not load (${esc(e.message || e.code || "error")}). The other windows still work.</div>`; }
  }
  const box = (title, body, extra = "", cls = "") => `<section class="mc-win ${cls}"><div class="mc-wh"><h3>${title}</h3>${extra}</div>${body}</section>`;
  const fresh = (iso, staleH) => iso ? `<span class="fresh ${Date.now() - Date.parse(iso) > staleH * 3600e3 ? "stale" : ""}" title="${esc(dt(iso))}">● ${esc(ago(iso))}</span>` : `<span class="fresh none">● no data</span>`;

  /* ---------------- overview ---------------- */
  async function overview(B) {
    const cfg = App.config.settings.intel || {};
    const [opps, st, snaps, mats, newsL, weeks] = await Promise.all([I.listOpps(), I.jobsState(), I.fxSnapshots(), I.materials(), I.news(), I.reports("w")]);
    const wk = Date.now() - 7 * 864e5, open = opps.filter((o) => !I.CLOSED.includes(I.shownStatus(o)));
    const newWk = opps.filter((o) => Date.parse(o.discoveredAt) >= wk), hi = open.filter((o) => o.priority === "high" && ["new", "review", "verified", "qualified"].includes(I.shownStatus(o)));
    const qual = open.filter((o) => ["qualified", "assigned", "contacted", "proposal"].includes(I.shownStatus(o))), bySec = {}; qual.forEach((o) => (bySec[o.category] = (bySec[o.category] || 0) + 1));
    const areas = {}; open.forEach((o) => { const l = (o.location || "Unknown").split(",")[0].trim() || "Unknown"; areas[l] = (areas[l] || 0) + 1; });
    const tenders = open.filter((o) => o.deadline && o.deadline.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.deadline.date.localeCompare(b.deadline.date));
    const devs = open.filter((o) => o.kind === "project" && Date.parse(o.discoveredAt) >= Date.now() - 14 * 864e5), partners = open.filter((o) => o.kind === "partnership");
    const fx = I.fxView(snaps, cfg.fxStaleHours || 36), mv = mats.map((m) => Object.assign({ m }, I.matView(m, { staleDays: cfg.materialStaleDays || 45 }))).filter((x) => x.ch != null).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch));
    const hiNews = newsL.filter((n) => ["high", "medium"].includes(n.impactLevel) && n.status !== "dismissed").slice(0, 6), w = weeks[0];
    const tile = (l, v, sub, go, cls = "") => `<button type="button" class="mc-tile ${cls}" data-go='${esc(JSON.stringify(go))}'><span class="mc-eye">${esc(l)}</span><b class="num">${v}</b><span class="tiny mc-muted">${sub}</span></button>`;
    B.innerHTML = `<div class="mc-tiles">${tile("New opportunities · 7 days", newWk.length, `found by research ${fresh((st.opportunities || {}).lastSuccess, 24 * 7)}`, { v: "intel", tab: "new" })}
        ${tile("High priority · awaiting action", hi.length, "score ≥ 70, not yet assigned", { v: "intel", tab: "high" }, hi.length ? "alert" : "")}${tile("Qualified pipeline", qual.length, "qualified, assigned or in proposal", { v: "intel", tab: "assigned" })}
        ${tile("Upcoming tenders", tenders.length, tenders[0] ? `next deadline ${esc(tenders[0].deadline.date)}` : "none with a sourced deadline", { v: "intel", tab: "tenders" })}${tile("New developments · 14 days", devs.length, "announced projects", { v: "intel", tab: "new" })}${tile("Partnership leads", partners.length, "open", { v: "intel", tab: "partners" })}</div>
      <div class="mc-grid">
        ${box("Qualified opportunities by sector", bars(Object.entries(bySec).sort((a, b) => b[1] - a[1]).map(([k, v]) => [DPIntelUI.CAT[k] || k, v, Math.max(...Object.values(bySec))])))}
        ${box("Open opportunities by area", bars(Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, v, Math.max(...Object.values(areas))])))}
        ${box("Currency · EGP per unit", `<div class="mc-fx">${I.CURRENCIES.map(([c]) => { const x = fx[c]; return `<button type="button" class="mc-fxc" data-tab="fx"><span class="mc-eye">${c}</span><b class="num">${x.cur ? num(x.cur.egpPer, c === "CNY" ? 3 : 2) : "—"}</b><span class="tiny ${x.ch1 > 0 ? "up" : x.ch1 < 0 ? "down" : "mc-muted"}">${x.ch1 != null ? pct(x.ch1, 2) : "no history"}</span>${fresh(x.cur && x.cur.retrievedAt, cfg.fxStaleHours || 36)}</button>`; }).join("")}</div>`)}
        ${box("Material price movements", mv.length ? `<div class="tl">${mv.slice(0, 6).map((x) => `<div><span class="tiny mc-muted">${esc(x.cur.publishedAt || "")}</span><span><b>${esc(x.m.id)}</b> ${esc(x.m.desc || "")} <span class="${x.ch > 0 ? "up" : "down"}">${pct(x.ch)}</span></span></div>`).join("")}</div>` : `<p class="small mc-muted">No material has two dated prices yet. Prices from the cost model (25 Oct 2026) are the baseline; run the Material-Price Update or record supplier quotes.</p>`, `<button class="btn ghost xs mc-btn" data-tab="materials">Open</button>`)}
        ${box("Upcoming tenders and deadlines", tenders.length ? `<div class="tl">${tenders.slice(0, 6).map((o) => `<div><span class="tiny">${esc(o.deadline.date)}</span><span><button class="linkbtn" data-opp="${esc(o.id)}">${esc(o.title)}</button> <span class="tiny mc-muted">${esc(o.organization || "")}</span></span></div>`).join("")}</div>` : `<p class="small mc-muted">No tender with a sourced deadline.</p>`)}
        ${box("Shipping, customs and regulation", hiNews.length ? `<div class="tl">${hiNews.map((n) => `<div><span class="tiny mc-muted">${esc(n.publishedAt || "")}</span><span><b>${esc(n.headline)}</b> <span class="pill ${n.sourceType === "official" ? "ok" : n.sourceType === "unconfirmed" ? "err" : "info"}">${esc(n.verification)}</span></span></div>`).join("")}</div>` : `<p class="small mc-muted">No medium- or high-impact items saved.</p>`, `${fresh((st.news || {}).lastSuccess, 48)} <button class="btn ghost xs mc-btn" data-tab="news">Open</button>`)}
        ${box("Recommended actions for the CEO", w && (w.recommendations || []).length ? `<div class="mc-recs">${w.recommendations.slice(0, 5).map((r) => `<div class="mc-rec"><b>${esc(r.title)}</b><span class="small">${esc(r.reason)}</span><span class="tiny mc-muted">Next: ${esc(r.nextStep)} · Owner: ${esc(r.owner || "—")} · By ${esc(r.deadline || "—")}</span></div>`).join("")}</div><p class="tiny mc-muted">From the weekly report ${esc(w.week)} (${esc(dt(w.createdAt))}).</p>` : `<p class="small mc-muted">No weekly report yet. Run the Weekly Market Position Report to get sourced recommendations.</p>`, `<button class="btn ghost xs mc-btn" data-tab="weekly">Reports</button>`, "wide")}
      </div>`;
    $$("[data-go]", B).forEach((b) => (b.onclick = () => { const g = JSON.parse(b.dataset.go); U.go(g.v, { tab: g.tab }); }));
    $$("[data-tab]", B).forEach((b) => (b.onclick = () => { M.tab = b.dataset.tab; renderMission(); }));
    $$("[data-opp]", B).forEach((b) => (b.onclick = () => DPIntelUI.oppPanel(b.dataset.opp)));
  }

  /* ---------------- currency ---------------- */
  async function fxTab(B) {
    const cfg = App.config.settings.intel || {}, [snaps, st] = await Promise.all([I.fxSnapshots(), I.jobsState()]), fx = I.fxView(snaps, cfg.fxStaleHours || 36);
    B.innerHTML = `${box("Exchange rates · EGP per 1 unit of foreign currency", `<div class="tablewrap"><table class="mtable mc-t"><thead><tr><th>Currency</th><th class="r">EGP per unit</th><th>Base</th><th>Source</th><th>Retrieved</th><th class="r">Previous</th><th class="r">Δ last</th><th class="r">Δ 7 d</th><th class="r">Δ 30 d</th><th>Trend</th><th>Status</th></tr></thead><tbody>
      ${I.CURRENCIES.map(([c, name]) => { const x = fx[c], r = x.cur; return `<tr><td><b>${c}</b> <span class="tiny mc-muted">${esc(name)}</span></td><td class="r num"><b>${r ? num(r.egpPer, c === "CNY" ? 3 : 2) : "—"}</b></td><td class="small">EGP</td>
        <td class="small">${r ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source)}</a> <span class="tiny mc-muted">${esc(r.kind)}${r.rateType ? " · " + esc(r.rateType) : ""}</span>` : "—"}</td><td class="small">${r ? esc(dt(r.retrievedAt)) : "—"}</td>
        <td class="r num small">${x.prev ? num(x.prev.egpPer, 3) + `<div class="tiny mc-muted">${esc(x.prev.date)}</div>` : "—"}</td><td class="r num small">${pct(x.ch1, 2)}</td><td class="r num small">${pct(x.ch7, 2)}</td><td class="r num small">${pct(x.ch30, 2)}</td><td>${spark(x.history.map((h) => h.egpPer))}</td>
        <td>${!r ? `<span class="pill err">No data yet</span>` : x.stale ? `<span class="pill warn">Stale · ${Math.round(x.ageH)} h old</span>` : `<span class="pill ok">Current</span>`}${x.held ? `<div class="tiny warn-t">A new value of ${num(x.held.egpPer, 2)} is held for review (${esc(x.held.note || "")})</div>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="tiny mc-muted">Indicative reference rates from the cited source — not the rate Dupedia's bank, payment provider or supplier will apply. A failed update never replaces a value with zero or an estimate: the last valid rate stays, with its age. Currency movements feed the monthly pricing assessment (imported components).</p>`,
      `${fresh((st.fx || {}).lastSuccess, cfg.fxStaleHours || 36)} <button class="btn ghost xs mc-btn" data-run="fx">Update now…</button>`)}`;
    $$("[data-run]", B).forEach((b) => (b.onclick = () => runDialog([b.dataset.run])));
  }

  /* ---------------- materials ---------------- */
  async function matTab(B) {
    const cfg = App.config.settings.intel || {}, [mats, model, st] = await Promise.all([I.materials(), I.costModel(), I.jobsState()]);
    if (!mats.length) { B.innerHTML = box("Materials", `<p class="small mc-muted">No materials are set up yet. They are created from the product cost model (Admin › Settings › Market Intelligence › Import cost model).</p>`); return; }
    const weight = {}; for (const p of Object.values((model && model.products) || {})) for (const [k, v] of Object.entries(p.lines || {})) weight[k] = (weight[k] || 0) + v;
    const tot = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
    const rows = mats.map((m) => Object.assign({ m, w: (weight[m.id] || 0) / tot }, I.matView(m, { staleDays: cfg.materialStaleDays || 45 }))).sort((a, b) => b.w - a.w);
    const alerts = rows.filter((r) => r.stale && r.w > 0.02).length, up = rows.filter((r) => r.ch > 0.05).length, down = rows.filter((r) => r.ch < -0.05).length, exp = rows.filter((r) => r.quoteExpired).length, nos = rows.filter((r) => r.noSource).length;
    B.innerHTML = `<div class="mc-tiles">${[["Rising > 5%", up, up ? "alert" : ""], ["Falling > 5%", down, ""], ["Stale (> " + (cfg.materialStaleDays || 45) + " days) and material to cost", alerts, alerts ? "alert" : ""], ["Expired supplier quotes", exp, exp ? "alert" : ""], ["Latest price without a source", nos, nos ? "alert" : ""]].map(([l, v, c]) => `<div class="mc-tile ${c}"><span class="mc-eye">${esc(l)}</span><b class="num">${v}</b></div>`).join("")}</div>
      ${box("Materials used in Dupedia products (by share of material cost in the cost model)", `<div class="filters"><div class="search" style="width:240px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="mt-q" placeholder="Search material"></div></div><div class="tablewrap"><table class="mtable mc-t"><thead><tr><th>Material</th><th>Unit</th><th class="r">Share</th><th class="r">Current EGP / unit</th><th>Type</th><th>Source</th><th>Date</th><th class="r">Previous</th><th class="r">Change</th><th>Status</th></tr></thead><tbody id="mt-rows"></tbody></table></div>
        <p class="tiny mc-muted">Baseline prices come from the manufacturing cost model (Base scenario, 25 Oct 2026) and are labelled <b>model estimate</b>. Public indicative prices are never treated as supplier quotations; quotes and actual purchase prices are entered here by administrators with their document and validity.</p>`, `${fresh((st.materials || {}).lastSuccess, 24 * (cfg.materialStaleDays || 45))} <button class="btn ghost xs mc-btn" data-run="materials">Update now…</button>`)}`;
    const draw = (q = "") => { $("#mt-rows", B).innerHTML = rows.filter((r) => !q || [r.m.id, r.m.desc, r.m.group].join(" ").toLowerCase().includes(q)).map((r) => { const c = r.cur;
      return `<tr class="click" data-m="${esc(r.m.id)}"><td><b>${esc(r.m.id)}</b><div class="tiny mc-muted">${esc(r.m.desc || "")}</div></td><td class="small">${esc(r.m.unit)}</td><td class="r num small">${(r.w * 100).toFixed(1)}%</td><td class="r num">${c ? num(c.egpPerUnit) : "—"}</td><td class="small">${c ? esc(I.PRICE_TYPES[c.type] || c.type) : "—"}</td>
        <td class="small">${c ? (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.source || host(c.url))}</a>` : esc(c.source || (c.quoteId ? "quotation document" : "—"))) : "—"}</td><td class="small">${c ? esc(c.publishedAt || "") : "—"}</td><td class="r num small">${r.prev ? num(r.prev.egpPerUnit) : "—"}</td><td class="r num small ${r.ch > 0 ? "up" : r.ch < 0 ? "down" : ""}">${pct(r.ch)}</td>
        <td>${r.quoteExpired ? `<span class="pill err">Quote expired</span>` : r.stale ? `<span class="pill warn">Stale</span>` : `<span class="pill ok">Current</span>`}${r.held ? ` <span class="pill warn">Held for review</span>` : ""}</td></tr>`; }).join("");
      $$("[data-m]", B).forEach((tr) => (tr.onclick = () => matPanel(rows.find((x) => x.m.id === tr.dataset.m).m, () => matTab(B)))); };
    draw(); $("#mt-q", B).oninput = (e) => draw(e.target.value.trim().toLowerCase());
    $$("[data-run]", B).forEach((b) => (b.onclick = () => runDialog([b.dataset.run])));
  }
  function matPanel(m, reload) {
    const S = DPCeo2.sec, v = I.matView(m);
    DPCeo2.drawer(`<div class="cd-head"><div><span class="eyebrow">${esc(m.group || "Material")} · ${esc(m.unit)}</span><h2>${esc(m.id)}</h2><p class="small muted">${esc(m.desc || "")}${m.spec ? " · " + esc(m.spec) : ""}</p></div><button class="btn ghost xs" data-close aria-label="Close">✕</button></div>
      ${S("Price history", `<div class="tablewrap"><table class="mtable"><thead><tr><th>Date</th><th class="r">EGP / ${esc(m.unit)}</th><th>Type</th><th>Source / supplier</th><th>Status</th></tr></thead><tbody>${(m.prices || []).slice().reverse().map((p) => `<tr><td class="small">${esc(p.publishedAt || "")}<div class="tiny muted">retrieved ${esc((p.retrievedAt || "").slice(0, 10))}</div></td><td class="r num">${num(p.egpPerUnit)}${p.currency && p.currency !== "EGP" ? `<div class="tiny muted">${esc(p.currency)} ${num(p.price)}</div>` : ""}</td><td class="small">${esc(I.PRICE_TYPES[p.type] || p.type)}${p.validUntil ? `<div class="tiny muted">valid to ${esc(p.validUntil)}</div>` : ""}</td>
        <td class="small">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.source || host(p.url))}</a>` : esc(p.source || "")}${p.quoteId ? ` <button class="linkbtn" data-q="${esc(p.quoteId)}">quotation</button>` : ""}${p.note ? `<div class="tiny muted">${esc(p.note)}</div>` : ""}</td><td><span class="pill ${p.status === "ok" ? "ok" : "warn"}">${esc(p.status)}</span></td></tr>`).join("")}</tbody></table></div>`)}
      ${S("Record a verified price", `<div class="grid2"><label class="field"><span>Type</span><select class="in sm" id="mp-t"><option value="supplier_quote">Supplier quotation</option><option value="purchase">Actual Dupedia purchase price</option><option value="official_index">Official index</option><option value="indicative">Indicative market price</option></select></label><label class="field"><span>Supplier / source *</span><input class="in sm" id="mp-s"></label></div>
        <div class="grid3"><label class="field"><span>Price per ${esc(m.unit)} *</span><input class="in sm num" id="mp-p" type="number" min="0" step="0.01"></label><label class="field"><span>Currency</span><select class="in sm" id="mp-c"><option>EGP</option><option>USD</option><option>EUR</option><option>CNY</option><option>AED</option><option>GBP</option></select></label><label class="field"><span>FX used (EGP per unit)</span><input class="in sm num" id="mp-fx" type="number" step="0.0001"></label></div>
        <div class="grid3"><label class="field"><span>Date *</span><input class="in sm" type="date" id="mp-d"></label><label class="field"><span>Valid until</span><input class="in sm" type="date" id="mp-v"></label><label class="field"><span>Link</span><input class="in sm" id="mp-u" placeholder="https://"></label></div>
        <div class="row"><button class="btn ghost sm" id="mp-f">${U.svg("clip")} Attach quotation…</button><span class="small" id="mp-fn"></span></div><input class="in sm" id="mp-n" placeholder="Note (grade, quantity, delivery terms)"><p class="small" id="mp-err" style="color:var(--red)"></p><button class="btn lime sm" id="mp-ok">Save price</button>`)}`, (d) => {
      let file = null; $$("[data-q]", d).forEach((b) => (b.onclick = async () => DPUI.showFile(await I.quoteFile(b.dataset.q), "Supplier quotation")));
      $("#mp-f", d).onclick = () => U.pickFile(".pdf,.jpg,.jpeg,.png,.webp", async (f) => { try { file = await DPOrders.prepareFile(f); $("#mp-fn", d).textContent = file.name; } catch (e) { $("#mp-err", d).textContent = e.message; } });
      $("#mp-ok", d).onclick = async () => { const err = $("#mp-err", d); err.textContent = "";
        try { await I.addPrice(m.id, { type: $("#mp-t", d).value, supplier: $("#mp-s", d).value.trim(), source: $("#mp-s", d).value.trim(), price: $("#mp-p", d).value, currency: $("#mp-c", d).value, fx: $("#mp-fx", d).value, date: $("#mp-d", d).value, validUntil: $("#mp-v", d).value || null, url: $("#mp-u", d).value.trim() || null, note: $("#mp-n", d).value.trim(), file });
          U.toast("Price recorded."); DPCeo2.closeDrawer(); reload && reload(); } catch (e) { err.textContent = e.message; } };
    }, { label: "Material" });
  }

  /* ---------------- pricing ---------------- */
  async function pricingTab(B) {
    const list = await I.reports("p"), month = new Date().toISOString().slice(0, 7);
    if (!M.prMonth) M.prMonth = (list[0] && list[0].id) || null;
    const cur = M.prMonth ? list.find((r) => r.id === M.prMonth) : null, prev = cur ? list.find((r) => r.id < cur.id) : null;
    B.innerHTML = `${box("Monthly Pricing Intelligence Report", `<div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn lime sm" id="pr-gen">${U.svg("refresh")} Generate ${esc(H.perLabel(month))} assessment</button>
        ${list.length ? `<select class="in sm" id="pr-m">${list.map((r) => `<option value="${esc(r.id)}"${r.id === M.prMonth ? " selected" : ""}>${esc(H.perLabel(r.id))} · rev ${r.revision || 1}</option>`).join("")}</select>` : ""}${cur ? `<button class="btn ghost sm mc-btn" id="pr-csv">${U.svg("export")} Export CSV</button>` : ""}</div>
      <p class="tiny mc-muted">Generated from saved data only: price book selling prices, recorded costs, the product cost model, the latest material prices and exchange rates. Recommendations never change prices or issued quotations; an administrator changes prices in Product Pricing, where every change is logged.</p>
      <div id="pr-body">${cur ? "" : `<p class="small mc-muted">No report saved yet. Generate the first one.</p>`}</div>`)}`;
    $("#pr-gen").onclick = async () => { const b = $("#pr-gen"); b.disabled = true; b.textContent = "Generating…";
      try { await buildPricing(month); M.prMonth = month; U.toast("Pricing assessment saved."); pricingTab(B); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); b.disabled = false; b.textContent = "Generate"; } };
    const ms = $("#pr-m"); if (ms) ms.onchange = (e) => { M.prMonth = e.target.value; pricingTab(B); };
    if (!cur) return;
    const csv = $("#pr-csv"); if (csv) csv.onclick = () => { const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const lines = [["code", "product", "selling_price", "recorded_cost", "cost_basis", "estimated_cost", "cost_movement_pct", "margin_before_pct", "margin_after_pct", "recommendation", "range_low", "range_high", "confidence", "data_gaps", "reasons"].join(",")].concat(cur.rows.map((r) => [r.code, r.name, r.sell, r.recorded, r.basis, r.estCost, r.movePct != null ? (r.movePct * 100).toFixed(2) : "", r.marginBefore != null ? (r.marginBefore * 100).toFixed(1) : "", r.marginAfter != null ? (r.marginAfter * 100).toFixed(1) : "", (I.REC[r.recommendation] || [r.recommendation])[0], r.range ? r.range[0] : "", r.range ? r.range[1] : "", r.confidence, r.gaps.join("; "), r.reasons.join("; ")].map(q).join(",")));
      U.downloadOut({ blob: new Blob([lines.join("\n")], { type: "text/csv" }), filename: `dupedia-pricing-intelligence-${cur.id}.csv` }, "Pricing report"); };
    const s = cur.summary, f = M.prFilter, rows = cur.rows.filter((r) => !f || r.recommendation === f);
    $("#pr-body").innerHTML = `<div class="mc-tiles">${[["maintain", s.maintain], ["review", s.review], ["increase", s.increase], ["urgent", s.urgent], ["request-quotes", s.quotes], ["set-price", s.setPrice]].map(([k, v]) => `<button type="button" class="mc-tile ${f === k ? "on" : ""} ${k === "urgent" && v ? "alert" : ""}" data-f="${k}"><span class="mc-eye">${esc(I.REC[k][0])}</span><b class="num">${v}</b></button>`).join("")}</div>
      <p class="small">${s.products} products · costs recorded for ${s.recordedCosts}, model estimate only for ${s.modelOnly} · target margin ${Math.round(cur.targetMargin * 100)}% · USD ${cur.fx.USD ? num(cur.fx.USD) : "not available"} vs model ${cur.fx.fxBase} · suggested effective date ${esc(cur.effectiveSuggested)} (subject to Admin approval) · generated ${esc(dt(cur.createdAt))}${prev ? ` · compared with ${esc(H.perLabel(prev.id))}` : ""}</p>
      <details class="small"><summary>How this is calculated</summary><p>${esc(cur.method)}</p></details>
      <div class="tablewrap"><table class="mtable mc-t"><thead><tr><th>Product</th><th class="r">Selling</th><th class="r">Recorded cost</th><th class="r">Estimated cost</th><th class="r">Δ cost</th><th class="r">Margin before</th><th class="r">Margin after</th><th>Recommendation</th><th>Confidence</th><th>Data gaps</th>${prev ? "<th>vs last report</th>" : ""}</tr></thead><tbody>
      ${rows.map((r) => { const rc = I.REC[r.recommendation] || [r.recommendation, ""], p = prev && prev.rows.find((x) => x.code === r.code); return `<tr class="click" data-pc="${esc(r.code)}"><td><b>${esc(r.code)}</b><div class="tiny mc-muted">${esc(r.name)}</div></td><td class="r num">${egp(r.sell)}</td><td class="r num">${r.recorded != null ? egp(r.recorded) : `<span class="tiny mc-muted">${r.modelCost != null ? "model " + egp(r.modelCost) : "—"}</span>`}</td><td class="r num">${egp(r.estCost)}</td><td class="r num ${r.movePct > 0 ? "up" : r.movePct < 0 ? "down" : ""}">${pct(r.movePct)}</td>
        <td class="r num">${pct(r.marginBefore).replace("+", "")}</td><td class="r num">${pct(r.marginAfter).replace("+", "")}</td><td><span class="pill ${rc[1]}">${esc(rc[0])}</span>${r.range ? `<div class="tiny">EGP ${r.range[0].toLocaleString("en-US")}–${r.range[1].toLocaleString("en-US")}</div>` : ""}</td><td class="small">${esc(r.confidence)}</td><td class="tiny mc-muted">${r.gaps.map(esc).join("<br>") || "—"}</td>${prev ? `<td class="tiny">${p ? (p.recommendation !== r.recommendation ? esc((I.REC[p.recommendation] || [p.recommendation])[0]) + " →" : "unchanged") : "new"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>`;
    $$("[data-f]", B).forEach((b) => (b.onclick = () => { M.prFilter = M.prFilter === b.dataset.f ? "" : b.dataset.f; pricingTab(B); }));
    $$("[data-pc]", B).forEach((tr) => (tr.onclick = () => { const r = cur.rows.find((x) => x.code === tr.dataset.pc); const S = DPCeo2.sec;
      DPCeo2.drawer(`<div class="cd-head"><div><span class="eyebrow">Pricing assessment · ${esc(H.perLabel(cur.id))}</span><h2>${esc(r.code)} ${esc(r.name)}</h2></div><button class="btn ghost xs" data-close>✕</button></div>
        ${S("Recommendation", `<p><span class="pill ${(I.REC[r.recommendation] || ["", ""])[1]}">${esc((I.REC[r.recommendation] || [r.recommendation])[0])}</span>${r.range ? ` <b>EGP ${r.range[0].toLocaleString("en-US")}–${r.range[1].toLocaleString("en-US")}</b> (to restore ${Math.round(cur.targetMargin * 100) - 2}–${Math.round(cur.targetMargin * 100)}% margin)` : ""}</p><ul class="small">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${r.gaps.length ? `<div class="note warn small"><b>Data gaps:</b> ${r.gaps.map(esc).join(" · ")}</div>` : ""}<p class="tiny muted">Suggested effective date ${esc(cur.effectiveSuggested)} if an administrator approves a change. Issued quotations keep their prices.</p>`)}
        ${S("Cost drivers", r.drivers.length ? `<div class="tl">${r.drivers.map((x) => `<div><span class="num small">${x.d > 0 ? "+" : ""}${egp(x.d)}</span><span class="small">${esc(x.why)}</span></div>`).join("")}</div>` : `<p class="small muted">No priced movements since the cost-model baseline.</p>`)}
        <div class="cd-acts"><button class="btn ghost sm" id="pc-pb">Open Product Pricing</button></div>`, (d) => { $("#pc-pb", d).onclick = () => { DPCeo2.closeDrawer(); U.go("admin", { tab: "prices" }); }; }, { label: "Pricing" }); }));
  }

  /* ---------------- news ---------------- */
  async function newsTab(B) {
    const [list, st, sched] = await Promise.all([I.news(), I.jobsState(), I.schedule()]), s = st.news || {}, f = M.newsF, nx = I.nextRun(((sched.jobs || {}).news || {}).cron);
    const rows = list.filter((n) => !f || n.area === f || (f === "open" && n.status !== "dismissed"));
    B.innerHTML = box("Industry &amp; Regulatory News", `<p class="small mc-muted">Last updated ${s.lastSuccess ? esc(dt(s.lastSuccess)) : "never"} · next check: ${nx ? esc(dt(nx)) : "on request (Run now)"}. This window refreshes when research runs; it is not a live feed. An AI summary is not legal or customs advice — items flagged for professional confirmation need the official source checked by a qualified person.</p>
      <div class="chips">${[["", "All"], ["open", "Open"], ["shipping", "Shipping"], ["customs", "Customs & imports"], ["regulatory", "Government & regulation"], ["materials", "Materials & supply"], ["procurement", "Procurement"], ["market", "Market"]].map(([k, l]) => `<button type="button" class="chip${f === k ? " is-on" : ""}" data-nf="${k}">${esc(l)}</button>`).join("")}</div>
      ${rows.length ? `<div class="mc-news">${rows.map((n) => `<article class="mc-n ${n.impactLevel} ${n.status === "dismissed" ? "dim" : ""}"><div class="row between"><span class="pill ${n.sourceType === "official" ? "ok" : n.sourceType === "unconfirmed" ? "err" : "info"}">${esc(n.verification)}</span><span class="tiny mc-muted">${esc(n.area)} · impact ${esc(n.impactLevel)}</span></div>
        <h4>${esc(n.headline)}</h4><p class="small">${esc(n.summary || "")}</p>${n.whyItMatters ? `<p class="small"><b>Why it matters:</b> ${esc(n.whyItMatters)}</p>` : ""}${n.impact ? `<p class="small"><b>Potential impact:</b> ${esc(n.impact)}</p>` : ""}${(n.relevantTo || []).length ? `<p class="tiny mc-muted">Relevant to: ${n.relevantTo.map(esc).join(", ")}</p>` : ""}
        ${n.nextStep ? `<p class="small"><b>Next step:</b> ${esc(n.nextStep)}</p>` : ""}${n.needsProfessional ? `<p class="tiny warn-t">Requires professional confirmation against the official source.</p>` : ""}
        <div class="row between"><span class="tiny mc-muted"><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.source)}</a> · published ${esc(n.publishedAt || "unknown")} · found ${esc(dt(n.discoveredAt))}</span>${n.status !== "dismissed" ? `<button class="btn ghost xs mc-btn" data-dis="${esc(n.id)}">Dismiss</button>` : ""}</div></article>`).join("")}</div>` : `<p class="small mc-muted">No items${f ? " in this filter" : " yet — run the Market News Monitor"}.</p>`}`,
      `${fresh(s.lastSuccess, 48)} <button class="btn ghost xs mc-btn" data-run="news">Check now…</button>`);
    $$("[data-nf]", B).forEach((b) => (b.onclick = () => { M.newsF = b.dataset.nf; newsTab(B); }));
    $$("[data-dis]", B).forEach((b) => (b.onclick = async () => { await I.setNewsStatus(b.dataset.dis, "dismissed"); newsTab(B); }));
    $$("[data-run]", B).forEach((b) => (b.onclick = () => runDialog([b.dataset.run])));
  }

  /* ---------------- weekly reports ---------------- */
  async function weeklyTab(B) {
    const list = await I.reports("w"); if (!M.wk || !list.some((w) => w.id === M.wk)) M.wk = list[0] ? list[0].id : null;
    const w = list.find((x) => x.id === M.wk), p = w && list.find((x) => x.id < w.id);
    const src = (s) => (s || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(host(x.url))}</a>`).join(" · ");
    B.innerHTML = box("Weekly Market Position Report", !w ? `<p class="small mc-muted">No report yet. Run the Weekly Market Position Report — it uses the saved opportunities and sourced research.</p>` : `
      <div class="row" style="gap:10px"><select class="in sm" id="wk-s">${list.map((x) => `<option value="${esc(x.id)}"${x.id === M.wk ? " selected" : ""}>${esc(x.week)} · ${esc(x.periodStart)} → ${esc(x.periodEnd)}</option>`).join("")}</select><span class="tiny mc-muted">created ${esc(dt(w.createdAt))}</span></div>
      <div class="mc-grid">${box("Executive summary", `<p class="small">${esc(w.executiveSummary)}</p>`, "", "wide")}
        ${box("This week vs last", `<div class="kcards sm"><div class="kc"><span class="eyebrow">Discovered</span><b class="num">${w.stats.discoveredThisWeek}</b><span class="tiny">${w.stats.discoveredPrevWeek} the week before</span></div><div class="kc"><span class="eyebrow">Not followed up</span><b class="num">${w.stats.notFollowedUp}</b><span class="tiny">older than 7 days, unassigned</span></div><div class="kc"><span class="eyebrow">Assigned, no update 7 d</span><b class="num">${w.stats.assignedNoUpdate7d}</b></div><div class="kc"><span class="eyebrow">High priority open</span><b class="num">${w.stats.highPriorityOpen}</b></div></div>${p ? `<p class="tiny mc-muted">Previous report ${esc(p.week)}: ${p.stats.discoveredThisWeek} discovered.</p>` : ""}`)}
        ${box("Important changes", (w.changes || []).length ? `<ul class="small">${w.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="small mc-muted">—</p>`)}
        ${box("1 · Verified facts", (w.facts || []).length ? `<ul class="small">${w.facts.map((x) => `<li>${esc(x.text)} <span class="tiny">${src(x.sources)}</span></li>`).join("")}</ul>` : `<p class="small mc-muted">No sourced facts.</p>`)}
        ${box("2 · Reasonable inferences", (w.inferences || []).length ? `<ul class="small">${w.inferences.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>` : `<p class="small mc-muted">—</p>`)}
        ${box("3 · Strategic recommendations", (w.recommendations || []).length ? `<div class="mc-recs">${w.recommendations.map((r) => `<div class="mc-rec"><b>${esc(r.title)}</b><span class="small"><b>Why:</b> ${esc(r.reason)}</span><span class="small"><b>Benefit:</b> ${esc(r.benefit)} · <b>Effort:</b> ${esc(r.effort)} · <b>Risks:</b> ${esc(r.risks)}</span><span class="small"><b>Next step:</b> ${esc(r.nextStep)} — ${esc(r.owner || "—")} by ${esc(r.deadline || "—")}</span>${(r.evidence || []).length ? `<span class="tiny">Evidence: ${src(r.evidence)}</span>` : ""}${(r.oppIds || []).map((id) => `<button class="linkbtn tiny" data-opp="${esc(id)}">opportunity</button>`).join(" ")}</div>`).join("")}</div>` : `<p class="small mc-muted">—</p>`, "", "wide")}
        ${box("Threats and risks", (w.threats || []).length ? `<ul class="small">${w.threats.map((x) => `<li>${esc(x.text)} <span class="tiny">${src(x.sources)}</span></li>`).join("")}</ul>` : `<p class="small mc-muted">—</p>`)}
        ${box("4 · Unknowns and data gaps", (w.unknowns || []).length ? `<ul class="small">${w.unknowns.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>` : `<p class="small mc-muted">—</p>`)}
        ${box("Confidence and data quality", `<p class="small">${esc(w.dataQuality || "—")}</p><p class="tiny mc-muted">Market share, competitor sales and rankings are not stated unless a cited source supports them.</p>`)}
        ${box("Sources", (w.sources || []).length ? `<ol class="small">${w.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join("")}</ol>` : `<p class="small mc-muted">—</p>`, "", "wide")}</div>`,
      `<button class="btn ghost xs mc-btn" data-run="weekly">New report…</button>`);
    const s = $("#wk-s"); if (s) s.onchange = (e) => { M.wk = e.target.value; weeklyTab(B); };
    $$("[data-opp]", B).forEach((b) => (b.onclick = () => DPIntelUI.oppPanel(b.dataset.opp)));
    $$("[data-run]", B).forEach((b) => (b.onclick = () => runDialog([b.dataset.run])));
  }

  /* ---------------- automation health ---------------- */
  async function autoTab(B) {
    const [st, reqs, sweep, runsL, sched] = await Promise.all([I.jobsState(), I.requests(), DPStore.tryGet("sweep/state"), I.runs(20), I.schedule()]);
    const trig = (App.config.settings.intel || {}).triggerId || ((sched.tasks || {}).research);
    const waitBy = Object.fromEntries((((sweep || {}).research || {}).waiting || []).map((w) => [w.id, w]));
    const reqWhy = (r) => (["queued", "running"].includes(r.status) && waitBy[r.id]) || null;
    const stalled = (r) => r.status === "running" && !(Date.now() - Date.parse(r.startedAt) < 90 * 60e3);
    const reqActs = (r) => [(r.status === "queued" && reqWhy(r) && ["expired", "no-time", "start-failed"].includes(reqWhy(r).reason)) || r.status === "failed" ? `<button class="btn ghost xs mc-btn" data-rq-again="${esc(r.id)}">Queue again</button>` : "",
      stalled(r) ? `<button class="btn ghost xs mc-btn" data-rq-fail="${esc(r.id)}">Mark failed</button>` : "",
      r.status === "queued" ? `<button class="btn ghost xs mc-btn" data-rq-cancel="${esc(r.id)}">Cancel</button>` : ""].join(" ");
    B.innerHTML = `${box("Automation Health", `<div class="tablewrap"><table class="mtable mc-t"><thead><tr><th>Job</th><th>Runs as</th><th>Schedule</th><th>Last successful run</th><th>Last attempt</th><th>Next run</th><th>Status</th><th class="r">Created / updated</th><th>Errors</th></tr></thead><tbody>
      ${I.JOBS.map(([k]) => { const h = I.health(k, st, sweep, reqs, sched); return `<tr><td><b>${esc(h.label)}</b></td><td class="small">${esc(h.kind)}</td><td class="small">${esc(h.schedule)}</td><td class="small">${h.lastSuccess ? esc(dt(h.lastSuccess)) + `<div class="tiny mc-muted">${esc(ago(h.lastSuccess))}</div>` : "—"}</td><td class="small">${h.lastAttempt ? esc(dt(h.lastAttempt)) : "—"}</td><td class="small">${h.next ? esc(dt(h.next)) : "on request"}</td>
        <td><span class="pill ${h.status === "ok" ? "ok" : ["failed", "stale"].includes(h.status) ? "err" : ["queued", "running"].includes(h.status) ? "info" : "warn"}">${esc(h.status)}</span>${h.failures ? `<div class="tiny">${h.failures} failure(s) in a row</div>` : ""}</td><td class="r num small">${h.created != null ? h.created : "—"} / ${h.updated != null ? h.updated : "—"}</td><td class="tiny">${esc(h.error || "")}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="tiny mc-muted">Research runs as Claude scheduled tasks on the schedules shown (times in your device's zone), plus “Run now” requests. A request is processed by the X FORCE research task${trig ? "" : " — <b>not configured yet</b>"}; if this page cannot start it, it runs with the next daily research run (the hourly sweep also tries to start it sooner, but that is not guaranteed). A failed run keeps the last good data and is shown here. Two requests for the same job never run at once, and every record is de-duplicated, so a repeated run cannot create duplicate opportunities, reports or notifications.</p>`)}
      ${box("Run requests", reqs.length ? `<div class="tablewrap"><table class="mtable mc-t"><thead><tr><th>Requested</th><th>By</th><th>Jobs</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>${reqs.slice(0, 20).map((r) => `<tr><td class="small">${esc(dt(r.at))}</td><td class="small">${esc(DPAuth.nameSync(r.by) || "—")}</td><td class="small">${(r.jobs || []).map((j) => esc(I.jobLabel(j))).join(", ")}</td><td><span class="pill ${r.status === "done" ? "ok" : r.status === "failed" ? "err" : "info"}">${esc(r.status)}</span>${r.finishedAt ? `<div class="tiny mc-muted">${esc(dt(r.finishedAt))}</div>` : ""}</td><td class="tiny">${esc(r.result || r.fireNote || "")}${reqWhy(r) ? `<div class="tiny"><b>Hourly sweep:</b> ${esc(reqWhy(r).detail)}</div>` : ""}</td><td>${reqActs(r)}</td></tr>`).join("")}</tbody></table></div>
      <p class="tiny mc-muted">A request is started automatically between 10 minutes and 2 days after it was made. An older request, one the research task never picked up (3 attempts), or a run that failed waits here until an administrator queues it again — it is never started or marked complete on its own.</p>` : `<p class="small mc-muted">No requests yet.</p>`)}
      ${box("Recent research runs", runsL.length ? `<div class="tl">${runsL.map((r) => `<div><span class="tiny mc-muted">${esc(dt(r.at))}</span><span class="small">${esc(r.label || r.job)} — ${r.ok ? `${r.created || 0} new, ${r.updated || 0} updated` : `<b>failed</b>: ${esc(r.error || "")}`}</span></div>`).join("")}</div>` : `<p class="small mc-muted">No runs yet.</p>`)}`;
    const act = (key, fn, done) => $$(`[data-${key}]`, B).forEach((b) => (b.onclick = async () => { b.disabled = true;
      try { const r = await fn(b.getAttribute(`data-${key}`)); U.toast(done(r), { ms: 8000 }); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); } autoTab(B); }));
    act("rq-again", I.requeue, (r) => r.fired ? `Research started: ${r.jobs.map(I.jobLabel).join(", ")}.` : `Queued again (${r.jobs.map(I.jobLabel).join(", ")}). ${r.why} The hourly sweep starts it after 10 minutes.`);
    act("rq-fail", I.markFailed, () => "Marked failed. You can queue it again.");
    act("rq-cancel", I.cancelRequest, () => "Request cancelled.");
  }

  /* ---------------- run dialog ---------------- */
  async function runDialog(pre = null) {
    const jobs = I.JOBS.filter(([, , t]) => t === "research");
    const f = await U.form("Run research now", jobs.map(([k, l]) => ({ id: k, label: l, type: "check", value: pre ? pre.includes(k) : k !== "weekly" })), { submit: "Start", intro: "Each run uses Claude to search reliable sources (bounded number of searches), then stores only sourced, de-duplicated results. It takes several minutes; this page shows the status in Automation Health." });
    if (!f) return; const sel = jobs.map(([k]) => k).filter((k) => f[k]); if (!sel.length) return;
    try { const r = await I.requestRun(sel);
      U.toast(r.fired ? `Research started: ${r.jobs.map(I.jobLabel).join(", ")}.${r.skipped.length ? " Already running: " + r.skipped.map(I.jobLabel).join(", ") + "." : ""}` : `Request saved (${r.jobs.map(I.jobLabel).join(", ")}). ${r.why} It will run with the next daily research run (06:17 Cairo), or sooner if the hourly sweep can start it.`, { ms: 9000 });
      if (M.tab === "auto") renderMission(); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); }
  }
  /** Build and save the pricing assessment for a month from saved data only (no AI, no web). */
  async function buildPricing(month, { auto = false } = {}) {
    const [model, mats, snaps] = await Promise.all([I.costModel(), I.materials(), I.fxSnapshots()]);
    if (!model) throw new Error("No product cost model is imported (Admin › Settings › Market Intelligence).");
    const names = {}; (root.DP_PRODUCTS || []).forEach((p) => (names[p.code] = p.name));
    const rep = I.pricingReport({ pricebook: App.config.pricebook, costs: App.costs || {}, model, mats, fx: I.fxView(snaps), targetMargin: ((App.intelCfg || {}).targetMargin || 40) / 100, staleDays: (App.config.settings.intel || {}).materialStaleDays || 45, month, names });
    if (auto) rep.auto = true;
    return I.savePricingReport(rep);
  }
  /** Monthly schedule: the first administrator session of a month generates that month's report once (deterministic — a
   *  repeated call finds the saved report and does nothing). The report recommends; it never changes a price. */
  async function autoMonthly() {
    if (!U.isAdmin()) return null; const month = new Date().toISOString().slice(0, 7);
    if (await DPStore.tryGet(`mix/reports/p/${month}`)) return null;
    if (!(await I.costModel())) return null;
    const rep = await buildPricing(month, { auto: true });
    const ceo = root.DPAskCeo ? DPAskCeo.ceoUid() : null;
    if (ceo && root.DPNotify) await DPNotify.deliver(ceo, { id: `pricing-${month}`, type: "info", title: "Monthly Pricing Intelligence Report ready", body: `${rep.summary.products} products assessed · ${rep.summary.urgent} urgent, ${rep.summary.increase} to consider an increase, ${rep.summary.quotes} need supplier quotes.`, link: { view: "mission", opts: { tab: "pricing" } } }).catch(() => {});
    return rep;
  }
  U.register("mission", renderMission);
  root.DPMission = { renderMission, runDialog, buildPricing, autoMonthly };
})(typeof self !== "undefined" ? self : this);
