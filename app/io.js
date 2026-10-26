/* Dupedia Site Planner 2.0 — imports (DXF, DWG detection, PDF, images, project files) and exports (PNG, CSV, DXF, JSON).
   The import pipeline is carried over from the v1 planner (validated, worker-based DXF parsing, unit detection, calibration). */
/* global DPGeom, DPModel, DPCanvas, DPDxf, DPCat, DPPlan, DPPen, DPPricing */
(function (root) {
  "use strict";
  const G = DPGeom, M = DPModel, S = M.S;
  const LIBS = { pdfjs: ["vendor/pdf.min.js"], pdfjsWorker: ["vendor/pdf.worker.min.js"], jspdf: ["vendor/jspdf.umd.min.js"], jszip: ["vendor/jszip.min.js"], dxf: ["vendor/dxf-parser.js", "app/dxf-core.js"] };
  const LIMITS = { dxf: 30e6, dwg: 30e6, pdf: 30e6, image: 15e6, json: 40e6 };
  const loaded = {};
  function script(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.async = false; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src.split("/").pop() + ".")); document.head.appendChild(s); }); }
  function lib(name) { if (!loaded[name]) loaded[name] = LIBS[name].reduce((p, src) => p.then(() => script(src)), Promise.resolve()).catch((e) => { delete loaded[name]; throw e; }); return loaded[name]; }

  /* ---------------- validation ---------------- */
  const EXT = { dxf: "dxf", dwg: "dwg", pdf: "pdf", png: "image", jpg: "image", jpeg: "image", json: "json" };
  class ImportError extends Error { constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); } }
  const DWG_VERSIONS = { AC1012: "R13", AC1014: "R14", AC1015: "AutoCAD 2000–2002", AC1018: "AutoCAD 2004–2006", AC1021: "AutoCAD 2007–2009", AC1024: "AutoCAD 2010–2012", AC1027: "AutoCAD 2013–2017", AC1032: "AutoCAD 2018–2025" };
  async function sniff(file) {
    const head = new Uint8Array(await file.slice(0, 32).arrayBuffer()), ascii = String.fromCharCode(...head);
    if (ascii.startsWith("%PDF-")) return "pdf"; if (head[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "png"; if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return "jpg";
    if (/^AC10\d\d/.test(ascii)) return "dwg"; if (ascii.startsWith("AutoCAD Binary DXF")) return "dxf-binary"; if (/^\s*\{/.test(ascii)) return "json";
    if (/^\s*0\s*[\r\n]+\s*SECTION/.test(ascii) || /^\s*999/.test(ascii)) return "dxf"; return "unknown";
  }
  async function validateFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase(), kind = EXT[ext];
    if (!kind) throw new ImportError(`".${ext}" files are not supported. Use DXF, PDF, PNG, JPG or a Site Planner project (.json).`, { code: "type" });
    if (!file.size) throw new ImportError("The file is empty.", { code: "empty" });
    if (file.size > LIMITS[kind]) throw new ImportError(`The file is ${(file.size / 1e6).toFixed(1)} MB; the limit for this type is ${LIMITS[kind] / 1e6} MB.`, { code: "size" });
    const sn = await sniff(file), ok = { dxf: ["dxf", "dxf-binary", "unknown"], dwg: ["dwg"], pdf: ["pdf"], image: ext === "png" ? ["png"] : ["jpg"], json: ["json"] }[kind];
    if (!ok.includes(sn)) throw new ImportError(`The file's content does not match its ".${ext}" extension. It may be corrupted or renamed.`, { code: "mismatch" });
    if (kind === "dxf" && sn === "dxf-binary") throw new ImportError("This is a binary DXF. Save it as ASCII DXF and upload again.", { code: "binary" });
    if (kind === "dwg") { const head = String.fromCharCode(...new Uint8Array(await file.slice(0, 6).arrayBuffer())); throw new ImportError(`This is a DWG drawing (${DWG_VERSIONS[head] || head}). DWG is proprietary and cannot be read in the browser. Export DXF from the CAD software (every CAD package can) and import that.`, { code: "dwg" }); }
    return { kind, ext };
  }
  async function readText(file) { const buf = await file.arrayBuffer(); const utf = new TextDecoder("utf-8", { fatal: false }).decode(buf); const bad = utf.split(String.fromCharCode(0xFFFD)).length - 1; return bad > 20 ? new TextDecoder("windows-1252").decode(buf) : utf; }
  function parseDxf(text, name, onProgress, signal) {
    return new Promise((resolve, reject) => {
      let w = null, settled = false;
      const handle = (m) => { if (m.type === "progress") onProgress && onProgress(m); else if (m.type === "done") { settled = true; w && w.terminate(); resolve(m); } else if (m.type === "error") { settled = true; w && w.terminate(); reject(new ImportError(m.message, { code: "parse" })); } };
      const fallback = async () => { try { await lib("dxf"); setTimeout(() => DPDxf.process(text, name, handle), 30); } catch (e) { reject(e); } };
      if (signal) signal.addEventListener("abort", () => { if (!settled) { settled = true; w && w.terminate(); reject(new ImportError("Import cancelled.", { code: "cancelled" })); } });
      try { w = new Worker("app/dxf-worker.js"); let started = false; w.onmessage = (ev) => { started = true; handle(ev.data); };
        w.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); if (!started && !settled) { w.terminate(); w = null; fallback(); } else if (!settled) { settled = true; reject(new ImportError("The drawing could not be processed.", { code: "parse" })); } };
        w.postMessage({ text, name }); } catch (e) { w = null; fallback(); }
    });
  }
  function installCad(data, fileName) {
    const u = G.unitsFactor(data.insunits); S.cadData = data; data.fileName = fileName;
    S.project.cad = { fileName, scale: u ? u.factor : 1, scaleSource: u ? "header" : "unverified", unitName: u ? u.name : null, insunits: data.insunits, offset: [0, 0], hidden: {} };
    data.layers.forEach((L, i) => { if (!L.visible) S.project.cad.hidden[i] = true; });
    recenterCad(); return { units: u, verified: !!u };
  }
  function recenterCad() { const b = S.cadData.bbox, sc = S.project.cad.scale; S.project.cad.offset = [-b.x0 * sc, -b.y0 * sc]; }
  /** Change drawing scale; everything traced from the drawing scales with it. */
  function setScale(target, newScale, source) {
    let f;
    if (target === "cad") { f = newScale / S.project.cad.scale; S.project.cad.scale = newScale; S.project.cad.scaleSource = source; if (source !== "header") S.project.cad.unitName = null; recenterCad(); }
    else { f = newScale / S.project.ref.mpp; S.project.ref.mpp = newScale; S.project.ref.scaleSource = source; S.project.ref.offset = [S.project.ref.offset[0] * f, S.project.ref.offset[1] * f]; }
    const traced = (src) => src === "cad" || src === "cad-edited" || src === "trace";
    if (S.project.site && traced(S.project.site.source)) S.project.site.poly = S.project.site.poly.map(([x, y]) => [x * f, y * f]);
    for (const o of S.project.objects) if (o.traced) { if (o.poly) o.poly = o.poly.map(([x, y]) => [x * f, y * f]); if (o.pts) o.pts = o.pts.map(([x, y]) => [x * f, y * f]); }
    return { factor: f };
  }
  async function pdfOpen(file) {
    const pdfjs = await pdfReader(); if (!pdfjs) throw new ImportError("The PDF reader could not start.", { code: "lib" });
    const data = new Uint8Array(await file.arrayBuffer());
    try { return await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise; }
    catch (e) { throw new ImportError(e && e.name === "PasswordException" ? "The PDF is password-protected." : "The PDF could not be read. It may be corrupted.", { code: "pdf" }); }
  }
  async function pdfRender(doc, pageNo) {
    const page = await doc.getPage(pageNo), vp1 = page.getViewport({ scale: 1 }), s = Math.min(6000 / Math.max(vp1.width, vp1.height), 300 / 72, 8);
    const vp = page.getViewport({ scale: s }), cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { dataUrl: cv.toDataURL("image/png"), w: cv.width, h: cv.height, paperMmPerPx: vp1.width * 25.4 / 72 / cv.width, pageMm: [vp1.width * 25.4 / 72, vp1.height * 25.4 / 72] };
  }
  /** pdf.js with its worker code loaded in the page (as a script), so no Worker or fetch is needed in sandboxed frames. */
  async function pdfReader() {
    await lib("pdfjs"); if (!root.pdfjsWorker) await lib("pdfjsWorker"); const pdfjs = root.pdfjsLib;
    try { pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; } catch (e) {}
    return pdfjs;
  }
  function readImage(file, maxSide = 8000) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new ImportError("The image could not be read.", { code: "image" }));
      fr.onload = () => { const img = new Image(); img.onload = () => { if (img.naturalWidth > maxSide || img.naturalHeight > maxSide) return rej(new ImportError(`The image is ${img.naturalWidth}×${img.naturalHeight} px; the limit is ${maxSide} px per side.`, { code: "size" })); res({ dataUrl: fr.result, w: img.naturalWidth, h: img.naturalHeight, img }); };
        img.onerror = () => rej(new ImportError("The image is corrupted or not a valid PNG/JPG.", { code: "image" })); img.src = fr.result; }; fr.readAsDataURL(file); });
  }
  function installRef(kind, fileName, r, extra) { S.refImage = r.dataUrl; S.project.ref = Object.assign({ kind, fileName, w: r.w, h: r.h, mpp: 40 / r.w, scaleSource: "unverified", offset: [0, 0], opacity: 0.6, paperMmPerPx: r.paperMmPerPx || null, pageMm: r.pageMm || null }, extra || {}); }
  /** Downscale an image file to a JPEG/PNG data URL (logos, cover images). */
  async function shrinkImage(file, maxSide = 1600, type = "image/jpeg", q = 0.85) {
    const r = await readImage(file, 12000); const s = Math.min(1, maxSide / Math.max(r.w, r.h)); const cv = document.createElement("canvas"); cv.width = Math.round(r.w * s); cv.height = Math.round(r.h * s);
    const ctx = cv.getContext("2d"); if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); } ctx.drawImage(r.img, 0, 0, cv.width, cv.height);
    let out = cv.toDataURL(type, q); while (out.length > 200000 && q > 0.4) { q -= 0.1; out = cv.toDataURL("image/jpeg", q); } return out;
  }

  /* ---------------- downloads ---------------- */
  async function download(blob, filename) {
    const dl = await (root.DPStore ? root.DPStore.capability("downloads") : Promise.resolve(null));
    if (dl) { await dl.save({ filename, data: blob }); return "saved"; }
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); return "browser";
  }
  const slug = () => ((S.project.meta.ref ? S.project.meta.ref + "-" : "") + (S.project.meta.name || "project")).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "project";
  const stamp = () => new Date().toISOString().slice(0, 10);
  function extent(project = S.project) {
    const pts = []; if (project.site && project.site.poly) pts.push(...project.site.poly);
    for (const o of project.objects) { if (o.hidden) continue; const s = M.shapes(o); if (s.missing) continue; pts.push(...M.outline(o).flat()); if (s.zone) pts.push(...s.zone); }
    return pts.length ? G.bbox(pts) : null;
  }
  function scaleSourceText() {
    const c = S.project.cad, r = S.project.ref, out = [];
    if (c) out.push(c.scaleSource === "header" ? `DXF units from file header (${c.unitName})` : c.scaleSource === "calibration" ? "DXF scale set by two-point calibration" : c.scaleSource === "manual" ? "DXF units chosen by user" : "DXF scale NOT VERIFIED");
    if (r) out.push(r.scaleSource === "calibration" ? `${r.kind.toUpperCase()} reference calibrated` : r.scaleSource === "paper" ? `${r.kind.toUpperCase()} reference scaled from stated drawing scale` : `${r.kind.toUpperCase()} reference scale NOT VERIFIED`);
    if (!out.length) out.push("Dimensions entered in metres"); return out.join("; ");
  }
  const scaleVerified = () => { const c = S.project.cad, r = S.project.ref; return !(c && c.scaleSource === "unverified") && !(r && r.scaleSource === "unverified"); };

  /* ---------------- PNG (high resolution, presentation style) ---------------- */
  async function exportPng(longEdge = 4000, mode = "presentation", show = {}) {
    const box = extent(); if (!box) throw new Error("Nothing to export yet.");
    const pad = longEdge * 0.04, footer = Math.round(longEdge * 0.022), aspect = Math.max(box.w, 1e-6) / Math.max(box.h, 1e-6);
    const W = aspect >= 1 ? longEdge : Math.round(longEdge * aspect + 2 * pad), H = (aspect >= 1 ? Math.round(longEdge / aspect + 2 * pad) : longEdge) + footer;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d"); ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
    const s = Math.min((W - 2 * pad) / Math.max(box.w, 1e-6), (H - footer - 2 * pad) / Math.max(box.h, 1e-6));
    const P = new DPPen({ kind: "canvas", ctx, minLine: 1 }); P.setMatrix([s, 0, 0, s, W / 2 - (box.x0 + box.w / 2) * s, (H - footer) / 2 - (box.y0 + box.h / 2) * s]);
    await document.fonts.ready;
    const ts = longEdge / 1400;
    DPPlan.draw(P, { project: S.project, cadData: S.cadData, refImg: null, mode, show: Object.assign({ grid: false, ref: false }, show), ts, view: null });
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#262626"; ctx.fillRect(0, H - footer, W, footer); ctx.fillStyle = "#fff"; ctx.font = `500 ${Math.round(footer * 0.42)}px "Instrument Sans", Arial`; ctx.textBaseline = "middle";
    ctx.fillText(`Dupedia · ${S.project.meta.name}${S.project.meta.ref ? " · " + S.project.meta.ref : ""} · ${stamp()} · metres · ${scaleVerified() ? "" : "SCALE NOT VERIFIED · "}plan check only, not a safety certification`, pad, H - footer / 2);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    return { blob, filename: `${slug()}_site-plan_${stamp()}.png`, w: W, h: H };
  }

  /* ---------------- CSV ---------------- */
  const q = (v) => { const s = String(v == null ? "" : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function exportScheduleCsv() {
    const lines = [["Code", "Product", "Collection", "Quantity", "Length (m)", "Width (m)", "Height (m)", "Published safety zone", "Zone drawn", "Data notes"].join(",")];
    const counts = {}; for (const o of S.project.objects) if (o.kind === "product") counts[o.code] = (counts[o.code] || 0) + 1;
    for (const code of Object.keys(counts).sort()) { const p = DPCat.BY[code]; if (!p) continue;
      lines.push([p.displayCode || p.code, p.name, p.collectionName, counts[code], p.dims && p.dims.l, p.dims && p.dims.w, p.dims && p.dims.h, p.zone && p.zone.text, p.zone && p.zone.kind === "rect" ? "yes (centred, verify)" : "no", (p.flags || []).map((f) => f.text).join(" | ")].map(q).join(",")); }
    const m = M.metrics(); lines.push(""); lines.push(["Site area (m2)", m.siteArea.toFixed(2)].join(",")); lines.push(["Note", "Plan check only; not a safety certification."].map(q).join(","));
    return { blob: new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), filename: `${slug()}_product-schedule_${stamp()}.csv` };
  }
  function exportQuoteCsv(r) {
    const cur = r.currency, lines = [["Category", "Code", "Description", "Quantity", "Unit", `Unit price (${cur})`, `Line total (${cur})`, "Status"].join(",")];
    for (const l of r.lines) lines.push([DPPricing.CAT_LABEL[l.cat] || l.cat, l.code || "", l.name, DPPricing.fmtQty(l.qty, l.unit), DPPricing.UNIT_LABEL[l.unit] || l.unit, l.unitMinor == null ? "" : (l.unitMinor / 100).toFixed(2), l.counted ? (l.totalMinor / 100).toFixed(2) : "", l.status === "exception" ? (l.exMode === "included" ? "Included" : l.exMode === "separate" ? "Priced separately" : "Excluded") : l.status].map(q).join(","));
    lines.push(""); for (const [k, v] of [["Subtotal", r.subtotal], [`Discount ${r.discountPct}%`, -r.discount], ["Subtotal after discount", r.afterDiscount], [`${r.taxLabel} ${r.taxPct}%`, r.tax], ["Total", r.total]]) lines.push([k, "", "", "", "", "", (v / 100).toFixed(2), ""].map(q).join(","));
    return { blob: new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), filename: `${slug()}_quotation_${stamp()}.csv` };
  }

  /* ---------------- DXF (R12 ASCII, metres) ---------------- */
  function dxfText() {
    const out = [], g = (c, v) => out.push(String(c), String(v)), num = (n) => (Math.round(n * 1e6) / 1e6).toString();
    const LAYERS = [["SITE", 7], ["EQUIPMENT", 3], ["SAFETY_ZONES", 2], ["ELEMENTS", 5], ["FENCES_WALLS", 8], ["PATHS", 9], ["SURFACES", 4], ["RESTRICTED", 1], ["EXISTING", 8], ["LABELS", 7], ["CAD_REFERENCE", 9]];
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, 6); g(9, "$MEASUREMENT"); g(70, 1); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
    g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
    g(0, "LTYPE"); g(2, "DASHED"); g(70, 0); g(3, "Dashed"); g(72, 65); g(73, 2); g(40, 0.75); g(49, 0.5); g(49, -0.25);
    g(0, "ENDTAB"); g(0, "TABLE"); g(2, "LAYER"); g(70, LAYERS.length);
    for (const [n, c] of LAYERS) { g(0, "LAYER"); g(2, n); g(70, 0); g(62, c); g(6, n === "SAFETY_ZONES" || n === "RESTRICTED" ? "DASHED" : "CONTINUOUS"); }
    g(0, "ENDTAB"); g(0, "ENDSEC"); g(0, "SECTION"); g(2, "ENTITIES");
    const pl = (layer, pts, closed) => { g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0); for (const [x, y] of pts) { g(0, "VERTEX"); g(8, layer); g(10, num(x)); g(20, num(-y)); g(30, 0); } g(0, "SEQEND"); g(8, layer); };
    const txt = (layer, x, y, h, t, rot = 0) => { g(0, "TEXT"); g(8, layer); g(10, num(x)); g(20, num(-y)); g(30, 0); g(40, num(h)); g(1, String(t).replace(/[\r\n]+/g, " ")); if (rot) g(50, num(rot)); g(72, 1); g(11, num(x)); g(21, num(-y)); g(31, 0); };
    if (S.project.site && S.project.site.poly) pl("SITE", S.project.site.poly, true);
    const { gaps } = M.gateHosts();
    for (const o of S.project.objects) { if (o.hidden) continue; const s = M.shapes(o); if (s.missing) continue;
      if (o.kind === "product") { pl("EQUIPMENT", s.foot, true); if (s.zone) pl("SAFETY_ZONES", s.zone, true); txt("LABELS", o.x, o.y, Math.max(0.15, Math.min(0.5, Math.min(s.p.dims.l, s.p.dims.w) / 5)), `${s.p.displayCode || s.p.code} ${s.p.dims.l}x${s.p.dims.w}m`, -(o.rot || 0)); }
      else if (o.kind === "point") { pl("ELEMENTS", s.foot, true); if (o.label) txt("LABELS", o.x, o.y, 0.25, o.label); }
      else if (o.kind === "line") { const layer = ["fence", "wall", "hedge"].includes(o.type) ? "FENCES_WALLS" : "PATHS"; const runs = gaps[o.id] ? DPSymbols.splitRuns(o.pts, gaps[o.id]) : [o.pts]; for (const r of runs) pl(layer, r, false); }
      else if (o.kind === "area") { const el = s.el; pl(el.noBuild ? "RESTRICTED" : el.existing ? "EXISTING" : "SURFACES", o.poly, true); if (o.label) { const c = G.centroid(o.poly); txt("LABELS", c[0], c[1], 0.3, o.label); } } }
    if (S.cadData && S.project.cad) { const { scale, offset, hidden = {} } = S.project.cad; for (const P of S.cadData.paths) { if (!P || hidden[P.l]) continue; const pts = []; for (let i = 0; i < P.p.length; i += 2) pts.push([P.p[i] * scale + offset[0], P.p[i + 1] * scale + offset[1]]); pl("CAD_REFERENCE", pts, P.c); } }
    g(0, "ENDSEC"); g(0, "EOF"); return out.join("\r\n") + "\r\n";
  }
  async function exportDxf() {
    const text = dxfText(), name = `${slug()}_technical_${stamp()}.dxf`;
    const dl = await (root.DPStore ? root.DPStore.capability("downloads") : Promise.resolve(null));
    if (!dl) return { blob: new Blob([text], { type: "application/dxf" }), filename: name };
    await lib("jszip"); const zip = new root.JSZip(); zip.file(name, text); zip.file("README.txt", "DXF R12 (ASCII), units: metres. Layers: SITE, EQUIPMENT, SAFETY_ZONES (centred, verify), ELEMENTS, FENCES_WALLS, PATHS, SURFACES, RESTRICTED, EXISTING, LABELS, CAD_REFERENCE.\r\nExported by Dupedia Site Planner 2.1. Plan check only; not a safety certification.\r\n");
    return { blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), filename: name.replace(/\.dxf$/, ".zip") };
  }
  function exportJson() { return { blob: new Blob([JSON.stringify(M.projectFile(true))], { type: "application/json" }), filename: `${slug()}_${stamp()}.dupedia-project.json` }; }

  root.DPIO = { lib, pdfReader, validateFile, ImportError, readText, parseDxf, installCad, recenterCad, setScale, pdfOpen, pdfRender, readImage, installRef, shrinkImage, download, slug, stamp, extent,
    scaleSourceText, scaleVerified, exportPng, exportScheduleCsv, exportQuoteCsv, dxfText, exportDxf, exportJson };
})(typeof self !== "undefined" ? self : this);
