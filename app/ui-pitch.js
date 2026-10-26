/* X FORCE 1.1 (Dupedia) — Sales pitch coaching, shown in the floating Sales Assistant (Sales Pitches tab). It no longer covers
   the plan: when two or more products are on the open plan a tip is ready and the assistant icon shows a small marker.
   It picks a pitch for the customer profile and what is already placed, and suggests a relevant addition. Nothing it does
   reloads or replaces the plan: "Add suggested product" places one item through the normal planner actions (undoable). */
/* global DPUI, DPModel, DPPitch, DPCat */
(function (root) {
  "use strict";
  const U = DPUI, M = DPModel, S = M.S, { $, esc, App } = U;
  const K = { recent: [], cur: null, hidden: {}, pid: null, prof: "", box: null };
  const inPlan = () => App.open && S.project && ["plan", "quote", "review", "setup"].includes(App.view);
  const profileOf = () => (inPlan() && S.project.meta && (S.project.meta.customerProfile || DPPitch.FROM_TYPE[S.project.meta.type])) || K.prof || "";
  /** A plan-specific tip is ready (two or more products placed, not dismissed for this project). */
  function tipReady() { return !!(App.open && S.project && App.view === "plan" && U.canWrite() && ["employee", "admin"].includes(U.role()) && DPPitch.productCount(S.project) >= 2 && !K.hidden[S.project.meta.id]); }
  function sync() {
    if (S.project && S.project.meta && K.pid !== S.project.meta.id) { K.pid = S.project.meta.id; K.cur = null; }
    if (root.DPAssist) root.DPAssist.tip(tipReady());
    if (K.box && K.box.isConnected) draw();
  }
  function next() {
    const prof = profileOf(), proj = inPlan() ? S.project : null; K.cur = prof ? DPPitch.pick(prof, proj, K.recent) : DPPitch.general(proj, K.recent);
    if (K.cur) K.recent = K.recent.filter((x) => x !== K.cur.id).concat([K.cur.id]).slice(-12);
  }
  function addable(x) { if (!inPlan() || App.view !== "plan" || !U.canWrite()) return null; const a = x && x.upsell && x.upsell.add; if (!a) return null; if (a.code) { const p = DPCat.BY[a.code]; return p && p.dims ? { label: `${p.displayCode || p.code} ${p.name}`, run: () => DPUI.quickAddProduct(a.code) } : null; } if (a.el && DPCat.EL[a.el]) return { label: DPCat.EL[a.el].name, run: () => DPUI.placeElement(a.el) }; return null; }
  /** Render the pitch card into a container (the assistant panel). */
  function renderInto(box) { K.box = box; if (!K.cur) next(); draw(); }
  function draw() {
    const c = K.box; if (!c) return; const x = K.cur, prof = profileOf(), add = addable(x), plan = inPlan();
    c.innerHTML = `<div id="coach" class="coach-in">
      <p class="tiny muted">${plan ? `Tailored to <b>${esc(S.project.meta.name || "the open project")}</b>${DPPitch.productCount(S.project) >= 2 ? " and the products on the plan" : ""}.` : "Open a project in the Site Planner for pitches tailored to its plan."}</p>
      <label class="field"><span class="tiny">Customer profile</span><select class="in sm" id="co-prof"><option value="">${prof ? "" : "Select a profile for a tailored pitch…"}</option>${Object.entries(DPPitch.PROFILES).map(([k, l]) => `<option value="${k}"${prof === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      ${x ? `<div class="coach-b"><div class="row" style="gap:6px"><span class="pill">${esc(DPPitch.CATEGORIES[x.c])}</span>${prof ? "" : `<span class="pill warn">General pitch</span>`}</div>
        <p class="small"><b>Need:</b> ${esc(x.need)}</p><p class="small"><b>Why it fits:</b> ${esc(x.fit)}</p><p class="small"><b>Benefit:</b> ${esc(x.benefit)}</p>
        <p class="small"><b>Suggest:</b> ${esc(x.upsell.text)}</p><blockquote class="say">“${esc(x.say)}”</blockquote><p class="small"><b>Next step:</b> ${esc(x.close)}</p></div>
        <div class="row coach-a"><button type="button" class="btn lime xs" id="co-use">Use this pitch</button><button type="button" class="btn ghost xs" id="co-next">Try another</button>${add ? `<button type="button" class="btn ghost xs" id="co-add" title="${esc(add.label)}">${U.svg("plus")} Add suggested product</button>` : ""}${plan ? `<button type="button" class="btn ghost xs" id="co-x" title="No more tips for this project">Dismiss</button>` : ""}</div>
        <p class="tiny muted">${esc(x.id)} · claims limited to the catalogue; confirm specifications and terms before promising them.</p>` : `<p class="small muted">No pitch available.</p>`}</div>`;
    $("#co-prof", c).onchange = (e) => { const v = e.target.value || null; if (inPlan() && U.canWrite()) { S.project.meta.customerProfile = v; M.commit("Customer profile", { audit: { action: "Customer profile set", detail: DPPitch.PROFILES[v] || "none" } }); U.scheduleAutosave(); } else K.prof = v || ""; K.cur = null; next(); draw(); };
    const use = $("#co-use", c); if (use) use.onclick = async () => {
      let copied = false; try { await navigator.clipboard.writeText(x.say); copied = true; } catch (e) { copied = false; }
      if (inPlan() && U.canWrite()) { S.project.meta.pitchesUsed = (S.project.meta.pitchesUsed || []).concat([{ id: x.id, at: new Date().toISOString() }]).slice(-50); M.touch && M.touch(); U.scheduleAutosave(); }
      U.toast(copied ? `Customer sentence copied.${inPlan() ? " Pitch noted on the project." : ""}` : `${inPlan() ? "Pitch noted on the project. " : ""}Select the sentence to copy it.`, { ms: 5000 }); };
    const nx = $("#co-next", c); if (nx) nx.onclick = () => { next(); draw(); };
    const ad = $("#co-add", c); if (ad) ad.onclick = () => { add.run(); U.toast(`Added: ${add.label}. Undo with Ctrl/⌘+Z if you change your mind.`, { ms: 5000 }); };
    const dx = $("#co-x", c); if (dx) dx.onclick = () => { K.hidden[K.pid] = true; sync(); if (root.DPAssist) root.DPAssist.close(); U.toast("No more automatic tips for this project. The assistant is still one click away.", { ms: 4000 }); };
  }
  function show() { if (K.pid) delete K.hidden[K.pid]; if (root.DPAssist) root.DPAssist.open("pitch"); }
  M.on("change", () => setTimeout(sync, 0)); M.on("loaded", () => { K.cur = null; setTimeout(sync, 0); });
  const goOrig = U.go; DPUI.go = function (view, opts) { const r = goOrig.call(this, view, opts); setTimeout(sync, 0); return r; };
  root.DPCoach = { sync, show, renderInto, tipReady, state: K };
})(typeof self !== "undefined" ? self : this);
