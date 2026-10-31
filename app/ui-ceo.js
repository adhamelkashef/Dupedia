/* X FORCE 1.0 (Dupedia) — CEO Control Center (administrator dashboard), Approve Commission, Audit Log, Company Search.
   Exception-driven: the first thing the owner sees is what needs a decision, each item linked to its record.
   Money definitions are kept apart on purpose:
     signed contract value  = value (incl. VAT) of orders the client accepted, not cancelled
     invoiced               = not tracked in X FORCE (no invoicing module) — shown as such, never estimated
     collected cash         = VERIFIED customer payments only
     pending verification   = payments recorded by sales/admin not yet verified
     outstanding receivable = signed contract value − collected cash
     estimated gross profit = value after discount excl. VAT − product cost captured at booking (lines without cost excluded)
     realised gross profit  = the same, only for orders that are completed AND fully collected */
/* global DPUI, DPShell, DPStore, DPAuth, DPLeads, DPLeadOps, DPSales, DPOrders, DPCommission, DPPricing, DPNotify */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, O = DPOrders, C = DPCommission;
  const D = { per: "month", ac: "", acSt: "open", aq: "", aw: "", sq: "" };
  const PERIODS = { today: "Today", week: "This week", month: "This month", quarter: "This quarter", ytd: "Year to date" };
  function range(per) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth(); let a;
    if (per === "today") a = new Date(y, m, n.getDate()); else if (per === "week") { a = new Date(y, m, n.getDate()); a.setDate(a.getDate() - ((a.getDay() + 1) % 7)); }   // week starts Saturday (Egypt)
    else if (per === "quarter") a = new Date(y, Math.floor(m / 3) * 3, 1); else if (per === "ytd") a = new Date(y, 0, 1); else a = new Date(y, m, 1);
    return [a.toISOString(), new Date(n.getTime() + 60e3).toISOString()];
  }
  const inR = (iso, r) => !!iso && iso >= r[0] && iso <= r[1];

  async function data() {
    await O.intake().catch(() => {});
    const [rows, comms, jobs, leads, claims, dir, workers, logs] = await Promise.all([DPUI.loadOrderRows({ all: true }), DPSales.allCommissions(), O.listJobs(), DPLeads.listLeads(), DPLeads.claimsByLead(), DPAuth.listDirectory(), O.listWorkers().catch(() => []), DPStore.tryList("adminlog"), DPLeadOps.loadActs()]);
    const uids = dir.filter((r) => r.uid).map((r) => r.uid), staffs = {}; await Promise.all(uids.map(async (u) => { staffs[u] = await DPSales.staffDoc(u); }));
    const docs = root.DPFin ? await DPFin.docs().catch(() => null) : null, inv = docs ? docs.filter((x) => x.status === "issued") : null;
    return { invoiced: inv ? inv.filter((x) => x.kind === "tax_invoice").reduce((t, x) => t + (x.totalMinor || 0), 0) - inv.filter((x) => x.kind === "credit_note").reduce((t, x) => t + (x.totalMinor || 0), 0) : null, rows, comms, jobs, leads, claims, dir, workers, staffs, log: logs.flatMap((x) => (x.data.entries || []).map((e) => Object.assign({ day: x.id }, e))).sort((a, b) => String(b.at).localeCompare(String(a.at))) };
  }
  /** The exception list: every item names the record, why it is flagged, and the action. */
  /** 1.3 — compact "Needs your attention": urgent exceptions first (strong colour only for them), then ordinary items and
   *  my overdue reminders in a quiet list; one line each, details on demand, three-plus more behind "Show all". */
  function attention(al) {
    const rem = (root.DPLive && DPLive.L.reminders || []).filter((r) => DPLive.isOverdue(r)).map((r) => ({ sev: r.priority === "urgent" ? 3 : 1, cat: "Reminder", title: r.title, body: (r.notes || "").slice(0, 160), action: "Open", go: { view: "reminders" }, when: DPLive.dueAt(r) }));
    const all = rem.concat(al), urgent = all.filter((a) => a.sev >= 3), rest = all.filter((a) => a.sev < 3), ic = { Reminder: "⏰", Payments: "¤", Payment: "¤", Engineering: "⚙", Factory: "⚙", Commission: "%", Leads: "◎", Orders: "◆", Access: "⚿" };
    const row = (a, i, cls) => `<details class="att ${cls}"><summary><span class="ai">${ic[a.cat] || "•"}</span><span class="at"><b>${esc(a.title)}</b><span class="tiny muted">${esc(a.cat)}${a.when ? " · " + esc(new Date(a.when).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : ""}</span></span><button class="btn ${cls === "u" ? "lime" : "ghost"} xs" data-al="${i}">${esc(a.action || "Open")}</button></summary><div class="small muted">${esc(a.body || "")}</div></details>`;
    if (!all.length) return `<div class="card att-wrap"><div class="row between"><h3>Needs your attention</h3><span class="pill ok">All clear</span></div></div>`;
    const idx = (a) => al.indexOf(a) >= 0 ? al.indexOf(a) : "r" + rem.indexOf(a);
    return `<div class="card att-wrap"><div class="row between"><h3>Needs your attention</h3><span class="tiny muted">${urgent.length ? `<b class="neg">${urgent.length} urgent</b> · ` : ""}${rest.length} other</span></div>
      ${urgent.map((a) => row(a, idx(a), "u")).join("")}${rest.slice(0, 4).map((a) => row(a, idx(a), "")).join("")}
      ${rest.length > 4 ? `<details class="att-more"><summary class="small">Show all (${rest.length - 4} more)</summary>${rest.slice(4).map((a) => row(a, idx(a), "")).join("")}</details>` : ""}</div>`;
  }
  function alerts(d) {
    const out = [], set = App.config.settings.ceo || {}, big = Math.round((+set.largeQuote || 1000000) * 100), today = new Date().toISOString().slice(0, 10), cur = App.config.pricebook.currency || "EGP";
    const add = (sev, cat, title, body, go, action) => out.push({ sev, cat, title, body, go, action });
    for (const j of d.jobs.filter((x) => x.status !== "cancelled")) {
      if (["delayed", "atrisk"].includes(j.ds.key) || (j.e && ["blocked", "delayed"].includes(j.e.status))) add(j.ds.key === "delayed" || (j.e && j.e.status === "blocked") ? 3 : 2, "Deadline", `${j.name}: ${j.e && j.e.status === "blocked" ? "blocked" : j.ds.label.toLowerCase()}`, `Target ${(j.e && j.e.expectedCompletion) || j.deadlineOriginal || "—"}${j.e && j.e.riskReason ? " · " + j.e.riskReason : ""}${j.engineerUid ? " · " + DPAuth.nameSync(j.engineerUid) : ""}`, { view: "engorders", opts: { oid: j.oid } }, "Open order");
      if (!j.engineerUid) add(Date.now() - Date.parse(j.acceptedAt || 0) > 864e5 ? 3 : 2, "Engineering", `${j.name}: no engineer assigned`, `Accepted ${H.dateS(j.acceptedAt)} — waiting in the engineering queue`, { view: "engqueue" }, "Assign engineer");
      else if (!(j.e && j.e.factory && j.e.factory.dest) && !(j.e && j.e.status === "completed") && Date.now() - Date.parse(j.acceptedAt || 0) > 2 * 864e5) add(2, "Factory", `${j.name}: no manufacturing or outsourcing assignment`, `Engineer ${DPAuth.nameSync(j.engineerUid)} has not assigned production yet`, { view: "factory", opts: { dest: "none" } }, "Open Factory");
      if (j.e && j.e.qc && j.e.qc.status === "failed") add(3, "Quality", `${j.name}: quality check failed`, (j.e.qc.checklist || []).filter((c) => !c.ok).map((c) => c.item).slice(0, 2).join(" · "), { view: "engorders", opts: { oid: j.oid } }, "Review");
      if (j.ds.missing && j.status !== "cancelled") add(1, "Records", `${j.name}: no project deadline recorded`, "Information missing — not a confirmed delay", { view: "engorders", opts: { oid: j.oid } }, "Set deadline");
    }
    if (root.DPAskCeo && DPAskCeo.canReadInbox()) for (const t of (DPAskCeo.S.threads || []).filter((x) => x.unread)) add(2, "Ask CEO", `${t.name}: ${t.unread} unread question${t.unread === 1 ? "" : "s"}`, (t.last.text || "Attachment").slice(0, 90), { view: "askceo", opts: { uid: t.uid } }, "Reply");
    for (const r of d.rows) {
      if (r.pay && r.pay.overpaidMinor > 0) add(3, "Payments", `${r.p.name}: overpayment to review`, `Verified ${H.money(r.pay.verifiedMinor, r.cur)} against an order value of ${H.money(r.pay.payableMinor, r.cur)}`, { view: "register", opts: { oid: r.oid } }, "Review");
      if (r.overdue > 0) add(3, "Payments", `${r.p.name}: customer payment overdue`, `${H.money(r.overdue, r.cur)} past due by the payment schedule · ${DPAuth.nameSync(r.ownerId) || ""}`, { view: "register", opts: { oid: r.oid } }, "Open order");
      if (r.custKey === "issued" && (r.total || 0) >= big && Date.now() - Date.parse(r.p.issuedAt || 0) > 7 * 864e5) add(2, "Quotations", `${r.p.name}: large quotation awaiting the client`, `${H.money(r.total, r.cur)} issued ${H.dateS(r.p.issuedAt)} by ${DPAuth.nameSync(r.ownerId) || "—"}`, { view: "register", opts: { pid: r.p.id, owner: r.ownerId } }, "Open");
      if (r.order) for (const p of (r.order.payments || []).filter((x) => x.status === "recorded")) add(2, "Payments", `${r.p.name}: payment awaiting verification`, `${H.money2(p.amountMinor, r.cur)} on ${p.date}${(p.files || []).length ? "" : " · no payment evidence attached"}`, { view: "payverify" }, "Verify");
      for (const x of r.reps.filter((y) => y.status === "submitted")) add(2, "Payments", `${r.p.name}: payment reported by sales`, `${H.money2(x.amountMinor, r.cur)} on ${x.date}${x.hasFile ? "" : " · no evidence attached"}`, { view: "payverify" }, "Verify");
      if (r.order && r.order.valueCheck) add(2, "Records", `${r.p.name}: booked value differs from the accepted quotation`, `Quotation ${H.money(r.order.valueCheck.quotedTotalMinor, r.cur)} · price book now ${H.money(r.order.valueCheck.bookedTotalMinor, r.cur)}`, { view: "register", opts: { oid: r.oid } }, "Check");
      if (r.accepted && !r.cancelled && r.sub && !r.sched.length && !(r.order && (r.order.payments || []).length) && !r.reps.length) add(1, "Records", `${r.p.name}: no payment schedule or payment recorded`, `Accepted ${H.dateS(r.sub.acceptedAt)}`, { view: "register", opts: { oid: r.oid } }, "Open");
    }
    const waiting = d.comms.filter((c) => ["calculated", "pending", "returned"].includes(c.status));
    if (waiting.length) add(2, "Commission", `${waiting.length} commission${waiting.length === 1 ? "" : "s"} awaiting approval`, `${H.money(waiting.reduce((a, c) => a + (c.calculatedMinor || 0), 0), cur)} calculated`, { view: "approvecomm" }, "Approve");
    const dirById = Object.fromEntries(d.dir.map((r) => [r.uid, r]));
    for (const uid of Object.keys(dirById)) {
      const over = DPLeadOps.followUps(uid).filter((f) => f.when === "overdue");
      if (over.length) add(over.length > 3 ? 3 : 2, "Follow-ups", `${DPAuth.fullName(dirById[uid])}: ${over.length} follow-up${over.length === 1 ? "" : "s"} overdue`, over.slice(0, 2).map((f) => ((d.leads.find((l) => l.id === f.leadId) || {}).name || "") + " · " + new Date(f.followUpAt).toLocaleDateString()).join(" · "), { view: "allleads" }, "Review leads");
    }
    for (const l of d.leads) { const own = DPLeads.ownership(l, d.claims[l.id] || []); if (own.owner && own.deadline && Date.parse(own.deadline) - Date.now() < 6 * 3600e3) add(1, "Leads", `${l.name}: no meaningful activity`, `Owner ${DPAuth.nameSync(own.owner)} · returns to the Lead Mine ${DPLeadOps.fmtRemaining(Date.parse(own.deadline) - Date.now()).replace(" left", "")}`, { view: "allleads" }, "Open"); }
    void today; return out.sort((a, b) => b.sev - a.sev);
  }

  /* ---------------- CEO Control Center ---------------- */
  async function renderCeo() {
    const V = $("#view-dash"), me = U.me(), pic = await H.picHtml(me.id, 64, "ring2");
    V.innerHTML = `<div class="page" style="max-width:1500px"><div class="phead"><div class="hello">${pic}<div><span class="eyebrow">CEO Control Center · ${esc(new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))}</span><h1>Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, <em>${esc(me.firstName || "")}</em>.</h1><p class="lead small" id="ceo-sum">Loading the company…</p></div></div>
      <div class="row"><div class="seg" role="group" aria-label="Period">${Object.entries(PERIODS).map(([k, l]) => `<button type="button" data-per="${k}" class="${D.per === k ? "is-on" : ""}">${l}</button>`).join("")}</div><button class="btn ghost sm" id="ceo-mine">My sales view</button></div></div>
      <div id="ceo-body"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $$("[data-per]", V).forEach((b) => (b.onclick = () => { D.per = b.dataset.per; renderCeo(); }));
    $("#ceo-mine").onclick = () => U.go("dash", { mine: true });
    if (root.DPAskCeo && DPAskCeo.canReadInbox()) await DPAskCeo.threads().catch(() => []);
    let d; try { d = await data(); } catch (e) { $("#ceo-body").innerHTML = `<div class="note err">Company data could not be loaded (${esc(e.message || e.code)}).</div>`; return; }
    const cur = App.config.pricebook.currency || "EGP", r = range(D.per), al = alerts(d), today = new Date().toISOString().slice(0, 10);
    const live = d.rows.filter((x) => x.accepted && !x.cancelled), accIn = live.filter((x) => inR((x.sub && x.sub.acceptedAt) || (x.order && x.order.approvedAt), r));
    const issuedIn = d.rows.filter((x) => inR(x.p.issuedAt, r)), rejectedIn = d.rows.filter((x) => ["lost", "rejected"].includes(x.custKey) && inR((x.sub && x.sub.at) || x.p.savedAt, r)), awaiting = d.rows.filter((x) => x.custKey === "issued");
    const sum = (l, f) => l.reduce((a, x) => a + (f(x) || 0), 0);
    const signed = sum(live, (x) => x.total), collected = sum(live, (x) => x.verified), pending = sum(live, (x) => x.pending), overdue = sum(live, (x) => x.overdue);
    const fin = live.filter((x) => x.order), gp = (o) => (o.costMinor == null ? null : o.afterDiscountMinor - o.costMinor);
    const estGP = sum(fin, (x) => gp(x.order)), estRev = sum(fin.filter((x) => x.order.costMinor != null), (x) => x.order.afterDiscountMinor), noCost = fin.filter((x) => x.order.costMinor == null).length;
    const realised = fin.filter((x) => x.job && x.job.e && x.job.e.status === "completed" && x.pay && x.pay.fullyPaid), realGP = sum(realised, (x) => gp(x.order));
    const disc = sum(fin.filter((x) => inR(x.order.approvedAt, r)), (x) => x.order.discountMinor);
    const comApproved = d.comms.filter((c) => c.approvedMinor != null && !["cancelled", "reversed"].includes(c.status)).reduce((a, c) => a + DPSales.owedMinor(c), 0), comPaid = d.comms.reduce((a, c) => a + DPSales.paidMinor(c), 0);
    const upcoming = live.flatMap((x) => DPUI.scheduleRows(x).filter((s) => s.st[0] !== "Paid" && s.due >= today && s.due <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)).map((s) => Object.assign({ x }, s))).sort((a, b) => a.due.localeCompare(b.due));
    const stage = (k) => live.filter((x) => (DPUI.orderStage(x) || [])[2] === k);
    const conv = issuedIn.length ? accIn.length / issuedIn.length : null, aov = accIn.length ? sum(accIn, (x) => x.total) / accIn.length : null;
    const sales = d.dir.filter((x) => x.uid && x.active !== false && DPAuth.isSalesRole(x.role)), roles = {}; d.dir.filter((x) => x.uid && x.active !== false).forEach((x) => { const b = DPAuth.baseOf(x.role); roles[b] = (roles[b] || 0) + 1; });
    const perNow = H.curPer(), q0 = Math.floor(new Date().getMonth() / 3) * 3, qPers = [0, 1, 2].map((i) => new Date(new Date().getFullYear(), q0 + i, 15).toISOString().slice(0, 7));
    const empRows = sales.map((s) => { const mine = live.filter((x) => x.ownerId === s.uid), m = mine.filter((x) => DPSales.inPer((x.sub && x.sub.acceptedAt) || (x.order && x.order.approvedAt), perNow)), q = mine.filter((x) => qPers.includes(String((x.sub && x.sub.acceptedAt) || (x.order && x.order.approvedAt) || "").slice(0, 7)));
      const elig = (x) => (x.order ? x.order.eligibleMinor : x.sub && x.sub.base ? x.sub.base.eligibleMinor : 0), tM = DPSales.targetFor(d.staffs[s.uid], perNow, App.config.settings) * 100, tQ = qPers.reduce((a, p) => a + DPSales.targetFor(d.staffs[s.uid], p, App.config.settings) * 100, 0);
      const cl = Object.values(d.claims).flat().filter((c) => c.uid === s.uid).length, fo = DPLeadOps.followUps(s.uid).filter((f) => f.when === "overdue").length, acts = DPLeadOps.LT.acts.filter((a) => a.uid === s.uid && inR(a.at, range("week"))).length;
      return { s, m: sum(m, elig), tM, q: sum(q, elig), tQ, n: m.length, issued: d.rows.filter((x) => x.ownerId === s.uid && DPSales.inPer(x.p.issuedAt, perNow)).length, cl, fo, acts }; }).sort((a, b) => b.m - a.m);
    const eng = d.dir.filter((x) => x.uid && x.active !== false && DPAuth.baseOf(x.role) === "engineer").map((e) => ({ e, open: d.jobs.filter((j) => j.engineerUid === e.uid && !(j.e && j.e.status === "completed") && j.status !== "cancelled").length, late: d.jobs.filter((j) => j.engineerUid === e.uid && ["delayed", "atrisk"].includes(j.ds.key)).length }));
    const wAct = d.workers.filter((w) => w.active !== false), wAlloc = wAct.filter((w) => (w.assignments || []).some((s) => !s.removedAt));
    $("#ceo-sum").textContent = `${al.filter((a) => a.sev >= 3).length} urgent and ${al.filter((a) => a.sev === 2).length} important item${al.length === 1 ? "" : "s"} · ${PERIODS[D.per].toLowerCase()}: ${accIn.length} order${accIn.length === 1 ? "" : "s"} signed, ${H.money(sum(accIn, (x) => x.total), cur)}.`;
    const card = (go, label, val, sub, cls = "") => `<button type="button" class="kcard ${cls}" data-go='${esc(JSON.stringify(go))}'><span class="eyebrow">${esc(label)}</span><b class="num">${val}</b><span class="tiny">${sub}</span></button>`;
    const cats = [...new Set(al.map((a) => a.cat))];
    $("#ceo-body").innerHTML = `<div class="stack">
      ${attention(al)}
      <h3 class="sect-h">Sales &amp; revenue · ${esc(PERIODS[D.per])}</h3>
      <div class="kcards">${card({ view: "register", opts: { filter: "accepted" } }, "Signed orders", accIn.length, esc(H.money(sum(accIn, (x) => x.total), cur)) + " contract value")}${card({ view: "register", opts: { filter: "issued" } }, "Quotations issued", issuedIn.length, `${accIn.length} accepted · ${rejectedIn.length} rejected · ${awaiting.length} awaiting`)}
        ${card({ view: "register", opts: { filter: "issued" } }, "Pipeline value", esc(H.money(sum(awaiting, (x) => x.total), cur)), `${awaiting.length} quotations awaiting the client`)}${card({ view: "reports" }, "Conversion", conv == null ? "—" : Math.round(conv * 100) + "%", "accepted ÷ issued in the period")}
        ${card({ view: "register" }, "Average order value", aov == null ? "—" : esc(H.money(aov, cur)), "orders signed in the period")}${card({ view: "register", opts: { filter: "accepted" } }, "Order pipeline", live.length, `${stage("accepted").length + stage("review").length} awaiting engineering · ${stage("production").length} in production · ${stage("ready").length} ready · ${stage("installing").length} installing · ${stage("completed").length} completed`)}</div>
      <details class="xsect" data-k="ceo.fin"${!root.DPX || DPX.openOf("ceo.fin", true) ? " open" : ""}><summary><h3>Financial control</h3><span class="xs-sum">Signed ${esc(H.money(signed, cur))} · collected ${esc(H.money(collected, cur))} · outstanding ${esc(H.money(Math.max(0, signed - collected), cur))}${overdue ? " · overdue " + esc(H.money(overdue, cur)) : ""}</span></summary><div class="stack">
      <p class="tiny muted">All open orders.</p>
      <div class="kcards">${card({ view: "register", opts: { filter: "accepted" } }, "Signed contract value", esc(H.money(signed, cur)), "accepted orders, incl. VAT")}${card({ view: "invoices" }, "Invoiced", d.invoiced == null ? "—" : esc(H.money(d.invoiced, cur)), "issued tax invoices − credit notes (Finance)")}
        ${card({ view: "approvals" }, "Collected cash", esc(H.money(collected, cur)), "verified payments only")}${card({ view: "payverify" }, "Pending verification", esc(H.money(pending, cur)), "recorded, not yet verified", pending ? "warn" : "")}
        ${card({ view: "register", opts: { filter: "unpaid" } }, "Outstanding receivables", esc(H.money(Math.max(0, signed - collected), cur)), overdue ? esc(H.money(overdue, cur)) + " overdue by schedule" : "none overdue", overdue ? "bad" : "")}
        ${card({ view: "reports" }, "Estimated gross profit", esc(H.money(estGP, cur)), estRev ? `margin ${Math.round(estGP / estRev * 100)}%${noCost ? ` · ${noCost} order(s) without cost data excluded` : ""}` : "no cost data yet")}
        ${card({ view: "reports" }, "Realised gross profit", esc(H.money(realGP, cur)), `${realised.length} completed and fully collected order(s)`)}${card({ view: "approvecomm" }, "Commission approved vs paid", esc(H.money(comApproved, cur)), esc(H.money(comPaid, cur)) + " paid")}
        ${card({ view: "reports" }, "Discounts granted", esc(H.money(disc, cur)), `on orders booked ${PERIODS[D.per].toLowerCase()}`)}${card({ view: "register" }, "Actual project costs", "Not recorded", "only product cost at booking is known")}</div>
      <p class="tiny muted">Gross profit is not net profit: overheads, salaries and other operating costs are not allocated. Collected cash counts only payments an administrator verified.</p></div></details>
      <div class="dgrid"><div class="card stack"><div class="row between"><h3>Sales by employee</h3><button class="btn ghost xs" data-go='${esc(JSON.stringify({ view: "employees" }))}'>Employees</button></div>
          <div class="tablewrap"><table class="mtable"><thead><tr><th>Employee</th><th class="r">Month vs target</th><th class="r">Quarter vs target</th><th class="r">Deals</th><th class="r">Issued</th><th class="r">Leads</th><th class="r">Overdue f-ups</th><th class="r">Activities (wk)</th></tr></thead><tbody>
          ${empRows.map((x) => `<tr class="click" data-emp="${esc(x.s.uid)}"><td><b>${esc(DPAuth.fullName(x.s))}</b></td><td class="r">${esc(H.money(x.m, cur))}<div class="tiny muted">${x.tM ? Math.round(x.m / x.tM * 100) : 0}% of ${esc(H.money(x.tM, cur))}</div></td><td class="r">${esc(H.money(x.q, cur))}<div class="tiny muted">${x.tQ ? Math.round(x.q / x.tQ * 100) : 0}%</div></td><td class="r">${x.n}</td><td class="r">${x.issued}</td><td class="r">${x.cl}</td><td class="r">${x.fo ? `<span class="pill err">${x.fo}</span>` : 0}</td><td class="r">${x.acts}</td></tr>`).join("") || `<tr><td colspan="8"><div class="empty small">No sales staff yet.</div></td></tr>`}</tbody></table></div></div>
        <div class="card stack"><h3>Upcoming expected payments (30 days)</h3>${upcoming.length ? `<div class="tl">${upcoming.slice(0, 10).map((u) => `<div><span class="small"><b>${esc(u.due)}</b></span><span><button class="linkbtn" data-oid="${esc(u.x.oid)}">${esc(u.x.p.name)}</button> — ${esc(u.label)} · <b class="num">${esc(H.money2(u.amountMinor, u.x.cur))}</b> <span class="pill ${u.st[1]}">${esc(u.st[0])}</span></span></div>`).join("")}</div>` : `<p class="small muted">No scheduled payments in the next 30 days.</p>`}
          <h3>Recent closed deals</h3>${live.length ? `<div class="tl">${live.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6).map((x) => `<div><span class="tiny muted">${esc(H.dateS(x.date))}</span><span><button class="linkbtn" data-oid="${esc(x.oid)}">${esc(x.p.name)}</button> · ${esc(H.money(x.total || 0, x.cur))} · ${esc(DPAuth.nameSync(x.ownerId) || "")}</span></div>`).join("")}</div>` : `<p class="small muted">None yet.</p>`}
          <h3>High-value opportunities</h3>${awaiting.length ? `<div class="tl">${awaiting.slice().sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 5).map((x) => `<div><span class="small num">${esc(H.money(x.total || 0, x.cur))}</span><span><button class="linkbtn" data-pid="${esc(x.p.id)}" data-owner="${esc(x.ownerId)}">${esc(x.p.name)}</button> · issued ${esc(H.dateS(x.p.issuedAt))} · ${esc(DPAuth.nameSync(x.ownerId) || "")}</span></div>`).join("")}</div>` : `<p class="small muted">No open quotations.</p>`}</div></div>
      <details class="xsect" data-k="ceo.ops"${!root.DPX || DPX.openOf("ceo.ops", false) ? " open" : ""}><summary><h3>People &amp; operations</h3><span class="xs-sum">${d.dir.filter((x) => x.uid && x.active !== false).length} active people · ${wAlloc.length} workers on projects · ${eng.reduce((a, x) => a + x.open, 0)} open engineering orders</span></summary><div class="stack">
      <div class="kcards">${["admin", "employee", "engineer", "dataentry"].map((b) => card({ view: "users" }, ({ admin: "Administrators", employee: "Sales", engineer: "Engineers", dataentry: "Data entry" })[b], roles[b] || 0, "active")).join("")}
        ${card({ view: "factory" }, "Workers on projects", wAlloc.length, `${wAct.length - wAlloc.length} of ${wAct.length} available`)}${card({ view: "engqueue" }, "Delayed or blocked", d.jobs.filter((j) => j.status !== "cancelled" && (["delayed"].includes(j.ds.key) || (j.e && ["blocked", "hold", "delayed"].includes(j.e.status)))).length, "orders", "")}</div>
      <div class="dgrid"><div class="card stack"><h3>Engineering workload</h3>${eng.length ? `<div class="tl">${eng.map((x) => `<div><span class="small"><b>${esc(DPAuth.fullName(x.e))}</b></span><span>${x.open} open order${x.open === 1 ? "" : "s"}${x.late ? ` · <span class="pill err">${x.late} at risk / delayed</span>` : ""}</span></div>`).join("")}</div>` : `<p class="small muted">No engineers yet.</p>`}</div>
        <div class="card stack"><div class="row between"><h3>Recent system activity</h3><button class="btn ghost xs" data-go='${esc(JSON.stringify({ view: "audit" }))}'>Audit Log</button></div>${d.log.length ? `<div class="tl">${d.log.slice(0, 8).map((e) => `<div><span class="tiny muted">${esc(new Date(e.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }))}</span><span><b>${esc(e.action)}</b> — ${esc(DPAuth.nameSync(e.by) || "system")}${e.detail ? " · " + esc(String(e.detail).slice(0, 90)) : ""}</span></div>`).join("")}</div>` : `<p class="small muted">Nothing yet.</p>`}</div></div></div></details></div>`;
    const B = $("#ceo-body"), vis = al.filter((a) => !D.ac || a.cat === D.ac);
    $$("[data-ac]", B).forEach((b) => (b.onclick = () => { D.ac = b.dataset.ac; renderCeo(); }));
    $$("[data-al]", B).forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const k = b.dataset.al; if (k[0] === "r") return U.go("reminders"); const a = al[+k]; if (a && a.go) U.go(a.go.view, a.go.opts || {}); }));
    $$("[data-go]", B).forEach((b) => (b.onclick = () => { const g = JSON.parse(b.dataset.go); U.go(g.view, g.opts || {}); }));
    $$("[data-oid]", B).forEach((b) => (b.onclick = () => U.go("register", { oid: b.dataset.oid })));
    $$("[data-pid]", B).forEach((b) => (b.onclick = () => U.go("register", { pid: b.dataset.pid, owner: b.dataset.owner })));
    $$("[data-emp]", B).forEach((tr) => (tr.onclick = () => U.go("employees", { uid: tr.dataset.emp })));
  }

  /* ---------------- Approve Commission ---------------- */
  async function renderApproveComm() {
    const V = $("#view-approvecomm");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Approve <em>Commission</em></h1><p class="lead small">Each order's commission is calculated automatically. Approve the calculated amount with one click, or enter an adjusted amount with a reason. Approval is not payment: record the payout separately, with its proof.</p></div></div>
      <div class="filters"><div class="seg">${[["open", "Awaiting approval"], ["approved", "Approved, unpaid"], ["paid", "Paid"], ["all", "All"]].map(([k, l]) => `<button type="button" data-cs="${k}" class="${D.acSt === k ? "is-on" : ""}">${l}</button>`).join("")}</div></div><div id="ac-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $$("[data-cs]", V).forEach((b) => (b.onclick = () => { D.acSt = b.dataset.cs; renderApproveComm(); }));
    await O.intake().catch(() => {});
    const [recs, cfg, creqs] = await Promise.all([DPSales.allCommissions(), DPSales.commissionConfig(), DPSales.allCollectRequests().catch(() => [])]), rule = DPSales.currentRule(cfg);
    const reqOf = (r) => creqs.find((q) => q.oid === r.oid && q.uid === r.uid);
    const pass = (r) => D.acSt === "all" || (D.acSt === "open" ? ["calculated", "pending", "returned"].includes(r.status) : D.acSt === "approved" ? r.status === "approved" : r.status === "paid");
    const rows = recs.filter(pass).sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt))), calc = (r) => (r.calculatedMinor != null ? r.calculatedMinor : r.amountMinor), adj = (r) => (r.adjustments || []).reduce((a, x) => a + x.amountMinor, 0);
    $("#ac-body").innerHTML = `<div class="stack"><div class="note small"><b>Current rule ${esc(rule.id)}</b> — ${esc(C.BASIS_LABEL[rule.method] || rule.method)}: below 500,000 0% · 500,000–999,999 3% · 1,000,000–2,999,999 5% · 3,000,000+ 7%. Change it in Commission Rules.</div>
      <div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>Employee</th><th>Order</th><th class="r">Eligible value</th><th class="r">Rate · basis</th><th class="r">Calculated</th><th class="r">Adjustments</th><th class="r">Approved</th><th>Approval</th><th>Payment</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const paid = DPSales.paidMinor(r), owed = DPSales.owedMinor(r); return `<tr><td class="small"><b>${esc(DPAuth.nameSync(r.uid) || "—")}</b></td><td><b>${esc(r.name)}</b><div class="tiny muted">${esc(r.oid)} · ${esc(H.dateS(r.approvedAt))}</div></td><td class="r num">${esc(H.money2(r.eligibleMinor, r.currency))}</td>
        <td class="r small">${r.method === "whole" && r.rateBp != null ? C.pct(r.rateBp) : C.pct(Math.round(r.effectiveBp || 0)) + " eff."}<div class="tiny muted">${esc(r.method === "whole" ? "whole-order" : "marginal")} · ${esc(r.ruleId)}</div></td><td class="r num">${esc(H.money2(calc(r), r.currency))}</td><td class="r num">${adj(r) ? esc(H.money2(adj(r), r.currency)) : "—"}</td><td class="r num"><b>${r.approvedMinor == null ? "—" : esc(H.money2(owed, r.currency))}</b></td>
        <td><span class="pill ${{ calculated: "", pending: "warn", returned: "warn", approved: "info", paid: "ok", cancelled: "err", reversed: "err" }[r.status] || ""}">${esc(C.STATUS_LABEL[r.status] || r.status)}</span>${reqOf(r) ? `<div class="tiny"><span class="pill warn">Collection requested ${esc(H.dateS(reqOf(r).lastAt))}</span></div>` : ""}${r.salaryCycle ? `<div class="tiny muted">${esc(DPPay.cycleLabel(r.salaryCycle))}</div>` : ""}</td>
        <td class="small">${paid ? `${esc(H.money2(paid, r.currency))} paid` : r.approvedMinor != null ? "Not paid" : "—"}${(r.payouts || []).filter((p) => p.proof).map((p) => ` <button class="btn ghost xs" data-pp="${esc(r.oid)}" data-pu="${esc(r.uid)}" data-po="${esc(p.id)}" title="View commission payout proof">${U.svg("eye")}</button>`).join("")}</td>
        <td style="white-space:nowrap">${["calculated", "pending", "returned"].includes(r.status) ? `<button class="btn lime xs" data-ok="${esc(r.oid)}" data-u="${esc(r.uid)}">Approve ${esc(H.money(calc(r), r.currency))}</button> <button class="btn ghost xs" data-adj="${esc(r.oid)}" data-u="${esc(r.uid)}">Adjust…</button>` : r.status === "approved" ? `<button class="btn xs" data-pay="${esc(r.oid)}" data-u="${esc(r.uid)}">Record payout…</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="10"><div class="empty small">Nothing here.</div></td></tr>`}</tbody></table></div></div></div>`;
    const find = (b) => recs.find((x) => x.oid === b.dataset.ok || x.oid === b.dataset.adj || x.oid === b.dataset.pay || x.oid === b.dataset.pp ? x.uid === (b.dataset.u || b.dataset.pu) : false);
    $$("[data-ok]", V).forEach((b) => (b.onclick = async () => { const r = find(b); if (!(await U.ask("Approve commission?", `<p>${esc(DPAuth.nameSync(r.uid))} · ${esc(r.name)}</p><div class="kv"><span>Eligible value</span><b>${esc(H.money2(r.eligibleMinor, r.currency))}</b><span>Calculated commission</span><b>${esc(H.money2(calc(r), r.currency))}</b></div><p class="small muted">Approval records the exact amount, your name and the time. It does not pay anything.</p>`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Approve " + H.money2(calc(r), r.currency), value: true }]))) return;
      try { await DPSales.approveCommission(r.uid, r.oid, { reason: "" }); U.toast("Commission approved."); renderApproveComm(); } catch (e) { U.toast(e.message, { err: true }); } }));
    $$("[data-adj]", V).forEach((b) => (b.onclick = async () => { const r = find(b); const f = await U.form("Approve an adjusted amount", [{ id: "a", label: `Approved amount (${r.currency}) — calculated ${(calc(r) / 100).toFixed(2)}`, type: "number", step: "0.01", min: 0, value: (calc(r) / 100).toFixed(2), required: true }, { id: "why", label: "Reason for the difference", type: "textarea", required: true }], { submit: "Approve", intro: "The calculated amount stays on record; the difference and your reason are audited and shown to the employee." });
      if (!f) return; try { await DPSales.approveCommission(r.uid, r.oid, { amountMinor: Math.round(f.a * 100), reason: f.why }); U.toast("Approved."); renderApproveComm(); } catch (e) { U.toast(e.message, { err: true }); } }));
    $$("[data-pay]", V).forEach((b) => (b.onclick = () => payoutDialog(find(b), renderApproveComm)));
    $$("[data-pp]", V).forEach((b) => (b.onclick = async () => DPUI.showFile(await DPSales.payoutProof(b.dataset.pu, b.dataset.pp, b.dataset.po), "Commission payout proof")));
  }
  /** Commission payout with its own proof (kept on the employee's commission record — never with customer payment evidence). */
  function payoutDialog(r, done) {
    // 1.2: when Finance accounts exist, a commission payout is a ledger transaction (approval already given by the
    // commission approval; payment recorded with proof, then verified — the payout is written on verification).
    if (root.DPFin && DPFin.isFin()) return DPFin.accounts().then((A) => { const L = Object.values(A).filter((a) => a.status !== "closed" && a.currency === (r.currency || "EGP")); if (!L.length) return legacyPayout(r, done);
      const due = Math.max(0, DPSales.owedMinor(r) - DPSales.paidMinor(r));
      return U.form("Pay commission through Transfers", [{ id: "acc", label: "Paid from *", type: "select", options: L.map((a) => ({ value: a.id, label: a.name })) }, { id: "meth", label: "Method", type: "select", value: "Bank transfer", options: DPFinCalc.METHODS.map((x) => ({ value: x, label: x })) },
        { id: "amt", label: `Amount (${r.currency || "EGP"})`, type: "number", step: "0.01", value: (due / 100).toFixed(2) }, { id: "d", label: "Date", type: "date", value: new Date().toISOString().slice(0, 10) }], { submit: "Create payout", intro: `${esc(DPAuth.nameSync(r.uid))} · ${esc(r.name)} · outstanding ${esc(H.money2(due, r.currency))}. The payout is created as a Commission transfer; attach the proof and verify it in Transfers — the commission record is then marked paid.` })
        .then(async (f) => { if (!f) return; try { const t = await DPFin.payCommission(r.uid, r.oid, { account: f.acc, method: f.meth, date: f.d, amountMinor: Math.round(+f.amt * 100) }); U.toast(`Payout ${t.ref} created.`); U.go("transfers", { ref: t.ref }); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); } }); });
    return legacyPayout(r, done);
  }
  function legacyPayout(r, done) {
    const due = Math.max(0, DPSales.owedMinor(r) - DPSales.paidMinor(r)); let proof = null;
    U.openModal(`<h2>Record commission payout</h2><p class="small muted">${esc(DPAuth.nameSync(r.uid))} · ${esc(r.name)} · outstanding ${esc(H.money2(due, r.currency))}</p>
      <div class="grid3"><label class="field"><span>Payment date *</span><input class="in" type="date" id="po-d" value="${new Date().toISOString().slice(0, 10)}"></label><label class="field"><span>Amount (${esc(r.currency)}) *</span><input class="in num" type="number" step="0.01" min="0" id="po-a" value="${(due / 100).toFixed(2)}"></label><label class="field"><span>Payroll / transfer reference</span><input class="in" id="po-r"></label></div>
      <div class="field"><span class="lbl">Commission payout proof (payslip, transfer receipt — JPG, PNG, WebP or PDF)</span><div class="row"><span class="small" id="po-f">No file</span><button type="button" class="btn ghost sm" id="po-b">${U.svg("clip")} Attach…</button></div><small>Stored on the employee's commission record. It is never shown as, or mixed with, customer payment evidence.</small></div>
      <p class="small" id="po-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="po-x">Cancel</button><button class="btn lime" id="po-ok">Record payout</button></div>`, (m) => {
      $("#po-b", m).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { try { proof = await O.prepareFile(f); $("#po-f", m).textContent = proof.name; } catch (e) { $("#po-err", m).textContent = e.message; } });
      $("#po-x", m).onclick = () => U.closeModal();
      $("#po-ok", m).onclick = async () => { const btn = $("#po-ok", m); btn.disabled = true; try { await DPSales.markPaid(r.uid, r.oid, { date: $("#po-d", m).value, ref: $("#po-r", m).value.trim(), amountMinor: Math.round(+$("#po-a", m).value * 100), proof }); U.closeModal(); U.toast("Payout recorded. The employee is notified."); done && done(); } catch (e) { $("#po-err", m).textContent = e.message; btn.disabled = false; } };
    }, { wide: true });
  }

  /* ---------------- Audit Log ---------------- */
  async function renderAudit() {
    const V = $("#view-audit");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Audit <em>Log</em></h1><p class="lead small">Who did what, to which record, and when — administrator actions, order and payment history, commission decisions, engineering changes, lead ownership and edits to call logs.</p></div><div class="row"><button class="btn ghost sm" id="au-csv">${U.svg("export")} Export CSV</button></div></div>
      <div class="filters"><div class="search" style="width:280px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="au-q" placeholder="Search action, record, detail" value="${esc(D.aq)}"></div><select class="in sm" id="au-w"><option value="">Everyone</option>${DPAuth.A.directory.filter((r) => r.uid).map((r) => `<option value="${esc(r.uid)}"${D.aw === r.uid ? " selected" : ""}>${esc(DPAuth.fullName(r))}</option>`).join("")}</select></div>
      <div class="card" style="padding:0"><div class="tablewrap" id="au-list"><div class="empty"><div class="spinner"></div></div></div></div></div>`;
    const [logs, orders, comms, jobs, leads] = await Promise.all([DPStore.tryList("adminlog"), DPSales.listOrders(), DPSales.allCommissions(), O.listJobs(), DPLeads.listLeads(), DPLeadOps.loadActs()]);
    const ev = [];
    for (const x of logs) for (const e of x.data.entries || []) ev.push({ at: e.at, by: e.by, area: "Administration", action: e.action, rec: e.target, detail: [e.detail, e.reason && "reason: " + e.reason].filter(Boolean).join(" · ") });
    for (const o of orders) { for (const h of o.history || []) ev.push({ at: h.at, by: h.by, area: "Order", action: h.action, rec: o.oid, detail: h.detail || "" }); for (const p of o.payments || []) ev.push({ at: p.at, by: p.by, area: "Payment", action: `Payment ${p.status}`, rec: o.oid, detail: `${p.date} · ${(p.amountMinor / 100).toFixed(2)} ${o.currency} · ${p.method || ""} ${p.ref || ""}${p.verifiedBy ? " · verified by " + DPAuth.nameSync(p.verifiedBy) : ""}` }); }
    for (const c of comms) { for (const h of c.statusHistory || []) ev.push({ at: h.at, by: h.by, area: "Commission", action: C.STATUS_LABEL[h.status] || h.status, rec: c.oid, detail: `${DPAuth.nameSync(c.uid)} · ${h.note || ""}` }); for (const a of c.approvals || []) ev.push({ at: a.at, by: a.by, area: "Commission", action: "Approved amount", rec: c.oid, detail: `calculated ${(a.calculatedMinor / 100).toFixed(2)} → approved ${(a.approvedMinor / 100).toFixed(2)}${a.reason ? " · " + a.reason : ""}` }); for (const p of c.payouts || []) ev.push({ at: p.at, by: p.by, area: "Commission", action: "Payout", rec: c.oid, detail: `${p.date} · ${(p.amountMinor / 100).toFixed(2)} · ${p.ref || ""}${p.proof ? " · proof attached" : ""}` }); for (const a of c.adjustments || []) ev.push({ at: a.at, by: a.by, area: "Commission", action: "Adjustment", rec: c.oid, detail: `${(a.amountMinor / 100).toFixed(2)} · ${a.reason}` }); }
    for (const j of jobs) { for (const l of (j.e && j.e.log) || []) ev.push({ at: l.at, by: l.by, area: "Engineering", action: l.what, rec: j.oid, detail: l.note || "" }); for (const h of j.history || []) ev.push({ at: h.at, by: h.by, area: "Engineering", action: h.action, rec: j.oid, detail: h.detail || "" }); }
    for (const l of leads) for (const h of l.history || []) ev.push({ at: h.at, by: h.by, area: "Lead", action: h.action, rec: l.name, detail: [h.detail, h.reason].filter(Boolean).join(" · ") });
    for (const a of DPLeadOps.LT.acts) for (const h of a.history || []) ev.push({ at: h.at, by: h.by, area: "Call log", action: "Activity edited", rec: (leads.find((l) => l.id === a.leadId) || {}).name || a.leadId, detail: Object.entries(h.changes || {}).map(([k, v]) => `${k}: ${v[0] == null ? "—" : v[0]} → ${v[1] == null ? "—" : v[1]}`).join("; ") + (h.reason ? " · " + h.reason : "") });
    // 1.2: the server's append-only audit trail (finance and lead entries; administration entries are already listed above)
    for (const x of await DPStore.tryList("audit")) { const e = x.data || {}; if (!["finance", "lead"].includes(e.kind)) continue;
      ev.push({ at: e.at, by: e.by, area: e.kind === "finance" ? "Finance" : "Lead", action: e.action, rec: e.target, detail: [e.detail, e.reason && "reason: " + e.reason, e.before && "before: " + JSON.stringify(e.before), e.after && "after: " + JSON.stringify(e.after)].filter(Boolean).join(" · ").slice(0, 400) }); }
    ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const draw = () => { const q = D.aq.toLowerCase(), rows = ev.filter((e) => (!D.aw || e.by === D.aw) && (!q || [e.area, e.action, e.rec, e.detail].join(" ").toLowerCase().includes(q)));
      $("#au-list").innerHTML = rows.length ? `<table class="mtable"><thead><tr><th>When</th><th>Who</th><th>Area</th><th>Action</th><th>Record</th><th>Detail (before → after where recorded)</th></tr></thead><tbody>${rows.slice(0, 800).map((e) => `<tr><td class="small">${esc(new Date(e.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</td><td class="small">${esc(DPAuth.nameSync(e.by) || (String(e.by || "").startsWith("server") ? "Server sweep" : e.by || "—"))}</td><td class="small">${esc(e.area)}</td><td class="small"><b>${esc(e.action)}</b></td><td class="small">${esc(e.rec || "")}</td><td class="small">${esc(e.detail || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No entries.</div>`;
      $("#au-csv").onclick = () => { const q2 = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`; const csv = ["when,who,area,action,record,detail"].concat(rows.map((e) => [e.at, DPAuth.nameSync(e.by) || e.by, e.area, e.action, e.rec, e.detail].map(q2).join(","))).join("\r\n");
        U.downloadOut({ blob: new Blob(["﻿" + csv], { type: "text/csv" }), filename: `xforce-audit_${new Date().toISOString().slice(0, 10)}.csv` }, "Audit log"); }; };
    $("#au-q").oninput = (e) => { D.aq = e.target.value; draw(); }; $("#au-w").onchange = (e) => { D.aw = e.target.value; draw(); }; draw();
  }

  /* ---------------- Company Search ---------------- */
  async function renderSearch(opts = {}) {
    if (opts.q != null) D.sq = opts.q;
    const V = $("#view-search");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Company <em>search</em></h1><p class="lead small">Customers, leads, quotations, orders, employees and workers in one place.</p></div></div>
      <div class="search" style="max-width:560px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in" id="cs-q" placeholder="Type a name, reference, phone or e-mail" value="${esc(D.sq)}" autofocus></div><div id="cs-out" class="stack" style="margin-top:14px"></div></div>`;
    const [rows, leads, workers] = await Promise.all([DPUI.loadOrderRows({ all: true }).catch(() => []), DPLeads.listLeads(), O.listWorkers().catch(() => [])]);
    const dir = DPAuth.A.directory.filter((r) => r.uid);
    const draw = () => { const q = D.sq.trim().toLowerCase(); const B = $("#cs-out"); if (q.length < 2) { B.innerHTML = `<p class="small muted">Type at least two characters.</p>`; return; }
      const has = (...xs) => xs.join(" ").toLowerCase().includes(q);
      const g = [["Orders & quotations", rows.filter((r) => has(r.p.ref, r.oid, r.p.name, r.p.client, r.p.location)).map((r) => ({ t: `${r.p.ref || ""} ${r.oid ? "· " + r.oid : ""} — ${r.p.name}`, s: [r.p.client, DPAuth.nameSync(r.ownerId)].filter(Boolean).join(" · "), go: r.oid ? ["register", { oid: r.oid }] : ["register", { pid: r.p.id, owner: r.ownerId }] }))],
        ["Customers & leads", leads.filter((l) => has(l.name, l.location, (l.contact || {}).name, (l.contact || {}).phone, (l.contact || {}).email, l.website)).map((l) => ({ t: l.name, s: [DPLeads.ORG_TYPES[l.orgType], l.location, (l.contact || {}).name].filter(Boolean).join(" · "), go: ["allleads", { lead: l.id }] }))],
        ["Employees", dir.filter((r) => has(DPAuth.fullName(r), r.email, r.title, r.department, r.employeeId)).map((r) => ({ t: DPAuth.fullName(r), s: [(DPAuth.roleOf(r.role) || {}).label, r.title, r.department].filter(Boolean).join(" · "), go: ["employees", { uid: r.uid }] }))],
        ["Workers", workers.filter((w) => has(w.name, w.phone, w.wid, w.trade, w.company)).map((w) => ({ t: `${w.name} (${w.wid})`, s: [w.trade, w.phone].filter(Boolean).join(" · "), go: ["workers", {}] }))]];
      B.innerHTML = g.map(([h, l]) => `<div class="card stack"><h3>${esc(h)} <span class="pill">${l.length}</span></h3>${l.length ? `<div class="tl">${l.slice(0, 15).map((x, i) => `<div><span class="small"><button class="linkbtn" data-g="${esc(h)}|${i}">${esc(x.t)}</button></span><span class="small muted">${esc(x.s)}</span></div>`).join("")}</div>` : `<p class="small muted">No matches.</p>`}</div>`).join("");
      $$("[data-g]", B).forEach((b) => (b.onclick = () => { const [h, i] = b.dataset.g.split("|"), x = g.find((y) => y[0] === h)[1][+i]; U.go(x.go[0], x.go[1]); })); };
    $("#cs-q").oninput = (e) => { D.sq = e.target.value; clearTimeout(D.st); D.st = setTimeout(draw, 200); }; draw();
  }

  U.register("approvecomm", renderApproveComm); U.register("audit", renderAudit); U.register("search", renderSearch);
  Object.assign(DPUI, { renderCeo, ceoAlerts: alerts, payoutDialog });
})(typeof self !== "undefined" ? self : this);
