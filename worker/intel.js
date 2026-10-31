/* X FORCE — Market Intelligence ingest for the Cloudflare Worker: a line-by-line port of ops/intel.py (the gate the
   claude.ai research task uses). It validates, de-duplicates, scores and labels research candidates and returns the
   documents to write. It never invents data: anything without a source is dropped or labelled unverified.
   Same input, same output as ops/intel.py — checked by qa/intel_parity.py.

   ingest(job, db, cands, nowMs) → {job, now, ok, error, writes:[{collection, doc_id, data}], notes, stats, notify}
     db = {"mi/opps/o": {id: doc}, "mix/news/n": {…}, "mix/fx/r": {…}, "mix/mat/m": {…}, "mi/state/jobs": {…}, "mi/schedule": doc|null} */

export const JOBS = { opportunities: "Daily Opportunity Discovery", news: "Market News Monitor", fx: "Currency Update", materials: "Material-Price Update", weekly: "Weekly Market Position Report" };
const CURRENCIES = ["USD", "CNY", "EUR", "AED", "GBP"];
const CATEGORIES = ["developer", "compound", "school", "nursery", "hotel", "resort", "coastal", "club", "fec", "amusement", "waterpark",
  "public", "landscape", "mall", "hospitality", "tender", "partner", "distributor", "oem", "exhibition", "association",
  "supplier", "media", "competitor", "trend", "procurement", "supply", "other"];
const KINDS = ["project", "tender", "partnership", "market", "competitor"];
const TARGET_AREAS = ["new cairo", "new zayed", "sheikh zayed", "north coast", "sahel", "alamein", "ain sokhna", "sokhna", "6th of october",
  "october", "new capital", "administrative capital", "mostakbal", "ras el hekma", "galala", "hurghada", "el gouna",
  "sharm", "red sea", "madinaty", "shorouk"];
const EGYPT = ["egypt", "cairo", "giza", "alexandria", "matrouh", "suez", "ismailia", "luxor", "aswan"].concat(TARGET_AREAS);
const NEAR = ["saudi", "ksa", "riyadh", "jeddah", "uae", "dubai", "abu dhabi", "qatar", "doha", "kuwait", "oman", "bahrain", "jordan", "libya", "morocco", "iraq"];
const PRODUCT_WORDS = { play: 6, playground: 8, kids: 4, children: 4, family: 3, amusement: 6, "water park": 7, aqua: 5,
  entertainment: 5, "soft play": 7, park: 3, landscape: 4, garden: 2, beach: 4, resort: 3, school: 4,
  nursery: 5, kindergarten: 5, club: 3, mall: 3, compound: 4, furniture: 3, bench: 3, shade: 2,
  sports: 3, recreation: 5, leisure: 4, "theme park": 7, fec: 5, arcade: 5 };
const OFFICIAL = [/\.gov\.eg$/, /\.gov$/, /\.gov\.[a-z]{2}$/, /(^|\.)etenders\.gov\.eg$/, /(^|\.)cbe\.org\.eg$/, /(^|\.)customs\.gov\.eg$/,
  /(^|\.)mof\.gov\.eg$/, /(^|\.)gafi\.gov\.eg$/, /(^|\.)nuca\.gov\.eg$/, /(^|\.)egx\.com\.eg$/, /(^|\.)sis\.gov\.eg$/];
const REPUTABLE = ["reuters.com", "bloomberg.com", "ahram.org.eg", "english.ahram.org.eg", "dailynewsegypt.com", "egypttoday.com", "enterprise.press",
  "zawya.com", "arabnews.com", "thenationalnews.com", "ft.com", "wsj.com", "apnews.com", "bbc.com", "cnbcarabia.com", "amwalalghad.com",
  "almalnews.com", "youm7.com", "masrawy.com", "elwatannews.com", "shorouknews.com", "investing.com", "xe.com", "construction-week",
  "constructionweekonline.com", "propertyfinder.eg", "aqarmap.com.eg", "lloydslist.com", "joc.com", "freightos.com", "drewry.co.uk",
  "spglobal.com", "fastmarkets.com", "argusmedia.com", "steelorbis.com", "worldbank.org", "imf.org"];
const DAY = 864e5;

