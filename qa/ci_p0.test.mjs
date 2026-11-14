/* X FORCE Commercial Intelligence, Phase 0: AI router and data classes, switches, search credit shares, the Egypt gazetteer, timing.
   No network: every provider is a fake fetch. Made-up records only (this repository is public).
   Run:  node --test qa/ci_p0.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { aiJson, aiReady, aiTest, aiSwitch } from "../worker/ai.js";
import { reserveTavily, settleTavily, streamKey, streamUsage, CapError } from "../worker/usage.js";
import { ProviderError } from "../worker/providers.js";

globalThis.self = globalThis;
await import("../app/store.js");
await import("../app/miengine.js");
await import("../app/growth.js");
await import("../app/ci.js");
await import("../app/geo-eg.js");
const K = globalThis.DPCi, G = globalThis.DPGeo, RULES = globalThis.DPStore;

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });
const KEYS = { GEMINI_API_KEY: "gem-test-not-a-real-key", GEMINI_BASE_URL: "https://gemini.test", GEMINI_TIMEOUT_MS: "300", AI_TIMEOUT_MS: "300",
  ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key-000000", ANTHROPIC_BASE_URL: "https://claude.test", AI_COMPAT_API_KEY: "compat-test-key-0000", AI_COMPAT_BASE_URL: "https://compat.test/v1" };
const env = (extra = {}) => Object.assign({ DB: fakeD1() }, KEYS, extra);
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const gem = (v) => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(v) }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 50 }, modelVersion: "gemini-test" });
function fake(handlers = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url); calls.push({ host: u.host, path: u.pathname, body: JSON.parse(init.body), headers: init.headers });
    const h = handlers[u.host]; if (!h) throw new Error("unexpected host " + u.host); return h(JSON.parse(init.body));
  };
  return calls;
}
const put = (e, p, d) => e.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data").bind(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), new Date().toISOString()).run();
const docs = async (e, parent) => (await e.DB.prepare("SELECT data FROM docs WHERE parent = ?").bind(parent).all()).results.map((r) => JSON.parse(r.data));
const kv = async (e, k) => { const r = await e.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first(); return r ? Number(r.v) : 0; };
const switchOn = (e, flags) => put(e, "config/settings", { ci: flags });
const SECRET = "PRIVATE-PROMPT-TEXT-zx81";

/* ---------------- switches ---------------- */
test("switches are off unless set to true", () => {
  assert.deepEqual(K.flagsOf(undefined), { ai: false, envelopes: false, signals: false });
  assert.deepEqual(K.flagsOf({ ci: { ai: "yes", envelopes: 1 } }), { ai: false, envelopes: false, signals: false });
  assert.deepEqual(K.flagsOf({ ci: { ai: true } }), { ai: true, envelopes: false, signals: false });
});

/* ---------------- data classes and routing ---------------- */
test("data classes: personal data never goes anywhere; Gemini free gets public text only; paid P2 only when allowed", () => {
  const c = K.aicfgOf(null);
  assert.equal(K.classAllowed("gemini", "P0", c), true);
  for (const cls of ["P1", "P2", "P3"]) assert.equal(K.classAllowed("gemini", cls, c), false, cls);
  for (const p of Object.keys(K.PROVIDERS)) assert.equal(K.classAllowed(p, "P3", c), false, p);
  assert.equal(K.classAllowed("claude", "P2", c), false);
  assert.equal(K.classAllowed("claude", "P2", K.aicfgOf({ providers: { claude: { allowP2: true } } })), true);
  assert.equal(K.classAllowed("compat", "P1", c), false, "an unnamed provider gets public text only");
  assert.match(K.routeFor("extract", "P3", c).error, /never sent/);
});
test("routing: default is Gemini for public tasks; a switched-off or disallowed provider is skipped; fallback follows", () => {
  assert.deepEqual(K.routeFor("extract", "P0", null).plan, [{ provider: "gemini", model: "" }]);
  assert.match(K.routeFor("reason", "P1", null).error, /No switched-on/);
  const cfg = { tasks: { extract: { provider: "compat", fallback: "gemini" }, reason: { provider: "gemini", fallback: "workersai" } }, providers: { compat: { on: true, model: "m1" }, workersai: { on: true, model: "w1" } } };
  assert.deepEqual(K.routeFor("extract", "P0", cfg).plan.map((p) => p.provider), ["compat", "gemini"]);
  assert.deepEqual(K.routeFor("reason", "P1", cfg).plan, [{ provider: "workersai", model: "w1" }], "Gemini is skipped for P1");
  const off = Object.assign({}, cfg, { providers: { compat: { on: false, model: "m1" } } });
  assert.deepEqual(K.routeFor("extract", "P0", off).plan.map((p) => p.provider), ["gemini"]);
  assert.match(K.routeFor("nope", "P0", null).error, /Unknown AI task/);
  const bad = K.aicfgOf({ tasks: { extract: { provider: "evil" } }, providers: { gemini: { model: "x<script>" }, claude: { dailyCalls: -5 } } });
  assert.equal(bad.tasks.extract.provider, "gemini"); assert.equal(bad.providers.gemini.model, "xscript"); assert.equal(bad.providers.claude.dailyCalls, 0);
});

