/* Dupedia Site Planner 2.1 — projects home, project setup, templates, sample project. */
/* global DPUI, DPModel, DPStore, DPCat, DPPlan, DPPen, DPIO, DPCanvas, DPGeom */
(function (root) {
  "use strict";
  const U = DPUI, M = DPModel, S = M.S, { $, $$, esc, App } = U;
  let cache = { projects: [], templates: [], q: "", status: "" };

  /* ---------------- home ---------------- */
  async function renderHome() {
    const el = $("#view-home");
    el.innerHTML = `<div class="page">
      <div class="hero">
        <div class="card corner"><span class="eyebrow">X FORCE 1.1 · Drafts &amp; projects</span>
          <h1>Plan it to scale. <em>Price</em> it. Send it.</h1>
          <p class="muted" style="max-width:58ch">Lay out real sites at true size with the Dupedia catalogue, landscape and fencing, let quantities and prices follow the drawing, and publish a branded proposal the client can sign.</p>
          <div class="row" style="margin-top:4px">${U.canWrite() ? `<button class="btn lime" id="h-new">${U.svg("plus")} New project</button><button class="btn ghost" id="h-import">Import project file</button>` : ""}<button class="btn ghost" id="h-sample">Open the sample project</button></div>
        </div>
        <div class="card flat"><div class="blocks" aria-hidden="true"><i class="sq"></i><i class="qc"></i><i class="hf"></i><i class="ci"></i></div>
          <h3>How a project flows</h3>
          <ol class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;color:var(--fg2)">
            <li><b>Project</b>: client, location, type and site size.</li><li><b>Site &amp; design</b>: boundary, products, landscape, fences, surfaces.</li>
            <li><b>Quotation</b>: quantities from the plan, prices from the price book, 5% or 10% discount.</li><li><b>Review</b>: plan against quotation, open issues, sign-off.</li><li><b>Proposal</b>: branded PDF, plan image, technical drawing.</li></ol>
          <p class="tiny muted">Storage: ${DPStore.st.mode === "cloud" ? "shared with your team on this page" : DPStore.st.mode === "local" ? "this browser only" : "temporary"} · Price book: ${Object.values(App.config.pricebook.items || {}).filter((x) => x && x.sell != null && x.sell !== "").length} priced items</p>
        </div>
      </div>
      <div class="phead"><div><h2>Drafts &amp; projects</h2><p class="small muted">Issued quotations and orders are in My Orders &amp; Proposals.</p></div><div class="row"><div class="search" style="width:260px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="h-q" placeholder="Search name, client or reference" value="${esc(cache.q)}"></div>
        <select class="in sm" id="h-st" style="width:auto"><option value="">All statuses</option><option value="draft"${cache.status === "draft" ? " selected" : ""}>Draft</option>${["issued", "submitted", "won", "lost", "cancelled"].map((k) => `<option value="${k}"${cache.status === k ? " selected" : ""}>${U.STATUS_LABEL[k]}</option>`).join("")}</select></div></div>
      <div class="card" style="padding:0"><div class="tablewrap" id="h-list"><div class="empty"><div class="spinner"></div>Loading projects…</div></div></div>
      <div class="phead"><div><h2>Layout templates</h2><p class="small muted">Save a successful layout as a template from any project (Save menu), then start new projects from it.</p></div></div>
      <div id="h-tpl" class="tpl"></div>
    </div>`;
    const n = $("#h-new"); if (n) n.onclick = () => U.go("setup", { isNew: true });
    const im = $("#h-import"); if (im) im.onclick = () => U.pickFile(".json", importProjectFile);
    $("#h-sample").onclick = openSample;
    $("#h-q").oninput = (e) => { cache.q = e.target.value; listHTML(); };
    $("#h-st").onchange = (e) => { cache.status = e.target.value; listHTML(); };
    try { [cache.projects, cache.templates] = await Promise.all([DPStore.listProjects(U.isAdmin() ? root.DPShell.ownerIds() : null), DPStore.listTemplates()]); }
    catch (e) { $("#h-list").innerHTML = `<div class="empty">Projects could not be loaded (${esc(e.message || e.code)}).</div>`; return; }
    listHTML(); tplHTML();
  }
  function listHTML() {
    const q = cache.q.trim().toLowerCase();
    const rows = cache.projects.filter((p) => (!cache.status || p.status === cache.status) && (!q || [p.name, p.client, p.ref, p.location].join(" ").toLowerCase().includes(q)));
    const box = $("#h-list"); if (!box) return;
    if (!cache.projects.length) { box.innerHTML = `<div class="empty"><div class="blocks" aria-hidden="true"><i class="sq"></i><i class="qc"></i><i class="hf"></i><i class="ci"></i></div><b>No projects yet.</b><span class="small">Start a new project, or open the sample project to see the whole workflow with illustrative prices.</span></div>`; return; }
    if (!rows.length) { box.innerHTML = `<div class="empty">No projects match “${esc(cache.q)}”.</div>`; return; }
    box.innerHTML = `<table class="plist"><thead><tr><th>Project</th>${U.isAdmin() ? "<th>Owner</th>" : ""}<th>Reference</th><th>Type</th><th>Status</th><th style="text-align:right">Total</th><th>Last saved</th><th></th></tr></thead><tbody>${rows.map((p) => `
      <tr class="click" data-open="${esc(p.id)}" data-owner="${esc(p.ownerId)}"><td><div class="pn">${esc(p.name || "Untitled")}</div><div class="tiny muted">${esc([p.client, p.location].filter(Boolean).join(" · "))}</div></td>
      ${U.isAdmin() ? `<td class="small">${esc(root.DPAuth.nameSync(p.ownerId) || (p.ownerId === DPStore.st.userId ? "You" : "—"))}</td>` : ""}<td class="num">${esc(p.ref || "—")}</td><td class="small">${esc(p.type || "—")}</td><td><span class="pill ${U.STATUS_PILL[p.status] || ""}">${esc(U.STATUS_LABEL[p.status] || "Draft")}</span></td>
      <td class="num" style="text-align:right">${p.total != null ? esc(DPPricing.fmtMoney(p.total, p.currency)) : "—"}</td>
      <td class="small">${p.savedAt ? esc(new Date(p.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })) : ""}<div class="tiny muted">${esc(p.savedBy || "")}</div></td>
      <td style="text-align:right;white-space:nowrap">${U.canWrite() ? `<button class="btn ghost xs" data-dup="${esc(p.id)}" data-o="${esc(p.ownerId)}">Duplicate</button> <button class="btn ghost xs" data-ren="${esc(p.id)}" data-o="${esc(p.ownerId)}">Rename</button> ${["won", "submitted"].includes(p.status) ? "" : `<button class="btn ghost xs" data-del="${esc(p.id)}" data-o="${esc(p.ownerId)}">Delete</button>`}` : ""}</td></tr>`).join("")}</tbody></table>`;
    $$("[data-open]", box).forEach((tr) => tr.onclick = (e) => { if (e.target.closest("button")) return; U.openProject(tr.dataset.open, tr.dataset.owner); });
    $$("[data-dup]", box).forEach((b) => b.onclick = () => duplicateProject(b.dataset.dup, b.dataset.o));
    $$("[data-ren]", box).forEach((b) => b.onclick = () => renameProject(b.dataset.ren, b.dataset.o));
    $$("[data-del]", box).forEach((b) => b.onclick = () => deleteProject(b.dataset.del, b.dataset.o));
  }
  function tplHTML() {
    const box = $("#h-tpl"); if (!box) return;
    if (!cache.templates.length) { box.innerHTML = `<div class="card flat small muted">No templates yet.</div>`; return; }
    box.innerHTML = cache.templates.map((t) => `<div class="card"><canvas data-tc="${esc(t.id)}" width="440" height="240"></canvas><b>${esc(t.name)}</b><span class="tiny muted">${esc(t.description || "")}${t.by ? ` · by ${esc(t.by)}` : ""}</span>
      <div class="row">${U.canWrite() ? `<button class="btn sm" data-tuse="${esc(t.id)}">New project from template</button>` : ""}${U.isAdmin() || (t.byId && t.byId === DPStore.st.userId) || DPStore.st.mode !== "cloud" ? `<button class="btn ghost sm" data-tdel="${esc(t.id)}">Delete</button>` : ""}</div></div>`).join("");
    for (const t of cache.templates) { const cv = $(`[data-tc="${CSS.escape(t.id)}"]`, box); if (cv) thumb(cv, t.project); }
    $$("[data-tuse]", box).forEach((b) => b.onclick = () => U.go("setup", { isNew: true, template: cache.templates.find((t) => t.id === b.dataset.tuse) }));
    $$("[data-tdel]", box).forEach((b) => b.onclick = async () => { if (await U.ask("Delete this template?", "Projects already started from it are not affected.", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Delete", value: true, cls: "danger" }])) { await DPStore.deleteTemplate(b.dataset.tdel); U.toast("Template deleted."); renderHome(); } });
  }
  /** Small plan thumbnail of a project (presentation style). */
  function thumb(cv, project) {
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    const pts = []; if (project.site && project.site.poly) pts.push(...project.site.poly); for (const o of project.objects || []) { const s = M.shapes(o); if (!s.missing) pts.push(...M.outline(o).flat()); }
    if (!pts.length) return; const b = DPGeom.bbox(pts), s = Math.min((cv.width - 20) / Math.max(b.w, 1e-6), (cv.height - 20) / Math.max(b.h, 1e-6));
    const P = new DPPen({ kind: "canvas", ctx, minLine: 0.5 }); P.setMatrix([s, 0, 0, s, cv.width / 2 - (b.x0 + b.w / 2) * s, cv.height / 2 - (b.y0 + b.h / 2) * s]);
    DPPlan.draw(P, { project, mode: "presentation", show: { grid: false, labels: false, dims: false, zones: true }, ts: 0.7 });
  }
  async function duplicateProject(id, owner) {
    const d = await DPStore.loadProject(id, owner); if (!d) return;
    const p = d.project; p.meta.id = M.uid("p-"); p.meta.ownerId = DPStore.st.userId || "local"; p.meta.issuedAt = null; p.meta.issuedBy = null; p.meta.rev = 0; p.meta.orderId = null; p.meta.name = p.meta.name + " (copy)"; p.meta.ref = U.nextRef(); p.meta.status = "draft"; p.meta.created = new Date().toISOString(); p.audit = [];
    M.load(p, { cadData: d.cadData }); M.audit("Duplicated", `from ${d.project.meta.ref || id}`); App.baseRev = null; App.open = true; App.sample = false;
    await U.save(); U.toast("Project duplicated."); renderHome();
  }
  async function renameProject(id, owner) {
    const d = await DPStore.loadProject(id, owner); if (!d) return;
    const r = await U.form("Rename project", [{ id: "name", label: "Project name", value: d.project.meta.name, required: true }]); if (!r) return;
    M.load(d.project, { cadData: d.cadData }); S.project.meta.name = r.name; M.audit("Renamed", r.name); App.baseRev = d.rev; App.open = true; App.sample = false;
    await U.save(); App.open = false; renderHome();
  }
  async function deleteProject(id, owner) {
    const p = cache.projects.find((x) => x.id === id && x.ownerId === owner);
    const ok = await U.ask(`Delete “${p ? p.name : "project"}”?`, "<p>The project, its saved versions and its images are removed for everyone. This cannot be undone. Export the project file first if you may need it.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Delete project", value: true, cls: "danger" }]);
    if (!ok) return; await DPStore.deleteProject(id, owner); U.toast("Project deleted."); renderHome();
  }
  async function importProjectFile(file) {
    try {
      await DPIO.validateFile(file); const obj = JSON.parse(await file.text()); const kind = M.checkProject(obj);
      if (kind === "v1") { const m = M.migrateV1(obj); m.project.meta.ref = U.nextRef(); U.startProject(m.project, { cadData: m.cadData, refImage: m.refImage }); M.audit("Imported", `v1 planner file ${file.name}`); U.toast("Plan imported from the client Site Planner. Add the project details next."); U.go("setup"); return; }
      const p = obj.project;
      // 1.1: an imported file is always a draft in the importer's own projects — it can never carry an issued quotation or an order
      p.meta.ownerId = DPStore.st.userId || "local"; Object.assign(p.meta, { status: "draft", issuedAt: null, issuedBy: null, orderId: null, acceptedAt: null });
      const saved = await DPStore.loadProject(p.meta.id).catch(() => null), exists = cache.projects.some((x) => x.id === p.meta.id) || !!saved;
      if (saved && !["draft", "lost", undefined, null, ""].includes(saved.project.meta.status)) { p.meta.id = M.uid("p-"); p.meta.name += " (imported)"; U.toast("The saved project with this id is an issued quotation or order, so the file is imported as a separate draft.", { ms: 7000 }); }
      else if (exists) { const c = await U.ask("This project already exists", "<p>Import it as a separate copy, or replace the saved one?</p>", [{ label: "Cancel", value: null, cls: "ghost" }, { label: "Import as copy", value: "copy", cls: "ghost" }, { label: "Replace saved", value: "replace", cls: "danger" }]);
        if (!c) return; if (c === "copy") { p.meta.id = M.uid("p-"); p.meta.name += " (imported)"; } }
      U.startProject(p, { cadData: obj.cadData || null, refImage: obj.refImage || null }); M.audit("Imported", file.name); await U.save({ force: true }); U.go("plan"); setTimeout(() => DPCanvas.fit(), 30);
    } catch (e) { U.toast(e.message || "The file could not be imported.", { err: true, ms: 8000 }); }
  }

  /* ---------------- project setup ---------------- */
  function renderSetup(opts = {}) {
    const isNew = !!opts.isNew, tpl = opts.template || null, me = U.userInfo();
    const m = isNew ? Object.assign(M.newProject().meta, { ref: U.nextRef(), preparedBy: me.name || "", name: tpl ? tpl.name : "" }) : S.project.meta;
    const site = !isNew && S.project.site && S.project.site.dims ? S.project.site.dims : tpl && tpl.project.site && tpl.project.site.dims ? tpl.project.site.dims : { w: "", l: "" };
    const ro = !U.canWrite();
    $("#view-setup").innerHTML = `<form class="page narrow" id="setup-form" novalidate>
      <div class="phead"><div><span class="eyebrow">${isNew ? "New project" : "Step 1 of 5"}</span><h1>${isNew ? "Project details" : "Project details"}</h1><p class="lead small">${isNew ? (tpl ? `Starting from the template “${esc(tpl.name)}”.` : "Everything here appears on the proposal. You can change it later.") : "These details feed the proposal cover, overview and title blocks."}</p></div>
        <div class="row">${isNew ? `<button type="button" class="btn ghost" id="s-cancel">Cancel</button>` : ""}<button type="submit" class="btn lime" ${ro ? "disabled" : ""}>${isNew ? "Create project and open the site" : "Save details"}</button></div></div>
      <div class="card stack">
        <div class="grid2"><label class="field"><span>Project name *</span><input class="in" id="s-name" value="${esc(m.name)}" required placeholder="e.g. Palm Residence — central play park"></label>
          <label class="field"><span>Client or company *</span><input class="in" id="s-client" value="${esc(m.client)}" placeholder="e.g. Al Nakheel Developments"></label></div>
        <div class="grid3"><label class="field"><span>Location</span><input class="in" id="s-loc" value="${esc(m.location)}" placeholder="City, compound or site"></label>
          <label class="field"><span>Project type</span><select class="in" id="s-type"><option value="">Choose…</option>${DPCat.PROJECT_TYPES.map((t) => `<option${t === m.type ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label class="field"><span>Proposal reference</span><input class="in" id="s-ref" value="${esc(m.ref)}"></label></div>
        <label class="field"><span>Lead (from My Leads)</span><select class="in" id="s-lead" ${ro ? "disabled" : ""}><option value="">Not linked to a lead</option></select><small>Linking keeps the lead's pipeline stage in step with this proposal and credits the sale to the lead's owner.</small></label>
        <div class="grid3"><label class="field"><span>Prepared by</span><input class="in" id="s-by" value="${esc(m.preparedBy)}" placeholder="Employee name"></label>
          <label class="field"><span>Proposal date</span><input class="in" type="date" id="s-date" value="${esc(m.date)}"></label>
          <div class="field"><span class="lbl">Site size (rectangle)</span><div class="grid2"><div class="unit"><input class="in num" id="s-w" type="number" min="1" step="0.1" value="${esc(site.w)}" placeholder="Width"><em>m</em></div><div class="unit"><input class="in num" id="s-l" type="number" min="1" step="0.1" value="${esc(site.l)}" placeholder="Length"><em>m</em></div></div>
            <small>${isNew ? "Optional: you can also draw any shape or import a drawing in the next step." : S.project.site ? "Changing these replaces the current boundary with a rectangle." : "Creates a rectangular boundary."}</small></div></div>
        <label class="field"><span>Project description (optional)</span><textarea class="in" id="s-desc" rows="3" placeholder="What the client wants to achieve, who will use the space, any constraints.">${esc(m.description)}</textarea></label>
        <div class="grid2">
          <div class="field"><span class="lbl">Client logo (optional)</span><div class="row"><div id="s-logo-prev">${m.clientLogo ? `<img src="${esc(m.clientLogo)}" alt="Client logo" style="height:44px;max-width:160px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px">` : `<span class="small muted">None</span>`}</div><button type="button" class="btn ghost sm" id="s-logo">Upload PNG/JPG</button>${m.clientLogo ? `<button type="button" class="btn ghost sm" id="s-logo-x">Remove</button>` : ""}</div></div>
          <div class="field"><span class="lbl">Project image for the cover (optional)</span><div class="row"><div id="s-cover-prev">${!isNew && S.project.proposal.coverImage ? `<img src="${esc(S.project.proposal.coverImage)}" alt="" style="height:44px;border-radius:8px">` : `<span class="small muted">The plan is used when none is given</span>`}</div><button type="button" class="btn ghost sm" id="s-cover">Upload photo or render</button></div></div>
        </div>
      </div>
      ${!isNew ? `<div class="card stack"><h3>Status and history</h3><div class="row"><span class="pill ${U.STATUS_PILL[m.status] || ""}">${esc(U.STATUS_LABEL[m.status] || "Draft")}</span><span class="small muted">Created ${esc(new Date(m.created).toLocaleDateString())}${m.createdBy ? " by " + esc(m.createdBy) : ""}</span></div>
        <div class="row"><button type="button" class="btn ghost sm" id="s-versions">Versions…</button><button type="button" class="btn ghost sm" id="s-audit">Change log…</button></div></div>` : ""}
    </form>`;
    let logo = m.clientLogo || null, cover = !isNew ? S.project.proposal.coverImage : null;
    const wantLead = isNew ? (opts.leadId || null) : (m.leadId || null);
    root.DPShell.myOwnedLeads().then((list) => { const sel = $("#s-lead"); if (!sel) return;
      if (wantLead && !list.some((l) => l.id === wantLead)) list.push({ id: wantLead, name: (opts.leadName || "Linked lead") + " (not owned by you)" });
      sel.innerHTML = `<option value="">Not linked to a lead</option>` + list.map((l) => `<option value="${esc(l.id)}"${l.id === wantLead ? " selected" : ""}>${esc(l.name)}</option>`).join("");
      if (isNew && opts.leadId) { const l = list.find((x) => x.id === opts.leadId); if (l && !$("#s-client").value) $("#s-client").value = l.name; if (l && l.location && !$("#s-loc").value) $("#s-loc").value = String(l.location).split(/[;/]/)[0].trim(); }
    }).catch(() => {});
    const c = $("#s-cancel"); if (c) c.onclick = () => U.go(App.open && !isNew ? "plan" : "home");
    $("#s-logo").onclick = () => U.pickFile(".png,.jpg,.jpeg", async (f) => { try { await DPIO.validateFile(f); logo = await DPIO.shrinkImage(f, 600, "image/png"); $("#s-logo-prev").innerHTML = `<img src="${logo}" alt="" style="height:44px;max-width:160px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px">`; } catch (e) { U.toast(e.message, { err: true }); } });
    const lx = $("#s-logo-x"); if (lx) lx.onclick = () => { logo = null; $("#s-logo-prev").innerHTML = `<span class="small muted">None</span>`; };
    $("#s-cover").onclick = () => U.pickFile(".png,.jpg,.jpeg", async (f) => { try { await DPIO.validateFile(f); cover = await DPIO.shrinkImage(f, 1800, "image/jpeg", 0.85); $("#s-cover-prev").innerHTML = `<img src="${cover}" alt="" style="height:44px;border-radius:8px">`; } catch (e) { U.toast(e.message, { err: true }); } });
    const vb = $("#s-versions"); if (vb) vb.onclick = () => DPUI.versions();
    const ab = $("#s-audit"); if (ab) ab.onclick = () => DPUI.auditLog();
    $("#setup-form").onsubmit = (e) => {
      e.preventDefault(); if (ro) return;
      const name = $("#s-name").value.trim(); if (!name) { U.toast("Enter a project name.", { err: true }); $("#s-name").focus(); return; }
      const w = +$("#s-w").value, l = +$("#s-l").value, anyDims = $("#s-w").value !== "" || $("#s-l").value !== "", hasDims = anyDims;
      if (anyDims && !(w > 0 && l > 0)) { U.toast("Enter both the site width and length, each greater than zero (or leave both empty).", { err: true }); ($("#s-w").value !== "" && w > 0 ? $("#s-l") : $("#s-w")).focus(); return; }
      if (hasDims && (w > 5000 || l > 5000)) { U.toast("Site sides above 5 km are not supported.", { err: true }); return; }
      const meta = { name, client: $("#s-client").value.trim(), location: $("#s-loc").value.trim(), type: $("#s-type").value, ref: $("#s-ref").value.trim(), preparedBy: $("#s-by").value.trim(), date: $("#s-date").value || M.today(), description: $("#s-desc").value.trim(), clientLogo: logo, leadId: ($("#s-lead") && $("#s-lead").value) || null };
      if (isNew) {
        const base = tpl ? JSON.parse(JSON.stringify(tpl.project)) : {}; const p = M.newProject({ meta: Object.assign(meta, { createdBy: U.userInfo().name || null }) });
        if (tpl) { p.site = base.site || null; p.objects = (base.objects || []).map((o) => Object.assign(o, { id: M.uid() })); }
        if (hasDims) p.site = { poly: [[0, 0], [w, 0], [w, l], [0, l]], source: "rect", north: (p.site && p.site.north) || 0, dims: { w, l } };
        p.pricing.currency = App.config.pricebook.currency || App.config.settings.currency; p.proposal.coverImage = cover;
        U.startProject(p); if (tpl) M.audit("Started from template", tpl.name); if (meta.leadId) root.DPLeads.syncStage(meta.leadId, "proposal_wip", "Project " + (meta.ref || meta.name) + " started"); U.save(); U.go("plan"); setTimeout(() => DPCanvas.fit(), 40);
        if (!p.site) setTimeout(() => DPUI.planTab && DPUI.planTab("site"), 60);
      } else {
        const changed = Object.keys(meta).filter((k) => S.project.meta[k] !== meta[k]);
        Object.assign(S.project.meta, meta); S.project.proposal.coverImage = cover;
        if (hasDims && (!S.project.site || !S.project.site.dims || S.project.site.dims.w !== w || S.project.site.dims.l !== l)) { S.project.site = { poly: [[0, 0], [w, 0], [w, l], [0, l]], source: "rect", north: (S.project.site && S.project.site.north) || 0, dims: { w, l } }; changed.push("site"); }
        M.commit("Edit details", { audit: { action: "Edited project details", detail: changed.join(", ") } }); U.scheduleAutosave(); U.toast("Project details saved."); U.header();
      }
    };
  }

  /* ---------------- sample project (illustrative prices, clearly labelled) ---------------- */
  const SAMPLE_PRICES = { currency: "EGP", illustrative: true, items: {
    "SW-E104": { sell: 1450000, install: 85000 }, "SW-A409": { sell: 185000, install: 12000 }, "SW-A408": { sell: 95000, install: 6000 }, "SW-Y303": { sell: 210000, install: 14000 },
    "SW-T211": { sell: 260000, install: 15000 }, "SW-Y311": { sell: 140000, install: 9000 }, "SW-A403": { sell: 230000, install: 14000 }, "SW-L501": { sell: 38000, install: 1500 },
    "el:fence": { sell: 1900 }, "el:gate": { sell: 22000 }, "el:gate-double": { sell: 48000 }, "el:rubber": { sell: 2400 }, "el:turf": { sell: 850 }, "el:path": { sell: 950 },
    "el:palm": { sell: 18000 }, "el:tree": { sell: 9500 }, "el:bin": { sell: 6500 }, "el:light": { sell: 28000 }, "el:planter": { sell: 7500 }, "el:shade": { sell: 165000 } } };
  function sampleProject() {
    const p = M.newProject({ meta: { name: "Palm Residence — central play park", client: "Sample client (illustrative)", location: "New Cairo, Egypt", type: "Residential compound", ref: "SAMPLE-001", preparedBy: "Dupedia design team",
      description: "A family play park at the heart of a residential compound: a destination play structure for 5–12 year olds, a separate early-years corner, swings and agility play, shaded seating for parents and a fenced perimeter with a main entrance and a maintenance gate." } });
    p.site = { poly: [[0, 0], [40, 0], [40, 18], [32, 26], [0, 26]], source: "manual", north: 0 };
    const o = (x) => p.objects.push(Object.assign({ id: M.uid() }, x));
    const A = (type, poly, extra) => o(Object.assign({ kind: "area", type, poly }, extra || {}));
    A("turf", [[0.6, 0.6], [39.4, 0.6], [39.4, 17.75], [31.75, 25.4], [0.6, 25.4]], { label: "" });
    A("rubber", [[2, 2.5], [18, 2.5], [18, 11.5], [2, 11.5]]); A("rubber", [[20, 3], [28, 3], [28, 9], [20, 9]]); A("rubber", [[30, 3], [36.2, 3], [36.2, 15], [30, 15]]);
    A("rubber", [[3, 15], [24, 15], [24, 23], [3, 23]], { label: "Early years zone" });
    o({ kind: "line", type: "path", pts: [[0, 13.2], [28, 13.2], [28, 26]], width: 1.5 });
    o({ kind: "line", type: "fence", pts: [[0, 0], [40, 0], [40, 18], [32, 26], [0, 26], [0, 0]], width: 0.08, label: "Perimeter fence 1.2 m" });
    o({ kind: "point", type: "gate", x: 28, y: 26, l: 1.5, w: 0.12, rot: 0, label: "Main entrance" });
    o({ kind: "point", type: "gate-double", x: 0, y: 13.2, l: 3, w: 0.12, rot: 90, label: "Maintenance gate" });
    const P = (code, x, y, rot = 0) => o({ kind: "product", code, x, y, rot });
    P("SW-E104", 10, 7); P("SW-A409", 24, 6); P("SW-A408", 33, 5); P("SW-A403", 33, 12); P("SW-Y303", 6, 18, 90); P("SW-T211", 14, 19); P("SW-Y311", 21.5, 19);
    P("SW-L501", 21, 11); P("SW-L501", 25.5, 11); P("SW-L501", 25.5, 22, 270);
    const E = (type, x, y, l, w, extra) => o(Object.assign({ kind: "point", type, x, y, l, w, rot: 0 }, extra || {}));
    E("palm", 2, 24, 3, 3); E("palm", 38.2, 2, 3, 3); E("tree", 34, 19.5, 4, 4); E("tree", 19, 1.8, 3, 3); E("bin", 23.2, 11.2, 0.6, 0.6); E("light", 1.2, 12, 0.4, 0.4); E("light", 30, 12.4, 0.4, 0.4);
    E("planter", 30.5, 24, 1.2, 0.6); E("planter", 26.5, 24.8, 1.2, 0.6);
    p.pricing.currency = "EGP"; p.pricing.discountPct = 5;
    p.pricing.extras = [{ id: "x1", label: "Delivery and transportation to site", cat: "services", method: "fixed", value: 35000 }, { id: "x2", label: "Site preparation and levelling", cat: "services", method: "perM2", value: 60 }];
    p.proposal = Object.assign(p.proposal, {
      objectives: "Create a safe, shaded destination for families that serves three age groups at once.\nKeep clear sight lines from the seating areas to every play zone.\nUse durable timber equipment and surfacing suited to the local climate.",
      scope: "Supply and installation of the play equipment, safety surfacing, artificial grass, perimeter fence and gates, site furniture and soft landscaping shown on the plan.",
      assumptions: "Site is level, accessible to delivery vehicles and cleared of debris before installation.\nWater and power for lighting are provided at the site boundary by the client.",
      exclusions: "Civil works beyond levelling, drainage, irrigation network, electrical supply to the lighting points, permits and authority fees.",
      payment: "[To be completed by Dupedia]", delivery: "[To be completed by Dupedia]", validity: "[To be completed by Dupedia]", warranty: "[To be completed by Dupedia]",
      installation: "Installation by Dupedia's installation team after site handover. Safety zones and surfacing to be verified on site against the manufacturer's layout before construction.",
      acceptance: "" });
    return p;
  }
  function openSample() {
    U.startProject(sampleProject(), { sample: true }); App.samplePrices = SAMPLE_PRICES;
    U.toast("Sample project opened. Prices are illustrative and are not saved to your price book.", { ms: 6000 });
    U.go("plan"); setTimeout(() => DPCanvas.fit(), 40);
  }

  U.register("home", renderHome); U.register("setup", renderSetup);
  Object.assign(DPUI, { renderHome, thumb, sampleProject, SAMPLE_PRICES, openSample, importProjectFile });
})(typeof self !== "undefined" ? self : this);
