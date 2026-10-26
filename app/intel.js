/* X FORCE 1.1 (Dupedia) — Market Intelligence data layer and the monthly Pricing Intelligence engine.

   mi/opps/o/<id>          opportunities (all staff read; administrators write)      ← research task (ops/intel.py) + people
   mi/state/jobs/<job>     automation health per job                                  ← research task / this app
   mi/req/r/<id>           "Run now" requests (queued → running → done/failed)       ← CEO; processed by the research task
   mi/runs/r/<id>          research history
   crm/<uid>/mi/<oppId>    a salesperson's update on an opportunity assigned to them (merged into mi by administrator sessions)
   mix/costmodel           product cost model (BOM-derived material lines; imported from the manufacturing cost workbook)
   mix/mat/m/<id>          materials with their price history (indicative / supplier quote / official index / actual purchase)
   mix/quotes/q/<id>(/c)   supplier quotation documents (chunked files)
   mix/fx/r/<YYYY-MM-DD>   exchange-rate snapshots, EGP per 1 unit of foreign currency
   mix/news/n/<id>         industry, shipping, customs and regulatory news (CEO)
   mix/reports/w/<week>    weekly market-position reports;  mix/reports/p/<YYYY-MM>  monthly pricing reports
   mix/* is readable by administrators only (costs, margins, prices, reports). */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, NT = () => root.DPNotify;
  const now = () => new Date().toISOString();
  const me = () => (AU() && AU().A.me) || {};
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const STATUS = [["new", "Newly Discovered"], ["review", "Under Review"], ["verified", "Evidence Verified"], ["qualified", "Qualified Opportunity"], ["assigned", "Assigned"], ["contacted", "Contacted"],
    ["proposal", "Proposal in Progress"], ["won", "Won"], ["lost", "Lost"], ["rejected", "Rejected"], ["expired", "Expired"]];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const CLOSED = ["won", "lost", "rejected", "expired"];
  const SALES_STATUSES = ["contacted", "proposal", "won", "lost"];
  const EVIDENCE = { verified: ["Evidence verified", "ok"], "single-source": ["Single source — confirm", "warn"], unverified: ["Unverified", "err"] };
  const JOBS = [["opportunities", "Daily Opportunity Discovery", "research"], ["news", "Market News Monitor", "research"], ["fx", "Currency Update", "research"], ["materials", "Material-Price Update", "research"],
    ["weekly", "Weekly Market Position Report", "research"], ["pricing", "Monthly Pricing Intelligence Report", "app"], ["overdue", "Overdue Payment Check", "sweep"], ["followups", "Follow-up Reminder Check", "sweep"], ["release", "Lead release (24-hour rule)", "sweep"]];
  const CURRENCIES = [["USD", "US Dollar"], ["CNY", "Chinese Yuan (RMB)"], ["EUR", "Euro"], ["AED", "UAE Dirham"], ["GBP", "British Pound"]];
  const PRICE_TYPES = { indicative: "Indicative market price", supplier_quote: "Supplier quotation", official_index: "Official index", purchase: "Actual Dupedia purchase price", estimate: "Model estimate" };

  /* ---------------- opportunities ---------------- */
  async function listOpps() {
    const db = DS().st.db; let rows = null;
    if (db && db.collection) { try { const s = await db.collection("mi/opps/o").orderBy("score", "desc").limit(400).get(); rows = s.docs.map((d) => Object.assign({ id: d.id }, d.data())); } catch (e) { rows = null; } }
    if (!rows) rows = (await DS().tryList("mi/opps/o")).map((x) => Object.assign({ id: x.id }, x.data));
    // salesperson overlays (crm/<uid>/mi/<oppId>) — mine for sales; everyone's for administrators
    const ids = AU().isAdmin() ? AU().A.directory.filter((r) => r.uid).map((r) => r.uid) : [me().id];
    const ov = (await Promise.all(ids.map((u) => DS().tryList(`crm/${u}/mi`).then((l) => l.map((x) => Object.assign({ uid: u, oppId: x.id }, x.data)))))).flat();
    for (const o of rows) { const v = ov.filter((x) => x.oppId === o.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]; if (v && (!o.updatedAt || v.at > o.updatedAt)) { o.salesUpdate = v; if (v.status && !CLOSED.includes(o.status)) o.statusShown = v.status; if (v.followUp) o.followUp = v.followUp; } }
    return rows;
  }
  const shownStatus = (o) => o.statusShown || o.status;
  async function getOpp(id) { const d = await DS().tryGet(`mi/opps/o/${id}`); return d ? Object.assign({ id }, d) : null; }
  /** Administrator change with full history. Evidence Verified / Qualified for a high-impact item records the approval. */
  async function updateOpp(id, patch, action, detail = "") {
    if (!AU().isAdmin()) throw new Error("Only administrators change opportunity records.");
    const o = await getOpp(id); if (!o) throw new Error("Opportunity not found.");
    if (patch.status === "verified" && o.evidence !== "verified" && !detail) throw new Error("Say how the evidence was verified (the source checked, call made, document seen).");
    const next = Object.assign({}, o, patch, { updatedAt: now(), updatedBy: me().id });
    if (patch.status === "verified") Object.assign(next, { evidence: "verified", evidenceNote: detail, verifiedBy: me().id, verifiedAt: now(), needsApproval: false });
    if (patch.status === "qualified" && o.needsApproval) Object.assign(next, { needsApproval: false, approvedBy: me().id, approvedAt: now() });
    next.history = (o.history || []).concat([{ at: now(), by: me().id, action, detail: String(detail || "").slice(0, 400) }]).slice(-120);
    delete next.id; delete next.salesUpdate; delete next.statusShown;
    await DS().set(`mi/opps/o/${id}`, next); return Object.assign({ id }, next);
  }
  async function setStatus(id, status, note) { return updateOpp(id, { status }, "Status: " + (STATUS_LABEL[status] || status), note); }
  async function assign(id, uid, { followUp = null, note = "" } = {}) {
    const o = await updateOpp(id, { assignedTo: uid, status: "assigned", followUp: followUp || null }, "Assigned to " + (AU().nameSync(uid) || uid), note);
    if (NT()) await NT().deliver(uid, { id: `mi-asg-${id}-${uid}`, type: "lead", priority: "high", title: "Market opportunity assigned to you", body: `${o.title}${followUp ? " — follow up by " + followUp : ""}`, link: { view: "intel", opts: { opp: id } } }).catch(() => {});
    return o;
  }
  async function setPriority(id, priority, reason) { if (!reason) throw new Error("Give the reason for the priority change."); return updateOpp(id, { priority, priorityManual: true }, `Priority set to ${priority}`, reason); }
  async function addNote(id, text) {
    text = String(text || "").trim().slice(0, 800); if (!text) throw new Error("Write the note.");
    if (AU().isAdmin()) { const o = await getOpp(id); return updateOpp(id, { notes: (o.notes || []).concat([{ at: now(), by: me().id, text }]).slice(-60) }, "Note added", text.slice(0, 120)); }
    return salesUpdate(id, { note: text });
  }
  /** Sales: update an opportunity assigned to them (status within the sales range, follow-up, note). Stored in their own crm subtree. */
  async function salesUpdate(id, { status = null, followUp = undefined, note = "" } = {}) {
    const o = await getOpp(id); if (!o) throw new Error("Opportunity not found."); if (o.assignedTo !== me().id) throw new Error("Only the assigned salesperson updates this opportunity.");
    if (status && !SALES_STATUSES.includes(status)) throw new Error("Choose Contacted, Proposal in Progress, Won or Lost.");
    const path = `crm/${me().id}/mi/${id}`, prev = (await DS().tryGet(path)) || { history: [] };
    const doc = Object.assign({}, prev, { at: now(), status: status || prev.status || null, note: note || prev.note || "", history: (prev.history || []).concat([{ at: now(), status: status || null, followUp: followUp === undefined ? null : followUp, note }]).slice(-60) });
    if (followUp !== undefined) doc.followUp = followUp;
    await DS().set(path, doc);
    if (NT()) await NT().deliver("@admins", { id: `mi-upd-${id}-${Date.now().toString(36)}`, type: "lead", title: "Opportunity update from sales", body: `${o.title}: ${status ? STATUS_LABEL[status] : "note"}${note ? " — " + note.slice(0, 100) : ""}`, link: { view: "intel", opts: { opp: id } } }).catch(() => {});
    return doc;
  }
  /** Administrator session: fold salespeople's updates into the opportunity records (history kept). */
  async function syncSalesUpdates() {
    if (!AU().isAdmin()) return 0; let n = 0;
    for (const r of AU().A.directory.filter((x) => x.uid)) for (const x of await DS().tryList(`crm/${r.uid}/mi`)) {
      const o = await getOpp(x.id); if (!o || o.assignedTo !== r.uid || (o.salesSyncedAt && o.salesSyncedAt >= x.data.at)) continue;
      const patch = { salesSyncedAt: x.data.at }; if (x.data.status && !CLOSED.includes(o.status)) patch.status = x.data.status; if (x.data.followUp !== undefined) patch.followUp = x.data.followUp;
      const last = (x.data.history || []).filter((h) => !o.salesSyncedAt || h.at > o.salesSyncedAt);
      const next = Object.assign({}, o, patch, { history: (o.history || []).concat(last.map((h) => ({ at: h.at, by: r.uid, action: h.status ? "Sales: " + STATUS_LABEL[h.status] : "Sales note", detail: h.note || (h.followUp ? "Follow-up " + h.followUp : "") }))).slice(-120) });
      delete next.id; await DS().set(`mi/opps/o/${x.id}`, next); n++;
    }
    return n;
  }
  /** Manual opportunity (e.g. heard at an exhibition). Stored as Newly Discovered and unverified unless a source is given. */
  async function addManual(v) {
    if (!AU().isAdmin()) throw new Error("Administrators add opportunities.");
    if (!v.title) throw new Error("Give a title.");
    const id = rid("op-m-"), src = /^https?:\/\//.test(v.sourceUrl || "") ? v.sourceUrl : null;
    const d = { title: v.title, organization: v.organization || "", location: v.location || "", category: v.category || "other", kind: v.kind || "project", description: v.description || "", products: [], sourceUrl: src, sourceOrg: v.sourceOrg || "",
      publishedAt: null, status: "new", evidence: src ? "single-source" : "unverified", evidenceNote: src ? "Added manually with a source; confirm independently" : "Added manually without a published source",
      needsApproval: false, score: null, scoreParts: [], priority: v.priority || "medium", sources: src ? [{ url: src, at: now() }] : [], discoveredAt: now(), lastChecked: now(), assignedTo: null, followUp: null, notes: [], unverified: [], claims: [],
      history: [{ at: now(), by: me().id, action: "Added manually", detail: v.note || "" }], manual: true };
    await DS().set(`mi/opps/o/${id}`, d); return Object.assign({ id }, d);
  }

  /* ---------------- automation ---------------- */
  async function jobsState() { return Object.fromEntries((await DS().tryList("mi/state/jobs")).map((x) => [x.id, x.data])); }
  async function requests() { return (await DS().tryList("mi/req/r")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  async function runs(limit = 40) { const l = (await DS().tryList("mi/runs/r")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.at).localeCompare(String(a.at))); return l.slice(0, limit); }
  /** CEO: request a research run. Never runs twice at once: a job already queued or running is not requested again.
   *  The request is picked up by the research task — started from here when the page can (connector), otherwise by the hourly server sweep. */
  async function requestRun(jobs) {
    if (!AU().isAdmin()) throw new Error("Administrators start research runs.");
    jobs = jobs.filter((j) => JOBS.some(([k, , t]) => k === j && t === "research")); if (!jobs.length) throw new Error("Choose a research job.");
    const open = (await requests()).filter((r) => ["queued", "running"].includes(r.status) && Date.now() - Date.parse(r.at) < 3 * 3600e3);
    const busy = jobs.filter((j) => open.some((r) => (r.jobs || []).includes(j))); const todo = jobs.filter((j) => !busy.includes(j));
    if (!todo.length) throw Object.assign(new Error(`Already queued or running: ${busy.map(jobLabel).join(", ")}.`), { code: "busy" });
    const id = rid("rq-"), doc = { jobs: todo, by: me().id, at: now(), status: "queued", started: null, via: null };
    await DS().set(`mi/req/r/${id}`, doc);
    const trig = ((root.DPUI && root.DPUI.App.config.settings.intel) || {}).triggerId || (((await schedule()).tasks || {}).research) || "";
    let fired = false, why = trig ? "" : "No research task is configured (Admin › Settings › Market Intelligence).";
    if (trig) {
      const mcp = await DS().capability("mcp");
      if (mcp) { try { await mcp.callTool("Claude Code Remote", "fire_trigger", { trigger_id: trig, text: `Process X FORCE research request ${id} (jobs: ${todo.join(", ")}).` }, { cache: false }); fired = true; }
        catch (e) { why = { not_in_manifest: "Starting the task from this page is not allowed for you.", approval_required: "Starting the task needs your approval in claude.ai.", server_not_connected: "The Claude Code Remote connector is not available to you.", needs_reauth: "Reconnect Claude Code Remote in claude.ai Settings." }[e && e.code] || `The task could not be started from here (${(e && e.code) || "error"}).`; } }
      else why = "This view cannot start the task directly.";
    }
    await DS().set(`mi/req/r/${id}`, Object.assign({}, doc, { via: fired ? "page" : null, fireNote: fired ? "" : why }));
    return { id, jobs: todo, skipped: busy, fired, why };
  }
  const jobLabel = (k) => (JOBS.find((j) => j[0] === k) || [k, k])[1];
  /** Schedules of the research jobs (mi/schedule, written when the scheduled tasks are set up): {jobs:{<job>:{label, cron}}, tasks:{…}}. */
  async function schedule() { return (await DS().tryGet("mi/schedule")) || { jobs: {} }; }
  /** Next run of a simple UTC cron "M H * * *" or "M H * * D[,D]" (the forms used by the X FORCE tasks). null when unknown. */
  function nextRun(cron, from = new Date()) {
    const m = String(cron || "").trim().split(/\s+/); if (m.length !== 5 || m[2] !== "*" || m[3] !== "*") return null;
    const mi = +m[0], hr = m[1] === "*" ? null : +m[1], dows = m[4] === "*" ? null : m[4].split(",").map(Number);
    if (!(mi >= 0 && mi < 60) || (hr != null && !(hr >= 0 && hr < 24))) return null;
    const t = new Date(from.getTime()); t.setUTCSeconds(0, 0);
    for (let i = 0; i < 8 * 24 * 60; i++) { t.setUTCMinutes(t.getUTCMinutes() + 1); if (t.getUTCMinutes() === mi && (hr == null || t.getUTCHours() === hr) && (!dows || dows.includes(t.getUTCDay()))) return t.toISOString(); }
    return null;
  }
  /** Health row for a job: last success, last attempt, status, counts, errors, next run. */
  function health(k, st, sweep, reqs, sched) {
    const sj = ((sched && sched.jobs) || {})[k] || null;
    const s = st[k] || {}, def = JOBS.find((j) => j[0] === k);
    if (def[2] === "sweep") { const lr = sweep && sweep.lastRun; return { job: k, label: def[1], kind: "hourly server sweep", lastSuccess: lr || null, lastAttempt: lr || null, status: lr ? (Date.now() - Date.parse(lr) < 3 * 3600e3 ? "ok" : "stale") : "unknown",
      next: lr ? new Date(Date.parse(lr) + 3600e3).toISOString() : null, created: k === "release" ? (sweep && sweep.lastReleases) : k === "followups" ? (sweep && sweep.lastReminders) : k === "overdue" ? (sweep && sweep.lastOverdue) : null, error: null, schedule: "Hourly at :28 UTC + every open session" }; }
    const q = (reqs || []).find((r) => (r.jobs || []).includes(k) && ["queued", "running"].includes(r.status));
    return { job: k, label: def[1], kind: def[2] === "app" ? "generated in the app" : "research task", lastSuccess: s.lastSuccess || null, lastAttempt: s.lastAttempt || null, status: q ? q.status : s.status || "never run", created: s.created, updated: s.updated, error: s.error || null,
      failures: s.failures || 0, next: sj && sj.cron ? nextRun(sj.cron) : null, schedule: sj ? sj.label : def[2] === "app" ? "On demand (Generate)" : "Not scheduled — Run now", notes: s.notes || [] };
  }

  /* ---------------- currency ---------------- */
  async function fxSnapshots() { return (await DS().tryList("mix/fx/r")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => a.id.localeCompare(b.id)); }
  /** Latest valid rate per currency (never a held-for-review value), with its age and movement over saved history. */
  function fxView(snaps, staleHours = 36) {
    const out = {};
    for (const [code, name] of CURRENCIES) {
      const hist = snaps.map((s) => s.rates && s.rates[code] ? Object.assign({ date: s.id }, s.rates[code]) : null).filter((r) => r && r.status === "ok");
      const cur = hist[hist.length - 1] || null, prev = hist[hist.length - 2] || null, held = snaps.length && snaps[snaps.length - 1].rates && snaps[snaps.length - 1].rates[code] && snaps[snaps.length - 1].rates[code].status === "review" ? snaps[snaps.length - 1].rates[code] : null;
      const back = (days) => { if (!cur) return null; const t = Date.parse(cur.date) - days * 864e5; const r = hist.filter((h) => Date.parse(h.date) <= t).pop(); return r ? cur.egpPer / r.egpPer - 1 : null; };
      const ageH = cur ? (Date.now() - Date.parse(cur.retrievedAt || cur.date)) / 3600e3 : null;
      out[code] = { code, name, cur, prev, held, ch1: prev ? cur.egpPer / prev.egpPer - 1 : null, ch7: back(7), ch30: back(30), ageH, stale: cur ? ageH > staleHours : true, history: hist.slice(-60) };
    }
    return out;
  }

  /* ---------------- materials and cost model ---------------- */
  async function materials() { return (await DS().tryList("mix/mat/m")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(a.group).localeCompare(String(b.group)) || String(a.id).localeCompare(String(b.id))); }
  async function costModel() { return DS().tryGet("mix/costmodel"); }
  const latestPrice = (m) => { const l = (m.prices || []).filter((p) => p.status === "ok"); return l[l.length - 1] || null; };
  function matView(m, { staleDays = 45, quoteDays = 30 } = {}) {
    const ok = (m.prices || []).filter((p) => p.status === "ok"), cur = ok[ok.length - 1] || null, prev = ok[ok.length - 2] || null;
    const age = cur ? (Date.now() - Date.parse(cur.publishedAt || cur.retrievedAt)) / 864e5 : null;
    const quoteExpired = cur && cur.type === "supplier_quote" && cur.validUntil && cur.validUntil < new Date().toISOString().slice(0, 10);
    return { cur, prev, ch: cur && prev ? cur.egpPerUnit / prev.egpPerUnit - 1 : null, age, stale: !cur || age > staleDays, noSource: cur && !cur.url && !cur.quoteId, quoteExpired, held: (m.prices || []).filter((p) => p.status === "review").pop() || null };
  }
  /** Administrator records a verified price: an actual purchase, a supplier quotation (with its document and validity), or an index value. */
  async function addPrice(mid, v) {
    if (!AU().isAdmin()) throw new Error("Administrators record material prices.");
    const m = await DS().tryGet(`mix/mat/m/${mid}`); if (!m) throw new Error("Material not found.");
    const price = +v.price; if (!(price > 0)) throw new Error("Enter the price."); if (!PRICE_TYPES[v.type] || v.type === "estimate") throw new Error("Choose the price type.");
    if (v.type === "supplier_quote" && !v.supplier) throw new Error("Name the supplier."); if (!v.date) throw new Error("Enter the quotation or purchase date.");
    let qid = null; if (v.file) { qid = rid("q-"); await root.DPOrders.putFile(`mix/quotes/q/${qid}`, v.file); await DS().set(`mix/quotes/q/${qid}`, { mid, supplier: v.supplier || "", date: v.date, validUntil: v.validUntil || null, name: v.file.name, type: v.file.type, size: v.file.size, by: me().id, at: now() }); }
    const fx = v.currency && v.currency !== "EGP" ? +v.fx : 1; if (v.currency && v.currency !== "EGP" && !(fx > 0)) throw new Error("Give the exchange rate used (EGP per 1 " + v.currency + ").");
    const ok = (m.prices || []).filter((p) => p.status === "ok"), prev = ok[ok.length - 1];
    const rec = { egpPerUnit: Math.round(price * fx * 10000) / 10000, price, currency: v.currency || "EGP", unit: m.unit, type: v.type, source: v.supplier || v.source || "", supplier: v.supplier || "", url: v.url || null, quoteId: qid,
      publishedAt: v.date, validUntil: v.validUntil || null, retrievedAt: now(), by: me().id, status: "ok", confidence: v.type === "purchase" ? "high" : v.type === "supplier_quote" ? "high" : "medium", note: v.note || "" };
    if (prev && prev.egpPerUnit) rec.changePct = Math.round((rec.egpPerUnit / prev.egpPerUnit - 1) * 10000) / 100;
    await DS().set(`mix/mat/m/${mid}`, Object.assign({}, m, { prices: (m.prices || []).concat([rec]).slice(-60), updatedAt: now() }));
    await AU().adminLog("Material price recorded", { target: mid, detail: `${PRICE_TYPES[v.type]} ${rec.egpPerUnit} EGP/${m.unit}${v.supplier ? " · " + v.supplier : ""}` });
    return rec;
  }
  async function quoteFile(qid) { return root.DPOrders.getFile(`mix/quotes/q/${qid}`); }

  /* ---------------- monthly pricing engine (pure) ---------------- */
  /** Product-level pricing assessment. Inputs: price book (selling prices), recorded costs (price book cost column), the cost model
   *  (BOM-derived material lines at the model's base prices), current material prices and exchange rates.
   *  Estimated cost = recorded cost (or model cost when none is recorded) + Σ material line × (current price / model base price − 1).
   *  Imported benchmark materials without a newer price move with the USD rate (model base EGP 55 / USD). Nothing is changed. */
  function pricingReport({ pricebook, costs, model, mats, fx, targetMargin = 0.4, staleDays = 45, month, names = {} }) {
    const items = (pricebook && pricebook.items) || {}, mm = Object.fromEntries((mats || []).map((m) => [m.id, m])), prods = (model && model.products) || {}, mdef = (model && model.materials) || {};
    const fxBase = (model && model.source && model.source.fxBaseEgpPerUsd) || 55, usdNow = fx && fx.USD && fx.USD.cur ? fx.USD.cur.egpPer : null;
    const codes = Array.from(new Set(Object.keys(items).filter((k) => !k.startsWith("el:")).concat(Object.keys(prods)))).sort();
    const rows = [];
    for (const code of codes) {
      const sell = items[code] && items[code].sell != null && items[code].sell !== "" ? +items[code].sell : null, rec = costs && costs[code] != null && costs[code] !== "" ? +costs[code] : null, p = prods[code];
      const gaps = [], reasons = [];
      if (sell == null) gaps.push("No selling price in the price book");
      if (rec == null && !p) gaps.push("No cost data (no recorded cost and not in the cost model)");
      if (!p) gaps.push("No bill of materials — material and currency movements cannot be applied");
      const base = rec != null ? rec : p ? p.mfgCost : null, basis = rec != null ? "recorded" : p ? "model" : null;
      let delta = 0, covered = 0, matTotal = 0, staleShare = 0, fxShare = 0; const drivers = [];
      if (p && base != null) {
        const scale = rec != null && p.mfgCost ? rec / p.mfgCost : 1;   // apply movements in proportion when the recorded cost differs from the model
        for (const [mid, lineCost] of Object.entries(p.lines || {})) {
          const md = mdef[mid] || {}, m = mm[mid], cur = m ? latestPrice(m) : null, baseP = md.base; matTotal += lineCost;
          let ratio = 1, why = null;
          if (cur && baseP && cur.type !== "estimate") { ratio = cur.egpPerUnit / baseP; why = `${mid} ${cur.type === "supplier_quote" ? "quote" : cur.type === "purchase" ? "purchase" : "market"} ${Math.round(cur.egpPerUnit * 100) / 100} vs model ${baseP} EGP/${md.unit}`; covered += lineCost;
            const age = (Date.now() - Date.parse(cur.publishedAt || cur.retrievedAt)) / 864e5; if (age > staleDays) staleShare += lineCost; }
          else if (md.usd && usdNow) { ratio = usdNow / fxBase; why = `${mid} imported: USD ${usdNow.toFixed(2)} vs model ${fxBase}`; fxShare += lineCost; covered += lineCost; }
          else staleShare += lineCost;
          const d = lineCost * (ratio - 1) * scale; delta += d; if (why && Math.abs(d) >= 1) drivers.push({ mid, d: Math.round(d), why });
        }
      }
      const est = base != null ? base + delta : null, moveP = base ? (est - base) / base : null;
      const mBefore = sell && base != null ? (sell - base) / sell : null, mAfter = sell && est != null ? (sell - est) / sell : null;
      const coverage = matTotal ? covered / matTotal : 0, staleFrac = matTotal ? staleShare / matTotal : 1;
      let conf = basis === "recorded" ? "medium" : basis === "model" ? "low" : "none"; if (basis && coverage > 0.6 && staleFrac < 0.3 && basis === "recorded") conf = "medium-high";
      if (basis === "model") reasons.push("Cost is the should-cost model estimate, not a verified actual cost");
      if (staleFrac > 0.5 && p) { gaps.push(`${Math.round(staleFrac * 100)}% of material cost has no recent price`); }
      let rec_ = "review", range = null;
      const t = targetMargin, need = est != null ? est / (1 - t) : null;
      if (sell == null || est == null) rec_ = sell == null ? "set-price" : "request-quotes";
      else if (staleFrac > 0.7 && basis === "model") rec_ = "request-quotes";
      else if (mAfter >= t + 0.03) rec_ = "maintain";
      else if (mAfter >= t - 0.03) rec_ = "review";
      else if (mAfter >= t - 0.10) { rec_ = "increase"; range = [Math.ceil(est / (1 - (t - 0.02)) / 50) * 50, Math.ceil(need / 50) * 50]; }
      else { rec_ = "urgent"; range = [Math.ceil(est / (1 - (t - 0.02)) / 50) * 50, Math.ceil(need / 50) * 50]; }
      if (mAfter != null) reasons.push(`Margin ${Math.round(mBefore * 1000) / 10}% → ${Math.round(mAfter * 1000) / 10}% after cost movements (target ${Math.round(t * 100)}%)`);
      if (moveP) reasons.push(`Estimated cost ${moveP > 0 ? "+" : ""}${Math.round(moveP * 1000) / 10}% (${drivers.length} driver${drivers.length === 1 ? "" : "s"})`);
      if (p && p.confidence) reasons.push(`Cost model confidence: ${p.confidence}`);
      rows.push({ code, name: (p && p.name) || names[code] || code, sell, recorded: rec, modelCost: p ? p.mfgCost : null, basis, estCost: est != null ? Math.round(est) : null, movePct: moveP, marginBefore: mBefore, marginAfter: mAfter,
        recommendation: rec_, range, drivers: drivers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6), coverage, staleFrac, confidence: conf, gaps, reasons });
    }
    const next = (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); })();
    const sum = (k) => rows.filter((r) => r.recommendation === k).length;
    return { id: month, month, createdAt: now(), createdBy: me().id || null, targetMargin, fx: usdNow ? { USD: usdNow, fxBase } : { USD: null, fxBase }, effectiveSuggested: next,
      summary: { products: rows.length, maintain: sum("maintain"), review: sum("review"), increase: sum("increase"), urgent: sum("urgent"), quotes: sum("request-quotes"), setPrice: sum("set-price"), recordedCosts: rows.filter((r) => r.basis === "recorded").length, modelOnly: rows.filter((r) => r.basis === "model").length },
      method: "Estimated cost = recorded cost (or the should-cost model when no cost is recorded) + Σ each material line × (current price ÷ model base price − 1). Imported benchmark materials without a newer price move with the USD rate. Recommendations compare the margin after cost movements with the target margin: ≥ target+3 pts maintain; ±3 pts review; up to −10 pts consider a modest increase (range to restore target−2 to target); below that recalculate urgently. Missing prices or stale material data lead to requesting quotes. Nothing is applied automatically.",
      rows };
  }
  const REC = { maintain: ["Maintain current price", "ok"], review: ["Review price", "info"], increase: ["Consider a modest increase", "warn"], urgent: ["Recalculate price urgently", "err"], "request-quotes": ["Request updated supplier quotes", "warn"], "set-price": ["Set a selling price", "warn"], spec: ["Review material specification", "info"], margin: ["Review target margin", "info"] };
  async function savePricingReport(rep) { if (!AU().isAdmin()) throw new Error("Administrators only."); const prev = await DS().tryGet(`mix/reports/p/${rep.id}`); const doc = Object.assign({}, rep, { revision: prev ? (prev.revision || 1) + 1 : 1 }); await DS().set(`mix/reports/p/${rep.id}`, doc);
    await DS().set("mi/state/jobs/pricing", { job: "pricing", label: "Monthly Pricing Intelligence Report", lastAttempt: now(), lastSuccess: now(), status: "ok", created: prev ? 0 : 1, updated: prev ? 1 : 0, schedule: "Monthly — first administrator session of the month; Generate any time", notes: [`${rep.summary.products} products assessed`], error: null }); return doc; }
  async function reports(kind) { return (await DS().tryList(`mix/reports/${kind}`)).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => b.id.localeCompare(a.id)); }
  async function news() { return (await DS().tryList("mix/news/n")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(b.publishedAt || b.discoveredAt).localeCompare(String(a.publishedAt || a.discoveredAt))); }
  async function setNewsStatus(id, status) { const d = await DS().tryGet(`mix/news/n/${id}`); if (!d) return; await DS().set(`mix/news/n/${id}`, Object.assign({}, d, { status, statusBy: me().id, statusAt: now() })); }

  root.DPIntel = { STATUS, STATUS_LABEL, CLOSED, SALES_STATUSES, EVIDENCE, JOBS, CURRENCIES, PRICE_TYPES, REC, listOpps, shownStatus, getOpp, updateOpp, setStatus, assign, setPriority, addNote, salesUpdate, syncSalesUpdates, addManual,
    jobsState, requests, runs, requestRun, jobLabel, health, schedule, nextRun, fxSnapshots, fxView, materials, costModel, latestPrice, matView, addPrice, quoteFile, pricingReport, savePricingReport, reports, news, setNewsStatus };
  if (typeof module !== "undefined") module.exports = root.DPIntel;
})(typeof self !== "undefined" ? self : this);