/* ---------------- the router: switch off = the old Gemini call ---------------- */
test("switch off: the request Gemini receives is exactly geminiJson's; nothing is logged", async () => {
  const e = env(), calls = fake({ "gemini.test": () => gem([{ a: 1 }]) });
  assert.equal(await aiSwitch(e), false);
  const a = await aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: SECRET });
  const { geminiJson } = await import("../worker/providers.js"); await geminiJson(e, { system: "S", prompt: SECRET });
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].body, calls[1].body); assert.equal(calls[0].path, calls[1].path);
  assert.equal(a.text, '[{"a":1}]'); assert.equal(a.provider, "gemini");
  assert.equal((await docs(e, "mix/ailog/l")).length, 0);
  assert.equal(await aiReady(e, "extract"), true); assert.equal(await aiReady(env({ GEMINI_API_KEY: "" }), "extract"), false);
});
test("switch off: anything but public data is refused before any call", async () => {
  const e = env(), calls = fake({ "gemini.test": () => gem([]) });
  await assert.rejects(aiJson(e, { task: "reason", cls: "P1", system: "S", prompt: "p" }), /Only public data/);
  await assert.rejects(aiJson(e, { task: "bogus", cls: "P0", system: "S", prompt: "p" }), /Unknown AI task/);
  assert.equal(calls.length, 0);
});

