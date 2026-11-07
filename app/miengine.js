/* X FORCE — Market Intelligence 2.0 engine: pure functions shared by the app, the Worker and the tests. No storage, no DOM.
   Plan: MARKET_INTELLIGENCE_2_PLAN.md (kept outside the repository).

   config/settings.miEngine   the switch. Off (or missing) = every research path behaves exactly as before.
   mix/enginecfg              versioned engine settings (administrators only)
   mix/enginev/v/<n>          every earlier version of those settings
   mix/alias/a/<id>           one organisation's English and Arabic names

   This repository is public, so nothing commercial belongs here: the code starts with every category "Not confirmed" and the
   administrator's real answers live in the database. */
(function (root) {
  "use strict";

  /* ---------------- product capability ---------------- */
  const CATEGORIES = [
    ["playground", "Outdoor playground equipment"], ["school", "School playgrounds and educational play"], ["furniture", "Outdoor furniture"], ["custom", "Custom playground and leisure solutions"],
    ["flooring", "Safety flooring"], ["indoor", "Indoor playgrounds and soft play"], ["amusement", "Amusement parks and water parks"], ["sports", "Sports and fitness equipment"],
    ["resort", "Resort, hotel and beach furniture"], ["umbrellas", "Umbrellas and leisure products"]];
  const STATUSES = {
    core: { label: "Core", effect: "Scores fully. Can go to sales." },
    supplier: { label: "Supplier-backed", effect: "Scores. A supplier check comes first." },
    inbound: { label: "Inbound only", effect: "Recorded and sent to an administrator. No outreach." },
    notsold: { label: "Not sold", effect: "Excluded, with the reason recorded." },
    unset: { label: "Not confirmed", effect: "Counts as no product fit until an administrator decides." },
  };
  const DEFAULT_CFG = { version: 0, capability: {}, personalMin: 20, enrichPerDay: 8, stepsPerRun: 2, updatedAt: null, updatedBy: null };
  const intIn = (v, d, lo, hi) => { const x = parseInt(v, 10); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  /** A stored settings document (or nothing) with every default filled in. Unknown statuses count as "Not confirmed". */
  function cfgOf(doc) {
    const d = Object.assign({}, DEFAULT_CFG, doc || {}), cap = {};
    for (const [k] of CATEGORIES) { const v = (d.capability || {})[k]; cap[k] = STATUSES[v] ? v : "unset"; }
    d.capability = cap;
    d.personalMin = intIn(d.personalMin, DEFAULT_CFG.personalMin, 1, 1000);
    d.enrichPerDay = intIn(d.enrichPerDay, DEFAULT_CFG.enrichPerDay, 0, 50);   // leads researched per day (about 2 search credits each)
    d.stepsPerRun = intIn(d.stepsPerRun, DEFAULT_CFG.stepsPerRun, 1, 10);       // research steps per hourly run (Workers Free: keep small)
    return d;
  }

  /* ---------------- text that works in English and Arabic ---------------- */
  /** Lower case, accents and Arabic vowel marks removed, Arabic letter forms folded (أ إ آ → ا, ة → ه, ى → ي), Arabic digits → 0-9. */
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ًͯ-ٰٟـ]/g, "")
      .replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).toLowerCase();
  }
  const EN_STOP = /\b(the|a|an|of|for|and|in|at|by|project|new|company|co|ltd|s\.a\.e|sae|llc|group|developments?)\b/g;
  const AR_STOP = new Set(["شركه", "مجموعه", "مشروع", "جديد", "جديده", "في", "من", "الي", "علي", "عن", "و", "للتطوير", "العقاري", "العقاريه"].map(fold));
  /** A name reduced for comparing. Plain English text gives exactly the same result as the older worker/intel.js norm(), so ids of
   *  English records do not change; Arabic letters are kept instead of being removed. */
  function normName(s) {
    const t = fold(s).replace(EN_STOP, " ").replace(/[^a-z0-9ء-ي]+/g, " ").trim();
    return t.split(/\s+/).filter((w) => w && !AR_STOP.has(w)).map((w) => (/^ال[ء-ي]{3,}/.test(w) ? w.slice(2) : w)).join(" ");
  }
  const WORD = new Map();
  /** True when `word` stands as a whole word (a plural counts): "park" is in "parks", never in "parking". Arabic words also match
   *  with their attached prefixes (و ب ل ف ال لل). `text` must already have been through fold(). */
  function hasWord(text, word) {
    let re = WORD.get(word);
    if (!re) {
      const w = fold(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      re = /[ء-ي]/.test(w) ? new RegExp(`(?<![\\p{L}\\p{N}])(?:[وبلف])?(?:ال|لل)?${w}(?:ات|ين|ون)?(?![\\p{L}\\p{N}])`, "u")
        : new RegExp(`(?<![\\p{L}\\p{N}])${w}(?:s|es)?(?![\\p{L}\\p{N}])`, "u");
      WORD.set(word, re);
    }
    return re.test(text);
  }

  /* ---------------- organisation names ---------------- */
  /** alias documents → {normalised name: canonical name} */
  function aliasIndex(docs) {
    const out = {};
    for (const d of Object.values(docs || {})) {
      if (!d || !d.canonical) continue;
      for (const n of [d.canonical].concat(Array.isArray(d.names) ? d.names : [])) { const k = normName(n); if (k) out[k] = d.canonical; }
    }
    return out;
  }
  const canon = (name, index) => (index && index[normName(name)]) || name;

  /* ---------------- data readiness: what the records can support ---------------- */
  const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : null);
  /** counts (worker/readiness.js) → one line per planned calculation: ready | partial | none, and why. Counts only, no names. */
  function verdicts(c, cfg) {
    const min = cfgOf(cfg).personalMin, s = (c.sellers && c.sellers.active) || 0, out = [];
    const person = (key, label, n, have, thing) => {
      const state = !s ? "none" : n >= s ? "ready" : n > 0 ? "partial" : "none";
      out.push({ key, label, state, text: !s ? "No active salespeople found." : `${n} of ${s} salespeople have at least ${min} ${thing} (${have} recorded in all). The others use the company assumption.` });
    };
    person("calls", "Call → conversation", c.sellers.enoughCalls, c.acts.calls, "logged calls");
    person("conv", "Conversation → meeting", c.sellers.enoughConversations, c.acts.conversations, "conversations");
    person("meet", "Meeting → quotation", c.sellers.enoughMeetings, c.acts.meetings, "meetings");
    person("quote", "Quotation → contract", c.sellers.enoughDecided, c.quotes.decided, "decided quotations");
    const linked = pctOf(c.quotes.withLead, c.quotes.total);
    out.push({ key: "link", label: "Quotations linked to a lead", state: linked == null ? "none" : linked >= 80 ? "ready" : linked >= 40 ? "partial" : "none",
      text: linked == null ? "No quotations recorded yet." : `${c.quotes.withLead} of ${c.quotes.total} (${linked}%). Unlinked quotations cannot count in lead-to-quotation rates or sales cycles.` });
    out.push({ key: "deal", label: "Average deal size", state: !c.quotes.accepted ? "none" : c.sellers.enoughDeals >= s && s ? "ready" : "partial",
      text: `${c.quotes.accepted} accepted orders. ${c.sellers.enoughDeals} of ${s} salespeople have at least 5.` });
    out.push({ key: "target", label: "Individual targets this month", state: !s ? "none" : c.targets.individual >= s ? "ready" : c.targets.individual ? "partial" : "none",
      text: `${c.targets.individual} of ${s} salespeople have their own target for ${c.month}. The others use the company default.` });
    const held = c.acts.meetingStatus;
    out.push({ key: "held", label: "Meetings held versus scheduled", state: !c.acts.meetings ? "none" : "partial",
      text: `${c.acts.meetingsHeld} logged as meetings, ${c.acts.meetingsScheduled} logged with the outcome Meeting Scheduled${held ? `, ${held} with the new status` : ""}. Today one meeting can count under both.` });
    const lost = pctOf(c.crm.lostWithReason, c.crm.lost);
    out.push({ key: "lost", label: "Reasons for lost deals", state: lost == null ? "none" : lost >= 80 ? "ready" : "partial", text: lost == null ? "No lost deals recorded yet." : `${c.crm.lostWithReason} of ${c.crm.lost} have a reason (free text).` });
    out.push({ key: "contact", label: "Verified lead contacts", state: !c.leads.total ? "none" : c.contacts.verified >= c.leads.total * 0.5 ? "ready" : c.contacts.verified ? "partial" : "none",
      text: `${c.contacts.verified} of ${c.leads.total} leads have a verified phone or e-mail.` });
    out.push({ key: "assign", label: "Territory and expertise", state: !s ? "none" : c.sellers.withProfile >= s ? "ready" : c.sellers.withProfile ? "partial" : "none",
      text: `${c.sellers.withProfile} of ${s} salespeople have a sales profile. Needed by Phase 5.` });
    return out;
  }

  /* ---------------- Phase 2a: ranking the existing Lead Mine ---------------- */
  const ORG_REL = { developer: 15, park: 15, fec: 15, school: 14, hotel: 13, club: 12, mall: 12, investor: 11, government: 9, contractor: 8, consultant: 8, other: 4 };
  const ACTIVE = ["handover", "construction", "launch", "launched", "tender", "phase", "expansion", "opening", "master plan", "new project", "تسليم", "انشاء", "طرح", "مناقصه", "مرحله", "افتتاح", "توسعه"];
  const GEO = {
    target: ["new cairo", "new zayed", "sheikh zayed", "north coast", "sahel", "alamein", "ain sokhna", "sokhna", "6th of october", "october", "new capital", "administrative capital", "mostakbal", "ras el hekma", "galala", "hurghada", "el gouna", "sharm", "madinaty", "shorouk",
      "القاهره الجديده", "الشيخ زايد", "الساحل الشمالي", "العلمين", "العين السخنه", "اكتوبر", "العاصمه الاداريه", "راس الحكمه", "الغردقه", "الجونه", "مدينتي", "الشروق"],
    egypt: ["egypt", "cairo", "giza", "alexandria", "matrouh", "suez", "ismailia", "luxor", "aswan", "مصر", "القاهره", "الجيزه", "الاسكندريه"],
    near: ["saudi", "ksa", "riyadh", "jeddah", "uae", "dubai", "abu dhabi", "qatar", "doha", "kuwait", "oman", "bahrain", "jordan", "libya", "السعوديه", "الامارات", "دبي", "قطر"] };
  const DATE_IN = /\b(20\d\d)-(\d\d)(?:-(\d\d))?\b/g;
  /** The newest date written anywhere in the lead's evidence (a "2026-05-03 / 2026-08-26" field counts as its later date). */
  function newestDate(lead) {
    const texts = [lead.sourceDate].concat((lead.sources || []).map((s) => s && s.date)).filter(Boolean).map(String); let best = null;
    for (const t of texts) for (const m of t.matchAll(DATE_IN)) { const v = Date.parse(`${m[1]}-${m[2]}-${m[3] || "01"}T00:00:00Z`); if (Number.isFinite(v) && (best == null || v > best)) best = v; }
    return best;
  }
  /** Which existing leads deserve research first, and why. Explainable: every point has its reason. Never a probability. */
  function rankLead(lead, now = Date.now()) {
    const parts = [], add = (k, label, pts, max, why) => parts.push({ k, label, pts: Math.max(0, Math.min(max, Math.round(pts))), max, why });
    const ct = lead.contact || {}, web = lead.website || "", text = fold([lead.evidence, lead.projects, lead.why].filter(Boolean).join(" ")), loc = fold(lead.location || "");
    const rel = ORG_REL[lead.orgType] != null ? ORG_REL[lead.orgType] : 4, fit = String(lead.productsFit || "").trim();
    add("fit", "Product fit", rel + (fit ? 10 : 0), 25, `${lead.orgType || "type unknown"}${fit ? `; fit noted: ${fit.slice(0, 60)}` : "; no product fit noted"}`);
    const n = (lead.sources || []).filter((s) => s && s.url).length, act = ACTIVE.filter((w) => hasWord(text, w));
    add("evidence", "Evidence of activity", (n >= 2 ? 12 : n ? 8 : 0) + (act.length ? 8 : 0), 20, `${n} source link(s)${act.length ? `; mentions ${act.slice(0, 3).join(", ")}` : "; no current activity mentioned"}`);
    const s = Number(lead.score);
    add("qual", "Earlier qualification", Number.isFinite(s) && lead.score !== null && lead.score !== "" ? s * 0.2 : 0, 20, Number.isFinite(s) && lead.score !== null && lead.score !== "" ? `Qualification score ${Math.round(s)} of 100` : "Not scored yet");
    const g = GEO.near.some((a) => hasWord(loc, a)) ? [3, "Outside Egypt"] : GEO.target.some((a) => hasWord(loc, a)) ? [10, "Priority sales area"] : GEO.egypt.some((a) => hasWord(loc, a)) ? [7, "Egypt, outside the priority areas"] : [loc ? 2 : 0, loc ? "Location unclear" : "No location"];
    add("geo", "Location", g[0], 10, g[1]);
    add("reach", "Ways to reach", (web ? 4 : 0) + (ct.phone ? 3 : 0) + (ct.email ? 3 : 0), 10, [web ? "website known" : "no website", ct.phone ? "phone recorded" : "no phone", ct.email ? "e-mail recorded" : "no e-mail"].join(", "));
    const d = newestDate(lead), months = d == null ? null : (now - d) / (30.44 * 864e5);
    add("recency", "Freshness of evidence", months == null ? 0 : months <= 6 ? 10 : months <= 12 ? 6 : 2, 10, months == null ? "No dated evidence" : `Newest evidence about ${Math.max(0, Math.round(months))} month(s) old`);
    const missing = [].concat(web ? [] : ["website"], ct.phone || ct.email ? [] : ["contact route"], n ? [] : ["source"], fit ? [] : ["product fit"], loc ? [] : ["location"], months != null && months <= 12 ? [] : ["recent evidence"]);
    const next = !web ? "Find the official website" : !(ct.phone || ct.email) ? "Find a published phone number or e-mail on the official website" : months == null || months > 12 ? "Check for current projects" : "Ready for a salesperson: verify the contact";
    return { score: parts.reduce((a, p) => a + p.pts, 0), parts, missing, next };
  }

  /* ---------------- Phase 2a: reading contact routes from a page, without AI ---------------- */
  const hostOf = (u) => { const m = /^https?:\/\/(?:www\.)?([^/:?#]+)/i.exec(String(u || "").trim()); return m ? m[1].toLowerCase() : ""; };
  const NOT_OFFICIAL = ["facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "wikipedia.org", "nawy.com", "aqarmap.com.eg", "aqarmap.com", "propertyfinder.eg", "bayut.eg", "olx.com.eg", "dubizzle.com.eg",
    "google.com", "zawya.com", "dailynewsegypt.com", "ahram.org.eg", "enterprise.press", "enterpriseam.com", "egypttoday.com", "youm7.com", "masrawy.com", "tendersarabia.com", "meed.com", "crunchbase.com", "yellowpages.com.eg", "glassdoor.com", "wuzzuf.net"];
  const blocked = (h) => !h || NOT_OFFICIAL.some((b) => h === b || h.endsWith("." + b));
  /** The organisation's own website: the lead's recorded website, else a search result whose address carries the name. */
  function officialSite(results, name, website) {
    const w = hostOf(website); if (w && !blocked(w)) return { host: w, how: "From the lead record", probable: false };
    const key = normName(name).split(" ").filter((t) => /^[a-z0-9]{4,}$/.test(t)), whole = key.join("");
    for (const r of results || []) {
      const h = hostOf(r.url); if (blocked(h)) continue; const label = h.split(".")[0];
      if ((whole.length >= 4 && label.includes(whole)) || key.some((t) => t.length >= 5 && label.includes(t))) return { host: h, how: "Its address matches the organisation's name: check it", probable: true };
    }
    return null;
  }
  const near = (text, i, len) => text.slice(Math.max(0, i - 70), i + len + 70).replace(/\s+/g, " ").trim();
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  // Egyptian numbers only, written with their leading 0 or +20: mobile 01x + 8 digits, Cairo 02 + 8, Alexandria 03 + 7
  const PHONE = /(?<![\d+])(?:(?:\+|00)20[\s.-]?\(?0?|\(?0)(?:1[0125]\)?(?:[\s.-]?\d){8}|2\)?(?:[\s.-]?\d){8}|3\)?(?:[\s.-]?\d){7})(?!\d)/g;
  const HOTLINE = /(?:hotline|call us|الخط الساخن|خط ساخن)[^0-9]{0,20}(1\d{4})(?!\d)/gi;   // pages often put the number on the next line
  /** Published e-mail addresses and phone numbers found on one page, each with the exact sentence around it. No names of people. */
  function contactRoutes(text, url, officialHost) {
    const raw = String(text || ""), t = raw.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)), out = [], seen = new Set();
    for (const m of t.matchAll(EMAIL)) {
      const v = m[0].replace(/\.+$/, "").toLowerCase(), dom = v.split("@")[1];
      if (/\.(png|jpe?g|gif|webp|svg)$/.test(v) || /(example|sentry|wixpress|domain|email)\.com$/.test(dom) || seen.has(v)) continue;
      seen.add(v); const own = !!officialHost && (dom === officialHost || dom.endsWith("." + officialHost) || officialHost.endsWith("." + dom));
      out.push({ kind: "email", value: v, own, sourceUrl: url, quote: near(raw, m.index, m[0].length) });
    }
    const phone = (shown, i, len) => { const d = shown.replace(/\D/g, ""), k = d.replace(/^(00)?20/, "0").replace(/^(?=[123]\d{7,9}$)/, "0"); if (k.length < 5 || seen.has(k)) return; seen.add(k); out.push({ kind: "phone", value: shown.trim(), key: k, sourceUrl: url, quote: near(raw, i, len) }); };
    for (const m of t.matchAll(PHONE)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 9) phone(m[0], m.index, m[0].length); }
    for (const m of t.matchAll(HOTLINE)) phone(m[1], m.index + m[0].lastIndexOf(m[1]), m[1].length);
    return out.slice(0, 12);
  }
  /** True when the quoted sentence really appears in the source text (spacing, case and Arabic letter forms ignored). */
  function quoteFound(quote, text) {
    const q = fold(quote).replace(/["'“”‘’«»]/g, "").replace(/\s+/g, " ").trim();
    return q.length >= 12 && fold(text).replace(/["'“”‘’«»]/g, "").replace(/\s+/g, " ").includes(q);
  }

  const api = { CATEGORIES, STATUSES, DEFAULT_CFG, cfgOf, fold, normName, hasWord, aliasIndex, canon, verdicts, rankLead, newestDate, hostOf, officialSite, contactRoutes, quoteFound };
  root.DPMiEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
