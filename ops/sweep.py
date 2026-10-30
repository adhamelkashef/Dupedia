#!/usr/bin/env python3
"""X FORCE 1.1 (Dupedia) — server-side sweep: lead release (24-hour rule), follow-up reminders, overdue customer payments,
and starting queued Market Intelligence research requests.

Run by the scheduled task on claude.ai every hour, with nobody needing the app open. The task reads the page's
database through the database API into a folder, runs this script, and applies the actions it prints.

    python3 sweep.py <dump_dir> [--now 2026-10-26T12:00:00Z]

<dump_dir> holds the documents as saved by the database API's out_dir option:
    directory/<uid>.json        leads/<lid>.json        claims/<uid>/c/<lid>.json        acts/<uid>/a/<aid>.json
    config/settings.json (optional)        sweep/state.json (optional)
    orders/<oid>.json (1.1, optional)      mi/req/r/<id>.json (1.1, optional)

OVERDUE PAYMENTS (1.1, same rules as app/payments.js): each accepted order has an initial deposit obligation
(settings.payTerms.depositPct, default 50 %) due on the acceptance date, plus any configured milestones. Only VERIFIED
payments count; they are allocated to milestones in due order. A milestone with money still owed after its due date is
overdue: one notification per milestone and due date (id od-<oid>-<milestone>-<due>) to the administrators and the
salesperson, and one escalation after settings.payTerms.escalateDays (default 7). Cancelled orders are not chased.
RESEARCH REQUESTS (1.1): if a "Run now" request has been queued for 10+ minutes and nothing is running, the output says
so (researchFire) and the scheduled task starts the research task.

The rule is the same one the app applies (app/leadops.js):
  * only active sales staff (roles with base "employee" or "admin") can hold a lead; other claims are ignored;
  * deadline = max(claim start, last qualifying activity by the owner) + hours (default 24); an administrator extension
    can push it later; an administrator assignment with the timer switched off has no deadline;
  * claim start = the EARLIEST of the claim's own time and the time this sweep first saw the claim (sweep/state), so
    rewriting a claim document cannot restart the clock;
  * activity dated in the future (more than 5 minutes ahead of server time) is ignored;
  * qualifying activity: call / e-mail / WhatsApp / meeting / site visit with an outcome and a note of 10+ characters
    (No Answer / Busy / Wrong Number need only the outcome); research update of 40+ characters; identical repeats within
    an hour do not count; data-entry activity counts for the owner only if settings.leadTimer.dataEntryCounts is true.
FOLLOW-UP REMINDERS (X FORCE 1.0): for every open follow-up on an activity (acts/<uid>/a/<aid>: followUp true,
followUpStatus "open", followUpAt) the sweep prepares up to three reminders for the responsible person, each once:
  pre  — within settings.followUps.advanceMin minutes (default 60) before the follow-up time,
  due  — from the follow-up time until settings.followUps.overdueHours (default 2) later,
  over — after that.
A reminder already marked in the activity's remindersSent (by the app or an earlier sweep) is never sent again; the
notification id fu-<aid>-<kind> is the same one the app uses, so the two cannot duplicate. Times in the message text are
shown in settings.timezone (default Africa/Cairo). As the sweep runs hourly, a reminder can arrive up to an hour late.
Output: JSON {now, releases:[...], reminders:[...], state:{...}, notes:[...]} on stdout. Nothing is written by this script.
"""
import json, os, re, sys, glob
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None
from datetime import datetime, timedelta, timezone

ATTEMPT_ONLY = {"No Answer", "Busy", "Wrong Number"}
ACT_TYPES = {"call", "email", "whatsapp", "meeting", "visit", "research", "custom"}

