/* X FORCE 1.1 (Dupedia) — hourly server sweep for Cloudflare: a line-for-line JavaScript port of ops/sweep.py.
   Lead release (24-hour rule), follow-up reminders, overdue customer payments and queued research requests.
   Pure function: takes the documents it needs ({ "path": data }) and the current time, returns the actions to apply
   ({now, releases, reminders, overdue, researchFire, state, notes, reason}) — exactly the output of ops/sweep.py.
   qa/sweep_parity.py runs the Python test-suite fixtures through both and compares the results. */

const ATTEMPT_ONLY = new Set(["No Answer", "Busy", "Wrong Number"]);
const ACT_TYPES = new Set(["call", "email", "whatsapp", "meeting", "visit", "research", "custom"]);
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;

const iso = (t) => new Date(t).toISOString();
function parse(s) {
  if (!s) return null;
  const t = Date.parse(String(s));
  return Number.isFinite(t) ? t : null;
}
const isDict = (x) => x && typeof x === "object" && !Array.isArray(x);
const str = (x) => (x == null || x === false ? "" : String(x));
const num = (x, d) => { const v = parseFloat(x); return Number.isFinite(v) && v ? v : d; };
/** Python str(float) — 50 → "50.0", 7.5 → "7.5" (used in a label, so output matches ops/sweep.py exactly). */
const pyFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

function qualifies(a, prev) {
  const t = a.type, notes = str(a.notes).trim();
  if (!ACT_TYPES.has(t)) return false;
  if (t === "research") { if (notes.length < 40) return false; }
  else if (t === "custom") { if (!str(a.customLabel).trim() || notes.length < 10) return false; }
  else { if (!a.outcome) return false; if (!ATTEMPT_ONLY.has(a.outcome) && notes.length < 10) return false; }
  if (prev && prev.leadId === a.leadId && prev.type === t && str(prev.outcome) === str(a.outcome) && str(prev.notes).trim() === notes) {
    const pa = parse(prev.at), aa = parse(a.at);
    if (pa != null && aa != null && (aa - pa) / 1000 < 3600) return false;
  }
  return true;
}

/* ---------- time zone helpers (strftime equivalents) ---------- */
function parts(t, tz) {
  let f;
  try { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch (e) { f = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: p.year, mon: p.month, d: p.day, H: p.hour === "24" ? "00" : p.hour, M: p.minute };
}
function dayIn(tz, t) {
  try { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; }
  catch (e) { return new Date(t).toISOString().slice(0, 10); }
}
const validTz = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch (e) { return false; } };

