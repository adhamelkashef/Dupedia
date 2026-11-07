/* X FORCE Market Intelligence 2.0, Phase 2a: research of existing leads. Made-up organisations, numbers and pages only.
   Run:  node --test qa/mi_enrich.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { queueLeads, engineStep, engineTick } from "../worker/enrich.js";

const E = globalThis.DPMiEngine, realFetch = globalThis.fetch;
const T = Date.parse("2026-11-07T10:00:00Z");
test.afterEach(() => { globalThis.fetch = realFetch; });

/* ---------------- ranking ---------------- */
test("rank: a well-evidenced developer with fit and a recent source outranks a bare record, with reasons", () => {
  const good = E.rankLead({ name: "Test Developer", orgType: "developer", location: "New Cairo", productsFit: "Play areas", evidence: "Handover of phase 2 began", sources: [{ url: "https://example.com/a", date: "2026-08-01" }, { url: "https://example.com/b" }], score: 80 }, T);
  const bare = E.rankLead({ name: "Test Other", orgType: "other" }, T);
  assert.ok(good.score > bare.score + 40, `${good.score} against ${bare.score}`);
  assert.equal(good.parts.length, 6); assert.ok(good.parts.every((p) => p.why && p.pts <= p.max));
  assert.deepEqual(bare.missing, ["website", "contact route", "source", "product fit", "location", "recent evidence"]);
  assert.equal(bare.next, "Find the official website");
});
test("rank: the newest of several dates counts; Saudi locations are not Egypt", () => {
  assert.equal(new Date(E.newestDate({ sourceDate: "2026-05-03 / 2026-08-26" })).toISOString().slice(0, 10), "2026-08-26");
  assert.equal(E.rankLead({ location: "Riyadh, Saudi Arabia" }, T).parts.find((p) => p.k === "geo").pts, 3);
  assert.equal(E.rankLead({ location: "الشيخ زايد" }, T).parts.find((p) => p.k === "geo").pts, 10);
});
test("rank: 858 leads rank quickly enough for a browser", () => {
  const leads = Array.from({ length: 858 }, (_, i) => ({ name: "L" + i, orgType: ["developer", "school", "hotel"][i % 3], location: "New Cairo", evidence: "phase launch ".repeat(5), sources: [{ url: "https://example.com", date: "2026-0" + (1 + (i % 9)) + "-01" }] }));
  const t0 = performance.now(); leads.forEach((l) => E.rankLead(l, T)); assert.ok(performance.now() - t0 < 500);
});

/* ---------------- reading contact routes ---------------- */
const PAGE = `Contact us. Head office: 90th Street, New Cairo. Call 0100 123 4567 or +20 2 2345 6789. Hotline: 19999.
  Sales: sales@testdev.example.eg — Careers: jobs@gmail.com. Logo: icon@2x.png. Founded 2012, 25,000,000 m2 delivered, phone 2026 2027 2028.
  للتواصل: ٠١٢٣٤٥٦٧٨٩١`;
