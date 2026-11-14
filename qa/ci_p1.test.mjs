/* X FORCE Commercial Intelligence, Phase 1: signals. Rules, feed parsing, robots.txt, safe fetching, the four job kinds, paste-a-link,
   the job ledger's kind filter, and permissions. No network: every website and provider is a fake fetch. Made-up text only.
   Run:  node --test qa/ci_p1.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { signalsRunNow, signalsTick, pasteLink, testFeed, publicUrl, fetchPublic, FetchRefused, toSignals } from "../worker/signals.js";
import { addJob, dueJobs } from "../worker/enginejobs.js";
import { streamKey } from "../worker/usage.js";

globalThis.self = globalThis;
await import("../app/store.js");
const S = globalThis.DPSignals, RULES = globalThis.DPStore;
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const KEYS = { GEMINI_API_KEY: "gem-test-not-a-real-key", GEMINI_BASE_URL: "https://gemini.test", GEMINI_TIMEOUT_MS: "300", TAVILY_API_KEY: "tvly-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", TAVILY_TIMEOUT_MS: "300" };
const env = (extra = {}) => Object.assign({ DB: fakeD1() }, KEYS, extra);
const put = (e, p, d) => e.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data").bind(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), new Date().toISOString()).run();
const sigs = async (e) => (await e.DB.prepare("SELECT data FROM docs WHERE parent = 'mi/sig/s'").all()).results.map((r) => JSON.parse(r.data));
const jobs = async (e) => (await e.DB.prepare("SELECT data FROM docs WHERE parent = 'mix/disc/j'").all()).results.map((r) => JSON.parse(r.data));
const kv = async (e, k) => { const r = await e.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first(); return r ? Number(r.v) : 0; };
const on = (e, flags = { signals: true }) => put(e, "config/settings", { ci: flags });
const res = (status, body, headers = {}) => new Response(body, { status, headers });
/** A fake web: {"https://host/path": body | {status, body, headers}}. robots.txt defaults to 404 (= allowed). */
function web(pages, extra = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url)); const u = new URL(url);
    if (u.host === "tavily.test") return extra.tavily ? extra.tavily(JSON.parse(init.body)) : res(200, JSON.stringify({ results: [], usage: { credits: 1 } }));
    if (u.host === "gemini.test") return extra.gemini ? extra.gemini(JSON.parse(init.body)) : res(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "[]" }] }, finishReason: "STOP" }] }));
    const p = pages[u.origin + u.pathname + u.search] ?? pages[u.origin + u.pathname];
    if (p === undefined) return res(404, "not found");
    if (typeof p === "string") return res(200, p, { "content-type": "text/html; charset=utf-8" });
    return res(p.status || 200, p.body || "", p.headers || {});
  };
  return calls;
}

const EN_AWARD = "Example Developments awarded the landscaping works of its New Cairo compound to a local contractor.";
const EN_NOISE = "The minister met the ambassador to discuss trade relations and the weather.";
const AR_FAC = "تعتزم الشركة إنشاء منطقة ألعاب أطفال ونادي اجتماعي داخل الكمبوند الجديد في الشيخ زايد.";
const rss = (items) => `<?xml version="1.0"?><rss><channel><title>T</title>${items.map((i, n) => `<item><title><![CDATA[${i.t}]]></title><link>https://news.example-press.com/a/${n}</link><pubDate>Thu, 12 Nov 2026 10:00:00 +0000</pubDate><description>${i.d}</description></item>`).join("")}</channel></rss>`;

