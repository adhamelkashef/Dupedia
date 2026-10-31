/* X FORCE 1.3 (Dupedia) — the server's hourly reminder and alert job (pure; run by the Cloudflare Worker's cron and by the tests).
   Input: the documents it needs (by path). Output: notifications to add to inboxes. Every notification id is deterministic
   (event + record + date), and the server only inserts a notification that does not exist yet, so an alert is never sent
   twice and a notification a person cleared never comes back.
   Recipients "@admins" and "@finance" are expanded by the server from the user accounts. */
(function (root) {
  "use strict";
  const F = () => root.DPFab, Hd = () => root.DPHol;
  function plan(docs, nowMs) {
    const now = new Date(nowMs).toISOString(), today = now.slice(0, 10), out = [], add = (to, n) => out.push({ to: [].concat(to).filter(Boolean), n: Object.assign({ at: now, from: "server-job", read: false, link: null }, n) });
    const soon = (d, days) => d && d >= today && d <= Hd().add(today, days);
    if (docs["hol/cal"]) Hd().use(docs["hol/cal"]);
    const assigns = {}; for (const [p, d] of Object.entries(docs)) if (/^assign\/[^/]+$/.test(p)) assigns[p.split("/")[1]] = d;
    for (const [p, d] of Object.entries(docs)) {
      // 1. reminders that fell due
      let m = p.match(/^rem\/([^/]+)\/r\/([^/]+)$/);
      if (m && d.status === "open") { const due = d.snoozedUntil && d.snoozedUntil > d.due ? d.snoozedUntil : d.due;
        if (due && due <= now) add(m[1], { id: `rem-${m[2]}-${due.replace(/[^0-9]/g, "").slice(0, 12)}`, type: "reminder", title: `Reminder: ${d.title}`, body: d.notes ? String(d.notes).slice(0, 140) : "It is due now.", link: { view: "reminders" }, priority: d.priority === "urgent" ? "urgent" : null, mandatory: true }); continue; }
      // 2. manufacturing deadlines
      m = p.match(/^fac\/jobs\/j\/([^/]+)$/);
      if (m && d.stage !== "completed" && d.status !== "cancelled") { const oid = m[1], a = assigns[oid] || {}, target = d.target || a.deadlineOriginal, eng = d.engineerUid || a.engineerUid, sales = d.salesUid || a.salesUid;
        if (target && target < today) add([eng, sales, "@admins"], { id: `fac-late-${oid}-${target}`, type: "factory", title: "Production deadline missed", body: `${d.name || oid}: target ${target}, now ${F().STAGE_LABEL[d.stage] || d.stage}.`, ref: oid, link: { view: "facjobs", opts: { oid } }, priority: "warning" });
        else if (soon(target, 3)) add([eng, sales], { id: `fac-soon-${oid}-${target}`, type: "factory", title: "Production deadline approaching", body: `${d.name || oid}: due ${target} (${F().STAGE_LABEL[d.stage] || d.stage}).`, ref: oid, link: { view: "facjobs", opts: { oid } } });
        if (d.materials === "missing") add(["@admins", eng], { id: `fac-mat-${oid}-${today}`, type: "factory", title: "Job blocked by missing material", body: `${d.name || oid}: ${d.materialsNote || "material not available"}.`, ref: oid, link: { view: "facjobs", opts: { oid } }, priority: "warning" });
        continue; }
      // 3. jobs waiting for an engineer for more than a day
      m = p.match(/^assign\/([^/]+)$/);
      if (m && !d.engineerUid && d.status !== "cancelled" && d.createdAt && Date.parse(d.createdAt) < nowMs - 864e5) { add("@admins", { id: `asg-queue-${m[1]}`, type: "factory", title: "Order still unassigned", body: `${d.name || m[1]} has waited more than a day for an engineer.`, ref: m[1], link: { view: "engqueue" }, priority: "warning" }); continue; }
      // 4. machine maintenance and calibration
      m = p.match(/^fac\/eq\/e\/([^/]+)$/);
      if (m && d.status !== "retired") { const s = F().maintStatus(d, today), who = [d.responsibleUid, "@admins"];
        if (s.maint === "overdue" || s.maint === "due") add(who, { id: `eq-m-${m[1]}-${s.next}-${s.maint}`, type: "factory", title: s.maint === "overdue" ? "Maintenance overdue" : "Maintenance due this week", body: `${d.name} (${d.assetId || m[1]}): ${s.next}.`, link: { view: "equipment", opts: { id: m[1] } }, priority: s.maint === "overdue" ? "warning" : null });
        if (s.cal === "overdue" || s.cal === "due") add(who, { id: `eq-c-${m[1]}-${s.calibration}-${s.cal}`, type: "factory", title: s.cal === "overdue" ? "Calibration overdue" : "Calibration due this week", body: `${d.name} (${d.assetId || m[1]}): ${s.calibration}.`, link: { view: "equipment", opts: { id: m[1] } }, priority: s.cal === "overdue" ? "warning" : null });
        continue; }
      // 5. finance: supplier payments and customer collections close to a bank closure
      m = p.match(/^fin\/purch\/p\/([^/]+)$/);
      if (m && d.status === "approved" && d.payState !== "paid" && soon(d.dueDate, 14)) { const c = Hd().check(d.dueDate, { scope: "bank", today });
        add(["@finance", "@admins"], { id: `due-sup-${m[1]}-${d.dueDate}`, type: "finance", title: "Supplier payment due", body: `${d.supplierName || "Supplier"} — purchase ${m[1]} due ${d.dueDate}.${c ? " " + c.text : ""}`, link: { view: "purchases" }, priority: c && c.closedOnDue ? "warning" : null });
        continue; }
      // 6. (1.4) Growth: target-account and partnership follow-ups that fell due; quotations without activity
      m = p.match(/^mkt\/(radar\/a|part\/p)\/([^/]+)$/);
      if (m) { const due = d.nextDue || d.followUp; if (d.ownerUid && due && due <= today && !["ended", "dormant"].includes(d.status) && d.qualification !== "disqualified")
          add(d.ownerUid, { id: `mkt-due-${m[2]}-${due}`, type: "lead", title: m[1] === "radar/a" ? "Target account follow-up due" : "Partnership follow-up due", body: `${d.company || d.name}${d.nextAction ? ": " + d.nextAction : ""} (due ${due}).`, link: { view: m[1] === "radar/a" ? "radar" : "partners", opts: { id: m[2] } } });
        continue; }
      m = p.match(/^submissions\/([^/]+)\/s\/([^/]+)$/);
      if (m) { const at = String(d.updatedAt || d.issuedAt || d.at || "").slice(0, 10), stall = (docs["mkt/cfg"] && docs["mkt/cfg"].stallDays) || 21;
        if (d.status === "submitted" && !d.oid && at && at <= Hd().add(today, -stall)) add(m[1], { id: `quote-stall-${m[2]}-${at}`, type: "lead", title: "Quotation without activity", body: `${d.name || d.ref || m[2]}${d.client ? " — " + d.client : ""}: no update since ${at}. Follow up with the client.`, link: { view: "proposals" }, ref: d.ref || null });
        continue; }
      m = p.match(/^orders\/([^/]+)$/);
      if (m && d.status !== "cancelled") for (const ms of (Array.isArray(d.schedule) ? d.schedule : [])) if (soon(ms.due, 7)) { const c = Hd().check(ms.due, { scope: "bank", today });
        if (c) add(["@finance", "@admins"], { id: `due-col-${m[1]}-${ms.id || ms.label}-${ms.due}`, type: "finance", title: "Collection date affected by a closure", body: `${d.name || m[1]} — ${ms.label || "payment"} due ${ms.due}. ${c.text}`, ref: m[1], link: { view: "finance" }, priority: c.closedOnDue ? "warning" : null }); }
    }
    return out;
  }
  root.DPJobs13 = { plan };
})(typeof self !== "undefined" ? self : this);
