/* X FORCE — Commercial Intelligence, Phase 0 (COMMERCIAL_INTELLIGENCE_BLUEPRINT.md, kept outside the repository).
   Pure functions shared by the app, the Worker and the tests. No storage, no DOM.

   config/settings.ci        the switches: { ai: bool, envelopes: bool }. Missing or off = everything behaves exactly as before.
   mix/aicfg                 AI routing: which provider and model does each task; daily caps (administrators only)
   mix/ailog/l/<id>          one line per AI call while the "ai" switch is on (administrators only, kept 90 days)
   mix/enginecfg             gains optional fields: leadTimes, safetyDays, salesCycle, stageOpening, envelopes

   The repository is public, so every commercial number (lead times, sales cycles, credit shares) starts blank here and is
   entered by an administrator. Nothing below is a company figure. */
(function (root) {
  "use strict";

  /* ---------------- switches ---------------- */
  const FLAGS = [
    ["ai", "AI routing and call log", "Each AI task uses the provider chosen below, data classes are enforced, and every call is logged. Off: every AI call goes to Gemini exactly as before."],
    ["envelopes", "Search credit envelopes", "Each kind of research may spend only its monthly share of search credits. Off: only the existing daily and monthly caps apply."],
  ];
  function flagsOf(settings) {
    const c = (settings && settings.ci) || {}, out = {};
    for (const [k] of FLAGS) out[k] = c[k] === true;
    return out;
  }

  /* ---------------- data classes ---------------- */
  const DATA_CLASSES = {
    P0: "Public web text and public facts",
    P1: "Internal counts and stages, no names or money",
    P2: "Prices, values, customer notes, targets",
    P3: "Personal data (employees, named contacts)",
  };
  /* What each provider may receive. Fixed in code on purpose: an administrator can switch a provider off, never widen this.
     Gemini's free tier may use and human-review inputs, so it gets public text only. */
  const PROVIDERS = {
    gemini: { label: "Gemini (free tier)", classes: ["P0"], paid: false, secret: "GEMINI_API_KEY" },
    workersai: { label: "Cloudflare Workers AI", classes: ["P0", "P1"], paid: false, secret: "AI binding" },
    claude: { label: "Claude API (paid)", classes: ["P0", "P1"], paidClasses: ["P2"], paid: true, secret: "ANTHROPIC_API_KEY" },
    compat: { label: "Other provider (OpenAI-style API)", classes: ["P0"], paid: true, secret: "AI_COMPAT_API_KEY" },
  };
  const TASKS = {
    extract: { label: "Read facts from public pages", cls: "P0" },
    explain: { label: "Two-sentence explanations", cls: "P0" },
    draft: { label: "Draft headlines and captions", cls: "P0" },
    route: { label: "Turn a question into a stored query", cls: "P0" },
    reason: { label: "Summaries of internal figures", cls: "P1" },
  };
  const DEFAULT_AICFG = {
    version: 0,
    tasks: { extract: { provider: "gemini", fallback: "" }, explain: { provider: "gemini", fallback: "" }, draft: { provider: "gemini", fallback: "" }, route: { provider: "gemini", fallback: "" }, reason: { provider: "", fallback: "" } },
    providers: { gemini: { on: true, model: "" }, workersai: { on: false, model: "", dailyCalls: 0 }, claude: { on: false, model: "", dailyCalls: 0, allowP2: false }, compat: { on: false, model: "", dailyCalls: 0 } },
    updatedAt: null, updatedBy: null,
  };
  const intIn = (v, d, lo, hi) => { const x = parseInt(v, 10); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  const model = (s) => String(s == null ? "" : s).replace(/[^A-Za-z0-9._:/@-]/g, "").slice(0, 120);
  function aicfgOf(doc) {
    const d = doc || {}, out = { version: intIn(d.version, 0, 0, 1e6), tasks: {}, providers: {}, updatedAt: d.updatedAt || null, updatedBy: d.updatedBy || null };
    for (const k of Object.keys(PROVIDERS)) {
      const p = (d.providers || {})[k] || {}, def = DEFAULT_AICFG.providers[k];
      out.providers[k] = { on: p.on === undefined ? def.on : p.on === true, model: model(p.model) };
      if (k !== "gemini") out.providers[k].dailyCalls = intIn(p.dailyCalls, 0, 0, 100000);
      if (k === "claude") out.providers[k].allowP2 = p.allowP2 === true;
    }
    for (const k of Object.keys(TASKS)) {
      const t = (d.tasks || {})[k] || {}, def = DEFAULT_AICFG.tasks[k];
      const pick = (v, dv) => (v === "" ? "" : PROVIDERS[v] ? v : dv);
      out.tasks[k] = { provider: pick(t.provider, def.provider), fallback: pick(t.fallback, def.fallback) };
    }
    return out;
  }
  /** May this provider receive data of this class? P3 never goes to any provider. */
  function classAllowed(provider, cls, cfg) {
    const p = PROVIDERS[provider]; if (!p || !DATA_CLASSES[cls] || cls === "P3") return false;
    if (p.classes.includes(cls)) return true;
    return !!(p.paidClasses && p.paidClasses.includes(cls) && cfg && cfg.providers[provider] && cfg.providers[provider].allowP2);
  }
  /** The providers to try for a task, in order, each with its model, or {error}. Only switched-on providers allowed for the class. */
  function routeFor(task, cls, cfg) {
    const t = TASKS[task]; if (!t) return { error: `Unknown AI task "${task}".` };
    if (!DATA_CLASSES[cls]) return { error: `Unknown data class "${cls}".` };
    if (cls === "P3") return { error: "Personal data is never sent to an AI provider." };
    const c = aicfgOf(cfg), plan = [], seen = new Set();
    for (const p of [c.tasks[task].provider, c.tasks[task].fallback]) {
      if (!p || seen.has(p)) continue; seen.add(p);
      if (!c.providers[p].on) continue;
      if (!classAllowed(p, cls, c)) continue;
      plan.push({ provider: p, model: c.providers[p].model });
    }
    if (!plan.length) return { error: `No switched-on AI provider may do "${t.label}" with ${cls} data. Choose one under AI routing.` };
    return { plan };
  }

  /* ---------------- project stages (the engine's list; Project Radar keeps its own for now) ---------------- */
  const STAGES = [
    ["announced", "Announced / planning"], ["design", "Design"], ["tender", "Tender / procurement"], ["construction", "Under construction"],
    ["finishing", "Landscape and finishing works"], ["handover", "Near handover"], ["preopening", "Pre-opening"], ["operating", "Operating (upgrade)"], ["unknown", "Unknown"]];
  const STAGE_KEYS = STAGES.map((s) => s[0]);
  const stageOf = (v) => { const s = String(v || "").trim().toLowerCase(); return STAGES.find(([k, l]) => k === s || l.toLowerCase() === s) ? STAGES.find(([k, l]) => k === s || l.toLowerCase() === s)[0] : "unknown"; };

  /* Customer types: the same keys as the Growth Center's segments (app/growth.js SEGMENTS), so one vocabulary is used. */
  const CUSTOMER_TYPES = [["developer", "Real-estate developers"], ["compound", "Residential compounds"], ["school", "International & private schools"], ["club", "Clubs & sports facilities"],
    ["hotel", "Hotels & resorts"], ["operator", "Amusement & entertainment operators"], ["consultant", "Architects & landscape consultants"], ["contractor", "Contractors & procurement"],
    ["mall", "Shopping malls"], ["government", "Government & municipalities"], ["other", "Other"]];

  /* ---------------- timing settings (stored in mix/enginecfg) ---------------- */
  const CATEGORY_KEYS = () => (root.DPMiEngine ? root.DPMiEngine.CATEGORIES.map((c) => c[0]) : []);
  const dayCount = (v, max) => (v === null || v === undefined || v === "" ? null : (Number.isInteger(+v) && +v >= 0 && +v <= max ? +v : undefined));
  /** Blank stays blank (null): a missing figure is shown as missing, never filled with a guess. */
  function timingOf(cfg) {
    const c = cfg || {}, out = { leadTimes: {}, salesCycle: {}, stageOpening: {}, safetyDays: null, periodEnd: null };
    for (const k of CATEGORY_KEYS()) { const v = dayCount((c.leadTimes || {})[k], 730); out.leadTimes[k] = v === undefined ? null : v; }
    for (const [k] of CUSTOMER_TYPES) { const v = dayCount((c.salesCycle || {})[k], 1095); out.salesCycle[k] = v === undefined ? null : v; }
    for (const k of STAGE_KEYS) { if (k === "unknown") continue; const v = dayCount((c.stageOpening || {})[k], 3650); out.stageOpening[k] = v === undefined ? null : v; }
    const s = dayCount(c.safetyDays, 365); out.safetyDays = s === undefined ? null : s;
    out.periodEnd = validDay(c.periodEnd) ? c.periodEnd : null;
    return out;
  }
  /** Problems in a timing patch before it is saved (null when fine). */
  function validateTiming(t) {
    const bad = (obj, max) => Object.entries(obj || {}).find(([, v]) => dayCount(v, max) === undefined);
    let b;
    if ((b = bad(t.leadTimes, 730))) return `Lead time for ${b[0]} must be a whole number of days from 0 to 730, or blank.`;
    if ((b = bad(t.salesCycle, 1095))) return `Sales cycle for ${b[0]} must be a whole number of days from 0 to 1095, or blank.`;
    if ((b = bad(t.stageOpening, 3650))) return `Days to opening for the ${b[0]} stage must be a whole number from 0 to 3650, or blank.`;
    if (dayCount(t.safetyDays, 365) === undefined) return "The safety margin must be a whole number of days from 0 to 365, or blank.";
    if (t.periodEnd && !validDay(t.periodEnd)) return "The target period end must be a date (YYYY-MM-DD), or blank.";
    return null;
  }
  const validDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T12:00:00Z").toISOString().slice(0, 10) === d;
  const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);

  /** Approach-by date and window for one opportunity. A calculation, never AI.
   *  input: { opening (YYYY-MM-DD, published), stage, stageSince (YYYY-MM-DD, when the stage was evidenced), category, customerType }
   *  Returns { window, opening, openingBasis, latestOrder, approachBy, fitsPeriod, basis:[lines], missing:[lines] }.
   *  window: early | open | lastcall | closed | unknown. */
  function approachBy(input, cfg, today) {
    const T = timingOf(cfg), i = input || {}, basis = [], missing = [], st = stageOf(i.stage);
    let opening = null, openingBasis = null;
    if (validDay(i.opening)) { opening = i.opening; openingBasis = "published"; basis.push(`Opening ${opening}, as published.`); }
    else if (st !== "unknown" && T.stageOpening[st] != null) {
      const from = validDay(i.stageSince) ? i.stageSince : today;
      opening = addDays(from, T.stageOpening[st]); openingBasis = "estimate";
      basis.push(`Opening estimated: ${T.stageOpening[st]} days after the ${STAGES.find((s) => s[0] === st)[1].toLowerCase()} stage (${from}). Estimate.`);
    } else missing.push(st === "unknown" ? "No opening date and no known stage." : `No opening date, and no days-to-opening figure for the ${st} stage.`);
    const lead = T.leadTimes[i.category], cycle = T.salesCycle[i.customerType];
    if (lead == null) missing.push(i.category ? `No lead time entered for ${i.category}.` : "No product category.");
    if (cycle == null) missing.push(i.customerType ? `No sales cycle entered for ${i.customerType}.` : "No customer type.");
    if (T.safetyDays == null) missing.push("No safety margin entered.");
    const out = { window: "unknown", opening, openingBasis, latestOrder: null, approachBy: null, fitsPeriod: null, basis, missing };
    if (!opening || lead == null || T.safetyDays == null) return out;
    out.latestOrder = addDays(opening, -(lead + T.safetyDays));
    basis.push(`Latest order date: opening − ${lead} days lead time − ${T.safetyDays} days margin.`);
    if (cycle == null) { out.window = diffDays(today, out.latestOrder) < 0 ? "closed" : "unknown"; return out; }
    out.approachBy = addDays(out.latestOrder, -cycle);
    basis.push(`Approach by: latest order date − ${cycle} days sales cycle.`);
    const toApproach = diffDays(today, out.approachBy), toOrder = diffDays(today, out.latestOrder);
    out.window = toOrder < 0 ? "closed" : toApproach < 0 ? "lastcall" : toApproach <= 90 ? "open" : "early";
    if (T.periodEnd) out.fitsPeriod = diffDays(addDays(today, cycle), T.periodEnd) >= 0;
    return out;
  }
  const WINDOWS = { early: "Early", open: "Open", lastcall: "Last call", closed: "Closed", unknown: "Unknown" };

  /* ---------------- search credit envelopes (stored in mix/enginecfg.envelopes) ---------------- */
  const STREAMS = [["jobs", "Scheduled research (news, currency, opportunities, materials, weekly)"], ["leads", "Lead and contact research"], ["topic", "Topic research"]];
  function envelopesOf(cfg) {
    const e = (cfg && cfg.envelopes) || {}, out = {};
    for (const [k] of STREAMS) { const v = e[k]; out[k] = v === null || v === undefined || v === "" ? null : Number.isInteger(+v) && +v >= 0 && +v <= 1000000 ? +v : null; }
    return out;
  }
  function validateEnvelopes(e, monthCap) {
    for (const [k, v] of Object.entries(e || {})) if (!(v === null || v === "" || (Number.isInteger(+v) && +v >= 0 && +v <= 1000000))) return `The share for ${k} must be a whole number of credits, or blank.`;
    const sum = Object.values(e || {}).reduce((a, v) => a + (v === null || v === "" ? 0 : +v), 0);
    if (monthCap != null && sum > monthCap) return `The shares add up to ${sum} credits, more than the monthly cap of ${monthCap}.`;
    return null;
  }

  const api = { FLAGS, flagsOf, DATA_CLASSES, PROVIDERS, TASKS, DEFAULT_AICFG, aicfgOf, classAllowed, routeFor, STAGES, STAGE_KEYS, stageOf, CUSTOMER_TYPES,
    timingOf, validateTiming, approachBy, WINDOWS, STREAMS, envelopesOf, validateEnvelopes, validDay, addDays };
  root.DPCi = api;
})(typeof self !== "undefined" ? self : globalThis);
