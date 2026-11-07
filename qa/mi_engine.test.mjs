/* X FORCE Market Intelligence 2.0, Phase 1. The failures found in the audit are kept here as permanent tests, with the switch off (the old
   behaviour must not move) and on (the new rules). Made-up records only: this repository is public.
   Run:  node --test qa/mi_engine.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { ingest } from "../worker/intel.js";
import { readiness } from "../worker/readiness.js";
import { addJob, dueJobs, claimJob, endJob, jobId } from "../worker/enginejobs.js";

globalThis.self = globalThis;   // app/store.js expects the Worker's global name
await import("../app/store.js");
const E = globalThis.DPMiEngine, RULES = globalThis.DPStore;
const T = Date.parse("2026-11-07T10:00:00Z");
const run = (c, db = {}, on = false, aliases = null) => ingest("opportunities", db, c, T, on ? { engine: true, aliases } : {});
const opps = (r) => r.writes.filter((w) => w.collection === "mi/opps/o").map((w) => w.data);
const one = (c, on) => opps(run([c], {}, on))[0];
const part = (o, k) => o.scoreParts.find((p) => p.k === k);
const base = { kind: "project", sourceType: "media", publishedAt: "2026-11-05", products: [] };
const PARKING = Object.assign({}, base, { title: "Small perfect display screens for a parking garage", organization: "Test Screens Co", location: "Red Sea, Saudi Arabia", category: "developer", description: "Electricity capacity upgrade. A small display for car parking with perfect effect.", sourceUrl: "https://example.com/a", products: ["Outdoor playground", "Soft play", "Water play"] });
const SCHOOL = Object.assign({}, base, { title: "New international school with kindergarten and playground", organization: "Test School", location: "Sheikh Zayed, Egypt", category: "school", description: "A new campus with a children's play area.", sourceUrl: "https://example.com/s" });
const AR1 = Object.assign({}, base, { title: "مدرسة دولية جديدة في الشيخ زايد", organization: "مدارس النور", location: "الشيخ زايد", category: "school", sourceUrl: "https://example.com/d1", publishedAt: null });
const AR2 = Object.assign({}, base, { title: "منتجع جديد في الساحل الشمالي", organization: "شركة البحر", location: "الساحل الشمالي", category: "resort", sourceUrl: "https://example.com/d2", publishedAt: null });

/* ---------------- switch off: exactly the old behaviour, including its faults ---------------- */
test("off: the old results do not move", () => {
  const a = one(PARKING, false);
  assert.equal(a.score, 79); assert.equal(a.priority, "high"); assert.equal(a.scoreVersion, undefined);
  assert.equal(part(a, "geo").pts, 10);
  const r = opps(run([AR1, AR2]));
  assert.equal(r[0].id, r[1].id, "the old Arabic id collision is unchanged while the switch is off");
  const v = one(Object.assign({}, SCHOOL, { estValue: { amount: 25e9, currency: "EGP", basis: "budget", sourceUrl: "https://example.com/v" } }), false);
  assert.equal(v.estValue.amountEgp, 25e9); assert.equal(v.needsApproval, true);
});
test("off is the default", () => assert.deepEqual(one(SCHOOL), one(SCHOOL, false)));

