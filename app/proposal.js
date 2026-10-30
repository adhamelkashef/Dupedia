/* Dupedia Site Planner 2.0 — client documents (jsPDF, vector, embedded brand fonts):
   proposal (adaptive, 7 sections), printable quotation, A3 technical drawing.
   The plan is drawn with the same renderer and symbols as the editor (DPPlan via the Pen PDF backend).
   Brand: Playful Classic — cream/white, charcoal, lime; no division colour on corporate documents; lime corner mark once per page. */
/* global DPModel, DPCat, DPPricing, DPPlan, DPPen, DPSymbols, DPGeom, DPIO, DPUI, DP_FONT_COVER */
(function (root) {
  "use strict";
  const M = DPModel, S = M.S, G = DPGeom, PR = DPPricing;
  const C = { ink: "#262626", graphite: "#45453F", pebble: "#5E5E58", stone: "#EAE8E1", cream: "#FBFAF6", lime: "#B8D241", limeInk: "#5B6B12", white: "#FFFFFF", line: "#D9D7CF", red: "#B3261E" };
  const FONTS = { sans: "IS", sansBold: "ISB", serif: "FR", serifItalic: "FRI" };
  const PT = 0.3527777778;  // mm per point
  let fontData = null, logoP = null, logoC = null;

  /* ---------------- assets (no fetch(): everything arrives by <script>, so it works in sandboxed artifact frames) ----------------
     Root cause of "The proposal could not be built: Load failed" (v2.0): the builder read its font files with fetch().
     In the artifact viewer the page runs in a sandboxed frame without an origin of its own, so fetch() of the page's own files is a
     cross-origin request and is refused (Safari/WebKit reports it as "Load failed"). Reading product photos back from a canvas
     is refused for the same reason. Fonts, logos and product photos are now shipped as small script files (pdfassets/), which
     load in any frame, and every optional image has a fallback. */
  function loadScript(src, timeoutMs = 20000) {
    return new Promise((res, rej) => {
      const s = document.createElement("script"); let done = false; const t = setTimeout(() => { if (!done) { done = true; rej(new Error("Timed out loading " + src)); } }, timeoutMs);
      s.src = src; s.async = true; s.onload = () => { if (!done) { done = true; clearTimeout(t); res(); } }; s.onerror = () => { if (!done) { done = true; clearTimeout(t); rej(new Error("Could not load " + src)); } };
      document.head.appendChild(s);
    });
  }
  const A = () => root.DP_PDF_ASSETS || {};
  async function loadAssets(progress) {
    if (!fontData) {
      progress && progress("Loading brand fonts");
      if (!A().fonts) await loadScript("pdfassets/fonts.js").catch(() => { throw new Error("The brand fonts for the PDF could not be loaded (pdfassets/fonts.js). Check the connection and try again."); });
      const f = A().fonts; if (!f || !["IS", "ISB", "FR", "FRI"].every((k) => typeof f[k] === "string" && f[k].length > 1000)) throw new Error("The PDF font data is incomplete.");
      fontData = ["IS", "ISB", "FR", "FRI"].map((k) => [k, f[k]]);
    }
    if (!logoP || !logoC) {
      progress && progress("Loading logos");
      if (!A().logos) await loadScript("pdfassets/logos.js").catch(() => null);
      const L = A().logos || {};
      logoP = L.primary ? Object.assign({ fmt: "PNG" }, L.primary) : null; logoC = L.compact ? Object.assign({ fmt: "PNG" }, L.compact) : null;   // null → text wordmark fallback
    }
  }
  /** Product photo for the schedule: script-shipped JPEG → canvas copy of the page image (same-origin hosts) → null (placeholder). */
  async function productPhoto(code, thumb) {
    const cache = root.DP_PDF_IMG || {}; if (cache[code]) return Object.assign({ fmt: "JPEG" }, cache[code]);
    if (thumb) try { await loadScript(`pdfassets/img/${encodeURIComponent(code)}.js`, 12000); const c = (root.DP_PDF_IMG || {})[code]; if (c && /^data:image\/jpeg;base64,/.test(c.data)) return Object.assign({ fmt: "JPEG" }, c); } catch (e) { /* fall through */ }
    if (thumb) return imgData(thumb, "image/jpeg", 700);
    return null;
  }
  /** Image (data URL or same-origin URL) → {data, w, h, fmt} for jsPDF, or null if it cannot be read. Never throws. */
  function imgData(src, type = "image/jpeg", maxSide = 1400) {
    return new Promise((res) => {
      if (!src) return res(null); const im = new Image(); const t = setTimeout(() => res(null), 15000);
      im.onload = () => { clearTimeout(t); try { const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight)); const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(im.naturalWidth * s)); cv.height = Math.max(1, Math.round(im.naturalHeight * s));
        const x = cv.getContext("2d"); if (type === "image/jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); } x.drawImage(im, 0, 0, cv.width, cv.height); res({ data: cv.toDataURL(type, 0.86), w: cv.width, h: cv.height, fmt: type === "image/png" ? "PNG" : "JPEG" }); } catch (e) { res(null); } };
      im.onerror = () => { clearTimeout(t); res(null); }; im.src = src; });
  }
  /** Draw a logo, or the Dupedia wordmark in Fraunces if the logo file could not be loaded. */
  function drawLogo(D, img, x, y, h) {
    if (img) { D.doc.addImage(img.data, "PNG", x, y, h * img.w / img.h, h, undefined, "FAST"); return; }
    txt(D, "Dupedia", x, y + h * 0.72, { size: h * 2.1, font: "serif" });
  }
  const cover = (k) => { const rs = (root.DP_FONT_COVER || {})[k]; return rs ? (c) => rs.some(([a, b]) => c >= a && c <= b) : () => true; };
  const COVER = { sans: cover("sans"), sansBold: cover("sansBold"), serif: cover("serif"), serifItalic: cover("serifItalic") };
  const SUBST = { "→": "-", "←": "-", "✓": "", "✕": "x", "≈": "~", "≤": "<=", "≥": ">=", "⌀": "dia. ", " ": " ", "−": "-" };
  function safe(str, font) { const ok = COVER[font] || COVER.sans; let o = ""; for (const ch of String(str)) { const c = ch.codePointAt(0); if (ok(c) || c === 10 || c === 13) o += ch; else if (SUBST[ch] != null) o += [...SUBST[ch]].filter((x) => ok(x.codePointAt(0))).join(""); else o += "?"; } return o; }

  /* ---------------- document wrapper ---------------- */
  /** 1.2: an A4 portrait document with the brand fonts (receipts, invoices, credit notes). Call ensureLib() first. */
  function portraitDoc() {
    const { jsPDF } = root.jspdf; const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    for (const [n, d] of fontData) { doc.addFileToVFS(n + ".ttf", d); doc.addFont(n + ".ttf", n, "normal"); }
    doc.setFont("IS", "normal"); doc.setLineHeightFactor(1.32); return doc;
  }
  const brandLogo = () => logoP;
  function newDoc(format = "a4") {
    const { jsPDF } = root.jspdf; const doc = new jsPDF({ orientation: "landscape", unit: "mm", format, compress: true });
    for (const [n, d] of fontData) { doc.addFileToVFS(n + ".ttf", d); doc.addFont(n + ".ttf", n, "normal"); }
    doc.setFont("IS", "normal"); doc.setLineHeightFactor(1.32);
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const D = { doc, W, H, pen: null, page: 1 };
    D.pen = () => new DPPen({ kind: "pdf", doc, fonts: FONTS, safe, pxScale: 4 });
    return D;
  }
  const rgb = (h) => DPPen.hexRgb(h);
  function txt(D, s, x, y, o = {}) {
    const d = D.doc, f = o.font || "sans"; d.setFont(FONTS[f], "normal"); d.setFontSize(o.size || 9); d.setTextColor(...rgb(o.color || C.ink));
    s = safe(s == null ? "" : s, f); const opt = { align: o.align || "left", baseline: o.baseline || "alphabetic" }; if (o.maxW) opt.maxWidth = o.maxW;
    if (o.charSpace) opt.charSpace = o.charSpace;
    d.text(s, x, y, opt); return d.getTextWidth(s);
  }
  /** Wrapped paragraph; returns y after the last line. */
  function para(D, s, x, y, w, o = {}) {
    const d = D.doc, f = o.font || "sans", size = o.size || 9, lh = (o.lh || 1.4) * size * PT; d.setFont(FONTS[f], "normal"); d.setFontSize(size); d.setTextColor(...rgb(o.color || C.ink));
    const lines = d.splitTextToSize(safe(s || "", f), w); const max = o.maxLines || 1e9;
    lines.slice(0, max).forEach((l, i) => { let t = l; if (i === max - 1 && lines.length > max) t = t.replace(/\s*\S*$/, "") + "…"; d.text(t, x, y + i * lh); });
    return y + Math.min(lines.length, max) * lh;
  }
  function eyebrow(D, s, x, y, color = C.pebble, align = "left") { s = safe(s.toUpperCase(), "sansBold"); const d = D.doc; d.setFont("ISB", "normal"); d.setFontSize(7); const w = d.getTextWidth(s) + 0.45 * Math.max(0, s.length - 1);
    return txt(D, s, align === "right" ? x - w : align === "center" ? x - w / 2 : x, y, { size: 7, font: "sansBold", color, charSpace: 0.45 }); }
  function rect(D, x, y, w, h, fill, stroke, lw = 0.2) { const d = D.doc; if (fill) d.setFillColor(...rgb(fill)); if (stroke) { d.setDrawColor(...rgb(stroke)); d.setLineWidth(lw); } d.rect(x, y, w, h, fill && stroke ? "FD" : fill ? "F" : "S"); }
  function hline(D, x1, x2, y, color = C.line, lw = 0.2) { const d = D.doc; d.setDrawColor(...rgb(color)); d.setLineWidth(lw); d.line(x1, y, x2, y); }
  /** The brand corner mark: a lime quarter circle in the top-right corner. */
  function cornerMark(D, r = 15) { const P = D.pen(); P.begin().moveTo(D.W, 0).lineTo(D.W - r, 0).arc(D.W, 0, r, Math.PI, Math.PI / 2, true).close().fill(C.lime); }
  /** Building-block band (square, quarter, half, circle). */
  function blocks(D, x, y, u, dark = C.ink) {
    const P = D.pen();
    P.begin().rect(x, y, u, u).fill(dark);
    P.begin().moveTo(x + 2 * u, y + u).lineTo(x + u, y + u).arc(x + 2 * u, y + u, u, Math.PI, Math.PI * 1.5, false).close().fill(C.lime);
    P.begin().moveTo(x + 2 * u, y).lineTo(x + 3 * u, y).lineTo(x + 3 * u, y + u / 2).arc(x + 2.5 * u, y + u / 2, u / 2, 0, Math.PI, false).close().fill(dark);
    P.begin().circle(x + 3.5 * u, y + u / 2, u / 2).fill(C.lime);
  }

  /* ---------------- shared data ---------------- */
  function context() {
    const p = S.project, m = M.metrics(), r = DPUI.pricing(), lg = DPPlan.legend(p), v = M.validate();
    const settings = DPUI.App.config.settings, company = settings.company || {};
    const counts = {}; for (const o of p.objects) if (o.kind === "product" && !o.hidden) counts[o.code] = (counts[o.code] || 0) + 1;
    return { p, m, r, lg, v, settings, company, counts, sample: !!DPUI.App.sample, date: p.meta.date ? new Date(p.meta.date + "T12:00:00") : new Date() };
  }
  const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m2 = (a) => `${a >= 100 ? Math.round(a).toLocaleString("en-US") : f2(a)} m²`;

  /* ---------------- page furniture ---------------- */
  function frame(D, X, section, num) {
    const { p } = X;
    drawLogo(D, logoC, 13, 6.5, 13);  // compact logo: brand minimum 25 mm wide
    eyebrow(D, `${String(num).padStart(2, "0")} · ${section}`, 44, 14.6);
    txt(D, `${p.meta.name}${p.meta.ref ? "  ·  " + p.meta.ref : ""}`, D.W - 24, 14.6, { size: 7.5, color: C.pebble, align: "right" });
    cornerMark(D, 13);
    hline(D, 14, D.W - 14, D.H - 11.5, C.line, 0.25);
    txt(D, "Dupedia", 14, D.H - 7, { size: 7.5, font: "sansBold" }); txt(D, "Serious about ", 26.8, D.H - 7, { size: 7.5, color: C.pebble }); txt(D, "play.", 26.8 + D.doc.getTextWidth("Serious about "), D.H - 7, { size: 7.5, font: "serifItalic", color: C.pebble });
    if (X.sample) txt(D, "SAMPLE PROJECT · ILLUSTRATIVE PRICES · NOT A QUOTATION", D.W / 2, D.H - 7, { size: 7, font: "sansBold", color: C.red, align: "center" });
    else txt(D, `Proposal ${p.meta.ref || ""} · ${fmtDate(X.date)}`, D.W / 2, D.H - 7, { size: 7.5, color: C.pebble, align: "center" });
  }
  function logoSize(img, h) { return [h * img.w / img.h, h]; }
  function heading(D, text, x, y, size = 24, accent) {
    // one italic accent per headline (brand rule): the accent word is set in Fraunces italic
    const d = D.doc; let cx = x;
    const parts = accent && text.includes(accent) ? text.split(accent) : [text];
    for (let i = 0; i < parts.length; i++) { cx += txt(D, parts[i], cx, y, { size, font: "serif" }); if (i < parts.length - 1) cx += txt(D, accent, cx, y, { size, font: "serifItalic" }); }
    void d; return cx;
  }

  /* ---------------- plan drawing into a box ---------------- */
  function drawPlan(D, X, box, { mode = "presentation", dims = true, labels = true, zones = true, ts = 0.22, standard = false } = {}) {
    const ext = DPIO.extent(X.p); if (!ext) return null;
    const pad = 4; let s = Math.min((box.w - 2 * pad) / Math.max(ext.w, 1e-6), (box.h - 2 * pad) / Math.max(ext.h, 1e-6));
    if (standard) { const den = [20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000].find((d) => 1000 / d <= s); if (den) s = 1000 / den; }
    const ox = box.x + box.w / 2 - (ext.x0 + ext.w / 2) * s, oy = box.y + box.h / 2 - (ext.y0 + ext.h / 2) * s;
    const P = D.pen(); P.save(); P.begin().rect(box.x, box.y, box.w, box.h).clip(); P.setMatrix([s, 0, 0, s, ox, oy]);
    DPPlan.draw(P, { project: X.p, mode, show: { grid: false, labels, dims, zones, ref: false, cad: !!(S.cadData && X.p.cad), }, cadData: S.cadData, pdf: true, ts, legend: X.lg });
    P.restore();
    return { s, ox, oy, ext };
  }
  function scaleBar(D, x, y, s, maxW = 50) {
    const step = [1, 2, 5, 10, 20, 50, 100, 200].find((m) => m * s >= maxW / 4) || 200, n = Math.max(2, Math.min(5, Math.floor(maxW / (step * s))));
    const P = D.pen();
    for (let i = 0; i < n; i++) P.begin().rect(x + i * step * s, y, step * s, 1.6).paint({ fill: i % 2 ? C.white : C.ink, stroke: C.ink, px: 0.2 });
    for (let i = 0; i <= n; i++) txt(D, `${i * step}`, x + i * step * s, y + 4.6, { size: 6.5, align: "center", color: C.graphite });
    txt(D, "m", x + n * step * s + 3, y + 4.6, { size: 6.5, color: C.graphite });
    const ratio = 1000 / s; const nice = [50, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000].find((r) => r >= ratio * 0.995);
    return { ratio, label: `1:${Math.round(ratio)} at A${D.W > 400 ? 3 : 4}` + (nice && Math.abs(nice - ratio) / ratio < 0.02 ? "" : "") };
  }
  function northArrow(D, x, y, deg) { const P = D.pen(); P.save().translate(x, y).rotateDeg(deg || 0); P.begin().circle(0, 0, 5).paint({ fill: C.white, stroke: C.ink, px: 0.25 }); P.begin().moveTo(0, -4).lineTo(1.9, 2.4).lineTo(0, 1.1).close().fill(C.ink); P.begin().moveTo(0, -4).lineTo(-1.9, 2.4).lineTo(0, 1.1).close().paint({ fill: C.white, stroke: C.ink, px: 0.18 }); P.restore(); txt(D, "N", x, y + 9.2, { size: 7, font: "sansBold", align: "center" }); }

  /* ---------------- pages ---------------- */
  async function pageCover(D, X) {
    const { p } = X, d = D.doc;
    rect(D, 0, 0, D.W, D.H, C.cream);
    // right: project visual in a photo mask with one rounded corner
    const vx = 150, vy = 0, vw = D.W - vx, vh = D.H - 26, r = 22;
    const P = D.pen(); P.save(); P.begin().roundRect(vx, vy, vw, vh, [0, 0, 0, r]).clip();
    if (p.proposal.coverImage) { const im = await imgData(p.proposal.coverImage, "image/jpeg", 2200); if (im) { const sc = Math.max(vw / im.w, vh / im.h); D.doc.addImage(im.data, "JPEG", vx + (vw - im.w * sc) / 2, vy + (vh - im.h * sc) / 2, im.w * sc, im.h * sc, undefined, "FAST"); } }
    else { rect(D, vx, vy, vw, vh, C.white); drawPlan(D, X, { x: vx + 8, y: vy + 10, w: vw - 16, h: vh - 18 }, { mode: "presentation", dims: false, labels: false, zones: true }); }
    P.restore();
    cornerMark(D, 16);
    drawLogo(D, logoP, 14, 12, 32);  // ESTD logo: brand minimum 60 mm wide
    eyebrow(D, "Playground design proposal", 16, 64);
    // title: wrap within the left column
    d.setFont("FR", "normal"); d.setFontSize(27); const lines = d.splitTextToSize(safe(p.meta.name, "serif"), 122).slice(0, 4);
    let y = 76; lines.forEach((l) => { txt(D, l, 16, y, { size: 27, font: "serif" }); y += 10.2; });
    y += 2; txt(D, "for ", 16, y, { size: 15, font: "serif", color: C.graphite }); txt(D, p.meta.client || "Client", 16 + d.getTextWidth("for "), y, { size: 15, font: "serifItalic", color: C.graphite });
    y += 13;
    const kv = [["Location", p.meta.location], ["Reference", p.meta.ref], ["Date", fmtDate(X.date)], ["Prepared by", p.meta.preparedBy]].filter(([, v]) => v);
    kv.forEach(([k, v]) => { eyebrow(D, k, 16, y); txt(D, v, 50, y, { size: 9.5, maxW: 90 }); y += 7.2; });
    if (p.meta.clientLogo) { const im = await imgData(p.meta.clientLogo, "image/png", 600); if (im) { const h = 13, w = Math.min(46, h * im.w / im.h); eyebrow(D, "Prepared for", 16, D.H - 46); D.doc.addImage(im.data, "PNG", 16, D.H - 42, w, w * im.h / im.w, undefined, "FAST"); } }
    // bottom band
    rect(D, 0, D.H - 26, D.W, 26, C.ink); blocks(D, 16, D.H - 18, 9, C.white);
    txt(D, "Serious about ", 70, D.H - 11, { size: 13, font: "serif", color: C.white }); txt(D, "play.", 70 + (d.setFont("FR", "normal"), d.setFontSize(13), d.getTextWidth("Serious about ")), D.H - 11, { size: 13, font: "serifItalic", color: C.lime });
    const comp = X.company; const contact = [comp.web, comp.email, comp.phone].filter(Boolean).join("   ·   ");
    txt(D, X.sample ? "SAMPLE PROJECT — ILLUSTRATIVE PRICES, NOT A QUOTATION" : contact || "Design · Supply · Installation", D.W - 16, D.H - 11, { size: 8, font: X.sample ? "sansBold" : "sans", color: X.sample ? C.lime : C.white, align: "right" });
  }
  function pageOverview(D, X, n) {
    const { p, m, counts } = X; frame(D, X, "Project overview", n);
    heading(D, "The project", 14, 36, 24, "project");
    let y = 46; const colW = 150;
    if (p.meta.description) y = para(D, p.meta.description, 14, y, colW, { size: 10.5, lh: 1.45, color: C.graphite }) + 4;
    const obj = (p.proposal.objectives || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (obj.length) { eyebrow(D, "Objectives", 14, y + 4); y += 10; const P = D.pen();
      for (const o of obj.slice(0, 8)) { P.begin().circle(16, y - 1.2, 1.15).fill(C.lime); y = para(D, o, 21, y, colW - 7, { size: 9.5, lh: 1.4 }) + 2.4; } }
    const scope = [p.meta.type && ["Project type", p.meta.type], ["Products", `${m.products} items · ${Object.keys(counts).length} types`]].filter(Boolean);
    // at a glance: three figures aligned with the big number on the right
    const figs = [[String(m.products), "play products", `${Object.keys(counts).length} types${p.meta.type ? " · " + p.meta.type : ""}`], [m.flooring ? Math.round(m.flooring).toLocaleString("en-US") : "—", "m² safety surfacing", m.zoneArea ? `${Math.round(m.zoneArea)} m² of published safety zones` : ""], [m.lengths.fence ? Math.round(m.lengths.fence.net).toLocaleString("en-US") : "—", "m of fencing", (m.counts.gate || 0) + (m.counts["gate-double"] || 0) ? `${(m.counts.gate || 0) + (m.counts["gate-double"] || 0)} gates` : ""]];
    if (y < D.H - 60) { eyebrow(D, "At a glance", 14, D.H - 52); hline(D, 14, 164, D.H - 48.5, C.line, 0.2);
      figs.forEach(([big, unit, sub], i) => { const x = 14 + i * 52; txt(D, big, x, D.H - 32, { size: 26, font: "serif" }); txt(D, unit, x, D.H - 25, { size: 8.5, color: C.graphite }); if (sub) txt(D, sub, x, D.H - 20.5, { size: 7, color: C.pebble, maxW: 48 }); }); }
    void scope;
    // 1.3 — featured equipment: fills the open space with what the client is buying (photo cropped to fit, top view if none)
    const feat = (X.featured || []).filter((c) => DPCat.BY[c]), top = y + 6, bottom = D.H - 60;
    if (feat.length && bottom - top >= 46) {
      eyebrow(D, "Featured equipment", 14, top); const gap = 5, cols = Math.max(2, feat.length), cw = (colW - gap * (cols - 1)) / cols, ph = Math.min(cw * 0.7, bottom - top - 24);
      feat.forEach((code, i) => { const pp = DPCat.BY[code], x = 14 + i * (cw + gap), yy = top + 4, im = (X.fimgs || {})[code];
        if (im) { const P = D.pen(); P.save(); P.begin().roundRect(x, yy, cw, ph, [2, 2, 2, 2]).clip(); const sc = Math.max(cw / im.w, ph / im.h); D.doc.addImage(im.data, im.fmt || "JPEG", x + (cw - im.w * sc) / 2, yy + (ph - im.h * sc) / 2, im.w * sc, im.h * sc, undefined, "FAST"); P.restore(); }
        else { rect(D, x, yy, cw, ph, C.cream); if (pp.dims) { const s2 = Math.min((cw - 4) / pp.dims.l, (ph - 4) / pp.dims.w); const P = D.pen(); P.translate(x + cw / 2, yy + ph / 2).scale(s2); DPSymbols.drawProduct(P, pp, { lod: s2 * 6, mode: "presentation" }); } }
        const P = D.pen(); P.begin().circle(x + cw - 4.5, yy + ph - 4.5, 3.4).fill(C.ink); txt(D, `×${X.counts[code]}`, x + cw - 4.5, yy + ph - 3.5, { size: 6.5, font: "sansBold", color: C.white, align: "center" });
        txt(D, pp.displayCode || pp.code, x, yy + ph + 5, { size: 6.5, font: "sansBold", color: C.limeInk });
        para(D, pp.name, x, yy + ph + 9.5, cw, { size: 8.5, font: "serif", maxLines: 2 }); });
    }
    // right facts card
    const cx = 178, cw = D.W - 14 - cx; rect(D, cx, 28, cw, D.H - 48, C.stone);
    eyebrow(D, "Site facts", cx + 8, 38);
    const facts = [["Client", p.meta.client], ["Location", p.meta.location], ["Site extent", m.bbox ? `${f2(m.bbox.w)} × ${f2(m.bbox.h)} m` : "—"], ["Total site area", m.siteArea ? m2(m.siteArea) : "—"],
      ["Planned play area", m.allocated != null ? m2(m.allocated) : "—"], ["Equipment footprint", m2(m.footArea)], ["Safety surfacing", m.flooring ? m2(m.flooring) : "—"],
      ["Fence (net)", m.lengths.fence ? `${f2(m.lengths.fence.net)} m` : "—"]].filter(([, v]) => v);
    let fy = 48; for (const [k, v] of facts) { txt(D, k, cx + 8, fy, { size: 8, color: C.pebble }); txt(D, v, cx + cw - 8, fy, { size: 9.5, font: "sansBold", align: "right" }); hline(D, cx + 8, cx + cw - 8, fy + 3, "#D3D0C6", 0.15); fy += 10; }
    // big number
    txt(D, m.siteArea ? Math.round(m.siteArea).toLocaleString("en-US") : String(m.products), cx + 8, D.H - 32, { size: 30, font: "serif" });
    txt(D, m.siteArea ? "square metres planned to scale" : "products planned", cx + 8, D.H - 25, { size: 8.5, color: C.graphite });
  }
  function pagePlan(D, X, n) {
    const { p, lg, counts } = X; frame(D, X, "Master site plan", n);
    heading(D, "Master site plan", 14, 31, 18, "site");
    const box = { x: 14, y: 36, w: 206, h: D.H - 36 - 16 };
    rect(D, box.x, box.y, box.w, box.h, C.white, C.line, 0.2);
    const pl = drawPlan(D, X, box, { mode: "presentation", dims: true, labels: true, zones: true, ts: 0.21, standard: true });
    // legend
    const lx = 228, lw = D.W - 14 - lx; let y = 40;
    eyebrow(D, "Equipment", lx, y); y += 6;
    for (const code of lg.codes) { const pp = DPCat.BY[code]; if (!pp) continue; const P = D.pen(); P.begin().circle(lx + 2.4, y - 1.2, 2.4).fill(C.ink); txt(D, String(lg.map[code]), lx + 2.4, y - 0.1, { size: 6.5, font: "sansBold", color: C.white, align: "center" });
      txt(D, `${pp.displayCode || pp.code}  ×${counts[code]}`, lx + 7, y - 1.6, { size: 6.8, font: "sansBold" }); y = para(D, pp.name, lx + 7, y + 1.4, lw - 7, { size: 6.8, color: C.graphite, maxLines: 1 }) + 1.6; if (y > D.H - 70) { txt(D, "…", lx, y, { size: 7 }); break; } }
    y += 2; eyebrow(D, "Site", lx, y); y += 5;
    const used = new Set(p.objects.filter((o) => o.kind !== "product" && !o.hidden).map((o) => o.type));
    const P = D.pen();
    const sw = (label, draw) => { if (y > D.H - 40) return; draw(lx, y - 3); txt(D, label, lx + 8, y - 0.6, { size: 6.8, color: C.graphite }); y += 5.2; };
    sw("Safety zone (published, centred)", (x, yy) => P.begin().rect(x, yy, 6, 3.4).paint({ fill: C.lime, fillAlpha: 0.15, stroke: C.limeInk, px: 0.2, dashPx: [0.8, 0.5] }));
    for (const t of used) { const el = DPCat.EL[t]; if (!el || el.annotation) continue;
      if (el.kind === "area") sw(el.name, (x, yy) => { const st = DPSymbols.AREA_STYLE[el.sym] || {}; P.begin().rect(x, yy, 6, 3.4).paint({ fill: st.fill || C.stone, fillAlpha: st.fillAlpha == null ? 1 : Math.max(0.2, st.fillAlpha), stroke: st.edge || C.pebble, px: 0.2 }); });
      else if (el.kind === "line") sw(el.name, (x, yy) => { const Q = D.pen(); Q.setMatrix([1, 0, 0, 1, 0, 0]); DPSymbols.drawLine(Q, el, [[x, yy + 1.7], [x + 6, yy + 1.7]], { width: Math.min(el.width, 1.2), pdf: true }); });
      else sw(el.name, (x, yy) => { const Q = D.pen(); Q.translate(x + 3, yy + 1.7); const s = 3.4 / Math.max(el.l || el.d || 1, el.w || el.d || 1); Q.scale(s); DPSymbols.drawPointElement(Q, el, el.l || el.d, el.w || el.d, { lod: 40 }); }); }
    if (pl) { const sb = scaleBar(D, lx, D.H - 32, pl.s, lw - 6); txt(D, `Scale 1:${Math.round(1000 / pl.s)} on A4 landscape`, lx, D.H - 23, { size: 6.5, color: C.pebble }); northArrow(D, lx + lw - 6, D.H - 52, (p.site && p.site.north) || 0); }
    para(D, "Safety zones are drawn from the manufacturer's published figures, centred on the equipment; confirm on site against the manufacturer's layout.", 14, D.H - 13.8, 206, { size: 6, color: C.pebble, maxLines: 1 });
  }
  async function pagesSchedule(D, X, startN) {
    const codes = Object.keys(X.counts).sort(); if (!codes.length) return 0;
    const per = 6, pages = Math.ceil(codes.length / per); const imgs = {};
    await Promise.all(codes.map(async (c) => { const pp = DPCat.BY[c]; if (pp) imgs[c] = await productPhoto(c, pp.thumb); }));
    for (let pg = 0; pg < pages; pg++) {
      if (pg) D.doc.addPage(); frame(D, X, "Product schedule", startN);
      heading(D, pg ? "Product schedule, continued" : "Product schedule", 14, 31, 18, pg ? null : "schedule");
      const cw = (D.W - 28 - 2 * 8) / 3, ch = 74;
      codes.slice(pg * per, pg * per + per).forEach((code, i) => {
        const pp = DPCat.BY[code]; if (!pp) return; const x = 14 + (i % 3) * (cw + 8), y = 38 + Math.floor(i / 3) * (ch + 8);
        rect(D, x, y, cw, ch, C.white, C.line, 0.2);
        const iw = 46, ih = 34; const im = imgs[code];
        if (im) { const P = D.pen(); P.save(); P.begin().roundRect(x + 3, y + 3, iw, ih, [0, 0, 0, 5]).clip(); const sc = Math.max(iw / im.w, ih / im.h); D.doc.addImage(im.data, "JPEG", x + 3 + (iw - im.w * sc) / 2, y + 3 + (ih - im.h * sc) / 2, im.w * sc, im.h * sc, undefined, "FAST"); P.restore(); }
        else { rect(D, x + 3, y + 3, iw, ih, C.stone); txt(D, "Photograph to follow", x + 3 + iw / 2, y + 3 + ih / 2 + 1, { size: 6.5, color: C.pebble, align: "center" }); }
        // top view
        const tvx = x + 3 + iw + 3, tvw = cw - iw - 9; rect(D, tvx, y + 3, tvw, ih, C.cream);
        if (pp.dims) { const s = Math.min((tvw - 4) / pp.dims.l, (ih - 4) / pp.dims.w); const P = D.pen(); P.translate(tvx + tvw / 2, y + 3 + ih / 2).scale(s); DPSymbols.drawProduct(P, pp, { lod: s * 6, mode: "presentation" }); }
        txt(D, "Top view", tvx + 1.6, y + ih + 1.2, { size: 5.5, color: C.pebble });
        const P = D.pen(); P.begin().circle(x + cw - 7, y + ih + 9, 4.2).fill(C.ink); txt(D, `×${X.counts[code]}`, x + cw - 7, y + ih + 10.2, { size: 7.5, font: "sansBold", color: C.white, align: "center" });
        txt(D, pp.displayCode || pp.code, x + 3, y + ih + 8.2, { size: 7, font: "sansBold", color: C.limeInk });
        para(D, pp.name, x + 3, y + ih + 13.5, cw - 18, { size: 10, font: "serif", maxLines: 1 });
        const spec = [pp.dims ? `${f2(pp.dims.l)} × ${f2(pp.dims.w)}${pp.dims.h ? " × " + f2(pp.dims.h) : ""} m` : null, pp.age, pp.zone && pp.zone.kind === "rect" ? `Safety zone ${pp.zone.text}` : null].filter(Boolean).join("  ·  ");
        txt(D, spec, x + 3, y + ih + 19, { size: 6.6, color: C.graphite, maxW: cw - 6 });
        para(D, pp.description || "", x + 3, y + ih + 24.5, cw - 6, { size: 6.6, color: C.graphite, lh: 1.35, maxLines: 3 });
      });
    }
    return pages;
  }
  function tableRows(D, cols, rows, x, y, o = {}) {
    // cols: [{label, w, align}] rows: [{cells:[], bold, fill, size}]
    const size = o.size || 7.6, rh = o.rh || 6.2; let yy = y;
    if (cols.some((c) => c.label)) { let cx = x; for (const c of cols) { eyebrow(D, c.label, c.align === "right" ? cx + c.w - 1.5 : cx + 1.5, yy, C.pebble, c.align || "left"); cx += c.w; } hline(D, x, x + cols.reduce((a, c) => a + c.w, 0), yy + 2.2, C.ink, 0.35); yy += 7; }
    for (const r of rows) {
      if (r.fill) rect(D, x, yy - rh + 1.9, cols.reduce((a, c) => a + c.w, 0), rh, r.fill);
      let cx = x; r.cells.forEach((v, i) => { const c = cols[i]; txt(D, v == null ? "" : String(v), c.align === "right" ? cx + c.w - 1.5 : cx + 1.5, yy, { size: r.size || size, font: r.bold || c.bold ? "sansBold" : "sans", align: c.align || "left", color: r.color || c.color || C.ink, maxW: c.w - 3 }); cx += c.w; });
      if (!r.fill && !r.noLine) hline(D, x, x + cols.reduce((a, c) => a + c.w, 0), yy + 2.1, C.line, 0.15);
      yy += rh;
    }
    return yy;
  }
  function pageTechnical(D, X, n) {
    const { m, counts, p } = X; frame(D, X, "Technical & area summary", n);
    heading(D, "Technical & area summary", 14, 31, 18, "area");
    const rows = [["Total site area", m.siteArea ? m2(m.siteArea) : "—"], ["Site perimeter", m.perimeter ? `${f2(m.perimeter)} m` : "—"], ["Equipment footprint (physical)", m2(m.footArea)],
      ["Safety zones drawn (sum)", m2(m.zoneArea)], ["Total allocated area (footprint + zones, overlaps counted once)", m.allocated != null ? m2(m.allocated) : "—"], ["Available usable area", m.usable != null ? m2(m.usable) : "—"], ["Number of products", `${m.products}`]];
    for (const [k, a] of Object.entries(m.surfaces)) if (DPCat.EL[k] && !DPCat.EL[k].annotation) rows.push([DPCat.EL[k].name, m2(a)]);
    for (const [k, L] of Object.entries(m.lengths)) if (DPCat.EL[k] && !DPCat.EL[k].annotation) rows.push([`${DPCat.EL[k].name}${L.net !== L.gross ? " (net of gates)" : ""}`, `${f2(L.net)} m`]);
    for (const [k, c] of Object.entries(m.counts)) { const el = DPCat.EL[k]; if (el && !el.annotation && el.id !== "label") rows.push([el.name, `${c}`]); }
    eyebrow(D, "Areas and quantities", 14, 42);
    tableRows(D, [{ label: "", w: 80 }, { label: "", w: 32, align: "right", bold: true }], rows.slice(0, 22).map((r) => ({ cells: r })), 14, 50, { rh: 6.1 });
    // product technical table
    const tx = 138; eyebrow(D, "Equipment data (manufacturer's published figures)", tx, 42);
    const prow = Object.keys(counts).sort().map((code) => { const pp = DPCat.BY[code]; if (!pp) return null; const placed = p.objects.find((o) => o.kind === "product" && o.code === code); const entered = placed && placed.zoneEntered && placed.zoneEntered.l > 0;
      return { cells: [pp.displayCode || pp.code, pp.name, counts[code], pp.dims ? `${f2(pp.dims.l)} × ${f2(pp.dims.w)}` : "—", pp.dims && pp.dims.h ? f2(pp.dims.h) : "—", entered ? `${f2(placed.zoneEntered.l)} × ${f2(placed.zoneEntered.w)} (site layout)` : pp.zone && pp.zone.kind === "rect" ? pp.zone.text : "Per site layout"] }; }).filter(Boolean);
    tableRows(D, [{ label: "Code", w: 20, bold: true }, { label: "Product", w: 52 }, { label: "Qty", w: 10, align: "right" }, { label: "L × W (m)", w: 22, align: "right" }, { label: "H (m)", w: 12, align: "right" }, { label: "Safety zone (m)", w: 29 }], prow.slice(0, 20), tx, 50, { size: 6.9, rh: 6 });
    para(D, M.DISCLAIMER, 14, D.H - 26, D.W - 28, { size: 6.6, color: C.pebble, lh: 1.35 });
    const flags = Object.keys(counts).flatMap((c) => ((DPCat.BY[c] || {}).flags || []).filter((f) => f.sev !== "info").map((f) => `${c}: ${f.text}`));
    if (flags.length) para(D, "Data to confirm with the manufacturer: " + flags.slice(0, 4).join(" · "), 14, D.H - 18.5, D.W - 28, { size: 6.4, color: C.graphite, maxLines: 2 });
  }
  /** Client view of quotation lines: derived installation/delivery lines are combined per category. */
  function clientLines(r) {
    const out = [], derived = {};
    for (const l of r.lines) {
      if (l.status === "exception" && l.exMode === "excluded") continue;
      if (l.derived) { const k = l.cat + l.name.split(" — ")[0]; const d = derived[k] || (derived[k] = { name: l.name.split(" — ")[0] + " of equipment", cat: l.cat, qty: 0, totalMinor: 0, n: 0, unit: "lot", counted: true }); d.totalMinor += l.totalMinor; d.n += 1; continue; }
      out.push(l);
    }
    for (const d of Object.values(derived)) out.push(Object.assign(d, { qty: 1, unitMinor: d.totalMinor, name: `${d.name} (${d.n} item type${d.n > 1 ? "s" : ""})` }));
    return out;
  }
  function pagesQuotation(D, X, n, { standalone = false } = {}) {
    const { r } = X, cur = r.currency; if (!r.lines.length) return 0;
    const lines = clientLines(r); const byCat = {}; lines.forEach((l) => (byCat[l.cat] = byCat[l.cat] || []).push(l));
    const rows = []; let i = 0;
    for (const c of PR.CAT_ORDER) { if (!byCat[c]) continue; rows.push({ cat: c }); for (const l of byCat[c]) rows.push({ l, i: ++i }); rows.push({ sub: c }); }
    const cols = [{ label: "#", w: 9 }, { label: "Code", w: 22 }, { label: "Description", w: 108 }, { label: "Qty", w: 20, align: "right" }, { label: "Unit", w: 14 }, { label: `Unit price (${cur})`, w: 42, align: "right" }, { label: `Total (${cur})`, w: 54, align: "right" }];
    const tw = cols.reduce((a, c) => a + c.w, 0), x0 = 14;
    let pages = 0, y = 0;
    const startPage = (cont) => { if (pages) D.doc.addPage(); pages++; frame(D, X, "Commercial quotation", n); heading(D, cont ? "Commercial quotation, continued" : "Commercial quotation", 14, 31, 18, cont ? null : "quotation");
      if (X.sample) txt(D, "Illustrative prices for demonstration only", D.W - 14, 31, { size: 8, font: "sansBold", color: C.red, align: "right" });
      else txt(D, `All prices in ${cur}${r.taxPct ? `, ${r.taxLabel} shown separately` : ""}`, D.W - 14, 31, { size: 8, color: C.pebble, align: "right" });
      y = tableRows(D, cols, [], x0, 41); };
    startPage(false);
    const limit = D.H - 22;
    for (const row of rows) {
      if (y > limit - 8) startPage(true);
      if (row.cat) { rect(D, x0, y - 4.3, tw, 6.4, C.stone); txt(D, PR.CAT_LABEL[row.cat].toUpperCase(), x0 + 1.5, y, { size: 7, font: "sansBold", charSpace: 0.35 }); y += 6.8; continue; }
      if (row.sub) { txt(D, `Subtotal ${PR.CAT_LABEL[row.sub].toLowerCase()}`, x0 + tw - 56, y, { size: 7.6, color: C.graphite, align: "right" }); txt(D, PR.fmtMoney(r.cats[row.sub].totalMinor, cur, { symbol: false }), x0 + tw - 1.5, y, { size: 7.8, font: "sansBold", align: "right" }); y += 8.5; continue; }
      const l = row.l; const exl = l.status === "exception";
      const cells = [String(row.i), l.code || "", l.name + (l.basis ? `  ·  ${l.basis}` : ""), l.kind === "derived" || l.unit === "lot" ? "1" : PR.fmtQty(l.qty, l.unit), PR.UNIT_LABEL[l.unit] || l.unit,
        exl ? "" : l.unitMinor == null ? "—" : PR.fmtMoney(l.unitMinor, cur, { symbol: false }), exl ? (l.exMode === "included" ? "Included" : "Priced separately") : l.counted ? PR.fmtMoney(l.totalMinor, cur, { symbol: false }) : "Not priced"];
      y = tableRows(D, cols.map((c, k) => Object.assign({}, c, { label: "", color: k === 1 ? C.limeInk : undefined, bold: k === 1 })), [{ cells }], x0, y);
    }
    // totals box
    if (y > limit - 50) startPage(true);
    const bx = x0 + tw - 110, bw = 110; let by = y + 4;
    const line = (k, v, o = {}) => { txt(D, k, bx + 4, by, { size: o.size || 8.5, color: o.color || C.graphite, font: o.font || "sans" }); txt(D, v, bx + bw - 4, by, { size: o.size || 8.5, align: "right", font: o.vfont || "sansBold", color: o.color || C.ink }); by += o.step || 6.4; };
    line("Subtotal before discount", PR.fmtMoney(r.subtotal, cur, { symbol: false }));
    if (r.discount) line(`Discount ${r.discountPct}%`, "- " + PR.fmtMoney(r.discount, cur, { symbol: false }), { color: C.limeInk });
    line("Subtotal after discount", PR.fmtMoney(r.afterDiscount, cur, { symbol: false }));
    if (r.taxPct) line(`${r.taxLabel} ${r.taxPct}%`, PR.fmtMoney(r.tax, cur, { symbol: false }));
    rect(D, bx, by - 3.2, bw, 13, C.ink); txt(D, "Total", bx + 4, by + 5.2, { size: 10, font: "sansBold", color: C.white }); txt(D, PR.fmtMoney(r.total, cur), bx + bw - 4, by + 5.6, { size: 15, font: "serif", color: C.lime, align: "right" });
    const exc = r.lines.filter((l) => l.status === "exception" && l.exMode === "excluded");
    let ny = y + 6; if (exc.length) { eyebrow(D, "Not included in this quotation", x0, ny); ny = para(D, exc.map((l) => l.name).join(" · "), x0, ny + 5, tw - 125, { size: 7.5, color: C.graphite }); }
    if (!r.taxPct) para(D, "Tax: not included. Applicable taxes will be added where required.", x0, Math.max(ny + 4, by - 2), tw - 125, { size: 7, color: C.pebble });
    void standalone; return pages;
  }
  function pageNotes(D, X, n) {
    const { p, company } = X; frame(D, X, "Notes & next steps", n);
    heading(D, "Notes & next steps", 14, 31, 18, "next steps");
    const pr = p.proposal; const TBC = "To be confirmed by Dupedia.";
    const left = [["Scope of work", pr.scope], ["Assumptions", pr.assumptions], ["Exclusions", pr.exclusions], ["Installation", pr.installation]].filter(([, v]) => v && v.trim());
    const right = [["Payment terms", pr.payment], ["Delivery", pr.delivery], ["Proposal validity", pr.validity], ["Warranty", pr.warranty]];
    let y = 42; const lw = 132;
    for (const [k, v] of left) { if (y > D.H - 30) break; eyebrow(D, k, 14, y); y = para(D, v.replace(/\[to be completed[^\]]*\]/gi, TBC), 14, y + 5, lw, { size: 8.4, lh: 1.42, color: C.graphite, maxLines: 9 }) + 5; }
    let ry = 42; const rx = 156, rw = D.W - 14 - rx;
    for (const [k, v] of right) { eyebrow(D, k, rx, ry); const val = v && v.trim() && !/^\[to be completed/i.test(v.trim()) ? v : TBC; ry = para(D, val, rx, ry + 5, rw, { size: 8.4, lh: 1.42, color: val === TBC ? C.pebble : C.graphite, maxLines: 5 }) + 5; }
    // acceptance
    const ay = Math.max(ry + 4, D.H - 66); rect(D, rx, ay, rw, D.H - 18 - ay, C.stone);
    eyebrow(D, "Acceptance", rx + 6, ay + 8);
    para(D, pr.acceptance && pr.acceptance.trim() ? pr.acceptance : `Signed acceptance of this proposal (${p.meta.ref || "reference"}) confirms the scope, layout and price above.`, rx + 6, ay + 13.5, rw - 12, { size: 7.6, color: C.graphite, maxLines: 3 });
    const sy = D.H - 32, half = (rw - 18) / 2;
    for (const [i, who] of [[0, `For ${p.meta.client || "the client"}`], [1, `For ${company.name || "Dupedia"}`]]) { const x = rx + 6 + i * (half + 6); hline(D, x, x + half, sy, C.ink, 0.3); txt(D, who, x, sy + 4, { size: 7, font: "sansBold" }); txt(D, "Name, signature and date", x, sy + 8, { size: 6.5, color: C.pebble }); }
    const comp = [company.name, company.address, company.phone, company.email, company.web, company.reg && `CR ${company.reg}`, company.taxNo && `Tax no. ${company.taxNo}`].filter(Boolean);
    if (comp.length > 1) para(D, comp.join("  ·  "), 14, D.H - 18, lw, { size: 7, color: C.pebble, maxLines: 2 });
  }

  /* ---------------- builders ---------------- */
  async function ensureLib(progress) {
    progress && progress("Loading the PDF engine");
    try { await DPIO.lib("jspdf"); } catch (e) { throw new Error("The PDF engine (vendor/jspdf.umd.min.js) could not be loaded. Check the connection and try again."); }
    if (!root.jspdf || !root.jspdf.jsPDF) throw new Error("The PDF engine did not start.");
    await loadAssets(progress);
  }
  /** Required information before a client document is built. Returns {errors:[], warnings:[]}. */
  function precheck(kind = "proposal") {
    const p = S.project, m = p.meta, errors = [], warnings = [];
    if (!m.name || !m.name.trim()) errors.push("Project name is missing (Project details).");
    if (kind !== "technical" && (!m.client || !m.client.trim())) errors.push("Client name is missing (Project details).");
    if (!p.objects.length && !(p.site && p.site.poly)) errors.push("The plan is empty: define the site or place items first.");
    if (kind === "technical" && !DPIO.extent(p)) errors.push("Nothing to draw yet.");
    for (const o of p.objects) if (o.kind === "product" && !DPCat.BY[o.code]) warnings.push(`${o.code} is no longer in the catalogue and is left out of the schedule.`);
    if (!m.date) warnings.push("No proposal date set; today's date is used.");
    return { errors, warnings };
  }
  /** A built PDF must start with %PDF-, end with %%EOF and have pages; otherwise it is never offered for download. */
  async function validatePdf(out, minPages = 1) {
    const b = out.blob; if (!b || !(b.size > 1500)) throw new Error("The generated PDF is empty.");
    const head = new Uint8Array(await b.slice(0, 5).arrayBuffer()), tail = new Uint8Array(await b.slice(Math.max(0, b.size - 1024)).arrayBuffer());
    const h = String.fromCharCode(...head), t = String.fromCharCode(...tail);
    if (h !== "%PDF-" || !t.includes("%%EOF")) throw new Error("The generated PDF is incomplete (missing header or end marker).");
    if (out.pages != null && out.pages < minPages) throw new Error("The generated PDF has no pages.");
    out.validated = { bytes: b.size, pages: out.pages }; return out;
  }
  function fileName(kind) { return `${DPIO.slug()}_${kind}_${DPIO.stamp()}.pdf`; }
  async function proposal(opts = {}) {
    const progress = opts.progress || null, chk = precheck("proposal");
    if (chk.errors.length) throw Object.assign(new Error(chk.errors.join(" ")), { code: "precheck", list: chk.errors });
    await ensureLib(progress); const X = context(), D = newDoc("a4"); let n = 1;
    progress && progress("Building the cover");
    await pageCover(D, X);
    const sec = Object.assign({ overview: true, plan: true, schedule: true, technical: true, quotation: true, notes: true }, opts.sections || {});
    if (sec.overview) { // 1.3: featured equipment on the overview page (photographs, never stretched)
      X.featured = Object.keys(X.counts).sort((a, b) => X.counts[b] - X.counts[a]).slice(0, 4); X.fimgs = {};
      await Promise.all(X.featured.map(async (c) => { const pp = DPCat.BY[c]; if (pp) X.fimgs[c] = await productPhoto(c, pp.thumb).catch(() => null); }));
      D.doc.addPage(); pageOverview(D, X, ++n); }
    if (sec.plan && DPIO.extent(X.p)) { D.doc.addPage(); pagePlan(D, X, ++n); }
    progress && progress("Drawing the plan and overview");
    if (sec.schedule && Object.keys(X.counts).length) { progress && progress("Adding product photographs"); D.doc.addPage(); await pagesSchedule(D, X, ++n); }
    if (sec.technical && (X.p.site || Object.keys(X.counts).length)) { D.doc.addPage(); pageTechnical(D, X, ++n); }
    if (sec.quotation && X.r.lines.length) { D.doc.addPage(); pagesQuotation(D, X, ++n); }
    if (sec.notes) { D.doc.addPage(); pageNotes(D, X, ++n); }
    pageNumbers(D);
    D.doc.setProperties({ title: `${X.p.meta.name} — Dupedia proposal`, subject: `Proposal ${X.p.meta.ref || ""}`, author: X.p.meta.preparedBy || "Dupedia", creator: "Dupedia X FORCE 1.3" });
    progress && progress("Checking the document");
    return validatePdf({ blob: D.doc.output("blob"), filename: fileName("proposal"), pages: D.doc.getNumberOfPages(), warnings: chk.warnings, total: X.r.total, currency: X.r.currency }, 2);
  }
  function pageNumbers(D, skipFirst = true) { const N = D.doc.getNumberOfPages(); for (let i = skipFirst ? 2 : 1; i <= N; i++) { D.doc.setPage(i); txt(D, `${i} / ${N}`, D.W - 14, D.H - 7, { size: 7.5, color: C.pebble, align: "right" }); } }
  async function quotation(opts = {}) {
    const chk = precheck("quotation"); if (chk.errors.length) throw Object.assign(new Error(chk.errors.join(" ")), { code: "precheck" });
    await ensureLib(opts.progress); const X = context(); if (!X.r.lines.length) throw new Error("Nothing to quote yet.");
    const D = newDoc("a4");
    // compact title block instead of a cover
    pagesQuotation(D, X, 1, { standalone: true });
    D.doc.setPage(1); rect(D, 160, 20, 0.01, 0.01, C.white);
    pageNumbers(D, false); D.doc.setProperties({ title: `${X.p.meta.name} — quotation`, creator: "Dupedia X FORCE 1.3" });
    return validatePdf({ blob: D.doc.output("blob"), filename: fileName("quotation"), pages: D.doc.getNumberOfPages() });
  }
  /** A3 technical drawing: design mode with dimensions, labels and zones, title block, standard scale where possible. */
  async function technical(opts = {}) {
    const chk = precheck("technical"); if (chk.errors.length) throw Object.assign(new Error(chk.errors.join(" ")), { code: "precheck" });
    await ensureLib(opts.progress); const X = context(), ext = DPIO.extent(X.p); if (!ext) throw new Error("Nothing to draw yet.");
    const D = newDoc("a3"), W = D.W, H = D.H, tbW = 92;
    const box = { x: 14, y: 14, w: W - 28 - tbW - 6, h: H - 28 };
    const SC = [20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000]; const need = Math.max(ext.w * 1000 / (box.w - 8), ext.h * 1000 / (box.h - 8)); const den = SC.find((d) => d >= need) || Math.ceil(need / 100) * 100;
    const s = 1000 / den; const ox = box.x + box.w / 2 - (ext.x0 + ext.w / 2) * s, oy = box.y + box.h / 2 - (ext.y0 + ext.h / 2) * s;
    rect(D, box.x, box.y, box.w, box.h, C.white, C.ink, 0.35);
    const P = D.pen(); P.save(); P.begin().rect(box.x, box.y, box.w, box.h).clip(); P.setMatrix([s, 0, 0, s, ox, oy]);
    DPPlan.draw(P, { project: X.p, mode: "design", show: { grid: false, labels: true, dims: true, zones: true, cad: !!S.cadData, ref: false }, cadData: S.cadData, pdf: true, ts: 0.25 }); P.restore();
    // title block
    const tx = W - 14 - tbW; rect(D, tx, 14, tbW, H - 28, C.white, C.ink, 0.35);
    drawLogo(D, logoC, tx + 6, 20, 16);
    let y = 48; const kv = [["Project", X.p.meta.name], ["Client", X.p.meta.client], ["Location", X.p.meta.location], ["Reference", X.p.meta.ref], ["Drawing", "Site layout — technical"], ["Scale", `1:${den} at A3${SC.includes(den) ? "" : " (non-standard)"}`], ["Units", "metres"], ["Date", fmtDate(X.date)], ["Prepared by", X.p.meta.preparedBy], ["Scale basis", DPIO.scaleSourceText()]];
    for (const [k, v] of kv) { if (!v) continue; eyebrow(D, k, tx + 6, y); y = para(D, v, tx + 6, y + 4.6, tbW - 12, { size: 8.6, maxLines: 3 }) + 3; }
    scaleBar(D, tx + 6, y + 4, s, tbW - 20); northArrow(D, tx + tbW - 12, y + 24, (X.p.site && X.p.site.north) || 0);
    para(D, M.DISCLAIMER, tx + 6, H - 54, tbW - 12, { size: 6.4, color: C.pebble, lh: 1.35 });
    if (!DPIO.scaleVerified()) txt(D, "SCALE NOT VERIFIED", tx + 6, H - 20, { size: 9, font: "sansBold", color: C.red });
    D.doc.setProperties({ title: `${X.p.meta.name} — technical drawing`, creator: "Dupedia X FORCE 1.3" });
    return validatePdf({ blob: D.doc.output("blob"), filename: fileName("technical-drawing-A3"), pages: D.doc.getNumberOfPages() });
  }

  root.DPProposal = { proposal, quotation, technical, ensureLib, clientLines, safe, precheck, validatePdf, loadScript, portraitDoc, brandLogo };
})(typeof self !== "undefined" ? self : this);
