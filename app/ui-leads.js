/* Dupedia Site Planner 2.1 — Lead Mine, My Leads, All Leads (administrators). */
/* global DPUI, DPShell, DPStore, DPAuth, DPLeads, DPSales */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, L = DPLeads;
  const F = { q: "", type: "", pri: "", contact: "", status: "", loc: "", sel: null, aq: "", aflt: "" };
  let cache = { leads: [], claims: {}, at: 0 };
  async function load(force) {
    if (!force && Date.now() - cache.at < 4000) return cache;
    const [leads, claims] = await Promise.all([L.listLeads(), L.claimsByLead()]);
    cache = { leads, claims, at: Date.now() }; return cache;
  }
  const pri = (l) => L.priority(l, App.config.settings);
  const own = (l) => L.ownership(l, cache.claims[l.id] || []);
  const ownerName = (uid) => (uid === DPStore.st.userId ? "You" : DPAuth.nameSync(uid) || "Another employee");
  const typeL = (k) => L.ORG_TYPES[k] || "Other";
  /** Time left on the 24-hour rule for the current owner. */
  function timerChip(o) { const ms = DPLeadOps.remaining(o); if (ms == null) return o && o.owner ? `<span class="timer">No time limit</span>` : ""; return `<span class="timer ${ms < 4 * 3600e3 ? "err" : ms < 10 * 3600e3 ? "warn" : ""}" title="Released automatically after ${DPLeadOps.timerCfg().hours} hours without logged activity">${esc(DPLeadOps.fmtRemaining(ms))}</span>`; }
  function contactBox(l) { const c = L.contactLabel(l); return `<div class="cl ${c.ok ? "ok" : ""}"><b>${esc(c.label)}</b><span class="muted">${esc(c.sub)}</span></div>`; }
  function srcList(l) { return (l.sources || []).length ? `<ul class="srcs small" style="margin:0;padding-left:18px">${l.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc((s.url || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</a>${s.date ? ` · ${esc(s.date)}` : ""}</li>`).join("")}</ul>` : `<p class="tiny muted">No source recorded.</p>`; }
  function filterBar(prefix) {
    return `<div class="filters"><div class="search" style="width:240px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="${prefix}-q" placeholder="Search organisation, project, city" value="${esc(F.q)}"></div>
      <select class="in sm" id="${prefix}-type"><option value="">All organisation types</option>${Object.entries(L.ORG_TYPES).map(([k, l]) => `<option value="${k}"${F.type === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <select class="in sm" id="${prefix}-pri"><option value="">All priorities</option>${["High", "Medium", "Low"].map((p) => `<option${F.pri === p ? " selected" : ""}>${p}</option>`).join("")}</select>
      <select class="in sm" id="${prefix}-contact"><option value="">Any contact status</option><option value="ok"${F.contact === "ok" ? " selected" : ""}>Contact Number &amp; Email Available</option><option value="research"${F.contact === "research" ? " selected" : ""}>Under Research</option></select>
      <select class="in sm" id="${prefix}-status"><option value="">Open leads</option><option value="available"${F.status === "available" ? " selected" : ""}>Not owned</option><option value="claimed"${F.status === "claimed" ? " selected" : ""}>Owned</option><option value="all"${F.status === "all" ? " selected" : ""}>Including archived</option></select>
      <input class="in sm" id="${prefix}-loc" placeholder="City / region" value="${esc(F.loc)}" style="width:150px"></div>`;
  }
  function bindFilters(prefix, rerender) { for (const k of ["q", "type", "pri", "contact", "status", "loc"]) { const el = $(`#${prefix}-${k}`); if (!el) continue; el[k === "q" || k === "loc" ? "oninput" : "onchange"] = (e) => { F[k] = e.target.value; rerender(); }; } }
  function passes(l) {
    const o = own(l), q = F.q.trim().toLowerCase();
    if (F.status !== "all" && ["archived", "merged", "inactive"].includes(l.status)) return false;
    if (F.status === "available" && (o.owner || o.conflict)) return false;
    if (F.status === "claimed" && !(o.owner || o.conflict)) return false;
    if (F.type && l.orgType !== F.type) return false;
    if (F.pri && pri(l) !== F.pri) return false;
    if (F.contact && (L.contactLabel(l).ok ? "ok" : "research") !== F.contact) return false;
    if (F.loc && !String(l.location || "").toLowerCase().includes(F.loc.toLowerCase())) return false;
    if (q && ![l.name, l.projects, l.location, l.evidence, l.productsFit].join(" ").toLowerCase().includes(q)) return false;
    return true;
  }
  const sortLeads = (list) => list.sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[pri(a)] - { High: 0, Medium: 1, Low: 2 }[pri(b)]) || ((+b.score || 0) - (+a.score || 0)) || a.name.localeCompare(b.name));

  /* ---------------- Lead Mine ---------------- */
  async function renderMine() {
    const V = $("#view-leads");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Lead Mine</span><h1>Find your next <em>project</em>.</h1><p class="lead small">Researched organisations with active or upcoming projects. Claim a lead to make it yours: nobody else can take it unless an administrator reassigns it.</p></div>
      <div class="row"><button class="btn ghost sm" id="lm-my">My Leads →</button></div></div>${filterBar("lm")}<div id="lm-list" class="lgrid"><div class="empty"><div class="spinner"></div></div></div>
      <p class="tiny muted">Contact details are shown only when verified with a source; everything else is “Under Research”. Lead information comes from public sources listed on each lead — check them before contacting anyone.</p></div>`;
    $("#lm-my").onclick = () => U.go("myleads");
    bindFilters("lm", list);
    try { await load(true); } catch (e) { $("#lm-list").innerHTML = `<div class="note err">Leads could not be loaded (${esc(e.message || e.code)}).</div>`; return; }
    list();
    function list() {
      const box = $("#lm-list"); if (!box) return; const rows = sortLeads(cache.leads.filter(passes));
      if (!cache.leads.length) { box.innerHTML = `<div class="card flat stack" style="grid-column:1/-1"><b>The Lead Mine is empty.</b><span class="small muted">${U.isAdmin() ? "Import the researched strategic account database from All Leads." : "An administrator has not added leads yet."}</span></div>`; return; }
      box.innerHTML = rows.map((l) => card(l)).join("") || `<div class="empty" style="grid-column:1/-1">No leads match these filters.</div>`;
      $$("[data-claim]", box).forEach((b) => (b.onclick = () => doClaim(b.dataset.claim, b)));
      $$("[data-view]", box).forEach((b) => (b.onclick = () => detail(b.dataset.view)));
    }
    function card(l) {
      const o = own(l), mine = o.owner === DPStore.st.userId, p = pri(l), closed = ["archived", "merged", "inactive"].includes(l.status);
      return `<article class="lcard${mine ? " mine" : ""}"><div class="row between"><span class="pri ${p}">${p} priority</span><span class="tiny muted">${l.score != null ? "Score " + esc(l.score) + "/100" : ""}</span></div>
        <h3>${esc(l.name)}</h3><div class="meta"><span class="pill">${esc(typeL(l.orgType))}</span>${l.location ? `<span class="pill">${esc(String(l.location).slice(0, 40))}</span>` : ""}</div>
        <p class="small" style="color:var(--fg2)">${esc(String(l.projects || "").slice(0, 170))}${String(l.projects || "").length > 170 ? "…" : ""}</p>${contactBox(l)}
        <div class="acts">${closed ? `<span class="pill">${esc(l.status === "merged" ? "Merged" : l.status === "inactive" ? "Inactive" : "Archived")}</span>` : o.conflict ? `<span class="pill err">Ownership under review</span>` : o.owner ? `<span class="pill ${mine ? "ok" : "dark"}">${mine ? "Yours" : "Claimed by " + esc(ownerName(o.owner))}</span>${mine ? timerChip(o) : ""}` : U.canWrite() && ["employee", "admin"].includes(U.role()) ? `<button class="btn lime sm" data-claim="${esc(l.id)}">Claim lead</button>` : ""}
          <button class="btn ghost sm" data-view="${esc(l.id)}">Details</button></div></article>`;
    }
  }
  async function doClaim(id, btn) {
    const l = cache.leads.find((x) => x.id === id);
    const ok = await U.ask(`Claim ${l ? l.name : "this lead"}?`, `<p>The lead becomes yours. Nobody else can take it while you work it; only an administrator can reassign it.</p><p><b>Log a qualifying activity (a call, e-mail, meeting or substantive research update) at least every ${DPLeadOps.timerCfg().hours} hours</b>, or the lead returns to the Lead Mine automatically. Contact-detail edits do not count.</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Claim lead", value: true }]);
    if (!ok) return; if (btn) btn.disabled = true;
    try { const r = await L.claim(id); await load(true);
      if (r.conflict) U.toast("Another claim reached the database at the same moment. The lead is locked until an administrator decides.", { err: true, ms: 9000 });
      else { U.toast(r.already ? "This lead is already yours." : "Lead claimed. It is now in My Leads.", { action: { label: "Open", fn: () => { F.sel = id; U.go("myleads"); } } }); }
    } catch (e) { U.toast(e.message || "The lead could not be claimed.", { err: true, ms: 7000 }); await load(true); }
    if (App.view === "leads") renderMine();
  }
  function detail(id) {
    const l = cache.leads.find((x) => x.id === id); if (!l) return; const o = own(l), q = l.qualification || {};
    U.openModal(`<div class="row between"><span class="pri ${pri(l)}">${pri(l)} priority</span><span class="small muted">${l.tier ? esc(l.tier) + " · " : ""}${l.confidence ? "Confidence " + esc(l.confidence) : ""}</span></div>
      <h2>${esc(l.name)}</h2><div class="row"><span class="pill">${esc(typeL(l.orgType))}</span><span class="pill">${esc(l.location || "")}</span>${l.website ? `<a class="pill" href="${esc(l.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : `<span class="pill">${esc(l.websiteNote || "Website not recorded")}</span>`}</div>
      ${contactBox(l)}
      <div class="kv"><span>Projects</span><span>${esc(l.projects || "—")}</span><span>Evidence</span><span>${esc(l.evidence || "—")}</span><span>Lead with</span><span>${esc(l.productsFit || "—")}</span><span>Why attractive</span><span>${esc(l.why || "—")}</span>
        <span>How they buy</span><span>${esc(l.process || "—")}</span><span>Titles to reach</span><span>${esc(l.titles || "—")}</span><span>Competitors</span><span>${esc(l.competitors || "—")}</span><span>Entry strategy</span><span>${esc(l.entry || "—")}</span><span>Suggested next step</span><span>${esc(l.nextAction || "—")}</span></div>
      <h4>Qualification (100 points)</h4><div class="kv">${L.QUAL.map(([k, lab, max]) => `<span>${esc(lab)}</span><span class="num">${q[k] != null ? esc(q[k]) : "—"} / ${max}</span>`).join("")}<span><b>Score</b></span><b class="num">${l.score != null ? esc(l.score) : "—"}</b></div>
      <h4>Sources</h4>${srcList(l)}<p class="tiny muted">${esc(l.origin || "")}</p>
      <div class="acts">${!o.owner && !o.conflict && U.canWrite() && !["archived", "merged", "inactive"].includes(l.status) ? `<button class="btn lime" id="ld-claim">Claim lead</button>` : `<span class="small muted">${o.conflict ? "Ownership under review by an administrator." : o.owner ? "Owner: " + esc(ownerName(o.owner)) : ""}</span>`}<button class="btn ghost" id="ld-x">Close</button></div>`,
      (m) => { $("#ld-x", m).onclick = () => U.closeModal(); const c = $("#ld-claim", m); if (c) c.onclick = () => { U.closeModal(); doClaim(id); }; }, { wide: true });
  }

  /* ---------------- My Leads ---------------- */
  async function renderMy(opts = {}) {
    if (opts && opts.lead) F.sel = opts.lead;
    const V = $("#view-myleads");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">My Leads</span><h1>Your <em>pipeline</em>.</h1><p class="lead small">Leads you own. Record each contact, keep a next action, and start the project when it is ready to quote. Only you and administrators can see these notes.</p></div>
      <div class="row"><button class="btn ghost sm" id="ml-mine">Lead Mine</button></div></div><div class="split"><div class="stack"><div class="filters"><select class="in sm" id="ml-st"><option value="">All stages</option>${L.STAGES.filter(([k]) => !["available", "research", "archived"].includes(k)).map(([k, l]) => `<option value="${k}"${F.mst === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div><div class="llist" id="ml-list"><div class="empty"><div class="spinner"></div></div></div></div><div id="ml-detail"></div></div></div>`;
    $("#ml-mine").onclick = () => U.go("leads");
    $("#ml-st").onchange = (e) => { F.mst = e.target.value; listMy(); };
    await load(true);
    const crms = await L.listCrm(DPStore.st.userId); cache.crm = Object.fromEntries(crms.map((c) => [c.leadId, c]));
    listMy();
  }
  function myList() { const me = DPStore.st.userId; return sortLeads(cache.leads.filter((l) => own(l).owner === me)); }
  function listMy() {
    const box = $("#ml-list"); if (!box) return; const list = myList().filter((l) => !F.mst || ((cache.crm[l.id] || {}).stage || "claimed") === F.mst);
    if (!myList().length) { box.innerHTML = `<div class="card flat stack"><b>No leads yet.</b><span class="small muted">Claim leads in the Lead Mine to start your pipeline.</span><button class="btn lime sm" id="ml-go">Open the Lead Mine</button></div>`; $("#ml-go").onclick = () => U.go("leads"); $("#ml-detail").innerHTML = ""; return; }
    if (!F.sel || !list.some((l) => l.id === F.sel)) F.sel = list[0] ? list[0].id : null;
    box.innerHTML = list.map((l) => { const c = cache.crm[l.id] || {}, na = c.nextAction; return `<button type="button" data-sel="${esc(l.id)}" class="${F.sel === l.id ? "is-on" : ""}"><span class="row between"><b>${esc(l.name)}</b><span class="pri ${pri(l)}">${pri(l)}</span></span>
      <span class="row"><span class="pill info">${esc(L.STAGE_LABEL[c.stage] || "Claimed")}</span>${na && na.due ? `<span class="pill ${na.due < new Date().toISOString().slice(0, 10) ? "err" : ""}">Next: ${esc(na.due)}</span>` : ""}</span></button>`; }).join("") || `<div class="empty small">No leads at this stage.</div>`;
    $$("[data-sel]", box).forEach((b) => (b.onclick = () => { F.sel = b.dataset.sel; listMy(); }));
    detailMy();
  }
  async function detailMy() {
    const B = $("#ml-detail"), l = cache.leads.find((x) => x.id === F.sel); if (!B || !l) return;
    const c = cache.crm[l.id] || { stage: "claimed", notes: [], activities: [] };
    const projects = (await DPStore.listProjects()).filter((p) => p.leadId === l.id);
    const o = own(l), acts = DPLeadOps.actsFor(l.id);
    const tl = [].concat(acts.map((a) => ({ at: a.at, html: `<b>${esc(DPLeadOps.ACT_TYPES[a.type] || a.type)}</b>${a.direction ? ` (${esc(a.direction)})` : ""} by ${esc(ownerName(a.uid))}${a.contact ? ` with ${esc(a.contact)}` : ""}${a.outcome ? ` · ${esc(a.outcome)}` : ""}${a.notes ? ` — ${esc(a.notes)}` : ""}${a.qualifying ? "" : ' <span class="pill" title="' + esc(a.why || "") + '">not counted</span>'}` })),
      (c.activities || []).map((a) => ({ at: a.at, html: `<b>${esc(a.type || "Activity")}</b> — ${esc(a.summary || "")}${a.outcome ? ` <span class="muted">→ ${esc(a.outcome)}</span>` : ""}${a.handover ? ' <span class="pill">from previous owner</span>' : ""}` })),
      (c.notes || []).map((n) => ({ at: n.at, html: `${n.system ? '<span class="pill">System</span> ' : "Note: "}${esc(n.text)}${n.handover ? ' <span class="pill">from previous owner</span>' : ""}` })),
      (c.stageHistory || []).map((h) => ({ at: h.at, html: `Stage → <b>${esc(L.STAGE_LABEL[h.stage] || h.stage)}</b>${h.note ? ` <span class="muted">${esc(h.note)}</span>` : ""}` }))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const cf = c.contactFound || {};
    B.innerHTML = `<div class="card stack corner"><div class="row between"><div><span class="eyebrow">${esc(typeL(l.orgType))} · ${esc(l.location || "")}</span><h2>${esc(l.name)}</h2></div><span class="pri ${pri(l)}">${pri(l)} priority</span></div>
      <div class="note small row between"><span><b>24-hour rule.</b> ${o.deadline ? `Released ${esc(new Date(o.deadline).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} unless you log a qualifying activity.` : "No time limit on this lead (set by an administrator)."}${o.lastActivity ? ` Last qualifying activity ${esc(new Date(o.lastActivity).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}.` : ""}</span>${timerChip(o)}</div>
      <div class="grid2"><label class="field"><span>Pipeline stage</span><select class="in" id="md-stage">${L.STAGES.filter(([k]) => L.OWNER_STAGES.includes(k) || k === c.stage).map(([k, lab]) => `<option value="${k}"${(c.stage || "claimed") === k ? " selected" : ""}${!L.OWNER_STAGES.includes(k) ? " disabled" : ""}>${esc(lab)}</option>`).join("")}</select><small>“Won” is set automatically when an administrator approves the order.</small></label>
        <div class="field"><span class="lbl">Next action</span><div class="row" style="flex-wrap:nowrap"><input class="in" id="md-na" placeholder="e.g. Call the landscape manager" value="${esc((c.nextAction || {}).text || "")}"><input class="in" type="date" id="md-due" value="${esc((c.nextAction || {}).due || "")}" style="width:150px"></div></div></div>
      <div class="row"><button class="btn sm" id="md-act">${U.svg("phone")} Log call / activity</button><button class="btn ghost sm" id="md-note">Private note</button><button class="btn ghost sm" id="md-contact">Update contact details</button><button class="btn lime sm" id="md-proj">${U.svg("planner")} Start a project</button><button class="btn ghost sm" id="md-info">Lead details</button><button class="btn ghost sm" id="md-rel">Release lead</button></div>
      ${contactBox(l)}${(() => { const ct = l.contact || {}; return ct.name || ct.phone || ct.email ? `<div class="kv small"><span>Contact</span><span>${esc([ct.name, ct.title].filter(Boolean).join(" · ") || "—")}</span><span>Phone</span><span>${esc(ct.phone || "—")}${ct.phone ? (ct.phoneVerified ? ' <span class="pill ok">verified</span>' : ' <span class="pill warn">unverified</span>') : ""}</span><span>E-mail</span><span>${esc(ct.email || "—")}${ct.email ? (ct.emailVerified ? ' <span class="pill ok">verified</span>' : ' <span class="pill warn">unverified</span>') : ""}</span>${ct.source ? `<span>Source</span><span>${esc(ct.source)}</span>` : ""}</div>` : ""; })()}
      ${projects.length ? `<div class="stack" style="gap:6px"><h4>Projects for this lead</h4>${projects.map((p) => `<button class="linkbtn" data-open="${esc(p.id)}" style="text-align:left">${esc(p.name)} · ${esc(U.STATUS_LABEL[p.status] || "Draft")}${p.total != null ? " · " + esc(H.money2(p.total, p.currency)) : ""}</button>`).join("")}</div>` : ""}
      <h4>Timeline</h4>${tl.length ? `<div class="tl">${tl.map((t) => `<div><span class="tiny muted">${esc(new Date(t.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span>${t.html}</span></div>`).join("")}</div>` : `<p class="small muted">Nothing logged yet.</p>`}
      <h4>Sources</h4>${srcList(l)}</div>`;
    const save = async (patch, note) => { try { cache.crm[l.id] = await L.updateCrm(l.id, patch, { stageNote: note || "" }); listMy(); } catch (e) { U.toast(e.message || "Not saved.", { err: true }); } };
    $("#md-stage").onchange = async (e) => { const st = e.target.value; let note = "";
      if (st === "lost") { const f = await U.form("Mark the lead as lost", [{ id: "r", label: "Reason", required: true, type: "textarea" }], { submit: "Mark lost" }); if (!f) { e.target.value = c.stage || "claimed"; return; } note = f.r; }
      save(Object.assign({ stage: st }, st === "lost" ? { lostReason: note } : {}), note); };
    const naSave = () => save({ nextAction: { text: $("#md-na").value.trim(), due: $("#md-due").value || null } });
    $("#md-na").onchange = naSave; $("#md-due").onchange = naSave;
    $("#md-act").onclick = () => DPUI.logDialog({ leadId: l.id, leads: cache.leads, onDone: renderMy });
    $("#md-note").onclick = async () => { const f = await U.form("Add note", [{ id: "text", label: "Note", type: "textarea", required: true }], { submit: "Add" }); if (!f) return; await L.addCrmEntry(l.id, "notes", { text: f.text }); renderMy(); };
    $("#md-contact").onclick = async () => { const ct = l.contact || {};
      const f = await U.form("Update contact details", [{ id: "name", label: "Contact person", value: ct.name }, { id: "title", label: "Job title", value: ct.title }, { id: "phone", label: "Phone", value: ct.phone }, { id: "pv", label: "Phone verified (I called and confirmed it)", type: "check", value: ct.phoneVerified },
        { id: "email", label: "E-mail", value: ct.email, type: "email" }, { id: "ev", label: "E-mail verified", type: "check", value: ct.emailVerified }, { id: "source", label: "Where it comes from (URL or how you got it)", required: true, value: ct.source }],
        { intro: "Saved on the shared lead record, so data entry, sales and administrators see the same details. Only record details from a real source. This does not reset your 24-hour timer — log the call for that.", submit: "Save" });
      if (!f) return; try { await DPLeadOps.saveContact(l.id, { contact: { name: f.name.trim(), title: f.title.trim(), phone: f.phone.trim(), email: f.email.trim(), phoneVerified: !!f.pv && !!f.phone.trim(), emailVerified: !!f.ev && !!f.email.trim(), source: f.source.trim() } }, "Updated by the owner"); await load(true); U.toast("Contact details saved to the shared record."); renderMy(); } catch (e) { U.toast(e.message, { err: true }); } };
    $("#md-proj").onclick = () => U.go("setup", { isNew: true, leadId: l.id, leadName: l.name });
    $("#md-info").onclick = () => detail(l.id);
    $("#md-rel").onclick = async () => { const f = await U.form(`Release ${l.name}?`, [{ id: "r", label: "Why are you giving it back?", required: true }], { intro: "The lead goes back to the Lead Mine, where any employee can claim it. Your notes stay in your history.", submit: "Release lead" });
      if (!f) return; await L.release(l.id, f.r); F.sel = null; U.toast("Lead released."); renderMy(); };
    $$("[data-open]", B).forEach((b) => (b.onclick = () => U.openProject(b.dataset.open)));
  }

  /* ---------------- All Leads (administrators) ---------------- */
  async function renderAll() {
    const V = $("#view-allleads");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>All <em>leads</em></h1><p class="lead small">Every lead with its owner and stage. Reassign, release, merge, correct or archive — every action asks for a reason and is logged.</p></div>
      <div class="row"><button class="btn ghost sm" id="al-add">Add lead</button><button class="btn ghost sm" id="al-csv">Import CSV…</button><button class="btn ghost sm" id="al-exp">Export CSV</button><button class="btn lime sm" id="al-seed">Import researched accounts</button></div></div>
      <div id="al-flags"></div>${filterBar("al")}<div class="card" style="padding:0"><div class="tablewrap" id="al-list"><div class="empty"><div class="spinner"></div></div></div></div></div>`;
    bindFilters("al", table);
    $("#al-add").onclick = () => editLead(null);
    $("#al-seed").onclick = importSeed;
    $("#al-csv").onclick = () => U.pickFile(".csv", importCsv);
    $("#al-exp").onclick = exportCsv;
    await load(true);
    const ids = await L.uids(); const crmL = await Promise.all(ids.map((u) => L.listCrm(u).then((l) => l.map((x) => Object.assign({ uid: u }, x))))); cache.allCrm = crmL.flat();
    const conflicts = cache.leads.filter((l) => own(l).conflict || (l.assignedTo && own(l).others.length));
    const found = cache.allCrm.filter((c) => c.contactFound && !c.contactFoundApplied && own(cache.leads.find((l) => l.id === c.leadId) || {}).owner === c.uid);
    const inactiveOwners = cache.leads.filter((l) => { const o = own(l).owner; if (!o) return false; const r = DPAuth.A.directory.find((x) => x.uid === o); return !r || r.active === false; });
    const props = (await DPLeadOps.listProposals()).filter((p) => p.status === "proposed"); cache.props = props;
    const expiredNow = cache.leads.filter((l) => (own(l).expired || []).length);
    const sw = await DPStore.tryGet("sweep/state"), swAge = sw && sw.lastRun ? (Date.now() - Date.parse(sw.lastRun)) / 3600e3 : null;
    const swNote = DPStore.st.mode === "cloud" ? (swAge == null ? `<div class="note warn small"><b>Server lead release has not run yet.</b> It runs hourly once the scheduled job is active; until then, releases happen when an administrator opens the app.</div>`
      : `<div class="note small${swAge > 3 ? " warn" : ""}">Server lead release last ran ${esc(new Date(sw.lastRun).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}${swAge > 3 ? " — more than 3 hours ago: check the scheduled job." : "."}</div>`) : "";
    $("#al-flags").innerHTML = swNote + (props.length ? `<div class="note"><b>${props.length} new lead(s) proposed by data entry.</b> <button class="linkbtn" id="al-props">Review</button></div>` : "")
      + (expiredNow.length ? `<div class="note warn"><b>${expiredNow.length} claim(s) passed the 24-hour deadline.</b> They are shown as available and are released automatically.</div>` : "") + (conflicts.length ? `<div class="note err"><b>${conflicts.length} ownership conflict${conflicts.length > 1 ? "s" : ""}.</b> More than one claim exists. These leads are locked for everyone until you choose the owner (Reassign).</div>` : "")
      + (inactiveOwners.length ? `<div class="note warn"><b>${inactiveOwners.length} lead(s) owned by deactivated or removed users.</b> Reassign or release them.</div>` : "")
      + (found.length ? `<div class="note"><b>${found.length} contact(s) reported by owners</b> are waiting for verification. Open the lead and choose “Correct” to add verified details.</div>` : "");
    const pb = $("#al-props"); if (pb) pb.onclick = reviewProps;
    table();
  }
  async function reviewProps() {
    const props = cache.props || [];
    U.openModal(`<h2>Proposed leads</h2><div class="stack">${props.map((p) => `<div class="card stack"><div class="row between"><b>${esc(p.name)}</b><span class="tiny muted">by ${esc(DPAuth.nameSync(p.uid))} · ${esc(H.dateS(p.at))}</span></div><span class="small">${esc([typeL(p.orgType), p.location, p.website].filter(Boolean).join(" · "))}</span><span class="small">${esc(p.projects || "")}</span>${srcList(p)}
      <div class="row"><button class="btn lime sm" data-ok="${esc(p.id)}">Add to Lead Mine</button><button class="btn ghost sm" data-no="${esc(p.id)}">Reject…</button></div></div>`).join("") || "<p class='small muted'>Nothing to review.</p>"}</div><div class="acts"><button class="btn ghost" id="pp-x">Close</button></div>`, (m) => {
      $("#pp-x", m).onclick = () => U.closeModal();
      $$("[data-ok]", m).forEach((b) => (b.onclick = async () => { await DPLeadOps.decideProposal(props.find((x) => x.id === b.dataset.ok), true); U.closeModal(); U.toast("Added."); renderAll(); }));
      $$("[data-no]", m).forEach((b) => (b.onclick = async () => { const f = await U.form("Reject proposal", [{ id: "r", label: "Reason", required: true }], { submit: "Reject" }); if (!f) return; await DPLeadOps.decideProposal(props.find((x) => x.id === b.dataset.no), false, f.r); U.toast("Rejected."); renderAll(); }));
    }, { wide: true });
  }
  function table() {
    const box = $("#al-list"); if (!box) return; const rows = sortLeads(cache.leads.filter(passes)), crmOf = (l, uid) => (cache.allCrm || []).find((c) => c.leadId === l.id && c.uid === uid);
    box.innerHTML = rows.length ? `<table class="mtable"><thead><tr><th>Lead</th><th>Type</th><th>Priority</th><th>Contact</th><th>Owner</th><th>24-hour rule</th><th>Stage</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map((l) => { const o = own(l), c = o.owner ? crmOf(l, o.owner) : null, st = L.stageOf(l, o, c);
      return `<tr><td><b>${esc(l.name)}</b><div class="tiny muted">${esc(l.location || "")}</div></td><td class="small">${esc(typeL(l.orgType))}</td><td><span class="pri ${pri(l)}">${pri(l)}</span><div class="tiny muted">${l.score != null ? esc(l.score) : ""}</div></td>
        <td class="small">${L.contactLabel(l).ok ? '<span class="pill ok">Available</span>' : '<span class="pill">Under Research</span>'}${c && c.contactFound && !c.contactFoundApplied ? ' <span class="pill warn">reported</span>' : ""}</td>
        <td class="small">${o.conflict ? `<span class="pill err">Conflict: ${esc(o.claimants.map((x) => ownerName(x.uid)).join(", "))}</span>` : o.owner ? esc(ownerName(o.owner)) + (o.via === "admin" ? ' <span class="tiny muted">(assigned)</span>' : "") : "—"}${o.others && o.others.length && !o.conflict ? ` <span class="pill err">+${o.others.length} invalid claim</span>` : ""}</td>
        <td>${o.owner ? timerChip(o) : (o.expired || []).length ? '<span class="timer err">expired — releasing</span>' : ""}</td><td><span class="pill ${st === "won" ? "ok" : st === "lost" ? "err" : ["available", "research"].includes(st) ? "" : "info"}">${esc(L.STAGE_LABEL[st] || st)}</span></td><td class="tiny muted">${esc(H.dateS(l.updatedAt))}</td>
        <td style="white-space:nowrap"><button class="btn ghost xs" data-act="${esc(l.id)}">Manage…</button></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">${cache.leads.length ? "No leads match these filters." : "No leads yet. Import the researched strategic account database to start."}</div>`;
    $$("[data-act]", box).forEach((b) => (b.onclick = () => manage(b.dataset.act)));
  }
  function manage(id) {
    const l = cache.leads.find((x) => x.id === id), o = own(l), crms = (cache.allCrm || []).filter((c) => c.leadId === id);
    const hist = (l.history || []).slice().reverse();
    U.openModal(`<h2>${esc(l.name)}</h2><div class="row"><span class="pill">${esc(typeL(l.orgType))}</span><span class="pri ${pri(l)}">${pri(l)}</span><span class="pill">${esc(L.STAGE_LABEL[L.stageOf(l, o, o.owner ? crms.find((c) => c.uid === o.owner) : null)] || "")}</span></div>
      <div class="kv"><span>Owner</span><b>${o.conflict ? "Conflict — " + esc(o.claimants.map((x) => `${ownerName(x.uid)} (${new Date(x.claimedAt).toLocaleString()})`).join(" · ")) : o.owner ? esc(ownerName(o.owner)) + (o.via === "admin" ? " · assigned " + esc(H.dateS(o.at)) : " · claimed " + esc(H.dateS(o.at))) : "Nobody"}</b><span>Status</span><span>${esc(l.status || "available")}</span></div>
      ${crms.filter((c) => c.contactFound).map((c) => `<div class="note small"><b>Contact reported by ${esc(ownerName(c.uid))}</b>: ${esc([c.contactFound.name, c.contactFound.title, c.contactFound.phone, c.contactFound.email].filter(Boolean).join(" · "))} — source: ${esc(c.contactFound.source || "")}</div>`).join("")}
      ${o.owner ? `<div class="note small row between"><span><b>24-hour rule:</b> ${o.deadline ? `deadline ${esc(new Date(o.deadline).toLocaleString())}${o.lastActivity ? ` · last qualifying activity ${esc(new Date(o.lastActivity).toLocaleString())}` : " · no qualifying activity yet"}` : "off for this assignment"}</span>${timerChip(o)}</div>` : ""}
      ${(l.releases || []).length ? `<details><summary class="small">Releases (${l.releases.length})</summary><div class="tl">${l.releases.slice().reverse().map((r) => `<div><span class="tiny muted">${esc(new Date(r.releasedAt).toLocaleString())}</span><span>${esc(ownerName(r.uid))} — ${esc(r.reason)}${r.by === "server-sweep" ? ' <span class="pill">server</span>' : ""}</span></div>`).join("")}</div></details>` : ""}
      <div class="row"><button class="btn sm" id="mg-re">Reassign…</button>${o.owner ? `<button class="btn ghost sm" id="mg-ext">Extend deadline…</button><button class="btn ghost sm" id="mg-tm">${l.assignTimer === false ? "Turn 24-hour rule on" : "Turn 24-hour rule off"}</button>` : ""}<button class="btn ghost sm" id="mg-rel" ${o.owner || o.conflict ? "" : "disabled"}>Release</button><button class="btn ghost sm" id="mg-ed">Correct details…</button><button class="btn ghost sm" id="mg-st">Change status…</button><button class="btn ghost sm" id="mg-mg">Merge into…</button></div>
      <h4>History</h4>${hist.length ? `<div class="tl">${hist.slice(0, 30).map((h) => `<div><span class="tiny muted">${esc(new Date(h.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span><b>${esc(h.action)}</b> by ${esc(ownerName(h.by))}${h.reason ? ` — ${esc(h.reason)}` : ""}${h.detail ? ` <span class="muted">(${esc(h.detail)})</span>` : ""}</span></div>`).join("")}</div>` : `<p class="small muted">No history.</p>`}
      <div class="acts"><button class="btn ghost" id="mg-x">Close</button></div>`, (m) => {
      $("#mg-x", m).onclick = () => U.closeModal();
      const run = async (fn, msg) => { try { await fn(); U.closeModal(); U.toast(msg); renderAll(); } catch (e) { U.toast(e.message || "Not saved.", { err: true, ms: 7000 }); } };
      $("#mg-re", m).onclick = async () => { const emps = DPAuth.A.directory.filter((r) => r.uid && r.active !== false && DPAuth.isSalesRole(r.role));
        const f = await U.form("Reassign lead", [{ id: "to", label: "New owner", type: "select", value: o.owner || (emps[0] && emps[0].uid), options: emps.map((r) => ({ value: r.uid, label: DPAuth.fullName(r) })) }, { id: "timer", label: "Apply the 24-hour inactivity rule to this assignment", type: "check", value: true }, { id: "reason", label: "Reason", required: true, type: "textarea" }], { intro: "The new owner receives the pipeline history and a notification. All other claims on this lead are removed.", submit: "Reassign" });
        if (f) run(() => L.reassign(id, f.to, f.reason, { timer: !!f.timer }), "Lead reassigned."); };
      const ext = $("#mg-ext", m); if (ext) ext.onclick = async () => { const f = await U.form("Extend the deadline (exceptional)", [{ id: "h", label: "Extend by (hours)", type: "number", min: 1, value: 24, required: true }, { id: "reason", label: "Reason", required: true }], { submit: "Extend" }); if (f) run(() => DPLeadOps.extend(id, o.owner, +f.h, f.reason), "Deadline extended."); };
      const tm = $("#mg-tm", m); if (tm) tm.onclick = async () => { const f = await U.form(l.assignTimer === false ? "Turn the 24-hour rule on" : "Turn the 24-hour rule off", [{ id: "reason", label: "Reason", required: true }], { intro: "Only applies while the lead is assigned to its current owner by an administrator.", submit: "Save" }); if (!f) return;
        if (o.via !== "admin" && l.assignTimer !== false) { run(async () => { await L.reassign(id, o.owner, f.reason, { timer: false }); }, "Assigned without a time limit."); } else run(() => DPLeadOps.setAssignTimer(id, l.assignTimer === false, f.reason), "Saved."); };
      $("#mg-rel", m).onclick = async () => { const f = await U.form("Release lead", [{ id: "reason", label: "Reason", required: true }], { intro: "All claims are removed and the lead returns to the Lead Mine.", submit: "Release" }); if (f) run(() => L.adminRelease(id, f.reason), "Lead released."); };
      $("#mg-st", m).onclick = async () => { const f = await U.form("Change lead status", [{ id: "st", label: "Status", type: "select", value: l.status || "available", options: [["available", "Available"], ["research", "Under Research"], ["inactive", "Inactive (not pursuing)"], ["archived", "Archived"]].map(([v, x]) => ({ value: v, label: x })) }, { id: "reason", label: "Reason", required: true }], { submit: "Save" });
        if (f) run(() => L.setLeadStatus(id, f.st, f.reason), "Status changed."); };
      $("#mg-ed", m).onclick = () => { U.closeModal(); editLead(l); };
      $("#mg-mg", m).onclick = async () => { const others = cache.leads.filter((x) => x.id !== id && x.status !== "merged");
        const f = await U.form("Merge duplicate", [{ id: "into", label: `Merge “${l.name}” into`, type: "select", value: others[0] && others[0].id, options: others.map((x) => ({ value: x.id, label: x.name })) }, { id: "reason", label: "Reason", required: true }], { intro: "Sources are combined into the lead you choose; this lead is closed as merged.", submit: "Merge" });
        if (f) run(() => L.merge(id, f.into, f.reason), "Leads merged."); };
    }, { wide: true });
  }
  async function editLead(l) {
    const isNew = !l; l = l || { contact: {}, qualification: {}, sources: [], orgType: "developer", country: "Egypt" };
    const c = l.contact || {}, q = l.qualification || {}, src = (l.sources || []).map((s) => `${s.url} ${s.date || ""}`.trim()).join("\n");
    const f = await U.form(isNew ? "Add a lead" : `Correct ${l.name}`, [
      { id: "name", label: "Organisation", value: l.name, required: true }, { id: "orgType", label: "Organisation type", type: "select", value: l.orgType, options: Object.entries(L.ORG_TYPES).map(([k, x]) => ({ value: k, label: x })) },
      { id: "location", label: "City / region", value: l.location }, { id: "website", label: "Website (verified)", value: l.website },
      { id: "projects", label: "Relevant projects", type: "textarea", value: l.projects }, { id: "evidence", label: "Evidence of activity", type: "textarea", value: l.evidence },
      { id: "sources", label: "Sources — one per line: URL then date (YYYY-MM-DD)", type: "textarea", value: src, required: true },
      { id: "productsFit", label: "Products to lead with", value: l.productsFit }, { id: "titles", label: "Titles to reach", value: l.titles },
      { id: "cname", label: "Contact name (verified only)", value: c.name }, { id: "ctitle", label: "Contact title", value: c.title }, { id: "cphone", label: "Contact phone (verified only)", value: c.phone }, { id: "cemail", label: "Contact e-mail (verified only)", value: c.email },
      { id: "csource", label: "Contact source (required when a phone or e-mail is entered)", value: c.source },
      ...L.QUAL.map(([k, lab, max]) => ({ id: "q_" + k, label: `${lab} (0–${max})`, type: "number", min: 0, value: q[k] })),
      { id: "prio", label: "Priority", type: "select", value: l.priorityOverride || "", options: [{ value: "", label: "From score" }, { value: "High", label: "High" }, { value: "Medium", label: "Medium" }, { value: "Low", label: "Low" }] },
      ...(isNew ? [] : [{ id: "reason", label: "Reason for the correction", required: true }])], { submit: isNew ? "Add lead" : "Save correction", wide: true,
      intro: "Never enter a person's name, phone or e-mail unless it comes from a real source you can cite. Leave contact fields empty when unknown: the lead shows “Under Research”." });
    if (!f) return;
    const sources = f.sources.split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => { const [url, date] = x.split(/\s+/); return { url, date: date || "" }; });
    if (!sources.every((s) => /^https?:\/\//.test(s.url))) return U.toast("Each source line must start with a web address (https://…).", { err: true });
    if ((f.cphone || f.cemail) && !f.csource) return U.toast("Enter where the contact details come from.", { err: true });
    const qual = {}; for (const [k, , max] of L.QUAL) { const v = f["q_" + k]; if (v != null) { if (v > max) return U.toast(`${k}: maximum ${max}.`, { err: true }); qual[k] = v; } }
    const contact = { name: f.cname.trim(), title: f.ctitle.trim(), phone: f.cphone.trim(), email: f.cemail.trim(), source: f.csource.trim(), sub: (l.contact || {}).sub || "none",
      verifiedAt: (f.cphone || f.cemail) ? ((c.phone === f.cphone.trim() && c.email === f.cemail.trim() && c.verifiedAt) || new Date().toISOString()) : null, verifiedBy: (f.cphone || f.cemail) ? DPStore.st.userId : null };
    const patch = { name: f.name.trim(), orgType: f.orgType, location: f.location.trim(), website: f.website.trim(), projects: f.projects, evidence: f.evidence, sources, productsFit: f.productsFit, titles: f.titles, contact, qualification: qual, score: L.scoreOf(qual), priorityOverride: f.prio || null };
    try {
      if (isNew) { await L.saveLead(Object.assign({ status: "research", country: "Egypt", origin: "Added by an administrator" }, patch), "Created", "Added manually", ""); U.toast("Lead added."); }
      else { const cpatch = Object.assign({}, patch); delete cpatch.contact; delete cpatch.website; await L.correct(l.id, cpatch, f.reason);
        // contact data and website live on the shared contact record (2.2), so data entry and sales see the correction
        await DPLeadOps.saveContact(l.id, { website: patch.website, contact: { name: contact.name, title: contact.title, phone: contact.phone, email: contact.email, source: contact.source, phoneVerified: !!contact.phone, emailVerified: !!contact.email } }, "Administrator correction: " + f.reason);
        for (const cr of (cache.allCrm || []).filter((x) => x.leadId === l.id && x.contactFound && !x.contactFoundApplied)) await DPStore.set(`crm/${cr.uid}/l/${l.id}`, Object.assign({}, cr, { contactFoundApplied: new Date().toISOString() })).catch(() => {}); U.toast("Lead corrected."); }
      renderAll();
    } catch (e) { U.toast(e.message || "Not saved.", { err: true }); }
  }
  async function importSeed() {
    const b = U.busy("Loading the strategic account database…");
    try { if (!root.DP_LEAD_SEED) await DPProposal.loadScript("data/leadseed.js", 15000);
      b.done();
      const ok = await U.ask("Import the researched accounts?", `<p>${root.DP_LEAD_SEED.length} Egyptian organisations from the Dupedia Strategic Account Database (researched 25 Oct 2026), each with its public source and date, qualification score and suggested approach.</p><p>No personal contact details are included: every lead starts as “Under Research”. Leads that already exist are skipped.</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Import", value: true }]);
      if (!ok) return; const b2 = U.busy("Importing…"); const r = await L.importLeads(root.DP_LEAD_SEED, { origin: "Dupedia Strategic Account Database (25 Oct 2026)" }); b2.done(); U.toast(`${r.added} leads imported, ${r.skipped} already present.`); renderAll();
    } catch (e) { b.done(); U.toast("Import failed: " + (e.message || e.code), { err: true }); }
  }
  function parseCsv(text) { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; } else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += ch; } if (f || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => x.trim())); }
  async function importCsv(file) {
    try { const rows = parseCsv((await file.text()).replace(/^﻿/, "")), head = rows.shift().map((h) => h.trim().toLowerCase());
      const col = (r, k) => { const i = head.indexOf(k); return i < 0 ? "" : (r[i] || "").trim(); };
      if (!head.includes("name") || !head.includes("source_url")) throw new Error("The CSV needs at least the columns name and source_url (optional: org_type, location, website, projects, evidence, source_date, products_fit, titles, contact_name, contact_title, contact_phone, contact_email, contact_source).");
      const list = rows.map((r) => { const ph = col(r, "contact_phone"), em = col(r, "contact_email"), cs = col(r, "contact_source");
        return { name: col(r, "name"), orgType: L.ORG_TYPES[col(r, "org_type")] ? col(r, "org_type") : "other", location: col(r, "location"), website: col(r, "website"), projects: col(r, "projects"), evidence: col(r, "evidence"),
          sources: [{ url: col(r, "source_url"), date: col(r, "source_date") }], productsFit: col(r, "products_fit"), titles: col(r, "titles"),
          contact: { name: col(r, "contact_name"), title: col(r, "contact_title"), phone: cs ? ph : "", email: cs ? em : "", source: cs, verifiedAt: cs && (ph || em) ? new Date().toISOString() : null, sub: "none" } }; })
        .filter((x) => x.name && /^https?:\/\//.test(x.sources[0].url));
      const ok = await U.ask(`Import ${list.length} leads?`, `<p>${rows.length - list.length} rows without a name or a valid source URL are skipped. Contact phone/e-mail are kept only when a contact source is given.</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Import", value: true }]);
      if (!ok) return; const r = await L.importLeads(list, { origin: "CSV import: " + file.name }); U.toast(`${r.added} leads imported.`); renderAll();
    } catch (e) { U.toast(e.message || "The file could not be read.", { err: true, ms: 9000 }); }
  }
  function exportCsv() {
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["id", "name", "org_type", "location", "priority", "score", "contact_status", "owner", "status", "website", "projects", "source_url", "source_date"];
    const csv = [head.join(",")].concat(cache.leads.map((l) => { const o = own(l); return [l.id, l.name, l.orgType, l.location, pri(l), l.score, L.contactLabel(l).label, o.conflict ? "CONFLICT" : o.owner ? DPAuth.nameSync(o.owner) : "", l.status || "", l.website, l.projects, (l.sources || [])[0] ? l.sources[0].url : "", (l.sources || [])[0] ? l.sources[0].date : ""].map(q).join(","); })).join("\r\n");
    U.downloadOut({ blob: new Blob(["﻿" + csv], { type: "text/csv" }), filename: `dupedia-leads_${new Date().toISOString().slice(0, 10)}.csv` }, "Lead list");
  }

  U.register("leads", renderMine); U.register("myleads", renderMy); U.register("allleads", renderAll);
  Object.assign(DPUI, { leadCache: () => cache });
})(typeof self !== "undefined" ? self : this);
