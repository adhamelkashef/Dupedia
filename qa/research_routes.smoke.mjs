/* X FORCE 2.1 S2 — end-to-end check of the research search routes against a LOCAL `wrangler dev` (never production).
   Needs a fresh local database and .dev.vars with SETUP_CODE=local-test-setup-code-only and either TAVILY_KEYLESS=1
   (a real, rate-limited Tavily search without a key) or a TAVILY_API_KEY.
   Run:  node qa/research_routes.smoke.mjs http://localhost:8799 */
const BASE = process.argv[2] || "http://localhost:8799";
const PW_OWNER = "Local-Test-Owner-1", PW_STAFF_TMP = "Local-Test-Staff-1", PW_STAFF = "Local-Test-Staff-2";   // local test accounts only
let fails = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`); if (!cond) fails++; };
async function call(path, { method = "GET", body, cookie, csrf = true } = {}) {
  const h = { "content-type": "application/json" }; if (csrf) h["x-xf"] = "1"; if (cookie) h.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const set = r.headers.get("set-cookie"); let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j, cookie: set ? set.split(";")[0] : null };
}

const s = await call("/api/setup", { method: "POST", body: { code: "local-test-setup-code-only", username: "audit.owner", name: "Audit Owner", password: PW_OWNER } });
ok(s.status === 200 && s.cookie, "owner account created on the local database");
const admin = s.cookie;

const st = await call("/api/research/status", { cookie: admin });
ok(st.status === 200 && st.j.provider === "free" && st.j.tavily === true, "status: provider free, search connected", JSON.stringify({ provider: st.j && st.j.provider, tavily: st.j && st.j.tavily, gemini: st.j && st.j.gemini }));
ok(st.j && st.j.usage && st.j.usage.tavily.monthCap === 900 && st.j.depths.deep.maxCredits === 14, "status: usage and depth costs shown", JSON.stringify(st.j && st.j.usage));

ok((await call("/api/research/topic", { method: "POST", body: { topic: "playground" } })).status === 401, "signed out → 401");
ok((await call("/api/research/topic", { method: "POST", cookie: admin, csrf: false, body: { topic: "playground" } })).status === 403, "no CSRF header → 403");

// a staff (non-admin) account
const mk = await call("/api/accounts", { method: "POST", cookie: admin, body: { username: "audit.sales", name: "Audit Sales", level: "interact", password: PW_STAFF_TMP } });
const li = await call("/api/login", { method: "POST", body: { username: "audit.sales", password: PW_STAFF_TMP } });
await call("/api/password", { method: "POST", cookie: li.cookie, body: { old: PW_STAFF_TMP, password: PW_STAFF } });
const staff = (await call("/api/login", { method: "POST", body: { username: "audit.sales", password: PW_STAFF } })).cookie;
ok(mk.status === 200 && !!staff, "staff account signed in");
const sTopic = await call("/api/research/topic", { method: "POST", cookie: staff, body: { topic: "playground Egypt", depth: "quick" } });
ok(sTopic.status === 403, "staff cannot start research", sTopic.j && sTopic.j.message);
ok((await call("/api/research/status", { cookie: staff })).status === 403, "staff cannot read research status/usage");
ok((await call("/api/research/topic/step", { method: "POST", cookie: staff, body: { id: "tabcdef" } })).status === 403, "staff cannot step a research");

ok((await call("/api/research/topic", { method: "POST", cookie: admin, body: { topic: "  x " } })).status === 400, "too-short topic refused");

// a real research (search stage)
const c = await call("/api/research/topic", { method: "POST", cookie: admin, body: { topic: "new residential compounds with kids playgrounds New Cairo", market: "egypt", depth: "quick" } });
ok(c.status === 200 && c.j.progress.stage === "queued", "admin starts a Quick research", c.j && c.j.progress && c.j.progress.id);
const id = c.j.progress.id; let p = c.j.progress;
for (let i = 0; i < 10 && ["queued", "searching", "collecting"].includes(p.stage); i++) {
  const r = await call("/api/research/topic/step", { method: "POST", cookie: admin, body: { id } }); p = r.j.progress || p;
  console.log(`      step ${i + 1}: stage=${p.stage} searches ${p.searchesDone}/${p.searchesTotal} sources=${p.sources} credits=${p.credits}${p.waiting ? " waiting: " + p.waiting.reason : ""}`);
}
ok(p.stage === "sources_ready" && p.sources > 0, "search stage finished with real sources", `${p.sources} sources, ${p.credits} credits`);

const d = await call("/api/db", { method: "POST", cookie: admin, body: { op: "get", path: "mix/topic/t/" + id } });
ok(d.j && d.j.exists && d.j.data.sources.every((x) => /^https?:\/\//.test(x.url)), "saved in the database, every source has a link");
if (d.j && d.j.exists) for (const x of d.j.data.sources.slice(0, 8)) console.log(`      ${x.id}  ${x.publishedAt || "no date   "}  ${x.host}  ${x.title.slice(0, 70)}`);
const sd = await call("/api/db", { method: "POST", cookie: staff, body: { op: "get", path: "mix/topic/t/" + id } });
ok(sd.j && sd.j.exists === false, "staff cannot read the saved research");
const sl = await call("/api/db", { method: "POST", cookie: staff, body: { op: "list", path: "mix/topic/t" } });
ok(!sl.j || !Array.isArray(sl.j.docs) || sl.j.docs.length === 0, "staff cannot list saved research", JSON.stringify(sl.j).slice(0, 120));

const st2 = await call("/api/research/status", { cookie: admin });
ok(st2.j.usage.reports.month === 1 && st2.j.usage.reports.mineToday === 1, "usage: 1 report counted", JSON.stringify(st2.j.usage));
console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