def iso(dt): return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
def parse(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception: return None
def load(path):
    try:
        with open(path) as f: return json.load(f)
    except Exception: return None
def docs(pattern):
    out = {}
    for p in glob.glob(pattern):
        d = load(p)
        if isinstance(d, dict): out[os.path.splitext(os.path.basename(p))[0]] = d
    return out

def qualifies(a, prev):
    t = a.get("type"); notes = str(a.get("notes") or "").strip()
    if t not in ACT_TYPES: return False
    if t == "research":
        if len(notes) < 40: return False
    elif t == "custom":
        if not str(a.get("customLabel") or "").strip() or len(notes) < 10: return False
    else:
        if not a.get("outcome"): return False
        if a.get("outcome") not in ATTEMPT_ONLY and len(notes) < 10: return False
    if prev and prev.get("leadId") == a.get("leadId") and prev.get("type") == t and (prev.get("outcome") or "") == (a.get("outcome") or "") \
            and str(prev.get("notes") or "").strip() == notes:
        pa, aa = parse(prev.get("at")), parse(a.get("at"))
        if pa and aa and (aa - pa).total_seconds() < 3600: return False
    return True


# ---------------- 1.1: payment obligations (mirror of app/payments.js) ----------------
def day_in(tz, d):
    try:
        return d.astimezone(tz).strftime("%Y-%m-%d")
    except Exception:
        return d.strftime("%Y-%m-%d")

def pay_summary(o, today, tz, dep_pct):
    payable = max(0, round(float(o.get("totalMinor") or 0)) + sum(round(float(a.get("amountMinor") or 0)) for a in (o.get("valueAdjustments") or []) if a and a.get("status") != "void"))
    verified = sum(round(float(p.get("amountMinor") or 0)) for p in (o.get("payments") or []) if p.get("status") == "verified")
    acc = parse(o.get("acceptedAt")); acc_day = day_in(tz, acc) if acc else None
    sched = [dict(x) for x in (o.get("schedule") or []) if x]
    for i, x in enumerate(sched):
        x.setdefault("id", "dep" if x.get("kind") == "deposit" else "m%d" % (i + 1))
        if not x.get("kind"):
            x["kind"] = "deposit" if i == 0 and re.search(r"advance|deposit|down", str(x.get("label") or ""), re.I) else "custom"
    if not any(x.get("kind") == "deposit" for x in sched):
        sched.insert(0, {"id": "dep", "kind": "deposit", "label": "Initial deposit (%s%%)" % dep_pct, "pct": dep_pct, "due": acc_day})
    seen_dep = False
    for x in sched:
        if x["kind"] == "deposit":
            if seen_dep: x["kind"] = "custom"
            seen_dep = True
    sched.sort(key=lambda x: (0 if x["kind"] == "deposit" else 1, str(x.get("due") or "9999")))
    left, out = verified, []
    for m in sched:
        exp = round(payable * float(m["pct"]) / 100) if m.get("pct") not in (None, "") else max(0, round(float(m.get("amountMinor") or 0)))
        paid = min(left, exp); left -= paid; rem = exp - paid
        due = m.get("due")
        overdue = rem > 0 and due and due < today
        days = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(due, "%Y-%m-%d")).days if overdue else 0
        out.append({"id": m["id"], "label": m.get("label") or "Payment", "due": due, "expected": exp, "remaining": rem, "overdue": bool(overdue), "days": days})
    return {"payable": payable, "verified": verified, "milestones": out}