/* ---------- Python-compatible helpers ---------- */
const isDict = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const g = (o, k) => (isDict(o) ? o[k] : undefined);
const truthy = (x) => !(x == null || x === false || x === 0 || x === "" || (Array.isArray(x) && !x.length) || (isDict(x) && !Object.keys(x).length));
const pyStr = (x) => (x == null ? "None" : x === true ? "True" : x === false ? "False" : typeof x === "string" ? x : typeof x === "number" ? pyNum(x) : JSON.stringify(x));
const pyNum = (x) => (Number.isInteger(x) && !Object.is(x, -0) ? String(x) : String(x));
const s0 = (x) => (x == null || x === false || x === "" || x === 0 ? "" : pyStr(x));      // str(x or "")
const cut = (s, n) => Array.from(s).slice(0, n).join("");                                    // Python slicing counts code points
/** Python round(x, n): round half to even on the decimal value. */
function pyRound(x, n = 0) {
  const m = Math.pow(10, n), y = x * m, f = Math.floor(y), d = y - f;
  let r = Math.abs(d - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(y);
  return n ? Number((r / m).toFixed(n)) : r;
}
const iso = (t) => new Date(t).toISOString().slice(0, 19) + "Z";
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
function norm(s) {
  s = s0(s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  s = s.replace(/\b(the|a|an|of|for|and|in|at|by|project|new|company|co|ltd|s\.a\.e|sae|llc|group|developments?)\b/g, " ");
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}
const tokens = (s) => new Set(norm(s).split(/\s+/).filter((t) => t.length > 2));
function jacc(a, b) {
  const A = tokens(a), B = tokens(b); let i = 0; for (const t of A) if (B.has(t)) i++;
  return i / Math.max(1, new Set([...A, ...B]).size);
}
function host(url) {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(String(url == null ? "" : url).trim());
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}
const goodUrl = (url) => !!host(url) && String(url).length <= 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
function parseDate(s) {
  if (!truthy(s)) return null;
  s = pyStr(s).trim();
  if (/^\d{4}-\d{2}$/.test(s)) s += "-01";
  if (!DATE_RE.test(s)) return null;
  let t = s.replace(" ", "T"); if (!/(Z|[+-]\d{2}:\d{2})$/.test(t)) t += t.length === 10 ? "T00:00:00Z" : "Z";
  const v = Date.parse(t); return Number.isFinite(v) ? v : null;
}
function sourceClass(url, declared) {
  const h = host(url) || "";
  if (OFFICIAL.some((p) => p.test(h))) return "official";
  if (declared === "organization") return "organization";
  if (REPUTABLE.some((r) => h === r || h.endsWith("." + r) || h.includes(r))) return "reputable";
  return "other";
}
/* SHA-1 (sync), for ids identical to the Python ones */
function sha1hex(str) {
  const b = new TextEncoder().encode(str), l = b.length, n = (((l + 8) >> 6) + 1) * 16, w = new Uint32Array(n);
  for (let i = 0; i < l; i++) w[i >> 2] |= b[i] << (24 - (i % 4) * 8);
  w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[n - 1] = l * 8;
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]; const W = new Uint32Array(80);
  for (let i = 0; i < n; i += 16) {
    for (let t = 0; t < 80; t++) W[t] = t < 16 ? w[i + t] : ((x) => (x << 1) | (x >>> 31))(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16]);
    let [a, bb, c, d, e] = [h0, h1, h2, h3, h4];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + W[t]) >>> 0; e = d; d = c; c = ((bb << 30) | (bb >>> 2)) >>> 0; bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}
const sid = (...parts) => sha1hex(parts.map(norm).join("|")).slice(0, 16);
const daysBetween = (a, b) => Math.floor((a - b) / DAY);                                     // timedelta.days
const fnum = (x) => { if (x == null || x === "" || typeof x === "boolean" && false) return null; const v = typeof x === "boolean" ? +x : typeof x === "number" ? x : (/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(String(x)) ? parseFloat(x) : NaN); return Number.isFinite(v) ? v : null; };

function jobDoc(job, now, ok, created = 0, updated = 0, notes = null, error = null, prev = null, schedule = null) {
  prev = prev || {};
  return { job, label: JOBS[job] || job, lastAttempt: iso(now), status: ok ? "ok" : "failed", schedule: schedule || "manual",
    lastSuccess: ok ? iso(now) : (prev.lastSuccess === undefined ? null : prev.lastSuccess), created, updated,
    notes: (notes || []).slice(0, 20), error, runs: (parseInt(prev.runs) || 0) + 1, failures: ok ? 0 : (parseInt(prev.failures) || 0) + 1 };
}