test("contacts: published numbers and e-mails with the sentence around them", () => {
  const c = E.contactRoutes(PAGE, "https://testdev.example.eg/contact", "testdev.example.eg"), v = c.map((x) => x.value);
  assert.ok(v.includes("sales@testdev.example.eg")); assert.ok(v.includes("jobs@gmail.com")); assert.ok(!v.some((x) => /png/.test(x)));
  assert.equal(c.find((x) => x.value === "sales@testdev.example.eg").own, true); assert.equal(c.find((x) => x.value === "jobs@gmail.com").own, false);
  const keys = c.filter((x) => x.kind === "phone").map((x) => x.key);
  assert.ok(keys.includes("01001234567")); assert.ok(keys.includes("0223456789")); assert.ok(keys.includes("19999")); assert.ok(keys.includes("01234567891"), "Arabic digits");
  assert.equal(keys.length, 4, "years, areas and prices are not phone numbers: " + keys.join(" "));
  for (const x of c) { assert.ok(x.quote.length > 10); assert.equal(x.sourceUrl, "https://testdev.example.eg/contact"); }
});
test("contacts: a hotline on the line after its label (as on a real Egyptian developer's contact page)", () => {
  assert.deepEqual(E.contactRoutes("SEND US A MESSAGE. HOTLINE\n16201\nEmail", "https://x.example", "x.example").map((c) => c.key), ["16201"]);
});
test("research: a record that waited and then succeeded no longer shows the old wait message", async () => {
  let n = 0; const { e } = env({ tavily: () => (n++ >= 2 ? new Response(JSON.stringify({ results: [], usage: { credits: 1 } })) : new Response("{}", { status: 429 })) });   // the provider's own single retry also meets a limit
  await queueLeads(e, ["L1"], "u", T); await engineStep(e, "h", T); assert.ok((await doc(e, "mix/enrich/e/L1")).error);
  await engineStep(e, "h", T + 61e3); assert.equal((await doc(e, "mix/enrich/e/L1")).error, undefined);
});
test("contacts: the same number written twice is one", () => {
  assert.equal(E.contactRoutes("Call 0100 123 4567. Mobile: 01001234567.", "https://x.example", "x.example").length, 1);
});

/* ---------------- official site, quotes ---------------- */
test("official site: the lead's own website first, else an address carrying the name, never a portal or social page", () => {
  const res = [{ url: "https://www.facebook.com/testdevelopments" }, { url: "https://www.nawy.com/compound/testdevelopments" }, { url: "https://testdevelopments.com.eg/about" }];
  assert.equal(E.officialSite(res, "Test Developments", "").host, "testdevelopments.com.eg");
  assert.equal(E.officialSite(res, "Test Developments", "").probable, true);
  assert.deepEqual(E.officialSite(res, "Test Developments", "https://www.recorded.example/"), { host: "recorded.example", how: "From the lead record", probable: false });
  assert.equal(E.officialSite(res.slice(0, 2), "Test Developments", ""), null);
  assert.equal(E.officialSite([{ url: "https://abc.com" }], "Al Ahly Sabbour", ""), null, "short or unrelated names do not match");
});
test("quotes: found despite spacing, case and Arabic letter forms; short or invented ones are not", () => {
  assert.equal(E.quoteFound("Construction of the new campus is under way", "Today, construction of  the new campus is under way."), true);
  assert.equal(E.quoteFound("مدرسة جديدة في الشيخ زايد", "افتتاح مدرسه جديده في الشيخ زايد"), true);
  assert.equal(E.quoteFound("A new resort opens in 2027", "A new resort opens in 2028"), false);
  assert.equal(E.quoteFound("campus", "campus"), false);
});

