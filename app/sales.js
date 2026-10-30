/* X FORCE 1.0 (Dupedia) — Lead Mine, pipeline, quotations, orders, commissions, targets (data layer; no DOM).

   Storage (see DPStore.RULES for who may read/write each path):
     leads/<leadId>                       lead record (administrators edit; everyone reads)
     claims/<uid>/c/<leadId>              "I own this lead" — written only by that employee (or an administrator)
     locks/<leadId>                       short lease that serialises claim attempts
     crm/<uid>/l/<leadId>                 the owner's private pipeline: stage, notes, activity, next action, contacts found
     submissions/<uid>/s/<projectId>      client decision on an issued quotation (X FORCE: "accepted" = order, no admin approval)
     handoff/<uid>/o/<orderId>            technical pack sent to engineering the moment the client accepts (no money)
     orders/<orderId>                     approved order with cost and profit (administrators only)
     commissions/<uid>/r/<orderId>        commission record (the employee reads their own; only administrators write)
     staff/<uid>                          monthly targets (the employee reads their own)
     config/commission                    commission rule versions and payable trigger (everyone reads)

   LEAD OWNERSHIP (the rule that matters): the owner of a lead is
     1. the person an administrator assigned (leads/<id>.assignedTo), otherwise
     2. the only employee holding a claim on it.
   No employee can write or delete another employee's claim or change a lead's assignment — the database refuses it. Claims go
   through a lease so two people pressing "Claim" at the same moment cannot both succeed. A second claim can only appear by
   bypassing the app; it never transfers ownership: the lead is marked "ownership conflict" and stays locked for everyone until
   an administrator decides. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, C = () => root.DPCommission;
  const now = () => new Date().toISOString();
  const me = () => (AU().A.me || {});
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const period = (iso) => String(iso || "").slice(0, 7);

  /* ---------------- vocabulary ---------------- */
  const ORG_TYPES = { developer: "Real-estate developer", hotel: "Hotel & resort", school: "School & education", mall: "Shopping mall", fec: "Family entertainment centre",
    park: "Amusement / water park operator", club: "Sporting club", government: "Government & municipality", contractor: "Contractor (landscape / main)", consultant: "Architect / landscape consultant",
    investor: "Investor / project developer", other: "Other" };
  const STAGES = [
    ["available", "Available"], ["research", "Under Research"], ["claimed", "Claimed"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["meeting", "Meeting Scheduled"],
    ["proposal_wip", "Proposal in Progress"], ["proposal_issued", "Proposal Issued"], ["negotiation", "Negotiation"], ["won", "Won"], ["lost", "Lost"], ["archived", "Archived"]];
  const STAGE_LABEL = Object.fromEntries(STAGES);
  const OWNER_STAGES = ["claimed", "contacted", "qualified", "meeting", "proposal_wip", "proposal_issued", "negotiation", "lost"]; // "won" is set by order approval
  const CONTACT_SUB = { none: "Not started", titles: "Decision-maker titles identified; contacts not collected", company: "Company switchboard / general e-mail only", phone: "Phone found, e-mail missing", email: "E-mail found, phone missing", unverified: "Contact found, not yet verified" };
  /** The label shown on every lead. "Available" only when both a phone number and an e-mail are present AND verified with a source. */
  function contactLabel(lead) {
    const c = lead.contact || {};
    const both = c.phone && c.email && c.verifiedAt && c.source;
    if (both) return { ok: true, label: "Contact Number & Email Available", sub: [c.name, c.title].filter(Boolean).join(" · ") || "Verified contact" };
    let sub = c.sub || "none";
    if (c.phone && !c.email) sub = "phone"; else if (c.email && !c.phone) sub = "email"; else if (c.phone && c.email && !c.verifiedAt) sub = "unverified";
    return { ok: false, label: "Under Research", sub: CONTACT_SUB[sub] || CONTACT_SUB.none, key: sub };
  }
  /** Priority from the qualification score (Strategic Account Database framework: Tier 1 ≥ 75, Tier 2 60–74, Tier 3 < 60). */
  function priority(lead, settings) {
    if (lead.priorityOverride) return lead.priorityOverride;
    const s = +lead.score; const t = (settings && settings.leadPriority) || { high: 75, medium: 60 };
    if (!isFinite(s)) return "Medium";
    return s >= t.high ? "High" : s >= t.medium ? "Medium" : "Low";
  }
  const QUAL = [["value", "Potential contract value", 25], ["evidence", "Evidence of active or upcoming projects", 20], ["fit", "Fit with Dupedia products", 20], ["access", "Access to decision-makers", 15], ["recurring", "Recurring business", 10], ["winProb", "Win probability", 10]];
  function scoreOf(q) { if (!q) return null; let t = 0, any = false; for (const [k, , max] of QUAL) { const v = +q[k]; if (isFinite(v)) { any = true; t += Math.max(0, Math.min(max, v)); } } return any ? t : null; }

  /* ---------------- loading ---------------- */
  async function uids(fresh) { const d = fresh || !AU().A.directory.length ? await AU().listDirectory() : AU().A.directory; const ids = new Set(d.filter((r) => r.uid).map((r) => r.uid)); if (me().id) ids.add(me().id); return [...ids]; }
  /** Leads as everyone sees them: the administrator record merged with the shared contact/research record (2.2). */
  async function listLeads() {
    const [l] = await Promise.all([DS().tryList("leads"), root.DPLeadOps ? root.DPLeadOps.loadContacts() : null]);
    return l.map((x) => { const lead = Object.assign({ id: x.id }, x.data); return root.DPLeadOps ? root.DPLeadOps.merged(lead) : lead; });
  }
  /** All claims of every user in the directory → {leadId: [{uid, claimedAt, ...}]} */
  async function claimsByLead(leadId) {
    if (root.DPLeadOps && Date.now() - root.DPLeadOps.LT.at > 8000) await root.DPLeadOps.loadActs();
    const out = {}, ids = await uids();
    const lists = await Promise.all(ids.map((u) => leadId ? DS().tryGet(`claims/${u}/c/${leadId}`).then((d) => (d ? [{ id: leadId, data: d }] : [])) : DS().tryList(`claims/${u}/c`)));
    ids.forEach((u, i) => { for (const x of lists[i]) (out[x.id] = out[x.id] || []).push(Object.assign({ uid: u }, x.data)); });
    for (const k of Object.keys(out)) out[k].sort((a, b) => String(a.claimedAt).localeCompare(String(b.claimedAt)));
    return out;
  }
  /** Ownership of one lead given its claims. */
  function ownership(lead, claims = []) {
    if (root.DPLeadOps) return root.DPLeadOps.ownership(lead, claims);   // 2.2: timer- and role-aware
    if (lead.assignedTo) return { owner: lead.assignedTo, via: "admin", at: lead.assignedAt, others: claims.filter((c) => c.uid !== lead.assignedTo), conflict: false };
    const valid = claims.filter((c) => c.uid);
    if (valid.length === 1) return { owner: valid[0].uid, via: "claim", at: valid[0].claimedAt, others: [], conflict: false };
    if (valid.length > 1) return { owner: null, via: null, conflict: true, claimants: valid, others: valid };
    return { owner: null, via: null, conflict: false, others: [] };
  }
  async function myCrm(leadId) { return DS().tryGet(`crm/${me().id}/l/${leadId}`); }
  async function listCrm(uid) { return (await DS().tryList(`crm/${uid}/l`)).map((x) => Object.assign({ leadId: x.id }, x.data)); }
  /** Pipeline stage shown for a lead (admins see every owner's stage; employees see their own and "Claimed" for others). */
  function stageOf(lead, own, crm) {
    if (lead.status === "archived") return "archived";
    if (lead.status === "merged") return "archived";
    if (own && own.owner) return (crm && crm.stage) || "claimed";
    if (own && own.conflict) return "claimed";
    if (lead.status === "research") return "research";
    return "available";
  }

  /* ---------------- employee actions ---------------- */
  /** Claim a lead. Serialised with a lease; verified after writing. Throws with a readable message when it cannot be claimed. */
  async function claim(leadId) {
    const uid = me().id; if (!uid) throw new Error("Sign in first.");
    if (me().role === "viewer") throw new Error("View-only access cannot claim leads.");
    const lead = await DS().tryGet(`leads/${leadId}`); if (!lead) throw new Error("This lead no longer exists.");
    if (["archived", "merged", "inactive"].includes(lead.status)) throw new Error("This lead is not open for claiming.");
    await uids(true);   // fresh directory, so claims by recently added colleagues are seen
    if (root.DPLeadOps && !root.DPLeadOps.isSalesUid(uid)) throw new Error("Only sales staff can claim leads.");
    const check = async () => { if (root.DPLeadOps) await root.DPLeadOps.loadActs(); const cl = (await claimsByLead(leadId))[leadId] || []; return ownership(Object.assign({ id: leadId }, lead), cl); };
    let own = await check();
    if (own.owner === uid) return { ok: true, already: true };
    if (own.owner) throw Object.assign(new Error(`Already claimed by ${(await AU().names([own.owner]))[own.owner]}.`), { code: "taken" });
    if (own.conflict) throw Object.assign(new Error("This lead is locked: an administrator is resolving an ownership conflict."), { code: "conflict" });
    const lease = await DS().acquire(`locks/${leadId}`, { holder: uid, ttlMs: 5000 });
    if (!lease || !lease.acquired) throw Object.assign(new Error("Someone is claiming this lead right now. Try again in a few seconds."), { code: "busy" });
    own = await check();       // re-read while holding the lease
    if (own.owner || own.conflict) throw Object.assign(new Error(own.owner === uid ? "Already yours." : "This lead was claimed a moment ago."), { code: "taken" });
    const at = now();
    await DS().set(`claims/${uid}/c/${leadId}`, { leadId, uid, claimedAt: at, lockVersion: lease.version || null, leadName: lead.name || "" });
    const prev = await myCrm(leadId);
    await DS().set(`crm/${uid}/l/${leadId}`, Object.assign({ leadId, uid, notes: [], activities: [], stageHistory: [] }, prev || {}, { stage: "claimed", claimedAt: at, updatedAt: at,
      stageHistory: ((prev && prev.stageHistory) || []).concat([{ stage: "claimed", at, note: "Claimed from Lead Mine" }]) }));
    AU().logActivity("Claimed lead", lead.name || leadId);
    const after = await check();
    if (after.conflict) return { ok: false, conflict: true };
    return { ok: after.owner === uid };
  }
  /** Give a lead back (owner only). Administrators release or reassign with their own action. */
  async function release(leadId, reason) {
    const uid = me().id, crm = await myCrm(leadId), at = now();
    await DS().del(`claims/${uid}/c/${leadId}`);
    if (crm) await DS().set(`crm/${uid}/l/${leadId}`, Object.assign({}, crm, { stage: "released", releasedAt: at, updatedAt: at, stageHistory: (crm.stageHistory || []).concat([{ stage: "released", at, note: reason || "" }]) }));
    AU().logActivity("Released lead", leadId);
  }
  async function updateCrm(leadId, patch, { stageNote = "" } = {}) {
    const uid = me().id, prev = (await myCrm(leadId)) || { leadId, uid, notes: [], activities: [], stageHistory: [] }, at = now();
    if (patch.stage && !OWNER_STAGES.includes(patch.stage)) throw new Error("That stage is set by the system.");
    const next = Object.assign({}, prev, patch, { updatedAt: at });
    if (patch.stage && patch.stage !== prev.stage) next.stageHistory = (prev.stageHistory || []).concat([{ stage: patch.stage, at, note: stageNote }]);
    await DS().set(`crm/${uid}/l/${leadId}`, next); return next;
  }
  async function addCrmEntry(leadId, kind, entry) {
    const uid = me().id, prev = (await myCrm(leadId)) || { leadId, uid, notes: [], activities: [], stageHistory: [], stage: "claimed" };
    const list = (prev[kind] || []).concat([Object.assign({ at: now() }, entry)]).slice(-200);
    await DS().set(`crm/${uid}/l/${leadId}`, Object.assign({}, prev, { [kind]: list, updatedAt: now() }));
  }
  /** Owner-only crm stage sync from the project workflow (proposal issued etc.); never moves backwards. */
  async function syncStage(leadId, stage, note) {
    if (!leadId || !me().id) return; const crm = await myCrm(leadId); if (!crm) return;
    const order = STAGES.map((s) => s[0]); if (order.indexOf(stage) <= order.indexOf(crm.stage)) return;
    await updateCrm(leadId, { stage }, { stageNote: note || "" }).catch(() => {});
  }

  /* ---------------- 1.2: manual lead creation, lead origin and attachments ---------------- */
  const ORIGIN_KINDS = { admin: "Added by an administrator", sales: "Added by sales (stays with its creator)", dataentry: "Added by data entry", research: "Lead research", import: "Imported list", proposal: "Data-entry proposal" };
  /** Administrators, sales and data entry add a lead by hand. A salesperson's own lead is claimed by them at once and is
   *  never released by the 24-hour rule; only an administrator can reassign it (with a reason). Data-entry leads start
   *  Under Research, unowned. The server checks creator and origin. */
  async function createLead(patch) {
    const u = me(); if (!u || !u.id) throw new Error("Sign in first.");
    const kind = u.role === "admin" ? "admin" : u.role === "employee" ? "sales" : u.role === "dataentry" ? "dataentry" : null; if (!kind) throw new Error("Your role cannot add leads.");
    const nm = String(patch.name || "").trim(); if (!nm) throw new Error("Enter the organisation name.");
    const dup = (await listLeads()).find((l) => String(l.name || "").trim().toLowerCase() === nm.toLowerCase() && !["merged", "archived"].includes(l.status));
    if (dup) throw Object.assign(new Error(`A lead called "${dup.name}" already exists. Open it instead of adding a duplicate.`), { code: "duplicate", leadId: dup.id });
    const id = rid("L-"), at = now();
    const doc = Object.assign({ country: "Egypt", orgType: "developer", contact: { name: "", title: "", phone: "", email: "", source: "", sub: "none" }, qualification: {}, sources: [] }, patch, { name: nm,
      status: kind === "dataentry" ? "research" : "available", origin: ORIGIN_KINDS[kind], originKind: kind, createdBy: u.id, createdAt: at, updatedAt: at, updatedBy: u.id, history: [{ at, by: u.id, action: "Created", reason: "Added manually", detail: ORIGIN_KINDS[kind] }] });
    if (kind === "admin") await saveLead(Object.assign({ id }, doc), "Created", "Added manually", "");
    else { const r = await DS().create(`leads/${id}`, doc); if (!r.created) throw new Error("The lead could not be created. Try again."); }
    if (kind === "sales") await DS().set(`claims/${u.id}/c/${id}`, { leadId: id, uid: u.id, claimedAt: at, leadName: nm, via: "created" });
    await AU().auditLog("Lead created", { kind: "lead", target: id, detail: `${nm} · ${ORIGIN_KINDS[kind]}` }).catch(() => {});
    return id;
  }
  const LEADX_TYPES = /\.(jpe?g|png|webp|gif|pdf|dwg|dxf|skp|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip)$/i, LEADX_MAX = 8 * 1024 * 1024;
  const leadFiles = async (leadId) => (await DS().tryList(`leadx/${leadId}/files`)).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  /** Pictures, drawings, CAD files and specifications on a lead (any staff who can see the lead can open them). */
  async function attachLeadFile(leadId, file, { label = "", kind = "other" } = {}) {
    const u = me(); if (!u || u.role === "viewer") throw new Error("View-only access cannot attach files.");
    if (!file || !LEADX_TYPES.test(file.name)) throw new Error("Use a picture, PDF, DWG/DXF/SKP drawing, Office document, CSV, text or ZIP file.");
    if (file.size > LEADX_MAX) throw new Error("The file is larger than 8 MB.");
    const f = /^image\/(jpeg|png|webp)$/.test(file.type) || file.type === "application/pdf" ? await root.DPOrders.prepareFile(file)
      : { name: file.name, type: file.type || "application/octet-stream", size: file.size, dataUrl: await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); }) };
    const fid = rid("lf-"), base = `leadx/${leadId}/files/${fid}`;
    await root.DPOrders.putFile(base, f);
    await DS().set(base, { name: f.name, type: f.type, size: f.size, label: String(label).slice(0, 120), kind, by: u.id, at: now() });
    await AU().auditLog("Lead file attached", { kind: "lead", target: leadId, detail: f.name }).catch(() => {});
    return fid;
  }
  const leadFile = (leadId, fid) => root.DPOrders.getFile(`leadx/${leadId}/files/${fid}`);
  async function removeLeadFile(leadId, fid, reason = "") { const base = `leadx/${leadId}/files/${fid}`, meta = await DS().tryGet(base); if (!meta) return;
    if (meta.by !== me().id && !AU().isAdmin()) throw new Error("Only the person who attached the file or an administrator can remove it.");
    await DS().del(base); for (const c of await DS().tryList(`${base}/c`)) await DS().del(`${base}/c/${c.id}`).catch(() => {});
    await AU().auditLog("Lead file removed", { kind: "lead", target: leadId, reason, detail: meta.name }).catch(() => {}); }

  /* ---------------- administrator actions on leads ---------------- */
  const reqAdmin = () => { if (!AU().isAdmin()) throw new Error("Administrators only."); };
  function hist(lead, action, reason, detail) { return (lead.history || []).concat([{ at: now(), by: me().id, action, reason: reason || "", detail: detail || "" }]).slice(-120); }
  async function saveLead(lead, action, reason, detail) {
    reqAdmin(); const id = lead.id || rid("L-"); const doc = Object.assign({}, lead); delete doc.id;
    doc.updatedAt = now(); doc.updatedBy = me().id; if (!doc.createdAt) { doc.createdAt = now(); doc.createdBy = me().id; }
    doc.history = hist(doc, action, reason, detail);
    await DS().set(`leads/${id}`, doc); await AU().adminLog("Lead: " + action, { target: id, reason, detail: (doc.name || "") + (detail ? " · " + detail : "") }); return id;
  }
  async function reassign(leadId, toUid, reason, { timer = true } = {}) {
    reqAdmin(); if (!reason) throw new Error("A reason is required.");
    const lead = await DS().get(`leads/${leadId}`); const cl = (await claimsByLead(leadId))[leadId] || [], own = ownership(lead, cl), at = now();
    const fromUid = own.owner || (own.claimants && own.claimants[0] && own.claimants[0].uid) || null;
    // carry the pipeline history to the new owner, then close it for the old owner
    const old = fromUid ? await DS().tryGet(`crm/${fromUid}/l/${leadId}`) : null;
    for (const c of cl) if (c.uid !== toUid) await DS().del(`claims/${c.uid}/c/${leadId}`);
    await DS().set(`claims/${toUid}/c/${leadId}`, { leadId, uid: toUid, claimedAt: at, via: "admin", by: me().id, leadName: lead.name || "" });
    const prevNew = await DS().tryGet(`crm/${toUid}/l/${leadId}`);
    await DS().set(`crm/${toUid}/l/${leadId}`, Object.assign({ leadId, uid: toUid, notes: [], activities: [], stageHistory: [] }, prevNew || {}, {
      stage: (old && old.stage && !["released", "reassigned"].includes(old.stage)) ? old.stage : "claimed", updatedAt: at,
      notes: ((prevNew && prevNew.notes) || []).concat(old ? (old.notes || []).map((n) => Object.assign({}, n, { handover: true })) : []).concat([{ at, text: `Assigned by an administrator: ${reason}`, system: true }]),
      activities: ((prevNew && prevNew.activities) || []).concat(old ? (old.activities || []).map((a) => Object.assign({}, a, { handover: true })) : []),
      contactFound: (prevNew && prevNew.contactFound) || (old && old.contactFound) || null,
      stageHistory: ((prevNew && prevNew.stageHistory) || []).concat([{ stage: "claimed", at, note: "Assigned by administrator" }]) }));
    if (old && fromUid !== toUid) await DS().set(`crm/${fromUid}/l/${leadId}`, Object.assign({}, old, { stage: "reassigned", updatedAt: at, stageHistory: (old.stageHistory || []).concat([{ stage: "reassigned", at, note: reason }]) }));
    const names = await AU().names([toUid].concat(fromUid ? [fromUid] : []));
    const ext = Object.assign({}, lead.extensions || {}); delete ext[toUid];
    await saveLead(Object.assign({ id: leadId }, lead, { assignedTo: toUid, assignedAt: at, assignedBy: me().id, assignReason: reason, assignTimer: !!timer, extensions: ext, status: lead.status === "research" ? "research" : (lead.status || "available") }), own.conflict ? "Ownership conflict resolved" : "Reassigned", reason, `${fromUid ? names[fromUid] : "unowned"} → ${names[toUid]}${timer ? "" : " · 24-hour rule off"}`);
    if (root.DPNotify) { await root.DPNotify.deliver(toUid, { id: `assign-${leadId}-${Date.parse(at)}`, type: "lead", title: "Lead assigned to you", body: `${lead.name}: ${reason}`, link: { view: "myleads" }, ref: leadId }).catch(() => {});
      if (fromUid && fromUid !== toUid) await root.DPNotify.deliver(fromUid, { id: `unassign-${leadId}-${Date.parse(at)}`, type: "lead", title: "Lead reassigned", body: `${lead.name} was reassigned by an administrator: ${reason}`, link: { view: "leads" }, ref: leadId }).catch(() => {}); }
  }
  async function adminRelease(leadId, reason) {
    reqAdmin(); if (!reason) throw new Error("A reason is required.");
    const lead = await DS().get(`leads/${leadId}`), cl = (await claimsByLead(leadId))[leadId] || [], at = now();
    for (const c of cl) { await DS().del(`claims/${c.uid}/c/${leadId}`); const crm = await DS().tryGet(`crm/${c.uid}/l/${leadId}`); if (crm) await DS().set(`crm/${c.uid}/l/${leadId}`, Object.assign({}, crm, { stage: "released", updatedAt: at, stageHistory: (crm.stageHistory || []).concat([{ stage: "released", at, note: "Released by administrator: " + reason }]) })); }
    await saveLead(Object.assign({ id: leadId }, lead, { assignedTo: null, assignedAt: null, assignedBy: null, assignReason: null }), "Released", reason, cl.map((c) => AU().nameSync(c.uid) || c.uid).join(", "));
  }
  async function setLeadStatus(leadId, status, reason) {
    reqAdmin(); if (!reason) throw new Error("A reason is required.");
    const lead = await DS().get(`leads/${leadId}`);
    await saveLead(Object.assign({ id: leadId }, lead, { status }), "Status changed", reason, `${lead.status || "available"} → ${status}`);
  }
  async function correct(leadId, patch, reason) {
    reqAdmin(); if (!reason) throw new Error("A reason is required.");
    const lead = await DS().get(`leads/${leadId}`), changed = Object.keys(patch).filter((k) => JSON.stringify(lead[k]) !== JSON.stringify(patch[k]));
    if (!changed.length) return;
    if (patch.qualification) patch.score = scoreOf(patch.qualification);
    await saveLead(Object.assign({ id: leadId }, lead, patch), "Corrected", reason, changed.join(", "));
  }
  /** Merge `fromId` into `intoId`: sources and notes are combined, the duplicate is closed. Ownership is kept if only one side had it. */
  async function merge(fromId, intoId, reason) {
    reqAdmin(); if (!reason) throw new Error("A reason is required."); if (fromId === intoId) throw new Error("Choose two different leads.");
    const a = await DS().get(`leads/${fromId}`), b = await DS().get(`leads/${intoId}`), cl = await claimsByLead();
    const oa = ownership(a, cl[fromId] || []), ob = ownership(b, cl[intoId] || []);
    if (oa.owner && ob.owner && oa.owner !== ob.owner) throw new Error("Both leads have different owners. Reassign one of them first.");
    const sources = [...(b.sources || [])]; for (const s of a.sources || []) if (!sources.some((x) => x.url === s.url)) sources.push(s);
    await saveLead(Object.assign({ id: intoId }, b, { sources, notes: [b.notes, a.notes].filter(Boolean).join("\n"), mergedFrom: (b.mergedFrom || []).concat([fromId]) }), "Merged in", reason, a.name || fromId);
    await saveLead(Object.assign({ id: fromId }, a, { status: "merged", mergedInto: intoId }), "Merged into another lead", reason, b.name || intoId);
    if (oa.owner && !ob.owner) await reassign(intoId, oa.owner, "Kept the owner of the merged duplicate");
    for (const c of cl[fromId] || []) await DS().del(`claims/${c.uid}/c/${fromId}`);
  }
  /** Import leads (seed database or CSV). Skips ids that already exist. Never adds contact details that are not in the input. */
  async function importLeads(list, { origin = "Import" } = {}) {
    reqAdmin(); const existing = new Set((await listLeads()).map((l) => l.id)); let added = 0, skipped = 0;
    for (const raw of list) {
      const id = raw.id || rid("L-"); if (existing.has(id)) { skipped++; continue; }
      const lead = Object.assign({ status: "research", country: "Egypt", contact: { phone: "", email: "", name: "", title: "", sub: "none" } }, raw, { id });
      if (!lead.score && lead.qualification) lead.score = scoreOf(lead.qualification);
      lead.origin = lead.origin || origin; await saveLead(lead, "Imported", origin, ""); added++;
    }
    return { added, skipped };
  }

  /* ---------------- commission rule ---------------- */
  async function commissionConfig() {
    const c = await DS().tryGet("config/commission");
    const base = { current: C().DEFAULT_RULE.id, versions: [C().DEFAULT_RULE], trigger: "approval" };
    return c && Array.isArray(c.versions) && c.versions.length ? Object.assign(base, c) : base;
  }
  function ruleById(cfg, id) { return cfg.versions.find((v) => v.id === id) || null; }
  const currentRule = (cfg) => ruleById(cfg, cfg.current) || cfg.versions[cfg.versions.length - 1];
  async function saveCommissionConfig(cfg, reason) {
    reqAdmin(); const r = currentRule(cfg), errs = C().validateRule(r); if (errs.length) throw new Error(errs.join(" "));
    await DS().set("config/commission", Object.assign({}, cfg, { updatedAt: now(), updatedBy: me().id }));
    if (root.DPPrice) await root.DPPrice.syncCopies();
    await AU().adminLog("Commission rule updated", { reason, detail: `${r.id} · ${r.method} · trigger ${cfg.trigger}` });
  }
  const estimate = (eligibleMinor, cfg) => C().calculate(eligibleMinor, currentRule(cfg));

  /* ---------------- submissions → orders → commissions ---------------- */
  /** Employee: the client accepted an issued proposal → request order approval. */
  async function submit(project, pricing, settings, note) {
    const uid = me().id; if (project.meta.status !== "issued") throw new Error("Issue the proposal first.");
    if (!pricing || pricing.blocking) throw new Error("The quotation has unresolved issues.");
    const base = C().base(pricing, settings);
    const doc = { pid: project.meta.id, ownerId: project.meta.ownerId || uid, ref: project.meta.ref, name: project.meta.name, client: project.meta.client || "", location: project.meta.location || "",
      type: project.meta.type || "", leadId: project.meta.leadId || null, rev: project.meta.rev || 0, issuedAt: project.meta.issuedAt || null, base, note: String(note || "").slice(0, 600), at: now(), status: "submitted", by: uid };
    await DS().set(`submissions/${uid}/s/${project.meta.id}`, doc);
    return doc;
  }
  async function mySubmissions() { return (await DS().tryList(`submissions/${me().id}/s`)).map((x) => Object.assign({ id: x.id }, x.data)); }
  async function allSubmissions() { const ids = await uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`submissions/${u}/s`))); return l.flat().map((x) => Object.assign({ id: x.id }, x.data)); }
  async function withdraw(pid) { const s = await DS().tryGet(`submissions/${me().id}/s/${pid}`); if (s && s.status === "submitted") await DS().set(`submissions/${me().id}/s/${pid}`, Object.assign({}, s, { status: "withdrawn", withdrawnAt: now() })); }
  /** Set a project's status in its owner's subtree (administrators). */
  async function setProjectStatus(ownerId, pid, status, extra = {}) {
    const path = `projects/${ownerId}/p/${pid}`, d = await DS().get(path); if (!d) return;
    d.project.meta.status = status; Object.assign(d.project.meta, extra); d.rev = (d.rev || 0) + 1; d.savedAt = now(); d.savedBy = me().name || ""; d.savedById = me().id;
    if (d.summary) d.summary.status = status;
    d.project.audit = (d.project.audit || []).concat([{ at: now(), by: me().name || "", action: "Status set to " + status, detail: extra.statusNote || "" }]).slice(-150);
    await DS().set(path, d);
  }
  /** Administrator: approve a submission. `approved` = {eligibleMinor, reason (required if it differs), date}.
   *  pricing/costs are the administrator's own recomputation from the saved project (never the employee's numbers). */
  async function approve(sub, { pricing, settings, costMargin, approved = {}, projectType = "", orgType = "", project = null, deadline = null, priority = "normal", contact = "", auto = false }) {
    reqAdmin();
    if (sub.oid && (await DS().tryGet(`orders/${sub.oid}`))) throw new Error("This order is already booked.");
    const cfg = await commissionConfig(), rule = currentRule(cfg), base = C().base(pricing, settings);
    const eligibleMinor = approved.eligibleMinor != null ? Math.round(approved.eligibleMinor) : base.eligibleMinor;
    if (eligibleMinor !== base.eligibleMinor && !approved.reason) throw new Error("Explain why the approved value differs from the quotation.");
    const at = sub.acceptedAt || (approved.date ? new Date(approved.date + "T12:00:00").toISOString() : now());
    const oid = sub.oid || orderIdFor(sub);
    const calc = C().calculate(eligibleMinor, rule);
    const order = { oid, pid: sub.pid, ownerId: sub.ownerId, ref: sub.ref, name: sub.name, client: sub.client, location: sub.location, type: projectType || sub.type, orgType, leadId: sub.leadId,
      currency: base.currency, subtotalMinor: base.subtotalMinor, discountMinor: base.discountMinor, afterDiscountMinor: base.afterDiscountMinor, taxMinor: base.taxMinor, totalMinor: base.totalMinor,
      passThroughMinor: base.passThroughMinor, quotedEligibleMinor: base.eligibleMinor, eligibleMinor, valueReason: approved.reason || "",
      // 1.2: the sold lines (selling prices only — never cost), so invoices are prefilled from the order itself
      lines: ((pricing && pricing.lines) || []).filter((l) => l.counted !== false && l.totalMinor).slice(0, 300).map((l) => ({ code: l.code || "", name: String(l.name || "").slice(0, 160), unit: l.unit || "", qty: l.qty, unitMinor: l.unitMinor, totalMinor: l.totalMinor })),
      costMinor: costMargin ? costMargin.costMinor : null, costMissing: costMargin ? costMargin.missing : null, sellingExpenses: [], payments: [],
      approvedAt: at, acceptedAt: sub.acceptedAt || at, bookedAt: now(), bookedBy: me().id, booking: auto ? "automatic" : "manual", period: period(at), approvedBy: me().id, status: "approved", rev: sub.rev,
      quotedTotalMinor: sub.base ? sub.base.totalMinor : null, valueCheck: sub.base && (sub.base.totalMinor !== base.totalMinor || sub.base.eligibleMinor !== base.eligibleMinor) ? { quotedTotalMinor: sub.base.totalMinor, quotedEligibleMinor: sub.base.eligibleMinor, bookedTotalMinor: base.totalMinor, bookedEligibleMinor: base.eligibleMinor } : null,
      schedule: root.DPPay.normalise((sub.schedule || []).map((x) => Object.assign({}, x)), { acceptDate: (sub.acceptedAt || at).slice(0, 10), settings }), scheduleOriginal: (sub.schedule || []).map((x) => Object.assign({}, x)), valueAdjustments: [], acceptNote: sub.note || "", acceptEvidence: sub.evidence || null,
      history: [{ at: now(), by: me().id, action: auto ? "Client acceptance recorded by sales — order booked automatically" : "Order approved", detail: approved.reason || (sub.note || "") }] };
    await DS().set(`orders/${oid}`, order);
    // 2.2: the commission record keeps the calculated amount; the approved amount is set only by an administrator's approval
    const rec = { oid, pid: sub.pid, ref: sub.ref, name: sub.name, client: sub.client, period: order.period, approvedAt: at, currency: base.currency, eligibleMinor,
      ruleId: rule.id, rule: { method: rule.method, bands: rule.bands, label: rule.label }, method: rule.method, basis: rule.method, rateBp: calc.rateBp, breakdown: calc.breakdown, effectiveBp: calc.effectiveBp, amountMinor: calc.amountMinor, calculatedMinor: calc.amountMinor,
      approvedMinor: null, approvals: [], payouts: [], milestone: eligibilityCfg(settings).milestone, eligibleAt: null,
      status: "calculated", statusHistory: [{ status: "calculated", at: now(), by: me().id, note: "Order booked; commission calculated automatically" }], adjustments: [] };
    await DS().set(`commissions/${sub.ownerId}/r/${oid}`, rec);
    const subDoc = Object.assign({}, sub); delete subDoc.id;
    await DS().set(`submissions/${sub.ownerId}/s/${sub.pid}`, Object.assign(subDoc, auto ? { booked: true, bookedAt: now(), orderId: oid } : { status: "approved", orderId: oid, decidedAt: now(), decidedBy: me().id })).catch(() => {});
    if (!auto) await setProjectStatus(sub.ownerId, sub.pid, "won", { orderId: oid, wonAt: at });
    if (sub.leadId) { const crm = await DS().tryGet(`crm/${sub.ownerId}/l/${sub.leadId}`); if (crm) await DS().set(`crm/${sub.ownerId}/l/${sub.leadId}`, Object.assign({}, crm, { stage: "won", wonOrderId: oid, updatedAt: now(), stageHistory: (crm.stageHistory || []).concat([{ stage: "won", at: now(), note: "Order approved " + oid }]) })); }
    await AU().adminLog(auto ? "Order booked (client acceptance)" : "Approved order", { target: oid, reason: approved.reason || "", detail: `${sub.ref} · eligible ${eligibleMinor / 100}${order.valueCheck ? " · VALUE DIFFERS FROM QUOTATION" : ""}` });
    if (project && root.DPOrders) await root.DPOrders.onOrderApproved(order, project, { deadline: deadline || sub.deadline || null, priority: sub.priority || priority, contact: contact || sub.contact || "" });
    if (order.valueCheck && root.DPNotify) await root.DPNotify.deliver("@admins", { id: `valuecheck-${oid}`, type: "order", title: "Booked value differs from the quotation", body: `${sub.name}: the current price book gives a different value from the quotation the client accepted. Check the order.`, link: { view: "register", opts: { oid } }, ref: oid }).catch(() => {});
    if (root.DPNotify && !auto) {
      // one celebration per approval event: the deterministic id "deal-<orderId>" can only be created once
      await root.DPNotify.deliver(sub.ownerId, { id: `deal-${oid}`, type: "deal", title: "You closed a deal!", body: `${sub.name}${sub.client ? " — " + sub.client : ""} is now an approved order.`, celebrate: true,
        data: { project: sub.name, client: sub.client || "", value: root.DPPricing.fmtMoney(base.totalMinor, base.currency, { dp: 0 }) + " incl. " + (settings.taxLabel || "VAT") }, link: { view: "tracking" }, ref: oid }).catch(() => {});
      await root.DPNotify.deliver("@admins", { id: `order-${oid}`, type: "order", title: "Quotation approved as an order", body: `${sub.name} (${AU().nameSync(sub.ownerId)}).`, link: { view: "approvals" }, ref: oid }).catch(() => {});
    }
    await checkEligibility(oid);
    return { order, rec: await DS().get(`commissions/${sub.ownerId}/r/${oid}`) };
  }
  /** Deterministic order reference for a project: the same quotation can never become two orders. */
  function orderIdFor(sub) { let h = 0; for (const ch of String(sub.pid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return "O-" + String(sub.ref || sub.pid).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) + "-" + h.toString(36).slice(-4).toUpperCase(); }
  /** SALES: the client accepted an issued quotation. The order is accepted immediately — no administrator approval — and goes
   *  straight to Engineering (technical pack without money) and to the administrators. Payment verification and commission
   *  approval stay separate administrator processes. Idempotent: a second call for the same quotation is refused. */
  async function accept(project, pricing, settings, { date, note = "", evidence = null, deadline = null, priority = "normal", contact = "", schedule = [] } = {}) {
    const uid = me().id; if (!uid) throw new Error("Sign in first.");
    if (!["employee", "admin"].includes(me().role)) throw new Error("Only sales staff record client acceptance.");
    const m = project.meta; if (m.status !== "issued") throw new Error(["accepted", "won"].includes(m.status) ? "The client's acceptance is already recorded." : "Issue the quotation first.");
    if ((m.ownerId || uid) !== uid && !AU().isAdmin()) throw new Error("Only the quotation's owner records the client's decision.");
    if (!pricing || pricing.blocking) throw new Error("The quotation has unresolved issues.");
    if (!date) throw new Error("Enter the acceptance date.");
    const owner = m.ownerId || uid, prev = await DS().tryGet(`submissions/${owner}/s/${m.id}`);
    if (prev && ["accepted", "approved"].includes(prev.status)) throw new Error("The client's acceptance is already recorded for this quotation.");
    const lease = await DS().acquire(`locks/accept-${m.id}`, { holder: uid, ttlMs: 8000 }); if (!lease || !lease.acquired) throw new Error("This acceptance is being recorded right now.");
    const base = C().base(pricing, settings), at = new Date(date + "T12:00:00").toISOString();
    const sub = { pid: m.id, ownerId: owner, ref: m.ref, name: m.name, client: m.client || "", location: m.location || "", type: m.type || "", leadId: m.leadId || null, rev: m.rev || 0, issuedAt: m.issuedAt || null, base,
      note: String(note || "").slice(0, 600), at: now(), status: "accepted", acceptedAt: at, acceptedBy: uid, by: uid, deadline: deadline || null, priority, contact: String(contact || "").slice(0, 200),
      // 1.1: every accepted order carries an initial deposit obligation (default 50 %, due on the acceptance date) — an
      // obligation, never a payment. Further milestones are optional; the rest is the outstanding balance.
      schedule: root.DPPay.normalise((schedule || []).filter((x) => x && (x.kind === "deposit" || (x.due && (x.amountMinor > 0 || x.pct > 0)))).map((x) => ({ id: x.id, kind: x.kind, label: String(x.label || "Payment").slice(0, 80), due: x.due || date, pct: x.pct != null && x.pct !== "" ? +x.pct : null, amountMinor: x.pct != null && x.pct !== "" ? null : x.amountMinor || null })), { acceptDate: date, settings }) };
    const totalPct = sub.schedule.reduce((a, x) => a + (x.pct || 0), 0); if (totalPct > 100) throw new Error("The payment schedule adds up to more than 100%.");
    // 1.1: automatic engineering assignment to the default engineer (Admin › Settings), when one is configured and active
    const defEng = (settings && settings.engineering && settings.engineering.defaultEngineer) || null, defRow = defEng ? AU().A.directory.find((r) => r.uid === defEng && r.active !== false && AU().baseOf(r.role) === "engineer") : null;
    sub.defaultEngineer = defRow ? defEng : null;
    sub.oid = orderIdFor(sub);
    // 1.3: automatic, workload-balanced engineer assignment (Factory › Settings). The default engineer above is the fallback
    // only when automatic assignment is switched off.
    let autoAsg = null;
    if (root.DPFac) { try { const fc = await root.DPFac.cfg(true); if (fc.autoAssign === "balanced") {
      const lease = await DS().acquire("locks/fac-assign", { holder: uid, ttlMs: 8000 }).catch(() => null);
      autoAsg = await root.DPFac.pick({ products: [], skills: [] }); sub.defaultEngineer = autoAsg.uid; sub.assignVia = "auto"; void lease; } } catch (e) { console.warn("auto-assign", e); } }
    if (evidence) { await root.DPOrders.putFile(`submissions/${owner}/s/${m.id}/ev/main`, evidence); sub.evidence = { name: evidence.name, type: evidence.type, size: evidence.size }; }
    await DS().set(`submissions/${owner}/s/${m.id}`, sub);
    // engineering receives the order now: technical pack only (DPOrders.handoverFrom strips every price, total and discount)
    const ho = root.DPOrders.handoverFrom(project, { oid: sub.oid, ref: sub.ref, name: sub.name, client: sub.client, location: sub.location, type: sub.type });
    Object.assign(ho, { pid: m.id, salesUid: owner, acceptedAt: at, deadlineOriginal: deadline || null, priority, contact: sub.contact, status: "accepted", defaultEngineer: sub.defaultEngineer,
      history: [{ at: now(), by: uid, action: "Client acceptance recorded" }].concat(sub.defaultEngineer ? [{ at: now(), by: uid, action: sub.assignVia === "auto" ? "Assigned automatically (balanced workload)" : "Assigned automatically to the default engineer", detail: AU().nameSync(sub.defaultEngineer) + (autoAsg ? " — " + autoAsg.reason : "") }] : [{ at: now(), by: uid, action: "No default engineer configured — waiting in the Unassigned Engineering Orders queue" }]) });
    if (JSON.stringify(ho).length > 240000) { ho.project = null; ho.planOmitted = true; }
    await DS().set(`handoff/${owner}/o/${sub.oid}`, ho);
    if (root.DPFac) { try { await root.DPFac.ensureJob({ oid: sub.oid, ref: sub.ref, name: sub.name, client: sub.client, location: sub.location, salesUid: owner, engineerUid: sub.defaultEngineer || null, deadlineOriginal: deadline || null }, ho);
      if (autoAsg) await root.DPFac.logAssignment(sub.oid, autoAsg.uid, { via: "auto", reason: autoAsg.reason, ranking: autoAsg.ranking }); } catch (e) { console.warn("factory job", e); } }
    if (m.leadId) { const crm = await DS().tryGet(`crm/${owner}/l/${m.leadId}`); if (crm) await DS().set(`crm/${owner}/l/${m.leadId}`, Object.assign({}, crm, { stage: "won", wonOrderId: sub.oid, updatedAt: now(), stageHistory: (crm.stageHistory || []).concat([{ stage: "won", at: now(), note: "Client accepted " + sub.oid }]) })).catch(() => {}); }
    AU().logActivity("Recorded client acceptance", `${sub.ref} → ${sub.oid}`).catch(() => {});
    if (root.DPNotify) {
      const N = root.DPNotify, engs = AU().A.directory.filter((r) => r.uid && r.active !== false && AU().baseOf(r.role) === "engineer").map((r) => r.uid);
      await N.deliver("@admins", { id: `accept-${sub.oid}`, type: "order", title: "Client accepted — new order", body: `${sub.name}${sub.client ? " — " + sub.client : ""} (${me().name || "sales"}). Sent to Engineering.`, link: { view: "register", opts: { oid: sub.oid } }, ref: sub.oid }).catch(() => {});
      if (sub.defaultEngineer) await N.deliver(sub.defaultEngineer, { id: `eng-asg-${sub.oid}-${sub.defaultEngineer}`, type: "engineering", title: "New order assigned to you", body: `${sub.name}${sub.location ? " · " + sub.location : ""} — assigned automatically${sub.assignVia === "auto" ? " (balanced workload)" : " as default engineer"}. Open it to accept the job.`, mandatory: true, link: { view: "engorders", opts: { oid: sub.oid } }, ref: sub.oid, priority: "high" }).catch(() => {});
      const others = engs.filter((u) => u !== sub.defaultEngineer);
      if (others.length) await N.deliver(others, { id: `eng-new-${sub.oid}`, type: "engineering", title: sub.defaultEngineer ? "New order accepted" : "New unassigned order", body: `${sub.name}${sub.location ? " · " + sub.location : ""}${sub.defaultEngineer ? " — assigned to " + AU().nameSync(sub.defaultEngineer) : " — in the Unassigned Engineering Orders queue"}`, link: { view: "engorders", opts: { oid: sub.oid } }, ref: sub.oid }).catch(() => {});
      if (!sub.defaultEngineer) await N.deliver("@admins", { id: `eng-nodef-${sub.oid}`, type: "engineering", title: "Order needs an engineer", body: `${sub.name}: ${autoAsg ? "no engineer is eligible for automatic assignment (all unavailable or over capacity)" : "no default engineer is configured (Admin › Settings › Engineering)"}. Assign one from the queue.`, link: { view: "engqueue" }, ref: sub.oid, priority: "high" }).catch(() => {});
      await N.toSelf({ id: `deal-${sub.oid}`, type: "deal", title: "You closed a deal!", body: `${sub.name}${sub.client ? " — " + sub.client : ""} is now an accepted order.`, celebrate: true, data: { project: sub.name, client: sub.client || "" }, link: { view: "proposals", opts: { oid: sub.oid } }, ref: sub.oid }).catch(() => {});
    }
    if (root.DPChat) root.DPChat.system(`accept-${sub.oid}`, "Deal closed: a client has accepted a quotation. The order is on its way to Engineering.", { view: "proposals", opts: { oid: sub.oid } }).catch(() => {});
    return sub;
  }
  /** SALES: the client declined (or the quotation lapsed). Recorded with the reason; the quotation can be reopened. */
  async function clientRejected(project, reason) {
    const m = project.meta; if (!reason) throw new Error("Give the reason."); if (!["issued"].includes(m.status)) throw new Error("Only an issued quotation awaiting the client's decision can be marked as rejected.");
    const owner = m.ownerId || me().id;
    await DS().set(`submissions/${owner}/s/${m.id}`, { pid: m.id, ownerId: owner, ref: m.ref, name: m.name, client: m.client || "", status: "rejected", reason: String(reason).slice(0, 600), at: now(), by: me().id, rev: m.rev || 0 });
    if (m.leadId) await updateCrm(m.leadId, { stage: "lost", lostReason: reason }, { stageNote: reason }).catch(() => {});
  }
  async function returnSubmission(sub, reason) {
    reqAdmin(); if (!reason) throw new Error("A reason is required.");
    await DS().set(`submissions/${sub.ownerId}/s/${sub.pid}`, Object.assign({}, sub, { status: "returned", returnReason: reason, decidedAt: now(), decidedBy: me().id }));
    await AU().adminLog("Returned submission", { target: sub.pid, reason });
  }
  async function listOrders() { return (await DS().tryList("orders")).map((x) => Object.assign({ oid: x.id }, x.data)); }
  async function myCommissions() { return (await DS().tryList(`commissions/${me().id}/r`)).map((x) => Object.assign({ oid: x.id }, x.data)); }
  async function allCommissions() { const ids = await uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`commissions/${u}/r`).then((r) => r.map((x) => Object.assign({ oid: x.id, uid: u }, x.data))))); return l.flat(); }
  const reqCommFin = () => { if (!(AU().isAdmin() || (AU().isFinance && AU().isFinance()))) throw new Error("Administrators or Finance only."); };
  async function updateCommission(uid, oid, fn, action, detail) {
    reqCommFin(); const path = `commissions/${uid}/r/${oid}`, rec = await DS().get(path); if (!rec) throw new Error("Commission record not found.");
    const next = fn(JSON.parse(JSON.stringify(rec))); await DS().set(path, next); await AU().adminLog(action, { target: oid, detail }); return next;
  }
  const setStatus = (rec, status, note) => { rec.status = status; rec.statusHistory = (rec.statusHistory || []).concat([{ status, at: now(), by: me().id, note: note || "" }]); return rec; };
  /* ---------- 2.2 commission approval and payout ----------
     calculatedMinor  automatic calculation (rule version stored on the record) — never changes
     approvals[]      every administrator approval: calculated, previously approved, approved, difference, reason, who, when
     approvedMinor    the exact amount an administrator approved — shown to the employee as their approved commission
     adjustments[]    documented changes after approval (positive or negative), never silent edits
     payouts[]        when and how much was actually paid out; status "paid" once payouts cover approved + adjustments
     eligibleAt       set when the configured milestone is reached: it flags the record for review, it never approves it
                      (unless an administrator turned on automatic approval). Approval is possible at any time. */
  const MILESTONES = { order: "Order approved", payment_verified: "First client payment verified", full_payment: "Client paid in full (verified)", ready: "Engineering: ready for installation", completed: "Engineering: completed / handed over" };
  function eligibilityCfg(settings) { const s = (settings || (root.DPUI && root.DPUI.App.config.settings) || {}).commission || {}; return { milestone: s.milestone || "order", autoApprove: !!s.autoApprove }; }
  const owedMinor = (r) => (r.approvedMinor != null ? r.approvedMinor : 0) + (r.adjustments || []).reduce((a, x) => a + (x.amountMinor || 0), 0);
  const paidMinor = (r) => (r.payouts || []).reduce((a, x) => a + (x.amountMinor || 0), 0) + (r.status === "paid" && !(r.payouts || []).length && r.paidAt ? owedMinor(r) : 0);
  async function approveCommission(uid, oid, { amountMinor, reason = "" } = {}) {
    if (!AU().isAdmin() && !(root.DPFin && root.DPFin.can("approveCommission"))) throw new Error("The administrator has not given you permission to approve commissions.");
    return updateCommission(uid, oid, (r) => {
      if (!["calculated", "pending", "returned"].includes(r.status)) throw new Error("This commission is already " + r.status + ". Use an adjustment to change an approved amount.");
      const calc = r.calculatedMinor != null ? r.calculatedMinor : r.amountMinor, amt = amountMinor == null ? calc : Math.round(amountMinor);
      if (!(amt >= 0)) throw new Error("Enter the approved amount.");
      if (amt !== calc && !String(reason).trim()) throw new Error("The approved amount differs from the calculation: give the reason.");
      const prevApproved = r.approvedMinor != null ? r.approvedMinor : null;
      r.approvals = (r.approvals || []).concat([{ at: now(), by: me().id, calculatedMinor: calc, previousApprovedMinor: prevApproved, approvedMinor: amt, diffMinor: amt - calc, reason: String(reason).trim(), eligibleAt: r.eligibleAt || null }]);
      r.approvedMinor = amt; r.approvedCommissionAt = now(); r.approvedBy = me().id;
      r.salaryCycle = root.DPPay.salaryCycle({ acceptedAt: r.approvedAt, approvalAt: r.approvedCommissionAt }, tzOf());
      return setStatus(r, "approved", amt === calc ? "Approved at the calculated amount" : `Approved ${amt / 100} (calculated ${calc / 100}): ${reason}`);
    }, "Commission approved", `${(amountMinor == null ? "calculated" : amountMinor / 100)} ${reason}`).then(async (r) => {
      if (root.DPNotify) await root.DPNotify.deliver(uid, { id: `comm-appr-${oid}-${(r.approvals || []).length}`, type: "commission", title: "Commission approved", body: `${r.name}: ${root.DPPricing.fmtMoney(r.approvedMinor, r.currency)} approved.`, link: { view: "mycomm" }, ref: oid }).catch(() => {});
      return r;
    });
  }
  async function returnCommission(uid, oid, reason) {
    if (!reason) throw new Error("A reason is required.");
    return updateCommission(uid, oid, (r) => { if (!["calculated", "pending"].includes(r.status)) throw new Error("Only commissions awaiting approval can be returned."); r.returnReason = reason; return setStatus(r, "returned", reason); }, "Commission returned for review", reason)
      .then(async (r) => { if (root.DPNotify) await root.DPNotify.deliver(uid, { id: `comm-ret-${oid}-${Date.now().toString(36)}`, type: "commission", title: "Commission returned for review", body: `${r.name}: ${reason}`, link: { view: "mycomm" }, ref: oid }).catch(() => {}); return r; });
  }
  const tzOf = () => ((root.DPUI && root.DPUI.App.config.settings) || {}).timezone || "Africa/Cairo";
  /** Where a commission stands for the employee (what the "Collect Commission" action may do). */
  function collectState(r, settings) {
    const cfg = eligibilityCfg(settings);
    if (["cancelled", "reversed"].includes(r.status)) return { key: "closed", can: false, text: "This commission was cancelled or reversed." };
    if (r.status === "paid") return { key: "paid", can: false, text: "Paid — see the payout proof." };
    if (r.status === "approved") return { key: "approved", can: true, text: `Approved. It will be paid with the ${root.DPPay.cycleLabel(r.salaryCycle || root.DPPay.salaryCycle({ acceptedAt: r.approvedAt, approvalAt: r.approvedCommissionAt }, tzOf()))}.` };
    if (r.status === "returned") return { key: "returned", can: false, text: "Returned for review by an administrator: " + (r.returnReason || "") };
    if (r.status === "pending" || r.eligibleAt) return { key: "eligible", can: false, text: "Eligible — awaiting administrator approval. It can be collected once an administrator approves it." };
    return { key: "calculated", can: false, text: `Calculated. Not yet eligible: ${MILESTONES[cfg.milestone] || "milestone"} not reached${cfg.milestone === "full_payment" ? " (verified payments only — uploaded proof is not verified payment)" : ""}.` };
  }
  /** EMPLOYEE: request collection of an eligible or approved commission. A request, not a transfer: it is recorded and the
   *  administrators are told; approval and payout stay administrator actions. Idempotent per order. */
  async function requestCollect(oid) {
    const uid = me().id, rec = await DS().tryGet(`commissions/${uid}/r/${oid}`); if (!rec) throw new Error("Commission not found.");
    const st = collectState(rec); if (!st.can) throw new Error(st.text);
    const path = `requests/${uid}/cc/${oid}`, prev = await DS().tryGet(path);
    const doc = { oid, uid, name: rec.name, ref: rec.ref || "", at: prev ? prev.at : now(), lastAt: now(), count: ((prev && prev.count) || 0) + 1, statusAtRequest: rec.status, cycle: rec.salaryCycle || null };
    await DS().set(path, doc);
    if (!prev && root.DPNotify) await root.DPNotify.deliver("@admins", { id: `cc-${uid}-${oid}`, type: "commission", title: "Commission collection requested", body: `${me().name || "An employee"} asked to collect the commission for ${rec.name}.`, link: { view: "approvecomm" }, ref: oid }).catch(() => {});
    return { doc, state: st, first: !prev };
  }
  async function myCollectRequests() { return (await DS().tryList(`requests/${me().id}/cc`)).map((x) => x.data); }
  async function allCollectRequests() { const ids = await uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`requests/${u}/cc`).then((x) => x.map((y) => y.data)))); return l.flat(); }
  /** Record a payout (full or partial). Paid status follows the payouts, not a single flag. */
  async function markPaid(uid, oid, { date, ref, amountMinor, proof = null, txRef = null }) {
    if (!date) throw new Error("Enter the payment date.");
    const poid = rid("po-");
    // commission payout proof is the EMPLOYEE's record (commissions/<uid>/…): never stored with, or shown as, client payment evidence
    if (proof) { reqCommFin(); await root.DPOrders.putFile(`commissions/${uid}/r/${oid}/po/${poid}`, proof); }
    return updateCommission(uid, oid, (r) => {
      if (!["approved", "paid"].includes(r.status) || r.approvedMinor == null) throw new Error("Approve the commission before recording a payout.");
      const due = owedMinor(r) - paidMinor(r), amt = amountMinor == null ? due : Math.round(amountMinor);
      if (!(amt > 0)) throw new Error("Nothing is outstanding on this commission."); if (amt > due) throw new Error("The payout is larger than the outstanding amount.");
      if (txRef && (r.payouts || []).some((x) => x.txRef === txRef)) throw new Error("This payout is already recorded.");
      r.payouts = (r.payouts || []).concat([{ id: poid, date, ref: ref || "", amountMinor: amt, at: now(), by: me().id, proof: proof ? { name: proof.name, type: proof.type, size: proof.size } : null, txRef: txRef || null }]);
      if (paidMinor(r) >= owedMinor(r)) { r.paidAt = date; r.paidRef = ref || ""; return setStatus(r, "paid", `Paid ${date}${ref ? " · " + ref : ""}`); }
      r.statusHistory = (r.statusHistory || []).concat([{ status: r.status, at: now(), by: me().id, note: `Partial payout ${amt / 100} on ${date}` }]); return r;
    }, "Commission payout", `${date} ${ref || ""}`).then(async (r) => { if (root.DPNotify) await root.DPNotify.deliver(uid, { id: `comm-paid-${oid}-${(r.payouts || []).length}`, type: "commission", title: r.status === "paid" ? "Commission paid" : "Commission partly paid", body: `${r.name}: ${root.DPPricing.fmtMoney(paidMinor(r), r.currency)} paid.`, link: { view: "mycomm" }, ref: oid }).catch(() => {}); return r; });
  }
  /** Commission payout proof (admin, or the employee for their own commission). */
  async function payoutProof(uid, oid, poid) { return root.DPOrders.getFile(`commissions/${uid}/r/${oid}/po/${poid}`); }
  /** Documented adjustment: the original and approved amounts are never edited. */
  async function adjust(uid, oid, amountMinor, reason) {
    if (!reason) throw new Error("A reason is required."); if (!Number.isInteger(amountMinor) || !amountMinor) throw new Error("Enter a non-zero amount.");
    return updateCommission(uid, oid, (r) => { if (["cancelled"].includes(r.status)) throw new Error("This commission is cancelled."); r.adjustments = (r.adjustments || []).concat([{ id: rid("adj-"), at: now(), by: me().id, amountMinor, reason }]);
      if (r.status === "paid" && paidMinor(r) < owedMinor(r)) setStatus(r, "approved", "Adjusted after payment: balance outstanding"); return r; }, "Commission adjusted", `${amountMinor / 100} · ${reason}`)
      .then(async (r) => { if (root.DPNotify) await root.DPNotify.deliver(uid, { id: `comm-adj-${oid}-${(r.adjustments || []).length}`, type: "commission", title: "Commission adjusted", body: `${r.name}: ${root.DPPricing.fmtMoney(amountMinor, r.currency)} — ${reason}`, link: { view: "mycomm" }, ref: oid }).catch(() => {}); return r; });
  }
  /** Recalculate under the current rule as an adjustment (only when an administrator decides to apply a new rule to an old order). */
  async function recalcAsAdjustment(uid, oid, reason) {
    const cfg = await commissionConfig(), rule = currentRule(cfg), rec = await DS().get(`commissions/${uid}/r/${oid}`);
    const base = rec.approvedMinor != null ? owedMinor(rec) : (rec.calculatedMinor != null ? rec.calculatedMinor : rec.amountMinor);
    const diff = C().calculate(rec.eligibleMinor, rule).amountMinor - base;
    if (!diff) throw new Error("The current rule gives the same amount.");
    return adjust(uid, oid, diff, `Recalculated under rule ${rule.id}: ${reason}`);
  }
  /** Flag a commission as eligible for review when the configured milestone is reached (administrator sessions). */
  async function checkEligibility(oid) {
    if (!AU().isAdmin() && !(AU().isFinance && AU().isFinance())) return;
    const o = await DS().tryGet(`orders/${oid}`); if (!o) return; const rec = await DS().tryGet(`commissions/${o.ownerId}/r/${oid}`); if (!rec || rec.eligibleAt || ["cancelled", "reversed"].includes(rec.status)) return;
    const cfg = eligibilityCfg(), verified = (o.payments || []).filter((p) => p.status === "verified").reduce((a, p) => a + p.amountMinor, 0);
    let met = cfg.milestone === "order";
    if (cfg.milestone === "payment_verified") met = verified > 0;
    if (cfg.milestone === "full_payment") met = root.DPPay.summary(o).fullyPaid;
    if (["ready", "completed"].includes(cfg.milestone)) { const a = await DS().tryGet(`assign/${oid}`), e = a && a.engineerUid ? await DS().tryGet(`eng/${a.engineerUid}/o/${oid}`) : null;
      met = !!e && (cfg.milestone === "completed" ? e.status === "completed" : ["ready", "installing", "completed"].includes(e.status)); }
    if (!met) return;
    const r2 = await updateCommission(o.ownerId, oid, (r) => { r.eligibleAt = now(); r.eligibleBy = MILESTONES[cfg.milestone]; if (r.status === "calculated") return setStatus(r, "pending", "Awaiting approval: " + MILESTONES[cfg.milestone]); r.statusHistory = (r.statusHistory || []).concat([{ status: r.status, at: now(), by: me().id, note: "Eligible for approval: " + MILESTONES[cfg.milestone] }]); return r; }, "Commission eligible for review", MILESTONES[cfg.milestone]);
    if (root.DPNotify) await root.DPNotify.deliver("@admins", { id: `comm-elig-${oid}`, type: "commission", title: "Commission eligible for review", body: `${o.name} (${AU().nameSync(o.ownerId)}): ${MILESTONES[cfg.milestone]}.`, link: { view: "commadmin" }, ref: oid }).catch(() => {});
    if (cfg.autoApprove && r2.status === "pending") await approveCommission(o.ownerId, oid, { reason: "" }).catch(() => {});
  }
  async function setSellingExpenses(oid, list, reason) {
    reqAdmin(); const o = await DS().get(`orders/${oid}`); o.sellingExpenses = list; o.history = (o.history || []).concat([{ at: now(), by: me().id, action: "Selling expenses updated", detail: reason || "" }]);
    await DS().set(`orders/${oid}`, o); await AU().adminLog("Updated selling expenses", { target: oid, reason });
  }
  /** Cancel an order: an unpaid commission is cancelled; a paid one is reversed with a negative adjustment. Nothing is deleted. */
  async function cancelOrder(oid, reason) {
    reqAdmin(); if (!reason) throw new Error("A reason is required.");
    const o = await DS().get(`orders/${oid}`); if (o.status === "cancelled") return;
    o.status = "cancelled"; o.cancelledAt = now(); o.cancelReason = reason; o.history = (o.history || []).concat([{ at: now(), by: me().id, action: "Order cancelled", detail: reason }]);
    await DS().set(`orders/${oid}`, o);
    const rec = await DS().tryGet(`commissions/${o.ownerId}/r/${oid}`);
    if (rec) await updateCommission(o.ownerId, oid, (r) => {
      const paid = paidMinor(r); if (paid > 0) { r.adjustments = (r.adjustments || []).concat([{ id: rid("adj-"), at: now(), by: me().id, amountMinor: -owedMinor(r), reason: "Reversal: order cancelled — " + reason }]); return setStatus(r, "reversed", reason); }
      return setStatus(r, "cancelled", reason);
    }, "Commission cancelled/reversed", oid);
    await setProjectStatus(o.ownerId, o.pid, "cancelled", { statusNote: reason });
    await AU().adminLog("Cancelled order", { target: oid, reason });
    if (root.DPOrders) { await root.DPOrders.syncSalesView(oid).catch(() => {}); const a = await DS().tryGet(`assign/${oid}`); if (a) { await DS().set(`assign/${oid}`, Object.assign({}, a, { status: "cancelled", history: (a.history || []).concat([{ at: now(), by: me().id, action: "Order cancelled", detail: reason }]) }));
      if (root.DPNotify && a.engineerUid) await root.DPNotify.deliver(a.engineerUid, { id: `eng-cancel-${oid}`, type: "engineering", title: "Order cancelled", body: `${a.name} was cancelled. Stop work and check with the administrator.`, link: { view: "engorders" }, ref: oid }).catch(() => {}); } }
  }

  /* ---------------- targets ---------------- */
  async function staffDoc(uid) { return (await DS().tryGet(`staff/${uid}`)) || { targets: {} }; }
  function targetFor(doc, per, settings) { const t = doc && doc.targets && doc.targets[per]; return t != null ? +t : +(((settings || {}).sales || {}).monthlyTarget || 500000); }
  async function setTarget(uid, per, amount, reason) {
    reqAdmin(); const d = await staffDoc(uid); d.targets = Object.assign({}, d.targets, { [per]: amount }); d.history = (d.history || []).concat([{ at: now(), by: me().id, per, amount, reason: reason || "" }]).slice(-100);
    await DS().set(`staff/${uid}`, d); await AU().adminLog("Set target", { target: uid, detail: `${per}: ${amount}`, reason });
  }

  /* ---------------- dashboard figures (definitions shown in the UI) ---------------- */
  const inPer = (iso, per) => { if (!iso) return false; const p = period(iso); return Array.isArray(per) ? per.includes(p) : p === per; };
  /** Sales achieved = eligible value of approved, not-cancelled orders approved in the period (excl. VAT, delivery, pass-through). */
  function salesFigures({ comms = [], projects = [], claims = [], crms = [], per }) {
    const live = comms.filter((c) => !["cancelled", "reversed"].includes(c.status));
    const achieved = live.filter((c) => inPer(c.approvedAt, per)).reduce((a, c) => a + c.eligibleMinor, 0);
    const issued = projects.filter((p) => p.issuedAt && inPer(p.issuedAt, per));
    const approvedOrders = live.filter((c) => inPer(c.approvedAt, per));
    const perComms = live.filter((c) => inPer(c.approvedAt, per));
    const calc = (c) => (c.calculatedMinor != null ? c.calculatedMinor : c.amountMinor) + (c.adjustments || []).reduce((a, x) => a + (x.amountMinor || 0), 0);
    return {
      achievedMinor: achieved, proposalsIssued: issued.length, drafts: projects.filter((p) => (!p.status || p.status === "draft") && inPer(p.savedAt, per)).length,
      ordersApproved: approvedOrders.length, conversion: issued.length ? approvedOrders.length / issued.length : null,
      commPending: perComms.filter((c) => ["calculated", "pending", "returned"].includes(c.status)).reduce((a, c) => a + calc(c), 0),
      commApproved: perComms.filter((c) => c.approvedMinor != null).reduce((a, c) => a + owedMinor(c), 0),
      commPaid: live.reduce((a, c) => a + (c.payouts || []).filter((p) => inPer(p.date, per)).reduce((b, p) => b + p.amountMinor, 0), 0),
      outstanding: live.filter((c) => c.approvedMinor != null).reduce((a, c) => a + Math.max(0, owedMinor(c) - paidMinor(c)), 0),
      leadsClaimed: claims.filter((c) => inPer(c.claimedAt, per)).length,
      leadsConverted: crms.filter((c) => c.stage === "won" && (c.stageHistory || []).some((h) => h.stage === "won" && inPer(h.at, per))).length,
    };
  }
  function lastPeriods(n, from) { const d = from ? new Date(from + "-01T12:00:00") : new Date(), out = []; for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 15); out.push(x.toISOString().slice(0, 7)); } return out; }

  root.DPLeads = { ORIGIN_KINDS, createLead, leadFiles, attachLeadFile, leadFile, removeLeadFile, ORG_TYPES, STAGES, STAGE_LABEL, OWNER_STAGES, CONTACT_SUB, QUAL, contactLabel, priority, scoreOf, listLeads, claimsByLead, ownership, myCrm, listCrm, stageOf, claim, release, updateCrm, addCrmEntry, syncStage,
    saveLead, reassign, adminRelease, setLeadStatus, correct, merge, importLeads, uids };
  root.DPSales = { collectState, requestCollect, myCollectRequests, allCollectRequests, commissionConfig, currentRule, ruleById, saveCommissionConfig, estimate, submit, accept, clientRejected, orderIdFor, payoutProof, mySubmissions, allSubmissions, withdraw, approve, returnSubmission, listOrders, myCommissions, allCommissions,
    approveCommission, returnCommission, markPaid, adjust, recalcAsAdjustment, checkEligibility, MILESTONES, eligibilityCfg, owedMinor, paidMinor, setSellingExpenses, cancelOrder, staffDoc, targetFor, setTarget, salesFigures, lastPeriods, period, inPer, setProjectStatus };
})(typeof self !== "undefined" ? self : this);
