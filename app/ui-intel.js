/* X FORCE 1.1 (Dupedia) — Market Intelligence (all authorised staff). Evidence first: every opportunity shows its source,
   publication and discovery dates, when it was last checked, its verification status and the reasons behind its score.
   Sales see and update the opportunities assigned to them; administrators review, verify, prioritise and assign. */
/* global DPUI, DPShell, DPStore, DPAuth, DPIntel, DPCeo2 */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, I = DPIntel;
  const F = { tab: "new", q: "", cat: "", kind: "", sort: "score", loaded: null };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  const ago = (iso) => { if (!iso) return "never"; const h = (Date.now() - Date.parse(iso)) / 3600e3; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const TABS = [["new", "New"], ["high", "High priority"], ["verified", "Recently verified"], ["assigned", "Assigned to sales"], ["mine", "Assigned to me"], ["followups", "Follow-ups due"], ["tenders", "Tenders"], ["partners", "Partnerships"], ["market", "Market news & trends"], ["all", "All"], ["history", "Research history"]];
  const CAT = { developer: "Real estate developer", compound: "Residential compound", school: "School", nursery: "Nursery / education", hotel: "Hotel", resort: "Resort", coastal: "Beach / coastal", club: "Sports club", fec: "Entertainment centre", amusement: "Amusement park",
    waterpark: "Water park", public: "Public sector", landscape: "Landscape / public space", mall: "Shopping mall", hospitality: "Hospitality refurbishment", tender: "Tender", partner: "Partner", distributor: "Distributor / reseller", oem: "OEM / manufacturer", exhibition: "Exhibition / event",
    association: "Business association", supplier: "Supplier", media: "Media / case study", competitor: "Competitor", trend: "Product trend", procurement: "Procurement", supply: "Supply / materials", other: "Other" };

  function filt(o) {
    const st = I.shownStatus(o), today = new Date().toISOString().slice(0, 10), me = DPStore.st.userId;
    switch (F.tab) {
      case "new": return ["new", "review"].includes(st);
      case "high": return o.priority === "high" && !I.CLOSED.includes(st);
      case "verified": return o.evidence === "verified" && o.verifiedAt && Date.now() - Date.parse(o.verifiedAt) < 30 * 864e5;
      case "assigned": return !!o.assignedTo && !I.CLOSED.includes(st);
      case "mine": return o.assignedTo === me;
      case "followups": return o.followUp && o.followUp <= today && !I.CLOSED.includes(st);
      case "tenders": return o.kind === "tender";
      case "partners": return o.kind === "partnership";
      case "market": return ["market", "competitor"].includes(o.kind);
      default: return true;
    }
  }
  async function renderIntel(opts = {}) {
    const V = $("#view-intel"), admin = U.isAdmin(); if (opts.tab) F.tab = opts.tab;
    if (!admin && F.tab === "new" && U.role() === "employee" && !opts.tab) F.tab = "mine";
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Market Intelligence</span><h1>Opportunities <em>radar</em></h1><p class="lead small">Projects, tenders, partners and market changes found by research, each with its source and verification status. An AI assessment is not a verified fact: check the source before you rely on it.</p></div>
      <div class="row">${admin ? `<button class="btn ghost sm" id="mi-add">${U.svg("plus")} Add opportunity</button><button class="btn lime sm" id="mi-mc">${U.svg("globe")} Mission Control</button>` : ""}</div></div>
      <div id="mi-status" class="mi-status"></div>
      <div class="chips mi-tabs" role="tablist">${TABS.filter(([k]) => admin || !["history"].includes(k)).map(([k, l]) => `<button type="button" class="chip${F.tab === k ? " is-on" : ""}" data-t="${k}">${esc(l)}<em data-c="${k}"></em></button>`).join("")}</div>
      <div class="filters"><div class="search" style="width:260px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="mi-q" placeholder="Search title, organisation, location" value="${esc(F.q)}"></div>
        <select class="in sm" id="mi-cat"><option value="">All customer categories</option>${Object.entries(CAT).map(([k, l]) => `<option value="${k}"${F.cat === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <select class="in sm" id="mi-sort">${[["score", "Highest score"], ["new", "Newest found"], ["pub", "Newest published"], ["checked", "Least recently checked"]].map(([k, l]) => `<option value="${k}"${F.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div id="mi-list"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $$("[data-t]", V).forEach((b) => (b.onclick = () => { F.tab = b.dataset.t; renderIntel(); }));
    const add = $("#mi-add"); if (add) add.onclick = addDialog; const mc = $("#mi-mc"); if (mc) mc.onclick = () => U.go("mission");
    $("#mi-q").oninput = (e) => { F.q = e.target.value; draw(); }; $("#mi-cat").onchange = (e) => { F.cat = e.target.value; draw(); }; $("#mi-sort").onchange = (e) => { F.sort = e.target.value; draw(); };
    let opps = [], st = {}, reqs = [];
    try { if (admin) await I.syncSalesUpdates().catch(() => 0); [opps, st, reqs] = await Promise.all([I.listOpps(), I.jobsState(), admin ? I.requests() : Promise.resolve([])]); }
    catch (e) { $("#mi-list").innerHTML = `<div class="note err">Could not load (${esc(e.message || e.code)}).</div>`; return; }
    const sch = await I.schedule().catch(() => ({ jobs: {} })); F.nextOpp = I.nextRun(((sch.jobs || {}).opportunities || {}).cron);
    F.loaded = opps; statusBar(st, reqs);
    for (const [k] of TABS) { const c = $(`[data-c="${k}"]`); if (c && k !== "all" && k !== "history") { const save = F.tab; F.tab = k; const n = opps.filter(filt).length; F.tab = save; c.textContent = n ? " " + n : ""; } }
    App.badges = Object.assign(App.badges || {}, { intel: opps.filter((o) => o.assignedTo === DPStore.st.userId && ["assigned"].includes(I.shownStatus(o))).length }); H.rail();
    if (F.tab === "history") return history();
    draw();
    if (opts.opp) oppPanel(opts.opp);
  }
  function statusBar(st, reqs) {
    const box = $("#mi-status"); if (!box) return; const o = st.opportunities || {}, open = (reqs || []).find((r) => (r.jobs || []).includes("opportunities") && ["queued", "running"].includes(r.status));
    box.innerHTML = `<div class="row" style="gap:14px;flex-wrap:wrap"><span class="small"><b>Last successful update:</b> ${o.lastSuccess ? `${esc(dt(o.lastSuccess))} (${esc(ago(o.lastSuccess))})` : "not run yet"}</span><span class="small"><b>Next run:</b> ${open ? `<span class="pill info">${esc(open.status)}</span> requested ${esc(ago(open.at))}` : (F.nextOpp ? esc(dt(F.nextOpp)) + " (daily schedule)" : "on request")}</span>
      ${o.status === "failed" ? `<span class="pill err">Last run failed: ${esc(o.error || "see research history")}</span>` : ""}${o.lastSuccess && Date.now() - Date.parse(o.lastSuccess) > 7 * 864e5 ? `<span class="pill warn">Older than a week — run a new search</span>` : ""}</div>`;
  }
  function sortRows(rows) {
    const k = F.sort; return rows.sort((a, b) => k === "new" ? String(b.discoveredAt).localeCompare(String(a.discoveredAt)) : k === "pub" ? String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")) : k === "checked" ? String(a.lastChecked || "").localeCompare(String(b.lastChecked || "")) : (b.score || 0) - (a.score || 0));
  }
  function draw() {
    const box = $("#mi-list"); if (!box || !F.loaded) return; const q = F.q.trim().toLowerCase();
    const rows = sortRows(F.loaded.filter(filt).filter((o) => (!F.cat || o.category === F.cat) && (!q || [o.title, o.organization, o.location, o.description].join(" ").toLowerCase().includes(q))));
    if (!rows.length) { box.innerHTML = `<div class="card empty"><b>${F.loaded.length ? "Nothing in this view." : "No opportunities yet."}</b><span class="small muted">${F.loaded.length ? "Try another tab or filter." : U.isAdmin() ? "Start a research run from Mission Control (Run now), or add one you heard about." : "Research results appear here once the CEO runs the opportunity search."}</span></div>`; return; }
    box.innerHTML = `<div class="opps">${rows.map((o) => { const st = I.shownStatus(o), ev = I.EVIDENCE[o.evidence] || ["Unverified", "err"]; return `<button type="button" class="opp" data-o="${esc(o.id)}">
      <span class="sc ${o.priority || ""}" title="Opportunity score (explainable, not a probability of winning)">${o.score != null ? o.score : "—"}</span>
      <span class="ob"><b>${esc(o.title)}</b><span class="small muted">${esc([o.organization, o.location, CAT[o.category] || o.category].filter(Boolean).join(" · "))}</span>
        <span class="row" style="gap:6px;margin-top:4px"><span class="pill ${["won"].includes(st) ? "ok" : ["lost", "rejected", "expired"].includes(st) ? "err" : "info"}">${esc(I.STATUS_LABEL[st] || st)}</span><span class="pill ${ev[1]}">${esc(ev[0])}</span>${o.needsApproval ? `<span class="pill warn">Needs approval</span>` : ""}${o.kind === "tender" ? `<span class="pill">Tender${o.deadline ? " · " + esc(o.deadline.date) : ""}</span>` : ""}${o.assignedTo ? `<span class="pill">${esc(DPAuth.nameSync(o.assignedTo) || "assigned")}</span>` : ""}</span></span>
      <span class="om tiny muted">${o.sourceUrl ? esc(host(o.sourceUrl)) : "no source"}<br>published ${esc(o.publishedAt || "unknown")}<br>checked ${esc(ago(o.lastChecked))}</span></button>`; }).join("")}</div>`;
    $$("[data-o]", box).forEach((b) => (b.onclick = () => oppPanel(b.dataset.o)));
  }
  async function history() {
    const box = $("#mi-list"), rs = await I.runs(60);
    box.innerHTML = rs.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>When</th><th>Job</th><th>Result</th><th class="r">New</th><th class="r">Updated</th><th>Notes</th></tr></thead><tbody>${rs.map((r) => `<tr><td class="small">${esc(dt(r.at))}</td><td class="small">${esc(r.label || r.job)}</td><td><span class="pill ${r.ok ? "ok" : "err"}">${r.ok ? "OK" : "Failed"}</span>${r.error ? `<div class="tiny muted">${esc(r.error)}</div>` : ""}</td><td class="r num">${r.created || 0}</td><td class="r num">${r.updated || 0}</td><td class="tiny muted">${(r.notes || []).slice(0, 4).map(esc).join("<br>")}</td></tr>`).join("")}</tbody></table></div></div>` : `<div class="card empty small">No research runs yet.</div>`;
  }

  /* ---------------- opportunity record ---------------- */
  async function oppPanel(id) {
    const o = (F.loaded || []).find((x) => x.id === id) || (await I.getOpp(id)); if (!o) return U.toast("Opportunity not found.", { err: true });
    const admin = U.isAdmin(), mine = o.assignedTo === DPStore.st.userId, st = I.shownStatus(o), ev = I.EVIDENCE[o.evidence] || ["Unverified", "err"], S = DPCeo2.sec;
    const sales = DPAuth.A.directory.filter((r) => r.uid && r.active !== false && ["employee", "admin"].includes(DPAuth.baseOf(r.role)));
    DPCeo2.drawer(`<div class="cd-head"><div><span class="eyebrow">${esc(CAT[o.category] || o.category || "Opportunity")} · ${esc(o.kind || "")}</span><h2>${esc(o.title)}</h2><p class="small muted">${esc([o.organization, o.location].filter(Boolean).join(" · "))}</p>
        <div class="row" style="gap:6px"><span class="pill info">${esc(I.STATUS_LABEL[st] || st)}</span><span class="pill ${ev[1]}">${esc(ev[0])}</span>${o.needsApproval ? `<span class="pill warn">High impact — needs approval</span>` : ""}<span class="pill">${esc((o.priority || "—") + " priority")}</span></div></div><button class="btn ghost xs" data-close aria-label="Close">✕</button></div>
      ${S("Evidence", `<dl class="kv small"><dt>Source</dt><dd>${o.sourceUrl ? `<a href="${esc(o.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(o.sourceOrg || host(o.sourceUrl))}</a> <span class="tiny muted">(${esc(o.sourceClass || "")})</span>` : "None"}</dd><dt>Published</dt><dd>${esc(o.publishedAt || "unknown")}</dd><dt>Discovered</dt><dd>${esc(dt(o.discoveredAt))}</dd><dt>Last checked</dt><dd>${esc(dt(o.lastChecked))}</dd>
        <dt>Verification</dt><dd>${esc(o.evidenceNote || ev[0])}${o.verifiedBy ? ` — by ${esc(DPAuth.nameSync(o.verifiedBy))} ${esc(dt(o.verifiedAt))}` : ""}</dd><dt>Confidence</dt><dd>${esc(o.confidence || "—")}</dd></dl>
        ${(o.sources || []).length > 1 ? `<p class="small"><b>Other sources:</b> ${o.sources.slice(1).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(host(s.url))}</a>`).join(" · ")}</p>` : ""}
        ${(o.claims || []).length ? `<ul class="small claims">${o.claims.map((c) => `<li>${c.status === "sourced" ? "✔" : "?"} ${esc(c.text)}${c.sourceUrl ? ` <a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : ` <span class="tiny muted">unverified</span>`}</li>`).join("")}</ul>` : ""}
        ${(o.unverified || []).length ? `<div class="note warn small"><b>Still to confirm:</b> ${o.unverified.map(esc).join(" · ")}</div>` : ""}`)}
      ${S("Opportunity", `<p class="small">${esc(o.description || "—")}</p><dl class="kv small"><dt>Relevant Dupedia products</dt><dd>${esc((o.products || []).join(", ") || "—")}</dd>
        <dt>Estimated value</dt><dd>${o.estValue ? `${esc(H.money(Math.round(o.estValue.amount * 100), o.estValue.currency))} <span class="tiny muted">${esc(o.estValue.basis || "")} · <a href="${esc(o.estValue.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a></span>` : "Not published — not estimated"}</dd>
        <dt>Deadline</dt><dd>${o.deadline ? `${esc(o.deadline.date)} <a href="${esc(o.deadline.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : "None published"}</dd>
        <dt>Contact route</dt><dd>${o.contact ? `${esc(o.contact.text)} <a href="${esc(o.contact.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : o.orgWebsite ? `<a href="${esc(o.orgWebsite)}" target="_blank" rel="noopener noreferrer">${esc(host(o.orgWebsite))}</a>` : "Not found — do not guess contact details"}</dd>
        <dt>Recommended next action</dt><dd>${esc(o.nextAction || "—")}</dd><dt>Suggested contact strategy</dt><dd>${esc(o.contactStrategy || "—")}</dd>
        <dt>Responsible</dt><dd>${esc(o.assignedTo ? DPAuth.nameSync(o.assignedTo) : "Unassigned")}</dd><dt>Follow-up</dt><dd>${esc(o.followUp || "—")}</dd></dl>`)}
      ${S("Score " + (o.score != null ? o.score + "/100" : ""), (o.scoreParts || []).length ? `<div class="scoreparts">${o.scoreParts.map((p) => `<div><span class="small">${esc(p.label)}</span><span class="bar"><i style="width:${Math.round(p.pts / p.max * 100)}%"></i></span><b class="num small">${p.pts}/${p.max}</b><span class="tiny muted">${esc(p.why)}</span></div>`).join("")}</div><p class="tiny muted">An explainable ranking of fit and urgency from the stored evidence — not a statistically validated probability of winning.</p>` : `<p class="small muted">Not scored (added manually).</p>`, false)}
      ${S("Notes and history", `${(o.notes || []).length ? `<div class="tl">${o.notes.slice().reverse().map((n) => `<div><span class="tiny muted">${esc(dt(n.at))}</span><span>${esc(n.text)} <span class="muted">— ${esc(DPAuth.nameSync(n.by) || "")}</span></span></div>`).join("")}</div>` : ""}
        <div class="tl">${(o.history || []).slice().reverse().slice(0, 40).map((h) => `<div><span class="tiny muted">${esc(dt(h.at))}</span><span>${esc(h.action)}${h.detail ? " — " + esc(h.detail) : ""} <span class="muted">${esc(h.by === "research" ? "research task" : DPAuth.nameSync(h.by) || "")}</span></span></div>`).join("")}</div>`, false)}
      <div class="cd-acts stack">
        ${admin ? `<div class="row"><select class="in sm" id="op-st">${I.STATUS.map(([k, l]) => `<option value="${k}"${o.status === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select><button class="btn ghost sm" id="op-sts">Set status…</button>
          <select class="in sm" id="op-pr">${["high", "medium", "low"].map((k) => `<option${o.priority === k ? " selected" : ""}>${k}</option>`).join("")}</select><button class="btn ghost sm" id="op-prs">Set priority…</button></div>
          <div class="row"><select class="in sm" id="op-as"><option value="">Assign to…</option>${sales.map((r) => `<option value="${esc(r.uid)}"${o.assignedTo === r.uid ? " selected" : ""}>${esc(DPAuth.nameSync(r.uid))}</option>`).join("")}</select><input class="in sm" type="date" id="op-fu" value="${esc(o.followUp || "")}" title="Follow-up date"><button class="btn lime sm" id="op-asg">Assign</button></div>` : ""}
        ${mine && !admin ? `<div class="row"><select class="in sm" id="op-sst"><option value="">Update status…</option>${I.SALES_STATUSES.map((k) => `<option value="${k}">${esc(I.STATUS_LABEL[k])}</option>`).join("")}</select><input class="in sm" type="date" id="op-sfu" value="${esc(o.followUp || "")}" title="Follow-up date"><button class="btn lime sm" id="op-sup">Save</button></div>` : ""}
        ${admin || mine ? `<div class="row"><input class="in sm" id="op-note" placeholder="Add a note" style="flex:1"><button class="btn ghost sm" id="op-addn">Add note</button></div>` : ""}<p class="small" id="op-err" style="color:var(--red)"></p></div>`, (d) => {
      const err = $("#op-err", d), done = async (msg) => { U.toast(msg); F.loaded = await I.listOpps().catch(() => F.loaded); draw(); oppPanel(id); };
      const run = (fn) => async () => { err.textContent = ""; try { await fn(); } catch (e) { err.textContent = e.message; } };
      const sts = $("#op-sts", d); if (sts) sts.onclick = run(async () => { const s = $("#op-st", d).value; const f = await U.form(`Set status: ${I.STATUS_LABEL[s]}`, [{ id: "n", label: s === "verified" ? "How was the evidence verified? (required)" : "Note (why)", type: "textarea", required: s === "verified" || s === "rejected" }], { submit: "Save" }); if (!f) return; await I.setStatus(id, s, f.n); done("Status saved."); });
      const prs = $("#op-prs", d); if (prs) prs.onclick = run(async () => { const f = await U.form("Change priority", [{ id: "r", label: "Reason", required: true }], { submit: "Save" }); if (!f) return; await I.setPriority(id, $("#op-pr", d).value, f.r); done("Priority saved."); });
      const asg = $("#op-asg", d); if (asg) asg.onclick = run(async () => { const u = $("#op-as", d).value; if (!u) throw new Error("Choose who follows it up."); await I.assign(id, u, { followUp: $("#op-fu", d).value || null }); done(`Assigned to ${DPAuth.nameSync(u)}. They have been notified.`); });
      const sup = $("#op-sup", d); if (sup) sup.onclick = run(async () => { const s = $("#op-sst", d).value || null, fu = $("#op-sfu", d).value || null; if (!s && fu === (o.followUp || null)) throw new Error("Choose a status or a new follow-up date."); await I.salesUpdate(id, { status: s, followUp: fu, note: $("#op-note", d) ? $("#op-note", d).value.trim() : "" }); done("Update saved. The CEO's office has been told."); });
      const an = $("#op-addn", d); if (an) an.onclick = run(async () => { await I.addNote(id, $("#op-note", d).value); done("Note added."); });
    }, { label: "Opportunity" });
  }
  async function addDialog() {
    const f = await U.form("Add an opportunity", [{ id: "title", label: "Title", required: true }, { id: "organization", label: "Organisation / project" }, { id: "location", label: "Location" },
      { id: "category", label: "Customer category", type: "select", options: Object.entries(CAT).map(([k, l]) => ({ value: k, label: l })) }, { id: "kind", label: "Type", type: "select", options: [["project", "Project"], ["tender", "Tender"], ["partnership", "Partnership"], ["market", "Market change"], ["competitor", "Competitor"]].map(([value, label]) => ({ value, label })) },
      { id: "sourceUrl", label: "Source link (if any)" }, { id: "description", label: "What you know", type: "textarea" }], { submit: "Add", intro: "Added as Newly Discovered. Without a source link it is marked unverified." });
    if (!f) return; try { const o = await I.addManual(f); U.toast("Opportunity added."); F.tab = "new"; await renderIntel(); oppPanel(o.id); } catch (e) { U.toast(e.message, { err: true }); }
  }
  U.register("intel", renderIntel);
  root.DPIntelUI = { renderIntel, oppPanel, CAT, ago, dt };
})(typeof self !== "undefined" ? self : this);