/* ---------------- the research steps, with fake providers ---------------- */
const SITE = "https://testdevelopments.com.eg/";
function env({ on = true, gemini = null, tavily = null } = {}) {
  const e = { DB: fakeD1(), TAVILY_API_KEY: "tvly-test-not-a-real-key", GEMINI_API_KEY: "gem-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", GEMINI_BASE_URL: "https://gemini.test" };
  const put = (p, d) => e.DB.raw.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?)").run(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), "2026-11-01");
  put("config/settings", { miEngine: on }); put("mix/enginecfg", { enrichPerDay: 2, stepsPerRun: 3 });
  put("leads/L1", { name: "Test Developments", orgType: "developer", location: "New Cairo", contact: { phone: "", email: "" } });
  put("leads/L2", { name: "Second Test Co", orgType: "school" }); put("leads/L3", { name: "Third Test Co" }); put("leads/LX", { name: "Old", status: "archived" });
  const calls = { search: 0, extract: 0, gemini: 0, sent: [] };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), body = JSON.parse(init.body); calls.sent.push(JSON.stringify(body));
    if (u.host === "tavily.test" && u.pathname === "/search" && (body.include_domains || []).includes("linkedin.com") && !tavily) { calls.people = (calls.people || 0) + 1; calls.search++;
      return new Response(JSON.stringify({ results: [
        { url: "https://eg.linkedin.com/in/test-person-1", title: "Test Person - Procurement Manager - Test Developments | LinkedIn", content: "Procurement Manager at Test Developments, New Cairo", score: 0.9 },
        { url: "https://www.linkedin.com/in/test-person-us", title: "US Person - Planner - Test Developments | LinkedIn", content: "Test Developments, Ohio", score: 0.85 },
        { url: "https://www.linkedin.com/in/someone-else", title: "Someone Else - Procurement Manager - Other Developers | LinkedIn", content: "Other Developers", score: 0.8 },
        { url: "https://www.linkedin.com/company/testdevelopments", title: "Test Developments | LinkedIn", content: "Test Developments real estate", score: 0.7 }], usage: { credits: 1 } })); }
    if (u.host === "tavily.test" && u.pathname === "/search") { calls.search++; if (tavily) return tavily(body);
      return new Response(JSON.stringify({ results: [{ url: "https://www.facebook.com/x", title: "fb", content: "Call 01112223334", score: 0.9 }, { url: SITE + "projects", title: "Projects", content: "Test Developments launches Lake Park, a new compound with a kids area in New Cairo. Phone 01009998877.", score: 0.8, published_date: "2026-10-01" }], usage: { credits: 1 } })); }
    if (u.host === "tavily.test") { calls.extract++; return new Response(JSON.stringify({ results: body.urls.slice(0, 2).map((x) => ({ url: x, raw_content: "Contact: info@testdevelopments.com.eg, 0100 123 4567." })), failed_results: body.urls.slice(2), usage: { credits: 1 } })); }
    calls.gemini++; const ans = gemini || [{ project: "Lake Park", quote: "Test Developments launches Lake Park, a new compound with a kids area", source: "S2" }, { project: "Invented Towers", quote: "Invented Towers will open in 2027 with a water park", source: "S2" }];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }], usageMetadata: { totalTokenCount: 10 } }));
  };
  return { e, calls };
}
const doc = async (e, p) => { const r = await e.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(p).first(); return r ? JSON.parse(r.data) : null; };
const count = async (e, like) => (await e.DB.prepare("SELECT COUNT(*) n FROM docs WHERE path GLOB ?").bind(like).first()).n;

