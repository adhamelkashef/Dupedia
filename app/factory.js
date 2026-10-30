/* X FORCE 1.3 (Dupedia) — Factory Quality & Production Control: data layer.

     fac/cfg                       tolerances, approval rule, automatic assignment            administrators write
     fac/mat/m/<id>                material library: kind, stock sizes, kerf, unit (no price)  administrators write
     facc/mat/c/<id>               material unit cost                                          administrators (Finance reads)
     fac/jobs/j/<oid>              manufacturing job: products, specs, verification, BOM and
                                   cutting plans, stage, dates, QC, sales-facing updates       assigned engineer + administrators
                                                                                               (staff read — it holds no money)
     fac/jobs/j/<oid>/f/<fid>      drawings and reference files (chunked)
     fac/mov/m/<id>                material movements: issue, return, reuse, waste, reject     append-only
     fac/eq/e/<id>                 equipment / machines / tools / jigs                         engineers + administrators
     facc/eq/c/<id>                equipment purchase cost                                     administrators (Finance reads)
     fac/prof/p/<uid>              engineer skills, capacity, unavailability                   administrators
     fac/asg/a/<id>                assignment history (who got which job and why)             append-only
   Internal production notes stay where 1.0 put them (engx — engineer and administrators); sales see only what is in the job
   record and the sales note. The Worker enforces who may write what (worker/index.js facGuard). */
