/* X FORCE — Commercial Intelligence, Phase 0: the one way the Worker talks to an AI provider.

     task → data-class check → route (mix/aicfg) → daily cap → provider → result → call log (mix/ailog/l)

   Switch config/settings.ci.ai OFF (the default): every call goes to Gemini exactly as before (worker/providers.js geminiJson), with
   only one added rule — the call must declare public data (P0), because Gemini's free tier may use and human-review what it receives.
   Switch ON: the administrator's routing in mix/aicfg chooses the provider and model per task, with an optional fallback; data classes
   are enforced per provider (app/ci.js PROVIDERS, fixed in code); each non-Gemini provider has its own daily call cap (kv
   ru:ai:<provider>:d:YYYY-MM-DD, 0 = not allowed); every call is logged without its text.

   Providers:
     gemini     GEMINI_API_KEY (existing). Its daily cap stays in worker/usage.js, reserved by the callers as before.
     workersai  the Worker's AI binding (env.AI). Not configured in wrangler.jsonc yet: add  "ai": { "binding": "AI" }  to use it.
     claude     ANTHROPIC_API_KEY (paid). ANTHROPIC_BASE_URL for tests.
     compat     any service with an OpenAI-style /chat/completions API: AI_COMPAT_BASE_URL and AI_COMPAT_API_KEY (paid as a rule).
   Every answer is asked for as JSON, as today. Returns {text, tokens, model, finish, provider}. Throws ProviderError or CapError. */
import "../app/ci.js";
import { callJson, geminiJson, geminiConfigured, secretOf, ProviderError } from "./providers.js";
import { CapError, reserveGemini, releaseGemini } from "./usage.js";

const C = () => globalThis.DPCi;
const LOG = "mix/ailog/l", KEEP_DAYS = 90;
const nowIso = () => new Date().toISOString();

/** Is the "ai" switch on? One small read of config/settings. */
export async function aiSwitch(env) {
  const r = await env.DB.prepare("SELECT json_extract(data,'$.ci.ai') v FROM docs WHERE path = 'config/settings'").first();
  return !!(r && (r.v === 1 || r.v === true));
}
async function routing(env) {
  const r = await env.DB.prepare("SELECT data FROM docs WHERE path = 'mix/aicfg'").first();
  return C().aicfgOf(r ? JSON.parse(r.data) : null);
}

