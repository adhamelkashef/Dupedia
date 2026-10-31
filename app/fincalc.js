/* X FORCE 1.2 (Dupedia) — Finance rules and calculations. Pure functions, no storage, no DOM.
   ONE source of truth used by the app (app/finance.js, the screens), by the Cloudflare Worker (worker/index.js, which
   refuses writes that break these rules) and by the tests (qa/fincalc.test.js).

   MONEY is always an integer number of minor units (piastres): never floating point.

   LEDGER. Every movement of money is one transaction (fin/tx/t/<ref>):
     direction "in"        money received into one company account (toAcct)            e.g. a customer receipt
     direction "out"       money paid from one company account (fromAcct)              e.g. salary, supplier, worker
     direction "internal"  money moved between two company accounts (fromAcct → toAcct) e.g. bank → company wallet
   POSTING RULE: a transaction changes book balances ONLY when its status is "verified". Draft, pending, approved,
   recorded and awaiting-verification transactions never move a balance. A verified transaction is never edited or
   deleted: a correction is a linked REVERSAL (a new verified transaction in the opposite direction, reversalOf → original),
   so history stays complete and the net effect is zero.
   CONSOLIDATED CASH. Company-wide inflows/outflows count only "in" and "out". Internal transfers move money between
   our own accounts: they change each account's balance but never count as income or expense.
   InstaPay is a payment CHANNEL (method), not a second movement: a customer InstaPay payment into the bank is one "in"
   transaction into the bank account; paying a worker's InstaPay wallet is one "out" transaction from our account. */