/* ---------------- the router: switch on ---------------- */
test("switch on: routes to the chosen provider, counts its cap, logs without text", async () => {
  const e = env(); await switchOn(e, { ai: true });
  await put(e, "mix/aicfg", { tasks: { extract: { provider: "compat", fallback: "gemini" } }, providers: { compat: { on: true, model: "small-1", dailyCalls: 2 } } });
  const calls = fake({ "compat.test": () => reply(200, { model: "small-1", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { total_tokens: 9 } }) });
  const a = await aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: SECRET });
  assert.equal(a.provider, "compat"); assert.equal(a.text, '{"ok":true}'); assert.equal(a.tokens, 9);
  assert.equal(calls[0].path, "/v1/chat/completions"); assert.equal(calls[0].body.model, "small-1"); assert.equal(calls[0].headers.authorization, "Bearer " + KEYS.AI_COMPAT_API_KEY);
  assert.equal(await kv(e, `ru:ai:compat:d:${new Date().toISOString().slice(0, 10)}`), 1);
  const log = await docs(e, "mix/ailog/l");
  assert.equal(log.length, 1); assert.equal(log[0].provider, "compat"); assert.equal(log[0].ok, true);
  assert.ok(!JSON.stringify(log).includes(SECRET), "prompt text is never logged");
});
test("switch on: cap reached or provider down → the fallback answers; each attempt is logged", async () => {
  const e = env(); await switchOn(e, { ai: true });
  await put(e, "mix/aicfg", { tasks: { extract: { provider: "compat", fallback: "gemini" } }, providers: { compat: { on: true, model: "small-1", dailyCalls: 0 } } });
  const calls = fake({ "gemini.test": () => gem({ ok: 1 }), "compat.test": () => reply(500, { error: "down" }) });
  const a = await aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: "p" });
  assert.equal(a.provider, "gemini"); assert.equal(calls.filter((c) => c.host === "compat.test").length, 0, "a zero cap means no call at all");
  await put(e, "mix/aicfg", { tasks: { extract: { provider: "compat", fallback: "gemini" } }, providers: { compat: { on: true, model: "small-1", dailyCalls: 5 } } });
  const b = await aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: "p" });
  assert.equal(b.provider, "gemini");
  assert.equal(await kv(e, `ru:ai:compat:d:${new Date().toISOString().slice(0, 10)}`), 0, "a failed call gives its cap back");
  const log = await docs(e, "mix/ailog/l");
  assert.deepEqual(log.map((l) => [l.provider, l.ok]).sort(), [["compat", false], ["compat", false], ["gemini", true], ["gemini", true]]);
});
test("switch on: no fallback after a fault of the request itself; personal data refused and logged", async () => {
  const e = env(); await switchOn(e, { ai: true });
  await put(e, "mix/aicfg", { tasks: { extract: { provider: "compat", fallback: "gemini" } }, providers: { compat: { on: true, model: "m", dailyCalls: 5 } } });
  const calls = fake({ "compat.test": () => reply(400, { error: { message: "bad" } }), "gemini.test": () => gem([]) });
  await assert.rejects(aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: "p" }), (x) => x instanceof ProviderError && x.code === "bad_request");
  assert.equal(calls.filter((c) => c.host === "gemini.test").length, 0);
  await assert.rejects(aiJson(e, { task: "extract", cls: "P3", system: "S", prompt: "p" }), /never sent/);
  assert.ok((await docs(e, "mix/ailog/l")).some((l) => l.code === "refused"));
});
test("switch on: a provider cap error is a CapError the jobs treat as waiting", async () => {
  const e = env({ GEMINI_API_KEY: "" }); await switchOn(e, { ai: true });
  await put(e, "mix/aicfg", { tasks: { extract: { provider: "compat", fallback: "" } }, providers: { compat: { on: true, model: "m", dailyCalls: 0 } } });
  fake({});
  await assert.rejects(aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: "p" }), (x) => x instanceof CapError);
});
test("Claude and Workers AI adapters read their answers", async () => {
  const e = env(); await switchOn(e, { ai: true });
  await put(e, "mix/aicfg", { tasks: { extract: { provider: "claude" }, reason: { provider: "workersai" } }, providers: { claude: { on: true, model: "claude-test", dailyCalls: 3 }, workersai: { on: true, model: "@cf/test", dailyCalls: 3 } } });
  const calls = fake({ "claude.test": () => reply(200, { model: "claude-test", content: [{ type: "text", text: '{"x":1}' }], stop_reason: "end_turn", usage: { input_tokens: 4, output_tokens: 3 } }) });
  const a = await aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: "p" });
  assert.equal(a.text, '{"x":1}'); assert.equal(a.tokens, 7); assert.equal(calls[0].path, "/v1/messages"); assert.equal(calls[0].headers["x-api-key"], KEYS.ANTHROPIC_API_KEY);
  let seen = null; e.AI = { run: async (m, inp) => { seen = { m, inp }; return { response: { y: 2 }, usage: { total_tokens: 11 } }; } };
  const b = await aiJson(e, { task: "reason", cls: "P1", system: "S", prompt: "p" });
  assert.equal(b.provider, "workersai"); assert.equal(b.text, '{"y":2}'); assert.equal(seen.m, "@cf/test");
});
test("old log lines are removed after 90 days", async () => {
  const e = env(); await switchOn(e, { ai: true }); fake({ "gemini.test": () => gem([]) });
  await e.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES ('mix/ailog/l/old1', 'mix/ailog/l', '{}', 1, '2020-01-01T00:00:00.000Z')").run();
  await aiJson(e, { task: "extract", cls: "P0", system: "S", prompt: "p" });
  const paths = (await e.DB.prepare("SELECT path FROM docs WHERE parent = 'mix/ailog/l'").all()).results.map((r) => r.path);
  assert.equal(paths.length, 1); assert.ok(!paths.includes("mix/ailog/l/old1"));
});
test("provider test: fixed public prompt, refused when not connected", async () => {
  const e = env({ AI_COMPAT_API_KEY: "" }); fake({ "gemini.test": (b) => { assert.match(b.contents[0].parts[0].text, /Answer exactly/); return gem({ ok: true }); } });
  assert.equal((await aiTest(e, "gemini")).ok, true);
  assert.match((await aiTest(e, "compat")).message, /not connected/);
  assert.equal((await aiTest(e, "nothing")).ok, false);
});

