/* X FORCE 1.0 (Dupedia) — UI core: app state, configuration, navigation, dialogs, save/load. */
/* global DPModel, DPStore, DPCat, DPPricing, DPCanvas, DPIO */
(function (root) {
  "use strict";
  const M = DPModel, S = M.S;
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = {
    select: '<path d="M5 3l14 8-6 2-3 6z"/>', pan: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    measure: '<rect x="2" y="8" width="20" height="8" rx="1"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>', rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>', del: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.1 3.6M6.3 7.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.2-1"/>',
    align: '<path d="M4 4v16M8 7h12M8 12h8M8 17h10"/>', layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', zin: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M21 21l-5-5"/>', zout: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-5-5"/>',
    export: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>', fence: '<path d="M3 20V8l2-2 2 2v12M10 20V8l2-2 2 2v12M17 20V8l2-2 2 2v12M3 11h18M3 16h18"/>',
    area: '<path d="M4 6l7-3 9 5-2 11-12 2z"/>', rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>', path: '<path d="M4 20c4-8 4-8 8-8s4-8 8-8"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', dash: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M12 13l4-4"/><path d="M4 18h16"/>', planner: '<path d="M4 20V4h16v16z"/><path d="M4 9h6v11M14 4v6h6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    mine: '<path d="M3 20h18M6 20V10l6-6 6 6v10"/><path d="M10 20v-5h4v5"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    team: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    truck: '<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', clip: '<path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    report: '<path d="M4 20V4M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>', factory: '<path d="M3 20V9l5 3V9l5 3V9l5 3V4h3v16z"/>', search2: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>', audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12l2 2 4-4"/>', bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>', send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
    leads: '<path d="M4 6h16M4 12h10M4 18h6"/><circle cx="18" cy="16" r="3"/><path d="M20.2 18.2 22 20"/>', out: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>', check: '<path d="m5 12 5 5 9-10"/>', show: '<path d="M3 6h18M3 12h18M3 18h12"/>', front: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V4h12"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ""}</svg>`;

  const DEFAULT_SETTINGS = {
    currency: "EGP", taxPct: 0, taxLabel: "VAT", refPrefix: "DUP",
    discountRoles: { 5: "employee", 10: "employee" },
    discountEligible: { equipment: true, landscape: true, flooring: true, installation: true, services: true, additional: true },
    employeeOverrides: false,
    sales: { monthlyTarget: 500000 },                      // default monthly sales target per employee (EGP, eligible value)
    leadPriority: { high: 75, medium: 60 },                // Lead Mine priority thresholds on the 100-point qualification score
    charges: [],          // [{id,label,cat,method,value,base}]
    terms: { scope: "", assumptions: "", exclusions: "", installation: "", payment: "", delivery: "", validity: "", warranty: "", acceptance: "" },
    company: { name: "Dupedia", address: "", phone: "", email: "", web: "", reg: "", taxNo: "" },
    // 1.1
    payTerms: { depositPct: 50, escalateDays: 7 },          // initial deposit milestone on every accepted order; overdue escalation
    engineering: { defaultEngineer: null },                 // accepted orders go to this engineer automatically (null = Unassigned queue)
    askCeo: { ceo: null, readers: [] },                     // Ask CEO: the CEO account and other administrators allowed to read
    intel: { triggerId: "", fxBase: "EGP", fxStaleHours: 36, materialStaleDays: 45, quoteValidDays: 30 },
  };
  const App = {
    view: "home", config: { settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), pricebook: { currency: "EGP", items: {}, log: [] }, catalog: { overrides: {}, custom: [] } },
    costs: null, baseRev: null, open: false, pricing: null, saving: false, autosaveTimer: null, sample: false,
  };

  /* ---------------- toasts & modals ---------------- */
  function toast(msg, { err = false, action = null, ms = 4200 } = {}) {
    const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { action.fn(); t.remove(); }; t.appendChild(b); }
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), action ? ms * 2 : ms);
  }
  const modal = { el: null, onClose: null };
  function openModal(html, bind, { wide = false, onClose = null } = {}) {
    const el = $("#modal"); modal.el = el; el.classList.toggle("wide", !!wide); $("#modal-in").innerHTML = html; modal.onClose = onClose;
    if (!el.open) el.showModal(); bind && bind($("#modal-in")); const f = $("#modal-in [autofocus]") || $("#modal-in .in"); f && setTimeout(() => f.focus(), 30);
  }
  function closeModal(result) { const el = $("#modal"); if (el.open) el.close(); const cb = modal.onClose; modal.onClose = null; cb && cb(result); }
  /** Confirmation dialog built into the page (native confirm() is unavailable in the viewer). */
  function ask(title, body, buttons = [{ label: "Cancel", value: false, cls: "ghost" }, { label: "OK", value: true }]) {
    return new Promise((res) => openModal(`<h2>${esc(title)}</h2>${body ? `<div class="stack small">${body}</div>` : ""}<div class="acts">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div>`,
      (m) => $$("[data-i]", m).forEach((b) => (b.onclick = () => closeModal(buttons[+b.dataset.i].value))), { onClose: (v) => res(v === undefined ? false : v) }));
  }
  /** Small form dialog: fields [{id,label,type,value,options,required,unit,step,help}] → resolves {id:value} or null. */
  function form(title, fields, { submit = "Save", intro = "", wide = false } = {}) {
    return new Promise((res) => {
      const f = fields.map((x) => {
        const id = "f-" + x.id;
        if (x.type === "select") return `<label class="field"><span>${esc(x.label)}</span><select class="in" id="${id}">${x.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(x.value) ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${x.help ? `<small>${esc(x.help)}</small>` : ""}</label>`;
        if (x.type === "textarea") return `<label class="field"><span>${esc(x.label)}</span><textarea class="in" id="${id}" rows="${x.rows || 3}">${esc(x.value || "")}</textarea>${x.help ? `<small>${esc(x.help)}</small>` : ""}</label>`;
        if (x.type === "check") return `<label class="check"><input type="checkbox" id="${id}"${x.value ? " checked" : ""}> ${esc(x.label)}</label>`;
        return `<label class="field"><span>${esc(x.label)}</span><div class="${x.unit ? "unit" : ""}"><input class="in${x.type === "number" ? " num" : ""}" id="${id}" type="${x.type || "text"}" ${x.step ? `step="${x.step}"` : ""} ${x.min != null ? `min="${x.min}"` : ""} value="${esc(x.value == null ? "" : x.value)}" ${x.required ? "required" : ""} ${x.placeholder ? `placeholder="${esc(x.placeholder)}"` : ""}>${x.unit ? `<em>${esc(x.unit)}</em>` : ""}</div>${x.help ? `<small>${esc(x.help)}</small>` : ""}</label>`;
      }).join("");
      openModal(`<h2>${esc(title)}</h2>${intro ? `<p class="small muted">${intro}</p>` : ""}<form class="stack" id="dlg-form" novalidate>${f}<p class="small" id="dlg-err" style="color:var(--red)"></p><div class="acts"><button type="button" class="btn ghost" id="dlg-cancel">Cancel</button><button type="submit" class="btn">${esc(submit)}</button></div></form>`,
        (m) => { $("#dlg-cancel", m).onclick = () => closeModal(null);
          $("#dlg-form", m).onsubmit = (e) => { e.preventDefault(); const out = {};
            for (const x of fields) { const el = $("#f-" + x.id, m); let v = x.type === "check" ? el.checked : el.value;
              if (x.type === "number") { v = v === "" ? null : +v; if (v != null && !isFinite(v)) { $("#dlg-err", m).textContent = `${x.label}: enter a number.`; return; } if (x.min != null && v != null && v < x.min) { $("#dlg-err", m).textContent = `${x.label}: must be at least ${x.min}.`; return; } }
              if (x.required && (v === "" || v == null)) { $("#dlg-err", m).textContent = `${x.label} is required.`; el.focus(); return; }
              out[x.id] = v; }
            closeModal(out); }; }, { onClose: (v) => res(v || null), wide });
    });
  }
  function busy(label) { openModal(`<div class="row"><div class="spinner"></div><b id="busy-l">${esc(label)}</b></div>`); return { set: (t) => { const e = $("#busy-l"); if (e) e.textContent = t; }, done: () => closeModal() }; }

  /* ---------------- configuration ---------------- */
  async function loadConfig() {
    // 2.2: the price book comes from DPPrice — administrators read the master, sales their own copy, other roles nothing
    const [settings, priced, catalog] = await Promise.all([DPStore.getConfig("settings").catch(() => null), root.DPPrice.load().catch(() => ({})), DPStore.getConfig("catalog").catch(() => null)]);
    const pricebook = priced.pricebook || null; App.commissionCfg = priced.commission && priced.commission.versions ? Object.assign({ trigger: "approval" }, priced.commission) : null;
    App.config.settings = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), settings || {});
    App.config.pricebook = Object.assign({ currency: App.config.settings.currency || "EGP", items: {}, log: [] }, pricebook || {});
    App.config.catalog = Object.assign({ overrides: {}, custom: [] }, catalog || {});
    DPCat.setCatalogConfig(App.config.catalog);
    if (root.DPProd) await root.DPProd.refreshCatalog().catch(() => {});
    if (root.DPHolUI) await root.DPHolUI.load().catch(() => {});   // 1.3: published Dupedia Products join the planner
    App.costs = null;
    if (isAdmin()) { const c = await DPStore.getRestricted("costs"); App.costs = (c && c.items) || {}; App.intelCfg = (await DPStore.tryGet("mix/intelcfg")) || {}; }
  }
  function deepMerge(a, b) { for (const k of Object.keys(b || {})) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
  const role = () => DPStore.st.role;
  const me = () => (root.DPAuth && root.DPAuth.A.me) || null;
  const isAdmin = () => role() === "admin";
  const canWrite = () => role() !== "viewer";
  const userInfo = () => ({ id: DPStore.st.userId, name: DPStore.st.userName || "" });

  /* ---------------- pricing (single computation used everywhere) ---------------- */
  function pricing() {
    const m = M.metrics();
    App.pricing = DPPricing.compute({ project: S.project, takeoff: M.takeoff(), pricebook: App.sample && App.samplePrices ? App.samplePrices : App.config.pricebook, settings: App.config.settings, costs: isAdmin() ? App.costs : null, siteArea: m.siteArea, productCount: m.products });
    S.project._summaryTotal = App.pricing.total; S.project._summaryCurrency = App.pricing.currency;
    try { S.project._summaryBase = root.DPCommission ? root.DPCommission.base(App.pricing, App.config.settings) : null; } catch (e) { S.project._summaryBase = null; }
    return App.pricing;
  }
  const money = (minor, cur) => DPPricing.fmtMoney(minor, cur || (App.pricing && App.pricing.currency) || App.config.pricebook.currency);

  /* ---------------- navigation ---------------- */
  const PROJECT_VIEWS = ["setup", "plan", "quote", "review", "proposal"];
  const ADMIN_VIEWS = ["admin", "allleads", "employees", "users", "commadmin", "reports", "approvals", "engqueue", "register", "approvecomm", "audit", "search", "payverify", "workforce", "askceo", "mission"];
  const GROWTH_VIEWS = ["growth", "campaigns", "radar", "partners"];
  const OPS_VIEWS = ["reminders", "facjobs", "facdash", "equipment", "products", "catalog", "holidays"];
  const FIN_VIEWS = ["finance", "transfers", "finaccounts", "salaries", "purchases", "invoices", "taxes", "finreports"];
  const VIEWS = ["dash", "home", "proposals", "leads", "myleads", "mycomm", "profile", "tracking", "calls", "engorders", "workers", "research", "factory", "messages", "start", "intel"].concat(PROJECT_VIEWS, ADMIN_VIEWS, FIN_VIEWS, OPS_VIEWS, GROWTH_VIEWS);
  /** Which views each access level may open (administrators: all). Enforcement of data is in the database rules. */
  const ROLE_VIEWS = {
    employee: ["dash", "home", "proposals", "leads", "myleads", "mycomm", "profile", "tracking", "calls", "messages", "start", "intel", "reminders", "catalog", "campaigns", "radar", "partners"].concat(PROJECT_VIEWS),
    engineer: ["dash", "engorders", "factory", "workers", "profile", "messages", "facjobs", "facdash", "equipment", "reminders", "catalog"],
    dataentry: ["dash", "research", "leads", "calls", "profile", "messages", "intel", "reminders"],
    viewer: ["dash", "profile"],
    marketing: ["dash", "profile", "messages", "reminders", "catalog", "leads", "intel"].concat(GROWTH_VIEWS),
    accountant: ["dash", "profile", "messages", "payverify", "approvecomm", "workers", "reminders", "holidays", "catalog"].concat(FIN_VIEWS),
  };
  const allowedView = (v) => isAdmin() || (ROLE_VIEWS[role()] || ROLE_VIEWS.viewer).includes(v);
  const renderers = {};
  function register(view, fn) { renderers[view] = fn; }
  function go(view, opts = {}) {
    if (!root.DPAuth || !root.DPAuth.A.ready) return;
    if (!VIEWS.includes(view)) view = "dash";
    if (view === "dash" && role() === "accountant") view = "finance";
    if (view === "dash" && role() === "marketing") view = "growth";   // 1.4: Marketing's home is the Growth Command Center   // 1.2: the Accountant's home is the Finance dashboard
    if (PROJECT_VIEWS.includes(view) && !App.open && !(view === "setup" && opts.isNew)) view = "home";
    if (!allowedView(view)) { toast("That page is not available for your role.", { err: true }); view = "dash"; }
    App.view = view; App.newSetup = view === "setup" && !!opts.isNew; App.viewOpts = opts; $("#app").dataset.view = view;
    $("#app").dataset.zone = PROJECT_VIEWS.includes(view) && !App.newSetup ? "project" : "app";
    $$("#flow button").forEach((b) => { b.classList.toggle("is-on", b.dataset.view === view); });
    header(); if (root.DPShell) root.DPShell.rail();
    if (renderers[view]) renderers[view](opts);
    if (view === "plan") setTimeout(() => { window.dispatchEvent(new Event("resize")); DPCanvas.req(); }, 0);
    try { if (!PROJECT_VIEWS.includes(view) || App.open) history.replaceState(null, "", "#" + view + (opts.tab ? "/" + opts.tab : "")); } catch (e) {}
  }
  function header() {
    const open = App.open && PROJECT_VIEWS.includes(App.view) && !(App.view === "setup" && App.newSetup);
    $("#ptitle").hidden = !open; $("#flow").hidden = !open; $("#htitle").hidden = open; $("#btn-save").hidden = !App.open || !canWrite() || !PROJECT_VIEWS.includes(App.view);
    $("#btn-admin").hidden = true; $("#btn-back").hidden = !open;
    if (open) { $("#pname").value = S.project.meta.name; const m = S.project.meta; $("#psub").textContent = [m.ref, m.client, m.location, STATUS_LABEL[m.status] || "Draft"].filter(Boolean).join(" · "); }
    const u = me(), rb = $("#role-badge");
    rb.innerHTML = u ? `<img class="av" alt="" src="${esc(App.myPic || (root.DPAuth ? root.DPAuth.initialsAvatar(u.name) : ""))}"><span class="un">${esc(u.name || u.email || "Signed in")}</span><span class="ur">${esc(u.role === "viewer" ? "View only" : u.roleLabel || "Employee")}</span>` : "";
    rb.classList.toggle("admin", isAdmin()); rb.hidden = !u;
  }
  const STATUS_LABEL = { draft: "Draft", issued: "Issued — awaiting client", submitted: "Awaiting approval", accepted: "Accepted (order)", won: "Won", lost: "Rejected / lost", cancelled: "Cancelled" };
  const STATUS_PILL = { draft: "", issued: "info", submitted: "warn", accepted: "ok", won: "ok", lost: "err", cancelled: "err" };
  function banner() {
    const b = $("#banner"), st = DPStore.st;
    const w = (root.DPAuth && root.DPAuth.A.warnings) || [];
    if (st.mode === "local") { b.hidden = false; b.innerHTML = `<b>Local demonstration mode.</b> Accounts, projects and prices are stored in this browser only. The sign-in protects nothing on this device and no rule is enforced by a server. Use the published version on claude.ai for real accounts and protected data. <b>Nothing is shared between devices here:</b> a payment proof uploaded by a salesperson on their computer cannot be seen by the CEO on another computer.`; }
    else if (w.length) { b.hidden = false; b.innerHTML = w.map((x) => `<b>Access check.</b> ${esc(x)}`).join("<br>"); }
    else if (st.mode === "memory") { b.hidden = false; b.innerHTML = `<b>Storage unavailable.</b> This browser blocks local storage, so nothing will be kept after you close the page. Export the project file to keep your work.`; }
    else if (st.role === "viewer") { b.hidden = false; b.innerHTML = `<b>View only.</b> You can open projects and proposals. Ask an administrator for Contributor access to edit.`; }
    else b.hidden = true;
  }

  /* ---------------- save & open ---------------- */
  function setSaveState(t, warn = false) { const e = $("#save-state"); e.textContent = t; e.classList.toggle("warn", warn); }
  function scheduleAutosave() {
    if (!App.open || !canWrite() || App.sample) return; setSaveState("Unsaved changes", true);
    clearTimeout(App.autosaveTimer); App.autosaveTimer = setTimeout(() => save({ auto: true }), 3500);
  }
  async function save({ auto = false, force = false } = {}) {
    if (!App.open || !canWrite()) return false;
    if (App.sample) {
      if (auto) return false;
      const ok = await ask("Save a copy of the sample?", "<p>The sample becomes one of your projects. Its illustrative prices are not kept: lines are priced from your own price book.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Save as my project", value: true }]);
      if (!ok) return false;
      App.sample = false; App.samplePrices = null; S.project.meta.id = M.uid("p-"); S.project.meta.ownerId = DPStore.st.userId || "local"; S.project.meta.ref = nextRef(); S.project.meta.client = ""; App.baseRev = null; M.audit("Created from sample", ""); header();
    }
    if (App.saving) { App.saveAgain = true; return false; }
    App.saving = true; setSaveState("Saving…");
    try {
      pricing();
      const r = await DPStore.saveProject(S.project, { cadData: S.cadData, baseRev: App.baseRev, force, user: userInfo() });
      if (r.conflict && statusOnlyChange(r.remote)) {
        // an administrator changed only the project's status (order approved, returned, cancelled): take their status, keep my work
        const rm = r.remote.project.meta; for (const k of ["status", "orderId", "wonAt", "statusNote", "acceptedAt", "lostReason"]) if (k in rm) S.project.meta[k] = rm[k];
        App.baseRev = r.remote.rev; App.saving = false; header(); return save({ auto });
      }
      if (r.conflict) {
        setSaveState("Not saved: changed by someone else", true);
        const choice = await ask("Someone else saved this project", `<p>${esc(r.remote.savedBy || "Another user")} saved a newer version at ${new Date(r.remote.savedAt).toLocaleString()}. Your changes have not been saved yet.</p>`,
          [{ label: "Keep theirs (reload)", value: "reload", cls: "ghost" }, { label: "Save mine as a copy", value: "copy", cls: "ghost" }, { label: "Overwrite with mine", value: "force", cls: "danger" }]);
        App.saving = false;
        if (choice === "reload") return openProject(S.project.meta.id);
        if (choice === "copy") { S.project.meta.id = M.uid("p-"); S.project.meta.name += " (copy)"; App.baseRev = null; M.audit("Saved as copy", "after a save conflict"); return save(); }
        if (choice === "force") { M.audit("Overwrote newer version", `of ${r.remote.savedBy || "another user"}`); return save({ force: true }); }
        return false;
      }
      if (r.ok && root.DPAuth) root.DPAuth.logActivity("Saved project", S.project.meta.ref || S.project.meta.name).catch(() => {});
      if (r.tooLarge) { setSaveState("Not saved: project too large", true); toast(`This project is too large for shared storage (${Math.round(r.bytes / 1024)} KB). Export the project file, and remove unused imported drawings or images.`, { err: true, ms: 9000 }); return false; }
      App.baseRev = r.rev; S.dirty = false;
      setSaveState(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${DPStore.st.mode === "local" ? " on this device" : ""}`);
      if (r.cadNote && !auto) toast(r.cadNote);
      if (S.project.ref && S.refImage) DPStore.putLocalHeavy(S.project.meta.id, { refImage: S.refImage });
      return true;
    } catch (e) { console.error(e); setSaveState("Save failed", true); if (!auto) toast("Saving failed: " + (e.message || e.code || "storage unavailable") + ". Your work is still open; try again or export the project file.", { err: true, ms: 9000 }); return false; }
    finally { App.saving = false; if (App.saveAgain) { App.saveAgain = false; scheduleAutosave(); } }
  }
  /** True when the newer saved copy differs from mine only by an administrator's status change. */
  function statusOnlyChange(remote) {
    try { const a = remote.project, b = S.project, pick = (p) => JSON.stringify({ o: p.objects, s: p.site, pr: p.pricing, pp: p.proposal, n: p.meta.name, c: p.meta.client });
      const last = (a.audit || []).slice(-1)[0] || {}; return pick(a) === pick(b) && /^Status( set to|:)/.test(last.action || ""); } catch (e) { return false; }
  }
  async function openProject(id, owner) {
    const b = busy("Opening project…");
    try {
      const d = await DPStore.loadProject(id, owner); if (!d) { b.done(); toast("That project no longer exists.", { err: true }); return; }
      const heavy = d.project.ref ? await DPStore.getLocalHeavy(id) : null;
      M.load(d.project, { cadData: d.cadData, refImage: heavy && heavy.refImage || null });
      App.baseRev = d.rev; App.open = true; App.sample = false; b.done();
      if (d.project.ref && !(heavy && heavy.refImage)) toast("The reference image for this project is stored on the device that imported it. Re-import it to see it here.");
      setSaveState(d.savedAt ? `Saved ${new Date(d.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}${d.savedBy ? " by " + d.savedBy : ""}` : "");
      DPStore.setPref("lastProject", id);
      go("plan"); setTimeout(() => DPCanvas.fit(), 30);
    } catch (e) { b.done(); console.error(e); toast("Could not open the project: " + (e.message || e.code), { err: true }); }
  }
  function startProject(project, { cadData = null, refImage = null, sample = false } = {}) {
    M.load(project, { cadData, refImage }); App.baseRev = null; App.open = true; App.sample = sample;
    S.project.meta.ownerId = DPStore.st.userId || "local";
    if (!sample) { M.audit("Created project", project.meta.name); scheduleAutosave(); }
    setSaveState(sample ? "Sample project (not saved)" : "Not saved yet", !sample);
  }
  function nextRef() { const d = new Date(), p = App.config.settings.refPrefix || "DUP"; return `${p}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`; }

  function pickFile(accept, cb) { const fi = $("#file-in"); fi.value = ""; fi.accept = accept; fi.onchange = () => { const f = fi.files && fi.files[0]; if (f) cb(f); }; fi.click(); }
  /** Offer a generated file. Resolves true only when the file was handed over (saved by the viewer or downloaded by the browser). */
  async function downloadOut(out, what) {
    try { const how = await DPIO.download(out.blob, out.filename); toast(how === "saved" ? `${what} saved: ${out.filename}` : `${what} downloaded: ${out.filename}`); return true; }
    catch (e) { toast(e && e.code === "declined" ? "Download cancelled." : `${what} could not be saved: ${e.message || e.code}`, { err: e && e.code !== "declined" }); return false; }
  }

  try { root.addEventListener("beforeunload", (e) => { if (App.open && M.S.dirty && canWrite() && !App.sample) { e.preventDefault(); e.returnValue = ""; } }); } catch (e) {}
  root.DPUI = { $, $$, esc, svg, ICON, App, DEFAULT_SETTINGS, toast, openModal, closeModal, ask, form, busy, loadConfig, role, me, isAdmin, canWrite, userInfo, pricing, money,
    register, go, header, banner, VIEWS, PROJECT_VIEWS, ADMIN_VIEWS, ROLE_VIEWS, FIN_VIEWS, allowedView, STATUS_LABEL, STATUS_PILL, setSaveState, scheduleAutosave, save, openProject, startProject, nextRef, pickFile, downloadOut, deepMerge };
})(typeof self !== "undefined" ? self : this);