/* ---------------- opportunities ---------------- */
function scoreOpp(o, now) {
  const text = [o.title || "", o.description || "", o.organization || "", (o.products || []).join(" ")].join(" ").toLowerCase();
  const loc = (o.location || "").toLowerCase(), parts = [];
  const add = (k, label, pts, mx, why) => parts.push({ k, label, pts: Math.trunc(Math.max(0, Math.min(mx, pyRound(pts)))), max: mx, why });
  const words = Object.keys(PRODUCT_WORDS), hit = words.filter((w) => text.includes(w));
  const fit = hit.reduce((s, w) => s + PRODUCT_WORDS[w], 0), np = (o.products || []).length;
  add("fit", "Product fit", Math.min(20, fit + 3 * np), 20, `Mentions ${hit.slice().sort().slice(0, 5).join(", ") || "no play/leisure terms"}; ${np} Dupedia product line(s) suggested`);
  const cat = o.category || "other";
  const rel = { compound: 15, developer: 14, resort: 14, hotel: 12, school: 13, nursery: 12, fec: 15, amusement: 15, waterpark: 15, mall: 12, club: 12, public: 11, landscape: 11, coastal: 14, hospitality: 11, tender: 13 }[cat] || 6;
  add("customer", "Customer relevance", rel, 15, `Customer category: ${cat}`);
  const v = g(o.estValue || {}, "amountEgp");
  const big = ["compound", "resort", "mall", "theme park", "water park", "city", "district", "master plan", "masterplan", "km", "feddan", "acres"].some((w) => text.includes(w));
  let sc, why;
  if (truthy(v)) [sc, why] = v >= 50e6 ? [15, "estimated value ≥ EGP 50M"] : v >= 10e6 ? [11, "estimated value ≥ EGP 10M"] : [7, "estimated value < EGP 10M"];
  else [sc, why] = big ? [9, "large-scale development by its description (value not published)"] : [4, "scale unknown"];
  add("scale", "Project scale", sc, 15, why);
  if (TARGET_AREAS.some((a) => loc.includes(a))) add("geo", "Geographic relevance", 10, 10, "Priority sales area");
  else if (EGYPT.some((a) => loc.includes(a))) add("geo", "Geographic relevance", 7, 10, "Egypt, outside the priority areas");
  else if (NEAR.some((a) => loc.includes(a))) add("geo", "Geographic relevance", 4, 10, "Nearby export market");
  else add("geo", "Geographic relevance", 1, 10, "Location unclear or far");
  const scCls = sourceClass(o.sourceUrl, o.sourceType);
  add("source", "Source reliability", { official: 10, organization: 8, reputable: 7, other: 3 }[scCls], 10, `Source class: ${scCls} (${pyStr(host(o.sourceUrl))})`);
  const pub = parseDate(o.publishedAt);
  if (pub != null) { const age = daysBetween(now, pub); add("recency", "Recency", age <= 14 ? 10 : age <= 45 ? 7 : age <= 120 ? 4 : 1, 10, `Published ${age} day(s) ago`); }
  else add("recency", "Recency", 2, 10, "Publication date unknown");
  const contact = o.contact || {};
  add("contact", "Ability to contact", truthy(contact.text) && truthy(contact.sourceUrl) ? 5 : truthy(o.orgWebsite) ? 3 : 1, 5,
    truthy(contact.text) ? "Published contact route" : truthy(o.orgWebsite) ? "Organisation website known" : "No contact route found yet");
  const supply = fit >= 10 ? 5 : fit >= 5 ? 3 : 1;
  add("supply", "Dupedia can supply", supply, 5, supply === 5 ? "Core playground/leisure scope" : supply === 3 ? "Partial fit" : "Weak fit");
  const dl = parseDate(g(o.deadline || {}, "date"));
  if (dl != null) { const days = daysBetween(dl, now); add("urgency", "Competitive urgency", days >= 0 && days <= 30 ? 5 : days >= 0 && days <= 90 ? 3 : 0, 5, days >= 0 ? `Deadline in ${days} day(s)` : "Deadline passed"); }
  else add("urgency", "Competitive urgency", ["tender", "project"].includes(o.kind) ? 2 : 1, 5, "No published deadline");
  const commercial = (truthy(v) && v >= 10e6) || big ? 5 : rel >= 12 ? 3 : 1;
  add("commercial", "Commercial potential", commercial, 5, commercial === 5 ? "Large or repeat-business potential" : commercial === 3 ? "Typical project size" : "Limited");
  return [parts.reduce((s, p) => s + p.pts, 0), parts];
}
const str_ = (c, k, n) => cut(s0(g(c, k)).trim(), n);

