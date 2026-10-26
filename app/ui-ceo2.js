/* X FORCE 1.1 (Dupedia) — CEO / administrator experience: order record side panel (opens from any dashboard, alert,
   notification or list), engineering summary panel, Work Force directory with role-based profiles, collapsible sidebar.
   Everything here reads data the administrator's database level already allows; nothing widens access for other roles. */
/* global DPUI, DPShell, DPStore, DPAuth, DPSales, DPOrders, DPPricing, DPPay, DPPayUI, DPModel, DPLeads, DPLeadOps, DPCat */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, O = DPOrders;
  const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

  /* ---------------- side panel ---------------- */
  function drawer(html, bind, { label = "Details" } = {}) {
    let d = $("#ceo-drawer");
    if (!d) { d = document.createElement("aside"); d.id = "ceo-drawer"; d.className = "ceo-drawer"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "false"); document.body.appendChild(d);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !d.hidden && !($("#modal") || {}).open) closeDrawer(); }); }
    d.setAttribute("aria-label", label); d.hidden = false; d.innerHTML = `<div class="cd-in">${html}</div>`; d.scrollTop = 0;
    const x = d.querySelector("[data-close]"); if (x) x.onclick = closeDrawer; bind && bind(d); setTimeout(() => { const f = d.querySelector("[data-close]"); f && f.focus(); }, 30);
  }
  function closeDrawer() { const d = $("#ceo-drawer"); if (d) { d.hidden = true; d.innerHTML = ""; } }
  const sec = (title, body, open = true, extra = "") => `<details class="cd-sec" ${open ? "open" : ""}><summary><b>${title}</b>${extra}</summary><div class="cd-b">${body}</div></details>`;

  /* ---------------- order record ---------------- */
  async function orderPanel(oid) {
    if (!U.isAdmin()) return U.go("proposals", { oid });
    drawer(`<div class="cd-head"><span class="eyebrow">Order</span><button class="btn ghost xs" data-close aria-label="Close">✕</button></div><div class="empty"><div class="spinner"></div>Loading the order record…</div>`, null, { label: "Order record" });
    const [o, subs, reps, job] = await Promise.all([DPStore.tryGet(`orders/${oid}`), DPSales.allSubmissions().catch(() => []), O.listPaymentReports().catch(() => []), O.jobOf(oid).catch(() => null)]);
    const sub = subs.find((s) => s.oid === oid) || null;
    if (!o && !sub) return drawer(`<div class="cd-head"><span class="eyebrow">Order</span><button class="btn ghost xs" data-close aria-label="Close">✕</button></div><div class="note err">Order ${esc(oid)} was not found.</div>`);
    const [ho, ex, comm] = await Promise.all([job ? O.handoverOf(job).catch(() => null) : null, job ? O.engxOf(job).catch(() => null) : null, o ? DPStore.tryGet(`commissions/${o.ownerId}/r/${oid}`) : null]);
    const cur = (o && o.currency) || "EGP", e = job && job.e, ds = job && job.ds;
    const base = o || { totalMinor: sub.base && sub.base.totalMinor, schedule: sub.schedule, payments: [], acceptedAt: sub.acceptedAt, currency: cur };
    const myReps = reps.filter((r) => r.oid === oid), s = DPPay.summary(base, { reports: myReps, tz: App.config.settings.timezone, settings: App.config.settings });
    const items = ho && ho.project ? DPModel.takeoff(ho.project).filter((t) => t.qty > 0 && t.kind !== "annotation") : (ho && ho.items) || [];
    const owner = (o && o.ownerId) || (sub && sub.ownerId), pays = (o && o.payments) || [], fac = (e && e.factory) || {};
    const pst = DPPay.STATUS[s.status] || [s.status, ""], open = (e && (e.blockers || []).filter((b) => !b.resolvedAt)) || [];
    const tl = [].concat(((o && o.history) || []).map((h) => ({ at: h.at, t: h.action + (h.detail ? " — " + h.detail : ""), by: h.by })), ((ho && ho.history) || []).map((h) => ({ at: h.at, t: h.action + (h.detail ? " — " + h.detail : ""), by: h.by })),
      ((e && e.log) || []).map((l) => ({ at: l.at, t: "Engineering: " + l.what + (l.note ? " — " + l.note : ""), by: l.by })), pays.map((p) => ({ at: p.at, t: `Payment ${H.money2(p.amountMinor, cur)} — ${O.PAY_STATUS[p.status] || p.status}`, by: p.by })),
      myReps.map((r) => ({ at: r.at, t: `Payment ${H.money2(r.amountMinor, cur)} reported by sales — ${r.status}`, by: r.uid }))).filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const eng = (job && job.engineerUid) ? DPAuth.nameSync(job.engineerUid) + (job.via === "default" ? " (default engineer)" : job.via === "pickup" ? " (picked up)" : "") : "Unassigned";
    drawer(`<div class="cd-head"><div><span class="eyebrow">${esc([(o && o.ref) || (sub && sub.ref), oid].filter(Boolean).join(" · "))}</span><h2>${esc((o && o.name) || sub.name)}</h2><p class="small muted">${esc([(o && o.client) || sub.client, (o && o.location) || sub.location].filter(Boolean).join(" · "))}</p>
        <div class="row" style="gap:6px"><span class="pill ${o && o.status === "cancelled" ? "err" : "ok"}">${esc(o && o.status === "cancelled" ? "Cancelled" : "Accepted")}</span>${e ? `<span class="pill info">${esc(O.ENG_LABEL[e.status] || e.status)}</span>` : `<span class="pill">${esc(job && job.engineerUid ? "Awaiting engineering review" : "No engineer yet")}</span>`}<span class="pill ${pst[1]}">${esc(pst[0])}</span>${ds ? `<span class="dl ${ds.key}">${esc(ds.label)}</span>` : ""}</div></div>
        <button class="btn ghost xs" data-close aria-label="Close">✕</button></div>
      <div class="row cd-acts"><button class="btn ghost sm" id="cd-full">Open full order page</button>${job ? `<button class="btn ghost sm" id="cd-eng">Engineering summary</button>` : ""}${s.pendingMinor ? `<button class="btn lime sm" id="cd-ver">Verify payments</button>` : ""}</div>
      ${sec("Overview", `<dl class="kv small"><dt>Customer</dt><dd>${esc((o && o.client) || sub.client || "—")}</dd><dt>Project</dt><dd>${esc([(o && o.type) || sub.type, (o && o.location) || sub.location].filter(Boolean).join(" · ") || "—")}</dd><dt>Salesperson</dt><dd>${esc(DPAuth.nameSync(owner) || "—")}</dd>
        <dt>Quotation issued</dt><dd>${esc(H.dateS(sub && sub.issuedAt))}${sub && sub.rev ? ` · revision ${sub.rev}` : ""}</dd><dt>Client accepted</dt><dd>${esc(H.dateS((o && o.acceptedAt) || (sub && sub.acceptedAt)))} · recorded by ${esc(DPAuth.nameSync(sub && sub.acceptedBy) || "—")}</dd><dt>Booked</dt><dd>${o ? esc(dt(o.bookedAt)) + (o.booking === "automatic" ? " (automatic)" : "") : "Booking in progress"}</dd>
        ${sub && sub.contact ? `<dt>Site contact</dt><dd>${esc(sub.contact)}</dd>` : ""}${sub && sub.note ? `<dt>Acceptance note</dt><dd>${esc(sub.note)}</dd>` : ""}${sub && sub.evidence ? `<dt>Acceptance evidence</dt><dd><button class="linkbtn" id="cd-ev">${esc(sub.evidence.name)}</button></dd>` : ""}</dl>`)}
      ${sec("Products and quotation", `${items.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Code</th><th>Item</th><th class="r">Qty</th><th>Unit</th></tr></thead><tbody>${items.slice(0, 120).map((i) => `<tr><td class="small"><b>${esc(i.displayCode || i.code || "")}</b></td><td class="small">${esc(i.name)}</td><td class="r num">${esc(DPPricing.fmtQty(i.qty, i.unit))}</td><td class="small">${esc(DPPricing.UNIT_LABEL[i.unit] || i.unit)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No product list available.</p>`}
        ${o ? `<dl class="kv small"><dt>Subtotal</dt><dd class="num">${esc(H.money2(o.subtotalMinor, cur))}</dd><dt>Discount</dt><dd class="num">${esc(H.money2(o.discountMinor || 0, cur))}</dd><dt>${esc(App.config.settings.taxLabel || "VAT")}</dt><dd class="num">${esc(H.money2(o.taxMinor || 0, cur))}</dd><dt>Contract value</dt><dd class="num"><b>${esc(H.money2(o.totalMinor, cur))}</b></dd>
          ${(o.valueAdjustments || []).length ? `<dt>Amendments</dt><dd>${o.valueAdjustments.map((a) => `${esc(H.money2(a.amountMinor, cur))} — ${esc(a.reason)}`).join("<br>")}</dd>` : ""}${o.valueCheck ? `<dt>Value check</dt><dd><span class="pill warn">Booked value differs from the accepted quotation</span></dd>` : ""}
          ${o.costMinor != null ? `<dt>Estimated cost</dt><dd class="num">${esc(H.money2(o.costMinor, cur))}${o.costMissing ? ` <span class="tiny muted">(${o.costMissing} item(s) without cost)</span>` : ""}</dd>` : ""}</dl>` : ""}`)}
      ${sec("Payments", `${DPPayUI.positionHtml(s, cur, { admin: !!o && o.status !== "cancelled" })}
        ${pays.length || myReps.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Date</th><th class="r">Amount</th><th>Method</th><th>Status</th><th>Proof</th></tr></thead><tbody>
          ${pays.map((p) => `<tr><td class="small">${esc(p.date)}</td><td class="r num">${esc(H.money2(p.amountMinor, cur))}</td><td class="small">${esc(p.method || "—")}${p.ref ? `<div class="tiny muted">${esc(p.ref)}</div>` : ""}</td><td><span class="pill ${{ verified: "ok", rejected: "err" }[p.status] || "warn"}">${esc(O.PAY_STATUS[p.status || "recorded"])}</span></td><td>${(p.files || []).map((f) => `<button class="btn ghost xs" data-rc="${esc(f)}">${U.svg("eye")} View</button>`).join(" ") || '<span class="tiny muted">none</span>'}</td></tr>`).join("")}
          ${myReps.filter((r) => r.status === "submitted").map((r) => `<tr><td class="small">${esc(r.date)}</td><td class="r num">${esc(H.money2(r.amountMinor, cur))}</td><td class="small">${esc(r.method || "—")}</td><td><span class="pill warn">Reported — pending</span></td><td>${r.hasFile ? `<button class="btn ghost xs" data-rp="${esc(r.id)}" data-ru="${esc(r.uid)}">${U.svg("eye")} View</button>` : '<span class="tiny muted">none</span>'}</td></tr>`).join("")}</tbody></table></div>` : ""}
        ${comm ? `<p class="small">Commission (${esc(DPAuth.nameSync(owner))}): <b>${esc(comm.status)}</b> · calculated ${esc(H.money2(comm.calculatedMinor != null ? comm.calculatedMinor : comm.amountMinor, cur))}${comm.approvedMinor != null ? ` · approved ${esc(H.money2(comm.approvedMinor, cur))}` : ""}</p>` : ""}`, true, ` <span class="pill ${pst[1]}">${esc(pst[0])}</span>`)}
      ${sec("Manufacturing and installation", job ? `<dl class="kv small"><dt>Engineer</dt><dd>${esc(eng)}</dd><dt>Manufacturing</dt><dd>${esc(fac.dest ? O.METHODS[fac.dest] : (e && e.method ? O.METHODS[e.method] : "Not decided"))}${fac.workshop && fac.workshop.name ? ` · ${esc(fac.workshop.name)}` : ""}</dd>
        <dt>Completion</dt><dd><div class="prog sm"><i style="width:${(e && e.progress) || 0}%"></i></div>${(e && e.progress) || 0}%</dd><dt>Deadline</dt><dd>${esc(job.deadlineOriginal || "Not set (information missing)")}${e && e.expectedCompletion && e.expectedCompletion !== job.deadlineOriginal ? ` · expected ${esc(e.expectedCompletion)}` : ""}</dd>
        <dt>Installation</dt><dd>${esc(e && e.installDate ? H.dateS(e.installDate) : "Not scheduled")}${e && e.installProgress ? ` · ${e.installProgress}%` : ""}</dd><dt>Quality check</dt><dd>${esc(e && e.qc ? O.QC[e.qc.status] || e.qc.status : "—")}</dd>${e && e.nextAction ? `<dt>Next action</dt><dd>${esc(e.nextAction)}</dd>` : ""}</dl>
        ${open.length ? `<div class="note err small"><b>Blockers:</b> ${open.map((b) => esc(b.text)).join(" · ")}</div>` : ""}
        ${ex && (ex.team || []).filter((t) => !t.removedAt).length ? `<p class="small"><b>Workers:</b> ${ex.team.filter((t) => !t.removedAt).map((t) => `${esc(t.name)} (${esc(t.role)}${t.from ? ", " + esc(t.from) + (t.to ? "→" + esc(t.to) : "") : ""})`).join(" · ")}</p>` : `<p class="small muted">No workers assigned yet.</p>`}
        ${ex && (ex.notes || []).length ? `<p class="small"><b>Latest engineering note:</b> ${esc(ex.notes[ex.notes.length - 1].text)}</p>` : ""}${ex && (ex.files || []).length ? `<p class="small"><b>Attachments:</b> ${ex.files.map((f) => `<button class="linkbtn" data-tf="${esc(f.id)}">${esc(f.name)}</button>`).join(" · ")}</p>` : ""}` : `<p class="small muted">Not yet in engineering.</p>`, false)}
      ${sec("Activity timeline", `<div class="tl">${tl.slice(0, 50).map((x) => `<div><span class="tiny muted">${esc(dt(x.at))}</span><span>${esc(x.t)} <span class="muted">${esc(DPAuth.nameSync(x.by) || "")}</span></span></div>`).join("") || "<span class='small muted'>—</span>"}</div>`, false)}`, (d) => {
      $("#cd-full", d).onclick = () => { closeDrawer(); U.go("register", { oid, full: true }); };
      const ce = $("#cd-eng", d); if (ce) ce.onclick = () => engPanel(oid);
      const cv = $("#cd-ver", d); if (cv) cv.onclick = () => { closeDrawer(); U.go("payverify"); };
      const evb = $("#cd-ev", d); if (evb) evb.onclick = async () => DPUI.showFile(await O.getFile(`submissions/${sub.ownerId}/s/${sub.pid}/ev/main`), "Acceptance evidence");
      $$("[data-rc]", d).forEach((b) => (b.onclick = async () => DPUI.showFile(await O.receipt(oid, b.dataset.rc), "Customer payment proof")));
      $$("[data-rp]", d).forEach((b) => (b.onclick = async () => DPUI.showFile(await O.getFile(`paysub/${b.dataset.ru}/p/${b.dataset.rp}`), "Customer payment proof")));
      $$("[data-tf]", d).forEach((b) => (b.onclick = async () => DPUI.showFile(await O.techFile(job, b.dataset.tf), "Project file")));
      const pos = $(".paypos", d); if (pos && o) DPPayUI.bindPosition(pos, o, () => orderPanel(oid));
    }, { label: "Order record" });
  }

  /* ---------------- engineering summary ---------------- */
  async function engPanel(oid) {
    if (!U.isAdmin()) return U.go("engorders", { oid });
    drawer(`<div class="cd-head"><span class="eyebrow">Engineering</span><button class="btn ghost xs" data-close aria-label="Close">✕</button></div><div class="empty"><div class="spinner"></div></div>`, null, { label: "Engineering summary" });
    const j = await O.jobOf(oid); if (!j) return drawer(`<div class="cd-head"><span class="eyebrow">Engineering</span><button class="btn ghost xs" data-close>✕</button></div><div class="note err">Not found.</div>`);
    const [ex, ho] = await Promise.all([O.engxOf(j).catch(() => null), O.handoverOf(j).catch(() => null)]); const e = j.e || {}, fac = e.factory || {}, team = ((ex && ex.team) || []).filter((t) => !t.removedAt);
    const blocks = e.blockers || [];
    drawer(`<div class="cd-head"><div><span class="eyebrow">${esc(j.ref || j.oid)} · engineering</span><h2>${esc(j.name)}</h2><p class="small muted">${esc([j.client, j.location].filter(Boolean).join(" · "))}</p>
        <div class="row" style="gap:6px"><span class="pill info">${esc(O.ENG_LABEL[e.status] || (j.engineerUid ? "Awaiting review" : "Unassigned"))}</span><span class="dl ${j.ds.key}">${esc(j.ds.label)}</span></div></div><button class="btn ghost xs" data-close aria-label="Close">✕</button></div>
      <div class="row cd-acts"><button class="btn ghost sm" id="ce-ord">Order record</button><button class="btn ghost sm" id="ce-full">Open in Engineering</button></div>
      ${sec("Status", `<dl class="kv small"><dt>Engineer</dt><dd>${esc(j.engineerUid ? DPAuth.nameSync(j.engineerUid) : "Unassigned")}${j.via ? ` <span class="tiny muted">(${esc({ default: "default engineer", pickup: "picked up", admin: "assigned by admin" }[j.via] || j.via)})</span>` : ""}</dd><dt>Method</dt><dd>${esc(fac.dest ? O.METHODS[fac.dest] : e.method ? O.METHODS[e.method] : "Not decided")}</dd><dt>Factory / workshop</dt><dd>${esc(fac.workshop && fac.workshop.name ? [fac.workshop.name, fac.workshop.contact].filter(Boolean).join(" · ") : fac.dest === "inhouse" ? "Dupedia factory" : "—")}</dd>
        <dt>Completion</dt><dd><div class="prog sm"><i style="width:${e.progress || 0}%"></i></div>${e.progress || 0}%</dd><dt>Contract deadline</dt><dd>${esc(j.deadlineOriginal || "Not set — information missing")}</dd><dt>Expected completion</dt><dd>${esc(e.expectedCompletion || "—")}</dd>${e.actualCompletion ? `<dt>Completed</dt><dd>${esc(e.actualCompletion)}</dd>` : ""}
        <dt>Installation</dt><dd>${esc(e.installDate ? H.dateS(e.installDate) : "Not scheduled")}${e.installProgress ? ` · ${e.installProgress}%` : ""}</dd><dt>Quality check</dt><dd>${esc(O.QC[(e.qc || {}).status || "pending"])}</dd>${e.nextAction ? `<dt>Next action</dt><dd>${esc(e.nextAction)}</dd>` : ""}${e.salesNote ? `<dt>Note for sales</dt><dd>${esc(e.salesNote)}</dd>` : ""}</dl>`)}
      ${sec("Delays and blockers", blocks.length ? `<div class="tl">${blocks.slice().reverse().map((b) => `<div><span class="tiny muted">${esc(H.dateS(b.at))}</span><span>${b.resolvedAt ? "<s>" : "<b>"}${esc(b.text)}${b.resolvedAt ? "</s>" : "</b>"}${b.resolvedAt ? ` <span class="pill ok">resolved</span>` : ""}</span></div>`).join("")}</div>` : `<p class="small muted">${j.ds.missing ? "No deadline recorded — information missing, not a confirmed delay." : "No blockers reported."}</p>`, blocks.some((b) => !b.resolvedAt))}
      ${sec("Workers", team.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Name</th><th>Role</th><th>Dates</th></tr></thead><tbody>${team.map((t) => `<tr><td class="small"><b>${esc(t.name)}</b>${t.external ? ' <span class="pill">outsourced</span>' : ""}</td><td class="small">${esc(t.role)}</td><td class="small">${esc([t.from, t.to].filter(Boolean).join(" → ") || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No workers assigned.</p>`)}
      ${sec("Quality checks", ((e.qc || {}).checklist || []).length ? `<ul class="small qclist">${e.qc.checklist.map((c) => `<li>${c.ok ? "✔" : "○"} ${esc(c.item)}${c.note ? ` — ${esc(c.note)}` : ""}</li>`).join("")}</ul>` : `<p class="small muted">No checklist.</p>`, false)}
      ${sec("Engineer notes", ((ex && ex.notes) || []).length ? `<div class="tl">${ex.notes.slice().reverse().slice(0, 20).map((n) => `<div><span class="tiny muted">${esc(dt(n.at))}</span><span>${esc(n.text)} <span class="muted">— ${esc(DPAuth.nameSync(n.by) || "")}</span></span></div>`).join("")}</div>` : `<p class="small muted">None.</p>`, false)}
      ${sec("Recent timeline", `<div class="tl">${(e.log || []).slice().reverse().slice(0, 30).map((l) => `<div><span class="tiny muted">${esc(dt(l.at))}</span><span>${esc(l.what)}${l.note ? " — " + esc(l.note) : ""} <span class="muted">${esc(DPAuth.nameSync(l.by) || "")}</span></span></div>`).join("") || "<span class='small muted'>No updates yet.</span>"}</div>`, false)}
      ${ho && ho.scopeNote ? "" : ""}`, (d) => { $("#ce-ord", d).onclick = () => orderPanel(oid); $("#ce-full", d).onclick = () => { closeDrawer(); U.go("engorders", { oid, full: true }); }; }, { label: "Engineering summary" });
  }

  /* ---------------- Work Force ---------------- */
  const WF = { q: "", role: "", st: "active" };
  async function renderWorkforce(opts = {}) {
    const V = $("#view-workforce");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration · People</span><h1>Work <em>Force</em></h1><p class="lead small">Everyone in X FORCE: system users (administrators, sales, engineers, data entry) and the company and outsourced workers from the Worker Directory. A person can have a login, a worker record, both or neither.</p></div>
      <div class="row"><button class="btn ghost sm" id="wf-users">Manage user accounts</button><button class="btn ghost sm" id="wf-workers">Worker Directory</button></div></div>
      <div class="filters"><div class="search" style="width:260px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="wf-q" placeholder="Search name, phone, e-mail, ID" value="${esc(WF.q)}"></div>
        <select class="in sm" id="wf-r"><option value="">All roles</option>${[["admin", "Administrators"], ["employee", "Sales"], ["engineer", "Engineers"], ["dataentry", "Data entry"], ["company", "Company workers"], ["outsourced", "Outsourced workers"]].map(([k, l]) => `<option value="${k}"${WF.role === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        <select class="in sm" id="wf-s">${[["active", "Active"], ["inactive", "Inactive"], ["", "All"]].map(([k, l]) => `<option value="${k}"${WF.st === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div id="wf-list"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $("#wf-users").onclick = () => U.go("users"); $("#wf-workers").onclick = () => U.go("workers");
    const [dir, workers, jobs] = await Promise.all([DPAuth.listDirectory().catch(() => DPAuth.A.directory), O.listWorkers().catch(() => []), O.listJobs().catch(() => [])]);
    const ppl = dir.filter((r) => r.uid).map((r) => ({ kind: "user", id: r.uid, name: DPAuth.fullName(r) || r.displayName || "—", role: DPAuth.baseOf(r.role), roleLabel: (DPAuth.roleOf(r.role) || {}).label || r.role, empId: r.employmentId || r.empId || "", phone: r.mobile || r.phone || "", email: r.email || "", hired: r.hireDate || "", active: r.active !== false, title: r.title || "", rec: r }))
      .concat(workers.map((w) => ({ kind: "worker", id: w.wid, name: w.name, role: w.type === "outsourced" ? "outsourced" : "company", roleLabel: (O.WORKER_TYPES[w.type] || w.type || "Worker"), empId: w.wid, phone: w.phone || "", email: "", hired: "", active: w.active !== false, title: w.trade || w.role || "", rec: w })));
    const draw = async () => {
      const q = WF.q.trim().toLowerCase(), vis = ppl.filter((p) => (!WF.role || p.role === WF.role) && (!WF.st || (WF.st === "active" ? p.active : !p.active)) && (!q || [p.name, p.phone, p.email, p.empId, p.title].join(" ").toLowerCase().includes(q)));
      const box = $("#wf-list"); if (!box) return;
      const resp = (p) => p.kind === "worker" ? `${(p.rec.assignments || []).filter((a) => !a.removedAt && (!a.to || a.to >= new Date().toISOString().slice(0, 10))).length} current project(s)` : p.role === "engineer" ? `${jobs.filter((j) => j.engineerUid === p.id && j.status !== "cancelled" && !(j.e && j.e.status === "completed")).length} open order(s)` : p.role === "employee" ? "Sales" : p.role === "dataentry" ? "Lead research" : p.role === "admin" ? "Administration" : "";
      box.innerHTML = vis.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="mtable wf"><thead><tr><th></th><th>Name</th><th>Role</th><th>ID</th><th>Phone</th><th>E-mail</th><th>Hired</th><th>Status</th><th>Current responsibilities</th></tr></thead><tbody>
        ${vis.map((p, i) => `<tr class="click" data-i="${i}"><td><img class="pic" alt="" width="32" height="32" data-pic="${esc(p.kind + ":" + p.id)}"></td><td><b>${esc(p.name)}</b>${p.title ? `<div class="tiny muted">${esc(p.title)}</div>` : ""}</td><td><span class="pill ${p.kind === "worker" ? "" : "info"}">${esc(p.roleLabel)}</span>${p.kind === "user" ? "" : ` <span class="tiny muted">no login</span>`}</td><td class="small num">${esc(p.empId || "—")}</td><td class="small">${esc(p.phone || "—")}</td><td class="small">${esc(p.email || "—")}</td><td class="small">${esc(p.hired || "—")}</td><td><span class="pill ${p.active ? "ok" : "err"}">${p.active ? "Active" : "Inactive"}</span></td><td class="small">${esc(resp(p))}</td></tr>`).join("")}</tbody></table></div></div>`
        : `<div class="card empty small">Nobody matches the filters.</div>`;
      for (const im of $$("[data-pic]", box)) { const [k, id] = im.dataset.pic.split(":"); im.src = k === "user" ? await DPAuth.avatarUrl(id) : ((await O.workerPicture(id).catch(() => null)) || DPAuth.initialsAvatar((ppl.find((p) => p.id === id) || {}).name || "?")); }
      $$("[data-i]", box).forEach((tr) => (tr.onclick = () => profile(vis[+tr.dataset.i], jobs)));
    };
    $("#wf-q").oninput = (e) => { WF.q = e.target.value; draw(); }; $("#wf-r").onchange = (e) => { WF.role = e.target.value; draw(); }; $("#wf-s").onchange = (e) => { WF.st = e.target.value; draw(); };
    await draw(); if (opts.uid) { const p = ppl.find((x) => x.id === opts.uid); if (p) profile(p, jobs); }
  }
  async function profile(p, jobs) {
    const pic = p.kind === "user" ? await DPAuth.avatarUrl(p.id) : ((await O.workerPicture(p.id).catch(() => null)) || DPAuth.initialsAvatar(p.name));
    drawer(`<div class="cd-head"><div class="row" style="gap:12px"><img class="pic" alt="" width="56" height="56" src="${esc(pic)}"><div><span class="eyebrow">${esc(p.roleLabel)}${p.kind === "worker" ? " · worker record (no login)" : ""}</span><h2>${esc(p.name)}</h2><span class="pill ${p.active ? "ok" : "err"}">${p.active ? "Active" : "Inactive"}</span></div></div><button class="btn ghost xs" data-close aria-label="Close">✕</button></div>
      ${sec("Contact", `<dl class="kv small"><dt>ID</dt><dd>${esc(p.empId || "—")}</dd><dt>Phone</dt><dd>${esc(p.phone || "—")}</dd><dt>E-mail</dt><dd>${esc(p.email || "—")}</dd><dt>Hired</dt><dd>${esc(p.hired || "—")}</dd>${p.title ? `<dt>Title</dt><dd>${esc(p.title)}</dd>` : ""}</dl>`)}
      <div id="wp-body"><div class="empty small"><div class="spinner"></div></div></div>
      <div class="row cd-acts">${p.kind === "user" ? `<button class="btn ghost sm" id="wp-edit">Edit account / deactivate…</button>` : `<button class="btn ghost sm" id="wp-edit">Open in Worker Directory</button>`}</div>`, async (d) => {
      $("#wp-edit", d).onclick = () => { closeDrawer(); U.go(p.kind === "user" ? "users" : "workers", p.kind === "user" ? { uid: p.id } : { wid: p.id }); };
      const body = $("#wp-body", d); let html = "";
      try {
        if (p.kind === "worker") {
          const as = p.rec.assignments || [], cur = as.filter((a) => !a.removedAt && (!a.to || a.to >= new Date().toISOString().slice(0, 10)));
          html = sec("Work", `<dl class="kv small"><dt>Worker type</dt><dd>${esc(p.roleLabel)}</dd><dt>National ID document</dt><dd>${p.rec.idDoc ? "On file (confidential — not a verification)" : "Not uploaded"}</dd><dt>Current allocation</dt><dd>${cur.length ? cur.map((a) => `${esc(a.name)} (${esc(a.role)}${a.from ? ", " + esc(a.from) + (a.to ? "→" + esc(a.to) : "") : ""})`).join("<br>") : "Available"}</dd></dl>
            ${as.length ? `<details><summary class="small">Assignment history (${as.length})</summary><div class="tl">${as.slice().reverse().map((a) => `<div><span class="tiny muted">${esc(H.dateS(a.at))}</span><span>${esc(a.name)} · ${esc(a.role)}${a.removedAt ? " · ended" : ""}</span></div>`).join("")}</div></details>` : ""}`);
        } else if (p.role === "employee") {
          const [rows, comms, fus] = await Promise.all([DPUI.loadOrderRows({ all: true }).catch(() => []), DPSales.allCommissions().catch(() => []), Promise.resolve(DPLeadOps.followUps ? DPLeadOps.followUps(p.id, { includeDone: false }) : [])]);
          const mine = rows.filter((r) => r.ownerId === p.id), acc = mine.filter((r) => r.accepted && !r.cancelled), per = new Date().toISOString().slice(0, 7);
          const month = acc.filter((r) => String((r.sub && r.sub.acceptedAt) || "").slice(0, 7) === per), target = ((App.config.settings.sales || {}).monthlyTarget || 0) * 100;
          const cm = comms.filter((c) => c.uid === p.id), leads = await DPStore.tryList(`claims/${p.id}/c`);
          html = sec("Sales", `<div class="kcards sm"><div class="kc"><span class="eyebrow">Closed this month</span><b class="num">${esc(H.money(month.reduce((a, r) => a + (r.total || 0), 0), "EGP"))}</b><span class="tiny muted">${month.length} order(s)${target ? ` · target ${esc(H.money(target, "EGP"))}` : ""}</span></div><div class="kc"><span class="eyebrow">Closed deals</span><b class="num">${acc.length}</b><span class="tiny muted">all time</span></div><div class="kc"><span class="eyebrow">Open quotations</span><b class="num">${mine.filter((r) => r.custKey === "issued").length}</b></div><div class="kc"><span class="eyebrow">Follow-ups open</span><b class="num">${fus.length}</b><span class="tiny muted">${fus.filter((f) => f.when === "overdue").length} overdue</span></div></div>
            <p class="small"><b>Leads currently claimed:</b> ${leads.length}</p>
            ${acc.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Order</th><th>Client</th><th class="r">Value</th><th>Payment</th></tr></thead><tbody>${acc.slice(0, 12).map((r) => `<tr class="click" data-oid="${esc(r.oid)}"><td class="small">${esc(r.p.ref || r.oid)}</td><td class="small">${esc(r.p.client || "—")}</td><td class="r num">${esc(H.money(r.total, r.cur))}</td><td><span class="pill ${(DPPay.STATUS[r.pay && r.pay.status] || ["", ""])[1]}">${esc((DPPay.STATUS[r.pay && r.pay.status] || ["—"])[0])}</span></td></tr>`).join("")}</tbody></table></div>` : ""}`)
            + sec("Commission (administrators only)", cm.length ? `<p class="small">${cm.length} record(s): ${["calculated", "pending", "approved", "paid"].map((k) => `${cm.filter((c) => c.status === k).length} ${k}`).join(" · ")}</p>` : `<p class="small muted">No commission records.</p>`, false);
        } else if (p.role === "engineer") {
          const mine = jobs.filter((j) => j.engineerUid === p.id && j.status !== "cancelled"), open = mine.filter((j) => !(j.e && j.e.status === "completed"));
          html = sec("Engineering", `<div class="kcards sm"><div class="kc"><span class="eyebrow">Open orders</span><b class="num">${open.length}</b></div><div class="kc"><span class="eyebrow">Delayed / at risk</span><b class="num">${open.filter((j) => ["delayed", "atrisk"].includes(j.ds.key)).length}</b></div><div class="kc"><span class="eyebrow">Completed</span><b class="num">${mine.length - open.length}</b></div></div>
            ${open.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Order</th><th>Status</th><th class="r">Done</th><th>Deadline</th></tr></thead><tbody>${open.map((j) => `<tr class="click" data-eng="${esc(j.oid)}"><td class="small">${esc(j.name)}</td><td class="small">${esc(j.e ? O.ENG_LABEL[j.e.status] : "Awaiting review")}</td><td class="r num">${(j.e && j.e.progress) || 0}%</td><td><span class="dl ${j.ds.key}">${esc(j.ds.label)}</span></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No open orders.</p>`}`);
        } else if (p.role === "dataentry") {
          const per = new Date().toISOString().slice(0, 7), [leads, staff] = await Promise.all([DPLeads.listLeads(), DPSales.staffDoc(p.id).catch(() => null), DPLeadOps.loadActs().catch(() => null), DPLeadOps.loadContacts ? DPLeadOps.loadContacts().catch(() => null) : null]);
          const f = DPLeadOps.dataEntryFigures(p.id, per, leads), target = DPLeadOps.dataEntryTarget(staff, per), hist = DPSales.lastPeriods(6).map((x) => DPLeadOps.dataEntryFigures(p.id, x, leads).completed);
          html = sec("Lead research", `<div class="kcards sm"><div class="kc"><span class="eyebrow">Qualified this month</span><b class="num">${f.completed}</b><span class="tiny muted">target ${target} (${target ? Math.round(f.completed / target * 100) : 0}%)</span></div><div class="kc"><span class="eyebrow">Researched today</span><b class="num">${f.researchedToday}</b></div><div class="kc"><span class="eyebrow">Last 6 months</span><b class="num">${hist.reduce((a, b) => a + b, 0)}</b><span class="tiny muted">${hist.join(" · ")}</span></div><div class="kc"><span class="eyebrow">Verified contacts</span><b class="num">${f.verifiedPhones}</b><span class="tiny muted">phones · ${f.verifiedEmails} e-mails (all open leads)</span></div></div>`);
        } else html = sec("Administration", `<p class="small muted">Administrator account.</p>`);
      } catch (e) { html = `<div class="note err small">Could not load (${esc(e.message || "")}).</div>`; }
      body.innerHTML = html;
      $$("[data-oid]", body).forEach((r) => (r.onclick = () => orderPanel(r.dataset.oid)));
      $$("[data-eng]", body).forEach((r) => (r.onclick = () => engPanel(r.dataset.eng)));
    }, { label: "Profile" });
  }

  /* ---------------- collapsible sidebar ---------------- */
  const RK = "xf.rail";
  function railPref() { try { return localStorage.getItem(RK) === "collapsed"; } catch (e) { return false; } }
  function applyRail(c) { const a = $("#app"); if (a) a.classList.toggle("rail-collapsed", !!c); const b = $("#rail-tog"); if (b) { b.setAttribute("aria-pressed", c ? "true" : "false"); b.title = c ? "Expand the menu" : "Collapse the menu"; b.innerHTML = U.svg(c ? "railOpen" : "railClose") + `<span>${c ? "Expand" : "Collapse menu"}</span>`; } }
  function toggleRail() { const c = !railPref(); try { localStorage.setItem(RK, c ? "collapsed" : "open"); } catch (e) {} applyRail(c); }

  /* ---------------- open records in the panel ---------------- */
  // Administrators: any navigation to an order (dashboards, alerts, notifications, lists) opens the record panel over the
  // current page instead of navigating away. "Open full order page" still reaches the full page ({full:true}).
  const goOrig = U.go;
  DPUI.go = function (view, opts = {}) {
    if (U.isAdmin() && opts && opts.oid && !opts.full) {
      if (["register", "proposals", "tracking"].includes(view)) { orderPanel(opts.oid); return; }
      if (["engqueue", "engorders"].includes(view)) { engPanel(opts.oid); return; }
    }
    if (view !== App.view) closeDrawer();
    return goOrig.call(this, view, opts);
  };

  Object.assign(U.ICON, {
    railClose: '<path d="M4 4h16v16H4zM9 4v16"/><path d="m16 9-3 3 3 3"/>', railOpen: '<path d="M4 4h16v16H4zM9 4v16"/><path d="m13 9 3 3-3 3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', send: U.ICON.send || '<path d="M4 12 20 4l-6 16-3-7z"/>', radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 19 5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>', inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>', pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>', sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>', mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  });
  U.register("workforce", renderWorkforce);
  root.DPCeo2 = { drawer, sec, orderPanel, engPanel, closeDrawer, renderWorkforce, toggleRail, applyRail, railPref };
})(typeof self !== "undefined" ? self : this);
