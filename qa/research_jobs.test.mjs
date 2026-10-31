/* X FORCE 2.1 Q2 — the Market Intelligence jobs on Tavily + Gemini (worker/freejobs.js via worker/research.js runJob).
   No network: Tavily and Gemini are a fake fetch. Run:  node --test qa/research_jobs.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { researchConfig, missingMessage, runJob, runRequestJob } from "../worker/research.js";

const realFetch = globalThis.fetch;
const KEYS = { TAVILY_API_KEY: "tvly-test-not-a-real-key", GEMINI_API_KEY: "gem-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", GEMINI_BASE_URL: "https://gemini.test", TAVILY_TIMEOUT_MS: "300", GEMINI_TIMEOUT_MS: "300" };
const env = (extra = {}) => Object.assign({ DB: fakeD1() }, KEYS, extra);
const reply = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const U1 = "https://www.ahram.org.eg/news/new-cairo-compound-kids-park", U2 = "https://dailynewsegypt.com/2026/10/28/suez-freight", U3 = "https://www.cbe.org.eg/en/economic-research/statistics/exchange-rates";
const tavResults = { results: [
  { url: U1, title: "Developer launches New Cairo compound with 5-acre kids park", content: "A new compound in New Cairo with a clubhouse and children's play areas", score: 0.9, published_date: "2026-10-20" },
  { url: U2, title: "Red Sea freight rates rise", content: "Suez Canal shipping", score: 0.8, published_date: "2026-10-28" },
  { url: U3, title: "CBE exchange rates", content: "USD 48.50", score: 0.7 } ], usage: { credits: 1 } };
const OPP = (url) => ({ title: "New Cairo compound kids park and clubhouse", organization: "Example Developments", location: "New Cairo, Egypt", category: "compound", kind: "project",
  description: "New compound with a 5-acre kids park", products: ["Outdoor playground"], sourceUrl: url, sourceOrg: "Al-Ahram", sourceType: "media", publishedAt: "2026-10-20",
  nextAction: "Contact the developer's procurement team", contactStrategy: "Via the developer's published sales office", region: "Egypt", claims: [{ text: "5-acre kids park", sourceUrl: url }] });
const gem = (value, tokens = 1234) => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: tokens }, modelVersion: "gemini-3.8-flash" });
/** route fake calls: tavily(path, body) / gemini(body) */
function fake({ tavily = () => reply(200, tavResults), gemini = () => gem([]) } = {}) {
  const calls = { tavily: [], gemini: [] };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), body = JSON.parse(init.body);
    if (u.host === "tavily.test") { calls.tavily.push({ path: u.pathname, body, headers: init.headers }); return tavily(u.pathname, body); }
    if (u.host === "gemini.test") { calls.gemini.push({ url: String(url), body, headers: init.headers }); return gemini(body); }
    throw new Error("unexpected host " + u.host);
  };
  return calls;
}
const list = async (e, parent) => (await e.DB.prepare("SELECT path, data FROM docs WHERE parent = ?").bind(parent).all()).results.map((r) => JSON.parse(r.data));
const kv = async (e, k) => { const r = await e.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first(); return r ? Number(r.v) : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const put = (e, p, d) => e.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?)").bind(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), new Date().toISOString()).run();
test.afterEach(() => { globalThis.fetch = realFetch; });

test("configuration: free needs TAVILY_API_KEY + GEMINI_API_KEY; Claude only when chosen", () => {
  const c = researchConfig({});
  assert.equal(c.provider, "free"); assert.equal(c.configured, false); assert.deepEqual(c.missing, ["TAVILY_API_KEY", "GEMINI_API_KEY"]);
  assert.match(missingMessage(c).text, /TAVILY_API_KEY and GEMINI_API_KEY.*Workers & Pages → dupedia → Settings → Variables and Secrets/);
  assert.deepEqual(researchConfig({ TAVILY_API_KEY: KEYS.TAVILY_API_KEY }).missing, ["GEMINI_API_KEY"]);
  assert.equal(researchConfig(KEYS).configured, true);
  assert.equal(researchConfig({ ANTHROPIC_API_KEY: "x".repeat(40) }).configured, false, "a Claude key alone does not switch to paid Claude");
  assert.deepEqual(researchConfig({ RESEARCH_PROVIDER: "claude" }).missing, ["ANTHROPIC_API_KEY"]);
});

