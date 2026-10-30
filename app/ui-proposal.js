/* Dupedia Site Planner 2.0 — proposal: content fields, in-app page preview (rendered from the real PDF), exports. */
/* global DPUI, DPModel, DPProposal, DPIO */
(function (root) {
  "use strict";
  const U = DPUI, M = DPModel, S = M.S, { $, $$, esc, App } = U;
  const FIELDS = [
    ["objectives", "Project objectives", "One per line. Shown as bullets on the overview page.", 4],
    ["scope", "Scope of work", "What Dupedia supplies and installs.", 3], ["assumptions", "Assumptions", "", 3], ["exclusions", "Exclusions", "", 3], ["installation", "Installation notes", "", 3],
    ["payment", "Payment terms", "", 2], ["delivery", "Delivery estimate", "", 2], ["validity", "Proposal validity", "", 2], ["warranty", "Warranty terms", "", 2], ["acceptance", "Acceptance wording", "Leave empty for the standard sentence.", 2],
  ];
  const ST = { sections: { overview: true, plan: true, schedule: true, technical: true, quotation: true, notes: true }, rendering: false, lastUrl: null };

  function renderProposal() {
    const pr = S.project.proposal, defaults = App.config.settings.terms || {}, w = U.canWrite();
    const tbc = (v) => !v || /\[to be completed/i.test(v);
    $("#view-proposal").innerHTML = `<div class="page" style="max-width:1400px">
      <div class="phead"><div><span class="eyebrow">Step 5 of 5 · Proposal</span><h1>Client proposal</h1><p class="lead small">A branded A4 proposal built from the plan and quotation. The preview below is the real PDF.</p></div>
        <div class="row"><button class="btn ghost" id="pp-review">← Review</button><button class="btn lime" id="pp-dl">${U.svg("export")} Download proposal (PDF)</button><button class="btn ghost" id="pp-send">Send by WhatsApp / e-mail…</button></div></div>
      ${App.sample ? `<div class="note warn">Sample project: the proposal is marked “illustrative prices, not a quotation” on every page.</div>` : ""}
      ${S.project.meta.status !== "issued" && !App.sample ? `<div class="note">This proposal is a draft. Mark it as issued in Review when it is ready to send.</div>` : ""}
      <div class="pgrid"><aside class="pnav">
        <div class="card stack"><h3>Sections</h3><div class="sec-toggle">${[["overview", "Project overview"], ["plan", "Master site plan"], ["schedule", "Product schedule"], ["technical", "Technical & area summary"], ["quotation", "Commercial quotation"], ["notes", "Notes & next steps"]].map(([k, l]) => `<label class="check"><input type="checkbox" data-sec="${k}" ${ST.sections[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
          <p class="tiny muted">Sections with nothing to show (no products, no prices) are left out automatically.</p></div>
        <div class="card stack"><div class="row between"><h3>Proposal text</h3>${w ? `<button class="btn ghost xs" id="pp-def">Fill empty fields from company defaults</button>` : ""}</div>
          ${FIELDS.map(([k, l, h, rows]) => `<label class="field"><span>${esc(l)}${tbc(pr[k]) && ["payment", "delivery", "validity", "warranty"].includes(k) ? ' <span class="pill warn">to complete</span>' : ""}</span><textarea class="in" data-pf="${k}" rows="${rows}" ${w ? "" : "disabled"} placeholder="${esc(defaults[k] ? "Default: " + defaults[k].slice(0, 80) : "Not set")}">${esc(pr[k] || "")}</textarea>${h ? `<small>${esc(h)}</small>` : ""}</label>`).join("")}
          <p class="tiny muted">Empty payment, delivery, validity and warranty fields print as “To be confirmed by Dupedia.” Nothing is promised that you have not written here.</p></div>
        <div class="card stack"><h3>Other outputs</h3><button class="btn ghost sm" data-out="quote">Printable quotation (PDF)</button><button class="btn ghost sm" data-out="png">Site plan image (PNG, 4000 px)</button><button class="btn ghost sm" data-out="tech">Technical drawing (A3 PDF)</button><button class="btn ghost sm" data-out="dxf">Technical drawing (DXF)</button><button class="btn ghost sm" data-out="json">Project file (.json)</button></div>
      </aside>
      <section><div class="row between" style="margin-bottom:10px"><b id="pp-info" class="small muted">Preparing preview…</b><button class="btn ghost sm" id="pp-refresh">Refresh preview</button></div><div class="pages" id="pp-pages"></div></section></div></div>`;
    const V = $("#view-proposal");
    $("#pp-review").onclick = () => U.go("review");
    $("#pp-dl").onclick = download;
    $("#pp-send").onclick = async () => {   // 1.3: review, then hand the PDF to WhatsApp or e-mail (nothing is sent automatically)
      if (U.canWrite() && !App.sample && M.S.dirty && !(await U.save())) return U.toast("Save the project first.", { err: true });
      const b = U.busy("Building the proposal…"); try { const out = await build((s) => b.set(s + "…")); b.done(); const meta = M.S.project.meta || {};
        const lc = meta.leadId ? await DPStore.tryGet(`leadcontact/${meta.leadId}`).catch(() => null) : null, ct = (lc && lc.contact) || {};
        root.DPShare.dialog(out, { customer: meta.client || "", ref: meta.ref || "", project: meta.name || "", total: DPPricing.fmtMoney(out.total, out.currency), phone: ct.phone || "", email: ct.email || "" }); }
      catch (e) { b.done(); U.toast("The proposal could not be built: " + (e.message || e), { err: true, ms: 9000 }); } };
    $("#pp-refresh").onclick = preview;
    $$("[data-sec]", V).forEach((c) => (c.onchange = () => { ST.sections[c.dataset.sec] = c.checked; preview(); }));
    let t = 0;
    $$("[data-pf]", V).forEach((ta) => (ta.oninput = () => { S.project.proposal[ta.dataset.pf] = ta.value; M.touch(); U.scheduleAutosave(); clearTimeout(t); t = setTimeout(preview, 1200); }));
    $$("[data-pf]", V).forEach((ta) => (ta.onchange = () => M.audit("Edited proposal text", ta.dataset.pf)));
    const def = $("#pp-def"); if (def) def.onclick = () => { let n = 0; for (const [k] of FIELDS) if (tbc(S.project.proposal[k]) && defaults[k]) { S.project.proposal[k] = defaults[k]; n++; } M.audit("Applied company default terms", `${n} fields`); U.scheduleAutosave(); renderProposal(); U.toast(n ? `${n} fields filled from the company defaults.` : "No company defaults are set for the empty fields. Administrators set them in Admin › Commercial."); };
    $$("[data-out]", V).forEach((b) => (b.onclick = () => other(b.dataset.out)));
    preview();
  }
  async function build(progress) { return DPProposal.proposal({ sections: ST.sections, progress }); }
  async function preview() {
    if (ST.rendering) { ST.again = true; return; } ST.rendering = true;
    const box = $("#pp-pages"), info = $("#pp-info"); if (!box) { ST.rendering = false; return; }
    try {
      const out = await build(); const pdfjs = await DPIO.pdfReader();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await out.blob.arrayBuffer()), isEvalSupported: false }).promise;
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= doc.numPages; i++) { const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 }), cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; cv.setAttribute("aria-label", `Proposal page ${i}`);
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise; frag.appendChild(cv); }
      box.innerHTML = ""; box.appendChild(frag); info.textContent = `${doc.numPages} pages · A4 landscape · ${(out.blob.size / 1024 / 1024).toFixed(1)} MB`;
    } catch (e) { console.error(e); if (info) info.textContent = (e && e.code === "precheck" ? "Complete these before the proposal can be built: " : "The preview could not be built: ") + (e.message || e); }
    finally { ST.rendering = false; if (ST.again) { ST.again = false; preview(); } }
  }
  /** Export: save the latest data → validate → load assets → build → verify the PDF → hand the file over → only then report success. */
  async function download() {
    const b = U.busy("Saving the latest changes…");
    try {
      if (U.canWrite() && !App.sample && M.S.dirty) { const ok = await U.save(); if (!ok) { b.done(); return U.toast("Save the project first: the proposal is built from the saved project.", { err: true }); } }
      const out = await build((step) => b.set(step + "…"));
      b.done();
      const ok = await U.downloadOut(out, `Proposal (${out.pages} pages)`);
      if (ok) { M.audit("Downloaded proposal PDF", `${out.pages} pages · ${(out.validated.bytes / 1024 / 1024).toFixed(1)} MB · total ${DPPricing.fmtMoney(out.total, out.currency)}`); U.scheduleAutosave(); }
      if (out.warnings && out.warnings.length) U.toast(out.warnings.join(" "), { ms: 8000 });
    } catch (e) {
      b.done(); console.error(e);
      if (e && e.code === "precheck") U.openModal(`<h2>Complete the project first</h2><div class="note warn"><ul style="margin:0;padding-left:18px">${(e.list || [e.message]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div class="acts"><button class="btn ghost" id="pc-x">Close</button><button class="btn" id="pc-go">Open project details</button></div>`, (m) => { $("#pc-x", m).onclick = () => U.closeModal(); $("#pc-go", m).onclick = () => { U.closeModal(); U.go("setup"); }; });
      else U.toast("The proposal could not be built: " + (e.message || e) + " Nothing was downloaded.", { err: true, ms: 10000 });
    }
  }
  async function other(k) {
    const b = U.busy("Preparing…");
    try {
      let out;
      if (k === "quote") out = await DPProposal.quotation(); else if (k === "tech") out = await DPProposal.technical(); else if (k === "png") out = await DPIO.exportPng(4000, "presentation", { dims: true });
      else if (k === "dxf") out = await DPIO.exportDxf(); else out = DPIO.exportJson();
      b.done(); U.downloadOut(out, { quote: "Quotation", tech: "Technical drawing", png: "Plan image", dxf: "Technical drawing", json: "Project file" }[k]);
    } catch (e) { b.done(); U.toast(e.message || "Export failed.", { err: true }); }
  }
  U.register("proposal", renderProposal);
  Object.assign(DPUI, { renderProposal, buildProposal: build });
})(typeof self !== "undefined" ? self : this);
