/* X FORCE 2.1 — Market Research on a topic an administrator types (the free providers: Tavily search now, Gemini in 2.1 S3).
   One document per research: mix/topic/t/<id> (administrators only — app/store.js RULES "mix"). It holds the request,
   its real progress and the sources found; the report is added to the same document by the analysis stage.

   The page moves a research forward one REAL step per call (POST /api/research/topic/step):
     queued → searching (one Tavily search per step, "2 of 5") → collecting (page texts, Standard/Deep only) → sources_ready
   A step that hits a cap or Tavily's free quota leaves the research "waiting" with the reason; nothing is skipped or paid.
   Only what Tavily returned is kept: every source URL comes from Tavily, never from AI text. */
import { tavilySearch, tavilyExtract, ProviderError } from "./providers.js";
import { reserveTavily, settleTavily, reserveReport, CapError } from "./usage.js";
import { nu } from "./research.js";

export const MARKETS = {
  egypt: { label: "Egypt", words: "Egypt", country: "egypt" },
  gcc: { label: "Gulf (Saudi Arabia, UAE, Qatar, Kuwait, Oman, Bahrain)", words: "Saudi Arabia UAE Qatar", country: null },
  libya: { label: "Libya", words: "Libya", country: null },
  mena: { label: "Middle East & North Africa", words: "Middle East North Africa", country: null },
  intl: { label: "International", words: "", country: null },
};
export const DEPTHS = {
  quick: { label: "Quick", queries: 3, search: "basic", maxResults: 5, extract: 0 },
  standard: { label: "Standard", queries: 5, search: "basic", maxResults: 6, extract: 5 },
  deep: { label: "Deep", queries: 6, search: "advanced", maxResults: 8, extract: 10 },
};
const MAX_TRIES = 3, LEASE_MS = 3 * 60e3, SNIPPET = 1500, PAGE = 6000, MAX_SOURCES = 40;
const nowIso = () => new Date().toISOString();
const parentOf = (p) => p.slice(0, p.lastIndexOf("/"));
const hostOf = (u) => { const m = /^https?:\/\/(?:www\.)?([^/:?#]+)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; };

/** Cleans what was typed: one line, no control characters, 3–200 characters. Returns null when unusable. */
export function cleanTopic(s) {
  const t = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return t.length >= 3 ? t : null;
}
/** The searches for one research. Fixed templates (no AI), so the plan and its credit cost are known before anything runs. */
export function planQueries(topic, market, depth, year = new Date().getUTCFullYear()) {
  const m = MARKETS[market] || MARKETS.egypt, d = DEPTHS[depth] || DEPTHS.quick, w = m.words ? " " + m.words : "";
  const all = [
    { q: `${topic}${w}` },
    { q: `${topic}${w} new project ${year}` },
    { q: `${topic}${w}`, topic: "news", timeRange: "year" },
    { q: `${topic}${w} companies suppliers developers` },
    { q: `${topic}${w} tender contract awarded` },
    { q: `${topic}${w} market trends ${year}` },
  ];
  return all.slice(0, d.queries).map((x) => ({ q: x.q.slice(0, 380), topic: x.topic || "general", timeRange: x.timeRange || null, country: m.country,
    depth: d.search, maxResults: d.maxResults, status: "pending", tries: 0, found: 0, credits: 0, error: null }));
}
/** Upper bound of Tavily credits a research can use (shown before it starts). */
export function creditEstimate(depth) { const d = DEPTHS[depth] || DEPTHS.quick, per = d.search === "advanced" ? 2 : 1; return d.queries * per + Math.ceil(d.extract / 5); }   // pages are read with basic extraction

/* ---------------- D1 ---------------- */
const pathOf = (id) => `mix/topic/t/${id}`;
async function load(env, id) { const r = await env.DB.prepare("SELECT data, v FROM docs WHERE path = ?").bind(pathOf(id)).first(); return r ? { d: JSON.parse(r.data), v: r.v } : null; }
const save = (env, id, d) => env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, v = docs.v + 1, at = excluded.at")
  .bind(pathOf(id), parentOf(pathOf(id)), JSON.stringify(d), nowIso()).run();
async function lease(env, id, holder) {
  const t = Date.now(), k = "research:topic:" + id;
  await env.DB.prepare("DELETE FROM leases WHERE path = ? AND exp < ?").bind(k, t).run();
  return !!(await env.DB.prepare("INSERT INTO leases (path, holder, exp) VALUES (?, ?, ?) ON CONFLICT(path) DO NOTHING RETURNING holder").bind(k, holder, t + LEASE_MS).first());
}
const unlease = (env, id, holder) => env.DB.prepare("DELETE FROM leases WHERE path = ? AND holder = ?").bind("research:topic:" + id, holder).run();

/** What the page shows. Only real counts — no percentage. */
export function progressOf(d) {
  const qs = d.plan.queries, done = qs.filter((q) => q.status !== "pending").length;
  return { id: d.id, stage: d.stage, topic: d.topic, market: d.market, depth: d.depth, searchesDone: done, searchesTotal: qs.length,
    sources: d.sources.length, pagesRead: d.sources.filter((s) => s.page).length, credits: d.usage.tavilyCredits, waiting: d.waiting || null, error: d.error || null, notes: (d.notes || []).slice(-8) };
}

/** Start a research (administrators only — checked by the route). Counts against the report caps. */
export async function createTopic(env, uid, input) {
  const topic = cleanTopic(input && input.topic);
  if (!topic) return { ok: false, error: "Type a research topic (at least 3 characters)." };
  const market = MARKETS[input.market] ? input.market : "egypt", depth = DEPTHS[input.depth] ? input.depth : "quick";
  try { await reserveReport(env, uid); } catch (e) { if (e.cap) return { ok: false, code: e.code, error: e.message }; throw e; }
  const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const d = { id, kind: "topic", topic, market, marketLabel: MARKETS[market].label, depth, by: uid, at: nowIso(), updatedAt: nowIso(), stage: "queued",
    plan: { queries: planQueries(topic, market, depth), extract: DEPTHS[depth].extract, creditEstimate: creditEstimate(depth) },
    sources: [], usage: { tavilySearches: 0, tavilyCredits: 0, pagesRead: 0 }, notes: [], error: null, waiting: null };
  await save(env, id, d);
  return { ok: true, progress: progressOf(d) };
}

function mergeResults(d, qi, results) {
  const byKey = new Map(d.sources.map((s) => [nu(s.url), s])); let fresh = 0;
  for (const r of results) {
    const k = nu(r.url); if (!k) continue;
    const s = byKey.get(k);
    if (s) { if (!s.fromQueries.includes(qi)) s.fromQueries.push(qi); s.score = Math.max(s.score, r.score); if (!s.publishedAt && r.publishedAt) s.publishedAt = r.publishedAt; continue; }
    if (d.sources.length >= MAX_SOURCES) break;
    const n = { id: "S" + (d.sources.length + 1), url: r.url, host: hostOf(r.url), title: r.title, snippet: String(r.content || "").slice(0, SNIPPET), publishedAt: r.publishedAt || null, score: r.score, fromQueries: [qi], page: null };
    d.sources.push(n); byKey.set(k, n); fresh++;
  }
  return fresh;
}

/** Move one research forward by one real step. Returns {ok, progress, busy?}. */
export async function stepTopic(env, id) {
  if (!/^t[a-z0-9]{4,30}$/.test(String(id || ""))) return { ok: false, error: "Research id missing." };
  const holder = Math.random().toString(36).slice(2);
  if (!(await lease(env, id, holder))) return { ok: false, busy: true, error: "This research is already taking a step — try again in a moment." };
  try {
    const cur = await load(env, id); if (!cur) return { ok: false, error: "Research not found." };
    const d = cur.d;
    if (!["queued", "searching", "collecting", "waiting"].includes(d.stage)) return { ok: true, progress: progressOf(d) };
    d.waiting = null; d.updatedAt = nowIso();
    const q = d.plan.queries.find((x) => x.status === "pending");
    if (q) await searchStep(env, d, q);
    else if (d.plan.extract > 0 && !d.extractDone && d.sources.length) await collectStep(env, d);
    if (!d.waiting && !d.plan.queries.some((x) => x.status === "pending") && (d.extractDone || !d.plan.extract || !d.sources.length)) {
      if (d.plan.queries.every((x) => x.status === "failed")) { d.stage = "failed"; d.error = d.error || "Every search failed — see the notes."; }
      else { d.stage = "sources_ready"; if (!d.sources.length) d.notes.push("No sources were found for this topic and market."); }
    } else if (d.waiting) d.stage = "waiting";
    await save(env, id, d);
    return { ok: true, progress: progressOf(d) };
  } finally { await unlease(env, id, holder); }
}

/** A cap, Tavily's quota, or a temporary error: wait (with the reason). A refused key or bad request: that search fails. */
function onError(d, e, q) {
  if (e instanceof CapError || (e instanceof ProviderError && (e.code === "quota" || e.code === "not_configured"))) { d.waiting = { code: e.code, reason: e.message, at: nowIso() }; return; }
  if (e instanceof ProviderError && e.retry && q && q.tries < MAX_TRIES) { d.waiting = { code: e.code, reason: e.message + " It will be tried again.", at: nowIso() }; return; }
  if (q) { q.status = "failed"; q.error = String(e.message || e).slice(0, 200); }
  d.notes.push(String(e.message || e).slice(0, 200));
  if (e instanceof ProviderError && e.code === "auth") d.error = e.message;
}

async function searchStep(env, d, q) {
  d.stage = "searching"; q.tries++;
  const est = q.depth === "advanced" ? 2 : 1; let res;
  try { res = await reserveTavily(env, est, "topic"); } catch (e) { q.tries--; return onError(d, e, null); }
  let spent = 0;
  try {
    const r = await tavilySearch(env, { query: q.q, depth: q.depth, topic: q.topic, timeRange: q.timeRange, country: q.country, maxResults: q.maxResults });
    spent = r.credits; q.status = "done"; q.credits = r.credits; q.found = mergeResults(d, d.plan.queries.indexOf(q), r.results);
    d.usage.tavilySearches++; d.usage.tavilyCredits += r.credits;
  } catch (e) { onError(d, e, q); }
  finally { await settleTavily(env, res, spent); }
}

async function collectStep(env, d) {
  d.stage = "collecting";
  const pick = d.sources.filter((s) => !s.page).sort((a, b) => b.score - a.score).slice(0, d.plan.extract);
  const est = Math.ceil(pick.length / 5); let res;   // basic extraction (1 credit per 5 pages) for Standard and Deep
  try { res = await reserveTavily(env, est, "topic"); } catch (e) { return onError(d, e, null); }
  d.extractTries = (d.extractTries || 0) + 1;
  let spent = 0;
  try {
    const r = await tavilyExtract(env, pick.map((s) => s.url), { depth: "basic", maxChars: PAGE });
    spent = r.credits; const byKey = new Map(r.results.map((x) => [nu(x.url), x.content]));
    for (const s of pick) { const t = byKey.get(nu(s.url)); if (t) { s.page = t; d.usage.pagesRead++; } }
    d.usage.tavilyCredits += r.credits; d.extractDone = true;
    if (r.failed.length) d.notes.push(`${r.failed.length} page(s) could not be read; their search snippets are used instead.`);
  } catch (e) {
    if (e instanceof ProviderError && (e.code === "quota" || e.code === "not_configured")) onError(d, e, null);
    else if (e instanceof ProviderError && e.retry && d.extractTries < MAX_TRIES) d.waiting = { code: e.code, reason: e.message + " It will be tried again.", at: nowIso() };
    else { d.extractDone = true; d.notes.push("Page texts could not be read (" + String(e.message || e).slice(0, 150) + "); the search snippets are used instead."); }
  } finally { await settleTavily(env, res, spent); }
}
