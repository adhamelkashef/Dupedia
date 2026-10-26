/* Dupedia Site Planner 2.2 — User Management, Employees (targets & performance), My Profile. */
/* global DPUI, DPShell, DPStore, DPAuth, DPLeads, DPSales, DPLeadOps, DPOrders */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, H = DPShell, A = DPAuth;
  const roleLabel = (id) => (A.roleOf(id) || {}).label || id;

  /* ---------------- User Management ---------------- */
  async function renderUsers() {
    const V = $("#view-users"), cloud = DPStore.st.mode === "cloud";
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>User <em>management</em></h1><p class="lead small">${root.XFServer ? "Self-hosted server: each person signs in with a username and password. Add them here with a temporary password; their role sets what the server lets them read and write." : cloud ? "People sign in with their claude.ai account. Add colleagues here (or approve their access request), choose their role, and share this page with them at the matching level." : "Local demonstration accounts (this browser only)."}</p></div>
      <div class="row"><button class="btn ghost sm" id="um-roles">Roles…</button><button class="btn lime sm" id="um-add">${U.svg("plus")} Add user</button></div></div>
      ${root.XFServer ? `<div class="note small"><b>One step gives someone access:</b> add them here. Administrators get administrator data; everyone else gets staff access, limited to their own records. Deactivating someone here ends their sessions and blocks sign-in at once.</div>` : cloud ? `<div class="note small"><b>Two steps give someone access.</b> 1. Add them here (Dupedia role). 2. Share this page with them: <b>Contributor</b> for employees, <b>Editor</b> for administrators. The database grants data by sharing level, so an employee shared as Editor could read administrator data — keep employees at Contributor. To remove access, deactivate here <b>and</b> remove them from the share menu.</div>` : `<div class="note warn small"><b>Local demonstration.</b> Passwords are stored as salted PBKDF2 hashes in this browser, but anyone with access to this device's browser storage can change data. Not suitable for real accounts.</div>`}
      <div id="um-req"></div><div class="card" style="padding:0"><div class="tablewrap" id="um-list"><div class="empty"><div class="spinner"></div></div></div></div></div>`;
    $("#um-add").onclick = addUser; $("#um-roles").onclick = rolesDlg;
    const [dir, reqs, acts] = await Promise.all([A.listDirectory(), A.processRequests(), Promise.all(A.A.directory.filter((r) => r.uid).map((r) => DPStore.tryGet(`activity/${r.uid}`).then((a) => [r.uid, a])))]);
    const act = Object.fromEntries(acts);
    App.badges = Object.assign(App.badges || {}, { requests: reqs.open.length }); H.rail();
    const names = reqs.open.length ? await A.names(reqs.open.map((r) => r.uid)) : {};
    $("#um-req").innerHTML = reqs.open.length ? `<div class="card stack"><h3>Access requests</h3>${reqs.open.map((r) => `<div class="row between"><div><b>${esc(names[r.uid] || "Unknown person")}</b> <span class="small muted">${esc(H.dateS(r.at))}</span><div class="small">${esc(r.message || "")}</div></div><div class="row"><button class="btn sm" data-grant="${esc(r.uid)}">Create account…</button><button class="btn ghost sm" data-deny="${esc(r.uid)}">Dismiss</button></div></div>`).join("")}</div>` : "";
    $$("[data-grant]", V).forEach((b) => (b.onclick = () => addUser({ uid: b.dataset.grant, name: names[b.dataset.grant] === "Unknown person" ? "" : names[b.dataset.grant] })));
    $$("[data-deny]", V).forEach((b) => (b.onclick = async () => { await DPStore.del(`requests/${b.dataset.deny}`); await A.adminLog("Dismissed access request", { target: b.dataset.deny }); renderUsers(); }));
    const rows = dir.slice().sort((a, b) => (a.active === false) - (b.active === false) || A.fullName(a).localeCompare(A.fullName(b)));
    const hrs = Object.fromEntries(await Promise.all(rows.filter((r) => r.uid).map((r) => DPStore.tryGet(`staff/${r.uid}`).then((d) => [r.uid, (d && d.hr) || {}]))));
    const pics = Object.fromEntries(await Promise.all(rows.map((r) => A.avatarUrl(r.uid).then((u) => [r.uid, u]))));
    $("#um-list").innerHTML = `<table class="mtable"><thead><tr><th></th><th>Name</th><th>Employment ID</th><th>Department</th><th>E-mail / mobile</th><th>Role</th><th>Created</th><th>Status</th><th>Last sign-in</th><th>Sharing level seen</th><th></th></tr></thead><tbody>${rows.map((r) => { const a = act[r.uid], hr = hrs[r.uid] || {};
      return `<tr><td><img class="pic" width="36" height="36" style="width:36px;height:36px" alt="" src="${esc(pics[r.uid])}"></td><td><b>${esc(A.fullName(r) || "—")}</b>${r.title ? `<div class="tiny muted">${esc(r.title)}</div>` : ""}${r.uid === DPStore.st.userId ? ' <span class="pill">You</span>' : ""}</td><td class="small num">${esc(hr.employeeId || "—")}</td><td class="small">${esc(r.department || "—")}</td><td class="small">${esc(r.email || hr.email || "—")}${hr.mobile ? `<div class="tiny muted">${esc(hr.mobile)}</div>` : ""}</td><td>${esc(roleLabel(r.role))}</td><td class="small">${esc(H.dateS(r.createdAt))}</td>
        <td>${r.active === false ? '<span class="pill err">Deactivated</span>' : '<span class="pill ok">Active</span>'}</td><td class="small">${a && a.lastSeen ? esc(new Date(a.lastSeen).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })) : "—"}</td>
        <td class="small">${root.XFServer ? (A.baseOf(r.role) === "admin" ? "Administrator (server)" : "Staff (server)") : DPStore.st.mode !== "cloud" ? "n/a (local)" : a && a.level ? (a.level === "admin" ? `Editor${A.baseOf(r.role) !== "admin" ? ' <span class="pill err">too high</span>' : ""}` : a.level === "interact" ? `Contributor${A.baseOf(r.role) === "admin" ? ' <span class="pill warn">too low for admin</span>' : ""}` : esc(a.level)) : "—"}</td>
        <td style="white-space:nowrap"><button class="btn ghost xs" data-ed="${esc(r.docId)}">Edit…</button> ${r.uid ? `<button class="btn ghost xs" data-act="${esc(r.uid)}">Activity</button>` : ""}</td></tr>`; }).join("")}</tbody></table>`;
    $$("[data-ed]", V).forEach((b) => (b.onclick = () => editUser(rows.find((r) => r.docId === b.dataset.ed))));
    $$("[data-act]", V).forEach((b) => (b.onclick = () => activity(b.dataset.act, act[b.dataset.act])));
  }
  async function addUser(pre = {}) {
    const srv = root.XFServer || null, cloud = DPStore.st.mode === "cloud" && !srv, roles = A.A.roles || A.DEFAULT_ROLES;
    if (cloud && !pre.uid) {
      // pick a colleague from the organisation directory, or invite by e-mail
      const user = DPStore.st.user;
      const picked = await new Promise((res) => U.openModal(`<h2>Add a user</h2><p class="small muted">Search your organisation by name. For someone outside it: share this page with them, ask them to open it and press <b>Request access</b>, then approve the request on this page.</p>
        <input class="in" id="au-q" placeholder="Name" autofocus><div id="au-hits" class="stack" style="gap:4px"></div><div class="acts"><button class="btn ghost" id="au-x">Cancel</button></div>`, (m) => {
        const draw = (hits) => { $("#au-hits", m).innerHTML = hits.map((h, i) => `<button class="menu-item" data-h="${i}"><b></b><small></small></button>`).join("") || `<p class="tiny muted">No match in your organisation.</p>`;
          hits.forEach((h, i) => { const b = $(`[data-h="${i}"]`, m); b.querySelector("b").textContent = h.name; b.querySelector("small").textContent = h.guest ? "guest" : ""; b.onclick = () => { U.closeModal(); res({ uid: h.id, name: h.name }); }; }); };
        const q = $("#au-q", m); q.onfocus = () => user && user.search && user.search("").then(draw); q.oninput = () => user && user.search && user.search(q.value).then(draw);
        $("#au-x", m).onclick = () => { U.closeModal(); res(null); };
      }));
      if (!picked) return; pre = picked;
    }
    const nm = String(pre.name || "").trim().split(/\s+/);
    const roleOpts = roles.map((r) => ({ value: r.id, label: `${r.label} — ${A.BASES[r.base] || r.base}` }));
    const fields = [{ id: "fn", label: "First name", value: nm[0] || "", required: true }, { id: "ln", label: "Last name", value: nm.slice(1).join(" ") }, { id: "eid", label: "Employment ID (unique)" },
      { id: "title", label: "Job title" }, { id: "dep", label: "Department", type: "select", value: "Sales", options: DEPTS.map((d) => ({ value: d, label: d })) }, { id: "hire", label: "Hiring date", type: "date" },
      { id: "email", label: cloud ? "Work e-mail (records only; sign-in uses their claude.ai account)" : srv ? "Work e-mail (records only; sign-in uses the username)" : "E-mail (used to sign in)", type: "email", value: pre.email || "", required: !cloud && !srv }, { id: "mob", label: "Mobile number" },
      { id: "role", label: "Role", type: "select", value: "employee", options: roleOpts }];
    if (srv) fields.unshift({ id: "un", label: "Username (used to sign in)", required: true });
    if (!cloud) fields.push({ id: "pw", label: "Temporary password (they must change it at first sign-in)", type: "text", required: true, value: tempPw() });
    const f = await U.form("New user", fields, { submit: "Create user", wide: true, intro: cloud ? `Linked to the claude.ai account of ${esc(pre.name || "the person who requested access")}.` : "" });
    if (!f) return;
    if (f.mob && !/^[+()0-9\s-]{6,24}$/.test(f.mob)) return U.toast("The mobile number has invalid characters.", { err: true });
    try { if (srv) { const r = await srv.createAccount({ username: f.un, password: f.pw, name: [f.fn, f.ln].filter(Boolean).join(" "), level: A.baseOf(f.role) === "admin" ? "admin" : "interact" }); pre.uid = r.uid; }
      const id = await A.createUser({ uid: pre.uid || null, email: f.email || "", firstName: f.fn, lastName: f.ln, title: f.title, department: f.dep, hireDate: f.hire, employeeId: f.eid || "", mobile: f.mob || "", role: f.role, tempPassword: srv ? null : f.pw || null });
      U.toast(srv ? `User created. Give them the username “${f.un}” and the temporary password; they set their own at first sign-in.` : cloud ? `User created. Now share this page with them as ${A.baseOf(f.role) === "admin" ? "Editor" : "Contributor"}.` : "User created. Give them the temporary password.", { ms: 8000 });
      await A.listDirectory(); const rec = A.A.directory.find((x) => x.docId === id); if (rec && (await U.ask("Add a profile picture?", "<p>JPG, PNG or WebP. You can also do it later from Edit.</p>", [{ label: "Later", value: false, cls: "ghost" }, { label: "Upload picture", value: true }]))) pickPicture(rec.uid, renderUsers); else renderUsers(); }
    catch (e) { U.toast(e.message || "Not created.", { err: true }); }
  }
  const DEPTS = ["Sales", "Engineering", "Data & Research", "Installation", "Management", "Finance", "Operations", "Other"];
  const tempPw = () => { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(12)); for (const x of r) s += c[x % c.length]; return s.slice(0, 8) + (2 + r[0] % 8) + s.slice(8, 11); };
  function pickPicture(uid, done) {
    U.pickFile(".jpg,.jpeg,.png,.webp", async (file) => { const b = U.busy("Uploading the picture…"); try { await A.setPicture(uid, file); b.done(); if (uid === DPStore.st.userId) { App.myPic = await A.avatarUrl(uid); U.header(); } U.toast("Profile picture saved."); done && done(); } catch (e) { b.done(); U.toast(e.message, { err: true }); } });
  }
  /** Employment statistics from actual records: closed deals = approved, non-cancelled orders (one per order). */
  async function statsFor(uid, r) {
    const base = A.baseOf(r.role), per = H.curPer(), out = { base };
    if (base === "employee" || base === "admin") {
      const comms = U.isAdmin() || uid === DPStore.st.userId ? await DPStore.tryList(`commissions/${uid}/r`).then((l) => l.map((x) => x.data)) : [];
      const live = comms.filter((c) => !["cancelled", "reversed"].includes(c.status));
      const staff = await DPSales.staffDoc(uid), t = DPSales.targetFor(staff, per, App.config.settings) * 100, ach = live.filter((c) => DPSales.inPer(c.approvedAt, per)).reduce((a, c) => a + c.eligibleMinor, 0);
      const projects = await DPStore.listProjects([uid]).catch(() => []), cfg = App.commissionCfg;
      const est = projects.filter((p) => ["issued", "submitted"].includes(p.status) && p.base && cfg).reduce((a, p) => a + DPSales.estimate(p.base.eligibleMinor, cfg).amountMinor, 0)
        + live.filter((c) => c.approvedMinor == null).reduce((a, c) => a + (c.calculatedMinor != null ? c.calculatedMinor : c.amountMinor), 0);
      Object.assign(out, { deals: new Set(live.map((c) => c.oid)).size, value: live.reduce((a, c) => a + c.eligibleMinor, 0), target: t, achieved: ach, est,
        approved: live.filter((c) => c.approvedMinor != null).reduce((a, c) => a + DPSales.owedMinor(c), 0), paid: live.reduce((a, c) => a + DPSales.paidMinor(c), 0) });
    }
    return out;
  }
  function statsHtml(st) {
    if (!("deals" in st)) return `<p class="small muted">${st.base === "engineer" ? "Engineering statistics are on the engineer's dashboard (assigned, completed and at-risk orders)." : st.base === "dataentry" ? "Research statistics are on the data entry dashboard (completed leads against the monthly target)." : ""}</p>`;
    return `<div class="stats">${H.stat("Deals closed", st.deals, "since joining")}${H.stat("Approved order value", esc(H.money(st.value, "EGP")), "commission value, since joining")}${H.stat("This month's target", st.target ? Math.round(st.achieved / st.target * 100) + "%" : "—", esc(H.money(st.achieved, "EGP")) + " of " + esc(H.money(st.target, "EGP")))}
      ${H.stat("Estimated commission", esc(H.money(st.est, "EGP")), "not yet approved")}${H.stat("Approved commission", esc(H.money(st.approved, "EGP")), "")}${H.stat("Paid commission", esc(H.money(st.paid, "EGP")), "")}</div>`;
  }
  async function editUser(r) {
    const roles = A.A.roles || A.DEFAULT_ROLES, cloud = DPStore.st.mode === "cloud", uid = r.uid, hr = uid ? (((await DPStore.tryGet(`staff/${uid}`)) || {}).hr || {}) : {};
    const pic = await A.avatarUrl(uid), hasPic = !!(await A.picture(uid)), st = uid ? await statsFor(uid, r) : {};
    U.openModal(`<div class="picedit"><img class="pic ring2" width="88" height="88" style="width:88px;height:88px" alt="" src="${esc(pic)}"><div><h2>${esc(A.fullName(r) || r.email)}</h2><span class="small muted">${esc([roleLabel(r.role), r.department, r.active === false ? "Deactivated" : "Active"].filter(Boolean).join(" · "))} · account created ${esc(H.dateS(r.createdAt))} by ${esc(A.nameSync(r.createdBy) || "—")}</span>
        <div class="row" style="margin-top:6px"><button class="btn ghost xs" id="eu-pic">${hasPic ? "Replace picture…" : "Upload picture…"}</button>${hasPic ? `<button class="btn ghost xs" id="eu-pico">Original</button><button class="btn ghost xs" id="eu-picx">Remove</button>` : ""}</div></div></div>
      ${r.deactivatedAt ? `<div class="note small">Deactivated ${esc(H.dateS(r.deactivatedAt))} — ${esc(r.deactivationReason || "")}</div>` : ""}
      <h4>Employment and performance</h4>${uid ? statsHtml(st) : ""}
      <div class="grid3"><label class="field"><span>First name</span><input class="in" id="eu-fn" value="${esc(r.firstName || A.fullName(r).split(" ")[0] || "")}"></label><label class="field"><span>Last name</span><input class="in" id="eu-ln" value="${esc(r.lastName || A.fullName(r).split(" ").slice(1).join(" "))}"></label><label class="field"><span>Employment ID</span><input class="in" id="eu-id" value="${esc(hr.employeeId || "")}"></label></div>
      <div class="grid3"><label class="field"><span>Job title</span><input class="in" id="eu-t" value="${esc(r.title || "")}"></label><label class="field"><span>Department</span><select class="in" id="eu-d">${DEPTS.map((d) => `<option${d === r.department ? " selected" : ""}>${esc(d)}</option>`).join("")}</select></label><label class="field"><span>Hiring date</span><input class="in" type="date" id="eu-h" value="${esc(hr.hireDate || "")}"></label></div>
      <div class="grid3"><label class="field"><span>E-mail</span><input class="in" id="eu-e" value="${esc(r.email || hr.email || "")}"></label><label class="field"><span>Mobile</span><input class="in" id="eu-m" value="${esc(hr.mobile || "")}"></label>
        <label class="field"><span>Role</span><select class="in" id="eu-r">${roles.map((x) => `<option value="${esc(x.id)}"${x.id === r.role ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label></div>
      ${A.baseOf(r.role) === "engineer" ? `<label class="check small"><input type="checkbox" id="eu-all" ${r.engineerSeesAll ? "checked" : ""}> May view every order's engineering status (not only assigned orders)</label>` : ""}
      ${cloud && !root.XFServer ? "<p class='tiny muted'>Match the sharing level to the role: Editor for administrators, Contributor for everyone else.</p>" : ""}
      <label class="field"><span>Reason for the change</span><input class="in" id="eu-why"></label>
      <div class="row">${r.active === false ? `<button class="btn sm" id="eu-on">Reactivate</button>` : `<button class="btn danger sm" id="eu-off" ${uid === DPStore.st.userId ? "disabled" : ""}>Deactivate</button>`}${!cloud ? `<button class="btn ghost sm" id="eu-pw">Reset password…</button>` : ""}${uid && A.isSalesRole(r.role) ? `<button class="btn ghost sm" id="eu-leads">Reassign their leads…</button>` : ""}</div>
      <div class="acts"><button class="btn ghost" id="eu-x">Close</button><button class="btn" id="eu-s">Save</button></div>`, (m) => {
      const why = () => $("#eu-why", m).value.trim();
      $("#eu-x", m).onclick = () => U.closeModal();
      const run = async (fn, msg) => { try { await fn(); U.closeModal(); U.toast(msg, { ms: 7000 }); renderUsers(); } catch (e) { U.toast(e.message || "Not saved.", { err: true }); } };
      $("#eu-pic", m).onclick = () => { U.closeModal(); pickPicture(uid, renderUsers); };
      const po = $("#eu-pico", m); if (po) po.onclick = async () => { const o = await A.originalPicture(uid); if (o) DPUI.showFile({ name: o.name, type: "image/*", dataUrl: o.dataUrl, size: o.dataUrl.length * 0.75 }); };
      const px = $("#eu-picx", m); if (px) px.onclick = () => run(() => A.removePicture(uid), "Picture removed.");
      $("#eu-s", m).onclick = () => { const patch = {}, g = (id) => $(id, m).value.trim();
        const map = { firstName: "#eu-fn", lastName: "#eu-ln", title: "#eu-t", department: "#eu-d", email: "#eu-e", role: "#eu-r" };
        for (const [k, id] of Object.entries(map)) if (g(id) !== String(r[k] || (k === "email" ? hr.email || "" : ""))) patch[k] = g(id);
        const all = $("#eu-all", m); if (all && all.checked !== !!r.engineerSeesAll) patch.engineerSeesAll = all.checked;
        const hrPatch = { employeeId: g("#eu-id"), mobile: g("#eu-m"), hireDate: $("#eu-h", m).value, email: g("#eu-e") };
        const hrChanged = hrPatch.employeeId !== (hr.employeeId || "") || hrPatch.mobile !== (hr.mobile || "") || hrPatch.hireDate !== (hr.hireDate || "") || hrPatch.email !== (hr.email || "");
        if (!Object.keys(patch).length && !hrChanged) return U.closeModal(); if (patch.role && !why()) return U.toast("Give a reason for the role change.", { err: true });
        if (!patch.firstName && "firstName" in patch) return U.toast("The first name is required.", { err: true });
        if (hrPatch.mobile && !/^[+()0-9\s-]{6,24}$/.test(hrPatch.mobile)) return U.toast("The mobile number has invalid characters.", { err: true });
        run(async () => { if (Object.keys(patch).length) await A.updateUser(r.docId, patch, why()); if (hrChanged && uid) { await A.saveHr(uid, hrPatch); await A.adminLog("Updated employment record", { target: uid, reason: why(), detail: Object.keys(hrPatch).filter((k) => hrPatch[k] !== (hr[k] || "")).join(", ") }); } },
          patch.role && cloud && !root.XFServer ? `Saved. Change their sharing level to ${A.baseOf(patch.role) === "admin" ? "Editor" : "Contributor"} in the share menu.` : "Saved."); };
      const off = $("#eu-off", m); if (off) off.onclick = () => { if (!why()) return U.toast("Give a reason for deactivating.", { err: true }); run(() => A.updateUser(r.docId, { active: false }, why()), cloud ? "Deactivated. Also remove them from the page's share menu to cut database access." : "Deactivated."); };
      const on = $("#eu-on", m); if (on) on.onclick = () => run(() => A.updateUser(r.docId, { active: true }, why() || "Reactivated"), "Reactivated.");
      const pw = $("#eu-pw", m); if (pw) pw.onclick = async () => { const f = await U.form("Reset password", [{ id: "p", label: "Temporary password", value: tempPw(), required: true }], { intro: "They must choose a new password at their next sign-in.", submit: "Reset" }); if (f) run(() => A.resetLocalPassword(r.docId, f.p), `Password reset. Temporary password: ${f.p}`); };
      const ld = $("#eu-leads", m); if (ld) ld.onclick = () => { U.closeModal(); bulkReassign(r); };
    }, { wide: true });
  }
  async function bulkReassign(r) {
    const [leads, claims] = await Promise.all([DPLeads.listLeads(), DPLeads.claimsByLead()]);
    const owned = leads.filter((l) => DPLeads.ownership(l, claims[l.id] || []).owner === r.uid);
    if (!owned.length) return U.toast(`${r.displayName || "This user"} owns no leads.`);
    const emps = A.A.directory.filter((x) => x.uid && x.active !== false && x.uid !== r.uid);
    const f = await U.form(`Reassign ${owned.length} lead(s) of ${r.displayName || r.email}`, [{ id: "to", label: "New owner", type: "select", value: emps[0] && emps[0].uid, options: [{ value: "__release", label: "Release them to the Lead Mine" }].concat(emps.map((x) => ({ value: x.uid, label: x.displayName || x.email }))) }, { id: "reason", label: "Reason", required: true }], { intro: owned.map((l) => esc(l.name)).join(", "), submit: "Reassign all" });
    if (!f) return; const b = U.busy("Reassigning…");
    try { for (const l of owned) { if (f.to === "__release") await DPLeads.adminRelease(l.id, f.reason); else await DPLeads.reassign(l.id, f.to, f.reason); } b.done(); U.toast(`${owned.length} lead(s) ${f.to === "__release" ? "released" : "reassigned"}.`); }
    catch (e) { b.done(); U.toast(e.message || "Stopped.", { err: true }); }
  }
  async function activity(uid, a) {
    const log = await DPStore.tryList("adminlog"), mine = log.flatMap((d) => (d.data.entries || []).filter((e) => e.target === uid || e.by === uid)).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 40);
    U.openModal(`<h2>Activity — ${esc(A.nameSync(uid) || "user")}</h2><h4>Sign-ins and actions</h4>${a && a.log ? `<div class="tl">${a.log.slice().reverse().map((e) => `<div><span class="tiny muted">${esc(new Date(e.at).toLocaleString())}</span><span>${esc(e.what)} ${e.detail ? "— " + esc(e.detail) : ""}</span></div>`).join("")}</div>` : `<p class="small muted">No activity recorded.</p>`}
      <h4>Administrator log entries</h4>${mine.length ? `<div class="tl">${mine.map((e) => `<div><span class="tiny muted">${esc(new Date(e.at).toLocaleString())}</span><span><b>${esc(e.action)}</b> by ${esc(A.nameSync(e.by) || "—")}${e.reason ? " — " + esc(e.reason) : ""}${e.detail ? ` <span class="muted">(${esc(e.detail)})</span>` : ""}</span></div>`).join("")}</div>` : `<p class="small muted">None.</p>`}
      <div class="acts"><button class="btn ghost" onclick="DPUI.closeModal()">Close</button></div>`, null, { wide: true });
  }
  async function rolesDlg() {
    const roles = (A.A.roles || A.DEFAULT_ROLES).map((r) => Object.assign({}, r)); const baseOpts = Object.entries(A.BASES);
    const draw = (m) => { $("#rl-list", m).innerHTML = roles.map((r, i) => `<div class="grid3" style="grid-template-columns:1.3fr 1fr 2fr auto;align-items:end"><label class="field"><span>Name</span><input class="in sm" data-rl="${i}" data-f="label" value="${esc(r.label)}"></label>
      <label class="field"><span>Access level</span><select class="in sm" data-rl="${i}" data-f="base" ${r.builtIn ? "disabled" : ""}>${baseOpts.map(([k, l]) => `<option value="${k}"${r.base === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="field"><span>Description</span><input class="in sm" data-rl="${i}" data-f="description" value="${esc(r.description || "")}"></label>${r.builtIn ? "<span></span>" : `<button class="btn ghost xs" data-rm="${i}">Remove</button>`}</div>`).join("");
      $$("[data-rl]", m).forEach((el) => (el.onchange = () => { roles[+el.dataset.rl][el.dataset.f] = el.value; }));
      $$("[data-rm]", m).forEach((b) => (b.onclick = () => { roles.splice(+b.dataset.rm, 1); draw(m); })); };
    U.openModal(`<h2>Roles</h2><p class="small muted">Each role has one of four access levels (administrator, sales, engineering, data entry), which decide the screens and the data the person receives. Add roles (for example “Sales Manager”) to label people; new access levels need a code change (see README).</p><div class="stack" id="rl-list"></div>
      <div class="acts"><button class="btn ghost" id="rl-add">Add role</button><button class="btn ghost" id="rl-x">Cancel</button><button class="btn" id="rl-s">Save roles</button></div>`, (m) => { draw(m);
      $("#rl-add", m).onclick = () => { roles.push({ id: "r" + Date.now().toString(36), label: "New role", base: "employee", description: "" }); draw(m); };
      $("#rl-x", m).onclick = () => U.closeModal();
      $("#rl-s", m).onclick = async () => { try { const used = new Set(A.A.directory.map((r) => r.role)); const removed = (A.A.roles || []).filter((r) => !roles.some((x) => x.id === r.id) && used.has(r.id)); if (removed.length) throw new Error(`${removed[0].label} is still assigned to users.`);
        await A.saveRoles(roles.map((r) => ({ id: r.id, label: r.label.trim(), base: r.base, description: r.description || "" }))); U.closeModal(); U.toast("Roles saved."); renderUsers(); } catch (e) { U.toast(e.message, { err: true }); } }; }, { wide: true });
  }

  /* ---------------- Employees (targets & performance) ---------------- */
  async function renderEmployees(opts = {}) {
    const V = $("#view-employees"), per = H.curPer();
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Administration</span><h1>Employees</h1><p class="lead small">Targets, results and records for each person. Sales default ${esc(H.money(Math.round(((App.config.settings.sales || {}).monthlyTarget || 500000) * 100), "EGP"))}/month · data entry default ${esc(String(((App.config.settings.dataEntry || {}).monthlyTarget) || 30))} completed leads/month (Settings).</p></div></div><div id="em-body"><div class="empty"><div class="spinner"></div></div></div></div>`;
    const d = await DPUI.companyData(), cur = App.config.pricebook.currency || "EGP";
    await DPLeadOps.loadActs(); await DPLeadOps.loadContacts();
    const emps = d.dir.filter((r) => r.uid && r.active !== false), pers = DPSales.lastPeriods(6), sel = opts.uid || (App.viewOpts && App.viewOpts.uid) || null;
    const asg = await DPOrders.listAssign(), engs = await Promise.all(asg.map((a) => DPOrders.engOf(a)));
    const cards = await Promise.all(emps.map(async (r) => { const base = A.baseOf(r.role), pic = await A.avatarUrl(r.uid);
      let body = "";
      if (base === "employee" || base === "admin") {
        const mineC = d.comms.filter((c) => c.uid === r.uid), mineP = d.projects.filter((p) => p.ownerId === r.uid), mineClaims = Object.values(d.claims).flat().filter((c) => c.uid === r.uid), mineCrm = d.crms.filter((c) => c.uid === r.uid);
        const fNow = DPSales.salesFigures({ comms: mineC, projects: mineP, claims: mineClaims, crms: mineCrm, per }), t = DPSales.targetFor(d.staffs[r.uid], per, App.config.settings) * 100, cf = DPLeadOps.callFigures(r.uid, per);
        const hist = pers.map((p) => ({ l: H.perLabel(p).slice(0, 3) + " " + p.slice(2, 4), v: DPSales.salesFigures({ comms: mineC, projects: mineP, per: p }).achievedMinor }));
        const live = mineC.filter((c) => !["cancelled", "reversed"].includes(c.status));
        body = `<div class="dgrid"><div class="tgt">${H.ring(t ? fNow.achievedMinor / t : 0, "Target")}<div class="kv"><span>Target ${esc(H.perLabel(per))}</span><b class="num">${esc(H.money(t, cur))}</b><span>Achieved</span><b class="num">${esc(H.money(fNow.achievedMinor, cur))}</b><span>Deals closed (all time)</span><b>${new Set(live.map((c) => c.oid)).size}</b><span>Proposals issued</span><b>${fNow.proposalsIssued}</b><span>Conversion</span><b>${H.pctS(fNow.conversion)}</b><span>Calls this month</span><b>${cf.month}</b><span>Commission outstanding</span><b class="num">${esc(H.money(fNow.outstanding, cur))}</b></div></div>
          <div>${H.bars(hist, { fmt: (v) => H.money(v, cur), target: t })}</div></div>`;
      } else if (base === "dataentry") {
        const f = DPLeadOps.dataEntryFigures(r.uid, per, d.leads), t = DPLeadOps.dataEntryTarget(d.staffs[r.uid], per);
        const hist = pers.map((p) => ({ l: H.perLabel(p).slice(0, 3) + " " + p.slice(2, 4), v: DPLeadOps.dataEntryFigures(r.uid, p, d.leads).completed }));
        body = `<div class="dgrid"><div class="tgt">${H.ring(t ? f.completed / t : 0, "Target")}<div class="kv"><span>Target ${esc(H.perLabel(per))}</span><b>${t} completed leads</b><span>Completed</span><b>${f.completed}</b><span>Remaining</span><b>${Math.max(0, t - f.completed)}</b><span>Research calls</span><b>${f.researchCalls}</b><span>Contacts verified</span><b>${f.verifiedThisMonth}</b><span>Records updated</span><b>${f.updated}</b></div></div><div>${H.bars(hist, { fmt: (v) => String(v), target: t })}</div></div>`;
      } else if (base === "engineer") {
        const mine = asg.map((a, i) => ({ a, e: engs[i] })).filter((x) => x.a.engineerUid === r.uid && x.a.status !== "cancelled");
        const ds = mine.map((x) => DPOrders.deadlineStatus(x.a, x.e).key);
        body = `<div class="stats">${H.stat("Assigned", mine.length, "")}${H.stat("In progress", mine.filter((x) => x.e && !["completed"].includes(x.e.status)).length, "")}${H.stat("Completed", mine.filter((x) => x.e && x.e.status === "completed").length, "")}${H.stat("At risk / delayed", ds.filter((k) => ["atrisk", "delayed"].includes(k)).length, "")}${H.stat("Completed late", ds.filter((k) => k === "late").length, "")}</div>`;
      }
      return `<div class="card stack ${sel === r.uid ? "corner" : ""}" id="em-${esc(r.uid)}"><div class="row between"><div class="hello"><img class="pic" width="52" height="52" style="width:52px;height:52px" alt="" src="${esc(pic)}"><div><h3>${esc(A.fullName(r))}</h3><span class="tiny muted">${esc([roleLabel(r.role), r.title, r.department].filter(Boolean).join(" · "))}</span></div></div>
        <div class="row">${base !== "engineer" ? `<button class="btn ghost sm" data-tg="${esc(r.uid)}" data-b="${esc(base)}">Set target…</button>` : ""}<button class="btn ghost sm" data-sum="${esc(r.docId)}">Full summary…</button></div></div>${body}</div>`; }));
    $("#em-body").innerHTML = `<div class="stack">${cards.join("") || `<div class="empty">No active users.</div>`}</div>`;
    $$("[data-sum]", V).forEach((b) => (b.onclick = () => editUser(d.dir.find((x) => x.docId === b.dataset.sum))));
    $$("[data-tg]", V).forEach((b) => (b.onclick = async () => { const uid = b.dataset.tg, de = b.dataset.b === "dataentry", doc = d.staffs[uid] || { targets: {} };
      const f = await U.form(`Monthly target — ${A.nameSync(uid)}`, [{ id: "per", label: "Month", type: "select", value: per, options: DPSales.lastPeriods(12).reverse().concat(nextPeriods(6)).map((p) => ({ value: p, label: H.perLabel(p) })) }, { id: "amt", label: de ? "Completed leads" : "Target (EGP, commission value)", type: "number", min: 0, required: true, value: de ? DPLeadOps.dataEntryTarget(doc, per) : DPSales.targetFor(doc, per, App.config.settings) }, { id: "reason", label: "Reason", required: true }], { submit: "Save target" });
      if (!f) return; try { if (de) { const s2 = await DPSales.staffDoc(uid); s2.leadTargets = Object.assign({}, s2.leadTargets, { [f.per]: f.amt }); s2.history = (s2.history || []).concat([{ at: new Date().toISOString(), by: DPStore.st.userId, per: f.per, leads: f.amt, reason: f.reason }]); await DPStore.set(`staff/${uid}`, s2); await A.adminLog("Set lead target", { target: uid, detail: `${f.per}: ${f.amt}`, reason: f.reason }); } else await DPSales.setTarget(uid, f.per, f.amt, f.reason); U.toast("Target saved."); renderEmployees({ uid }); } catch (e) { U.toast(e.message, { err: true }); } }));
    if (sel) { const el = $("#em-" + CSS.escape(sel)); if (el) el.scrollIntoView({ block: "start" }); }
  }
  function nextPeriods(n) { const out = [], d = new Date(); for (let i = 1; i <= n; i++) out.push(new Date(d.getFullYear(), d.getMonth() + i, 15).toISOString().slice(0, 7)); return out; }

  /* ---------------- My Profile ---------------- */
  async function renderProfile() {
    const V = $("#view-profile"), me = U.me(), local = DPStore.st.mode !== "cloud", rec = A.A.record || {};
    const staff = await DPSales.staffDoc(DPStore.st.userId).catch(() => ({ targets: {} })), hr = staff.hr || {}, act = await DPStore.tryGet(`activity/${DPStore.st.userId}`), pic = await A.avatarUrl(me.id);
    const st = await statsFor(me.id, rec).catch(() => ({}));
    V.innerHTML = `<div class="page narrow"><div class="phead"><div class="hello"><img class="pic ring2" width="96" height="96" style="width:96px;height:96px" alt="" src="${esc(pic)}"><div><span class="eyebrow">My Profile</span><h1>${esc(me.name || "Your account")}</h1><p class="lead small">${esc([me.title, me.department].filter(Boolean).join(" · "))}</p></div></div><div class="row"><button class="btn ghost" id="pf-out">${U.svg("out")} Sign out</button></div></div>
      <div class="card stack corner"><div class="kv"><span>First name</span><b>${esc(rec.firstName || me.firstName || "")}</b><span>Last name</span><b>${esc(rec.lastName || "")}</b><span>Employment ID</span><span class="num">${esc(hr.employeeId || "—")}</span><span>Job title</span><span>${esc(rec.title || "—")}</span><span>Department</span><span>${esc(rec.department || "—")}</span><span>Hiring date</span><span>${esc(hr.hireDate || "—")}</span>
        <span>E-mail</span><span>${esc(rec.email || hr.email || "—")}</span><span>Mobile</span><span>${esc(hr.mobile || "—")}</span><span>Account status</span><span>${rec.active === false ? "Deactivated" : "Active"}</span><span>Role</span><b>${esc(me.roleLabel)}</b><span>Account created</span><span>${esc(H.dateS(rec.createdAt))}</span>
        <span>Sign-in</span><span>${root.XFServer ? "X FORCE server account — username and password" : local ? "Local demonstration account (this browser only)" : "claude.ai account — passwords and two-step sign-in are managed by claude.ai"}</span></div>
        <p class="tiny muted">Your picture and employment details are maintained by an administrator.</p>${local || root.XFServer ? `<button class="btn ghost sm" id="pf-pw" style="align-self:flex-start">Change password…</button>` : ""}</div>
      ${"deals" in st ? `<div class="card stack"><h3>Performance</h3>${statsHtml(st)}</div>` : ""}
      <div class="card stack"><h3>Recent activity</h3>${act && act.log ? `<div class="tl">${act.log.slice().reverse().slice(0, 15).map((e) => `<div><span class="tiny muted">${esc(new Date(e.at).toLocaleString())}</span><span>${esc(e.what)} ${e.detail ? "— " + esc(e.detail) : ""}</span></div>`).join("")}</div>` : `<p class="small muted">Nothing yet.</p>`}</div></div>`;
    $("#pf-out").onclick = () => H.signOut();
    const pw = $("#pf-pw"); if (pw) pw.onclick = async () => { const f = await U.form("Change password", [{ id: "c", label: "Current password", type: "password", required: true }, { id: "n", label: "New password", type: "password", required: true, help: "At least 10 characters with letters and a number." }, { id: "n2", label: "Repeat", type: "password", required: true }], { submit: "Change password" });
      if (!f) return; if (f.n !== f.n2) return U.toast("The new passwords do not match.", { err: true }); try { if (root.XFServer) await root.XFServer.changePassword(f.c, f.n); else await A.localChangePassword(DPStore.st.userId, f.c, f.n); U.toast("Password changed."); A.logActivity("Changed password"); } catch (e) { U.toast(e.message, { err: true }); } };
  }

  U.register("users", renderUsers); U.register("employees", renderEmployees); U.register("profile", renderProfile);
})(typeof self !== "undefined" ? self : this);
