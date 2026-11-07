/* X FORCE — Market Intelligence 2.0: the job ledger, mix/disc/j/<id>. Phase 1 builds it; Phase 2's discovery uses it.
   One small step per job, saved after every step, so a stopped run can always resume and nothing disappears:

     queued → running → done
                      → waiting (a limit, or a temporary failure; retried at nextAt)
                      → failed  (out of tries, with the reason, visible to administrators)

   Retry-safe: a job's id comes from its key, so asking twice for the same work never makes two jobs.
   One worker per job: a lease in the existing `leases` table. A job left "running" by a run that died is picked up again. */

const LEASE_MS = 3 * 60e3, BACKOFF_MS = 60 * 60e3;
const PARENT = "mix/disc/j";
const nowIso = (t) => new Date(t == null ? Date.now() : t).toISOString();
const pathOf = (id) => `${PARENT}/${id}`;
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

/** A fixed id from the job's key (the same key always gives the same id). */
export async function jobId(key) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(key)));
  return "j" + [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const save = (env, id, d) => env.DB.prepare("UPDATE docs SET data = ?, v = v + 1, at = ? WHERE path = ?").bind(JSON.stringify(d), nowIso(), pathOf(id)).run();
const read = async (env, id) => { const r = await env.DB.prepare("SELECT data FROM docs WHERE path = ?").bind(pathOf(id)).first(); return r ? JSON.parse(r.data) : null; };

/** Adds a job unless one with this key exists. Returns {id, created}. */
export async function addJob(env, { key, kind, input = null, maxTries = 3 }, t = Date.now()) {
  if (!key || !kind) throw new Error("A job needs a key and a kind.");
  const id = await jobId(key);
  const d = { id, key: clip(key, 300), kind: clip(kind, 40), input, status: "queued", tries: 0, maxTries, createdAt: nowIso(t), nextAt: nowIso(t), startedAt: null, finishedAt: null, result: null, error: null, log: [] };
  const r = await env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING RETURNING v").bind(pathOf(id), PARENT, JSON.stringify(d), nowIso()).first();
  return { id, created: !!r };
}

/** Jobs ready now, oldest first (counted in the database, so the Worker parses only what it returns). */
export async function dueJobs(env, limit = 1, t = Date.now()) {
  const rs = (await env.DB.prepare(`SELECT data FROM docs WHERE parent = ? AND json_extract(data,'$.status') IN ('queued','waiting','running') AND json_extract(data,'$.nextAt') <= ? ORDER BY json_extract(data,'$.nextAt') LIMIT ?`)
    .bind(PARENT, nowIso(t), Math.max(1, Math.min(50, limit))).all()).results || [];
  return rs.map((r) => JSON.parse(r.data));
}

/** Takes one job for this holder. Returns the job, or null when someone else holds it or it is not ready. A claim counts as a try. */
export async function claimJob(env, id, holder, t = Date.now()) {
  const lease = "mi:job:" + id;
  await env.DB.prepare("DELETE FROM leases WHERE path = ? AND exp < ?").bind(lease, t).run();
  const got = await env.DB.prepare("INSERT INTO leases (path, holder, exp) VALUES (?, ?, ?) ON CONFLICT(path) DO NOTHING RETURNING holder").bind(lease, holder, t + LEASE_MS).first();
  if (!got) return null;
  const d = await read(env, id);
  const release = () => env.DB.prepare("DELETE FROM leases WHERE path = ? AND holder = ?").bind(lease, holder).run();
  if (!d || !["queued", "waiting", "running"].includes(d.status) || d.nextAt > nowIso(t)) { await release(); return null; }
  if (d.tries >= d.maxTries) {   // it died while running on its last try: report that instead of trying for ever
    Object.assign(d, { status: "failed", finishedAt: nowIso(t), error: d.error || "Stopped responding on its last try." }); await save(env, id, d); await release(); return null;
  }
  Object.assign(d, { status: "running", tries: d.tries + 1, startedAt: d.startedAt || nowIso(t), nextAt: nowIso(t + LEASE_MS) });
  await save(env, id, d);
  return d;
}

/** Records how a claimed job's step ended and frees the job.
 *  done   {result}                     finished
 *  wait   {reason, untilMs?}           a limit: not this job's fault, so the try is given back and the reason is shown
 *  fail   {reason}                     a failure: retried until maxTries, then failed with the reason. */
export async function endJob(env, id, holder, outcome, t = Date.now()) {
  const d = await read(env, id); if (!d) return null;
  const entry = { at: nowIso(t), outcome: outcome.status };
  if (outcome.status === "done") Object.assign(d, { status: "done", result: outcome.result == null ? null : outcome.result, error: null, finishedAt: nowIso(t) });
  else if (outcome.status === "wait") { Object.assign(d, { status: "waiting", tries: Math.max(0, d.tries - 1), error: clip(outcome.reason, 300), nextAt: nowIso(outcome.untilMs || t + BACKOFF_MS) }); entry.reason = d.error; }
  else {
    const reason = clip(outcome.reason || "Unknown failure", 300), out = d.tries >= d.maxTries; entry.reason = reason;
    Object.assign(d, out ? { status: "failed", error: reason, finishedAt: nowIso(t) } : { status: "waiting", error: reason, nextAt: nowIso(t + BACKOFF_MS) });
  }
  d.log = (d.log || []).concat([entry]).slice(-20);
  await save(env, id, d);
  await env.DB.prepare("DELETE FROM leases WHERE path = ? AND holder = ?").bind("mi:job:" + id, holder).run();
  return d;
}