function ingestOpps(db, cands, now, notes) {
  const existing = db["mi/opps/o"] || {}, writes = []; let created = 0, updated = 0;
  const seen = Object.assign({}, existing);
  (Array.isArray(cands) ? cands : []).forEach((c, i) => {
    if (!isDict(c)) c = {};
    const title = cut(s0(c.title).trim(), 200), url = s0(c.sourceUrl).trim();
    if (!title || !goodUrl(url)) { notes.push(`#${i}: dropped — no title or no valid source URL`); return; }
    const pd = parseDate(c.publishedAt);
    const o = { title, organization: str_(c, "organization", 160), location: str_(c, "location", 160),
      category: CATEGORIES.includes(c.category) ? c.category : "other", kind: KINDS.includes(c.kind) ? c.kind : "project",
      description: str_(c, "description", 1500), products: (Array.isArray(c.products) ? c.products : []).map((x) => cut(pyStr(x), 60)).slice(0, 8),
      sourceUrl: url, sourceOrg: cut(s0(c.sourceOrg) || host(url) || "", 120), sourceType: ["official", "organization", "media", "industry", "other"].includes(c.sourceType) ? c.sourceType : null,
      publishedAt: pd != null ? ymd(pd) : null, orgWebsite: goodUrl(c.orgWebsite) ? c.orgWebsite : null,
      nextAction: str_(c, "nextAction", 300), contactStrategy: str_(c, "contactStrategy", 400), region: str_(c, "region", 60) };
    const ct = isDict(c.contact) ? c.contact : {};
    if (truthy(ct.text) && goodUrl(ct.sourceUrl)) o.contact = { text: cut(pyStr(ct.text), 200), sourceUrl: ct.sourceUrl };
    else if (truthy(ct.text)) notes.push(`#${i}: contact dropped — no source`);
    const dl = isDict(c.deadline) ? c.deadline : {};
    if (truthy(dl.date) && goodUrl(dl.sourceUrl) && parseDate(dl.date) != null) o.deadline = { date: ymd(parseDate(dl.date)), sourceUrl: dl.sourceUrl, label: cut(s0(dl.label) || "Deadline", 80) };
    else if (truthy(dl.date)) notes.push(`#${i}: deadline dropped — no source`);
    const ev = isDict(c.estValue) ? c.estValue : {};
    const amt = ev.amount != null ? fnum(ev.amount) : null;
    if (truthy(amt) && goodUrl(ev.sourceUrl)) {
      const cur = (s0(ev.currency) || "EGP").toUpperCase();
      o.estValue = { amount: amt, currency: cur, basis: cut(s0(ev.basis) || "as published", 200), sourceUrl: ev.sourceUrl, amountEgp: cur === "EGP" ? amt : (truthy(ev.fx) ? amt * fnum(ev.fx) : null) };
    } else if (truthy(amt)) notes.push(`#${i}: value dropped — no source`);
    const claims = [];
    for (const cl of (Array.isArray(c.claims) ? c.claims : []).slice(0, 12)) {
      const t = cut(s0(g(cl, "text")).trim(), 300); if (!t) continue;
      const ok = goodUrl(g(cl, "sourceUrl")); claims.push({ text: t, sourceUrl: ok ? cl.sourceUrl : null, status: ok ? "sourced" : "unverified" });
    }
    o.claims = claims;
    o.unverified = claims.filter((x) => x.status === "unverified").map((x) => x.text).concat((Array.isArray(c.toConfirm) ? c.toConfirm : []).map((x) => cut(pyStr(x), 200))).slice(0, 10);
    let dup = null;
    for (const k of Object.keys(seen)) {
      const d = seen[k];
      if (d.sourceUrl === url || (d.sources || []).some((s) => g(s, "url") === url)) { dup = k; break; }
      if (o.organization && norm(d.organization) === norm(o.organization) && (!o.location || jacc(d.location, o.location) >= 0.5) && jacc(d.title, title) >= 0.35) { dup = k; break; }
      if (jacc(d.title, title) >= 0.8) { dup = k; break; }
    }
    if (dup) {
      const d = Object.assign({}, seen[dup]);
      const srcs = (d.sources || [{ url: d.sourceUrl === undefined ? null : d.sourceUrl, org: d.sourceOrg === undefined ? null : d.sourceOrg, at: d.discoveredAt === undefined ? null : d.discoveredAt }]).slice();
      if (!srcs.some((s) => g(s, "url") === url)) {
        srcs.push({ url, org: o.sourceOrg, at: iso(now), publishedAt: o.publishedAt });
        d.sources = srcs.slice(-10);
        d.history = (d.history || []).concat([{ at: iso(now), by: "research", action: "Seen again in a new source", detail: url }]);
        notes.push(`#${i}: duplicate of ${dup} — new source added`);
      } else notes.push(`#${i}: duplicate of ${dup} — already known`);
      d.lastChecked = iso(now); d.history = (d.history || []).slice(-80);
      writes.push({ collection: "mi/opps/o", doc_id: dup, data: d }); seen[dup] = d; updated++; return;
    }
    const [total, parts] = scoreOpp(o, now), cls = sourceClass(url, o.sourceType);
    const autoVerified = ["official", "organization"].includes(cls) && truthy(o.publishedAt) && !o.unverified.length;
    const high = total >= 70 || ((o.estValue || {}).amountEgp || 0) >= 10e6;
    const oid = "op-" + sid(o.organization || title, o.location, title);
    const cap = cls.charAt(0).toUpperCase() + cls.slice(1);
    Object.assign(o, { id: oid, status: "new", evidence: autoVerified && !high ? "verified" : cls !== "other" ? "single-source" : "unverified",
      evidenceNote: autoVerified ? "Official/organisation source with date; all claims sourced" : o.unverified.length ? `${cap} source; ${o.unverified.length} point(s) still to confirm` : `One ${cls} source; confirm independently`,
      needsApproval: !!high, score: total, scoreParts: parts, priority: total >= 70 ? "high" : total >= 50 ? "medium" : "low",
      sourceClass: cls, sources: [{ url, org: o.sourceOrg, at: iso(now), publishedAt: o.publishedAt }],
      discoveredAt: iso(now), lastChecked: iso(now), assignedTo: null, followUp: null, notes: [],
      history: [{ at: iso(now), by: "research", action: "Discovered", detail: `Score ${total} · ${cls} source` }],
      confidence: ["official", "organization", "reputable"].includes(cls) ? "medium" : "low", dedupKey: sid(o.organization, o.location) });
    if (autoVerified && high) o.evidenceNote += " — high-impact: an administrator must approve before it is treated as confirmed";
    writes.push({ collection: "mi/opps/o", doc_id: oid, data: o }); seen[oid] = o; created++;
  });
  for (const k of Object.keys(existing)) {
    let d = existing[k]; const dl = parseDate(g(d.deadline || {}, "date"));
    if (dl != null && dl < now - DAY && ["new", "review", "verified", "qualified"].includes(d.status)) {
      d = Object.assign({}, d); d.status = "expired";
      d.history = (d.history || []).concat([{ at: iso(now), by: "research", action: "Status: Expired", detail: `Deadline ${d.deadline.date} passed` }]);
      if (!writes.some((w) => w.doc_id === k)) { writes.push({ collection: "mi/opps/o", doc_id: k, data: d }); updated++; }
    }
  }
  return [writes, created, updated];
}

