/* X FORCE 1.1 (Dupedia) — payment obligations, balances and salary cycles. Pure functions, no storage: the same rules run in
   every session, in the server sweep (ops/sweep.py mirrors summary/overdue) and in the tests.

   CONFIRMED PAYABLE VALUE = the order's confirmed total incl. VAT (booked value; before booking: the accepted quotation's
   total) + approved value amendments (order.valueAdjustments[], positive or negative, each with a reason and approver).
   An approved discount is already inside the confirmed total; a later discount is a negative value amendment.

   SCHEDULE: milestones {id, label, kind, pct | amountMinor, due}. Every accepted order gets an INITIAL DEPOSIT milestone of
   settings.payTerms.depositPct (default 50 %) of the payable value, due on the acceptance date. The rest is the outstanding
   balance; it only becomes a dated obligation when a milestone for it exists (balance / custom milestones). Percentage
   milestones follow value amendments automatically; fixed-amount milestones keep their amount.

   A milestone is a payment OBLIGATION, never a payment. Money counts only when a payment record is VERIFIED; recorded,
   pending (reported by sales) and rejected payments never reduce the verified balance. Verified money is allocated to the
   milestones in due-date order. */
(function (root) {
  "use strict";
  const DEPOSIT_PCT = 50;
  const TZ_DEFAULT = "Africa/Cairo";
  /** YYYY-MM-DD for an instant in a time zone. */
  function dayIn(tz, d = new Date()) {
    try { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz || TZ_DEFAULT, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d); const g = (t) => p.find((x) => x.type === t).value; return `${g("year")}-${g("month")}-${g("day")}`; }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  const depositPct = (settings) => { const v = settings && settings.payTerms && +settings.payTerms.depositPct; return v > 0 && v <= 100 ? v : DEPOSIT_PCT; };
  function payableOf(order) {
    const base = Math.round(+(order && order.totalMinor) || 0);
    const adj = ((order && order.valueAdjustments) || []).filter((a) => a && a.status !== "void").reduce((s, a) => s + Math.round(+a.amountMinor || 0), 0);
    return Math.max(0, base + adj);
  }
  /** Default schedule for a newly accepted order (deposit only; the remainder is the outstanding balance). */
  function defaultSchedule(acceptDate, settings) { return [{ id: "dep", kind: "deposit", label: `Initial deposit (${depositPct(settings)}%)`, pct: depositPct(settings), due: acceptDate || null, auto: true }]; }
  /** Normalise a schedule: guarantees exactly one deposit milestone (adds the default one when missing). */
  function normalise(schedule, { acceptDate, settings } = {}) {
    const s = (schedule || []).filter(Boolean).map((x, i) => ({ id: x.id || (x.kind === "deposit" ? "dep" : "m" + (i + 1)), kind: x.kind || (i === 0 && /advance|deposit|down/i.test(x.label || "") ? "deposit" : "custom"), label: String(x.label || "Payment").slice(0, 80), pct: x.pct != null && x.pct !== "" ? +x.pct : null, amountMinor: x.pct != null && x.pct !== "" ? null : (x.amountMinor != null ? Math.round(+x.amountMinor) : null), due: x.due || null, auto: !!x.auto }));
    if (!s.some((x) => x.kind === "deposit")) s.unshift(defaultSchedule(acceptDate, settings)[0]);
    let dep = 0; for (const x of s) if (x.kind === "deposit") { if (dep++) x.kind = "custom"; }
    return s;
  }
  const amountOf = (m, payable) => m.pct != null ? Math.round(payable * m.pct / 100) : Math.max(0, Math.round(m.amountMinor || 0));

  /** Full payment position of an order. `reports` = sales payment reports not yet added to the order (status submitted). */
  function summary(order, { reports = [], today = null, tz = TZ_DEFAULT, settings = null, acceptDate = null } = {}) {
    const payable = payableOf(order), pays = (order && order.payments) || [];
    const sum = (f) => pays.filter(f).reduce((a, p) => a + Math.round(+p.amountMinor || 0), 0);
    const verified = sum((p) => p.status === "verified"), recorded = sum((p) => (p.status || "recorded") === "recorded"), rejected = sum((p) => p.status === "rejected");
    const reported = (reports || []).filter((r) => r.status === "submitted").reduce((a, r) => a + Math.round(+r.amountMinor || 0), 0);
    const day = today || dayIn(tz);
    const acc = acceptDate || (order && order.acceptedAt ? dayIn(tz, new Date(order.acceptedAt)) : null);
    const sched = normalise(order && order.schedule, { acceptDate: acc, settings });
    let left = verified;
    const ms = sched.slice().sort((a, b) => (a.kind === "deposit" ? -1 : b.kind === "deposit" ? 1 : String(a.due || "9999").localeCompare(String(b.due || "9999")))).map((m) => {
      const expected = amountOf(m, payable), paid = Math.min(left, expected); left -= paid;
      const remaining = expected - paid, overdue = remaining > 0 && m.due && m.due < day;
      const state = expected === 0 ? "none" : remaining === 0 ? "paid" : overdue ? "overdue" : paid > 0 ? "partly" : m.due && m.due <= day ? "due" : "upcoming";
      return Object.assign({}, m, { expectedMinor: expected, paidMinor: paid, remainingMinor: remaining, state, daysOverdue: overdue ? Math.round((Date.parse(day) - Date.parse(m.due)) / 864e5) : 0 });
    });
    const scheduled = ms.reduce((a, m) => a + m.expectedMinor, 0);
    const dep = ms.find((m) => m.kind === "deposit") || { expectedMinor: 0, remainingMinor: 0 };
    const overdueMinor = ms.filter((m) => m.state === "overdue").reduce((a, m) => a + m.remainingMinor, 0);
    const remaining = Math.max(0, payable - verified), over = Math.max(0, verified - payable);
    const fully = payable > 0 && verified >= payable;
    const status = order && order.status === "cancelled" ? "cancelled" : over > 0 ? "overpaid" : fully ? "paid" : overdueMinor > 0 ? (dep.remainingMinor > 0 && dep.state === "overdue" ? "deposit-overdue" : "overdue") : verified > 0 ? (dep.remainingMinor > 0 ? "deposit-partly" : "partly") : dep.remainingMinor > 0 ? "deposit-due" : "unpaid";
    return { payableMinor: payable, baseMinor: Math.round(+(order && order.totalMinor) || 0), adjustmentsMinor: payable - Math.round(+(order && order.totalMinor) || 0),
      depositMinor: dep.expectedMinor, depositRemainingMinor: dep.remainingMinor, depositPaidMinor: dep.paidMinor || 0,
      verifiedMinor: verified, recordedMinor: recorded, pendingMinor: recorded + reported, reportedMinor: reported, rejectedMinor: rejected,
      remainingMinor: remaining, overpaidMinor: over, overdueMinor, scheduledMinor: scheduled, unscheduledMinor: Math.max(0, payable - scheduled), overScheduled: scheduled > payable,
      fullyPaid: fully, status, milestones: ms, today: day };
  }
  const STATUS = { unpaid: ["Unpaid", ""], "deposit-due": ["Deposit due", "warn"], "deposit-partly": ["Deposit partly paid", "warn"], "deposit-overdue": ["Deposit overdue", "err"], partly: ["Partly paid", "info"], overdue: ["Payment overdue", "err"], paid: ["Fully paid", "ok"], overpaid: ["Overpaid — review", "err"], cancelled: ["Cancelled", "err"] };
  const MS_STATE = { paid: ["Paid", "ok"], partly: ["Partly paid", "warn"], due: ["Due", "warn"], overdue: ["Overdue", "err"], upcoming: ["Upcoming", ""], none: ["—", ""] };
  /** Overdue reminders: one per milestone per due date, then one escalation after `escalateDays` (default 7). */
  function overdueAlerts(oid, s, { escalateDays = 7 } = {}) {
    const out = [];
    for (const m of s.milestones.filter((x) => x.state === "overdue")) {
      out.push({ id: `od-${oid}-${m.id}-${m.due}`, level: "overdue", m });
      if (m.daysOverdue >= escalateDays) out.push({ id: `od-${oid}-${m.id}-${m.due}-esc`, level: "escalation", m });
    }
    return out;
  }

  /* ---------------- commission salary cycle ---------------- */
  /** Salary cycle (YYYY-MM) for a date: on or before the 25th (company time zone) → that month; after the 25th → next month. */
  function cycleOf(iso, tz = TZ_DEFAULT, cutoff = 25) {
    if (!iso) return null; const d = dayIn(tz, new Date(iso)); let [y, m, day] = d.split("-").map(Number);
    if (day > cutoff) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  /** A commission is paid with the salary cycle of the later of: the order's closing date (client acceptance) and the approval. */
  function salaryCycle(rec, tz = TZ_DEFAULT, cutoff = 25) {
    const a = cycleOf(rec && (rec.acceptedAt || rec.approvedAt), tz, cutoff), b = cycleOf(rec && rec.approvalAt, tz, cutoff);
    if (!a) return b; if (!b) return a; return a > b ? a : b;
  }
  const cycleLabel = (c) => { if (!c) return "—"; const [y, m] = c.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) + " salary"; };
  const CUTOFF_MESSAGE = "Please note: commissions for orders closed after the 25th will be reflected in the following month's salary cycle.";

  root.DPPay = { DEPOSIT_PCT, TZ_DEFAULT, dayIn, depositPct, payableOf, defaultSchedule, normalise, summary, STATUS, MS_STATE, overdueAlerts, cycleOf, salaryCycle, cycleLabel, CUTOFF_MESSAGE };
  if (typeof module !== "undefined") module.exports = root.DPPay;
})(typeof self !== "undefined" ? self : this);