/* ---------------- switch on: the audit's failures ---------------- */
test("on: letters inside words do not match", () => {
  const a = one(PARKING, true);
  assert.equal(part(a, "fit").pts, 0, part(a, "fit").why);
  assert.equal(a.priority, "low"); assert.equal(a.scoreVersion, 2);
  const has = (t, w) => E.hasWord(E.fold(t), w);
  for (const [t, w] of [["a perfect fit", "fec"], ["small shops", "mall"], ["car parking", "park"], ["a display wall", "play"], ["electricity capacity", "city"]]) assert.equal(has(t, w), false, `${w} in ${t}`);
  for (const [t, w] of [["new FEC centre", "fec"], ["the Mall of Cairo", "mall"], ["two parks", "park"], ["a play area", "play"], ["a new city", "city"]]) assert.equal(has(t, w), true, `${w} in ${t}`);
});
test("on: Saudi Red Sea is not a priority area of Egypt", () => {
  assert.equal(part(one(PARKING, true), "geo").pts, 4);
  assert.equal(part(one(Object.assign({}, SCHOOL, { location: "Red Sea" }), true), "geo").pts, 3);
  assert.equal(part(one(Object.assign({}, SCHOOL, { location: "Hurghada, Red Sea, Egypt" }), true), "geo").pts, 10);
  assert.equal(part(one(Object.assign({}, SCHOOL, { location: "New Cairo" }), true), "geo").pts, 10);
  assert.equal(part(one(AR1, true), "geo").pts, 10);
  assert.equal(part(one(Object.assign({}, AR1, { location: "الرياض، السعودية" }), true), "geo").pts, 4);
});
test("on: AI product labels add no points, and are still kept to read", () => {
  const a = one(SCHOOL, true), b = one(Object.assign({}, SCHOOL, { products: ["a", "b", "c", "d", "e", "f", "g", "h"] }), true);
  assert.equal(part(a, "fit").pts, part(b, "fit").pts); assert.equal(a.score, b.score); assert.equal(b.products.length, 8);
  assert.match(part(b, "fit").why, /add no points/);
});
test("on: a real play project still scores well above an irrelevant one", () => {
  const good = one(SCHOOL, true), bad = one(PARKING, true);
  assert.ok(good.score - bad.score >= 20, `${good.score} against ${bad.score}`);
  assert.ok(part(good, "fit").pts >= 10, part(good, "fit").why);
});
test("on: a project budget is the project's size, never Dupedia's value", () => {
  const v = one(Object.assign({}, SCHOOL, { estValue: { amount: 25e9, currency: "EGP", basis: "budget", sourceUrl: "https://example.com/v" } }), true);
  assert.equal(v.estValue, undefined); assert.equal(v.projectValue.amountEgp, 25e9);
  assert.equal(part(v, "scale").pts, 15); assert.match(part(v, "scale").why, /not Dupedia's share/);
});
test("on: different Arabic records stay separate, and each is saved", () => {
  const r = opps(run([AR1, AR2], {}, true));
  assert.equal(new Set(r.map((x) => x.id)).size, 2);
  assert.ok(part(r[0], "fit").pts > 0, "Arabic words count");
});
test("on: the same Arabic record seen again is one record", () => {
  const first = opps(run([AR1], {}, true))[0], db = { "mi/opps/o": { [first.id]: first } };
  const again = run([Object.assign({}, AR1, { sourceUrl: "https://example.com/d9", title: "مَدرسة دولية جديدة في الشيخ زايد" })], db, true);
  assert.equal(again.stats.created, 0); assert.equal(again.stats.updated, 1);
});
test("on: English ids do not change, so existing records still match", () => {
  assert.equal(one(SCHOOL, true).id, one(SCHOOL, false).id);
  for (const s of ["Example Developments S.A.E", "The Company of New Cairo", "Résidence Élite"]) assert.equal(E.normName(s), oldNorm(s));
});
function oldNorm(s) { s = String(s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase(); s = s.replace(/\b(the|a|an|of|for|and|in|at|by|project|new|company|co|ltd|s\.a\.e|sae|llc|group|developments?)\b/g, " "); return s.replace(/[^a-z0-9]+/g, " ").trim(); }
test("on: Arabic and English names of one company are one organisation", () => {
  const al = { x: { canonical: "Test School", names: ["مدارس النور"] } };
  const first = one(Object.assign({}, SCHOOL, { title: "School campus in Sheikh Zayed", location: "Sheikh Zayed" }), true), db = { "mi/opps/o": { [first.id]: first } };
  const r = run([Object.assign({}, AR1, { title: "School campus Sheikh Zayed", location: "Sheikh Zayed" })], db, true, al);
  assert.equal(r.stats.created, 0); assert.equal(r.stats.updated, 1);
});
test("on: a name with nothing left after cleaning never matches another", () => {
  const first = one(Object.assign({}, SCHOOL, { organization: "The Company" }), true), db = { "mi/opps/o": { [first.id]: first } };
  const r = run([Object.assign({}, PARKING, { organization: "Group LLC" })], db, true);
  assert.equal(r.stats.created, 1);
});

/* ---------------- settings ---------------- */
test("settings: everything starts Not confirmed, and unknown values stay Not confirmed", () => {
  const c = E.cfgOf(null); assert.equal(E.CATEGORIES.length, 10);
  for (const [k] of E.CATEGORIES) assert.equal(c.capability[k], "unset");
  assert.equal(E.cfgOf({ capability: { playground: "core", sports: "nonsense" } }).capability.sports, "unset");
  assert.equal(E.cfgOf({ capability: { playground: "core" } }).capability.playground, "core");
});

/* ---------------- permissions ---------------- */
test("permissions: engine records are administrators only; plans are private", () => {
  const can = (p, op, lvl, uid = "u1") => RULES.allowed(p, op, lvl, uid);
  for (const p of ["mix/enginecfg", "mix/enginev/v/1", "mix/alias/a/x", "mix/disc/j/x", "mix/disc/c/x", "mix/opp/o/x", "mix/assign/a/x", "mix/outcome/o/x"]) {
    assert.equal(can(p, "read", "admin"), true, p); assert.equal(can(p, "write", "admin"), true, p);
    assert.equal(can(p, "read", "interact"), false, p); assert.equal(can(p, "write", "interact"), false, p);
    assert.equal(RULES.allowedFinance(p, "read", "u1"), false, "finance " + p);
  }
  assert.equal(can("plan/u1/o/x", "read", "interact"), true); assert.equal(can("plan/u2/o/x", "read", "interact"), false);
  assert.equal(can("plan/u1/o/x", "write", "interact"), false); assert.equal(can("plan/u1/o/x", "write", "admin"), true);
});

/* ---------------- job ledger ---------------- */
const env = () => ({ DB: fakeD1() });
test("jobs: asking twice makes one job", async () => {
  const e = env(), a = await addJob(e, { key: "sweep|new-cairo|schools", kind: "sweep" }, T), b = await addJob(e, { key: "sweep|new-cairo|schools", kind: "sweep" }, T);
  assert.equal(a.id, b.id); assert.equal(a.created, true); assert.equal(b.created, false);
  assert.equal(a.id, await jobId("sweep|new-cairo|schools")); assert.equal((await dueJobs(e, 10, T)).length, 1);
});
test("jobs: one holder at a time; finished jobs do not come back", async () => {
  const e = env(), { id } = await addJob(e, { key: "k", kind: "sweep" }, T);
  const j = await claimJob(e, id, "h1", T); assert.equal(j.status, "running"); assert.equal(j.tries, 1);
  assert.equal(await claimJob(e, id, "h2", T), null);
  assert.equal((await endJob(e, id, "h1", { status: "done", result: { found: 3 } }, T)).status, "done");
  assert.equal((await dueJobs(e, 10, T + 864e5)).length, 0); assert.equal(await claimJob(e, id, "h2", T + 864e5), null);
});
test("jobs: a failure retries, then stays visible as failed with its reason", async () => {
  const e = env(), { id } = await addJob(e, { key: "k", kind: "sweep", maxTries: 2 }, T); let t = T;
  await claimJob(e, id, "h", t); let d = await endJob(e, id, "h", { status: "fail", reason: "Search timed out" }, t);
  assert.equal(d.status, "waiting"); assert.equal(d.error, "Search timed out");
  assert.equal(await claimJob(e, id, "h", t), null, "not before its retry time");
  t += 2 * 3600e3; assert.equal((await claimJob(e, id, "h", t)).tries, 2);
  d = await endJob(e, id, "h", { status: "fail", reason: "Search timed out again" }, t);
  assert.equal(d.status, "failed"); assert.equal(d.error, "Search timed out again"); assert.equal(d.log.length, 2);
  const row = await e.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(`mix/disc/j/${id}`).first(); assert.ok(row, "kept, not deleted");
});
test("jobs: waiting on a limit does not use up a try", async () => {
  const e = env(), { id } = await addJob(e, { key: "k", kind: "sweep", maxTries: 1 }, T);
  await claimJob(e, id, "h", T); const d = await endJob(e, id, "h", { status: "wait", reason: "Daily allowance reached", untilMs: T + 3600e3 }, T);
  assert.equal(d.status, "waiting"); assert.equal(d.tries, 0); assert.equal((await claimJob(e, id, "h", T + 3600e3)).status, "running");
});
test("jobs: a run that died is picked up again, and fails with a reason on its last try", async () => {
  const e = env(), { id } = await addJob(e, { key: "k", kind: "sweep", maxTries: 2 }, T);
  await claimJob(e, id, "dead", T); let t = T + 10 * 60e3;   // its lease has ended and it never reported
  assert.equal((await dueJobs(e, 5, t)).length, 1); assert.equal((await claimJob(e, id, "h2", t)).tries, 2);
  t += 10 * 60e3; assert.equal(await claimJob(e, id, "h3", t), null);
  const row = JSON.parse((await e.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(`mix/disc/j/${id}`).first()).data);
  assert.equal(row.status, "failed"); assert.match(row.error, /last try/);
});

/* ---------------- data readiness ---------------- */
function seed(db) {
  const put = (p, d) => db.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?)").run(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), "2026-11-01");
  put("directory/a", { uid: "s1", role: "employee", active: true, firstName: "PRIVATE-NAME" }); put("directory/b", { uid: "s2", role: "seller2", active: true }); put("directory/c", { uid: "x", role: "engineer", active: true }); put("directory/d", { uid: "s3", role: "employee", active: false });
  put("config/roles", { roles: [{ id: "seller2", base: "employee" }] });
  for (let i = 0; i < 25; i++) put(`acts/s1/a/c${i}`, { type: "call", outcome: i < 10 ? "No Answer" : "Contact Reached", qualifying: true, notes: "PRIVATE-NOTE" });
  put("acts/s2/a/m1", { type: "meeting", outcome: "Interested", qualifying: true }); put("acts/s2/a/m2", { type: "call", outcome: "Meeting Scheduled", qualifying: true }); put("acts/s2/a/n", { type: "call", outcome: "", qualifying: false });
  put("projects/s1/p/q1", { summary: { issuedAt: "2026-10-01", leadId: "L1", status: "issued" }, project: {} }); put("projects/s1/p/q2", { summary: { issuedAt: "2026-10-02", leadId: null, status: "won" }, project: {} }); put("projects/s1/p/q3", { summary: { issuedAt: null, status: "draft" }, project: {} });
  put("submissions/s1/s/q2", { status: "accepted", leadId: null, base: { eligibleMinor: 999 } });
  put("crm/s1/l/L1", { stage: "lost", lostReason: "Price", stageHistory: [{}] }); put("crm/s2/l/L2", { stage: "lost", stageHistory: [] }); put("crm/s1/mi/o1", { status: "contacted" });
  put("leads/L1", { name: "PRIVATE-LEAD", orgType: "developer", sources: [{ url: "https://example.com" }], productsFit: "Play", assignedTo: "s1" }); put("leads/L2", { name: "B", orgType: "school", sources: [], status: "archived" });
  put("leadcontact/L1", { contact: { phone: "0100", phoneVerified: true } }); put("leadcontact/L2", { contact: { phone: "0101", phoneVerified: false } });
  put("orders/O1", { status: "accepted" }); put("orders/O2", { status: "cancelled" });
  put("mi/opps/o/1", { priority: "high", evidence: "unverified", assignedTo: "s1" }); put("mi/opps/o/2", { priority: "low", evidence: "verified", scoreVersion: 2 });
  put("staff/s1", { targets: { "2026-11": 1 }, sales: { territories: ["x"] } }); put("staff/s2", { targets: { "2026-10": 1 } }); put("staff/x", { targets: { "2026-11": 1 } });
  put("config/pricebook", { items: { a: {}, b: {} } }); put("config/catalog", { custom: [{}] }); put("prod/cat/p/a", {}); put("hol/cal", { days: [{}, {}] }); put("mkt/radar/a/1", {});
}
test("readiness: the counts are right", async () => {
  const e = env(); seed(e.DB.raw); const c = await readiness(e, "2026-11-07T10:00:00Z", 20);
  assert.deepEqual(c.sellers, { active: 2, enoughCalls: 1, enoughConversations: 0, enoughMeetings: 0, enoughDecided: 0, enoughDeals: 0, withProfile: 1 });
  assert.deepEqual(c.targets, { individual: 1, defaultOnly: 1 });
  assert.deepEqual(c.acts, { total: 28, calls: 27, callsWithOutcome: 26, qualifying: 27, conversations: 17, meetings: 2, meetingsHeld: 1, meetingsScheduled: 1, meetingStatus: 0, visits: 0 });
  assert.deepEqual(c.quotes, { total: 2, withLead: 1, accepted: 1, decided: 1 });
  assert.deepEqual(c.crm, { total: 2, won: 0, lost: 2, lostWithReason: 1, withHistory: 1 });
  assert.equal(c.leads.total, 2); assert.equal(c.leads.open, 1); assert.equal(c.leads.assigned, 1); assert.equal(c.leads.withSource, 1); assert.equal(c.contacts.verified, 1);
  assert.deepEqual(c.orders, { total: 2, live: 1 });
  assert.equal(c.opps.total, 2); assert.equal(c.opps.high, 1); assert.equal(c.opps.newScore, 1); assert.equal(c.opps.legacyUpdates, 1);
  assert.deepEqual(c.catalog, { priceBookItems: 2, customProducts: 1, productPages: 1, holidaysListed: 2 }); assert.equal(c.radar.accounts, 1);
});
test("readiness: no names, notes, contact details or money leave the server", async () => {
  const e = env(); seed(e.DB.raw); const s = JSON.stringify(await readiness(e, "2026-11-07T10:00:00Z"));
  for (const x of ["PRIVATE", "0100", "s1", "s2", "eligibleMinor", "Price"]) assert.equal(s.includes(x), false, x);
});
test("readiness: it writes nothing", async () => {
  const e = env(); seed(e.DB.raw); const count = () => e.DB.raw.prepare("SELECT COUNT(*) c, SUM(v) s FROM docs").get();
  const before = count(); await readiness(e); assert.deepEqual(count(), before);
});
test("readiness: an empty database gives plain answers, never an error", async () => {
  const c = await readiness(env()); const v = E.verdicts(c, null);
  assert.equal(c.sellers.active, 0); assert.ok(v.length >= 10); assert.ok(v.every((x) => x.state === "none" && x.text));
});
test("verdicts: say who has enough records and who falls back on the assumption", async () => {
  const e = env(); seed(e.DB.raw); const v = E.verdicts(await readiness(e, "2026-11-07T10:00:00Z"), null), by = (k) => v.find((x) => x.key === k);
  assert.equal(by("calls").state, "partial"); assert.match(by("calls").text, /1 of 2 salespeople/);
  assert.equal(by("quote").state, "none"); assert.equal(by("link").state, "partial"); assert.match(by("link").text, /50%/);
  assert.equal(by("target").state, "partial");
});