/* ---------------- search credit shares ---------------- */
test("streams: use is always counted; a share limits only with the switch on", async () => {
  const e = env(), sk = streamKey("leads");
  const r = await reserveTavily(e, 2, "leads"); await settleTavily(e, r, 1);
  assert.equal(await kv(e, sk), 1, "settled to what was spent");
  await put(e, "mix/enginecfg", { envelopes: { leads: 2 } });
  await reserveTavily(e, 2, "leads");   // switch off: the share is not applied
  assert.equal(await kv(e, sk), 3);
  await switchOn(e, { envelopes: true });
  await assert.rejects(reserveTavily(e, 1, "leads"), (x) => x instanceof CapError && /month/.test(x.code));
  assert.equal(await kv(e, sk), 3, "a refused reservation adds nothing");
  await reserveTavily(e, 1, "jobs");    // no share for jobs: only the ordinary caps
  assert.deepEqual(await streamUsage(e), { jobs: 1, leads: 3, topic: 0, signals: 0 });
  const plain = await reserveTavily(e, 1); assert.equal(plain.streamKey, undefined, "a call without a stream works as before");
});
test("streams: when the daily cap refuses, the stream counter is given back", async () => {
  const e = env({ TAVILY_DAILY_CREDITS: "1" });
  await assert.rejects(reserveTavily(e, 2, "topic"), (x) => x.code === "tavily_day");
  assert.equal(await kv(e, streamKey("topic")), 0);
});
test("share validation", () => {
  assert.equal(K.validateEnvelopes({ jobs: 100, leads: null, topic: "" }, 900), null);
  assert.match(K.validateEnvelopes({ jobs: 600, leads: 400 }, 900), /more than the monthly cap/);
  assert.match(K.validateEnvelopes({ jobs: -1 }, 900), /whole number/);
  assert.deepEqual(K.envelopesOf({ envelopes: { jobs: "50", leads: "x" } }), { jobs: 50, leads: null, topic: null, signals: null });
});

/* ---------------- gazetteer ---------------- */
test("gazetteer: areas, governorates, Arabic, and places outside Egypt", () => {
  const L = (t) => G.locate(t);
  assert.deepEqual([L("Sidi Abdel Rahman, North Coast").precision, L("Sidi Abdel Rahman, North Coast").area], ["area", "sidiabdelrahman"]);
  assert.equal(L("التجمع الخامس").area, "newcairo");
  assert.equal(L("مشروع بالساحل الشمالي").area, "northcoast");
  assert.equal(L("مشروع في العين السخنة").gov, "suez");
  assert.equal(L("Giza").precision, "governorate");
  assert.equal(L("الإسكندرية").gov, "alexandria");
  assert.equal(L("Red Sea, Saudi Arabia").precision, "foreign");
  assert.equal(L("Riyadh").precision, "foreign");
  assert.equal(L("Alexandria, Virginia").precision, "foreign");
  assert.equal(L("Red Sea").precision, "unknown", "Red Sea alone may be Saudi");
  assert.equal(L("Red Sea Governorate, Egypt").gov, "redsea");
  assert.equal(L("Launched on 6 October 2026").precision, "unknown", "a date is not 6th of October City");
  assert.equal(L("6th of October City").area, "october");
  assert.equal(L("").precision, "unknown");
  assert.equal(G.GOVS.length, 27);
  for (const a of G.AREAS) assert.ok(G.GOVS.some((g) => g.key === a.gov), a.key);
  for (const p of G.GOVS.concat(G.AREAS)) assert.ok(p.lat > 22 && p.lat < 32 && p.lng > 24.5 && p.lng < 37, "inside Egypt's box: " + p.key);
});