/* ---------------- news ---------------- */
function ingestNews(db, cands, now, notes) {
  const existing = Object.assign({}, db["mix/news/n"] || {}), writes = []; let created = 0;
  (Array.isArray(cands) ? cands : []).forEach((c, i) => {
    if (!isDict(c)) c = {};
    const h = cut(s0(c.headline).trim(), 250), url = s0(c.url).trim();
    if (!h || !goodUrl(url)) { notes.push(`news #${i}: dropped — no headline or source URL`); return; }
    if (Object.values(existing).some((d) => d.url === url || jacc(d.headline, h) >= 0.8)) { notes.push(`news #${i}: duplicate`); return; }
    const cls = sourceClass(url);
    let st = ["official", "media", "industry", "unconfirmed"].includes(c.sourceType) ? c.sourceType : cls === "official" ? "official" : cls === "reputable" ? "media" : "unconfirmed";
    if (st === "official" && cls !== "official") st = "media";
    const lvl = ["low", "medium", "high"].includes(c.impactLevel) ? c.impactLevel : "low";
    const nid = "nw-" + sid(h, url), pub = parseDate(c.publishedAt);
    const area = ["shipping", "customs", "regulatory", "materials", "procurement", "market"].includes(c.area) ? c.area : "market";
    const d = { id: nid, headline: h, source: cut(truthy(c.source) ? pyStr(c.source) : pyStr(host(url)), 120), url, sourceType: st, area,
      publishedAt: pub != null ? ymd(pub) : null, discoveredAt: iso(now), summary: cut(s0(c.summary), 1200), whyItMatters: cut(s0(c.whyItMatters), 800),
      relevantTo: (Array.isArray(c.relevantTo) ? c.relevantTo : []).map((x) => cut(pyStr(x), 60)).slice(0, 8), impact: cut(s0(c.impact), 500), impactLevel: lvl,
      verification: st === "official" ? "official announcement" : ["media", "industry"].includes(st) ? "media report" : "unconfirmed",
      nextStep: cut(s0(c.nextStep), 400), needsProfessional: truthy(c.needsProfessional) || ["customs", "regulatory"].includes(c.area), status: "new" };
    writes.push({ collection: "mix/news/n", doc_id: nid, data: d }); existing[nid] = d; created++;
  });
  return [writes, created, 0];
}

