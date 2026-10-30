/* X FORCE 1.0 (Dupedia) — application shell: sign-in gate, role-based navigation rail, shared helpers. */
/* global DPUI, DPAuth, DPStore, DPLeads, DPSales */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U;
  const NAV = {
    employee: [["dash", "Dashboard", "dash"], ["planner", "Site Planner", "planner"], ["proposals", "My Orders & Proposals", "doc"], ["home", "Drafts & Projects", "folder"], ["leads", "Lead Mine", "mine"], ["myleads", "My Leads", "target"], ["calls", "Calls & Follow-ups", "phone"], ["intel", "Market Intelligence", "radar"], ["mycomm", "My Commission", "coins"], ["catalog", "Dupedia Products", "tag"], ["reminders", "Reminders", "check"], ["messages", "Messages", "chat"], ["profile", "My Profile", "user"]],
    engineer: [["dash", "Dashboard", "dash"], ["engorders", "Engineering Orders", "truck"], ["factory", "Factory", "factory"], ["workers", "Worker Directory", "team"], ["facjobs", "Production Jobs", "factory"], ["facdash", "Factory Dashboard", "report"], ["equipment", "Machines & Tools", "gear"], ["catalog", "Dupedia Products", "tag"], ["reminders", "Reminders", "check"], ["messages", "Messages", "chat"], ["profile", "My Profile", "user"]],
    dataentry: [["dash", "Dashboard", "dash"], ["research", "Lead Research", "leads"], ["leads", "Lead Mine", "mine"], ["calls", "Call Log", "phone"], ["intel", "Market Intelligence", "radar"], ["reminders", "Reminders", "check"], ["messages", "Messages", "chat"], ["profile", "My Profile", "user"]],
    viewer: [["dash", "Dashboard", "dash"], ["profile", "My Profile", "user"]],
    accountant: [["finance", "Finance Dashboard", "finance"], ["transfers", "Transfers", "transfer"], ["finaccounts", "Financial Accounts", "bank"], ["payverify", "Payment Verification", "shield"], ["salaries", "Salaries & Payroll", "payroll"], ["purchases", "Purchases", "cart"],
      ["invoices", "Invoices & Receipts", "receipt"], ["approvecomm", "Commissions", "coins"], ["taxes", "Taxes", "tax"], ["finreports", "Finance Reports", "report"], ["holidays", "Holidays", "doc"], ["reminders", "Reminders", "check"], ["messages", "Messages", "chat"], ["profile", "My Profile", "user"]],
  };
  const NAV_OPS = [["facjobs", "Production Jobs", "factory"], ["facdash", "Factory Dashboard", "report"], ["equipment", "Machines & Tools", "gear"], ["products", "Products", "tag"], ["catalog", "Dupedia Products", "tag"], ["holidays", "Holidays", "doc"], ["reminders", "Reminders", "check"]];
  const NAV_FIN = [["finance", "Finance Dashboard", "finance"], ["transfers", "Transfers", "transfer"], ["finaccounts", "Financial Accounts", "bank"], ["salaries", "Salaries & Payroll", "payroll"], ["purchases", "Purchases", "cart"], ["invoices", "Invoices & Receipts", "receipt"], ["taxes", "Taxes", "tax"], ["finreports", "Finance Reports", "report"]];
  const NAV_EMP = NAV.employee;
  const NAV_ADM = [["mission", "Mission Control", "globe"], ["askceo", "Ask CEO Inbox", "inbox"], ["register", "Order Register", "doc"], ["payverify", "Payment Verification", "shield"], ["approvals", "Payments & Approvals", "check"], ["approvecomm", "Approve Commission", "coins"], ["engqueue", "Engineering", "truck"], ["factory", "Factory", "factory"], ["workers", "Worker Directory", "team"], ["allleads", "All Leads", "leads"], ["research", "Lead Research", "mine"], ["workforce", "Work Force", "users"], ["employees", "Employees", "team"], ["users", "User Management", "users"], ["commadmin", "Commission Rules", "coins"], ["pricing", "Product Pricing", "tag"], ["reports", "Reports", "report"], ["audit", "Audit Log", "audit"], ["search", "Company Search", "search2"], ["settings", "Settings", "gear"]];

  /* ---------------- rail ---------------- */
  function rail() {
    const r = $("#rail"); if (!r) return; const adm = U.isAdmin(), v = App.view, tab = (App.viewOpts || {}).tab;
    const on = (k) => k === v || (k === "pricing" && v === "admin" && (tab || "prices") === "prices") || (k === "settings" && v === "admin" && tab && tab !== "prices") || (k === "planner" && (v === "start" || U.PROJECT_VIEWS.includes(v)));
    const bd = App.badges || {}, badge = (k) => ({ approvals: bd.approvals, users: bd.requests, engqueue: bd.engqueue, approvecomm: bd.comm, messages: bd.messages, engorders: bd.engnew, calls: bd.followups, payverify: bd.payverify, askceo: bd.askceo, intel: bd.intel, mission: bd.mission }[k]);
    const item = ([k, l, ic]) => `<button type="button" class="ri${on(k) ? " is-on" : ""}" data-nav="${k}" title="${esc(l)}">${U.svg(ic)}<span>${esc(l)}</span>${badge(k) ? `<em>${badge(k)}</em>` : ""}</button>`;
    const mine = adm ? [["dash", "CEO Control Center", "dash"]].concat(NAV_EMP.filter((x) => x[0] !== "dash")) : (NAV[U.role()] || NAV.viewer);
    const adm2 = NAV_ADM.filter(([k]) => k !== "askceo" || (root.DPAskCeo && DPAskCeo.canReadInbox()));
    r.innerHTML = `<div class="rtop"><button type="button" class="ri rtog" id="rail-tog" aria-label="Collapse or expand the menu"></button></div><div class="rg">${mine.map(item).join("")}</div>${adm ? `<div class="rh">Factory &amp; products</div><div class="rg">${NAV_OPS.filter(([k]) => !mine.some((x) => x[0] === k)).map(item).join("")}</div><div class="rh">Finance</div><div class="rg">${NAV_FIN.map(item).join("")}</div><div class="rh">Administration</div><div class="rg">${adm2.map(item).join("")}</div>` : ""}
      <div class="rfoot">${root.DPI18n ? DPI18n.toggleHtml() : ""}<button type="button" class="ri" id="r-out" title="Sign out">${U.svg("out")}<span>Sign out</span></button></div>`;
    $$("[data-nav]", r).forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
    $("#r-out").onclick = signOut;
    const lg = $("#r-lang"); if (lg) lg.onclick = () => DPI18n.setLang(DPI18n.lang === "ar" ? "en" : "ar");
    if (root.DPI18n && !rail.lp) { rail.lp = 1; DPI18n.loadPref(); }
    $("#rail-tog").onclick = () => root.DPCeo2 && DPCeo2.toggleRail(); if (root.DPCeo2) DPCeo2.applyRail(DPCeo2.railPref());
  }
  async function nav(k) {
    if (App.open && U.PROJECT_VIEWS.includes(App.view) && DPModel.S.dirty && U.canWrite() && !App.sample) await U.save();
    if (k === "planner") return U.go("start");   // 1.1: always the start screen — never reopens a saved project by itself
    if (k === "pricing") return U.go("admin", { tab: "prices" });
    if (k === "settings") return U.go("admin", { tab: "commercial" });
    U.go(k);
  }
  async function signOut() {
    if (App.open && DPModel.S.dirty && U.canWrite() && !App.sample) await U.save();
    DPAuth.logActivity("Signed out").catch(() => {}); DPNotify.stop(); if (root.DPLive) DPLive.stop(); if (root.DPChat) DPChat.stop(); if (root.DPAssist) DPAssist.stop(); if (root.DPCeo2) DPCeo2.closeDrawer(); clearInterval(App.loop); DPAuth.signOut(); App.open = false; App.myPic = null;
    try { sessionStorage.removeItem("dp.sp21.cloudok"); } catch (e) {}
    if (root.XFServer) return root.XFServer.logout();
    gate();
  }
  /** Owner ids whose projects an administrator lists: everyone in the directory, plus the 'local' owner in local mode. */
  function ownerIds() { const ids = DPAuth.A.directory.filter((r) => r.uid).map((r) => r.uid); if (DPStore.st.userId && !ids.includes(DPStore.st.userId)) ids.push(DPStore.st.userId); return ids; }
  /** Leads the signed-in person owns (for linking projects). */
  async function myOwnedLeads() {
    const [leads, claims] = await Promise.all([DPLeads.listLeads(), DPLeads.claimsByLead()]), me = DPStore.st.userId;
    return leads.filter((l) => DPLeads.ownership(l, claims[l.id] || []).owner === me).map((l) => ({ id: l.id, name: l.name, location: l.location })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ---------------- sign-in gate ---------------- */
  const brandBlock = `<div class="gbrand"><img src="brand/logo_primary.png" alt="Dupedia" width="240"><div class="blocks" aria-hidden="true"><i class="sq"></i><i class="qc"></i><i class="hf"></i><i class="ci"></i></div></div>`;
  function gateShell(inner) {
    $("#app").hidden = true; const g = $("#gate"); g.hidden = false;
    g.innerHTML = `<div class="gwrap"><section class="gcard corner">${brandBlock}<span class="eyebrow">X FORCE 1.1 · Dupedia internal</span>${inner}</section>
      <aside class="gside"><h2>One system to <em>sell</em>, build and run Dupedia.</h2><ul><li>Site plans, quotations and orders from first call to handover</li><li>Engineering, factory and installation with live progress</li><li>Leads, follow-ups, payments, commission and company messaging</li></ul>
      <p class="tiny">For Dupedia employees. Access is granted by an administrator; there is no public registration.</p></aside></div>`;
    return g;
  }
  async function gate(note) {
    const res = await DPAuth.resolve();
    const st = DPStore.st;
    if (res.state === "ok") {
      if (st.mode === "cloud") {
        let ok = false; try { ok = sessionStorage.getItem("dp.sp21.cloudok") === DPAuth.A.me.id; } catch (e) {}
        if (!ok) {
          const g = gateShell(`<h1>Welcome back${DPAuth.A.me.name ? `, <em>${esc(DPAuth.A.me.name.split(" ")[0])}</em>` : ""}.</h1>
            <p class="muted">You are signed in with your ${root.XFServer ? "X FORCE server" : "claude.ai"} account${DPAuth.A.me.email ? ` (${esc(DPAuth.A.me.email)})` : ""}. Dupedia role: <b>${esc(DPAuth.A.me.roleLabel)}</b>.</p>
            <button class="btn lime block" id="g-go" autofocus>Continue to X FORCE</button>
            <p class="tiny muted">${root.XFServer ? "Your access level comes from your account on this server, set by an administrator." : "Passwords and two-step sign-in are managed by your claude.ai account. Your access level comes from the Dupedia user directory and how this page is shared with you."}</p>`);
          return new Promise((resolve) => { $("#g-go", g).onclick = () => { try { sessionStorage.setItem("dp.sp21.cloudok", DPAuth.A.me.id); } catch (e) {} enter().then(resolve); }; });
        }
      }
      return enter();
    }
    if (res.state === "nouser") { gateShell(`<h1>Sign in to continue.</h1><p class="muted">Open this page while signed in to your claude.ai account. X FORCE uses your claude.ai sign-in; it never asks for a password.</p>`); return; }
    if (res.state === "request" || res.state === "pending") {
      const g = gateShell(res.state === "pending" ? `<h1>Request <em>sent</em>.</h1><p class="muted">An administrator will review your request. You can close this page; come back once you have been added.</p><p class="tiny muted">Sent ${esc(new Date(res.request.at).toLocaleString())}</p><button class="btn ghost" id="g-re">Check again</button>`
        : `<h1>You don't have <em>access</em> yet.</h1><p class="muted">${esc(st.userName || "Your account")} is not in the Dupedia user directory. Accounts are created by an administrator. Send a request and say who you are.</p>
          <label class="field"><span>Message to the administrator</span><textarea class="in" id="g-msg" rows="3" placeholder="Name, team, manager"></textarea></label><button class="btn lime block" id="g-req">Request access</button>`);
      const re = $("#g-re", g); if (re) re.onclick = () => gate();
      const rq = $("#g-req", g); if (rq) rq.onclick = async () => { try { await DPAuth.requestAccess($("#g-msg", g).value); gate(); } catch (e) { U.toast(e.message || "The request could not be sent.", { err: true }); } };
      return;
    }
    if (res.state === "inactive") { gateShell(`<h1>Account <em>deactivated</em>.</h1><p class="muted">Your Dupedia account has been deactivated${res.record.deactivatedAt ? " on " + esc(new Date(res.record.deactivatedAt).toLocaleDateString()) : ""}. Contact your administrator if you think this is a mistake.</p>`); return; }
    if (res.state === "setup") {
      const g = gateShell(`<h1>Create the <em>administrator</em> account.</h1>
        <div class="note warn small"><b>Local demonstration mode.</b> This copy runs without a server: accounts and data stay in this browser and the sign-in protects nothing on this device. Use the published version on claude.ai for real use.</div>
        <form class="stack" id="g-f"><label class="field"><span>Full name</span><input class="in" id="g-n" required autocomplete="name"></label><label class="field"><span>E-mail</span><input class="in" id="g-e" type="email" required autocomplete="username"></label>
        <label class="field"><span>Password</span><input class="in" id="g-p" type="password" required autocomplete="new-password"><small>At least 10 characters with letters and a number. Stored only as a salted PBKDF2 hash.</small></label>
        <label class="field"><span>Repeat password</span><input class="in" id="g-p2" type="password" required autocomplete="new-password"></label><p class="small" id="g-err" style="color:var(--red)"></p><button class="btn lime block">Create account and sign in</button></form>`);
      $("#g-f", g).onsubmit = async (e) => { e.preventDefault(); const err = $("#g-err", g);
        if ($("#g-p", g).value !== $("#g-p2", g).value) { err.textContent = "The passwords do not match."; return; }
        try { await DPAuth.localSetup({ name: $("#g-n", g).value.trim(), email: $("#g-e", g).value, password: $("#g-p", g).value }); gate(); } catch (x) { err.textContent = x.message; } };
      return;
    }
    // local sign-in
    const g = gateShell(`<h1>Sign <em>in</em>.</h1>${note || res.note ? `<div class="note small">${esc(note || res.note)}</div>` : ""}
      <form class="stack" id="g-f"><label class="field"><span>E-mail</span><input class="in" id="g-e" type="email" required autocomplete="username" autofocus></label>
      <label class="field"><span>Password</span><input class="in" id="g-p" type="password" required autocomplete="current-password"></label><p class="small" id="g-err" style="color:var(--red)"></p>
      <button class="btn lime block" id="g-b">Sign in</button></form>
      <p class="tiny muted">Local demonstration mode: accounts live in this browser only. Forgot your password? Ask an administrator to issue a temporary one.</p>`);
    let fails = 0;
    $("#g-f", g).onsubmit = async (e) => { e.preventDefault(); const err = $("#g-err", g), b = $("#g-b", g); b.disabled = true; err.textContent = "";
      try { const r = await DPAuth.localSignIn($("#g-e", g).value, $("#g-p", g).value);
        if (r.mustChange) { await DPAuth.resolve(); return forceChange(); }
        gate(); }
      catch (x) { fails++; err.textContent = x.message; setTimeout(() => (b.disabled = false), Math.min(8000, 600 * fails * fails)); } };
  }
  function forceChange() {
    const g = gateShell(`<h1>Choose a <em>new</em> password.</h1><p class="muted">Your administrator issued a temporary password. Choose your own to continue.</p>
      <form class="stack" id="g-f"><label class="field"><span>New password</span><input class="in" id="g-p" type="password" required autocomplete="new-password"><small>At least 10 characters with letters and a number.</small></label>
      <label class="field"><span>Repeat</span><input class="in" id="g-p2" type="password" required autocomplete="new-password"></label><p class="small" id="g-err" style="color:var(--red)"></p><button class="btn lime block">Save and continue</button></form>`);
    $("#g-f", g).onsubmit = async (e) => { e.preventDefault(); const err = $("#g-err", g);
      if ($("#g-p", g).value !== $("#g-p2", g).value) { err.textContent = "The passwords do not match."; return; }
      try { await DPAuth.localChangePassword(DPAuth.A.me.id, null, $("#g-p", g).value); gate(); } catch (x) { err.textContent = x.message; } };
  }
  /** Signed in: load configuration, run administrator housekeeping, open the app. */
  /** Self-hosted: a temporary password is replaced at the first sign-in; the temporary one stops working once changed. */
  async function serverFirstLogin() {
    const m = await root.XFServer.me(); if (!m.mustChange) return;
    for (;;) { const f = await U.form("Choose your password", [{ id: "old", label: "Temporary password", type: "password", required: true }, { id: "pw", label: "New password (10+ characters, letters and a digit)", type: "password", required: true }, { id: "pw2", label: "Repeat the new password", type: "password", required: true }], { submit: "Set password", intro: "Your administrator gave you a temporary password. Choose your own to continue." });
      if (!f) return; if (f.pw !== f.pw2) { U.toast("The two passwords differ.", { err: true }); continue; }
      try { await root.XFServer.changePassword(f.old, f.pw); U.toast("Password changed."); return; } catch (e) { U.toast(e.message, { err: true }); } }
  }
  async function enter() {
    $("#gate").hidden = true; $("#app").hidden = false;
    $("#view-dash").innerHTML = `<div class="page"><div class="empty"><div class="spinner"></div>Loading…</div></div>`;
    try { await U.loadConfig(); } catch (e) { console.error(e); U.toast("Settings could not be loaded; defaults are used.", { err: true }); }
    if (U.isAdmin()) { try { App.commissionCfg = await DPSales.commissionConfig(); } catch (e) { App.commissionCfg = null; } DPPrice.syncCopies().catch((e) => console.warn("price copies", e)); }
    DPAuth.touchActivity().catch(() => {});
    App.myPic = await DPAuth.avatarUrl(DPAuth.A.me.id).catch(() => null);
    DPNotify.on(bellUpdate); DPNotify.start(); if (root.DPLive) DPLive.start();
    $("#btn-bell").onclick = notifPanel;
    if (root.DPChatUI) DPChatUI.init();
    if (root.DPAssist) DPAssist.init();
    startLoops();
    if (U.isAdmin()) {
      DPLeadOps.releaseExpired().then((r) => { if (r.length) U.toast(`${r.length} lead(s) released after 24 hours without activity.`); }).catch((e) => console.warn("release", e));
      try { const moved = await DPStore.migrateLegacy(DPStore.st.userId, DPAuth.A.directory.map((r) => r.uid).filter(Boolean)); if (moved.length) U.toast(`${moved.length} project(s) from version 2.0 moved into their owners' folders.`); } catch (e) { console.warn("migration", e); }
      refreshBadges();
    }
    U.banner(); U.header();
    if (root.XFServer) serverFirstLogin().catch(() => {});
    const h = (location.hash || "").slice(1).split("/"), v = h[0];
    if (v && U.VIEWS.includes(v) && !U.PROJECT_VIEWS.includes(v)) U.go(v, h[1] ? { tab: h[1] } : {}); else U.go("dash");
  }
  /** Background work while the app is open: follow-up reminders for everyone; automatic order booking for administrators. */
  function startLoops() {
    clearInterval(App.loop); let n = 0;
    const tick = async () => { n++;
      try { if (Date.now() - DPLeadOps.LT.at > 50000) await DPLeadOps.loadActs(); const k = await DPLeadOps.checkReminders(); if (k) DPNotify.pull().catch(() => {});
        App.badges = App.badges || {}; App.badges.followups = DPLeadOps.followUps(DPStore.st.userId).filter((f) => ["overdue", "today"].includes(f.when)).length || 0; } catch (e) {}
      if (U.isAdmin()) { try { const booked = await DPOrders.intake(); if (booked.length) { U.toast(`${booked.length} accepted order(s) booked automatically.`); refreshBadges(); } } catch (e) { console.warn("intake", e); } }
      if (U.role() === "engineer") { try { const jobs = await DPOrders.listJobs(); App.badges = App.badges || {}; App.badges.engnew = jobs.filter((j) => (!j.engineerUid || (j.engineerUid === DPStore.st.userId && j.e && j.e.status === "review" && Date.now() - Date.parse(j.e.takenAt || 0) < 3 * 864e5)) && j.status !== "cancelled").length; } catch (e) {} }
      // 1.1: overdue customer payments (every 10 minutes), Ask CEO inbox, assistant unread
      if (n % 10 === 1 && root.DPPayUI && ["admin", "employee"].includes(U.role())) DPPayUI.checkOverdue().catch((e) => console.warn("overdue", e));
      if (root.DPAssist) { DPAssist.refresh(); if (U.isAdmin()) DPAssist.refreshInbox().catch(() => {}); }
      if (U.isAdmin() && n === 2 && root.DPMission) DPMission.autoMonthly().catch((e) => console.warn("pricing", e));
      if (U.isAdmin() && root.DPPayUI && n % 2 === 1) DPPayUI.queue().then((q) => { App.badges.payverify = q.length; rail(); }).catch(() => {});
      rail(); };
    tick(); App.loop = setInterval(tick, 60000);
  }
  async function refreshBadges() {
    if (!U.isAdmin()) return; App.badges = App.badges || {};
    try { const [subs, reqs, jobs, reps, comms] = await Promise.all([DPSales.allSubmissions(), DPAuth.processRequests(), DPOrders.listJobs(), DPOrders.listPaymentReports(), DPSales.allCommissions()]);
      const asg = jobs.filter((j) => j.booked);
      App.badges.approvals = subs.filter((s) => s.status === "submitted").length + reps.filter((r) => r.status === "submitted").length; App.badges.requests = reqs.open.length; App.requests = reqs.open;
      App.badges.engqueue = jobs.filter((a) => !a.engineerUid && a.status !== "cancelled").length;
      App.badges.comm = comms.filter((c) => ["calculated", "pending", "returned"].includes(c.status)).length;
      // engineering milestones may have made commissions eligible since the last administrator visit
      for (const a of asg) if (a.engineerUid) DPSales.checkEligibility(a.oid).catch(() => {}); } catch (e) { console.warn(e); }
    rail();
  }

  /* ---------------- notifications ---------------- */
  function bellUpdate() { const n = DPNotify.unread(), b = $("#bell-n"); if (!b) return; b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n); }
  const NICON = { deal: "★", order: "◆", quote: "◆", payment: "¤", commission: "%", engineering: "⚙", lead: "◎", followup: "⏰", message: "✉", chat: "✉", access: "⚿", info: "•" };
  let NF = { cat: "all", unread: false, history: false };
  /** Open the record a notification points to (Notification Center and pop-ups). */
  async function openNotif(n) {
    if (DPNotify.N.items.some((x) => x.id === n.id && !x.read)) DPNotify.markRead([n.id]).catch(() => {}); const L = n.link || {};
    if (n.type === "deal" && n.celebrate) DPNotify.celebrate(n);
    else if (L.chat && root.DPChatUI) DPChatUI.open({ dm: L.chat });
    else if (L.askceo && U.allowedView("askceo")) U.go("askceo", { uid: L.askceo });
    else if (L.assist && root.DPAssist) DPAssist.open(L.assist);
    else if (U.isAdmin() && n.ref && /^O-/.test(n.ref) && ["register", "proposals", "tracking", "approvals"].includes(L.view) && root.DPCeo2) DPCeo2.orderPanel(n.ref);
    else if (L.view && U.allowedView(L.view)) U.go(L.view, L.opts || {});
  }
  function notifPanel() {
    const draw = (m) => {
      const all = NF.history ? DPNotify.N.items : DPNotify.visible(), items = all.filter((n) => (NF.cat === "all" || DPNotify.categoryOf(n) === NF.cat) && (!NF.unread || !n.read));
      const counts = {}; all.filter((n) => !n.read).forEach((n) => { const c = DPNotify.categoryOf(n); counts[c] = (counts[c] || 0) + 1; });
      $("#np-cats", m).innerHTML = Object.entries(DPNotify.CATEGORIES).map(([k, l]) => `<button type="button" data-cat="${k}" class="${NF.cat === k ? "is-on" : ""}">${esc(l)}${k !== "all" && counts[k] ? ` <em>${counts[k]}</em>` : ""}</button>`).join("");
      $$("[data-cat]", m).forEach((b) => (b.onclick = () => { NF.cat = b.dataset.cat; draw(m); }));
      $("#np-list", m).innerHTML = items.length ? items.slice(0, 120).map((n) => `<div class="nitem${n.read ? "" : " unread"}" data-n="${esc(n.id)}" role="button" tabindex="0"><span class="ni">${NICON[n.type] || "•"}</span><span class="nt"><b></b><span></span><small>${esc(new Date(n.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))} · ${esc(DPNotify.CATEGORIES[DPNotify.categoryOf(n)])}</small></span><span class="nacts">${n.read ? "" : `<button class="btn ghost xs" data-mr="${esc(n.id)}">Mark read</button>`}${n.cleared ? `<span class="tiny muted">cleared</span>` : `<button class="nx" data-dis="${esc(n.id)}" title="Clear this notification" aria-label="Clear">✕</button>`}</span></div>`).join("") : `<div class="empty small">${all.length ? "Nothing in this filter." : "No notifications yet."}</div>`;
      items.slice(0, 120).forEach((n) => { const b = $(`[data-n="${CSS.escape(n.id)}"]`, m); if (!b) return; b.querySelector("b").textContent = n.title; b.querySelector(".nt span").textContent = n.body;
        const openIt = async () => { U.closeModal(); openNotif(n); };
        b.onclick = (e) => { if (e.target.closest("[data-mr]")) return; openIt(); }; b.onkeydown = (e) => { if (e.key === "Enter") openIt(); }; });
      $$("[data-mr]", m).forEach((x) => (x.onclick = async (e) => { e.stopPropagation(); await DPNotify.markRead([x.dataset.mr]); draw(m); }));
      $$("[data-dis]", m).forEach((x) => (x.onclick = async (e) => { e.stopPropagation(); try { await DPNotify.dismiss([x.dataset.dis]); } catch (er) { U.toast(er.message, { err: true }); } draw(m); }));
      bellUpdate();
    };
    const sp = root.DPSound ? DPSound.prefs() : null;
    U.openModal(`<div class="row between"><h2>Notification Center</h2><div class="row"><label class="check small"><input type="checkbox" id="np-un" ${NF.unread ? "checked" : ""}> Unread only</label><button class="btn ghost xs" id="np-all">Mark all as read</button><button class="btn ghost xs" id="np-clr">Clear all…</button><label class="check small"><input type="checkbox" id="np-hist" ${NF.history ? "checked" : ""}> Show cleared</label>${sp ? `<button class="btn ghost xs" id="np-snd" aria-pressed="${sp.on}" title="Notification sound">${U.svg(sp.on ? "sound" : "mute")} ${sp.on ? "Sound on" : "Muted"}</button>` : ""}</div></div>
      ${sp ? `<details class="small" id="np-sp"><summary>Sound settings</summary><div class="row" style="gap:12px;flex-wrap:wrap;margin-top:6px">${[["message", "Messages & Ask CEO"], ["payment", "Payments"], ["order", "Orders"], ["engineering", "Engineering"], ["followup", "Follow-ups"], ["commission", "Commission"], ["lead", "Leads"]].map(([k, l]) => `<label class="check"><input type="checkbox" data-snd="${k}" ${sp.kinds[k] ? "checked" : ""}> ${l}</label>`).join("")}<label class="row" style="gap:6px">Volume <input type="range" id="np-vol" min="0" max="1" step="0.1" value="${sp.volume}"></label><button class="btn ghost xs" id="np-test">Play test sound</button></div><p class="tiny muted">Browsers only play sound after you have clicked or typed on the page; until then notifications stay silent but still appear here. Saved in this browser.</p></details>` : ""}
      <div class="chips" id="np-cats" role="tablist" aria-label="Notification categories"></div><div class="nlist" id="np-list"></div><div class="acts"><button class="btn ghost" id="np-x">Close</button></div>`, (m) => {
      draw(m); $("#np-x", m).onclick = () => U.closeModal(); $("#np-un", m).onchange = (e) => { NF.unread = e.target.checked; draw(m); };
      if (root.DPSound) { const snd = $("#np-snd", m), upd = () => { const p = DPSound.prefs(); snd.innerHTML = `${U.svg(p.on ? "sound" : "mute")} ${p.on ? "Sound on" : "Muted"}`; snd.setAttribute("aria-pressed", p.on); };
        snd.onclick = () => { const p = DPSound.prefs(); p.on = !p.on; DPSound.save(p); upd(); };
        $$("[data-snd]", m).forEach((c) => (c.onchange = () => { const p = DPSound.prefs(); p.kinds[c.dataset.snd] = c.checked; DPSound.save(p); }));
        $("#np-vol", m).onchange = (e) => { const p = DPSound.prefs(); p.volume = +e.target.value; DPSound.save(p); };
        $("#np-test", m).onclick = () => { if (!DPSound.test()) U.toast("This browser did not allow sound. Click anywhere on the page and try again.", { err: true }); }; }
      const inCat = () => DPNotify.visible().filter((x) => NF.cat === "all" || DPNotify.categoryOf(x) === NF.cat).map((x) => x.id);
      $("#np-all", m).onclick = async () => { try { await DPNotify.markAllRead(NF.cat === "all" ? null : inCat()); } catch (e) { U.toast(e.message, { err: true }); } draw(m); };
      $("#np-clr", m).onclick = async () => { const n = inCat().length; if (!n) return; if (!(await U.ask("Clear notifications?", `${n} notification(s)${NF.cat === "all" ? "" : " in this category"} will be cleared from your list. They stay in your history (tick “Show cleared”) and nobody else's notifications change.`, [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Clear", value: true }]))) return notifPanel();
        try { await DPNotify.clearAll(NF.cat === "all" ? null : inCat()); U.toast("Notifications cleared."); } catch (e) { U.toast(e.message, { err: true }); } notifPanel(); };
      $("#np-hist", m).onchange = (e) => { NF.history = e.target.checked; draw(m); };
      DPNotify.pull().then(() => { if ($("#np-list", m)) draw(m); }); }, { wide: true });
  }

  /* ---------------- small shared UI helpers ---------------- */
  const money = (m, cur) => DPPricing.fmtMoney(m, cur || "EGP", { dp: 0 });
  const money2 = (m, cur) => DPPricing.fmtMoney(m, cur || "EGP");
  const pctS = (x) => (x == null || !isFinite(x) ? "—" : (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%");
  const dateS = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—");
  const perLabel = (per) => { const [y, m] = per.split("-"); return new Date(+y, +m - 1, 15).toLocaleDateString([], { month: "long", year: "numeric" }); };
  const curPer = () => new Date().toISOString().slice(0, 7);
  /** Month picker: last 12 months. */
  function perSelect(id, val) { return `<select class="in sm" id="${id}" style="width:auto">${DPSales.lastPeriods(12).map((p) => `<option value="${p}"${p === val ? " selected" : ""}>${esc(perLabel(p))}</option>`).join("")}</select>`; }
  /** Progress ring (SVG). */
  function ring(frac, label) {
    const f = Math.max(0, Math.min(1, frac || 0)), r = 46, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 110 110" role="img" aria-label="${esc(label)}"><circle cx="55" cy="55" r="${r}" class="rbg"/>${f > 0 ? "" : "<!--"}<circle cx="55" cy="55" r="${r}" class="rfg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 55 55)"/>${f > 0 ? "" : "-->"}
      <text x="55" y="53" text-anchor="middle" class="rt">${Math.round((frac || 0) * 100)}%</text><text x="55" y="70" text-anchor="middle" class="rs">of target</text></svg>`;
  }
  function stat(label, value, sub, cls = "") { return `<div class="stat ${cls}"><span class="eyebrow">${esc(label)}</span><b class="num">${value}</b>${sub ? `<span class="tiny muted">${sub}</span>` : ""}</div>`; }
  function bars(rows, { fmt = (v) => v, target = null } = {}) {
    const max = Math.max(1, ...rows.map((r) => r.v), target || 0);
    return `<div class="bars">${rows.map((r) => `<div class="bar"><span class="bl">${esc(r.l)}</span><span class="bt"><i style="width:${(r.v / max * 100).toFixed(1)}%"></i>${target ? `<s style="left:${(target / max * 100).toFixed(1)}%" title="Target"></s>` : ""}</span><span class="bv num">${esc(fmt(r.v))}</span></div>`).join("")}</div>`;
  }

  /** Circular picture (or initials) for a user id. */
  async function picHtml(uid, size = 40, cls = "") { const src = await DPAuth.avatarUrl(uid); return `<img class="pic ${cls}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" alt="" src="${esc(src)}">`; }
  root.DPShell = { openNotif, bellUpdate, startLoops, rail, nav, gate, enter, signOut, notifPanel, picHtml, ownerIds, myOwnedLeads, refreshBadges, money, money2, pctS, dateS, perLabel, curPer, perSelect, ring, stat, bars };
})(typeof self !== "undefined" ? self : this);
