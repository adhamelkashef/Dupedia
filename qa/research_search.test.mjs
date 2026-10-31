/* X FORCE 2.1 S2 — tests for the free research search (worker/providers.js, usage.js, topic.js). No network: Tavily is a
   fake fetch. Run:  node --test qa/research_search.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { tavilySearch, tavilyExtract } from "../worker/providers.js";
import { reserveTavily, settleTavily, reserveReport, usageSummary, keys } from "../worker/usage.js";
import { cleanTopic, planQueries, creditEstimate, createTopic, stepTopic } from "../worker/topic.js";

const realFetch = globalThis.fetch;
const env = (extra = {}) => Object.assign({ DB: fakeD1(), TAVILY_API_KEY: "tvly-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", TAVILY_TIMEOUT_MS: "300" }, extra);
const reply = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const results = (tag, n = 3) => ({ results: Array.from({ length: n }, (_, i) => ({ url: `https://site${i}.example/${tag}`, title: `${tag} ${i}`, content: `about ${tag} ${i}`, score: 0.9 - i / 10, published_date: "Mon, 20 Oct 2026 10:00:00 GMT" })), usage: { credits: 1 }, request_id: "r-" + tag });
/** fake Tavily: handler(path, body, callNo) → Response | Promise; records every call */
function fakeTavily(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), body = JSON.parse(init.body); calls.push({ path: u.pathname, body, headers: init.headers });
    return handler(u.pathname, body, calls.length, init);
  };
  return calls;
}
const kv = async (e, k) => { const r = await e.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first(); return r ? Number(r.v) : 0; };
async function runToEnd(e, id, max = 20) { let p; for (let i = 0; i < max; i++) { p = (await stepTopic(e, id)).progress; if (!["queued", "searching", "collecting"].includes(p.stage)) return p; } return p; }
test.afterEach(() => { globalThis.fetch = realFetch; });

test("topic cleaning and fixed query plans", () => {
  assert.equal(cleanTopic("  new\u0000 compounds\n  New Cairo "), "new compounds New Cairo");
  assert.equal(cleanTopic("ab"), null);
  assert.equal(cleanTopic("x".repeat(500)).length, 200);
  assert.equal(planQueries("soft play", "egypt", "quick").length, 3);
  assert.equal(planQueries("soft play", "egypt", "standard").length, 5);
  const deep = planQueries("soft play", "gcc", "deep", 2026);
  assert.equal(deep.length, 6); assert.ok(deep.every((q) => q.depth === "advanced" && q.country === null));
  assert.equal(deep[1].q, "soft play Saudi Arabia UAE Qatar new project 2026");
  assert.equal(planQueries("x y z", "egypt", "quick")[0].country, "egypt");
  assert.deepEqual([creditEstimate("quick"), creditEstimate("standard"), creditEstimate("deep")], [3, 6, 14]);
});

test("Tavily search: request shape, key in header only, results normalised", async () => {
  const calls = fakeTavily(() => reply(200, { results: [{ url: "https://a.example/x", title: "A", content: "c", score: 0.5, published_date: "2026-10-01" }, { url: "javascript:alert(1)", title: "bad" }], usage: { credits: 1 } }));
  const r = await tavilySearch(env(), { query: "playground Egypt", country: "egypt", maxResults: 50 });
  assert.equal(calls[0].path, "/search");
  assert.equal(calls[0].headers.authorization, "Bearer tvly-test-not-a-real-key");
  assert.ok(!JSON.stringify(calls[0].body).includes("tvly-test"), "the key is never in the body");
  assert.equal(calls[0].body.include_usage, true); assert.equal(calls[0].body.max_results, 10); assert.equal(calls[0].body.country, "egypt");
  assert.equal(r.results.length, 1, "non-http links are dropped"); assert.equal(r.results[0].publishedAt, "2026-10-01"); assert.equal(r.credits, 1);
});

test("Tavily: 429 with a short Retry-After is retried; a long one is reported, not waited for", async () => {
  fakeTavily((p, b, n) => (n === 1 ? reply(429, { detail: { error: "slow down" } }, { "retry-after": "0" }) : reply(200, results("ok"))));
  assert.equal((await tavilySearch(env(), { query: "a b c" })).results.length, 3);
  const calls = fakeTavily(() => reply(429, { detail: { error: "slow down" } }, { "retry-after": "60" }));
  await assert.rejects(tavilySearch(env(), { query: "a b c" }), (e) => e.code === "rate_limited" && e.retry);
  assert.equal(calls.length, 1, "no 60-second wait inside the request");
});