test("missing keys: the job is not run, nothing is spent, the exact secret names are returned", async () => {
  const e = env({ GEMINI_API_KEY: "" }), calls = fake();
  const r = await runJob(e, "news");
  assert.equal(r.ok, false); assert.equal(r.code, "not_configured"); assert.deepEqual(r.missing, ["GEMINI_API_KEY"]);
  assert.equal(calls.tavily.length + calls.gemini.length, 0);
});

test("opportunities: Tavily searches, Gemini reads only those sources, an invented link is dropped, the real one is saved", async () => {
  const e = env();
  const calls = fake({ gemini: () => gem([OPP(U1), OPP("https://invented.example/fake-project")]) });
  const r = await runJob(e, "opportunities");
  assert.equal(r.ok, true, r.error); assert.equal(r.created, 1);
  assert.equal(calls.tavily.length, 5, "5 fixed searches"); assert.ok(calls.tavily.every((c) => c.body.country === "egypt" && c.body.time_range === "month"));
  assert.equal(calls.gemini.length, 1);
  const g = calls.gemini[0];
  assert.equal(g.headers["x-goog-api-key"], KEYS.GEMINI_API_KEY); assert.ok(!g.url.includes(KEYS.GEMINI_API_KEY), "key never in the URL");
  assert.match(g.url, /\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(g.body.generationConfig.responseMimeType, "application/json");
  const prompt = g.body.contents[0].parts[0].text;
  assert.ok(prompt.includes("[S1]") && prompt.includes(U1), "the sources are listed"); assert.ok(!prompt.includes("tvly-test"));
  const opps = await list(e, "mi/opps/o");
  assert.equal(opps.length, 1); assert.equal(opps[0].sourceUrl, U1);
  assert.ok(r.notes.some((n) => /not among this run's search results/.test(n)), "the dropped item is explained");
  assert.ok(r.notes.some((n) => /5 Tavily search\(es\)/.test(n) && /1234 tokens/.test(n)));
  assert.equal(await kv(e, "ru:tav:m:" + today().slice(0, 7)), 5);
});

test("a repeated run updates the same opportunity — no duplicate", async () => {
  const e = env(); fake({ gemini: () => gem([OPP(U1)]) });
  const a = await runJob(e, "opportunities"), b = await runJob(e, "opportunities");
  assert.equal(a.created, 1); assert.equal(b.created, 0);
  assert.equal((await list(e, "mi/opps/o")).length, 1);
});

test("news and currency: saved to their existing places; currency reads the page texts", async () => {
  const e = env();
  const calls = fake({ tavily: (p, b) => (p === "/extract" ? reply(200, { results: b.urls.map((u) => ({ url: u, raw_content: "USD 48.50 EGP" })), usage: { credits: 1 } }) : reply(200, tavResults)),
    gemini: (b) => { const t = b.contents[0].parts[0].text; return t.includes("exchange rates") && t.includes("EGP per 1 unit")
      ? gem([{ code: "USD", egpPer: 48.5, url: U3, source: "Central Bank of Egypt", kind: "official", rateType: "CBE official, sell", publishedAt: today() }])
      : gem([{ headline: "Red Sea freight rates rise", url: U2, source: "Daily News Egypt", sourceType: "media", area: "shipping", publishedAt: "2026-10-28", summary: "Rates rose", whyItMatters: "Import costs", relevantTo: ["imports"], impact: "Higher freight", impactLevel: "medium", nextStep: "Check forwarder quotes", needsProfessional: false }]); } });
  const n = await runJob(e, "news"); assert.equal(n.ok, true, n.error); assert.equal((await list(e, "mix/news/n")).length, 1);
  assert.ok(calls.tavily.filter((c) => c.path === "/search").every((c) => c.body.topic === "news"));
  const f = await runJob(e, "fx"); assert.equal(f.ok, true, f.error);
  assert.ok(calls.tavily.some((c) => c.path === "/extract"), "rate pages were read");
  assert.ok(calls.tavily.some((c) => (c.body.include_domains || []).includes("cbe.org.eg")), "the CBE site is searched first");
  const fx = await list(e, "mix/fx/r"); assert.equal(fx.length, 1);
});

test("materials with none saved: no search, no AI call, nothing charged", async () => {
  const e = env(), calls = fake();
  const r = await runJob(e, "materials");
  assert.equal(calls.tavily.length + calls.gemini.length, 0); assert.ok(r.notes.some((x) => /no materials are saved/.test(x)));
});

test("weekly report: only public fields of saved records reach Gemini", async () => {
  const e = env();
  await put(e, "mi/opps/o/op1", { title: "Club X kids area", organization: "Club X", sourceUrl: U1, status: "won", priority: "high", score: 87, notes: [{ text: "secret internal note 4711" }], assignedTo: "u_sales1" });
  const calls = fake({ gemini: () => gem(null) });
  await runJob(e, "weekly");
  const prompt = calls.gemini[0].body.contents[0].parts[0].text;
  assert.ok(prompt.includes("op1 | Club X kids area | Club X |"));
  for (const s of ["won", "| high", "87", "4711", "u_sales1", "Previous report"]) assert.ok(!prompt.includes(s), "not sent: " + s);
});

test("Gemini free quota used up → the request WAITS (not failed, not completed); the daily job count is given back", async () => {
  const e = env();
  fake({ gemini: () => reply(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 250 per day" } }) });
  await put(e, "mi/req/r/rq1", { jobs: ["news"], status: "queued", at: new Date().toISOString() });
  const r = await runRequestJob(e, "rq1", null, "test");
  assert.equal(r.ok, false); assert.equal(r.code, "limit"); assert.match(r.error, /free daily quota is used up.*nothing is charged/);
  const req = (await list(e, "mi/req/r"))[0];
  assert.equal(req.status, "queued"); assert.equal(req.progress.news.status, "waiting");
  assert.equal(await kv(e, "research:" + today()), 0, "a waiting job does not use up the daily job limit");
});

test("invalid Gemini key → clear error; one job ok + one failed → request 'partial', never 'done'", async () => {
  const e = env(); let bad = false;
  fake({ gemini: () => (bad ? reply(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }) : gem([OPP(U1)])) });
  await put(e, "mi/req/r/rq2", { jobs: ["opportunities", "news"], status: "queued", at: new Date().toISOString() });
  const a = await runRequestJob(e, "rq2", null, "test"); assert.equal(a.ok, true, a.error);
  bad = true; const b = await runRequestJob(e, "rq2", null, "test");
  assert.equal(b.ok, false); assert.match(b.error, /Gemini refused the API key — check GEMINI_API_KEY/);
  const req = (await list(e, "mi/req/r"))[0];
  assert.equal(req.status, "partial"); assert.match(req.result, /failed — Gemini refused the API key/);
});

test("missing secret → the request stays queued with the exact reason (never marked completed)", async () => {
  const e = env({ TAVILY_API_KEY: "", GEMINI_API_KEY: "" }); fake();
  await put(e, "mi/req/r/rq3", { jobs: ["opportunities"], status: "queued", at: new Date().toISOString() });
  const r = await runRequestJob(e, "rq3", null, "test");
  const req = (await list(e, "mi/req/r"))[0];
  assert.equal(req.status, "queued"); assert.equal(req.progress.opportunities.status, "waiting"); assert.match(req.progress.opportunities.note, /TAVILY_API_KEY and GEMINI_API_KEY/);
  assert.equal(r.finished, false);
});

test("AI answer with a raw line break inside a text value is still read (seen with real Gemini)", async () => {
  const e = env(); const item = { headline: "Red Sea freight rates rise", url: U2, source: "Daily News Egypt", sourceType: "media", area: "shipping", publishedAt: "2026-10-28", summary: "Rates rose", whyItMatters: "Import costs", relevantTo: ["imports"], impact: "Higher freight", impactLevel: "medium", nextStep: "Check quotes", needsProfessional: false };
  const text = JSON.stringify([item]).replace("Rates rose", "Rates rose\nsharply\tthis week");   // a real newline and tab inside a string
  fake({ gemini: () => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 10 } }) });
  const r = await runJob(e, "news");
  assert.equal(r.ok, true, r.error); assert.equal((await list(e, "mix/news/n")).length, 1);
});

test("AI answer cut off at the length limit → clear message, nothing saved", async () => {
  const e = env(); fake({ gemini: () => reply(200, { candidates: [{ content: { parts: [{ text: "[{\"title\": \"New Cairo" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { totalTokenCount: 32768 } }) });
  const r = await runJob(e, "opportunities");
  assert.equal(r.ok, false); assert.match(r.error, /answer was cut off/); assert.equal((await list(e, "mi/opps/o")).length, 0);
});

test("Gemini is asked for low thinking; a model that refuses the setting is asked again without it", async () => {
  const e = env(); let n = 0;
  const calls = fake({ gemini: (b) => (++n === 1 ? reply(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "thinking_level is not supported for this model" } }) : gem([])) });
  const r = await runJob(e, "news");
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(calls.gemini[0].body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assert.equal(calls.gemini[1].body.generationConfig.thinkingConfig, undefined);
});

test("AI answer that is not JSON → nothing saved, clear error", async () => {
  const e = env(); fake({ gemini: () => reply(200, { candidates: [{ content: { parts: [{ text: "Sorry, here are some thoughts" }] } }], usageMetadata: { totalTokenCount: 10 } }) });
  const r = await runJob(e, "opportunities");
  assert.equal(r.ok, false); assert.match(r.error, /could not be read as JSON — nothing was saved/);
  assert.equal((await list(e, "mi/opps/o")).length, 0);
});

test("every search fails → no AI call, the job fails with the reason", async () => {
  const e = env(); const calls = fake({ tavily: () => reply(502, "<html>bad gateway</html>") });
  const r = await runJob(e, "news");
  assert.equal(r.ok, false); assert.match(r.error, /Every search for this job failed/); assert.equal(calls.gemini.length, 0);
  assert.equal(await kv(e, "ru:tav:m:" + today().slice(0, 7)), 0, "failed searches cost nothing");
});

test("Tavily credits used up → waiting, Gemini never called", async () => {
  const e = env(); const calls = fake({ tavily: () => reply(432, { detail: { error: "This request exceeds your plan's set usage limit." } }) });
  const r = await runJob(e, "news");
  assert.equal(r.code, "limit"); assert.equal(calls.gemini.length, 0); assert.match(r.error, /free monthly credits are used up/);
});

test("the paid Claude path is never used unless RESEARCH_PROVIDER=claude", async () => {
  const e = env({ ANTHROPIC_API_KEY: "sk-ant-" + "x".repeat(40) });
  const calls = fake({ gemini: () => gem([]) });
  const orig = globalThis.fetch; let anthropic = 0;
  globalThis.fetch = (url, init) => { if (String(url).includes("anthropic")) anthropic++; return orig(url, init); };
  await runJob(e, "news");
  assert.equal(anthropic, 0); assert.ok(calls.gemini.length === 1);
});
