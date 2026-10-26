/* Dupedia Site Planner 2.1 — boot: storage → sign-in gate → app. The app never opens before the gate resolves a signed-in, active user. */
/* global DPUI, DPStore, DPModel, DPShell */
(function () {
  "use strict";
  const U = DPUI, M = DPModel, { $, $$, App } = U;
  async function boot() {
    $("#app").hidden = true;
    $("#gate").hidden = false; $("#gate").innerHTML = `<div class="gwrap"><div class="empty"><div class="spinner"></div>Starting Site Planner…</div></div>`;
    const forceLocal = /[?&]local=1/.test(location.search);
    await DPStore.init({ forceLocal });
    $("#go-home").onclick = () => DPShell.nav("dash");
    $("#btn-back").onclick = () => DPShell.nav("home");
    $$("#flow button").forEach((b) => (b.onclick = () => U.go(b.dataset.view)));
    $("#btn-save").onclick = () => U.save();
    $("#role-badge").onclick = () => U.go("profile");
    $("#pname").onchange = (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = M.S.project.meta.name; return; } M.S.project.meta.name = v; M.commit("Rename", { audit: { action: "Renamed", detail: v } }); U.scheduleAutosave(); U.header(); };
    window.addEventListener("beforeunload", (e) => { if (App.open && M.S.dirty && !App.sample && U.canWrite()) { U.save({ auto: true }); e.preventDefault(); e.returnValue = ""; } });
    M.on("dirty", () => { if (App.view !== "plan") U.scheduleAutosave(); });
    await DPShell.gate();
  }
  boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML("beforeend", `<div class="toast err" style="position:fixed;left:16px;bottom:16px">The planner could not start: ${String(e && e.message || e)}</div>`); });
})();
