/* X FORCE — Market Intelligence 2.0, Phase 1: the administrators' screen (Data Readiness, product capability, company names,
   job ledger, the switch). Reached from Mission Control → Automation Health. Nothing here is visible to other roles. */
/* global DPUI, DPStore, DPAuth, DPMiEngine */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, E = DPMiEngine;
  const S = { tab: "leads", counts: null, lf: "todo", lp: 0 };
  const TABS = [["leads", "Existing leads"], ["sched", "Research schedule"], ["ready", "Data readiness"], ["cap", "Product capability"], ["names", "Company names"], ["jobs", "Job ledger"]];
  const STATE = { ready: ["Ready", "ok"], partial: ["Partly", "warn"], none: ["Not yet", "err"] };
  const num = (x) => (Number(x) || 0).toLocaleString("en-US");
  const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  const loadCfg = async () => E.cfgOf(await DPStore.tryGet("mix/enginecfg"));

  /** New settings version: the current one is kept in mix/enginev, and the change is audited with its reason. */
  async function saveCfg(patch, reason) {
    if (!U.isAdmin()) throw new Error("Administrators only."); if (!String(reason || "").trim()) throw new Error("Give a reason for the change.");
    const prev = await loadCfg(), at = new Date().toISOString(), version = (prev.version || 0) + 1;
    const next = Object.assign({}, prev, patch, { version, updatedAt: at, updatedBy: DPAuth.A.me.id });
    if (prev.version) await DPStore.set(`mix/enginev/v/${prev.version}`, Object.assign({}, prev, { replacedAt: at, replacedBy: DPAuth.A.me.id }));
    await DPStore.set("mix/enginecfg", next);
    await DPAuth.auditLog("Market Intelligence settings changed", { kind: "mi", reason, detail: `Version ${version}`, before: { capability: prev.capability }, after: { capability: next.capability } }).catch(() => {});
    return next;
  }
  /** The switch lives in config/settings. It is re-read first, so nothing else in the settings is overwritten. */
  async function setSwitch(on, reason) {
    if (!U.isAdmin()) throw new Error("Administrators only."); if (!String(reason || "").trim()) throw new Error("Give a reason.");
    const cur = (await DPStore.getConfig("settings")) || {};
    await DPStore.setConfig("settings", Object.assign({}, cur, { miEngine: !!on }));
    App.config.settings.miEngine = !!on;
    await DPAuth.auditLog(on ? "Market Intelligence engine switched on" : "Market Intelligence engine switched off", { kind: "mi", reason }).catch(() => {});
  }

  async function render() {
    const V = $("#view-miengine"), on = !!App.config.settings.miEngine;
    V.innerHTML = `<div class="page"><div class="phead"><div><span class="eyebrow">Market Intelligence 2.0 · Administrators only</span><h1>Engine <em>foundation</em></h1>
        <p class="lead small">What the records can support today, what Dupedia sells, and the switch for the new research rules.</p></div>
      <div class="row"><span class="pill ${on ? "ok" : "warn"}">Engine ${on ? "on" : "off"}</span><button class="btn ghost sm" id="me-sw">${on ? "Switch off…" : "Switch on…"}</button><button class="btn lime sm" id="me-mc">${U.svg("globe")} Mission Control</button></div></div>
      <div class="note small">${on ? "New research results use the corrected scoring and Arabic-safe matching. Records saved earlier keep their score." : "Off: research works exactly as before. Switching on affects only new research results: corrected word matching, Egypt and Saudi locations told apart, AI product labels add no points, a published project budget is no longer treated as Dupedia's value, and Arabic records stay separate."}</div>
      <div class="chips mi-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" class="chip${S.tab === k ? " is-on" : ""}" data-mt="${k}">${esc(l)}</button>`).join("")}</div>
      <div id="me-body"><div class="empty"><div class="spinner"></div>Loading…</div></div></div>`;
    $("#me-mc").onclick = () => U.go("mission", { tab: "auto" });
    $("#me-sw").onclick = async () => { const f = await U.form(on ? "Switch the engine off" : "Switch the engine on", [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { submit: on ? "Switch off" : "Switch on", intro: "Applies from the next research run. Saved records are not changed." }); if (!f) return; try { await setSwitch(!on, f.r); U.toast(on ? "Engine switched off." : "Engine switched on."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
    $$("[data-mt]", V).forEach((b) => (b.onclick = () => { S.tab = b.dataset.mt; render(); }));
    const B = $("#me-body");
    try { await ({ leads: leadsTab, sched: schedTab, ready: readyTab, cap: capTab, names: namesTab, jobs: jobsTab })[S.tab](B); }
    catch (e) { B.innerHTML = `<div class="note err">Could not load (${esc(e.message || e.code)}).</div>`; }
  }

  /* ---------------- Phase 2a: existing leads ---------------- */
  const RS = { queued: ["Queued", ""], running: ["Researching", "info"], waiting: ["Waiting", "warn"], review: ["Results to review", "ok"], nothing: ["Nothing found", ""], failed: ["Failed", "err"], done: ["Reviewed", "ok"] };
  const LF = [["todo", "Not researched"], ["review", "Results to review"], ["active", "In progress"], ["done", "Reviewed"], ["all", "All"]];
  async function leadsTab(B) {
    const on = !!App.config.settings.miEngine, cfg = await loadCfg();
    const [leads, enr] = await Promise.all([DPLeads.listLeads(), DPStore.tryList("mix/enrich/e")]);
    const E2 = Object.fromEntries(enr.map((x) => [x.id, x.data])), now = Date.now();
    const rows = leads.filter((l) => !["archived", "merged", "inactive"].includes(l.status)).map((l) => Object.assign({ l, e: E2[l.id] || null }, E.rankLead(l, now))).sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => (r.rank = i + 1));
    const st = (r) => (r.e ? r.e.status : "todo"), pick = { todo: (r) => !r.e, review: (r) => st(r) === "review", active: (r) => ["queued", "running", "waiting", "failed"].includes(st(r)), done: (r) => ["done", "nothing"].includes(st(r)), all: () => true }[S.lf];
    const vis = rows.filter(pick), page = vis.slice(S.lp * 50, S.lp * 50 + 50), cnt = (k) => rows.filter({ todo: (r) => !r.e, review: (r) => st(r) === "review", active: (r) => ["queued", "running", "waiting", "failed"].includes(st(r)), done: (r) => ["done", "nothing"].includes(st(r)), all: () => true }[k]).length;
    B.innerHTML = `<div class="stack">${on ? "" : `<div class="note warn small">The engine is off. Ranking works, but research starts only when it is on.</div>`}
      <div class="card stack"><div class="row between"><div><h3>${rows.length} open leads, ranked</h3><p class="small muted">Best first for research: product fit, evidence, earlier qualification, location, ways to reach, and how recent the evidence is. A ranking, not a probability. Research finds the official website, published business phone numbers and e-mails, and current projects, each with its source. Up to ${cfg.enrichPerDay} leads a day, about 4 to 6 search credits each. ${cfg.autoAdd ? "A found website, company e-mail and phone are filled in automatically, marked unverified; you can undo it in Results." : "Nothing is added to a lead until you approve it."}</p></div>
        <div class="row"><button class="btn ghost sm" id="le-step"${on ? "" : " disabled"}>Run the next steps now</button><button class="btn lime sm" id="le-top"${on ? "" : " disabled"}>Research the top 10 not yet researched</button></div></div>
      <div class="chips">${LF.map(([k, l]) => `<button type="button" class="chip${S.lf === k ? " is-on" : ""}" data-lf="${k}">${esc(l)}<em> ${cnt(k)}</em></button>`).join("")}</div>
      ${page.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th class="r">#</th><th class="r">Score</th><th>Lead</th><th>Why</th><th>Missing</th><th>Research</th><th></th></tr></thead><tbody>${page.map((r) => { const top = r.parts.slice().sort((a, b) => b.pts / b.max - a.pts / a.max).slice(0, 2), s = r.e ? RS[r.e.status] || [r.e.status, ""] : null;
        return `<tr><td class="r num tiny muted">${r.rank}</td><td class="r num"><b>${r.score}</b></td><td class="small"><b>${esc(r.l.name || "—")}</b><div class="tiny muted">${esc([DPLeads.ORG_TYPES[r.l.orgType] || r.l.orgType, r.l.location].filter(Boolean).join(" · "))}</div></td>
          <td class="tiny">${top.map((p) => esc(`${p.label}: ${p.why}`)).join("<br>")}</td><td class="tiny muted">${esc(r.missing.join(", ") || "—")}<div>${esc(r.next)}</div></td>
          <td>${s ? `<span class="pill ${s[1]}">${esc(s[0])}</span>${r.e.error ? `<div class="tiny muted">${esc(r.e.error)}</div>` : ""}` : `<span class="tiny muted">Not yet</span>`}</td>
          <td class="r">${r.e && ["review", "done", "nothing", "failed"].includes(r.e.status) ? `<button class="btn ghost xs" data-lr="${esc(r.l.id)}">Results</button>` : !r.e ? `<label class="check tiny"><input type="checkbox" data-lq="${esc(r.l.id)}"${on ? "" : " disabled"}> pick</label>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="small muted">Nothing in this view.</p>`}
      <div class="row between"><span class="tiny muted">${vis.length ? `${S.lp * 50 + 1}–${Math.min(vis.length, S.lp * 50 + 50)} of ${vis.length}` : ""}</span><div class="row">${S.lp ? `<button class="btn ghost xs" id="le-prev">Previous</button>` : ""}${vis.length > (S.lp + 1) * 50 ? `<button class="btn ghost xs" id="le-next">Next</button>` : ""}<button class="btn ghost sm" id="le-pick"${on ? "" : " disabled"}>Research the picked leads</button></div></div></div>
      <div class="card stack"><h3>Research limits</h3><div class="row"><label class="field"><span>Leads researched per day</span><input class="in sm num" id="le-pd" type="number" min="0" max="50" value="${cfg.enrichPerDay}"></label><label class="field"><span>Steps per hourly run</span><input class="in sm num" id="le-sr" type="number" min="1" max="10" value="${cfg.stepsPerRun}"></label><label class="check small"><input type="checkbox" id="le-auto"${cfg.autoAdd ? " checked" : ""}> Fill in a found website, company e-mail and phone automatically (unverified, only where the lead has none)</label><label class="check small"><input type="checkbox" id="le-ppl"${cfg.people ? " checked" : ""}> Look for the company page and relevant people on LinkedIn (public search results; never added automatically)</label><button class="btn ghost sm" id="le-save">Save…</button></div>
        <p class="tiny muted">Each lead takes up to three steps. Cloudflare's free plan allows little processing per run, so keep steps per run small; "Run the next steps now" moves research along while this page is open.</p></div></div>`;
    $$("[data-lf]", B).forEach((b) => (b.onclick = () => { S.lf = b.dataset.lf; S.lp = 0; render(); }));
    const pg = (d) => () => { S.lp += d; render(); }; if ($("#le-prev")) $("#le-prev").onclick = pg(-1); if ($("#le-next")) $("#le-next").onclick = pg(1);
    const queue = async (ids) => { if (!ids.length) return U.toast("Pick at least one lead.", { err: true }); try { const r = await root.XFServer.miQueue(ids); U.toast(`${r.queued.length} queued${r.already.length ? `, ${r.already.length} already researched this month` : ""}.`); render(); } catch (e) { U.toast(e.message, { err: true }); } };
    $("#le-top").onclick = () => queue(rows.filter((r) => !r.e).slice(0, 10).map((r) => r.l.id));
    $("#le-pick").onclick = () => queue($$("[data-lq]", B).filter((c) => c.checked).map((c) => c.dataset.lq).slice(0, 20));
    $("#le-step").onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true; let n = 0;
      try { for (let i = 0; i < 12; i++) { b.textContent = `Working… ${n} step(s)`; const r = await root.XFServer.miStep(); if (r.idle || r.busy) break; n++; if (r.waiting) { U.toast("Today's lead research limit is reached.", { err: true }); break; } } U.toast(n ? `${n} step(s) done.` : "Nothing is waiting."); } catch (e) { U.toast(e.message, { err: true }); }
      render(); };
    $("#le-save").onclick = async () => { const f = await U.form("Save research limits", [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { submit: "Save" }); if (!f) return;
      try { await saveCfg({ enrichPerDay: +$("#le-pd").value, stepsPerRun: +$("#le-sr").value, autoAdd: $("#le-auto").checked, people: $("#le-ppl").checked }, f.r); U.toast("Saved."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
    $$("[data-lr]", B).forEach((b) => (b.onclick = () => results(rows.find((r) => r.l.id === b.dataset.lr))));
  }
  const link = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t || E.hostOf(u))}</a>`;
  /** One lead's research: what was found, with its source, and what to add to the lead (marked unverified until someone checks it). */
  function results(r) {
    const e = r.e, lc = (DPLeadOps.LT.contacts || {})[r.l.id] || {}, cur = Object.assign({}, r.l.contact || {}, lc.contact || {}), hasWeb = !!(r.l.website || lc.website);
    const ph = e.contacts.filter((c) => c.kind === "phone"), em = e.contacts.filter((c) => c.kind === "email"), done = e.status === "done", auto = (e.autoAdded || []).filter((a) => !a.undone), people = e.people || [];
    U.openModal(`<h2>${esc(r.l.name)}</h2><p class="small muted">Researched ${esc(dt(e.finishedAt || e.updatedAt))} · ${e.credits || 0} search credit(s). Everything below was read from public pages; check before you rely on it.</p>
      ${(e.notes || []).map((n) => `<div class="note small">${esc(n)}</div>`).join("")}${e.error ? `<div class="note err small">${esc(e.error)}</div>` : ""}
      ${auto.length ? `<div class="note ok small"><b>Filled in automatically, unverified:</b> ${auto.map((a) => esc(`${a.field} ${a.value}`)).join(" · ")} <button class="btn ghost xs" id="rs-undo">Undo</button></div>` : ""}
      <div class="stack" style="margin-top:10px"><h3>Official website</h3>${e.site ? `<label class="check small"><input type="checkbox" id="rs-web"${hasWeb || done ? " disabled" : " checked"}> ${link("https://" + e.site.host + "/", e.site.host)} <span class="tiny muted">${esc(e.site.how)}${hasWeb ? " · the lead already has a website" : ""}</span></label>` : `<p class="small muted">Not found.</p>`}
      <h3>Published contact routes</h3>${e.contacts.length ? `<p class="tiny muted">Choose at most one phone and one e-mail. They are added as unverified: someone must call or write to confirm them.</p>${[["phone", ph, cur.phone], ["email", em, cur.email]].map(([k, list, have]) => list.map((c, i) => `<label class="check small" style="align-items:flex-start"><input type="radio" name="rs-${k}" value="${i}"${have || done ? " disabled" : ""}> <span><b>${esc(c.value)}</b>${c.kind === "phone" && !E.fitsPhoneField(c.value) ? ` <span class="pill">hotline: added as a note</span>` : ""}${c.kind === "email" && !c.own ? ` <span class="pill warn">not on the company's own domain</span>` : ""}<br><span class="tiny muted">“${esc(c.quote)}” · ${link(c.sourceUrl)}</span></span></label>`).join("") + (list.length && have ? `<p class="tiny muted">The lead already has a ${k === "phone" ? "phone number" : "e-mail"}: ${esc(have)}</p>` : "")).join("")}` : `<p class="small muted">None found.</p>`}
      <h3>LinkedIn</h3>${e.company ? `<p class="small">Company page: ${link(e.company.url, e.company.title || "LinkedIn")}</p>` : ""}${people.length ? `<p class="tiny muted">Public search results that name this organisation. X FORCE never opens LinkedIn; check each profile before you contact anyone. Choose at most one to record as the lead's contact person.</p>${people.map((p, i) => `<label class="check small" style="align-items:flex-start"><input type="radio" name="rs-person" value="${i}"${cur.name || done ? " disabled" : ""}> <span><b>${esc(p.name)}</b>${p.headline ? ` · ${esc(p.headline)}` : ""}<br><span class="tiny muted">${link(p.url, "LinkedIn profile")}${p.snippet ? ` · ${esc(p.snippet)}` : ""}</span></span></label>`).join("")}${cur.name ? `<p class="tiny muted">The lead already has a contact person: ${esc(cur.name)}</p>` : ""}` : `<p class="small muted">${e.company ? "No people found." : "Nothing found."}</p>`}
      <h3>Current projects</h3>${e.projects.length ? e.projects.map((p, i) => `<label class="check small" style="align-items:flex-start"><input type="checkbox" data-rp="${i}"${done ? " disabled" : " checked"}> <span><b>${esc(p.project)}</b><br><span class="tiny muted">“${esc(p.quote)}” · ${link(p.url)}${p.publishedAt ? ` · ${esc(p.publishedAt)}` : ""}</span></span></label>`).join("") : `<p class="small muted">None found with a source sentence.</p>`}
      <details><summary class="small">Search results (${e.sources.length})</summary>${e.sources.map((s) => `<p class="tiny">${link(s.url, s.title)}${s.publishedAt ? ` · ${esc(s.publishedAt)}` : ""}</p>`).join("")}</details>
      ${done ? `<div class="note small">Reviewed ${esc(dt(e.decided && e.decided.at))} by ${esc(DPAuth.nameSync(e.decided && e.decided.by) || "")}${e.decided && e.decided.added && e.decided.added.length ? `: added ${esc(e.decided.added.join(", "))}` : ": nothing added"}.</div>` : ""}
      <p class="small" id="rs-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="rs-close">Close</button>${done ? "" : `<button class="btn ghost" id="rs-none">Nothing useful</button><button class="btn lime" id="rs-add">Add the selected to the lead</button>`}</div></div>`, (m) => {
      $("#rs-close", m).onclick = () => U.closeModal();
      const finish = async (added, patch) => { const err = $("#rs-err", m); err.textContent = "";
        try {
          if (patch) await DPLeadOps.saveContact(r.l.id, patch, "Added from Market Intelligence research (unverified)");
          await DPStore.set(`mix/enrich/e/${r.l.id}`, Object.assign({}, e, { status: "done", decided: { at: new Date().toISOString(), by: DPAuth.A.me.id, added } }));
          await DPAuth.auditLog("Lead research reviewed", { kind: "mi", target: r.l.id, detail: added.length ? "Added: " + added.join(", ") : "Nothing added" }).catch(() => {});
          U.closeModal(); U.toast(added.length ? "Added to the lead, marked unverified." : "Marked as reviewed."); render();
        } catch (x) { err.textContent = x.message; } };
      if ($("#rs-none", m)) $("#rs-none", m).onclick = () => finish([], null);
      if ($("#rs-undo", m)) $("#rs-undo", m).onclick = async () => { const err = $("#rs-err", m); err.textContent = "";
        try { const lc2 = (await DPStore.tryGet(`leadcontact/${r.l.id}`)) || {}, c2 = Object.assign({}, lc2.contact || {}), patch = {}, undone = [];
          for (const a of auto) { if (a.field === "website" && lc2.website === a.value) { patch.website = ""; undone.push("website"); } if (a.field === "email" && c2.email === a.value) { c2.email = ""; c2.emailVerified = false; undone.push("e-mail"); } if (a.field === "phone" && c2.phone === a.value) { c2.phone = ""; c2.phoneVerified = false; undone.push("phone"); }
            if (a.field === "hotline" && (lc2.extraSources || []).some((x) => x && x.note === a.note)) { patch.extraSources = (patch.extraSources || lc2.extraSources).filter((x) => !(x && x.note === a.note)); undone.push("hotline"); } }
          if (undone.length) await DPLeadOps.saveContact(r.l.id, Object.assign(patch, { contact: c2 }), "Automatic fill-in undone");
          await DPStore.set(`mix/enrich/e/${r.l.id}`, Object.assign({}, e, { autoAdded: (e.autoAdded || []).map((a) => Object.assign({}, a, { undone: true })) }));
          await DPAuth.auditLog("Lead research fill-in undone", { kind: "mi", target: r.l.id, detail: undone.join(", ") || "already changed by someone" }).catch(() => {});
          U.closeModal(); U.toast(undone.length ? "Undone." : "Nothing to undo: those fields were changed since."); render(); } catch (x) { err.textContent = x.message; } };
      if ($("#rs-add", m)) $("#rs-add", m).onclick = () => {
        const added = [], patch = { contact: {} }, pi = $('[name="rs-phone"]:checked', m), ei = $('[name="rs-email"]:checked', m), src = [];
        if ($("#rs-web", m) && $("#rs-web", m).checked) { patch.website = "https://" + e.site.host + "/"; added.push("website"); }
        if (pi) { const c = ph[+pi.value];
          if (E.fitsPhoneField(c.value)) { patch.contact.phone = c.value.trim(); patch.contact.phoneVerified = false; src.push(c.sourceUrl); added.push("phone"); }
          else { patch.extraSources = (patch.extraSources || lc.extraSources || []).concat([{ url: c.sourceUrl, date: new Date().toISOString().slice(0, 10), note: `Hotline ${c.value} (published; unverified)` }]); added.push("hotline"); } }
        if (ei) { const c = em[+ei.value]; patch.contact.email = c.value; patch.contact.emailVerified = false; src.push(c.sourceUrl); added.push("e-mail"); }
        const pp = $('[name="rs-person"]:checked', m); if (pp) { const p = people[+pp.value]; patch.contact.name = p.name; patch.contact.title = p.headline.slice(0, 120); src.push(p.url); added.push("contact person"); }
        if (src.length) patch.contact.source = [...new Set(src)].join(" ");
        const proj = $$("[data-rp]", m).filter((c) => c.checked).map((c) => e.projects[+c.dataset.rp]);
        if (proj.length) { const have = lc.extraSources || []; patch.extraSources = have.concat(proj.filter((p) => !have.some((h) => h.url === p.url)).map((p) => ({ url: p.url, date: p.publishedAt || new Date().toISOString().slice(0, 10), note: `${p.project}: “${p.quote}”` }))); added.push(`${proj.length} project(s)`); }
        if (!Object.keys(patch.contact).length) delete patch.contact;
        if (!added.length) return finish([], null);
        finish(added, patch);
      };
    }, { wide: true });
  }

  /* ---------------- research schedule ---------------- */
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  /** Cairo is UTC+2 in winter and UTC+3 in summer; the hour is stored in UTC and shown for Cairo today. */
  const cairoOffset = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date()), u = new Date().getUTCHours(); return ((+p - u) % 24 + 24) % 24; };
  async function schedTab(B) {
    const cfg = await loadCfg(), s = cfg.schedule, off = cairoOffset(), on = !!App.config.settings.miEngine;
    B.innerHTML = `<div class="card stack"><div class="row between"><h3>When research runs by itself</h3><span class="tiny muted">Version ${cfg.version || "not saved yet"}</span></div>
      ${on ? "" : `<div class="note warn small">The engine is off, so nothing runs by schedule. "Run research now" in Mission Control still works.</div>`}
      <p class="small muted">Each job runs once on each chosen day, at the hourly run after the chosen time. A missed hour is caught up later the same day. Results appear in the usual places: currency and materials in Mission Control, news, opportunities, weekly reports.</p>
      <div class="tablewrap"><table class="mtable"><thead><tr><th>Job</th><th>On</th><th>Days</th><th>Around (Cairo time)</th></tr></thead><tbody>${E.SCHEDULE_JOBS.map(([k, l]) => `<tr><td class="small"><b>${esc(l)}</b></td><td><input type="checkbox" data-son="${k}"${s[k].on ? " checked" : ""} aria-label="${esc(l)} on"></td>
        <td class="small">${DAYS.map((d, i) => `<label class="check tiny" style="display:inline-flex;margin-right:6px"><input type="checkbox" data-sday="${k}" value="${i}"${s[k].days.includes(i) ? " checked" : ""}> ${d}</label>`).join("")}</td>
        <td><select class="in sm" data-shr="${k}" aria-label="${esc(l)} time">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${s[k].hour === h ? " selected" : ""}>${String((h + off) % 24).padStart(2, "0")}:28</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
      <p class="small" id="sc-cr"></p><div class="row"><button class="btn lime sm" id="sc-save">Save the schedule…</button></div></div>`;
    const read = () => { const out = {}; for (const [k] of E.SCHEDULE_JOBS) out[k] = { on: $(`[data-son="${k}"]`, B).checked, hour: +$(`[data-shr="${k}"]`, B).value, days: $$(`[data-sday="${k}"]`, B).filter((c) => c.checked).map((c) => +c.value) }; return E.scheduleOf(out); };
    const est = () => { $("#sc-cr", B).textContent = `About ${E.scheduleCredits(read())} search credits a month for these jobs (planning figure), within the free 900, which lead research also uses.`; };
    $$("input,select", B).forEach((x) => (x.onchange = est)); est();
    $("#sc-save").onclick = async () => { const f = await U.form("Save the research schedule", [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { submit: "Save" }); if (!f) return;
      try { const sch = read(); await saveCfg({ schedule: sch }, f.r);
        // the existing Automation Health screen reads mi/schedule to show each job's schedule and next run
        await DPStore.set("mi/schedule", { jobs: Object.fromEntries(E.SCHEDULE_JOBS.filter(([k]) => sch[k].on).map(([k, l]) => [k, { label: `${sch[k].days.map((d) => DAYS[d]).join(", ")} around ${String((sch[k].hour + off) % 24).padStart(2, "0")}:28 Cairo`, cron: E.cronOf(sch[k]) }])), tasks: {}, updatedAt: new Date().toISOString() });
        U.toast("Schedule saved."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
  }

  /* ---------------- data readiness ---------------- */
  async function readyTab(B) {
    const [c, cfg] = await Promise.all([root.XFServer.miReadiness(), loadCfg()]); S.counts = c;
    const v = E.verdicts(c, cfg), box = (t, rows) => `<div class="card"><h3>${esc(t)}</h3><dl class="kv small">${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd class="num">${num(x)}</dd>`).join("")}</dl></div>`;
    B.innerHTML = `<div class="stack"><div class="card"><div class="row between"><h3>What can be calculated from your records</h3><span class="tiny muted">Read ${esc(dt(c.at))} · counts only, no names or money</span></div>
      <div class="tablewrap"><table class="mtable"><thead><tr><th>Measure</th><th>Status</th><th>Detail</th></tr></thead><tbody>${v.map((x) => `<tr><td class="small"><b>${esc(x.label)}</b></td><td><span class="pill ${STATE[x.state][1]}">${STATE[x.state][0]}</span></td><td class="small">${esc(x.text)}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="grid3">
      ${box("Salespeople and targets", [["Active salespeople", c.sellers.active], ["Own target this month", c.targets.individual], ["On the company default", c.targets.defaultOnly], ["With a sales profile", c.sellers.withProfile]])}
      ${box("Activity", [["All activities", c.acts.total], ["Calls", c.acts.calls], ["Calls with an outcome", c.acts.callsWithOutcome], ["Conversations", c.acts.conversations], ["Logged as meetings", c.acts.meetingsHeld], ["Outcome Meeting Scheduled", c.acts.meetingsScheduled], ["Site visits", c.acts.visits]])}
      ${box("Quotations and orders", [["Quotations issued", c.quotes.total], ["Linked to a lead", c.quotes.withLead], ["Accepted", c.quotes.accepted], ["Decided", c.quotes.decided], ["Orders", c.orders.total], ["Orders not cancelled", c.orders.live]])}
      ${box("Lead Mine", [["Leads", c.leads.total], ["Open", c.leads.open], ["Assigned", c.leads.assigned], ["With a source", c.leads.withSource], ["With product fit", c.leads.withFit], ["Verified contact", c.contacts.verified], ["Personal pipelines", c.crm.total], ["With stage history", c.crm.withHistory]])}
      ${box("Market research", [["Opportunities", c.opps.total], ["High priority", c.opps.high], ["Evidence verified", c.opps.verified], ["Single source", c.opps.singleSource], ["Unverified", c.opps.unverified], ["Assigned (old pipeline)", c.opps.assigned], ["Sales updates (old pipeline)", c.opps.legacyUpdates], ["Scored by the new rules", c.opps.newScore], ["Project Radar accounts", c.radar.accounts]])}
      ${box("Catalogue and calendar", [["Catalogue products in the app", (root.DP_PRODUCTS || []).length], ["Custom products added", c.catalog.customProducts], ["Dupedia Products pages", c.catalog.productPages], ["Price book items", c.catalog.priceBookItems], ["Closures in the calendar", c.catalog.holidaysListed]])}
      </div></div>`;
  }

  /* ---------------- product capability ---------------- */
  async function capTab(B) {
    const cfg = await loadCfg();
    B.innerHTML = `<div class="card stack"><div class="row between"><h3>What Dupedia really sells</h3><span class="tiny muted">Version ${cfg.version || "not saved yet"}${cfg.updatedAt ? ` · ${esc(dt(cfg.updatedAt))} by ${esc(DPAuth.nameSync(cfg.updatedBy) || "")}` : ""}</span></div>
      <p class="small muted">Stored and versioned now. Qualification starts using it in Phase 3. An undecided category counts as no product fit.</p>
      <div class="tablewrap"><table class="mtable"><thead><tr><th>Category</th><th>Status</th><th>What it means</th></tr></thead><tbody>${E.CATEGORIES.map(([k, l]) => `<tr><td class="small"><b>${esc(l)}</b></td><td><select class="in sm" style="min-width:150px" data-cap="${k}" aria-label="${esc(l)}">${Object.entries(E.STATUSES).map(([s, x]) => `<option value="${s}"${cfg.capability[k] === s ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></td><td class="small muted" data-capn="${k}">${esc(E.STATUSES[cfg.capability[k]].effect)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row"><button class="btn lime sm" id="cap-save">Save a new version…</button></div></div>`;
    $$("[data-cap]", B).forEach((s) => (s.onchange = () => { $(`[data-capn="${s.dataset.cap}"]`, B).textContent = E.STATUSES[s.value].effect; }));
    $("#cap-save").onclick = async () => { const capability = {}; $$("[data-cap]", B).forEach((s) => (capability[s.dataset.cap] = s.value)); const f = await U.form("Save product capability", [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { submit: "Save" }); if (!f) return; try { await saveCfg({ capability }, f.r); U.toast("Saved."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
  }

  /* ---------------- company names ---------------- */
  async function namesTab(B) {
    const rows = (await DPStore.tryList("mix/alias/a")).map((x) => Object.assign({ id: x.id }, x.data)).sort((a, b) => String(a.canonical).localeCompare(String(b.canonical)));
    B.innerHTML = `<div class="card stack"><div class="row between"><h3>Company names in English and Arabic</h3><button class="btn lime sm" id="al-add">${U.svg("plus")} Add a company</button></div>
      <p class="small muted">Results that use any of these names count as the same organisation, which stops duplicates when one source writes a name in Arabic and another in English.</p>
      ${rows.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Main name</th><th>Also known as</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td class="small"><b>${esc(r.canonical)}</b></td><td class="small"><bdi>${(r.names || []).map(esc).join(" · ")}</bdi></td><td class="r"><button class="btn ghost xs" data-ale="${esc(r.id)}">Edit</button> <button class="btn ghost xs" data-ald="${esc(r.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No names added yet.</p>`}</div>`;
    const edit = async (r) => { const f = await U.form(r ? "Edit company names" : "Add a company", [{ id: "c", label: "Main name", required: true, value: r ? r.canonical : "" }, { id: "n", label: "Other names, one per line (Arabic welcome)", type: "textarea", value: r ? (r.names || []).join("\n") : "" }], { submit: "Save" }); if (!f) return;
      try { const id = r ? r.id : "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), names = String(f.n || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
        await DPStore.set(`mix/alias/a/${id}`, { canonical: f.c.trim(), names, updatedAt: new Date().toISOString(), updatedBy: DPAuth.A.me.id }); await DPAuth.auditLog("Company names changed", { kind: "mi", target: id, detail: f.c.trim() }).catch(() => {}); U.toast("Saved."); render(); } catch (e) { U.toast(e.message, { err: true }); } };
    $("#al-add").onclick = () => edit(null);
    $$("[data-ale]", B).forEach((b) => (b.onclick = () => edit(rows.find((r) => r.id === b.dataset.ale))));
    $$("[data-ald]", B).forEach((b) => (b.onclick = async () => { const r = rows.find((x) => x.id === b.dataset.ald); const f = await U.form("Remove company names", [{ id: "r", label: `Why remove ${r.canonical}?`, required: true }], { submit: "Remove" }); if (!f) return; try { await DPStore.del(`mix/alias/a/${r.id}`); await DPAuth.auditLog("Company names removed", { kind: "mi", target: r.id, reason: f.r, detail: r.canonical }).catch(() => {}); render(); } catch (e) { U.toast(e.message, { err: true }); } }));
  }

  /* ---------------- job ledger ---------------- */
  async function jobsTab(B) {
    const rows = (await DPStore.tryList("mix/disc/j")).map((x) => x.data).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100), P = { done: "ok", failed: "err", waiting: "warn", running: "info", queued: "" };
    B.innerHTML = `<div class="card stack"><h3>Job ledger</h3><p class="small muted">Every step of the discovery engine will be recorded here, including failures and their reasons. It stays empty until discovery arrives in Phase 2.</p>
      ${rows.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Created</th><th>Job</th><th>Status</th><th class="r">Tries</th><th>Next</th><th>Detail</th></tr></thead><tbody>${rows.map((j) => `<tr><td class="small">${esc(dt(j.createdAt))}</td><td class="small">${esc(j.kind)}<div class="tiny muted">${esc(j.key)}</div></td><td><span class="pill ${P[j.status] || ""}">${esc(j.status)}</span></td><td class="r num">${j.tries || 0}/${j.maxTries || 0}</td><td class="small">${["queued", "waiting"].includes(j.status) ? esc(dt(j.nextAt)) : "—"}</td><td class="small muted">${esc(j.error || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No jobs yet.</p>`}</div>`;
  }

  U.register("miengine", render);
  root.DPMiEngineUI = { render };
})(typeof self !== "undefined" ? self : this);
