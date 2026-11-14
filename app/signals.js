/* X FORCE — Commercial Intelligence, Phase 1: signals. Pure functions shared by the Worker, the app and the tests. No storage, no network.
   Needs app/miengine.js (fold, hasWord, quoteFound) and app/geo-eg.js (locate) loaded first.

   A SIGNAL is one dated public sentence that gives an organisation a reason to buy, with its link. It is found by RULES, never invented:
   the quote is always a sentence taken from the source text, so it exists by construction. AI (Phase 1: optional) only adds the
   organisation, project and place, and each of those must itself appear in the source text.

     mi/sig/s/<id>          signals (staff can read: public text only, no money, no people)
     mix/sigcfg             feeds, watched pages, searches, extra phrases, limits (administrators only; versioned in mix/sigcfgv/v/<n>)
     mix/sigpage/p/<id>     what a watched page said last time (sentence fingerprints), to see what is new

   Trigger phrases below are starting points, public by nature. An administrator can add more per type in mix/sigcfg. */
(function (root) {
  "use strict";
  const E = () => root.DPMiEngine, G = () => root.DPGeo;

  /* ---------------- signal types: strength 0–5 and trigger phrases ---------------- */
  const TYPES = {
    award: { label: "Landscape or finishing works awarded", strength: 5,
      en: ["awarded the landscaping", "landscaping contract", "landscaping works", "landscape works", "landscaping package", "hardscape", "softscape", "finishing works contract"],
      ar: ["أعمال اللاندسكيب", "أعمال تنسيق الموقع", "تنسيق الحدائق", "إسناد أعمال", "ترسية أعمال", "أعمال التشطيبات"] },
    opening: { label: "Handover or opening date", strength: 5,
      en: ["handover", "hand over", "handing over", "deliveries", "delivery of units", "set to open", "will open", "soft opening", "grand opening", "inaugurated", "inauguration"],
      ar: ["تسليم الوحدات", "بدء التسليم", "التسليمات", "افتتاح", "يفتتح", "تفتتح", "الافتتاح"] },
    tender: { label: "Tender or request for quotations", strength: 5,
      en: ["tender", "invites bids", "invitation to bid", "request for proposals", "request for quotation", "bidding process"],
      ar: ["مناقصة", "مزايدة", "طرح كراسة", "كراسة الشروط", "ممارسة عامة", "ممارسة محدودة"] },
    construction: { label: "Construction contract or start", strength: 4,
      en: ["construction contract", "main contractor", "signed a contract", "groundbreaking", "construction began", "began construction", "begins construction", "start of construction", "construction works"],
      ar: ["عقد مقاولات", "المقاول الرئيسي", "حجر الأساس", "بدء أعمال الإنشاء", "عقد تنفيذ", "أعمال الإنشاءات"] },
    facility: { label: "Play, leisure or outdoor facility planned", strength: 4,
      en: ["kids area", "kids zone", "kids club", "children's play", "children's area", "playground", "play area", "clubhouse", "water park", "aqua park", "beach club", "theme park", "family entertainment", "central park", "green spaces", "landscaped"],
      ar: ["منطقة ألعاب", "ألعاب أطفال", "منطقة أطفال", "ملاهي", "كلوب هاوس", "النادي الاجتماعي", "حديقة مركزية", "مسطحات خضراء", "أكوا بارك", "حديقة مائية", "بيتش كلوب"],
      // an existing facility hosting an event is not a reason to buy: a word about building or planning must be in the same sentence
      needs: ["will", "plans", "planned", "to include", "includes", "including", "features", "will feature", "new", "under construction", "designed", "launch", "launches", "develop", "developing", "construction",
        "سيتم", "يضم", "تضم", "يشمل", "تشمل", "إنشاء", "جديد", "جديدة", "سوف", "يتضمن", "تطوير", "إطلاق"] },
    school: { label: "New school or campus", strength: 4,
      en: ["new school", "international school", "school campus", "new campus", "kindergarten", "nursery"],
      ar: ["مدرسة دولية", "مدرسة جديدة", "مدارس دولية", "حضانة", "روضة أطفال"],
      not: ["school year", "new school year", "back to school", "school days", "coral nursery", "plant nursery", "العام الدراسي"],
      // a school that already runs is not news: the sentence must be about opening, building or a new campus
      needs: ["new", "will open", "to open", "opening", "opens", "construction", "under construction", "launch", "launches", "planned", "plans", "inaugurat", "groundbreaking",
        "جديد", "جديدة", "افتتاح", "يفتتح", "تفتتح", "إنشاء", "تحت الإنشاء", "إطلاق"] },
    phase: { label: "New project or phase launched", strength: 3,
      en: ["new phase", "launches phase", "launched phase", "second phase", "third phase", "launches its", "launched its", "unveils", "new project"],
      ar: ["مرحلة جديدة", "المرحلة الثانية", "المرحلة الثالثة", "إطلاق مشروع", "إطلاق المرحلة", "مشروع جديد"] },
    renovation: { label: "Renovation or expansion", strength: 3,
      en: ["renovation", "refurbishment", "refurbish", "expansion of", "redevelopment", "upgrade of"],
      ar: ["إعادة تطوير", "تجديد", "رفع كفاءة", "توسعات", "أعمال تطوير"] },
    financing: { label: "Financing secured", strength: 3,
      en: ["financing", "loan facility", "secured a loan", "secures egp", "secures a", "investments worth", "capital increase"],
      ar: ["تمويل بقيمة", "قرض بقيمة", "استثمارات بقيمة", "زيادة رأس المال"] },
    land: { label: "Land acquired or allocated", strength: 1,
      en: ["land plot", "plot of land", "feddans", "acquires land", "acquired land", "land allocation", "allocated land"],
      ar: ["قطعة أرض", "فدان", "أفدنة", "تخصيص أرض", "تخصيص قطعة"],
      // a finished compound's size is not a land deal
      needs: ["acquire", "acquires", "acquired", "acquisition", "allocate", "allocates", "allocated", "allocation", "purchase", "purchased", "bought", "buys",
        "تخصيص", "شراء", "استحواذ", "يستحوذ", "تستحوذ", "خصصت"] },
  };
  const TYPE_KEYS = Object.keys(TYPES);
  /* A trigger counts only next to a word that ties it to the kind of place Dupedia supplies. */
  const RELEVANT = {
    en: ["compound", "residential", "community", "resort", "hotel", "school", "club", "park", "mall", "beach", "coastal", "north coast", "playground", "kids", "children",
      "landscape", "landscaping", "sports", "entertainment", "clubhouse", "villas", "chalets", "housing", "campus", "nursery", "kindergarten", "garden", "gardens", "leisure", "tourism", "tourist"],
    ar: ["كمبوند", "مجمع سكني", "سكني", "منتجع", "فندق", "مدرسة", "مدارس", "نادي", "حديقة", "حدائق", "مول", "شاطئ", "الساحل الشمالي", "ألعاب", "أطفال", "لاندسكيب",
      "رياضي", "ترفيهي", "فيلات", "شاليهات", "إسكان", "حضانة", "سياحي", "سياحية", "قرية سياحية"],
  };

  /* ---------------- source classes ---------------- */
  const SOCIAL = ["facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "linkedin.com", "youtube.com", "youtu.be", "threads.net", "t.me", "whatsapp.com"];
  const LISTING = ["propertyfinder.eg", "aqarmap.com.eg", "aqarmap.com", "nawy.com", "bayut.eg", "dubizzle.com.eg", "olx.com.eg", "hatla2ee.com", "sakneen.com", "theaddress.eg"];
  const hostOf = (u) => { const m = /^https?:\/\/(?:www\.)?([^/:?#]+)/i.exec(String(u || "").trim()); return m ? m[1].toLowerCase() : null; };
  const onDomain = (host, list) => !!host && list.some((d) => host === d || host.endsWith("." + d));
  /** official | organization | press | listing | social | other. `orgHosts` = websites of watched organisations. */
  function sourceClass(url, { orgHosts = [], pressHosts = [] } = {}) {
    const h = hostOf(url); if (!h) return "other";
    if (onDomain(h, SOCIAL)) return "social";
    if (onDomain(h, LISTING)) return "listing";
    if (/\.gov\.eg$|\.gov$|^gov\.eg$/.test(h) || onDomain(h, ["nuca.gov.eg", "gafi.gov.eg", "sis.gov.eg"])) return "official";
    if (onDomain(h, orgHosts)) return "organization";
    if (onDomain(h, pressHosts)) return "press";
    return "other";
  }

  /* ---------------- text ---------------- */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };
  const decode = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? (() => { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; })() : ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m);
  /** Visible text of an HTML page or fragment: scripts, styles, menus and tags removed, entities decoded, spaces collapsed. */
  function htmlText(html) {
    return decode(String(html || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*$/i, " ")   // one cut off by the size limit, never closed
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, ". ").replace(/<[^>]+>/g, " ")).replace(/[ \t\r\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/(\.\s*){2,}/g, ". ").trim();
  }
  /** Sentences of at least 25 characters, at most 400 (longer ones are cut at a word). */
  const CODE = /\\u[0-9a-f]{4}|\{"|"\}|":\s*["\[{\d]|<\/?[a-z]|=>|\bfunction\s*\(/i;
  /** Mostly letters and spaces (script data and markup left in a page fail this). */
  const prose = (s) => !CODE.test(s) && (s.match(/[\p{L}\s]/gu) || []).length / s.length >= 0.75;
  function sentences(text) {
    return String(text || "").split(/(?<=[.!?؟])\s+|\n+|\s+[|•·]\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 25 && prose(s))
      .map((s) => (s.length > 400 ? s.slice(0, 400).replace(/\s+\S*$/, "") : s));
  }
  /** A short, stable fingerprint (FNV-1a, 32 bit) — enough to tell sentences apart on one page. */
  function fnv(s) { let h = 0x811c9dc5; const t = String(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); }
  const normQ = (q) => E().fold(q).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  /** A signal's id: the same sentence from the same page is always the same signal. */
  const sigId = (url, quote) => "s" + fnv(String(url || "").replace(/[#?].*$/, "").toLowerCase()) + fnv(normQ(quote));

  /* ---------------- RSS and Atom ---------------- */
  const tag = (x, n) => { const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, "i").exec(x); return m ? decode(m[1]).trim() : ""; };
  const attrHref = (x) => { const m = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(x); return m ? decode(m[1]) : ""; };
  /** Items of an RSS or Atom feed: {title, url, date (YYYY-MM-DD or null), text}. At most 60. */
  function parseFeed(xml) {
    const s = String(xml || ""), blocks = s.match(/<item\b[\s\S]*?<\/item>/gi) || s.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    return blocks.slice(0, 60).map((b) => {
      const url = (tag(b, "link") || attrHref(b) || tag(b, "guid")).trim(), d = Date.parse(tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date"));
      return { title: htmlText(tag(b, "title")).slice(0, 300), url, date: Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null, text: htmlText(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content")).slice(0, 3000) };
    }).filter((i) => /^https?:\/\//i.test(i.url) && (i.title || i.text));
  }

  /* ---------------- robots.txt ---------------- */
  /** The rules for our agent: the most specific group that names it, else "*". Returns [{allow, path}]. */
  function robotsRules(txt, agent = "xforce-research") {
    const groups = []; let cur = null, lastWasAgent = false;
    for (const raw of String(txt || "").split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
      const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "user-agent") { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
      lastWasAgent = false; if (!cur) continue;
      if (k === "disallow" || k === "allow") cur.rules.push({ allow: k === "allow", path: v });
    }
    const mine = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a))) || groups.find((g) => g.agents.includes("*"));
    return mine ? mine.rules.filter((r) => r.path) : [];
  }
  const ruleRe = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  /** Is this path allowed? The longest matching rule wins; on a tie, allow wins. */
  function robotsAllows(rules, path) {
    let best = null;
    for (const r of rules) if (ruleRe(r.path).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    return !best || best.allow;
  }

  /* ---------------- settings ---------------- */
  const SEARCH_AREAS = [["newcairo", "New Cairo", "القاهرة الجديدة"], ["zayed", "Sheikh Zayed", "الشيخ زايد"], ["october", "6th of October", "السادس من أكتوبر"], ["northcoast", "North Coast", "الساحل الشمالي"],
    ["sokhna", "Ain Sokhna", "العين السخنة"], ["nac", "New Administrative Capital", "العاصمة الإدارية"], ["redsea", "Hurghada", "الغردقة"], ["alexandria", "Alexandria", "الإسكندرية"]];
  const SEARCH_TYPES = [["developer", "new compound handover OR launch OR landscaping", "كمبوند جديد تسليم أو إطلاق"], ["school", "new international school campus", "مدرسة دولية جديدة"],
    ["hotel", "new resort OR hotel opening", "افتتاح منتجع أو فندق جديد"], ["club", "new sports club OR social club", "نادي اجتماعي رياضي جديد"]];
  const DEFAULT_CFG = { version: 0, feeds: [], watch: [], phrases: {}, searchesPerDay: 0, searchAreas: SEARCH_AREAS.map((a) => a[0]), searchTypes: SEARCH_TYPES.map((t) => t[0]), searchLangs: ["en", "ar"],
    stepsPerRun: 2, maxPageKb: 200, pressHosts: [] };
  const SUGGESTED_FEEDS = [
    { url: "https://www.dailynewsegypt.com/feed/", label: "Daily News Egypt", lang: "en" }, { url: "https://www.egyptdailynews.com/feed/", label: "Egypt Daily News", lang: "en" },
    { url: "https://www.almasryalyoum.com/rss/rssfeeds", label: "Al-Masry Al-Youm", lang: "ar" }, { url: "https://www.elaosboa.com/feed/", label: "El Aosboa", lang: "ar" }];   // each answered with a current feed and allowed it in robots.txt on 14 Nov 2026
  const intIn = (v, d, lo, hi) => { const x = parseInt(v, 10); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  const goodUrl = (u) => { try { const x = new URL(String(u)); return (x.protocol === "https:" || x.protocol === "http:") && !!x.hostname; } catch (e) { return false; } };
  const clip = (s, n) => String(s == null ? "" : s).trim().slice(0, n);
  const idOk = (x) => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x);
  function cfgOf(doc) {
    const d = doc || {}, out = Object.assign({}, DEFAULT_CFG, { version: intIn(d.version, 0, 0, 1e6), updatedAt: d.updatedAt || null, updatedBy: d.updatedBy || null });
    out.feeds = (Array.isArray(d.feeds) ? d.feeds : []).filter((f) => f && idOk(f.id) && goodUrl(f.url)).slice(0, 40)
      .map((f) => ({ id: f.id, url: clip(f.url, 500), label: clip(f.label, 80) || hostOf(f.url), lang: f.lang === "ar" ? "ar" : "en", on: f.on !== false, everyHours: intIn(f.everyHours, 6, 1, 168), cls: ["press", "official", "organization", "other"].includes(f.cls) ? f.cls : "press" }));
    out.watch = (Array.isArray(d.watch) ? d.watch : []).filter((w) => w && idOk(w.id) && Array.isArray(w.urls)).slice(0, 80)
      .map((w) => ({ id: w.id, org: clip(w.org, 160), urls: w.urls.filter(goodUrl).slice(0, 3).map((u) => clip(u, 500)), leadId: w.leadId && /^[A-Za-z0-9_\-.~:@+]{1,120}$/.test(w.leadId) ? w.leadId : null, on: w.on !== false, everyDays: intIn(w.everyDays, 7, 1, 60) }))
      .filter((w) => w.org && w.urls.length);
    out.phrases = {}; for (const k of TYPE_KEYS) { const p = (d.phrases || {})[k] || []; out.phrases[k] = (Array.isArray(p) ? p : []).map((x) => clip(x, 80)).filter((x) => x.length >= 3).slice(0, 30); }
    out.searchesPerDay = intIn(d.searchesPerDay, 0, 0, 30);
    out.searchAreas = Array.isArray(d.searchAreas) ? d.searchAreas.filter((a) => SEARCH_AREAS.some((x) => x[0] === a)) : DEFAULT_CFG.searchAreas;
    out.searchTypes = Array.isArray(d.searchTypes) ? d.searchTypes.filter((a) => SEARCH_TYPES.some((x) => x[0] === a)) : DEFAULT_CFG.searchTypes;
    out.searchLangs = Array.isArray(d.searchLangs) ? d.searchLangs.filter((l) => l === "en" || l === "ar") : DEFAULT_CFG.searchLangs;
    out.stepsPerRun = intIn(d.stepsPerRun, 2, 1, 6); out.maxPageKb = intIn(d.maxPageKb, 200, 50, 1500);
    out.pressHosts = (Array.isArray(d.pressHosts) ? d.pressHosts : []).map((h) => String(h).toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "")).filter(Boolean).slice(0, 100);
    return out;
  }
  /** Every search cell (type × area × language) the settings allow, in a fixed order. */
  function cells(cfg) {
    const c = cfgOf(cfg), out = [];
    for (const t of SEARCH_TYPES) if (c.searchTypes.includes(t[0])) for (const a of SEARCH_AREAS) if (c.searchAreas.includes(a[0])) for (const l of c.searchLangs)
      out.push({ key: `${t[0]}.${a[0]}.${l}`, type: t[0], area: a[0], lang: l, q: l === "ar" ? `${t[2]} ${a[2]}` : `${t[1]} "${a[1]}" Egypt` });
    return out;
  }

  /* ---------------- triage ---------------- */
  /** Signals in one item: the sentences with a trigger phrase next to a relevant word, strongest first, at most `max`.
   *  item: {title, text, url}. Returns [{type, strength, quote, matched, place}] — the quote is always a sentence of the item. */
  /* Phrases folded once per settings version; a phrase is tested as a whole word only when its letters appear at all (a plain substring
     check first), which keeps triage to a few milliseconds even on Workers Free. */
  let LEX = null, LEXKEY = null;
  function lexicon(c) {
    const key = JSON.stringify(c.phrases); if (LEX && LEXKEY === key) return LEX;
    const F = E().fold, w = (x) => ({ raw: x, f: F(x).replace(/\s+/g, " ").trim() });
    LEX = { rel: RELEVANT.en.concat(RELEVANT.ar).map(w), types: TYPE_KEYS.map((k) => ({ k, s: TYPES[k].strength, words: TYPES[k].en.concat(TYPES[k].ar, c.phrases[k] || []).map(w),
      not: (TYPES[k].not || []).map(w), needs: (TYPES[k].needs || []).map(w) })).sort((a, b) => b.s - a.s),
      // place names such as "New Cairo" or "القاهرة الجديدة" must not count as the plan word "new"
      places: G().AREAS.concat(G().GOVS).flatMap((p) => [p.en, p.ar]).map((x) => F(x).replace(/\s+/g, " ").trim()).filter((x) => x.length > 3).sort((a, b) => b.length - a.length) };
    LEXKEY = key; return LEX;
  }
  const present = (f, x) => f.includes(x.f.replace(/^ال/, "")) && E().hasWord(f, x.raw);
  /** Signals in one item: the sentences with a trigger phrase next to a relevant word, strongest first, at most `max`.
   *  item: {title, text, url}. Returns [{type, strength, quote, matched, place}] — the quote is always a sentence of the item.
   *  requireEgypt: the item must name a place in Egypt or Egypt itself (search results; Egyptian feeds and company pages often do not). */
  function triage(item, cfg, max = 2, { requireEgypt = false } = {}) {
    const c = cfgOf(cfg), L = lexicon(c), F = E().fold, noPlaces = (f) => L.places.reduce((t, p) => (t.includes(p) ? t.split(p).join(" ") : t), f), whole = `${item.title || ""}. ${item.text || ""}`, out = [];
    const p = G().locate(whole);
    if (p.precision === "foreign") return [];
    if (requireEgypt && p.precision !== "area" && p.precision !== "governorate" && !/egypt|مصر/i.test(F(whole))) return [];
    for (const s of sentences(whole)) {
      const f = F(s).replace(/\s+/g, " ");
      if (!L.rel.some((x) => present(f, x))) continue;
      if (G().locate(s).precision === "foreign") continue;   // this sentence is about a place outside Egypt
      for (const t of L.types) {   // strongest type first: the first type that matches is the sentence's type
        const hit = t.words.filter((x) => present(f, x));
        if (!hit.length) continue;
        if (t.not.some((x) => present(f, x)) || (t.needs.length && !t.needs.some((x) => present(noPlaces(f), x)))) continue;
        if (hit.length) { if (!out.some((o) => o.quote === s)) out.push({ type: t.k, strength: t.s, quote: s, matched: hit.slice(0, 4).map((x) => x.raw) }); break; }
      }
    }
    return out.sort((a, b) => b.strength - a.strength).slice(0, max).map((o) => Object.assign(o, { place: { precision: p.precision, gov: p.gov, area: p.area, note: p.note } }));
  }

  root.DPSignals = { TYPES, TYPE_KEYS, RELEVANT, SOCIAL, LISTING, hostOf, sourceClass, htmlText, sentences, fnv, sigId, parseFeed, robotsRules, robotsAllows,
    SEARCH_AREAS, SEARCH_TYPES, DEFAULT_CFG, SUGGESTED_FEEDS, cfgOf, cells, triage, goodUrl };
})(typeof self !== "undefined" ? self : globalThis);
