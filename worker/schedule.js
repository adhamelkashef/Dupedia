/* X FORCE Market Intelligence 2.0: the research schedule (owner's request, 7 Nov 2026: currency, news and the rest run by themselves).
   Each hourly run (minute 28) checks the administrator's schedule in mix/enginecfg. A job that is due today and whose hour has come (or
   passed: a missed run is caught up the same day) is queued once as an ordinary research request (mi/req/r), which the existing hourly
   research run then carries out with all its limits and checks. One request per day per job, even if the hour is missed and retried.
   Only while config/settings.miEngine is on. */
import "../app/miengine.js";

const E = () => globalThis.DPMiEngine;
const nowIso = (t) => new Date(t == null ? Date.now() : t).toISOString();

export async function scheduleTick(env, t = Date.now()) {
  const on = await env.DB.prepare("SELECT json_extract(data,'$.miEngine') v FROM docs WHERE path = 'config/settings'").first();
  if (!(on && on.v === 1)) return { off: true };
  const row = await env.DB.prepare("SELECT data FROM docs WHERE path = 'mix/enginecfg'").first();
  const sch = E().cfgOf(row ? JSON.parse(row.data) : null).schedule, d = new Date(t), day = nowIso(t).slice(0, 10), due = [];
  for (const [job] of E().SCHEDULE_JOBS) {
    const s = sch[job];
    if (!s.on || !s.days.includes(d.getUTCDay()) || d.getUTCHours() < s.hour) continue;
    const r = await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING RETURNING k").bind(`mi:sched:${job}:${day}`, nowIso(t)).first();
    if (r) due.push(job);
  }
  if (!due.length) return { queued: [] };
  // a job already waiting in an open request is not asked for twice
  const open = ((await env.DB.prepare("SELECT data FROM docs WHERE parent = 'mi/req/r' AND json_extract(data,'$.status') IN ('queued','running')").all()).results || []).flatMap((x) => JSON.parse(x.data).jobs || []);
  const jobs = due.filter((j) => !open.includes(j));
  if (!jobs.length) return { queued: [], skipped: due };
  const id = "rq-s" + d.getTime().toString(36);
  await env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, 'mi/req/r', ?, 1, ?) ON CONFLICT(path) DO NOTHING")
    .bind(`mi/req/r/${id}`, JSON.stringify({ jobs, by: "schedule", at: nowIso(t), status: "queued", started: null, via: "cloudflare", scheduled: true }), nowIso(t)).run();
  return { queued: jobs, request: id };
}
