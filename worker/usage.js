/* X FORCE 2.1 — research usage counters and caps (D1 table kv; no new table).
   A call first RESERVES what it may spend (one atomic statement that refuses to go past the cap), then corrects the
   counter to what the provider actually reported. So two admins starting research at once can never pass a cap.

     ru:tav:m:YYYY-MM          Tavily credits this month       cap TAVILY_MONTHLY_CREDITS  (default 900 of the free 1,000)
     ru:tav:d:YYYY-MM-DD       Tavily credits today (UTC)      cap TAVILY_DAILY_CREDITS    (default 60)
     ru:gem:d:YYYY-MM-DD       Gemini calls today (Pacific — Google resets at midnight Pacific)  cap GEMINI_DAILY_CALLS (default 100)
     ru:gem:t:YYYY-MM          Gemini tokens this month (shown only, no cap)
     ru:rep:m:YYYY-MM          topic reports started this month   cap RESEARCH_MONTHLY_JOBS (default 150)
     ru:rep:u:<uid>:YYYY-MM-DD topic reports started by one admin today   cap RESEARCH_USER_DAILY (default 3)
     research:YYYY-MM-DD       fixed research jobs today (1.4.2, unchanged)   cap RESEARCH_DAILY_JOBS
     ru:tav:s:<stream>:YYYY-MM Tavily credits this month for one kind of research (Commercial Intelligence, Phase 0). Always counted, so an
                               administrator sees each stream's real use before choosing shares. Capped only while config/settings.ci.envelopes
                               is on AND mix/enginecfg.envelopes.<stream> holds a number; blank = no envelope for that stream. */

const num = (v, d, lo, hi) => { const x = parseInt(v, 10); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
export function caps(env) {
  return { tavilyMonth: num(env.TAVILY_MONTHLY_CREDITS, 900, 0, 1000000), tavilyDay: num(env.TAVILY_DAILY_CREDITS, 60, 0, 100000),
    geminiDay: num(env.GEMINI_DAILY_CALLS, 100, 0, 100000), reportsMonth: num(env.RESEARCH_MONTHLY_JOBS, 150, 0, 100000),
    reportsUserDay: num(env.RESEARCH_USER_DAILY, 3, 0, 1000) };
}
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const utcMonth = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
/** Google's daily quota day (America/Los_Angeles). */
export const pacificDay = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
export const keys = (t = Date.now()) => ({ tavMonth: "ru:tav:m:" + utcMonth(t), tavDay: "ru:tav:d:" + utcDay(t), gemDay: "ru:gem:d:" + pacificDay(t),
  gemTokens: "ru:gem:t:" + utcMonth(t), repMonth: "ru:rep:m:" + utcMonth(t), repUser: (uid) => `ru:rep:u:${uid}:${utcDay(t)}` });

const get = async (env, k) => { const r = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first(); return r ? parseInt(r.v, 10) || 0 : 0; };
/** Adds n to counter k only while the result stays ≤ cap. Returns true when it was added. */
async function addCapped(env, k, n, cap) {
  if (n > cap) return false;
  const r = await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?1, CAST(?2 AS TEXT)) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + ?2 AS TEXT) WHERE CAST(kv.v AS INTEGER) + ?2 <= ?3 RETURNING v")
    .bind(k, n, cap).first();
  return !!r;
}
const add = (env, k, n) => env.DB.prepare("INSERT INTO kv (k, v) VALUES (?1, CAST(?2 AS TEXT)) ON CONFLICT(k) DO UPDATE SET v = CAST(MAX(0, CAST(kv.v AS INTEGER) + ?2) AS TEXT)").bind(k, n).run();

export class CapError extends Error { constructor(code, message) { super(message); this.code = code; this.cap = true; } }
const resetUtc = "It resets at midnight UTC (2 or 3 a.m. in Cairo).";

export const STREAMS = ["jobs", "leads", "topic"];
export const streamKey = (stream, t = Date.now()) => `ru:tav:s:${stream}:${utcMonth(t)}`;
/** The stream's envelope in credits, or null when there is none (switch off, or no share entered). */
async function envelope(env, stream) {
  const r = await env.DB.prepare("SELECT (SELECT json_extract(data,'$.ci.envelopes') FROM docs WHERE path = 'config/settings') AS onv, (SELECT json_extract(data, ?1) FROM docs WHERE path = 'mix/enginecfg') AS cap")
    .bind(`$.envelopes.${stream}`).first();
  if (!r || !(r.onv === 1 || r.onv === true)) return null;
  const cap = Number(r.cap); return r.cap === null || r.cap === undefined || r.cap === "" || !Number.isInteger(cap) || cap < 0 ? null : cap;
}
/** Reserve Tavily credits before a call. Throws CapError when a cap would be passed (nothing is reserved then).
 *  stream (optional): which kind of research spends them (STREAMS), for its monthly envelope. */
