/* X FORCE — Commercial Intelligence, Phase 1: the administrators' Signals inbox and Signal sources settings. Two tabs on the Market
   Intelligence engine page (app/ui-miengine.js). Shadow mode: nothing here is shown to other roles or sent to anyone. */
/* global DPUI, DPStore, DPAuth, DPSignals, DPCi */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc, App } = U, S = () => root.DPSignals;
  const api = (u, o) => root.XFServer.api(u, o);
  const F = { status: "new", type: "", origin: "" };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
  const href = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : "#");
  const on = () => !!(App.config.settings.ci && App.config.settings.ci.signals === true);
  const CLS = { official: ["Official", "ok"], organization: ["Organisation's own site", "ok"], press: ["Press", "info"], listing: ["Listing site", "warn"], social: ["Social media", "warn"], other: ["Other site", ""] };
  const ORIGIN = { feed: "News feed", watch: "Watched page", search: "Search", paste: "Pasted link" };
  const STATUS = { new: "New", useful: "Useful", dismissed: "Dismissed" };
  const dots = (n) => `<span class="tiny" aria-label="Strength ${n} of 5" title="Strength ${n} of 5">${"●".repeat(n)}${"○".repeat(5 - n)}</span>`;
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  /* U.form inserts `intro` as HTML, so it is always escaped here: intros can carry headlines from outside websites. Options become {value, label}. */
  const ask = (title, fields, opts) => U.form(title, fields.map((x) => (x.options ? Object.assign({}, x, { options: x.options.map(([value, label]) => ({ value, label })) }) : x)),
    Object.assign({ submit: "Save" }, opts || {}, { intro: esc((opts && opts.intro) || "") }));

  /* ---------------- inbox ---------------- */
  async function inboxTab(B, rerender) {
    const [rows, opps] = await Promise.all([DPStore.tryList("mi/sig/s"), DPStore.tryList("mi/opps/o")]);
    const all = rows.map((x) => Object.assign({ id: x.id }, x.data)), oppName = Object.fromEntries(opps.map((o) => [o.id, o.data.title || o.id]));
    const vis = all.filter((s) => (!F.status || s.status === F.status) && (!F.type || s.type === F.type) && (!F.origin || s.origin === F.origin))
      .sort((a, b) => b.strength - a.strength || String(b.publishedAt || b.foundAt).localeCompare(String(a.publishedAt || a.foundAt))).slice(0, 100);
    const count = (k, v) => all.filter((s) => s[k] === v).length;
    const sel = (id, cur, opts, label) => `<select class="in sm" id="${id}" aria-label="${esc(label)}"><option value="">${esc(label)}: all</option>${opts.map(([k, l]) => `<option value="${k}"${cur === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    B.innerHTML = `<div class="stack">
      ${on() ? "" : `<div class="note warn small">Signals are off: nothing is fetched. Switch them on under Commercial intelligence → Switches. Saved signals stay readable.</div>`}
      <div class="card stack"><div class="row between wrap"><h3>Signals</h3><div class="row wrap">
        <button class="btn ghost sm" id="sg-run"${on() ? "" : " disabled"}>Run the next steps now</button><button class="btn lime sm" id="sg-add"${on() ? "" : " disabled"}>${U.svg("plus")} Add a link…</button></div></div>
        <p class="small muted">Each signal is one sentence copied from a public page, found by fixed rules: a trigger phrase next to a word about compounds, schools, resorts, clubs or play. The sentence is always on the page; open the link to check it. Organisation, project and place marked "AI reading" were read by AI and checked against the same text. Shadow mode: only administrators see this, and nobody is notified.</p>
        <div class="row wrap">${sel("sg-st", F.status, Object.entries(STATUS).map(([k, l]) => [k, `${l} (${count("status", k)})`]), "Status")}
          ${sel("sg-ty", F.type, S().TYPE_KEYS.map((k) => [k, S().TYPES[k].label]), "Kind")}${sel("sg-or", F.origin, Object.entries(ORIGIN), "Found by")}</div></div>
      ${vis.length ? vis.map((s) => `<div class="card stack" data-sig="${esc(s.id)}">
          <div class="row between wrap"><div class="row wrap"><b class="small">${esc(S().TYPES[s.type] ? S().TYPES[s.type].label : s.type)}</b> ${dots(s.strength)} <span class="pill ${(CLS[s.cls] || CLS.other)[1]}">${esc((CLS[s.cls] || CLS.other)[0])}</span>
            <span class="tiny muted">${esc(ORIGIN[s.origin] || s.origin)} · found ${esc(dt(s.foundAt))}${s.publishedAt ? ` · published ${esc(s.publishedAt)}` : " · publication date not given"}</span></div>
            <span class="pill ${s.status === "useful" ? "ok" : s.status === "dismissed" ? "" : "info"}">${esc(STATUS[s.status] || s.status)}</span></div>
          <blockquote class="small" dir="auto" style="margin:0;padding-inline-start:12px;border-inline-start:3px solid currentColor"><bdi>${esc(s.quote)}</bdi></blockquote>
          <div class="small"><a href="${href(s.url)}" target="_blank" rel="noopener noreferrer nofollow"><bdi>${esc(s.title || s.host || s.url)}</bdi></a> <span class="tiny muted">${esc(s.host || "")}</span></div>
          <div class="tiny muted">Place: ${esc(s.place && s.place.note ? s.place.note : "not recognised")}${s.org ? ` · Organisation: <bdi>${esc(s.org)}</bdi>${s.origin === "watch" ? "" : " (AI reading)"}` : ""}${s.project ? ` · Project: <bdi>${esc(s.project)}</bdi> (AI reading)` : ""}${s.placeText ? ` · Place named: <bdi>${esc(s.placeText)}</bdi> (AI reading)` : ""}${s.matched && s.matched.length ? ` · Rule words: <bdi>${esc(s.matched.join(", "))}</bdi>` : ""}</div>
          ${s.status !== "new" ? `<div class="tiny muted">${esc(STATUS[s.status])} by ${esc(DPAuth.nameSync(s.decidedBy) || "")} ${esc(dt(s.decidedAt))}${s.reason ? ` — ${esc(s.reason)}` : ""}${s.oppId ? ` · Linked to: <bdi>${esc(oppName[s.oppId] || s.oppId)}</bdi>` : ""}</div>` : ""}
          <div class="row wrap">${s.status !== "useful" ? `<button class="btn ghost xs" data-sgu="${esc(s.id)}">Useful</button>` : ""}${s.status !== "dismissed" ? `<button class="btn ghost xs" data-sgd="${esc(s.id)}">Dismiss…</button>` : ""}
            ${opps.length ? `<button class="btn ghost xs" data-sgl="${esc(s.id)}">Link to an opportunity…</button>` : ""}${s.status !== "new" ? `<button class="btn ghost xs" data-sgn="${esc(s.id)}">Back to new</button>` : ""}</div></div>`).join("")
        : `<div class="card"><p class="small muted">${all.length ? "No signals match these filters." : "No signals yet. Add feeds, watched pages or searches under Signal sources, then run the next steps."}</p></div>`}
      ${vis.length === 100 ? `<p class="tiny muted">The first 100 are shown, strongest first.</p>` : ""}</div>`;
    const re = () => rerender();
    $("#sg-st").onchange = (e) => { F.status = e.target.value; re(); }; $("#sg-ty").onchange = (e) => { F.type = e.target.value; re(); }; $("#sg-or").onchange = (e) => { F.origin = e.target.value; re(); };
    const decide = async (id, patch, action) => {
      const cur = await DPStore.tryGet(`mi/sig/s/${id}`); if (!cur) return U.toast("This signal no longer exists.", { err: true });
      await DPStore.set(`mi/sig/s/${id}`, Object.assign({}, cur, patch, { decidedBy: DPAuth.A.me.id, decidedAt: new Date().toISOString() }));
      await DPAuth.auditLog(action, { kind: "mi", target: id, reason: patch.reason || "", detail: String(cur.quote || "").slice(0, 120) }).catch(() => {});
      re();
    };
    $$("[data-sgu]", B).forEach((b) => (b.onclick = () => decide(b.dataset.sgu, { status: "useful", reason: "" }, "Signal marked useful").catch((e) => U.toast(e.message, { err: true }))));
    $$("[data-sgn]", B).forEach((b) => (b.onclick = () => decide(b.dataset.sgn, { status: "new", reason: "" }, "Signal returned to new").catch((e) => U.toast(e.message, { err: true }))));
    $$("[data-sgd]", B).forEach((b) => (b.onclick = async () => { const f = await ask("Dismiss the signal", [{ id: "r", label: "Why is it not useful? (helps tune the rules)", required: true }], { submit: "Dismiss" }); if (!f) return;
      decide(b.dataset.sgd, { status: "dismissed", reason: String(f.r).slice(0, 300) }, "Signal dismissed").catch((e) => U.toast(e.message, { err: true })); }));
    $$("[data-sgl]", B).forEach((b) => (b.onclick = async () => {
      const f = await ask("Link to an opportunity", [{ id: "o", label: "Opportunity", type: "select", options: opps.map((o) => [o.id, String(o.data.title || o.id).slice(0, 90)]), required: true }], { submit: "Link" }); if (!f) return;
      decide(b.dataset.sgl, { status: "useful", oppId: f.o, reason: "" }, "Signal linked to an opportunity").catch((e) => U.toast(e.message, { err: true })); }));
    $("#sg-run").onclick = async () => { const b = $("#sg-run"); b.disabled = true; b.textContent = "Working…";
      try { const r = await api("/api/mi/signal/run", { method: "POST", body: JSON.stringify({ steps: 3 }) });
        const made = (r.ran || []).reduce((n, x) => n + ((x.result && x.result.signals) || 0), 0), waits = (r.ran || []).filter((x) => x.waiting || x.failed || x.refused).map((x) => x.waiting || x.failed || x.refused);
        U.toast(r.ok === false ? r.message || "Not run." : `${(r.ran || []).length} step(s) run, ${made} new signal(s).${waits.length ? " " + waits[0] : ""}${(r.ran || []).length ? "" : " Nothing was due."}`, waits.length ? { err: true } : {}); }
      catch (e) { U.toast(e.message, { err: true }); } re(); };
    $("#sg-add").onclick = async () => {
      const f = await ask("Add a signal from a link", [{ id: "u", label: "Public web address (https://…)", required: true }, { id: "q", label: "Optional: the exact sentence to save (copied from the page)", type: "textarea" },
        { id: "t", label: "Kind (only with a sentence)", type: "select", options: [["", "—"]].concat(S().TYPE_KEYS.map((k) => [k, S().TYPES[k].label])) }], { submit: "Read the page", intro: "X FORCE reads the page under its normal rules (robots.txt, public pages only) and looks for signal sentences. If you give a sentence, it is saved only if the page contains it." });
      if (!f) return;
      try { const r = await api("/api/mi/signal/add", { method: "POST", body: JSON.stringify({ url: f.u, quote: f.q || "", type: f.t || "" }) });
        U.toast(r.created ? `${r.created} new signal(s) saved.` : r.found && r.found.length ? "Already saved." : "No signal sentence found on that page. Add the sentence yourself if it matters.", r.created ? {} : { err: !(r.found && r.found.length) }); re(); }
      catch (e) { U.toast(e.message, { err: true }); } };
  }

  /* ---------------- sources ---------------- */
  async function saveCfg(next, reason) {
    if (!U.isAdmin()) throw new Error("Administrators only."); if (!String(reason || "").trim()) throw new Error("Give a reason for the change.");
    const prev = S().cfgOf(await DPStore.tryGet("mix/sigcfg")), at = new Date().toISOString(), version = (prev.version || 0) + 1;
    const doc = Object.assign(S().cfgOf(Object.assign({}, prev, next)), { version, updatedAt: at, updatedBy: DPAuth.A.me.id });
    if (prev.version) await DPStore.set(`mix/sigcfgv/v/${prev.version}`, Object.assign({}, prev, { replacedAt: at, replacedBy: DPAuth.A.me.id }));
    await DPStore.set("mix/sigcfg", doc);
    await DPAuth.auditLog("Signal sources changed", { kind: "mi", reason, detail: `Version ${version}: ${doc.feeds.length} feed(s), ${doc.watch.length} watched organisation(s), ${doc.searchesPerDay} search(es) a day` }).catch(() => {});
    return doc;
  }
  async function sourcesTab(B, rerender) {
    const c = S().cfgOf(await DPStore.tryGet("mix/sigcfg")), st = await api("/api/ci/status").catch(() => null);
    const cellCount = S().cells(c).length, leads = (await DPStore.tryList("leads")).map((x) => Object.assign({ id: x.id }, x.data)).filter((l) => !["archived", "merged"].includes(l.status));
    const chk = (attr, v, list, label) => `<label class="check tiny" style="display:inline-flex;margin-right:8px"><input type="checkbox" ${attr}="${esc(v)}"${list.includes(v) ? " checked" : ""}> ${esc(label)}</label>`;
    B.innerHTML = `<div class="stack">
      ${on() ? "" : `<div class="note warn small">Signals are off: nothing is fetched until switched on under Commercial intelligence → Switches.</div>`}
      <div class="card stack"><div class="row between"><h3>News feeds</h3><span class="tiny muted">Version ${c.version || "not saved yet"}${c.updatedAt ? ` · ${esc(dt(c.updatedAt))} by ${esc(DPAuth.nameSync(c.updatedBy) || "")}` : ""}</span></div>
        <p class="small muted">Free, no search credits. Only items not seen before are read, at most 10 at a time. General news feeds give few signals; trade and property news gives more.</p>
        ${c.feeds.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Feed</th><th>Language</th><th class="r">Every (hours)</th><th>On</th><th></th></tr></thead><tbody>${c.feeds.map((f) => `<tr><td class="small"><b>${esc(f.label)}</b><div class="tiny muted"><bdi>${esc(f.url)}</bdi></div></td><td class="small">${f.lang === "ar" ? "Arabic" : "English"}</td>
          <td class="r"><input class="in sm num" style="width:70px" type="number" min="1" max="168" data-fh="${esc(f.id)}" value="${f.everyHours}" aria-label="${esc(f.label)} hours"></td><td><input type="checkbox" data-fo="${esc(f.id)}"${f.on ? " checked" : ""} aria-label="${esc(f.label)} on"></td>
          <td class="r"><button class="btn ghost xs" data-ft="${esc(f.url)}">Test</button> <button class="btn ghost xs" data-fx="${esc(f.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No feeds yet.</p>`}
        <div class="row wrap"><button class="btn ghost sm" id="sf-add">${U.svg("plus")} Add a feed…</button>${S().SUGGESTED_FEEDS.filter((s) => !c.feeds.some((f) => f.url === s.url)).map((s) => `<button class="btn ghost sm" data-fs="${esc(s.url)}">Add ${esc(s.label)}</button>`).join("")}</div>
        <p class="tiny muted">The suggested feeds answered with current items and allowed automated reading on 14 Nov 2026. Several other Egyptian news sites refuse automated readers and are not suggested.</p></div>

      <div class="card stack"><h3>Watched organisations</h3>
        <p class="small muted">Free, no search credits. Up to three public pages per organisation (its news or projects page works best). Each visit compares the page with the last one and reads only new sentences. The first visit reads the whole page.</p>
        ${c.watch.length ? `<div class="tablewrap"><table class="mtable"><thead><tr><th>Organisation</th><th>Pages</th><th class="r">Every (days)</th><th>On</th><th></th></tr></thead><tbody>${c.watch.map((w) => `<tr><td class="small"><b><bdi>${esc(w.org)}</bdi></b>${w.leadId ? `<div class="tiny muted">Lead Mine record linked</div>` : ""}</td><td class="tiny">${w.urls.map((u) => `<div><bdi>${esc(u)}</bdi></div>`).join("")}</td>
          <td class="r"><input class="in sm num" style="width:70px" type="number" min="1" max="60" data-wd="${esc(w.id)}" value="${w.everyDays}" aria-label="${esc(w.org)} days"></td><td><input type="checkbox" data-wo="${esc(w.id)}"${w.on ? " checked" : ""} aria-label="${esc(w.org)} on"></td>
          <td class="r"><button class="btn ghost xs" data-we="${esc(w.id)}">Edit…</button> <button class="btn ghost xs" data-wx="${esc(w.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No organisations watched yet.</p>`}
        <div class="row"><button class="btn ghost sm" id="sw-add">${U.svg("plus")} Watch an organisation…</button></div></div>

      <div class="card stack"><h3>Searches</h3>
        <p class="small muted">Each search costs one search credit, counted as "Signal searches" in the credit shares. At most one search starts per hourly run. ${cellCount} combinations are chosen; the one searched longest ago goes next.${st ? ` Used this month: ${st.streams.signals || 0} credit(s).` : ""}</p>
        <div class="row wrap"><label class="small">Searches a day <input class="in sm num" style="width:70px" type="number" min="0" max="30" id="ss-n" value="${c.searchesPerDay}"></label><span class="tiny muted">0 = no searches.</span></div>
        <div class="small"><b>Customer types</b><div>${S().SEARCH_TYPES.map((t) => chk("data-sty", t[0], c.searchTypes, (DPCi.CUSTOMER_TYPES.find((x) => x[0] === t[0]) || [0, t[0]])[1])).join("")}</div></div>
        <div class="small"><b>Areas</b><div>${S().SEARCH_AREAS.map((a) => chk("data-sar", a[0], c.searchAreas, a[1])).join("")}</div></div>
        <div class="small"><b>Languages</b><div>${chk("data-sla", "en", c.searchLangs, "English")}${chk("data-sla", "ar", c.searchLangs, "Arabic")}</div></div></div>

      <div class="card stack"><h3>Extra trigger phrases</h3><p class="small muted">Added to the built-in phrases for each kind of signal. One per line, English or Arabic. A phrase counts only as a whole word or phrase, and only next to a word about compounds, schools, resorts, clubs or play.</p>
        <div class="grid2">${S().TYPE_KEYS.map((k) => `<label class="small"><b>${esc(S().TYPES[k].label)}</b> <span class="tiny muted">(${S().TYPES[k].en.length + S().TYPES[k].ar.length} built in)</span><textarea class="in" rows="2" dir="auto" data-ph="${k}" aria-label="${esc(S().TYPES[k].label)} extra phrases">${esc((c.phrases[k] || []).join("\n"))}</textarea></label>`).join("")}</div></div>

      <div class="card stack"><h3>Limits</h3><div class="row wrap"><label class="small">Steps per hourly run <input class="in sm num" style="width:70px" type="number" min="1" max="6" id="sl-steps" value="${c.stepsPerRun}"></label>
        <label class="small">Largest page read (KB) <input class="in sm num" style="width:80px" type="number" min="50" max="1500" id="sl-kb" value="${c.maxPageKb}"></label></div>
        <p class="tiny muted">On Workers Free keep 2 steps: each hourly run has little processing time.</p>
        <div class="row"><button class="btn lime sm" id="sc-save">Save a new version…</button></div></div></div>`;

    const read = () => {
      const feeds = c.feeds.map((f) => Object.assign({}, f, { everyHours: +$(`[data-fh="${f.id}"]`, B).value || 6, on: $(`[data-fo="${f.id}"]`, B).checked }));
      const watch = c.watch.map((w) => Object.assign({}, w, { everyDays: +$(`[data-wd="${w.id}"]`, B).value || 7, on: $(`[data-wo="${w.id}"]`, B).checked }));
      const phrases = {}; $$("[data-ph]", B).forEach((t) => (phrases[t.dataset.ph] = String(t.value).split(/\n+/).map((x) => x.trim()).filter(Boolean)));
      return { feeds, watch, phrases, searchesPerDay: +$("#ss-n", B).value || 0, searchTypes: $$("[data-sty]", B).filter((x) => x.checked).map((x) => x.dataset.sty),
        searchAreas: $$("[data-sar]", B).filter((x) => x.checked).map((x) => x.dataset.sar), searchLangs: $$("[data-sla]", B).filter((x) => x.checked).map((x) => x.dataset.sla),
        stepsPerRun: +$("#sl-steps", B).value || 2, maxPageKb: +$("#sl-kb", B).value || 400 };
    };
    const commit = async (patch, title, intro) => { const f = await ask(title, [{ id: "r", label: "Reason (kept in the audit log)", required: true }], { intro: intro || "" }); if (!f) return;
      try { await saveCfg(Object.assign(read(), patch), f.r); U.toast("Saved."); rerender(); } catch (e) { U.toast(e.message, { err: true }); } };
    $("#sc-save").onclick = () => { const n = +$("#ss-n", B).value || 0; commit({}, "Save signal sources", n ? `Up to ${n} search credit(s) a day, about ${n * 30} a month, inside the existing caps and the "Signal searches" share.` : ""); };
    const addFeed = async (url, label, lang) => {
      const t = await api("/api/mi/signal/testfeed", { method: "POST", body: JSON.stringify({ url }) }).catch((e) => ({ ok: false, message: e.message }));
      if (!t.ok) return U.toast(`Not added: ${t.message || "no items could be read."}`, { err: true });
      commit({ feeds: read().feeds.concat([{ id: rid("f"), url, label: label || S().hostOf(url), lang, on: true, everyHours: 6, cls: "press" }]) }, `Add the feed ${label || S().hostOf(url)}`, `Test read ${t.items} item(s); newest ${t.newest || "undated"}. ${t.titles.map((x) => "“" + x + "”").join(" ")}`);
    };
    $("#sf-add").onclick = async () => { const f = await ask("Add a news feed", [{ id: "u", label: "Feed address (RSS or Atom, https://…)", required: true }, { id: "l", label: "Name" }, { id: "g", label: "Language", type: "select", options: [["en", "English"], ["ar", "Arabic"]] }], { submit: "Test and add" }); if (!f) return; addFeed(f.u.trim(), f.l, f.g); };
    $$("[data-fs]", B).forEach((b) => (b.onclick = () => { const s = S().SUGGESTED_FEEDS.find((x) => x.url === b.dataset.fs); addFeed(s.url, s.label, s.lang); }));
    $$("[data-ft]", B).forEach((b) => (b.onclick = async () => { b.disabled = true; const t = await api("/api/mi/signal/testfeed", { method: "POST", body: JSON.stringify({ url: b.dataset.ft }) }).catch((e) => ({ ok: false, message: e.message })); b.disabled = false;
      U.toast(t.ok ? `${t.items} item(s), newest ${t.newest || "undated"}.` : t.message, t.ok ? {} : { err: true }); }));
    $$("[data-fx]", B).forEach((b) => (b.onclick = () => commit({ feeds: read().feeds.filter((f) => f.id !== b.dataset.fx) }, "Remove the feed")));
    const watchForm = async (w) => {
      const f = await ask(w ? "Edit a watched organisation" : "Watch an organisation", [{ id: "o", label: "Organisation", required: true, value: w ? w.org : "" },
        { id: "u", label: "Public pages to watch, one per line (up to 3): its news, media or projects page", type: "textarea", required: true, value: w ? w.urls.join("\n") : "" },
        { id: "l", label: "Lead Mine record (optional)", type: "select", options: [["", "—"]].concat(leads.slice(0, 900).map((l) => [l.id, String(l.name || l.id).slice(0, 80)])), value: w && w.leadId ? w.leadId : "" }], { submit: "Continue" });
      if (!f) return;
      const urls = String(f.u).split(/\s+/).map((x) => x.trim()).filter((x) => S().goodUrl(x)).slice(0, 3);
      if (!urls.length) return U.toast("Give at least one https:// page.", { err: true });
      const rec = { id: w ? w.id : rid("w"), org: f.o.trim(), urls, leadId: f.l || null, on: w ? w.on : true, everyDays: w ? w.everyDays : 7 };
      commit({ watch: read().watch.filter((x) => x.id !== rec.id).concat([rec]) }, w ? "Save the watched organisation" : "Watch the organisation", "Pages are read under robots.txt rules. A page that refuses automated readers is reported in the Job ledger and not retried.");
    };
    $("#sw-add").onclick = () => watchForm(null);
    $$("[data-we]", B).forEach((b) => (b.onclick = () => watchForm(c.watch.find((w) => w.id === b.dataset.we))));
    $$("[data-wx]", B).forEach((b) => (b.onclick = () => commit({ watch: read().watch.filter((w) => w.id !== b.dataset.wx) }, "Stop watching the organisation")));
  }

  root.DPSignalsUI = { inboxTab, sourcesTab };
})(typeof self !== "undefined" ? self : this);