test("Tavily: quota (432/433) and refused key (401) are not retried", async () => {
  for (const [status, code] of [[432, "quota"], [433, "quota"], [401, "auth"]]) {
    const calls = fakeTavily(() => reply(status, { detail: { error: "x" } }));
    await assert.rejects(tavilySearch(env(), { query: "a b c" }), (e) => e.code === code && !e.retry);
    assert.equal(calls.length, 1);
  }
});

test("Tavily: timeout and non-JSON answers retry, then fail clearly", async () => {
  let calls = fakeTavily((p, b, n, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))));
  await assert.rejects(tavilySearch(env(), { query: "a b c" }), (e) => e.code === "timeout");
  assert.equal(calls.length, 2, "a timeout is retried once, then reported");
  calls = fakeTavily(() => reply(502, "<html>bad gateway</html>"));
  await assert.rejects(tavilySearch(env(), { query: "a b c" }), (e) => e.code === "server");
});

test("extract: credits from Tavily, failed pages listed", async () => {
  fakeTavily(() => reply(200, { results: [{ url: "https://a.example/1", raw_content: "x".repeat(9000) }], failed_results: [{ url: "https://b.example/2" }], usage: { credits: 1 } }));
  const r = await tavilyExtract(env(), ["https://a.example/1", "https://b.example/2", "ftp://no"]);
  assert.equal(r.results[0].content.length, 6000); assert.deepEqual(r.failed, ["https://b.example/2"]); assert.equal(r.credits, 1);
});

test("caps: reserve refuses past the daily and monthly caps and never goes over", async () => {
  const e = env({ TAVILY_DAILY_CREDITS: "3", TAVILY_MONTHLY_CREDITS: "5" }), k = keys();
  const a = await reserveTavily(e, 2); await reserveTavily(e, 1);
  await assert.rejects(reserveTavily(e, 1), (x) => x.code === "tavily_day");
  assert.equal(await kv(e, k.tavDay), 3);
  await settleTavily(e, a, 0);                                  // the 2-credit call failed → given back
  assert.equal(await kv(e, k.tavDay), 1); assert.equal(await kv(e, k.tavMonth), 1);
  const e2 = env({ TAVILY_DAILY_CREDITS: "50", TAVILY_MONTHLY_CREDITS: "2" });
  await reserveTavily(e2, 2); await assert.rejects(reserveTavily(e2, 1), (x) => x.code === "tavily_month");
  assert.equal(await kv(e2, keys().tavDay), 2, "a refused monthly reservation is taken back from today's count too");
});

test("caps: reports per admin per day and per month", async () => {
  const e = env({ RESEARCH_USER_DAILY: "2", RESEARCH_MONTHLY_JOBS: "3" });
  await reserveReport(e, "u1"); await reserveReport(e, "u1");
  await assert.rejects(reserveReport(e, "u1"), (x) => x.code === "user_day");
  await reserveReport(e, "u2"); await assert.rejects(reserveReport(e, "u3"), (x) => x.code === "reports_month");
  const s = await usageSummary(e, "u1"); assert.equal(s.reports.month, 3); assert.equal(s.reports.mineToday, 2);
});

test("quick research: 3 real steps, sources de-duplicated, credits counted", async () => {
  const e = env();
  fakeTavily((p, b) => reply(200, results(b.query.includes("news") || b.topic === "news" ? "news" : "same", 3)));
  const c = await createTopic(e, "admin1", { topic: "outdoor playground New Cairo compounds", market: "egypt", depth: "quick" });
  assert.ok(c.ok); assert.equal(c.progress.stage, "queued"); assert.equal(c.progress.searchesTotal, 3);
  const p1 = (await stepTopic(e, c.progress.id)).progress; assert.equal(p1.stage, "searching"); assert.equal(p1.searchesDone, 1);
  const p = await runToEnd(e, c.progress.id);
  assert.equal(p.stage, "sources_ready"); assert.equal(p.searchesDone, 3); assert.equal(p.sources, 6, "3 + 3 news; repeats merged");
  assert.equal(p.credits, 3); assert.equal(await kv(e, keys().tavMonth), 3);
  const d = JSON.parse((await e.DB.prepare("SELECT data FROM docs WHERE path = ?").bind("mix/topic/t/" + p.id).first()).data);
  assert.deepEqual(d.sources.map((s) => s.id), ["S1", "S2", "S3", "S4", "S5", "S6"]);
  assert.deepEqual(d.sources[0].fromQueries, [0, 1]);
  assert.ok(d.sources.every((s) => s.url.startsWith("https://site")), "every URL came from Tavily");
});

