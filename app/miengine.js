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
  const DEFAULT_CFG = { version: 0, capability: {}, personalMin: 20, updatedAt: null, updatedBy: null };
  /** A stored settings document (or nothing) with every default filled in. Unknown statuses count as "Not confirmed". */
  function cfgOf(doc) {
    const d = Object.assign({}, DEFAULT_CFG, doc || {}), cap = {};
    for (const [k] of CATEGORIES) { const v = (d.capability || {})[k]; cap[k] = STATUSES[v] ? v : "unset"; }
    d.capability = cap;
    const m = parseInt(d.personalMin, 10); d.personalMin = Number.isFinite(m) && m >= 1 ? Math.min(m, 1000) : DEFAULT_CFG.personalMin;
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

  const api = { CATEGORIES, STATUSES, DEFAULT_CFG, cfgOf, fold, normName, hasWord, aliasIndex, canon, verdicts };
  root.DPMiEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
