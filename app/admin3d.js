/* X FORCE Site Planner 3D — Admin › 3D library. Loaded only when this tab is opened.
   One row for every catalogue product: its model file, what that file measures against the catalogue, and how far it can be trusted.
   Records live in config/catalog under "models" (no prices, staff can read, administrators write), next to the catalogue overrides.
   "Reviewed" needs a named person, a named source and a file that passes the size check: nobody can mark a model reviewed by accident. */
/* global DPUI, DPCat, DPStore, DPScene3D, DPAuth */
(function (root) {
  "use strict";
  const U = DPUI, S3 = () => root.DPScene3D, { esc, App, $, $$ } = U;
  const state = { checks: {} };   // code → {info, problems, notes} from the last check of this session
  const FILE_OK = /^models\/[A-Za-z0-9._-]+\.glb$/;
  const recorded = () => (App.config.catalog || {}).models || {};
  const record = (code) => S3().libraryRecord(code, root.DP_MODELS, recorded());
  const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;

  async function checkFile(code, file) {
    try { const r = await fetch(file, { cache: "no-cache" }); if (!r.ok) throw new Error(`The file ${file} was not found.`); const info = S3().glbInfo(await r.arrayBuffer()), c = S3().checkModel(info, DPCat.BY[code]); return Object.assign({ info }, c); }
    catch (e) { return { info: null, ok: false, problems: [e.message || "The file could not be read."], notes: [] }; }
  }
  /** "Name #RRGGBB" on each line → [{id, name, hex}]. Refuses a line it can't read rather than guessing the colour. */
  function parseColours(text) {
    const out = [], seen = new Set();
    for (const line of String(text || "").split(/\n+/).map((x) => x.trim()).filter(Boolean)) { const m = line.match(/^(.+?)\s+(#[0-9a-fA-F]{6})$/); if (!m) throw new Error(`Colour "${line.slice(0, 40)}": write a name, then a colour code such as Natural timber #B98A52.`);
      const id = m[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "colour"; if (seen.has(id)) throw new Error(`Colour "${m[1]}" is listed twice.`); seen.add(id); out.push({ id, name: m[1].slice(0, 40), hex: m[2].toUpperCase() }); }
    return out;
  }
  const size = (d) => (d ? `${d.l.toFixed(2)} × ${d.w.toFixed(2)} × ${d.h ? d.h.toFixed(2) : "?"} m` : "None published");

  function row(p) {
    const r = record(p.code), c = state.checks[p.code], acc = r ? r.accuracy : "block-out";
    let status = acc === "reviewed" ? pill("ok", "Reviewed model") : acc === "approximate" ? pill("info", "Approximate model") : pill("", "Block-out");
    let found = !r || !r.file ? `<span class="muted">No file</span>` : `<code>${esc(r.file)}</code>`;
    if (c) { if (c.info) found += `<div class="tiny muted">Measures ${esc(size(c.info))} · ${c.info.triangles.toLocaleString("en-US")} triangles · ${c.info.kb} KB</div>`;
      if (!c.ok) { status += ` ${pill("err", "Size problem")}`; found += c.problems.map((x) => `<div class="tiny" style="color:var(--red)">${esc(x)}</div>`).join(""); } else if (c.notes.length) found += c.notes.map((x) => `<div class="tiny muted">${esc(x)}</div>`).join(""); else found += `<div class="tiny muted">Matches the catalogue.</div>`; }
    const cols = r && r.colours.length ? r.colours.map((x) => `<span title="${esc(x.name)}" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${esc(x.hex)};border:1px solid var(--line);vertical-align:-2px"></span>`).join(" ") : "";
    return `<tr><td><span class="code">${esc(p.displayCode || p.code)}</span></td><td>${esc(p.name)}<div class="tiny muted">${esc(p.collectionName || "")}</div></td><td>${esc(size(p.dims))}</td><td>${found}</td><td>${status}${r && r.source ? `<div class="tiny muted">${esc(r.source.slice(0, 70))}</div>` : ""}</td><td>${cols}${r && r.materials.length ? `<div class="tiny muted">${esc(r.materials.join(", ").slice(0, 60))}</div>` : ""}</td><td class="r"><button type="button" class="btn ghost xs" data-m3="${esc(p.code)}">Edit</button></td></tr>`;
  }
  function render(B) {
    const list = DPCat.PRODUCTS, withFile = list.filter((p) => { const r = record(p.code); return r && r.file; }).length, checked = Object.values(state.checks), bad = checked.filter((c) => !c.ok).length;
    B.innerHTML = `<div class="card stack"><div class="row between"><div><h3>Product models</h3><p class="small muted">${withFile} of ${list.length} products have a model. The others show as block-outs: their catalogue size, not their real shape.</p></div><button type="button" class="btn ghost sm" id="m3-check">Check all model files</button></div>
      <div class="note small">No model here is an engineering drawing. Approximate models are interpreted from photographs. Mark one as reviewed only after someone has checked it against a named source. A model whose size doesn't match the catalogue is not shown as the product.</div>
      ${checked.length ? `<div class="note small ${bad ? "err" : "ok"}">${checked.length} checked: ${bad ? `${bad} with a size problem, shown as block-outs until fixed.` : "all match the catalogue."}</div>` : ""}
      <div class="tablewrap"><table class="qtable"><thead><tr><th>Code</th><th>Product</th><th>Catalogue size (L × W × H)</th><th>Model file</th><th>Status</th><th>Colours and materials</th><th></th></tr></thead><tbody>${list.map(row).join("")}</tbody></table></div></div>`;
    $("#m3-check", B).onclick = async (e) => { const b = e.target; b.disabled = true; b.textContent = "Checking…"; for (const p of list) { const r = record(p.code); if (r && r.file) state.checks[p.code] = await checkFile(p.code, r.file); } render(B); };
    $$("[data-m3]", B).forEach((b) => (b.onclick = () => edit(b.dataset.m3, B)));
  }
  async function edit(code, B) {
    const p = DPCat.BY[code], r = record(code) || { file: "", accuracy: "approximate", source: "", reviewedBy: "", colours: [], materials: [], note: "" };
    const v = await U.form(`${p.displayCode || p.code} ${p.name}`, [
      { id: "file", label: "Model file (in the models folder of the app)", value: r.file || "" },
      { id: "accuracy", label: "How far it can be trusted", type: "select", value: r.accuracy === "reviewed" ? "reviewed" : "approximate", options: [{ value: "approximate", label: "Approximate: catalogue size, details interpreted" }, { value: "reviewed", label: "Reviewed: checked by a named person against a named source" }] },
      { id: "source", label: "Where the model came from", value: r.source || "" },
      { id: "reviewedBy", label: "Reviewed by (needed for Reviewed)", value: r.reviewedBy || "" },
      { id: "fallHeight", label: "Confirmed fall height, for the engineering prompts (leave blank if not confirmed)", type: "number", unit: "m", step: "0.01", min: 0, value: r.fallHeight == null ? "" : r.fallHeight },
      { id: "colours", label: "Colours this product comes in", type: "textarea", rows: 3, value: (r.colours || []).map((c) => `${c.name} ${c.hex}`).join("\n"), help: "One per line, name then colour code: Natural timber #B98A52. Enter only colours Dupedia really offers." },
      { id: "materials", label: "Materials", type: "textarea", rows: 2, value: (r.materials || []).join("\n"), help: "One per line. Enter only materials confirmed for this product." },
      { id: "note", label: "Note", value: r.note || "" },
    ], { submit: "Save", wide: true, intro: `Catalogue size: ${esc(size(p.dims))}. Saved for everyone straight away.` });
    if (!v) return;
    try {
      const file = v.file.trim(), source = v.source.trim(), reviewedBy = v.reviewedBy.trim();
      if (file && !FILE_OK.test(file)) throw new Error("The model file must look like models/SW-A409.glb.");
      if (v.accuracy === "reviewed") {
        if (!file || !source || !reviewedBy) throw new Error("A reviewed model needs a file, a source and the name of the person who reviewed it.");
        const c = await checkFile(code, file); if (!c.ok) throw new Error(`It can't be marked as reviewed: ${c.problems[0]}`);   // a refused attempt says nothing about the file actually in use
      }
      const rec = { file: file || null, accuracy: file ? v.accuracy : "block-out", source, reviewedBy: v.accuracy === "reviewed" ? reviewedBy : "", reviewedAt: v.accuracy === "reviewed" ? new Date().toISOString() : "", colours: parseColours(v.colours), fallHeight: v.fallHeight == null || !(v.fallHeight >= 0) ? null : v.fallHeight, materials: v.materials.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 60)), note: v.note.trim().slice(0, 300) };
      const fresh = (await DPStore.getConfig("catalog")) || {}, cfg = Object.assign({ overrides: {}, custom: [] }, fresh, { models: Object.assign({}, fresh.models || {}, { [code]: rec }), updatedAt: new Date().toISOString(), updatedBy: U.userInfo().name || "administrator" });
      await DPStore.setConfig("catalog", cfg); App.config.catalog = cfg; DPCat.setCatalogConfig(cfg); delete state.checks[code];   // any earlier result may be about a different file
      if (root.DPAuth && DPAuth.adminLog) DPAuth.adminLog("Updated 3D library", { target: code, detail: `${rec.accuracy}; source: ${source || "not given"}` }).catch(() => {});
      U.toast("Saved."); render(B);
    } catch (e) { U.toast(e.message || "It could not be saved.", { err: true, ms: 7000 }); render(B); }
  }
  /* ---------------- Admin > Engineering limits ---------------- */
  function renderLimits(B) {
    const K = root.DPChecks3D, cur = U.engineeringLimits(), groups = {}; for (const l of K.LIMITS) (groups[l.group] = groups[l.group] || []).push(l);
    const set = K.LIMITS.filter((l) => typeof cur[l.key] === "number").length;
    B.innerHTML = `<form class="stack" id="lim-form" novalidate><div class="card stack"><div class="row between"><div><h3>Limits for the engineering prompts</h3><p class="small muted">${set} of ${K.LIMITS.length} entered.</p></div><button class="btn lime sm" id="lim-save">Save limits</button></div>
      <div class="note warn small"><b>Enter only figures supplied by your responsible engineer.</b> The app has no limits of its own. A blank limit means the prompt only asks for a review. A figure here doesn't make a design safe or compliant, and prompts inside a limit are not an approval.</div>
      <div class="grid2"><label class="field"><span>Standard or code these come from</span><input class="in" id="lim-standard" value="${esc(cur.standard || "")}" maxlength="120"></label><label class="field"><span>Supplied by (engineer's name)</span><input class="in" id="lim-by" value="${esc(cur.suppliedBy || "")}" maxlength="120"></label></div>
      ${cur.updatedAt ? `<p class="tiny muted">Last saved ${esc(String(cur.updatedAt).slice(0, 10))} by ${esc(cur.updatedBy || "an administrator")}.</p>` : ""}</div>
      ${Object.entries(groups).map(([g, list]) => `<div class="card stack"><h3>${esc(g)}</h3><div class="grid2">${list.map((l) => `<label class="field"><span>${esc(l.label)}</span><div class="unit"><input class="in num" type="number" step="any" min="0" data-lim="${esc(l.key)}" value="${typeof cur[l.key] === "number" ? cur[l.key] : ""}" placeholder="Not set"><em>${esc(l.unit)}</em></div></label>`).join("")}</div></div>`).join("")}</form>`;
    $("#lim-form", B).onsubmit = async (e) => { e.preventDefault(); const next = {}; for (const inp of $$("[data-lim]", B)) { const t = inp.value.trim(); if (t === "") continue; const v = +t; if (!isFinite(v) || v < 0) return U.toast(`Check the figure for "${inp.closest("label").querySelector("span").textContent}".`, { err: true }); next[inp.dataset.lim] = v; }
      next.standard = $("#lim-standard", B).value.trim(); next.suppliedBy = $("#lim-by", B).value.trim(); next.updatedAt = new Date().toISOString(); next.updatedBy = U.userInfo().name || "administrator";
      if (Object.keys(next).some((k) => K.LIMITS.some((l) => l.key === k)) && !next.suppliedBy && !next.standard && !(await U.ask("Save without a source?", "<p>These limits don't say where they came from. Everyone will see that on the prompts.</p>", [{ label: "Go back", value: false, cls: "ghost" }, { label: "Save anyway", value: true }]))) return;
      try { const fresh = (await DPStore.getConfig("settings")) || {}, merged = Object.assign({}, fresh, { engineeringLimits: next }); await DPStore.setConfig("settings", merged); App.config.settings = U.deepMerge(JSON.parse(JSON.stringify(U.DEFAULT_SETTINGS)), merged); if (root.DPAuth && DPAuth.adminLog) DPAuth.adminLog("Updated engineering limits", { detail: `${K.LIMITS.filter((l) => l.key in next).length} entered; standard: ${next.standard || "not given"}; supplied by: ${next.suppliedBy || "not given"}` }).catch(() => {}); U.toast("Limits saved."); renderLimits(B); }
      catch (x) { U.toast("They could not be saved: " + (x.message || x.code), { err: true }); } };
  }
  root.DPAdmin3D = { render, renderLimits, parseColours, FILE_OK };
})(typeof self !== "undefined" ? self : this);