test("standard research reads the top pages after the searches", async () => {
  const e = env(); let extracted = null;
  fakeTavily((p, b) => (p === "/extract" ? (extracted = b.urls, reply(200, { results: b.urls.map((u) => ({ url: u, raw_content: "page " + u })), usage: { credits: 1 } })) : reply(200, results("q" + b.query.length, 3))));
  const c = await createTopic(e, "admin1", { topic: "water park suppliers", market: "egypt", depth: "standard" });
  const p = await runToEnd(e, c.progress.id);
  assert.equal(p.stage, "sources_ready"); assert.equal(extracted.length, 5); assert.equal(p.pagesRead, 5); assert.equal(p.credits, 6);
});

test("free quota used up → research waits with the reason, nothing charged; it continues later", async () => {
  const e = env(); let quota = true;
  fakeTavily(() => (quota ? reply(432, { detail: { error: "This request exceeds your plan's set usage limit." } }) : reply(200, results("x", 2))));
  const c = await createTopic(e, "admin1", { topic: "soft play Egypt", depth: "quick" });
  let p = (await stepTopic(e, c.progress.id)).progress;
  assert.equal(p.stage, "waiting"); assert.equal(p.waiting.code, "quota"); assert.match(p.waiting.reason, /nothing is charged/);
  assert.equal(await kv(e, keys().tavMonth), 0, "the reserved credit was given back");
  quota = false; p = await runToEnd(e, c.progress.id); assert.equal(p.stage, "sources_ready");
});

test("daily cap reached mid-research → waiting (cap), not failed", async () => {
  const e = env({ TAVILY_DAILY_CREDITS: "2" });
  fakeTavily(() => reply(200, results("x", 2)));
  const c = await createTopic(e, "admin1", { topic: "school playgrounds", depth: "quick" });
  const p = await runToEnd(e, c.progress.id);
  assert.equal(p.stage, "waiting"); assert.equal(p.waiting.code, "tavily_day"); assert.equal(p.searchesDone, 2);
  assert.equal(await kv(e, keys().tavDay), 2);
});

test("refused key → every search fails → research failed with the reason", async () => {
  const e = env(); fakeTavily(() => reply(401, { detail: { error: "Unauthorized" } }));
  const c = await createTopic(e, "admin1", { topic: "amusement park Egypt", depth: "quick" });
  const p = await runToEnd(e, c.progress.id);
  assert.equal(p.stage, "failed"); assert.match(p.error, /TAVILY_API_KEY/); assert.equal(await kv(e, keys().tavMonth), 0);
});

test("not connected (no key) → waiting with a setup message", async () => {
  const e = env({ TAVILY_API_KEY: "" });
  const c = await createTopic(e, "admin1", { topic: "beach furniture", depth: "quick" });
  const p = (await stepTopic(e, c.progress.id)).progress;
  assert.equal(p.stage, "waiting"); assert.equal(p.waiting.code, "not_configured");
});

test("two steps at the same moment: the second is refused (busy)", async () => {
  const e = env(); let release; fakeTavily(() => new Promise((r) => { release = () => r(reply(200, results("x", 1))); }));
  const c = await createTopic(e, "admin1", { topic: "hotel kids club", depth: "quick" });
  const first = stepTopic(e, c.progress.id); await new Promise((r) => setTimeout(r, 20));
  const second = await stepTopic(e, c.progress.id);
  assert.equal(second.busy, true); release(); assert.equal((await first).ok, true);
});

test("bad input is refused before anything is spent", async () => {
  const e = env();
  assert.equal((await createTopic(e, "admin1", { topic: " a " })).ok, false);
  assert.equal((await stepTopic(e, "../../users")).ok, false);
  assert.equal((await usageSummary(e, "admin1")).reports.month, 0);
});
