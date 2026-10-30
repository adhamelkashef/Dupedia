/* X FORCE 1.2 (Dupedia) — Finance data layer: accounts, the Transfers ledger, payroll, worker payments, purchases,
   invoices / receipts, taxes, reconciliation. Calculations live in app/fincalc.js (DPFinCalc); the Cloudflare Worker
   enforces the same rules on every write (permissions, separation of duties, posted transactions frozen, audit trail).

   Paths (all admin / Accountant only, see store.js RULES + FINANCE_RULES):
     fin/cfg                         finance settings and the Accountant's permissions (written by the administrator)
     fin/accounts/a/<id>             bank / InstaPay / wallet / petty-cash accounts (opening balance + date)
     fin/tx/t/<ref>                  ledger transactions (one per movement of money)        fin/txf/<ref>/<fid>/c/NNN  proofs
     fin/stmt/<acct>/<id>            imported bank statement lines        fin/recon/r/<id>   reconciliation history
     fin/salary/p/<uid>              employee salary profile              fin/payroll/r/<period>-<uid>  payroll line
     fin/wprof/w/<wid>               worker payment profile (wallet reference: finance only)
     fin/wdue/d/<id>                 worker amount due (salary, wage, installation, project fee, advance, reimbursement)
     fin/supp/s/<id>                 suppliers                            fin/purch/p/<ref>  purchases
     fin/inv/i/<number>              receipts, tax invoices, credit notes  fin/tax/r/<id>     tax rules
     payslips/<uid>/p/<period>       the employee's own copy of their payslip
     requests/<uid>/inv/<id>         invoice / receipt drafts prepared by sales */
