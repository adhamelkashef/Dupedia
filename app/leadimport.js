/* X FORCE 1.3 (Dupedia) — bulk lead import for administrators: CSV or Excel (.xlsx) → column mapping → preview with
   validation → duplicate check (against the file itself and the existing leads: normalised company name, phone, e-mail)
   → confirmation → import → summary with a downloadable list of rejected rows. Imported leads go into the existing Lead
   Mine with its claiming and 24-hour rules unchanged; their ids are derived from the company name, so uploading the same
   file twice never creates duplicates. Sales get ONE summary notification per import. */
/* global DPUI, DPLeads, DPStore, DPAuth, DPNotify, DPIO */
(function (root) {
  "use strict";
  const U = DPUI, { $, $$, esc } = U, L = () => root.DPLeads;
  const FIELDS = [["name", "Company name *", ["company", "name", "organisation", "organization", "account", "client", "الشركة", "اسم الشركة"]], ["contactName", "Contact name", ["contact", "contact name", "person", "contact_name", "الاسم"]],
    ["category", "Business category", ["category", "type", "org_type", "industry", "sector", "segment", "النشاط"]], ["phone", "Phone", ["phone", "mobile", "tel", "telephone", "contact_phone", "whatsapp", "الهاتف", "موبايل"]],
    ["email", "E-mail", ["email", "e-mail", "mail", "contact_email", "البريد"]], ["location", "City / location", ["city", "location", "area", "address", "governorate", "المدينة"]], ["source", "Lead source", ["source", "lead source", "source_url", "url", "link", "المصدر"]],
    ["notes", "Notes", ["notes", "note", "comments", "projects", "ملاحظات"]], ["followUp", "Follow-up date", ["follow-up", "follow up", "followup", "next", "date"]], ["owner", "Owner (salesperson name or e-mail)", ["owner", "salesperson", "assigned", "assigned to", "claimed by"]]];
  const norm = (s) => String(s || "").toLowerCase().replace(/\b(co|company|llc|ltd|s\.?a\.?e|group|for|and|the|developments?|egypt)\b/g, "").replace(/[^a-z0-9؀-ۿ]+/g, "");
  const phoneN = (s) => String(s || "").replace(/\D/g, "").replace(/^0020|^20(?=1\d{9}$)/, "0");
  const idFor = (name) => { let h = 2166136261; for (const c of norm(name)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return "L-imp-" + (h >>> 0).toString(36); };
  /* ---------- reading the file ---------- */
  function parseCsv(text) { const rows = []; let row = [], f = "", q = false, sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
    for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; } else if (ch === '"') q = true; else if (ch === sep) { row.push(f); f = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += ch; }
    if (f || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => String(x).trim())); }
  async function parseXlsx(buf) {
    await DPIO.lib("jszip"); const zip = await root.JSZip.loadAsync(buf), x = (p) => (zip.file(p) ? zip.file(p).async("string") : Promise.resolve("")), dp = new DOMParser();
    const ss = dp.parseFromString(await x("xl/sharedStrings.xml") || "<sst/>", "application/xml"), strings = [...ss.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
    const wb = dp.parseFromString(await x("xl/workbook.xml"), "application/xml"), rels = dp.parseFromString(await x("xl/_rels/workbook.xml.rels"), "application/xml");
    const first = wb.getElementsByTagName("sheet")[0]; if (!first) throw new Error("The workbook has no sheet.");
    const rid = first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"), rel = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
    const target = rel ? rel.getAttribute("Target").replace(/^\/?(xl\/)?/, "xl/") : "xl/worksheets/sheet1.xml", sh = dp.parseFromString(await x(target), "application/xml");
    const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }, rows = [];
    for (const r of sh.getElementsByTagName("row")) { const row = []; for (const c of r.getElementsByTagName("c")) { const t = c.getAttribute("t"), v = (c.getElementsByTagName("v")[0] || {}).textContent;
        row[col(c.getAttribute("r"))] = t === "s" ? strings[+v] || "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((e) => e.textContent).join("") : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v == null ? "" : v; }
      rows.push(Array.from(row, (z) => (z == null ? "" : String(z)))); }
    return rows.filter((r) => r.some((z) => String(z).trim()));
  }
  async function readFile(file) { if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer()); if (/\.xls$/i.test(file.name)) throw new Error("Old .xls files are not supported. Save the sheet as .xlsx or .csv and upload again."); return parseCsv((await file.text()).replace(/^﻿/, "")); }
  const dateOf = (v) => { if (!v) return ""; if (/^\d{5}(\.\d+)?$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(+v) * 864e5); return d.toISOString().slice(0, 10); } const m = String(v).match(/^(\d{4})-(\d\d)-(\d\d)/) || String(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    return !m ? "invalid" : m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
  /* ---------- validation and duplicates ---------- */
  function analyse(rows, map, existing, people) {
    const ex = { name: new Map(), phone: new Map(), email: new Map() };
    for (const l of existing) { ex.name.set(norm(l.name), l); const c = l.contact || {}; if (c.phone) ex.phone.set(phoneN(c.phone), l); if (c.email) ex.email.set(String(c.email).toLowerCase(), l); }
    const seen = new Map(), out = [];
    rows.forEach((r, i) => { const g = (k) => (map[k] != null && map[k] !== "" ? String(r[+map[k]] || "").trim() : ""), v = Object.fromEntries(FIELDS.map(([k]) => [k, g(k)])), errs = [], warn = [];
      if (!v.name) errs.push("Company name missing"); if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.push("Invalid e-mail"); if (v.phone && !/^[+()0-9\s-]{6,24}$/.test(v.phone)) errs.push("Invalid phone number");
      const fu = dateOf(v.followUp); if (fu === "invalid") errs.push("Follow-up date not understood (use YYYY-MM-DD or DD/MM/YYYY)");
      let owner = null; if (v.owner) { const o = people.find((p) => [p.email, DPAuth.fullName(p), p.displayName].filter(Boolean).some((x) => String(x).toLowerCase() === v.owner.toLowerCase())); if (!o) errs.push(`Owner "${v.owner}" is not an active salesperson`); else owner = o.uid; }
      const n = norm(v.name), dupFile = n && seen.has(n) ? seen.get(n) : null; if (n && !dupFile) seen.set(n, i + 2);
      const exName = n ? ex.name.get(n) : null, exPhone = v.phone ? ex.phone.get(phoneN(v.phone)) : null, exMail = v.email ? ex.email.get(v.email.toLowerCase()) : null;
      let status = errs.length ? "rejected" : dupFile ? "duplicate" : exName ? "duplicate" : "ok", dupOf = dupFile ? `row ${dupFile} of this file` : exName ? `existing lead "${exName.name}"` : null;
      if (status === "ok" && (exPhone || exMail)) { status = "possible"; warn.push(`Same ${exPhone ? "phone" : "e-mail"} as existing lead "${(exPhone || exMail).name}"`); }
      out.push({ row: i + 2, v, followUp: fu === "invalid" ? "" : fu, owner, errs, warn, status, dupOf }); });
    return out;
  }
  /* ---------- the wizard ---------- */
  async function wizard(file, done) {
    let rows; try { rows = await readFile(file); } catch (e) { return U.toast(e.message || "The file could not be read.", { err: true, ms: 9000 }); }
    if (rows.length < 2) return U.toast("The file has no data rows.", { err: true });
    const head = rows[0].map((h) => String(h).trim()), body = rows.slice(1), map = {};
    for (const [k, , syn] of FIELDS) { const i = head.findIndex((h) => syn.some((s) => h.toLowerCase() === s || h.toLowerCase().replace(/[_-]/g, " ") === s)); if (i >= 0) map[k] = String(i); }
    const [existing, dir] = await Promise.all([L().listLeads(), DPAuth.listDirectory()]), people = dir.filter((r) => r.uid && r.active !== false && DPAuth.isSalesRole(r.role));
    let res = null;
    U.openModal(`<h2>Import leads — ${esc(file.name)}</h2><p class="small muted">${body.length} data row(s). 1 · match the columns · 2 · check the preview · 3 · import.</p>
      <div class="card"><b class="small">Columns</b><div class="grid2">${FIELDS.map(([k, l]) => `<label class="field"><span>${esc(l)}</span><select class="in sm" data-map="${k}"><option value="">— not in the file —</option>${head.map((h, i) => `<option value="${i}"${map[k] === String(i) ? " selected" : ""}>${esc(h || "column " + (i + 1))}</option>`).join("")}</select></label>`).join("")}</div>
        <div class="grid2"><label class="field"><span>Where the contact details come from (required to keep phones and e-mails)</span><input class="in sm" id="li-src" placeholder="e.g. Cityscape 2026 visitor list, our own CRM export"></label><label class="field"><span>After import</span><select class="in sm" id="li-st"><option value="available">Available in the Lead Mine (sales can claim)</option><option value="research">Under research (data entry completes them first)</option></select></label></div><label class="field"><span>Campaign that produced this list (lead source for reporting)</span><select class="in sm" id="li-cp"><option value="">— none —</option></select></label></div>
      <div id="li-prev"></div><p class="small fin-err" style="color:var(--red)"></p><div class="acts"><button class="btn ghost" id="li-x">Cancel</button><button class="btn ghost" id="li-c">Check</button><button class="btn lime" id="li-ok" disabled>Import</button></div>`, (m) => { if (root.DPMkt) DPMkt.campaigns().then((cs) => { const sel = $("#li-cp", m); if (sel) sel.insertAdjacentHTML("beforeend", cs.filter((c) => !["cancelled"].includes(c.status)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.source)}</option>`).join("")); }).catch(() => {});
      const read = () => { $$("[data-map]", m).forEach((s) => (map[s.dataset.map] = s.value)); };
      const check = () => { read(); if (!map.name) { $(".fin-err", m).textContent = "Choose the column with the company name."; return; } $(".fin-err", m).textContent = "";
        res = analyse(body, map, existing, people); const c = (s) => res.filter((r) => r.status === s).length;
        $("#li-prev", m).innerHTML = `<div class="kcards sm"><div class="kc"><span class="eyebrow">Ready to import</span><b class="num">${c("ok")}</b></div><div class="kc ${c("possible") ? "warn" : ""}"><span class="eyebrow">Possible duplicates</span><b class="num">${c("possible")}</b><span class="tiny muted">tick to import anyway</span></div><div class="kc"><span class="eyebrow">Duplicates (skipped)</span><b class="num">${c("duplicate")}</b></div><div class="kc ${c("rejected") ? "err" : ""}"><span class="eyebrow">Rejected</span><b class="num">${c("rejected")}</b></div></div>
          <div class="tablewrap" style="max-height:300px"><table class="mtable"><thead><tr><th>Row</th><th>Company</th><th>Contact</th><th>Phone / e-mail</th><th>City</th><th>Result</th></tr></thead><tbody>${res.slice(0, 200).map((r, i) => `<tr><td class="tiny">${r.row}</td><td class="small">${esc(r.v.name)}</td><td class="small">${esc(r.v.contactName)}</td><td class="small">${esc([r.v.phone, r.v.email].filter(Boolean).join(" · "))}</td><td class="small">${esc(r.v.location)}</td>
            <td class="small">${r.status === "ok" ? `<span class="pill ok">OK</span>` : r.status === "possible" ? `<label class="check tiny"><input type="checkbox" data-pos="${i}"> ${esc(r.warn.join("; "))}</label>` : r.status === "duplicate" ? `<span class="pill">duplicate of ${esc(r.dupOf)}</span>` : `<span class="pill err">${esc(r.errs.join("; "))}</span>`}</td></tr>`).join("")}</tbody></table></div>${res.length > 200 ? `<p class="tiny muted">Showing the first 200 rows.</p>` : ""}
          ${c("rejected") ? `<button class="btn ghost xs" id="li-rej">Download rejected rows (CSV)</button>` : ""}`;
        $("#li-ok", m).disabled = !c("ok") && !c("possible"); const rj = $("#li-rej", m); if (rj) rj.onclick = () => downloadRejected(res, head, body); };
      $$("[data-map]", m).forEach((s) => (s.onchange = check)); $("#li-c", m).onclick = check; $("#li-x", m).onclick = () => U.closeModal(); check();
      $("#li-ok", m).onclick = async () => { read(); const src = $("#li-src", m).value.trim(), status = $("#li-st", m).value, campaignId = ($("#li-cp", m) || {}).value || null, take = new Set($$("[data-pos]", m).filter((x) => x.checked).map((x) => +x.dataset.pos));
        const list = res.filter((r, i) => r.status === "ok" || (r.status === "possible" && take.has(i)));
        if (list.some((r) => r.v.phone || r.v.email) && !src) { $(".fin-err", m).textContent = "Say where the contact details come from — otherwise phones and e-mails cannot be kept."; return; }
        const btn = $("#li-ok", m); btn.disabled = true; btn.textContent = "Importing…";
        try { const r = await importRows(list, { file: file.name, source: src, status, campaignId }); U.closeModal(); summary(r, res, head, body); done && done(r); } catch (e) { $(".fin-err", m).textContent = e.message; btn.disabled = false; btn.textContent = "Import"; } };
    }, { wide: true });
  }
  async function importRows(list, { file, source, status, campaignId = null }) {
    if (!U.isAdmin()) throw new Error("Administrators only."); const at = new Date().toISOString(), me = DPAuth.A.me.id, origin = `File import: ${file}`;
    let added = 0, skipped = 0; const owners = [];
    const work = list.map((r) => async () => { const id = idFor(r.v.name), path = `leads/${id}`; if (await DPStore.tryGet(path)) { skipped++; return; }
      const orgType = Object.keys(L().ORG_TYPES).find((k) => k === r.v.category || L().ORG_TYPES[k].toLowerCase() === r.v.category.toLowerCase()) || "other";
      const keep = !!source, lead = { name: r.v.name, orgType, category: r.v.category || "", location: r.v.location, country: "Egypt", status, origin, originKind: "import", campaignId: campaignId || null, sources: /^https?:\/\//.test(r.v.source) ? [{ url: r.v.source, date: at.slice(0, 10) }] : [], sourceNote: /^https?:\/\//.test(r.v.source) ? "" : r.v.source,
        evidence: r.v.notes, notes: r.v.notes, followUp: r.followUp || null, contact: { name: r.v.contactName, title: "", phone: keep ? r.v.phone : "", email: keep ? r.v.email : "", source: keep && (r.v.phone || r.v.email) ? source : "", sub: "none", verifiedAt: null },
        qualification: {}, createdAt: at, createdBy: me, updatedAt: at, updatedBy: me, history: [{ at, by: me, action: "Imported", reason: origin, detail: `row ${r.row}` }] };
      await DPStore.set(path, lead); added++; if (r.owner) owners.push({ id, uid: r.owner }); });
    for (let i = 0; i < work.length; i += 8) await Promise.all(work.slice(i, i + 8).map((f) => f()));
    for (const o of owners) await L().reassign(o.id, o.uid, "Owner given in the imported file", { timer: true }).catch(() => {});
    await DPAuth.adminLog("Leads imported", { target: file, detail: `${added} added, ${skipped} already existed${owners.length ? `, ${owners.length} assigned` : ""}` }).catch(() => {});
    if (added && status === "available") { const sales = DPAuth.A.directory.filter((r) => r.uid && r.active !== false && DPAuth.baseOf(r.role) === "employee").map((r) => r.uid);
      if (sales.length) await DPNotify.deliver(sales, { id: `leadimp-${at.replace(/\D/g, "").slice(0, 14)}`, type: "lead", title: `${added} new lead(s) in the Lead Mine`, body: `${added} new organisation(s) are available to claim${owners.length ? ` (${owners.length} already assigned)` : ""}.`, link: { view: "leads" } }).catch(() => {}); }
    return { added, skipped, assigned: owners.length };
  }
  function downloadRejected(res, head, body) { const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [["row", "error"].concat(head).map(q).join(",")].concat(res.filter((r) => r.status === "rejected").map((r) => [r.row, r.errs.join("; ")].concat(body[r.row - 2]).map(q).join(","))).join("\r\n");
    U.downloadOut({ blob: new Blob(["﻿" + csv], { type: "text/csv" }), filename: `lead-import-rejected_${new Date().toISOString().slice(0, 10)}.csv` }, "Rejected rows"); }
  function summary(r, res, head, body) { const rej = res.filter((x) => x.status === "rejected").length, dup = res.filter((x) => x.status === "duplicate").length;
    U.openModal(`<h2>Import finished</h2><dl class="kv"><dt>Added to the Lead Mine</dt><dd><b>${r.added}</b></dd><dt>Already existed (not duplicated)</dt><dd>${r.skipped + dup}</dd><dt>Rejected</dt><dd>${rej}</dd>${r.assigned ? `<dt>Assigned to their owner</dt><dd>${r.assigned}</dd>` : ""}</dl>${r.added ? `<p class="small muted">Sales have been notified once with the number of new leads.</p>` : ""}
      <div class="acts">${rej ? `<button class="btn ghost" id="ls-r">Download rejected rows</button>` : ""}<button class="btn lime" id="ls-x">Done</button></div>`, (m) => { $("#ls-x", m).onclick = () => U.closeModal(); const b = $("#ls-r", m); if (b) b.onclick = () => downloadRejected(res, head, body); }); }
  root.DPLeadImport = { FIELDS, parseCsv, parseXlsx, analyse, wizard, importRows, idFor, norm };
})(typeof self !== "undefined" ? self : this);
