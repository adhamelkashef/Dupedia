/* X FORCE 1.0 (Dupedia) — Engineering: operational dashboard, engineering orders (queue pickup, quick updates, dates,
   quality check, blockers, team, files, handover), Factory (in-house / outsourced production), administrator engineering
   queue, Worker Directory. Nothing here reads prices, totals, discounts, payments, costs or commission — the documents it
   reads (handoff, assign, eng, engx, workers) contain none (enforced where they are written: DPOrders.handoverFrom). */
/* global DPUI, DPShell, DPStore, DPAuth, DPOrders, DPModel, DPPlan, DPPen, DPGeom, DPProposal, DPPricing */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, O = DPOrders, AU = () => DPAuth;
  const F = { st: "", dl: "", pr: "", me: "", m: "", sel: null, wq: "", wt: "", wa: "", fq: "", fd: "" };
  const PRI = { normal: "Normal", high: "High", urgent: "Urgent" };
  const SHORT = { review: "Review", assign: "Awaiting production", manufacturing: "Manufacturing", outsourced: "Outsourced", ready: "Ready to install", installing: "Installing", qc: "Quality check", completed: "Completed", hold: "On hold", delayed: "Delayed / at risk", blocked: "Blocked" };
  const today = () => new Date().toISOString().slice(0, 10);
  const isEng = () => U.role() === "engineer";
  function statusPill(j) { const e = j.e; return `<span class="pill ${e && e.status === "completed" ? "ok" : e && ["blocked", "hold", "delayed"].includes(e.status) ? "err" : j.engineerUid ? "info" : "warn"}">${esc(e ? O.ENG_LABEL[e.status] : j.engineerUid ? "Awaiting Engineering Review" : "Unassigned — in the queue")}</span>`; }
  function progHtml(e) { const p = (e && e.progress) || 0; return `<div class="row" style="flex-wrap:nowrap;gap:8px"><div class="prog ${p === 100 ? "done" : ""}" style="flex:1"><i style="width:${p}%"></i></div><b class="num small">${p}%</b></div>`; }
  const sortJobs = (l) => l.slice().sort((x, y) => ({ urgent: 0, high: 1, normal: 2 }[x.priority || "normal"] - { urgent: 0, high: 1, normal: 2 }[y.priority || "normal"]) || String((x.e && x.e.expectedCompletion) || x.deadlineOriginal || "9").localeCompare(String((y.e && y.e.expectedCompletion) || y.deadlineOriginal || "9")));
  async function jobs() { return (await O.listJobs()).filter((j) => j.status !== "cancelled" || U.isAdmin()); }

  /* ---------------- dashboard ---------------- */
  async function renderEngDash() {
    const V = $("#view-dash"), me = U.me(), pic = await H.picHtml(me.id, 72, "ring2");
    V.innerHTML = `<div class="page"><div class="phead"><div class="hello">${pic}<div><span class="eyebrow">${esc([me.title || me.roleLabel, me.department].filter(Boolean).join(" · "))}</span><h1>Hello, <em>${esc(me.firstName || "there")}</em>.</h1><p class="lead small" id="ed-sum">Production, installation and quality — at a glance.</p></div></div>
      <div class="row"><button class="btn lime" id="ed-up">${U.svg("check")} Quick update</button><button class="btn ghost" id="ed-go">${U.svg("truck")} Engineering orders</button><button class="btn ghost" id="ed-f">${U.svg("factory")} Factory</button></div></div><div id="ed-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $("#ed-go").onclick = () => U.go("engorders"); $("#ed-f").onclick = () => U.go("factory");
    const all = await jobs(), uid = DPStore.st.userId, mine = all.filter((j) => j.engineerUid === uid && j.status !== "cancelled"), queue = all.filter((j) => !j.engineerUid && j.status !== "cancelled");
    const st = (k) => mine.filter((j) => j.e && j.e.status === k);
    const risk = mine.filter((j) => ["atrisk", "delayed"].includes(j.ds.key) || (j.e && ["blocked", "hold", "delayed"].includes(j.e.status)));
    const soon = mine.filter((j) => j.ds.days != null && j.ds.days >= 0 && j.ds.days <= 14 && !(j.e && j.e.status === "completed")).sort((a, b) => a.ds.days - b.ds.days);
    const qcIssues = mine.filter((j) => j.e && j.e.qc && j.e.qc.status === "failed"), noProd = mine.filter((j) => !(j.e && j.e.factory && j.e.factory.dest) && !(j.e && ["completed"].includes(j.e.status)));
    const ws = await O.listWorkers().catch(() => []), act = ws.filter((w) => w.active !== false), allocated = act.filter((w) => (w.assignments || []).some((s) => !s.removedAt));
    const recent = mine.flatMap((j) => ((j.e && j.e.log) || []).map((l) => Object.assign({ j }, l))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
    $("#ed-sum").textContent = `${mine.length} order${mine.length === 1 ? "" : "s"} · ${queue.length} waiting in the queue · ${risk.length} at risk, delayed or blocked.`;
    const card = (k, label, n, sub, cls = "") => `<button type="button" class="kcard ${cls}" data-k="${k}"><span class="eyebrow">${esc(label)}</span><b class="num">${n}</b><span class="tiny">${sub}</span></button>`;
    $("#ed-body").innerHTML = `<div class="stack"><div class="kcards">
        ${card("queue", "Awaiting engineering review", queue.length + st("review").length, `${queue.length} unassigned in the queue`, queue.length ? "warn" : "")}${card("assign", "Awaiting production assignment", noProd.length, "no factory or workshop yet", noProd.length ? "warn" : "")}
        ${card("manufacturing", "In manufacturing", st("manufacturing").length, "in-house factory")}${card("outsourced", "Outsourced", st("outsourced").length, "external workshops")}
        ${card("ready", "Ready for installation", st("ready").length, "")}${card("installing", "Installations in progress", st("installing").length + st("qc").length, `${st("qc").length} in quality check`)}
        ${card("completed", "Completed", st("completed").length, "")}${card("risk", "Delayed, blocked or at risk", risk.length, risk.length ? "needs attention" : "none", risk.length ? "bad" : "")}</div>
      <div class="dgrid"><div class="card stack"><h3>Needs attention</h3>${risk.length || qcIssues.length ? `<div class="tl">${risk.concat(qcIssues.filter((x) => !risk.includes(x))).map((j) => `<div><span class="dl ${j.ds.key}">${esc(j.e && ["blocked", "hold"].includes(j.e.status) ? SHORT[j.e.status] : j.e && j.e.qc && j.e.qc.status === "failed" ? "QC failed" : j.ds.label)}</span><span><button class="linkbtn" data-o="${esc(j.oid)}">${esc(j.name)}</button> — target ${esc((j.e && j.e.expectedCompletion) || j.deadlineOriginal || "—")}${j.e && j.e.riskReason ? " · " + esc(j.e.riskReason) : ""}${(j.e && j.e.blockers || []).filter((b) => !b.resolvedAt).map((b) => " · blocker: " + esc(b.text)).join("")}</span></div>`).join("")}</div>` : `<p class="small muted">Nothing at risk.</p>`}</div>
        <div class="card stack"><h3>Upcoming deadlines (14 days)</h3>${soon.length ? `<div class="tl">${soon.map((j) => `<div><span class="small"><b>${esc((j.e && j.e.expectedCompletion) || j.deadlineOriginal)}</b> · ${j.ds.days} d</span><span><button class="linkbtn" data-o="${esc(j.oid)}">${esc(j.name)}</button> ${progHtml(j.e)}</span></div>`).join("")}</div>` : `<p class="small muted">No deadlines in the next two weeks.</p>`}</div></div>
      <div class="dgrid"><div class="card stack"><div class="row between"><h3>Worker allocation</h3><button class="btn ghost xs" data-go="workers">Worker Directory</button></div><div class="kv"><span>Active workers</span><b>${act.length}</b><span>Allocated to projects</span><b>${allocated.length}</b><span>Available</span><b>${act.length - allocated.length}</b><span>National ID on file</span><b>${act.filter((w) => w.idDoc && w.idDoc.uploaded).length} of ${act.length}</b></div></div>
        <div class="card stack"><h3>Recent engineering updates</h3>${recent.length ? `<div class="tl">${recent.map((l) => `<div><span class="tiny muted">${esc(new Date(l.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }))}</span><span><b>${esc(l.j.name)}</b> — ${esc(l.what)}</span></div>`).join("")}</div>` : `<p class="small muted">No updates yet.</p>`}</div></div></div>`;
    const go = { queue: () => U.go("engorders", { view: "queue" }), assign: () => U.go("factory", { dest: "none" }), manufacturing: () => U.go("engorders", { st: "manufacturing" }), outsourced: () => U.go("engorders", { st: "outsourced" }), ready: () => U.go("engorders", { st: "ready" }), installing: () => U.go("engorders", { st: "installing" }), completed: () => U.go("engorders", { st: "completed" }), risk: () => U.go("engorders", { dl: "risk" }) };
    $$("[data-k]", V).forEach((b) => (b.onclick = () => go[b.dataset.k]()));
    $$("[data-o]", V).forEach((b) => (b.onclick = () => U.go("engorders", { oid: b.dataset.o })));
    $$("[data-go]", V).forEach((b) => (b.onclick = () => U.go(b.dataset.go)));
    $("#ed-up").onclick = () => quickUpdate(mine, () => renderEngDash());
  }
  /** Quick update from the dashboard: pick an order, set status / progress / note in one small dialog. */
  async function quickUpdate(mine, done) {
    if (!mine.length) return U.toast("No orders assigned to you yet. Take one from the queue in Engineering Orders.");
    const f = await U.form("Quick update", [{ id: "o", label: "Order", type: "select", value: mine[0].oid, options: sortJobs(mine).map((j) => ({ value: j.oid, label: `${j.name} · ${j.e ? SHORT[j.e.status] : "Review"} · ${(j.e && j.e.progress) || 0}%` })) },
      { id: "s", label: "Status", type: "select", value: "", options: [{ value: "", label: "Keep the current status" }].concat(O.ENG.map(([k, l]) => ({ value: k, label: l }))) },
      { id: "p", label: "Completion %", type: "number", min: 0, step: 5 }, { id: "n", label: "Note (required for on hold, delayed or blocked)" }], { submit: "Save update" });
    if (!f) return; const j = mine.find((x) => x.oid === f.o), patch = {};
    if (f.s) patch.status = f.s; if (f.p != null) patch.progress = Math.min(100, f.p);
    if (!Object.keys(patch).length && !f.n) return;
    try { await O.updateEng(f.o, patch, { note: f.n || "" }); U.toast(`${j.name}: update saved. Sales and administrators are notified of material changes.`); done && done(); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); }
  }

  /* ---------------- engineering orders ---------------- */
  async function renderEngOrders(opts = {}) {
    if (opts.oid) F.sel = opts.oid; if (opts.st != null) F.st = opts.st; if (opts.dl != null) F.dl = opts.dl; if (opts.view) F.view = opts.view;
    const V = $("#view-engorders"), admin = U.isAdmin(), uid = DPStore.st.userId;
    V.innerHTML = `<div class="page" style="max-width:1500px"><div class="phead"><div><span class="eyebrow">Engineering</span><h1>Engineering <em>orders</em></h1><p class="lead small">Accepted orders from engineering review to completed installation. Specifications, plans, teams and dates only — prices and payments never appear here.</p></div>
      <div class="seg" role="tablist">${[["mine", admin ? "All orders" : "My orders"], ["queue", "Unassigned Engineering Orders"]].map(([k, l]) => `<button type="button" data-vw="${k}" class="${(F.view || "mine") === k ? "is-on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="filters" id="eo-f"></div><div class="split"><div class="llist" id="eo-list"><div class="empty"><div class="spinner"></div></div></div><div id="eo-detail"></div></div></div>`;
    $$("[data-vw]", V).forEach((b) => (b.onclick = () => { F.view = b.dataset.vw; F.sel = null; renderEngOrders(); }));
    const all = await jobs(), engsSeesAll = admin || (AU().A.record || {}).engineerSeesAll;
    const queueView = F.view === "queue";
    const rows = queueView ? all.filter((j) => !j.engineerUid && j.status !== "cancelled") : all.filter((j) => j.engineerUid && (engsSeesAll || j.engineerUid === uid));
    const engs = [...new Set(rows.map((r) => r.engineerUid).filter(Boolean))];
    $("#eo-f").innerHTML = queueView ? `<span class="small muted">${rows.length} order${rows.length === 1 ? "" : "s"} waiting for an engineer. Open one to review the handover pack, then take it.</span>` : `<select class="in sm" id="eo-st"><option value="">All statuses</option>${O.ENG.map(([k, l]) => `<option value="${k}"${F.st === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <select class="in sm" id="eo-dl"><option value="">Any deadline status</option>${[["ontrack", "On Track"], ["risk", "At Risk or Delayed"], ["atrisk", "At Risk"], ["delayed", "Delayed"], ["none", "No deadline set"], ["done", "Completed"]].map(([k, l]) => `<option value="${k}"${F.dl === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      <select class="in sm" id="eo-pr"><option value="">Any priority</option>${Object.entries(PRI).map(([k, l]) => `<option value="${k}"${F.pr === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      ${engs.length > 1 ? `<select class="in sm" id="eo-e"><option value="">All engineers</option>${engs.map((u) => `<option value="${esc(u)}"${F.me === u ? " selected" : ""}>${esc(AU().nameSync(u))}</option>`).join("")}</select>` : ""}`;
    ["st", "dl", "pr", "e"].forEach((k) => { const el = $("#eo-" + k); if (el) el.onchange = () => { F[k === "e" ? "me" : k] = el.value; list(); }; });
    function list() {
      const vis = sortJobs(rows.filter((r) => queueView || ((!F.st || (r.e && r.e.status === F.st) || (F.st === "installing" && r.e && r.e.status === "qc")) && (!F.dl || r.ds.key === F.dl || (F.dl === "risk" && (["atrisk", "delayed"].includes(r.ds.key) || (r.e && ["blocked", "hold", "delayed"].includes(r.e.status)))) || (F.dl === "done" && r.ds.key === "late")) && (!F.pr || (r.priority || "normal") === F.pr) && (!F.me || r.engineerUid === F.me))));
      if (!F.sel || !vis.some((r) => r.oid === F.sel)) F.sel = vis[0] ? vis[0].oid : (F.sel && all.some((j) => j.oid === F.sel) ? F.sel : null);
      $("#eo-list").innerHTML = vis.map((r) => `<button type="button" data-sel="${esc(r.oid)}" class="${F.sel === r.oid ? "is-on" : ""}"><span class="row between"><b>${esc(r.name)}</b><span class="dl ${r.ds.key}">${esc(r.ds.key === "none" ? "No deadline" : r.ds.label)}</span></span>
        <span class="tiny muted">${esc([r.ref, r.client, r.location, PRI[r.priority || "normal"] + " priority"].filter(Boolean).join(" · "))}</span>${queueView ? `<span class="tiny">Accepted ${esc(H.dateS(r.acceptedAt))}</span>` : `<span class="tiny">${esc(r.e ? SHORT[r.e.status] : "Review")}${r.e && r.e.factory && r.e.factory.dest ? " · " + esc(O.METHODS[r.e.factory.dest]) : ""}</span>${progHtml(r.e)}`}</button>`).join("") || `<div class="empty small">${queueView ? "Nothing waiting. New orders appear here the moment a client accepts." : rows.length ? "No orders match these filters." : "No orders assigned to you yet — check the queue."}</div>`;
      $$("[data-sel]", $("#eo-list")).forEach((b) => (b.onclick = () => { F.sel = b.dataset.sel; list(); }));
      const r = all.find((x) => x.oid === F.sel); if (r) detail(r, () => renderEngOrders()); else $("#eo-detail").innerHTML = "";
    }
    list();
  }
  async function detail(j, reload) {
    const B = $("#eo-detail"), uid = DPStore.st.userId, can = U.isAdmin() || (j.engineerUid && j.engineerUid === uid);
    B.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
    const [x, ho] = await Promise.all([O.engxOf(j), O.handoverOf(j)]); const e = j.e, ds = j.ds;
    const ev = e || { status: "review", progress: 0, qc: { status: "pending", checklist: [] }, blockers: [] }, xv = x || { team: [], notes: [], files: [], suppliers: [] }, fac = ev.factory || {};
    const openBlocks = (ev.blockers || []).filter((b) => !b.resolvedAt);
    B.innerHTML = `<div class="stack"><div class="card stack corner"><div class="row between"><div><span class="eyebrow">${esc(j.ref || j.oid)} · ${esc(j.oid)} · ${esc(PRI[j.priority || "normal"])} priority</span><h2>${esc(j.name)}</h2><span class="small muted">${esc([j.client, j.location, j.type].filter(Boolean).join(" · "))}</span></div><div class="row">${statusPill(j)}<span class="dl ${ds.key}">${esc(ds.label)}</span></div></div>
        ${progHtml(e)}<div class="kv"><span>Engineer</span><span>${esc(j.engineerUid ? AU().nameSync(j.engineerUid) + (j.via === "pickup" ? " (picked up from the queue)" : j.via === "default" ? " (assigned automatically — default engineer)" : "") : "Not assigned")}</span><span>Sales contact</span><span>${esc(AU().nameSync(j.salesUid) || "—")}</span><span>Client accepted</span><span>${esc(H.dateS(j.acceptedAt))}</span>
          <span>Project deadline (contractual)</span><span>${esc(j.deadlineOriginal || "Not set — information missing")}</span><span>Start date</span><span>${esc(ev.startDate || "—")}</span><span>Target completion</span><b>${esc(ev.expectedCompletion || "—")}</b>${ev.actualCompletion ? `<span>Actual completion</span><b>${esc(ev.actualCompletion)}</b>` : ""}
          <span>Days remaining</span><span>${ds.days == null ? "—" : ds.days >= 0 ? ds.days : `${-ds.days} overdue`}</span><span>Installation</span><span>${esc(ev.installDate ? H.dateS(ev.installDate) : "Not scheduled")}${ev.installProgress ? ` · ${ev.installProgress}%` : ""}</span>
          <span>Production</span><span>${esc(fac.dest ? O.METHODS[fac.dest] : "Not assigned")}${fac.workshop && fac.workshop.name ? " · " + esc(fac.workshop.name) : ""}</span><span>Quality check</span><span>${esc(O.QC[(ev.qc || {}).status || "pending"])}</span>${ev.nextAction ? `<span>Next action</span><b>${esc(ev.nextAction)}</b>` : ""}${ho && ho.contact ? `<span>Site contact</span><span>${esc(ho.contact)}</span>` : ""}</div>
        ${openBlocks.length ? `<div class="note err small"><b>Open blockers:</b> ${openBlocks.map((b) => esc(b.text)).join(" · ")}</div>` : ""}
        ${!j.engineerUid ? `<div class="row">${isEng() ? `<button class="btn lime" id="eo-take">${U.svg("check")} Take this order</button>` : ""}${U.isAdmin() ? `<button class="btn ghost" id="eo-asg">Assign an engineer…</button>` : ""}<span class="small muted">Review the handover pack below before taking the order.</span></div>` : U.isAdmin() ? `<div class="row"><button class="btn ghost sm" id="eo-asg">Change engineer…</button><button class="btn ghost sm" id="eo-dl2">Deadline &amp; priority…</button></div>` : ""}</div>
      ${can && j.engineerUid && j.status !== "cancelled" ? `<div class="card stack"><h3>Update</h3><form class="stack" id="eu-f">
        <div class="field"><span class="lbl">Status</span><div class="chips" id="eu-chips">${O.ENG.map(([k, l]) => `<button type="button" class="chip${ev.status === k ? " is-on" : ""}" data-st="${k}">${esc(SHORT[k])}</button>`).join("")}</div><input type="hidden" id="eu-st" value="${esc(ev.status)}"></div>
        <div class="field"><span class="lbl">Manufacturing completion <b id="eu-pv">${ev.progress || 0}%</b></span><div class="row" style="flex-wrap:nowrap"><input type="range" min="0" max="100" step="1" id="eu-p" value="${ev.progress || 0}" style="flex:1" aria-label="Completion percent"><input class="in num" id="eu-pn" type="number" min="0" max="100" value="${ev.progress || 0}" style="width:80px" aria-label="Completion percent"></div>
          <div class="row">${[10, 25, 50, 75, 90, 100].map((v) => `<button type="button" class="btn ghost xs" data-pp="${v}">${v}%</button>`).join("")}</div></div>
        <div class="grid3"><label class="field"><span>Start date</span><input class="in" type="date" id="eu-sd" value="${esc(ev.startDate || "")}"></label><label class="field"><span>Target completion</span><input class="in" type="date" id="eu-dl" value="${esc(ev.expectedCompletion || "")}"></label><label class="field"><span>Deadline flag</span><select class="in" id="eu-r"><option value="">Automatic</option><option value="atrisk"${ev.risk === "atrisk" ? " selected" : ""}>At Risk</option><option value="delayed"${ev.risk === "delayed" ? " selected" : ""}>Delayed</option></select></label></div>
        <div class="grid3"><label class="field"><span>Installation date</span><input class="in" type="date" id="eu-id" value="${esc(ev.installDate || "")}"></label><label class="field"><span>Installation progress %</span><input class="in num" type="number" min="0" max="100" id="eu-ip" value="${ev.installProgress || 0}"></label><label class="field"><span>Next required action</span><input class="in" id="eu-na" value="${esc(ev.nextAction || "")}"></label></div>
        <label class="field"><span>Note (required for on hold, delayed, blocked or a changed target date)</span><input class="in" id="eu-n"></label>
        <label class="field"><span>Update visible to sales (what they can tell the client)</span><input class="in" id="eu-sn" value="${esc(ev.salesNote || "")}"></label>
        <p class="small" id="eu-err" style="color:var(--red)"></p><div class="row"><button class="btn lime">Save update</button></div></form></div>
      <div class="card stack"><div class="row between"><h3>Quality check</h3><select class="in sm" id="qc-st" style="width:auto">${Object.entries(O.QC).map(([k, l]) => `<option value="${k}"${(ev.qc || {}).status === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="qcl">${((ev.qc || {}).checklist || []).map((c, i) => `<label class="check"><input type="checkbox" data-qc="${i}" ${c.ok ? "checked" : ""}> ${esc(c.item)}</label>`).join("") || `<p class="small muted">No checklist.</p>`}</div>
        <div class="row"><input class="in sm" id="qc-add" placeholder="Add a checklist item" style="max-width:320px"><button class="btn ghost sm" id="qc-save">Save quality check</button></div></div>
      <div class="card stack"><div class="row between"><h3>Blockers &amp; risks</h3><button class="btn ghost sm" id="bl-add">${U.svg("plus")} Report a blocker…</button></div>
        ${(ev.blockers || []).length ? `<div class="tl">${ev.blockers.slice().reverse().map((b) => `<div><span class="tiny muted">${esc(H.dateS(b.at))}</span><span>${b.resolvedAt ? "<s>" : "<b>"}${esc(b.text)}${b.resolvedAt ? "</s>" : "</b>"}${b.dependsOn ? ` · depends on: ${esc(b.dependsOn)}` : ""} ${b.resolvedAt ? `<span class="pill ok">resolved ${esc(H.dateS(b.resolvedAt))}</span>` : `<button class="btn ghost xs" data-bres="${esc(b.id)}">Resolve</button>`}</span></div>`).join("")}</div>` : `<p class="small muted">No blockers recorded.</p>`}</div>` : ""}
      ${j.engineerUid ? `<div class="card stack"><div class="row between"><h3>Factory / workshop</h3>${can ? `<button class="btn ghost sm" id="fa-ed">Assign production…</button>` : ""}</div>
        <div class="kv"><span>Destination</span><b>${esc(fac.dest ? O.METHODS[fac.dest] : "Not assigned")}</b>${fac.workshop && fac.workshop.name ? `<span>Workshop</span><span>${esc([fac.workshop.name, fac.workshop.contact, fac.workshop.phone].filter(Boolean).join(" · "))}</span>` : ""}${fac.dest === "mixed" && fac.split ? `<span>Split</span><span>${Object.values(fac.split).filter((v) => v === "inhouse").length} item line(s) in-house · ${Object.values(fac.split).filter((v) => v === "outsourced").length} outsourced</span>` : ""}${fac.notes ? `<span>Notes</span><span>${esc(fac.notes)}</span>` : ""}</div></div>` : ""}
      ${j.engineerUid ? `<div class="card stack"><div class="row between"><h3>Project team</h3>${can ? `<button class="btn ghost sm" id="tm-add">${U.svg("plus")} Assign worker…</button>` : ""}</div>
        ${(xv.team || []).length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Name</th><th>Role</th><th>Dates</th><th>Since</th>${can ? "<th></th>" : ""}</tr></thead><tbody>${xv.team.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.external ? ' <span class="pill">outsourced</span>' : ""}${t.wid ? `<div class="tiny muted">${esc(t.wid)}</div>` : ""}</td><td class="small">${esc(t.role)}</td><td class="small">${esc([t.from, t.to].filter(Boolean).join(" → ") || "—")}</td><td class="small">${esc(H.dateS(t.addedAt))}</td>${can ? `<td><button class="btn ghost xs" data-rm="${esc(t.id)}">Remove</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No team yet.</p>`}
        ${(xv.teamHistory || []).length ? `<details><summary class="small">Team history</summary><div class="tl">${xv.teamHistory.slice().reverse().map((h) => `<div><span class="tiny muted">${esc(new Date(h.at).toLocaleString())}</span><span>${esc(h.action)} ${esc(h.who)} (${esc(h.role)})${h.reason ? " — " + esc(h.reason) : ""}</span></div>`).join("")}</div></details>` : ""}</div>` : ""}
      <div class="card stack"><h3>Handover pack</h3>${ho ? `<div class="kv"><span>Scope</span><span>${esc(((ho.project || {}).proposal || {}).scope || "—")}</span><span>Installation</span><span>${esc(((ho.project || {}).proposal || {}).installation || "—")}</span><span>Assumptions</span><span>${esc(((ho.project || {}).proposal || {}).assumptions || "—")}</span><span>Exclusions</span><span>${esc(((ho.project || {}).proposal || {}).exclusions || "—")}</span></div>
        <div class="tablewrap"><table class="mtable"><thead><tr><th>Code</th><th>Item</th><th class="r">Quantity</th><th>Unit</th>${fac.dest === "mixed" ? "<th>Produced</th>" : ""}</tr></thead><tbody>${(ho.items || []).map((i) => `<tr><td class="small"><b>${esc(i.code)}</b></td><td>${esc(i.name)}</td><td class="r">${esc(DPPricing.fmtQty(i.qty, i.unit))}</td><td class="small">${esc(DPPricing.UNIT_LABEL[i.unit] || i.unit)}</td>${fac.dest === "mixed" ? `<td class="small">${esc(((fac.split || {})[i.key] === "outsourced") ? "Outsourced" : "In-house")}</td>` : ""}</tr>`).join("")}</tbody></table></div>
        ${ho.project ? `<canvas id="ho-cv" width="1200" height="700" style="width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:12px"></canvas><div class="row"><button class="btn ghost sm" id="ho-png">${U.svg("export")} Site plan (PNG)</button><button class="btn ghost sm" id="ho-tech">${U.svg("export")} Technical drawing (A3 PDF)</button></div>` : `<p class="small muted">The plan was too large to include; ask sales for the drawing.</p>`}` : `<p class="small muted">Handover pack not available.</p>`}</div>
      ${j.engineerUid ? `<div class="card stack"><div class="row between"><h3>Attachments</h3>${can ? `<button class="btn ghost sm" id="tf-add">${U.svg("clip")} Attach…</button>` : ""}</div>
        ${(xv.files || []).length ? `<div class="tl">${xv.files.map((f) => `<div><span class="tiny muted">${esc(H.dateS(f.at))}</span><span><button class="linkbtn" data-tf="${esc(f.id)}">${esc(f.name)}</button> <span class="muted small">${Math.round(f.size / 1024)} kB · ${esc(AU().nameSync(f.by) || "")}</span></span></div>`).join("")}</div>` : `<p class="small muted">None.</p>`}</div>
      <div class="card stack"><div class="row between"><h3>Internal engineering notes</h3>${can ? `<button class="btn ghost sm" id="nt-add">Add note…</button>` : ""}</div>
        ${(xv.notes || []).length ? `<div class="tl">${xv.notes.slice().reverse().map((n) => `<div><span class="tiny muted">${esc(new Date(n.at).toLocaleString())}</span><span>${esc(n.text)} <span class="muted">— ${esc(AU().nameSync(n.by) || "")}</span></span></div>`).join("")}</div>` : `<p class="small muted">None. These notes are not visible to sales.</p>`}</div>
      <div class="card stack"><h3>Order timeline</h3><div class="tl">${(ev.log || []).slice().reverse().slice(0, 60).map((l) => `<div><span class="tiny muted">${esc(new Date(l.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span>${esc(l.what)}${l.note ? " — " + esc(l.note) : ""} <span class="muted">${esc(AU().nameSync(l.by) || "")}</span></span></div>`).join("") || "<span class='small muted'>No updates yet.</span>"}</div></div>` : ""}</div>`;
    const refresh = () => reload();
    const take = $("#eo-take"); if (take) take.onclick = async () => { take.disabled = true; try { await O.takeJob(j.oid); U.toast("The order is yours. Sales and administrators are notified."); F.view = "mine"; F.sel = j.oid; renderEngOrders(); } catch (e2) { U.toast(e2.message, { err: true }); take.disabled = false; } };
    const asg = $("#eo-asg"); if (asg) asg.onclick = () => assignDlg(j, refresh);
    const dl2 = $("#eo-dl2"); if (dl2) dl2.onclick = () => deadlineDlg(j, refresh);
    if (ho && ho.project) drawPlan($("#ho-cv"), ho.project);
    const f = $("#eu-f");
    if (f) {
      const p = $("#eu-p"), pn = $("#eu-pn"), pv = $("#eu-pv"), setP = (v) => { p.value = pn.value = v; pv.textContent = v + "%"; };
      p.oninput = () => setP(p.value); pn.oninput = () => setP(Math.max(0, Math.min(100, +pn.value || 0))); $$("[data-pp]", B).forEach((b) => (b.onclick = () => setP(b.dataset.pp)));
      $$("[data-st]", B).forEach((b) => (b.onclick = () => { $$("[data-st]", B).forEach((y) => y.classList.toggle("is-on", y === b)); $("#eu-st").value = b.dataset.st; if (b.dataset.st === "completed" && +p.value < 100) setP(100); if (O.EXPLAIN.includes(b.dataset.st)) $("#eu-n").focus(); }));
      f.onsubmit = async (ev2) => { ev2.preventDefault(); const err = $("#eu-err"); err.textContent = "";
        const patch = { status: $("#eu-st").value, progress: +p.value, risk: $("#eu-r").value, startDate: $("#eu-sd").value || null, installDate: $("#eu-id").value || null, installProgress: +$("#eu-ip").value || 0, nextAction: $("#eu-na").value.trim() }; const dl = $("#eu-dl").value; if (dl && dl !== ev.expectedCompletion) patch.expectedCompletion = dl;
        if (patch.risk) patch.riskReason = $("#eu-n").value.trim() || ev.riskReason || "";
        const btn = f.querySelector("button.lime"); btn.disabled = true;
        try { await O.updateEng(j.oid, patch, { note: $("#eu-n").value.trim(), salesNote: $("#eu-sn").value }); U.toast("Update saved. Sales and administrators can see it."); refresh(); } catch (x2) { err.textContent = x2.message; btn.disabled = false; } };
      $("#qc-save").onclick = async () => { const cl = ((ev.qc || {}).checklist || []).map((c, i) => Object.assign({}, c, { ok: $(`[data-qc="${i}"]`, B).checked })); const add = $("#qc-add").value.trim(); if (add) cl.push({ item: add, ok: false, note: "" });
        const st = $("#qc-st").value; if (st === "passed" && cl.some((c) => !c.ok)) { if (!(await U.ask("Pass the quality check?", "<p>Some checklist items are not ticked.</p>", [{ label: "Go back", value: false, cls: "ghost" }, { label: "Pass anyway", value: true }]))) return; }
        try { await O.updateEng(j.oid, { qc: { status: st, checklist: cl, by: uid, at: new Date().toISOString() } }, { note: st === "failed" ? "Quality check failed" : "" }); U.toast("Quality check saved."); refresh(); } catch (x3) { U.toast(x3.message, { err: true }); } };
      $("#bl-add").onclick = async () => { const fm = await U.form("Report a blocker", [{ id: "t", label: "What is blocking or at risk", type: "textarea", required: true }, { id: "d", label: "Depends on (supplier, client, permit…)" }, { id: "flag", label: "Mark the order as at risk", type: "check", value: true }], { submit: "Report" }); if (!fm) return;
        const bl = (ev.blockers || []).concat([{ id: "b" + Date.now().toString(36), text: fm.t, dependsOn: fm.d || "", at: new Date().toISOString(), by: uid }]);
        try { await O.updateEng(j.oid, Object.assign({ blockers: bl }, fm.flag ? { risk: "atrisk", riskReason: fm.t } : {}), { note: "Blocker: " + fm.t }); U.toast("Blocker recorded. Sales and administrators are notified."); refresh(); } catch (x4) { U.toast(x4.message, { err: true }); } };
      $$("[data-bres]", B).forEach((b) => (b.onclick = async () => { const fm = await U.form("Resolve blocker", [{ id: "n", label: "How it was resolved", required: true }], { submit: "Resolve" }); if (!fm) return;
        const bl = (ev.blockers || []).map((x5) => (x5.id === b.dataset.bres ? Object.assign({}, x5, { resolvedAt: new Date().toISOString(), resolvedBy: uid, resolution: fm.n }) : x5)); const still = bl.some((x5) => !x5.resolvedAt);
        try { await O.updateEng(j.oid, Object.assign({ blockers: bl }, !still && ev.risk === "atrisk" ? { risk: "" } : {}), { note: "Blocker resolved: " + fm.n }); refresh(); } catch (x6) { U.toast(x6.message, { err: true }); } }));
    }
    const fa = $("#fa-ed"); if (fa) fa.onclick = () => productionDlg(j, ho, refresh);
    const ta = $("#tm-add"); if (ta) ta.onclick = () => teamDlg(j, refresh);
    $$("[data-rm]", B).forEach((b) => (b.onclick = async () => { const fm = await U.form("Remove from team", [{ id: "r", label: "Reason" }], { submit: "Remove", intro: "The worker's allocation history is kept." }); if (!fm) return; await O.removeTeamMember(j.oid, b.dataset.rm, fm.r); refresh(); }));
    const tf = $("#tf-add"); if (tf) tf.onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (file) => { try { await O.addTechFile(j.oid, file); U.toast("Attached."); refresh(); } catch (x4) { U.toast(x4.message, { err: true }); } });
    $$("[data-tf]", B).forEach((b) => (b.onclick = async () => DPUI.showFile(await O.techFile(j, b.dataset.tf), "Project file")));
    const na = $("#nt-add"); if (na) na.onclick = async () => { const fm = await U.form("Internal engineering note", [{ id: "t", label: "Note (not visible to sales)", type: "textarea", required: true }], { submit: "Add" }); if (!fm) return; await O.updateEngx(j.oid, (x5) => { x5.notes = (x5.notes || []).concat([{ at: new Date().toISOString(), by: uid, text: fm.t }]); return x5; }); refresh(); };
    const png = $("#ho-png"); if (png) png.onclick = () => { const cv = document.createElement("canvas"); cv.width = 3000; cv.height = 2000; drawPlan(cv, ho.project, true); cv.toBlob((b) => U.downloadOut({ blob: b, filename: `${(j.ref || j.oid)}-site-plan.png` }, "Site plan"), "image/png"); };
    const tech = $("#ho-tech"); if (tech) tech.onclick = async () => {
      const M = DPModel, saved = { project: M.S.project, cad: M.S.cadData, ref: M.S.refImage, open: App.open, sample: App.sample };
      const b2 = U.busy("Preparing the technical drawing…");
      try { M.load(ho.project, {}); App.sample = false; const out = await DPProposal.technical(); b2.done(); await U.downloadOut(out, "Technical drawing"); }
      catch (x6) { b2.done(); U.toast(x6.message || "The drawing could not be built.", { err: true }); }
      finally { if (saved.project) M.load(saved.project, { cadData: saved.cad, refImage: saved.ref }); App.open = saved.open; App.sample = saved.sample; }
    };
  }
  function drawPlan(cv, project, big) {
    if (!cv) return; const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    const pts = []; if (project.site && project.site.poly) pts.push(...project.site.poly); for (const o of project.objects || []) { const s = DPModel.shapes(o); if (!s.missing) pts.push(...DPModel.outline(o).flat()); }
    if (!pts.length) return; const b = DPGeom.bbox(pts), pad = big ? 80 : 30, s = Math.min((cv.width - 2 * pad) / Math.max(b.w, 1e-6), (cv.height - 2 * pad) / Math.max(b.h, 1e-6));
    const P = new DPPen({ kind: "canvas", ctx, minLine: 0.6 }); P.setMatrix([s, 0, 0, s, cv.width / 2 - (b.x0 + b.w / 2) * s, cv.height / 2 - (b.y0 + b.h / 2) * s]);
    DPPlan.draw(P, { project, mode: "presentation", show: { grid: false, labels: true, dims: true, zones: true }, ts: big ? 1.4 : 0.9 });
  }
  /** Production assignment: in-house factory, outsourced workshop, or mixed (per item line). */
  async function productionDlg(j, ho, done) {
    const e = j.e || {}, fac = e.factory || {}, ws = fac.workshop || {}, items = (ho && ho.items) || [];
    U.openModal(`<h2>Assign production</h2><p class="small muted">${esc(j.name)}</p>
      <div class="seg" role="group" aria-label="Destination">${Object.entries(O.METHODS).map(([k, l]) => `<button type="button" data-dest="${k}" class="${fac.dest === k ? "is-on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div id="pd-ws" class="stack" style="margin-top:10px"><div class="grid3"><label class="field"><span>Workshop / supplier</span><input class="in" id="pd-n" value="${esc(ws.name || "")}"></label><label class="field"><span>Contact person</span><input class="in" id="pd-c" value="${esc(ws.contact || "")}"></label><label class="field"><span>Phone</span><input class="in" id="pd-p" value="${esc(ws.phone || "")}"></label></div></div>
      <div id="pd-mix" class="stack" style="margin-top:10px">${items.length ? `<p class="small muted">Choose where each item line is produced.</p><div class="tablewrap" style="max-height:260px"><table class="mtable"><tbody>${items.map((i) => `<tr><td class="small"><b>${esc(i.code)}</b> ${esc(i.name)}</td><td><select class="in sm" data-split="${esc(i.key)}"><option value="inhouse">In-house</option><option value="outsourced"${((fac.split || {})[i.key] === "outsourced") ? " selected" : ""}>Outsourced</option></select></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No item lines in the handover pack.</p>`}</div>
      <label class="field"><span>Production notes (no prices or costs)</span><textarea class="in" id="pd-notes" rows="2">${esc(fac.notes || "")}</textarea></label>
      <label class="check"><input type="checkbox" id="pd-st" ${["review", "assign"].includes(e.status || "review") ? "checked" : ""}> Set the status to Under Manufacturing / Outsourced Manufacturing now</label>
      <p class="small" id="pd-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="pd-x">Cancel</button><button class="btn lime" id="pd-ok">Save</button></div>`, (m) => {
      let dest = fac.dest || ""; const sync = () => { $("#pd-ws", m).hidden = !["outsourced", "mixed"].includes(dest); $("#pd-mix", m).hidden = dest !== "mixed"; $$("[data-dest]", m).forEach((b) => b.classList.toggle("is-on", b.dataset.dest === dest)); };
      $$("[data-dest]", m).forEach((b) => (b.onclick = () => { dest = b.dataset.dest; sync(); })); sync();
      $("#pd-x", m).onclick = () => U.closeModal();
      $("#pd-ok", m).onclick = async () => { const err = $("#pd-err", m); if (!dest) { err.textContent = "Choose In-House Factory, Outsourced Workshop or Mixed."; return; }
        if (dest !== "inhouse" && !$("#pd-n", m).value.trim()) { err.textContent = "Name the outsourced workshop."; return; }
        const notes = $("#pd-notes", m).value.trim(); if (/\b(egp|usd|eur|price|cost)\b|[$£€]/i.test(notes)) { err.textContent = "Production notes must not contain prices or costs."; return; }
        const split = dest === "mixed" ? Object.fromEntries($$("[data-split]", m).map((s) => [s.dataset.split, s.value])) : null;
        const patch = { method: dest, factory: { dest, workshop: dest !== "inhouse" ? { name: $("#pd-n", m).value.trim(), contact: $("#pd-c", m).value.trim(), phone: $("#pd-p", m).value.trim() } : null, split, notes, at: new Date().toISOString(), by: DPStore.st.userId } };
        if ($("#pd-st", m).checked) patch.status = dest === "outsourced" ? "outsourced" : "manufacturing";
        try { await O.updateEng(j.oid, patch, { note: `Production: ${O.METHODS[dest]}${patch.factory.workshop ? " — " + patch.factory.workshop.name : ""}` }); U.closeModal(); U.toast("Production assigned."); done && done(); } catch (x) { err.textContent = x.message; } };
    }, { wide: true });
  }
  async function teamDlg(j, done) {
    const workers = (await O.listWorkers()).filter((w) => w.active !== false), e = j.e || {};
    const fm = await U.form("Assign a worker", [{ id: "w", label: "From the Worker Directory", type: "select", value: workers[0] ? workers[0].wid : "", options: workers.map((w) => ({ value: w.wid, label: `${w.name} · ${w.trade || ""}${w.type === "outsourced" ? " (outsourced)" : ""}${(w.assignments || []).some((s) => !s.removedAt) ? " · allocated" : " · available"}` })).concat([{ value: "", label: "— someone not in the directory —" }]) },
      { id: "name", label: "Name (only if not in the directory)" }, { id: "role", label: "Role on this order", type: "select", value: "Installer", options: O.ROLES.map((r) => ({ value: r, label: r })) },
      { id: "from", label: "From", type: "date", value: e.startDate || today() }, { id: "to", label: "To (planned)", type: "date", value: e.expectedCompletion || "" }], { submit: "Assign" });
    if (!fm) return; const w = workers.find((x) => x.wid === fm.w);
    if (!w && !fm.name.trim()) return U.toast("Choose a worker or type a name.", { err: true });
    const m = { wid: w ? w.wid : null, name: w ? w.name : fm.name.trim(), role: fm.role, external: w ? w.type === "outsourced" : false, from: fm.from || null, to: fm.to || null };
    try { await O.addTeamMember(j.oid, m); U.toast("Worker assigned. Their directory record shows the allocation."); done(); }
    catch (err) { if (err.code === "overlap") { if (await U.ask("Possible double booking", `<p>${esc(err.message)}</p><p>Assign anyway?</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Assign anyway", value: true, cls: "danger" }])) { await O.addTeamMember(j.oid, m, { allowOverlap: true }); U.toast("Assigned (overlap acknowledged)."); done(); } } else U.toast(err.message, { err: true }); }
  }
  async function assignDlg(j, done) {
    const engineers = DPAuth.A.directory.filter((r) => r.uid && r.active !== false && DPAuth.baseOf(r.role) === "engineer"); if (!engineers.length) return U.toast("Create an Engineer account first.", { err: true });
    const fm = await U.form(`Engineer for ${j.name}`, [{ id: "u", label: "Engineer", type: "select", value: j.engineerUid || engineers[0].uid, options: engineers.map((r) => ({ value: r.uid, label: DPAuth.fullName(r) })) }, { id: "d", label: "Project deadline (contractual)", type: "date", value: j.deadlineOriginal || "" }, { id: "r", label: "Note / reason", required: !!j.engineerUid }], { submit: "Assign" });
    if (!fm) return; try { if (fm.d && fm.d !== j.deadlineOriginal) await O.setAssignField(j.oid, { deadlineOriginal: fm.d }, "Deadline set at assignment"); await O.assignEngineer(j.oid, fm.u, { reason: fm.r, deadline: fm.d || j.deadlineOriginal || null }); U.toast("Engineer assigned and notified."); done(); } catch (e) { U.toast(e.message, { err: true }); }
  }
  async function deadlineDlg(j, done) {
    const fm = await U.form("Project deadline and priority", [{ id: "d", label: "Project deadline (contractual)", type: "date", value: j.deadlineOriginal || "" }, { id: "p", label: "Priority", type: "select", value: j.priority || "normal", options: Object.entries(PRI).map(([v, l]) => ({ value: v, label: l })) }, { id: "r", label: "Reason", required: true }], { submit: "Save" });
    if (!fm) return; try { await O.setAssignField(j.oid, { deadlineOriginal: fm.d || null, priority: fm.p }, fm.r); U.toast("Saved. The engineer is notified of a deadline change."); done(); } catch (e) { U.toast(e.message, { err: true }); }
  }

  /* ---------------- Factory ---------------- */
  async function renderFactory(opts = {}) {
    if (opts.dest) F.fd = opts.dest;
    const V = $("#view-factory");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Engineering</span><h1><em>Factory</em> &amp; workshops</h1><p class="lead small">Where every order is produced — Dupedia's in-house factory or an outsourced workshop — with workers, progress and deadlines. Connected to the order record: nothing is copied.</p></div></div><div id="fa-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    const all = (await jobs()).filter((j) => j.status !== "cancelled"), uid = DPStore.st.userId, scope = U.isAdmin() || (DPAuth.A.record || {}).engineerSeesAll ? all : all.filter((j) => !j.engineerUid || j.engineerUid === uid);
    const dest = (j) => (j.e && j.e.factory && j.e.factory.dest) || "none", st = (j) => (j.e ? j.e.status : "review");
    const teams = {}; await Promise.all(scope.filter((j) => j.engineerUid).map(async (j) => { const x = await O.engxOf(j).catch(() => null); teams[j.oid] = (x && x.team) || []; }));
    const tiles = [["inhouse", "In-house factory", scope.filter((j) => ["inhouse", "mixed"].includes(dest(j)) && !["completed"].includes(st(j))).length], ["outsourced", "Outsourced workshops", scope.filter((j) => ["outsourced", "mixed"].includes(dest(j)) && !["completed"].includes(st(j))).length],
      ["none", "Awaiting production assignment", scope.filter((j) => dest(j) === "none" && !["completed"].includes(st(j))).length], ["prod", "In production", scope.filter((j) => ["manufacturing", "outsourced"].includes(st(j))).length],
      ["ready", "Ready for installation", scope.filter((j) => st(j) === "ready").length], ["late", "Delayed or blocked", scope.filter((j) => ["delayed", "blocked", "hold"].includes(st(j)) || j.ds.key === "delayed").length]];
    const pass = (j) => !F.fd || (F.fd === "inhouse" ? ["inhouse", "mixed"].includes(dest(j)) : F.fd === "outsourced" ? ["outsourced", "mixed"].includes(dest(j)) : F.fd === "none" ? dest(j) === "none" : F.fd === "prod" ? ["manufacturing", "outsourced"].includes(st(j)) : F.fd === "ready" ? st(j) === "ready" : F.fd === "late" ? ["delayed", "blocked", "hold"].includes(st(j)) || j.ds.key === "delayed" : true);
    const rows = sortJobs(scope.filter(pass).filter((j) => !F.fq || [j.name, j.ref, j.client, ((j.e || {}).factory || {}).workshop ? j.e.factory.workshop.name : ""].join(" ").toLowerCase().includes(F.fq.toLowerCase())));
    $("#fa-body").innerHTML = `<div class="stack"><div class="kcards">${tiles.map(([k, l, n]) => `<button type="button" class="kcard${F.fd === k ? " on" : ""}${k === "late" && n ? " bad" : k === "none" && n ? " warn" : ""}" data-fd="${k}"><span class="eyebrow">${esc(l)}</span><b class="num">${n}</b></button>`).join("")}</div>
      <div class="filters"><div class="search" style="width:260px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="fa-q" placeholder="Order, client or workshop" value="${esc(F.fq)}"></div>${F.fd ? `<button class="btn ghost xs" id="fa-clr">Show all</button>` : ""}</div>
      <div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>Order</th><th>Destination</th><th>Workshop / workers</th><th>Status</th><th>Progress</th><th>Deadline</th></tr></thead><tbody>
      ${rows.map((j) => { const fac = (j.e && j.e.factory) || {}, tm = teams[j.oid] || []; return `<tr class="click" data-fo="${esc(j.oid)}"><td><b>${esc(j.name)}</b><div class="tiny muted">${esc([j.ref, j.client].filter(Boolean).join(" · "))}</div></td><td><span class="pill ${fac.dest ? "info" : "warn"}">${esc(fac.dest ? O.METHODS[fac.dest] : "Not assigned")}</span></td>
        <td class="small">${esc(fac.workshop && fac.workshop.name ? fac.workshop.name : "")}${tm.length ? `<div class="tiny muted">${esc(tm.map((t) => t.name).join(", "))}</div>` : fac.dest && fac.dest !== "outsourced" ? `<div class="tiny muted">No workers yet</div>` : ""}</td><td class="small">${esc(j.e ? SHORT[j.e.status] : j.engineerUid ? "Review" : "Unassigned")}</td><td style="min-width:120px">${progHtml(j.e)}</td><td><span class="dl ${j.ds.key}">${esc(j.ds.key === "none" ? "No deadline" : j.ds.label)}</span><div class="tiny muted">${esc((j.e && j.e.expectedCompletion) || j.deadlineOriginal || "")}</div></td></tr>`; }).join("") || `<tr><td colspan="6"><div class="empty small">Nothing here.</div></td></tr>`}</tbody></table></div></div></div>`;
    $$("[data-fd]", V).forEach((b) => (b.onclick = () => { F.fd = F.fd === b.dataset.fd ? "" : b.dataset.fd; renderFactory(); }));
    const clr = $("#fa-clr"); if (clr) clr.onclick = () => { F.fd = ""; renderFactory(); };
    $("#fa-q").oninput = (e) => { F.fq = e.target.value; clearTimeout(F.ft); F.ft = setTimeout(() => renderFactory(), 300); };
    $$("[data-fo]", V).forEach((tr) => (tr.onclick = () => factoryPopup(rows.find((j) => j.oid === tr.dataset.fo), teams[tr.dataset.fo] || [])));
  }
  function factoryPopup(j, team) {
    const e = j.e || {}, fac = e.factory || {}, blocks = (e.blockers || []).filter((b) => !b.resolvedAt), can = U.isAdmin() || j.engineerUid === DPStore.st.userId;
    U.openModal(`<span class="eyebrow">${esc(j.ref || "")} · ${esc(j.oid)}</span><h2>${esc(j.name)}</h2><div class="kv"><span>Production destination</span><b>${esc(fac.dest ? O.METHODS[fac.dest] : "Not assigned")}</b>${fac.workshop && fac.workshop.name ? `<span>Workshop</span><span>${esc([fac.workshop.name, fac.workshop.contact, fac.workshop.phone].filter(Boolean).join(" · "))}</span>` : ""}
      <span>Assigned workers</span><span>${team.length ? esc(team.map((t) => `${t.name} (${t.role})`).join(", ")) : "—"}</span><span>Engineer</span><span>${esc(j.engineerUid ? DPAuth.nameSync(j.engineerUid) : "Unassigned")}</span><span>Manufacturing status</span><span>${esc(e.status ? O.ENG_LABEL[e.status] : "Awaiting Engineering Review")}</span><span>Completion</span><b>${e.progress || 0}%</b>
      <span>Deadline</span><span>${esc(e.expectedCompletion || j.deadlineOriginal || "Not set")} · <span class="dl ${j.ds.key}">${esc(j.ds.label)}</span></span>${fac.notes ? `<span>Notes</span><span>${esc(fac.notes)}</span>` : ""}${blocks.length ? `<span>Blockers</span><span>${esc(blocks.map((b) => b.text).join(" · "))}</span>` : ""}${e.nextAction ? `<span>Next action</span><span>${esc(e.nextAction)}</span>` : ""}</div>
      <div class="acts"><button class="btn ghost" id="fp-x">Close</button><button class="btn" id="fp-o">Open order</button></div>`, (m) => { $("#fp-x", m).onclick = () => U.closeModal(); $("#fp-o", m).onclick = () => { U.closeModal(); F.view = j.engineerUid ? "mine" : "queue"; U.go("engorders", { oid: j.oid }); }; void can; });
  }

  /* ---------------- administrator: engineering queue ---------------- */
  async function renderQueue() {
    const V = $("#view-engqueue");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Engineering</h1><p class="lead small">Accepted orders waiting for an engineer, and every order's production status. Engineers can pick orders up themselves; you can assign or change the engineer, deadlines and priority at any time.</p></div><div class="row"><button class="btn ghost sm" id="eq-all">Engineering orders</button><button class="btn ghost sm" id="eq-fac">Factory</button></div></div><div id="eq-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $("#eq-all").onclick = () => U.go("engorders"); $("#eq-fac").onclick = () => U.go("factory");
    const all = await jobs(), engineers = DPAuth.A.directory.filter((r) => r.uid && r.active !== false && DPAuth.baseOf(r.role) === "engineer");
    const un = all.filter((a) => !a.engineerUid && a.status !== "cancelled");
    App.badges = Object.assign(App.badges || {}, { engqueue: un.length }); H.rail();
    const load = engineers.map((r) => ({ r, n: all.filter((j) => j.engineerUid === r.uid && !(j.e && j.e.status === "completed") && j.status !== "cancelled").length }));
    $("#eq-body").innerHTML = `<div class="stack">${!engineers.length ? `<div class="note warn small">No engineers yet. Create an Engineer account in User Management.</div>` : `<div class="stats">${load.map((x) => H.stat(DPAuth.fullName(x.r), x.n, "open orders")).join("")}</div>`}
      <div class="card stack"><h3>Unassigned queue (${un.length})</h3>${un.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Accepted</th><th>Order</th><th>Sales</th><th>Deadline</th><th>Priority</th><th></th></tr></thead><tbody>${un.map((a) => `<tr><td class="small">${esc(H.dateS(a.acceptedAt))}</td><td><b>${esc(a.name)}</b><div class="tiny muted">${esc([a.ref, a.client].filter(Boolean).join(" · "))}</div></td><td class="small">${esc(DPAuth.nameSync(a.salesUid))}</td><td class="small">${esc(a.deadlineOriginal || "Not set")}</td><td class="small">${esc(PRI[a.priority || "normal"])}</td><td><button class="btn lime xs" data-as="${esc(a.oid)}">Assign…</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">Nothing waiting.</p>`}</div>
      <div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>Order</th><th>Engineer</th><th>Status</th><th>Production</th><th>Progress</th><th>Deadline / target</th><th>Deadline status</th><th></th></tr></thead><tbody>
      ${all.filter((a) => a.engineerUid).map((a) => `<tr><td><button type="button" class="linkbtn" data-ep="${esc(a.oid)}" title="Engineering summary"><b>${esc(a.name)}</b></button><div class="tiny muted">${esc([a.ref, a.client, a.status === "cancelled" ? "cancelled" : ""].filter(Boolean).join(" · "))}</div></td><td class="small">${esc(DPAuth.nameSync(a.engineerUid))}${a.via === "pickup" ? '<div class="tiny muted">picked up</div>' : a.via === "default" ? '<div class="tiny muted">default engineer</div>' : ""}</td><td>${statusPill(a)}${a.e && a.e.completionException && !a.e.completionException.approved ? ' <span class="pill warn">completion exception</span>' : ""}</td><td class="small">${esc(a.e && a.e.factory && a.e.factory.dest ? O.METHODS[a.e.factory.dest] : "—")}</td><td style="min-width:120px">${progHtml(a.e)}</td><td class="small">${esc(a.deadlineOriginal || "—")} / ${esc((a.e && a.e.expectedCompletion) || "—")}</td><td><span class="dl ${a.ds.key}">${esc(a.ds.label)}</span></td><td style="white-space:nowrap"><button class="btn ghost xs" data-as="${esc(a.oid)}">Engineer…</button> <button class="btn ghost xs" data-dl="${esc(a.oid)}">Deadline…</button></td></tr>`).join("") || `<tr><td colspan="8"><div class="empty small">No orders in engineering yet.</div></td></tr>`}</tbody></table></div></div></div>`;
    $$("[data-ep]", V).forEach((b) => (b.onclick = () => root.DPCeo2 && DPCeo2.engPanel(b.dataset.ep)));
    if (!(DPUI.App.config.settings.engineering || {}).defaultEngineer) $("#eq-body").insertAdjacentHTML("afterbegin", `<div class="note warn small">No default engineer is set, so every accepted order waits here until someone is assigned. Set one in Admin › Settings.</div>`);
    $$("[data-as]", V).forEach((b) => (b.onclick = () => assignDlg(all.find((x) => x.oid === b.dataset.as), renderQueue)));
    $$("[data-dl]", V).forEach((b) => (b.onclick = () => deadlineDlg(all.find((x) => x.oid === b.dataset.dl), renderQueue)));
  }

  /* ---------------- Worker Directory ---------------- */
  async function renderWorkers() {
    const V = $("#view-workers"), can = U.isAdmin() || isEng();
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Engineering</span><h1>Worker <em>Directory</em></h1><p class="lead small">Company employees and outsourced workers you allocate to projects. Being listed gives no access to X FORCE. National ID documents are private to engineers and administrators.</p></div>${can ? `<div class="row"><button class="btn lime" id="wk-add">${U.svg("plus")} Add worker</button></div>` : ""}</div>
      <div class="filters"><div class="search" style="width:260px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="wk-q" placeholder="Name, phone, trade" value="${esc(F.wq)}"></div>
        <select class="in sm" id="wk-t"><option value="">All types</option>${Object.entries(O.WORKER_TYPES).map(([k, l]) => `<option value="${k}"${F.wt === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        <select class="in sm" id="wk-a"><option value="">Active and inactive</option><option value="active"${F.wa === "active" ? " selected" : ""}>Active</option><option value="avail"${F.wa === "avail" ? " selected" : ""}>Available (no open allocation)</option><option value="inactive"${F.wa === "inactive" ? " selected" : ""}>Inactive</option></select></div>
      <div class="card" style="padding:0"><div class="tablewrap" id="wk-list"><div class="empty"><div class="spinner"></div></div></div></div></div>`;
    const ws = await O.listWorkers(), pics = {};
    await Promise.all(ws.filter((w) => w.hasPic).map(async (w) => { pics[w.wid] = await O.workerPicture(w.wid).catch(() => null); }));
    const openAs = (w) => (w.assignments || []).filter((s) => !s.removedAt);
    const draw = () => { const q = F.wq.toLowerCase(), rows = ws.filter((w) => (!q || [w.name, w.trade, w.company, w.wid, w.phone].join(" ").toLowerCase().includes(q)) && (!F.wt || (w.type || (w.external ? "outsourced" : "employee")) === F.wt) && (!F.wa || (F.wa === "active" ? w.active !== false : F.wa === "inactive" ? w.active === false : w.active !== false && !openAs(w).length)));
      $("#wk-list").innerHTML = rows.length ? `<table class="mtable"><thead><tr><th></th><th>Name</th><th>Phone</th><th>Type</th><th>Current assignment</th><th>National ID</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((w) => `<tr><td style="width:44px"><img class="pic" width="34" height="34" alt="" src="${esc(pics[w.wid] || DPAuth.initialsAvatar(w.name))}"></td><td><button class="linkbtn" data-pf="${esc(w.wid)}"><b>${esc(w.name)}</b></button><div class="tiny muted">${esc([w.wid, w.trade, w.company].filter(Boolean).join(" · "))}</div></td><td class="small">${esc(w.phone || "")}</td>
        <td class="small">${esc(O.WORKER_TYPES[w.type || (w.external ? "outsourced" : "employee")])}</td><td class="small">${openAs(w).length ? esc(openAs(w).map((s) => s.name).join(", ")) : '<span class="muted">Available</span>'}</td>
        <td>${w.idDoc && w.idDoc.uploaded ? `<span class="pill ok" title="A document is on file. This does not verify its authenticity.">✓ On file</span>` : `<span class="pill warn">Missing</span>`}</td><td>${w.active === false ? '<span class="pill">Inactive</span>' : '<span class="pill ok">Active</span>'}</td><td>${can ? `<button class="btn ghost xs" data-ed="${esc(w.wid)}">Edit…</button>` : ""}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No workers${ws.length ? " match" : " yet"}.</div>`;
      $$("[data-ed]", V).forEach((b) => (b.onclick = () => edit(ws.find((w) => w.wid === b.dataset.ed))));
      $$("[data-pf]", V).forEach((b) => (b.onclick = () => profile(ws.find((w) => w.wid === b.dataset.pf)))); };
    $("#wk-q").oninput = (e) => { F.wq = e.target.value; draw(); }; $("#wk-t").onchange = (e) => { F.wt = e.target.value; draw(); }; $("#wk-a").onchange = (e) => { F.wa = e.target.value; draw(); };
    const add = $("#wk-add"); if (add) add.onclick = () => edit(null); draw();
    function profile(w) {
      const all = (w.assignments || []).slice().reverse();
      U.openModal(`<div class="row" style="gap:14px"><img class="pic" width="72" height="72" alt="" src="${esc(pics[w.wid] || DPAuth.initialsAvatar(w.name))}"><div><span class="eyebrow">${esc(w.wid)} · ${esc(O.WORKER_TYPES[w.type || (w.external ? "outsourced" : "employee")])}</span><h2>${esc(w.name)}</h2><span class="small muted">${esc([w.trade, w.company, w.phone].filter(Boolean).join(" · "))}</span></div></div>
        <div class="kv"><span>Status</span><span>${w.active === false ? "Inactive" : "Active"}</span><span>National ID</span><span>${w.idDoc && w.idDoc.uploaded ? `✓ Document on file (${esc(H.dateS(w.idDoc.at))}) — not a verification of authenticity ${can ? `<button class="btn ghost xs" id="wp-id">View</button>` : ""}` : "Missing"}</span>${w.notes ? `<span>Notes</span><span>${esc(w.notes)}</span>` : ""}</div>
        <h4>Active project assignments</h4>${openAs(w).length ? `<div class="tl">${openAs(w).map((s) => `<div><span class="small">${esc([s.from, s.to].filter(Boolean).join(" → ") || H.dateS(s.at))}</span><span><b>${esc(s.name)}</b> · ${esc(s.role)}</span></div>`).join("")}</div>` : `<p class="small muted">None — available.</p>`}
        <h4>Site allocation history</h4>${all.length ? `<div class="tl">${all.map((s) => `<div><span class="small">${esc(H.dateS(s.at))}</span><span>${esc(s.name)} · ${esc(s.role)}${s.removedAt ? ` · <span class="muted">ended ${esc(H.dateS(s.removedAt))}${s.removeReason ? " — " + esc(s.removeReason) : ""}</span>` : ' <span class="pill ok">current</span>'}</span></div>`).join("")}</div>` : `<p class="small muted">No allocations yet.</p>`}
        <div class="acts"><button class="btn ghost" id="wp-x">Close</button>${can ? `<button class="btn" id="wp-e">Edit…</button>` : ""}</div>`, (m) => {
        $("#wp-x", m).onclick = () => U.closeModal(); const e = $("#wp-e", m); if (e) e.onclick = () => { U.closeModal(); edit(w); };
        const id = $("#wp-id", m); if (id) id.onclick = async () => { const f = await O.idDoc(w.wid); if (!f) return U.toast(U.isAdmin() ? "The document has not been synchronised yet." : "The document is held by the engineer who uploaded it; it reaches you after an administrator session synchronises it.", { err: true, ms: 8000 }); DPUI.showFile(f, "National ID — confidential"); };
      }, { wide: true });
    }
    function edit(w) {
      let picFile = null, idFile = null;
      U.openModal(`<h2>${w ? "Edit " + esc(w.name) : "Add worker"}</h2>
        <div class="row" style="gap:14px"><img class="pic" id="we-pic" width="64" height="64" alt="" src="${esc((w && pics[w.wid]) || DPAuth.initialsAvatar(w ? w.name : "?"))}"><button type="button" class="btn ghost sm" id="we-pf">Upload picture…</button></div>
        <div class="grid2"><label class="field"><span>Full name *</span><input class="in" id="we-n" value="${esc(w ? w.name : "")}"></label><label class="field"><span>Phone number</span><input class="in" id="we-p" value="${esc(w ? w.phone || "" : "")}" placeholder="+20 …"></label></div>
        <div class="grid3"><label class="field"><span>Worker type</span><select class="in" id="we-t">${Object.entries(O.WORKER_TYPES).map(([k, l]) => `<option value="${k}"${(w ? w.type || (w.external ? "outsourced" : "employee") : "employee") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Trade</span><select class="in" id="we-tr">${O.ROLES.map((r) => `<option${(w ? w.trade : "Installer") === r ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></label><label class="field"><span>Company (outsourced)</span><input class="in" id="we-c" value="${esc(w ? w.company || "" : "")}"></label></div>
        <label class="field"><span>Notes</span><textarea class="in" id="we-no" rows="2">${esc(w ? w.notes || "" : "")}</textarea></label>
        <div class="field"><span class="lbl">National ID document (private: engineers and administrators only)</span><div class="row"><span class="small" id="we-idn">${w && w.idDoc && w.idDoc.uploaded ? "✓ On file — upload to replace" : "Not uploaded"}</span><button type="button" class="btn ghost sm" id="we-id">${U.svg("clip")} Upload…</button></div><small>A tick means a document is on file. It is not a verification of the document.</small></div>
        <label class="check"><input type="checkbox" id="we-a" ${!w || w.active !== false ? "checked" : ""}> Active</label>
        <p class="small" id="we-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="we-x">Cancel</button><button class="btn lime" id="we-ok">Save</button></div>`, (m) => {
        $("#we-pf", m).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp", async (f) => { try { const pf = await O.prepareFile(f); if (pf.type === "application/pdf") throw new Error("Use an image."); picFile = f; $("#we-pic", m).src = pf.dataUrl; } catch (e) { $("#we-err", m).textContent = e.message; } });
        $("#we-id", m).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { try { await O.prepareFile(f); idFile = f; $("#we-idn", m).textContent = "Selected: " + f.name; } catch (e) { $("#we-err", m).textContent = e.message; } });
        $("#we-x", m).onclick = () => U.closeModal();
        $("#we-ok", m).onclick = async () => { const err = $("#we-err", m), btn = $("#we-ok", m); err.textContent = ""; btn.disabled = true; btn.textContent = "Saving…";
          try { const wid = await O.saveWorker({ wid: w && w.wid, name: $("#we-n", m).value, phone: $("#we-p", m).value.trim(), type: $("#we-t", m).value, trade: $("#we-tr", m).value, company: $("#we-c", m).value.trim(), notes: $("#we-no", m).value, active: $("#we-a", m).checked });
            if (picFile) await O.setWorkerPicture(wid, picFile); if (idFile) await O.uploadIdDoc(wid, idFile);
            U.closeModal(); U.toast(`Saved (${wid}).`); renderWorkers(); } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = "Save"; } };
      }, { wide: true });
    }
  }

  U.register("engorders", renderEngOrders); U.register("engqueue", renderQueue); U.register("workers", renderWorkers); U.register("factory", renderFactory);
  Object.assign(DPUI, { renderEngDash });
})(typeof self !== "undefined" ? self : this);
