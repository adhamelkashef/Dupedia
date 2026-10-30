/* X FORCE 1.3 (Dupedia) — share a generated proposal through WhatsApp or e-mail, always after the employee reviews it.
   Nothing is ever sent by X FORCE itself and no public link to the file is created:
   • "Share…" uses the device's own share sheet with the PDF attached where the browser supports it (Chrome / Edge on
     Windows and Android, Safari on iPhone/iPad and recent macOS): the person picks WhatsApp, Outlook, Gmail… and presses send.
   • Otherwise WhatsApp opens (wa.me, desktop app or web) with the prepared message, and the PDF is saved so it can be
     attached; the e-mail client opens with the subject and message filled in (mailto cannot carry an attachment) and the PDF
     is saved to attach. The screen says this plainly. */
/* global DPUI, DPAuth */
(function (root) {
  "use strict";
  const U = DPUI, { $, esc } = U;
  const waNum = (p) => { let d = String(p || "").replace(/\D/g, ""); if (/^01\d{9}$/.test(d)) d = "2" + d; if (/^1\d{9}$/.test(d)) d = "20" + d; return d; };
  function message(c) { const me = (DPAuth.A.me || {}).name || "", co = ((U.App.config.settings || {}).company || {}).name || "Dupedia";
    return `Dear ${c.customer || "Sir / Madam"},\n\nPlease find attached our proposal ${c.ref ? c.ref + " " : ""}for ${c.project || "your project"}${c.total ? ` (total ${c.total})` : ""}.\n\nWe would be glad to walk you through the layout and answer any question.\n\nBest regards,\n${me}\n${co}`; }
  async function dialog(out, c = {}) {
    const file = new File([out.blob], out.filename, { type: "application/pdf" }), canFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    U.openModal(`<h2>Send the proposal</h2><p class="small muted">Check the customer, the message and the attachment. Nothing is sent until you press send in WhatsApp or your e-mail program.</p>
      <div class="grid2"><label class="field"><span>Customer</span><input class="in" id="sh-c" value="${esc(c.customer || "")}"></label><label class="field"><span>Reference</span><input class="in" id="sh-r" value="${esc(c.ref || "")}" disabled></label></div>
      <div class="grid2"><label class="field"><span>WhatsApp number</span><input class="in" id="sh-p" value="${esc(c.phone || "")}" placeholder="+20 10…"></label><label class="field"><span>E-mail</span><input class="in" id="sh-e" value="${esc(c.email || "")}" placeholder="name@company.com"></label></div>
      <label class="field"><span>E-mail subject</span><input class="in" id="sh-s" value="${esc(`Proposal ${c.ref || ""} — ${c.project || ""}`.trim())}"></label><label class="field"><span>Message</span><textarea class="in" rows="7" id="sh-m">${esc(message(c))}</textarea></label>
      <div class="note small">Attachment: <b>${esc(out.filename)}</b> · ${(out.blob.size / 1024 / 1024).toFixed(1)} MB${out.pages ? ` · ${out.pages} pages` : ""}</div>
      ${canFile ? "" : `<p class="tiny muted">This browser cannot hand a file to WhatsApp or e-mail directly. The buttons below open them with the message ready and save the PDF, which you then attach yourself.</p>`}
      <div class="acts"><button class="btn ghost" id="sh-x">Close</button><button class="btn ghost" id="sh-dl">Save PDF</button>${canFile ? `<button class="btn lime" id="sh-sys">Share… (WhatsApp, e-mail…)</button>` : ""}<button class="btn ghost" id="sh-wa">WhatsApp</button><button class="btn ghost" id="sh-em">E-mail</button></div>`, (m) => {
      const v = (id) => $("#" + id, m).value.trim(), log = (how) => DPAuth.logActivity(`Proposal prepared for sending (${how})`, `${c.ref || ""} ${v("sh-c")}`).catch(() => {});
      $("#sh-x", m).onclick = () => U.closeModal(); $("#sh-dl", m).onclick = () => U.downloadOut(out, "Proposal");
      const sys = $("#sh-sys", m); if (sys) sys.onclick = async () => { try { await navigator.share({ files: [file], title: v("sh-s"), text: v("sh-m") }); log("share sheet"); U.toast("Handed to the app you chose — check it was sent there."); } catch (e) { if (e && e.name !== "AbortError") U.toast("Sharing was not possible: " + (e.message || e), { err: true }); } };
      $("#sh-wa", m).onclick = async () => { const n = waNum(v("sh-p")); if (v("sh-p") && n.length < 10) return U.toast("Check the WhatsApp number (include the country code).", { err: true });
        await U.downloadOut(out, "Proposal (attach it in WhatsApp)"); root.open(`https://wa.me/${n}?text=${encodeURIComponent(v("sh-m"))}`, "_blank", "noopener"); log("WhatsApp"); U.toast("WhatsApp opened with the message. Attach the saved PDF, then press send.", { ms: 9000 }); };
      $("#sh-em", m).onclick = async () => { const e = v("sh-e"); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return U.toast("Check the e-mail address.", { err: true });
        await U.downloadOut(out, "Proposal (attach it to the e-mail)"); location.href = `mailto:${encodeURIComponent(e)}?subject=${encodeURIComponent(v("sh-s"))}&body=${encodeURIComponent(v("sh-m"))}`; log("e-mail"); U.toast("Your e-mail program opened with the message. Attach the saved PDF, then send.", { ms: 9000 }); };
    }, { wide: true });
  }
  root.DPShare = { dialog, message, waNum };
})(typeof self !== "undefined" ? self : this);
