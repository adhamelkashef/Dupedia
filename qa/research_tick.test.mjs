/* X FORCE 2.1 Q3 — the hourly research run (worker/research.js researchTick): whole requests per tick, time budget,
   one tick at a time, waiting on limits, dead jobs closed, no duplicates on retry. Tavily + Gemini are a fake fetch.
   Run:  node --test qa/research_tick.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { researchTick, runRequestJob } from "../worker/research.js";

const realFetch = globalThis.fetch;
const KEYS = { TAVILY_API_KEY: "tvly-test-not-a-real-key", GEMINI_API_KEY: "gem-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", GEMINI_BASE_URL: "https://gemini.test", TAVILY_TIMEOUT_MS: "300", GEMINI_TIMEOUT_MS: "300" };
const env = (extra = {}) => Object.assign({ DB: fakeD1() }, KEYS, extra);
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const U1 = "https://www.ahram.org.eg/news/new-cairo-compound-kids-park", U2 = "https://dailynewsegypt.com/2026/10/28/suez-freight", U3 = "https://www.cbe.org.eg/en/exchange-rates", U4 = "https://steelorbis.com/egypt-rebar-prices";
const today = () => new Date().toISOString().slice(0, 10);
const tav = { results: [U1, U2, U3, U4].map((u, i) => ({ url: u, title: "t" + i, content: "c" + i, score: 0.9 - i / 10, published_date: "2026-10-28" })), usage: { credits: 1 } };
const ANSWERS = {
  opportunities: [{ title: "New Cairo compound kids park and clubhouse", organization: "Example Developments", location: "New Cairo, Egypt", category: "compound", kind: "project", description: "kids park", products: ["Outdoor playground"], sourceUrl: U1, sourceOrg: "Al-Ahram", sourceType: "media", publishedAt: "2026-10-20", nextAction: "Contact", contactStrategy: "Sales office", region: "Egypt" }],
  news: [{ headline: "Red Sea freight rates rise", url: U2, source: "Daily News Egypt", sourceType: "media", area: "shipping", publishedAt: "2026-10-28", summary: "Rates rose", whyItMatters: "Import costs", relevantTo: ["imports"], impact: "Higher freight", impactLevel: "high", nextStep: "Check quotes", needsProfessional: false }],
  fx: [{ code: "USD", egpPer: 48.5, url: U3, source: "Central Bank of Egypt", kind: "official", rateType: "CBE official, sell", publishedAt: today() }],
  materials: [{ materialId: "m1", price: 42000, unit: "t", currency: "EGP", url: U4, source: "SteelOrbis", priceType: "indicative", market: "Egypt", publishedAt: "2026-10-30", note: "" }],
};
const jobOf = (prompt) => /EGP per 1 unit/.test(prompt) ? "fx" : /materials listed below/.test(prompt) ? "materials" : /commercial opportunities/.test(prompt) ? "opportunities" : "news";
const gem = (v) => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(v) }] } }], usageMetadata: { totalTokenCount: 100 } });
function fake({ gemini, delayMs = 0 } = {}) {
  const calls = { tavily: 0, gemini: [] };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), body = JSON.parse(init.body); if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (u.host === "tavily.test") { calls.tavily++; return u.pathname === "/extract" ? reply(200, { results: body.urls.map((x) => ({ url: x, raw_content: "page" })), usage: { credits: 1 } }) : reply(200, tav); }
    const job = jobOf(body.contents[0].parts[0].text); calls.gemini.push(job);
    return gemini ? gemini(job, calls) : gem(ANSWERS[job]);
  };
  return calls;
}
const put = (e, p, d) => e.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data").bind(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), new Date().toISOString()).run();
const get = async (e, p) => { const r = await e.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(p).first(); return r ? JSON.parse(r.data) : null; };
const count = async (e, parent) => (await e.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE parent = ?").bind(parent).first()).n;
const countLike = async (e, glob) => (await e.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE path GLOB ?").bind(glob).first()).n;
const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
const JOBS4 = ["opportunities", "news", "fx", "materials"];
async function seed(e) { await e.DB.prepare("INSERT INTO users (uid, owner, active) VALUES ('u_ceo', 1, 1)").run(); await put(e, "mix/mat/m/m1", { name: "Steel rebar", unit: "t", grade: "B500" }); }
test.afterEach(() => { globalThis.fetch = realFetch; });

test("one hourly run finishes a whole 4-job request (not one job per hour) and records the run", async () => {
  const e = env(); await seed(e); fake();
  await put(e, "mi/req/r/rq1", { jobs: JOBS4, status: "queued", at: ago(30) });
  const t = await researchTick(e);
  assert.equal(t.ran.length, 4); assert.ok(t.ran.every((x) => x.ok), JSON.stringify(t.ran));
  const r = await get(e, "mi/req/r/rq1");
  assert.equal(r.status, "done"); assert.ok(JOBS4.every((j) => r.progress[j].status === "done"));
  assert.equal(await count(e, "mi/opps/o"), 1); assert.equal(await count(e, "mix/news/n"), 1); assert.equal(await count(e, "mix/fx/r"), 1);
  const lt = JSON.parse((await e.DB.prepare("SELECT v FROM kv WHERE k = 'research:lastTick'").first()).v);
  assert.equal(lt.ran.length, 4); assert.equal(lt.by, "hourly");
  assert.deepEqual(await researchTick(e), { idle: true }, "nothing left to do");
});

test("several queued requests: oldest first, all finished in one run", async () => {
  const e = env(); await seed(e); const calls = fake();
  await put(e, "mi/req/r/rqB", { jobs: ["news"], status: "queued", at: ago(20) });
  await put(e, "mi/req/r/rqA", { jobs: ["opportunities"], status: "queued", at: ago(50) });
  const t = await researchTick(e);
  assert.deepEqual(t.ran.map((x) => x.request), ["rqA", "rqB"]); assert.deepEqual(calls.gemini, ["opportunities", "news"]);
  assert.equal((await get(e, "mi/req/r/rqA")).status, "done"); assert.equal((await get(e, "mi/req/r/rqB")).status, "done");
});

test("time budget: no new job starts after it; the next run continues where it stopped", async () => {
  const e = env(); await seed(e); fake({ delayMs: 15 });
  await put(e, "mi/req/r/rq1", { jobs: JOBS4, status: "queued", at: ago(30) });
  const t1 = await researchTick(e, { budgetMs: 60 });
  assert.ok(t1.ran.length >= 1 && t1.ran.length < 4, "stopped early: " + t1.ran.length);
  const mid = await get(e, "mi/req/r/rq1"); assert.equal(mid.status, "running");
  const t2 = await researchTick(e); assert.equal(t1.ran.length + t2.ran.length, 4);
  assert.equal((await get(e, "mi/req/r/rq1")).status, "done");
});

test("free quota reached mid-request: the run stops, the job shows WAITING (not failed), the next hour finishes it", async () => {
  const e = env(); await seed(e); let quota = true;
  fake({ gemini: (job) => (job === "news" && quota ? reply(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded: requests per day" } }) : gem(ANSWERS[job])) });
  await put(e, "mi/req/r/rq1", { jobs: JOBS4, status: "queued", at: ago(30) });
  const t1 = await researchTick(e);
  assert.deepEqual(t1.ran.map((x) => [x.job, x.code]), [["opportunities", null], ["news", "limit"]], "stops at the quota instead of hammering");
  const r1 = await get(e, "mi/req/r/rq1");
  assert.equal(r1.status, "queued"); assert.equal(r1.progress.news.status, "waiting");
  const h = await get(e, "mi/state/jobs/news");
  assert.equal(h.status, "waiting"); assert.equal(h.error, null); assert.equal(h.failures, 0); assert.match(h.waiting, /free daily quota/);
  quota = false; const t2 = await researchTick(e);
  assert.deepEqual(t2.ran.map((x) => x.job), ["news", "fx", "materials"]);
  assert.equal((await get(e, "mi/req/r/rq1")).status, "done"); assert.equal((await get(e, "mi/state/jobs/news")).status, "ok");
});

test("only one hourly run at a time", async () => {
  const e = env(); await seed(e); fake();
  await put(e, "mi/req/r/rq1", { jobs: ["news"], status: "queued", at: ago(30) });
  await e.DB.prepare("INSERT INTO leases (path, holder, exp) VALUES ('research:tick', 'other', ?)").bind(Date.now() + 60e3).run();
  assert.deepEqual(await researchTick(e), { skipped: "another research tick is running" });
  assert.equal((await get(e, "mi/req/r/rq1")).status, "queued", "untouched");
});

test("a job already running from the page: the hourly run does not start it twice", async () => {
  const e = env(); await seed(e); const calls = fake();
  await put(e, "mi/req/r/rq1", { jobs: ["news"], status: "queued", at: ago(30) });
  await e.DB.prepare("INSERT INTO leases (path, holder, exp) VALUES ('research:run', 'page-job', ?)").bind(Date.now() + 60e3).run();
  const t = await researchTick(e);
  assert.equal(t.ran[0].code, "busy"); assert.equal(t.ran.length, 1); assert.equal(calls.gemini.length, 0);
  assert.equal((await get(e, "mi/req/r/rq1")).progress.news.status, "waiting");
});

test("a job that stopped responding 3 times is closed as failed; its request finishes as partial", async () => {
  const e = env(); await seed(e); fake();
  await put(e, "mi/req/r/rq1", { jobs: ["opportunities", "news"], status: "running", at: ago(40), startedAt: ago(40),
    progress: { opportunities: { status: "done", at: ago(35), created: 1, updated: 0, tries: 1 }, news: { status: "running", at: ago(20), tries: 3 } } });
  const t = await researchTick(e);
  assert.deepEqual(t.closed, ["rq1"]);
  const r = await get(e, "mi/req/r/rq1"); assert.equal(r.status, "partial"); assert.match(r.progress.news.error, /Stopped responding 3 times/);
});

test("a job interrupted once is retried by the next run", async () => {
  const e = env(); await seed(e); fake();
  await put(e, "mi/req/r/rq1", { jobs: ["news"], status: "running", at: ago(40), startedAt: ago(40), progress: { news: { status: "running", at: ago(20), tries: 1 } } });
  const t = await researchTick(e); assert.equal(t.ran[0].ok, true);
  const r = await get(e, "mi/req/r/rq1"); assert.equal(r.status, "done"); assert.equal(r.progress.news.tries, 2);
});

test("requests older than 2 days are left for 'Queue again' — never run or changed by the hourly run", async () => {
  const e = env(); await seed(e); const calls = fake();
  const old = { jobs: ["news"], status: "queued", at: ago(3 * 24 * 60) }; await put(e, "mi/req/r/rqOld", old);
  assert.deepEqual(await researchTick(e), { idle: true }); assert.equal(calls.tavily, 0);
  assert.deepEqual(await get(e, "mi/req/r/rqOld"), old);
});

test("missing secrets: the hourly run does nothing and says which secrets; queued requests are kept as they are", async () => {
  const e = env({ GEMINI_API_KEY: "", TAVILY_API_KEY: "" }); await seed(e); const calls = fake();
  const q = { jobs: JOBS4, status: "queued", at: ago(30) }; await put(e, "mi/req/r/rq1", q);
  const t = await researchTick(e);
  assert.equal(t.skipped, "not configured"); assert.deepEqual(t.missing, ["TAVILY_API_KEY", "GEMINI_API_KEY"]);
  assert.equal(calls.tavily + calls.gemini.length, 0); assert.deepEqual(await get(e, "mi/req/r/rq1"), q);
});

test("retries never duplicate: the same results twice → same opportunities, news, rates, prices and notifications", async () => {
  const e = env(); await seed(e); fake();
  await put(e, "mi/req/r/rq1", { jobs: JOBS4, status: "queued", at: ago(30) });
  await researchTick(e);
  const snap = async () => [await count(e, "mi/opps/o"), await count(e, "mix/news/n"), await count(e, "mix/fx/r"), JSON.stringify((await get(e, "mix/mat/m/m1")).prices || (await get(e, "mix/mat/m/m1"))), await countLike(e, "notif/*")];
  const first = await snap();
  await put(e, "mi/req/r/rq2", { jobs: JOBS4, status: "queued", at: ago(10) });
  const t = await researchTick(e);
  assert.equal(t.ran.length, 4); assert.ok(t.ran.every((x) => x.created === 0), "nothing new created: " + JSON.stringify(t.ran));
  const second = await snap();
  assert.deepEqual(second.slice(0, 3), first.slice(0, 3)); assert.equal(second[4], first[4], "no duplicate notifications");
  assert.ok(first[1] === 1 && first[4] >= 1, "the high-impact news made one notification");
});

test("a request with a job retried after a temporary error does not run its finished jobs again", async () => {
  const e = env(); await seed(e); let fail = true; const calls = fake({ gemini: (job) => (job === "news" && fail ? reply(503, { error: { message: "overloaded" } }) : gem(ANSWERS[job])) });
  await put(e, "mi/req/r/rq1", { jobs: ["opportunities", "news"], status: "queued", at: ago(30) });
  await runRequestJob(e, "rq1", null, "page"); const r1 = await runRequestJob(e, "rq1", null, "page");
  assert.equal(r1.ok, false);
  const req = await get(e, "mi/req/r/rq1"); assert.equal(req.status, "partial", "a non-limit error fails that job; the request reports partial");
  fail = false; const before = calls.gemini.length;
  assert.deepEqual(await researchTick(e), { idle: true }, "finished requests are not re-run automatically");
  assert.equal(calls.gemini.length, before);
});