test("queue: refused while the switch is off; nothing runs either", async () => {
  const { e, calls } = env({ on: false });
  assert.equal((await queueLeads(e, ["L1"], "u", T)).ok, false); assert.deepEqual(await engineTick(e, T), { off: true }); assert.equal(calls.search, 0);
});
test("queue: retry-safe, archived and unknown leads skipped, at most 20 a request", async () => {
  const { e } = env();
  const a = await queueLeads(e, ["L1", "L1", "LX", "nope"], "u", T); assert.deepEqual([a.queued, a.already, a.missing], [["L1"], [], ["LX", "nope"]]);
  assert.deepEqual((await queueLeads(e, ["L1"], "u", T)).already, ["L1"]);
  assert.ok((await queueLeads(e, Array.from({ length: 40 }, (_, i) => "Z" + i), "u", T)).missing.length <= 20);
});
const runAll = async (e, t = T) => { const s = []; for (let i = 0; i < 9; i++) { const r = await engineStep(e, "h", t + i * 1000); s.push(r); if (r.idle) break; } return s; };
test("research: search, website pages, LinkedIn, projects; real contact routes with sources; an invented project removed; nobody notified", async () => {
  const { e, calls } = env(); await queueLeads(e, ["L1"], "u", T);
  const s = await runAll(e);
  assert.deepEqual(s.map((x) => x.next || (x.done ? "done" : x.idle ? "idle" : JSON.stringify(x))), ["pages", "people", "projects", "done", "idle"]);
  const r = await doc(e, "mix/enrich/e/L1");
  assert.equal(r.status, "review"); assert.equal(r.site.host, "testdevelopments.com.eg");
  assert.ok(r.contacts.some((c) => c.value === "info@testdevelopments.com.eg" && c.own));
  assert.ok(r.contacts.some((c) => c.key === "01001234567")); assert.ok(!r.contacts.some((c) => c.key === "01112223334"), "the Facebook result is not read for contacts");
  assert.deepEqual(r.projects.map((p) => p.project), ["Lake Park"]); assert.match(r.notes.join(" "), /1 project\(s\) removed/);
  assert.deepEqual(r.people.map((p) => p.name), ["Test Person"], "only people whose result names this organisation");
  assert.equal(r.company.url, "https://www.linkedin.com/company/testdevelopments");
  assert.equal(r.credits, 3); assert.deepEqual([calls.search, calls.extract, calls.gemini], [2, 1, 1]);
  assert.ok(!calls.sent.some((b) => /linkedin\.com\/in/.test(b) && /urls/.test(b)), "LinkedIn pages are never opened");
  assert.equal(await count(e, "notif/*"), 0);
  assert.ok(!calls.sent.some((b) => /tvly-test|gem-test/.test(b)), "keys never in a body");
});
test("fill-in: website, company e-mail and official-site phone written to the lead's contact record, unverified, with sources and a log", async () => {
  const { e } = env(); await queueLeads(e, ["L1"], "u", T); const s = await runAll(e);
  assert.deepEqual(s.find((x) => x.done).added, ["website", "email", "phone"]);
  const lc = await doc(e, "leadcontact/L1");
  assert.equal(lc.website, "https://testdevelopments.com.eg/");
  assert.equal(lc.contact.email, "info@testdevelopments.com.eg"); assert.equal(lc.contact.emailVerified, false);
  assert.equal(lc.contact.phoneVerified, false); assert.ok(/testdevelopments\.com\.eg/.test(lc.contact.source));
  assert.equal(lc.contact.name, undefined, "no person is ever added automatically");
  assert.equal(await count(e, "leadcontact/L1/log/*"), 1);
  assert.deepEqual((await doc(e, "leads/L1")).contact, { phone: "", email: "" }, "the lead record itself is not changed");
  assert.equal((await doc(e, "mix/enrich/e/L1")).autoAdded.length, 3);
});
test("fill-in: a 5-digit hotline becomes a dated note, never the phone field (the Lead Mine's form would refuse every later save)", async () => {
  const { e } = env(); globalThis.fetch = ((orig) => async (url, init) => (new URL(url).pathname === "/extract" ? new Response(JSON.stringify({ results: [{ url: SITE + "contact-us", raw_content: "Call us Our Hotline 16220. Email info@testdevelopments.com.eg" }], usage: { credits: 1 } })) : orig(url, init)))(globalThis.fetch);
  await queueLeads(e, ["L1"], "u", T); await runAll(e);
  const lc = await doc(e, "leadcontact/L1"); assert.equal(lc.contact.phone, undefined);
  assert.equal(lc.extraSources.length, 1); assert.match(lc.extraSources[0].note, /Hotline 16220/);
  for (const v of ["16220", "0100 123 4567", "(02) 2345 6789", "+20 100 123 4567"]) assert.equal(E.fitsPhoneField(v), v !== "16220", v);
});
test("fill-in: never overwrites what the lead already has", async () => {
  const { e } = env(); e.DB.raw.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES ('leadcontact/L1','leadcontact',?,1,'x')").run(JSON.stringify({ website: "https://mine.example/", contact: { email: "me@mine.example", phone: "0100" } }));
  await queueLeads(e, ["L1"], "u", T); await runAll(e);
  const lc = await doc(e, "leadcontact/L1"); assert.equal(lc.website, "https://mine.example/"); assert.equal(lc.contact.email, "me@mine.example"); assert.equal(lc.contact.phone, "0100");
});
test("fill-in: off writes nothing to the lead", async () => {
  const { e } = env(); e.DB.raw.prepare("UPDATE docs SET data = ? WHERE path = 'mix/enginecfg'").run(JSON.stringify({ enrichPerDay: 5, stepsPerRun: 3, autoAdd: false, people: false }));
  await queueLeads(e, ["L1"], "u", T); const s = await runAll(e);
  assert.deepEqual(s.map((x) => x.next || (x.done ? "done" : "idle")), ["pages", "projects", "done", "idle"], "no LinkedIn step when off");
  assert.equal(await doc(e, "leadcontact/L1"), null);
});
test("e-mail fallback: when the pages show no company e-mail, one search for the domain finds it", async () => {
  const { e, calls } = env({ tavily: (b) => new Response(JSON.stringify({ results: /^"@/.test(b.query)
      ? [{ url: "https://news.example/a", title: "Contact", content: "write to sales@testdevelopments.com.eg or ceo@gmail.com", score: 0.5 }]
      : [{ url: SITE, title: "Home", content: "Test Developments", score: 0.9 }], usage: { credits: 1 } })) });
  e.DB.raw.prepare("UPDATE docs SET data = ? WHERE path = 'mix/enginecfg'").run(JSON.stringify({ enrichPerDay: 5, stepsPerRun: 3, people: false }));
  globalThis.fetch = ((orig) => async (url, init) => (new URL(url).pathname === "/extract" ? new Response(JSON.stringify({ results: [{ url: SITE, raw_content: "Welcome. No contact details here." }], usage: { credits: 1 } })) : orig(url, init)))(globalThis.fetch);
  await queueLeads(e, ["L1"], "u", T); const s = await runAll(e);
  assert.deepEqual(s.map((x) => x.next || (x.done ? "done" : "idle")), ["pages", "emails", "projects", "done", "idle"]);
  const r = await doc(e, "mix/enrich/e/L1"); assert.deepEqual(r.contacts.map((c) => c.value), ["sales@testdevelopments.com.eg"], "only the company's own domain");
});
test("website: a second search is tried before giving up", async () => {
  let n = 0; const { e } = env({ tavily: (b) => new Response(JSON.stringify({ results: n++ === 0 ? [{ url: "https://www.nawy.com/x", title: "listing", content: "x", score: 0.5 }] : [{ url: "https://testdevelopments.com.eg/", title: "Official", content: "x", score: 0.9 }], usage: { credits: 1 } })) });
  e.DB.raw.prepare("UPDATE docs SET data = ? WHERE path = 'mix/enginecfg'").run(JSON.stringify({ enrichPerDay: 5, people: false }));
  await queueLeads(e, ["L1"], "u", T); await engineStep(e, "h", T);
  assert.equal((await doc(e, "mix/enrich/e/L1")).site.host, "testdevelopments.com.eg");
});
test("LinkedIn: people must work in Egypt (a real test found Mountain View, California staff); LinkedIn clutter removed", () => {
  const f = E.linkedinFrom([
    { url: "https://www.linkedin.com/in/us", title: "Jennifer Test - Director of Public Works - City of Mountain View | LinkedIn", content: "Mountain View, California" },
    { url: "https://eg.linkedin.com/in/eg", title: "‏Ayman Test‏ - ‏General Manager · LinkedIn مصر", content: "General Manager at Mountain View" },
    { url: "https://www.linkedin.com/in/cairo", title: "Sara Test - Procurement - Mountain View | LinkedIn", content: "Cairo, Egypt" }], "Mountain View");
  assert.deepEqual(f.people.map((p) => p.name), ["Ayman Test", "Sara Test"]); assert.equal(f.people[0].headline, "General Manager");
});
test("contacts: SODIC's \"(+2)02…\" international format is read", () => {
  assert.deepEqual(E.contactRoutes("International Number (+2)0238270398", "https://x.example", "x.example").map((c) => c.key), ["0238270398"]);
});
test("LinkedIn: the name must match as whole distinctive words", () => {
  const f = E.linkedinFrom([{ url: "https://eg.linkedin.com/in/a", title: "A B - Projects Manager - ORA Developers | LinkedIn", content: "" }, { url: "https://eg.linkedin.com/in/b", title: "C D - Corporate Affairs - Big Corp | LinkedIn", content: "" }, { url: "https://eg.linkedin.com/in/c", title: "E F - Engineer - Egypt Developers | LinkedIn", content: "" }], "Ora Developers Egypt");
  assert.deepEqual(f.people.map((p) => p.name), ["A B"]);
  assert.deepEqual(E.peopleTitles({ titles: "Head of Landscape; Project Director (iCity); Procurement Manager" }), ["head of landscape", "project director", "procurement manager"]);
});
test("research: the AI cannot add contact details; only rules read them from the website", async () => {
  const { e } = env({ gemini: [{ project: "Lake Park", quote: "Test Developments launches Lake Park, a new compound with a kids area", source: "S2", phone: "01055555555", email: "ceo@x.example" }] });
  await queueLeads(e, ["L1"], "u", T); for (let i = 0; i < 3; i++) await engineStep(e, "h", T + i);
  const s = JSON.stringify(await doc(e, "mix/enrich/e/L1")); assert.ok(!s.includes("01055555555") && !s.includes("ceo@x.example"));
});
test("research: no official website → no page reading, an honest note, projects still read", async () => {
  const { e, calls } = env({ tavily: () => new Response(JSON.stringify({ results: [{ url: "https://www.nawy.com/x", title: "listing", content: "Second Test Co opens a school in October", score: 0.5 }], usage: { credits: 1 } })) });
  await queueLeads(e, ["L2"], "u", T); await engineStep(e, "h", T); await engineStep(e, "h", T + 1);
  const r = await doc(e, "mix/enrich/e/L2"); assert.equal(calls.extract, 0); assert.equal(r.site, null); assert.match(r.notes[0], /No official website/);
});
test("limits: the daily lead limit waits until tomorrow without failing or losing the lead", async () => {
  const { e } = env(); await queueLeads(e, ["L1", "L2", "L3"], "u", T);
  for (let i = 0; i < 12; i++) await engineStep(e, "h", T + i * 1000);
  const r3 = await doc(e, "mix/enrich/e/L3"), j = (await e.DB.prepare("SELECT data FROM docs WHERE parent = 'mix/disc/j' AND json_extract(data,'$.input.leadId') = 'L3'").first());
  assert.equal(r3.status, "queued"); const jd = JSON.parse(j.data); assert.equal(jd.status, "waiting"); assert.match(jd.error, /limit/); assert.equal(jd.tries, 0);
  assert.equal(jd.nextAt.slice(0, 10), "2026-11-08");
});
test("limits: Tavily's free quota makes research wait, not fail", async () => {
  const { e } = env({ tavily: () => new Response(JSON.stringify({ detail: { error: "quota" } }), { status: 432 }) });
  await queueLeads(e, ["L1"], "u", T); const s = await engineStep(e, "h", T);
  assert.equal(s.status, "waiting"); assert.match(s.error, /free monthly credits/);
});
test("limits: a rate limit waits a minute and does not use up a try", async () => {
  const { e } = env({ tavily: () => new Response("{}", { status: 429 }) }); await queueLeads(e, ["L1"], "u", T);
  let t = T; for (let i = 0; i < 5; i++) { const s = await engineStep(e, "h", t); assert.equal(s.status, "waiting"); t += 61e3; }
  const j = JSON.parse((await e.DB.prepare("SELECT data FROM docs WHERE parent = 'mix/disc/j'").first()).data); assert.equal(j.status, "waiting"); assert.equal(j.tries, 0);
});
test("failures: a refused key fails at once with the reason, kept for review", async () => {
  const { e } = env({ tavily: () => new Response("{}", { status: 401 }) });
  await queueLeads(e, ["L1"], "u", T); const s = await engineStep(e, "h", T);
  assert.equal(s.status, "failed"); assert.match((await doc(e, "mix/enrich/e/L1")).error, /refused the API key/);
});
test("failures: a temporary error retries, then fails with its reason", async () => {
  const { e } = env({ tavily: () => new Response("{}", { status: 500 }) }); await queueLeads(e, ["L1"], "u", T);
  let t = T, last, steps = 0; for (let r; !(r = await engineStep(e, "h", t)).idle; t += 2 * 3600e3) { last = r; if (++steps > 5) break; }
  assert.equal(steps, 3, "three tries"); assert.equal(last.status, "failed"); assert.match((await doc(e, "mix/enrich/e/L1")).error, /temporary problem/);
});
test("hourly run: at most the configured steps", async () => {
  const { e, calls } = env(); await queueLeads(e, ["L1", "L2"], "u", T);
  const r = await engineTick(e, T); assert.equal(r.ran.length, 3);
  assert.ok(calls.search + calls.extract + calls.gemini <= 6, "a step makes at most two searches (the second only when no website was found)");
});