export async function reserveTavily(env, n, stream = null) {
  const c = caps(env), k = keys(), sk = STREAMS.includes(stream) ? streamKey(stream) : null;
  if (sk) {
    const cap = await envelope(env, stream);
    if (cap == null) await add(env, sk, n);
    else if (!(await addCapped(env, sk, n, cap))) throw new CapError("envelope_month_" + stream, `This month's share of search credits for ${stream === "jobs" ? "scheduled research" : stream === "leads" ? "lead research" : "topic research"} (${cap} credits) is used up. It renews on the 1st; an administrator can change the share.`);
  }
  if (!(await addCapped(env, k.tavDay, n, c.tavilyDay))) { if (sk) await add(env, sk, -n); throw new CapError("tavily_day", `Today's research search allowance (${c.tavilyDay} Tavily credits) is used up. ${resetUtc} An administrator can change TAVILY_DAILY_CREDITS.`); }
  if (!(await addCapped(env, k.tavMonth, n, c.tavilyMonth))) { await add(env, k.tavDay, -n); if (sk) await add(env, sk, -n);
    throw new CapError("tavily_month", `This month's research search allowance (${c.tavilyMonth} Tavily credits) is used up. It renews on the 1st; nothing is charged.`); }
  return sk ? { reserved: n, keys: k, streamKey: sk } : { reserved: n, keys: k };
}
/** After the call: correct the reservation to what Tavily actually charged (0 when the call failed). */
export async function settleTavily(env, res, actual) {
  const d = Math.max(0, Math.round(Number(actual) || 0)) - res.reserved; if (!d) return;
  await Promise.all([add(env, res.keys.tavDay, d), add(env, res.keys.tavMonth, d)].concat(res.streamKey ? [add(env, res.streamKey, d)] : []));
}
/** This month's credits per stream (for the administrators' screen). */
export async function streamUsage(env) {
  const out = {}; for (const s of STREAMS) out[s] = await get(env, streamKey(s)); return out;
}
/** Reserve one Gemini call (Session 3 uses it). */
export async function reserveGemini(env) {
  const c = caps(env);
  if (!(await addCapped(env, keys().gemDay, 1, c.geminiDay))) throw new CapError("gemini_day", `Today's AI analysis allowance (${c.geminiDay} Gemini calls) is used up. It resets at midnight Pacific time (10 or 11 a.m. in Cairo).`);
}
export const releaseGemini = (env) => add(env, keys().gemDay, -1);
export const countGeminiTokens = (env, n) => add(env, keys().gemTokens, Math.max(0, Math.round(Number(n) || 0)));

/** Reserve one topic report for this admin (monthly + per-person daily caps). */
export async function reserveReport(env, uid) {
  const c = caps(env), k = keys();
  if (!(await addCapped(env, k.repUser(uid), 1, c.reportsUserDay))) throw new CapError("user_day", `You have started ${c.reportsUserDay} research reports today — the daily limit per person. ${resetUtc}`);
  if (!(await addCapped(env, k.repMonth, 1, c.reportsMonth))) { await add(env, k.repUser(uid), -1);
    throw new CapError("reports_month", `This month's research report limit (${c.reportsMonth}) is reached. It renews on the 1st; an administrator can change RESEARCH_MONTHLY_JOBS.`); }
}

/** What /api/research/status shows. */
export async function usageSummary(env, uid) {
  const c = caps(env), k = keys();
  const [tm, td, gd, gt, rm, ru] = await Promise.all([get(env, k.tavMonth), get(env, k.tavDay), get(env, k.gemDay), get(env, k.gemTokens), get(env, k.repMonth), uid ? get(env, k.repUser(uid)) : 0]);
  return { tavily: { month: tm, monthCap: c.tavilyMonth, today: td, todayCap: c.tavilyDay }, gemini: { today: gd, todayCap: c.geminiDay, tokensMonth: gt },
    reports: { month: rm, monthCap: c.reportsMonth, mineToday: ru, perUserDay: c.reportsUserDay } };
}
