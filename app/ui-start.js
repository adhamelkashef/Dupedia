/* X FORCE 1.1 (Dupedia) — Site Planner start screen. The Site Planner navigation item ALWAYS lands here: it never reopens a
   saved project by itself. New Project, Import Project File and Open Sample Project are separate actions; a saved project is
   reopened only from its record (recent list, Drafts & Projects, My Orders & Proposals). */
/* global DPUI, DPStore, DPModel, DPPricing */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U;
  async function renderStart() {
    const V = $("#view-start"), w = U.canWrite(), cur = App.open && DPModel.S.project ? DPModel.S.project.meta : null;
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Site Planner</span><h1>Start a <em>site plan</em></h1><p class="lead small">Choose how to begin. Nothing opens or changes until you choose.</p></div></div>
      ${cur ? `<div class="card row between resume"><div><span class="eyebrow">${App.sample ? "Sample open in this session" : "Open in this session"}</span><b>${esc(cur.name || "Untitled")}</b> <span class="small muted">${esc([cur.ref, cur.client].filter(Boolean).join(" · "))}</span></div><button class="btn ghost sm" id="st-resume">Return to it →</button></div>` : ""}
      <div class="starts">
        <button type="button" class="start-card" id="st-new" ${w ? "" : "disabled"}><span class="sc-ic">${U.svg("plus")}</span><b>New Project</b><span class="small muted">A fresh, empty workspace. Your saved projects are not touched.</span></button>
        <button type="button" class="start-card" id="st-imp" ${w ? "" : "disabled"}><span class="sc-ic">${U.svg("folder")}</span><b>Import Project File</b><span class="small muted">A Dupedia project file (<code>.dupedia-project.json</code>) or a client Site Planner v1 file. Imported as a draft; you confirm before anything is replaced.</span></button>
        <button type="button" class="start-card" id="st-sample"><span class="sc-ic">${U.svg("layers")}</span><b>Open Sample Project</b><span class="small muted">A labelled demonstration with illustrative prices. It cannot be issued and never creates an order or a payment.</span></button>
      </div>
      <p class="tiny muted">CAD drawings (DXF), PDF site plans and images are not project files: import them as the site background inside the planner (Site &amp; design › Import). DWG must be exported to DXF first.</p>
      <div class="phead"><div><h2>Recent projects</h2><p class="small muted">Open a saved project from its record.</p></div><button class="btn ghost sm" id="st-all">All drafts &amp; projects →</button></div>
      <div class="card" style="padding:0"><div class="tablewrap" id="st-recent"><div class="empty small"><div class="spinner"></div>Loading…</div></div></div></div>`;
    const r = $("#st-resume"); if (r) r.onclick = () => U.go("plan");
    $("#st-new").onclick = async () => { if (App.open && DPModel.S.dirty && !App.sample && U.canWrite()) await U.save(); U.go("setup", { isNew: true }); };
    $("#st-imp").onclick = () => U.pickFile(".json", async (f) => { if (App.open && DPModel.S.dirty && !App.sample && U.canWrite()) await U.save(); U.importProjectFile(f); });
    $("#st-sample").onclick = async () => { if (App.open && DPModel.S.dirty && !App.sample && U.canWrite()) await U.save(); U.openSample(); };
    $("#st-all").onclick = () => U.go("home");
    let list = []; try { list = await DPStore.listProjects(null); } catch (e) { $("#st-recent").innerHTML = `<div class="empty small">Projects could not be loaded (${esc(e.message || e.code)}).</div>`; return; }
    list = list.filter((p) => p.ownerId === (DPStore.st.userId || "local")).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, 6);
    const box = $("#st-recent"); if (!box) return;
    box.innerHTML = list.length ? `<table class="plist"><tbody>${list.map((p) => `<tr class="click" data-o="${esc(p.id)}"><td><div class="pn">${esc(p.name || "Untitled")}</div><div class="tiny muted">${esc([p.client, p.location].filter(Boolean).join(" · "))}</div></td><td class="num small">${esc(p.ref || "")}</td><td><span class="pill ${U.STATUS_PILL[p.status] || ""}">${esc(U.STATUS_LABEL[p.status] || "Draft")}</span></td><td class="small">${p.savedAt ? esc(new Date(p.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })) : ""}</td><td style="text-align:right"><button class="btn ghost xs" data-o="${esc(p.id)}">Open</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty small">No saved projects yet.</div>`;
    $$("[data-o]", box).forEach((el) => (el.onclick = async (e) => { e.stopPropagation(); if (App.open && DPModel.S.dirty && !App.sample && U.canWrite()) await U.save(); U.openProject(el.dataset.o); }));
  }
  U.register("start", renderStart);
  DPUI.renderStart = renderStart;
})(typeof self !== "undefined" ? self : this);