/* ---------------- rules ---------------- */
test("triage: a trigger next to a relevant word is a signal; the quote is a sentence of the item", () => {
  const r = S.triage({ title: "Landscaping news", text: `${EN_NOISE} ${EN_AWARD}` }, null);
  assert.equal(r.length, 1); assert.equal(r[0].type, "award"); assert.equal(r[0].strength, 5); assert.equal(r[0].quote, EN_AWARD);
  assert.equal(r[0].place.area, "newcairo");
  const a = S.triage({ title: "", text: AR_FAC }, null);
  assert.equal(a[0].type, "facility"); assert.equal(a[0].place.area, "zayed");
});
test("triage: no relevant word, letters inside words, or a foreign place → nothing", () => {
  assert.deepEqual(S.triage({ title: "", text: "The company announced the handover of its new car model to dealers next month." }, null), []);
  assert.deepEqual(S.triage({ title: "", text: "Her tenderness was noted at the school assembly for the children this year." }, null), [], "tender must be a whole word");
  assert.deepEqual(S.triage({ title: "", text: "A new resort in Riyadh, Saudi Arabia will open its kids club and playground next year." }, null), []);
});
test("triage: strongest kind wins; extra phrases from settings count", () => {
  const r = S.triage({ title: "", text: "The developer launched a new phase of the compound and signed the construction contract with its main contractor." }, null);
  assert.equal(r[0].type, "construction");
  const cfg = { phrases: { award: ["pergola package"] } };
  assert.equal(S.triage({ title: "", text: "The resort gave its pergola package to a firm from Hurghada last week." }, cfg)[0].type, "award");
  assert.deepEqual(S.triage({ title: "", text: "The resort gave its pergola package to a firm from Hurghada last week." }, null), []);
});
test("triage stays fast: 60 items in well under 100 ms once warm", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ title: "News " + i, text: (i % 3 ? EN_NOISE : EN_AWARD) + " " + AR_FAC + " " + EN_NOISE.repeat(4) }));
  for (const it of items) S.triage(it, null);
  const t0 = performance.now(); for (const it of items) S.triage(it, null); const ms = performance.now() - t0;
  assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
});
test("signal ids: the same sentence on the same page is one signal", () => {
  assert.equal(S.sigId("https://a.com/x?utm=1", "Hello  world, this is it"), S.sigId("https://A.com/x", "hello world this is it"));
  assert.notEqual(S.sigId("https://a.com/x", "one sentence here"), S.sigId("https://a.com/y", "one sentence here"));
});
test("source classes", () => {
  assert.equal(S.sourceClass("https://www.facebook.com/x"), "social"); assert.equal(S.sourceClass("https://www.propertyfinder.eg/x"), "listing");
  assert.equal(S.sourceClass("https://www.nuca.gov.eg/x"), "official"); assert.equal(S.sourceClass("https://dev.example-dev.com/x", { orgHosts: ["example-dev.com"] }), "organization");
  assert.equal(S.sourceClass("https://news.example-press.com/a", { pressHosts: ["example-press.com"] }), "press"); assert.equal(S.sourceClass("https://elsewhere.com/a"), "other");
});

/* ---------------- feeds and pages ---------------- */
test("feeds: RSS with CDATA and entities, and Atom; only http(s) links", () => {
  const items = S.parseFeed(rss([{ t: "A &amp; B", d: "&lt;p&gt;Text &#8211; here&lt;/p&gt;" }, { t: "Two", d: "x" }]));
  assert.equal(items.length, 2); assert.equal(items[0].title, "A & B"); assert.equal(items[0].text, "Text – here."); assert.equal(items[0].date, "2026-11-12");
  const atom = S.parseFeed(`<feed><entry><title>X</title><link href="https://a.com/1"/><updated>2026-11-10T00:00:00Z</updated><summary>S</summary></entry><entry><title>Bad</title><link href="javascript:alert(1)"/></entry></feed>`);
  assert.deepEqual(atom.map((i) => i.url), ["https://a.com/1"]);
});
test("page text: scripts, styles and menus removed", () => {
  const t = S.htmlText(`<html><head><style>p{}</style><script>evil()</script></head><body><nav>Home About</nav><p>First &amp; real.</p><p>Second line</p><footer>©</footer></body></html>`);
  assert.ok(t.includes("First & real.") && t.includes("Second line")); assert.ok(!/evil|Home About|©/.test(t));
});

