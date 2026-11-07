/* X FORCE — Market Intelligence 2.0: Data Readiness. Read-only counts for administrators (GET /api/mi/readiness).
   It writes nothing and returns no names, ids, contact details or money: only how many records of each kind exist.
   The counting happens inside the database, so the Worker's own processing stays small (Workers Free allows 10 ms of CPU). */

const MIN_DEALS = 5;
/** parent IN acts/<uid>/a … as an index range (parent >= 'acts/' AND parent < 'acts0'), then an exact pattern. */
const under = (top, glob) => `parent >= '${top}/' AND parent < '${top}0' AND parent GLOB '${glob}'`;
const one = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()) || {};
const many = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const n = (x) => Number(x) || 0;
const sumOf = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0);

const REACHED = "('Contact Reached','Interested','Not Interested','Decision-Maker Identified','Follow-Up Required','Meeting Scheduled','Qualified Opportunity')";

export async function readiness(env, nowIso = new Date().toISOString(), personalMin = 20) {
  const month = nowIso.slice(0, 7), min = Math.max(1, parseInt(personalMin, 10) || 20);

  const acts = await many(env, `SELECT parent uid, COUNT(*) total,
      SUM(t='call') calls, SUM(t='call' AND o IS NOT NULL AND o<>'') callsWithOutcome, SUM(q=1) qualifying,
      SUM(t IN ('call','email','whatsapp','meeting','visit') AND o IN ${REACHED}) conversations,
      SUM(t='meeting') held, SUM(o='Meeting Scheduled') scheduled, SUM(t='meeting' OR o='Meeting Scheduled') meetings, SUM(t='visit') visits, SUM(ms IS NOT NULL) meetingStatus
    FROM (SELECT parent, json_extract(data,'$.type') t, json_extract(data,'$.outcome') o, json_extract(data,'$.qualifying') q, json_extract(data,'$.meetingStatus') ms FROM docs WHERE ${under("acts", "acts/*/a")})
    GROUP BY parent`);

  // a quotation = a saved project that was issued; its status is kept on the project's summary
  const quotes = await many(env, `SELECT parent uid, SUM(i IS NOT NULL) total, SUM(i IS NOT NULL AND lead IS NOT NULL AND lead<>'') withLead,
      SUM(i IS NOT NULL AND st IN ('accepted','won','lost','rejected')) decided
    FROM (SELECT parent, json_extract(data,'$.summary.issuedAt') i, json_extract(data,'$.summary.leadId') lead, json_extract(data,'$.summary.status') st FROM docs WHERE ${under("projects", "projects/*/p")})
    GROUP BY parent`);
  const subs = await many(env, `SELECT parent uid, SUM(st IN ('accepted','approved')) accepted
    FROM (SELECT parent, json_extract(data,'$.status') st FROM docs WHERE ${under("submissions", "submissions/*/s")})
    GROUP BY parent`);

  const crm = await one(env, `SELECT COUNT(*) total, SUM(st='won') won, SUM(st='lost') lost, SUM(st='lost' AND r IS NOT NULL AND r<>'') lostWithReason, SUM(COALESCE(h,0)>0) withHistory
    FROM (SELECT json_extract(data,'$.stage') st, json_extract(data,'$.lostReason') r, json_array_length(data,'$.stageHistory') h FROM docs WHERE ${under("crm", "crm/*/l")})`);

  const leads = await one(env, `SELECT COUNT(*) total, SUM(st IS NULL OR st NOT IN ('archived','merged','inactive')) open, SUM(a IS NOT NULL) assigned, SUM(COALESCE(s,0)>0) withSource, SUM(f IS NOT NULL AND f<>'') withFit
    FROM (SELECT json_extract(data,'$.status') st, json_extract(data,'$.assignedTo') a, json_array_length(data,'$.sources') s, json_extract(data,'$.productsFit') f FROM docs WHERE parent='leads')`);
  const contacts = await one(env, `SELECT COUNT(*) total, SUM(json_extract(data,'$.contact.phoneVerified')=1 OR json_extract(data,'$.contact.emailVerified')=1) verified FROM docs WHERE parent='leadcontact'`);
  const orgTypes = await many(env, `SELECT COALESCE(json_extract(data,'$.orgType'),'other') k, COUNT(*) c FROM docs WHERE parent='leads' GROUP BY k ORDER BY c DESC`);

  const orders = await one(env, `SELECT COUNT(*) total, SUM(json_extract(data,'$.status')='cancelled') cancelled FROM docs WHERE parent='orders'`);

  const opps = await one(env, `SELECT COUNT(*) total, SUM(p='high') high, SUM(ev='verified') verified, SUM(ev='single-source') singleSource, SUM(ev='unverified') unverified, SUM(a IS NOT NULL) assigned, SUM(sv=2) newScore
    FROM (SELECT json_extract(data,'$.priority') p, json_extract(data,'$.evidence') ev, json_extract(data,'$.assignedTo') a, json_extract(data,'$.scoreVersion') sv FROM docs WHERE parent='mi/opps/o')`);
  const overlays = await one(env, `SELECT COUNT(*) c FROM docs WHERE ${under("crm", "crm/*/mi")}`);
  const radar = await one(env, `SELECT COUNT(*) c FROM docs WHERE parent='mkt/radar/a'`);

  // salespeople: built-in "employee" plus custom roles based on it (no names leave this function)
  const roleRow = await one(env, `SELECT data FROM docs WHERE path='config/roles'`);
  const baseRoles = new Set(["employee"]);
  try { for (const r of (JSON.parse(roleRow.data || "{}").roles || [])) if (r && r.id && r.base === "employee") baseRoles.add(r.id); } catch (e) { /* no custom roles */ }
  const dir = await many(env, `SELECT json_extract(data,'$.uid') uid, json_extract(data,'$.role') role, json_extract(data,'$.active') active FROM docs WHERE parent='directory'`);
  const salesUids = new Set(dir.filter((r) => r.uid && r.active !== 0 && baseRoles.has(r.role)).map((r) => r.uid));
  const of = (rows, uid, k, top, tail) => n((rows.find((r) => r.uid === `${top}/${uid}/${tail}`) || {})[k]);
  let enoughCalls = 0, enoughConversations = 0, enoughMeetings = 0, enoughDecided = 0, enoughDeals = 0;
  for (const u of salesUids) {
    if (of(acts, u, "calls", "acts", "a") >= min) enoughCalls++;
    if (of(acts, u, "conversations", "acts", "a") >= min) enoughConversations++;
    if (of(acts, u, "meetings", "acts", "a") >= min) enoughMeetings++;
    if (of(quotes, u, "decided", "projects", "p") >= min) enoughDecided++;
    if (of(subs, u, "accepted", "submissions", "s") >= MIN_DEALS) enoughDeals++;
  }
  const staff = await many(env, `SELECT path, json_extract(data,?) t, json_extract(data,'$.sales') sp FROM docs WHERE parent='staff'`, `$.targets."${month}"`);
  const has = (k) => staff.filter((r) => r[k] != null && salesUids.has(r.path.slice(6))).length;

  const pb = await one(env, `SELECT COUNT(*) c FROM docs, json_each(docs.data,'$.items') WHERE docs.path='config/pricebook'`);
  const cat = await one(env, `SELECT json_array_length(data,'$.custom') custom FROM docs WHERE path='config/catalog'`);
  const prod = await one(env, `SELECT COUNT(*) c FROM docs WHERE parent='prod/cat/p'`);
  const hol = await one(env, `SELECT json_array_length(data,'$.days') days FROM docs WHERE path='hol/cal'`);

  return { at: nowIso, month, personalMin: min,
    sellers: { active: salesUids.size, enoughCalls, enoughConversations, enoughMeetings, enoughDecided, enoughDeals, withProfile: has("sp") },
    targets: { individual: has("t"), defaultOnly: Math.max(0, salesUids.size - has("t")) },
    acts: { total: sumOf(acts, "total"), calls: sumOf(acts, "calls"), callsWithOutcome: sumOf(acts, "callsWithOutcome"), qualifying: sumOf(acts, "qualifying"), conversations: sumOf(acts, "conversations"),
      meetings: sumOf(acts, "meetings"), meetingsHeld: sumOf(acts, "held"), meetingsScheduled: sumOf(acts, "scheduled"), meetingStatus: sumOf(acts, "meetingStatus"), visits: sumOf(acts, "visits") },
    quotes: { total: sumOf(quotes, "total"), withLead: sumOf(quotes, "withLead"), accepted: sumOf(subs, "accepted"), decided: sumOf(quotes, "decided") },
    crm: { total: n(crm.total), won: n(crm.won), lost: n(crm.lost), lostWithReason: n(crm.lostWithReason), withHistory: n(crm.withHistory) },
    leads: { total: n(leads.total), open: n(leads.open), assigned: n(leads.assigned), withSource: n(leads.withSource), withFit: n(leads.withFit), byType: orgTypes.map((r) => [r.k, n(r.c)]) },
    contacts: { records: n(contacts.total), verified: n(contacts.verified) },
    orders: { total: n(orders.total), live: n(orders.total) - n(orders.cancelled) },
    opps: { total: n(opps.total), high: n(opps.high), verified: n(opps.verified), singleSource: n(opps.singleSource), unverified: n(opps.unverified), assigned: n(opps.assigned), newScore: n(opps.newScore), legacyUpdates: n(overlays.c) },
    radar: { accounts: n(radar.c) },
    catalog: { priceBookItems: n(pb.c), customProducts: n(cat.custom), productPages: n(prod.c), holidaysListed: n(hol.days) } };
}
