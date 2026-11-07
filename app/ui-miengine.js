/* X FORCE — Market Intelligence 2.0, Phase 1: the administrators' screen (Data Readiness, product capability, company names,
   job ledger, the switch). Reached from Mission Control → Automation Health. Nothing here is visible to other roles. */
/* global DPUI, DPStore, DPAuth, DPMiEngine */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, E = DPMiEngine;
  const S = { tab: "ready", counts: null };
  const TABS = [["ready", "Data readiness"], ["cap", "Product capability"], ["names", "Company names"], ["jobs", "Job ledger"]];
  const STATE = { ready: ["Ready", "ok"], partial: ["Partly", "warn"], none: ["Not yet", "err"] };
  const num = (x) => (Number(x) || 0).toLocaleString("en-US");
  const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  const loadCfg = async () => E.cfgOf(await DPStore.tryGet("mix/enginecfg"));

  /** New settings version: the current one is kept in mix/enginev, and the change is audited with its reason. */
  async function saveCfg(patch, reason) {
    if (!U.isAdmin()) throw new Error("Administrators only."); if (!String(reason || "").trim()) throw new Error("Give a reason for the change.");
    const prev = await loadCfg(), at = new Date().toISOString(), version = (prev.version || 0) + 1;
    const next = Object.assign({}, prev, patch, { version, updatedAt: at, updatedBy: DPAuth.A.me.id });
    if (prev.version) await DPStore.set(`mix/enginev/v/${prev.version}`, Object.assign({}, prev, { replacedAt: at, replacedBy: DPAuth.A.me.id }));
    await DPStore.set("mix/enginecfg", next);
    await DPAuth.auditLog("Market Intelligence settings changed", { kind: "mi", reason, detail: `Version ${version}`, before: { capability: prev.capability }, after: { capability: next.capability } }).catch(() => {});
    return next;
  }
  /** The switch lives in config/settings. It is re-read first, so nothing else in the settings is overwritten. */
  async function setSwitch(on, reason) {
    if (!U.isAdmin()) throw new Error("Administrators only."); if (!String(reason || "").trim()) throw new Error("Give a reason.");
    const cur = (await DPStore.getConfig("settings")) || {};
    await DPStore.setConfig("settings", Object.assign({}, cur, { miEngine: !!on }));
    App.config.settings.miEngine = !!on;
    await DPAuth.auditLog(on ? "Market Intelligence engine switched on" : "Market Intelligence engine switched off", { kind: "mi", reason }).catch(() => {});
  }

  async function render() {
    const V = $("#view-miengine"), on = !!App.config.settings.miEngine;
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Market Intelligence 2.0 · Administrators only</span><h1>Engine <em>foundation</em></h1>
        <p class="lead small">What the records can support today, what Dupedia sells, and the switch for the new research rules.</p></div>
      <div class="row"><span class="pill ${on ? "ok" : "warn"}">Engine ${on ? "on" : "off"}</span><button class="btn ghost sm" id="me-sw">${on ? "Switch off…" : "Switch on…"}</button><button class="btn lime sm" id="me-mc">${U.svg("globe")} Mission Control</button></div></div>
      <div class="note small">${on ? "New research results use the corrected scoring and Arabic-safe matching. Records saved earlier keep their score." : "Off: research works exactly as before. Switching on affects only new research results: corrected word matching, Egypt and Saudi locations told apart, AI product labels add no points, a published project budget is no longer treated as Dupedia's value, and Arabic records stay separate."}</div>
      <div class="chips mi-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" class="chip${S.tab === k ? " is-on" : ""}" data-mt="${k}">${esc(l)}</button>`).join("")}</div>
      <div id="me-body"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $("#me-mc").onclick = () => U.go("mission", { tab: "auto" });
    $("#me-sw").onclick = async () => { const f = await U.form(on ? "Switch the engine off" : "Switch the engine on", [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { submit: on ? "Switch off" : "Switch on", intro: "Applies from the next research run. Saved records are not changed." }); if (!f) return; try { await setSwitch(!on, f.r); U.toast(on ? "Engine switched off." : "Engine switched on."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
    $$("[data-mt]", V).forEach((b) => (b.onclick = () => { S.tab = b.dataset.mt; render(); }));
    const B = $("#me-body");
    try { await ({ ready: readyTab, cap: capTab, names: namesTab, jobs: jobsTab })[S.tab](B); }
    catch (e) { B.innerHTML = `<div class="note err">Could not load (${esc(e.message || e.code)}).</div>`; }
  }

  /* ---------------- data readiness ---------------- */
  async function readyTab(B) {
    const [c, cfg] = await Promise.all([root.XFServer.miReadiness(), loadCfg()]); S.counts = c;
    const v = E.verdicts(c, cfg), box = (t, rows) => `<div class="card"><h3>${esc(t)}</h3><dl class="kv small">${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd class="num">${num(x)}</dd>`).join("")}</dl></div>`;
    B.innerHTML = `<div class="stack"><div class="card"><div class="row between"><h3>What can be calculated from your records</h3><span class="tiny muted">Read ${esc(dt(c.at))} · counts only, no names or money</span></div>
      <div class="tablewrap"><table class="mtable"><thead><tr><th>Measure</th><th>Status</th><th>Detail</th></tr></thead><tbody>${v.map((x) => `<tr><td class="small"><b>${esc(x.label)}</b></td><td><span class="pill ${STATE[x.state][1]}">${STATE[x.state][0]}</span></td><td class="small">${esc(x.text)}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="grid3">
      ${box("Salespeople and targets", [["Active salespeople", c.sellers.active], ["Own target this month", c.targets.individual], ["On the company default", c.targets.defaultOnly], ["With a sales profile", c.sellers.withProfile]])}
      ${box("Activity", [["All activities", c.acts.total], ["Calls", c.acts.calls], ["Calls with an outcome", c.acts.callsWithOutcome], ["Conversations", c.acts.conversations], ["Logged as meetings", c.acts.meetingsHeld], ["Outcome Meeting Scheduled", c.acts.meetingsScheduled], ["Site visits", c.acts.visits]])}
      ${box("Quotations and orders", [["Quotations issued", c.quotes.total], ["Linked to a lead", c.quotes.withLead], ["Accepted", c.quotes.accepted], ["Decided", c.quotes.decided], ["Orders", c.orders.total], ["Orders not cancelled", c.orders.live]])}
      ${box("Lead Mine", [["Leads", c.leads.total], ["Open", c.leads.open], ["Assigned", c.leads.assigned], ["With a source", c.leads.withSource], ["With product fit", c.leads.withFit], ["Verified contact", c.contacts.verified], ["Personal pipelines", c.crm.total], ["With stage history", c.crm.withHistory]])}
      ${box("Market research", [["Opportunities", c.opps.total], ["High priority", c.opps.high], ["Evidence verified", c.opps.verified], ["Single source", c.opps.singleSource], ["Unverified", c.opps.unverified], ["Assigned (old pipeline)", c.opps.assigned], ["Sales updates (old pipeline)", c.opps.legacyUpdates], ["Scored by the new rules", c.opps.newScore], ["Project Radar accounts", c.radar.accounts]])}
      ${box("Catalogue and calendar", [["Catalogue products in the app", (root.DP_PRODUCTS || []).length], ["Custom products added", c.catalog.customProducts], ["Dupedia Products pages", c.catalog.productPages], ["Price book items", c.catalog.priceBookItems], ["Closures in the calendar", c.catalog.holidaysListed]])}
      </div></div>`;
  }

  /* ---------------- product capability ---------------- */
  async function capTab(B) {
    const cfg = await loadCfg();
    B.innerHTML = `<div class="card stack"><div class="row between"><h3>What Dupedia really sells</h3><span class="tiny muted">Version ${cfg.version || "not saved yet"}${cfg.updatedAt ? ` · ${esc(dt(cfg.updatedAt))} by ${esc(DPAuth.nameSync(cfg.updatedBy) || "")}` : ""}</span></div>
      <p class="small muted">Stored and versioned now. Qualification starts using it in Phase 3. An undecided category counts as no product fit.</p>
      <div class="tablewrap"><table class="mtable"><thead><tr><th>Category</th><th>Status</th><th>What it means</th></tr></thead><tbody>${E.CATEGORIES.map(([k, l]) => `<tr><td class="small"><b>${esc(l)}</b></td><td><select class="in sm" style="min-width:150px" data-cap="${k}" aria-label="${esc(l)}">${Object.entries(E.STATUSES).map(([s, x]) => `<option value="${s}"${cfg.capability[k] === s ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></td><td class="small muted" data-capn="${k}">${esc(E.STATUSES[cfg.capability[k]].effect)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row"><button class="btn lime sm" id="cap-save">Save a new version…</button></div></div>`;
    $$("[data-cap]", B).forEach((s) => (s.onchange = () => { $(`[data-capn="${s.dataset.cap}"]`, B).textContent = E.STATUSES[s.value].effect; }));
    $("#cap-save").onclick = async () => { const capability = {}; $$("[data-cap]", B).forEach((s) => (capability[s.dataset.cap] = s.value)); const f = await U.form("Save product capability", [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { submit: "Save" }); if (!f) return; try { await saveCfg({ capability }, f.r); U.toast("Saved."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
  }

  /* ---------------- company names ---------------- */
  async function namesTab(B) {
    const rows = (await DPStore.tryList("mix/alias/a")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(a.canonical).localeCompare(String(b.canonical)));
    B.innerHTML = `<div class="card stack"><div class="row between"><h3>Company names in English and Arabic</h3><button class="btn lime sm" id="al-add">${U.svg("plus")} Add a company</button></div>
      <p class="small muted">Results that use any of these names count as the same organisation, which stops duplicates when one source writes a name in Arabic and another in English.</p>
      ${rows.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Main name</th><th>Also known as</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td class="small"><b>${esc(r.canonical)}</b></td><td class="small"><bdi>${(r.names || []).map(esc).join(" · ")}</bdi></td><td class="r"><button class="btn ghost xs" data-ale="${esc(r.id)}">Edit</button> <button class="btn ghost xs" data-ald="${esc(r.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No names added yet.</p>`}</div>`;
    const edit = async (r) => { const f = await U.form(r ? "Edit company names" : "Add a company", [{ id: "c", label: "Main name", required: true, value: r ? r.canonical : "" }, { id: "n", label: "Other names, one per line (Arabic welcome)", type: "textarea", value: r ? (r.names || []).join("\n") : "" }], { submit: "Save" }); if (!f) return;
      try { const id = r ? r.id : "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), names = String(f.n || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
        await DPStore.set(`mix/alias/a/${id}`, { canonical: f.c.trim(), names, updatedAt: new Date().toISOString(), updatedBy: DPAuth.A.me.id }); await DPAuth.auditLog("Company names changed", { kind: "mi", target: id, detail: f.c.trim() }).catch(() => {}); U.toast("Saved."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
    $("#al-add").onclick = () => edit(null);
    $$("[data-ale]", B).forEach((b) => (b.onclick = () => edit(rows.find((r) => r.id === b.dataset.ale))));
    $$("[data-ald]", B).forEach((b) => (b.onclick = async () => { const r = rows.find((x) => x.id === b.dataset.ald); const f = await U.form("Remove company names", [{ id: "r", label: `Why remove ${r.canonical}?`, required: true }], { submit: "Remove" }); if (!f) return; try { await DPStore.del(`mix/alias/a/${r.id}`); await DPAuth.auditLog("Company names removed", { kind: "mi", target: r.id, reason: f.r, detail: r.canonical }).catch(() => {}); render(); } catch (e) { U.toast(e.message, { err: true }); } }));
  }

  /* ---------------- job ledger ---------------- */
  async function jobsTab(B) {
    const rows = (await DPStore.tryList("mix/disc/j")).map((x) => x.data).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100), P = { done: "ok", failed: "err", waiting: "warn", running: "info", queued: "" };
    B.innerHTML = `<div class="card stack"><h3>Job ledger</h3><p class="small muted">Every step of the discovery engine will be recorded here, including failures and their reasons. It stays empty until discovery arrives in Phase 2.</p>
      ${rows.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Created</th><th>Job</th><th>Status</th><th class="r">Tries</th><th>Next</th><th>Detail</th></tr></thead><tbody>${rows.map((j) => `<tr><td class="small">${esc(dt(j.createdAt))}</td><td class="small">${esc(j.kind)}<div class="tiny muted">${esc(j.key)}</div></td><td><span class="pill ${P[j.status] || ""}">${esc(j.status)}</span></td><td class="r num">${j.tries || 0}/${j.maxTries || 0}</td><td class="small">${["queued", "waiting"].includes(j.status) ? esc(dt(j.nextAt)) : "—"}</td><td class="small muted">${esc(j.error || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No jobs yet.</p>`}</div>`;
  }

  U.register("miengine", render);
  root.DPMiEngineUI = { render };
})(typeof self !== "undefined" ? self : this);