/* ---------------- robots.txt and safe fetching ---------------- */
test("robots.txt: our group or *, longest rule wins, wildcards and $", () => {
  const txt = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/news\nDisallow: /*.pdf$\n";
  const r = S.robotsRules(txt);
  assert.equal(S.robotsAllows(r, "/news/1"), true); assert.equal(S.robotsAllows(r, "/private/x"), false); assert.equal(S.robotsAllows(r, "/private/news/2"), true);
  assert.equal(S.robotsAllows(r, "/a/file.pdf"), false); assert.equal(S.robotsAllows(r, "/a/file.pdf?x=1"), true);
  assert.equal(S.robotsAllows(S.robotsRules("User-agent: XFORCE-Research\nDisallow: /\nUser-agent: *\nAllow: /"), "/x"), false, "a group naming us comes first");
});
test("only public web addresses can be fetched", () => {
  for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.2/", "https://[::1]/", "http://intranet/", "https://a.local/x", "https://u:p@a.com/", "https://a.com:8443/", "ftp://a.com/", "javascript:alert(1)"]) assert.equal(publicUrl(u), null, u);
  assert.ok(publicUrl("https://www.example-dev.com/news#top")); assert.equal(publicUrl("https://www.example-dev.com/news#top").hash, "");
});
test("fetching obeys robots.txt, re-checks redirects, and stops at the size limit", async () => {
  const e = env();
  web({ "https://blocked.example-x.com/robots.txt": { body: "User-agent: *\nDisallow: /news" }, "https://blocked.example-x.com/news": "x" });
  await assert.rejects(fetchPublic(e, "https://blocked.example-x.com/news"), (x) => x instanceof FetchRefused && x.code === "robots");
  web({ "https://redir.example-x.com/a": { status: 302, headers: { location: "http://127.0.0.1/admin" } } });
  await assert.rejects(fetchPublic(e, "https://redir.example-x.com/a"), (x) => x.code === "unsafe");
  web({ "https://big.example-x.com/p": "A".repeat(300 * 1024) });
  const r = await fetchPublic(e, "https://big.example-x.com/p", { maxKb: 50 }); assert.equal(r.text.length, 50 * 1024);
  web({ "https://no.example-x.com/p": { status: 403, body: "no" } });
  await assert.rejects(fetchPublic(e, "https://no.example-x.com/p"), (x) => x.code === "blocked");
  const calls = web({ "https://ok.example-x.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://ok.example-x.com/a": "page", "https://ok.example-x.com/b": "page" });
  await fetchPublic(e, "https://ok.example-x.com/a"); await fetchPublic(e, "https://ok.example-x.com/b");
  assert.equal(calls.filter((c) => c.endsWith("/robots.txt")).length, 1, "robots.txt cached");
});

/* ---------------- feed job ---------------- */
const CFG = (over = {}) => Object.assign({ feeds: [{ id: "f1", url: "https://news.example-press.com/feed", label: "Example press", lang: "en", on: true, everyHours: 6 }], watch: [], stepsPerRun: 2 }, over);
test("switch off: nothing runs and nothing is fetched", async () => {
  const e = env(), calls = web({}); await put(e, "mix/sigcfg", CFG());
  assert.equal((await signalsRunNow(e)).ok, false); assert.deepEqual(await signalsTick(e), { off: true });
  assert.equal((await pasteLink(e, { url: "https://a.example-x.com/" }, "u1")).ok, false);
  assert.equal(calls.length, 0); assert.equal((await jobs(e)).length, 0);
});
test("feed: new items are triaged into signals once; seen items are not read again", async () => {
  const e = env(); await on(e); await put(e, "mix/sigcfg", CFG());
  web({ "https://news.example-press.com/feed": { body: rss([{ t: "Award", d: EN_AWARD }, { t: "Noise", d: EN_NOISE }]) } });
  const r = await signalsRunNow(e, 3);
  assert.equal(r.ok, true); assert.equal(r.ran[0].kind, "sig-feed"); assert.equal(r.ran[0].result.signals, 1);
  const s = await sigs(e); assert.equal(s.length, 1); assert.equal(s[0].quote, EN_AWARD); assert.equal(s[0].cls, "press"); assert.equal(s[0].origin, "feed"); assert.equal(s[0].status, "new");
  await put(e, "mix/sigcfg", CFG({ feeds: [Object.assign(CFG().feeds[0], { everyHours: 1 })] }));
  const r2 = await signalsTick(e, Date.now() + 2 * 3600e3);
  assert.equal(r2.ran[0].result.fresh, 0); assert.equal((await sigs(e)).length, 1);
});
test("feed: more than 10 new items are read over several steps", async () => {
  const e = env(); await on(e); await put(e, "mix/sigcfg", CFG({ stepsPerRun: 6 }));
  web({ "https://news.example-press.com/feed": { body: rss(Array.from({ length: 20 }, (_, i) => ({ t: "Item " + i, d: EN_NOISE }))) } });
  const r = await signalsRunNow(e, 6);
  assert.equal(r.ran[0].more, true); assert.equal(r.ran[0].result.read, 10); assert.equal(r.ran[1].result.read, 10);
});

/* ---------------- watch job ---------------- */
test("watched page: the first visit reads it; later visits read only new sentences", async () => {
  const e = env(); await on(e); const t = Date.now();
  await put(e, "mix/sigcfg", CFG({ feeds: [], watch: [{ id: "w1", org: "Example Developments", urls: ["https://www.example-dev.com/news"], on: true, everyDays: 1, leadId: "L-1" }] }));
  web({ "https://www.example-dev.com/news": `<html><body><p>${EN_NOISE}</p><p>${EN_AWARD}</p></body></html>` });
  const r = await signalsRunNow(e, 3, t); assert.equal(r.ran[0].result.signals, 1);
  const s = (await sigs(e))[0]; assert.equal(s.cls, "organization"); assert.equal(s.org, "Example Developments"); assert.equal(s.leadId, "L-1");
  const later = t + 2 * 864e5;
  const r2 = await signalsRunNow(e, 3, later); assert.equal(r2.ran[0].result.fresh, 0);
  web({ "https://www.example-dev.com/news": `<html><body><p>${EN_NOISE}</p><p>${EN_AWARD}</p><p>The compound's clubhouse and kids area will open in the first quarter of next year.</p></body></html>` });
  const r3 = await signalsRunNow(e, 3, later + 2 * 864e5); assert.equal(r3.ran[0].result.fresh, 1); assert.equal(r3.ran[0].result.signals, 1);
});
test("watched page refused by robots.txt: recorded as refused, not retried", async () => {
  const e = env(); await on(e);
  await put(e, "mix/sigcfg", CFG({ feeds: [], watch: [{ id: "w1", org: "X", urls: ["https://www.example-dev.com/news"], on: true }] }));
  web({ "https://www.example-dev.com/robots.txt": { body: "User-agent: *\nDisallow: /" } });
  const r = await signalsRunNow(e, 3); assert.match(r.ran[0].refused, /robots/);
  assert.equal((await jobs(e)).find((j) => j.kind === "sig-watch").status, "done");
});

/* ---------------- search job ---------------- */
test("searches: none unless a daily number is set; one per run; counted in the signals share; least recently searched first", async () => {
  const e = env(); await on(e); await put(e, "mix/sigcfg", CFG({ feeds: [] }));
  web({}); await signalsRunNow(e); assert.equal((await jobs(e)).filter((j) => j.kind === "sig-search").length, 0);
  await put(e, "mix/sigcfg", CFG({ feeds: [], searchesPerDay: 2, searchTypes: ["developer"], searchAreas: ["newcairo", "zayed"], searchLangs: ["en"] }));
  const queries = [];
  web({}, { tavily: (b) => { queries.push(b.query); return res(200, JSON.stringify({ results: [{ url: "https://news.example-press.com/z", title: "Compound", content: EN_AWARD, published_date: "2026-11-10" }], usage: { credits: 1 } })); } });
  const t = Date.now(), a = await signalsRunNow(e, 3, t), b = await signalsRunNow(e, 3, t + 3600e3), c = await signalsRunNow(e, 3, t + 7200e3);
  assert.equal(queries.length, 2, "the daily number is the limit"); assert.notEqual(queries[0], queries[1], "the other area goes next");
  assert.equal(a.ran[0].result.signals, 1); assert.equal(c.added.filter((x) => x.startsWith("search")).length, 0);
  assert.equal(await kv(e, streamKey("signals")), 2);
});

/* ---------------- AI reading ---------------- */
test("AI reading: values found in the signal's own text are kept, invented ones dropped", async () => {
  const e = env(); await on(e); await put(e, "mix/sigcfg", CFG());
  web({ "https://news.example-press.com/feed": { body: rss([{ t: "Award", d: EN_AWARD }]) } }, { gemini: () => res(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ n: 1, org: "Example Developments", project: "Invented Towers", place: "New Cairo" }]) }] }, finishReason: "STOP" }] })) });
  const r = await signalsRunNow(e, 3);
  const ai = r.ran.find((x) => x.kind === "sig-ai"); assert.ok(ai, JSON.stringify(r)); assert.deepEqual([ai.result.kept, ai.result.dropped], [2, 1]);
  const s = (await sigs(e))[0]; assert.equal(s.org, "Example Developments"); assert.equal(s.project, null); assert.equal(s.placeText, "New Cairo"); assert.deepEqual(s.ai.dropped, ["project"]);
});
test("AI reading without an AI key: skipped, the signals stay", async () => {
  const e = env({ GEMINI_API_KEY: "" }); await on(e); await put(e, "mix/sigcfg", CFG());
  web({ "https://news.example-press.com/feed": { body: rss([{ t: "Award", d: EN_AWARD }]) } });
  const r = await signalsRunNow(e, 3); const ai = r.ran.find((x) => x.kind === "sig-ai");
  assert.match(ai.result.skipped, /No AI provider/); assert.equal((await sigs(e)).length, 1);
});

