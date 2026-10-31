/* X FORCE 2.0 "Snap" — people (Session 5): the employee ID card on screen and as a printable PDF.
   The card shows only what X FORCE stores (name, job title, department, employee ID, hire date, picture) and only what the
   viewer may read: everyone reads their own HR record; administrators read everyone's (database rules, store.js).
   Card: the back of the brand business card ("Quiet front. Warm back."): charcoal, lime corner, arch portrait, codes style.
   PDF: ID-1 card size 54 × 85.6 mm, page 1 the quiet front (logo on white), page 2 the warm back. */
/* global DPAuth, DPSales, DPProposal, DPUI */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /** Department colour of a role (the X FORCE 1.4.3 department signals). */
  const DEPT_OF = { admin: "strategic", employee: "sales", marketing: "sales", dataentry: "sales", accountant: "finance", engineer: "factory", viewer: "strategic" };
  const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";

  /** Everything the card needs for one person, read with the viewer's own permissions (missing fields stay empty). */
  async function cardData(uid) {
    const A = root.DPAuth; if (!A || !uid) return null;
    const rec = (A.A.directory || []).find((r) => r.uid === uid) || (A.A.me && A.A.me.id === uid ? A.A.record || {} : {});
    const [staff, photo] = await Promise.all([root.DPSales ? DPSales.staffDoc(uid).catch(() => null) : null, A.picture(uid).catch(() => null)]);
    const hr = (staff && staff.hr) || {}, base = A.baseOf ? A.baseOf(rec.role) : "employee";
    const name = (A.fullName && A.fullName(rec)) || rec.displayName || (A.A.me && A.A.me.id === uid ? A.A.me.name : "") || "";
    return { uid, name, title: rec.title || "", department: rec.department || "", roleLabel: ((A.roleOf && A.roleOf(rec.role)) || {}).label || "", dept: DEPT_OF[base] || "strategic",
      employeeId: hr.employeeId || "", hireDate: hr.hireDate || "", photo: photo || null };
  }

  /** On-screen card (Session 2 .x-idcard shell). width in px. */
  function cardHtml(d, { width = 340 } = {}) {
    if (!d) return "";
    const since = d.hireDate ? String(d.hireDate).slice(0, 4) : "—", sub = [d.title || d.roleLabel, d.department].filter(Boolean).join(" · ");
    return `<button type="button" class="x-idcard" data-name="${esc(d.name)}" style="--_w:${width}px">
      <div class="x-idcard__flip">
        <div class="x-idcard__face x-idcard__back">
          <span class="x-idcard__plate"><img src="brand/logo_compact.png" alt="Dupedia"></span>
          <div class="x-idcard__photo">${d.photo ? `<img alt="" src="${esc(d.photo)}">` : esc(initials(d.name))}</div>
          <p class="x-idcard__name">${esc(d.name || "—")}</p>
          <p class="x-idcard__title">${esc(sub)}</p>
          <div class="x-idcard__row"><dl><div><dt>Employee ID</dt><dd>${esc(d.employeeId || "—")}</dd></div><div><dt>Since</dt><dd>${esc(since)}</dd></div></dl>${root.XF && XF.mark ? XF.mark(d.dept) : ""}</div>
        </div>
        <div class="x-idcard__face x-idcard__front"><img src="brand/logo_compact.png" alt="Dupedia"><p>Serious about play.</p></div>
      </div></button>`;
  }
  /** Bind the flip on a card inside host. */
  function bind(host) { const c = host && host.querySelector(".x-idcard"); if (c && root.XF && XF.motion) XF.motion.idcard(c); return c; }

  /* ---------------- printable PDF ---------------- */
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("An image for the ID card could not be loaded.")); i.src = src; });
  /** The arch portrait (or initials on graphite) as a PNG, so the PDF gets the same shape as the screen. */
  async function archPng(d, wmm, hmm) {
    const s = 24, cv = document.createElement("canvas"); cv.width = Math.round(wmm * s); cv.height = Math.round(hmm * s); const g = cv.getContext("2d"), W = cv.width, H = cv.height, r = W / 2, foot = Math.round(0.4 * s);
    g.beginPath(); g.moveTo(0, H - foot); g.lineTo(0, r); g.arc(r, r, r, Math.PI, 0); g.lineTo(W, H - foot); g.quadraticCurveTo(W, H, W - foot, H); g.lineTo(foot, H); g.quadraticCurveTo(0, H, 0, H - foot); g.closePath(); g.clip();
    g.fillStyle = "#45453F"; g.fillRect(0, 0, W, H);
    if (d.photo) { const im = await loadImg(d.photo); const k = Math.max(W / im.width, H / im.height); g.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k); }
    else { if (document.fonts) await document.fonts.load(`600 ${Math.round(H * 0.32)}px Fraunces`).catch(() => {}); g.fillStyle = "#BDBBB2"; g.font = `600 ${Math.round(H * 0.32)}px Fraunces, Georgia, serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(initials(d.name), W / 2, H * 0.58); }
    return cv.toDataURL("image/png");
  }
  /** The department's division mark as a PNG (drawn from the same SVG as the screen). */
  async function markPng(dept, mm) {
    const svg = root.XF && XF.mark ? XF.mark(dept) : ""; if (!svg) return null;
    const xml = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" ');
    const im = await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml)); const cv = document.createElement("canvas"); cv.width = cv.height = Math.round(mm * 24);
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); return cv.toDataURL("image/png");
  }
  /** Build the two-page ID card PDF. Returns { blob, filename, pages }. */
  async function pdf(d) {
    if (!root.DPProposal) throw new Error("The PDF engine is not available.");
    await DPProposal.ensureLib();   // jsPDF, the brand fonts and the master logos (same as proposals)
    const A = root.DP_PDF_ASSETS || {}, F = A.fonts || {}, L = (A.logos || {}).compact;
    const W = 54, H = 85.6, doc = new root.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: [W, H], compress: true });
    for (const k of ["IS", "ISB", "FR", "FRI"]) if (F[k]) { doc.addFileToVFS(k + ".ttf", F[k]); doc.addFont(k + ".ttf", k, "normal"); }
    const font = (k, fb) => doc.setFont(F[k] ? k : "helvetica", F[k] ? "normal" : fb || "normal");
    const logo = (x, y, w) => { if (!L) { font("ISB", "bold"); doc.setFontSize(w * 0.9); doc.setTextColor("#262626"); doc.text("Dupedia", x, y + w * 0.32); return w * 0.4; } const h = (w * L.h) / L.w; doc.addImage(L.data, "PNG", x, y, w, h, "logoC", "FAST"); return h; };
    // page 1 — the quiet front: the logo on white, the lime corner, the line
    doc.setFillColor("#FFFFFF"); doc.rect(0, 0, W, H, "F");
    doc.setFillColor("#B8D241"); doc.circle(W, 0, 13, "F");
    const lw = 36, lh = logo((W - lw) / 2, 30, lw);
    font("FRI"); doc.setFontSize(9); doc.setTextColor("#262626"); doc.text("Serious about play.", W / 2, 30 + lh + 26, { align: "center" });
    // page 2 — the warm back: charcoal, lime corner, plate with the compact logo (brand minimum 25 mm), arch portrait, codes
    doc.addPage([W, H], "portrait");
    doc.setFillColor("#262626"); doc.rect(0, 0, W, H, "F");
    doc.setFillColor("#B8D241"); doc.circle(W, 0, 15, "F");
    doc.setFillColor("#FFFFFF"); const pw = 25, ph = L ? (pw * L.h) / L.w : 10; doc.roundedRect(4, 4, pw + 3, ph + 3, 1.2, 1.2, "F"); logo(5.5, 5.5, pw);
    const ax = 4.5, ay = ph + 11, aw = 27, ah = 30; doc.addImage(await archPng(d, aw, ah), "PNG", ax, ay, aw, ah);
    let y = ay + ah + 7; font("FR"); doc.setTextColor("#F3F1EA"); doc.setFontSize(13);
    const nameLines = doc.splitTextToSize(d.name || "—", W - 9).slice(0, 2); doc.text(nameLines, 4.5, y); y += nameLines.length * 5;
    font("IS"); doc.setFontSize(6.6); doc.setTextColor("#BDBBB2"); const sub = doc.splitTextToSize([d.title || d.roleLabel, d.department].filter(Boolean).join(" · ") || " ", W - 9).slice(0, 2); doc.text(sub, 4.5, y);
    const by = H - 13; doc.setDrawColor("#4A4A46"); doc.setLineWidth(0.2); doc.line(4.5, by, W - 4.5, by);
    font("ISB", "bold"); doc.setFontSize(4.6); doc.setTextColor("#B8D241"); doc.text("EMPLOYEE ID", 4.5, by + 4); doc.text("SINCE", 25, by + 4);
    doc.setFontSize(7.2); doc.setTextColor("#F3F1EA"); doc.text(String(d.employeeId || "—").toUpperCase(), 4.5, by + 8.2); doc.text(d.hireDate ? String(d.hireDate).slice(0, 4) : "—", 25, by + 8.2);
    const mk = await markPng(d.dept, 7.5).catch(() => null); if (mk) doc.addImage(mk, "PNG", W - 4.5 - 7.5, by + 2.2, 7.5, 7.5);
    const blob = doc.output("blob"), slug = String(d.name || "employee").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
    const out = { blob, filename: `dupedia-id-card_${slug}.pdf`, pages: doc.getNumberOfPages() };
    if (root.DPProposal.validatePdf) await DPProposal.validatePdf(out, 2);
    return out;
  }
  /** Button handler: the button shows it is busy while the PDF is built, then the file is offered for download. */
  async function downloadPdf(d, btn) {
    const U = root.DPUI, run = async () => { const out = await pdf(d); if (U) await U.downloadOut(out, "ID card"); return out; };
    try { return btn && root.XF && XF.motion ? await XF.motion.busy(btn, run) : await run(); }
    catch (e) { if (U) U.toast(`The ID card could not be created: ${e.message || e}`, { err: true }); throw e; }
  }

  /** A dialog with one person's card and the PDF button (directory, Work Force, user management). */
  async function openCard(uid) {
    const U = root.DPUI; if (!U) return; const d = await cardData(uid); if (!d) return U.toast("This person's card could not be loaded.", { err: true });
    U.openModal(`<div class="xid-dlg"><div id="xid-host">${cardHtml(d, { width: 300 })}</div><div class="xid-side"><h2 class="x-display x-d4">${esc(d.name || "—")}</h2><p class="x-muted">${esc([d.title || d.roleLabel, d.department].filter(Boolean).join(" · "))}</p>
      ${d.employeeId ? "" : `<p class="xid-warn">No employee ID is recorded yet. Add it in User Management before printing.</p>`}
      <div class="xid-acts"><button type="button" class="x-btn x-btn--primary" id="xid-pdf">${root.XF ? XF.icon("download", { size: "md" }) : ""} Download PDF</button><button type="button" class="x-btn x-btn--ghost" id="xid-x">Close</button></div><p class="x-muted xid-tip">Tap the card to turn it over.</p></div></div>`,
      (m) => { bind(m.querySelector("#xid-host")); m.querySelector("#xid-pdf").onclick = (e) => downloadPdf(d, e.currentTarget).catch(() => {}); m.querySelector("#xid-x").onclick = () => U.closeModal(); }, { wide: true });
  }

  const XF = (root.XF = root.XF || {});
  XF.people = { cardData, cardHtml, bind, pdf, downloadPdf, openCard, deptOfRole: (b) => DEPT_OF[b] || "strategic", initials };
})(typeof self !== "undefined" ? self : this);
