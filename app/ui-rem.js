/* X FORCE 1.3 (Dupedia) — Reminders page, the reusable "Remind me" dialog and notification pop-up preferences. */
/* global DPUI, DPLive, DPAuth, DPNotify, DPShell */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc } = U, R = () => root.DPLive;
  const local = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const when = (iso) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  /** The "Remind me" dialog. ref = {kind, id, label, link} ties the reminder to a lead, order, payment, machine… */
  async function dialog(pre = {}, done) {
    const admin = U.isAdmin(), people = admin ? DPAuth.A.directory.filter((r) => r.uid && r.active !== false) : [];
    const d0 = pre.due || new Date(Date.now() + 3600e3).toISOString();
    const f = await U.form(pre.id ? "Edit reminder" : "Set a reminder", [{ id: "title", label: "What to do *", value: pre.title || "", required: true }, { id: "kind", label: "Type", type: "select", value: pre.kind || "followup", options: Object.entries(R().KINDS).map(([k, l]) => ({ value: k, label: l })) },
      { id: "due", label: "When *", type: "datetime-local", value: local(d0), required: true }, { id: "priority", label: "Priority", type: "select", value: pre.priority || "normal", options: Object.entries(R().PRIORITY).map(([k, l]) => ({ value: k, label: l })) },
      { id: "repeat", label: "Repeat", type: "select", value: pre.repeat || "none", options: Object.entries(R().REPEAT).map(([k, l]) => ({ value: k, label: l })) }].concat(admin ? [{ id: "uid", label: "Responsible person", type: "select", value: pre.uid || DPAuth.A.me.id, options: people.map((r) => ({ value: r.uid, label: DPAuth.fullName(r) })) }] : [])
      .concat([{ id: "notes", label: "Notes", type: "textarea", value: pre.notes || "" }]), { submit: "Save reminder", intro: pre.ref ? `For: <b>${esc(pre.ref.label || "")}</b>` : "" });
    if (!f) return null;
    try { const r = await R().saveReminder(Object.assign({}, pre, { title: f.title, kind: f.kind, due: new Date(f.due).toISOString(), priority: f.priority, repeat: f.repeat, notes: f.notes, uid: f.uid || pre.uid })); U.toast("Reminder saved."); done && done(r); return r; }
    catch (e) { U.toast(e.message, { err: true }); return null; }
  }
  const RF = { show: "open" };
  async function render() {
    const V = $("#view-reminders");
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">My work</span><h1><em>Reminders</em></h1><p class="lead small">Call-backs, follow-ups, promised dates, collections, approvals and maintenance. Reminders are kept on the server: they pop up on any device where you are signed in and stay here while overdue.</p></div>
      <div class="row"><button class="btn ghost sm" id="rm-pref">Pop-up settings…</button><button class="btn lime sm" id="rm-new">${U.svg("plus")} New reminder</button></div></div>
      <div class="seg" id="rm-tabs">${[["open", "Open"], ["overdue", "Overdue"], ["done", "Done"], ["all", "All"]].map(([k, l]) => `<button type="button" data-s="${k}" class="${RF.show === k ? "is-on" : ""}">${l}</button>`).join("")}</div><div id="rm-list"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $$("[data-s]", V).forEach((b) => (b.onclick = () => { RF.show = b.dataset.s; render(); }));
    $("#rm-new").onclick = () => dialog({}, render); $("#rm-pref").onclick = prefsDialog;
    const l = (await R().loadReminders()).sort((a, b) => R().dueAt(a).localeCompare(R().dueAt(b)));
    const rows = l.filter((r) => RF.show === "all" || (RF.show === "overdue" ? R().isOverdue(r) : RF.show === "open" ? r.status === "open" : r.status !== "open"));
    $("#rm-list").innerHTML = rows.length ? `<div class="rlist">${rows.map((r) => { const od = R().isOverdue(r); return `<div class="ritem ${od ? "od" : ""} ${r.status}"><div><b>${esc(r.title)}</b>${r.priority !== "normal" ? ` <span class="pill ${r.priority === "urgent" || r.priority === "high" ? "warn" : ""}">${esc(R().PRIORITY[r.priority])}</span>` : ""}
      <div class="tiny muted">${esc(R().KINDS[r.kind] || "")}${r.ref ? " · " + esc(r.ref.label || "") : ""} · ${od ? `<b class="neg">overdue since ${esc(when(R().dueAt(r)))}</b>` : esc(when(R().dueAt(r)))}${r.repeat !== "none" ? " · " + esc(R().REPEAT[r.repeat]) : ""}${r.status !== "open" ? " · " + esc(r.status) : ""}</div>${r.notes ? `<div class="small">${esc(r.notes)}</div>` : ""}
      <details class="tiny"><summary>History (${(r.history || []).length})</summary>${(r.history || []).map((h) => `<div>${esc(new Date(h.at).toLocaleString())} · ${esc(DPAuth.nameSync(h.by) || "")} · ${esc(h.action)}</div>`).join("")}</details></div>
      <div class="row" style="gap:4px;flex-wrap:wrap">${r.status === "open" ? `<button class="btn lime xs" data-a="done" data-id="${esc(r.id)}">Done</button><button class="btn ghost xs" data-a="s60" data-id="${esc(r.id)}">Snooze 1 h</button><button class="btn ghost xs" data-a="s1d" data-id="${esc(r.id)}">Tomorrow</button><button class="btn ghost xs" data-a="edit" data-id="${esc(r.id)}">Edit / reschedule</button><button class="btn ghost xs" data-a="cancel" data-id="${esc(r.id)}">Cancel</button>` : `<button class="btn ghost xs" data-a="reopen" data-id="${esc(r.id)}">Reopen</button>`}${r.ref && r.ref.link ? `<button class="btn ghost xs" data-a="open" data-id="${esc(r.id)}">Open record</button>` : ""}</div></div>`; }).join("")}</div>` : `<div class="empty">Nothing here.</div>`;
    $$("[data-a]", V).forEach((b) => (b.onclick = async () => { const r = l.find((x) => x.id === b.dataset.id), a = b.dataset.a;
      try { if (a === "edit") return dialog(r, render); if (a === "open") return U.go(r.ref.link.view, r.ref.link.opts || {});
        await R().actOn(r, a === "s60" || a === "s1d" ? "snooze" : a, a === "s60" ? 60 : a === "s1d" ? 1440 : ""); render(); } catch (e) { U.toast(e.message, { err: true }); } }));
  }
  async function prefsDialog() {
    const p = await R().loadPrefs(), C = DPNotify.CATEGORIES;
    U.openModal(`<h2>Pop-up settings</h2><p class="small muted">Choose which notifications pop up on screen. Everything still arrives in the Notification Center. Urgent alerts and work assigned to you always pop up.</p>
      <div class="stack">${Object.entries(C).filter(([k]) => k !== "all").map(([k, l]) => `<label class="check"><input type="checkbox" data-c="${k}" ${(p.popups || {})[k] === false ? "" : "checked"}> ${esc(l)}</label>`).join("")}
      <label class="check"><input type="checkbox" id="pp-dnd" ${p.dnd ? "checked" : ""}> Do not disturb (only urgent pop-ups)</label></div>
      <div class="acts"><button class="btn ghost" id="pp-x">Cancel</button><button class="btn lime" id="pp-ok">Save</button></div>`, (m) => {
      $("#pp-x", m).onclick = () => U.closeModal();
      $("#pp-ok", m).onclick = async () => { const pop = {}; $$("[data-c]", m).forEach((c) => (pop[c.dataset.c] = c.checked)); try { await R().savePrefs({ popups: pop, dnd: $("#pp-dnd", m).checked }); U.closeModal(); U.toast("Saved."); } catch (e) { U.toast(e.message, { err: true }); } };
    });
  }
  U.register("reminders", render);
  root.DPRemUI = { dialog, render, prefsDialog };
})(typeof self !== "undefined" ? self : this);