def money(minor, cur):
    return "%s %s" % (cur or "EGP", "{:,.2f}".format(minor / 100))

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(2)
    root = sys.argv[1]
    now = datetime.now(timezone.utc)
    if "--now" in sys.argv: now = parse(sys.argv[sys.argv.index("--now") + 1])
    settings = load(os.path.join(root, "config", "settings.json")) or {}
    roles_doc = load(os.path.join(root, "config", "roles.json")) or {}
    timer = {"hours": 24, "dataEntryCounts": False}; timer.update(settings.get("leadTimer") or {})
    state = load(os.path.join(root, "sweep", "state.json")) or {}
    seen = dict(state.get("firstSeen") or {})
    base_of = {"admin": "admin", "employee": "employee", "engineer": "engineer", "dataentry": "dataentry"}
    for r in roles_doc.get("roles") or []:
        if r.get("id") and r.get("base") in ("admin", "employee", "engineer", "dataentry"): base_of[r["id"]] = r["base"]
    directory = docs(os.path.join(root, "directory", "*.json"))
    users = {}
    for did, r in directory.items():
        uid = r.get("uid") or did
        users[uid] = {"active": r.get("active") is not False, "base": base_of.get(r.get("role"), "employee"), "name": " ".join(x for x in [r.get("firstName"), r.get("lastName")] if x) or r.get("displayName") or uid}
    leads = docs(os.path.join(root, "leads", "*.json"))
    # activities per (uid, lead), time-ordered, future-dated ignored
    acts = []
    for p in glob.glob(os.path.join(root, "acts", "*", "a", "*.json")):
        uid = p.split(os.sep)[-3]; a = load(p)
        if not isinstance(a, dict): continue
        at = parse(a.get("at"))
        if not at or at > now + timedelta(minutes=5): continue
        acts.append((uid, at, a))
    acts.sort(key=lambda x: x[1])
    last_q = {}; prev_by = {}
    for uid, at, a in acts:
        k = (uid, a.get("leadId"))
        if qualifies(a, prev_by.get(k)):
            last_q.setdefault(a.get("leadId"), []).append((uid, at))
        prev_by[k] = a
    releases, notes, new_seen = [], [], {}
    for p in glob.glob(os.path.join(root, "claims", "*", "c", "*.json")):
        uid, lid = p.split(os.sep)[-3], os.path.splitext(os.path.basename(p))[0]
        c = load(p) or {}; lead = leads.get(lid)
        key = f"{uid}|{lid}"
        first = parse(seen.get(key)) or now
        new_seen[key] = iso(first)
        if lead is None: notes.append(f"claim on missing lead {lid} by {uid}"); continue
        u = users.get(uid)
        if not u or not u["active"] or u["base"] not in ("employee", "admin"):
            notes.append(f"claim by non-sales or inactive user {uid} on {lid} is ignored by the app; left for an administrator"); continue
        if lead.get("assignedTo") == uid and lead.get("assignTimer") is False: continue
        claimed = parse(c.get("claimedAt"))
        if claimed and claimed > now + timedelta(minutes=5): claimed = None
        start = min([x for x in [claimed, first] if x]) if (claimed or first) else now
        if lead.get("assignedTo") == uid:
            aa = parse(lead.get("assignedAt"))
            if aa and aa <= now and aa > start: start = aa
        cnt_de = bool(timer.get("dataEntryCounts"))
        last = None
        for (au, at) in last_q.get(lid, []):
            if at < start: continue
            if au == uid or (cnt_de and users.get(au, {}).get("base") == "dataentry"):
                if not last or at > last: last = at
        base = max([x for x in [start, last] if x])
        deadline = base + timedelta(hours=float(timer.get("hours") or 24))
        ext = (lead.get("extensions") or {}).get(uid)
        if ext:
            until, frm = parse(ext.get("until")), parse(ext.get("from"))
            if until and until > deadline and (not frm or not claimed or frm >= claimed - timedelta(seconds=1)): deadline = until
        if deadline <= now:
            releases.append({"lead": lid, "leadName": lead.get("name") or lid, "uid": uid, "ownerName": u["name"], "claimedAt": c.get("claimedAt"),
                             "lastActivity": iso(last) if last else None, "deadline": iso(deadline), "key": f"{uid}-{c.get('claimedAt')}",
                             "alreadyRecorded": any(r.get("key") == f"{uid}-{c.get('claimedAt')}" for r in lead.get("releases") or [])})
    # prepare the lead patches (full arrays, to be written with the version read just before writing)
    reason = f"Inactivity timeout ({int(float(timer.get('hours') or 24))} hours without qualifying activity)"
    for r in releases:
        lead = leads[r["lead"]]
        patch = {"releases": (lead.get("releases") or []) + ([] if r["alreadyRecorded"] else [{"key": r["key"], "uid": r["uid"], "claimedAt": r["claimedAt"], "lastActivity": r["lastActivity"],
                  "deadline": r["deadline"], "releasedAt": iso(now), "reason": reason, "by": "server-sweep"}]),
                 "history": (lead.get("history") or []) + ([] if r["alreadyRecorded"] else [{"at": iso(now), "by": "server-sweep", "action": "Released: inactivity", "reason": reason, "detail": r["ownerName"]}]),
                 "status": "research" if lead.get("status") == "research" else "available", "updatedAt": iso(now)}
        if lead.get("assignedTo") == r["uid"]: patch.update({"assignedTo": None, "assignedAt": None, "assignedBy": None, "assignReason": None})
        patch["releases"] = patch["releases"][-50:]; patch["history"] = patch["history"][-120:]
        r["leadPatch"] = patch
        r["notification"] = {"id": f"release-{r['lead']}-{int(parse(r['claimedAt']).timestamp() * 1000) if parse(r['claimedAt']) else 0}", "type": "lead", "title": "Lead released",
                             "body": f"{r['leadName']} went back to the Lead Mine after {int(float(timer.get('hours') or 24))} hours without logged activity. Its history is kept.",
                             "link": {"view": "leads"}, "ref": r["lead"], "at": iso(now), "from": "server-sweep", "read": False, "celebrate": False, "data": None}
    # follow-up reminders
    fu = {"advanceMin": 60, "overdueHours": 2}; fu.update(settings.get("followUps") or {})
    tzname = settings.get("timezone") or "Africa/Cairo"
    try: tz = ZoneInfo(tzname) if ZoneInfo else timezone.utc
    except Exception: tz = timezone.utc
    reminders = []
    for p in glob.glob(os.path.join(root, "acts", "*", "a", "*.json")):
        uid, aid = p.split(os.sep)[-3], os.path.splitext(os.path.basename(p))[0]
        a = load(p)
        if not isinstance(a, dict) or not a.get("followUp") or (a.get("followUpStatus") or "open") != "open": continue
        at = parse(a.get("followUpAt"))
        if not at: continue
        u = users.get(a.get("responsible") or uid)
        if not u or not u["active"]: continue
        sent = dict(a.get("remindersSent") or {})
        lead = leads.get(a.get("leadId")) or {}
        who = f" with {a['contact']}" if a.get("contact") else ""
        local = at.astimezone(tz)
        nxt = f" — {a['nextAction']}" if a.get("nextAction") else ""
        kinds = []
        if at - timedelta(minutes=float(fu["advanceMin"])) <= now < at and not sent.get("due"): kinds.append(("pre", "Follow-up coming up", f"{lead.get('name') or 'Lead'}{who} at {local.strftime('%H:%M')}{nxt}"))
        if at <= now < at + timedelta(hours=float(fu["overdueHours"])): kinds.append(("due", "Follow-up due now", f"{lead.get('name') or 'Lead'}{who}{nxt}"))
        if now >= at + timedelta(hours=float(fu["overdueHours"])): kinds.append(("over", "Follow-up overdue", f"{lead.get('name') or 'Lead'}{who} was due {local.strftime('%d %b %Y %H:%M')} ({tzname})"))
        for k, title, body in kinds:
            if sent.get(k): continue
            sent[k] = iso(now)
            reminders.append({"uid": a.get("responsible") or uid, "actOwner": uid, "act": aid, "kind": k,
                              "notification": {"id": f"fu-{aid}-{k}", "type": "followup", "title": title, "body": body, "link": {"view": "calls", "opts": {"act": aid}}, "ref": a.get("leadId"),
                                               "at": iso(now), "from": "server-sweep", "read": False, "celebrate": False, "data": None},
                              "actPatch": {"remindersSent": dict(sent)}})
    # 1.1: overdue customer payments
    pay_cfg = {"depositPct": 50, "escalateDays": 7}; pay_cfg.update(settings.get("payTerms") or {})
    admins = sorted(u for u, x in users.items() if x["active"] and x["base"] == "admin")
    today = day_in(tz, now)
    overdue = []
    for oid, o in docs(os.path.join(root, "orders", "*.json")).items():
        if not isinstance(o, dict) or o.get("status") == "cancelled": continue
        sm = pay_summary(o, today, tz, float(pay_cfg.get("depositPct") or 50))
        for m in sm["milestones"]:
            if not m["overdue"]: continue
            levels = [("", "Payment overdue", "normal")] + ([("-esc", "Payment still overdue — escalate", "high")] if m["days"] >= int(pay_cfg.get("escalateDays") or 7) else [])
            for suf, title, prio in levels:
                nid = "od-%s-%s-%s%s" % (oid, m["id"], m["due"], suf)
                to = sorted(set(admins + ([o.get("ownerId")] if o.get("ownerId") and users.get(o.get("ownerId"), {}).get("active") else [])))
                overdue.append({"to": to, "notification": {"id": nid, "type": "payment", "priority": prio, "title": title,
                    "body": "%s · %s: %s of %s was due %s. Next step: contact the client and agree a payment date." % (o.get("ref") or oid, o.get("name") or "", m["label"], money(m["remaining"], o.get("currency")), m["due"]),
                    "link": {"view": "proposals", "opts": {"oid": oid}}, "ref": oid, "at": iso(now), "from": "server-sweep", "read": False, "celebrate": False, "data": None}})
    # 1.1: queued research requests the page could not start
    reqs = docs(os.path.join(root, "mi", "req", "r", "*.json"))
    running = [k for k, r in reqs.items() if r.get("status") == "running" and parse(r.get("startedAt")) and now - parse(r.get("startedAt")) < timedelta(minutes=90)]
    queued = sorted(k for k, r in reqs.items() if r.get("status") == "queued" and parse(r.get("at")) and now - parse(r.get("at")) >= timedelta(minutes=10) and now - parse(r.get("at")) < timedelta(days=2))
    research_fire = {"requestIds": queued} if queued and not running else None
    if queued and running: notes.append("Research requests queued while another run is in progress: not started twice.")
    # forget claims that no longer exist; keep first-seen times for the rest
    out_state = {"firstSeen": new_seen, "lastRun": iso(now), "lastReleases": len(releases), "lastReminders": len(reminders), "lastOverdue": len(overdue)}
    print(json.dumps({"now": iso(now), "releases": releases, "reminders": reminders, "overdue": overdue, "researchFire": research_fire, "state": out_state, "notes": notes, "reason": reason}, indent=1, ensure_ascii=False))

if __name__ == "__main__":
    main()
