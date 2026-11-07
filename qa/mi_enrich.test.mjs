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
test("research: three steps, real contact routes with sources, an invented project removed, nothing written to the lead, nobody notified", async () => {
  const { e, calls } = env(); await queueLeads(e, ["L1"], "u", T);
  const s = [await engineStep(e, "h", T), await engineStep(e, "h", T + 1000), await engineStep(e, "h", T + 2000), await engineStep(e, "h", T + 3000)];
  assert.deepEqual(s.map((x) => x.next || (x.done ? "done" : x.idle ? "idle" : JSON.stringify(x))), ["pages", "projects", "done", "idle"]);
  const r = await doc(e, "mix/enrich/e/L1");
  assert.equal(r.status, "review"); assert.equal(r.site.host, "testdevelopments.com.eg");
  assert.ok(r.contacts.some((c) => c.value === "info@testdevelopments.com.eg" && c.own));
  assert.ok(r.contacts.some((c) => c.key === "01001234567")); assert.ok(!r.contacts.some((c) => c.key === "01112223334"), "the Facebook result is not read for contacts");
  assert.deepEqual(r.projects.map((p) => p.project), ["Lake Park"]); assert.match(r.notes.join(" "), /1 project\(s\) removed/);
  assert.equal(r.credits, 2); assert.deepEqual([calls.search, calls.extract, calls.gemini], [1, 1, 1]);
  assert.deepEqual((await doc(e, "leads/L1")).contact, { phone: "", email: "" }); assert.equal(await doc(e, "leadcontact/L1"), null);
  assert.equal(await count(e, "notif/*"), 0);
  assert.ok(!calls.sent.some((b) => /tvly-test|gem-test/.test(b)), "keys never in a body");
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
  const r = await engineTick(e, T); assert.equal(r.ran.length, 3); assert.equal(calls.search + calls.extract + calls.gemini, 3);
});
test("processing per step stays small", async () => {
  const { e } = env(); await queueLeads(e, ["L1"], "u", T); const ms = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); await engineStep(e, "h", T + i); ms.push(performance.now() - t0); }
  console.log("step ms (includes the fake database and fake network):", ms.map((x) => x.toFixed(1)).join(", "));
});
