/* X FORCE 1.4 (Dupedia) — Growth & Marketing Center: data layer.

     mkt/cfg                      scoring weights, thresholds                        administrators
     mkt/camp/c/<id>              campaign + content calendar (posts, reels, briefs,
                                  outreach drafts, CTA, destination, approvals)      Marketing + administrators write; staff read
     mkt/camp/c/<id>/f/<fid>/c/…  creative assets (images, PDFs, short videos ≤ 6 MB)
     mkt/radar/a/<id>             Project Radar: target account / project research   Marketing + administrators; the account's
                                                                                     owner (sales) updates next action, notes,
                                                                                     qualification feedback
     mkt/part/p/<id>              partnership pipeline                                Marketing + administrators; relationship owner
     mkt/touch/t/<id>             recorded interactions (meeting, call, visit,
                                  campaign engagement) with lead / account / partner  any staff, append-only
   Leads stay in the ONE Lead Mine (leads/<id>) with campaignId = first source. Quotations, orders and payments are the
   existing records; spend is Finance's verified ledger transactions linked to a campaign (fin/tx … links.campaign).
   The Worker (worker/index.js mktGuard) enforces who may write what. */
/* global DPStore, DPAuth, DPNotify, DPLeads, DPGrowth */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, G = () => root.DPGrowth, NT = () => root.DPNotify;
  const now = () => new Date().toISOString(), me = () => AU().A.me || {};
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isAdmin = () => AU().isAdmin(), isMkt = () => isAdmin() || me().role === "marketing";
  const reqMkt = () => { if (!isMkt()) throw new Error("Marketing or administrators only."); };
  const list = async (c) => (await DS().tryList(c)).map((x) => Object.assign({ id: x.id }, x.data));
  const hist = (o, action, detail = "") => { o.history = (o.history || []).concat([{ at: now(), by: me().id, action, detail: String(detail).slice(0, 300) }]).slice(-120); };
  let CFG = null;
  async function cfg(force) { if (!CFG || force) CFG = G().cfgOf(await DS().tryGet("mkt/cfg")); return CFG; }
  async function saveCfg(c, reason = "") { if (!isAdmin()) throw new Error("Administrators only."); const next = Object.assign({}, await cfg(true), c, { updatedAt: now(), updatedBy: me().id });
    await DS().set("mkt/cfg", next); CFG = G().cfgOf(next); await AU().auditLog("Marketing scoring settings changed", { kind: "lead", reason, after: { weights: next.weights, priorityA: next.priorityA, priorityB: next.priorityB } }).catch(() => {}); return CFG; }

  /* ---------------- campaigns & content ---------------- */
  const campaigns = async () => (await list("mkt/camp/c")).sort((a, b) => String(b.start || b.createdAt).localeCompare(String(a.start || a.createdAt)));
  const getCampaign = (id) => DS().tryGet(`mkt/camp/c/${id}`).then((c) => (c ? Object.assign({ id }, c) : null));
  async function saveCampaign(c) {
    reqMkt(); if (!String(c.name || "").trim()) throw new Error("Name the campaign."); if (!String(c.objective || "").trim()) throw new Error("State the objective (e.g. 15 qualified site visits from schools).");
    if (c.start && c.end && c.end < c.start) throw new Error("The end date is before the start date.");
    const id = c.id || rid("cp-"), path = `mkt/camp/c/${id}`, prev = await DS().tryGet(path);
    const rec = Object.assign({}, prev || {}, { name: c.name.trim().slice(0, 120), objective: String(c.objective).trim().slice(0, 500), segment: G().SEGMENTS[c.segment] ? c.segment : "other", segments: c.segments || [c.segment].filter(Boolean),
      products: (c.products || []).slice(0, 40), ownerUid: c.ownerUid || (prev && prev.ownerUid) || me().id, start: c.start || null, end: c.end || null, budgetMinor: c.budgetMinor != null && c.budgetMinor !== "" ? Math.max(0, Math.round(+c.budgetMinor)) : null,
      channels: (c.channels || []).filter((x) => G().CHANNELS[x]), status: G().CAMP_STATUS[c.status] ? c.status : (prev && prev.status) || "draft", cta: String(c.cta || "").slice(0, 200), destination: String(c.destination || "").slice(0, 300),
      location: String(c.location || "").slice(0, 120), source: (prev && prev.source) || G().sourceCode(c.name), content: (prev && prev.content) || [], updatedAt: now(), updatedBy: me().id, createdAt: (prev && prev.createdAt) || now(), createdBy: (prev && prev.createdBy) || me().id });
    // a running campaign with spend or outside messaging needs an administrator's approval first
    if (["approved", "live"].includes(rec.status) && !isAdmin() && !(prev && ["approved", "live", "paused"].includes(prev.status))) throw new Error("An administrator approves a campaign before it runs (budget and external messaging).");
    if (rec.status === "approved" && (!prev || prev.status !== "approved")) Object.assign(rec, { approvedBy: me().id, approvedAt: now() });
    hist(rec, prev ? "Edited" : "Created", rec.status); await DS().set(path, rec);
    if (!prev && rec.ownerUid !== me().id && NT()) await NT().deliver(rec.ownerUid, { id: `mkt-owner-${id}`, type: "lead", title: "Campaign assigned to you", body: rec.name, link: { view: "campaigns", opts: { id } } }).catch(() => {});
    if (rec.status === "awaiting" && (!prev || prev.status !== "awaiting") && NT()) await NT().deliver("@admins", { id: `mkt-appr-${id}-${Date.now().toString(36)}`, type: "lead", title: "Campaign awaiting approval", body: `${rec.name}${rec.budgetMinor ? " — planned budget EGP " + (rec.budgetMinor / 100).toLocaleString("en-US") : ""}`, link: { view: "campaigns", opts: { id } } }).catch(() => {});
    return Object.assign({ id }, rec);
  }
  /** Add or update one content item (post, reel, case study, outreach draft…) in the campaign's calendar. */
  async function saveContent(cid, item) {
    reqMkt(); const path = `mkt/camp/c/${cid}`, c = await DS().get(path); if (!c) throw new Error("Campaign not found.");
    if (!G().CONTENT_KINDS[item.kind]) throw new Error("Choose the content type."); if (!item.date) throw new Error("Choose the planned date.");
    const id = item.id || rid("ct-"), prev = (c.content || []).find((x) => x.id === id) || {};
    const st = G().CONTENT_STATUS[item.status] ? item.status : prev.status || "draft";
    if (["approved", "published"].includes(st) && prev.status !== st && !isAdmin() && !(st === "published" && prev.status === "approved")) throw new Error("An administrator approves content before it is published.");
    const rec = Object.assign({}, prev, { id, kind: item.kind, channel: G().CHANNELS[item.channel] ? item.channel : "other", date: item.date, title: String(item.title || "").slice(0, 140), caption: String(item.caption || "").slice(0, 4000),
      brief: String(item.brief || "").slice(0, 4000), cta: String(item.cta || c.cta || "").slice(0, 200), destination: String(item.destination || c.destination || "").slice(0, 300), status: st, assets: prev.assets || [], updatedAt: now(), updatedBy: me().id },
      st === "approved" && prev.status !== "approved" ? { approvedBy: me().id, approvedAt: now() } : {}, st === "published" && prev.status !== "published" ? { publishedRecordedBy: me().id, publishedAt: item.publishedAt || now(), url: item.url || "" } : {});
    c.content = (c.content || []).filter((x) => x.id !== id).concat([rec]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    hist(c, prev.id ? "Content edited" : "Content added", `${G().CONTENT_KINDS[rec.kind]} · ${rec.date} · ${G().CONTENT_STATUS[st]}`); c.updatedAt = now(); await DS().set(path, c);
    if (st === "review" && prev.status !== "review" && NT()) await NT().deliver("@admins", { id: `mkt-rev-${cid}-${id}`, type: "lead", title: "Content waiting for approval", body: `${c.name}: ${rec.title || G().CONTENT_KINDS[rec.kind]} (${rec.date})`, link: { view: "campaigns", opts: { id: cid } } }).catch(() => {});
    return rec;
  }
  async function addAsset(cid, contentId, file) { reqMkt(); const fid = rid("as-"); await root.DPOrders.putFile(`mkt/camp/c/${cid}/f/${fid}`, file); const path = `mkt/camp/c/${cid}`, c = await DS().get(path);
    const it = (c.content || []).find((x) => x.id === contentId); if (!it) throw new Error("Content item not found."); it.assets = (it.assets || []).concat([{ id: fid, name: file.name, type: file.type, size: file.size, at: now() }]); await DS().set(path, c); return it; }
  const asset = (cid, fid) => root.DPOrders.getFile(`mkt/camp/c/${cid}/f/${fid}`);

  /* ---------------- Project Radar ---------------- */
  const accounts = async () => list("mkt/radar/a");
  async function saveAccount(a, { reason = "" } = {}) {
    const id = a.id || rid("ra-"), path = `mkt/radar/a/${id}`, prev = await DS().tryGet(path), owner = prev && prev.ownerUid === me().id;
    if (!isMkt() && !owner) throw new Error("Only Marketing, administrators or the account's owner can edit it.");
    if (!String(a.company != null ? a.company : (prev && prev.company) || "").trim()) throw new Error("Enter the company name.");
    for (const c of a.contacts || []) if ((c.phone || c.email) && !String(c.source || "").trim()) throw new Error(`Contact ${c.name || ""}: record where the phone / e-mail comes from — never enter invented details.`);
    for (const s of a.sources || []) if (s.url && !/^https?:\/\//.test(s.url)) throw new Error("Source links must start with https://");
    const ownerFields = ["nextAction", "nextDue", "notes", "qualification", "confirmedNeed", "priorityOverride", "feedback"];
    const base = Object.assign({}, prev || {});
    const src = !isMkt() && owner ? Object.fromEntries(ownerFields.filter((k) => k in a).map((k) => [k, a[k]])) : a;
    const rec = Object.assign(base, src, { company: String((src.company != null ? src.company : base.company) || "").trim().slice(0, 160), segment: G().SEGMENTS[(src.segment || base.segment)] ? (src.segment || base.segment) : "other",
      estValueMinor: src.estValueMinor != null && src.estValueMinor !== "" ? Math.max(0, Math.round(+src.estValueMinor)) : base.estValueMinor || null,
      updatedAt: now(), updatedBy: me().id, createdAt: base.createdAt || now(), createdBy: base.createdBy || me().id });
    delete rec.id; if (!isMkt()) rec.ownerUid = base.ownerUid;
    if (src.confirmedNeed && !(prev && prev.confirmedNeed)) rec.confirmedNeedBy = AU().nameSync(me().id) || "sales";
    if ("priorityOverride" in src && (src.priorityOverride || null) !== ((prev && prev.priorityOverride) || null) && !String(reason || src.feedback || "").trim()) throw new Error("Give the reason for changing the priority.");
    if (src.feedback && src.feedback !== (prev && prev.feedback)) rec.feedbackLog = ((prev && prev.feedbackLog) || []).concat([{ at: now(), by: me().id, text: String(src.feedback).slice(0, 600), priority: rec.priorityOverride || null, qualification: rec.qualification || null }]).slice(-40);
    hist(rec, prev ? "Edited" : "Added to the Radar", reason);
    await DS().set(path, rec);
    if (rec.ownerUid && (!prev || prev.ownerUid !== rec.ownerUid) && rec.ownerUid !== me().id && NT()) await NT().deliver(rec.ownerUid, { id: `radar-own-${id}-${rec.ownerUid}`, type: "lead", title: "Target account assigned to you", body: `${rec.company}${rec.project ? " — " + rec.project : ""}${rec.nextAction ? ". Next: " + rec.nextAction : ""}`, link: { view: "radar", opts: { id } } }).catch(() => {});
    return Object.assign({ id }, rec);
  }
  /** Import researched accounts (rows already parsed: {company, project, segment, location, website, source, verifiedAt, stage, …}).
   *  Rows without a source link are imported as PROVISIONAL. Duplicates (same normalised company + project) are skipped. */
  async function importAccounts(rows, { origin = "research import" } = {}) {
    reqMkt(); const have = await accounts(), key = (x) => `${String(x.company || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "")}|${String(x.project || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "")}`;
    const seen = new Set(have.map(key)); let added = 0, skipped = 0; const rejected = [];
    for (const [i, r] of rows.entries()) { if (!String(r.company || "").trim()) { rejected.push({ row: i + 2, why: "company missing" }); continue; } if (seen.has(key(r))) { skipped++; continue; }
      const src = r.source && /^https?:\/\//.test(r.source) ? [{ url: r.source, date: r.verifiedAt || null }] : [];
      await saveAccount({ company: r.company, project: r.project || "", segment: r.segment || "other", location: r.location || "", website: /^https?:\/\//.test(r.website || "") ? r.website : "", sources: src, verifiedAt: src.length ? r.verifiedAt || null : null,
        stage: G().STAGES[r.stage] ? r.stage : "unknown", procurementBy: r.procurementBy || null, products: r.products || "", notes: r.notes || "", origin, provisional: !src.length, contacts: [] }); seen.add(key(r)); added++; }
    return { added, skipped, rejected };
  }
  /** Hand a qualified Radar account to Sales: ONE lead in the existing Lead Mine (campaign source kept), no duplicates. */
  async function toLeadMine(id, { campaignId = null } = {}) {
    reqMkt(); const path = `mkt/radar/a/${id}`, a = await DS().get(path); if (!a) throw new Error("Account not found.");
    if (a.leadId && (await DS().tryGet(`leads/${a.leadId}`))) return { leadId: a.leadId, existed: true };
    const c0 = (a.contacts || [])[0] || {};
    let leadId;
    try { leadId = await root.DPLeads.createLead({ name: a.company, orgType: G().SEG_TO_ORG[a.segment] || "other", location: a.location || "", website: a.website || "", projects: [a.project, a.products].filter(Boolean).join(" — "), evidence: a.notes || "",
      sources: (a.sources || []).filter((s) => s.url), contact: { name: c0.name || "", title: c0.role || "", phone: c0.phone || "", email: c0.email || "", source: c0.source || "", sub: "none" }, campaignId: campaignId || a.campaignId || null, radarId: id }); }
    catch (e) { if (e.code === "duplicate" && e.leadId) leadId = e.leadId; else throw e; }
    a.leadId = leadId; hist(a, "Sent to the Lead Mine", leadId); await DS().set(path, a);
    const sales = a.ownerUid ? [a.ownerUid] : AU().A.directory.filter((r) => r.uid && r.active !== false && AU().baseOf(r.role) === "employee").map((r) => r.uid);
    if (NT() && sales.length) await NT().deliver(sales, { id: `radar-lead-${id}`, type: "lead", title: "New qualified lead from Marketing", body: `${a.company}${a.project ? " — " + a.project : ""}`, link: { view: "leads" }, ref: leadId }).catch(() => {});
    return { leadId, existed: false };
  }

  /* ---------------- partnerships ---------------- */
  const partners = async () => list("mkt/part/p");
  async function savePartner(p) {
    const id = p.id || rid("pa-"), path = `mkt/part/p/${id}`, prev = await DS().tryGet(path), owner = prev && prev.ownerUid === me().id;
    if (!isMkt() && !owner) throw new Error("Only Marketing, administrators or the relationship owner can edit it.");
    if (!String(p.name || "").trim()) throw new Error("Enter the partner's name.");
    for (const c of p.contacts || []) if ((c.phone || c.email) && !String(c.source || "").trim()) throw new Error(`Contact ${c.name || ""}: record where the details come from.`);
    const rec = Object.assign({}, prev || {}, p, { name: p.name.trim().slice(0, 160), type: G().PART_TYPES[p.type] ? p.type : "other", status: G().PART_STATUS[p.status] ? p.status : "prospect", updatedAt: now(), updatedBy: me().id, createdAt: (prev && prev.createdAt) || now() });
    delete rec.id; if (!isMkt()) rec.ownerUid = prev.ownerUid; hist(rec, prev ? "Edited" : "Added"); await DS().set(path, rec);
    if (rec.ownerUid && (!prev || prev.ownerUid !== rec.ownerUid) && rec.ownerUid !== me().id && NT()) await NT().deliver(rec.ownerUid, { id: `part-own-${id}-${rec.ownerUid}`, type: "lead", title: "Partnership assigned to you", body: rec.name, link: { view: "partners", opts: { id } } }).catch(() => {});
    return Object.assign({ id }, rec);
  }
  /** A referral: the partner brought a lead (existing Lead Mine record) — kept on the partner and as an interaction. */
  async function addReferral(pid, leadId, note = "") { const path = `mkt/part/p/${pid}`, p = await DS().get(path); if (!p) throw new Error("Partner not found.");
    if (!isMkt() && p.ownerUid !== me().id) throw new Error("Only Marketing, administrators or the relationship owner can record referrals.");
    p.referrals = (p.referrals || []).filter((r) => r.leadId !== leadId).concat([{ leadId, note: String(note).slice(0, 300), at: now(), by: me().id }]); hist(p, "Referral recorded", leadId); await DS().set(path, p);
    await logTouch({ partnerId: pid, leadId, kind: "referral", note }); return p; }

  /* ---------------- interactions (append-only) ---------------- */
  const touches = async () => list("mkt/touch/t");
  async function logTouch(t) {
    const u = me(); if (!u.id || u.role === "viewer") throw new Error("View-only access cannot log interactions."); if (!G().TOUCH[t.kind]) throw new Error("Choose what happened.");
    if (!t.leadId && !t.accountId && !t.partnerId) throw new Error("Link the interaction to a lead, account or partner.");
    const id = rid("tc-"), rec = { kind: t.kind, campaignId: t.campaignId || null, leadId: t.leadId || null, accountId: t.accountId || null, partnerId: t.partnerId || null, note: String(t.note || "").slice(0, 600), outcome: String(t.outcome || "").slice(0, 200), at: t.at || now(), by: u.id };
    const r = await DS().create(`mkt/touch/t/${id}`, rec); if (!r.created) throw new Error("Not recorded — try again.");
    if (t.accountId && t.nextAction) { await saveAccount({ id: t.accountId, nextAction: t.nextAction, nextDue: t.nextDue || null }).catch(() => {}); }
    return Object.assign({ id }, rec);
  }

  /* ---------------- everything the dashboard needs, honestly limited by what this person may read ---------------- */
  async function snapshot() {
    const admin = isAdmin(), fin = AU().isFinance && AU().isFinance();
    const [C, camps, accs, parts, tch, leads] = await Promise.all([cfg(true), campaigns(), accounts(), partners(), touches(), root.DPLeads.listLeads()]);
    let subs = [], orders = [], spend = [], full = false;
    if (admin || fin) { full = true;
      [subs, orders] = await Promise.all([admin ? root.DPSales.allSubmissions().catch(() => []) : Promise.resolve([]), root.DPSales.listOrders().catch(() => [])]);
      if (!admin) { full = false; }
      const txs = root.DPFin ? await root.DPFin.txs().catch(() => []) : [];
      spend = txs.filter((t) => t.status === "verified" && t.direction === "out" && t.links && t.links.campaign).map((t) => ({ campaignId: t.links.campaign, amountMinor: t.type === "reversal" ? -t.amountMinor : t.amountMinor, date: t.date, ref: t.ref })); }
    return { cfg: C, campaigns: camps, accounts: accs, partners: parts, touches: tch, leads, subs, orders, spend, full };
  }

  root.DPMkt = { cfg, saveCfg, isMkt, campaigns, getCampaign, saveCampaign, saveContent, addAsset, asset, accounts, saveAccount, importAccounts, toLeadMine, partners, savePartner, addReferral, touches, logTouch, snapshot };
})(typeof self !== "undefined" ? self : this);