/* ---------------- paste a link ---------------- */
test("paste a link: rule signals are found; a chosen sentence is saved only if the page has it", async () => {
  const e = env(); await on(e);
  web({ "https://news.example-press.com/p": `<html><head><title>Big news</title></head><body><p>${EN_AWARD}</p><p>The school will open its new campus with sports fields in September.</p></body></html>` });
  const a = await pasteLink(e, { url: "https://news.example-press.com/p" }, "u1"); assert.equal(a.ok, true); assert.equal(a.created, 2);
  const b = await pasteLink(e, { url: "https://news.example-press.com/p", quote: "A sentence that is not on the page at all.", type: "school" }, "u1"); assert.match(b.error, /not found/);
  const c = await pasteLink(e, { url: "https://news.example-press.com/p", quote: "The school will open its new campus", type: "" }, "u1"); assert.match(c.error, /kind/);
  const d = await pasteLink(e, { url: "https://news.example-press.com/p", quote: "The school will open its new campus", type: "school" }, "u1"); assert.equal(d.created, 1);
  assert.equal((await pasteLink(e, { url: "http://127.0.0.1/p" }, "u1")).ok, false);
});
test("feed test: reports items without saving anything", async () => {
  const e = env(); web({ "https://news.example-press.com/feed": { body: rss([{ t: "One", d: "x" }]) } });
  const r = await testFeed(e, "https://news.example-press.com/feed"); assert.equal(r.ok, true); assert.equal(r.items, 1); assert.equal((await sigs(e)).length, 0);
});