/* ---------------- currency ---------------- */
function ingestFx(db, cands, now, notes) {
  const snaps = db["mix/fx/r"] || {}, last = {};
  for (const k of Object.keys(snaps).sort()) for (const [code, r] of Object.entries(snaps[k].rates || {})) if (g(r, "status") !== "rejected") last[code] = Object.assign({}, r, { date: k });
  const day = ymd(now);
  const snap = Object.assign({}, snaps[day] || { date: day, base: "EGP", convention: "EGP per 1 unit of the foreign currency", rates: {} });
  snap.rates = Object.assign({}, snap.rates || {}); let got = 0;
  (Array.isArray(cands) ? cands : []).forEach((c, i) => {
    if (!isDict(c)) c = {};
    const raw = s0(c.code).toUpperCase(), code = ["RMB", "CNY"].includes(raw) ? "CNY" : raw;
    const val = fnum(c.egpPer), url = s0(c.url);
    if (!CURRENCIES.includes(code) || !truthy(val) || val <= 0 || !goodUrl(url)) { notes.push(`fx #${i}: dropped (${code || "no code"}: value or source missing)`); return; }
    const prev = last[code]; let status = "ok", note = "";
    if (prev && truthy(prev.egpPer)) { const ch = val / prev.egpPer - 1; if (Math.abs(ch) > 0.15) { status = "review"; note = `Moved ${(ch * 100).toFixed(1)}% since ${prev.date}: kept for review, the previous value stays current`; } }
    snap.rates[code] = { egpPer: pyRound(val, 4), source: cut(truthy(c.source) ? pyStr(c.source) : pyStr(host(url)), 120), url, kind: ["official", "bank", "market"].includes(c.kind) ? c.kind : "market",
      rateType: cut(s0(c.rateType), 40), publishedAt: c.publishedAt === undefined ? null : c.publishedAt, retrievedAt: iso(now), status, note,
      prevEgpPer: prev ? (prev.egpPer === undefined ? null : prev.egpPer) : null, prevDate: prev ? (prev.date === undefined ? null : prev.date) : null };
    got++;
  });
  const missing = CURRENCIES.filter((c) => !(c in snap.rates));
  if (missing.length) notes.push("No new value for " + missing.join(", ") + " — the last saved values stay in use and are shown with their age.");
  return [got ? [{ collection: "mix/fx/r", doc_id: day, data: snap }] : [], got && !(day in snaps) ? 1 : 0, got && day in snaps ? 1 : 0];
}