/* global DPStore, DPAuth, DPNotify, DPOrders, DPFab */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, F = () => root.DPFab, NT = () => root.DPNotify;
  const now = () => new Date().toISOString(), today = () => now().slice(0, 10), me = () => AU().A.me || {};
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isAdmin = () => AU().isAdmin(), isEng = () => me().role === "engineer";
  const list = async (c) => (await DS().tryList(c)).map((x) => Object.assign({ id: x.id }, x.data));
  const DEF = { tolerancePct: 10, wasteTolPct: 15, requireApproval: false, autoAssign: "balanced", minReusable: 300, skills: ["Welding", "Carpentry", "Fibreglass", "Painting", "Electrical", "Installation", "Soft play", "Water play"] };
  let CFG = null;
  async function cfg(force) { if (!CFG || force) CFG = Object.assign({}, DEF, (await DS().tryGet("fac/cfg")) || {}); return CFG; }
  async function saveCfg(c) { if (!isAdmin()) throw new Error("Administrators only."); await DS().set("fac/cfg", Object.assign({}, await cfg(true), c, { updatedAt: now(), updatedBy: me().id })); return cfg(true); }

  /* ---------------- material library ---------------- */
  const materials = async () => (await list("fac/mat/m")).sort((a, b) => a.name.localeCompare(b.name));
  async function saveMaterial(m) { if (!isAdmin()) throw new Error("Administrators maintain the material library."); if (!String(m.name || "").trim()) throw new Error("Name the material."); if (!F().STOCK_KINDS[m.kind]) throw new Error("Choose the stock type.");
    const id = m.id || rid("mt-"); const rec = { name: m.name.trim(), kind: m.kind, unit: m.unit || (m.kind === "sheet" ? "sheet" : m.kind === "linear" ? "bar" : m.kind === "roll" ? "m" : "pcs"), thickness: m.thickness || "", stock: m.stock || [], kerf: +m.kerf || 0, trim: +m.trim || 0, grain: !!m.grain, notes: m.notes || "", updatedAt: now(), updatedBy: me().id };
    await DS().set(`fac/mat/m/${id}`, rec); if (m.costMinor != null && m.costMinor !== "") await DS().set(`facc/mat/c/${id}`, { costMinor: Math.round(+m.costMinor), currency: "EGP", per: rec.unit, updatedAt: now() }); return Object.assign({ id }, rec); }
  async function matCosts() { try { return Object.fromEntries((await list("facc/mat/c")).map((x) => [x.id, x])); } catch (e) { return {}; } }

  /* ---------------- engineer profiles and automatic assignment ---------------- */
  const profiles = async () => Object.fromEntries((await list("fac/prof/p")).map((x) => [x.id, x]));
  async function saveProfile(uid, p) { if (!isAdmin()) throw new Error("Administrators only."); await DS().set(`fac/prof/p/${uid}`, { skills: p.skills || [], capacity: Math.max(1, +p.capacity || 5), unavailable: (p.unavailable || []).filter((u) => u.from), active: p.active !== false, updatedAt: now(), updatedBy: me().id }); }
  function engineersFrom(dir, prof) { return dir.filter((r) => r.uid && r.active !== false && AU().baseOf(r.role) === "engineer").map((r) => Object.assign({ uid: r.uid, name: AU().fullName(r), skills: [], capacity: 5, unavailable: [] }, prof[r.uid] || {})); }
  /** Active workload per engineer from the shared assignment index and the job records. */
  async function workload() {
    const [jobs, recs, fj] = await Promise.all([root.DPOrders.listJobs(), Promise.resolve(null), list("fac/jobs/j")]); const fb = Object.fromEntries(fj.map((j) => [j.id, j]));
    return jobs.filter((j) => j.engineerUid && j.status !== "cancelled" && !(j.e && j.e.status === "completed") && !(fb[j.oid] && fb[j.oid].stage === "completed"))
      .map((j) => { const f = fb[j.oid] || {}, due = f.target || (j.e && j.e.expectedCompletion) || j.deadlineOriginal; return { oid: j.oid, engineerUid: j.engineerUid, weight: f.weight || 1, due, overdue: !!(due && due < today()) }; });
  }
  async function history() { return (await list("fac/asg/a")).sort((a, b) => String(a.at).localeCompare(String(b.at))); }
  /** Choose an engineer for a job. Returns {uid|null, ranking, reason}. Writes nothing. */
  async function pick(job) {
    const [dir, prof, load, hist] = await Promise.all([AU().listDirectory(), profiles(), workload(), history()]);
    const ranking = F().rankEngineers(job, engineersFrom(dir, prof), load, { today: today(), history: hist });
    const best = ranking.find((x) => x.eligible); return { uid: best ? best.uid : null, ranking, reason: best ? `Lowest workload score (${best.score}): ${best.why}` : "No eligible engineer (all unavailable, over capacity or without the required skill)." };
  }
  async function logAssignment(oid, uid, { via = "auto", reason = "", ranking = [] } = {}) {
    await DS().create(`fac/asg/a/${rid("as-")}`, { oid, uid: uid || null, via, reason: String(reason).slice(0, 300), ranking: ranking.slice(0, 8).map((r) => ({ uid: r.uid, score: r.score, eligible: r.eligible, why: r.why })), by: me().id, at: now() }).catch(() => {});
  }

  /* ---------------- manufacturing jobs ---------------- */
  const jobs = async () => list("fac/jobs/j");
  const getJob = (oid) => DS().tryGet(`fac/jobs/j/${oid}`).then((j) => (j ? Object.assign({ id: oid, oid }, j) : null));
  const hist = (j, action, detail = "") => { j.history = (j.history || []).concat([{ at: now(), by: me().id, action, detail: String(detail).slice(0, 300) }]).slice(-300); };
  async function nextJobId() { const y = today().slice(2, 4), l = await jobs(); const n = l.filter((j) => String(j.jobId || "").startsWith(`MJ-${y}-`)).reduce((m, j) => Math.max(m, parseInt(j.jobId.split("-")[2], 10) || 0), 0) + 1; return `MJ-${y}-${String(n).padStart(4, "0")}`; }
  /** Create the job shell for an accepted order (idempotent, create-only). Products come from the technical handover (no prices). */
  async function ensureJob(a, ho) {
    const path = `fac/jobs/j/${a.oid}`, cur = await DS().tryGet(path); if (cur) return Object.assign({ id: a.oid, oid: a.oid }, cur);
    const items = (ho && ho.items) || [], products = items.filter((i) => i.qty > 0).map((i) => ({ code: i.displayCode || i.code || "", name: i.name || "", qty: i.qty, unit: i.unit || "pcs" }));
    const job = { jobId: await nextJobId(), oid: a.oid, ref: a.ref || "", name: a.name || "", client: a.client || "", location: a.location || "", salesUid: a.salesUid || null, engineerUid: a.engineerUid || null, products, specs: [], drawings: [], designRef: "",
      bom: [], stage: "review", target: a.deadlineOriginal || null, startDate: null, materials: "unknown", qc: [], install: { required: true, notes: "" }, salesUpdates: [], salesActions: [], machines: [], weight: F().weightOf({ products }),
      createdAt: now(), createdBy: me().id, history: [{ at: now(), by: me().id, action: "Manufacturing job created", detail: a.ref || "" }] };
    const r = await DS().create(path, job); return Object.assign({ id: a.oid, oid: a.oid }, r.created ? job : await DS().get(path));
  }
  async function saveJob(j, action, detail) { const copy = Object.assign({}, j); delete copy.id; hist(copy, action, detail); copy.updatedAt = now(); copy.updatedBy = me().id; await DS().set(`fac/jobs/j/${j.oid}`, copy); return Object.assign({ id: j.oid }, copy); }
  async function mutate(oid, fn, action, detail) { const j = await getJob(oid); if (!j) throw new Error("Manufacturing job not found."); const r = fn(j); if (r === false) return j; return saveJob(j, action, detail); }
  // the sales-facing engineering status follows the factory stage
  const ENG_MAP = { review: ["review", 5], verified: ["review", 15], approval: ["review", 20], approved: ["assign", 25], production: ["manufacturing", 50], inspection: ["qc", 80], rework: ["delayed", 60], completed: ["ready", 95] };
  async function setStage(oid, to, { note = "", salesNote } = {}) {
    const j = await getJob(oid); if (!j) throw new Error("Job not found."); const c = await cfg();
    const why = F().gate(j, to, { requireApproval: c.requireApproval, override: j.override }); if (why.length) throw Object.assign(new Error(why.join(" ")), { why });
    if (to === "rework" && !String(note).trim()) throw new Error("Describe what must be reworked.");
    const from = j.stage; j.stage = to; if (to === "production" && !j.startDate) j.startDate = today(); if (to === "completed") j.completedAt = now();
    if (salesNote) j.salesUpdates = (j.salesUpdates || []).concat([{ at: now(), by: me().id, text: salesNote }]).slice(-80);
    await saveJob(j, `Stage: ${F().STAGE_LABEL[from]} → ${F().STAGE_LABEL[to]}`, note);
    const [st, prog] = ENG_MAP[to] || []; if (st && (isAdmin() || j.engineerUid === me().id)) await root.DPOrders.updateEng(oid, Object.assign({ status: st, progress: prog }, st === "delayed" ? { risk: "delayed", riskReason: note } : {}), { note: note || `Factory: ${F().STAGE_LABEL[to]}`, salesNote: salesNote || undefined }).catch((e) => console.warn("eng sync", e.message));
    const ev = { review: null, verified: null, approval: "Technical approval required", approved: "Approved for manufacturing", production: "Manufacturing started", inspection: "Quality inspection", rework: "Rework required — quality inspection failed", completed: "Manufacturing completed" }[to];
    if (ev && NT()) { const to2 = to === "approval" ? ["@admins"] : [j.salesUid, "@admins"].filter(Boolean);
      await NT().deliver(to2, { id: `fac-${oid}-${to}-${Date.now().toString(36)}`, type: "factory", title: ev, body: `${j.name || oid} (${j.jobId}): ${F().STAGE_LABEL[to]}${salesNote ? " — " + salesNote : ""}.`, link: { view: to === "approval" ? "facjobs" : "proposals", opts: { oid } }, ref: oid, priority: to === "rework" ? "warning" : null }).catch(() => {}); }
    return getJob(oid);
  }
  /** Verification of one measurement: pass / fail, measured value, note, by whom and when. */
  const verifySpec = (oid, i, { status, measured = "", note = "" }) => mutate(oid, (j) => { const s = j.specs[i]; if (!s) throw new Error("Measurement not found.");
    if (status === "fail" && !note) throw new Error("Say what failed."); Object.assign(s, { status, measured, note, by: me().id, at: now() }); }, "Measurement verified", `${(oid && "")}${status}`);
  /** Approve the material estimate of a BOM line (stock quantity from its cutting plan). Never changed afterwards. */
  const approveEstimate = (oid, lineId) => mutate(oid, (j) => { const b = (j.bom || []).find((x) => x.id === lineId); if (!b) throw new Error("BOM line not found."); if (b.approvedQty != null) throw new Error("Already approved.");
    if (!b.plan || !b.plan.totals) throw new Error("Calculate the cutting plan first."); b.approvedQty = F().stockQty(b.plan); b.approvedBy = me().id; b.approvedAt = now(); }, "Material estimate approved", lineId);
  async function addDrawing(oid, file, label = "") { const fid = rid("dw-"); await root.DPOrders.putFile(`fac/jobs/j/${oid}/f/${fid}`, file);
    return mutate(oid, (j) => { j.drawings = (j.drawings || []).concat([{ id: fid, name: file.name, type: file.type, size: file.size, label, by: me().id, at: now() }]); }, "Drawing / reference file attached", file.name); }
  const drawing = (oid, fid) => root.DPOrders.getFile(`fac/jobs/j/${oid}/f/${fid}`);

  /* ---------------- material movements ---------------- */
  async function moves(oid = null) { const l = await list("fac/mov/m"); return (oid ? l.filter((m) => m.oid === oid) : l).sort((a, b) => String(a.at).localeCompare(String(b.at))); }
  async function addMove(m) {
    if (!F().MOVES[m.type]) throw new Error("Choose the movement type."); if (!(+m.qty > 0)) throw new Error("Enter a quantity greater than zero.");
    if (["waste", "reject"].includes(m.type) && !String(m.reason || "").trim()) throw new Error("Explain the waste or rejected material.");
    const c = await cfg(), job = m.oid ? await getJob(m.oid) : null, mats = await materials(), mat = mats.find((x) => x.id === m.matId); if (!mat) throw new Error("Choose the material.");
    const rec = { oid: m.oid || null, jobId: job ? job.jobId : null, matId: m.matId, name: mat.name, unit: mat.unit, type: m.type, qty: +m.qty, reason: String(m.reason || "").slice(0, 300), by: me().id, at: now() };
    await DS().create(`fac/mov/m/${rid("mv-")}`, rec);
    const alerts = [];
    if (!m.oid && m.type === "issue") alerts.push({ code: "no-job", text: `${mat.name} issued without a manufacturing job.` });
    if (job) { const st = F().materialStatus((job.bom || []).map((b) => ({ matId: b.matId, name: b.matName, unit: b.unit, approvedQty: b.approvedQty })), await moves(job.oid), c);
      for (const a of st.alerts.filter((x) => x.matId === m.matId)) alerts.push(a);
      const over = st.alerts.filter((a) => a.code === "overrun"); if (over.length) { const n = ((job.overruns || 0) + (st.alerts.some((a) => a.code === "overrun" && a.matId === m.matId) ? 1 : 0)); await mutate(job.oid, (j) => { j.overruns = n; }, "Material overrun recorded", `${mat.name}: ${m.reason || ""}`).catch(() => {}); } }
    if (alerts.length && NT()) await NT().deliver("@admins", { id: `fac-mat-${m.oid || "none"}-${m.matId || ""}-${alerts.some((a) => a.code === "overrun") ? "overrun" : alerts.some((a) => a.code === "waste-high") ? "waste" : alerts.map((a) => a.code).sort().join("+")}-${today()}`, type: "factory", title: alerts.some((a) => a.code === "overrun") ? "Material overrun" : alerts.some((a) => a.code === "waste-high") ? "Waste above tolerance" : "Material exception", body: alerts.map((a) => a.text).join(" "), link: { view: "facjobs", opts: { oid: m.oid || "" } }, ref: m.oid || null, priority: "warning" }).catch(() => {});
    return { rec, alerts };
  }

  /* ---------------- equipment ---------------- */
  const EQ_CATS = { machine: "Machine", hand: "Hand tool", measuring: "Measuring equipment", production: "Production equipment", cutting: "Cutting tool", jig: "Mould / jig / fixture", other: "Other asset" };
  const EQ_STATUS = { available: "Available", inuse: "In use", maintenance: "Under maintenance", broken: "Out of order", retired: "Retired" };
  const equipment = async () => (await list("fac/eq/e")).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  async function saveEquipment(e) {
    if (!isAdmin() && !isEng()) throw new Error("Engineers and administrators maintain the equipment directory."); if (!String(e.name || "").trim()) throw new Error("Name the asset.");
    const all = await equipment(), id = e.id || rid("eq-"), assetId = String(e.assetId || "").trim() || `EQ-${String(all.length + 1).padStart(4, "0")}`;
    if (all.some((x) => x.id !== id && x.assetId === assetId)) throw new Error(`Asset ID ${assetId} is already used.`);
    const prev = all.find((x) => x.id === id) || {};
    const rec = Object.assign({}, prev, { assetId, name: e.name.trim(), category: EQ_CATS[e.category] ? e.category : "other", brand: e.brand || "", model: e.model || "", supplier: e.supplier || "", serial: e.serial || "", purchaseDate: e.purchaseDate || "", location: e.location || "", responsibleUid: e.responsibleUid || null,
      instructions: e.instructions || "", safety: e.safety || "", intervalDays: +e.intervalDays || null, lastMaintenance: e.lastMaintenance || prev.lastMaintenance || null, nextMaintenance: e.nextMaintenance || null, condition: e.condition || "good", status: EQ_STATUS[e.status] ? e.status : "available",
      calibration: e.calibration || prev.calibration || null, log: prev.log || [], files: prev.files || [], updatedAt: now(), updatedBy: me().id });
    if (id === e.id && prev.status && prev.status !== rec.status) rec.log = rec.log.concat([{ at: now(), by: me().id, kind: "status", text: `${EQ_STATUS[prev.status]} → ${EQ_STATUS[rec.status]}` }]);
    delete rec.id; await DS().set(`fac/eq/e/${id}`, rec);
    if (isAdmin() && e.costMinor != null && e.costMinor !== "") await DS().set(`facc/eq/c/${id}`, { costMinor: Math.round(+e.costMinor), currency: "EGP", updatedAt: now() });
    if (["broken", "maintenance"].includes(rec.status) && prev.status !== rec.status && NT()) await NT().deliver("@admins", { id: `eq-st-${id}-${Date.now().toString(36)}`, type: "factory", title: `${rec.name} unavailable`, body: `${rec.assetId}: ${EQ_STATUS[rec.status]}.`, link: { view: "equipment", opts: { id } }, priority: "warning" }).catch(() => {});
    return Object.assign({ id }, rec);
  }
  async function logMaintenance(id, { date, kind = "maintenance", text, by = null, next = null }) {
    if (!String(text || "").trim()) throw new Error("Describe the work done."); const p = `fac/eq/e/${id}`, e = await DS().get(p);
    e.log = (e.log || []).concat([{ at: now(), date: date || today(), by: by || me().id, kind, text }]).slice(-200);
    if (kind === "calibration") e.calibration = Object.assign({}, e.calibration || { required: true }, { last: date || today(), next: next || null }); else { e.lastMaintenance = date || today(); e.nextMaintenance = next || null; if (e.status === "maintenance") e.status = "available"; }
    e.updatedAt = now(); await DS().set(p, e); return e;
  }
  async function eqCosts() { try { return Object.fromEntries((await list("facc/eq/c")).map((x) => [x.id, x])); } catch (e) { return {}; } }

  root.DPFac = { DEF, cfg, saveCfg, materials, saveMaterial, matCosts, profiles, saveProfile, engineersFrom, workload, history, pick, logAssignment, jobs, getJob, ensureJob, saveJob, mutate, setStage, verifySpec, approveEstimate, addDrawing, drawing, moves, addMove, EQ_CATS, EQ_STATUS, equipment, saveEquipment, logMaintenance, eqCosts, ENG_MAP };
})(typeof self !== "undefined" ? self : this);