/* ---------------- the ledger is shared fairly ---------------- */
test("job ledger: each engine sees only its own kinds", async () => {
  const e = env(), t = Date.now();
  await addJob(e, { key: "sig-a", kind: "sig-feed", input: {} }, t - 5000); await addJob(e, { key: "en-a", kind: "enrich", input: {} }, t);
  assert.equal((await dueJobs(e, 1, t))[0].kind, "sig-feed", "without a filter: oldest of any kind (unchanged)");
  assert.equal((await dueJobs(e, 1, t, ["enrich"]))[0].kind, "enrich");
  assert.equal((await dueJobs(e, 5, t, ["sig-feed", "sig-ai"])).length, 1);
});
test("toSignals copies only public fields", () => {
  const s = toSignals({ title: "T", text: EN_AWARD, url: "https://a.example-x.com/1", date: "2026-11-01" }, { origin: "feed", cls: "press", cfg: null, t: Date.now() })[0];
  assert.deepEqual(Object.keys(s).sort(), ["ai", "cls", "foundAt", "host", "id", "lang", "matched", "org", "origin", "originId", "place", "project", "publishedAt", "quote", "status", "strength", "text", "title", "type", "url"].sort());
  assert.ok(s.text.length <= 1500);
});

/* ---------------- permissions ---------------- */
test("permissions: signals readable by staff, written by administrators; settings and page memory administrators only", () => {
  assert.equal(RULES.allowed("mi/sig/s/x", "read", "interact", "u1"), true); assert.equal(RULES.allowed("mi/sig/s/x", "write", "interact", "u1"), false);
  for (const p of ["mix/sigcfg", "mix/sigcfgv/v/1", "mix/sigpage/p/x"]) { assert.equal(RULES.allowed(p, "read", "interact", "u1"), false, p); assert.equal(RULES.allowed(p, "read", "admin", "u1"), true, p); }
});