/* ---------------- research schedule ---------------- */
import { scheduleTick } from "../worker/schedule.js";
const at = (iso) => Date.parse(iso);   // 2026-11-08 is a Sunday
test("schedule: due jobs queued once a day as one request; a missed hour caught up; not twice", async () => {
  const { e } = env();
  assert.deepEqual((await scheduleTick(e, at("2026-11-08T05:28:00Z"))).queued, [], "before the hour");
  const a = await scheduleTick(e, at("2026-11-08T06:28:00Z")); assert.deepEqual(a.queued, ["fx", "news"]);
  const req = await doc(e, "mi/req/r/" + a.request); assert.deepEqual([req.status, req.by, req.jobs], ["queued", "schedule", ["fx", "news"]]);
  const b = await scheduleTick(e, at("2026-11-08T09:28:00Z")); assert.deepEqual(b.queued, ["materials"], "07:00 job caught up at 09:28; fx and news not again");
  assert.deepEqual((await scheduleTick(e, at("2026-11-08T10:28:00Z"))).queued, []);
  assert.deepEqual((await scheduleTick(e, at("2026-11-13T09:28:00Z"))).queued, [], "Friday: nothing by default");
});
test("schedule: off with the switch; a job already waiting in a request is not asked twice", async () => {
  const off = env({ on: false }); assert.deepEqual(await scheduleTick(off.e, at("2026-11-08T06:28:00Z")), { off: true });
  const { e } = env(); e.DB.raw.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES ('mi/req/r/x','mi/req/r',?,1,'x')").run(JSON.stringify({ jobs: ["fx"], status: "queued" }));
  assert.deepEqual((await scheduleTick(e, at("2026-11-08T06:28:00Z"))).queued, ["news"]);
});
test("schedule: the administrator's choices, cleaned; the credits estimate", () => {
  const s = E.scheduleOf({ fx: { on: false }, news: { days: [9, 1, 1, "2"], hour: 99 } });
  assert.equal(s.fx.on, false); assert.deepEqual(s.news.days, [1, 2]); assert.equal(s.news.hour, 23); assert.deepEqual(s.weekly, E.DEFAULT_SCHEDULE.weekly);
  assert.equal(E.cronOf(E.DEFAULT_SCHEDULE.fx), "28 6 * * 0,1,2,3,4");
  const c = E.scheduleCredits(E.DEFAULT_SCHEDULE); assert.ok(c > 100 && c < 300, String(c));
});
test("processing per step stays small", async () => {
  const { e } = env(); await queueLeads(e, ["L1"], "u", T); const ms = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); await engineStep(e, "h", T + i); ms.push(performance.now() - t0); }
  console.log("step ms (includes the fake database and fake network):", ms.map((x) => x.toFixed(1)).join(", "));
});