/* ---------------- adapters ---------------- */
const configured = {
  gemini: (env) => geminiConfigured(env),
  workersai: (env) => !!(env.AI && typeof env.AI.run === "function"),
  claude: (env) => secretOf(env, "ANTHROPIC_API_KEY").length > 20,
  compat: (env) => secretOf(env, "AI_COMPAT_API_KEY").length > 10 && /^https:\/\//.test(String(env.AI_COMPAT_BASE_URL || "")),
};
const timeout = (env) => { const t = parseInt(env.AI_TIMEOUT_MS, 10); return Number.isFinite(t) && t >= 100 ? Math.min(t, 120000) : 60000; };
const adapters = {
  async gemini(env, { system, prompt, maxOutputTokens }, model) {
    const e = model ? Object.assign({}, env, { GEMINI_MODEL: model }) : env;
    return geminiJson(e, maxOutputTokens == null ? { system, prompt } : { system, prompt, maxOutputTokens });
  },
  async workersai(env, { system, prompt, maxOutputTokens }, model) {
    if (!model) throw new ProviderError("Workers AI", "not_configured", "Choose a Workers AI model under AI routing.");
    let r;
    try { r = await env.AI.run(model, { messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: Math.min(maxOutputTokens || 4096, 8192), response_format: { type: "json_object" } }); }
    catch (e) { throw new ProviderError("Workers AI", /limit|quota|429/i.test(String(e && e.message)) ? "quota" : "server", `Workers AI failed (${String(e && e.message).slice(0, 160)}).`); }
    const text = typeof (r && r.response) === "string" ? r.response : r && r.response != null ? JSON.stringify(r.response) : "";
    if (!text) throw new ProviderError("Workers AI", "server", "Workers AI returned no answer.");
    return { text, tokens: Number(r.usage && r.usage.total_tokens) || 0, model, finish: null };
  },
  async claude(env, { system, prompt, maxOutputTokens }, model) {
    if (!model) throw new ProviderError("Claude", "not_configured", "Choose a Claude model under AI routing.");
    const base = String(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
    const j = await callJson(`${base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": secretOf(env, "ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: Math.min(maxOutputTokens || 4096, 16000), temperature: 0.2, system: system + "\nAnswer with JSON only.", messages: [{ role: "user", content: prompt }] }) },
      { name: "Claude", timeoutMs: timeout(env), retries: 1 });
    const text = (j.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
    if (!text) throw new ProviderError("Claude", "server", `Claude returned no answer (${j.stop_reason || "no reason given"}).`);
    if (j.stop_reason === "max_tokens") throw new ProviderError("Claude", "server", "Claude's answer was cut off (too long). Nothing was saved.");
    return { text, tokens: (Number(j.usage && j.usage.input_tokens) || 0) + (Number(j.usage && j.usage.output_tokens) || 0), model: j.model || model, finish: j.stop_reason || null };
  },
  async compat(env, { system, prompt, maxOutputTokens }, model) {
    if (!model) throw new ProviderError("AI provider", "not_configured", "Choose a model for the other provider under AI routing.");
    const base = String(env.AI_COMPAT_BASE_URL).replace(/\/+$/, "");
    const j = await callJson(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + secretOf(env, "AI_COMPAT_API_KEY") },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: Math.min(maxOutputTokens || 4096, 16000), response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }) },
      { name: "AI provider", timeoutMs: timeout(env), retries: 1 });
    const ch = (j.choices || [])[0] || {}, text = ch.message && typeof ch.message.content === "string" ? ch.message.content : "";
    if (!text) throw new ProviderError("AI provider", "server", "The AI provider returned no answer.");
    if (ch.finish_reason === "length") throw new ProviderError("AI provider", "server", "The answer was cut off (too long). Nothing was saved.");
    return { text, tokens: Number(j.usage && j.usage.total_tokens) || 0, model: j.model || model, finish: ch.finish_reason || null };
  },
};

/* ---------------- caps for providers other than Gemini ---------------- */
const pday = () => nowIso().slice(0, 10);
async function reserveProvider(env, provider, cap) {
  if (!(cap > 0)) throw new CapError("ai_" + provider, `${C().PROVIDERS[provider].label}: no daily calls allowed yet. Set a daily limit under AI routing.`);
  const r = await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?1, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + 1 AS TEXT) WHERE CAST(kv.v AS INTEGER) + 1 <= ?2 RETURNING v")
    .bind(`ru:ai:${provider}:d:${pday()}`, cap).first();
  if (!r) throw new CapError("ai_" + provider, `${C().PROVIDERS[provider].label}: today's limit of ${cap} calls is used up. It resets at midnight UTC.`);
}
const releaseProvider = (env, provider) => env.DB.prepare("UPDATE kv SET v = CAST(MAX(0, CAST(v AS INTEGER) - 1) AS TEXT) WHERE k = ?").bind(`ru:ai:${provider}:d:${pday()}`).run();
export async function providerUsage(env) {
  const out = {};
  for (const p of Object.keys(C().PROVIDERS)) { if (p === "gemini") continue; const r = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(`ru:ai:${p}:d:${pday()}`).first(); out[p] = r ? parseInt(r.v, 10) || 0 : 0; }
  return out;
}

/* ---------------- the call log (no prompt or answer text is kept) ---------------- */
async function logCall(env, rec) {
  const at = nowIso(), id = at.replace(/[^0-9]/g, "").slice(0, 17) + Math.random().toString(36).slice(2, 7), path = `${LOG}/${id}`;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO docs (path, parent, data, v, at) VALUES (?, ?, ?, 1, ?)").bind(path, LOG, JSON.stringify(Object.assign({ at }, rec)), at),
    env.DB.prepare("DELETE FROM docs WHERE path >= ? AND path < ? AND at < ?").bind(LOG + "/", LOG + "0", cutoff),
  ]);
}

/** Is AI available for this task? (Switch off: exactly the old Gemini check.) */
export async function aiReady(env, task, cls = "P0") {
  if (!(await aiSwitch(env))) return geminiConfigured(env);
  const r = C().routeFor(task, cls, await routing(env));
  return !r.error && r.plan.some((p) => configured[p.provider](env));
}

/**
 * One AI call that must answer JSON.
 * @param {object} o  { task, cls ("P0"…"P3"), system, prompt, maxOutputTokens }
 */
export async function aiJson(env, o) {
  const { task, cls } = o, req = { system: o.system, prompt: o.prompt, maxOutputTokens: o.maxOutputTokens };
  if (!C().TASKS[task]) throw new ProviderError("AI", "bad_request", `Unknown AI task "${task}".`);
  if (!(await aiSwitch(env))) {
    if (cls !== "P0") throw new ProviderError("AI", "bad_request", `Only public data may go to Gemini's free tier; this call is marked ${cls}.`);
    return Object.assign(await adapters.gemini(env, req, ""), { provider: "gemini" });
  }
  const route = C().routeFor(task, cls, await routing(env));
  if (route.error) { await logCall(env, { task, cls, provider: null, ok: false, code: "refused", error: route.error }).catch(() => {}); throw new ProviderError("AI", "not_configured", route.error); }
  const cfg = await routing(env); let last = null;
  for (const step of route.plan) {
    const p = step.provider, t0 = Date.now();
    if (!configured[p](env)) { last = new ProviderError(C().PROVIDERS[p].label, "not_configured", `${C().PROVIDERS[p].label} is not connected (${C().PROVIDERS[p].secret}).`); continue; }
    let reserved = false;
    try {
      if (p !== "gemini") { await reserveProvider(env, p, cfg.providers[p].dailyCalls); reserved = true; }
      const a = await adapters[p](env, req, step.model);
      await logCall(env, { task, cls, provider: p, model: a.model, tokens: a.tokens, ms: Date.now() - t0, ok: true }).catch(() => {});
      return Object.assign(a, { provider: p });
    } catch (e) {
      if (reserved) await releaseProvider(env, p).catch(() => {});
      await logCall(env, { task, cls, provider: p, model: step.model || null, ms: Date.now() - t0, ok: false, code: e.code || "error", error: String(e.message || e).slice(0, 200) }).catch(() => {});
      last = e;
      // a fault of the request itself would fail again elsewhere; anything about the provider tries the fallback
      if (e instanceof ProviderError && e.code === "bad_request") throw e;
    }
  }
  throw last || new ProviderError("AI", "not_configured", "No AI provider is available for this task.");
}

/** Administrators' test of one provider: a fixed public prompt, so nothing private is ever sent. Counts against its cap. */
export async function aiTest(env, provider) {
  if (!C().PROVIDERS[provider]) return { ok: false, message: "Unknown provider." };
  if (!configured[provider](env)) return { ok: false, message: `${C().PROVIDERS[provider].label} is not connected (${C().PROVIDERS[provider].secret}).` };
  const cfg = await routing(env), t0 = Date.now(), req = { system: "You check that an API works.", prompt: 'Answer exactly {"ok": true}', maxOutputTokens: 200 };
  let reserved = false;
  try {
    if (provider !== "gemini") await reserveProvider(env, provider, cfg.providers[provider].dailyCalls); else await reserveGemini(env);
    reserved = true;
    const a = await adapters[provider](env, req, cfg.providers[provider].model);
    await logCall(env, { task: "test", cls: "P0", provider, model: a.model, tokens: a.tokens, ms: Date.now() - t0, ok: true }).catch(() => {});
    return { ok: true, model: a.model, ms: Date.now() - t0, answer: String(a.text).slice(0, 80) };
  } catch (e) {
    if (reserved) await (provider === "gemini" ? releaseGemini(env) : releaseProvider(env, provider)).catch(() => {});
    await logCall(env, { task: "test", cls: "P0", provider, ms: Date.now() - t0, ok: false, code: e.code || "error", error: String(e.message || e).slice(0, 200) }).catch(() => {});
    return { ok: false, message: String(e.message || e).slice(0, 300) };
  }
}
export const aiConfiguredMap = (env) => Object.fromEntries(Object.keys(configured).map((k) => [k, configured[k](env)]));
