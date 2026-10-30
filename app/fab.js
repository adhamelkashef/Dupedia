/* X FORCE 1.3 (Dupedia) — factory engineering calculations. Pure functions (no storage), shared by the app, the server
   job and the tests.

   CUTTING  • Linear stock (pipe, profile, timber, bar): one-dimensional cutting — Best-Fit-Decreasing over every stock length
              offered, reusable offcuts first, saw kerf between cuts and end trim; then each bar is moved to the shortest stock
              length that still holds its cuts.
            • Sheet / board / panel: two-dimensional GUILLOTINE nesting (every cut runs edge to edge, as on a panel saw):
              best-area-fit placement, shorter-leftover split, optional 90° rotation per part (off when grain matters), kerf
              around every part and edge trim. Several part orders are tried and the plan with the fewest sheets, then the
              least waste, is kept. Fabric rolls use the same method on a strip of the roll width.
            • Countable items (bolts, fittings): quantity only.
            Theoretical material = the parts themselves; stock consumption = the whole bars/sheets that must be issued.
            These are planning aids for an engineer, not a substitute for engineering verification.
   WASTE    Planned vs issued, returned, reused, scrapped; waste % and utilisation; alerts.
   ASSIGN   Workload-balanced choice of engineer with an explanation of the scores. */
