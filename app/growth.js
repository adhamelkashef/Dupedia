/* X FORCE 1.4 (Dupedia) — Growth & Marketing Center: pure calculations (no storage), shared by the app, the hourly server
   job and the tests.

   SCORING      A transparent account / project priority score (0–100) from weighted factors. Every factor shows its
                points and the reason; Sales can override the priority and record qualification feedback. Social-media
                engagement and estimated values are never treated as proof of purchase intent: estimates carry a small
                weight and are labelled.
   ATTRIBUTION  Campaign → leads (the lead's FIRST SOURCE = sourced) → quotations (submissions of projects for those
                leads) → booked orders (signed contract value) → verified customer payments. Recorded campaign
                interactions with a lead that another source brought in count as INFLUENCED. Sourced and influenced are
                reported separately and never added together. Spend = verified ledger transactions linked to the
                campaign (Finance records), never the planned budget.
   COPY         Draft texts built only from the real catalogue (names, codes, dimensions) and the campaign record — a
                starting point for a person to edit, never published automatically. */
(function (root) {
  "use strict";
  const SEGMENTS = { developer: "Real-estate developers", compound: "Residential compounds", school: "International & private schools", club: "Clubs & sports facilities", hotel: "Hotels & resorts",
    operator: "Amusement & entertainment operators", consultant: "Architects & landscape consultants", contractor: "Contractors & procurement", mall: "Shopping malls", government: "Government & municipalities", other: "Other" };
  // the Lead Mine's organisation types mapped to marketing segments (one vocabulary for reporting)
  const ORG_TO_SEG = { developer: "developer", hotel: "hotel", school: "school", mall: "mall", fec: "operator", park: "operator", club: "club", government: "government", contractor: "contractor", consultant: "consultant", investor: "developer", other: "other" };
  const SEG_TO_ORG = { developer: "developer", compound: "developer", school: "school", club: "club", hotel: "hotel", operator: "fec", consultant: "consultant", contractor: "contractor", mall: "mall", government: "government", other: "other" };
  const CHANNELS = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", email: "E-mail (one-to-one)", whatsapp: "WhatsApp (one-to-one)", event: "Event / exhibition", website: "Website", referral: "Referral / partner", print: "Print", other: "Other" };
  const CAMP_STATUS = { draft: "Draft", planned: "Planned", awaiting: "Awaiting approval", approved: "Approved", live: "Running", paused: "Paused", done: "Completed", cancelled: "Cancelled" };
  const CONTENT_KINDS = { post: "Social post", reel: "Reel / short video", case: "Case study", showcase: "Product showcase", outreach: "Outreach message", concept: "Campaign concept", article: "Article", brochure: "Brochure / catalogue" };
  const CONTENT_STATUS = { idea: "Idea", draft: "Draft", review: "In review", approved: "Approved to publish", published: "Published (recorded)", dropped: "Dropped" };
  const STAGES = { announced: "Announced / planning", design: "Design", tender: "Tender / procurement", construction: "Under construction", handover: "Near handover", operating: "Operating (upgrade)", unknown: "Unknown" };
  const PART_TYPES = { referral: "Referral partner", specifier: "Specifier (architect / consultant)", channel: "Channel / reseller", supplier: "Supplier / manufacturer", operator: "Operator", developer: "Developer framework", other: "Other" };
  const PART_STATUS = { prospect: "Prospect", contacted: "Contacted", active: "Active", dormant: "Dormant", ended: "Ended" };
  const TOUCH = { meeting: "Meeting", call: "Call", email: "E-mail", visit: "Site visit", event: "Event contact", inbound: "Inbound enquiry", content: "Engaged with campaign content", referral: "Referral" };
  const r1 = (x) => Math.round(x * 10) / 10;
  const today0 = () => new Date().toISOString().slice(0, 10);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  /* ---------------- scoring ---------------- */
  const DEFAULT_CFG = {
    weights: { fit: 20, scale: 10, evidence: 15, timing: 15, people: 10, engagement: 10, need: 10, qualified: 5, freshness: 5 },
    priorityA: 70, priorityB: 45, qualifiedScore: 60, stallDays: 21,
    segmentFit: { developer: 1, compound: 1, school: 1, club: 0.9, hotel: 1, operator: 0.9, consultant: 0.7, contractor: 0.7, mall: 0.8, government: 0.6, other: 0.3 },
  };
  const cfgOf = (c) => { const d = JSON.parse(JSON.stringify(DEFAULT_CFG)); if (!c) return d; return Object.assign(d, c, { weights: Object.assign(d.weights, c.weights || {}), segmentFit: Object.assign(d.segmentFit, c.segmentFit || {}) }); };
  /** Account / project score with the reason for every point. touches = recorded interactions with this account. */
  function scoreAccount(a, { cfg = null, touches = [], today = today0() } = {}) {
    const C = cfgOf(cfg), W = C.weights, F = [];
    const add = (k, frac, why) => { const pts = r1(W[k] * Math.max(0, Math.min(1, frac))); F.push({ k, pts, max: W[k], why }); };
    add("fit", C.segmentFit[a.segment] ?? 0.3, `${SEGMENTS[a.segment] || "Unknown segment"} — fit ${Math.round((C.segmentFit[a.segment] ?? 0.3) * 100)}%`);
    const v = +a.estValueMinor || 0; add("scale", v >= 500000000 ? 1 : v >= 200000000 ? 0.75 : v >= 50000000 ? 0.5 : v > 0 ? 0.25 : 0, v ? `estimated EGP ${Math.round(v / 100).toLocaleString("en-US")} (an estimate, low weight)` : "no value estimate");
    const st = { construction: 1, tender: 1, handover: 0.8, design: 0.6, announced: 0.3, operating: 0.4 }[a.stage] || 0;
    const ev = (a.sources || []).filter((s) => s && s.url).length; add("evidence", ev ? st : st * 0.4, ev ? `${STAGES[a.stage] || "stage unknown"} — ${ev} source link(s)` : `${STAGES[a.stage] || "stage unknown"} — no source link, treated as provisional`);
    const t = a.procurementBy ? days(today, a.procurementBy) : null;
    add("timing", t == null ? 0 : t < 0 ? 0.3 : t <= 90 ? 1 : t <= 180 ? 0.7 : t <= 365 ? 0.4 : 0.15, t == null ? "procurement timing unknown" : t < 0 ? `expected procurement date passed (${a.procurementBy})` : `procurement expected in about ${Math.max(1, Math.round(t / 30))} month(s)`);
    const people = (a.contacts || []).filter((c) => c.name && c.source), dm = people.filter((c) => c.decisionMaker);
    add("people", dm.length ? 1 : people.length ? 0.5 : 0, dm.length ? `${dm.length} decision-maker(s) with a source` : people.length ? `${people.length} contact(s) with a source, no decision-maker yet` : "no sourced contact");
    const recent = touches.filter((x) => x.at && days(String(x.at).slice(0, 10), today) <= 90 && ["meeting", "call", "visit", "inbound", "referral", "email"].includes(x.kind));
    const meet = recent.filter((x) => ["meeting", "visit", "inbound"].includes(x.kind)).length;
    add("engagement", meet ? 1 : recent.length ? 0.5 : 0, recent.length ? `${recent.length} recorded interaction(s) in 90 days${meet ? `, ${meet} meeting / visit / enquiry` : ""}` : "no recorded two-way interaction (content views do not count)");
    add("need", a.confirmedNeed ? 1 : 0, a.confirmedNeed ? `need confirmed by ${a.confirmedNeedBy || "sales"}` : "need not confirmed by Sales");
    add("qualified", a.qualification === "qualified" ? 1 : a.qualification === "disqualified" ? 0 : 0.3, a.qualification === "qualified" ? "qualified by Sales" : a.qualification === "disqualified" ? "disqualified by Sales" : "not yet qualified");
    const fresh = a.verifiedAt ? days(String(a.verifiedAt).slice(0, 10), today) : null;
    add("freshness", fresh == null ? 0 : fresh <= 90 ? 1 : fresh <= 180 ? 0.5 : 0, fresh == null ? "sources never verified" : `sources verified ${fresh} day(s) ago`);
    const score = Math.round(F.reduce((s, f) => s + f.pts, 0)), auto = score >= C.priorityA ? "A" : score >= C.priorityB ? "B" : "C";
    const priority = a.priorityOverride && ["A", "B", "C"].includes(a.priorityOverride) ? a.priorityOverride : a.qualification === "disqualified" ? "C" : auto;
    return { score, auto, priority, overridden: priority !== auto, factors: F, provisional: !ev || fresh == null || fresh > 180 };
  }

  /* ---------------- attribution & dashboard ---------------- */
  const inRange = (d, from, to) => !!d && (!from || String(d).slice(0, 10) >= from) && (!to || String(d).slice(0, 10) <= to);
  /**
   * leads: [{id, campaignId, orgType, location, createdAt, qualification, ownerUid?}]
   * subs:  [{pid, leadId, ownerId, status, issuedAt, at, base:{totalMinor}, oid}]   (quotations)
   * orders:[{oid, totalMinor, status, bookedAt, ownerId, payments:[{status, amountMinor}]}]
   * touches: [{campaignId, leadId, accountId, kind, at}]
   * spend: [{campaignId, amountMinor, date}]  — verified ledger transactions only
   */
  function attribution({ campaigns = [], leads = [], subs = [], orders = [], touches = [], spend = [], cfg = null, from = null, to = null, scoreOf = null }) {
    const C = cfgOf(cfg), ordersBy = Object.fromEntries(orders.map((o) => [o.oid, o])), byLead = {};
    for (const s of subs) if (s.leadId) (byLead[s.leadId] = byLead[s.leadId] || []).push(s);
    const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));
    const qualified = (l) => (scoreOf ? (scoreOf(l.qualification) || 0) >= C.qualifiedScore : false) || (byLead[l.id] || []).length > 0;
    const out = {};
    for (const c of campaigns) {
      const sourced = leads.filter((l) => l.campaignId === c.id && inRange(l.createdAt, from, to));
      const infIds = new Set(touches.filter((t) => t.campaignId === c.id && t.leadId && leadById[t.leadId] && leadById[t.leadId].campaignId !== c.id && inRange(t.at, from, to)).map((t) => t.leadId));
      const tally = (ls) => { const qs = ls.flatMap((l) => byLead[l.id] || []).filter((s) => s.issuedAt || s.status !== "draft");
        const won = qs.filter((s) => s.oid && ordersBy[s.oid] && ordersBy[s.oid].status !== "cancelled"), seen = new Set(), wonU = won.filter((s) => (seen.has(s.oid) ? false : seen.add(s.oid)));
        const contract = wonU.reduce((a, s) => a + (+ordersBy[s.oid].totalMinor || 0), 0), cash = wonU.reduce((a, s) => a + (ordersBy[s.oid].payments || []).filter((p) => p.status === "verified").reduce((x, p) => x + (+p.amountMinor || 0), 0), 0);
        const open = qs.filter((s) => !s.oid && !["rejected", "withdrawn", "lost"].includes(s.status));
        return { leads: ls.length, qualified: ls.filter(qualified).length, quotations: qs.length, quoteMinor: qs.reduce((a, s) => a + (+(s.base && s.base.totalMinor) || 0), 0), openMinor: open.reduce((a, s) => a + (+(s.base && s.base.totalMinor) || 0), 0),
          contracts: wonU.length, contractMinor: contract, cashMinor: cash, oids: wonU.map((s) => s.oid) }; };
      const sp = spend.filter((x) => x.campaignId === c.id && inRange(x.date, from, to)).reduce((a, x) => a + (+x.amountMinor || 0), 0);
      const S = tally(sourced), I = tally([...infIds].map((id) => leadById[id]));
      out[c.id] = { id: c.id, name: c.name, sourced: S, influenced: I, spendMinor: sp, hasSpend: spend.some((x) => x.campaignId === c.id),
        costPerQualified: sp && S.qualified ? Math.round(sp / S.qualified) : null, roas: sp && S.contractMinor ? Math.round((S.contractMinor / sp) * 100) / 100 : null,
        touches: touches.filter((t) => t.campaignId === c.id && inRange(t.at, from, to)).length };
    }
    return out;
  }
  /** Contracts with more than one campaign involved: the recorded interactions, not a single "cause". */
  function multiTouch({ leads = [], subs = [], orders = [], touches = [] }) {
    const out = []; const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));
    for (const o of orders.filter((x) => x.status !== "cancelled")) { const s = subs.find((x) => x.oid === o.oid); if (!s || !s.leadId) continue; const l = leadById[s.leadId] || {};
      const camps = new Set([l.campaignId].concat(touches.filter((t) => t.leadId === s.leadId).map((t) => t.campaignId)).filter(Boolean));
      if (camps.size > 1) out.push({ oid: o.oid, leadId: s.leadId, firstSource: l.campaignId || null, campaigns: [...camps], interactions: touches.filter((t) => t.leadId === s.leadId).length }); }
    return out;
  }
  /** Funnel and segment reports from the same records (measured values only). */
  function funnel({ leads = [], subs = [], orders = [], from = null, to = null, cfg = null, scoreOf = null, groupBy = (l) => l.orgType || "other" }) {
    const C = cfgOf(cfg), ordersBy = Object.fromEntries(orders.map((o) => [o.oid, o])), out = {};
    for (const l of leads.filter((x) => inRange(x.createdAt, from, to))) {
      const g = groupBy(l) || "—", x = (out[g] = out[g] || { leads: 0, qualified: 0, quotations: 0, quoteMinor: 0, contracts: 0, contractMinor: 0, closeDays: [] });
      const qs = subs.filter((s) => s.leadId === l.id); x.leads++; if ((scoreOf ? (scoreOf(l.qualification) || 0) >= C.qualifiedScore : false) || qs.length) x.qualified++;
      x.quotations += qs.length; x.quoteMinor += qs.reduce((a, s) => a + (+(s.base && s.base.totalMinor) || 0), 0);
      for (const s of qs.filter((q) => q.oid && ordersBy[q.oid] && ordersBy[q.oid].status !== "cancelled")) { x.contracts++; x.contractMinor += +ordersBy[s.oid].totalMinor || 0; const b = ordersBy[s.oid].bookedAt || ordersBy[s.oid].acceptedAt; if (b && l.createdAt) x.closeDays.push(days(String(l.createdAt).slice(0, 10), String(b).slice(0, 10))); }
    }
    for (const x of Object.values(out)) { x.avgContractMinor = x.contracts ? Math.round(x.contractMinor / x.contracts) : null; x.avgCloseDays = x.closeDays.length ? Math.round(x.closeDays.reduce((a, b) => a + b, 0) / x.closeDays.length) : null; x.leadToQuote = x.leads ? Math.round((x.quotations ? Math.min(x.leads, x.quotations) : 0) / x.leads * 100) : null; x.quoteToContract = x.quotations ? Math.round(x.contracts / x.quotations * 100) : null; delete x.closeDays; }
    return out;
  }
  /** Stalled quotations: issued, not decided, no update for N days. */
  const stalled = (subs, n = 21, today = today0()) => subs.filter((s) => !s.oid && ["submitted", "issued"].includes(s.status || "submitted") && (s.issuedAt || s.at) && days(String(s.updatedAt || s.issuedAt || s.at).slice(0, 10), today) > n);

  /* ---------------- draft copy from real catalogue data ---------------- */
  function suggest(kind, { campaign = {}, products = [], company = "Dupedia", segment = null } = {}) {
    const seg = SEGMENTS[segment || campaign.segment] || "your project", ps = products.slice(0, 4), names = ps.map((p) => p.name).filter(Boolean);
    const dims = (p) => (p.dims && p.dims.l ? `${p.dims.l} × ${p.dims.w} m` : "");
    const list = ps.map((p) => `• ${p.name}${p.code ? " (" + p.code + ")" : ""}${dims(p) ? " — footprint " + dims(p) : ""}`).join("\n");
    const cta = campaign.cta || "Book a site visit and a free layout from our design team.";
    const T = {
      post: `${campaign.name || "New"} — play spaces designed for ${seg.toLowerCase()}.\n\n${names.length ? "Featuring " + names.join(", ") + "." : ""}\nPlanned to scale, manufactured and installed by ${company}.\n\n${cta}\n#${company} #PlaygroundDesign #Egypt`,
      reel: `Reel outline (20–30 s)\n1. Hook (0–3 s): the empty site → the finished play area.\n2. ${names[0] ? names[0] + " close-up" : "Hero product close-up"} (3–10 s).\n3. Factory / installation behind the scenes (10–20 s).\n4. Children / families using it (only with permission), logo and CTA: ${cta}`,
      case: `Case study draft — [client, location, year: fill in only from the real project]\nChallenge: …\nWhat ${company} did: layout in the Site Planner, products ${names.join(", ") || "…"}, manufacturing, installation.\nResult: [handover date, area, number of users — real figures only].`,
      showcase: `Product showcase\n${list || "• (choose products from Dupedia Products)"}\nAll products planned to scale; safety zones from the manufacturers' published data.\n${cta}`,
      outreach: `Dear [name],\n\nI am [your name] from ${company}. We design, manufacture and install play and leisure areas for ${seg.toLowerCase()} in Egypt.\n\n${names.length ? "For a project like yours we would propose " + names.slice(0, 3).join(", ") + ", planned to your site's dimensions." : "We would be glad to propose a layout planned to your site's dimensions."}\n\nWould you have 20 minutes next week for a short call or a site visit?\n\nBest regards,\n[your name]\n${company}`,
      concept: `Campaign concept: "${campaign.name || "…"}"\nAudience: ${seg}. Objective: ${campaign.objective || "qualified site visits"}.\nCore message: play spaces that are safe, durable and delivered on time.\nAssets: product showcase (${names.length || "n"} products), one case study, a short reel, a one-to-one outreach message.\nMeasure: qualified leads, meetings, quotations, signed contracts — not likes.`,
    };
    return T[kind] || T.post;
  }
  /** Simple campaign source code used in links and lead records: CMP-YYMM-XXX. */
  const sourceCode = (name, d = new Date()) => `CMP-${d.toISOString().slice(2, 4)}${d.toISOString().slice(5, 7)}-${(String(name || "X").replace(/[^A-Za-z]/g, "").toUpperCase() + "XXX").slice(0, 3)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

  root.DPGrowth = { SEGMENTS, ORG_TO_SEG, SEG_TO_ORG, CHANNELS, CAMP_STATUS, CONTENT_KINDS, CONTENT_STATUS, STAGES, PART_TYPES, PART_STATUS, TOUCH, DEFAULT_CFG, cfgOf, scoreAccount, attribution, multiTouch, funnel, stalled, suggest, sourceCode, inRange };
})(typeof self !== "undefined" ? self : this);
