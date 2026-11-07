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
  /* Shared, deterministic reporting. Dates are event dates in activity mode and
     lead-acquisition dates in cohort mode. Both stop at the selected end date. */
  const oidOf = (s) => s.oid || s.orderId;
  const quoteDate = (s) => s.issuedAt || s.at;
  const orderDate = (o) => o.acceptedAt || o.bookedAt || o.approvedAt;
  const byEnd = (date, to) => !!date && (!to || String(date).slice(0, 10) <= to);
  const isQuote = (s) => s.status !== 'draft' && !!quoteDate(s);
  function unique(rows, key) {
    const out = new Map();
    for (const row of rows) { const k = key(row); if (!k) continue; const prev = out.get(k);
      if (!prev || (+row.rev || 0) > (+prev.rev || 0) || ((+row.rev || 0) === (+prev.rev || 0) && String(row.updatedAt || row.at || '') > String(prev.updatedAt || prev.at || ''))) out.set(k, row);
    } return [...out.values()];
  }
  function measure({ leads = [], subs = [], orders = [], from = null, to = null, mode = 'activity', cfg = null, scoreOf = null }) {
    const C = cfgOf(cfg), all = leads.filter(l => byEnd(l.createdAt, to)), cohort = all.filter(l => inRange(l.createdAt, from, to));
    const population = mode === 'cohort' ? cohort : all, ids = new Set(population.map(l => l.id)), cohortIds = new Set(cohort.map(l => l.id));
    const qs = unique(subs.filter(s => ids.has(s.leadId) && isQuote(s) && byEnd(quoteDate(s), to)), s => `${s.ownerId || ''}/${s.pid || s.id || ''}`);
    const qids = new Set(qs.map(oidOf).filter(Boolean));
    const os = unique(orders.filter(o => o.status !== 'cancelled' && (ids.has(o.leadId) || qids.has(o.oid)) && byEnd(orderDate(o), to)), o => o.oid);
    const shownQ = mode === 'cohort' ? qs : qs.filter(s => inRange(quoteDate(s), from, to));
    const shownO = mode === 'cohort' ? os : os.filter(o => inRange(orderDate(o), from, to));
    const quoted = new Set(qs.map(s => s.leadId)), cohortQ = qs.filter(s => cohortIds.has(s.leadId));
    const wonIds = new Set(os.map(o => o.oid)), cohortWonQ = cohortQ.filter(s => wonIds.has(oidOf(s)) || os.some(o => o.pid === s.pid && (!o.ownerId || o.ownerId === s.ownerId)));
    const outstanding = qs.filter(s => !qids.has(oidOf(s)) && !['rejected','withdrawn','lost','accepted','approved'].includes(s.status));
    // A linked order closes its quotation even when the submission has no oid yet.
    const open = outstanding.filter(s => !os.some(o => o.pid === s.pid && (!o.ownerId || o.ownerId === s.ownerId)));
    const closeDays = shownO.map(o => {const l = population.find(l => l.id === o.leadId) || population.find(l => qs.some(q => q.leadId === l.id && oidOf(q) === o.oid)); return l ? days(String(l.createdAt).slice(0,10),String(orderDate(o)).slice(0,10)) : null;}).filter(n => n != null && n >= 0);
    const cashOrders = mode === 'cohort' ? os : os;
    const cash = cashOrders.reduce((sum,o) => sum + (o.payments || []).filter(p => p.status === 'verified' && (mode === 'cohort' ? byEnd(p.date || p.verifiedAt || p.at,to) : inRange(p.date || p.verifiedAt || p.at,from,to))).reduce((s,p) => s + (+p.amountMinor || 0),0),0);
    return { leads: cohort.length, qualified: cohort.filter(l => (scoreOf ? (+scoreOf(l.qualification) || 0) >= C.qualifiedScore : l.qualification === 'qualified') || quoted.has(l.id)).length,
      quotations: shownQ.length, quoteMinor: shownQ.reduce((s,q) => s + (+(q.base || {}).totalMinor || 0),0),
      openMinor: open.reduce((s,q) => s + (+(q.base || {}).totalMinor || 0),0), contracts: shownO.length, contractMinor: shownO.reduce((s,o) => s + (+o.totalMinor || 0),0), cashMinor: cash,
      oids: shownO.map(o => o.oid), cohortLeads: cohort.length, cohortQuotedLeads: cohort.filter(l => quoted.has(l.id)).length, cohortQuotations: cohortQ.length, cohortWonQuotations: cohortWonQ.length,
      leadToQuote: cohort.length ? Math.round(cohort.filter(l => quoted.has(l.id)).length / cohort.length * 100) : null,
      quoteToContract: cohortQ.length ? Math.round(cohortWonQ.length / cohortQ.length * 100) : null,
      avgContractMinor: shownO.length ? Math.round(shownO.reduce((s,o) => s + (+o.totalMinor || 0),0)/shownO.length) : null,
      avgCloseDays: closeDays.length ? Math.round(closeDays.reduce((s,n)=>s+n,0)/closeDays.length) : null };
  }
  function attribution({ campaigns = [], leads = [], subs = [], orders = [], touches = [], spend = [], cfg = null, from = null, to = null, mode = 'activity', scoreOf = null }) {
    const out = {};
    for (const c of campaigns) {
      const sourced = leads.filter(l => l.campaignId === c.id), firstTouch = new Map();
      for (const t of touches.filter(t => t.campaignId === c.id && t.leadId && byEnd(t.at,to))) {
        if (!firstTouch.has(t.leadId) || String(t.at) < firstTouch.get(t.leadId)) firstTouch.set(t.leadId, String(t.at));
      }
      // An interaction can influence only later events, not a quotation or sale already made.
      const afterTouch = (leadId, date) => firstTouch.has(leadId) && !!date && String(date).slice(0,10) >= firstTouch.get(leadId).slice(0,10) && (String(date).length <= 10 || String(date) >= firstTouch.get(leadId));
      const influencedSubs = subs.filter(q => afterTouch(q.leadId, quoteDate(q)));
      const influencedOrders = orders.map(o => {
        const q = subs.find(q => oidOf(q) === o.oid || (q.pid === o.pid && q.ownerId === o.ownerId));
        return o.leadId ? o : {...o, leadId: q && q.leadId};
      }).filter(o => afterTouch(o.leadId, orderDate(o)));
      const common = {subs,orders,cfg,from,to,mode,scoreOf};
      const S = measure({...common,leads:sourced}), I = measure({...common,subs:influencedSubs,orders:influencedOrders,leads:leads.filter(l => l.campaignId !== c.id && firstTouch.has(l.id))});
      const costs = spend.filter(x => x.campaignId === c.id && inRange(x.date,from,to)), sp = costs.reduce((s,x)=>s+(+x.amountMinor||0),0);
      out[c.id] = {id:c.id,name:c.name,sourced:S,influenced:I,spendMinor:sp,hasSpend:costs.length>0,costPerQualified:sp>0&&S.qualified?Math.round(sp/S.qualified):null,
        roas:mode==='activity'&&sp>0&&S.contractMinor?Math.round(S.contractMinor/sp*100)/100:null,touches:touches.filter(t=>t.campaignId===c.id&&inRange(t.at,from,to)).length};
    } return out;
  }
  function funnel(input) {
    const {leads = [], groupBy = l=>l.orgType||'other'} = input, groups = {};
    for(const l of leads)(groups[groupBy(l)||'—'] ||= []).push(l);
    const out={}; for(const [key,ls]of Object.entries(groups)){const m=measure({...input,leads:ls});if(m.leads||m.quotations||m.contracts||m.cashMinor)out[key]=m;}return out;
  }
  function multiTouch({leads=[],subs=[],orders=[],touches=[],from=null,to=null,mode='activity'}) {
    const chosen=measure({leads,subs,orders,from,to,mode}).oids, out=[];
    for(const o of orders.filter(o=>chosen.includes(o.oid))){const q=subs.find(s=>oidOf(s)===o.oid),lid=o.leadId||(q&&q.leadId),l=leads.find(l=>l.id===lid)||{};
      const ts=touches.filter(t=>t.leadId===lid&&byEnd(t.at,orderDate(o))),campaigns=[...new Set([l.campaignId,...ts.map(t=>t.campaignId)].filter(Boolean))];
      if(campaigns.length>1)out.push({oid:o.oid,leadId:lid,firstSource:l.campaignId||null,campaigns,interactions:ts.length});}return out;
  }
  function filterSnapshot(S,F={}) {
    const camps=S.campaigns.filter(c=>(!F.camp||c.id===F.camp)&&(!F.channel||(c.channels||[]).includes(F.channel))&&(!F.seg||c.segment===F.seg||(c.segments||[]).includes(F.seg)));
    const selected=!!(F.camp||F.channel),campIds=new Set(camps.map(c=>c.id)),loc=String(F.loc||'').toLowerCase();
    const leadIdsForOwner=new Set(S.subs.filter(q=>q.ownerId===F.sp).map(q=>q.leadId));
    const leads=S.leads.filter(l=>(!selected||campIds.has(l.campaignId)||S.touches.some(t=>t.leadId===l.id&&campIds.has(t.campaignId)&&byEnd(t.at,F.to)))&&(!F.seg||(ORG_TO_SEG[l.orgType]||'other')===F.seg)&&(!loc||String(l.location||'').toLowerCase().includes(loc))&&(!F.sp||l.ownerUid===F.sp||l.assignedTo===F.sp||leadIdsForOwner.has(l.id)));
    const ids=new Set(leads.map(l=>l.id));
    const subs=S.subs.filter(q=>ids.has(q.leadId)&&(!F.sp||q.ownerId===F.sp));
    const orders=S.orders.filter(o=>(ids.has(o.leadId)||subs.some(q=>oidOf(q)===o.oid||q.pid===o.pid))&&(!F.sp||o.ownerId===F.sp));
    const accounts=S.accounts.filter(a=>(!selected||campIds.has(a.campaignId)||ids.has(a.leadId))&&(!F.seg||a.segment===F.seg)&&(!loc||String(a.location||'').toLowerCase().includes(loc))&&(!F.sp||a.ownerUid===F.sp));
    const restricted=selected||F.seg||loc||F.sp,partners=S.partners.filter(p=>!restricted||(p.referrals||[]).some(r=>ids.has(r.leadId)));
    const aids=new Set(accounts.map(a=>a.id)),pids=new Set(partners.map(p=>p.id));
    const touches=S.touches.filter(t=>(!selected||campIds.has(t.campaignId))&&(ids.has(t.leadId)||aids.has(t.accountId)||pids.has(t.partnerId))&&(!F.sp||ids.has(t.leadId)||accounts.some(a=>a.id===t.accountId&&a.ownerUid===F.sp)));
    return {camps,leads,subs,orders,accounts,partners,touches,spend:S.spend.filter(x=>campIds.has(x.campaignId)),spendComparable:!F.sp&&!loc};
  }
  function followUpStats(accounts,{from=null,to=null,today=today0()}={}) {
    const cutoff=to&&to<today?to:today,entries=[];
    for(const a of accounts){const done=a.followUpCompletions||[],seen=new Set();
      for(const x of done){const key=`${x.due}|${x.action}`;if(!seen.has(key)&&inRange(x.due,from,cutoff)){seen.add(key);entries.push({due:x.due,completed:byEnd(x.completedAt,to||today),onTime:String(x.completedAt||'').slice(0,10)<=x.due});}}
      if(a.nextDue&&inRange(a.nextDue,from,cutoff)&&!seen.has(`${a.nextDue}|${a.nextAction||''}`))entries.push({due:a.nextDue,completed:false,onTime:false});
    }return {due:entries.length,completed:entries.filter(x=>x.completed).length,onTime:entries.filter(x=>x.completed&&x.onTime).length};
  }
  const CAMP_APPROVAL_FIELDS=['name','objective','segment','segments','products','ownerUid','start','end','budgetMinor','channels','cta','destination','location','source'];
  const CONTENT_APPROVAL_FIELDS=['kind','channel','date','title','caption','brief','cta','destination','assets'];
  const APPROVAL_FIELDS=['approvedBy','approvedAt','approvalFingerprint'];
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x??null;
  const fingerprint=(r,kind='campaign')=>JSON.stringify((kind==='content'?CONTENT_APPROVAL_FIELDS:CAMP_APPROVAL_FIELDS).map(k=>stable(r&&r[k])));
  const hasApproval=(r,kind='campaign')=>!!(r&&r.approvedBy&&r.approvedAt&&r.approvalFingerprint===fingerprint(r,kind));
  function clearApproval(r){for(const k of APPROVAL_FIELDS)delete r[k];return r;}
  function prepareApproval(old,next,{kind='campaign',admin=false,approve=false,by,at}={}){
    const approved=kind==='campaign'?['approved','live']:['approved','published'],changed=old&&fingerprint(old,kind)!==fingerprint(next,kind);
    if(changed&&APPROVAL_FIELDS.some(k=>old[k])){clearApproval(next);if(approved.includes(next.status))next.status=kind==='campaign'?'awaiting':'review';}
    if(admin&&(approve||(next.status==='approved'&&(!old||old.status!=='approved')))){next.status='approved';next.approvedBy=by;next.approvedAt=at;next.approvalFingerprint=fingerprint(next,kind);}
    if(approved.includes(next.status)&&!hasApproval(next,kind))throw new Error('Approve this version before it runs or is published.');
    return next;
  }
  function approvalGuard(old,next,{admin=false,uid}={}){
    const check=(a,b,kind)=>{
      const fieldsChanged=APPROVAL_FIELDS.some(k=>(a&&a[k]||null)!==(b[k]||null));
      if(fieldsChanged&&APPROVAL_FIELDS.some(k=>b[k])&&(!admin||b.approvedBy!==uid))return 'Only an administrator can approve a specific version.';
      const states=kind==='campaign'?['approved','live']:['approved','published'];
      if(states.includes(b.status)){
        if(!hasApproval(b,kind))return 'The current version needs administrator approval.';
        if(!admin&&(!hasApproval(a,kind)||a.approvalFingerprint!==b.approvalFingerprint))return 'An administrator must approve this version first.';
        if(a&&fingerprint(a,kind)!==fingerprint(b,kind)&&b.approvedAt===a.approvedAt)return 'Changed material needs a new approval.';
      }
      return null;
    };
    let err=check(old,next,'campaign');if(err)return err;
    const prior=new Map(((old&&old.content)||[]).map(c=>[c.id,c]));
    for(const c of next.content||[]){err=check(prior.get(c.id),c,'content');if(err)return err;}
    return null;
  }

  /** Stalled quotations: issued, not decided, no update for N days. */
  const stalled = (subs, n = 21, today = today0()) => subs.filter((s) => !oidOf(s) && ["submitted", "issued"].includes(s.status || "submitted") && (s.issuedAt || s.at) && days(String(s.updatedAt || s.issuedAt || s.at).slice(0, 10), today) > n);

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

  root.DPGrowth = { SEGMENTS, ORG_TO_SEG, SEG_TO_ORG, CHANNELS, CAMP_STATUS, CONTENT_KINDS, CONTENT_STATUS, STAGES, PART_TYPES, PART_STATUS, TOUCH, DEFAULT_CFG, cfgOf, scoreAccount, measure, filterSnapshot, followUpStats, fingerprint, hasApproval, prepareApproval, approvalGuard, clearApproval, attribution, multiTouch, funnel, stalled, suggest, sourceCode, inRange };
})(typeof self !== "undefined" ? self : globalThis);