/* ---------------- stages and timing ---------------- */
test("stages: the two new ones exist; customer types match the Growth Center", () => {
  assert.equal(K.stageOf("finishing"), "finishing"); assert.equal(K.stageOf("Pre-opening"), "preopening"); assert.equal(K.stageOf("whatever"), "unknown");
  assert.deepEqual(K.CUSTOMER_TYPES.map((c) => c[0]).sort(), Object.keys(globalThis.DPGrowth.SEGMENTS).sort());
});
test("timing: blank by default, and the result says what is missing", () => {
  const T = K.timingOf({});
  assert.ok(Object.values(T.leadTimes).every((v) => v === null) && T.safetyDays === null && T.periodEnd === null);
  const r = K.approachBy({ category: "playground", customerType: "developer", stage: "construction" }, {}, "2026-11-13");
  assert.equal(r.window, "unknown"); assert.equal(r.approachBy, null); assert.equal(r.missing.length, 4);
});
const CFG = { leadTimes: { playground: 60 }, safetyDays: 14, salesCycle: { developer: 150, school: 90 }, stageOpening: { construction: 300 }, periodEnd: "2027-04-30" };
test("timing: a published opening gives the dates and window", () => {
  const r = K.approachBy({ opening: "2027-07-01", category: "playground", customerType: "school" }, CFG, "2026-11-13");
  assert.equal(r.latestOrder, "2027-04-18"); assert.equal(r.approachBy, "2027-01-18"); assert.equal(r.window, "open"); assert.equal(r.openingBasis, "published");
  assert.equal(r.fitsPeriod, true);
  assert.equal(K.approachBy({ opening: "2027-07-01", category: "playground", customerType: "school" }, CFG, "2026-09-01").window, "early");
  assert.equal(K.approachBy({ opening: "2027-07-01", category: "playground", customerType: "school" }, CFG, "2027-02-01").window, "lastcall");
  assert.equal(K.approachBy({ opening: "2027-07-01", category: "playground", customerType: "school" }, CFG, "2027-05-01").window, "closed");
  assert.equal(K.approachBy({ opening: "2027-07-01", category: "playground", customerType: "developer" }, CFG, "2026-12-15").fitsPeriod, false);
});
test("timing: without an opening date the stage gives an estimate, marked as such", () => {
  const r = K.approachBy({ stage: "construction", stageSince: "2026-10-01", category: "playground", customerType: "developer" }, CFG, "2026-11-13");
  assert.equal(r.openingBasis, "estimate"); assert.equal(r.opening, "2027-07-28"); assert.match(r.basis.join(" "), /Estimate/);
  assert.equal(K.approachBy({ stage: "design", category: "playground", customerType: "developer" }, CFG, "2026-11-13").window, "unknown");
});
test("timing validation", () => {
  assert.equal(K.validateTiming({ leadTimes: { playground: 60, school: null }, safetyDays: "", periodEnd: "2027-04-30" }), null);
  assert.match(K.validateTiming({ leadTimes: { playground: -3 } }), /Lead time/);
  assert.match(K.validateTiming({ salesCycle: { school: 1.5 } }), /Sales cycle/);
  assert.match(K.validateTiming({ periodEnd: "2027-02-30" }), /period end/);
});

/* ---------------- permissions ---------------- */
test("permissions: AI settings and the call log are administrators only", () => {
  for (const p of ["mix/aicfg", "mix/aicfgv/v/1", "mix/ailog/l/x"]) {
    assert.equal(RULES.allowed(p, "read", "admin", "u1"), true, p);
    assert.equal(RULES.allowed(p, "read", "interact", "u1"), false, p);
    assert.equal(RULES.allowed(p, "write", "interact", "u1"), false, p);
  }
});
