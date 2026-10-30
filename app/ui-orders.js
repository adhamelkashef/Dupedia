/* X FORCE 1.0 (Dupedia) — My Orders & Proposals (sales), Order Register (administrators), order details and quick actions.
   Opening an order never opens the Site Planner: "Open in Site Planner" is a separate, explicit action. */
/* global DPUI, DPShell, DPStore, DPAuth, DPLeads, DPSales, DPOrders, DPCommission, DPPricing, DPModel, DPProposal, DPNotify */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, O = DPOrders, PR = DPPricing;
  const F = { q: "", st: "", sort: "date", emp: "", rq: "", rst: "", rsort: "date", flag: "" };
  const CUST = { issued: ["Awaiting decision", "warn"], accepted: ["Accepted", "ok"], won: ["Accepted", "ok"], submitted: ["Accepted (approval requested)", "info"], lost: ["Rejected", "err"], rejected: ["Rejected", "err"], cancelled: ["Cancelled", "err"], draft: ["Draft", ""] };
  /** Order stage from the engineering record (what the client cares about). */
  function stageOf(row) {
    if (row.cancelled) return ["Cancelled", "err", "cancelled"];
    if (!row.accepted) return null;
    const e = row.job && row.job.e;
    if (!e) return [row.job && row.job.engineerUid ? "Awaiting Engineering Review" : "Accepted — waiting for an engineer", "info", "accepted"];
    const k = e.status;
    if (k === "completed") return ["Completed", "ok", "completed"];
    if (["ready"].includes(k)) return ["Ready for installation", "ok", "ready"];
    if (["installing", "qc"].includes(k)) return [O.ENG_LABEL[k], "info", "installing"];
    if (["manufacturing", "outsourced", "assign"].includes(k)) return [O.ENG_LABEL[k], "info", "production"];
    if (["hold", "delayed", "blocked"].includes(k)) return [O.ENG_LABEL[k], "err", "issue"];
    return [O.ENG_LABEL[k] || k, "info", "review"];
  }

  /* ---------------- data ---------------- */
  /** One row per issued quotation (and its order). Admins: everyone's; sales: their own. Money only where the viewer may see it. */
  async function loadRows({ all = false } = {}) {
    const admin = U.isAdmin() && all, owners = admin ? H.ownerIds() : [DPStore.st.userId];
    const [projects, subs, jobs, orders, salesViews, reps] = await Promise.all([
      DPStore.listProjects(admin ? owners : null),
      admin ? DPSales.allSubmissions() : DPSales.mySubmissions().then((l) => l.map((x) => Object.assign({ ownerId: DPStore.st.userId }, x))),
      O.listJobs().catch(() => []),
      admin ? DPSales.listOrders() : Promise.resolve([]),
      admin ? Promise.resolve([]) : O.mySalesOrders().catch(() => []),
      admin ? O.listPaymentReports().catch(() => []) : O.myPaymentReports().catch(() => []),
    ]);
    const rows = projects.filter((p) => p.issuedAt || ["accepted", "won", "submitted", "lost", "cancelled", "issued"].includes(p.status)).map((p) => {
      const sub = subs.find((s) => s.pid === p.id && (s.ownerId || DPStore.st.userId) === p.ownerId) || null;
      const oid = (sub && (sub.oid || sub.orderId)) || p.orderId || null;
      const order = oid ? orders.find((o) => o.oid === oid) || null : null, sv = oid ? salesViews.find((o) => o.oid === oid) || null : null;
      const job = oid ? jobs.find((j) => j.oid === oid) || null : null;
      const fin = order || sv, pays = (fin && fin.payments) || [];
      const verified = pays.filter((x) => x.status === "verified").reduce((a, x) => a + x.amountMinor, 0);
      const myReps = reps.filter((r) => r.oid === oid);
      const pending = myReps.filter((r) => r.status === "submitted").reduce((a, r) => a + r.amountMinor, 0) + pays.filter((x) => x.status === "recorded").reduce((a, x) => a + x.amountMinor, 0);
      const total = fin ? fin.totalMinor : p.total, cur = (fin && fin.currency) || p.currency || "EGP";
      const custKey = sub && sub.status === "accepted" ? "accepted" : sub && sub.status === "rejected" ? "rejected" : p.status || "issued";
      const accepted = ["accepted", "won", "submitted"].includes(custKey) || !!order;
      const cancelled = (order && order.status === "cancelled") || (fin && fin.status === "cancelled") || p.status === "cancelled";
      const sched = (fin && fin.schedule) || (sub && sub.schedule) || [];
      // 1.1: one payment engine everywhere (deposit obligation, verified-only balance, overdue by milestone)
      const pay = accepted ? DPPay.summary({ totalMinor: total, valueAdjustments: (fin && fin.valueAdjustments) || [], schedule: sched, payments: pays, acceptedAt: (fin && fin.acceptedAt) || (sub && sub.acceptedAt), status: cancelled ? "cancelled" : "open" }, { reports: myReps, tz: App.config.settings.timezone, settings: App.config.settings }) : null;
      const overdue = pay && !cancelled ? pay.overdueMinor : 0;
      return { p, sub, oid, order, sv, job, fin, total: pay ? pay.payableMinor : total, cur, verified, pending, outstanding: pay ? pay.remainingMinor : null, custKey, accepted, cancelled, sched, overdue, pay,
        reps: myReps, ownerId: p.ownerId, date: (sub && sub.acceptedAt) || p.issuedAt || p.savedAt };
    });
    return rows;
  }

  /* ---------------- list ---------------- */
  async function renderList(opts = {}) {
    const V = $("#view-proposals");
    if (opts.oid || opts.pid) return renderDetail(V, opts, { back: "proposals" });
    if (opts.st != null) F.st = opts.st;
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Sales</span><h1>My Orders &amp; <em>Proposals</em></h1><p class="lead small">Every quotation you issued and every order it became — client decision, payments, production and installation. Click a row for the full details; the Site Planner only opens when you choose to.</p></div>
      <div class="row"><button class="btn lime" id="mo-new">${U.svg("plus")} New site plan</button></div></div>
      <div class="filters"><div class="search" style="width:280px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="mo-q" placeholder="Search reference, project or client" value="${esc(F.q)}"></div>
        <select class="in sm" id="mo-st"><option value="">All</option>${[["issued", "Awaiting client decision"], ["accepted", "Accepted orders"], ["production", "In production"], ["ready", "Ready for installation"], ["installing", "Installing"], ["completed", "Completed"], ["rejected", "Rejected"], ["unpaid", "Balance outstanding"], ["overdue", "Payment overdue"]].map(([k, l]) => `<option value="${k}"${F.st === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        <select class="in sm" id="mo-sort">${[["date", "Newest first"], ["value", "Highest value"], ["client", "Client A–Z"], ["balance", "Largest balance"]].map(([k, l]) => `<option value="${k}"${F.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div id="mo-sum"></div><div class="card" style="padding:0"><div class="tablewrap" id="mo-list"><div class="empty"><div class="spinner"></div>Loading…</div></div></div></div>`;
    $("#mo-new").onclick = () => U.go("setup", { isNew: true });
    let rows; try { rows = await loadRows(); } catch (e) { $("#mo-list").innerHTML = `<div class="empty">Could not load (${esc(e.message || e.code)}).</div>`; return; }
    const draw = () => {
      const q = F.q.trim().toLowerCase();
      let vis = rows.filter((r) => !q || [r.p.ref, r.p.name, r.p.client, r.oid].join(" ").toLowerCase().includes(q)).filter((r) => filt(r, F.st));
      vis = sortRows(vis, F.sort, opts.highlight);
      const cur = (rows[0] && rows[0].cur) || "EGP";
      $("#mo-sum").innerHTML = `<div class="stats">${H.stat("Awaiting decision", rows.filter((r) => r.custKey === "issued").length, esc(H.money(rows.filter((r) => r.custKey === "issued").reduce((a, r) => a + (r.total || 0), 0), cur)) + " quoted")}
        ${H.stat("Accepted orders", rows.filter((r) => r.accepted && !r.cancelled).length, esc(H.money(rows.filter((r) => r.accepted && !r.cancelled).reduce((a, r) => a + (r.total || 0), 0), cur)))}
        ${H.stat("Verified payments", esc(H.money(rows.reduce((a, r) => a + r.verified, 0), cur)), "funds cleared")}${H.stat("Pending verification", esc(H.money(rows.reduce((a, r) => a + r.pending, 0), cur)), "recorded, not yet verified")}
        ${H.stat("Outstanding", esc(H.money(rows.reduce((a, r) => a + (r.cancelled ? 0 : r.outstanding || 0), 0), cur)), rows.some((r) => r.overdue) ? `${rows.filter((r) => r.overdue).length} overdue` : "on accepted orders", rows.some((r) => r.overdue) ? "hl" : "")}</div>`;
      $("#mo-list").innerHTML = vis.length ? `<table class="mtable"><thead><tr><th>Reference</th><th>Project · client</th><th>Submitted</th><th>Client</th><th>Order status</th><th class="r">Value</th><th class="r">Paid (verified)</th><th class="r">Balance</th><th></th></tr></thead><tbody>
        ${vis.map((r) => rowHtml(r, false, opts.highlight)).join("")}</tbody></table>`
        : `<div class="empty">${rows.length ? "Nothing matches these filters." : `<b>No quotations issued yet.</b><span class="small">Plan a site, price it, then use <b>Review &amp; Submit</b> to issue the quotation. It appears here straight away.</span>`}</div>`;
      bindRows($("#mo-list"), vis, () => renderList(opts));
    };
    $("#mo-q").oninput = (e) => { F.q = e.target.value; draw(); };
    $("#mo-st").onchange = (e) => { F.st = e.target.value; draw(); };
    $("#mo-sort").onchange = (e) => { F.sort = e.target.value; draw(); };
    draw();
    if (opts.highlight) { const el = $(`[data-row="${CSS.escape(opts.highlight)}"]`, V); if (el) el.scrollIntoView({ block: "center" }); }
  }
  function filt(r, st) {
    if (!st) return true; const sg = stageOf(r);
    if (st === "issued") return r.custKey === "issued"; if (st === "accepted") return r.accepted && !r.cancelled; if (st === "rejected") return ["lost", "rejected"].includes(r.custKey);
    if (st === "unpaid") return !r.cancelled && r.outstanding > 0; if (st === "overdue") return r.overdue > 0;
    return sg && sg[2] === st;
  }
  function sortRows(vis, k, hl) {
    const s = vis.slice().sort((a, b) => k === "value" ? (b.total || 0) - (a.total || 0) : k === "client" ? String(a.p.client || "").localeCompare(String(b.p.client || "")) : k === "balance" ? (b.outstanding || 0) - (a.outstanding || 0) : String(b.date).localeCompare(String(a.date)));
    if (hl) { const i = s.findIndex((r) => r.p.id === hl); if (i > 0) s.unshift(s.splice(i, 1)[0]); }
    return s;
  }
  function rowHtml(r, admin, hl) {
    const c = CUST[r.custKey] || [r.custKey, ""], sg = stageOf(r);
    return `<tr class="click${hl === r.p.id ? " hl-row" : ""}" data-row="${esc(r.p.id)}" data-owner="${esc(r.ownerId)}"><td><b class="num">${esc(r.p.ref || "—")}</b>${r.oid ? `<div class="tiny muted">${esc(r.oid)}</div>` : ""}</td>
      <td><b>${esc(r.p.name || "Untitled")}</b><div class="tiny muted">${esc([r.p.client, r.p.location].filter(Boolean).join(" · "))}</div>${admin ? `<div class="tiny muted">${esc(DPAuth.nameSync(r.ownerId) || "")}</div>` : ""}</td>
      <td class="small">${esc(H.dateS(r.p.issuedAt))}${r.p.rev > 1 ? ` · rev ${r.p.rev}` : ""}</td><td><span class="pill ${c[1]}">${esc(c[0])}</span></td>
      <td>${sg ? `<span class="pill ${sg[1]}">${esc(sg[0])}</span>${r.job && r.job.e ? `<div class="prog" style="margin-top:5px;max-width:120px"><i style="width:${r.job.e.progress || 0}%"></i></div>` : ""}` : '<span class="tiny muted">—</span>'}</td>
      <td class="r num">${r.total != null ? esc(H.money(r.total, r.cur)) : "—"}</td><td class="r num">${r.accepted ? esc(H.money(r.verified, r.cur)) : "—"}${r.pending ? `<div class="tiny" style="color:var(--amber)">${esc(H.money(r.pending, r.cur))} pending</div>` : ""}</td>
      <td class="r num">${r.accepted && !r.cancelled ? esc(H.money(r.outstanding || 0, r.cur)) : "—"}${r.overdue ? `<div class="tiny" style="color:var(--red)">${esc(H.money(r.overdue, r.cur))} overdue</div>` : ""}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn ghost xs actbtn" data-act="${esc(r.p.id)}" aria-haspopup="menu" aria-label="Actions for ${esc(r.p.ref || r.p.name)}">Actions ▾</button></td></tr>`;
  }
  function bindRows(box, vis, refresh, admin) {
    $$("[data-row]", box).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest("button")) return; const r = vis.find((x) => x.p.id === tr.dataset.row && x.ownerId === tr.dataset.owner); U.go(admin ? "register" : "proposals", r.oid ? { oid: r.oid } : { pid: r.p.id, owner: r.ownerId }); }));
    $$("[data-act]", box).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const r = vis.find((x) => x.p.id === b.dataset.act); actionMenu(b, r, refresh, admin); }));
  }
  /** Small actions menu on each row (keyboard-accessible). */
  function actionMenu(anchor, r, refresh, admin) {
    const old = $("#actmenu"); if (old) old.remove();
    const mine = r.ownerId === DPStore.st.userId, can = mine || U.isAdmin();
    const items = [["view", "View order details", true],
      ["accept", "Client accepted…", can && r.custKey === "issued" && !admin],
      ["reject", "Client rejected…", can && r.custKey === "issued" && !admin],
      ["pay", "Record payment…", can && r.accepted && !r.cancelled],
      ["pdf", "Download proposal PDF", mine || U.isAdmin()],
      ["plan", r.accepted ? "Open in Site Planner (read-only once accepted)" : "Open in Site Planner…", mine || U.isAdmin()]].filter((x) => x[2]);
    const m = document.createElement("div"); m.id = "actmenu"; m.className = "pop-panel"; m.setAttribute("role", "menu");
    m.innerHTML = items.map(([k, l]) => `<button class="menu-item" role="menuitem" data-k="${k}">${esc(l)}</button>`).join("");
    document.body.appendChild(m); const rc = anchor.getBoundingClientRect(); m.style.top = Math.min(innerHeight - m.offsetHeight - 8, rc.bottom + 4) + "px"; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, rc.right - m.offsetWidth)) + "px";
    const close = () => { m.remove(); document.removeEventListener("mousedown", out, true); document.removeEventListener("keydown", key, true); anchor.focus(); };
    const out = (e) => { if (!m.contains(e.target)) close(); }, key = (e) => { if (e.key === "Escape") close(); if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); const bs = $$(".menu-item", m), i = bs.indexOf(document.activeElement); bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); } };
    setTimeout(() => { document.addEventListener("mousedown", out, true); document.addEventListener("keydown", key, true); }, 0);
    $$(".menu-item", m).forEach((b) => (b.onclick = () => { close(); doAction(b.dataset.k, r, refresh, admin); })); const f = $(".menu-item", m); f && f.focus();
  }
  async function doAction(k, r, refresh, admin) {
    if (k === "view") return U.go(admin ? "register" : "proposals", r.oid ? { oid: r.oid } : { pid: r.p.id, owner: r.ownerId });
    if (k === "accept") return acceptDialog(r.p.id, r.ownerId, refresh);
    if (k === "reject") return rejectDialog(r.p.id, r.ownerId, refresh);
    if (k === "pay") return recordPayment(r, refresh);
    if (k === "pdf") return exportPdf(r.p.id, r.ownerId);
    if (k === "plan") { const ok = await U.ask("Open in the Site Planner?", `<p>${r.accepted ? "This quotation has been accepted, so its plan and prices are locked. You can view it and export documents." : "You can change the plan and quotation. Changes after issue need a new revision."}</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Open Site Planner", value: true }]); if (ok) U.openProject(r.p.id, r.ownerId); }
  }

  /* ---------------- detail ---------------- */
  async function renderDetail(V, opts, { back }) {
    V.innerHTML = `<div class="page"><div class="empty"><div class="spinner"></div>Loading the order…</div></div>`;
    const rows = await loadRows({ all: back === "register" }).catch(() => []);
    const r = rows.find((x) => (opts.oid && x.oid === opts.oid) || (opts.pid && x.p.id === opts.pid && (!opts.owner || x.ownerId === opts.owner)));
    if (!r) { V.innerHTML = `<div class="page"><div class="note err">This order or quotation is not available to you.</div><button class="btn ghost" id="od-b">← Back</button></div>`; $("#od-b").onclick = () => U.go(back); return; }
    const d = await DPStore.loadProject(r.p.id, r.ownerId).catch(() => null), p = d && d.project;
    const ho = r.oid && r.job ? await O.handoverOf(r.job).catch(() => null) : null;
    const items = p ? DPModel.takeoff(p).filter((t) => t.qty > 0 && t.kind !== "annotation") : ((ho && ho.items) || []);
    const c = CUST[r.custKey] || [r.custKey, ""], sg = stageOf(r), e = r.job && r.job.e, cur = r.cur, admin = U.isAdmin();
    const pays = ((r.fin && r.fin.payments) || []).slice(), reps = r.reps.filter((x) => !["accepted"].includes(x.status) && !pays.some((y) => y.reportId === x.id));
    const notes = (DPNotify.N.items || []).filter((n) => r.oid && (n.ref === r.oid || (n.link && n.link.opts && n.link.opts.oid === r.oid))).slice(0, 8);
    const tl = [];
    if (r.p.issuedAt) tl.push({ at: r.p.issuedAt, t: `Quotation issued${r.p.rev > 1 ? " (revision " + r.p.rev + ")" : ""}` });
    if (r.sub && r.sub.status === "accepted") tl.push({ at: r.sub.at, t: `Client acceptance recorded by ${DPAuth.nameSync(r.sub.acceptedBy) || "sales"} (accepted ${H.dateS(r.sub.acceptedAt)})${r.sub.note ? " — " + r.sub.note : ""}` });
    if (r.sub && r.sub.status === "rejected") tl.push({ at: r.sub.at, t: `Client rejected — ${r.sub.reason}` });
    if (r.order) tl.push({ at: r.order.bookedAt || r.order.approvedAt, t: "Order booked in the financial register" });
    for (const x of pays) tl.push({ at: x.at || x.date, t: `Payment ${H.money2(x.amountMinor, cur)} — ${O.PAY_STATUS[x.status] || x.status}` });
    for (const x of r.reps) tl.push({ at: x.at, t: `Payment ${H.money2(x.amountMinor, cur)} reported — ${O.PAY_STATUS[x.status] || x.status}` });
    for (const l of (e && e.log) || []) tl.push({ at: l.at, t: `Engineering: ${l.what}${l.note ? " — " + l.note : ""}` });
    tl.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const mine = r.ownerId === DPStore.st.userId, can = mine || admin;
    V.innerHTML = `<div class="page"><div class="crumbs small"><button class="linkbtn" id="od-b">${back === "register" ? "Order Register" : "My Orders &amp; Proposals"}</button> › ${esc(r.p.ref || r.p.name)}</div>
      <div class="phead"><div><span class="eyebrow">${esc([r.p.ref, r.oid].filter(Boolean).join(" · "))}</span><h1>${esc(r.p.name || "Untitled")}</h1><p class="lead small">${esc([r.p.client, r.p.location, r.p.type].filter(Boolean).join(" · "))}${admin ? " · sales: " + esc(DPAuth.nameSync(r.ownerId) || "—") : ""}</p>
        <div class="row" style="margin-top:6px"><span class="pill ${c[1]}">Client: ${esc(c[0])}</span>${sg ? `<span class="pill ${sg[1]}">${esc(sg[0])}</span>` : ""}${r.job ? `<span class="dl ${r.job.ds.key}">${esc(r.job.ds.label)}</span>` : ""}${r.overdue ? `<span class="pill err">Payment overdue</span>` : ""}</div></div>
        <div class="row">${can && r.custKey === "issued" ? `<button class="btn lime" id="od-acc">${U.svg("check")} Client accepted…</button><button class="btn ghost" id="od-rej">Client rejected…</button>` : ""}${can && r.accepted && !r.cancelled ? `<button class="btn lime" id="od-pay">${U.svg("plus")} Record payment…</button>` : ""}<button class="btn ghost" id="od-more" aria-haspopup="menu">More ▾</button></div></div>
      <div class="dgrid"><div class="stack">
        <div class="card stack"><h3>Summary</h3><div class="kv"><span>Quotation reference</span><b>${esc(r.p.ref || "—")}</b><span>Order reference</span><b>${esc(r.oid || "Created when the client accepts")}</b>
          <span>Date submitted (issued)</span><span>${esc(H.dateS(r.p.issuedAt))}${r.p.rev ? ` · revision ${r.p.rev}` : ""}</span>${r.sub && r.sub.acceptedAt ? `<span>Client accepted on</span><span>${esc(H.dateS(r.sub.acceptedAt))}${r.sub.evidence ? ` · <button class="linkbtn" id="od-ev">view evidence</button>` : ""}</span>` : ""}
          <span>Value (incl. ${esc(App.config.settings.taxLabel || "VAT")})</span><b class="num">${r.total != null ? esc(H.money2(r.total, cur)) : "—"}</b>
          ${r.pay ? `<span>Payment status</span><span><span class="pill ${(DPPay.STATUS[r.pay.status] || ["", ""])[1]}">${esc((DPPay.STATUS[r.pay.status] || [r.pay.status])[0])}</span> <span class="tiny muted">(separate from production status)</span></span>` : ""}
          ${r.order && r.order.valueCheck && admin ? `<span>Value check</span><span class="pill warn">Booked value differs from the accepted quotation</span>` : ""}</div></div>
        ${r.pay ? `<div class="card stack" id="od-pos">${DPPayUI.positionHtml(r.pay, cur, { admin: admin && !!r.order && !r.cancelled })}</div>` : ""}
        <div class="card stack"><div class="row between"><h3>Payments</h3>${can && r.accepted && !r.cancelled ? `<button class="btn sm" id="od-pay2">${U.svg("plus")} Record payment…</button>` : ""}</div>
          ${pays.length || reps.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Date</th><th class="r">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Proof</th></tr></thead><tbody>
            ${pays.map((x) => `<tr><td class="small">${esc(x.date)}</td><td class="r num">${esc(H.money2(x.amountMinor, cur))}</td><td class="small">${esc(x.method || "—")}</td><td class="small">${esc(x.ref || "—")}</td><td><span class="pill ${{ verified: "ok", rejected: "err", recorded: "warn" }[x.status] || ""}">${esc(O.PAY_STATUS[x.status] || x.status)}</span></td><td>${(x.files || []).map((f) => `<button class="btn ghost xs" data-rcpt="${esc(f)}" title="View proof">${U.svg("eye")} View</button>`).join(" ") || '<span class="tiny muted">none</span>'}</td></tr>`).join("")}
            ${reps.map((x) => `<tr><td class="small">${esc(x.date)}</td><td class="r num">${esc(H.money2(x.amountMinor, cur))}</td><td class="small">${esc(x.method || "—")}</td><td class="small">${esc(x.ref || "—")}</td><td><span class="pill ${x.status === "rejected" ? "err" : "warn"}">${esc(x.status === "rejected" ? "Rejected" + (x.note ? ": " + x.note : "") : "Pending verification")}</span></td><td>${x.hasFile ? `<button class="btn ghost xs" data-rep="${esc(x.id)}" data-ru="${esc(x.uid || r.ownerId)}">${U.svg("eye")} View</button>` : '<span class="tiny muted">none</span>'}</td></tr>`).join("")}</tbody></table></div>`
            : `<p class="small muted">${r.accepted ? "No payments recorded yet." : "Payments can be recorded once the client accepts."}</p>`}
          <p class="tiny muted">A payment you record is <b>pending verification</b> until an administrator confirms the funds have cleared. Only verified payments count as collected cash.</p></div>
        ${r.oid && r.accepted && (mine || admin) && root.DPFinUI2 ? `<div class="card stack" id="od-docs"><h3>Invoices &amp; receipts</h3><p class="small muted">Loading…</p></div>` : ""}
        <div class="card stack"><h3>Order items</h3>${items.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Code</th><th>Item</th><th class="r">Quantity</th><th>Unit</th></tr></thead><tbody>${items.slice(0, 200).map((i) => `<tr><td class="small"><b>${esc(i.displayCode || i.code || "")}</b></td><td>${esc(i.name)}</td><td class="r num">${esc(PR.fmtQty(i.qty, i.unit))}</td><td class="small">${esc(PR.UNIT_LABEL[i.unit] || i.unit)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No items.</p>`}</div>
      </div><div class="stack">
        <div class="card stack"><h3>Production &amp; installation</h3>${r.accepted ? `
          <div class="kv"><span>Engineer</span><span>${esc(r.job && r.job.engineerUid ? DPAuth.nameSync(r.job.engineerUid) : "Not assigned yet")}</span><span>Status</span><span>${esc(e ? O.ENG_LABEL[e.status] : "Awaiting Engineering Review")}</span>
          <span>Production</span><span>${esc(e && e.factory && e.factory.dest ? O.METHODS[e.factory.dest] : e && e.method ? O.METHODS[e.method] : "To be decided")}</span><span>Manufacturing progress</span><span>${e ? e.progress || 0 : 0}%</span>
          <span>Target completion</span><span>${esc((e && e.expectedCompletion) || (r.job && r.job.deadlineOriginal) || "—")}</span><span>Installation</span><span>${esc(e && e.installDate ? H.dateS(e.installDate) : "Not scheduled")}${e && e.installProgress ? ` · ${e.installProgress}%` : ""}</span>
          <span>Quality check</span><span>${esc(e && e.qc ? O.QC[e.qc.status] || e.qc.status : "—")}</span><span>Completed</span><span>${esc(e && e.actualCompletion ? H.dateS(e.actualCompletion) : "—")}</span>${e && e.salesNote ? `<span>Note from engineering</span><span>${esc(e.salesNote)}</span>` : ""}</div>
          <div class="prog ${e && e.progress === 100 ? "done" : ""}"><i style="width:${(e && e.progress) || 0}%"></i></div>` : `<p class="small muted">Engineering receives the order automatically when you record the client's acceptance.</p>`}</div>
        <div class="card stack"><h3>Recent updates</h3>${notes.length ? `<div class="tl">${notes.map((n) => `<div><span class="tiny muted">${esc(new Date(n.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span><b>${esc(n.title)}</b> — ${esc(n.body)}</span></div>`).join("")}</div>` : `<p class="small muted">No notifications for this order yet.</p>`}</div>
        <div class="card stack"><h3>History</h3><div class="tl">${tl.slice(0, 40).map((x) => `<div><span class="tiny muted">${esc(new Date(x.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span>${esc(x.t)}</span></div>`).join("") || "<span class='small muted'>—</span>"}</div></div>
      </div></div></div>`;
    const refresh = () => renderDetail(V, opts, { back });
    $("#od-b").onclick = () => U.go(back, { highlight: r.p.id });
    const acc = $("#od-acc"); if (acc) acc.onclick = () => acceptDialog(r.p.id, r.ownerId, () => { U.go(back, { oid: DPSales.orderIdFor({ pid: r.p.id, ref: r.p.ref }) }); });
    const rej = $("#od-rej"); if (rej) rej.onclick = () => rejectDialog(r.p.id, r.ownerId, refresh);
    ["#od-pay", "#od-pay2"].forEach((s) => { const b = $(s); if (b) b.onclick = () => recordPayment(r, refresh); });
    $("#od-more").onclick = (ev) => actionMenu(ev.currentTarget, r, refresh, back === "register");
    const pos = $("#od-pos"); if (pos && r.order) DPPayUI.bindPosition(pos, r.order, refresh);
    const dc = $("#od-docs"); if (dc) root.DPFinUI2.salesDocsCard(dc, r, refresh);
    const ev = $("#od-ev"); if (ev) ev.onclick = async () => DPUI.showFile(await O.getFile(`submissions/${r.ownerId}/s/${r.p.id}/ev/main`));
    $$("[data-rcpt]", V).forEach((b) => (b.onclick = async () => { b.disabled = true; try { const f = await O.receipt(r.oid, b.dataset.rcpt); if (!f) U.toast("The proof is not available to you.", { err: true }); else DPUI.showFile(f, "Customer payment proof"); } finally { b.disabled = false; } }));
    $$("[data-rep]", V).forEach((b) => (b.onclick = async () => DPUI.showFile(await O.getFile(`paysub/${b.dataset.ru}/p/${b.dataset.rep}`), "Customer payment proof")));
  }
  /** Milestones covered by verified payments, oldest first. */
  function scheduleRows(r) {
    return ((r.pay && r.pay.milestones) || []).map((m) => ({ label: m.label, due: m.due || "", amountMinor: m.expectedMinor, remainingMinor: m.remainingMinor, st: m.state === "paid" ? ["Paid", "ok"] : m.state === "overdue" ? ["Overdue", "err"] : m.state === "partly" ? ["Part paid", "warn"] : ["Upcoming", ""] }));
  }

  /* ---------------- quick actions ---------------- */
  /** Price a saved project with the viewer's own price list (sales: their copy; admins: the master). */
  function priceProject(p) { const met = DPModel.metrics(p); return PR.compute({ project: p, takeoff: DPModel.takeoff(p), pricebook: App.config.pricebook, settings: App.config.settings, costs: U.isAdmin() ? App.costs : null, siteArea: met.siteArea, productCount: met.products }); }
  async function acceptDialog(pid, owner, done) {
    const d = await DPStore.loadProject(pid, owner); if (!d) return U.toast("The quotation could not be loaded.", { err: true });
    const p = d.project, r = priceProject(p), today = new Date().toISOString().slice(0, 10);
    if (p.meta.status !== "issued") return U.toast(["accepted", "won"].includes(p.meta.status) ? "The client's acceptance is already recorded." : "Only an issued quotation can be accepted.", { err: true });
    let ev = null;
    U.openModal(`<h2>Client accepted</h2><p class="small muted">${esc([p.meta.ref, p.meta.name, p.meta.client].filter(Boolean).join(" · "))} · ${esc(H.money2(r.total, r.currency))}</p>
      <div class="note ok small">The order becomes <b>Accepted</b> straight away and is sent to Engineering and the administrators. Payment verification and commission approval remain separate.</div>
      <div class="grid3"><label class="field"><span>Acceptance date *</span><input class="in" type="date" id="ac-d" value="${today}" max="${today}"></label><label class="field"><span>Required completion date</span><input class="in" type="date" id="ac-dl"></label>
        <label class="field"><span>Priority</span><select class="in" id="ac-pr"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
      <div class="grid2"><label class="field"><span>Client site contact (shared with engineering)</span><input class="in" id="ac-ct" placeholder="Name · phone"></label><label class="field"><span>Notes (PO number, how the client confirmed…)</span><input class="in" id="ac-n"></label></div>
      <div class="field"><span class="lbl">Acceptance evidence (signed quotation, PO, e-mail screenshot — optional)</span><div class="row"><div id="ac-prev" class="thumbs"><span class="small muted">No file</span></div><button type="button" class="btn ghost sm" id="ac-f">${U.svg("clip")} Attach…</button></div></div>
      <div class="note small"><b>Initial deposit:</b> ${DPPay.depositPct(App.config.settings)}% of the confirmed order value (${esc(H.money2(Math.round(r.total * DPPay.depositPct(App.config.settings) / 100), r.currency))}), due on the acceptance date. This is a payment obligation — record the actual payment separately when the client pays. The remaining balance stays outstanding unless you add milestones for it.</div>
      <details><summary class="small"><b>Further milestones for the balance</b> (optional) — used for “payment due” reminders and overdue alerts</summary><div id="ac-sch" class="stack" style="margin-top:8px"></div><button type="button" class="btn ghost xs" id="ac-add">${U.svg("plus")} Add milestone</button></details>
      <p class="small" id="ac-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="ac-x">Cancel</button><button class="btn lime" id="ac-ok">Record acceptance</button></div>`, (m) => {
      const sch = $("#ac-sch", m), addRow = (label = "", pct = "", due = "") => { const div = document.createElement("div"); div.className = "grid3"; div.innerHTML = `<input class="in sm" data-l placeholder="e.g. Advance payment" value="${esc(label)}"><div class="unit"><input class="in sm num" data-p type="number" min="0" max="100" step="1" placeholder="%" value="${esc(pct)}"><em>%</em></div><input class="in sm" data-d type="date" value="${esc(due)}">`; sch.appendChild(div); };
      $("#ac-add", m).onclick = () => addRow();
      $("#ac-f", m).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { try { ev = await O.prepareFile(f); $("#ac-prev", m).innerHTML = ev.type === "application/pdf" ? `<div class="th pdf">PDF</div><span class="small">${esc(ev.name)}</span>` : `<img class="th" alt="" src="${esc(ev.dataUrl)}"><span class="small">${esc(ev.name)}</span>`; } catch (e) { $("#ac-err", m).textContent = e.message; } });
      $("#ac-x", m).onclick = () => U.closeModal();
      $("#ac-ok", m).onclick = async () => {
        const btn = $("#ac-ok", m), err = $("#ac-err", m); err.textContent = ""; const date = $("#ac-d", m).value;
        if (!date) { err.textContent = "Enter the acceptance date."; return; } if (date > today) { err.textContent = "The acceptance date cannot be in the future."; return; }
        const schedule = $$(".grid3", sch).map((row) => ({ label: $("[data-l]", row).value.trim() || "Payment", pct: +$("[data-p]", row).value || 0, due: $("[data-d]", row).value })).filter((x) => x.pct > 0 && x.due);
        if (schedule.reduce((a, x) => a + x.pct, 0) + DPPay.depositPct(App.config.settings) > 100) { err.textContent = `The milestones add up to more than the ${100 - DPPay.depositPct(App.config.settings)}% balance after the deposit.`; return; }
        btn.disabled = true; btn.textContent = "Recording…";
        try {
          const sub = await DPSales.accept(p, r, App.config.settings, { date, note: $("#ac-n", m).value.trim(), evidence: ev, deadline: $("#ac-dl", m).value || null, priority: $("#ac-pr", m).value, contact: $("#ac-ct", m).value.trim(), schedule });
          await setProjectStatus(p, d, "accepted", { orderId: sub.oid, acceptedAt: sub.acceptedAt }, `Client accepted (${H.dateS(sub.acceptedAt)}) — order ${sub.oid}`);
          U.closeModal(); U.toast(`Order ${sub.oid} accepted and sent to Engineering.`, { ms: 6000 }); done && done(sub);
        } catch (e) { err.textContent = e.message || "Not saved."; btn.disabled = false; btn.textContent = "Record acceptance"; }
      };
    }, { wide: true });
  }
  async function rejectDialog(pid, owner, done) {
    const f = await U.form("Client rejected the quotation", [{ id: "r", label: "Reason (price, timing, chose a competitor…)", type: "textarea", required: true }], { submit: "Record rejection", intro: "The quotation is marked as rejected. You can reopen it later if the client comes back." });
    if (!f) return; const d = await DPStore.loadProject(pid, owner); if (!d) return;
    try { await DPSales.clientRejected(d.project, f.r); await setProjectStatus(d.project, d, "lost", { lostReason: f.r }, "Client rejected: " + f.r); U.toast("Recorded as rejected."); done && done(); } catch (e) { U.toast(e.message, { err: true }); }
  }
  /** Status change on a saved project without opening it in the planner (or through the open project when it is open). */
  async function setProjectStatus(p, d, status, extra, auditText) {
    if (App.open && DPModel.S.project.meta.id === p.meta.id) { Object.assign(DPModel.S.project.meta, { status }, extra); DPModel.commit("Status", { audit: { action: "Status: " + status, detail: auditText } }); const ok = await U.save(); if (!ok) throw new Error("The project could not be saved."); return; }
    Object.assign(p.meta, { status }, extra); p.audit = (p.audit || []).concat([{ at: new Date().toISOString(), by: U.userInfo().name || "", action: "Status: " + status, detail: auditText }]).slice(-150);
    const res = await DPStore.saveProject(p, { cadData: d.cadData, baseRev: d.rev, user: U.userInfo() });
    if (res.conflict) { const res2 = await DPStore.saveProject(Object.assign(res.remote.project, { meta: Object.assign(res.remote.project.meta, { status }, extra) }), { force: true, user: U.userInfo() }); if (!res2.ok) throw new Error("The project could not be saved."); }
    else if (!res.ok) throw new Error(res.tooLarge ? "The project is too large to save." : "The project could not be saved.");
  }
  function recordPayment(r, done) {
    const order = { oid: r.oid, ref: r.p.ref, name: r.p.name, currency: r.cur };
    if (U.isAdmin() && r.order) return DPUI.paymentForm({ title: "Record client payment", order, admin: true, onSubmit: (v) => O.recordPayment(r.oid, v).then(() => { U.toast("Payment recorded."); done && done(); }) });
    DPUI.paymentForm({ title: "Record a client payment", order, admin: false, onSubmit: (v) => O.reportPayment(r.oid, v).then(() => { U.toast("Payment recorded — pending verification by an administrator."); done && done(); }) });
  }
  /** Proposal PDF without leaving this page: the drawing engine reads the open project, so load it, build, restore. */
  async function exportPdf(pid, owner) {
    const M = DPModel, saved = { project: M.S.project, cad: M.S.cadData, ref: M.S.refImage, open: App.open, sample: App.sample, dirty: M.S.dirty };
    if (App.open && M.S.dirty) await U.save();
    const b = U.busy("Building the proposal PDF…");
    try { const d = await DPStore.loadProject(pid, owner); if (!d) throw new Error("The quotation could not be loaded."); M.load(d.project, { cadData: d.cadData }); App.sample = false; U.pricing();
      const out = await DPProposal.proposal({ sections: { overview: true, plan: true, schedule: true, technical: true, quotation: true, notes: true }, progress: (s) => b.set(s + "…") }); b.done(); await U.downloadOut(out, `Proposal (${out.pages} pages)`); }
    catch (e) { b.done(); U.toast("The proposal could not be built: " + (e.message || e) + " Nothing was downloaded.", { err: true, ms: 9000 }); }
    finally { if (saved.project) M.load(saved.project, { cadData: saved.cad, refImage: saved.ref }); App.open = saved.open; App.sample = saved.sample; M.S.dirty = saved.dirty; if (saved.project) U.pricing(); }
  }

  /* ---------------- administrators: Order Register ---------------- */
  async function renderRegister(opts = {}) {
    const V = $("#view-register");
    if (opts.oid || opts.pid) return renderDetail(V, opts, { back: "register" });
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Order <em>Register</em></h1><p class="lead small">Every quotation and order in the company: who issued it, the client's decision, value, collected cash, production status. Search, filter and export.</p></div>
      <div class="row"><button class="btn ghost sm" id="rg-csv">${U.svg("export")} Export CSV</button></div></div>
      <div class="filters"><div class="search" style="width:280px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="rg-q" placeholder="Reference, project, client, employee" value="${esc(F.rq)}"></div>
        <select class="in sm" id="rg-st"><option value="">All</option>${[["issued", "Awaiting client decision"], ["accepted", "Accepted orders"], ["production", "In production"], ["ready", "Ready for installation"], ["installing", "Installing"], ["completed", "Completed"], ["rejected", "Rejected"], ["unpaid", "Balance outstanding"], ["overdue", "Payment overdue"], ["noeng", "No engineer"], ["noprod", "No production assignment"], ["valuecheck", "Value differs from quotation"]].map(([k, l]) => `<option value="${k}"${F.rst === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        <select class="in sm" id="rg-emp"><option value="">All employees</option>${DPAuth.A.directory.filter((x) => x.uid && DPAuth.isSalesRole(x.role)).map((x) => `<option value="${esc(x.uid)}"${F.emp === x.uid ? " selected" : ""}>${esc(DPAuth.fullName(x))}</option>`).join("")}</select>
        <select class="in sm" id="rg-sort">${[["date", "Newest first"], ["value", "Highest value"], ["client", "Client A–Z"], ["balance", "Largest balance"]].map(([k, l]) => `<option value="${k}"${F.rsort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="card" style="padding:0"><div class="tablewrap" id="rg-list"><div class="empty"><div class="spinner"></div></div></div></div></div>`;
    await O.intake().catch(() => {});
    let rows = await loadRows({ all: true }).catch(() => []);
    const fx = (r, k) => k === "noeng" ? r.accepted && !r.cancelled && !(r.job && r.job.engineerUid) : k === "noprod" ? r.accepted && !r.cancelled && !(r.job && r.job.e && r.job.e.factory && r.job.e.factory.dest) : k === "valuecheck" ? !!(r.order && r.order.valueCheck) : filt(r, k);
    const draw = () => {
      const q = F.rq.trim().toLowerCase();
      const vis = sortRows(rows.filter((r) => (!F.emp || r.ownerId === F.emp) && (!q || [r.p.ref, r.p.name, r.p.client, r.oid, DPAuth.nameSync(r.ownerId)].join(" ").toLowerCase().includes(q)) && fx(r, F.rst)), F.rsort);
      $("#rg-list").innerHTML = vis.length ? `<table class="mtable"><thead><tr><th>Reference</th><th>Project · client · sales</th><th>Submitted</th><th>Client</th><th>Order status</th><th class="r">Value</th><th class="r">Collected</th><th class="r">Balance</th><th></th></tr></thead><tbody>${vis.map((r) => rowHtml(r, true)).join("")}</tbody></table>` : `<div class="empty">No records match.</div>`;
      bindRows($("#rg-list"), vis, () => renderRegister(opts), true);
      $("#rg-csv").onclick = () => {
        const q2 = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`, n = (m) => (m == null ? "" : (m / 100).toFixed(2));
        const head = ["quotation_ref", "order_ref", "project", "client", "sales", "issued", "client_status", "order_status", "value", "collected_verified", "pending_verification", "outstanding", "overdue", "engineer", "currency"];
        const csv = [head.join(",")].concat(vis.map((r) => [r.p.ref, r.oid, r.p.name, r.p.client, DPAuth.nameSync(r.ownerId), (r.p.issuedAt || "").slice(0, 10), (CUST[r.custKey] || [r.custKey])[0], (stageOf(r) || [""])[0], n(r.total), n(r.verified), n(r.pending), n(r.outstanding), n(r.overdue), r.job && r.job.engineerUid ? DPAuth.nameSync(r.job.engineerUid) : "", r.cur].map(q2).join(","))).join("\r\n");
        U.downloadOut({ blob: new Blob(["﻿" + csv], { type: "text/csv" }), filename: `xforce-order-register_${new Date().toISOString().slice(0, 10)}.csv` }, "Order register");
      };
    };
    $("#rg-q").oninput = (e) => { F.rq = e.target.value; draw(); }; $("#rg-st").onchange = (e) => { F.rst = e.target.value; draw(); };
    $("#rg-emp").onchange = (e) => { F.emp = e.target.value; draw(); }; $("#rg-sort").onchange = (e) => { F.rsort = e.target.value; draw(); };
    if (opts.filter) { F.rst = opts.filter; $("#rg-st").value = opts.filter; }
    draw();
  }

  U.register("proposals", renderList); U.register("register", renderRegister);
  Object.assign(DPUI, { acceptDialog, rejectDialog, exportPdf, loadOrderRows: loadRows, orderStage: stageOf, scheduleRows });
})(typeof self !== "undefined" ? self : this);
