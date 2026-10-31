/* X FORCE 1.2 (Dupedia) — Finance screens (1/2): Finance dashboard, CEO financial overview, approvals inbox, finance
   settings, the Transfers ledger and Financial Accounts with bank reconciliation. Every figure is calculated from stored
   records with DPFinCalc; every tile opens the records behind it. */
/* global DPUI, DPShell, DPStore, DPAuth, DPFin, DPFinCalc, DPSales, DPOrders, DPPay, DPPayUI */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, C = () => root.DPFinCalc, Fn = () => root.DPFin;
  Object.assign(U.ICON, {
    bank: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>', transfer: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
    payroll: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>', receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    tax: '<path d="M5 19L19 5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>', cart: '<path d="M3 4h2l2.5 11h11L21 8H7"/><circle cx="10" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
    finance: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  });
  const m = (v, cur) => esc(H.money2(v || 0, cur || "EGP"));
  const today = () => new Date().toISOString().slice(0, 10);
  const monthStart = (d = new Date()) => d.toISOString().slice(0, 8) + "01";
  const toMinor = (v) => Math.round((+String(v).replace(/,/g, "") || 0) * 100);
  const name = (uid) => (uid ? DPAuth.nameSync(uid) || "—" : "—");
  const ST_PILL = { draft: "", pending_approval: "warn", approved: "", payment_recorded: "warn", awaiting_verification: "warn", verified: "ok", rejected: "err", cancelled: "", prepared: "", partly_paid: "warn", paid: "ok", failed: "err", issued: "ok", received: "ok" };
  const pill = (st, label) => `<span class="pill ${ST_PILL[st] || ""}">${esc(label || C().STATUS[st] || C().PAYROLL_STATUS[st] || st)}</span>`;
  const isAdm = () => U.isAdmin();

  /* ---------------- period picker ---------------- */
  const P = { from: null, to: null, compare: true };
  function periodPresets() {
    const d = new Date(), y = d.getFullYear(), mo = d.getMonth(), iso = (x) => x.toISOString().slice(0, 10);
    const q = Math.floor(mo / 3) * 3;
    return { month: [monthStart(d), today()], last: [iso(new Date(Date.UTC(y, mo - 1, 1))), iso(new Date(Date.UTC(y, mo, 0)))], quarter: [iso(new Date(Date.UTC(y, q, 1))), today()], ytd: [`${y}-01-01`, today()] };
  }
  function periodBar(onChange) {
    if (!P.from) [P.from, P.to] = periodPresets().month;
    return { html: `<div class="row fin-per"><div class="seg" data-pp>${[["month", "This month"], ["last", "Last month"], ["quarter", "This quarter"], ["ytd", "Year to date"]].map(([k, l]) => `<button type="button" data-p="${k}">${l}</button>`).join("")}</div>
      <input class="in sm" type="date" id="fp-from" value="${P.from}" aria-label="From"><span class="tiny muted">to</span><input class="in sm" type="date" id="fp-to" value="${P.to}" aria-label="To">
      <label class="check tiny"><input type="checkbox" id="fp-cmp"${P.compare ? " checked" : ""}> compare with the previous period</label></div>`,
      bind: (box) => { $$("[data-p]", box).forEach((b) => (b.onclick = () => { [P.from, P.to] = periodPresets()[b.dataset.p]; onChange(); }));
        $("#fp-from", box).onchange = (e) => { P.from = e.target.value; onChange(); }; $("#fp-to", box).onchange = (e) => { P.to = e.target.value; onChange(); }; $("#fp-cmp", box).onchange = (e) => { P.compare = e.target.checked; onChange(); }; } };
  }
  function prevPeriod(from, to) { const a = Date.parse(from), b = Date.parse(to), len = b - a + 864e5; return [new Date(a - len).toISOString().slice(0, 10), new Date(a - 864e5).toISOString().slice(0, 10)]; }
  const delta = (cur, prev, goodUp = true) => { if (prev == null || !P.compare) return ""; const d = cur - prev; if (!prev && !cur) return ""; const pct = prev ? Math.round(d / Math.abs(prev) * 100) : null;
    return `<span class="tiny ${d === 0 ? "muted" : (d > 0) === goodUp ? "up" : "down"}">${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${pct != null ? Math.abs(pct) + "%" : H.money2(Math.abs(d), "EGP")} vs previous</span>`; };

  /* ---------------- data for the dashboards ---------------- */
  async function load() {
    const [S, orders, comms, queue, unposted] = await Promise.all([Fn().snapshot(), DPSales.listOrders().catch(() => []), DPSales.allCommissions().catch(() => []), DPPayUI.queue().catch(() => []), Fn().unpostedReceipts().catch(() => [])]);
    return Object.assign(S, { orders, comms, queue, unposted });
  }
  function figures(D, from, to) {
    const cf = C().cashflow(D.txs, { from, to }), E = cf.EGP || { inMinor: 0, outMinor: 0, netMinor: 0, internalMinor: 0, byType: {} }, bt = E.byType;
    const tz = App.config.settings.timezone, sums = D.orders.filter((o) => o.status !== "cancelled").map((o) => ({ o, s: DPPay.summary(o, { tz, settings: App.config.settings }) }));
    const pay = (t) => C().paidStatus(t.totalMinor, D.txs.filter((x) => (x.links || {}).purchase === t.ref));
    const P2 = D.purchases.filter((p) => p.status === "approved").map((p) => ({ p, st: pay(p) }));
    const duesO = D.dues.filter((d) => ["approved", "partly_paid"].includes(d.status)).map((d) => ({ d, st: C().paidStatus(d.amountDueMinor, D.txs.filter((x) => (x.links || {}).wdue === d.id)) }));
    const payrollO = D.payroll.filter((l) => ["approved", "partly_paid"].includes(l.status)).map((l) => ({ l, st: C().paidStatus(l.netMinor, D.txs.filter((x) => (x.links || {}).payroll === l.id)) }));
    const owed = (r) => (r.approvedMinor || 0) + C().sum(r.adjustments || [], (x) => x.amountMinor) - C().sum(r.payouts || [], (x) => x.amountMinor);
    const commPending = D.comms.filter((r) => ["pending", "calculated", "returned"].includes(r.status)), commApproved = D.comms.filter((r) => r.status === "approved" && owed(r) > 0);
    const tsum = C().taxSummary({ invoices: D.docs, purchases: D.purchases, txs: D.txs, rules: D.taxRules, from, to });
    const bal = C().balances(D.accounts, D.txs);
    const k = (types) => C().sum(types, (t) => bt[t] || 0);
    const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    return {
      bal, cash: Object.values(bal).filter((b) => b.currency === "EGP" && b.status !== "closed").reduce((s, b) => s + b.bookMinor, 0),
      inMinor: E.inMinor, outMinor: E.outMinor, netMinor: E.netMinor, internalMinor: E.internalMinor,
      receipts: bt.customer_receipt || 0, awaiting: C().sum(D.queue, (x) => x.amountMinor), awaitingN: D.queue.length,
      receivable: C().sum(sums, (x) => x.s.remainingMinor), overdue: C().sum(sums, (x) => x.s.overdueMinor), overdueN: sums.filter((x) => x.s.overdueMinor > 0).length,
      apPurch: C().sum(P2, (x) => x.st.outstandingMinor), apDues: C().sum(duesO, (x) => x.st.outstandingMinor), apPayroll: C().sum(payrollO, (x) => x.st.outstandingMinor), apComm: C().sum(commApproved, owed),
      upcoming: C().sum(P2.filter((x) => x.p.dueDate && x.p.dueDate <= soon), (x) => x.st.outstandingMinor), upcomingN: P2.filter((x) => x.p.dueDate && x.p.dueDate <= soon && x.st.outstandingMinor > 0).length,
      payrollDue: C().sum(payrollO, (x) => x.st.outstandingMinor) + C().sum(D.payroll.filter((l) => ["prepared", "pending_approval"].includes(l.status)), (l) => l.netMinor),
      commPending: C().sum(commPending, (r) => (r.calculatedMinor != null ? r.calculatedMinor : r.amountMinor) || 0), commPendingN: commPending.length, commApproved: C().sum(commApproved, owed), commApprovedN: commApproved.length,
      opex: k(["expense", "transport", "other_out"]), procurement: k(["supplier", "outsourced", "factory"]), labour: k(["worker_salary", "worker_payment"]), salaries: k(["salary", "commission"]),
      taxLiability: tsum.outstandingMinor, taxPaid: tsum.paidMinor, tsum, sums, P2, duesO, payrollO, commApproved,
    };
  }
  /** Cash-flow FORECAST for the next 30/60/90 days: expected customer milestones vs known obligations. Not a promise. */
  function forecast(D, F) {
    const horizon = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10), out = {};
    for (const d of [30, 60, 90]) { const h = horizon(d);
      const inn = C().sum(F.sums, (x) => C().sum((x.s.milestones || []).filter((mm) => mm.remainingMinor > 0 && mm.due && mm.due <= h), (mm) => mm.remainingMinor));
      const outp = C().sum(F.P2.filter((x) => !x.p.dueDate || x.p.dueDate <= h), (x) => x.st.outstandingMinor) + F.apDues + F.apPayroll + F.apComm + C().sum(D.txs.filter((t) => t.direction === "out" && ["approved", "payment_recorded", "awaiting_verification"].includes(t.status) && !(t.links && (t.links.purchase || t.links.wdue || t.links.payroll || t.links.commission))), (t) => t.amountMinor);
      out[d] = { inMinor: inn, outMinor: outp, endMinor: F.cash + inn - outp }; }
    return out;
  }

  /* ---------------- Finance dashboard ---------------- */
  const FD = { tab: "overview" };
  async function renderFinance(opts = {}) {
    const V = $("#view-finance"); if (opts.tab) FD.tab = opts.tab; if (FD.tab === "ceo" && !isAdm()) FD.tab = "overview"; if (FD.tab === "settings" && !isAdm()) FD.tab = "overview";
    const pb = periodBar(() => renderFinance());
    V.innerHTML = `<div class="page fin"><div class="phead"><div><span class="eyebrow">Finance</span><h1>Financial <em>Command Center</em></h1>
      <p class="lead small">Cash, obligations and approvals from recorded transactions only. Balances are <b>book balances</b> kept in X FORCE — they are not read from your bank; reconcile them against bank statements in Financial Accounts.</p></div>
      <div class="row"><button class="btn lime sm" id="fd-new">${U.svg("plus")} New transfer</button></div></div>
      <div class="row between"><div class="seg" id="fd-tabs">${[["overview", "Overview"]].concat(isAdm() ? [["ceo", "CEO overview"]] : []).concat([["approvals", "Approvals"]]).concat(isAdm() ? [["settings", "Finance settings"]] : []).map(([k, l]) => `<button type="button" data-t="${k}" class="${FD.tab === k ? "is-on" : ""}">${l}</button>`).join("")}</div>${FD.tab === "settings" || FD.tab === "approvals" ? "" : pb.html}</div>
      <div id="fd-body"><div class="empty"><div class="spinner"></div>Calculating from the ledger…</div></div></div>`;
    $$("[data-t]", V).forEach((b) => (b.onclick = () => { FD.tab = b.dataset.t; renderFinance(); }));
    if (FD.tab !== "settings" && FD.tab !== "approvals") pb.bind(V);
    $("#fd-new").onclick = () => transferForm({}, () => renderFinance());
    let D; try { D = await load(); } catch (e) { $("#fd-body").innerHTML = `<div class="note err">Could not load finance data: ${esc(e.message)}</div>`; return; }
    ({ overview, ceo: ceoOverview, approvals: approvalsTab, settings: settingsTab })[FD.tab]($("#fd-body"), D);
  }
  const tile = (label, v, sub, go, cls = "", extra = "") => `<button type="button" class="kc fin-t ${cls}" data-go='${esc(JSON.stringify(go))}'><span class="eyebrow">${esc(label)}</span><b class="num">${v}</b><span class="tiny muted">${sub}</span>${extra}</button>`;
  function bindGo(box) { $$("[data-go]", box).forEach((b) => (b.onclick = () => { const g = JSON.parse(b.dataset.go); U.go(g.view, g.opts || {}); })); }
  function overview(box, D) {
    const F = figures(D, P.from, P.to), [pf, pt] = prevPeriod(P.from, P.to), F0 = figures(D, pf, pt), fc = forecast(D, F);
    const alerts = [];
    if (D.unposted.length) alerts.push(["warn", `${D.unposted.length} verified customer payment(s) are not posted to a bank or wallet account yet.`, { view: "transfers", opts: { unposted: 1 } }]);
    const pend = D.txs.filter((t) => t.status === "pending_approval"); if (pend.length) alerts.push(["warn", `${pend.length} payment(s) wait for approval.`, { view: "finance", opts: { tab: "approvals" } }]);
    const ver = D.txs.filter((t) => ["payment_recorded", "awaiting_verification"].includes(t.status)); if (ver.length) alerts.push(["warn", `${ver.length} recorded payment(s) wait for verification.`, { view: "finance", opts: { tab: "approvals" } }]);
    const stale = Object.values(D.accounts).filter((a) => a.status !== "closed" && a.type !== "petty" && (!a.lastRecon || Date.now() - Date.parse(a.lastRecon.at) > 35 * 864e5)); if (stale.length) alerts.push(["", `${stale.length} account(s) not reconciled in the last 35 days.`, { view: "finaccounts" }]);
    if (root.DPHolUI) for (const w of DPHolUI.finWarnings(D)) alerts.push([w.c.closedOnDue ? "warn" : "", `${w.what}: ${w.c.text}${w.c.provisional ? " (provisional date)" : ""}`, { view: "holidays" }]);
    if (!Object.keys(D.accounts).length) alerts.push(["err", "No financial accounts yet. Add your bank, InstaPay and wallet accounts with their opening balances first.", { view: "finaccounts" }]);
    box.innerHTML = `${alerts.length ? `<div class="stack fin-alerts">${alerts.map(([c, t, g]) => `<button type="button" class="note ${c} small" data-go='${esc(JSON.stringify(g))}'>${esc(t)}</button>`).join("")}</div>` : ""}
      <h3 class="fin-h">Cash</h3><div class="kcards">
        ${tile("Book balance — all EGP accounts", m(F.cash), `${Object.keys(D.accounts).length} account(s) · as recorded`, { view: "finaccounts" })}
        ${tile("Inflows (external)", m(F.inMinor), `${esc(P.from)} → ${esc(P.to)}`, { view: "transfers", opts: { dir: "in", from: P.from, to: P.to, status: "verified" } }, "", delta(F.inMinor, F0.inMinor))}
        ${tile("Outflows (external)", m(F.outMinor), "verified payments", { view: "transfers", opts: { dir: "out", from: P.from, to: P.to, status: "verified" } }, "", delta(F.outMinor, F0.outMinor, false))}
        ${tile("Net cash movement", m(F.netMinor), `internal transfers excluded (${H.money2(F.internalMinor, "EGP")} moved)`, { view: "transfers", opts: { from: P.from, to: P.to, status: "verified" } }, F.netMinor < 0 ? "err" : "", delta(F.netMinor, F0.netMinor))}</div>
      <h3 class="fin-h">Customers</h3><div class="kcards">
        ${tile("Verified customer payments", m(F.receipts), "received in the period", { view: "transfers", opts: { type: "customer_receipt", from: P.from, to: P.to } }, "", delta(F.receipts, F0.receipts))}
        ${tile("Awaiting verification", m(F.awaiting), `${F.awaitingN} payment(s) — not counted`, { view: "payverify" }, F.awaitingN ? "warn" : "")}
        ${tile("Outstanding customer balances", m(F.receivable), "accounts receivable", { view: "register" })}
        ${tile("Overdue customer payments", m(F.overdue), `${F.overdueN} order(s)`, { view: "register" }, F.overdue ? "err" : "")}</div>
      <h3 class="fin-h">Obligations</h3><div class="kcards">
        ${tile("Accounts payable", m(F.apPurch + F.apDues + F.apPayroll + F.apComm), `suppliers ${H.money2(F.apPurch, "EGP")} · workers ${H.money2(F.apDues, "EGP")} · payroll ${H.money2(F.apPayroll, "EGP")} · commission ${H.money2(F.apComm, "EGP")}`, { view: "purchases" })}
        ${tile("Supplier payments due in 30 days", m(F.upcoming), `${F.upcomingN} purchase(s)`, { view: "purchases" }, F.upcomingN ? "warn" : "")}
        ${tile("Payroll due", m(F.payrollDue), "prepared or approved, not paid", { view: "salaries" })}
        ${tile("Commissions awaiting approval", m(F.commPending), `${F.commPendingN} record(s)`, { view: "approvecomm" })}
        ${tile("Approved commissions to pay", m(F.commApproved), `${F.commApprovedN} record(s)`, { view: "approvecomm" })}</div>
      <h3 class="fin-h">Spending in the period</h3><div class="kcards">
        ${tile("Operating expenses", m(F.opex), "expenses, transport, other", { view: "transfers", opts: { group: "opex", from: P.from, to: P.to, status: "verified" } }, "", delta(F.opex, F0.opex, false))}
        ${tile("Procurement & materials", m(F.procurement), "suppliers, workshops, factory", { view: "transfers", opts: { group: "procurement", from: P.from, to: P.to, status: "verified" } }, "", delta(F.procurement, F0.procurement, false))}
        ${tile("Factory & worker costs", m(F.labour), "wages, installation, project fees", { view: "transfers", opts: { group: "labour", from: P.from, to: P.to, status: "verified" } }, "", delta(F.labour, F0.labour, false))}
        ${tile("Salaries & commissions paid", m(F.salaries), "verified payouts", { view: "transfers", opts: { group: "salaries", from: P.from, to: P.to, status: "verified" } })}
        ${tile("Tax liability (estimate)", m(F.taxLiability), `paid ${H.money2(F.taxPaid, "EGP")} in the period`, { view: "taxes" }, F.taxLiability > 0 ? "warn" : "")}</div>
      <h3 class="fin-h">Cash-flow forecast <span class="pill">forecast</span></h3>
      <div class="card"><div class="tablewrap"><table class="mtable"><thead><tr><th>Horizon</th><th class="r">Expected customer payments</th><th class="r">Known obligations</th><th class="r">Projected book balance</th></tr></thead><tbody>
        ${[30, 60, 90].map((d) => `<tr><td>Next ${d} days</td><td class="r num">${m(fc[d].inMinor)}</td><td class="r num">${m(fc[d].outMinor)}</td><td class="r num ${fc[d].endMinor < 0 ? "neg" : ""}"><b>${m(fc[d].endMinor)}</b></td></tr>`).join("")}</tbody></table></div>
        <p class="tiny muted">Expected payments are the unpaid payment milestones of accepted orders due in the horizon; obligations are approved purchases, worker dues, payroll, commissions and approved payments not yet made. Customers may pay late — this is a planning aid, not a promise.</p></div>
      <h3 class="fin-h">Recent transactions</h3>${txTable(D.txs.slice(0, 12), D.accounts)}
      <p class="tiny muted">Cash flow ≠ profit. Order profitability (revenue minus recorded costs) is in Reports and on each order.</p>`;
    bindGo(box); bindTxRows(box, D, () => renderFinance());
  }
  function ceoOverview(box, D) {
    const F = figures(D, P.from, P.to), bal = Object.values(F.bal), mon = C().monthly(D.txs, "EGP").slice(-12), max = Math.max(1, ...mon.map((x) => Math.max(x.inMinor, x.outMinor)));
    const byType = {}; for (const b of bal) if (b.status !== "closed") byType[b.type] = (byType[b.type] || 0) + (b.currency === "EGP" ? b.bookMinor : 0);
    const hv = (D.cfg.highValueMinor || 50000000), unusual = D.txs.filter((t) => C().inRange(t.date, P.from, P.to) && (t.amountMinor >= hv || t.type === "reversal" || [0, 6].includes(new Date(t.date).getDay()) && false)).slice(0, 15);
    const pend = D.txs.filter((t) => ["pending_approval", "payment_recorded", "awaiting_verification"].includes(t.status));
    box.innerHTML = `<div class="grid2 fin-ceo"><div class="card"><h3>Balances by account</h3>${accountsTable(D, false)}</div>
      <div class="card"><h3>Balances by channel (EGP)</h3><div class="tablewrap"><table class="mtable"><tbody>${Object.entries(byType).map(([k, v]) => `<tr><td>${esc(C().ACCOUNT_TYPES[k] || k)}</td><td class="r num"><b>${m(v)}</b></td></tr>`).join("") || `<tr><td class="muted">No accounts yet.</td></tr>`}</tbody></table></div>
        <h3 style="margin-top:14px">Obligations</h3><dl class="kv small"><dt>Accounts receivable</dt><dd>${m(F.receivable)} <span class="tiny muted">(overdue ${m(F.overdue)})</span></dd><dt>Accounts payable — suppliers</dt><dd>${m(F.apPurch)}</dd><dt>Worker dues</dt><dd>${m(F.apDues)}</dd><dt>Payroll approved, unpaid</dt><dd>${m(F.apPayroll)}</dd><dt>Commissions approved, unpaid</dt><dd>${m(F.apComm)}</dd><dt>Tax (estimate)</dt><dd>${m(F.taxLiability)}</dd></dl></div></div>
      <div class="card"><h3>Monthly inflows and outflows (EGP, verified)</h3>${mon.length ? `<div class="fin-bars">${mon.map((x) => `<div class="fb"><div class="fbb"><i class="in" style="height:${Math.round(x.inMinor / max * 100)}%" title="In ${esc(H.money2(x.inMinor, "EGP"))}"></i><i class="out" style="height:${Math.round(x.outMinor / max * 100)}%" title="Out ${esc(H.money2(x.outMinor, "EGP"))}"></i></div><span class="tiny">${esc(x.month.slice(2))}</span><span class="tiny ${x.netMinor < 0 ? "down" : "up"}">${esc(H.money2(x.netMinor, "EGP"))}</span></div>`).join("")}</div><p class="tiny muted"><i class="lg in"></i> in · <i class="lg out"></i> out · internal transfers excluded</p>` : `<p class="small muted">No verified transactions yet.</p>`}</div>
      <div class="grid2"><div class="card"><h3>Pending approvals & verifications (${pend.length})</h3>${txTable(pend.slice(0, 10), D.accounts)}</div>
        <div class="card"><h3>High-value or unusual in the period</h3><p class="tiny muted">At or above ${m(hv)}, and every reversal.</p>${txTable(unusual, D.accounts)}</div></div>`;
    bindTxRows(box, D, () => renderFinance());
  }
  async function approvalsTab(box, D) {
    const me = DPAuth.A.me.id, cfg = D.cfg, sod = cfg.sod && !isAdm();
    const txA = D.txs.filter((t) => t.status === "pending_approval"), txV = D.txs.filter((t) => ["payment_recorded", "awaiting_verification"].includes(t.status));
    const pr = D.payroll.filter((l) => l.status === "pending_approval"), pu = D.purchases.filter((p) => p.status === "pending_approval"), du = D.dues.filter((d) => d.status === "pending_approval");
    const drafts = (await Fn().salesDrafts().catch(() => [])).filter((d) => d.status === "draft");
    const mineNote = (by) => (sod && by === me ? `<span class="tiny muted">you prepared this — another person must approve</span>` : "");
    box.innerHTML = `<div class="stack">
      <div class="card"><h3>Payments to approve (${txA.length})</h3>${txTable(txA, D.accounts)}</div>
      <div class="card"><h3>Payments to verify (${txV.length})</h3><p class="tiny muted">Verify only when the money has really left or reached the account — this is when balances change.</p>${txTable(txV, D.accounts)}</div>
      <div class="card"><h3>Customer payments to verify (${D.queue.length})</h3><p class="small">${D.queue.length ? `<button class="btn lime xs" data-go='${esc(JSON.stringify({ view: "payverify" }))}'>Open Payment Verification</button>` : "Nothing waiting."}</p></div>
      <div class="card"><h3>Payroll awaiting approval (${pr.length})</h3>${pr.length ? `<ul class="small">${pr.map((l) => `<li>${esc(l.period)} · ${esc(l.name)} · net ${m(l.netMinor, l.currency)} ${mineNote(l.preparedBy)}</li>`).join("")}</ul><button class="btn ghost xs" data-go='${esc(JSON.stringify({ view: "salaries", opts: { period: pr[0].period } }))}'>Open payroll</button>` : `<p class="small muted">Nothing waiting.</p>`}</div>
      <div class="card"><h3>Purchases awaiting approval (${pu.length})</h3>${pu.length ? `<ul class="small">${pu.map((p) => `<li>${esc(p.ref)} · ${esc(p.supplierName)} · ${m(p.totalMinor, p.currency)} ${mineNote(p.preparedBy)}</li>`).join("")}</ul><button class="btn ghost xs" data-go='${esc(JSON.stringify({ view: "purchases" }))}'>Open purchases</button>` : `<p class="small muted">Nothing waiting.</p>`}</div>
      <div class="card"><h3>Worker payments awaiting approval (${du.length})</h3>${du.length ? `<ul class="small">${du.map((d) => `<li>${esc(d.workerName)} · ${esc(Fn().DUE_KINDS[d.kind])} · ${m(d.amountDueMinor, d.currency)} ${mineNote(d.preparedBy)}</li>`).join("")}</ul><button class="btn ghost xs" data-go='${esc(JSON.stringify({ view: "salaries", opts: { tab: "workers" } }))}'>Open worker payments</button>` : `<p class="small muted">Nothing waiting.</p>`}</div>
      <div class="card"><h3>Invoice / receipt drafts from sales (${drafts.length})</h3>${drafts.length ? `<button class="btn ghost xs" data-go='${esc(JSON.stringify({ view: "invoices" }))}'>Open invoices</button>` : `<p class="small muted">Nothing waiting.</p>`}</div></div>`;
    bindGo(box); bindTxRows(box, D, () => renderFinance());
  }
  async function settingsTab(box, D) {
    const c = D.cfg, A = Object.values(D.accounts).filter((a) => a.status !== "closed"), P = c.accountant;
    const perms = [["verifyCustomerPayments", "Verify customer payments"], ["approvePayments", "Approve payments, internal transfers and reversals"], ["approvePayroll", "Approve payroll"], ["approveCommission", "Approve commissions"], ["approveExpenses", "Approve expenses, purchases and worker payments"], ["finalizeInvoices", "Issue and cancel invoices and receipts"], ["recordTax", "Configure taxes and approve tax payments"], ["exportSensitive", "Export sensitive reports (balances, salaries, commissions)"]];
    box.innerHTML = `<div class="grid2"><div class="card stack"><h3>What the Accountant may do</h3><p class="small muted">Everything the Accountant prepares is always recorded. These switches decide what they may <b>approve</b>. The server enforces them — hiding buttons is not the control.</p>
        ${perms.map(([k, l]) => `<label class="check"><input type="checkbox" data-perm="${k}"${P[k] ? " checked" : ""}> ${esc(l)}</label>`).join("")}
        <label class="check"><input type="checkbox" id="fs-sod"${c.sod ? " checked" : ""}> <b>Separation of duties</b>: the person who prepares or records a payment cannot approve or verify it</label></div>
      <div class="card stack"><h3>Defaults</h3><p class="small muted">Account that receives customer payments by method (used when a payment is verified).</p>
        ${C().METHODS.slice(0, 5).map((mt) => `<label class="field"><span>${esc(mt)}</span><select class="in sm" data-ma="${esc(mt)}"><option value="">— automatic (first bank account) —</option>${A.map((a) => `<option value="${esc(a.id)}"${(c.methodAccounts || {})[mt] === a.id ? " selected" : ""}>${esc(a.name)} · ${esc(a.currency)}</option>`).join("")}</select></label>`).join("")}
        <label class="field"><span>Sales and invoices</span><select class="in sm" id="fs-si"><option value="draft"${c.salesInvoices !== "issue" ? " selected" : ""}>Sales prepare drafts; Finance or the Administrator issues them</option></select></label>
        <label class="check"><input type="checkbox" id="fs-ps"${c.payslipsVisible ? " checked" : ""}> Employees can see and download their own payslips</label>
        <label class="field"><span>Highlight transactions from (EGP)</span><input class="in sm num" id="fs-hv" type="number" min="0" value="${(c.highValueMinor || 0) / 100}"></label>
        <label class="field"><span>Reason for this change (kept in the audit trail)</span><input class="in sm" id="fs-r" maxlength="200"></label>
        <div class="row"><button class="btn lime" id="fs-ok">Save finance settings</button><span class="small" id="fs-err" style="color:var(--red)"></span></div></div></div>`;
    $("#fs-ok", box).onclick = async () => { const next = { accountant: {}, sod: $("#fs-sod", box).checked, methodAccounts: {}, salesInvoices: "draft", payslipsVisible: $("#fs-ps", box).checked, highValueMinor: toMinor($("#fs-hv", box).value) };
      $$("[data-perm]", box).forEach((x) => (next.accountant[x.dataset.perm] = x.checked)); $$("[data-ma]", box).forEach((x) => { if (x.value) next.methodAccounts[x.dataset.ma] = x.value; });
      try { await Fn().saveCfg(next, $("#fs-r", box).value.trim()); U.toast("Finance settings saved."); renderFinance(); } catch (e) { $("#fs-err", box).textContent = e.message; } };
  }

  /* ---------------- transaction table & detail ---------------- */
  function txTable(list, accounts) {
    if (!list.length) return `<p class="small muted">No transactions.</p>`;
    const acn = (id) => (id && accounts[id] ? accounts[id].name : id ? "?" : "—");
    return `<div class="tablewrap"><table class="mtable"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Payee / payer</th><th>Account</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>
      ${list.map((t) => `<tr class="click" data-tx="${esc(t.ref)}"><td class="small">${esc(t.date)}</td><td class="small"><b>${esc(t.ref)}</b>${t.reversedBy ? ` <span class="pill">reversed</span>` : ""}${t.orderId ? `<div class="tiny muted">${esc(t.orderId)}</div>` : ""}</td><td class="small">${esc((C().TYPES[t.type] || {}).label || t.type)}</td><td class="small">${esc((t.payee && t.payee.name) || "—")}</td>
        <td class="small">${t.direction === "internal" ? `${esc(acn(t.fromAcct))} → ${esc(acn(t.toAcct))}` : esc(acn(t.direction === "in" ? t.toAcct : t.fromAcct))}</td><td class="r num ${t.direction === "out" ? "neg" : ""}">${t.direction === "out" ? "−" : t.direction === "in" ? "+" : "⇄ "}${m(t.amountMinor, t.currency)}</td><td>${pill(t.status)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function bindTxRows(box, D, done) { $$("[data-tx]", box).forEach((r) => (r.onclick = () => txDetail(r.dataset.tx, D, done))); }
  async function txDetail(ref, D, done) {
    const t = await Fn().getTx(ref); if (!t) return U.toast("Transaction not found.", { err: true });
    const cfg = await Fn().cfg(), me = DPAuth.A.me.id, T = C().TYPES[t.type] || {}, A = D.accounts, sod = cfg.sod && !isAdm();
    const may = (perm) => Fn().can(perm), acn = (id) => (id && A[id] ? `${A[id].name} (${A[id].currency})` : "—");
    const canApprove = t.status === "pending_approval" && may(T.perm) && !(sod && t.preparedBy === me);
    const canRecord = ["approved"].includes(t.status) || (t.status === "payment_recorded" && !(t.proofs || []).length);
    const canVerify = ["payment_recorded", "awaiting_verification"].includes(t.status) && (may(t.type === "customer_receipt" ? "verifyCustomerPayments" : T.perm)) && !(sod && (t.recordedBy || t.preparedBy) === me && t.type !== "customer_receipt");
    const canReverse = t.status === "verified" && !t.reversedBy && t.type !== "reversal" && may("approvePayments");
    const L = t.links || {};
    U.openModal(`<div class="row between"><div><span class="eyebrow">${esc(T.label || t.type)} · ${esc(C().DIRECTIONS[t.direction])}</span><h2>${t.direction === "out" ? "−" : t.direction === "in" ? "+" : "⇄ "}${m(t.amountMinor, t.currency)} <span class="small muted">${esc(t.ref)}</span></h2></div>${pill(t.status)}</div>
      <div class="pv-grid"><div class="stack"><dl class="kv small"><dt>Date</dt><dd>${esc(t.date)}</dd><dt>What it is for</dt><dd>${esc(t.description || "—")}</dd><dt>Payee / payer</dt><dd>${esc((t.payee && t.payee.name) || "—")} ${t.payee ? `<span class="tiny muted">${esc(t.payee.kind || "")}</span>` : ""}</dd>
        ${t.direction !== "in" ? `<dt>From account</dt><dd>${esc(acn(t.fromAcct))}</dd>` : ""}${t.direction !== "out" ? `<dt>To account</dt><dd>${esc(acn(t.toAcct))}</dd>` : ""}<dt>Method</dt><dd>${esc(t.method || "—")}</dd>
        ${t.bankRef ? `<dt>Bank reference</dt><dd>${esc(t.bankRef)}</dd>` : ""}${t.walletRef ? `<dt>InstaPay / wallet reference</dt><dd>${esc(t.walletRef)}</dd>` : ""}${t.orderId ? `<dt>Order</dt><dd><button class="linkbtn" id="td-o">${esc(t.orderId)}</button></dd>` : ""}
        ${t.dept ? `<dt>Department</dt><dd>${esc(t.dept)}</dd>` : ""}${t.category ? `<dt>Category</dt><dd>${esc(t.category)}</dd>` : ""}<dt>Prepared by</dt><dd>${esc(name(t.preparedBy))} · ${esc(H.dateS(t.preparedAt))}</dd>
        ${t.approvedBy ? `<dt>Approved by</dt><dd>${esc(name(t.approvedBy))} · ${esc(H.dateS(t.approvedAt))}</dd>` : t.preApproved ? `<dt>Approval</dt><dd>approved record (${esc(Object.keys(L).join(", "))})</dd>` : ""}
        ${t.recordedBy ? `<dt>Payment recorded by</dt><dd>${esc(name(t.recordedBy))} · ${esc(H.dateS(t.recordedAt))}</dd>` : ""}${t.verifiedBy ? `<dt>Verified by</dt><dd>${esc(name(t.verifiedBy))} · ${esc(H.dateS(t.verifiedAt))}</dd>` : ""}
        ${t.reversalOf ? `<dt>Reverses</dt><dd>${esc(t.reversalOf)} — ${esc(t.reason || "")}</dd>` : ""}${t.reversedBy ? `<dt>Reversed by</dt><dd>${esc(t.reversedBy)}</dd>` : ""}${t.reason && !t.reversalOf ? `<dt>Reason</dt><dd>${esc(t.reason)}</dd>` : ""}${t.recon ? `<dt>Bank statement</dt><dd>matched ${esc(H.dateS(t.recon.at))}</dd>` : ""}</dl>
        <div><b class="small">Proof and documents</b><div class="row" style="flex-wrap:wrap;gap:6px">${(t.proofs || []).concat(t.docs || []).map((p, i) => `<button class="btn ghost xs" data-pf="${i}">${U.svg("clip")} ${esc(p.name)}</button>`).join("") || `<span class="small muted">None attached.</span>`}</div></div>
        <details><summary class="small">History (${(t.history || []).length})</summary><ul class="tiny">${(t.history || []).map((h) => `<li>${esc(H.dateS(h.at))} · ${esc(name(h.by))} · ${esc(h.action)}${h.detail ? " — " + esc(h.detail) : ""}</li>`).join("")}</ul></details></div>
      <div class="stack" id="td-act">
        ${canApprove ? `<button class="btn lime" id="td-ap">Approve</button><button class="btn ghost" id="td-rj">Reject…</button>` : t.status === "pending_approval" ? `<p class="small muted">${sod && t.preparedBy === me ? "You prepared this payment, so another person must approve it." : "Waiting for an authorised approver."}</p>` : ""}
        ${canRecord ? `<div class="card stack"><b class="small">Record the payment</b><label class="field"><span>${t.direction === "in" ? "Received into" : "Paid from"}</span><select class="in sm" id="td-acc">${accountOptions(A, t.currency, t.direction === "in" ? t.toAcct : t.fromAcct)}</select></label>
          <label class="field"><span>Method</span><select class="in sm" id="td-m">${C().METHODS.map((x) => `<option${x === t.method ? " selected" : ""}>${x}</option>`).join("")}</select></label><label class="field"><span>Bank reference</span><input class="in sm" id="td-br" value="${esc(t.bankRef || "")}"></label>
          <label class="field"><span>InstaPay / wallet reference</span><input class="in sm" id="td-wr" value="${esc(t.walletRef || "")}"></label><label class="field"><span>Payment date</span><input class="in sm" type="date" id="td-d" value="${esc(t.date)}"></label>
          <button class="btn ghost xs" id="td-pick">${U.svg("clip")} Attach payment proof</button><span class="tiny" id="td-pn"></span><button class="btn lime sm" id="td-rec">Record payment</button></div>` : ""}
        ${["payment_recorded", "awaiting_verification", "approved"].includes(t.status) && !canRecord ? `<button class="btn ghost xs" id="td-att">${U.svg("clip")} Attach proof…</button>` : ""}
        ${canVerify ? `<button class="btn lime" id="td-v">Verify — post to the account</button><p class="tiny muted">Verify only when the bank or wallet shows the movement. Balances change now; afterwards only a reversal can correct it.</p>` : ["payment_recorded", "awaiting_verification"].includes(t.status) ? `<p class="small muted">${sod && (t.recordedBy || t.preparedBy) === me ? "You recorded this payment, so another person must verify it." : "Waiting for an authorised person to verify."}</p>` : ""}
        ${!["verified", "rejected", "cancelled"].includes(t.status) ? `<button class="btn ghost xs" id="td-c">Cancel…</button>` : ""}${canReverse ? `<button class="btn ghost xs" id="td-rv">Reverse…</button>` : ""}
        <p class="small" id="td-err" style="color:var(--red)"></p><button class="btn ghost" id="td-x">Close</button></div></div>`, (mm) => {
      const err = $("#td-err", mm), act = (fn, okMsg) => async () => { err.textContent = ""; try { await fn(); U.closeModal(); U.toast(okMsg); done && done(); } catch (e) { err.textContent = e.message; } };
      $("#td-x", mm).onclick = () => U.closeModal();
      const all = (t.proofs || []).concat(t.docs || []); $$("[data-pf]", mm).forEach((b) => (b.onclick = async () => { const p = all[+b.dataset.pf]; const f = p.orderFile ? await DPOrders.getFile(`orders/${t.orderId}/files/${p.id}`) : await Fn().proofFile(t.ref, p.id); DPPayUI.showFile(f, "Payment proof"); }));
      const o = $("#td-o", mm); if (o) o.onclick = () => { U.closeModal(); root.DPCeo2 && DPCeo2.orderPanel ? DPCeo2.orderPanel(t.orderId) : U.go("register", { oid: t.orderId }); };
      const ap = $("#td-ap", mm); if (ap) ap.onclick = act(() => Fn().approve(ref), "Approved.");
      const rj = $("#td-rj", mm); if (rj) rj.onclick = async () => { const r = prompt2("Reason for rejecting"); if (r) act(() => Fn().reject(ref, r), "Rejected.")(); };
      let file = null; const pk = $("#td-pick", mm); if (pk) pk.onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { try { file = await DPOrders.prepareFile(f); $("#td-pn", mm).textContent = file.name; } catch (e) { err.textContent = e.message; } });
      const rec = $("#td-rec", mm); if (rec) rec.onclick = act(() => Fn().recordPayment(ref, { account: $("#td-acc", mm).value, method: $("#td-m", mm).value, bankRef: $("#td-br", mm).value.trim(), walletRef: $("#td-wr", mm).value.trim(), date: $("#td-d", mm).value, file }), "Payment recorded. It is posted when it is verified.");
      const at = $("#td-att", mm); if (at) at.onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { try { const pf = await DPOrders.prepareFile(f); await Fn().addProof(ref, pf, "proof"); U.closeModal(); U.toast("Proof attached."); done && done(); } catch (e) { err.textContent = e.message; } });
      const v = $("#td-v", mm); if (v) v.onclick = act(() => Fn().verify(ref), "Verified and posted.");
      const c = $("#td-c", mm); if (c) c.onclick = async () => { const r = prompt2("Reason for cancelling"); if (r) act(() => Fn().cancel(ref, r), "Cancelled.")(); };
      const rv = $("#td-rv", mm); if (rv) rv.onclick = async () => { const r = prompt2("Why is this transaction reversed? (at least 5 characters)"); if (r) act(() => Fn().reverse(ref, r), "Reversal recorded. Both entries stay in the ledger.")(); };
    }, { wide: true });
  }
  const prompt2 = (q) => { const r = root.prompt ? root.prompt(q) : null; return r && r.trim() ? r.trim() : null; };
  function accountOptions(A, cur, sel) { const l = Object.values(A).filter((a) => a.status !== "closed" && (!cur || a.currency === cur)); return `<option value="">— choose —</option>` + l.map((a) => `<option value="${esc(a.id)}"${a.id === sel ? " selected" : ""}>${esc(a.name)} · ${esc(C().ACCOUNT_TYPES[a.type] || a.type)} · ${esc(a.currency)}</option>`).join(""); }

  /* ---------------- new transfer (form adapts to the type) ---------------- */
  async function transferForm(pre = {}, done) {
    Fn().req(); const [A, workers, sups, orders] = await Promise.all([Fn().accounts(), DPOrders.listWorkers().catch(() => []), Fn().suppliers(), DPSales.listOrders().catch(() => [])]);
    if (!Object.keys(A).length) return U.toast("Add a financial account first (Financial Accounts).", { err: true, ms: 6000 });
    const ref = C().newRef("TX"), types = Object.entries(C().TYPES).filter(([k]) => !["reversal", "customer_receipt"].includes(k));
    const staff = DPAuth.A.directory.filter((r) => r.uid && r.active !== false);
    U.openModal(`<h2>New transfer</h2><p class="small muted">Reference <b>${esc(ref)}</b> — created once, even if you click twice. Payments wait for approval; nothing changes a balance until it is verified.</p>
      <div class="grid2"><label class="field"><span>Type *</span><select class="in" id="nt-type">${types.map(([k, x]) => `<option value="${k}"${pre.type === k ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label><label class="field"><span>Date *</span><input class="in" type="date" id="nt-d" value="${esc(pre.date || today())}"></label></div>
      <div id="nt-who" class="grid2"></div>
      <div class="grid2"><label class="field" id="nt-fromw"><span>From account</span><select class="in" id="nt-from">${accountOptions(A, null, pre.fromAcct)}</select></label><label class="field" id="nt-tow"><span>To account</span><select class="in" id="nt-to">${accountOptions(A, null, pre.toAcct)}</select></label></div>
      <div class="grid2"><label class="field"><span>Amount *</span><input class="in num" id="nt-a" type="number" min="0" step="0.01" value="${pre.amountMinor ? pre.amountMinor / 100 : ""}"></label><label class="field"><span>Method</span><select class="in" id="nt-m">${C().METHODS.map((x) => `<option${x === (pre.method || "Bank transfer") ? " selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <div class="grid2"><label class="field"><span>Related order (optional)</span><select class="in" id="nt-o"><option value="">—</option>${orders.map((o) => `<option value="${esc(o.oid)}"${o.oid === pre.orderId ? " selected" : ""}>${esc(o.ref || o.oid)} · ${esc(o.name)}</option>`).join("")}</select></label><label class="field"><span>Department</span><select class="in" id="nt-dep">${["", "Finance", "Sales", "Engineering", "Procurement", "Installation", "Management", "Operations"].map((x) => `<option${x === (pre.dept || "") ? " selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <label class="field"><span>Exactly what the money is for *</span><input class="in" id="nt-desc" maxlength="240" value="${esc(pre.description || "")}"></label>
      <div class="grid2"><label class="field"><span>Category</span><input class="in" id="nt-cat" maxlength="60" value="${esc(pre.category || "")}" placeholder="e.g. Rent, Fuel, HDPE sheets"></label><label class="field"><span>Bank / InstaPay reference (if paid already)</span><input class="in" id="nt-br" maxlength="80"></label></div>
      <label class="field" id="nt-cpw" hidden><span>Marketing campaign this payment is for (counts as actual campaign spend once verified)</span><select class="in" id="nt-cp"><option value="">— not a campaign cost —</option></select></label>
      <label class="field"><span>Notes</span><textarea class="in" id="nt-n" rows="2"></textarea></label>
      <div class="row"><button class="btn ghost xs" id="nt-pick">${U.svg("clip")} Attach supporting document</button><span class="tiny" id="nt-pn"></span></div>
      <p class="small" id="nt-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="nt-x">Cancel</button><button class="btn lime" id="nt-ok">Create transfer</button></div>`, (mm) => {
      const type = $("#nt-type", mm), who = $("#nt-who", mm), err = $("#nt-err", mm); let file = null;
      const draw = () => { const T = C().TYPES[type.value]; $("#nt-fromw", mm).hidden = T.dir === "in"; $("#nt-tow", mm).hidden = T.dir === "out";
        who.innerHTML = T.payee === "employee" ? `<label class="field"><span>Employee *</span><select class="in" id="nt-p">${staff.map((r) => `<option value="${esc(r.uid)}">${esc(DPAuth.fullName(r) || r.displayName)}</option>`).join("")}</select></label>`
          : T.payee === "worker" ? `<label class="field"><span>Worker *</span><select class="in" id="nt-p">${workers.map((w) => `<option value="${esc(w.wid)}">${esc(w.name)} · ${esc(DPOrders.WORKER_TYPES[w.type] || "")}</option>`).join("")}</select></label>`
          : T.payee === "supplier" ? `<label class="field"><span>Supplier / workshop *</span><select class="in" id="nt-p">${sups.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}<option value="__new">+ New supplier…</option></select></label>`
          : T.payee === "tax" ? `<label class="field"><span>Tax authority / period *</span><input class="in" id="nt-pn2" value="Egyptian Tax Authority" maxlength="80"></label><label class="field"><span>Tax period</span><input class="in" id="nt-tp" placeholder="e.g. 2026-10" maxlength="20"></label>`
          : T.payee ? `<label class="field"><span>Payee / payer *</span><input class="in" id="nt-pn2" maxlength="120"></label>` : ""; };
      type.onchange = draw; draw();
      if (root.DPMkt) DPMkt.campaigns().then((cs) => { if (!cs.length) return; $("#nt-cpw", mm).hidden = false; $("#nt-cp", mm).insertAdjacentHTML("beforeend", cs.map((c) => `<option value="${esc(c.id)}"${(pre.links || {}).campaign === c.id ? " selected" : ""}>${esc(c.name)} · ${esc(c.source)}</option>`).join("")); }).catch(() => {});
      $("#nt-x", mm).onclick = () => U.closeModal();
      $("#nt-pick", mm).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { try { file = await DPOrders.prepareFile(f); $("#nt-pn", mm).textContent = file.name; } catch (e) { err.textContent = e.message; } });
      $("#nt-ok", mm).onclick = async () => { err.textContent = ""; const T = C().TYPES[type.value], b = $("#nt-ok", mm);
        try { let payee = null; const pSel = $("#nt-p", mm);
          if (T.payee === "employee") payee = { kind: "employee", id: pSel.value, name: DPAuth.nameSync(pSel.value) };
          else if (T.payee === "worker") { const w = workers.find((x) => x.wid === pSel.value); if (!w) throw new Error("Add the worker to the Worker Directory first."); payee = { kind: "worker", id: w.wid, name: w.name }; }
          else if (T.payee === "supplier") { let s = sups.find((x) => x.id === pSel.value); if (pSel.value === "__new" || !s) { const nm = prompt2("Supplier name"); if (!nm) return; s = await Fn().saveSupplier({ name: nm }); } payee = { kind: "supplier", id: s.id, name: s.name }; }
          else if (T.payee) { const nm = ($("#nt-pn2", mm) || {}).value; if (!String(nm || "").trim()) throw new Error("Enter the payee or payer."); payee = { kind: T.payee, id: null, name: nm.trim(), period: ($("#nt-tp", mm) || {}).value || "" }; }
          const from = T.dir !== "in" ? $("#nt-from", mm).value : null, to = T.dir !== "out" ? $("#nt-to", mm).value : null;
          if (T.dir === "internal" && (!from || !to)) throw new Error("Choose both accounts."); const accCur = (A[from || to] || {}).currency || "EGP";
          b.disabled = true; b.textContent = "Saving…";
          const t = await Fn().createTx({ ref, type: type.value, date: $("#nt-d", mm).value, amountMinor: toMinor($("#nt-a", mm).value), currency: accCur, fromAcct: from, toAcct: to, method: $("#nt-m", mm).value, bankRef: $("#nt-br", mm).value.trim(), payee, orderId: $("#nt-o", mm).value || null, dept: $("#nt-dep", mm).value, category: $("#nt-cat", mm).value.trim(), description: $("#nt-desc", mm).value, notes: $("#nt-n", mm).value, files: file ? [file] : [], proofKind: "doc", links: Object.assign({}, pre.links || {}, $("#nt-cp", mm).value ? { campaign: $("#nt-cp", mm).value } : {}) });
          U.closeModal(); U.toast(t.status === "pending_approval" ? "Transfer created — waiting for approval." : "Transfer created."); done && done(t);
        } catch (e) { err.textContent = e.message; b.disabled = false; b.textContent = "Create transfer"; } };
    }, { wide: true });
  }

  /* ---------------- Transfers ledger ---------------- */
  const TF = { q: "", type: "", status: "", dir: "", acct: "", group: "", from: "", to: "" };
  const GROUPS = { opex: ["expense", "transport", "other_out"], procurement: ["supplier", "outsourced", "factory"], labour: ["worker_salary", "worker_payment"], salaries: ["salary", "commission"] };
  async function renderTransfers(opts = {}) {
    const V = $("#view-transfers"); if (Object.keys(opts).some((k) => k in TF)) Object.assign(TF, { q: "", type: "", status: "", dir: "", acct: "", group: "", from: "", to: "" }, opts);
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Finance</span><h1><em>Transfers</em></h1><p class="lead small">Every movement of money — received, paid or moved between company accounts — with its purpose, proof, approvals and links to the order, person or purchase it belongs to.</p></div>
      <div class="row"><button class="btn lime sm" id="tf-new">${U.svg("plus")} New transfer</button></div></div><div id="tf-body"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $("#tf-new").onclick = () => transferForm({}, () => renderTransfers());
    let D; try { D = await load(); } catch (e) { $("#tf-body").innerHTML = `<div class="note err">${esc(e.message)}</div>`; return; }
    const draw = () => {
      const q = TF.q.toLowerCase(), list = D.txs.filter((t) => (!TF.type || t.type === TF.type) && (!TF.status || t.status === TF.status) && (!TF.dir || t.direction === TF.dir) && (!TF.acct || t.fromAcct === TF.acct || t.toAcct === TF.acct) && (!TF.group || (GROUPS[TF.group] || []).includes(t.type)) && C().inRange(t.date, TF.from, TF.to)
        && (!q || [t.ref, t.description, t.payee && t.payee.name, t.orderId, t.bankRef, t.walletRef].join(" ").toLowerCase().includes(q)));
      const tot = C().cashflow(list.map((t) => Object.assign({}, t, { status: t.status === "verified" ? "verified" : "x" })), {}).EGP || { inMinor: 0, outMinor: 0 };
      $("#tf-body").innerHTML = `${opts.unposted || D.unposted.length ? unpostedHtml(D) : ""}<div class="card row fin-filt"><input class="in sm" id="tf-q" placeholder="Search reference, purpose, payee, order…" value="${esc(TF.q)}">
        <select class="in sm" id="tf-type"><option value="">All types</option>${Object.entries(C().TYPES).map(([k, x]) => `<option value="${k}"${TF.type === k ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
        <select class="in sm" id="tf-st"><option value="">All statuses</option>${Object.entries(C().STATUS).map(([k, x]) => `<option value="${k}"${TF.status === k ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <select class="in sm" id="tf-dir"><option value="">In, out and internal</option>${Object.entries(C().DIRECTIONS).map(([k, x]) => `<option value="${k}"${TF.dir === k ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <select class="in sm" id="tf-acc"><option value="">All accounts</option>${Object.values(D.accounts).map((a) => `<option value="${esc(a.id)}"${TF.acct === a.id ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
        <input class="in sm" type="date" id="tf-from" value="${esc(TF.from)}"><input class="in sm" type="date" id="tf-to" value="${esc(TF.to)}">${TF.group ? `<span class="pill">${esc(TF.group)} <button class="linkbtn" id="tf-g">✕</button></span>` : ""}</div>
        <p class="small muted">${list.length} transaction(s) · verified in ${m(tot.inMinor)} · verified out ${m(tot.outMinor)}</p>${txTable(list, D.accounts)}`;
      const B = $("#tf-body"); $("#tf-q", B).oninput = (e) => { TF.q = e.target.value; clearTimeout(TF.t); TF.t = setTimeout(() => { draw(); const x = $("#tf-q"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 250); };
      for (const [id, k] of [["tf-type", "type"], ["tf-st", "status"], ["tf-dir", "dir"], ["tf-acc", "acct"], ["tf-from", "from"], ["tf-to", "to"]]) $("#" + id, B).onchange = (e) => { TF[k] = e.target.value; draw(); };
      const g = $("#tf-g", B); if (g) g.onclick = () => { TF.group = ""; draw(); };
      bindTxRows(B, D, () => renderTransfers()); bindUnposted(B, D, () => renderTransfers());
      if (opts.ref && !TF.opened) { TF.opened = true; txDetail(opts.ref, D, () => renderTransfers()); }
    };
    TF.opened = false; draw();
  }
  function unpostedHtml(D) { if (!D.unposted.length) return ""; return `<div class="card"><h3>Verified customer payments not yet in an account (${D.unposted.length})</h3><p class="small muted">They are already verified on the order. Posting creates the single incoming ledger entry for each — choose the account the money arrived in.</p>
    <div class="tablewrap"><table class="mtable"><thead><tr><th>Order</th><th>Date</th><th class="r">Amount</th><th>Method</th><th>Account</th><th></th></tr></thead><tbody>${D.unposted.map((x, i) => `<tr><td class="small">${esc(x.o.ref || x.o.oid)} · ${esc(x.o.name)}</td><td class="small">${esc(x.p.date)}</td><td class="r num">${m(x.p.amountMinor, x.o.currency)}</td><td class="small">${esc(x.p.method || "—")}</td><td><select class="in sm" data-ua="${i}">${accountOptions(D.accounts, x.o.currency || "EGP", null)}</select></td><td><button class="btn lime xs" data-up="${i}">Post</button></td></tr>`).join("")}</tbody></table></div></div>`; }
  function bindUnposted(box, D, done) { $$("[data-up]", box).forEach((b) => (b.onclick = async () => { const i = +b.dataset.up, x = D.unposted[i], a = $(`[data-ua="${i}"]`, box).value; if (!a) return U.toast("Choose the account.", { err: true }); try { const r = await Fn().postReceipt(x.o, x.p, { account: a }); if (!r) throw new Error("Not posted (no permission or account)."); U.toast("Posted."); done(); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); } })); }

  /* ---------------- Financial accounts & reconciliation ---------------- */
  function accountsTable(D, actions = true) {
    const b = C().balances(D.accounts, D.txs), rows = Object.values(D.accounts);
    if (!rows.length) return `<p class="small muted">No accounts yet.</p>`;
    return `<div class="tablewrap"><table class="mtable"><thead><tr><th>Account</th><th>Type</th><th class="r">Book balance</th><th class="r">Statement balance</th><th class="r">Difference</th><th>Last reconciled</th></tr></thead><tbody>
      ${rows.map((a) => { const x = b[a.id], st = a.statementBalanceMinor, diff = st == null ? null : st - x.bookMinor; return `<tr class="${actions ? "click" : ""}" data-acc="${esc(a.id)}"><td><b>${esc(a.name)}</b>${a.status === "closed" ? ` <span class="pill">closed</span>` : ""}<div class="tiny muted">${esc(a.bankName || "")} ${esc(a.maskedNumber || "")}</div></td><td class="small">${esc(C().ACCOUNT_TYPES[a.type] || a.type)} · ${esc(a.currency)}</td>
        <td class="r num"><b>${m(x.bookMinor, a.currency)}</b></td><td class="r num">${st == null ? "—" : m(st, a.currency)}${a.statementDate ? `<div class="tiny muted">${esc(a.statementDate)}</div>` : ""}</td><td class="r num ${diff ? "neg" : ""}">${diff == null ? "—" : m(diff, a.currency)}</td><td class="small">${a.lastRecon ? esc(a.lastRecon.asOf) : "never"}</td></tr>`; }).join("")}</tbody></table></div>`;
  }
  async function renderAccounts(opts = {}) {
    const V = $("#view-finaccounts");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Finance</span><h1>Financial <em>Accounts</em></h1><p class="lead small">Bank accounts, InstaPay settlement, company wallets and petty cash. X FORCE keeps the <b>book balance</b> from verified transactions; no bank login or card data is ever stored. Import statements to reconcile.</p></div>
      <div class="row"><button class="btn lime sm" id="fa-new">${U.svg("plus")} Add account</button></div></div><div id="fa-body"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $("#fa-new").onclick = () => accountForm(null, () => renderAccounts());
    let D; try { D = await load(); } catch (e) { $("#fa-body").innerHTML = `<div class="note err">${esc(e.message)}</div>`; return; }
    $("#fa-body").innerHTML = `<div class="card">${accountsTable(D)}</div><p class="tiny muted">Book balance = opening balance on its date + verified incoming − verified outgoing ± verified internal transfers. Pending, approved and recorded payments are not included.</p>`;
    $$("[data-acc]", $("#fa-body")).forEach((r) => (r.onclick = () => accountDetail(r.dataset.acc, D)));
    if (opts.acct) accountDetail(opts.acct, D);
  }
  function accountForm(a, done) {
    U.form(a ? "Edit account" : "Add financial account", [{ id: "name", label: "Account name *", value: a ? a.name : "", required: true }, { id: "type", label: "Type", type: "select", value: a ? a.type : "bank", options: Object.entries(C().ACCOUNT_TYPES).map(([k, l]) => ({ value: k, label: l })) },
      { id: "currency", label: "Currency", type: "select", value: a ? a.currency : "EGP", options: ["EGP", "USD", "EUR", "CNY", "AED", "GBP"].map((x) => ({ value: x, label: x })) }, { id: "bank", label: "Bank / provider name", value: a ? a.bankName : "" },
      { id: "num", label: "Account number (last 4 digits are kept)", value: "" }, { id: "op", label: "Opening balance", type: "number", step: "0.01", value: a ? a.openingMinor / 100 : 0, required: true }, { id: "od", label: "Opening-balance date", type: "date", value: a ? a.openingDate : today(), required: true },
      { id: "st", label: "Status", type: "select", value: a ? a.status : "active", options: [{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }] }, { id: "notes", label: "Notes", type: "textarea", value: a ? a.notes : "" }, { id: "r", label: a ? "Reason for the change" : "Note", value: "" }],
      { submit: "Save account", intro: "Enter the balance shown by the bank or wallet on the opening date. Never enter passwords, PINs or full card numbers." }).then(async (f) => {
      if (!f) return; try { await Fn().saveAccount({ id: a && a.id, name: f.name, type: f.type, currency: f.currency, bankName: f.bank, maskedNumber: f.num || (a && a.maskedNumber) || "", openingMinor: Math.round((+f.op || 0) * 100), openingDate: f.od, status: f.st, notes: f.notes }, f.r); U.toast("Account saved."); done && done(); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); } });
  }
  async function accountDetail(id, D) {
    const a = Object.assign({ id }, D.accounts[id]), lines = await Fn().statementLines(id), rec = C().reconcile(a, D.txs, lines), hist = await Fn().reconHistory(id);
    const mine = D.txs.filter((t) => t.fromAcct === id || t.toAcct === id), taken = new Set(lines.map((l) => l.matchedTx).filter(Boolean));
    U.openModal(`<div class="row between"><div><span class="eyebrow">${esc(C().ACCOUNT_TYPES[a.type])} · ${esc(a.currency)}</span><h2>${esc(a.name)}</h2></div><div class="row"><button class="btn ghost sm" id="ad-e">Edit</button><button class="btn ghost sm" id="ad-imp">${U.svg("export")} Import statement (CSV)</button></div></div>
      <div class="kcards sm"><div class="kc"><span class="eyebrow">Book balance</span><b class="num">${m(rec.bookMinor, a.currency)}</b></div><div class="kc"><span class="eyebrow">Statement balance</span><b class="num">${rec.statementMinor == null ? "—" : m(rec.statementMinor, a.currency)}</b><span class="tiny muted">${esc(a.statementDate || "")}</span></div>
        <div class="kc ${rec.diffMinor ? "err" : ""}"><span class="eyebrow">Difference</span><b class="num">${rec.diffMinor == null ? "—" : m(rec.diffMinor, a.currency)}</b></div><div class="kc"><span class="eyebrow">Last reconciliation</span><b class="num">${a.lastRecon ? esc(a.lastRecon.asOf) : "never"}</b></div></div>
      <div class="grid2"><div class="card"><h3>Statement lines not matched (${rec.unmatchedLines.length})</h3>${rec.unmatchedLines.length ? `<div class="tablewrap"><table class="mtable"><tbody>${rec.unmatchedLines.slice(0, 60).map((l) => { const s = C().suggestMatch(l, a, D.txs, taken); return `<tr><td class="small">${esc(l.date)}</td><td class="small">${esc(l.desc || l.ref || "")}</td><td class="r num ${l.amountMinor < 0 ? "neg" : ""}">${m(l.amountMinor, a.currency)}</td><td>${s ? `<button class="btn lime xs" data-mt="${esc(l.id)}" data-ref="${esc(s.ref)}" title="${esc(s.description)}">Match ${esc(s.ref)}</button>` : `<span class="tiny muted">no recorded match — record the transfer</span>`}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="small muted">Everything imported is matched.</p>`}</div>
        <div class="card"><h3>Recorded but not on the statement (${rec.unmatchedTx.length})</h3>${txTable(rec.unmatchedTx.slice(0, 40), D.accounts)}</div></div>
      <div class="card row"><b class="small">Record reconciliation</b><label class="field"><span>As of</span><input class="in sm" type="date" id="ad-asof" value="${esc(a.statementDate || today())}"></label><label class="field"><span>Statement balance</span><input class="in sm num" type="number" step="0.01" id="ad-sb" value="${rec.statementMinor != null ? rec.statementMinor / 100 : ""}"></label><label class="field"><span>Notes</span><input class="in sm" id="ad-n"></label><button class="btn lime sm" id="ad-rec">Save</button></div>
      <details><summary class="small">All transactions on this account (${mine.length})</summary>${txTable(mine, D.accounts)}</details>
      <details><summary class="small">Reconciliation history (${hist.length})</summary><ul class="small">${hist.map((h) => `<li>${esc(h.asOf)} · statement ${m(h.statementMinor, a.currency)} · book ${m(h.bookMinor, a.currency)} · difference <b>${m(h.diffMinor, a.currency)}</b> · ${esc(name(h.by))}${h.notes ? " · " + esc(h.notes) : ""}</li>`).join("") || "<li>None yet.</li>"}</ul></details>
      <p class="small" id="ad-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="ad-x">Close</button></div>`, (mm) => {
      const refresh = async () => { U.closeModal(); const D2 = await load(); accountDetail(id, D2); };
      $("#ad-x", mm).onclick = () => U.closeModal(); $("#ad-e", mm).onclick = () => { U.closeModal(); accountForm(a, () => renderAccounts()); };
      $("#ad-imp", mm).onclick = () => U.pickFile(".csv,text/csv", async (f) => { try { const r = await Fn().importStatement(id, await f.text(), f.name); U.toast(`${r.added} line(s) imported${r.dup ? `, ${r.dup} already there` : ""}.`); refresh(); } catch (e) { $("#ad-err", mm).textContent = e.message; } });
      $$("[data-mt]", mm).forEach((b) => (b.onclick = async () => { try { await Fn().matchLine(id, b.dataset.mt, b.dataset.ref); refresh(); } catch (e) { $("#ad-err", mm).textContent = e.message; } }));
      bindTxRows(mm, D, () => renderAccounts());
      $("#ad-rec", mm).onclick = async () => { try { const r = await Fn().saveRecon(id, { asOf: $("#ad-asof", mm).value, statementMinor: toMinor($("#ad-sb", mm).value), notes: $("#ad-n", mm).value }); U.toast(r.diffMinor ? `Recorded — difference ${H.money2(r.diffMinor, a.currency)} to investigate.` : "Reconciled: book and statement agree."); refresh(); } catch (e) { $("#ad-err", mm).textContent = e.message; } };
    }, { wide: true });
  }

  U.register("finance", renderFinance); U.register("transfers", renderTransfers); U.register("finaccounts", renderAccounts);
  root.DPFinUI = { load, figures, txTable, bindTxRows, txDetail, transferForm, accountOptions, pill, m, toMinor, today, monthStart, prompt2, periodBar, P, bindGo, tile };
})(typeof self !== "undefined" ? self : this);
