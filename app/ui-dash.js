/* X FORCE 1.0 (Dupedia) — Sales dashboard, company figures, reports. (CEO Control Center: ui-ceo.js; orders list: ui-orders.js) */
/* global DPUI, DPShell, DPStore, DPAuth, DPLeads, DPSales, DPCommission, DPPricing */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell;
  const D = { per: null, emp: "", aper: null, rperFrom: null, rperTo: null, rEmp: "", rType: "", rOrg: "", rStatus: "" };
  const DEFS = `<div class="defs"><b>Sales achieved</b><span>Commission value of orders an administrator approved in the month (subtotal after discount, excluding VAT, delivery and pass-through charges). Cancelled orders are excluded.</span>
    <b>Proposals issued</b><span>Projects marked as issued in the month (each project counted once, at its latest issue date). Drafts are never counted as issued.</span>
    <b>Conversion</b><span>Orders approved in the month ÷ proposals issued in the month.</span>
    <b>Commission</b><span>Pending: order approved, waiting for the payable trigger. Approved: payable. Paid: paid out. Outstanding: pending + approved, all months.</span></div>`;

  /* ---------------- sales dashboard ---------------- */
  const today = () => new Date().toISOString().slice(0, 10);
  async function renderDash() {
    const role = U.role();
    if (role === "engineer" && DPUI.renderEngDash) return DPUI.renderEngDash();
    if (role === "dataentry" && DPUI.renderDeDash) return DPUI.renderDeDash();
    if (role === "viewer") { $("#view-dash").innerHTML = `<div class="page"><div class="note">View-only access.</div></div>`; return; }
    if (U.isAdmin() && DPUI.renderCeo && !(App.viewOpts || {}).mine) return DPUI.renderCeo();
    const V = $("#view-dash"); D.per = D.per || H.curPer();
    const me = U.me(), pic = await H.picHtml(me.id, 72, "ring2");
    V.innerHTML = `<div class="page"><div class="phead"><div class="hello">${pic}<div><span class="eyebrow">${esc([me.title || me.roleLabel, me.department].filter(Boolean).join(" · "))} · ${esc(new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))}</span><h1>Hello, <em>${esc(me.firstName || "there")}</em>.</h1><p class="lead small" id="d-sum">Here is what needs you today.</p></div></div>
      <div class="row">${H.perSelect("d-per", D.per)}<button class="btn lime" id="d-new">${U.svg("plus")} New site plan</button><button class="btn ghost" id="d-log">${U.svg("phone")} Log a call</button></div></div>
      <div id="d-body"><div class="empty"><div class="spinner"></div>Loading your day…</div></div></div>`;
    $("#d-per").onchange = (e) => { D.per = e.target.value; renderDash(); };
    $("#d-new").onclick = () => U.go("setup", { isNew: true });
    $("#d-log").onclick = () => DPUI.logDialog({ onDone: renderDash });
    let comms = [], rows = [], crms = [], staff = { targets: {} }, leads = [];
    try {
      [comms, rows, crms, staff, leads] = await Promise.all([DPSales.myCommissions(), DPUI.loadOrderRows(), DPLeads.listCrm(DPStore.st.userId), DPSales.staffDoc(DPStore.st.userId), DPLeads.listLeads(), DPLeadOps.loadActs()]);
    } catch (e) { $("#d-body").innerHTML = `<div class="note err">Your figures could not be loaded (${esc(e.message || e.code)}).</div>`; return; }
    const uid = DPStore.st.userId, cur = App.config.pricebook.currency || "EGP", leadsById = Object.fromEntries(leads.map((l) => [l.id, l]));
    const target = DPSales.targetFor(staff, D.per, App.config.settings), tMinor = Math.round(target * 100);
    // closed deals: accepted orders (client acceptance date), value = booked commission value when booked, else the accepted quotation
    const commOf = (oid) => comms.find((c) => c.oid === oid);
    const elig = (r) => { const c = commOf(r.oid); return c && !["cancelled", "reversed"].includes(c.status) ? c.eligibleMinor : r.sub && r.sub.base ? r.sub.base.eligibleMinor : 0; };
    const closed = rows.filter((r) => r.accepted && !r.cancelled);
    const inPer = (r, per) => DPSales.inPer((r.sub && r.sub.acceptedAt) || (r.order && r.order.approvedAt) || r.p.savedAt, per);
    const closedPer = closed.filter((r) => inPer(r, D.per)), achieved = closedPer.reduce((a, r) => a + elig(r), 0), frac = tMinor ? achieved / tMinor : 0;
    const fus = DPLeadOps.followUps(uid), fOver = fus.filter((f) => f.when === "overdue"), fToday = fus.filter((f) => f.when === "today"), fUp = fus.filter((f) => f.when === "upcoming");
    const awaiting = rows.filter((r) => r.custKey === "issued"), action = closed.filter((r) => r.overdue > 0 || (r.outstanding > 0 && !r.verified && !r.pending));
    const paysMonth = rows.flatMap((r) => ((r.fin && r.fin.payments) || []).map((p) => Object.assign({ r }, p)).concat(r.reps.filter((x) => !((r.fin && r.fin.payments) || []).some((y) => y.reportId === x.id)).map((x) => Object.assign({ r, status: x.status === "submitted" ? "submitted" : x.status }, x)))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const cfg = App.commissionCfg, est = awaiting.filter((r) => r.sub == null && r.p.base && cfg).reduce((a, r) => a + DPSales.estimate(r.p.base.eligibleMinor, cfg).amountMinor, 0);
    const live = comms.filter((c) => !["cancelled", "reversed"].includes(c.status)), calc = (c) => (c.calculatedMinor != null ? c.calculatedMinor : c.amountMinor);
    const cAwait = live.filter((c) => ["calculated", "pending", "returned"].includes(c.status)).reduce((a, c) => a + calc(c), 0), cAppr = live.filter((c) => c.approvedMinor != null).reduce((a, c) => a + DPSales.owedMinor(c), 0), cPaid = live.reduce((a, c) => a + DPSales.paidMinor(c), 0);
    const unacceptedEst = closed.filter((r) => !commOf(r.oid) && r.sub && r.sub.base && cfg).reduce((a, r) => a + DPSales.estimate(r.sub.base.eligibleMinor, cfg).amountMinor, 0);
    // quotations most likely to close: pipeline stage of the linked lead, then recency
    const stageRank = { negotiation: 3, meeting: 2, qualified: 2, proposal_issued: 1 };
    const hot = awaiting.map((r) => { const crm = r.p.leadId ? crms.find((c) => c.leadId === r.p.leadId) : null; return { r, rank: (crm && stageRank[crm.stage]) || 0, age: Math.round((Date.now() - Date.parse(r.p.issuedAt || r.p.savedAt)) / 864e5), crm }; })
      .sort((a, b) => b.rank - a.rank || a.age - b.age || (b.r.total || 0) - (a.r.total || 0)).slice(0, 5);
    const unread = DPNotify.N.items.filter((n) => !n.read);
    $("#d-sum").textContent = `${fOver.length + fToday.length} follow-up${fOver.length + fToday.length === 1 ? "" : "s"} today${fOver.length ? ` (${fOver.length} overdue)` : ""} · ${awaiting.length} quotation${awaiting.length === 1 ? "" : "s"} awaiting a decision · ${Math.round(frac * 100)}% of this month's target.`;
    const card = (k, label, val, sub, cls = "") => `<button type="button" class="kcard ${cls}" data-k="${k}"><span class="eyebrow">${esc(label)}</span><b class="num">${val}</b><span class="tiny">${sub}</span></button>`;
    $("#d-body").innerHTML = `<div class="stack">
      <div class="kcards">${card("fu-today", "Follow-ups today", fToday.length, fToday[0] ? esc(fToday[0].contact || (leadsById[fToday[0].leadId] || {}).name || "") : "nothing scheduled")}${card("fu-over", "Overdue follow-ups", fOver.length, fOver.length ? "needs you now" : "all caught up", fOver.length ? "bad" : "")}
        ${card("issued", "Awaiting client decision", awaiting.length, esc(H.money(awaiting.reduce((a, r) => a + (r.total || 0), 0), cur)) + " quoted")}${card("accepted", "Closed this month", closedPer.length, esc(H.money(closedPer.reduce((a, r) => a + (r.total || 0), 0), cur)) + " order value")}
        ${card("action", "Orders needing action", action.length, action.length ? "payment due or not yet recorded" : "none", action.length ? "warn" : "")}${card("notif", "Unread notifications", unread.length, unread[0] ? esc(unread[0].title) : "you're up to date")}</div>
      <div class="dgrid"><div class="card stack corner"><div class="row between"><h3>Monthly target</h3><span class="tiny muted">${esc(H.perLabel(D.per))} · target ${esc(H.money(tMinor, cur))}</span></div>
        <div class="tgt">${H.ring(frac, "Target progress")}<div class="stack" style="gap:6px"><div class="kv"><span>Closed (commission value)</span><b class="num">${esc(H.money(achieved, cur))}</b><span>Remaining</span><b class="num">${esc(H.money(Math.max(0, tMinor - achieved), cur))}</b><span>Deals closed</span><b class="num">${closedPer.length}</b><span>Active leads</span><b class="num">${crms.filter((c) => !["won", "lost", "released", "reassigned"].includes(c.stage)).length}</b></div>
          <p class="tiny muted">Counted at the client's acceptance date, on the value after discount excluding ${esc(App.config.settings.taxLabel || "VAT")}, delivery and pass-through charges.</p></div></div></div>
        <div class="card stack" id="d-fu"></div></div>
      <div class="dgrid"><div class="card stack"><div class="row between"><h3>Quotations most likely to close</h3><button class="btn ghost xs" data-go="proposals">All</button></div>
          ${hot.length ? `<div class="tl">${hot.map((x) => `<div><span class="small"><span class="pill ${x.rank >= 3 ? "ok" : x.rank ? "info" : ""}">${esc(x.crm ? DPLeads.STAGE_LABEL[x.crm.stage] || "Issued" : "Issued")}</span></span><span><button class="linkbtn" data-pid="${esc(x.r.p.id)}">${esc(x.r.p.name)}</button> — ${esc(x.r.p.client || "")} · <b class="num">${esc(H.money(x.r.total || 0, x.r.cur))}</b> · issued ${x.age} day${x.age === 1 ? "" : "s"} ago</span></div>`).join("")}</div><p class="tiny muted">Ranked by the linked lead's pipeline stage, then by how recently the quotation was issued. Not a prediction.</p>` : `<p class="small muted">No quotations awaiting a decision.</p>`}</div>
        <div class="card stack"><div class="row between"><h3>Recent orders</h3><button class="btn ghost xs" data-go="proposals">My Orders &amp; Proposals</button></div>
          ${closed.length ? `<div class="tl">${closed.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5).map((r) => { const sg = DPUI.orderStage(r) || ["", ""]; return `<div><span class="tiny muted">${esc(H.dateS(r.date))}</span><span><button class="linkbtn" data-oid="${esc(r.oid)}">${esc(r.p.name)}</button> <span class="pill ${sg[1]}">${esc(sg[0])}</span>${r.job && r.job.e ? ` ${r.job.e.progress || 0}%` : ""}</span></div>`; }).join("")}</div>` : `<p class="small muted">No accepted orders yet.</p>`}</div></div>
      <div class="dgrid"><div class="card stack"><div class="row between"><h3>Recent payments</h3></div>
          ${paysMonth.length ? `<div class="tl">${paysMonth.slice(0, 6).map((p) => `<div><span class="small">${esc(p.date)}</span><span><b class="num">${esc(H.money2(p.amountMinor, p.r.cur))}</b> — ${esc(p.r.p.name)} <span class="pill ${{ verified: "ok", rejected: "err" }[p.status] || "warn"}">${esc(DPOrders.PAY_STATUS[p.status] || p.status)}</span></span></div>`).join("")}</div>` : `<p class="small muted">No payments recorded yet.</p>`}</div>
        <div class="card stack corner"><div class="row between"><h3>My Commission</h3><button class="btn ghost xs" data-go="mycomm">Details</button></div>
          <div class="kv"><span>Estimated (open quotations &amp; new orders)</span><b class="num">${esc(H.money(est + unacceptedEst, cur))}</b><span>Awaiting approval</span><b class="num">${esc(H.money(cAwait, cur))}</b><span>Approved</span><b class="num">${esc(H.money(cAppr, cur))}</b><span>Paid</span><b class="num">${esc(H.money(cPaid, cur))}</b></div>
          <p class="tiny muted">Estimates are not approved amounts. Approval and payment are separate steps.</p></div></div>
      <div class="dgrid"><div class="card stack"><div class="row between"><h3>Notifications</h3><button class="btn ghost xs" id="d-bell">Notification Center</button></div>${DPNotify.N.items.length ? `<div class="tl">${DPNotify.N.items.slice(0, 5).map((n) => `<div><span class="tiny muted">${esc(new Date(n.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }))}</span><span>${n.read ? "" : "● "}<b>${esc(n.title)}</b> — ${esc(n.body)}</span></div>`).join("")}</div>` : `<p class="small muted">Nothing yet.</p>`}</div>
        <div class="card stack"><div class="row between"><h3>Messages</h3><button class="btn ghost xs" id="d-chat">Open chat</button></div><p class="small muted">Company Wall and private conversations with any colleague, without leaving your work.</p></div></div></div>`;
    followWidget($("#d-fu"), { fOver, fToday, fUp, leadsById, done: renderDash });
    const go = { "fu-today": () => U.go("calls", { fu: "today" }), "fu-over": () => U.go("calls", { fu: "overdue" }), issued: () => U.go("proposals", { st: "issued" }), accepted: () => U.go("proposals", { st: "accepted" }), action: () => U.go("proposals", { st: "unpaid" }), notif: () => DPShell.notifPanel() };
    $$("[data-k]", V).forEach((b) => (b.onclick = () => go[b.dataset.k] && go[b.dataset.k]()));
    $$("[data-go]", V).forEach((b) => (b.onclick = () => U.go(b.dataset.go)));
    $$("[data-pid]", V).forEach((b) => (b.onclick = () => U.go("proposals", { pid: b.dataset.pid })));
    $$("[data-oid]", V).forEach((b) => (b.onclick = () => U.go("proposals", { oid: b.dataset.oid })));
    $("#d-bell").onclick = () => DPShell.notifPanel(); $("#d-chat").onclick = () => root.DPChatUI && DPChatUI.open();
  }
  /** Compact "My Follow-ups" widget: overdue, today, upcoming, with quick actions. */
  function followWidget(B, { fOver, fToday, fUp, leadsById, done }) {
    const tab = D.fuTab || (fOver.length ? "overdue" : "today"), list = { overdue: fOver, today: fToday, upcoming: fUp }[tab] || [];
    const last = (a) => { const prev = DPLeadOps.LT.acts.filter((x) => x.leadId === a.leadId && x.uid === a.uid).sort((x, y) => String(y.at).localeCompare(String(x.at)))[0]; return prev ? `${DPLeadOps.actLabel(prev)}${prev.outcome ? " · " + prev.outcome : ""}${prev.notes ? " — " + prev.notes.slice(0, 80) : ""}` : ""; };
    B.innerHTML = `<div class="row between"><h3>My Follow-ups</h3><div class="seg">${[["overdue", "Overdue", fOver.length], ["today", "Today", fToday.length], ["upcoming", "Upcoming", fUp.length]].map(([k, l, n]) => `<button type="button" data-fut="${k}" class="${tab === k ? "is-on" : ""}">${l}${n ? ` <em class="${k === "overdue" ? "bad" : ""}">${n}</em>` : ""}</button>`).join("")}</div></div>
      ${list.length ? `<div class="fulist">${list.slice(0, 8).map((a) => `<div class="fu ${a.when}"><div class="fut"><b>${esc(new Date(a.followUpAt).toLocaleString([], tab === "today" ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }))}</b><span class="tiny">${esc(a.when === "overdue" ? "overdue" : "")}</span></div>
          <div class="fud"><b>${esc((leadsById[a.leadId] || {}).name || a.leadId)}</b>${a.contact ? ` · ${esc(a.contact)}` : ""}<div class="tiny muted">${esc(a.nextAction || "Follow up")}</div>${last(a) ? `<div class="tiny muted">Last: ${esc(last(a))}</div>` : ""}</div>
          <div class="fua"><button class="btn ghost xs" data-fl="${esc(a.leadId)}" title="Open lead">Lead</button><button class="btn ghost xs" data-fc="${esc(a.leadId)}">Log call</button><button class="btn ghost xs" data-fe="${esc(a.id)}">Edit</button><button class="btn lime xs" data-fd="${esc(a.id)}">Done</button></div></div>`).join("")}</div>`
        : `<p class="small muted">${tab === "overdue" ? "Nothing overdue." : tab === "today" ? "No follow-ups today." : "Nothing scheduled. Set a follow-up when you log a call."}</p>`}`;
    $$("[data-fut]", B).forEach((b) => (b.onclick = () => { D.fuTab = b.dataset.fut; followWidget(B, { fOver, fToday, fUp, leadsById, done }); }));
    $$("[data-fl]", B).forEach((b) => (b.onclick = () => U.go("myleads", { lead: b.dataset.fl })));
    $$("[data-fc]", B).forEach((b) => (b.onclick = () => DPUI.logDialog({ leadId: b.dataset.fc, onDone: done })));
    $$("[data-fe]", B).forEach((b) => (b.onclick = () => { const a = DPLeadOps.LT.acts.find((x) => x.id === b.dataset.fe); if (a) DPUI.editActDialog(a, done); }));
    $$("[data-fd]", B).forEach((b) => (b.onclick = () => { const a = DPLeadOps.LT.acts.find((x) => x.id === b.dataset.fd); if (a) DPUI.completeFuDialog(a, done); }));
  }

  /* ---------------- administrator dashboard ---------------- */
  async function companyData() {
    const [orders, comms, projects, dir, claims, leads] = await Promise.all([DPSales.listOrders(), DPSales.allCommissions(), DPStore.listProjects(H.ownerIds()), DPAuth.listDirectory(), DPLeads.claimsByLead(), DPLeads.listLeads()]);
    const uids = dir.filter((r) => r.uid).map((r) => r.uid);
    const crmLists = await Promise.all(uids.map((u) => DPLeads.listCrm(u).then((l) => l.map((x) => Object.assign({ uid: u }, x)))));
    const staffs = {}; await Promise.all(uids.map(async (u) => { staffs[u] = await DPSales.staffDoc(u); }));
    return { orders, comms, projects, dir, claims, leads, crms: crmLists.flat(), staffs };
  }
  /** Profitability of one order. Gross profit = after-discount value excl. VAT − product cost. Contribution = gross profit − commission − selling expenses.
   *  Not "net profit": overheads and other operating costs are not allocated here. */
  function orderMoney(o, comm) {
    const rev = o.afterDiscountMinor; // revenue after discount, excluding VAT
    const cost = o.costMinor, gp = cost == null ? null : rev - cost, c = comm ? DPCommission.total(comm) : 0, sx = (o.sellingExpenses || []).reduce((a, x) => a + (x.amountMinor || 0), 0);
    return { rev, cost, gp, gm: gp == null || !rev ? null : gp / rev, comm: c, sx, contrib: gp == null ? null : gp - c - sx };
  }
  async function renderAdminDash(B) {
    D.aper = D.aper || H.curPer();
    let d; try { d = await companyData(); } catch (e) { B.innerHTML = `<div class="note err">Company figures could not be loaded (${esc(e.message || e.code)}).</div>`; return; }
    const cur = App.config.pricebook.currency || "EGP";
    const live = d.orders.filter((o) => o.status !== "cancelled" && DPSales.inPer(o.approvedAt, D.aper) && (!D.emp || o.ownerId === D.emp));
    const commOf = (o) => d.comms.find((c) => c.oid === o.oid);
    const tot = live.reduce((a, o) => { const m = orderMoney(o, commOf(o)); a.elig += o.eligibleMinor; a.rev += m.rev; a.comm += m.comm; a.sx += m.sx; if (m.cost != null) { a.cost += m.cost; a.gp += m.gp; } else a.noCost++; a.contrib += m.contrib || 0; return a; }, { elig: 0, rev: 0, cost: 0, gp: 0, comm: 0, sx: 0, contrib: 0, noCost: 0 });
    const emps = d.dir.filter((r) => r.uid && r.active !== false);
    const issued = d.projects.filter((p) => p.issuedAt && DPSales.inPer(p.issuedAt, D.aper));
    const rows = emps.map((r) => { const mine = live.filter((o) => o.ownerId === r.uid), t = DPSales.targetFor(d.staffs[r.uid], D.aper, App.config.settings) * 100;
      const ach = mine.reduce((a, o) => a + o.eligibleMinor, 0), iss = issued.filter((p) => p.ownerId === r.uid).length, cm = mine.reduce((a, o) => a + orderMoney(o, commOf(o)).comm, 0);
      const cl = Object.values(d.claims).flat().filter((c) => c.uid === r.uid && DPSales.inPer(c.claimedAt, D.aper)).length;
      return { r, ach, t, iss, orders: mine.length, conv: iss ? mine.length / iss : null, cm, cl }; }).sort((a, b) => b.ach - a.ach);
    const pend = d.comms.filter((c) => ["pending", "approved"].includes(c.status)).reduce((a, c) => a + DPCommission.total(c), 0);
    B.innerHTML = `<div class="stack"><div class="filters">${H.perSelect("ad-per", D.aper)}<select class="in sm" id="ad-emp"><option value="">All employees</option>${emps.map((r) => `<option value="${esc(r.uid)}"${D.emp === r.uid ? " selected" : ""}>${esc(r.displayName || r.email)}</option>`).join("")}</select><button class="btn ghost sm" id="ad-rep">Open reports</button></div>
      <div class="stats">${H.stat("Approved sales", esc(H.money(tot.elig, cur)), `${live.length} orders · commission value`)}${H.stat("Revenue excl. VAT", esc(H.money(tot.rev, cur)), "after discount")}${H.stat("Product cost", esc(H.money(tot.cost, cur)), tot.noCost ? `${tot.noCost} order(s) without cost data` : "from the restricted cost prices")}
        ${H.stat("Gross profit", esc(H.money(tot.gp, cur)), tot.rev ? "margin " + H.pctS(tot.gp / tot.rev) : "")}${H.stat("Commission", esc(H.money(tot.comm, cur)), tot.gp ? H.pctS(tot.comm / tot.gp) + " of gross profit" : "")}
        ${H.stat("Selling expenses", esc(H.money(tot.sx, cur)), "recorded on orders")}${H.stat("Contribution", esc(H.money(tot.contrib, cur)), "after commission and selling expenses", "hl")}${H.stat("Commission outstanding", esc(H.money(pend, cur)), "pending + approved, all months")}</div>
      <p class="tiny muted">Contribution is gross profit minus commission and recorded selling expenses. It is <b>not net profit</b>: overheads, salaries, rent and other operating costs are not allocated in Site Planner.</p>
      <div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>Employee</th><th class="r">Target</th><th class="r">Achieved</th><th class="r">%</th><th class="r">Proposals issued</th><th class="r">Orders</th><th class="r">Conversion</th><th class="r">Leads claimed</th><th class="r">Commission</th></tr></thead>
        <tbody>${rows.map((x) => `<tr class="click" data-emp="${esc(x.r.uid)}"><td><b>${esc(x.r.displayName || x.r.email)}</b><div class="tiny muted">${esc((DPAuth.roleOf(x.r.role) || {}).label || x.r.role)}</div></td><td class="r">${esc(H.money(x.t, cur))}</td><td class="r">${esc(H.money(x.ach, cur))}</td><td class="r">${x.t ? Math.round(x.ach / x.t * 100) + "%" : "—"}</td><td class="r">${x.iss}</td><td class="r">${x.orders}</td><td class="r">${H.pctS(x.conv)}</td><td class="r">${x.cl}</td><td class="r">${esc(H.money(x.cm, cur))}</td></tr>`).join("") || `<tr><td colspan="9"><div class="empty small">No active users yet.</div></td></tr>`}</tbody></table></div></div></div>`;
    $("#ad-per").onchange = (e) => { D.aper = e.target.value; renderAdminDash(B); };
    $("#ad-emp").onchange = (e) => { D.emp = e.target.value; renderAdminDash(B); };
    $("#ad-rep").onclick = () => U.go("reports");
    $$("[data-emp]", B).forEach((tr) => (tr.onclick = () => U.go("employees", { uid: tr.dataset.emp })));
  }

  /* ---------------- reports (administrators) ---------------- */
  async function renderReports() {
    const V = $("#view-reports"); D.rperFrom = D.rperFrom || DPSales.lastPeriods(3)[2]; D.rperTo = D.rperTo || H.curPer();
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Sales &amp; profitability <em>reports</em></h1><p class="lead small">Approved orders with cost, gross profit, commission and contribution. Export to CSV for finance.</p></div><div class="row"><button class="btn ghost sm" id="rp-csv">Export CSV</button></div></div>
      <div class="filters" id="rp-f"></div><div id="rp-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    let d; try { d = await companyData(); } catch (e) { $("#rp-body").innerHTML = `<div class="note err">${esc(e.message || e.code)}</div>`; return; }
    const pers = DPSales.lastPeriods(24), emps = d.dir.filter((r) => r.uid), leadsById = Object.fromEntries(d.leads.map((l) => [l.id, l]));
    $("#rp-f").innerHTML = `<span class="small">From</span><select class="in sm" id="rp-a">${pers.map((p) => `<option value="${p}"${p === D.rperFrom ? " selected" : ""}>${esc(H.perLabel(p))}</option>`).join("")}</select><span class="small">to</span><select class="in sm" id="rp-b">${pers.map((p) => `<option value="${p}"${p === D.rperTo ? " selected" : ""}>${esc(H.perLabel(p))}</option>`).join("")}</select>
      <select class="in sm" id="rp-e"><option value="">All employees</option>${emps.map((r) => `<option value="${esc(r.uid)}"${D.rEmp === r.uid ? " selected" : ""}>${esc(r.displayName || r.email)}</option>`).join("")}</select>
      <select class="in sm" id="rp-t"><option value="">All project types</option>${[...new Set(d.orders.map((o) => o.type).filter(Boolean))].map((t) => `<option${D.rType === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select class="in sm" id="rp-o"><option value="">All customer types</option>${Object.entries(DPLeads.ORG_TYPES).map(([k, l]) => `<option value="${k}"${D.rOrg === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <select class="in sm" id="rp-s"><option value="">Approved orders</option><option value="cancelled"${D.rStatus === "cancelled" ? " selected" : ""}>Cancelled orders</option></select>`;
    ["a", "b", "e", "t", "o", "s"].forEach((k) => ($("#rp-" + k).onchange = () => { D.rperFrom = $("#rp-a").value; D.rperTo = $("#rp-b").value; D.rEmp = $("#rp-e").value; D.rType = $("#rp-t").value; D.rOrg = $("#rp-o").value; D.rStatus = $("#rp-s").value; renderReports(); }));
    const lo = D.rperFrom < D.rperTo ? D.rperFrom : D.rperTo, hi = D.rperFrom < D.rperTo ? D.rperTo : D.rperFrom;
    const orgOf = (o) => o.orgType || (o.leadId && leadsById[o.leadId] ? leadsById[o.leadId].orgType : "");
    const rows = d.orders.filter((o) => (D.rStatus === "cancelled" ? o.status === "cancelled" : o.status !== "cancelled") && o.period >= lo && o.period <= hi && (!D.rEmp || o.ownerId === D.rEmp) && (!D.rType || o.type === D.rType) && (!D.rOrg || orgOf(o) === D.rOrg))
      .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)))
      .map((o) => ({ o, m: orderMoney(o, d.comms.find((c) => c.oid === o.oid)), c: d.comms.find((c) => c.oid === o.oid) }));
    const cur = App.config.pricebook.currency || "EGP", sum = (f) => rows.reduce((a, x) => a + (f(x) || 0), 0);
    const byEmp = emps.map((r) => ({ l: (r.displayName || r.email || "").slice(0, 16), v: rows.filter((x) => x.o.ownerId === r.uid).reduce((a, x) => a + x.o.eligibleMinor, 0) })).filter((x) => x.v).sort((a, b) => b.v - a.v);
    $("#rp-body").innerHTML = `<div class="stack"><div class="stats">${H.stat("Orders", rows.length, "")}${H.stat("Commission value", esc(H.money(sum((x) => x.o.eligibleMinor), cur)), "")}${H.stat("Revenue excl. VAT", esc(H.money(sum((x) => x.m.rev), cur)), "")}${H.stat("Gross profit", esc(H.money(sum((x) => x.m.gp), cur)), "")}${H.stat("Commission", esc(H.money(sum((x) => x.m.comm), cur)), "")}${H.stat("Contribution", esc(H.money(sum((x) => x.m.contrib), cur)), "not net profit", "hl")}</div>
      ${byEmp.length ? `<div class="card stack"><h3>Approved sales by employee</h3>${H.bars(byEmp, { fmt: (v) => H.money(v, cur) })}</div>` : ""}
      <div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>Approved</th><th>Order</th><th>Employee</th><th>Customer type</th><th class="r">Commission value</th><th class="r">Revenue excl. VAT</th><th class="r">Cost</th><th class="r">Gross profit</th><th class="r">GM %</th><th class="r">Commission</th><th class="r">Selling exp.</th><th class="r">Contribution</th><th>Commission status</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td class="small">${esc(H.dateS(x.o.approvedAt))}</td><td><b>${esc(x.o.name)}</b><div class="tiny muted">${esc([x.o.oid, x.o.client].filter(Boolean).join(" · "))}</div></td><td class="small">${esc(DPAuth.nameSync(x.o.ownerId) || "—")}</td><td class="small">${esc(DPLeads.ORG_TYPES[orgOf(x.o)] || "—")}</td>
        <td class="r">${esc(H.money(x.o.eligibleMinor, cur))}</td><td class="r">${esc(H.money(x.m.rev, cur))}</td><td class="r">${x.m.cost == null ? '<span class="pill warn">no cost data</span>' : esc(H.money(x.m.cost, cur))}</td><td class="r">${x.m.gp == null ? "—" : esc(H.money(x.m.gp, cur))}</td><td class="r">${H.pctS(x.m.gm)}</td>
        <td class="r">${esc(H.money(x.m.comm, cur))}</td><td class="r">${esc(H.money(x.m.sx, cur))}</td><td class="r">${x.m.contrib == null ? "—" : esc(H.money(x.m.contrib, cur))}</td><td>${x.c ? `<span class="pill">${esc(DPCommission.STATUS_LABEL[x.c.status])}</span>` : "—"}</td></tr>`).join("") || `<tr><td colspan="13"><div class="empty small">No orders match these filters.</div></td></tr>`}</tbody></table></div></div>
      <p class="tiny muted">Gross profit uses the cost prices captured when each order was approved. Contribution = gross profit − commission (including adjustments) − recorded selling expenses. Overheads and other operating costs are not allocated, so none of these figures is net profit.</p></div>`;
    $("#rp-csv").onclick = () => {
      const head = ["approved", "order", "project", "client", "employee", "customer_type", "project_type", "commission_value", "revenue_excl_vat", "cost", "gross_profit", "gm_pct", "commission", "selling_expenses", "contribution", "commission_status", "currency"];
      const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`, n = (m) => (m == null ? "" : (m / 100).toFixed(2));
      const csv = [head.join(",")].concat(rows.map((x) => [x.o.approvedAt.slice(0, 10), x.o.oid, x.o.name, x.o.client, DPAuth.nameSync(x.o.ownerId), DPLeads.ORG_TYPES[orgOf(x.o)] || "", x.o.type || "", n(x.o.eligibleMinor), n(x.m.rev), n(x.m.cost), n(x.m.gp), x.m.gm == null ? "" : (x.m.gm * 100).toFixed(1), n(x.m.comm), n(x.m.sx), n(x.m.contrib), x.c ? x.c.status : "", x.o.currency].map(q).join(","))).join("\r\n");
      U.downloadOut({ blob: new Blob(["﻿" + csv], { type: "text/csv" }), filename: `dupedia-sales-report_${lo}_${hi}.csv` }, "Report");
    };
  }

  U.register("dash", renderDash); U.register("reports", renderReports);
  Object.assign(DPUI, { renderDash, orderMoney, companyData, followWidget });
})(typeof self !== "undefined" ? self : this);
