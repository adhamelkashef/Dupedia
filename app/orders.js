/* X FORCE 1.0 (Dupedia) — order operations: payments with evidence, engineering handover and production workflow,
   worker directory and teams, sales order tracking. One order record (orders/<oid>) is the source of truth; the other
   paths are role-specific views of it, each readable only by the people who need it (see store.js RULES):

     orders/<oid>                                full order incl. values, cost, payments          administrators
     orders/<oid>/handover/main                  non-financial handover pack (master)             administrators
     orders/<oid>/files/<fid>/c/<n>              payment receipts (chunked data, ≤180 kB/chunk)   administrators
     salesorders/<uid>/o/<oid> (+/f/<fid>/c/<n>) the sales owner's copy: values, payments, receipts — read-only
     paysub/<uid>/p/<id> (+/c/<n>)               payment reported by sales, awaiting verification
     handoff/<salesUid>/o/<oid>                  technical pack written by sales when the client accepts — no money   all staff
     assign/<oid>                                sales owner, engineer, original deadline — no money       all staff
     eng/<engineerUid>/o/<oid>                   status, progress, method, dates, sales-visible note       all staff read,
                                                                                                           engineer writes
     engx/<engineerUid>/o/<oid> (+/h/main, /f)   handover pack, team, suppliers, internal notes, files      engineer + admins
     workers/<wid> (+/pic/main)                  worker directory (no app access) and profile picture
     engx/<engineerUid>/wid/<wid>/c/<n>          National ID document copy for each engineer              that engineer + admins
     restricted/wid-<wid>/c/<n>                  National ID master copy                                  administrators

   Engineers never receive a document that contains prices, totals, discounts, payments, receipts, costs or commission. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth, NT = () => root.DPNotify;
  const now = () => new Date().toISOString();
  const me = () => AU().A.me || {};
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const reqAdmin = () => { if (!AU().isAdmin()) throw new Error("Administrators only."); };
  // 1.2: the Accountant records and verifies customer payments when the administrator allows it
  const reqPay = () => { if (AU().isAdmin()) return; if (root.DPFin && AU().isFinance && AU().isFinance() && root.DPFin.can("verifyCustomerPayments")) return; throw new Error("Administrators or authorised Finance users only."); };
  /** 1.2: a verified customer payment becomes exactly ONE incoming ledger transaction (linked to the order payment). */
  async function post(o, p, account) { if (!root.DPFin) return null; try { return await root.DPFin.postReceipt(o, p, { account }); } catch (e) { console.warn("ledger", e && e.message); return null; } }

  /* ---------------- files stored inside access-controlled documents ---------------- */
  const FILE_TYPES = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP", "application/pdf": "PDF" };
  const FILE_MAX = 6 * 1024 * 1024;
  /** Validate and prepare an upload: images are re-encoded (max 2000 px, JPEG) which also strips anything that is not an
   *  image; PDFs are checked for the %PDF header. Returns {name, type, size, dataUrl}. */
  async function prepareFile(file) {
    if (!file) throw new Error("Choose a file.");
    if (!FILE_TYPES[file.type]) throw new Error("Use a JPG, PNG, WebP image or a PDF.");
    if (file.size > FILE_MAX) throw new Error("The file is larger than 6 MB.");
    if (file.type === "application/pdf") {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer()); if (String.fromCharCode(...head) !== "%PDF-") throw new Error("This file is not a valid PDF.");
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      const out = { name: file.name, type: file.type, size: file.size, dataUrl }; out.hash = await hashOf(out); return out;
    }
    const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) throw new Error("This image could not be read.");
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const dataUrl = cv.toDataURL("image/jpeg", 0.85);
    const out = { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", size: Math.round(dataUrl.length * 0.75), dataUrl, w: cv.width, h: cv.height, original: { name: file.name, type: file.type, size: file.size } };
    out.hash = await hashOf(out); return out;
  }
  /** SHA-256 of the stored content: detects the same evidence uploaded twice. */
  async function hashOf(f) { try { const b = new TextEncoder().encode(f.dataUrl); const h = await crypto.subtle.digest("SHA-256", b); return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join(""); } catch (e) { return null; } }
  /** Store a file as ≤180 kB chunks and READ BACK the chunk count: a file is only reported as saved when every chunk is in the database
   *  (1.1 fix — an interrupted upload used to leave a payment that claimed evidence the administrator could never open). */
  async function putFile(base, f) {
    const parts = []; for (let i = 0; i < f.dataUrl.length; i += 180000) parts.push(f.dataUrl.slice(i, i + 180000));
    for (let i = 0; i < parts.length; i++) {
      const doc = { n: i, total: parts.length, part: parts[i], name: f.name, type: f.type, size: f.size, hash: f.hash || null };
      try { await DS().set(`${base}/c/${String(i).padStart(3, "0")}`, doc); }
      catch (e) { await new Promise((r) => setTimeout(r, 600)); await DS().set(`${base}/c/${String(i).padStart(3, "0")}`, doc); }   // one retry on a transient failure
    }
    const back = await DS().tryList(`${base}/c`);
    if (back.length < parts.length) { const err = new Error("The file did not upload completely. Check the connection and attach it again."); err.code = "upload_incomplete"; throw err; }
  }
  async function getFile(base) { const l = (await DS().tryList(`${base}/c`)).sort((a, b) => a.data.n - b.data.n); if (!l.length || l.length !== l[0].data.total) return null; return { name: l[0].data.name, type: l[0].data.type, size: l[0].data.size, dataUrl: l.map((x) => x.data.part).join("") }; }
  async function delFile(base) { for (const x of await DS().tryList(`${base}/c`)) await DS().del(`${base}/c/${x.id}`); }
  async function copyFile(from, to) { const f = await getFile(from); if (f) await putFile(to, f); return !!f; }

  /* ---------------- order views ---------------- */
  /** Sales owner's read-only copy of their order (values, payments incl. status, receipts). Written by administrators. */
  async function syncSalesView(oid) {
    const o = await DS().get(`orders/${oid}`); if (!o || !o.ownerId) return;
    const view = { oid, pid: o.pid, ref: o.ref, name: o.name, client: o.client, currency: o.currency, subtotalMinor: o.subtotalMinor, discountMinor: o.discountMinor, afterDiscountMinor: o.afterDiscountMinor,
      taxMinor: o.taxMinor, totalMinor: o.totalMinor, approvedAt: o.approvedAt, acceptedAt: o.acceptedAt || o.approvedAt, schedule: o.schedule || [], valueAdjustments: (o.valueAdjustments || []).map((a) => ({ amountMinor: a.amountMinor, reason: a.reason, at: a.at })), scheduleChanged: (o.scheduleHistory || []).length > 0, status: o.status, cancelReason: o.cancelReason || "",
      payments: (o.payments || []).map((p) => ({ id: p.id, date: p.date, amountMinor: p.amountMinor, method: p.method || "", ref: p.ref || "", notes: p.notes || "", status: p.status || "recorded", files: p.files || [], source: p.source || "admin", reportId: p.reportId || null })), updatedAt: now() };
    await DS().set(`salesorders/${o.ownerId}/o/${oid}`, view);
    for (const p of o.payments || []) for (const fid of p.files || []) { const to = `salesorders/${o.ownerId}/o/${oid}/f/${fid}`; if (!(await DS().tryList(`${to}/c`)).length) await copyFile(`orders/${oid}/files/${fid}`, to); }
  }
  async function mySalesOrders() { return (await DS().tryList(`salesorders/${me().id}/o`)).map((x) => Object.assign({ oid: x.id }, x.data)); }
  /** Receipt for display: administrators read the order copy, the sales owner their own copy. Engineers have neither. */
  async function receipt(oid, fid, ownerId) { return AU().isAdmin() ? getFile(`orders/${oid}/files/${fid}`) : getFile(`salesorders/${me().id}/o/${oid}/f/${fid}`); }

  /* ---------------- payments ---------------- */
  const PAY_METHODS = ["Bank transfer", "Cheque", "Cash", "Card", "Instapay", "Other"];
  const PAY_STATUS = { recorded: "Recorded — pending verification", submitted: "Pending verification", verified: "Verified (funds cleared)", rejected: "Rejected", accepted: "Added to the order" };
  const payMethods = () => { const s = (root.DPUI && root.DPUI.App.config.settings.paymentMethods) || null; return Array.isArray(s) && s.length ? s : PAY_METHODS; };
  /** Administrator records a payment. Recording is not verification: status stays "recorded" until verified. */
  async function recordPayment(oid, { date, amountMinor, method, ref, notes, files = [], verified = false, reportId = null, reportedBy = null, account = null }) {
    reqPay(); if (!date || !(amountMinor > 0)) throw new Error("Enter the date and an amount greater than zero.");
    const o = await DS().get(`orders/${oid}`); if (!o) throw new Error("Order not found."); if (o.status === "cancelled") throw new Error("The order is cancelled.");
    const pid = rid("pay-"), fids = [];
    const pays = (o.payments || []).filter((x) => x.status !== "rejected");
    const dupe = reportId ? pays.find((x) => x.reportId === reportId) : ref ? pays.find((x) => x.date === date && x.amountMinor === amountMinor && (x.ref || "") === ref) : null;
    if (dupe) throw new Error("This payment is already recorded on the order.");
    const hashes = new Set(pays.flatMap((x) => (x.fileMeta || []).map((m) => m.hash).filter(Boolean)));
    if (files.some((f) => f.hash && hashes.has(f.hash))) throw new Error("This proof file is already attached to another payment on this order.");
    const fileMeta = [];
    for (const f of files) { const fid = rid("f-"); await putFile(`orders/${oid}/files/${fid}`, f); fids.push(fid); fileMeta.push({ id: fid, name: f.name, type: f.type, size: f.size, hash: f.hash || null }); }
    const p = { id: pid, date, amountMinor, method: method || "", ref: ref || "", notes: notes || "", files: fids, fileMeta, status: verified ? "verified" : "recorded", at: now(), by: me().id, source: reportId ? "sales" : "admin", reportId: reportId || null, reportedBy: reportedBy || null };
    if (verified && !fids.length) throw new Error("Attach the payment proof to mark the payment as verified.");
    if (verified && !reportId && !AU().isAdmin() && (await root.DPFin.cfg()).sod) throw new Error("Separation of duties: record the payment, then another person verifies it.");
    if (verified) Object.assign(p, { verifiedAt: now(), verifiedBy: me().id });
    o.payments = (o.payments || []).concat([p]); o.history = (o.history || []).concat([{ at: now(), by: me().id, action: verified ? "Payment recorded and verified" : "Payment recorded", detail: `${date} · ${amountMinor / 100} · ${method || ""}` }]);
    await DS().set(`orders/${oid}`, o); await syncSalesView(oid);
    await AU().adminLog("Recorded client payment", { target: oid, detail: `${date} ${amountMinor / 100} ${method || ""} ${ref || ""}${fids.length ? ` · ${fids.length} attachment(s)` : ""}` });
    if (verified) await post(o, p, account);
    await paymentNotices(o, p); await root.DPSales.checkEligibility(oid);
    return p;
  }
  async function paymentNotices(o, p) {
    if (!NT()) return; const amt = root.DPPricing.fmtMoney(p.amountMinor, o.currency);
    await NT().deliver(o.ownerId, { id: `pay-${p.id}-${p.status}`, type: "payment", title: p.status === "verified" ? "Payment verified" : "Payment recorded", body: `${o.name}: ${amt} (${PAY_STATUS[p.status] || p.status}).`, link: { view: "tracking" }, ref: o.oid }).catch(() => {});
    await NT().deliver("@admins", { id: `pay-adm-${p.id}-${p.status}`, type: "payment", title: "Payment " + (p.status === "verified" ? "verified" : "recorded"), body: `${o.name}: ${amt}.`, link: { view: "payverify" }, ref: o.oid }).catch(() => {});
  }
  async function setPaymentStatus(oid, payId, status, note, { account = null } = {}) {
    reqPay(); if (!PAY_STATUS[status]) throw new Error("Unknown status."); if (status === "rejected" && !note) throw new Error("Give the reason.");
    const o = await DS().get(`orders/${oid}`), p = (o.payments || []).find((x) => x.id === payId); if (!p) throw new Error("Payment not found.");
    if (status === "verified") { if (!(p.files || []).length) throw new Error("This payment has no proof attached. Attach the evidence first — a payment is verified against its evidence.");
      for (const fid of p.files) if (!(await getFile(`orders/${oid}/files/${fid}`))) throw new Error("The payment proof cannot be opened (incomplete upload). Attach it again before verifying."); }
    if (status === "verified" && !AU().isAdmin() && p.by === me().id && p.source !== "sales" && (await root.DPFin.cfg()).sod) throw new Error("Separation of duties: you recorded this payment, so another person must verify it.");
    if (p.status === "verified" && status !== "verified" && !AU().isAdmin()) throw new Error("Only the administrator can change a verified payment.");
    p.statusHistory = (p.statusHistory || []).concat([{ from: p.status || "recorded", to: status, at: now(), by: me().id, note: note || "" }]);
    p.status = status; p.statusNote = note || ""; if (status === "verified") Object.assign(p, { verifiedAt: now(), verifiedBy: me().id }); if (status === "rejected") Object.assign(p, { rejectedAt: now(), rejectedBy: me().id });
    o.history = (o.history || []).concat([{ at: now(), by: me().id, action: `Payment ${status}`, detail: `${p.date} · ${p.amountMinor / 100}${note ? " · " + note : ""}` }]);
    await DS().set(`orders/${oid}`, o); await syncSalesView(oid);
    if (status === "verified") await post(o, p, account);
    await paymentNotices(o, p); await root.DPSales.checkEligibility(oid);
    await AU().adminLog(`Payment ${status}`, { target: oid, reason: note || "", detail: `${p.amountMinor / 100}` });
  }
  /** Administrator changes the payment terms. The original terms and every change (with its reason) are kept. */
  async function amendSchedule(oid, schedule, reason) {
    reqAdmin(); if (!reason || reason.trim().length < 5) throw new Error("Explain why the payment terms change.");
    const o = await DS().get(`orders/${oid}`); if (!o) throw new Error("Order not found.");
    const next = root.DPPay.normalise(schedule, { acceptDate: (o.acceptedAt || "").slice(0, 10), settings: root.DPUI && root.DPUI.App.config.settings });
    if (next.reduce((a, x) => a + (x.pct || 0), 0) > 100) throw new Error("The milestones add up to more than 100%.");
    const fixed = next.reduce((a, x) => a + (x.pct == null ? x.amountMinor || 0 : 0), 0), pctSum = next.reduce((a, x) => a + (x.pct || 0), 0);
    if (fixed + Math.round(root.DPPay.payableOf(o) * pctSum / 100) > root.DPPay.payableOf(o)) throw new Error("The milestones add up to more than the order value.");
    if (!o.scheduleOriginal) o.scheduleOriginal = (o.schedule || []).map((x) => Object.assign({}, x));
    o.scheduleHistory = (o.scheduleHistory || []).concat([{ at: now(), by: me().id, reason: reason.trim(), before: o.schedule || [], after: next }]);
    o.schedule = next; o.history = (o.history || []).concat([{ at: now(), by: me().id, action: "Payment terms changed", detail: reason.trim() }]);
    await DS().set(`orders/${oid}`, o); await syncSalesView(oid); await AU().adminLog("Payment terms changed", { target: oid, reason: reason.trim(), detail: next.map((x) => `${x.label} ${x.pct != null ? x.pct + "%" : x.amountMinor / 100} ${x.due || ""}`).join(" · ") });
    if (NT()) await NT().deliver(o.ownerId, { id: `terms-${oid}-${o.scheduleHistory.length}`, type: "payment", title: "Payment terms changed", body: `${o.name}: ${reason.trim()}`, link: { view: "proposals", opts: { oid } }, ref: oid }).catch(() => {});
    return o;
  }
  /** Administrator amends the confirmed order value (extra scope, approved discount, credit). Percentage milestones follow. */
  async function amendValue(oid, amountMinor, reason) {
    reqAdmin(); amountMinor = Math.round(+amountMinor); if (!amountMinor) throw new Error("Enter the amount of the change (negative for a reduction)."); if (!reason || reason.trim().length < 5) throw new Error("Explain the change.");
    const o = await DS().get(`orders/${oid}`); if (!o) throw new Error("Order not found.");
    if (root.DPPay.payableOf(o) + amountMinor < 0) throw new Error("The order value cannot become negative.");
    o.valueAdjustments = (o.valueAdjustments || []).concat([{ id: rid("va-"), amountMinor, reason: reason.trim(), at: now(), by: me().id }]);
    o.history = (o.history || []).concat([{ at: now(), by: me().id, action: "Order value amended", detail: `${amountMinor / 100} · ${reason.trim()}` }]);
    await DS().set(`orders/${oid}`, o); await syncSalesView(oid);
    await AU().adminLog("Order value amended", { target: oid, reason: reason.trim(), detail: `${amountMinor / 100}` });
    if (NT()) await NT().deliver("@admins", { id: `va-${oid}-${o.valueAdjustments.length}`, type: "order", title: "Order value amended — check the commission", body: `${o.name}: ${amountMinor > 0 ? "+" : ""}${amountMinor / 100}. The commission is not recalculated automatically; review it in Approve Commission.`, link: { view: "approvecomm" }, ref: oid }).catch(() => {});
    return o;
  }
  /** Administrator attaches (more) proof to a recorded payment. Evidence is never deleted. */
  async function attachPaymentFile(oid, payId, f) {
    reqPay(); const o = await DS().get(`orders/${oid}`), p = o && (o.payments || []).find((x) => x.id === payId); if (!p) throw new Error("Payment not found.");
    if (f.hash && (o.payments || []).some((x) => (x.fileMeta || []).some((m) => m.hash === f.hash))) throw new Error("This file is already attached to a payment on this order.");
    const fid = rid("f-"); await putFile(`orders/${oid}/files/${fid}`, f);
    p.files = (p.files || []).concat([fid]); p.fileMeta = (p.fileMeta || []).concat([{ id: fid, name: f.name, type: f.type, size: f.size, hash: f.hash || null }]);
    o.history = (o.history || []).concat([{ at: now(), by: me().id, action: "Payment proof attached", detail: `${p.date} · ${f.name}` }]);
    await DS().set(`orders/${oid}`, o); await syncSalesView(oid); await AU().adminLog("Payment proof attached", { target: oid, detail: f.name });
  }
  /** Sales owner reports a payment with evidence; an administrator verifies it into the order. */
  async function reportPayment(oid, { date, amountMinor, method, ref, notes, file }) {
    const uid = me().id; if (!date || !(amountMinor > 0)) throw new Error("Enter the date and an amount greater than zero.");
    let mine = await DS().tryGet(`salesorders/${uid}/o/${oid}`);
    if (!mine) { const sub = (await DS().tryList(`submissions/${uid}/s`)).map((x) => x.data).find((x) => x.oid === oid && x.status === "accepted"); if (sub) mine = { name: sub.name }; }
    if (!mine) throw new Error("This is not one of your orders.");
    // duplicate checks BEFORE anything is uploaded (1.1 fix: a refused duplicate used to leave orphaned file chunks)
    const mineReps = (await DS().tryList(`paysub/${uid}/p`)).map((x) => x.data).filter((x) => x.oid === oid && x.status !== "rejected");
    if (mineReps.some((x) => x.date === date && x.amountMinor === amountMinor && (x.ref || "") === (ref || ""))) throw new Error("You already reported this payment (same date, amount and reference).");
    if (file && file.hash && mineReps.some((x) => x.fileHash === file.hash)) throw new Error("This proof file is already attached to another payment on this order.");
    const id = rid("ps-"); if (file) await putFile(`paysub/${uid}/p/${id}`, file);
    await DS().set(`paysub/${uid}/p/${id}`, { oid, date, amountMinor, method: method || "", ref: ref || "", notes: notes || "", hasFile: !!file, fileName: file ? file.name : "", fileType: file ? file.type : "", fileSize: file ? file.size : 0, fileHash: file ? file.hash || null : null, at: now(), by: uid, status: "submitted" });
    if (NT()) await NT().deliver("@admins", { id: `paysub-${id}`, type: "payment", priority: "high", title: "Payment reported by sales — verification needed", body: `${mine.name}: please verify the reported payment and its evidence.`, link: { view: "payverify" }, ref: oid }).catch(() => {});
    return id;
  }
  async function listPaymentReports() { const ids = await root.DPLeads.uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`paysub/${u}/p`).then((x) => x.map((y) => Object.assign({ id: y.id, uid: u }, y.data))))); return l.flat().filter((x) => x.oid); }
  async function myPaymentReports() { return (await DS().tryList(`paysub/${me().id}/p`)).map((x) => Object.assign({ id: x.id }, x.data)).filter((x) => x.oid); }
  async function decidePaymentReport(rep, accept, { verified = false, note = "", account = null } = {}) {
    reqPay(); const base = `paysub/${rep.uid}/p/${rep.id}`;
    if (accept) { if (!(await DS().tryGet(`orders/${rep.oid}`)) && AU().isAdmin()) await intake(); if (!(await DS().tryGet(`orders/${rep.oid}`))) throw new Error("The order is not booked yet. Open the order once and try again.");
      const f = rep.hasFile ? await getFile(base) : null;
      if (rep.hasFile && !f) throw new Error("The payment proof cannot be read (the upload is incomplete). Reject the report and ask the salesperson to attach the file again.");
      if (verified && !f) throw new Error("There is no payment proof. A payment can only be verified against its evidence.");
      await recordPayment(rep.oid, { date: rep.date, amountMinor: rep.amountMinor, method: rep.method, ref: rep.ref, notes: (rep.notes ? rep.notes + " · " : "") + "Reported by " + (AU().nameSync(rep.uid) || "sales"), files: f ? [f] : [], verified, reportId: rep.id, reportedBy: rep.uid, account }); }
    else if (!note) throw new Error("Give the reason.");
    const cur = await DS().get(base); await DS().set(base, Object.assign({}, cur, { status: accept ? "accepted" : "rejected", decidedAt: now(), decidedBy: me().id, note }));
    if (NT()) await NT().deliver(rep.uid, { id: `paysub-dec-${rep.id}`, type: "payment", title: accept ? "Payment report accepted" : "Payment report rejected", body: accept ? "Your reported payment was added to the order." : `Reason: ${note}`, link: { view: "tracking" }, ref: rep.oid }).catch(() => {});
  }

  /* ---------------- engineering ---------------- */
  const ENG = [["review", "Awaiting Engineering Review"], ["assign", "Awaiting Production Assignment"], ["manufacturing", "Under Manufacturing"], ["outsourced", "Outsourced Manufacturing"],
    ["ready", "Ready for Installation"], ["installing", "Installation in Progress"], ["qc", "Quality Check"], ["completed", "Completed"], ["hold", "On Hold"], ["delayed", "Delayed / At Risk"], ["blocked", "Blocked / Issue Reported"]];
  const ENG_LABEL = Object.fromEntries(ENG);
  const EXPLAIN = ["hold", "delayed", "blocked"];   // these statuses need an explanation
  const METHODS = { inhouse: "In-House Factory", outsourced: "Outsourced Workshop", mixed: "Mixed (in-house and outsourced)" };
  const QC = { pending: "Not started", inprogress: "In progress", passed: "Passed", failed: "Failed — issues found", na: "Not applicable" };
  const QC_DEFAULT = ["Dimensions and quantities match the handover", "Finish and edges checked (no splinters, sharp edges)", "Fixings and anchors complete and tight", "Safety surfacing and clearance zones as on the plan", "Site cleaned and handed over", "Client walk-through done"];
  const ROLES = ["Project Engineer", "Fabrication Technician", "Welder", "Carpenter", "Painter", "Installation Supervisor", "Installer", "Electrician", "Civil Works Contractor", "Quality Inspector", "Driver", "Other"];
  /** Non-financial handover pack built from the project. Every price, total, discount and the commercial terms are removed. */
  function handoverFrom(project, order) {
    const p = JSON.parse(JSON.stringify(project));
    delete p.pricing; delete p.audit; delete p.review; p.meta = { name: p.meta.name, client: p.meta.client, location: p.meta.location, type: p.meta.type, ref: p.meta.ref, description: p.meta.description, date: p.meta.date, preparedBy: p.meta.preparedBy, id: p.meta.id };
    const pr = p.proposal || {}; p.proposal = { scope: pr.scope || "", installation: pr.installation || "", assumptions: pr.assumptions || "", exclusions: pr.exclusions || "", delivery: pr.delivery || "" };
    for (const o of p.objects || []) { delete o.price; delete o.unitPrice; delete o.cost; delete o.sell; }
    const items = root.DPModel.takeoff(project).filter((t) => t.kind === "product" || t.kind === "point" || t.kind === "line" || t.kind === "area")
      .map((t) => ({ key: t.key, code: t.displayCode || t.code || "", name: t.name, qty: t.qty, unit: t.unit, cat: t.cat }));
    return { oid: order.oid, ref: order.ref, name: order.name, client: order.client, location: order.location || p.meta.location || "", type: order.type || p.meta.type || "", items, project: p, at: now() };
  }
  /* ---------------- jobs: the engineering view of an order ----------------
     A job is assembled from the sales handoff (written at client acceptance), the administrator's assign/<oid> (once booked or
     assigned) and the engineer's own record eng/<uid>/o/<oid>. The engineer is the one an administrator assigned, otherwise the
     engineer who picked the order up from the queue. Nothing in a job carries money. */
  const JB = { list: [], at: 0 };
  async function listHandoffs() { const ids = await root.DPLeads.uids(); const l = await Promise.all(ids.map((u) => DS().tryList(`handoff/${u}/o`).then((x) => x.map((y) => Object.assign({ oid: y.id, salesUid: u }, y.data))))); return l.flat(); }
  async function listAssign() { return (await DS().tryList("assign")).map((x) => Object.assign({ oid: x.id }, x.data)); }
  const engineerUids = () => AU().A.directory.filter((r) => r.uid && AU().baseOf(r.role) === "engineer").map((r) => r.uid);
  async function engRecords() { const l = await Promise.all(engineerUids().map((u) => DS().tryList(`eng/${u}/o`).then((x) => x.map((y) => Object.assign({ oid: y.id, engineerUid: u }, y.data))))); return l.flat(); }
  async function listJobs() {
    const [hos, asg, recs] = await Promise.all([listHandoffs(), listAssign(), engRecords()]), by = {};
    for (const h of hos) by[h.oid] = { oid: h.oid, pid: h.pid, ref: h.ref, name: h.name, client: h.client, location: h.location, type: h.type, salesUid: h.salesUid, acceptedAt: h.acceptedAt, approvedAt: h.acceptedAt, deadlineOriginal: h.deadlineOriginal || null, priority: h.priority || "normal", status: h.status === "cancelled" ? "cancelled" : "open", source: "handoff", engineerUid: null, defaultEngineer: h.defaultEngineer || null, history: h.history || [] };
    for (const a of asg) by[a.oid] = Object.assign({}, by[a.oid] || {}, a, { deadlineOriginal: a.deadlineOriginal || (by[a.oid] || {}).deadlineOriginal || null, status: a.status === "cancelled" ? "cancelled" : "open", booked: true });
    for (const j of Object.values(by)) {
      if (!j.engineerUid) { const taken = recs.filter((r) => r.oid === j.oid && r.takenAt && !r.superseded).sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt))); if (taken[0]) { j.engineerUid = taken[0].engineerUid; j.via = taken[0].via === "default" ? "default" : "pickup"; } }
      else j.via = j.via || "admin";
      // 1.1: accepted orders go to the default engineer automatically (recorded on the handoff at acceptance)
      if (!j.engineerUid && j.defaultEngineer && j.status !== "cancelled") { j.engineerUid = j.defaultEngineer; j.via = "default"; }
      j.e = recs.find((r) => r.oid === j.oid && r.engineerUid === j.engineerUid && !r.superseded) || null;
      j.ds = deadlineStatus(j, j.e);
    }
    JB.list = Object.values(by); JB.at = Date.now();
    // the default engineer's own session creates their engineering record the first time it sees the assignment (idempotent: fixed path)
    if (me().role === "engineer") for (const j of JB.list.filter((x) => x.engineerUid === me().id && !x.e && x.via === "default" && x.status !== "cancelled")) {
      const rec = newEngRecord(j.oid, me().id, j.deadlineOriginal, "Assigned automatically (default engineer)", "default");
      if (!(await DS().tryGet(`eng/${me().id}/o/${j.oid}`))) { await DS().set(`eng/${me().id}/o/${j.oid}`, rec).catch(() => {}); if (!(await DS().tryGet(`engx/${me().id}/o/${j.oid}`))) await DS().set(`engx/${me().id}/o/${j.oid}`, { oid: j.oid, notes: [], team: [], teamHistory: [], suppliers: [], files: [] }).catch(() => {}); }
      j.e = rec; j.ds = deadlineStatus(j, j.e);
    }
    return JB.list;
  }
  function newEngRecord(oid, uid, dl, what, via) {
    return { oid, engineerUid: uid, takenAt: now(), via: via || null, status: "review", progress: 0, method: "", factory: { dest: "" }, startDate: null, expectedCompletion: dl || null, actualCompletion: null, installDate: null, installProgress: 0,
      qc: { status: "pending", checklist: QC_DEFAULT.map((t) => ({ item: t, ok: false, note: "" })) }, blockers: [], risk: "", riskReason: "", nextAction: "", salesNote: "", updatedAt: now(), updatedBy: uid,
      log: [{ at: now(), by: uid, what, status: "review", progress: 0 }], deadlineHistory: [] };
  }
  async function jobOf(oid) { const l = Date.now() - JB.at < 3000 ? JB.list : await listJobs(); return l.find((j) => j.oid === oid) || null; }
  /** Engineer picks an accepted order up from the queue (serialised with a lease, so two engineers cannot both take it). */
  async function takeJob(oid) {
    const uid = me().id; if (me().role !== "engineer" && !AU().isAdmin()) throw new Error("Only engineers pick up orders.");
    const lease = await DS().acquire(`locks/eng-${oid}`, { holder: uid, ttlMs: 6000 }); if (!lease || !lease.acquired) throw new Error("Another engineer is taking this order right now.");
    const j = await listJobs().then((l) => l.find((x) => x.oid === oid)); if (!j) throw new Error("Order not found."); if (j.status === "cancelled") throw new Error("This order is cancelled.");
    if (j.engineerUid && j.engineerUid !== uid) throw new Error(`Already taken by ${AU().nameSync(j.engineerUid)}.`); if (j.engineerUid === uid) return j;
    await DS().set(`eng/${uid}/o/${oid}`, { oid, engineerUid: uid, takenAt: now(), status: "review", progress: 0, method: "", factory: { dest: "" }, startDate: null, expectedCompletion: j.deadlineOriginal || null, actualCompletion: null, installDate: null, installProgress: 0,
      qc: { status: "pending", checklist: QC_DEFAULT.map((t) => ({ item: t, ok: false, note: "" })) }, blockers: [], risk: "", riskReason: "", nextAction: "", salesNote: "", updatedAt: now(), updatedBy: uid,
      log: [{ at: now(), by: uid, what: "Picked up from the engineering queue", status: "review", progress: 0 }], deadlineHistory: [] });
    if (!(await DS().tryGet(`engx/${uid}/o/${oid}`))) await DS().set(`engx/${uid}/o/${oid}`, { oid, notes: [], team: [], teamHistory: [], suppliers: [], files: [] });
    if (NT()) await NT().deliver([j.salesUid, "@admins"], { id: `eng-take-${oid}`, type: "engineering", title: "Engineer assigned", body: `${j.name}: ${me().name || "an engineer"} picked up the order.`, link: { view: "proposals", opts: { oid } }, ref: oid }).catch(() => {});
    JB.at = 0; return jobOf(oid);
  }
  /** Called by DPSales.approve (booking): engineering index for the order. Keeps an engineer who already picked it up. */
  async function onOrderApproved(order, project, { deadline = null, priority = "normal", contact = "" } = {}) {
    const hoPath = order.ownerId ? `handoff/${order.ownerId}/o/${order.oid}` : null, existing = hoPath ? await DS().tryGet(hoPath) : null;
    const ho = existing || Object.assign(handoverFrom(project, order), { contact: contact || "" });
    await DS().set(`orders/${order.oid}/handover/main`, ho);
    if (!existing && hoPath) await DS().set(hoPath, Object.assign({}, ho, { pid: order.pid, salesUid: order.ownerId, acceptedAt: order.acceptedAt || order.approvedAt, deadlineOriginal: deadline, priority, status: "accepted" })).catch(() => {});
    const taken = (await engRecords()).filter((r) => r.oid === order.oid && r.takenAt && !r.superseded).sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)))[0];
    const def = !taken && existing && existing.defaultEngineer ? existing.defaultEngineer : null, engUid = taken ? taken.engineerUid : def;
    const prevA = await DS().tryGet(`assign/${order.oid}`); if (prevA && prevA.engineerUid) { await syncSalesView(order.oid); JB.at = 0; return; }   // idempotent: never overwrite an existing assignment
    await DS().set(`assign/${order.oid}`, { oid: order.oid, pid: order.pid, ref: order.ref, name: order.name, client: order.client, location: ho.location, type: ho.type, salesUid: order.ownerId, engineerUid: engUid || null, priority,
      deadlineOriginal: deadline, approvedAt: order.approvedAt, acceptedAt: order.acceptedAt || order.approvedAt, createdAt: now(), status: engUid ? "assigned" : "unassigned", via: taken ? (taken.via === "default" ? "default" : "pickup") : def ? "default" : null,
      history: ((existing && existing.history) || []).concat([{ at: now(), by: me().id, action: taken ? `Order booked; engineer ${AU().nameSync(taken.engineerUid)}` : def ? `Order booked; default engineer ${AU().nameSync(def)}` : "Order booked; awaiting an engineer" }]) });
    await syncSalesView(order.oid);
    if (!engUid && NT()) await NT().deliver("@admins", { id: `eng-nodef-${order.oid}`, type: "engineering", title: "Order needs an engineer", body: `${order.name} is in the Unassigned Engineering Orders queue.`, link: { view: "engqueue" }, ref: order.oid }).catch(() => {});
    JB.at = 0;
  }
  /** ADMINISTRATOR SESSION — automatic booking of client-accepted orders. The client's acceptance (recorded by sales) already
   *  made the order Accepted and sent it to Engineering. Booking adds the financial record only administrators may see: the
   *  value recomputed from the saved project with the master price book, cost, payment schedule and the calculated commission.
   *  Runs whenever an administrator has X FORCE open (on entry and every minute); idempotent (one order per quotation). */
  let intakeBusy = null;
  async function intake() {
    if (!AU().isAdmin()) return [];
    if (intakeBusy) return intakeBusy;
    intakeBusy = (async () => {
      const subs = await root.DPSales.allSubmissions(), out = [], U = root.DPUI, App = U.App, M = root.DPModel, PR = root.DPPricing;
      for (const sub of subs.filter((s) => s.status === "accepted" && s.oid && !s.booked)) {
        try {
          if (await DS().tryGet(`orders/${sub.oid}`)) { await DS().set(`submissions/${sub.ownerId}/s/${sub.pid}`, Object.assign({}, sub, { booked: true })).catch(() => {}); continue; }
          const d = await DS().loadProject(sub.pid, sub.ownerId); if (!d) continue;
          const p = d.project, met = M.metrics(p);
          const r = PR.compute({ project: p, takeoff: M.takeoff(p), pricebook: App.config.pricebook, settings: App.config.settings, costs: App.costs, siteArea: met.siteArea, productCount: met.products });
          const lead = sub.leadId ? await DS().tryGet(`leads/${sub.leadId}`) : null;
          const res = await root.DPSales.approve(Object.assign({}, sub), { pricing: r, settings: App.config.settings, costMargin: r.margin, approved: {}, projectType: p.meta.type, orgType: (lead && lead.orgType) || "", project: p, auto: true });
          out.push(res.order.oid);
        } catch (e) { console.warn("intake", sub.oid, e); }
      }
      await syncIdDocs().catch((e) => console.warn("id docs", e));
      return out;
    })();
    try { return await intakeBusy; } finally { intakeBusy = null; }
  }
  /** Administrator: designate (or change) the engineer. Carries the engineering record over to the new engineer. */
  async function assignEngineer(oid, engUid, { reason = "", deadline } = {}) {
    reqAdmin(); const j = await listJobs().then((l) => l.find((x) => x.oid === oid)); if (!j) throw new Error("Order not found.");
    const r = AU().A.directory.find((x) => x.uid === engUid); if (!r || AU().baseOf(r.role) !== "engineer" || r.active === false) throw new Error("Choose an active engineer.");
    const a = (await DS().tryGet(`assign/${oid}`)) || { oid, pid: j.pid, ref: j.ref, name: j.name, client: j.client, location: j.location, type: j.type, salesUid: j.salesUid, priority: j.priority, deadlineOriginal: j.deadlineOriginal, approvedAt: j.acceptedAt, acceptedAt: j.acceptedAt, createdAt: now(), status: "unassigned", history: [] };
    const prev = j.engineerUid;
    if (prev && prev !== engUid) {
      const e = await DS().tryGet(`eng/${prev}/o/${oid}`), x = await DS().tryGet(`engx/${prev}/o/${oid}`);
      if (e) await DS().set(`eng/${engUid}/o/${oid}`, Object.assign({}, e, { engineerUid: engUid, takenAt: e.takenAt || now() })); if (x) await DS().set(`engx/${engUid}/o/${oid}`, x);
      for (const f of (x && x.files) || []) await copyFile(`engx/${prev}/o/${oid}/f/${f.id}`, `engx/${engUid}/o/${oid}/f/${f.id}`);
      if (e) await DS().set(`eng/${prev}/o/${oid}`, Object.assign({}, e, { reassignedTo: engUid, reassignedAt: now(), superseded: true }));
      else if (!(await DS().tryGet(`eng/${engUid}/o/${oid}`))) { await DS().set(`eng/${engUid}/o/${oid}`, newEngRecord(oid, engUid, deadline !== undefined ? deadline : a.deadlineOriginal, "Assigned by an administrator (replacing the default engineer)", "admin")); if (!x) await DS().set(`engx/${engUid}/o/${oid}`, { oid, notes: [], team: [], teamHistory: [], suppliers: [], files: [] }); }
    } else if (!(await DS().tryGet(`eng/${engUid}/o/${oid}`))) {
      const dl = deadline !== undefined ? deadline : a.deadlineOriginal;
      await DS().set(`eng/${engUid}/o/${oid}`, { oid, engineerUid: engUid, takenAt: now(), status: "review", progress: 0, method: "", factory: { dest: "" }, expectedCompletion: dl || null, actualCompletion: null, installDate: null, installProgress: 0,
        qc: { status: "pending", checklist: QC_DEFAULT.map((t) => ({ item: t, ok: false, note: "" })) }, blockers: [], risk: "", riskReason: "", nextAction: "", salesNote: "", updatedAt: now(), updatedBy: me().id,
        log: [{ at: now(), by: me().id, what: "Assigned by an administrator", status: "review", progress: 0 }], deadlineHistory: [] });
      await DS().set(`engx/${engUid}/o/${oid}`, { oid, notes: [], team: [], teamHistory: [], suppliers: [], files: [] });
    }
    const hist = (a.history || []).concat([{ at: now(), by: me().id, action: prev ? "Engineer changed" : "Engineer assigned", detail: `${prev ? AU().nameSync(prev) + " → " : ""}${AU().nameSync(engUid)}${reason ? " · " + reason : ""}` }]);
    await DS().set(`assign/${oid}`, Object.assign({}, a, { engineerUid: engUid, via: "admin", status: "assigned", assignedAt: now(), deadlineOriginal: deadline !== undefined && !a.deadlineOriginal ? deadline : a.deadlineOriginal, history: hist }));
    await AU().adminLog(prev ? "Changed order engineer" : "Assigned order engineer", { target: oid, reason, detail: AU().nameSync(engUid) });
    if (NT()) {
      await NT().deliver(engUid, { id: `eng-assign-${oid}-${engUid}`, type: "engineering", title: "New order assigned to you", body: `${a.name} (${a.ref}) — review the handover pack.`, link: { view: "engorders", opts: { oid } }, ref: oid });
      if (prev && prev !== engUid) await NT().deliver(prev, { id: `eng-unassign-${oid}-${Date.now().toString(36)}`, type: "engineering", title: "Order reassigned", body: `${a.name} was reassigned to another engineer.`, link: { view: "engorders" }, ref: oid });
      await NT().deliver(a.salesUid, { id: `eng-assigned-sales-${oid}-${engUid}`, type: "engineering", title: "Engineer assigned", body: `${a.name}: ${AU().nameSync(engUid)} is the project engineer.`, link: { view: "proposals", opts: { oid } }, ref: oid });
    }
    JB.at = 0;
  }
  async function setAssignField(oid, patch, reason) {
    reqAdmin(); const j = await jobOf(oid); const a = (await DS().tryGet(`assign/${oid}`)) || { oid, pid: j.pid, ref: j.ref, name: j.name, client: j.client, location: j.location, type: j.type, salesUid: j.salesUid, priority: j.priority, deadlineOriginal: j.deadlineOriginal, approvedAt: j.acceptedAt, engineerUid: j.engineerUid || null, createdAt: now(), status: j.engineerUid ? "assigned" : "unassigned", history: [] };
    await DS().set(`assign/${oid}`, Object.assign({}, a, patch, { history: (a.history || []).concat([{ at: now(), by: me().id, action: "Updated " + Object.keys(patch).join(", "), detail: reason || "" }]) }));
    const eu = a.engineerUid || (j && j.engineerUid);
    if (eu && patch.deadlineOriginal && NT()) await NT().deliver(eu, { id: `eng-dl-${oid}-${Date.now().toString(36)}`, type: "engineering", title: "Deadline changed", body: `${a.name}: required completion ${patch.deadlineOriginal}.`, link: { view: "engorders", opts: { oid } }, ref: oid });
    JB.at = 0;
  }
  async function engOf(a) { return a && a.engineerUid ? DS().tryGet(`eng/${a.engineerUid}/o/${a.oid}`) : null; }
  async function engxOf(a) { return a && a.engineerUid ? DS().tryGet(`engx/${a.engineerUid}/o/${a.oid}`) : null; }
  async function handoverOf(a) { return (a.salesUid ? await DS().tryGet(`handoff/${a.salesUid}/o/${a.oid}`) : null) || (AU().isAdmin() ? DS().tryGet(`orders/${a.oid}/handover/main`) : (a.engineerUid ? DS().tryGet(`engx/${a.engineerUid}/o/${a.oid}/h/main`) : null)); }
  const daysBetween = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);
  /** On Track / At Risk / Delayed from dates, progress, blockers and the engineer's own flag. A missing deadline is reported as
   *  missing information — never as a delay. */
  function deadlineStatus(a, e) {
    const today = new Date().toISOString().slice(0, 10), orig = a && a.deadlineOriginal, exp = (e && e.expectedCompletion) || orig;
    if (e && e.status === "completed") { const act = e.actualCompletion || today; return { key: orig && act > orig ? "late" : "done", label: orig && act > orig ? `Completed ${daysBetween(act, orig)} day(s) late` : "Completed", days: null }; }
    if (!exp) return { key: "none", label: "No deadline set (information missing)", days: null, missing: true };
    const days = daysBetween(exp, today), openBlock = ((e && e.blockers) || []).some((b) => !b.resolvedAt);
    if (days < 0 || (orig && exp > orig) || (e && (e.risk === "delayed" || e.status === "delayed"))) return { key: "delayed", label: "Delayed", days };
    const p = (e && e.progress) || 0, start = (a && (a.acceptedAt || a.approvedAt)) ? String(a.acceptedAt || a.approvedAt).slice(0, 10) : null, span = orig && start ? Math.max(1, daysBetween(orig, start)) : null;
    const behind = span ? (1 - Math.max(0, days) / span) * 100 - p > 35 : false;
    if ((e && (e.status === "blocked" || e.status === "hold" || e.risk === "atrisk")) || openBlock || (days <= 7 && p < 75) || behind) return { key: "atrisk", label: "At Risk", days };
    return { key: "ontrack", label: "On Track", days };
  }
  /** Engineer updates the order (only their own record). Validates consistency and notifies sales and administrators. */
  async function updateEng(oid, patch, { note = "", salesNote } = {}) {
    const uid = me().id, a = await listJobs().then((l) => l.find((x) => x.oid === oid)); if (!a) throw new Error("Order not found.");
    if (a.engineerUid !== uid && !AU().isAdmin()) throw new Error("This order is not assigned to you.");
    if (!a.engineerUid) throw new Error("Assign an engineer first.");
    const owner = a.engineerUid, path = `eng/${owner}/o/${oid}`, prev = (await DS().tryGet(path)) || { oid, engineerUid: owner, log: [], deadlineHistory: [] };
    const next = Object.assign({}, prev, patch, { updatedAt: now(), updatedBy: uid });
    if (patch.progress != null) { const v = +patch.progress; if (!(v >= 0 && v <= 100)) throw new Error("Progress must be between 0 and 100."); next.progress = Math.round(v); }
    if (patch.installProgress != null) { const v = +patch.installProgress; if (!(v >= 0 && v <= 100)) throw new Error("Installation progress must be between 0 and 100."); next.installProgress = Math.round(v); }
    if (patch.status && !ENG_LABEL[patch.status]) throw new Error("Unknown status.");
    if (EXPLAIN.includes(next.status) && patch.status && patch.status !== prev.status && !note) throw new Error(`Explain why the order is ${ENG_LABEL[next.status].toLowerCase()}.`);
    if (patch.risk && ["atrisk", "delayed"].includes(patch.risk) && !(note || patch.riskReason)) throw new Error("Explain why the order is at risk or delayed.");
    if (patch.status === "outsourced" && !(next.factory && next.factory.dest && next.factory.dest !== "inhouse")) throw new Error("Record the outsourced workshop in the Factory tab first.");
    if (next.status === "completed") {
      if (!next.actualCompletion) next.actualCompletion = new Date().toISOString().slice(0, 10);
      if (next.progress !== 100) { if (!note) throw new Error("A completed order is normally 100%. Explain the exception."); next.completionException = { note, at: now(), by: uid, approved: AU().isAdmin() ? { by: uid, at: now() } : null }; }
      if (next.qc && next.qc.status === "failed" && !note) throw new Error("Quality check failed: explain before completing.");
    }
    if (next.status !== "completed" && next.progress === 100 && patch.progress != null && prev.progress !== 100 && !note) throw new Error("Progress is 100% but the status is not Completed. Add a note.");
    if (patch.expectedCompletion && patch.expectedCompletion !== prev.expectedCompletion) {
      if (prev.expectedCompletion && !note) throw new Error("Explain the change of the target completion date.");
      next.deadlineHistory = (prev.deadlineHistory || []).concat([{ from: prev.expectedCompletion || null, to: patch.expectedCompletion, at: now(), by: uid, reason: note || "Target date set" }]);
    }
    if (salesNote !== undefined) next.salesNote = String(salesNote || "").slice(0, 600);
    const what = [patch.status && patch.status !== prev.status ? `Status → ${ENG_LABEL[patch.status]}` : "", patch.progress != null && +patch.progress !== prev.progress ? `Progress ${prev.progress || 0}% → ${next.progress}%` : "",
      patch.method && patch.method !== prev.method ? `Production: ${METHODS[patch.method]}` : "", patch.expectedCompletion && patch.expectedCompletion !== prev.expectedCompletion ? `Target completion ${patch.expectedCompletion}` : "",
      patch.installDate && patch.installDate !== prev.installDate ? `Installation date ${patch.installDate}` : "", patch.installProgress != null && +patch.installProgress !== (prev.installProgress || 0) ? `Installation ${next.installProgress}%` : "",
      patch.qc && (!prev.qc || patch.qc.status !== prev.qc.status) ? `Quality check: ${QC[patch.qc.status] || patch.qc.status}` : "",
      patch.risk !== undefined && patch.risk !== prev.risk ? `Deadline flag: ${patch.risk || "cleared"}` : "", patch.nextAction && patch.nextAction !== prev.nextAction ? `Next: ${patch.nextAction}` : ""].filter(Boolean).join(" · ");
    next.log = (prev.log || []).concat([{ at: now(), by: uid, what: what || "Updated", note: note || "", status: next.status, progress: next.progress }]).slice(-200);
    next.deadline = deadlineStatus(a, next);
    await DS().set(path, next); JB.at = 0;
    if (NT()) {
      const to = [a.salesUid, "@admins"], ds = next.deadline.key, prevDs = prev.deadline && prev.deadline.key;
      const material = (patch.status && patch.status !== prev.status) || (patch.progress != null && Math.abs(next.progress - (prev.progress || 0)) >= 10) || (ds !== prevDs && ["atrisk", "delayed"].includes(ds)) || (patch.expectedCompletion && patch.expectedCompletion !== prev.expectedCompletion) || (patch.qc && prev.qc && patch.qc.status !== prev.qc.status);
      if (material) {
        const title = next.status === "completed" && prev.status !== "completed" ? "Order completed" : next.status === "ready" && prev.status !== "ready" ? "Ready for installation" : ["atrisk", "delayed"].includes(ds) && ds !== prevDs ? (ds === "delayed" ? "Order delayed" : "Order at risk") : "Engineering update";
        await NT().deliver(to, { id: `eng-${oid}-${Date.parse(next.updatedAt)}`, type: "engineering", title, body: `${a.name}: ${what || "updated"}${next.salesNote ? ` — ${next.salesNote}` : ""}`, link: { view: "proposals", opts: { oid } }, ref: oid });
      }
    }
    // company wall (1.1): only milestones useful to everyone — a completed installation. Production steps and delays go to the
    // salesperson and the administrators as notifications, not to the wall.
    if (root.DPChat && patch.status === "completed" && prev.status !== "completed") await root.DPChat.system(`eng-done-${oid}`, "Milestone: an installation has been completed and handed over.", { view: "proposals", opts: { oid } }).catch(() => {});
    return next;
  }
  async function updateEngx(oid, fn, action) {
    const uid = me().id, a = await jobOf(oid); if (!a || (a.engineerUid !== uid && !AU().isAdmin())) throw new Error("This order is not assigned to you.");
    const path = `engx/${a.engineerUid}/o/${oid}`, prev = (await DS().tryGet(path)) || { oid, notes: [], team: [], teamHistory: [], suppliers: [], files: [] };
    const next = fn(JSON.parse(JSON.stringify(prev))); next.updatedAt = now(); next.updatedBy = uid; await DS().set(path, next); return next;
  }
  /** Add a worker (or a named person) to the order team; workers from the directory get the allocation on their own record. */
  async function addTeamMember(oid, m, { allowOverlap = false } = {}) {
    if (!m.name || !m.role) throw new Error("Give the name and the role.");
    const a = await jobOf(oid);
    if (m.wid) {
      const w = await DS().tryGet(`workers/${m.wid}`); if (!w) throw new Error("Worker not found."); if (w.active === false) throw new Error("This worker is inactive.");
      const clash = overlaps(w, oid, m.from, m.to); if (clash.length && !allowOverlap) throw Object.assign(new Error(`${w.name} is already allocated to ${clash.map((c) => c.name).join(", ")} in these dates.`), { code: "overlap", clash });
      await DS().set(`workers/${m.wid}`, Object.assign({}, w, { assignments: (w.assignments || []).concat([{ id: rid("as-"), oid, name: a.name, ref: a.ref, role: m.role, from: m.from || null, to: m.to || null, at: now(), by: me().id }]), updatedAt: now(), updatedBy: me().id }));
    }
    const out = await updateEngx(oid, (x) => { const e = Object.assign({ id: rid("tm-"), addedAt: now(), addedBy: me().id }, m); x.team = (x.team || []).concat([e]); x.teamHistory = (x.teamHistory || []).concat([{ at: now(), by: me().id, action: "Added", who: m.name, role: m.role, wid: m.wid || null }]); return x; });
    if (NT() && a.engineerUid && a.engineerUid !== me().id) await NT().deliver(a.engineerUid, { id: `team-${oid}-${Date.now().toString(36)}`, type: "engineering", title: "Team member added", body: `${a.name}: ${m.name} (${m.role}).`, link: { view: "engorders", opts: { oid } }, ref: oid }).catch(() => {});
    return out;
  }
  /** Removing someone keeps the history: the worker's allocation is closed (removedAt), never deleted. */
  async function removeTeamMember(oid, id, reason) {
    let removed = null;
    const out = await updateEngx(oid, (x) => { const t = (x.team || []).find((y) => y.id === id); if (!t) return x; removed = t; x.team = x.team.filter((y) => y.id !== id); x.teamHistory = (x.teamHistory || []).concat([{ at: now(), by: me().id, action: "Removed", who: t.name, role: t.role, wid: t.wid || null, reason: reason || "" }]); return x; });
    if (removed && removed.wid) { const w = await DS().tryGet(`workers/${removed.wid}`); if (w) await DS().set(`workers/${removed.wid}`, Object.assign({}, w, { assignments: (w.assignments || []).map((s) => (s.oid === oid && !s.removedAt ? Object.assign({}, s, { removedAt: now(), removedBy: me().id, removeReason: reason || "" }) : s)), updatedAt: now() })); }
    return out;
  }
  /** Date overlap with the worker's other open allocations (only when both have dates — otherwise there is not enough information). */
  function overlaps(w, oid, from, to) {
    if (!from) return []; const a1 = from, a2 = to || from;
    return (w.assignments || []).filter((s) => s.oid !== oid && !s.removedAt && s.from && (s.to || s.from) >= a1 && s.from <= a2);
  }
  async function addTechFile(oid, file) {
    const a = await jobOf(oid), f = await prepareFile(file), id = rid("tf-");
    await putFile(`engx/${a.engineerUid}/o/${oid}/f/${id}`, f);
    return updateEngx(oid, (x) => { x.files = (x.files || []).concat([{ id, name: f.name, type: f.type, size: f.size, at: now(), by: me().id }]); return x; });
  }
  async function techFile(a, id) { return getFile(`engx/${a.engineerUid}/o/${a.oid}/f/${id}`); }

  /* ---------------- worker directory ---------------- */
  const WORKER_TYPES = { employee: "Company Employee", outsourced: "Outsourced Worker" };
  async function listWorkers() { return (await DS().tryList("workers")).map((x) => Object.assign({ wid: x.id }, x.data)).sort((a, b) => a.name.localeCompare(b.name)); }
  const canWorkers = () => ["admin", "engineer"].includes(me().role) || AU().isAdmin();
  async function saveWorker(w) {
    if (!canWorkers()) throw new Error("Engineers and administrators manage workers.");
    if (!w.name || !String(w.name).trim()) throw new Error("Give the worker's full name.");
    if (w.phone && !/^[+()0-9\s-]{6,24}$/.test(w.phone)) throw new Error("The phone number has invalid characters.");
    const all = await listWorkers();
    if (w.phone && all.some((x) => x.wid !== w.wid && x.phone && x.phone.replace(/\D/g, "") === w.phone.replace(/\D/g, ""))) throw new Error("Another worker already has this phone number.");
    let wid = w.wid; if (!wid) { const have = new Set(all.map((x) => x.wid)); do { wid = "W-" + Math.random().toString(36).slice(2, 7).toUpperCase(); } while (have.has(wid)); }
    const prev = (await DS().tryGet(`workers/${wid}`)) || { createdAt: now(), createdBy: me().id, assignments: [] };
    const type = w.type || (w.external ? "outsourced" : "employee");
    const next = Object.assign({}, prev, { name: String(w.name).trim(), trade: w.trade || prev.trade || "Installer", type, external: type === "outsourced", company: w.company || "", phone: w.phone || "", notes: String(w.notes || "").slice(0, 1000), active: w.active !== false, updatedAt: now(), updatedBy: me().id });
    if (prev.active !== false && next.active === false) next.deactivatedAt = now();
    next.history = (prev.history || []).concat([{ at: now(), by: me().id, action: prev.name ? "Updated" : "Created" }]).slice(-60);
    await DS().set(`workers/${wid}`, next);
    return wid;
  }
  async function setWorkerPicture(wid, file) {
    if (!canWorkers()) throw new Error("Engineers and administrators manage workers.");
    const f = await prepareFile(file); if (f.type === "application/pdf") throw new Error("Use a JPG, PNG or WebP image.");
    const bmp = await createImageBitmap(await (await fetch(f.dataUrl)).blob()), k = Math.min(1, 256 / Math.min(bmp.width, bmp.height)), cv = document.createElement("canvas"), S = 256;
    cv.width = S; cv.height = S; const ctx = cv.getContext("2d"), sw = Math.min(bmp.width, bmp.height); ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sw) / 2, sw, sw, 0, 0, S, S); void k;
    await DS().set(`workers/${wid}/pic/main`, { dataUrl: cv.toDataURL("image/jpeg", 0.85), at: now(), by: me().id });
    const w = await DS().get(`workers/${wid}`); await DS().set(`workers/${wid}`, Object.assign({}, w, { hasPic: true, updatedAt: now() }));
  }
  async function workerPicture(wid) { const d = await DS().tryGet(`workers/${wid}/pic/main`); return d ? d.dataUrl : null; }
  /** National ID: private. Stored in the uploading engineer's private subtree and (by an administrator session) in the
   *  administrators' restricted area and every engineer's private subtree. Never on a public asset URL. The green tick on the
   *  worker means "a document is on file" — it is not a verification of the document. */
  async function uploadIdDoc(wid, file) {
    if (!canWorkers()) throw new Error("Engineers and administrators manage workers.");
    const f = await prepareFile(file), uid = me().id, w = await DS().get(`workers/${wid}`);
    if (AU().isAdmin()) { await delFile(`restricted/wid-${wid}`); await putFile(`restricted/wid-${wid}`, f); for (const e of engineerUids()) { await delFile(`engx/${e}/wid/${wid}`); await putFile(`engx/${e}/wid/${wid}`, f); } }
    else { await delFile(`engx/${uid}/wid/${wid}`); await putFile(`engx/${uid}/wid/${wid}`, f); }
    await DS().set(`workers/${wid}`, Object.assign({}, w, { idDoc: { uploaded: true, at: now(), by: uid, name: f.name, type: f.type, size: f.size, holder: uid, synced: AU().isAdmin() }, updatedAt: now(), history: (w.history || []).concat([{ at: now(), by: uid, action: "National ID document uploaded" }]).slice(-60) }));
  }
  async function idDoc(wid) { return AU().isAdmin() ? ((await getFile(`restricted/wid-${wid}`)) || null) : getFile(`engx/${me().id}/wid/${wid}`); }
  /** Administrator session: copy ID documents uploaded by an engineer to the restricted master and to every engineer. */
  async function syncIdDocs() {
    if (!AU().isAdmin()) return; const ws = await listWorkers(), engs = engineerUids();
    for (const w of ws.filter((x) => x.idDoc && x.idDoc.uploaded && !x.idDoc.synced)) {
      const src = w.idDoc.holder ? `engx/${w.idDoc.holder}/wid/${w.wid}` : null, f = src ? await getFile(src) : null; if (!f) continue;
      await delFile(`restricted/wid-${w.wid}`); await putFile(`restricted/wid-${w.wid}`, f);
      for (const e of engs) if (e !== w.idDoc.holder) { await delFile(`engx/${e}/wid/${w.wid}`); await putFile(`engx/${e}/wid/${w.wid}`, f); }
      await DS().set(`workers/${w.wid}`, Object.assign({}, w, { idDoc: Object.assign({}, w.idDoc, { synced: true, syncedAt: now() }) }));
    }
  }

  root.DPOrders = { FILE_TYPES, prepareFile, putFile, getFile, delFile, syncSalesView, mySalesOrders, receipt, PAY_METHODS, payMethods, PAY_STATUS, recordPayment, setPaymentStatus, attachPaymentFile, amendSchedule, amendValue, hashOf, reportPayment, listPaymentReports, myPaymentReports, decidePaymentReport,
    ENG, ENG_LABEL, EXPLAIN, METHODS, QC, QC_DEFAULT, ROLES, handoverFrom, listHandoffs, listAssign, listJobs, jobOf, takeJob, onOrderApproved, intake, assignEngineer, setAssignField, engOf, engxOf, handoverOf, deadlineStatus, updateEng, updateEngx,
    addTeamMember, removeTeamMember, overlaps, addTechFile, techFile, WORKER_TYPES, listWorkers, saveWorker, setWorkerPicture, workerPicture, uploadIdDoc, idDoc, syncIdDocs };
})(typeof self !== "undefined" ? self : this);