(function (root) {
  "use strict";
  const num = (v) => (isFinite(+v) ? +v : 0), r2 = (x) => Math.round(x * 100) / 100;
  const STOCK_KINDS = { sheet: "Sheet / board / panel", linear: "Pipe / profile / bar / timber", roll: "Fabric or membrane roll", unit: "Countable item" };

  /* ---------------- 1-D cutting ---------------- */
  function cut1D({ parts = [], stock = [], offcuts = [], kerf = 3, trim = 0, minReusable = 300 }) {
    const L = stock.map((s) => num(s.len || s)).filter((x) => x > 0).sort((a, b) => b - a), K = Math.max(0, num(kerf)), T = Math.max(0, num(trim));
    const pieces = []; for (const p of parts) for (let i = 0; i < Math.round(num(p.qty)); i++) pieces.push({ label: p.label || "", len: num(p.len) });
    if (!pieces.length) return { bars: [], errors: [] };
    if (!L.length) return { bars: [], errors: ["Enter at least one stock length."] };
    const errors = pieces.filter((p) => p.len + 2 * T > L[0]).map((p) => `${p.label || "A part"} (${p.len} mm) is longer than the longest stock (${L[0]} mm).`);
    const ok = pieces.filter((p) => p.len + 2 * T <= L[0]).sort((a, b) => b.len - a.len);
    const bars = offcuts.map((o) => ({ stockLen: num(o.len || o), source: "offcut", cuts: [], free: num(o.len || o) - 2 * T })).filter((b) => b.free > 0);
    for (const p of ok) {
      let best = null; for (const b of bars) { const need = p.len + (b.cuts.length ? K : 0); if (need <= b.free + 1e-9 && (!best || b.free - need < best.free - (p.len + (best.cuts.length ? K : 0)))) best = b; }
      if (!best) { best = { stockLen: L[0], source: "stock", cuts: [], free: L[0] - 2 * T }; bars.push(best); }
      best.free -= p.len + (best.cuts.length ? K : 0); best.cuts.push(p);
    }
    const used = bars.filter((b) => b.cuts.length);
    for (const b of used) if (b.source === "stock") { const need = b.stockLen - 2 * T - b.free; for (const l of L) if (l - 2 * T >= need - 1e-9 && l < b.stockLen) { b.free = l - 2 * T - need; b.stockLen = l; } }
    const out = used.map((b) => { const partsLen = b.cuts.reduce((s, c) => s + c.len, 0), kerfLoss = K * Math.max(0, b.cuts.length - 1) + (b.free > 0 ? K : 0);
      const rem = Math.max(0, b.stockLen - partsLen - kerfLoss - 2 * T); return { stockLen: b.stockLen, source: b.source, cuts: b.cuts, partsLen, kerfLoss: Math.min(kerfLoss, b.stockLen - partsLen), trim: 2 * T, remnant: r2(rem), reusable: rem >= minReusable }; });
    return { bars: out, errors, totals: totals1D(out) };
  }
  function totals1D(bars) {
    const stock = bars.filter((b) => b.source === "stock"), theo = bars.reduce((s, b) => s + b.partsLen, 0), consumed = bars.reduce((s, b) => s + b.stockLen, 0);
    const reuse = bars.filter((b) => b.reusable).reduce((s, b) => s + b.remnant, 0), waste = consumed - theo - reuse;
    const byLen = {}; for (const b of stock) byLen[b.stockLen] = (byLen[b.stockLen] || 0) + 1;
    return { theoretical: theo, consumed, stockConsumed: stock.reduce((s, b) => s + b.stockLen, 0), offcutsUsed: bars.length - stock.length, stockPieces: byLen, reusableRemnant: r2(reuse), waste: r2(waste), wastePct: consumed ? r2(waste / consumed * 100) : 0, utilisationPct: consumed ? r2(theo / consumed * 100) : 0, unit: "mm" };
  }

  /* ---------------- 2-D guillotine nesting ---------------- */
  function pack2D(parts, W, H, K, rotateOK) {
    // free rectangles; each placement splits the chosen rectangle by a full-length (guillotine) cut along the shorter leftover
    const sheets = [], open = () => { const s = { free: [{ x: 0, y: 0, w: W, h: H }], placed: [] }; sheets.push(s); return s; };
    for (const p of parts) {
      const pw = p.w + K, ph = p.h + K; let best = null;
      const tryFit = (s, f, w, h, rot) => { if (w <= f.w + 1e-9 && h <= f.h + 1e-9) { const sc = f.w * f.h - w * h; if (!best || sc < best.sc) best = { s, f, w, h, rot, sc }; } };
      for (const s of sheets) for (const f of s.free) { tryFit(s, f, pw, ph, false); if (rotateOK(p)) tryFit(s, f, ph, pw, true); }
      if (!best) { const s = open(), f = s.free[0]; tryFit(s, f, pw, ph, false); if (rotateOK(p)) tryFit(s, f, ph, pw, true); if (!best) { sheets.pop(); p._err = true; continue; } }
      const { s, f, w, h, rot } = best; s.placed.push({ label: p.label, x: f.x, y: f.y, w: rot ? p.h : p.w, h: rot ? p.w : p.h, rot, pid: p.pid });
      s.free.splice(s.free.indexOf(f), 1);
      const rw = f.w - w, rh = f.h - h;   // shorter-leftover-axis split
      if (rw < rh) { if (rw > 0) s.free.push({ x: f.x + w, y: f.y, w: rw, h }); if (rh > 0) s.free.push({ x: f.x, y: f.y + h, w: f.w, h: rh }); }
      else { if (rw > 0) s.free.push({ x: f.x + w, y: f.y, w: rw, h: f.h }); if (rh > 0) s.free.push({ x: f.x, y: f.y + h, w, h: rh }); }
    }
    return sheets;
  }
  /** Sheets: stock {l, w} (mm; several sizes allowed), parts {label, l, w, qty, rotate}. Roll: stock {w, len}. */
  function nest2D({ parts = [], stock = [], kerf = 3, trim = 10, roll = false, rotateAll = true }) {
    const K = Math.max(0, num(kerf)), T = Math.max(0, num(trim)), sizes = stock.map((s) => ({ l: num(s.l || s.len), w: num(s.w) })).filter((s) => s.l > 0 && s.w > 0);
    if (!sizes.length) return { sheets: [], errors: ["Enter the stock size (length × width)."] };
    const pieces = []; parts.forEach((p, pi) => { for (let i = 0; i < Math.round(num(p.qty)); i++) pieces.push({ label: p.label || `Part ${pi + 1}`, w: num(p.l), h: num(p.w), rotate: p.rotate !== false && rotateAll, pid: pi }); });
    if (!pieces.length) return { sheets: [], errors: [] };
    const orders = [(a, b) => b.w * b.h - a.w * a.h, (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h), (a, b) => b.h - a.h || b.w - a.w, (a, b) => b.w - a.w || b.h - a.h];
    let best = null;
    for (const sz of sizes) for (const o of orders) {
      const W = sz.l - 2 * T + K, H = sz.w - 2 * T + K, list = pieces.map((p) => Object.assign({}, p)).sort(o), sh = pack2D(list, W, H, K, (p) => p.rotate);
      const bad = list.filter((p) => p._err), used = sh.length, area = sz.l * sz.w;
      const lastUse = used ? sh[used - 1].placed.reduce((s, q) => s + (q.w + K) * (q.h + K), 0) / (W * H) : 0;
      const rollLen = roll && used === 1 ? Math.min(sz.l, Math.max(...sh[0].placed.map((q) => q.x + q.w + K)) + 2 * T) : null;
      const cost = roll ? (rollLen || used * sz.l) * sz.w : used * area;
      const cand = { size: sz, sheets: sh, bad, cost, lastUse };
      if (!best || cand.bad.length < best.bad.length || (cand.bad.length === best.bad.length && (cand.cost < best.cost - 1e-6 || (Math.abs(cand.cost - best.cost) < 1e-6 && cand.lastUse < best.lastUse)))) best = Object.assign(cand, { rollLen });
    }
    const theo = pieces.filter((p) => !best.bad.some((b) => b.pid === p.pid && b.label === p.label)).reduce((s, p) => s + p.w * p.h, 0);
    const errors = [...new Set(best.bad.map((p) => `${p.label} (${p.w} × ${p.h} mm) does not fit on ${best.size.l} × ${best.size.w} mm stock${p.rotate ? "" : " without rotation"}.`))];
    // the unused part of the LAST sheet is a returnable offcut when it is a usable size (planning assumption, shown as such)
    const area1 = best.size.l * best.size.w, remnant = !roll && best.sheets.length && best.lastUse < 0.6 ? (1 - best.lastUse) * area1 * 0.9 : 0;
    const consumed = best.cost, waste = consumed - theo - remnant;
    return { size: best.size, roll, sheets: best.sheets.map((s) => ({ placed: s.placed.map((q) => Object.assign(q, { x: r2(q.x + T), y: r2(q.y + T) })) })), errors,
      totals: { theoretical: r2(theo / 1e6), consumed: r2(consumed / 1e6), sheets: best.sheets.length, rollLength: best.rollLen, reusableRemnant: r2(remnant / 1e6), waste: r2(waste / 1e6), wastePct: consumed ? r2(waste / consumed * 100) : 0, utilisationPct: consumed ? r2(theo / consumed * 100) : 0,
        lastSheetUsePct: r2(best.lastUse * 100), unit: "m²", kerf: K, trim: T } };
  }
  /** Check a manually adjusted layout: parts inside the sheet (after trim) and not overlapping (kerf respected). */
  function checkLayout(sheet, size, kerf = 3, trim = 10) {
    const out = [], P = sheet.placed;
    P.forEach((a, i) => { if (a.x < trim - 1e-6 || a.y < trim - 1e-6 || a.x + a.w > size.l - trim + 1e-6 || a.y + a.h > size.w - trim + 1e-6) out.push(`${a.label} is outside the usable sheet area.`);
      for (let j = i + 1; j < P.length; j++) { const b = P[j]; if (a.x < b.x + b.w + kerf - 1e-6 && b.x < a.x + a.w + kerf - 1e-6 && a.y < b.y + b.h + kerf - 1e-6 && b.y < a.y + a.h + kerf - 1e-6) out.push(`${a.label} and ${b.label} overlap or are closer than the saw kerf (${kerf} mm).`); } });
    return out;
  }
  /** Plan one BOM line with the right method; also compare every stock option to show possible savings. */
  function planLine(line) {
    const kind = line.kind || "sheet";
    if (kind === "unit") { const q = (line.parts || []).reduce((s, p) => s + num(p.qty), 0); return { kind, totals: { theoretical: q, consumed: q, waste: 0, wastePct: 0, utilisationPct: 100, unit: line.unit || "pcs" }, errors: [] }; }
    if (kind === "linear") {
      const base = cut1D({ parts: line.parts, stock: line.stock, offcuts: line.offcuts || [], kerf: line.kerf, trim: line.trim, minReusable: line.minReusable || 300 });
      const alts = (line.stock || []).length > 1 ? line.stock.map((s) => ({ stock: s, r: cut1D({ parts: line.parts, stock: [s], kerf: line.kerf, trim: line.trim }) })).filter((a) => !a.r.errors.length).map((a) => ({ label: `${num(a.stock.len || a.stock)} mm only`, consumed: a.r.totals.stockConsumed, wastePct: a.r.totals.wastePct })) : [];
      return Object.assign({ kind }, base, { alternatives: alts });
    }
    const base = nest2D({ parts: line.parts, stock: line.stock, kerf: line.kerf, trim: line.trim, roll: kind === "roll", rotateAll: line.rotate !== false });
    const alts = [];
    if ((line.stock || []).length > 1) for (const s of line.stock) { const r = nest2D({ parts: line.parts, stock: [s], kerf: line.kerf, trim: line.trim, roll: kind === "roll", rotateAll: line.rotate !== false }); if (!r.errors.length) alts.push({ label: `${num(s.l || s.len)} × ${num(s.w)} only`, consumed: r.totals.consumed, wastePct: r.totals.wastePct, sheets: r.totals.sheets }); }
    if (line.rotate === false) { const r = nest2D({ parts: line.parts, stock: line.stock, kerf: line.kerf, trim: line.trim, roll: kind === "roll", rotateAll: true }); if (!r.errors.length && r.totals.consumed < base.totals.consumed) alts.push({ label: "if parts may be rotated (no grain direction)", consumed: r.totals.consumed, wastePct: r.totals.wastePct, sheets: r.totals.sheets, saves: r2(base.totals.consumed - r.totals.consumed) }); }
    return Object.assign({ kind }, base, { alternatives: alts });
  }
  /** Quantity of stock units to issue for a planned line (sheets, bars per length, roll metres, pieces). */
  function stockQty(plan) {
    if (!plan || !plan.totals) return 0; if (plan.kind === "linear") return Object.values(plan.totals.stockPieces || {}).reduce((s, x) => s + x, 0);
    if (plan.kind === "roll") return plan.totals.rollLength ? r2(plan.totals.rollLength / 1000) : plan.totals.sheets; return plan.kind === "unit" ? plan.totals.consumed : plan.totals.sheets;
  }

  /* ---------------- material ledger and waste alerts ---------------- */
  const MOVES = { issue: "Issued to the job", return: "Returned to store", reuse: "Offcut reused", waste: "Waste / scrap", reject: "Rejected material" };
  /** movements: {matId, type, qty} for one job. bom: [{matId, approvedQty}]. Returns per-material figures and alerts. */
  function materialStatus(bom = [], moves = [], { tolerancePct = 10, wasteTolPct = 15 } = {}) {
    const by = {}, alerts = [];
    for (const b of bom) by[b.matId] = { matId: b.matId, name: b.name || b.matId, unit: b.unit || "", planned: num(b.approvedQty != null ? b.approvedQty : b.plannedQty), issued: 0, returned: 0, reused: 0, waste: 0, rejected: 0, inBom: true };
    for (const m of moves) { const x = by[m.matId] || (by[m.matId] = { matId: m.matId, name: m.name || m.matId, unit: m.unit || "", planned: 0, issued: 0, returned: 0, reused: 0, waste: 0, rejected: 0, inBom: false });
      const q = num(m.qty); if (m.type === "issue") x.issued += q; else if (m.type === "return") x.returned += q; else if (m.type === "reuse") x.reused += q; else if (m.type === "waste") x.waste += q; else if (m.type === "reject") x.rejected += q;
      if ((m.type === "waste" || m.type === "reject") && !String(m.reason || "").trim()) alerts.push({ level: "warning", code: "waste-no-reason", matId: m.matId, text: `${x.name}: waste recorded without an explanation.` }); }
    for (const x of Object.values(by)) {
      x.consumed = r2(x.issued - x.returned); x.wasteAll = r2(x.waste + x.rejected); x.wastePct = x.consumed > 0 ? r2(x.wasteAll / x.consumed * 100) : 0; x.overrun = x.planned > 0 ? r2(x.consumed - x.planned) : 0;
      x.overrunPct = x.planned > 0 ? r2(x.overrun / x.planned * 100) : null;
      if (!x.inBom && x.issued > 0) alerts.push({ level: "warning", code: "not-in-bom", matId: x.matId, text: `${x.name} was issued but is not in the approved bill of materials.` });
      if (x.planned > 0 && x.overrunPct > tolerancePct) alerts.push({ level: "error", code: "overrun", matId: x.matId, text: `${x.name}: ${x.consumed} ${x.unit} used against ${x.planned} approved (+${x.overrunPct}%). A reason is required.`, tip: "Check the cutting plan was followed, re-measure before cutting the next pieces, and record reusable offcuts as returns." });
      if (x.consumed > 0 && x.wastePct > wasteTolPct) alerts.push({ level: "warning", code: "waste-high", matId: x.matId, text: `${x.name}: waste ${x.wastePct}% is above the ${wasteTolPct}% tolerance.`, tip: "Nest smaller parts into offcuts, allow rotation where the grain permits, and keep remnants above the reusable length." });
    }
    return { lines: Object.values(by), alerts };
  }

  /* ---------------- technical verification and stage gate ---------------- */
  const STAGES = [["review", "Awaiting Technical Review"], ["verified", "Measurements Verified"], ["approval", "Awaiting Approval"], ["approved", "Approved for Manufacturing"], ["production", "In Production"], ["inspection", "Quality Inspection"], ["rework", "Rework Required"], ["completed", "Completed"]];
  const STAGE_LABEL = Object.fromEntries(STAGES);
  const FLOW = { review: ["verified"], verified: ["approval", "approved", "review"], approval: ["approved", "review"], approved: ["production", "review"], production: ["inspection", "rework"], inspection: ["completed", "rework"], rework: ["production", "inspection"], completed: [] };
  /** Why a job may not move to a stage. Empty list = allowed. */
  function gate(job, to, { requireApproval = false, override = null } = {}) {
    const why = [], specs = job.specs || [], bom = job.bom || [];
    if (!(FLOW[job.stage || "review"] || []).includes(to)) why.push(`A job cannot go from "${STAGE_LABEL[job.stage || "review"]}" to "${STAGE_LABEL[to]}".`);
    if (["verified", "approval", "approved", "production"].includes(to)) {
      if (!specs.length) why.push("Add the required measurements and tolerances.");
      for (const s of specs.filter((x) => x.required !== false)) { if (!s.value && s.value !== 0) why.push(`${s.label}: required value missing.`); if (s.status !== "pass") why.push(`${s.label}: not verified${s.status === "fail" ? " — verification FAILED" : ""}.`); }
    }
    if (["approved", "production"].includes(to)) {
      if (!(job.drawings || []).length && !job.designRef) why.push("Attach the approved drawing or design reference.");
      if (!bom.length) why.push("Add the bill of materials.");
      if (bom.some((b) => b.approvedQty == null)) why.push("Approve the material estimate of every BOM line.");
      if (requireApproval && to === "approved" && !job.techApprovedBy) why.push("Technical approval by an authorised manager is required.");
    }
    if (why.length && override && String(override.reason || "").trim().length >= 10 && override.by) return [];
    return why;
  }

  /* ---------------- automatic, fair engineer assignment ---------------- */
  /** engineers: [{uid, name, skills[], capacity, unavailable:[{from,to}], active}]; jobs: active jobs [{engineerUid, weight, due, overdue}];
   *  history: recent assignments [{uid, at}]. Returns ranking (best first) with reasons; empty = nobody eligible. */
  function rankEngineers(job, engineers, jobs, { today = new Date().toISOString().slice(0, 10), history = [] } = {}) {
    const need = (job.skills || []).filter(Boolean), out = [];
    for (const e of engineers) {
      if (e.active === false) continue;
      if ((e.unavailable || []).some((u) => u.from <= today && (!u.to || u.to >= today))) { out.push({ uid: e.uid, name: e.name, eligible: false, why: "unavailable (leave or absence)" }); continue; }
      const miss = need.filter((s) => !(e.skills || []).includes(s)); if (miss.length && (e.skills || []).length) { out.push({ uid: e.uid, name: e.name, eligible: false, why: `missing skill: ${miss.join(", ")}` }); continue; }
      const mine = jobs.filter((j) => j.engineerUid === e.uid), cap = Math.max(1, num(e.capacity) || 5);
      const load = mine.reduce((s, j) => s + (num(j.weight) || 1), 0), overdue = mine.filter((j) => j.overdue).length, soon = mine.filter((j) => j.due && j.due <= addDays(today, 7)).length;
      const recent = history.filter((h) => h.uid === e.uid && h.at >= addDays(today, -30)).length, last = history.filter((h) => h.uid === e.uid).map((h) => h.at).sort().pop() || "";
      const score = r2(load / cap + overdue * 0.5 + soon * 0.15 + recent * 0.02 + (miss.length ? 0.3 : 0));
      out.push({ uid: e.uid, name: e.name, eligible: load < cap * 1.5, score, load, cap, overdue, soon, recent, last, why: `${load}/${cap} workload points, ${mine.length} active job(s), ${overdue} overdue, ${soon} due within 7 days${load >= cap * 1.5 ? " — over capacity" : ""}` });
    }
    return out.sort((a, b) => (b.eligible - a.eligible) || (a.score - b.score) || String(a.last).localeCompare(String(b.last)) || String(a.name).localeCompare(String(b.name)));
  }
  function addDays(d, n) { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  /** Default workload weight of a job from its size: number of product lines and units (1 = small, up to 5). */
  const weightOf = (job) => Math.min(5, Math.max(1, Math.round(1 + ((job.products || []).length / 3) + ((job.products || []).reduce((s, p) => s + num(p.qty), 0) / 10))));

  /* ---------------- equipment maintenance ---------------- */
  function maintStatus(eq, today = new Date().toISOString().slice(0, 10)) {
    const next = eq.nextMaintenance || (eq.lastMaintenance && eq.intervalDays ? addDays(eq.lastMaintenance, num(eq.intervalDays)) : null);
    const cal = eq.calibration && eq.calibration.required ? (eq.calibration.next || (eq.calibration.last && eq.calibration.intervalDays ? addDays(eq.calibration.last, num(eq.calibration.intervalDays)) : null)) : null;
    const st = (d) => (!d ? "none" : d < today ? "overdue" : d <= addDays(today, 7) ? "due" : "ok");
    return { next, maint: st(next), calibration: cal, cal: st(cal) };
  }

  root.DPFab = { STOCK_KINDS, cut1D, nest2D, checkLayout, planLine, stockQty, MOVES, materialStatus, STAGES, STAGE_LABEL, FLOW, gate, rankEngineers, weightOf, maintStatus, addDays };
})(typeof self !== "undefined" ? self : this);
