/* X FORCE 2.1 — free research providers, called only from this Worker (the keys never reach the browser).
   Tavily (web search + page extraction): docs.tavily.com — free "Researcher" plan = 1,000 credits a month.
     basic search 1 credit · advanced search 2 · extract 1 credit per 5 pages (basic) or 2 (advanced) · failed pages are free.
     432 = the plan's monthly credits are used up · 433 = the pay-as-you-go limit · 429 = too many requests (Retry-After).
   Every call: a timeout, one retry for temporary errors (so a request is never held open long) (following Retry-After, never longer than RETRY_MAX_MS),
   and the credits Tavily reports (include_usage) so worker/usage.js can count them. Quota errors are never retried.

   Settings (Cloudflare → the Worker → Settings → Variables and Secrets):
     TAVILY_API_KEY     secret — a free key from app.tavily.com (leave pay-as-you-go OFF there)
     TAVILY_BASE_URL    optional, for tests only
     TAVILY_KEYLESS     optional, "1" = Tavily's rate-limited keyless mode, for local tests only (search + extract)
     TAVILY_TIMEOUT_MS  optional, per-call timeout (default 20000 for search, 30000 for extract) */

const RETRY_MAX_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

export class ProviderError extends Error {
  /** code: auth | quota | rate_limited | timeout | bad_request | server | network | not_configured */
  constructor(provider, code, message, extra = {}) { super(message); Object.assign(this, { provider, code, retry: ["rate_limited", "timeout", "server", "network"].includes(code) }, extra); }
}

/** fetch → JSON with a timeout and bounded retries. `name` is the provider shown in messages. */
export async function callJson(url, init, { name, timeoutMs = 20000, retries = 2, describe = defaultDescribe } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    let r, txt;
    try { r = await fetch(url, Object.assign({}, init, { signal: ac.signal })); txt = await r.text(); }
    catch (e) {
      last = ac.signal.aborted ? new ProviderError(name, "timeout", `${name} did not answer within ${Math.round(timeoutMs / 1000)} s.`)
        : new ProviderError(name, "network", `${name} could not be reached (${clip(e && e.message, 120)}).`);
    } finally { clearTimeout(t); }
    if (r) {
      let j = null; try { j = JSON.parse(txt); } catch (e) {}
      if (r.ok) { if (j == null) throw new ProviderError(name, "server", `${name} sent an answer that is not JSON.`); return j; }
      last = describe(name, r.status, j, txt, r.headers);
    }
    if (!last.retry || attempt === retries) break;
    const ra = last.retryAfterMs != null ? last.retryAfterMs : 1000 * 2 ** attempt;
    if (ra > RETRY_MAX_MS) break;              // a long wait: report it instead of holding the request open
    await sleep(ra);
  }
  throw last;
}

function retryAfterMs(headers) {
  const v = headers && headers.get && headers.get("retry-after"); if (!v) return null;
  const s = Number(v); if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(v); return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
}
function errText(j, txt) {
  const d = j && (j.detail != null ? j.detail : j.error);
  const m = d && typeof d === "object" && !Array.isArray(d) ? d.error || d.message : Array.isArray(d) ? d.map((x) => x && x.msg).filter(Boolean).join("; ") : d;
  return clip(m || txt, 200);
}
function defaultDescribe(name, status, j, txt, headers) {
  const msg = errText(j, txt), ra = retryAfterMs(headers);
  if (status === 401 || status === 403) return new ProviderError(name, "auth", `${name} refused the API key (${status}). Check the key in Cloudflare.`, { status });
  if (status === 429) return new ProviderError(name, "rate_limited", `${name} rate limit reached — try again in a minute.`, { status, retryAfterMs: ra });
  if (status >= 500) return new ProviderError(name, "server", `${name} had a temporary problem (${status}).`, { status, retryAfterMs: ra });
  return new ProviderError(name, "bad_request", `${name} rejected the request (${status}): ${msg}`, { status });
}