(function (root) {
  "use strict";
  const ACCOUNT_TYPES = { bank: "Bank account", instapay: "InstaPay settlement account", wallet: "Company wallet", petty: "Petty cash", other: "Other payment account" };
  const METHODS = ["Bank transfer", "InstaPay", "Wallet", "Cash", "Cheque", "Card", "Other"];
  const DIRECTIONS = { in: "Incoming", out: "Outgoing", internal: "Internal transfer" };
  // type → default direction, whether it needs approval before payment, which accountant permission approves it
  const TYPES = {
    customer_receipt: { label: "Customer receipt", dir: "in", approval: false, perm: "approvePayments", payee: "customer" },
    refund_in: { label: "Refund received", dir: "in", approval: false, perm: "approvePayments", payee: "other" },
    other_income: { label: "Other income", dir: "in", approval: false, perm: "approvePayments", payee: "other" },
    salary: { label: "Employee salary", dir: "out", approval: true, perm: "approvePayroll", payee: "employee" },
    commission: { label: "Sales commission", dir: "out", approval: true, perm: "approveCommission", payee: "employee" },
    worker_salary: { label: "Worker salary / wage", dir: "out", approval: true, perm: "approvePayroll", payee: "worker" },
    worker_payment: { label: "Worker / installation payment", dir: "out", approval: true, perm: "approveExpenses", payee: "worker" },
    outsourced: { label: "Outsourced worker / workshop", dir: "out", approval: true, perm: "approveExpenses", payee: "supplier" },
    factory: { label: "Factory payment", dir: "out", approval: true, perm: "approveExpenses", payee: "supplier" },
    supplier: { label: "Supplier / material purchase", dir: "out", approval: true, perm: "approveExpenses", payee: "supplier" },
    expense: { label: "Operating expense", dir: "out", approval: true, perm: "approveExpenses", payee: "other" },
    transport: { label: "Transport / delivery", dir: "out", approval: true, perm: "approveExpenses", payee: "other" },
    tax: { label: "Tax payment", dir: "out", approval: true, perm: "recordTax", payee: "tax" },
    refund_out: { label: "Refund to customer", dir: "out", approval: true, perm: "approvePayments", payee: "customer" },
    other_out: { label: "Other business payment", dir: "out", approval: true, perm: "approveExpenses", payee: "other" },
    internal: { label: "Internal transfer", dir: "internal", approval: true, perm: "approvePayments", payee: null },
    reversal: { label: "Reversal", dir: null, approval: false, perm: "approvePayments", payee: null },
  };
  const STATUS = {
    draft: "Draft", pending_approval: "Pending approval", approved: "Approved", payment_recorded: "Payment recorded",
    awaiting_verification: "Awaiting verification", verified: "Verified", rejected: "Rejected", cancelled: "Cancelled",
  };
  const POSTED = (t) => !!t && t.status === "verified";
  // allowed transitions (from → [to])
  const FLOW = {
    draft: ["pending_approval", "approved", "payment_recorded", "awaiting_verification", "cancelled"],
    pending_approval: ["approved", "rejected", "cancelled"],
    approved: ["payment_recorded", "awaiting_verification", "cancelled"],
    payment_recorded: ["awaiting_verification", "verified", "rejected", "cancelled"],
    awaiting_verification: ["verified", "rejected", "payment_recorded"],
    rejected: [], cancelled: [], verified: [],
  };
  // fields of a verified (posted) transaction that may never change afterwards
  const TX_FROZEN = ["ref", "date", "type", "direction", "fromAcct", "toAcct", "amountMinor", "currency", "verifiedBy", "verifiedAt", "reversalOf"];
  const DEFAULT_CFG = {
    accountant: { approvePayments: false, verifyCustomerPayments: true, approvePayroll: false, approveCommission: false, approveExpenses: false, finalizeInvoices: true, recordTax: false, exportSensitive: false },
    sod: true,                      // separation of duties: the person who prepares / records a transaction cannot approve / verify it
    methodAccounts: {},             // payment method → default account id for customer receipts
    salesInvoices: "draft",         // "draft" (sales prepare, Finance issues) or "issue"
    payslipsVisible: true,          // employees can see and download their own payslips
    highValueMinor: 50000000,       // EGP 500,000: transactions above this are highlighted for the CEO
  };
  const cfgOf = (c) => { const x = Object.assign({}, DEFAULT_CFG, c || {}); x.accountant = Object.assign({}, DEFAULT_CFG.accountant, (c && c.accountant) || {}); return x; };

  const int = (v) => (v == null || v === "" ? 0 : Math.round(+v));
  const isMinor = (v) => Number.isInteger(v) && v >= 0 && v <= 1e13;
  const sum = (l, f = (x) => x) => (l || []).reduce((s, x) => s + int(f(x)), 0);
  const inRange = (d, from, to) => (!from || String(d) >= from) && (!to || String(d) <= to);

  /* ---------------- validation ---------------- */
  /** Structural checks for a transaction document. Returns an error message or null. */
  function validateTx(t, accounts = null) {
    if (!t || typeof t !== "object") return "Missing transaction.";
    if (!/^[A-Za-z0-9-]{6,40}$/.test(String(t.ref || ""))) return "Missing or invalid transaction reference.";
    if (!TYPES[t.type]) return "Unknown transaction type.";
    if (!DIRECTIONS[t.direction]) return "Unknown direction.";
    if (t.type !== "reversal" && TYPES[t.type].dir && TYPES[t.type].dir !== t.direction) return "The direction does not match the transaction type.";
    if (!isMinor(t.amountMinor) || t.amountMinor === 0) return "The amount must be a positive whole number of piastres.";
    if (!/^[A-Z]{3}$/.test(String(t.currency || ""))) return "Invalid currency.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ""))) return "Invalid date.";
    if (!STATUS[t.status]) return "Unknown status.";
    if (t.direction === "in" && !t.toAcct && POSTED(t)) return "Choose the account the money was received into.";
    if (t.direction === "out" && !t.fromAcct && POSTED(t)) return "Choose the account the money was paid from.";
    if (t.direction === "internal" && (!t.fromAcct || !t.toAcct || t.fromAcct === t.toAcct)) return "An internal transfer needs two different company accounts.";
    if (accounts) {
      for (const k of [t.direction !== "in" ? "fromAcct" : null, t.direction !== "out" ? "toAcct" : null].filter(Boolean)) {
        const a = accounts[t[k]]; if (!t[k]) continue;
        if (!a) return "The selected account does not exist.";
        if (a.currency && a.currency !== t.currency) return `The ${a.name || "account"} account is in ${a.currency}; the transaction is in ${t.currency}.`;
        if (a.status === "closed" && POSTED(t)) return `The ${a.name || "account"} account is closed.`;
      }
    }
    return null;
  }
  /** Server-side guard for a change to a transaction: who may move it to which status (permissions + separation of
   *  duties) and that a posted transaction never changes. who = {uid, level: "owner"|"admin"|"finance"|"interact"}. */
  function guardTx(who, old, next, cfg) {
    cfg = cfgOf(cfg);
    const admin = who.level === "owner" || who.level === "admin", fin = who.level === "finance";
    if (!admin && !fin) return "Finance users only.";
    const err = validateTx(next); if (err) return err;
    if (old && old.ref !== next.ref) return "The reference cannot change.";
    if (old && POSTED(old)) {
      for (const f of TX_FROZEN) if (JSON.stringify(old[f] ?? null) !== JSON.stringify(next[f] ?? null)) return "A verified transaction cannot be changed. Record a reversal instead.";
      if (next.status !== "verified") return "A verified transaction cannot be changed. Record a reversal instead.";
      return null;
    }
    const from = old ? old.status : null, to = next.status;
    if (old && from !== to && !(FLOW[from] || []).includes(to)) return `A transaction cannot go from "${STATUS[from]}" to "${STATUS[to]}".`;
    if (!old && !["draft", "pending_approval", "approved", "payment_recorded", "awaiting_verification", "verified"].includes(to)) return "A new transaction must start as draft, pending, approved, recorded or verified.";
    const T = TYPES[next.type] || {}, perm = T.perm, acc = cfg.accountant;
    const may = (p) => admin || (fin && !!acc[p]);
    const self = (field) => next[field] && next[field] !== who.uid;
    // approval
    // approving = moving INTO an approved-or-later state from draft / pending (or creating it there); later edits of an
    // approved transaction (attaching proof, recording the payment) are not approvals
    const approving = (!old || ["draft", "pending_approval"].includes(from)) && from !== to && ["approved", "payment_recorded", "awaiting_verification", "verified"].includes(to) && T.approval;
    if (approving && T.approval && !next.preApproved) {
      if (!may(perm)) return "You are not authorised to approve this type of transaction.";
      if (self("approvedBy")) return "The approver must be the person approving.";
      if (cfg.sod && fin && next.preparedBy === who.uid) return "Separation of duties: you prepared this transaction, so another person must approve it.";
    }
    if (next.preApproved && !old && !["commission", "salary", "worker_salary", "worker_payment", "supplier", "tax", "outsourced", "factory"].includes(next.type)) return "Only payouts of an already approved record can skip approval.";
    // verification (posting)
    if (to === "verified" && from !== "verified") {
      const vperm = next.type === "customer_receipt" ? "verifyCustomerPayments" : perm;
      if (!may(vperm) && !(fin && next.type === "customer_receipt" && acc.approvePayments)) return "You are not authorised to verify this transaction.";
      if (self("verifiedBy")) return "The verifier must be the person verifying.";
      if (cfg.sod && fin && (next.recordedBy === who.uid || (!next.recordedBy && next.preparedBy === who.uid)) && next.type !== "customer_receipt" && next.type !== "reversal") return "Separation of duties: you recorded this payment, so another person must verify it.";
      if (next.type !== "customer_receipt" && next.type !== "reversal" && !(next.proofs || []).length) return "Attach the payment proof before verifying.";
    }
    return null;
  }

  /* ---------------- balances and cash flow ---------------- */
  /** Effect of one posted transaction on each account: {acctId: ±minor}. */
  function effect(t) {
    if (!POSTED(t)) return {};
    const a = int(t.amountMinor), e = {};
    if (t.direction === "in") e[t.toAcct] = a;
    else if (t.direction === "out") e[t.fromAcct] = -a;
    else if (t.direction === "internal") { e[t.fromAcct] = -a; e[t.toAcct] = (e[t.toAcct] || 0) + a; }
    return e;
  }
  /** Book balance of every account as of `asOf` (inclusive): opening + posted movements dated on/after the opening date. */
  function balances(accounts, txs, asOf = null) {
    const out = {};
    for (const a of Object.values(accounts || {})) out[a.id] = { id: a.id, name: a.name, type: a.type, currency: a.currency, status: a.status, openingMinor: int(a.openingMinor), bookMinor: int(a.openingMinor), in: 0, out: 0, count: 0 };
    for (const t of txs || []) {
      if (!POSTED(t) || (asOf && t.date > asOf)) continue;
      for (const [id, d] of Object.entries(effect(t))) {
        const b = out[id]; if (!b) continue;
        const a = accounts[id]; if (a && a.openingDate && t.date < a.openingDate) continue;   // the opening balance already includes earlier movements
        b.bookMinor += d; if (d > 0) b.in += d; else b.out -= d; b.count++;
      }
    }
    return out;
  }
  /** Company-wide cash flow for a period, per currency. Internal transfers are listed separately and never count as in/out. */
  function cashflow(txs, { from = null, to = null } = {}) {
    const by = {};
    const cur = (c) => (by[c] = by[c] || { currency: c, inMinor: 0, outMinor: 0, internalMinor: 0, netMinor: 0, inCount: 0, outCount: 0, internalCount: 0, byType: {} });
    for (const t of txs || []) {
      if (!POSTED(t) || !inRange(t.date, from, to)) continue;
      const c = cur(t.currency), a = int(t.amountMinor);
      if (t.direction === "internal") { c.internalMinor += a; c.internalCount++; continue; }
      const k = t.type === "reversal" ? `reversal_${t.direction}` : t.type;
      c.byType[k] = (c.byType[k] || 0) + a;
      if (t.direction === "in") { c.inMinor += a; c.inCount++; } else { c.outMinor += a; c.outCount++; }
    }
    for (const c of Object.values(by)) c.netMinor = c.inMinor - c.outMinor;
    return by;
  }
  /** Monthly in/out per currency for trend charts: [{month, inMinor, outMinor, netMinor}] */
  function monthly(txs, currency = "EGP") {
    const m = {};
    for (const t of txs || []) { if (!POSTED(t) || t.currency !== currency || t.direction === "internal") continue; const k = String(t.date).slice(0, 7), x = (m[k] = m[k] || { month: k, inMinor: 0, outMinor: 0 }); if (t.direction === "in") x.inMinor += int(t.amountMinor); else x.outMinor += int(t.amountMinor); }
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).map((x) => Object.assign(x, { netMinor: x.inMinor - x.outMinor }));
  }
  /** Bank reconciliation: book vs statement, and which lines/transactions are still unmatched. */
  function reconcile(account, txs, lines, asOf) {
    const b = balances({ [account.id]: account }, txs, asOf)[account.id];
    const mine = (txs || []).filter((t) => POSTED(t) && (t.fromAcct === account.id || t.toAcct === account.id) && (!asOf || t.date <= asOf));
    const matched = new Set((lines || []).map((l) => l.matchedTx).filter(Boolean));
    const ls = (lines || []).filter((l) => !asOf || l.date <= asOf).sort((a, c) => (a.date + (a.n || 0)).localeCompare(c.date + (c.n || 0)));
    const withBal = ls.filter((l) => l.balanceMinor != null);
    const stmt = account.statementBalanceMinor != null && (!asOf || !withBal.length) ? int(account.statementBalanceMinor) : withBal.length ? int(withBal[withBal.length - 1].balanceMinor) : null;
    return { bookMinor: b.bookMinor, statementMinor: stmt, diffMinor: stmt == null ? null : stmt - b.bookMinor,
      unmatchedLines: ls.filter((l) => !l.matchedTx), unmatchedTx: mine.filter((t) => !matched.has(t.ref)) };
  }
  /** Suggest a statement line ↔ transaction match: same signed amount, same account, dates within 5 days, unmatched. */
  function suggestMatch(line, account, txs, taken = new Set()) {
    const signed = (t) => (effect(t)[account.id] || 0);
    const c = (txs || []).filter((t) => POSTED(t) && !taken.has(t.ref) && signed(t) === int(line.amountMinor) && Math.abs(Date.parse(t.date) - Date.parse(line.date)) <= 5 * 864e5);
    c.sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(line.date)) - Math.abs(Date.parse(b.date) - Date.parse(line.date)) || (line.ref && b.bankRef === line.ref ? 1 : 0) - (line.ref && a.bankRef === line.ref ? 1 : 0));
    return c[0] || null;
  }
  /** Parse a bank statement CSV (date, description, amount OR debit/credit, optional reference and balance). */
  function parseStatementCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true; else if (ch === "," || ch === ";" || ch === "\t") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch; }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const R = rows.filter((r) => r.some((c) => String(c).trim()));
    if (R.length < 2) throw new Error("The file has no statement lines.");
    const h = R[0].map((x) => String(x).trim().toLowerCase());
    const col = (...names) => h.findIndex((x) => names.some((n) => x === n || x.includes(n)));
    const ci = { date: col("date", "تاريخ"), desc: col("description", "details", "narrative", "memo", "البيان"), amount: col("amount", "المبلغ"), debit: col("debit", "withdrawal", "مدين"), credit: col("credit", "deposit", "دائن"), ref: col("reference", "ref"), bal: col("balance", "الرصيد") };
    if (ci.date < 0 || (ci.amount < 0 && ci.debit < 0 && ci.credit < 0)) throw new Error("The statement needs a Date column and an Amount column (or Debit and Credit columns).");
    const money = (s) => { s = String(s || "").replace(/[^\d.,()-]/g, ""); if (!s) return 0; const neg = /^\(.*\)$/.test(s) || s.startsWith("-"); s = s.replace(/[()-]/g, ""); if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, ""); else if (s.includes(",") && !s.includes(".")) s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, ""); const v = Math.round(parseFloat(s) * 100); return Number.isFinite(v) ? (neg ? -v : v) : 0; };
    const day = (s) => { s = String(s || "").trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return null; };
    const out = [];
    R.slice(1).forEach((r, n) => {
      const date = day(r[ci.date]); if (!date) return;
      const amount = ci.amount >= 0 && String(r[ci.amount] || "").trim() ? money(r[ci.amount]) : money(r[ci.credit]) - Math.abs(money(r[ci.debit]));
      if (!amount) return;
      out.push({ n, date, desc: ci.desc >= 0 ? String(r[ci.desc] || "").trim().slice(0, 200) : "", ref: ci.ref >= 0 ? String(r[ci.ref] || "").trim().slice(0, 80) : "", amountMinor: amount, balanceMinor: ci.bal >= 0 && String(r[ci.bal] || "").trim() ? money(r[ci.bal]) : null });
    });
    if (!out.length) throw new Error("No dated lines with an amount were found.");
    return out;
  }

  /* ---------------- payroll ---------------- */
  /** Gross = base + allowances + bonuses; Net = gross − deductions − recoveries + approved adjustments. */
  function payroll(line) {
    const allow = sum(line.allowances, (x) => x.amountMinor), bonus = sum(line.bonuses, (x) => x.amountMinor), comm = sum(line.commissions || [], (x) => x.amountMinor);   // 1.4.6: approved commission, its own line
    const ded = sum(line.deductions, (x) => x.amountMinor), rec = sum(line.recoveries, (x) => x.amountMinor);
    const adj = sum((line.adjustments || []).filter((x) => x.approved !== false), (x) => x.amountMinor);
    const gross = int(line.baseMinor) + allow + bonus + comm, net = gross - ded - rec + adj;
    return { baseMinor: int(line.baseMinor), allowancesMinor: allow, bonusesMinor: bonus, commissionsMinor: comm, grossMinor: gross, deductionsMinor: ded, recoveriesMinor: rec, adjustmentsMinor: adj, netMinor: net };
  }
  const PAYROLL_STATUS = { prepared: "Payroll prepared", pending_approval: "Awaiting approval", approved: "Approved for payment", partly_paid: "Partially paid", paid: "Paid", failed: "Payment rejected / failed" };
  /** Payment status of anything paid through the ledger: obligation amount vs verified linked transactions. */
  function paidStatus(dueMinor, txs) {
    const verified = sum((txs || []).filter(POSTED).map((t) => (t.direction === "out" || t.direction === "in" ? (t.type === "reversal" ? -t.amountMinor : t.amountMinor) : 0)));
    const pending = sum((txs || []).filter((t) => ["approved", "payment_recorded", "awaiting_verification", "pending_approval"].includes(t.status)), (t) => t.amountMinor);
    const due = int(dueMinor), out = Math.max(0, due - verified);
    return { dueMinor: due, paidMinor: verified, pendingMinor: pending, outstandingMinor: out, overpaidMinor: Math.max(0, verified - due), state: verified <= 0 ? (pending ? "in_progress" : "unpaid") : verified >= due ? "paid" : "partly_paid" };
  }

  /* ---------------- tax ---------------- */
  const TAX_KINDS = { standard: "Taxable (standard)", reduced: "Taxable (other rate)", zero: "Zero-rated", exempt: "Exempt", non_taxable: "Non-taxable / outside scope" };
  /** Tax on a base. rateBp = basis points (1400 = 14 %). Exclusive: tax = base × rate. Inclusive: the base already
   *  contains the tax: tax = base × rate / (1 + rate). Zero / exempt / non-taxable: no tax. Rounded half-up per line. */
  function taxOf(baseMinor, rule) {
    const base = int(baseMinor);
    if (!rule || ["zero", "exempt", "non_taxable"].includes(rule.kind) || !(+rule.rateBp > 0)) return { netMinor: base, taxMinor: 0, grossMinor: base, rateBp: rule ? +rule.rateBp || 0 : 0, inclusive: !!(rule && rule.inclusive) };
    const r = +rule.rateBp;
    if (rule.inclusive) { const tax = Math.round(base * r / (10000 + r)); return { netMinor: base - tax, taxMinor: tax, grossMinor: base, rateBp: r, inclusive: true }; }
    const tax = Math.round(base * r / 10000); return { netMinor: base, taxMinor: tax, grossMinor: base + tax, rateBp: r, inclusive: false };
  }
  /** Document totals: lines (qty × unit), a discount before tax (when discountBeforeTax, default) and one tax rule. */
  function docTotals({ lines = [], discountMinor = 0, rule = null, discountBeforeTax = true }) {
    const sub = sum(lines, (l) => Math.round((+l.qty || 0) * int(l.unitMinor)));
    const disc = Math.min(int(discountMinor), sub);
    if (discountBeforeTax) { const t = taxOf(sub - disc, rule); return { subtotalMinor: sub, discountMinor: disc, taxableMinor: t.netMinor, taxMinor: t.taxMinor, totalMinor: t.inclusive ? sub - disc : t.grossMinor, rateBp: t.rateBp, inclusive: t.inclusive }; }
    const t = taxOf(sub, rule); return { subtotalMinor: sub, discountMinor: disc, taxableMinor: t.netMinor, taxMinor: t.taxMinor, totalMinor: (t.inclusive ? sub : t.grossMinor) - disc, rateBp: t.rateBp, inclusive: t.inclusive };
  }
  /** Tax-period summary from issued tax invoices (output tax), approved purchases with recoverable tax (input tax) and
   *  verified tax payments. An ESTIMATE for review by a qualified accountant — never a filing. */
  function taxSummary({ invoices = [], purchases = [], txs = [], rules = {}, from = null, to = null }) {
    const out = (invoices || []).filter((d) => d.status === "issued" && inRange(d.date, from, to));
    const output = sum(out.filter((d) => d.kind === "tax_invoice"), (d) => d.taxMinor) - sum(out.filter((d) => d.kind === "credit_note"), (d) => d.taxMinor);
    const inp = (purchases || []).filter((p) => p.status !== "cancelled" && p.status !== "pending_approval" && inRange(p.date, from, to) && (rules[p.taxRuleId] || {}).recoverable);
    const input = sum(inp, (p) => p.taxMinor);
    const paid = sum((txs || []).filter((t) => POSTED(t) && t.type === "tax" && inRange(t.date, from, to)), (t) => t.amountMinor);
    const net = output - input;
    return { outputTaxMinor: output, inputTaxMinor: input, netLiabilityMinor: net, paidMinor: paid, outstandingMinor: net - paid, invoices: out.length, purchases: inp.length,
      missingDocs: inp.filter((p) => !(p.docs || []).length).length + out.filter((d) => d.kind === "tax_invoice" && !d.customer?.taxId).length };
  }

  /* ---------------- purchases and order costs ---------------- */
  function purchaseTotals(p) {
    const t = docTotals({ lines: (p.lines || []).map((l) => ({ qty: l.qty, unitMinor: l.unitPriceMinor })), discountMinor: p.discountMinor, rule: p.taxRule || null });
    return t;
  }
  /** Share of a purchase charged to one order: explicit allocation percentages (must add up to ≤ 100 %), or the single
   *  linked order. Returns minor units. */
  function allocated(p, oid) {
    const tot = int(p.totalMinor);
    if (Array.isArray(p.alloc) && p.alloc.length) { const a = p.alloc.find((x) => x.oid === oid); return a ? Math.round(tot * (+a.pct || 0) / 100) : 0; }
    return p.oid === oid ? tot : 0;
  }
  /** Actual project costs for one order, from records that exist — never from price-book estimates.
   *  committed = approved purchases allocated to the order; labour = approved worker dues; paid = verified ledger money. */
  function orderCosts(oid, { purchases = [], dues = [], txs = [] }) {
    const P = (purchases || []).filter((p) => !["cancelled", "pending_approval", "rejected"].includes(p.status) && allocated(p, oid) > 0);
    const D = (dues || []).filter((d) => d.oid === oid && !["cancelled", "pending_approval", "rejected"].includes(d.status));
    const T = (txs || []).filter((t) => POSTED(t) && t.orderId === oid && t.direction === "out");
    const byCat = {};
    for (const p of P) { const k = p.category || "materials"; byCat[k] = (byCat[k] || 0) + allocated(p, oid); }
    for (const d of D) { const k = d.kind === "installation" ? "installation" : "labour"; byCat[k] = (byCat[k] || 0) + int(d.amountDueMinor); }
    // direct expenses paid against the order that are not a payment of a purchase or a worker due (those are already counted)
    const direct = T.filter((t) => !(t.links && (t.links.purchase || t.links.wdue || t.links.commission || t.links.payroll)) && t.type !== "refund_out");
    for (const t of direct) { const k = t.type === "transport" ? "transport" : t.type === "outsourced" ? "outsourced" : t.type === "factory" ? "manufacturing" : "other"; byCat[k] = (byCat[k] || 0) + int(t.amountMinor); }
    const committed = sum(Object.values(byCat));
    const paid = sum(T.filter((t) => t.type !== "refund_out" && !(t.links && t.links.commission)), (t) => t.amountMinor);
    return { byCategory: byCat, committedMinor: committed, paidMinor: paid, unpaidMinor: Math.max(0, committed - paid), purchases: P.length, dues: D.length, directTx: direct.length };
  }
  /** Order profitability from ACTUAL records: value (ex-tax), verified cash received, actual costs → contribution.
   *  Labelled an estimate when cost records are incomplete (nothing recorded, or work not yet completed). */
  function orderProfit(order, costs, { completed = false } = {}) {
    const value = Math.max(0, int(order.totalMinor) - int(order.taxMinor) + sum((order.valueAdjustments || []).filter((a) => a && a.status !== "void"), (a) => a.amountMinor));
    const cash = sum((order.payments || []).filter((p) => p.status === "verified"), (p) => p.amountMinor);
    const contribution = value - costs.committedMinor;
    const missing = [];
    if (!costs.purchases) missing.push("No material purchases are linked to this order.");
    if (!costs.dues) missing.push("No worker or installation costs are linked to this order.");
    if (!completed) missing.push("The order is not completed, so more costs may follow.");
    return { valueExTaxMinor: value, cashReceivedMinor: cash, costsMinor: costs.committedMinor, contributionMinor: contribution, marginPct: value ? Math.round(contribution / value * 1000) / 10 : null, estimate: missing.length > 0, missing };
  }

  /* ---------------- references ---------------- */
  const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
  function newRef(prefix = "TX", d = new Date()) { const r = Math.random().toString(36).slice(2, 7).toUpperCase(); return `${prefix}-${ymd(d).replace(/-/g, "")}-${r}${Date.now().toString(36).slice(-3).toUpperCase()}`; }
  const DOC_PREFIX = { receipt: "RCPT", tax_invoice: "INV", credit_note: "CN" };
  const docNumber = (kind, year, n) => `${DOC_PREFIX[kind] || "DOC"}-${year}-${String(n).padStart(5, "0")}`;

  root.DPFinCalc = { ACCOUNT_TYPES, METHODS, DIRECTIONS, TYPES, STATUS, FLOW, TX_FROZEN, DEFAULT_CFG, cfgOf, POSTED, validateTx, guardTx, effect, balances, cashflow, monthly,
    reconcile, suggestMatch, parseStatementCsv, payroll, PAYROLL_STATUS, paidStatus, TAX_KINDS, taxOf, docTotals, taxSummary, purchaseTotals, allocated, orderCosts, orderProfit,
    newRef, docNumber, DOC_PREFIX, inRange, sum, int };
})(typeof self !== "undefined" ? self : this);
