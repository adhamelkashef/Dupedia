/* X FORCE 1.0 (Dupedia) — lead inactivity timer, shared contact record, call tracker, data-entry targets.

   24-HOUR RULE
   A claim (or an administrator assignment with the timer on) expires when its owner logs no QUALIFYING activity for
   24 consecutive hours (configurable). Two mechanisms make this independent of anyone having the app open:
     1. Derived ownership — every client evaluates the same rule (ownership()), so at the deadline the lead is shown as
        Available and can be claimed, even if nothing has run yet.
     2. Server sweep — a scheduled job on claude.ai (qa/sweeper/sweep.py, run hourly through the page's database API with
        SERVER timestamps) releases expired claims for good: deletes the claim, records previous owner, time and reason
        ("inactivity timeout") on the lead, keeps all history, and notifies the previous owner and administrators.
   An administrator's session runs the same release when it opens (releaseExpired), so releases also happen between sweeps.

   QUALIFYING ACTIVITY (qualifies()) — logged by the owner in acts/<uid>/a/<id>:
     call / e-mail / WhatsApp / meeting / site visit with an outcome, and a note of at least 10 characters
       (an unanswered call needs only the outcome: "No Answer", "Busy", "Wrong Number");
     a research update of at least 40 characters;
     never: opening the lead, contact-detail edits, blank or repeated identical entries within an hour.
   Contact-detail maintenance (leadcontact/<lid>) never resets the owner's timer. Data-entry research counts for the
   owner only when an administrator enables "leadTimer.dataEntryCounts". */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, L = () => root.DPLeads;
  const now = () => new Date().toISOString();
  const me = () => AU().A.me || {};
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const LT = { acts: [], contacts: {}, at: 0 };
  const settings = () => ((root.DPUI && root.DPUI.App.config.settings) || {});
  const timerCfg = () => Object.assign({ hours: 24, dataEntryCounts: false }, settings().leadTimer || {});

  const ACT_TYPES = { call: "Call", email: "E-mail", whatsapp: "WhatsApp", meeting: "Meeting", visit: "Site visit", research: "Research update", custom: "Custom activity" };
  const FU_STATUS = { open: "Open", done: "Completed", cancelled: "Cancelled" };
  const fuCfg = () => Object.assign({ advanceMin: 60, overdueHours: 2 }, settings().followUps || {});
  const OUTCOMES = ["No Answer", "Busy", "Wrong Number", "Contact Reached", "Interested", "Not Interested", "Decision-Maker Identified", "Follow-Up Required", "Meeting Scheduled", "Qualified Opportunity"];
  const ATTEMPT_ONLY = ["No Answer", "Busy", "Wrong Number"];
  /** The single definition of a qualifying activity (the server sweep implements the same rule). */
  function qualifies(a, prev) {
    if (!a || !a.type) return { ok: false, why: "No activity type" };
    const notes = String(a.notes || "").trim();
    if (a.type === "research") { if (notes.length < 40) return { ok: false, why: "Research updates need at least 40 characters to count" }; }
    else if (a.type === "custom") { if (!String(a.customLabel || "").trim()) return { ok: false, why: "Describe the activity" }; if (notes.length < 10) return { ok: false, why: "Add a note of at least 10 characters" }; }
    else if (ACT_TYPES[a.type]) {
      if (!a.outcome) return { ok: false, why: "Choose an outcome" };
      if (!ATTEMPT_ONLY.includes(a.outcome) && notes.length < 10) return { ok: false, why: "Add a note of at least 10 characters" };
    } else return { ok: false, why: "Unknown activity type" };
    if (prev && prev.leadId === a.leadId && prev.type === a.type && (prev.outcome || "") === (a.outcome || "") && String(prev.notes || "").trim() === notes && Date.parse(a.at) - Date.parse(prev.at) < 3600e3)
      return { ok: false, why: "Identical to your previous entry within the hour" };
    return { ok: true };
  }

  /* ---------------- loading ---------------- */
  async function loadActs() {
    const ids = await L().uids();
    const lists = await Promise.all(ids.map((u) => DS().tryList(`acts/${u}/a`).then((l) => l.map((x) => Object.assign({ id: x.id, uid: u }, x.data)))));
    LT.acts = lists.flat().sort((a, b) => String(a.at).localeCompare(String(b.at))); LT.at = Date.now(); return LT.acts;
  }
  async function loadContacts() { const l = await DS().tryList("leadcontact"); LT.contacts = Object.fromEntries(l.map((x) => [x.id, x.data])); return LT.contacts; }
  /** The lead as everyone sees it: admin record + shared contact data (data entry and sales edits). */
  function merged(lead) {
    const c = LT.contacts[lead.id]; if (!c) return lead;
    const out = Object.assign({}, lead, { contact: Object.assign({}, lead.contact || {}, c.contact || {}), research: c });
    if (c.website) out.website = c.website;
    if (c.orgType && !lead.orgType) out.orgType = c.orgType;
    if ((c.city || c.area) && !lead.location) out.location = [c.area, c.city].filter(Boolean).join(", ");
    if (c.extraSources && c.extraSources.length) { const s = [...(lead.sources || [])]; for (const x of c.extraSources) if (!s.some((y) => y.url === x.url)) s.push(x); out.sources = s; }
    return out;
  }

  /* ---------------- timer ---------------- */
  const isSalesUid = (uid) => { const r = AU().A.directory.find((x) => x.uid === uid); return !!r && r.active !== false && AU().isSalesRole(r.role); };
  const roleUid = (uid) => { const r = AU().A.directory.find((x) => x.uid === uid); return r ? AU().baseOf(r.role) : null; };
  function lastQualifying(leadId, uid, since) {
    let last = null; const cfg = timerCfg();
    for (const a of LT.acts) {
      if (a.leadId !== leadId || !a.qualifying) continue;
      if (a.uid !== uid && !(cfg.dataEntryCounts && roleUid(a.uid) === "dataentry")) continue;
      if (since && a.at < since) continue;
      if (!last || a.at > last) last = a.at;
    }
    return last;
  }
  /** Deadline of one claim: null = no timer (administrator assignment with the timer switched off). */
  function deadline(lead, claim) {
    if (lead.assignedTo === claim.uid && lead.assignTimer === false) return null;
    if (lead.originKind === "sales" && lead.createdBy === claim.uid && !(lead.assignedTo && lead.assignedTo !== claim.uid)) return null;   // 1.2: a lead a salesperson created stays theirs (no 24-hour release)
    const start = [claim.claimedAt, lead.assignedTo === claim.uid ? lead.assignedAt : null].filter(Boolean).sort().pop();
    const last = lastQualifying(lead.id, claim.uid, start), base = [start, last].filter(Boolean).sort().pop();
    let dl = new Date(Date.parse(base) + timerCfg().hours * 3600e3).toISOString();
    const ext = lead.extensions && lead.extensions[claim.uid]; if (ext && ext.until > dl && ext.from >= String(start)) dl = ext.until;
    return { deadline: dl, start, lastActivity: last };
  }
  /** Ownership with the timer: only active sales staff (or administrators) can hold a lead, and only until their deadline. */
  function ownership(lead, claims = []) {
    const t = Date.now(), valid = [], expired = [], ignored = [];
    for (const c of claims) {
      if (!c.uid) continue;
      if (!isSalesUid(c.uid)) { ignored.push(c); continue; }
      const d = deadline(lead, c); c.deadline = d && d.deadline; c.lastActivity = d && d.lastActivity;
      if (d && Date.parse(d.deadline) <= t) expired.push(c); else valid.push(c);
    }
    if (lead.assignedTo) {
      const a = valid.find((c) => c.uid === lead.assignedTo);
      if (a) return { owner: a.uid, via: "admin", at: lead.assignedAt, deadline: a.deadline, lastActivity: a.lastActivity, others: valid.filter((c) => c !== a), expired, ignored, conflict: false };
    }
    if (valid.length === 1) return { owner: valid[0].uid, via: valid[0].via === "admin" ? "admin" : "claim", at: valid[0].claimedAt, deadline: valid[0].deadline, lastActivity: valid[0].lastActivity, others: [], expired, ignored, conflict: false };
    if (valid.length > 1) return { owner: null, via: null, conflict: true, claimants: valid, others: valid, expired, ignored };
    return { owner: null, via: null, conflict: false, others: [], expired, ignored };
  }
  const remaining = (own) => (own && own.deadline ? Date.parse(own.deadline) - Date.now() : null);
  function fmtRemaining(ms) { if (ms == null) return "No time limit"; if (ms <= 0) return "Expired"; const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3); return h ? `${h} h ${m} min left` : `${m} min left`; }

  /** Release expired claims (administrator session; the scheduled server sweep does the same with server time). */
  async function releaseExpired({ reason = "Inactivity timeout (24 hours without qualifying activity)", by = "app" } = {}) {
    if (!AU().isAdmin()) return [];
    await loadActs(); const [leads, claims] = await Promise.all([L().listLeads(), L().claimsByLead()]), out = [];
    for (const lead of leads) {
      const own = ownership(lead, claims[lead.id] || []);
      for (const c of own.expired) { await releaseOne(lead, c, reason, by); out.push({ lead: lead.id, uid: c.uid }); }
    }
    return out;
  }
  async function releaseOne(lead, c, reason, by) {
    const at = now(), key = `${c.uid}-${c.claimedAt}`;
    if ((lead.releases || []).some((r) => r.key === key)) { await DS().del(`claims/${c.uid}/c/${lead.id}`).catch(() => {}); return; }
    await DS().del(`claims/${c.uid}/c/${lead.id}`);
    const crm = await DS().tryGet(`crm/${c.uid}/l/${lead.id}`);
    if (crm) await DS().set(`crm/${c.uid}/l/${lead.id}`, Object.assign({}, crm, { stage: "released", releasedAt: at, updatedAt: at, stageHistory: (crm.stageHistory || []).concat([{ stage: "released", at, note: reason }]) }));
    const next = Object.assign({}, lead); delete next.id;
    if (next.assignedTo === c.uid) Object.assign(next, { assignedTo: null, assignedAt: null, assignedBy: null, assignReason: null });
    next.status = next.status === "research" ? "research" : "available";
    next.releases = (lead.releases || []).concat([{ key, uid: c.uid, claimedAt: c.claimedAt, lastActivity: c.lastActivity || null, deadline: c.deadline, releasedAt: at, reason, by }]).slice(-50);
    next.history = (lead.history || []).concat([{ at, by: me().id || by, action: "Released: inactivity", reason, detail: AU().nameSync(c.uid) || c.uid }]).slice(-120);
    next.updatedAt = at;
    await DS().set(`leads/${lead.id}`, next);
    await AU().adminLog("Lead released (inactivity)", { target: lead.id, reason, detail: `${lead.name} · ${AU().nameSync(c.uid)}` }).catch(() => {});
    if (root.DPNotify) {
      await root.DPNotify.deliver(c.uid, { id: `release-${lead.id}-${Date.parse(c.claimedAt) || 0}`, type: "lead", title: "Lead released", body: `${lead.name} went back to the Lead Mine after 24 hours without logged activity. Its history is kept.`, link: { view: "leads" }, ref: lead.id }).catch(() => {});
      await root.DPNotify.deliver("@admins", { id: `release-adm-${lead.id}-${Date.parse(c.claimedAt) || 0}`, type: "lead", title: "Lead released for inactivity", body: `${lead.name} (owner: ${AU().nameSync(c.uid) || "—"}).`, link: { view: "allleads" }, ref: lead.id }).catch(() => {});
    }
  }
  /** Administrator: extend one owner's deadline (exceptional, logged). */
  async function extend(leadId, uid, hours, reason) {
    if (!AU().isAdmin()) throw new Error("Administrators only."); if (!reason) throw new Error("A reason is required."); if (!(hours > 0 && hours <= 24 * 14)) throw new Error("Extend by 1 hour to 14 days.");
    const lead = await DS().get(`leads/${leadId}`), claims = (await L().claimsByLead(leadId))[leadId] || [], own = ownership(Object.assign({ id: leadId }, lead), claims);
    const base = own.deadline && Date.parse(own.deadline) > Date.now() ? Date.parse(own.deadline) : Date.now();
    const until = new Date(base + hours * 3600e3).toISOString(), c = claims.find((x) => x.uid === uid);
    const ext = Object.assign({}, lead.extensions || {}, { [uid]: { until, from: (c && c.claimedAt) || now(), by: me().id, at: now(), reason } });
    await L().saveLead(Object.assign({ id: leadId }, lead, { extensions: ext }), "Deadline extended", reason, `${AU().nameSync(uid)} until ${until}`);
  }
  async function setAssignTimer(leadId, on, reason) {
    const lead = await DS().get(`leads/${leadId}`);
    await L().saveLead(Object.assign({ id: leadId }, lead, { assignTimer: !!on }), on ? "24-hour rule on" : "24-hour rule off", reason || "", "");
  }

  /* ---------------- activities & calls ---------------- */
  /** Log an activity on a lead. Returns {qualifying, why}. Never resets anyone else's timer. */
  async function logAct(leadId, a) {
    const uid = me().id; if (!uid) throw new Error("Sign in first.");
    if (!ACT_TYPES[a.type]) throw new Error("Choose the activity type.");
    const mine = LT.acts.filter((x) => x.uid === uid && x.leadId === leadId), prev = mine[mine.length - 1];
    if (a.type === "custom" && !String(a.customLabel || "").trim()) throw new Error("Write the activity description.");
    const fu = normFollowUp(a);
    const doc = { leadId, by: uid, role: me().role, type: a.type, customLabel: a.type === "custom" ? String(a.customLabel).trim().slice(0, 120) : "", direction: a.direction || (["research", "custom"].includes(a.type) ? "" : "outbound"), outcome: a.outcome || "", contact: a.contact || "", notes: String(a.notes || "").trim(),
      nextAction: String(a.nextAction || "").trim().slice(0, 300), followUp: fu.followUp, followUpDate: fu.followUpDate, followUpTime: fu.followUpTime, followUpAt: fu.followUpAt, followUpStatus: fu.followUp ? "open" : null, remindersSent: {},
      responsible: uid, at: a.at || now(), loggedAt: now(), createdBy: uid, updatedAt: now(), updatedBy: uid, history: [] };
    const q = qualifies(doc, prev); doc.qualifying = q.ok; doc.why = q.ok ? "" : q.why;
    const id = rid("A-"); await DS().set(`acts/${uid}/a/${id}`, doc); LT.acts.push(Object.assign({ id, uid }, doc));
    if (a.type !== "research" && root.DPLeads.myCrm) { const crm = await root.DPLeads.myCrm(leadId); if (crm && crm.stage === "claimed" && q.ok) await root.DPLeads.updateCrm(leadId, { stage: "contacted" }, { stageNote: "First activity logged" }).catch(() => {}); }
    if (fu.followUp && root.DPLeads.myCrm) { const crm = await root.DPLeads.myCrm(leadId); if (crm) await root.DPLeads.updateCrm(leadId, { nextAction: { text: doc.nextAction || `Follow up: ${doc.contact || actLabel(doc)}`, due: fu.followUpDate, time: fu.followUpTime, actId: id } }).catch(() => {}); }
    return { qualifying: q.ok, why: q.why || "", id };
  }
  const actLabel = (a) => (a.type === "custom" ? a.customLabel || "Custom activity" : ACT_TYPES[a.type] || a.type);
  /** Follow-up date + time → an absolute instant in the user's own time zone (the browser's), stored in UTC. */
  function normFollowUp(a) {
    const on = !!(a.followUp && a.followUpDate);
    if (!on) return { followUp: false, followUpDate: null, followUpTime: null, followUpAt: null };
    const time = /^\d{2}:\d{2}$/.test(a.followUpTime || "") ? a.followUpTime : "09:00";
    return { followUp: true, followUpDate: a.followUpDate, followUpTime: time, followUpAt: new Date(`${a.followUpDate}T${time}:00`).toISOString() };
  }
  const EDITABLE = ["type", "customLabel", "contact", "direction", "outcome", "notes", "nextAction", "followUp", "followUpDate", "followUpTime", "followUpStatus", "followUpResult"];
  /** Edit a logged activity. The original entry is kept: every change is appended to history with before/after values.
   *  The activity's time and its qualifying status are fixed at creation (editing cannot move the 24-hour timer). */
  async function editAct(uid, id, patch, reason) {
    const editor = me().id; if (uid !== editor && !AU().isAdmin()) throw new Error("You can only edit your own activities.");
    const path = `acts/${uid}/a/${id}`, prev = await DS().get(path); if (!prev) throw new Error("Activity not found.");
    if (patch.type === "custom" && !String(patch.customLabel || prev.customLabel || "").trim()) throw new Error("Write the activity description.");
    const next = Object.assign({}, prev), changes = {};
    for (const k of EDITABLE) if (k in patch && JSON.stringify(patch[k]) !== JSON.stringify(prev[k])) { changes[k] = [prev[k] == null ? null : prev[k], patch[k]]; next[k] = patch[k]; }
    if ("followUpDate" in patch || "followUpTime" in patch || "followUp" in patch) {
      const fu = normFollowUp({ followUp: next.followUp, followUpDate: next.followUpDate, followUpTime: next.followUpTime });
      Object.assign(next, fu); if (fu.followUpAt !== prev.followUpAt) { next.remindersSent = {}; if (fu.followUp && (!next.followUpStatus || next.followUpStatus === "done" && !("followUpStatus" in patch))) next.followUpStatus = "open"; }
    }
    if (patch.followUpStatus === "done" && prev.followUpStatus !== "done") { next.completedAt = now(); next.completedBy = editor; }
    if (!Object.keys(changes).length && next.followUpAt === prev.followUpAt) return prev;
    next.history = (prev.history || []).concat([{ at: now(), by: editor, changes, reason: String(reason || "").slice(0, 300) }]).slice(-100);
    next.updatedAt = now(); next.updatedBy = editor;
    await DS().set(path, next);
    const i = LT.acts.findIndex((x) => x.id === id && x.uid === uid); if (i >= 0) LT.acts[i] = Object.assign({ id, uid }, next);
    if (uid !== editor && AU().isAdmin()) await AU().adminLog("Activity corrected", { target: id, reason, detail: Object.keys(changes).join(", ") }).catch(() => {});
    return next;
  }
  /** Mark a follow-up completed with its result. */
  const completeFollowUp = (uid, id, result) => editAct(uid, id, { followUpStatus: "done", followUpResult: String(result || "").slice(0, 400) }, "Follow-up completed");
  /** My open follow-ups classified: overdue / today / upcoming (completed ones only when asked). */
  function followUps(uid, { includeDone = false } = {}) {
    const t = Date.now(), endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    return LT.acts.filter((a) => a.uid === uid && a.followUp && a.followUpAt && (includeDone || (a.followUpStatus || "open") === "open"))
      .map((a) => { const at = Date.parse(a.followUpAt); return Object.assign({}, a, { when: (a.followUpStatus || "open") !== "open" ? a.followUpStatus : at < t ? "overdue" : at <= endToday.getTime() ? "today" : "upcoming" }); })
      .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));
  }
  /** Client-side reminders while the app is open (the hourly server sweep sends the same ones when nobody is online).
   *  Deterministic ids + the act's remindersSent flags prevent duplicates between the two. */
  async function checkReminders() {
    const uid = me().id; if (!uid || !root.DPNotify) return 0; const cfg = fuCfg(), t = Date.now(); let n = 0;
    for (const a of LT.acts.filter((x) => x.uid === uid && x.followUp && x.followUpAt && (x.followUpStatus || "open") === "open")) {
      const at = Date.parse(a.followUpAt), sent = a.remindersSent || {}, lead = (await DS().tryGet(`leads/${a.leadId}`)) || {}, who = a.contact ? ` with ${a.contact}` : "";
      const due = [["pre", t >= at - cfg.advanceMin * 60e3 && t < at, "Follow-up coming up", `${lead.name || "Lead"}${who} at ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${a.nextAction ? " — " + a.nextAction : ""}`],
        ["due", t >= at && t < at + cfg.overdueHours * 3600e3, "Follow-up due now", `${lead.name || "Lead"}${who}${a.nextAction ? " — " + a.nextAction : ""}`],
        ["over", t >= at + cfg.overdueHours * 3600e3, "Follow-up overdue", `${lead.name || "Lead"}${who} was due ${new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`]];
      for (const [k, cond, title, body] of due) {
        if (!cond || sent[k]) continue;
        if (k === "pre" && sent.due) continue;
        const made = await root.DPNotify.toSelf({ id: `fu-${a.id}-${k}`, type: "followup", priority: k === "pre" ? "normal" : "high", title, body, link: { view: "calls", opts: { act: a.id } }, ref: a.leadId });
        // 1.1: an overdue follow-up is also reported to the administrators (once; no money in it)
        if (k === "over" && made) await root.DPNotify.deliver("@admins", { id: `fu-adm-${a.id}`, type: "followup", title: "Follow-up overdue", body: `${me().name || "A salesperson"}: ${body}`, link: { view: "allleads" }, ref: a.leadId }).catch(() => {});
        const doc = await DS().tryGet(`acts/${uid}/a/${a.id}`); if (doc) { doc.remindersSent = Object.assign({}, doc.remindersSent || {}, { [k]: now() }); await DS().set(`acts/${uid}/a/${a.id}`, doc).catch(() => {}); a.remindersSent = doc.remindersSent; }
        if (made) n++;
      }
    }
    return n;
  }
  const actsFor = (leadId) => LT.acts.filter((a) => a.leadId === leadId).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* ---------------- shared contact record (data entry + sales) ---------------- */
  function completeness(lead, c, crit) {
    crit = Object.assign({ orgType: true, location: true, source: true, verifiedMethods: 1, phone: false, email: false, contactName: false, fit: true, qualified: true }, crit || settings().leadComplete || {});
    const m = merged(Object.assign({}, lead)), ct = Object.assign({}, lead.contact || {}, (c && c.contact) || {}), miss = [];
    if (crit.orgType && !m.orgType) miss.push("organisation type");
    if (crit.location && !m.location) miss.push("location");
    if (crit.source && !((c && c.website) || m.website || (m.sources || []).length)) miss.push("website or source");
    const ver = (ct.phone && ct.phoneVerified ? 1 : 0) + (ct.email && ct.emailVerified ? 1 : 0);
    if (ver < (crit.verifiedMethods || 0)) miss.push(`${crit.verifiedMethods} verified contact method${crit.verifiedMethods > 1 ? "s" : ""}`);
    if (crit.phone && !(ct.phone && ct.phoneVerified)) miss.push("verified phone");
    if (crit.email && !(ct.email && ct.emailVerified)) miss.push("verified e-mail");
    if (crit.contactName && !ct.name) miss.push("contact name");
    if (crit.fit && !(m.productsFit || (c && c.productsFit))) miss.push("Dupedia product fit");
    if (crit.qualified && !(c && c.qualification === "qualified")) miss.push("qualification status “Qualified”");
    return { complete: !miss.length, missing: miss };
  }
  /** Save contact / research data on the central record. Never changes ownership; never resets the owner's timer. */
  async function saveContact(leadId, patch, note) {
    const uid = me().id; if (!uid) throw new Error("Sign in first.");
    if (!["admin", "employee", "dataentry"].includes(me().role)) throw new Error("Your role cannot edit lead contact data.");
    const lead = await DS().get(`leads/${leadId}`); if (!lead) throw new Error("Lead not found.");
    const prev = (await DS().tryGet(`leadcontact/${leadId}`)) || {}, at = now();
    const next = Object.assign({}, prev, patch, { contact: Object.assign({}, prev.contact || {}, patch.contact || {}), updatedAt: at, updatedBy: uid, lastResearchedAt: at, lastResearchedBy: uid });
    const ct = next.contact;
    for (const k of ["phone", "email"]) {
      const was = (prev.contact || {})[k] || "", isV = !!ct[k + "Verified"];
      if (ct[k] && ct[k] !== was && !(patch.contact && patch.contact[k + "Verified"])) ct[k + "Verified"] = false;   // a changed value needs re-verification
      if (isV && ct[k] && !ct.source) throw new Error("Record where the contact details come from before marking them verified.");
    }
    if (ct.phone && !/^[+()0-9\s-]{6,24}$/.test(ct.phone)) throw new Error("The phone number has invalid characters.");
    if (ct.phone && ct.phone.replace(/\D/g, "").length < 7) throw new Error("The phone number is too short.");
    if (ct.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ct.email)) throw new Error("The e-mail address is not valid.");
    if (ct.phoneVerified || ct.emailVerified) { ct.verifiedAt = ct.verifiedAt && (prev.contact || {}).verifiedAt ? ct.verifiedAt : at; ct.verifiedBy = uid; }
    if (next.qualification && !QUAL_STATUS[next.qualification]) throw new Error("Unknown qualification status.");
    if ((patch.contact || {}).phoneVerified || (patch.contact || {}).emailVerified) next.lastVerifiedAt = at;
    if (!next.researchDate) next.researchDate = at.slice(0, 10);
    const comp = completeness(lead, next);
    next.completeness = comp;
    const firstComplete = comp.complete && !prev.completedAt;
    if (firstComplete) { next.completedAt = at; next.completedBy = uid; }   // counted once, by whoever completed it first
    const changed = Object.keys(patch).concat(Object.keys(patch.contact || {}).map((k) => "contact." + k)).filter((k) => k !== "contact");
    await DS().set(`leadcontact/${leadId}`, next);
    await DS().set(`leadcontact/${leadId}/log/${rid("c-")}`, { at, by: uid, role: me().role, fields: changed, note: String(note || "").slice(0, 300) });
    LT.contacts[leadId] = next;
    if (firstComplete && root.DPChat) root.DPChat.system(`lead-q-${leadId}`, "A new qualified lead has been added to the Lead Mine.", { view: "leads" }).catch(() => {});
    if (firstComplete && root.DPNotify) root.DPNotify.deliver("@admins", { id: `lead-q-${leadId}`, type: "lead", title: "Lead completed and qualified", body: `${lead.name} is now complete and qualified.`, link: { view: "allleads" }, ref: leadId }).catch(() => {});
    if (patch.dupOf && root.DPNotify) await root.DPNotify.deliver("@admins", { id: `dup-${leadId}`, type: "lead", title: "Possible duplicate lead", body: `${lead.name} may duplicate another record. Review it in All Leads.`, link: { view: "allleads" }, ref: leadId }).catch(() => {});
    return next;
  }
  const QUAL_STATUS = { new: "Not yet qualified", research: "Researching", qualified: "Qualified", disqualified: "Disqualified" };
  /** Possible duplicates of a lead: same normalised company name, or the same phone or e-mail on another record. */
  function duplicatesOf(leadId, name, contact, leads) {
    const norm = (x) => String(x || "").toLowerCase().replace(/\b(company|co|group|developments?|egypt|s\.?a\.?e|llc|ltd)\b/g, "").replace(/[^a-z0-9\u0600-\u06ff]/g, "");
    const n = norm(name), ph = String((contact || {}).phone || "").replace(/\D/g, "").slice(-9), em = String((contact || {}).email || "").toLowerCase();
    return (leads || []).filter((l) => l.id !== leadId && !["merged"].includes(l.status)).filter((l) => { const c = Object.assign({}, l.contact || {}, ((LT.contacts[l.id] || {}).contact) || {});
      return (n && n.length > 3 && norm(l.name) === n) || (ph.length >= 7 && String(c.phone || "").replace(/\D/g, "").slice(-9) === ph) || (em && String(c.email || "").toLowerCase() === em); });
  }
  async function contactLog(leadId) { return (await DS().tryList(`leadcontact/${leadId}/log`)).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  /** Data entry proposes a new lead; an administrator approves it into the Lead Mine. */
  async function proposeLead(data) {
    const uid = me().id; if (!data.name || !(data.sources || []).length) throw new Error("Give the organisation name and at least one source.");
    const id = rid("P-"); await DS().set(`leadprop/${uid}/p/${id}`, Object.assign({ status: "proposed", at: now(), by: uid }, data));
    if (root.DPNotify) await root.DPNotify.deliver("@admins", { id: `prop-${id}`, type: "lead", title: "New lead proposed", body: `${data.name} was proposed by ${me().name || "data entry"}.`, link: { view: "allleads" } }).catch(() => {});
    return id;
  }
  async function listProposals() { const ids = await L().uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`leadprop/${u}/p`).then((x) => x.map((y) => Object.assign({ id: y.id, uid: u }, y.data))))); return l.flat(); }
  async function decideProposal(p, accept, reason) {
    if (!AU().isAdmin()) throw new Error("Administrators only.");
    if (accept) { const lead = Object.assign({}, p); ["id", "uid", "status", "at", "by"].forEach((k) => delete lead[k]); await L().importLeads([Object.assign(lead, { origin: `Proposed by ${AU().nameSync(p.uid)}` })], { origin: "Data entry proposal" });
      if (root.DPChat) root.DPChat.system(`lead-new-${p.id}`, "A new lead has been added to the Lead Mine.", { view: "leads" }).catch(() => {}); }
    await DS().set(`leadprop/${p.uid}/p/${p.id}`, Object.assign({}, p, { status: accept ? "accepted" : "rejected", decidedAt: now(), decidedBy: me().id, reason: reason || "" }));
  }
  /** Administrator asks for a correction: flag on the shared record + notification to data entry staff. */
  async function requestCorrection(leadId, note) {
    if (!AU().isAdmin()) throw new Error("Administrators only.");
    const prev = (await DS().tryGet(`leadcontact/${leadId}`)) || {};
    await DS().set(`leadcontact/${leadId}`, Object.assign({}, prev, { needsCorrection: { at: now(), by: me().id, note } }));
    const de = AU().A.directory.filter((r) => r.uid && r.active !== false && AU().baseOf(r.role) === "dataentry").map((r) => r.uid);
    if (root.DPNotify && de.length) await root.DPNotify.deliver(de, { id: `corr-${leadId}-${Date.now().toString(36)}`, type: "lead", title: "Lead needs correction", body: note, link: { view: "research" }, ref: leadId });
  }

  /* ---------------- figures ---------------- */
  const inPer = (iso, per) => !!iso && String(iso).slice(0, 7) === per;
  const today = () => new Date().toISOString().slice(0, 10);
  function callFigures(uid, per) {
    const mine = LT.acts.filter((a) => a.uid === uid && ["call", "email", "whatsapp", "meeting", "visit"].includes(a.type));
    const calls = mine.filter((a) => a.type === "call"), q = (l) => l.filter((a) => a.qualifying);
    return { today: q(calls.filter((a) => String(a.at).slice(0, 10) === today())).length, month: q(calls.filter((a) => inPer(a.at, per))).length,
      reached: q(mine.filter((a) => inPer(a.at, per) && !["No Answer", "Busy", "Wrong Number"].includes(a.outcome))).length,
      followUps: mine.filter((a) => a.followUp && a.followUpDate && (a.followUpStatus || "open") === "open" && a.followUpDate <= today()).length,
      meetings: q(mine.filter((a) => inPer(a.at, per) && (a.outcome === "Meeting Scheduled" || a.type === "meeting"))).length,
      qualified: q(mine.filter((a) => inPer(a.at, per) && a.outcome === "Qualified Opportunity")).length,
      wrong: mine.filter((a) => inPer(a.at, per) && a.outcome === "Wrong Number").length };
  }
  /** Data entry: completed leads count once per lead, on the month the lead first met the criteria. */
  function dataEntryFigures(uid, per, leads) {
    const C = LT.contacts, list = Object.entries(C);
    const completed = list.filter(([, c]) => c.completedBy === uid && inPer(c.completedAt, per)).length;
    const researchedToday = new Set(LT.acts.filter((a) => a.uid === uid && a.type === "research" && String(a.at).slice(0, 10) === today()).map((a) => a.leadId));
    list.filter(([, c]) => c.lastResearchedBy === uid && String(c.lastResearchedAt).slice(0, 10) === today()).forEach(([id]) => researchedToday.add(id));
    const ct = (id) => Object.assign({}, (leads.find((l) => l.id === id) || {}).contact || {}, (C[id] || {}).contact || {});
    const open = leads.filter((l) => !["archived", "merged", "inactive"].includes(l.status));
    return { completed, researchedToday: researchedToday.size,
      verifiedPhones: open.filter((l) => ct(l.id).phone && ct(l.id).phoneVerified).length, verifiedEmails: open.filter((l) => ct(l.id).email && ct(l.id).emailVerified).length,
      awaiting: open.filter((l) => !(C[l.id] && C[l.id].completedAt)).length, duplicates: open.filter((l) => C[l.id] && C[l.id].dupOf).length,
      corrections: open.filter((l) => C[l.id] && C[l.id].needsCorrection && !C[l.id].needsCorrection.resolvedAt).length,
      researchCalls: LT.acts.filter((a) => a.uid === uid && a.type === "call" && inPer(a.at, per)).length,
      verifiedThisMonth: list.filter(([, c]) => c.contact && c.contact.verifiedBy === uid && inPer(c.contact.verifiedAt, per)).length,
      wrongNumbers: LT.acts.filter((a) => a.uid === uid && a.outcome === "Wrong Number" && inPer(a.at, per)).length,
      updated: new Set(list.filter(([, c]) => c.updatedBy === uid && inPer(c.updatedAt, per)).map(([id]) => id)).size };
  }
  function dataEntryTarget(staff, per) { const t = staff && staff.leadTargets && staff.leadTargets[per]; return t != null ? +t : +(((settings().dataEntry) || {}).monthlyTarget || 30); }

  root.DPLeadOps = { QUAL_STATUS, duplicatesOf, LT, ACT_TYPES, FU_STATUS, OUTCOMES, qualifies, actLabel, editAct, completeFollowUp, followUps, checkReminders, fuCfg, normFollowUp, loadActs, loadContacts, merged, deadline, ownership, remaining, fmtRemaining, releaseExpired, extend, setAssignTimer, logAct, actsFor,
    completeness, saveContact, contactLog, proposeLead, listProposals, decideProposal, requestCorrection, callFigures, dataEntryFigures, dataEntryTarget, timerCfg, isSalesUid };
})(typeof self !== "undefined" ? self : this);