/* ======================= Tavily ======================= */
export const tavilyConfigured = (env) => !!(env.TAVILY_API_KEY && String(env.TAVILY_API_KEY).length > 10) || String(env.TAVILY_KEYLESS || "") === "1";
const tavilyBase = (env) => String(env.TAVILY_BASE_URL || "https://api.tavily.com").replace(/\/+$/, "");
const tavilyTimeout = (env, d) => { const x = parseInt(env.TAVILY_TIMEOUT_MS, 10); return Number.isFinite(x) && x >= 100 ? Math.min(x, 60000) : d; };
function tavilyHeaders(env) {
  const h = { "content-type": "application/json" };
  if (env.TAVILY_API_KEY) h.authorization = "Bearer " + env.TAVILY_API_KEY;
  else if (String(env.TAVILY_KEYLESS || "") === "1") h["X-Tavily-Access-Mode"] = "keyless";
  return h;
}
function tavilyDescribe(name, status, j, txt, headers) {
  const msg = errText(j, txt);
  if (status === 432) return new ProviderError(name, "quota", "Tavily's free monthly credits are used up. Research waits until they renew; nothing is charged.", { status });
  if (status === 433) return new ProviderError(name, "quota", "Tavily's pay-as-you-go limit was reached. Nothing more is searched.", { status });
  if (status === 401) return new ProviderError(name, "auth", "Tavily refused the API key — check TAVILY_API_KEY in Cloudflare.", { status });
  return defaultDescribe(name, status, j, txt, headers) || new ProviderError(name, "server", msg);
}
const credits = (j, fallback) => { const c = j && j.usage && Number(j.usage.credits); return Number.isFinite(c) ? c : fallback; };
const dateOnly = (s) => { const d = Date.parse(s || ""); return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null; };

/** One Tavily search. Returns {results:[{url,title,content,score,publishedAt}], credits, requestId, ms}. */
export async function tavilySearch(env, q) {
  if (!tavilyConfigured(env)) throw new ProviderError("Tavily", "not_configured", "Research search is not connected: add the TAVILY_API_KEY secret to this Worker (see CLOUDFLARE.md).");
  const depth = q.depth === "advanced" ? "advanced" : "basic";
  const body = { query: clip(q.query, 380), search_depth: depth, topic: q.topic === "news" ? "news" : "general", max_results: Math.max(1, Math.min(10, q.maxResults || 6)),
    include_answer: false, include_raw_content: false, include_images: false, include_usage: true, include_published_date: true };
  if (q.timeRange) body.time_range = q.timeRange;
  if (q.country && body.topic === "general") body.country = q.country;
  if (Array.isArray(q.includeDomains) && q.includeDomains.length) body.include_domains = q.includeDomains.slice(0, 20);
  if (Array.isArray(q.excludeDomains) && q.excludeDomains.length) body.exclude_domains = q.excludeDomains.slice(0, 20);
  const t0 = Date.now();
  const j = await callJson(tavilyBase(env) + "/search", { method: "POST", headers: tavilyHeaders(env), body: JSON.stringify(body) }, { name: "Tavily", timeoutMs: tavilyTimeout(env, 20000), retries: 1, describe: tavilyDescribe });
  const results = (Array.isArray(j.results) ? j.results : []).filter((r) => r && /^https?:\/\//i.test(String(r.url || ""))).map((r) => ({
    url: String(r.url).trim(), title: clip(r.title, 300), content: clip(r.content, 1500), score: Number(r.score) || 0, publishedAt: dateOnly(r.published_date) }));
  return { results, credits: credits(j, depth === "advanced" ? 2 : 1), requestId: j.request_id || null, ms: Date.now() - t0 };
}

/** Extract the readable text of up to 20 pages. Returns {results:[{url, content}], failed:[url], credits}. */
export async function tavilyExtract(env, urls, { depth = "basic", maxChars = 6000 } = {}) {
  if (!tavilyConfigured(env)) throw new ProviderError("Tavily", "not_configured", "Research search is not connected: add the TAVILY_API_KEY secret to this Worker (see CLOUDFLARE.md).");
  const list = [...new Set((urls || []).filter((u) => /^https?:\/\//i.test(String(u))))].slice(0, 20);
  if (!list.length) return { results: [], failed: [], credits: 0 };
  const j = await callJson(tavilyBase(env) + "/extract", { method: "POST", headers: tavilyHeaders(env),
    body: JSON.stringify({ urls: list, extract_depth: depth === "advanced" ? "advanced" : "basic", format: "text", include_images: false, include_usage: true }) },
    { name: "Tavily", timeoutMs: tavilyTimeout(env, 30000), retries: 1, describe: tavilyDescribe });
  const results = (Array.isArray(j.results) ? j.results : []).filter((r) => r && r.url).map((r) => ({ url: String(r.url), content: clip(r.raw_content, maxChars) }));
  const failed = (Array.isArray(j.failed_results) ? j.failed_results : []).map((r) => String((r && r.url) || r)).filter(Boolean);
  const per = depth === "advanced" ? 2 : 1;
  return { results, failed, credits: credits(j, Math.ceil(results.length / 5) * per) };
}
