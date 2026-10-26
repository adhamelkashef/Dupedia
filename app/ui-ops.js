/* X FORCE 1.0 (Dupedia) — payments UI, Call Tracker & follow-ups, Data Entry dashboard and research workspace. */
/* global DPUI, DPShell, DPStore, DPAuth, DPLeads, DPLeadOps, DPOrders, DPSales, DPPricing */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, O = DPOrders, LO = DPLeadOps;
  const F = { cq: "", co: "", sel: null, rq: "", rf: "todo" };

  /* ---------------- payment components ---------------- */
  const PST = { recorded: "warn", verified: "ok", rejected: "err" };
  function paymentListHtml(pays, cur, admin) {
    if (!pays.length) return `<p class="small muted">No payments recorded yet.</p>`;
    return `<div class="tablewrap"><table class="mtable"><thead><tr><th>Date</th><th class="r">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Receipt</th><th>Notes</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>
      ${pays.map((p) => `<tr><td class="small">${esc(p.date)}</td><td class="r">${esc(DPPricing.fmtMoney(p.amountMinor, cur))}</td><td class="small">${esc(p.method || "—")}</td><td class="small">${esc(p.ref || "—")}</td>
        <td><span class="pill ${PST[p.status || "recorded"] || ""}">${esc(O.PAY_STATUS[p.status || "recorded"])}</span></td>
        <td>${(p.files || []).length ? p.files.map((f, i) => `<button class="btn ghost xs" data-rcpt="${esc(f)}">View${p.files.length > 1 ? " " + (i + 1) : ""}</button>`).join(" ") : '<span class="tiny muted">none</span>'}</td>
        <td class="small">${esc(p.notes || "")}${p.statusNote ? `<div class="tiny muted">${esc(p.statusNote)}</div>` : ""}</td>
        ${admin ? `<td style="white-space:nowrap">${(p.status || "recorded") === "recorded" ? `<button class="btn lime xs" data-pv="${esc(p.id)}">Verify</button> <button class="btn ghost xs" data-px="${esc(p.id)}">Reject</button>` : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }
  function bindPaymentList(box, pays, { oid, admin, onStatus }) {
    if (!box) return;
    $$("[data-rcpt]", box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { const f = await O.receipt(oid, b.dataset.rcpt); if (!f) U.toast("The receipt is not available to you.", { err: true }); else DPUI.showFile(f, "Customer payment proof"); } finally { b.disabled = false; } }));
    if (!admin) return;
    $$("[data-pv]", box).forEach((b) => (b.onclick = async () => { if (await U.ask("Mark as verified?", "<p>Only when your bank confirms the funds have cleared.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Verified", value: true }])) onStatus(b.dataset.pv, "verified", ""); }));
    $$("[data-px]", box).forEach((b) => (b.onclick = async () => { const f = await U.form("Reject payment", [{ id: "n", label: "Reason (e.g. cheque bounced)", required: true }], { submit: "Reject" }); if (f) onStatus(b.dataset.px, "rejected", f.n); }));
  }
  /** Full-size view or download of an attachment held in an access-controlled document. */
  function showFile(f, kind = "Payment evidence") {
    if (!f) return U.toast("Not available.", { err: true });
    const isPdf = f.type === "application/pdf";
    U.openModal(`<div class="row between"><div><span class="eyebrow">${esc(kind)}</span><h2>${esc(f.name)}</h2></div><button class="btn ghost sm" id="sf-dl">${U.svg("export")} Download</button></div>
      ${isPdf ? `<p class="small muted">PDF document (${Math.round((f.size || 0) / 1024)} kB). Download it to view.</p>` : `<img src="${esc(f.dataUrl)}" alt="${esc(kind)}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:10px;background:var(--sunk)">`}
      <div class="acts"><button class="btn ghost" id="sf-x">Close</button></div>`, (m) => { $("#sf-x", m).onclick = () => U.closeModal();
      $("#sf-dl", m).onclick = async () => { const blob = dataUrlBlob(f.dataUrl); U.downloadOut({ blob, filename: f.name }, kind); }; }, { wide: true });
  }
  function dataUrlBlob(u) { const [h, b] = u.split(","), mime = (h.match(/data:([^;]+)/) || [])[1] || "application/octet-stream", bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime }); }
  /** Payment form with attachment preview; replace or remove the file before saving. */
  function paymentForm({ title, order, admin, onSubmit }) {
    let file = null;
    U.openModal(`<h2>${esc(title)}</h2><p class="small muted">${esc([order.ref || order.oid, order.name].filter(Boolean).join(" · "))}</p>
      <div class="grid3"><label class="field"><span>Payment amount (${esc(order.currency || "EGP")}) *</span><input class="in num" id="pf-a" type="number" step="0.01" min="0"></label><label class="field"><span>Payment date *</span><input class="in" id="pf-d" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="field"><span>Payment method</span><select class="in" id="pf-m">${O.payMethods().map((x) => `<option>${esc(x)}</option>`).join("")}</select></label></div>
      <div class="grid2"><label class="field"><span>Reference number</span><input class="in" id="pf-r"></label><label class="field"><span>Notes</span><input class="in" id="pf-n"></label></div>
      <div class="field"><span class="lbl">Payment proof — receipt, transfer screenshot or document (JPG, PNG, WebP or PDF, max 6 MB)</span><div class="row"><div id="pf-prev" class="thumbs"><span class="small muted">No file attached</span></div>
        <button type="button" class="btn ghost sm" id="pf-f">${U.svg("clip")} Attach…</button><button type="button" class="btn ghost sm" id="pf-rm" hidden>Remove</button></div></div>
      ${admin ? `<label class="check"><input type="checkbox" id="pf-v"> Funds already confirmed by the bank (mark as verified)</label>` : `<p class="tiny muted">Your payment is saved as <b>pending verification</b>. An administrator confirms it against the bank; until then it is not counted as collected cash.</p>`}
      <p class="small" id="pf-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="pf-x">Cancel</button><button class="btn lime" id="pf-ok">${admin ? "Save payment" : "Record payment"}</button></div>`, (m) => {
      const prev = () => { $("#pf-prev", m).innerHTML = file ? (file.type === "application/pdf" ? `<div class="th pdf">PDF</div><span class="small">${esc(file.name)}</span>` : `<img class="th" alt="Preview" src="${esc(file.dataUrl)}"><span class="small">${esc(file.name)} · ${Math.round(file.size / 1024)} kB</span>`) : `<span class="small muted">No file attached</span>`; $("#pf-rm", m).hidden = !file; $("#pf-f", m).textContent = file ? "Replace…" : "Attach…"; };
      $("#pf-f", m).onclick = () => U.pickFile(".jpg,.jpeg,.png,.webp,.pdf", async (f) => { $("#pf-err", m).textContent = ""; try { file = await O.prepareFile(f); prev(); } catch (e) { $("#pf-err", m).textContent = e.message; } });
      $("#pf-rm", m).onclick = () => { file = null; prev(); };
      $("#pf-x", m).onclick = () => U.closeModal();
      $("#pf-ok", m).onclick = async () => { const a = Math.round(+$("#pf-a", m).value * 100), d = $("#pf-d", m).value; if (!(a > 0) || !d) { $("#pf-err", m).textContent = "Enter the amount and the date."; return; }
        const b = $("#pf-ok", m); b.disabled = true; b.textContent = file ? "Uploading…" : "Saving…";
        try { await onSubmit({ date: d, amountMinor: a, method: $("#pf-m", m).value, ref: $("#pf-r", m).value.trim(), notes: $("#pf-n", m).value.trim(), files: file ? [file] : [], file, verified: admin && $("#pf-v", m).checked }); U.closeModal(); }
        catch (e) { $("#pf-err", m).textContent = e.message || "Not saved."; b.disabled = false; b.textContent = admin ? "Save payment" : "Record payment"; } };
    }, { wide: true });
  }

  /* Order Tracking (2.2) is now part of My Orders & Proposals. */
  function renderTracking() { U.go("proposals", { st: "accepted" }); }

  /* ---------------- Call Tracker ---------------- */
  const localDT = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  /** Log a call / activity. `leadId` may be preset. Predefined types, or "Custom activity" with your own description. */
  async function logDialog({ leadId = null, leads = null, onDone } = {}) {
    leads = leads || (await DPLeads.listLeads()).filter((l) => !["merged"].includes(l.status));
    const role = U.role(), types = role === "dataentry" ? ["call", "email", "research", "custom"] : Object.keys(LO.ACT_TYPES);
    U.openModal(`<h2>Log activity</h2>
      <div class="grid2"><label class="field"><span>Lead / customer *</span><select class="in" id="lg-l">${leads.map((l) => `<option value="${esc(l.id)}"${l.id === leadId ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Activity type *</span><select class="in" id="lg-t">${types.map((t) => `<option value="${t}">${esc(t === "custom" ? "Custom activity / write manually…" : LO.ACT_TYPES[t])}</option>`).join("")}</select></label></div>
      <label class="field" id="lg-cl" hidden><span>Describe the activity *</span><input class="in" id="lg-cu2" maxlength="120" placeholder="e.g. Showroom visit with the purchasing committee"></label>
      <div class="grid3" id="lg-callrow"><label class="field"><span>Contact person</span><input class="in" id="lg-c"></label><label class="field"><span>Direction</span><select class="in" id="lg-d"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
        <label class="field"><span>Date and time</span><input class="in" id="lg-at" type="datetime-local" value="${localDT()}"></label></div>
      <label class="field" id="lg-orow"><span>Outcome</span><select class="in" id="lg-o"><option value="">Choose…</option>${LO.OUTCOMES.map((o) => `<option>${esc(o)}</option>`).join("")}<option value="__custom">Other…</option></select></label>
      <label class="field" id="lg-crow" hidden><span>Custom outcome</span><input class="in" id="lg-cu"></label>
      <label class="field"><span>Notes / discussion summary</span><textarea class="in" id="lg-n" rows="3" placeholder="What was said, what was agreed, what you found"></textarea><small id="lg-q"></small></label>
      <label class="field"><span>Next action</span><input class="in" id="lg-na" maxlength="300" placeholder="e.g. Send revised layout with shade structure"></label>
      <div class="row"><label class="check"><input type="checkbox" id="lg-f"> Schedule a follow-up</label><input class="in" type="date" id="lg-fd" style="width:170px" hidden><input class="in" type="time" id="lg-ft" style="width:120px" value="10:00" hidden></div>
      <p class="tiny muted" id="lg-fh" hidden>You get a reminder before, at and after this time — in X FORCE, and from the hourly server check even when nobody has the app open.</p>
      <p class="small" id="lg-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="lg-x">Cancel</button><button class="btn lime" id="lg-ok">Log</button></div>`, (m) => {
      const t = $("#lg-t", m), sync = () => { const res = t.value === "research", cu = t.value === "custom"; $("#lg-callrow", m).hidden = res; $("#lg-orow", m).hidden = res || cu; $("#lg-cl", m).hidden = !cu; $("#lg-crow", m).hidden = res || cu || $("#lg-o", m).value !== "__custom"; hint(); };
      const val = () => ({ leadId: $("#lg-l", m).value, type: t.value, customLabel: $("#lg-cu2", m).value.trim(), contact: $("#lg-c", m).value.trim(), direction: $("#lg-d", m).value, outcome: ["research", "custom"].includes(t.value) ? "" : ($("#lg-o", m).value === "__custom" ? $("#lg-cu", m).value.trim() : $("#lg-o", m).value),
        notes: $("#lg-n", m).value, nextAction: $("#lg-na", m).value.trim(), at: $("#lg-at", m).value ? new Date($("#lg-at", m).value).toISOString() : new Date().toISOString(), followUp: $("#lg-f", m).checked, followUpDate: $("#lg-fd", m).value || null, followUpTime: $("#lg-ft", m).value || "10:00" });
      const hint = () => { const q = LO.qualifies(Object.assign({ at: new Date().toISOString() }, val())); $("#lg-q", m).textContent = q.ok ? "✓ Counts as a qualifying activity." : `Not a qualifying activity yet: ${q.why}.`; };
      t.onchange = sync; $("#lg-o", m).onchange = sync; $("#lg-n", m).oninput = hint; $("#lg-cu2", m).oninput = hint;
      $("#lg-f", m).onchange = () => { const on = $("#lg-f", m).checked; $("#lg-fd", m).hidden = $("#lg-ft", m).hidden = $("#lg-fh", m).hidden = !on; if (on && !$("#lg-fd", m).value) $("#lg-fd", m).value = new Date(Date.now() + 864e5).toISOString().slice(0, 10); }; sync();
      $("#lg-x", m).onclick = () => U.closeModal();
      $("#lg-ok", m).onclick = async () => { const v = val(), err = $("#lg-err", m); if (Date.parse(v.at) > Date.now() + 5 * 60e3) { err.textContent = "The date and time cannot be in the future."; return; }
        if (v.type === "custom" && !v.customLabel) { err.textContent = "Describe the activity."; return; }
        if (!["research", "custom"].includes(v.type) && !v.outcome) { err.textContent = "Choose the outcome."; return; } if (!String(v.notes).trim() && !["No Answer", "Busy", "Wrong Number"].includes(v.outcome)) { err.textContent = "Add a short note."; return; }
        if (v.followUp && !v.followUpDate) { err.textContent = "Choose the follow-up date."; return; }
        const b = $("#lg-ok", m); b.disabled = true;
        try { const r = await LO.logAct(v.leadId, v); U.closeModal(); U.toast(r.qualifying ? "Logged. It counts as qualifying activity." : `Logged — not counted as qualifying: ${r.why}.`, { ms: 6000 }); onDone && onDone(); }
        catch (e) { err.textContent = e.message; b.disabled = false; } };
    }, { wide: true });
  }
  /** Edit a logged activity (owner or administrator). Every change is kept in its history. */
  function editActDialog(a, done) {
    const mine = a.uid === DPStore.st.userId; if (!mine && !U.isAdmin()) return U.toast("You can only edit your own activities.", { err: true });
    const at = a.followUpAt ? new Date(a.followUpAt) : null, d0 = at ? localDT(at).slice(0, 10) : "", t0 = at ? localDT(at).slice(11, 16) : "10:00";
    U.openModal(`<h2>Edit activity</h2><p class="small muted">${esc(LO.actLabel(a))} · logged ${esc(new Date(a.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))} by ${esc(DPAuth.nameSync(a.uid) || "")}. The original entry and every change are kept.</p>
      ${a.type === "custom" ? `<label class="field"><span>Activity description</span><input class="in" id="ea-cl" value="${esc(a.customLabel || "")}"></label>` : ""}
      <div class="grid2"><label class="field"><span>Contact person</span><input class="in" id="ea-c" value="${esc(a.contact || "")}"></label>${["research", "custom"].includes(a.type) ? "" : `<label class="field"><span>Outcome</span><input class="in" id="ea-o" value="${esc(a.outcome || "")}" list="ea-ol"><datalist id="ea-ol">${LO.OUTCOMES.map((o) => `<option>${esc(o)}</option>`).join("")}</datalist></label>`}</div>
      <label class="field"><span>Notes</span><textarea class="in" id="ea-n" rows="3">${esc(a.notes || "")}</textarea></label>
      <label class="field"><span>Next action</span><input class="in" id="ea-na" value="${esc(a.nextAction || "")}"></label>
      <div class="grid3"><label class="check"><input type="checkbox" id="ea-f" ${a.followUp ? "checked" : ""}> Follow-up</label><input class="in" type="date" id="ea-fd" value="${esc(d0)}"><input class="in" type="time" id="ea-ft" value="${esc(t0)}"></div>
      <div class="grid2"><label class="field"><span>Follow-up status</span><select class="in" id="ea-fs">${Object.entries(LO.FU_STATUS).map(([k, l]) => `<option value="${k}"${(a.followUpStatus || "open") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label><label class="field"><span>Result</span><input class="in" id="ea-fr" value="${esc(a.followUpResult || "")}"></label></div>
      <label class="field"><span>Reason for the change${mine ? " (optional)" : " (required for corrections)"}</span><input class="in" id="ea-r"></label>
      ${(a.history || []).length ? `<details><summary class="small">History (${a.history.length})</summary><div class="tl">${a.history.slice().reverse().map((h) => `<div><span class="tiny muted">${esc(new Date(h.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span>${esc(DPAuth.nameSync(h.by) || "")}: ${Object.entries(h.changes || {}).map(([k, v]) => `${esc(k)} “${esc(String(v[0] == null ? "—" : v[0]).slice(0, 60))}” → “${esc(String(v[1] == null ? "—" : v[1]).slice(0, 60))}”`).join("; ") || "updated"}${h.reason ? " — " + esc(h.reason) : ""}</span></div>`).join("")}</div></details>` : ""}
      <p class="small" id="ea-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="ea-x">Cancel</button><button class="btn lime" id="ea-ok">Save changes</button></div>`, (m) => {
      $("#ea-x", m).onclick = () => U.closeModal();
      $("#ea-ok", m).onclick = async () => { const err = $("#ea-err", m), reason = $("#ea-r", m).value.trim(); if (!mine && !reason) { err.textContent = "Give the reason for the correction."; return; }
        const patch = { contact: $("#ea-c", m).value.trim(), notes: $("#ea-n", m).value.trim(), nextAction: $("#ea-na", m).value.trim(), followUp: $("#ea-f", m).checked, followUpDate: $("#ea-fd", m).value || null, followUpTime: $("#ea-ft", m).value || "10:00", followUpStatus: $("#ea-fs", m).value, followUpResult: $("#ea-fr", m).value.trim() };
        if ($("#ea-o", m)) patch.outcome = $("#ea-o", m).value.trim(); if ($("#ea-cl", m)) patch.customLabel = $("#ea-cl", m).value.trim();
        if (patch.followUp && !patch.followUpDate) { err.textContent = "Choose the follow-up date."; return; }
        try { await LO.editAct(a.uid, a.id, patch, reason); U.closeModal(); U.toast("Activity updated. The previous version is kept in its history."); done && done(); } catch (e) { err.textContent = e.message; } };
    }, { wide: true });
  }
  async function completeFuDialog(a, done) {
    const f = await U.form("Mark follow-up completed", [{ id: "r", label: "Result", type: "textarea", required: true, placeholder: "e.g. Client confirmed the meeting for Sunday" }, { id: "next", label: "Schedule another follow-up", type: "check", value: false }], { submit: "Complete" });
    if (!f) return; try { await LO.completeFollowUp(a.uid, a.id, f.r); U.toast("Follow-up completed."); if (f.next) return logDialog({ leadId: a.leadId, onDone: done }); done && done(); } catch (e) { U.toast(e.message, { err: true }); }
  }
  async function renderCalls(opts = {}) {
    if (opts && opts.fu) F.fu = opts.fu;
    const V = $("#view-calls"), me = DPStore.st.userId, per = H.curPer(), de = U.role() === "dataentry";
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">${de ? "Call Log" : "Calls & Follow-ups"}</span><h1>Every call, <em>logged</em>.</h1><p class="lead small">Calls, e-mails, meetings, visits and your own custom activities, attached to the lead they belong to. Open any entry to edit it — the original and every change stay in its history.</p></div>
      <div class="row"><button class="btn lime" id="cl-new">${U.svg("plus")} Log a call</button></div></div><div id="cl-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $("#cl-new").onclick = () => logDialog({ onDone: () => renderCalls() });
    const [leads] = await Promise.all([DPLeads.listLeads(), LO.loadActs()]), byId = Object.fromEntries(leads.map((l) => [l.id, l]));
    const f = LO.callFigures(me, per), fus = LO.followUps(me, { includeDone: F.fu === "done" });
    const fuList = F.fu === "done" ? fus.filter((x) => x.followUpStatus === "done") : fus.filter((x) => !F.fu || F.fu === "all" || x.when === F.fu);
    const mine = LO.LT.acts.filter((a) => a.uid === me && (!F.co || a.outcome === F.co) && (!F.cq || [(byId[a.leadId] || {}).name, a.contact, a.notes, a.customLabel].join(" ").toLowerCase().includes(F.cq.toLowerCase()))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const cnt = (k) => fus.filter((x) => x.when === k).length;
    $("#cl-body").innerHTML = `<div class="stack"><div class="stats">${de ? `${H.stat("Research calls", f.month, "this month")}${H.stat("Contacts verified", LO.dataEntryFigures(me, per, leads).verifiedThisMonth, "this month")}${H.stat("Wrong numbers", f.wrong, "this month")}${H.stat("Records updated", LO.dataEntryFigures(me, per, leads).updated, "this month")}`
        : `${H.stat("Calls today", f.today, "qualifying")}${H.stat("This month", f.month, "qualifying calls")}${H.stat("Contacts reached", f.reached, "this month")}${H.stat("Follow-ups overdue", cnt("overdue"), "", cnt("overdue") ? "hl" : "")}${H.stat("Meetings", f.meetings, "scheduled this month")}${H.stat("Qualified", f.qualified, "opportunities this month")}`}</div>
      <div class="card stack"><div class="row between"><h3>Follow-ups</h3><div class="seg">${[["", "Open"], ["overdue", `Overdue (${cnt("overdue")})`], ["today", `Today (${cnt("today")})`], ["upcoming", `Upcoming (${cnt("upcoming")})`], ["done", "Completed"]].map(([k, l]) => `<button type="button" data-fuf="${k}" class="${(F.fu || "") === k ? "is-on" : ""}">${l}</button>`).join("")}</div></div>
        ${fuList.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>When</th><th>Lead</th><th>Contact</th><th>Next action</th><th>Status</th><th></th></tr></thead><tbody>${fuList.map((a) => `<tr class="${a.id === opts.act ? "hl-row" : ""}"><td class="small"><b>${esc(new Date(a.followUpAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</b></td><td><b>${esc((byId[a.leadId] || {}).name || a.leadId)}</b></td><td class="small">${esc(a.contact || "")}</td><td class="small">${esc(a.nextAction || LO.actLabel(a))}</td>
          <td><span class="pill ${a.followUpStatus === "done" ? "ok" : a.when === "overdue" ? "err" : a.when === "today" ? "warn" : ""}">${esc(a.followUpStatus === "done" ? "Completed" : a.when === "overdue" ? "Overdue" : a.when === "today" ? "Today" : "Upcoming")}</span>${a.followUpResult ? `<div class="tiny muted">${esc(a.followUpResult)}</div>` : ""}</td>
          <td style="white-space:nowrap">${a.followUpStatus !== "done" ? `<button class="btn ghost xs" data-fc="${esc(a.leadId)}">Log call</button> <button class="btn ghost xs" data-ed="${esc(a.id)}">Edit</button> <button class="btn lime xs" data-fd="${esc(a.id)}">Done</button>` : `<button class="btn ghost xs" data-ed="${esc(a.id)}">Open</button>`}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">Nothing here.</p>`}</div>
      <div class="filters"><div class="search" style="width:240px"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="cl-q" placeholder="Search lead, contact, notes" value="${esc(F.cq)}"></div><select class="in sm" id="cl-o"><option value="">All outcomes</option>${LO.OUTCOMES.map((o) => `<option${F.co === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
      <div class="card" style="padding:0"><div class="tablewrap"><table class="mtable"><thead><tr><th>When</th><th>Lead</th><th>Activity</th><th>Contact</th><th>Outcome</th><th>Notes · next action</th><th>Counts</th><th></th></tr></thead><tbody>
      ${mine.slice(0, 300).map((a) => `<tr><td class="small">${esc(new Date(a.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</td><td><b>${esc((byId[a.leadId] || {}).name || a.leadId)}</b></td><td class="small">${esc(LO.actLabel(a))}${a.direction ? " · " + esc(a.direction) : ""}${(a.history || []).length ? ` <span class="pill" title="Edited">edited</span>` : ""}</td><td class="small">${esc(a.contact || "")}</td><td class="small">${esc(a.outcome || "—")}</td><td class="small">${esc(a.notes || "")}${a.nextAction ? `<div class="tiny muted">Next: ${esc(a.nextAction)}</div>` : ""}</td><td>${a.qualifying ? '<span class="pill ok">Yes</span>' : `<span class="pill" title="${esc(a.why || "")}">No</span>`}</td><td><button class="btn ghost xs" data-ed="${esc(a.id)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="8"><div class="empty small">Nothing logged yet.</div></td></tr>`}</tbody></table></div></div></div>`;
    $("#cl-q").oninput = (e) => { F.cq = e.target.value; clearTimeout(F.t); F.t = setTimeout(() => renderCalls(), 350); };
    $("#cl-o").onchange = (e) => { F.co = e.target.value; renderCalls(); };
    $$("[data-fuf]", V).forEach((b) => (b.onclick = () => { F.fu = b.dataset.fuf; renderCalls(); }));
    const find = (id) => LO.LT.acts.find((x) => x.id === id);
    $$("[data-ed]", V).forEach((b) => (b.onclick = () => editActDialog(find(b.dataset.ed), () => renderCalls())));
    $$("[data-fd]", V).forEach((b) => (b.onclick = () => completeFuDialog(find(b.dataset.fd), () => renderCalls())));
    $$("[data-fc]", V).forEach((b) => (b.onclick = () => logDialog({ leadId: b.dataset.fc, onDone: () => renderCalls() })));
    if (opts.act && !find(opts.act)) U.toast("That activity is no longer available.");
  }

  /* ---------------- Data Entry: dashboard ---------------- */
  async function renderDeDash() {
    const V = $("#view-dash"), me = U.me(), per = H.curPer(), pic = await H.picHtml(me.id, 72, "ring2");
    V.innerHTML = `<div class="page"><div class="phead"><div class="hello">${pic}<div><span class="eyebrow">${esc([me.title || me.roleLabel, me.department].filter(Boolean).join(" · "))} · ${esc(H.perLabel(per))}</span><h1>Hello, <em>${esc(me.firstName || "there")}</em>.</h1><p class="lead small" id="de-sum">Your research target and lead quality at a glance.</p></div></div>
      <div class="row"><button class="btn lime" id="de-go">${U.svg("leads")} Open Lead Research</button></div></div><div id="de-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $("#de-go").onclick = () => U.go("research");
    const [leads, staff, props] = await Promise.all([DPLeads.listLeads(), DPSales.staffDoc(me.id), LO.listProposals().catch(() => []), LO.loadActs()]);
    const f = LO.dataEntryFigures(me.id, per, leads), target = LO.dataEntryTarget(staff, per), frac = target ? f.completed / target : 0;
    const hist = DPSales.lastPeriods(6).map((p) => ({ l: H.perLabel(p).slice(0, 3) + " " + p.slice(2, 4), v: LO.dataEntryFigures(me.id, p, leads).completed }));
    $("#de-sum").textContent = `${f.completed} of ${target} completed leads this month (${Math.round(frac * 100)}%) · ${f.researchedToday} researched today.`;
    $("#de-body").innerHTML = `<div class="stack"><div class="dgrid"><div class="card stack corner"><div class="row between"><h3>Monthly target</h3><span class="tiny muted">Target ${target} completed leads</span></div>
        <div class="tgt">${H.ring(frac, "Target progress")}<div class="kv"><span>Monthly target</span><b>${target}</b><span>Completed</span><b>${f.completed}</b><span>Remaining</span><b>${Math.max(0, target - f.completed)}</b><span>Achievement</span><b>${Math.round(frac * 100)}%</b></div></div>
        <p class="tiny muted">A lead counts once, in the month it first meets the qualification requirements (customer category, location, source, a verified contact method, product fit and status “Qualified”). Editing the same lead again never adds to the count.</p></div>
        <div class="card stack"><h3>Completed leads, last six months</h3>${H.bars(hist, { fmt: (v) => String(v), target })}</div></div>
      <div class="stats">${H.stat("Researched today", f.researchedToday, "unique leads")}${H.stat("Verified phones", f.verifiedPhones, "open leads")}${H.stat("Verified e-mails", f.verifiedEmails, "open leads")}${H.stat("Awaiting research", f.awaiting, "not yet complete")}${H.stat("Duplicates flagged", f.duplicates, "for review")}${H.stat("Need correction", f.corrections, "requested by an administrator", f.corrections ? "hl" : "")}</div>
      <div class="stats">${H.stat("Research calls", f.researchCalls, "this month")}${H.stat("Contacts verified", f.verifiedThisMonth, "this month")}${H.stat("Wrong numbers", f.wrongNumbers, "this month")}${H.stat("Records updated", f.updated, "this month")}${H.stat("Awaiting review", props.filter((x) => x.uid === me.id && x.status === "proposed").length, "your proposed leads")}${H.stat("Incomplete records", f.awaiting, "open leads not yet complete")}</div>
      <div class="dgrid"><div class="card stack"><h3>Today's tasks</h3>${(() => { const C = LO.LT.contacts, open = leads.filter((l) => !["archived", "merged", "inactive"].includes(l.status));
          const corr = open.filter((l) => C[l.id] && C[l.id].needsCorrection && !C[l.id].needsCorrection.resolvedAt), dup = open.filter((l) => C[l.id] && C[l.id].dupOf), todo = open.filter((l) => !(C[l.id] && C[l.id].completedAt)).sort((a, b) => (+b.score || 0) - (+a.score || 0)).slice(0, 6);
          const unver = open.filter((l) => { const ct = Object.assign({}, l.contact || {}, (C[l.id] || {}).contact || {}); return (ct.phone && !ct.phoneVerified) || (ct.email && !ct.emailVerified); }).slice(0, 4);
          const item = (l, why) => `<div><span class="tiny muted">${esc(why)}</span><span><button class="linkbtn" data-rl="${esc(l.id)}">${esc(l.name)}</button></span></div>`;
          const all = corr.map((l) => item(l, "Correction")).concat(dup.map((l) => item(l, "Duplicate?")), unver.map((l) => item(l, "Verify contact")), todo.map((l) => item(l, "Research")));
          return all.length ? `<div class="tl">${all.slice(0, 14).join("")}</div>` : `<p class="small muted">Nothing open — great work.</p>`; })()}</div>
        <div class="card stack"><h3>Recent updates</h3>${(() => { const mine = Object.entries(LO.LT.contacts).filter(([, c]) => c.updatedBy === me.id).sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt))).slice(0, 8);
          return mine.length ? `<div class="tl">${mine.map(([id, c]) => `<div><span class="tiny muted">${esc(new Date(c.updatedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }))}</span><span>${esc((leads.find((l) => l.id === id) || {}).name || id)}${c.completedAt ? ' <span class="pill ok">complete</span>' : ""}</span></div>`).join("")}</div>` : `<p class="small muted">No updates yet.</p>`; })()}</div></div></div>`;
    $$("[data-rl]", V).forEach((b) => (b.onclick = () => { F.sel = b.dataset.rl; F.rf = "all"; U.go("research"); }));
  }

  /* ---------------- Data Entry: research workspace ---------------- */
  async function renderResearch() {
    const V = $("#view-research");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Lead Research</span><h1>Make every lead <em>callable</em>.</h1><p class="lead small">Find and verify contact details on the shared lead record. Your updates are visible at once to the lead's owner, sales and administrators — without taking ownership of the lead.</p></div>
      <div class="row"><button class="btn ghost sm" id="rs-prop">Propose a new lead…</button></div></div>
      <div class="split"><div class="stack"><div class="filters"><div class="search" style="width:100%"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="rs-q" placeholder="Search" value="${esc(F.rq)}"></div>
        <div class="seg">${[["todo", "To research"], ["corr", "Corrections"], ["done", "Complete"], ["all", "All"]].map(([k, l]) => `<button type="button" data-rf="${k}" class="${F.rf === k ? "is-on" : ""}">${l}</button>`).join("")}</div></div><div class="llist" id="rs-list"><div class="empty"><div class="spinner"></div></div></div></div><div id="rs-detail"></div></div></div>`;
    $("#rs-q").oninput = (e) => { F.rq = e.target.value; list(); };
    $$("[data-rf]", V).forEach((b) => (b.onclick = () => { F.rf = b.dataset.rf; renderResearch(); }));
    $("#rs-prop").onclick = proposeDlg;
    const [leads] = await Promise.all([DPLeads.listLeads(), LO.loadActs()]); F.leads = leads;
    list();
    function list() {
      const C = LO.LT.contacts, q = F.rq.trim().toLowerCase();
      const rows = F.leads.filter((l) => !["merged", "archived"].includes(l.status)).filter((l) => { const c = C[l.id] || {};
        if (F.rf === "todo" && c.completedAt) return false; if (F.rf === "done" && !c.completedAt) return false; if (F.rf === "corr" && !(c.needsCorrection && !c.needsCorrection.resolvedAt)) return false;
        return !q || [l.name, l.location, l.projects].join(" ").toLowerCase().includes(q); }).sort((a, b) => ((C[a.id] || {}).needsCorrection ? -1 : 0) - ((C[b.id] || {}).needsCorrection ? -1 : 0) || (+b.score || 0) - (+a.score || 0));
      if (!F.sel || !rows.some((l) => l.id === F.sel)) F.sel = rows[0] ? rows[0].id : null;
      $("#rs-list").innerHTML = rows.map((l) => { const c = C[l.id] || {}, cl = DPLeads.contactLabel(l); return `<button type="button" data-sel="${esc(l.id)}" class="${F.sel === l.id ? "is-on" : ""}"><span class="row between"><b>${esc(l.name)}</b>${c.completedAt ? '<span class="pill ok">Complete</span>' : c.needsCorrection && !c.needsCorrection.resolvedAt ? '<span class="pill err">Correction</span>' : ""}</span>
        <span class="tiny muted">${esc(cl.label)}${c.lastResearchedAt ? " · researched " + esc(H.dateS(c.lastResearchedAt)) : ""}</span></button>`; }).join("") || `<div class="empty small">Nothing here.</div>`;
      $$("[data-sel]", $("#rs-list")).forEach((b) => (b.onclick = () => { F.sel = b.dataset.sel; list(); }));
      detail();
    }
    async function detail() {
      const B = $("#rs-detail"), l = F.leads.find((x) => x.id === F.sel); if (!B) return; if (!l) { B.innerHTML = ""; return; }
      const c = LO.LT.contacts[l.id] || {}, ct = Object.assign({}, l.contact || {}, c.contact || {}), comp = LO.completeness(l, c), own = DPLeads.ownership(l, ((await DPLeads.claimsByLead(l.id))[l.id]) || []);
      const log = await LO.contactLog(l.id), acts = LO.actsFor(l.id);
      B.innerHTML = `<div class="card stack corner"><div><span class="eyebrow">${esc(DPLeads.ORG_TYPES[l.orgType] || "")} · ${esc(l.location || "")}${own.owner ? " · owned by " + esc(DPAuth.nameSync(own.owner)) : ""}</span><h2>${esc(l.name)}</h2></div>
        ${c.needsCorrection && !c.needsCorrection.resolvedAt ? `<div class="note err small"><b>Correction requested</b> by ${esc(DPAuth.nameSync(c.needsCorrection.by))}: ${esc(c.needsCorrection.note)}</div>` : ""}
        <div class="note ${comp.complete ? "ok" : ""} small">${comp.complete ? `<b>Complete.</b>${c.completedAt ? ` Counted for ${esc(DPAuth.nameSync(c.completedBy))} on ${esc(H.dateS(c.completedAt))}.` : ""}` : `<b>Still missing:</b> ${esc(comp.missing.join(", "))}.`}</div>
        <div class="kv"><span>Assigned salesperson</span><span>${own.owner ? esc(DPAuth.nameSync(own.owner)) : "Not owned (in the Lead Mine)"}</span><span>Research date</span><span>${esc(c.researchDate || "—")}</span><span>Last verified</span><span>${esc(c.lastVerifiedAt ? H.dateS(c.lastVerifiedAt) : "Never")}</span></div>
        <form class="stack" id="rs-f"><div class="grid3"><label class="field"><span>Customer category</span><select class="in" id="rs-cat"><option value="">—</option>${Object.entries(DPLeads.ORG_TYPES).map(([k, lb]) => `<option value="${k}"${(c.orgType || l.orgType) === k ? " selected" : ""}>${esc(lb)}</option>`).join("")}</select></label><label class="field"><span>Project name</span><input class="in" id="rs-pn" value="${esc(c.projectName || "")}"></label>
            <label class="field"><span>Qualification status</span><select class="in" id="rs-qs">${Object.entries(LO.QUAL_STATUS).map(([k, lb]) => `<option value="${k}"${(c.qualification || "new") === k ? " selected" : ""}>${esc(lb)}</option>`).join("")}</select></label></div>
          <div class="grid2"><label class="field"><span>City</span><input class="in" id="rs-city" value="${esc(c.city || "")}"></label><label class="field"><span>Area / district</span><input class="in" id="rs-area" value="${esc(c.area || "")}"></label></div>
          <div class="grid2"><label class="field"><span>Contact person</span><input class="in" id="rs-n" value="${esc(ct.name || "")}"></label><label class="field"><span>Job title</span><input class="in" id="rs-t" value="${esc(ct.title || "")}"></label></div>
          <div class="grid2"><div class="field"><span class="lbl">Telephone</span><input class="in" id="rs-p" value="${esc(ct.phone || "")}" placeholder="+20 …"><label class="check small"><input type="checkbox" id="rs-pv" ${ct.phoneVerified ? "checked" : ""}> Verified (called and confirmed)</label></div>
            <div class="field"><span class="lbl">E-mail</span><input class="in" id="rs-e" value="${esc(ct.email || "")}"><label class="check small"><input type="checkbox" id="rs-ev" ${ct.emailVerified ? "checked" : ""}> Verified</label></div></div>
          <div class="grid2"><label class="field"><span>Company website</span><input class="in" id="rs-w" value="${esc(c.website || l.website || "")}" placeholder="https://"></label><label class="field"><span>Source of the contact details *</span><input class="in" id="rs-s" value="${esc(ct.source || "")}" placeholder="URL, LinkedIn page, call to switchboard on …"></label></div>
          <label class="field"><span>Add a source URL (optional)</span><input class="in" id="rs-src" placeholder="https://… (news, project page)"></label>
          <label class="field"><span>Dupedia product fit (what to lead with)</span><input class="in" id="rs-fit" value="${esc(c.productsFit || l.productsFit || "")}" placeholder="e.g. outdoor playground for the compound's central park"></label>
          <label class="field"><span>Research notes</span><textarea class="in" id="rs-r" rows="3">${esc(c.researchNotes || "")}</textarea></label>
          <div class="row"><label class="check small"><input type="checkbox" id="rs-dup" ${c.dupOf ? "checked" : ""}> Possible duplicate of</label><select class="in sm" id="rs-dupof" style="max-width:260px"><option value="">—</option>${F.leads.filter((x) => x.id !== l.id).map((x) => `<option value="${esc(x.id)}"${c.dupOf === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
          <p class="small" id="rs-err" style="color:var(--red)"></p><div class="row"><button class="btn lime">Save to the lead</button><button type="button" class="btn ghost" id="rs-call">${U.svg("phone")} Log research call</button>${U.isAdmin() ? `<button type="button" class="btn ghost" id="rs-corr">Request correction…</button>` : ""}</div></form>
        <h4>Change history</h4>${log.length ? `<div class="tl">${log.slice(0, 20).map((x) => `<div><span class="tiny muted">${esc(new Date(x.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span>${esc(DPAuth.nameSync(x.by) || "—")}: ${esc((x.fields || []).join(", ") || "updated")}${x.note ? " — " + esc(x.note) : ""}</span></div>`).join("")}</div>` : `<p class="small muted">No contact updates yet.</p>`}
        <h4>Activity timeline</h4>${acts.length ? `<div class="tl">${acts.slice(0, 20).map((a) => `<div><span class="tiny muted">${esc(new Date(a.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span><span><b>${esc(LO.ACT_TYPES[a.type])}</b> by ${esc(DPAuth.nameSync(a.uid) || "—")}${a.outcome ? " · " + esc(a.outcome) : ""}${a.notes ? " — " + esc(a.notes) : ""}</span></div>`).join("")}</div>` : `<p class="small muted">No activity yet.</p>`}</div>`;
      $("#rs-f").onsubmit = async (e) => { e.preventDefault(); const err = $("#rs-err"); err.textContent = "";
        const src = $("#rs-src").value.trim(); if (src && !/^https?:\/\//.test(src)) { err.textContent = "Source URLs start with https://"; return; }
        const w = $("#rs-w").value.trim(); if (w && !/^https?:\/\//.test(w)) { err.textContent = "The website starts with https://"; return; }
        const patch = { contact: { name: $("#rs-n").value.trim(), title: $("#rs-t").value.trim(), phone: $("#rs-p").value.trim(), email: $("#rs-e").value.trim(), phoneVerified: $("#rs-pv").checked && !!$("#rs-p").value.trim(), emailVerified: $("#rs-ev").checked && !!$("#rs-e").value.trim(), source: $("#rs-s").value.trim() },
          website: w, researchNotes: $("#rs-r").value.trim(), dupOf: $("#rs-dup").checked ? ($("#rs-dupof").value || "unknown") : null,
          orgType: $("#rs-cat").value || null, projectName: $("#rs-pn").value.trim(), city: $("#rs-city").value.trim(), area: $("#rs-area").value.trim(), qualification: $("#rs-qs").value, productsFit: $("#rs-fit").value.trim() || null };
        const dups = LO.duplicatesOf(l.id, l.name, patch.contact, F.leads);
        if (dups.length && !patch.dupOf) { const ok = await U.ask("Possible duplicate", `<p>These records share the company name, phone or e-mail:</p><ul>${dups.slice(0, 5).map((d) => `<li>${esc(d.name)}</li>`).join("")}</ul><p>Save anyway, or flag this lead as a possible duplicate for an administrator?</p>`, [{ label: "Cancel", value: null, cls: "ghost" }, { label: "Flag as duplicate", value: "flag", cls: "ghost" }, { label: "Save anyway", value: "save" }]); if (!ok) return; if (ok === "flag") patch.dupOf = dups[0].id; }
        if (src) patch.extraSources = (c.extraSources || []).concat([{ url: src, date: new Date().toISOString().slice(0, 10), by: DPStore.st.userId }]);
        if (c.needsCorrection && !c.needsCorrection.resolvedAt) patch.needsCorrection = Object.assign({}, c.needsCorrection, { resolvedAt: new Date().toISOString(), resolvedBy: DPStore.st.userId });
        try { const out = await LO.saveContact(l.id, patch, ""); F.leads = await DPLeads.listLeads(); U.toast(out.completedAt && !c.completedAt ? "Saved — this lead is now complete and counts towards your target." : "Saved to the shared lead record."); list(); } catch (x) { err.textContent = x.message; } };
      $("#rs-call").onclick = () => logDialog({ leadId: l.id, leads: F.leads, onDone: detail });
      const corr = $("#rs-corr"); if (corr) corr.onclick = async () => { const f = await U.form("Request correction", [{ id: "n", label: "What needs correcting", required: true, type: "textarea" }], { submit: "Send to data entry" }); if (f) { await LO.requestCorrection(l.id, f.n); await LO.loadContacts(); U.toast("Correction requested."); detail(); } };
    }
  }
  async function proposeDlg() {
    const f = await U.form("Propose a new lead", [{ id: "name", label: "Organisation", required: true }, { id: "orgType", label: "Organisation type", type: "select", value: "developer", options: Object.entries(DPLeads.ORG_TYPES).map(([k, l]) => ({ value: k, label: l })) },
      { id: "location", label: "City / region" }, { id: "website", label: "Website" }, { id: "projects", label: "Relevant projects", type: "textarea" }, { id: "url", label: "Source URL (news, project page) *", required: true }, { id: "date", label: "Source date", type: "date" }],
      { intro: "An administrator reviews the proposal and adds it to the Lead Mine.", submit: "Propose" });
    if (!f) return; if (!/^https?:\/\//.test(f.url)) return U.toast("The source must be a web address.", { err: true });
    try { await LO.proposeLead({ name: f.name.trim(), orgType: f.orgType, location: f.location, website: f.website, projects: f.projects, sources: [{ url: f.url, date: f.date || "" }], status: "research" }); U.toast("Proposed. An administrator will review it."); } catch (e) { U.toast(e.message, { err: true }); }
  }

  U.register("tracking", renderTracking); U.register("calls", renderCalls); U.register("research", renderResearch);
  Object.assign(DPUI, { paymentListHtml, bindPaymentList, paymentForm, showFile, logDialog, editActDialog, completeFuDialog, renderDeDash });
})(typeof self !== "undefined" ? self : this);
