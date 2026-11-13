/* X FORCE Commercial Intelligence, Phase 0 — switch-off comparison, one side. Runs every research job and two lead-research steps on a
   fake database and fake providers, with a fixed clock and fixed random numbers, and prints everything they produced as JSON:
   each provider request (address and body), each saved document, each counter, each result. Run it on two checkouts and compare
   (for example with cmp; only the per-kind credit counters ru:tav:s:* are left out, by design). Made-up records only.
   Run:  node qa/ci_p0_switchoff.run.mjs <checkout root> <scenario>     scenario = off | engine */
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || "."), scenario = process.argv[3] || "off";
const T = Date.parse("2026-11-12T09:15:00Z"), RealDate = Date;
let tick = 0;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [T + tick])); } static now() { return T + tick; } };
let seed = 42; Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
globalThis.self = globalThis;
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { fakeD1 } = await imp("qa/fake-d1.mjs");
const { runJob } = await imp("worker/research.js");
const enrich = await imp("worker/enrich.js");

const requests = [];
const reply = (b) => new Response(JSON.stringify(b), { status: 200 });
const U = ["https://www.ahram.org.eg/news/new-cairo-kids-park", "https://dailynewsegypt.com/2026/11/10/school", "https://www.cbe.org.eg/en/rates", "https://www.example-dev.com.eg/contact-us"];
const ANSWERS = {
  opportunities: [{ title: "New Cairo compound with kids park", organization: "Example Developments", location: "New Cairo, Egypt", category: "compound", kind: "project", products: ["Outdoor playground"], sourceUrl: U[0], sourceType: "media", publishedAt: "2026-11-01" },
    { title: "مدرسة دولية جديدة في الشيخ زايد", organization: "مدارس النور", location: "الشيخ زايد", category: "school", kind: "project", products: [], sourceUrl: U[1], sourceType: "media" },
    { title: "Invented", organization: "X", location: "Cairo", category: "school", sourceUrl: "https://invented.example/x" }],
  news: [{ headline: "Freight rates", summary: "Rates rose", url: U[1], publishedAt: "2026-11-10", category: "shipping", impact: "medium" }],
  fx: [{ code: "USD", egpPer: 48.5, url: U[2], asOf: "2026-11-12" }, { code: "EUR", egpPer: 52.1, url: U[2], asOf: "2026-11-12" }],
  materials: [{ name: "Steel tube", price: 55000, unit: "ton", currency: "EGP", url: U[1], asOf: "2026-11-10" }],
  weekly: { summary: "A quiet week.", sources: [U[0]] },
};
let job = "opportunities";
globalThis.fetch = async (url, init) => {
  tick += 1000; const u = new URL(url), body = init && init.body ? JSON.parse(init.body) : null;
  requests.push({ host: u.host, path: u.pathname, body });
  if (u.host === "tavily.test" && u.pathname === "/extract") return reply({ results: (body.urls || []).map((x) => ({ url: x, raw_content: "Contact us: sales@example-dev.com.eg, phone 02 2345 6789. Our New Cairo compound has a kids park." })), usage: { credits: 1 } });
  if (u.host === "tavily.test") return reply({ results: U.map((x, i) => ({ url: x, title: "Example Developments result " + i, content: "Example Developments New Cairo project", score: 0.9 - i / 10, published_date: "2026-11-0" + (i + 1) })), usage: { credits: 1 } });
  if (u.host === "gemini.test") return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(job === "enrich" ? [{ project: "New Cairo compound", quote: "Example Developments New Cairo project", source: "S1" }] : ANSWERS[job]) }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 77 }, modelVersion: "gemini-test" });
  throw new Error("unexpected host " + u.host);
};
const env = { DB: fakeD1(), TAVILY_API_KEY: "tvly-test-not-a-real-key", GEMINI_API_KEY: "gem-test-not-a-real-key", TAVILY_BASE_URL: "https://tavily.test", GEMINI_BASE_URL: "https://gemini.test", TAVILY_TIMEOUT_MS: "300", GEMINI_TIMEOUT_MS: "300" };
const put = (p, d) => env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?)").bind(p, p.slice(0, p.lastIndexOf("/")), JSON.stringify(d), "2026-11-01T00:00:00.000Z").run();
await put("config/settings", { miEngine: scenario === "engine" });
await put("mix/mat/m/steel", { name: "Steel tube", grade: "S235", unit: "ton", history: [] });
await put("leads/L-test1", { name: "Example Developments", orgType: "developer", location: "New Cairo", status: "available", createdAt: "2026-10-01T00:00:00.000Z" });
await env.DB.prepare("INSERT INTO users (uid) VALUES ('u-admin')").run();

const results = [];
for (job of ["opportunities", "news", "fx", "materials", "weekly"]) results.push([job, await runJob(env, job)]);
if (scenario === "engine") {
  job = "enrich";
  results.push(["queue", await enrich.queueLeads(env, ["L-test1"], "u-admin")]);
  for (let i = 0; i < 8; i++) results.push(["step", await enrich.engineStep(env, "holder-" + i)]);
}
const all = (sql) => env.DB.raw.prepare(sql).all();
console.log(JSON.stringify({ requests, results, docs: all("SELECT path, data, v, at FROM docs ORDER BY path"),
  kv: all("SELECT k, v FROM kv ORDER BY k").filter((r) => !r.k.startsWith("ru:tav:s:")) }, null, 1));
