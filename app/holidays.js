/* X FORCE 1.3 (Dupedia) — holidays, bank closures and business days (Egypt by default). Pure functions + the calendar.

   The calendar is a record the administrator maintains (hol/cal): weekend days, and dated closures each with a type
   (national holiday, bank closure, government closure, company closure), who is closed (banks / government offices /
   the company), the SOURCE of the date and whether it is still PROVISIONAL. Nothing here is fetched from the internet: Egypt
   announces several holidays (Islamic holidays, moved holidays) only shortly before, so the administrator records them as
   they are announced. Fixed-date national holidays can be pre-filled as provisional — they are often moved by decree.
   Contractual due dates are never changed: the functions only SUGGEST a processing date and say why. */
(function (root) {
  "use strict";
  const SCOPES = { bank: "Banks closed", gov: "Government offices closed", company: "Dupedia closed" };
  const TYPES = { national: "Official national holiday", bank: "Bank closure", government: "Government closure", company: "Company closure", substitute: "Substitute / moved holiday" };
  const DEFAULT = { weekend: { bank: [5, 6], gov: [5, 6], company: [5] }, days: [], updatedAt: null, updatedBy: null };
  // fixed-date official holidays in Egypt (pre-fill only, always provisional — the government often moves them to another weekday)
  const FIXED = [["01-07", "Coptic Christmas"], ["01-25", "Revolution Day (25 January) and Police Day"], ["04-25", "Sinai Liberation Day"], ["05-01", "Labour Day"], ["06-30", "30 June Revolution Day"], ["07-23", "23 July Revolution Day"], ["10-06", "Armed Forces Day"]];
  let CAL = Object.assign({}, DEFAULT);
  const use = (cal) => { CAL = Object.assign({}, DEFAULT, cal || {}, { weekend: Object.assign({}, DEFAULT.weekend, (cal && cal.weekend) || {}) }); return CAL; };
  const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  const add = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  /** Closures that apply to a date for a scope (bank, gov, company). */
  function closures(d, scope = "bank", cal = CAL) {
    const out = []; if ((cal.weekend[scope] || []).includes(dow(d))) out.push({ date: d, name: "Weekend", type: "weekend" });
    for (const h of cal.days || []) if (h.date === d && (!h.scope || !h.scope.length || h.scope.includes(scope))) out.push(h);
    return out;
  }
  const isWorkingDay = (d, scope = "company", cal = CAL) => !closures(d, scope, cal).length;
  const prevWorkingDay = (d, scope = "bank", cal = CAL) => { let x = add(d, -1); for (let i = 0; i < 30 && !isWorkingDay(x, scope, cal); i++) x = add(x, -1); return x; };
  const nextWorkingDay = (d, scope = "bank", cal = CAL) => { let x = add(d, 1); for (let i = 0; i < 30 && !isWorkingDay(x, scope, cal); i++) x = add(x, 1); return x; };
  function addBusinessDays(d, n, scope = "company", cal = CAL) { let x = d, k = 0; while (k < Math.abs(n)) { x = add(x, n < 0 ? -1 : 1); if (isWorkingDay(x, scope, cal)) k++; } return x; }
  /** A deadline check: is the due date a closure day for this kind of payment, and are there closures in the days before it
   *  that shorten the time to prepare? Returns null when there is nothing to warn about. */
  function check(due, { scope = "bank", lead = 3, cal = CAL, today = null } = {}) {
    if (!due) return null; const d = String(due).slice(0, 10), on = closures(d, scope, cal), before = [];
    for (let i = 1; i <= lead; i++) { const x = add(d, -i); const c = closures(x, scope, cal).filter((h) => h.type !== "weekend"); if (c.length) before.push(...c); }
    if (!on.length && !before.length) return null;
    let suggested = on.length ? prevWorkingDay(d, scope, cal) : null; const provisional = on.concat(before).some((h) => h.provisional);
    // the earlier working day has already passed: the only honest suggestion is the next working day
    const late = !!(suggested && today && suggested < today), nextDay = late ? nextWorkingDay(d, scope, cal) : null; if (late) suggested = null;
    return { due: d, scope, closedOnDue: on.length > 0, reasons: on.map((h) => h.name), closuresBefore: before.map((h) => `${h.date} ${h.name}`), suggested, provisional,
      late, nextWorkingDay: nextDay,
      text: late ? `Due ${d} falls on ${on.map((h) => h.name).join(", ")} (${SCOPES[scope] || scope}); the working day before it has passed — expect processing on ${nextDay}.` : on.length ? `Due ${d} falls on ${on.map((h) => h.name).join(", ")} (${SCOPES[scope] || scope}). Consider processing by ${suggested}.` : `Closures before the due date ${d}: ${before.map((h) => h.date + " " + h.name).join("; ")}. Prepare the payment earlier.` };
  }
  /** Pre-fill the fixed-date holidays of a year as PROVISIONAL entries (skips dates already in the calendar). */
  function fixedFor(year, by) { return FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name, type: "national", scope: ["bank", "gov", "company"], provisional: true, source: "Fixed-date official holiday — confirm the observed date with the official announcement (holidays are often moved)", addedBy: by || null })); }
  root.DPHol = { SCOPES, TYPES, DEFAULT, FIXED, use, get cal() { return CAL; }, closures, isWorkingDay, prevWorkingDay, nextWorkingDay, addBusinessDays, check, fixedFor, add };
})(typeof self !== "undefined" ? self : this);
