/* X FORCE 1.1 (Dupedia) — payment evidence viewer, Payment Verification queue, payment position panel, payment-term and
   order-value amendments, overdue-payment reminders.

   Evidence is read from rule-protected database documents (orders/<oid>/files, paysub/<uid>/p/<id>, submissions/…/ev):
   there is no public URL to guess. The viewer renders images with zoom and PDFs page by page with the bundled PDF reader,
   so an administrator can inspect the proof without downloading it (1.0 could only download PDFs). */
/* global DPUI, DPShell, DPStore, DPAuth, DPSales, DPOrders, DPPricing, DPPay, DPNotify, DPIO */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, O = DPOrders;
  const kB = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " kB");
  function bytesOf(dataUrl) { const b = atob(String(dataUrl).split(",")[1] || ""), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

  /* ---------------- viewer ---------------- */
  /** Mount a zoomable viewer for a stored file into `box`. Resolves {ok, error}. */
  async function mountViewer(box, f) {
    if (!f || !f.dataUrl) { box.innerHTML = `<div class="note err">The file is not available: it is missing or its upload is incomplete.</div>`; return { ok: false, error: "missing" }; }
    const isPdf = f.type === "application/pdf" || /^data:application\/pdf/.test(f.dataUrl);
    box.innerHTML = `<div class="fv"><div class="fv-bar row"><button class="btn ghost xs" data-z="-">−</button><button class="btn ghost xs" data-z="fit">Fit</button><button class="btn ghost xs" data-z="1">100%</button><button class="btn ghost xs" data-z="+">+</button><span class="tiny muted" data-zl></span><span class="tiny muted" style="margin-left:auto">${esc(f.name || "file")} · ${esc(isPdf ? "PDF" : "Image")} · ${esc(kB(f.size || f.dataUrl.length * 0.75))}</span></div>
      <div class="fv-stage" tabindex="0" aria-label="Document preview"><div class="fv-in"><div class="empty small"><div class="spinner"></div>Opening…</div></div></div></div>`;
    const stage = $(".fv-stage", box), inner = $(".fv-in", box), lab = $("[data-zl]", box); let z = "fit", natural = [1, 1];
    const apply = () => { const fit = Math.min(1, (stage.clientWidth - 16) / natural[0]); const k = z === "fit" ? fit : z; $$(".fv-pg", inner).forEach((el) => { el.style.width = Math.round((el.dataset.w || natural[0]) * k) + "px"; }); lab.textContent = Math.round(k * 100) + "%"; };
    $$("[data-z]", box).forEach((b) => (b.onclick = () => { const v = b.dataset.z, cur = z === "fit" ? Math.min(1, (stage.clientWidth - 16) / natural[0]) : z; z = v === "fit" ? "fit" : v === "1" ? 1 : Math.max(0.1, Math.min(6, cur * (v === "+" ? 1.25 : 0.8))); apply(); }));
    stage.addEventListener("keydown", (e) => { if (e.key === "+" || e.key === "=") $("[data-z='+']", box).click(); if (e.key === "-") $("[data-z='-']", box).click(); });
    try {
      if (!isPdf) {
        const img = new Image(); img.className = "fv-pg"; img.alt = "Document"; img.src = f.dataUrl;
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("The image cannot be displayed (damaged file).")); });
        natural = [img.naturalWidth, img.naturalHeight]; img.dataset.w = img.naturalWidth; inner.innerHTML = ""; inner.appendChild(img);
      } else {
        const pdfjs = await DPIO.pdfReader(), doc = await pdfjs.getDocument({ data: bytesOf(f.dataUrl), isEvalSupported: false, disableFontFace: true }).promise;
        inner.innerHTML = ""; const n = Math.min(doc.numPages, 12);
        for (let i = 1; i <= n; i++) { const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 }), cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; cv.className = "fv-pg"; cv.dataset.w = Math.round(vp.width / 2);
          const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); await page.render({ canvasContext: ctx, viewport: vp }).promise; inner.appendChild(cv); if (i === 1) natural = [vp.width / 2, vp.height / 2]; }
        if (doc.numPages > n) inner.insertAdjacentHTML("beforeend", `<p class="tiny muted">Showing the first ${n} of ${doc.numPages} pages — download the file to see the rest.</p>`);
      }
      apply(); return { ok: true };
    } catch (e) { inner.innerHTML = `<div class="note err">${esc(e.message && !/^\w+Exception/.test(e.name || "") ? e.message : "The document cannot be displayed. It may be damaged or password-protected — download it to check.")}</div>`; return { ok: false, error: "render" }; }
  }
  /** Full-screen viewer (replaces the 1.0 viewer that could only download PDFs). */
  function showFile(f, kind = "Payment evidence") {
    if (!f) return U.toast("The file is not available: it is missing or its upload is incomplete.", { err: true, ms: 6000 });
    U.openModal(`<div class="row between"><div><span class="eyebrow">${esc(kind)}</span><h2>${esc(f.name || "Document")}</h2></div><button class="btn ghost sm" id="sf-dl">${U.svg("export")} Download</button></div>
      <div id="sf-v"></div><div class="acts"><button class="btn ghost" id="sf-x">Close</button></div>`, (m) => {
      $("#sf-x", m).onclick = () => U.closeModal(); mountViewer($("#sf-v", m), f);
      $("#sf-dl", m).onclick = () => U.downloadOut({ blob: new Blob([bytesOf(f.dataUrl)], { type: f.type || "application/octet-stream" }), filename: f.name || "document" }, kind); }, { wide: true });
  }

  /* ---------------- verification queue ---------------- */
  /** Everything waiting for a verification decision: sales-reported payments not yet on the order, and order payments still
   *  "recorded". Each item knows how to load its evidence. */
  async function queue() {
    const [reps, orders, subs] = await Promise.all([O.listPaymentReports(), DPSales.listOrders(), DPSales.allSubmissions()]);
    const items = [];
    for (const r of reps.filter((x) => x.status === "submitted")) {
      const o = orders.find((x) => x.oid === r.oid), s = subs.find((x) => x.oid === r.oid);
      items.push({ kind: "report", key: "r:" + r.uid + ":" + r.id, oid: r.oid, ref: (o && o.ref) || (s && s.ref) || "", client: (o && o.client) || (s && s.client) || "", project: (o && o.name) || (s && s.name) || "", currency: (o && o.currency) || "EGP",
        amountMinor: r.amountMinor, date: r.date, method: r.method, payRef: r.ref, notes: r.notes, by: r.uid, at: r.at, hasFile: !!r.hasFile, fileName: r.fileName, fileType: r.fileType, booked: !!o, rep: r,
        load: () => O.getFile(`paysub/${r.uid}/p/${r.id}`) });
    }
    for (const o of orders.filter((x) => x.status !== "cancelled")) for (const p of (o.payments || []).filter((x) => (x.status || "recorded") === "recorded")) {
      const fid = (p.files || [])[0], meta = (p.fileMeta || [])[0] || {};
      items.push({ kind: "payment", key: "p:" + o.oid + ":" + p.id, oid: o.oid, ref: o.ref, client: o.client, project: o.name, currency: o.currency, amountMinor: p.amountMinor, date: p.date, method: p.method, payRef: p.ref, notes: p.notes,
        by: p.reportedBy || p.by, at: p.at, hasFile: !!fid, nFiles: (p.files || []).length, fileName: meta.name || "", fileType: meta.type || "", booked: true, pay: p, files: p.files || [],
        load: (i = 0) => (p.files || [])[i] ? O.getFile(`orders/${o.oid}/files/${p.files[i]}`) : Promise.resolve(null) });
    }
    return items.sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date)));
  }
  async function renderVerify(opts = {}) {
    const V = $("#view-payverify");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration · Finance</span><h1>Payment <em>Verification</em></h1>
      <p class="lead small">Every payment waiting for a decision, oldest first. Open one, check the proof against the bank, then verify or reject. Pending payments never count as collected cash.</p></div>
      <div class="row"><button class="btn ghost sm" id="pv-r">${U.svg("refresh")} Refresh</button></div></div><div id="pv-list"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $("#pv-r").onclick = () => renderVerify();
    let items; try { items = await queue(); } catch (e) { $("#pv-list").innerHTML = `<div class="note err">Could not load the queue (${esc(e.message || e.code)}).</div>`; return; }
    App.badges = Object.assign(App.badges || {}, { payverify: items.length }); H.rail();
    const box = $("#pv-list");
    if (!items.length) { box.innerHTML = `<div class="card empty"><b>Nothing to verify.</b><span class="small muted">New payments recorded by sales appear here.</span></div>`; return; }
    box.innerHTML = `<div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>Order</th><th>Customer</th><th class="r">Amount</th><th>Date</th><th>Method</th><th>Recorded by</th><th>Reference</th><th>Evidence</th><th>Status</th><th></th></tr></thead><tbody>
      ${items.map((x, i) => `<tr class="click" data-i="${i}"><td class="small"><b>${esc(x.ref || x.oid)}</b><div class="tiny muted">${esc(x.project)}</div></td><td class="small">${esc(x.client || "—")}</td><td class="r num">${esc(H.money2(x.amountMinor, x.currency))}</td>
        <td class="small">${esc(x.date)}</td><td class="small">${esc(x.method || "—")}</td><td class="small">${esc(DPAuth.nameSync(x.by) || "—")}</td><td class="small">${esc(x.payRef || "—")}</td>
        <td>${x.hasFile ? `<span class="fileind ${/pdf/.test(x.fileType) ? "pdf" : "img"}" title="${esc(x.fileName)}">${/pdf/.test(x.fileType) ? "PDF" : "IMG"}</span>` : `<span class="pill err">No proof</span>`}</td>
        <td><span class="pill warn">${x.kind === "report" ? "Pending verification" : "Recorded — pending"}</span>${x.kind === "report" && !x.booked ? `<div class="tiny muted">order booking in progress</div>` : ""}</td><td><button class="btn lime xs" data-i="${i}">Review</button></td></tr>`).join("")}</tbody></table></div></div>`;
    $$("[data-i]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); review(items[+el.dataset.i]); }));
    if (opts.key) { const it = items.find((x) => x.key === opts.key); if (it) review(it); }
  }
  /** One-screen review: evidence on the left, facts and the decision on the right. */
  function review(x) {
    U.openModal(`<div class="row between"><div><span class="eyebrow">Payment verification</span><h2>${esc(H.money2(x.amountMinor, x.currency))} · ${esc(x.ref || x.oid)}</h2></div><button class="btn ghost sm" id="rv-dl" hidden>${U.svg("export")} Download</button></div>
      <div class="pv-grid"><div id="rv-v">${x.hasFile ? "" : `<div class="note err"><b>No payment proof attached.</b> A payment can only be verified against its evidence. ${x.kind === "payment" ? "Attach the proof first, or reject the payment." : "Reject it with a reason so the salesperson can attach the proof."}</div>`}</div>
        <div class="stack"><dl class="kv small"><dt>Customer</dt><dd>${esc(x.client || "—")}</dd><dt>Project</dt><dd>${esc(x.project || "—")}</dd><dt>Amount</dt><dd><b>${esc(H.money2(x.amountMinor, x.currency))}</b></dd><dt>Payment date</dt><dd>${esc(x.date)}</dd><dt>Method</dt><dd>${esc(x.method || "—")}</dd>
          <dt>Reference</dt><dd>${esc(x.payRef || "—")}</dd><dt>Recorded by</dt><dd>${esc(DPAuth.nameSync(x.by) || "—")} · ${esc(H.dateS(x.at))}</dd>${x.notes ? `<dt>Notes</dt><dd>${esc(x.notes)}</dd>` : ""}${x.nFiles > 1 ? `<dt>Files</dt><dd>${x.files.map((f, i) => `<button class="linkbtn" data-f="${i}">file ${i + 1}</button>`).join(" · ")}</dd>` : ""}</dl>
          <div id="rv-pos" class="small muted">Loading the order's payment position…</div>
          <label class="field"><span>Note (optional for verification, required for rejection)</span><textarea class="in" id="rv-n" rows="2" maxlength="300"></textarea></label>
          ${x.kind === "payment" && !x.hasFile ? `<button class="btn ghost sm" id="rv-att">${U.svg("clip")} Attach proof…</button>` : ""}
          <p class="small" id="rv-err" style="color:var(--red)"></p>
          <div class="row"><button class="btn lime" id="rv-ok" disabled>Verify payment</button><button class="btn ghost" id="rv-no">Reject payment</button><button class="btn ghost" id="rv-x">Close</button></div>
          <p class="tiny muted">Verify only when the funds are confirmed in Dupedia's account. Verification and rejection are recorded with your name and time.</p></div></div>`, async (m) => {
      const err = $("#rv-err", m), ok = $("#rv-ok", m); let f = null;
      $("#rv-x", m).onclick = () => U.closeModal();
      const show = async (i = 0) => { f = await x.load(i).catch(() => null); const r = await mountViewer($("#rv-v", m), f); ok.disabled = !r.ok; if (!r.ok) err.textContent = "The proof cannot be opened, so the payment cannot be verified. Reject it with a reason (e.g. “proof missing — upload again”)."; else { err.textContent = ""; $("#rv-dl", m).hidden = false; } };
      if (x.hasFile) show(0); $$("[data-f]", m).forEach((b) => (b.onclick = () => show(+b.dataset.f)));
      $("#rv-dl", m).onclick = () => f && U.downloadOut({ blob: new Blob([bytesOf(f.dataUrl)], { type: f.type }), filename: f.name || "payment-proof" }, "Payment proof");
      const att = $("#rv-att", m); if (att) att.onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (file) => { try { att.disabled = true; att.textContent = "Uploading…"; const pf = await O.prepareFile(file); await O.attachPaymentFile(x.oid, x.pay.id, pf); U.closeModal(); U.toast("Proof attached. Review the payment again."); renderVerify(); } catch (e) { err.textContent = e.message; att.disabled = false; att.textContent = "Attach proof…"; } });
      // payment position of the order (verified money only)
      try { const o = await DPStore.tryGet(`orders/${x.oid}`); if (o) { const s = DPPay.summary(o, { tz: App.config.settings.timezone, settings: App.config.settings }); $("#rv-pos", m).innerHTML = `Order value <b>${esc(H.money2(s.payableMinor, o.currency))}</b> · verified so far <b>${esc(H.money2(s.verifiedMinor, o.currency))}</b> · remaining <b>${esc(H.money2(s.remainingMinor, o.currency))}</b>${s.verifiedMinor + x.amountMinor > s.payableMinor ? `<div class="note warn" style="margin-top:6px">Verifying this payment would exceed the order value by ${esc(H.money2(s.verifiedMinor + x.amountMinor - s.payableMinor, o.currency))}. It will be flagged as an overpayment for review.</div>` : ""}`; } else $("#rv-pos", m).textContent = "The order is being booked; the payment is added to it when you verify."; } catch (e) { $("#rv-pos", m).textContent = ""; }
      ok.onclick = async () => { ok.disabled = true; ok.textContent = "Verifying…"; err.textContent = "";
        try { const note = $("#rv-n", m).value.trim();
          if (x.kind === "report") await O.decidePaymentReport(x.rep, true, { verified: true, note }); else await O.setPaymentStatus(x.oid, x.pay.id, "verified", note);
          U.closeModal(); U.toast(`Payment verified: ${H.money2(x.amountMinor, x.currency)} on ${x.ref || x.oid}. The salesperson has been notified.`, { ms: 6000 }); renderVerify(); }
        catch (e) { err.textContent = e.message || "Not saved."; ok.disabled = false; ok.textContent = "Verify payment"; } };
      $("#rv-no", m).onclick = async () => { const note = $("#rv-n", m).value.trim(); if (note.length < 3) { err.textContent = "Give the reason for the rejection so the salesperson can correct it."; $("#rv-n", m).focus(); return; }
        const b = $("#rv-no", m); b.disabled = true; b.textContent = "Rejecting…";
        try { if (x.kind === "report") await O.decidePaymentReport(x.rep, false, { note }); else await O.setPaymentStatus(x.oid, x.pay.id, "rejected", note);
          U.closeModal(); U.toast("Payment rejected. The salesperson has been told why.", { ms: 6000 }); renderVerify(); }
        catch (e) { err.textContent = e.message || "Not saved."; b.disabled = false; b.textContent = "Reject payment"; } };
    }, { wide: true });
  }

  /* ---------------- payment position (order details) ---------------- */
  function positionHtml(s, cur, { admin = false } = {}) {
    const st = DPPay.STATUS[s.status] || [s.status, ""], m = (v) => esc(H.money2(v, cur));
    return `<div class="paypos"><div class="row between"><h3>Payments</h3><span class="pill ${st[1]}">${esc(st[0])}</span></div>
      <div class="kcards sm">${[["Order value", s.payableMinor, s.adjustmentsMinor ? `incl. amendments ${H.money2(s.adjustmentsMinor, cur)}` : "confirmed, incl. VAT"], ["Required deposit", s.depositMinor, s.depositRemainingMinor ? `${H.money2(s.depositRemainingMinor, cur)} still due` : "received (verified)"], ["Verified received", s.verifiedMinor, "bank-confirmed only"],
        ["Pending verification", s.pendingMinor, "not counted yet"], ["Remaining balance", s.remainingMinor, s.overpaidMinor ? `overpaid ${H.money2(s.overpaidMinor, cur)} — review` : ""], ["Overdue", s.overdueMinor, s.overdueMinor ? "past due date" : "nothing overdue"]].map(([l, v, sub], i) => `<div class="kc ${i === 5 && v ? "err" : i === 4 && s.overpaidMinor ? "err" : ""}"><span class="eyebrow">${esc(l)}</span><b class="num">${m(v)}</b><span class="tiny muted">${esc(sub)}</span></div>`).join("")}</div>
      <div class="tablewrap"><table class="mtable"><thead><tr><th>Milestone</th><th>Due</th><th class="r">Expected</th><th class="r">Verified</th><th class="r">Remaining</th><th>Status</th></tr></thead><tbody>
      ${s.milestones.map((x) => { const t = DPPay.MS_STATE[x.state] || [x.state, ""]; return `<tr><td class="small">${esc(x.label)}${x.pct != null ? ` <span class="tiny muted">${x.pct}%</span>` : ""}</td><td class="small">${esc(x.due || "—")}</td><td class="r num">${m(x.expectedMinor)}</td><td class="r num">${m(x.paidMinor)}</td><td class="r num">${m(x.remainingMinor)}</td><td><span class="pill ${t[1]}">${esc(t[0])}${x.daysOverdue ? ` · ${x.daysOverdue} d` : ""}</span></td></tr>`; }).join("")}
      ${s.unscheduledMinor ? `<tr><td class="small">Balance (no due date set)</td><td class="small">—</td><td class="r num">${m(s.unscheduledMinor)}</td><td colspan="3" class="tiny muted">Outstanding until paid or scheduled</td></tr>` : ""}</tbody></table></div>
      ${s.overScheduled ? `<div class="note warn small">The milestones add up to more than the order value. Correct the payment terms.</div>` : ""}
      ${admin ? `<div class="row"><button class="btn ghost xs" data-terms>Change payment terms…</button><button class="btn ghost xs" data-amend>Amend order value…</button></div>` : ""}</div>`;
  }
  function bindPosition(box, o, done) {
    const t = box.querySelector("[data-terms]"); if (t) t.onclick = () => termsDialog(o, done);
    const a = box.querySelector("[data-amend]"); if (a) a.onclick = async () => {
      const f = await U.form("Amend the order value", [{ id: "a", label: `Change in ${o.currency || "EGP"} (negative for a reduction or credit)`, type: "number", required: true }, { id: "r", label: "Reason (extra scope, approved discount, credit note…)", type: "textarea", required: true }], { submit: "Amend value", intro: "The confirmed value, deposit and balance are recalculated. The original value stays on record. The commission is not recalculated automatically." });
      if (!f) return; try { await O.amendValue(o.oid, Math.round(+f.a * 100), f.r); U.toast("Order value amended."); done && done(); } catch (e) { U.toast(e.message, { err: true, ms: 7000 }); } };
  }
  function termsDialog(o, done) {
    const s = DPPay.normalise(o.schedule, { acceptDate: (o.acceptedAt || "").slice(0, 10), settings: App.config.settings });
    U.openModal(`<h2>Payment terms</h2><p class="small muted">${esc(o.ref || o.oid)} · ${esc(o.name)} · value ${esc(H.money2(DPPay.payableOf(o), o.currency))}</p>
      <p class="small">Milestones are obligations, not payments. Percentages follow later value amendments. The original terms and this change are kept on the order.</p>
      <div id="tm-rows" class="stack"></div><button class="btn ghost xs" id="tm-add">${U.svg("plus")} Add milestone</button>
      <label class="field"><span>Reason for the change *</span><input class="in" id="tm-r" maxlength="200"></label><p class="small" id="tm-err" style="color:var(--red)"></p>
      <div class="acts"><button class="btn ghost" id="tm-x">Cancel</button><button class="btn lime" id="tm-ok">Save terms</button></div>`, (m) => {
      const rows = $("#tm-rows", m);
      const add = (x = {}) => { const d = document.createElement("div"); d.className = "grid4 tmr"; d.dataset.kind = x.kind || "custom"; d.dataset.id = x.id || "";
        d.innerHTML = `<input class="in sm" data-l value="${esc(x.label || "")}" placeholder="Milestone"><div class="unit"><input class="in sm num" data-p type="number" min="0" max="100" step="0.5" value="${x.pct != null ? esc(x.pct) : ""}" placeholder="%"><em>%</em></div><input class="in sm num" data-a type="number" min="0" step="0.01" value="${x.pct == null && x.amountMinor ? x.amountMinor / 100 : ""}" placeholder="or amount"><div class="row"><input class="in sm" data-d type="date" value="${esc(x.due || "")}">${x.kind === "deposit" ? `<span class="tiny muted">deposit</span>` : `<button class="btn ghost xs" data-rm>✕</button>`}</div>`;
        rows.appendChild(d); const rm = d.querySelector("[data-rm]"); if (rm) rm.onclick = () => d.remove(); };
      s.forEach(add); $("#tm-add", m).onclick = () => add({ label: "Payment", kind: "custom" }); $("#tm-x", m).onclick = () => U.closeModal();
      $("#tm-ok", m).onclick = async () => { const err = $("#tm-err", m); err.textContent = "";
        const sch = $$(".tmr", rows).map((d) => { const p = d.querySelector("[data-p]").value, a = d.querySelector("[data-a]").value; return { id: d.dataset.id || undefined, kind: d.dataset.kind, label: d.querySelector("[data-l]").value.trim() || "Payment", pct: p !== "" ? +p : null, amountMinor: p === "" && a !== "" ? Math.round(+a * 100) : null, due: d.querySelector("[data-d]").value || null }; });
        if (sch.some((x) => x.pct == null && x.amountMinor == null)) { err.textContent = "Give each milestone a percentage or an amount."; return; }
        try { await O.amendSchedule(o.oid, sch, $("#tm-r", m).value); U.closeModal(); U.toast("Payment terms saved."); done && done(); } catch (e) { err.textContent = e.message; } };
    }, { wide: true });
  }

  /* ---------------- overdue reminders ---------------- */
  /** Runs in open sessions (administrators: all orders; sales: their own order copies). Deterministic notification ids make
   *  every reminder unique per milestone and due date; the server sweep sends the same ids when nobody is online. */
  async function checkOverdue() {
    const tz = App.config.settings.timezone || DPPay.TZ_DEFAULT, admin = U.isAdmin(), sent = [];
    const orders = admin ? await DPSales.listOrders().catch(() => []) : await O.mySalesOrders().catch(() => []);
    for (const o of orders.filter((x) => x.status !== "cancelled")) {
      const s = DPPay.summary(o, { tz, settings: App.config.settings });
      for (const a of DPPay.overdueAlerts(o.oid, s)) {
        const n = { id: a.id, type: "payment", priority: a.level === "escalation" ? "high" : "normal", title: a.level === "escalation" ? "Payment still overdue — escalate" : "Payment overdue", body: `${o.ref || o.oid} · ${o.name}: ${a.m.label} of ${H.money2(a.m.remainingMinor, o.currency)} was due ${a.m.due}. Next step: contact the client and agree a payment date.`, link: { view: "proposals", opts: { oid: o.oid } }, ref: o.oid };
        if (admin) { await DPNotify.deliver(["@admins", o.ownerId], n).catch(() => {}); sent.push(a.id); }
        else if (await DPNotify.toSelf(n).catch(() => false)) sent.push(a.id);
      }
    }
    return sent;
  }

  U.register("payverify", renderVerify);
  Object.assign(DPUI, { showFile, mountViewer, paymentPosition: positionHtml, bindPaymentPosition: bindPosition, termsDialog, verifyQueue: queue, reviewPayment: review });
  root.DPPayUI = { showFile, mountViewer, queue, review, positionHtml, bindPosition, termsDialog, checkOverdue };
})(typeof self !== "undefined" ? self : this);