/* ---------------- materials ---------------- */
function latestFx(db) {
  const snaps = db["mix/fx/r"] || {}, out = {};
  for (const k of Object.keys(snaps).sort()) for (const [code, r] of Object.entries(snaps[k].rates || {})) if (g(r, "status") === "ok") out[code] = r.egpPer;
  return out;
}
const UNIT_CONV = { "t|kg": 1 / 1000, "ton|kg": 1 / 1000, "tonne|kg": 1 / 1000, "kg|kg": 1, "m3|m3": 1, "l|L": 1, "L|L": 1, "m2|m2": 1, "m|m": 1 };
function ingestMaterials(db, cands, now, notes) {
  const mats = Object.assign({}, db["mix/mat/m"] || {}), fx = latestFx(db), writes = []; let updated = 0;
  (Array.isArray(cands) ? cands : []).forEach((c, i) => {
    if (!isDict(c)) c = {};
    const mid = s0(c.materialId), m = mats[mid], url = s0(c.url), price = fnum(c.price);
    if (!m || !truthy(price) || price <= 0 || !goodUrl(url)) { notes.push(`material #${i}: dropped (${mid || "no id"}: unknown material, price or source missing)`); return; }
    const unit = truthy(c.unit) ? pyStr(c.unit) : pyStr(m.unit);
    const k = UNIT_CONV[`${unit}|${m.unit}`] || UNIT_CONV[`${unit.toLowerCase()}|${m.unit}`];
    if (k == null) { notes.push(`material #${i}: dropped (${mid}: unit ${unit} cannot be converted to ${pyStr(m.unit)})`); return; }
    const cur = (s0(c.currency) || "EGP").toUpperCase();
    const egp = cur === "EGP" ? price * k : cur in fx ? price * k * fx[cur] : null;
    if (egp == null) { notes.push(`material #${i}: dropped (${mid}: no saved ${cur} rate to convert)`); return; }
    let pt = ["indicative", "supplier_quote", "official_index", "purchase"].includes(c.priceType) ? c.priceType : "indicative";
    if (["supplier_quote", "purchase"].includes(pt)) { pt = "indicative"; notes.push(`material #${i}: stored as indicative (quotes and purchase prices are entered by administrators)`); }
    const prices = (m.prices || []).slice(), prev = prices.slice().reverse().find((p) => g(p, "status") !== "rejected") || null, pub = parseDate(c.publishedAt);
    const rec = { egpPerUnit: pyRound(egp, 4), price, currency: cur, unit, type: pt, source: cut(truthy(c.source) ? pyStr(c.source) : pyStr(host(url)), 160), url,
      market: cut(s0(c.market), 80), publishedAt: pub != null ? ymd(pub) : null, retrievedAt: iso(now), by: "research",
      status: "ok", confidence: ["official", "reputable"].includes(sourceClass(url)) ? "medium" : "low", note: cut(s0(c.note), 300) };
    if (prev && truthy(prev.egpPerUnit)) {
      const ch = egp / prev.egpPerUnit - 1; rec.changePct = pyRound(ch * 100, 2);
      if (Math.abs(ch) > 0.35) { rec.status = "review"; rec.note = (rec.note ? rec.note + " " : "") + `Moved ${(ch * 100).toFixed(0)}% — check before use.`; }
    }
    if (prices.some((p) => g(p, "url") === url && g(p, "egpPerUnit") === rec.egpPerUnit)) { notes.push(`material #${i}: same price and source already stored`); return; }
    const m2 = Object.assign({}, m, { prices: prices.concat([rec]).slice(-60), updatedAt: iso(now) });
    writes.push({ collection: "mix/mat/m", doc_id: mid, data: m2 }); mats[mid] = m2; updated++;
  });
  return [writes, 0, updated];
}