/* ---------------- lessons from the first real pages (14 Nov 2026), kept as tests ---------------- */
test("real-page noise: school years, events at an existing clubhouse, and places abroad are not signals", () => {
  assert.deepEqual(S.triage({ title: "", text: "A new school year calls for new energy and plenty of fun for the children in the compound." }, null), []);
  assert.deepEqual(S.triage({ title: "", text: "Join the Ramadan sohour at the clubhouse of our compound this Friday evening." }, null), []);
  assert.equal(S.triage({ title: "", text: "The compound will include a clubhouse and a kids area for residents." }, null)[0].type, "facility");
  assert.deepEqual(S.triage({ title: "Egypt news", text: "Our Cairo team completed the roof works for the KAUST coral nursery school in Jeddah, Saudi Arabia." }, null), []);
});
test("real-page noise: script data and a script cut off by the size limit are not text", () => {
  const t = S.htmlText(`<p>The new school campus in New Cairo will open in September.</p><script>var a = {"id":1,"html":"\\u003cp\\u003eA new compound handover\\u003c/p\\u003e"}`);
  assert.ok(t.includes("New Cairo")); assert.ok(!/\\u003c|"id"/.test(t));
  assert.deepEqual(S.sentences(`{"id":10262,"date":"2026-10-26","slug":"new-compound-handover","title":"x"} and more json text here`), []);
});

test("search results must be in Egypt; feeds and company pages need not name it", () => {
  const us = { title: "National convention", text: "The new school campus in Indianapolis will open in September for the students." };
  assert.deepEqual(S.triage(us, null, 2, { requireEgypt: true }), []);
  assert.equal(S.triage(us, null, 2).length, 1, "without the search rule it would have counted");
  assert.equal(S.triage({ title: "", text: "The new school campus in New Cairo will open in September for the students." }, null, 2, { requireEgypt: true }).length, 1);
  assert.equal(S.triage({ title: "Egypt", text: "The new school campus will open in September for the students." }, null, 2, { requireEgypt: true }).length, 1);
});

test("real search noise: lists of existing schools and finished compounds are not signals", () => {
  assert.deepEqual(S.triage({ title: "", text: "10 Best British International Schools in Cairo, ranked for November in New Cairo." }, null), []);
  assert.deepEqual(S.triage({ title: "", text: "Lake View is a finished villa compound in New Cairo: 600 villas on about 300 feddans." }, null), []);
  assert.equal(S.triage({ title: "", text: "The developer acquired a 200 feddans land plot for a new compound in Sheikh Zayed." }, null)[0].type, "land");
  assert.equal(S.triage({ title: "", text: "The group plans an international school with a new campus in New Cairo." }, null)[0].type, "school");
});