/* global DPStore, DPAuth, DPFinCalc, DPOrders, DPSales, DPPay, DPNotify */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, C = () => root.DPFinCalc, NT = () => root.DPNotify;
  const now = () => new Date().toISOString(), today = () => now().slice(0, 10);
  const meId = () => (AU().A.me || {}).id;
  const isAdmin = () => AU().isAdmin(), isAcc = () => AU().isFinance && AU().isFinance();
  const F = { cfg: null, at: 0 };

  /* ---------------- access ---------------- */
  async function cfg(force = false) { if (!F.cfg || force || Date.now() - F.at > 60e3) { F.cfg = C().cfgOf(await DS().tryGet("fin/cfg")); F.at = Date.now(); } return F.cfg; }
  const isFin = () => isAdmin() || isAcc();
  /** May the signed-in person do `perm` (one of the Accountant permissions)? Administrators always may. */
  function can(perm) { if (isAdmin()) return true; if (!isAcc()) return false; const c = F.cfg || C().cfgOf(null); return !!c.accountant[perm]; }
  const req = (perm) => { if (!isFin()) throw new Error("Finance users only."); if (perm && !can(perm)) throw new Error("The administrator has not given you permission for this."); };
  async function saveCfg(next, reason = "") {
    if (!isAdmin()) throw new Error("Only the administrator changes finance settings.");
    const before = await DS().tryGet("fin/cfg"); await DS().set("fin/cfg", Object.assign({}, next, { updatedAt: now(), updatedBy: meId() }));
    F.cfg = null; await AU().auditLog("Finance settings changed", { kind: "finance", target: "fin/cfg", reason, before, after: next });
  }
  const audit = (action, o = {}) => AU().auditLog(action, Object.assign({ kind: "finance" }, o));
  const list = async (coll) => (await DS().tryList(coll)).map((x) => Object.assign({ id: x.id }, x.data));

  /* ---------------- accounts ---------------- */
  async function accounts() { const l = await list("fin/accounts/a"); return Object.fromEntries(l.map((a) => [a.id, a])); }
  async function saveAccount(a, reason = "") {
    req(); if (!String(a.name || "").trim()) throw new Error("Give the account a name.");
    if (!C().ACCOUNT_TYPES[a.type]) throw new Error("Choose the account type."); if (!/^[A-Z]{3}$/.test(a.currency || "")) throw new Error("Choose the currency.");
    if (!Number.isInteger(a.openingMinor)) throw new Error("Enter the opening balance."); if (!/^\d{4}-\d{2}-\d{2}$/.test(a.openingDate || "")) throw new Error("Enter the opening-balance date.");
    const id = a.id || "acc-" + Math.random().toString(36).slice(2, 9), path = `fin/accounts/a/${id}`, prev = await DS().tryGet(path);
    if (prev && (prev.openingMinor !== a.openingMinor || prev.openingDate !== a.openingDate || prev.currency !== a.currency)) {
      const used = (await txs()).some((t) => C().POSTED(t) && (t.fromAcct === id || t.toAcct === id));
      if (used) throw new Error("The opening balance, date and currency are fixed once verified transactions use this account. Record an adjustment transfer instead.");
    }
    const rec = { name: a.name.trim(), type: a.type, currency: a.currency, openingMinor: a.openingMinor, openingDate: a.openingDate, status: a.status || "active", notes: a.notes || "", bankName: a.bankName || "", maskedNumber: String(a.maskedNumber || "").replace(/\d(?=\d{4})/g, "•"), createdAt: (prev && prev.createdAt) || now(), createdBy: (prev && prev.createdBy) || meId(), updatedAt: now(), statementBalanceMinor: prev ? prev.statementBalanceMinor ?? null : null, statementDate: prev ? prev.statementDate || null : null, lastRecon: prev ? prev.lastRecon || null : null };
    await DS().set(path, rec); await audit(prev ? "Financial account changed" : "Financial account created", { target: path, reason, before: prev, after: rec });
    return Object.assign({ id }, rec);
  }

  /* ---------------- transactions ---------------- */
  async function txs() { return (await list("fin/tx/t")).map((t) => Object.assign(t, { ref: t.ref || t.id })).sort((a, b) => String(b.date + b.preparedAt).localeCompare(String(a.date + a.preparedAt))); }
  const txPath = (ref) => `fin/tx/t/${ref}`;
  async function getTx(ref) { const t = await DS().tryGet(txPath(ref)); return t ? Object.assign({ ref }, t) : null; }
  const hist = (t, action, detail = "") => { t.history = (t.history || []).concat([{ at: now(), by: meId(), action, detail: String(detail).slice(0, 300), status: t.status }]); return t; };
  /** Write a transaction (the server validates the transition). */
  async function putTx(t, action, detail) { hist(t, action, detail); await DS().set(txPath(t.ref), t); return t; }
  /** Create a transaction once. `ref` is generated when the form opens, so a double click or network retry cannot create a
   *  second one (create-only on the server). → the stored transaction. */
  async function createTx(input) {
    req(); const T = C().TYPES[input.type]; if (!T) throw new Error("Choose the transaction type.");
    const ref = input.ref || C().newRef(input.type === "internal" ? "TR" : T.dir === "in" ? "RC" : "PY");
    const t = Object.assign({ ref, date: input.date || today(), type: input.type, direction: input.type === "reversal" ? input.direction : T.dir, currency: input.currency || "EGP",
      amountMinor: Math.round(+input.amountMinor || 0), fromAcct: input.fromAcct || null, toAcct: input.toAcct || null, method: input.method || "", bankRef: input.bankRef || "", walletRef: input.walletRef || "",
      payee: input.payee || null, orderId: input.orderId || null, dept: input.dept || "", category: input.category || "", description: String(input.description || "").trim(), notes: input.notes || "",
      proofs: [], docs: [], links: input.links || {}, preparedBy: meId(), preparedAt: now(), status: "draft", preApproved: !!input.preApproved, reversalOf: input.reversalOf || null, reason: input.reason || "" });
    if (!t.description && input.type !== "reversal") throw new Error("Describe exactly what the money is for.");
    const e = C().validateTx(Object.assign({}, t, { status: "draft" })); if (e) throw new Error(e);
    // starting status: payouts of an approved record, income and reversals skip approval; everything else waits for it
    t.status = input.status || (input.type === "reversal" ? "verified" : T.approval && !t.preApproved ? "pending_approval" : T.dir === "in" ? "payment_recorded" : "approved");
    if (t.status === "verified") Object.assign(t, { verifiedBy: meId(), verifiedAt: now(), recordedBy: meId(), recordedAt: now() });
    if (["payment_recorded", "awaiting_verification"].includes(t.status)) Object.assign(t, { recordedBy: meId(), recordedAt: now() });
    hist(t, "Prepared", T.label);
    const r = await DS().create(txPath(ref), t);
    if (!r.created) { const ex = await getTx(ref); if (ex) return ex; throw new Error("This transaction reference already exists."); }
    for (const f of input.files || []) await addProof(ref, f, input.proofKind || "proof");
    await audit("Transaction prepared", { target: ref, detail: `${T.label} · ${t.amountMinor / 100} ${t.currency} · ${t.description}`, after: { status: t.status, amountMinor: t.amountMinor } });
    if (t.status === "pending_approval") await notifyApprovers(t);
    return getTx(ref);
  }
  async function notifyApprovers(t) {
    if (!NT()) return; const T = C().TYPES[t.type] || {};
    await NT().deliver("@admins", { id: `fin-appr-${t.ref}`, type: "payment", priority: t.amountMinor >= (F.cfg || C().DEFAULT_CFG).highValueMinor ? "high" : "normal", title: "Payment awaiting approval", body: `${T.label}: ${(t.amountMinor / 100).toLocaleString()} ${t.currency} — ${t.description}`, link: { view: "transfers", opts: { ref: t.ref } }, ref: t.ref }).catch(() => {});
  }
  async function step(ref, fn, action, detail) { req(); const t = await getTx(ref); if (!t) throw new Error("Transaction not found."); const before = { status: t.status }; fn(t); await putTx(t, action, detail); await audit(`Transaction ${action.toLowerCase()}`, { target: ref, detail, before, after: { status: t.status } }); return t; }
  const approve = (ref, note = "") => step(ref, (t) => { if (t.status !== "pending_approval") throw new Error("Only a transaction awaiting approval can be approved."); t.status = "approved"; t.approvedBy = meId(); t.approvedAt = now(); t.approvalNote = note; }, "Approved", note);
  const reject = (ref, reason) => { if (!String(reason || "").trim()) throw new Error("Give the reason."); return step(ref, (t) => { t.status = "rejected"; t.rejectedBy = meId(); t.rejectedAt = now(); t.reason = reason; }, "Rejected", reason); };
  const cancel = (ref, reason) => { if (!String(reason || "").trim()) throw new Error("Give the reason."); return step(ref, (t) => { t.status = "cancelled"; t.cancelledBy = meId(); t.cancelledAt = now(); t.reason = reason; }, "Cancelled", reason); };
  /** The money has been sent / received: record the method, references and the proof. Not posted yet. */
  async function recordPayment(ref, { method, bankRef, walletRef, date, account, file, note = "" }) {
    if (file) await addProof(ref, file, "proof");
    return step(ref, (t) => {
      if (!["approved", "payment_recorded", "draft"].includes(t.status)) throw new Error("Approve the transaction before recording the payment.");
      if (method) t.method = method; if (bankRef != null) t.bankRef = bankRef; if (walletRef != null) t.walletRef = walletRef; if (date) t.date = date;
      if (account) { if (t.direction === "in") t.toAcct = account; else t.fromAcct = account; }
      t.status = (t.proofs || []).length || file ? "awaiting_verification" : "payment_recorded"; t.recordedBy = meId(); t.recordedAt = now(); t.recordNote = note;
    }, "Payment recorded", [method, bankRef, walletRef].filter(Boolean).join(" · "));
  }
  /** Verify = post. Only now does the balance change; linked records (salary, commission, worker due, purchase) follow. */
  async function verify(ref, note = "") {
    const t = await step(ref, (t) => {
      if (!["payment_recorded", "awaiting_verification"].includes(t.status)) throw new Error("Record the payment before verifying it.");
      if (t.direction !== "in" && !t.fromAcct) throw new Error("Choose the account the money was paid from."); if (t.direction !== "out" && !t.toAcct) throw new Error("Choose the account the money was received into.");
      t.status = "verified"; t.verifiedBy = meId(); t.verifiedAt = now(); t.verifyNote = note;
    }, "Verified", note);
    await afterVerified(t); return t;
  }
  /** Correct a verified transaction with a linked reversal (the original is never edited or deleted). */
  async function reverse(ref, reason) {
    req("approvePayments"); if (!String(reason || "").trim() || reason.trim().length < 5) throw new Error("Explain why the transaction is reversed.");
    const o = await getTx(ref); if (!o || !C().POSTED(o)) throw new Error("Only a verified transaction can be reversed."); if (o.reversedBy) throw new Error("This transaction is already reversed.");
    const flip = { in: "out", out: "in", internal: "internal" }[o.direction];
    const r = await createTx({ type: "reversal", direction: flip, amountMinor: o.amountMinor, currency: o.currency, date: today(), fromAcct: o.direction === "in" ? o.toAcct : o.direction === "internal" ? o.toAcct : null,
      toAcct: o.direction === "out" ? o.fromAcct : o.direction === "internal" ? o.fromAcct : null, reversalOf: o.ref, reason: reason.trim(), description: `Reversal of ${o.ref}: ${reason.trim()}`, orderId: o.orderId, payee: o.payee, links: {} });
    o.reversedBy = r.ref; o.reversedAt = now(); await putTx(o, "Reversed", `${r.ref} · ${reason}`);
    await audit("Transaction reversed", { target: o.ref, reason, detail: `reversal ${r.ref}`, before: { status: "verified" }, after: { reversedBy: r.ref } });
    return r;
  }
  async function addProof(ref, file, kind = "proof") {
    req(); const fid = "f-" + Math.random().toString(36).slice(2, 10);
    const t = await getTx(ref); if (!t) throw new Error("Transaction not found.");
    if (file.hash && (t.proofs || []).concat(t.docs || []).some((p) => p.hash === file.hash)) throw new Error("This file is already attached.");
    await root.DPOrders.putFile(`fin/txf/${ref}/${fid}`, file);
    const meta = { id: fid, name: file.name, type: file.type, size: file.size, hash: file.hash || null, at: now(), by: meId(), kind };
    if (kind === "proof") t.proofs = (t.proofs || []).concat([meta]); else t.docs = (t.docs || []).concat([meta]);
    if (kind === "proof" && t.status === "payment_recorded") t.status = "awaiting_verification";
    await putTx(t, kind === "proof" ? "Proof attached" : "Document attached", file.name);
    return meta;
  }
  const proofFile = (ref, fid) => root.DPOrders.getFile(`fin/txf/${ref}/${fid}`);

  /* side effects of a verified payout / receipt on the record it pays */
  async function afterVerified(t) {
    const l = t.links || {};
    try {
      if (l.commission) await root.DPSales.markPaid(l.commission.uid, l.commission.oid, { date: t.date, ref: t.ref, amountMinor: t.amountMinor, txRef: t.ref });
      if (l.payroll) await payrollPaid(l.payroll, t);
      if (l.wdue) await duePaid(l.wdue, t);
      if (l.purchase) await purchasePaid(l.purchase, t);
    } catch (e) { await audit("Linked record not updated after payment", { target: t.ref, detail: e.message }); throw new Error(`The payment is verified, but the linked record could not be updated: ${e.message}`); }
  }
  async function linkedTxs(pred) { return (await txs()).filter((t) => pred(t.links || {}, t)); }

  /* ---------------- customer receipts (from the order's payment verification) ---------------- */
  /** Default account for a customer payment method. */
  async function accountFor(method, currency = "EGP") {
    const c = await cfg(), all = await accounts(), id = (c.methodAccounts || {})[method];
    if (id && all[id] && all[id].status !== "closed" && all[id].currency === currency) return id;
    const bank = Object.values(all).find((a) => a.status !== "closed" && a.currency === currency && (method === "InstaPay" ? a.type === "instapay" || a.type === "bank" : a.type === "bank"));
    return bank ? bank.id : null;
  }
  /** Called when an order payment becomes verified: one incoming ledger transaction, linked both ways, never two. */
  async function postReceipt(o, p, { account = null } = {}) {
    if (!isFin()) return null;
    const ref = p.txRef || "RC-" + o.oid.slice(-10) + "-" + p.id.slice(-8).toUpperCase();
    const ex = await getTx(ref); if (ex) return ex;
    const acct = account || (await accountFor(p.method || "Bank transfer", o.currency || "EGP")); if (!acct) return null;
    const t = { ref, date: p.date, type: "customer_receipt", direction: "in", toAcct: acct, fromAcct: null, amountMinor: p.amountMinor, currency: o.currency || "EGP", method: p.method || "", bankRef: p.ref || "", walletRef: "",
      payee: { kind: "customer", id: o.ownerId || null, name: o.client || o.name || "" }, orderId: o.oid, dept: "Sales", category: "Customer payment", description: `Customer payment ${o.ref || o.oid} · ${o.name || ""}`,
      proofs: (p.fileMeta || []).map((m) => Object.assign({ orderFile: true }, m)), docs: [], links: { payment: { oid: o.oid, pid: p.id } }, preparedBy: p.by || meId(), preparedAt: p.at || now(), recordedBy: p.by || meId(), recordedAt: p.at || now(),
      status: "verified", verifiedBy: meId(), verifiedAt: now(), history: [{ at: now(), by: meId(), action: "Posted from verified order payment", status: "verified" }] };
    const r = await DS().create(txPath(ref), t); return r.created ? t : getTx(ref);
  }
  /** Verified order payments that have no ledger transaction yet (before 1.2, or no account was configured). */
  async function unpostedReceipts() {
    const [orders, all] = await Promise.all([root.DPSales.listOrders(), txs()]); const have = new Set(all.filter((t) => t.links && t.links.payment).map((t) => t.links.payment.oid + "|" + t.links.payment.pid));
    const out = []; for (const o of orders) for (const p of (o.payments || []).filter((x) => x.status === "verified")) if (!have.has(o.oid + "|" + p.id)) out.push({ o, p }); return out;
  }

  /* ---------------- payroll ---------------- */
  const profiles = () => list("fin/salary/p");
  async function saveProfile(uid, p, reason = "") {
    req(); const path = `fin/salary/p/${uid}`, prev = await DS().tryGet(path); if (!Number.isInteger(p.baseMinor) || p.baseMinor < 0) throw new Error("Enter the base monthly salary.");
    const rec = { uid, basis: p.basis || "monthly", baseMinor: p.baseMinor, allowances: (p.allowances || []).filter((x) => x && x.amountMinor), method: p.method || "Bank transfer", payRef: p.payRef || "", effectiveFrom: p.effectiveFrom || today(),
      currency: p.currency || "EGP", history: ((prev && prev.history) || []).concat(prev ? [{ at: now(), by: meId(), reason, before: { baseMinor: prev.baseMinor, allowances: prev.allowances, effectiveFrom: prev.effectiveFrom } }] : []), updatedAt: now(), updatedBy: meId() };
    if (prev && !String(reason).trim()) throw new Error("Give the reason for the salary change.");
    await DS().set(path, rec); await audit(prev ? "Salary changed" : "Salary profile created", { target: uid, reason, before: prev ? { baseMinor: prev.baseMinor, allowances: prev.allowances } : null, after: { baseMinor: rec.baseMinor, allowances: rec.allowances, effectiveFrom: rec.effectiveFrom } });
    return rec;
  }
  const payrollLines = async (period) => (await list("fin/payroll/r")).filter((x) => !period || x.period === period);
  /** Prepare a payroll period for every active person with a salary profile. Existing lines are kept (never duplicated). */
  async function preparePayroll(period) {
    req(); if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Choose the month.");
    const [profs, dir, lines] = await Promise.all([profiles(), AU().listDirectory(), payrollLines(period)]); const have = new Set(lines.map((l) => l.uid)); let made = 0;
    for (const p of profs) { const r = dir.find((d) => d.uid === p.uid); if (!r || r.active === false || have.has(p.uid) || p.effectiveFrom > period + "-31") continue;
      const line = { id: `${period}-${p.uid}`, period, uid: p.uid, name: AU().fullName(r) || r.displayName || "", role: r.role, department: r.department || "", currency: p.currency || "EGP", baseMinor: p.baseMinor, allowances: (p.allowances || []).map((a) => ({ label: a.label, amountMinor: a.amountMinor })),
        bonuses: [], deductions: [], recoveries: [], adjustments: [], method: p.method, payRef: p.payRef, status: "prepared", preparedBy: meId(), preparedAt: now(), txRefs: [], history: [{ at: now(), by: meId(), action: "Prepared" }] };
      Object.assign(line, C().payroll(line)); const r2 = await DS().create(`fin/payroll/r/${line.id}`, line); if (r2.created) made++; }
    await audit("Payroll prepared", { target: period, detail: `${made} line(s)` }); return made;
  }
  async function editPayroll(id, patch, reason = "") {
    req(); const path = `fin/payroll/r/${id}`, l = await DS().get(path); if (!["prepared", "pending_approval"].includes(l.status)) throw new Error("Approved payroll cannot be edited. Record an adjustment in the next period.");
    for (const k of ["allowances", "bonuses", "deductions", "recoveries", "adjustments"]) if (patch[k]) { for (const x of patch[k]) if (!Number.isInteger(x.amountMinor) || (k !== "adjustments" && x.amountMinor < 0)) throw new Error("Amounts must be whole piastres."); if (["deductions", "adjustments"].includes(k) && patch[k].some((x) => !String(x.reason || "").trim())) throw new Error("Every deduction and adjustment needs a reason."); }
    const before = C().payroll(l); Object.assign(l, patch); Object.assign(l, C().payroll(l)); if (l.status === "pending_approval") l.status = "prepared";
    l.history = (l.history || []).concat([{ at: now(), by: meId(), action: "Edited", reason, before: { netMinor: before.netMinor }, after: { netMinor: l.netMinor } }]);
    await DS().set(path, l); await audit("Payroll line changed", { target: id, reason, before: { netMinor: before.netMinor }, after: { netMinor: l.netMinor } }); return l;
  }
  async function submitPayroll(ids) { req(); for (const id of ids) { const p = `fin/payroll/r/${id}`, l = await DS().get(p); if (l.status !== "prepared") continue; l.status = "pending_approval"; l.history.push({ at: now(), by: meId(), action: "Submitted for approval" }); await DS().set(p, l); } await NT() && NT().deliver("@admins", { id: `fin-payroll-${ids[0]}-${Date.now()}`, type: "payment", title: "Payroll awaiting approval", body: `${ids.length} payroll line(s) are ready for approval.`, link: { view: "salaries" } }).catch(() => {}); }
  async function approvePayroll(ids) {
    req("approvePayroll"); let n = 0;
    for (const id of ids) { const p = `fin/payroll/r/${id}`, l = await DS().get(p); if (!["prepared", "pending_approval"].includes(l.status)) continue;
      Object.assign(l, C().payroll(l), { status: "approved", approvedBy: meId(), approvedAt: now() }); l.history.push({ at: now(), by: meId(), action: "Approved" }); await DS().set(p, l); n++;
      await payslip(l); await audit("Payroll approved", { target: id, after: { netMinor: l.netMinor } }); }
    return n;
  }
  /** Prepare the salary payments (one ledger transaction per person — each with its own proof and status). */
  async function payPayroll(ids, { account, method, date }) {
    req(); const out = [];
    for (const id of ids) { const l = await DS().get(`fin/payroll/r/${id}`); if (!["approved", "partly_paid"].includes(l.status)) continue;
      const paid = C().paidStatus(l.netMinor, await linkedTxs((k) => k.payroll === id)); if (paid.outstandingMinor <= 0 || paid.pendingMinor) continue;
      out.push(await createTx({ ref: C().newRef("SAL"), type: "salary", amountMinor: paid.outstandingMinor, currency: l.currency, fromAcct: account, method: method || l.method, date, payee: { kind: "employee", id: l.uid, name: l.name },
        dept: l.department, category: "Salary", description: `Salary ${l.period} — ${l.name}`, links: { payroll: id }, preApproved: true })); }
    return out;
  }
  async function payrollPaid(id, t) {
    const p = `fin/payroll/r/${id}`, l = await DS().get(p), s = C().paidStatus(l.netMinor, await linkedTxs((k) => k.payroll === id));
    l.status = s.state === "paid" ? "paid" : "partly_paid"; l.paidMinor = s.paidMinor; l.txRefs = Array.from(new Set((l.txRefs || []).concat([t.ref]))); l.history.push({ at: now(), by: meId(), action: l.status === "paid" ? "Paid" : "Partly paid", detail: t.ref });
    await DS().set(p, l); await payslip(l);
    if (NT()) await NT().deliver(l.uid, { id: `payslip-${id}-${l.status}`, type: "info", title: "Salary paid", body: `Your ${l.period} salary payment is recorded.`, link: { view: "profile" } }).catch(() => {});
  }
  /** Employee's own copy (no other person's data). */
  async function payslip(l) { const c = await cfg(); if (!c.payslipsVisible) return; await DS().set(`payslips/${l.uid}/p/${l.period}`, { period: l.period, name: l.name, currency: l.currency, baseMinor: l.baseMinor, allowances: l.allowances, bonuses: l.bonuses, deductions: l.deductions.map((d) => ({ label: d.label, amountMinor: d.amountMinor, reason: d.reason })), recoveries: l.recoveries, adjustments: (l.adjustments || []).map((a) => ({ label: a.label, amountMinor: a.amountMinor, reason: a.reason })), grossMinor: l.grossMinor, netMinor: l.netMinor, status: l.status, paidMinor: l.paidMinor || 0, method: l.method, updatedAt: now() }).catch(() => {}); }
  const myPayslips = async () => (await DS().tryList(`payslips/${meId()}/p`)).map((x) => Object.assign({ period: x.id }, x.data));

  /* ---------------- workers ---------------- */
  const wprofile = (wid) => DS().tryGet(`fin/wprof/w/${wid}`);
  async function saveWProfile(wid, p, reason = "") { req(); const path = `fin/wprof/w/${wid}`, prev = await DS().tryGet(path);
    if (/pin|password|otp/i.test(String(p.walletRef || ""))) throw new Error("Never store wallet PINs or passwords — only the payment identifier.");
    const rec = { wid, method: p.method || "InstaPay", walletRef: String(p.walletRef || "").slice(0, 80), basis: p.basis || "project", rateMinor: Math.round(+p.rateMinor || 0), employment: p.employment || "company", notes: p.notes || "", updatedAt: now(), updatedBy: meId(), history: ((prev && prev.history) || []).concat(prev ? [{ at: now(), by: meId(), reason, before: { basis: prev.basis, rateMinor: prev.rateMinor, method: prev.method } }] : []) };
    await DS().set(path, rec); await audit(prev ? "Worker payment profile changed" : "Worker payment profile created", { target: wid, reason, before: prev ? { basis: prev.basis, rateMinor: prev.rateMinor } : null, after: { basis: rec.basis, rateMinor: rec.rateMinor } }); return rec; }
  const DUE_KINDS = { salary: "Monthly salary", daily: "Daily wages", installation: "Installation payment", project: "Project-based fee", overtime: "Overtime", advance: "Approved advance", reimbursement: "Reimbursement", other: "Other payment" };
  const dues = () => list("fin/wdue/d");
  async function addDue(d) { req(); if (!d.wid) throw new Error("Choose the worker."); if (!DUE_KINDS[d.kind]) throw new Error("Choose the payment type."); if (!(Math.round(+d.amountDueMinor) > 0)) throw new Error("Enter the amount due."); if (!String(d.work || "").trim()) throw new Error("Describe the work or period.");
    const id = d.id || "wd-" + Math.random().toString(36).slice(2, 10);
    const rec = { id, wid: d.wid, workerName: d.workerName || "", oid: d.oid || null, orderRef: d.orderRef || "", kind: d.kind, work: d.work.trim(), period: d.period || "", amountDueMinor: Math.round(+d.amountDueMinor), currency: d.currency || "EGP", notes: d.notes || "", status: "pending_approval", preparedBy: meId(), preparedAt: now(), history: [{ at: now(), by: meId(), action: "Recorded" }] };
    const r = await DS().create(`fin/wdue/d/${id}`, rec); if (!r.created) throw new Error("This entry already exists."); await audit("Worker amount due recorded", { target: id, detail: `${rec.workerName} · ${rec.amountDueMinor / 100} · ${rec.work}` }); return rec; }
  async function decideDue(id, ok, reason = "") { req("approveExpenses"); const p = `fin/wdue/d/${id}`, d = await DS().get(p); if (d.status !== "pending_approval") throw new Error("Already decided.");
    if (!ok && !reason) throw new Error("Give the reason."); Object.assign(d, ok ? { status: "approved", approvedBy: meId(), approvedAt: now() } : { status: "cancelled", cancelReason: reason, cancelledBy: meId() }); d.history.push({ at: now(), by: meId(), action: ok ? "Approved" : "Rejected", detail: reason });
    await DS().set(p, d); await audit(ok ? "Worker payment approved" : "Worker payment rejected", { target: id, reason }); return d; }
  async function payDue(id, { account, method, date, walletRef }) { req(); const d = await DS().get(`fin/wdue/d/${id}`); if (!["approved", "partly_paid"].includes(d.status)) throw new Error("Approve the amount due first.");
    const s = C().paidStatus(d.amountDueMinor, await linkedTxs((k) => k.wdue === id)); if (s.pendingMinor) throw new Error("A payment for this is already in progress."); if (s.outstandingMinor <= 0) throw new Error("Nothing is outstanding.");
    return createTx({ ref: C().newRef("WK"), type: ["salary", "daily", "overtime"].includes(d.kind) ? "worker_salary" : "worker_payment", amountMinor: s.outstandingMinor, currency: d.currency, fromAcct: account, method: method || "InstaPay", walletRef: walletRef || "", date,
      payee: { kind: "worker", id: d.wid, name: d.workerName }, orderId: d.oid, dept: "Engineering", category: DUE_KINDS[d.kind], description: `${DUE_KINDS[d.kind]} — ${d.workerName}: ${d.work}${d.orderRef ? " · " + d.orderRef : ""}`, links: { wdue: id }, preApproved: true }); }
  async function duePaid(id, t) { const p = `fin/wdue/d/${id}`, d = await DS().get(p), s = C().paidStatus(d.amountDueMinor, await linkedTxs((k) => k.wdue === id)); d.status = s.state === "paid" ? "paid" : "partly_paid"; d.paidMinor = s.paidMinor; d.history.push({ at: now(), by: meId(), action: d.status === "paid" ? "Paid" : "Partly paid", detail: t.ref }); await DS().set(p, d); }
  /** "How much have we paid this worker, for what, on which projects?" */
  async function workerHistory(wid) { const [all, ds] = await Promise.all([txs(), dues()]); const T = all.filter((t) => t.payee && t.payee.kind === "worker" && t.payee.id === wid);
    const D = ds.filter((d) => d.wid === wid); const out = D.map((d) => ({ due: d, payments: T.filter((t) => (t.links || {}).wdue === d.id), status: C().paidStatus(d.amountDueMinor, T.filter((t) => (t.links || {}).wdue === d.id)) }));
    return { dues: out, payments: T, totalPaidMinor: C().sum(T.filter(C().POSTED), (t) => (t.type === "reversal" ? -t.amountMinor : t.amountMinor)), outstandingMinor: C().sum(out, (x) => x.status.outstandingMinor) }; }

  /* ---------------- suppliers & purchases ---------------- */
  const suppliers = () => list("fin/supp/s");
  async function saveSupplier(s) { req(); if (!String(s.name || "").trim()) throw new Error("Enter the supplier name."); const id = s.id || "sup-" + Math.random().toString(36).slice(2, 9);
    const rec = { name: s.name.trim(), category: s.category || "", contact: s.contact || "", phone: s.phone || "", email: s.email || "", taxId: s.taxId || "", terms: s.terms || "", notes: s.notes || "", updatedAt: now(), updatedBy: meId() };
    const prev = await DS().tryGet(`fin/supp/s/${id}`); await DS().set(`fin/supp/s/${id}`, Object.assign({ createdAt: (prev && prev.createdAt) || now() }, rec)); await audit(prev ? "Supplier changed" : "Supplier created", { target: id, before: prev, after: rec }); return Object.assign({ id }, rec); }
  const purchases = () => list("fin/purch/p");
  async function savePurchase(p, rules = {}) {
    req(); if (!p.supplierId) throw new Error("Choose the supplier."); if (!(p.lines || []).length || p.lines.some((l) => !String(l.item || "").trim() || !(+l.qty > 0) || !Number.isInteger(l.unitPriceMinor))) throw new Error("Each line needs an item, a quantity and a unit price.");
    if (p.alloc && p.alloc.length && p.alloc.reduce((s, a) => s + (+a.pct || 0), 0) > 100.0001) throw new Error("The allocation percentages add up to more than 100%.");
    const ref = p.ref || C().newRef("PO"), path = `fin/purch/p/${ref}`, prev = await DS().tryGet(path);
    if (prev && !["pending_approval", "draft"].includes(prev.status)) throw new Error("An approved purchase cannot be edited. Cancel it and record a new one.");
    const rule = p.taxRuleId ? rules[p.taxRuleId] || null : null, tot = C().docTotals({ lines: p.lines.map((l) => ({ qty: l.qty, unitMinor: l.unitPriceMinor })), discountMinor: p.discountMinor || 0, rule });
    const rec = Object.assign({ ref, supplierId: p.supplierId, supplierName: p.supplierName || "", date: p.date || today(), lines: p.lines, discountMinor: tot.discountMinor, subtotalMinor: tot.subtotalMinor, taxRuleId: p.taxRuleId || null, taxMinor: tot.taxMinor, totalMinor: tot.totalMinor,
      currency: p.currency || "EGP", fx: p.fx || null, terms: p.terms || "", dueDate: p.dueDate || null, oid: p.oid || null, orderRef: p.orderRef || "", alloc: p.alloc || [], stockRef: p.stockRef || "", category: p.category || "materials", notes: p.notes || "",
      status: "pending_approval", preparedBy: (prev && prev.preparedBy) || meId(), preparedAt: (prev && prev.preparedAt) || now(), docs: (prev && prev.docs) || [] }, {});
    rec.history = ((prev && prev.history) || []).concat([{ at: now(), by: meId(), action: prev ? "Edited" : "Recorded" }]);
    await DS().set(path, rec); await audit(prev ? "Purchase changed" : "Purchase recorded", { target: ref, before: prev ? { totalMinor: prev.totalMinor } : null, after: { totalMinor: rec.totalMinor } }); return rec;
  }
  async function decidePurchase(ref, ok, reason = "") { req("approveExpenses"); const p = `fin/purch/p/${ref}`, x = await DS().get(p); if (x.status !== "pending_approval") throw new Error("Already decided."); if (!ok && !reason) throw new Error("Give the reason.");
    Object.assign(x, ok ? { status: "approved", approvedBy: meId(), approvedAt: now() } : { status: "cancelled", cancelReason: reason, cancelledBy: meId() }); x.history.push({ at: now(), by: meId(), action: ok ? "Approved" : "Cancelled", detail: reason }); await DS().set(p, x);
    await audit(ok ? "Purchase approved" : "Purchase cancelled", { target: ref, reason }); return x; }
  async function markReceived(ref, note = "") { req(); const p = `fin/purch/p/${ref}`, x = await DS().get(p); if (x.status !== "approved") throw new Error("Only an approved purchase can be marked received."); x.received = true; x.receivedAt = now(); x.receivedBy = meId(); x.receivedNote = note; x.history.push({ at: now(), by: meId(), action: "Goods received", detail: note }); await DS().set(p, x); return x; }
  async function addPurchaseDoc(ref, file) { req(); const fid = "f-" + Math.random().toString(36).slice(2, 10); await root.DPOrders.putFile(`fin/txf/${ref}/${fid}`, file); const p = `fin/purch/p/${ref}`, x = await DS().get(p);
    x.docs = (x.docs || []).concat([{ id: fid, name: file.name, type: file.type, size: file.size, hash: file.hash || null, at: now(), by: meId() }]); x.history.push({ at: now(), by: meId(), action: "Invoice / receipt attached", detail: file.name }); await DS().set(p, x); return x; }
  async function payPurchase(ref, { account, method, date, amountMinor }) { req(); const x = await DS().get(`fin/purch/p/${ref}`); if (!["approved"].includes(x.status)) throw new Error("Approve the purchase first.");
    const s = C().paidStatus(x.totalMinor, await linkedTxs((k) => k.purchase === ref)); if (s.outstandingMinor <= 0) throw new Error("This purchase is fully paid."); const amt = amountMinor ? Math.round(amountMinor) : s.outstandingMinor; if (amt > s.outstandingMinor) throw new Error("More than the outstanding balance.");
    const type = x.category === "outsourced" ? "outsourced" : x.category === "manufacturing" ? "factory" : "supplier";
    return createTx({ ref: C().newRef("PP"), type, amountMinor: amt, currency: x.currency, fromAcct: account, method: method || "Bank transfer", date, payee: { kind: "supplier", id: x.supplierId, name: x.supplierName }, orderId: x.oid || null, dept: "Procurement", category: "Purchase payment", description: `Payment for purchase ${ref} — ${x.supplierName}`, links: { purchase: ref }, preApproved: true }); }
  async function purchasePaid(ref, t) { const p = `fin/purch/p/${ref}`, x = await DS().get(p), s = C().paidStatus(x.totalMinor, await linkedTxs((k) => k.purchase === ref)); x.paidMinor = s.paidMinor; x.payState = s.state; x.history.push({ at: now(), by: meId(), action: s.state === "paid" ? "Paid in full" : "Partly paid", detail: t.ref }); await DS().set(p, x); }

  /* ---------------- commission payouts (through the ledger; the existing commission record stays the source) ---------------- */
  async function payCommission(uid, oid, { account, method, date, amountMinor }) { req(); const r = await DS().get(`commissions/${uid}/r/${oid}`);
    if (!r || !["approved"].includes(r.status) || r.approvedMinor == null) throw new Error("Only an approved commission can be paid out.");
    const paid = C().sum(r.payouts || [], (x) => x.amountMinor), out = Math.max(0, r.approvedMinor + C().sum(r.adjustments || [], (x) => x.amountMinor) - paid);
    if (!out) throw new Error("Nothing is outstanding."); const pend = (await linkedTxs((k) => k.commission && k.commission.uid === uid && k.commission.oid === oid)).filter((t) => !["verified", "rejected", "cancelled"].includes(t.status));
    if (pend.length) throw new Error("A payout for this commission is already in progress."); const amt = amountMinor ? Math.round(amountMinor) : out; if (amt > out) throw new Error("More than the outstanding commission.");
    return createTx({ ref: C().newRef("COM"), type: "commission", amountMinor: amt, currency: r.currency || "EGP", fromAcct: account, method: method || "Bank transfer", date, payee: { kind: "employee", id: uid, name: AU().nameSync(uid) || "" }, orderId: oid, dept: "Sales", category: "Commission", description: `Commission ${r.name || oid} — ${AU().nameSync(uid) || ""}`, links: { commission: { uid, oid } }, preApproved: true }); }

  /* ---------------- taxes ---------------- */
  const taxRules = async () => Object.fromEntries((await list("fin/tax/r")).map((r) => [r.id, r]));
  async function saveTaxRule(r, reason = "") { req("recordTax"); if (!String(r.name || "").trim()) throw new Error("Name the rule."); if (!C().TAX_KINDS[r.kind]) throw new Error("Choose the tax treatment."); if (!(r.rateBp >= 0 && r.rateBp <= 10000)) throw new Error("Enter the rate (0–100%)."); if (!r.effectiveFrom) throw new Error("Enter the date it takes effect."); if (!String(r.source || "").trim()) throw new Error("Record the source of the rule (law, decree or adviser).");
    const id = r.id || "tax-" + Math.random().toString(36).slice(2, 8), path = `fin/tax/r/${id}`, prev = await DS().tryGet(path);
    const rec = { name: r.name.trim(), kind: r.kind, rateBp: Math.round(r.rateBp), inclusive: !!r.inclusive, appliesTo: r.appliesTo || ["sales"], recoverable: !!r.recoverable, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo || null, source: r.source.trim(), reviewed: !!r.reviewed, reviewedBy: r.reviewed ? (prev && prev.reviewed ? prev.reviewedBy : meId()) : null, notes: r.notes || "", updatedAt: now(), updatedBy: meId(), history: ((prev && prev.history) || []).concat(prev ? [{ at: now(), by: meId(), reason, before: { rateBp: prev.rateBp, kind: prev.kind, inclusive: prev.inclusive } }] : []) };
    await DS().set(path, rec); await audit(prev ? "Tax rule changed" : "Tax rule created", { target: id, reason, before: prev ? { rateBp: prev.rateBp, kind: prev.kind } : null, after: { rateBp: rec.rateBp, kind: rec.kind, source: rec.source } }); return Object.assign({ id }, rec); }

  /* ---------------- invoices, receipts, credit notes ---------------- */
  const KINDS = { receipt: "Payment receipt", tax_invoice: "Tax invoice", credit_note: "Credit note" };
  const docs = () => list("fin/inv/i");
  /** Next unique number: tries N, N+1… with create-only writes (two people issuing at once can never get the same number). */
  async function issueDoc(draft) {
    req("finalizeInvoices"); const kind = draft.kind; if (!KINDS[kind]) throw new Error("Choose the document type.");
    if (kind === "receipt" && !draft.paymentVerified) throw new Error("The payment is not verified yet. A receipt confirming funds can only be issued for a verified payment.");
    if (kind === "credit_note" && !draft.creditOf) throw new Error("A credit note must refer to the issued document it corrects.");
    const year = (draft.date || today()).slice(0, 4), existing = (await docs()).filter((d) => d.kind === kind && String(d.number).includes(`-${year}-`));
    let n = existing.reduce((m, d) => Math.max(m, parseInt(String(d.number).split("-").pop(), 10) || 0), 0) + 1;
    for (let tries = 0; tries < 20; tries++, n++) {
      const number = C().docNumber(kind, year, n), rec = Object.assign({}, draft, { number, status: "issued", issuedBy: meId(), issuedAt: now(), history: [{ at: now(), by: meId(), action: "Issued" }] });
      delete rec.id; const r = await DS().create(`fin/inv/i/${number}`, rec);
      if (r.created) { await audit(`${KINDS[kind]} issued`, { target: number, detail: `${draft.orderRef || draft.orderId || ""} · ${draft.totalMinor / 100}` }); await copyToSales(rec); if (draft.draftOf) await closeDraft(draft.draftOf, number); return rec; }
    }
    throw new Error("Could not allocate a document number. Try again.");
  }
  async function cancelDoc(number, reason) { req("finalizeInvoices"); if (!String(reason || "").trim()) throw new Error("Give the reason for cancelling."); const p = `fin/inv/i/${number}`, d = await DS().get(p); if (d.status !== "issued") throw new Error("Only an issued document can be cancelled.");
    d.status = "cancelled"; d.cancelReason = reason.trim(); d.cancelledBy = meId(); d.cancelledAt = now(); d.history.push({ at: now(), by: meId(), action: "Cancelled", detail: reason }); await DS().set(p, d); await audit("Document cancelled", { target: number, reason }); await copyToSales(d); return d; }
  async function copyToSales(d) { if (!d.ownerId || !d.orderId) return; await DS().set(`salesorders/${d.ownerId}/o/${d.orderId}/docs/${d.number}`, { number: d.number, kind: d.kind, date: d.date, totalMinor: d.totalMinor, receivedMinor: d.receivedMinor || 0, currency: d.currency, status: d.status, paymentVerified: !!d.paymentVerified, doc: d }).catch(() => {}); }
  /** Prefill a document from the order (and, for a receipt, from one recorded payment). Nothing on the order changes. */
  async function draftFromOrder(oid, kind, { paymentId = null, rules = null } = {}) {
    const o = await DS().get(`orders/${oid}`); if (!o) throw new Error("Order not found."); const c = (root.DPUI && root.DPUI.App.config.settings.company) || {};
    const p = paymentId ? (o.payments || []).find((x) => x.id === paymentId) : null, s = root.DPPay.summary(o, { tz: (root.DPUI && root.DPUI.App.config.settings.timezone) || "Africa/Cairo", settings: root.DPUI && root.DPUI.App.config.settings });
    const lines = (o.lines || o.items || []).map((l) => ({ desc: l.name || l.desc || l.code || "Item", code: l.code || "", qty: +l.qty || 1, unitMinor: Math.round(l.unitMinor != null ? l.unitMinor : l.priceMinor != null ? l.priceMinor : l.sellMinor || 0) }));
    const base = { kind, orderId: oid, orderRef: o.ref || oid, ownerId: o.ownerId || null, date: today(), currency: o.currency || "EGP", company: { name: c.name || "Dupedia", address: c.address || "", phone: c.phone || "", email: c.email || "", taxId: c.taxId || "", crn: c.crn || "" },
      customer: { name: o.client || "", org: o.client || "", billing: o.billingAddress || o.location || "", taxId: o.clientTaxId || "" }, project: o.name || "", notes: "" };
    if (kind === "receipt") { if (!p) throw new Error("Choose the payment this receipt confirms.");
      const t = (await txs()).find((x) => x.links && x.links.payment && x.links.payment.pid === p.id);
      return Object.assign(base, { paymentId: p.id, txRef: t ? t.ref : null, lines: [{ desc: `Payment received — ${o.name || ""}`, qty: 1, unitMinor: p.amountMinor }], subtotalMinor: p.amountMinor, discountMinor: 0, taxLines: [], taxMinor: 0, totalMinor: p.amountMinor,
        receivedMinor: p.amountMinor, paymentDate: p.date, paymentMethod: p.method, paymentRef: p.ref, remainingMinor: s.remainingMinor, payableMinor: s.payableMinor, paymentVerified: p.status === "verified" }); }
    // tax invoice: the order's lines with the configured sales tax rule (the quotation's VAT by default)
    const R = rules || (await taxRules()), rule = Object.values(R).filter((r) => (r.appliesTo || []).includes("sales") && r.effectiveFrom <= today() && (!r.effectiveTo || r.effectiveTo >= today())).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
    const useLines = lines.length ? lines : [{ desc: o.name || "Order", qty: 1, unitMinor: Math.max(0, (o.subtotalMinor || 0)) }];
    const t = C().docTotals({ lines: useLines, discountMinor: o.discountMinor || 0, rule });
    return Object.assign(base, { lines: useLines, subtotalMinor: t.subtotalMinor, discountMinor: t.discountMinor, taxRuleId: rule ? rule.id : null, taxLines: rule ? [{ rule: rule.name, rateBp: rule.rateBp, baseMinor: t.taxableMinor, taxMinor: t.taxMinor, inclusive: !!rule.inclusive, kind: rule.kind }] : [], taxMinor: t.taxMinor, totalMinor: t.totalMinor,
      receivedMinor: s.verifiedMinor, remainingMinor: s.remainingMinor, payableMinor: s.payableMinor, orderTotalMinor: o.totalMinor, differsFromOrder: t.totalMinor !== root.DPPay.payableOf(o) });
  }
  /* sales drafts */
  async function salesDraft(oid, kind, data) { const uid = meId(), id = "dr-" + Math.random().toString(36).slice(2, 9); await DS().set(`requests/${uid}/inv/${id}`, Object.assign({}, data, { kind, oid, status: "draft", by: uid, at: now() }));
    if (NT()) await NT().deliver("@admins", { id: `invdraft-${id}`, type: "payment", title: "Invoice / receipt draft to issue", body: `${AU().nameSync(uid) || "Sales"} prepared a ${KINDS[kind] || kind} for ${data.orderRef || oid}.`, link: { view: "invoices" } }).catch(() => {}); return id; }
  async function salesDrafts() { const ids = await root.DPLeads.uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`requests/${u}/inv`).then((x) => x.map((y) => Object.assign({ id: y.id, uid: u }, y.data))))); return l.flat(); }
  async function closeDraft(d, number) { if (!d || !d.uid || !d.id) return; const p = `requests/${d.uid}/inv/${d.id}`, cur = await DS().tryGet(p); if (cur) await DS().set(p, Object.assign({}, cur, { status: "issued", number, issuedAt: now() })).catch(() => {}); }
  async function myDocs(oid) { return (await DS().tryList(`salesorders/${meId()}/o/${oid}/docs`)).map((x) => x.data); }

  /* ---------------- statements & reconciliation ---------------- */
  async function importStatement(acct, text, fileName = "") { req(); const lines = C().parseStatementCsv(text), have = await statementLines(acct);
    const key = (l) => `${l.date}|${l.amountMinor}|${l.ref}|${l.desc}`, seen = new Set(have.map(key)); let added = 0, dup = 0;
    for (const l of lines) { if (seen.has(key(l))) { dup++; continue; } const id = `${l.date.replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`; await DS().set(`fin/stmt/${acct}/${id}`, Object.assign({}, l, { acct, importedAt: now(), by: meId(), file: fileName, matchedTx: null })); seen.add(key(l)); added++; }
    const last = lines.filter((l) => l.balanceMinor != null).pop(); if (last) { const a = await DS().get(`fin/accounts/a/${acct}`); await DS().set(`fin/accounts/a/${acct}`, Object.assign({}, a, { statementBalanceMinor: last.balanceMinor, statementDate: last.date })); }
    await audit("Bank statement imported", { target: acct, detail: `${added} new line(s), ${dup} already imported · ${fileName}` }); return { added, dup }; }
  const statementLines = async (acct) => (await DS().tryList(`fin/stmt/${acct}`)).map((x) => Object.assign({ id: x.id }, x.data));
  async function matchLine(acct, lineId, ref) { req(); const p = `fin/stmt/${acct}/${lineId}`, l = await DS().get(p); const t = ref ? await getTx(ref) : null; if (ref && (!t || !C().POSTED(t))) throw new Error("Match a verified transaction.");
    if (ref && C().effect(t)[acct] !== l.amountMinor) throw new Error("The amounts differ: this line is not that transaction.");
    await DS().set(p, Object.assign({}, l, { matchedTx: ref || null, matchedBy: meId(), matchedAt: now() }));
    if (t) { t.recon = { acct, line: lineId, at: now(), by: meId() }; await putTx(t, "Matched to bank statement", lineId); } await audit(ref ? "Statement line matched" : "Statement line unmatched", { target: acct, detail: `${lineId} ↔ ${ref || "—"}` }); }
  async function saveRecon(acct, { asOf, statementMinor, notes = "" }) { req(); const [a, all, lines] = await Promise.all([DS().get(`fin/accounts/a/${acct}`), txs(), statementLines(acct)]);
    const r = C().reconcile(Object.assign({ id: acct }, a, { statementBalanceMinor: statementMinor }), all, lines, asOf), id = `${acct}-${asOf}-${Date.now().toString(36)}`;
    const rec = { acct, asOf, statementMinor, bookMinor: r.bookMinor, diffMinor: statementMinor - r.bookMinor, unmatchedLines: r.unmatchedLines.length, unmatchedTx: r.unmatchedTx.length, notes, by: meId(), at: now() };
    await DS().set(`fin/recon/r/${id}`, rec); await DS().set(`fin/accounts/a/${acct}`, Object.assign({}, a, { statementBalanceMinor: statementMinor, statementDate: asOf, lastRecon: { asOf, diffMinor: rec.diffMinor, at: now(), by: meId() } }));
    await audit("Bank reconciliation recorded", { target: acct, detail: `${asOf}: statement ${statementMinor / 100}, book ${r.bookMinor / 100}, difference ${rec.diffMinor / 100}` }); return rec; }
  const reconHistory = async (acct) => (await list("fin/recon/r")).filter((r) => !acct || r.acct === acct).sort((a, b) => b.at.localeCompare(a.at));

  /* ---------------- one load for the dashboards ---------------- */
  async function snapshot() {
    const [c, A, T, P, D, PR, S, R, I] = await Promise.all([cfg(true), accounts(), txs(), purchases(), dues(), payrollLines(), suppliers(), taxRules(), docs()]);
    return { cfg: c, accounts: A, txs: T, purchases: P, dues: D, payroll: PR, suppliers: S, taxRules: R, docs: I };
  }

  root.DPFin = { F, cfg, saveCfg, can, isFin, req, accounts, saveAccount, txs, getTx, createTx, approve, reject, cancel, recordPayment, verify, reverse, addProof, proofFile, linkedTxs,
    accountFor, postReceipt, unpostedReceipts, profiles, saveProfile, payrollLines, preparePayroll, editPayroll, submitPayroll, approvePayroll, payPayroll, myPayslips,
    wprofile, saveWProfile, DUE_KINDS, dues, addDue, decideDue, payDue, workerHistory, suppliers, saveSupplier, purchases, savePurchase, decidePurchase, markReceived, addPurchaseDoc, payPurchase,
    payCommission, taxRules, saveTaxRule, KINDS, docs, issueDoc, cancelDoc, draftFromOrder, salesDraft, salesDrafts, myDocs, importStatement, statementLines, matchLine, saveRecon, reconHistory, snapshot };
})(typeof self !== "undefined" ? self : this);
