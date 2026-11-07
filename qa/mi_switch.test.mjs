/* X FORCE Market Intelligence 2.0, Phase 1: the switch in config/settings.miEngine, through a real research job (worker/research.js) on a
   fake database and fake providers. Made-up records only.  Run:  node --test qa/mi_switch.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./fake-d1.mjs";
import { runJob } from "../worker/research.js";

const realFetch = globalThis.fetch;
const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
const U1 = "https://www.ahram.org.eg/news/parking-screens", U2 = "https://www.ahram.org.eg/news/arabic-1", U3 = "https://www.ahram.org.eg/news/arabic-2";
const ANSWER = [
  { title: "Small perfect display screens for a parking garage", organization: "Test Screens Co", location: "Red Sea, Saudi Arabia", category: "developer", kind: "project", description: "Electricity capacity upgrade.", products: ["Soft play", "Water play"], sourceUrl: U1, sourceType: "media", publishedAt: new Date().toISOString().slice(0, 10) },
  { title: "مدرسة دولية جديدة في الشيخ زايد", organization: "مدارس النور", location: "الشيخ زايد", category: "school", kind: "project", products: [], sourceUrl: U2, sourceType: "media" },
  { title: "منتجع جديد في الساحل الشمالي", organization: "شركة البحر", location: "الساحل الشمالي", category: "resort", kind: "project", products: [], sourceUrl: U3, sourceType: "media" }];
function env() {
  globalThis.fetch = async (url) => new URL(url).host === "tavily.test"
    ? reply({ results: [U1, U2, U3].map((u, i) => ({ url: u, title: "t" + i, content: "c", score: 0.9, published_date: "2026-11-01" })), usage: { credits: 1 } })
    : reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(ANSWER) }] } }], usageMetadata: { totalTokenCount: 10 } });
  return { DB: fakeD1(), TAVILY_API_KEY: "tvly-test-not-a-real-key", GEMINI_API_KEY: "gem-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", GEMINI_BASE_URL: "https://gemini.test" };
}
const put = (e, p, d) => e.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?)").bind(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), "2026-11-01").run();
const saved = async (e) => ((await e.DB.prepare("SELECT data FROM docs WHERE parent = 'mi/opps/o'").all()).results).map((r) => JSON.parse(r.data));
test.afterEach(() => { globalThis.fetch = realFetch; });

for (const [name, settings] of [["no settings at all", null], ["the switch missing", { taxPct: 14 }], ["the switch off", { miEngine: false }], ["a value that isn't true", { miEngine: "yes" }]])
  test(`research with ${name} keeps the old rules`, async () => {
    const e = env(); if (settings) await put(e, "config/settings", settings);
    const r = await runJob(e, "opportunities"); assert.equal(r.ok, true, r.error);
    const o = await saved(e), p = o.find((x) => x.title.startsWith("Small"));
    assert.equal(p.priority, "high"); assert.equal(p.scoreVersion, undefined);
    assert.equal(o.length, 2, "the old Arabic id collision still loses one record while off");
  });

test("research with the switch on uses the new rules, and saves every Arabic record", async () => {
  const e = env(); await put(e, "config/settings", { miEngine: true });
  const r = await runJob(e, "opportunities"); assert.equal(r.ok, true, r.error);
  const o = await saved(e), p = o.find((x) => x.title.startsWith("Small"));
  assert.equal(p.scoreVersion, 2); assert.equal(p.priority, "low");
  assert.equal(o.length, 3, "nothing lost");
  assert.equal(r.created, 3);
});
test("records saved before the switch keep their score", async () => {
  const e = env(); await runJob(e, "opportunities");
  const before = (await saved(e)).find((x) => x.title.startsWith("Small"));
  await put(e, "config/settings", { miEngine: true }); await e.DB.prepare("DELETE FROM kv").run();
  await runJob(e, "opportunities");
  const after = (await saved(e)).find((x) => x.id === before.id);
  assert.equal(after.score, before.score); assert.equal(after.scoreVersion, undefined);
});