/* ---------- payment obligations (mirror of app/payments.js) ---------- */
function paySummary(o, today, tz, depPct) {
  const payable = Math.max(0, Math.round(+o.totalMinor || 0) + (o.valueAdjustments || []).filter((a) => a && a.status !== "void").reduce((s, a) => s + Math.round(+a.amountMinor || 0), 0));
  const verified = (o.payments || []).filter((p) => p && p.status === "verified").reduce((s, p) => s + Math.round(+p.amountMinor || 0), 0);
  const acc = parse(o.acceptedAt), accDay = acc != null ? dayIn(tz, acc) : null;
  const sched = (o.schedule || []).filter(Boolean).map((x) => Object.assign({}, x));
  sched.forEach((x, i) => {
    if (!("id" in x)) x.id = x.kind === "deposit" ? "dep" : "m" + (i + 1);
    if (!x.kind) x.kind = i === 0 && /advance|deposit|down/i.test(str(x.label)) ? "deposit" : "custom";
  });
  if (!sched.some((x) => x.kind === "deposit")) sched.unshift({ id: "dep", kind: "deposit", label: `Initial deposit (${pyFloat(depPct)}%)`, pct: depPct, due: accDay });
  let seenDep = false;
  for (const x of sched) if (x.kind === "deposit") { if (seenDep) x.kind = "custom"; seenDep = true; }
  sched.sort((a, b) => { const ka = a.kind === "deposit" ? 0 : 1, kb = b.kind === "deposit" ? 0 : 1; if (ka !== kb) return ka - kb; const da = str(a.due || "9999"), db = str(b.due || "9999"); return da < db ? -1 : da > db ? 1 : 0; });
  let left = verified; const out = [];
  for (const m of sched) {
    const exp = m.pct != null && m.pct !== "" ? Math.round(payable * parseFloat(m.pct) / 100) : Math.max(0, Math.round(+m.amountMinor || 0));
    const paid = Math.min(left, exp); left -= paid; const rem = exp - paid, due = m.due;
    const overdue = rem > 0 && !!due && due < today;
    const days = overdue ? Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / DAY) : 0;
    out.push({ id: m.id, label: m.label || "Payment", due, expected: exp, remaining: rem, overdue, days });
  }
  return { payable, verified, milestones: out };
}
const money = (minor, cur) => `${cur || "EGP"} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * @param {Record<string, any>} docs  documents by path: directory/*, leads/*, claims/<uid>/c/*, acts/<uid>/a/*, orders/*,
 *                                    mi/req/r/*, config/settings, config/roles, sweep/state
 * @param {number} nowMs
 */
export function computeSweep(docs, nowMs = Date.now()) {
  const now = nowMs;
  const get = (p) => (isDict(docs[p]) ? docs[p] : null);
  const under = (re) => Object.keys(docs).filter((p) => re.test(p) && isDict(docs[p])).sort();
  const settings = get("config/settings") || {}, rolesDoc = get("config/roles") || {};
  const timer = Object.assign({ hours: 24, dataEntryCounts: false }, settings.leadTimer || {});
  const state = get("sweep/state") || {}, seen = Object.assign({}, state.firstSeen || {});
  const baseOf = { admin: "admin", employee: "employee", engineer: "engineer", dataentry: "dataentry" };
  for (const r of rolesDoc.roles || []) if (r && r.id && ["admin", "employee", "engineer", "dataentry"].includes(r.base)) baseOf[r.id] = r.base;
  const users = {};
  for (const p of under(/^directory\/[^/]+$/)) {
    const r = docs[p], did = p.split("/")[1], uid = r.uid || did;
    users[uid] = { active: r.active !== false, base: baseOf[r.role] || "employee", name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.displayName || uid };
  }
  const leads = {}; for (const p of under(/^leads\/[^/]+$/)) leads[p.split("/")[1]] = docs[p];
  // activities per (uid, lead), time-ordered, future-dated ignored
  const acts = [];
  for (const p of under(/^acts\/[^/]+\/a\/[^/]+$/)) {
    const a = docs[p], uid = p.split("/")[1], at = parse(a.at);
    if (at == null || at > now + 5 * MIN) continue;
    acts.push([uid, at, a]);
  }
  acts.sort((x, y) => x[1] - y[1]);
  const lastQ = {}, prevBy = {};
  for (const [uid, at, a] of acts) {
    const k = uid + "\u0000" + a.leadId;
    if (qualifies(a, prevBy[k])) (lastQ[a.leadId] = lastQ[a.leadId] || []).push([uid, at]);
    prevBy[k] = a;
  }
  const releases = [], notes = [], newSeen = {};
  const hours = num(timer.hours, 24);
  for (const p of under(/^claims\/[^/]+\/c\/[^/]+$/)) {
    const uid = p.split("/")[1], lid = p.split("/")[3], c = docs[p] || {}, lead = leads[lid];
    const key = `${uid}|${lid}`, first = parse(seen[key]) ?? now;
    newSeen[key] = iso(first);
    if (lead == null) { notes.push(`claim on missing lead ${lid} by ${uid}`); continue; }
    const u = users[uid];
    if (!u || !u.active || !["employee", "admin"].includes(u.base)) { notes.push(`claim by non-sales or inactive user ${uid} on ${lid} is ignored by the app; left for an administrator`); continue; }
    if (lead.assignedTo === uid && lead.assignTimer === false) continue;
    let claimed = parse(c.claimedAt);
    if (claimed != null && claimed > now + 5 * MIN) claimed = null;
    let start = Math.min(...[claimed, first].filter((x) => x != null));
    if (lead.assignedTo === uid) { const aa = parse(lead.assignedAt); if (aa != null && aa <= now && aa > start) start = aa; }
    const cntDe = !!timer.dataEntryCounts;
    let last = null;
    for (const [au, at] of lastQ[lid] || []) {
      if (at < start) continue;
      if (au === uid || (cntDe && (users[au] || {}).base === "dataentry")) if (last == null || at > last) last = at;
    }
    let deadline = Math.max(...[start, last].filter((x) => x != null)) + hours * HOUR;
    const ext = (lead.extensions || {})[uid];
    if (ext) {
      const until = parse(ext.until), frm = parse(ext.from);
      if (until != null && until > deadline && (frm == null || claimed == null || frm >= claimed - 1000)) deadline = until;
    }
    if (deadline <= now) {
      releases.push({ lead: lid, leadName: lead.name || lid, uid, ownerName: u.name, claimedAt: c.claimedAt ?? null, lastActivity: last != null ? iso(last) : null, deadline: iso(deadline),
        key: `${uid}-${c.claimedAt ?? "None"}`, alreadyRecorded: (lead.releases || []).some((r) => r && r.key === `${uid}-${c.claimedAt ?? "None"}`) });
    }
  }
  const reason = `Inactivity timeout (${Math.trunc(hours)} hours without qualifying activity)`;
  for (const r of releases) {
    const lead = leads[r.lead];
    const patch = {
      releases: (lead.releases || []).concat(r.alreadyRecorded ? [] : [{ key: r.key, uid: r.uid, claimedAt: r.claimedAt, lastActivity: r.lastActivity, deadline: r.deadline, releasedAt: iso(now), reason, by: "server-sweep" }]),
      history: (lead.history || []).concat(r.alreadyRecorded ? [] : [{ at: iso(now), by: "server-sweep", action: "Released: inactivity", reason, detail: r.ownerName }]),
      status: lead.status === "research" ? "research" : "available", updatedAt: iso(now),
    };
    if (lead.assignedTo === r.uid) Object.assign(patch, { assignedTo: null, assignedAt: null, assignedBy: null, assignReason: null });
    patch.releases = patch.releases.slice(-50); patch.history = patch.history.slice(-120);
    r.leadPatch = patch;
    const ca = parse(r.claimedAt);
    r.notification = { id: `release-${r.lead}-${ca != null ? Math.trunc(ca) : 0}`, type: "lead", title: "Lead released",
      body: `${r.leadName} went back to the Lead Mine after ${Math.trunc(hours)} hours without logged activity. Its history is kept.`,
      link: { view: "leads" }, ref: r.lead, at: iso(now), from: "server-sweep", read: false, celebrate: false, data: null };
  }
  // follow-up reminders
  const fu = Object.assign({ advanceMin: 60, overdueHours: 2 }, settings.followUps || {});
  const tzname = settings.timezone || "Africa/Cairo", tz = validTz(tzname) ? tzname : "UTC";
  const reminders = [];
  for (const p of under(/^acts\/[^/]+\/a\/[^/]+$/)) {
    const uid = p.split("/")[1], aid = p.split("/")[3], a = docs[p];
    if (!a.followUp || (a.followUpStatus || "open") !== "open") continue;
    const at = parse(a.followUpAt); if (at == null) continue;
    const u = users[a.responsible || uid]; if (!u || !u.active) continue;
    const sent = Object.assign({}, a.remindersSent || {}), lead = leads[a.leadId] || {};
    const who = a.contact ? ` with ${a.contact}` : "", L = parts(at, tz), nxt = a.nextAction ? ` — ${a.nextAction}` : "";
    const adv = parseFloat(fu.advanceMin) * MIN, od = parseFloat(fu.overdueHours) * HOUR, kinds = [];
    if (at - adv <= now && now < at && !sent.due) kinds.push(["pre", "Follow-up coming up", `${lead.name || "Lead"}${who} at ${L.H}:${L.M}${nxt}`]);
    if (at <= now && now < at + od) kinds.push(["due", "Follow-up due now", `${lead.name || "Lead"}${who}${nxt}`]);
    if (now >= at + od) kinds.push(["over", "Follow-up overdue", `${lead.name || "Lead"}${who} was due ${L.d} ${L.mon} ${L.y} ${L.H}:${L.M} (${tzname})`]);
    for (const [k, title, body] of kinds) {
      if (sent[k]) continue;
      sent[k] = iso(now);
      reminders.push({ uid: a.responsible || uid, actOwner: uid, act: aid, kind: k,
        notification: { id: `fu-${aid}-${k}`, type: "followup", title, body, link: { view: "calls", opts: { act: aid } }, ref: a.leadId ?? null, at: iso(now), from: "server-sweep", read: false, celebrate: false, data: null },
        actPatch: { remindersSent: Object.assign({}, sent) } });
    }
  }
  // overdue customer payments
  const payCfg = Object.assign({ depositPct: 50, escalateDays: 7 }, settings.payTerms || {});
  const admins = Object.keys(users).filter((u) => users[u].active && users[u].base === "admin").sort();
  const today = dayIn(tz, now), overdue = [];
  for (const p of under(/^orders\/[^/]+$/)) {
    const oid = p.split("/")[1], o = docs[p];
    if (o.status === "cancelled") continue;
    const sm = paySummary(o, today, tz, num(payCfg.depositPct, 50));
    for (const m of sm.milestones) {
      if (!m.overdue) continue;
      const levels = [["", "Payment overdue", "normal"]].concat(m.days >= Math.trunc(num(payCfg.escalateDays, 7)) ? [["-esc", "Payment still overdue — escalate", "high"]] : []);
      for (const [suf, title, prio] of levels) {
        const nid = `od-${oid}-${m.id}-${m.due}${suf}`;
        const to = [...new Set(admins.concat(o.ownerId && (users[o.ownerId] || {}).active ? [o.ownerId] : []))].sort();
        overdue.push({ to, notification: { id: nid, type: "payment", priority: prio, title,
          body: `${o.ref || oid} · ${o.name || ""}: ${m.label} of ${money(m.remaining, o.currency)} was due ${m.due}. Next step: contact the client and agree a payment date.`,
          link: { view: "proposals", opts: { oid } }, ref: oid, at: iso(now), from: "server-sweep", read: false, celebrate: false, data: null } });
      }
    }
  }
  // queued research requests
  const reqs = {}; for (const p of under(/^mi\/req\/r\/[^/]+$/)) reqs[p.split("/")[3]] = docs[p];
  const running = Object.keys(reqs).filter((k) => { const r = reqs[k], s = parse(r.startedAt); return r.status === "running" && s != null && now - s < 90 * MIN; });
  const queued = Object.keys(reqs).filter((k) => { const r = reqs[k], a = parse(r.at); return r.status === "queued" && a != null && now - a >= 10 * MIN && now - a < 2 * DAY; }).sort();
  const researchFire = queued.length && !running.length ? { requestIds: queued } : null;
  if (queued.length && running.length) notes.push("Research requests queued while another run is in progress: not started twice.");
  const outState = { firstSeen: newSeen, lastRun: iso(now), lastReleases: releases.length, lastReminders: reminders.length, lastOverdue: overdue.length };
  return { now: iso(now), releases, reminders, overdue, researchFire, state: outState, notes, reason };
}