/* ---------------- weekly report ---------------- */
function weekId(t) {
  const d = new Date(t), th = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);   // Thursday of this ISO week
  const y = new Date(th).getUTCFullYear(), w = 1 + Math.floor((th - Date.UTC(y, 0, 1)) / DAY / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
const count = (items, k) => { const out = {}; for (const o of items) { const v = truthy(o[k]) ? o[k] : "other"; out[v] = (out[v] || 0) + 1; } return out; };
function ingestWeekly(db, rep, now, notes) {
  if (!isDict(rep)) { notes.push("weekly: no report object"); return [[], 0, 0]; }
  const opps = db["mi/opps/o"] || {}, ov = Object.values(opps), wk = weekId(now), start = now - 7 * DAY, prevStart = now - 14 * DAY;
  const at = (o) => { const v = parseDate(o.discoveredAt); return v == null ? now : v; };
  const disc = ov.filter((o) => at(o) >= start), discPrev = ov.filter((o) => prevStart <= at(o) && at(o) < start);
  const ignored = ov.filter((o) => ["new", "review", "verified", "qualified"].includes(o.status) && at(o) < now - 7 * DAY && !truthy(o.assignedTo));
  const stale = ov.filter((o) => { if (o.status !== "assigned") return false; const h = (o.history || [{}]); const v = parseDate(g(h[h.length - 1], "at")); return (v == null ? now : v) < now - 7 * DAY; });
  const srcs = (x) => (isDict(x) ? (Array.isArray(x.sources) ? x.sources : []).filter((s) => isDict(s) && goodUrl(s.url)) : []);
  const facts = []; let moved = 0;
  for (const f of rep.facts || []) {
    if (srcs(f).length) facts.push({ text: cut(pyStr(g(f, "text")), 600), sources: srcs(f) });
    else { moved++; if (!Array.isArray(rep.unknowns)) rep.unknowns = []; rep.unknowns.push({ text: cut(pyStr(g(f, "text")), 600) + " (no source — not stated as fact)" }); }
  }
  if (moved) notes.push(`weekly: ${moved} unsourced 'fact(s)' moved to unknowns`);
  const recs = (rep.recommendations || []).slice(0, 12).map((r) => {
    const o = {}; for (const k of ["title", "reason", "benefit", "effort", "risks", "nextStep", "owner", "deadline"]) o[k] = g(r, k) != null ? cut(pyStr(r[k]), 500) : "";
    o.evidence = srcs(r); o.oppIds = (Array.isArray(g(r, "oppIds")) ? r.oppIds : []).filter((x) => x in opps); return o;
  });
  const tx = (x, n) => cut(pyStr(isDict(x) ? x.text : x), n);
  const d = { id: wk, week: wk, createdAt: iso(now), periodStart: ymd(start), periodEnd: ymd(now),
    executiveSummary: cut(s0(rep.executiveSummary), 3000), changes: (rep.changes || []).map((x) => cut(pyStr(x), 500)).slice(0, 15),
    priorities: (rep.priorities || []).map((p) => ({ text: cut(pyStr(g(p, "text")), 400), oppId: g(p, "oppId") in opps ? p.oppId : null, owner: cut(s0(g(p, "owner")), 80), deadline: cut(s0(g(p, "deadline")), 20) })).slice(0, 12),
    threats: (rep.threats || []).map((t) => ({ text: tx(t, 500), sources: srcs(t) })).slice(0, 10),
    facts: facts.slice(0, 25), inferences: (rep.inferences || []).map((x) => ({ text: tx(x, 500) })).slice(0, 20),
    recommendations: recs, unknowns: (rep.unknowns || []).map((x) => ({ text: tx(x, 500) })).slice(0, 20),
    sources: (rep.sources || []).filter((s) => isDict(s) && goodUrl(s.url)).map((s) => ({ title: cut(truthy(s.title) ? pyStr(s.title) : pyStr(host(s.url)), 200), url: s.url })).slice(0, 60),
    dataQuality: cut(s0(rep.dataQuality), 1200),
    stats: { discoveredThisWeek: disc.length, discoveredPrevWeek: discPrev.length, notFollowedUp: ignored.length, assignedNoUpdate7d: stale.length,
      byCategory: count(disc, "category"), byStatus: count(ov, "status"), highPriorityOpen: ov.filter((o) => o.priority === "high" && !["won", "lost", "rejected", "expired"].includes(o.status)).length },
    ignoredIds: ignored.map((o) => (o.id === undefined ? null : o.id)).slice(0, 30) };
  return [[{ collection: "mix/reports/w", doc_id: wk, data: d }], 1, 0];
}

/** One research job's candidates → the documents to write (plus job state and run history). */
export function ingest(job, db, cands, nowMs) {
  const now = Math.floor(nowMs / 1000) * 1000, notes = [];
  const prev = (db["mi/state/jobs"] || {})[job] || null;
  const sched = g(g(db["mi/schedule"] || {}, "jobs") || {}, job) || {};
  let writes, created, updated, ok, err;
  try {
    const fn = { opportunities: ingestOpps, news: ingestNews, fx: ingestFx, materials: ingestMaterials, weekly: ingestWeekly }[job];
    if (cands == null) throw Object.assign(new Error("candidates file missing or not valid JSON"), { name: "ValueError" });
    [writes, created, updated] = fn(db, cands, now, notes); ok = true; err = null;
  } catch (e) { writes = []; created = 0; updated = 0; ok = false; err = `${e.name === "ValueError" ? "ValueError" : e.name || "Error"}: ${e.message}`; }
  const high = writes.filter((w) => w.collection === "mi/opps/o" && w.data.priority === "high" && (w.data.history || []).some((h) => h.action === "Discovered" && h.at === iso(now))).map((w) => w.data);
  const newsHi = writes.filter((w) => w.collection === "mix/news/n" && w.data.impactLevel === "high").map((w) => w.data);
  writes.push({ collection: "mi/state/jobs", doc_id: job, data: jobDoc(job, now, ok, created, updated, notes, err, prev, g(sched, "label")) });
  const stamp = iso(now).replace(/[-:]/g, "").slice(0, 15);
  writes.push({ collection: "mi/runs/r", doc_id: `${stamp}-${job}`, data: { job, label: JOBS[job], at: iso(now), ok, created, updated, notes: notes.slice(0, 30), error: err,
    candidates: Array.isArray(cands) ? cands.length : (truthy(cands) ? 1 : 0) } });
  return { job, now: iso(now), ok, error: err, writes, notes, stats: { created, updated },
    notify: { highOpportunities: high.map((o) => ({ id: o.id, title: o.title, score: o.score })), highImpactNews: newsHi.map((n) => ({ id: n.id, headline: n.headline })) } };
}
