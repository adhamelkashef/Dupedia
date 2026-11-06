/* Dupedia Site Planner 2.0 — site & design workspace: toolbar, library, site setup & imports, properties, layers, status, price drawer. */
/* global DPUI, DPModel, DPCanvas, DPCat, DPGeom, DPIO, DPPen, DPSymbols, DPPlan, DPPricing, DPFit, DPStore */
(function (root) {
  "use strict";
  const U = DPUI, M = DPModel, S = M.S, C = DPCanvas, G = DPGeom, { $, $$, esc, App, svg } = U;
  const P = { tab: "products", q: "", coll: "", fits: false, group: "landscape", areaMode: "rect", drawer: false, inited: false, mobile: "canvas" };
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m2 = (a) => `${a >= 100 ? Math.round(a).toLocaleString("en-US") : f2(a)} m²`;
  const ro = () => !U.canWrite();

  /* ---------------- toolbar ---------------- */
  function toolbar() {
    const t = (attr, icon, label, title) => `<button type="button" class="tool" ${attr} title="${esc(title || label)}">${svg(icon)}<span class="lbl">${esc(label)}</span></button>`;
    $("#toolbar").innerHTML = `
      <div class="tg">${t('data-tool="select"', "select", "Select", "Select and move (V)")}${t('data-tool="pan"', "pan", "Pan", "Pan (H, or hold Space)")}${t('data-tool="measure"', "measure", "Measure", "Measure a distance (M)")}</div>
      <div class="tg">${t('data-draw="fence"', "fence", "Fence", "Draw a fence (click corners, Enter to finish)")}${t('data-draw="rubber"', "rect", "Flooring", "Draw rubber safety flooring")}${t('data-draw="path"', "path", "Path", "Draw a pathway")}</div>
      <div class="tg">${t('data-act="undo"', "undo", "Undo", "Undo (Ctrl+Z)")}${t('data-act="redo"', "redo", "Redo", "Redo (Ctrl+Y)")}</div>
      <div class="tg">${t('data-act="rotate"', "rotate", "Rotate", "Rotate selection (R; Shift+R = 90°)")}${t('data-act="duplicate"', "dup", "Duplicate", "Duplicate (Ctrl+D)")}${t('data-act="lock"', "lock", "Lock", "Lock / unlock (L)")}${t('data-act="delete"', "del", "Delete", "Delete (Del)")}
        <div class="pop">${t('data-pop="arrange"', "align", "Arrange", "Align, distribute and order")}</div></div>
      <div class="tg"><div class="seg" role="group" aria-label="Display mode"><button type="button" data-mode="design">Design</button><button type="button" data-mode="presentation">Presentation</button></div><button type="button" class="btn sm ghost" id="tb-3d" hidden aria-pressed="false" title="Show this plan in 3D">3D</button>
        <div class="pop">${t('data-pop="show"', "show", "Show", "Labels, dimensions, safety zones, grid")}</div></div>
      <div class="tg tg-zoom">${t('data-act="zoom-out"', "zout", "", "Zoom out (−)")}<span class="zoom" id="zoom-label">100%</span>${t('data-act="zoom-in"', "zin", "", "Zoom in (+)")}${t('data-act="fit"', "fit", "Fit", "Fit to screen (F)")}</div>
      <div class="tg right"><div class="pop">${t('data-pop="saveas"', "layers", "Versions", "Save a version, template, history")}</div><div class="pop">${t('data-pop="export"', "export", "Export", "Export plan, drawing, schedule or project file")}</div>
        <button type="button" class="btn sm lime" id="tb-quote">Quotation →</button></div>`;
    $("#toolbar").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "tb-3d") return toggle3D();
      if (b.dataset.tool || b.dataset.draw) close3D();   // 2D tools work on the 2D plan
      if (b.dataset.tool) setTool(b.dataset.tool);
      else if (b.dataset.draw) startDraw(b.dataset.draw);
      else if (b.dataset.act) act(b.dataset.act);
      else if (b.dataset.mode) { C.displayMode = b.dataset.mode; syncToolbar(); C.req(); }
      else if (b.dataset.pop) popover(b.dataset.pop, b);
      else if (b.id === "tb-quote") U.go("quote");
    };
    syncToolbar();
  }
  function syncToolbar() {
    $$("[data-tool]").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === C.tool && !C.mode));
    $$("[data-mode]").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === C.displayMode));
    sync3D();
    const sel = M.selected(), any = sel.length > 0, w = !ro();
    const dis = (a, d) => { const b = $(`[data-act="${a}"]`); if (b) b.disabled = d; };
    dis("rotate", !any || !w || sel.every((o) => o.locked)); dis("duplicate", !any || !w); dis("delete", !any || !w || sel.every((o) => o.locked)); dis("lock", !any || !w);
    dis("undo", !M.hist.past.length || M.hist.past[M.hist.past.length - 1] == null || !w); dis("redo", !M.hist.future.length || !w);
    $$("[data-draw]").forEach((b) => (b.disabled = !w));
    const lk = $('[data-act="lock"]'); if (lk) { lk.innerHTML = svg(any && sel.every((o) => o.locked) ? "unlock" : "lock") + `<span class="lbl">${any && sel.every((o) => o.locked) ? "Unlock" : "Lock"}</span>`; }
    zoomLabel();
  }
  function zoomLabel() { const z = $("#zoom-label"); if (z) z.textContent = `${C.v.scale >= 10 ? Math.round(C.v.scale) : C.v.scale.toFixed(1)} px/m`; scalebar(); }
  function scalebar() {
    const el = $("#scalebar"); if (!el) return; const step = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => s * C.v.scale >= 70) || 1000;
    el.querySelector("i").style.width = step * C.v.scale + "px"; el.querySelector("span").textContent = step >= 1 ? `${step} m` : `${step * 100} cm`;
    const n = $("#north"); if (n) n.style.transform = `rotate(${(S.project.site && S.project.site.north) || 0}deg)`;
  }
  function setTool(t) { if (C.mode) C.endMode(null); C.tool = t; if (t !== "measure") C.measure = null; syncToolbar(); C.req(); }
  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function popover(kind, btn) {
    if (popEl && popEl.dataset.k === kind) return closePop(); closePop();
    const r = btn.getBoundingClientRect(), p = document.createElement("div"); p.className = "pop-panel"; p.dataset.k = kind;
    const sel = M.selected(), w = !ro();
    if (kind === "show") p.innerHTML = [["labels", "Labels"], ["dims", "Dimensions"], ["zones", "Safety zones"], ["grid", "Grid"], ["cad", "Imported drawing"], ["ref", "Reference image"]].map(([k, l]) => `<label class="prow check"><input type="checkbox" data-show="${k}"${C.show[k] ? " checked" : ""}> ${l}</label>`).join("") +
      `<hr><label class="prow check"><input type="checkbox" id="pp-snap"${C.snap ? " checked" : ""}> Snap to grid</label><label class="prow">Grid step <select class="in sm" id="pp-step" style="width:auto">${[0.1, 0.25, 0.5, 1].map((s) => `<option value="${s}"${C.step === s ? " selected" : ""}>${s} m</option>`).join("")}</select></label>
      <label class="prow">Rotation step <select class="in sm" id="pp-ang" style="width:auto">${[1, 5, 15, 45, 90].map((s) => `<option value="${s}"${C.angle === s ? " selected" : ""}>${s}°</option>`).join("")}</select></label><label class="prow check"><input type="checkbox" id="pp-guides"${C.guides ? " checked" : ""}> Alignment guides</label>`;
    if (kind === "arrange") p.innerHTML = `${[["left", "Align left"], ["hcenter", "Align centres (vertical line)"], ["right", "Align right"], ["top", "Align top"], ["vcenter", "Align middles (horizontal line)"], ["bottom", "Align bottom"]].map(([k, l]) => `<button class="menu-item" data-al="${k}" ${sel.length < 2 || !w ? "disabled" : ""}>${l}</button>`).join("")}
      <hr><button class="menu-item" data-al="dh" ${sel.length < 3 || !w ? "disabled" : ""}>Distribute horizontally</button><button class="menu-item" data-al="dv" ${sel.length < 3 || !w ? "disabled" : ""}>Distribute vertically</button>
      <hr><button class="menu-item" data-al="front" ${!sel.length || !w ? "disabled" : ""}>Bring to front</button><button class="menu-item" data-al="back" ${!sel.length || !w ? "disabled" : ""}>Send to back</button><button class="menu-item" data-al="hide" ${!sel.length || !w ? "disabled" : ""}>Hide selected</button><button class="menu-item" data-al="showall" ${!w ? "disabled" : ""}>Show all hidden</button><button class="menu-item" data-al="all">Select all <small>Ctrl+A</small></button>`;
    if (kind === "export") p.innerHTML = `<button class="menu-item" data-ex="png">Site plan image (PNG, 4000 px)<small>presentation</small></button><button class="menu-item" data-ex="pngd">Site plan image (PNG)<small>design</small></button><button class="menu-item" data-ex="tech">Technical drawing (PDF, A3)</button><button class="menu-item" data-ex="dxf">Technical drawing (DXF, metres)</button><button class="menu-item" data-ex="csv">Product schedule (CSV)</button><hr><button class="menu-item" data-ex="json">Project file (.json)<small>reopen &amp; edit</small></button>`;
    if (kind === "saveas") p.innerHTML = `<button class="menu-item" data-sv="save" ${!w ? "disabled" : ""}>Save now <small>Ctrl+S</small></button><button class="menu-item" data-sv="saveas" ${!w ? "disabled" : ""}>Save as a new project…</button><button class="menu-item" data-sv="version" ${!w || App.sample ? "disabled" : ""}>Save a named version…</button><button class="menu-item" data-sv="versions" ${App.sample ? "disabled" : ""}>Versions and restore…</button><button class="menu-item" data-sv="template" ${!w ? "disabled" : ""}>Save layout as template…</button><button class="menu-item" data-sv="audit">Change log…</button>`;
    document.body.appendChild(p); p.style.top = r.bottom + 6 + "px"; p.style.left = Math.min(window.innerWidth - p.offsetWidth - 8, Math.max(8, r.left)) + "px"; popEl = p;
    p.onchange = (e) => { const t = e.target; if (t.dataset.show) { C.show[t.dataset.show] = t.checked; C.req(); } if (t.id === "pp-snap") C.snap = t.checked; if (t.id === "pp-step") C.step = +t.value; if (t.id === "pp-ang") C.angle = +t.value; if (t.id === "pp-guides") C.guides = t.checked; };
    p.onclick = (e) => { const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.al) { arrange(b.dataset.al); closePop(); } if (b.dataset.ex) { closePop(); doExport(b.dataset.ex); } if (b.dataset.sv) { closePop(); saveMenu(b.dataset.sv); } };
  }
  document.addEventListener("pointerdown", (e) => { if (popEl && !popEl.contains(e.target) && !e.target.closest("[data-pop]")) closePop(); });

  /* ---------------- actions ---------------- */
  function act(a) {
    const sel = M.selected(), movable = sel.filter((o) => !o.locked);
    if (ro() && !["zoom-in", "zoom-out", "fit"].includes(a)) return;
    if (a === "undo") { if (M.undo()) { U.toast(`Undone: ${M.hist.lastLabel || "change"}`); refresh(); } }
    else if (a === "redo") { if (M.redo()) refresh(); }
    else if (a === "zoom-in") C.zoomAt(1.25); else if (a === "zoom-out") C.zoomAt(0.8); else if (a === "fit") C.fit();
    else if (a === "delete") { if (!movable.length) return; const n = movable.length; M.removeIds(movable.map((o) => o.id)); C.editVerts = null; M.commit(`Delete ${n}`, { audit: { action: "Deleted", detail: movable.map(M.shortName).join(", ").slice(0, 300) } }); U.toast(`${n} item${n > 1 ? "s" : ""} deleted.`, { action: { label: "Undo", fn: () => { M.undo(); refresh(); } } }); refresh(); }
    else if (a === "duplicate") { if (!sel.length) return; const copies = sel.map((o) => M.cloneObj(o, 1, 1)); copies.forEach((c) => S.project.objects.push(c)); S.selection.clear(); copies.forEach((c) => S.selection.add(c.id)); M.commit("Duplicate"); refresh(); }
    else if (a === "rotate" || a === "rotate90" || a === "rotate-") { if (!movable.length) return; const d = a === "rotate90" ? 90 : a === "rotate-" ? -C.angle : C.angle;
      if (movable.length === 1) M.rotateObj(movable[0], d); else { const b = G.bbox(movable.flatMap((o) => M.outline(o).flat())); movable.forEach((o) => M.rotateObj(o, d, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2])); } M.commit("Rotate"); refresh(); }
    else if (a === "lock") { if (!sel.length) return; const v = !sel.every((o) => o.locked); sel.forEach((o) => (o.locked = v)); M.commit(v ? "Lock" : "Unlock"); refresh(); }
    else if (a === "copy") { if (!sel.length) return; C.clipboard = JSON.parse(JSON.stringify(sel)); U.toast(`${sel.length} copied.`); }
    else if (a === "paste") { if (!C.clipboard) return; const copies = C.clipboard.map((o) => M.cloneObj(o, 2, 2)); copies.forEach((c) => S.project.objects.push(c)); S.selection.clear(); copies.forEach((c) => S.selection.add(c.id)); C.clipboard = copies.map((c) => JSON.parse(JSON.stringify(c))); M.commit("Paste"); refresh(); }
  }
  function arrange(k) {
    const sel = M.selected().filter((o) => !o.locked);
    if (k === "all") { S.selection.clear(); S.project.objects.forEach((o) => !o.hidden && S.selection.add(o.id)); refresh(); return; }
    if (k === "showall") { S.project.objects.forEach((o) => (o.hidden = false)); M.commit("Show all"); refresh(); return; }
    if (k === "hide") { sel.forEach((o) => (o.hidden = true)); S.selection.clear(); M.commit("Hide"); refresh(); return; }
    if (k === "front" || k === "back") { const ids = new Set(sel.map((o) => o.id)), rest = S.project.objects.filter((o) => !ids.has(o.id)), mv = S.project.objects.filter((o) => ids.has(o.id)); S.project.objects = k === "front" ? rest.concat(mv) : mv.concat(rest); M.commit(k === "front" ? "Bring to front" : "Send to back"); refresh(); return; }
    const bb = sel.map((o) => ({ o, b: M.bounds(o) })).filter((x) => x.b); if (bb.length < 2) return;
    const all = G.bbox(bb.flatMap((x) => [[x.b.x0, x.b.y0], [x.b.x1, x.b.y1]]));
    if (k === "dh" || k === "dv") { const ax = k === "dh" ? "x" : "y"; bb.sort((a, b) => (a.b[ax + "0"] + a.b[ax + "1"]) - (b.b[ax + "0"] + b.b[ax + "1"]));
      const tot = bb.reduce((s, x) => s + (x.b[ax + "1"] - x.b[ax + "0"]), 0), span = all[ax + "1"] - all[ax + "0"], gap = (span - tot) / (bb.length - 1); let pos = all[ax + "0"];
      for (const x of bb) { const d = pos - x.b[ax + "0"]; M.translateObj(x.o, ax === "x" ? d : 0, ax === "y" ? d : 0); pos += x.b[ax + "1"] - x.b[ax + "0"] + gap; } }
    else for (const x of bb) { const b = x.b; let dx = 0, dy = 0;
      if (k === "left") dx = all.x0 - b.x0; if (k === "right") dx = all.x1 - b.x1; if (k === "hcenter") dx = (all.x0 + all.x1) / 2 - (b.x0 + b.x1) / 2;
      if (k === "top") dy = all.y0 - b.y0; if (k === "bottom") dy = all.y1 - b.y1; if (k === "vcenter") dy = (all.y0 + all.y1) / 2 - (b.y0 + b.y1) / 2; M.translateObj(x.o, dx, dy); }
    M.commit("Align"); refresh();
  }
  M.on("key", (e) => {
    if (App.view !== "plan") return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === "s") { e.preventDefault(); U.save(); return; }
    if (ro()) { if (k === "f" || k === "F") C.fit(); return; }
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); act(e.shiftKey ? "redo" : "undo"); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); act("redo"); return; }
    if (mod && k.toLowerCase() === "d") { e.preventDefault(); act("duplicate"); return; }
    if (mod && k.toLowerCase() === "c") { act("copy"); return; } if (mod && k.toLowerCase() === "v") { act("paste"); return; }
    if (mod && k.toLowerCase() === "a") { e.preventDefault(); arrange("all"); return; }
    if (k === "Delete" || k === "Backspace") { if (C.editVerts && C.selVertex >= 0) { removeVertex(); e.preventDefault(); return; } e.preventDefault(); act("delete"); return; }
    if (k === "Escape") { if (C.editVerts) { C.editVerts = null; C.selVertex = -1; } S.selection.clear(); C.measure = null; refresh(); return; }
    if (k === "r" || k === "R") { act(e.shiftKey ? "rotate90" : "rotate"); return; }
    if (k === "l" || k === "L") { act("lock"); return; }
    if (k === "v" || k === "V") setTool("select"); if (k === "h" || k === "H") setTool("pan"); if (k === "m" || k === "M") setTool("measure");
    if (k === "f" || k === "F") C.fit(); if (k === "+" || k === "=") C.zoomAt(1.25); if (k === "-") C.zoomAt(0.8);
    if (k.startsWith("Arrow")) { e.preventDefault(); const st = e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1, dx = k === "ArrowLeft" ? -st : k === "ArrowRight" ? st : 0, dy = k === "ArrowUp" ? -st : k === "ArrowDown" ? st : 0;
      const sel = M.selected().filter((o) => !o.locked); if (sel.length) { sel.forEach((o) => M.translateObj(o, dx, dy)); M.commit("Nudge"); refresh(); }
      else if (C.editVerts && C.selVertex >= 0) { const t = C.editVerts === "site" ? S.project.site.poly : (M.byId(C.editVerts).pts || M.byId(C.editVerts).poly); t[C.selVertex][0] += dx; t[C.selVertex][1] += dy; M.commit("Move corner"); refresh(); } }
  });
  function removeVertex() {
    const isSite = C.editVerts === "site", o = isSite ? null : M.byId(C.editVerts), pts = isSite ? S.project.site.poly : o.kind === "line" ? o.pts : o.poly, min = !isSite && o.kind === "line" ? 2 : 3;
    if (pts.length <= min) return U.toast(`A ${isSite ? "boundary" : o.kind} needs at least ${min} corners.`, { err: true });
    pts.splice(C.selVertex, 1); C.selVertex = -1; M.commit("Remove corner"); refresh();
  }

  /* ---------------- placing & drawing ---------------- */
  function hint(text, onCancel) { const h = $("#hint"); h.innerHTML = `<span>${esc(text)}</span><button type="button" class="alt" id="hint-x">Cancel</button>`; h.hidden = false; $("#hint-x").onclick = () => { C.endMode(null); onCancel && onCancel(); }; mobile("canvas"); }
  const hideHint = () => ($("#hint").hidden = true);
  function newProductObj(code, at) { const p = DPCat.BY[code]; return { id: M.uid(), kind: "product", code, x: at[0], y: at[1], rot: at[2] || 0 }; void p; }
  /** New items join the quotation only once they have a price: an unpriced line would otherwise block the whole quote. */
  const hasPrice = (el, o) => { const it = ((App.config.pricebook || {}).items || {})[o ? M.priceKey(o) : "el:" + el.id]; return !!(it && it.sell != null && it.sell !== "" && isFinite(it.sell)); };
  function quoteDefault(o) { const el = DPCat.EL[o.type]; if (el && el.priced3d) o.costable = hasPrice(el, o); else if (el && el.added3d && el.costable && !hasPrice(el)) o.costable = false; return o; }
  function quoteNote(o) { const el = DPCat.EL[o.type]; if (!el || !(el.added3d || el.priced3d) || (o.costable != null ? o.costable : el.costable)) return ""; const custom = el.group === "custom"; return `<div class="note warn small">${custom ? "Not in the quotation yet. Enter a unit price below and tick the box to include it." : hasPrice(el, o) ? "A price now exists. Tick the box to include this in the quotation." : "Not in the quotation: this item has no price yet. An administrator can add one in the Price book."}</div>`; }
  function newPointObj(type, at, rot = 0) { const el = DPCat.EL[type]; return quoteDefault({ id: M.uid(), kind: "point", type, x: at[0], y: at[1], rot, l: el.l || el.d, w: el.w || el.d, label: type === "label" ? "Label" : "" }); }
  function placeProduct(code) {
    if (ro()) return; const p = DPCat.BY[code]; if (!p || !p.dims) return U.toast("This product has no published dimensions and cannot be placed. Ask Dupedia for a site-specific layout.", { err: true });
    setTool("select"); hint(`Click to place ${p.displayCode || p.code} ${p.name}. R rotates before placing. Esc cancels.`);
    C.setMode("place", { code }, (g) => { hideHint(); if (!g) return; const o = newProductObj(code, [g.x, g.y, g.rot]); M.addObject(o, false); S.selection.clear(); S.selection.add(o.id); M.commit(`Add ${p.code}`, { audit: { action: "Added product", detail: `${p.code} ${p.name}` } }); refresh(); syncToolbar(); });
  }
  /** Quick add: first free spot (fit assistant from v1) or the centre of the view. */
  function quickAddProduct(code) {
    if (ro()) return; const p = DPCat.BY[code]; if (!p || !p.dims) return U.toast("This product has no published dimensions and cannot be placed.", { err: true });
    const site = S.project.site && S.project.site.poly; let spot = null;
    if (site && root.DPFit) { const blockers = blockersForFit(); spot = DPFit.findSpot(p, site, blockers, { near: C.toW([C.W / 2, C.H / 2]) }); }
    const at = spot ? [spot.x, spot.y, spot.rot] : [...C.toW([C.W / 2, C.H / 2]).map((v) => G.snap(v, C.step)), 0];
    const o = newProductObj(code, at); M.addObject(o, false); S.selection.clear(); S.selection.add(o.id); M.commit(`Add ${p.code}`, { audit: { action: "Added product", detail: `${p.code} ${p.name}` } });
    if (site && !spot) U.toast(`No free space found for ${p.code} with its safety zone; placed at the centre of the view. Check the warnings.`, { ms: 6000 });
    if (!C.contentBox() || !G.pointInPolygon([o.x, o.y], [[C.toW([0, 0])[0], C.toW([0, 0])[1]], [C.toW([C.W, 0])[0], C.toW([C.W, 0])[1]], [C.toW([C.W, C.H])[0], C.toW([C.W, C.H])[1]], [C.toW([0, C.H])[0], C.toW([0, C.H])[1]]])) C.centerOn([o.x, o.y]);
    refresh();
  }
  function blockersForFit() {
    const out = [], bb = (poly) => G.bbox(poly);
    for (const o of S.project.objects) { if (o.hidden) continue; const s = M.shapes(o); if (s.missing) continue;
      if (o.kind === "product") { out.push({ poly: s.foot, bb: bb(s.foot), convex: true }); if (s.zone) out.push({ poly: s.zone, bb: bb(s.zone), convex: true }); }
      else if (o.kind === "point" && s.blocks) out.push({ poly: s.foot, bb: bb(s.foot), convex: true });
      else if (o.kind === "area" && (s.el.noBuild || s.el.existing || s.el.blocks)) out.push({ poly: o.poly, bb: bb(o.poly), convex: false });
      else if (o.kind === "line" && s.blocks) for (const q of s.quads) out.push({ poly: q, bb: bb(q), convex: true }); }
    return out;
  }
  function placeElement(type) {
    if (ro()) return; const el = DPCat.EL[type]; if (!el) return;
    if (el.kind === "line") return startDraw(type);
    if (el.kind === "area") return startDraw(type);
    setTool("select"); hint(`Click to place: ${el.name}. ${el.gate ? "It snaps onto the nearest fence. " : ""}R rotates. Esc cancels.`);
    C.setMode("place", { type }, (g) => { hideHint(); if (!g) return; const o = newPointObj(type, [g.x, g.y], g.rot); if (g.l) { o.l = g.l; o.w = g.w; }
      M.addObject(o, false); S.selection.clear(); S.selection.add(o.id); M.commit(`Add ${el.name}`); refresh(); syncToolbar();
      if (el.gate && !g.snapped) U.toast("The gate is not on a fence, so no fence length is deducted. Drag it onto a fence line or draw the fence through it.", { ms: 6000 }); });
  }
  function startDraw(type) {
    if (ro()) return; const el = DPCat.EL[type]; setTool("select");
    if (el.kind === "line") {
      hint(`Draw ${el.name.toLowerCase()}: click each corner; double-click, Enter, or click the last point again to finish. Shift draws straight lines. Backspace removes a corner.`);
      C.setMode("draw-line", type === "dimension" ? { maxPts: 2 } : {}, (pts) => { hideHint(); syncToolbar(); if (!pts || pts.length < 2) return;
        const o = quoteDefault({ id: M.uid(), kind: "line", type, pts, width: el.width, label: "", traced: !!(S.project.cad || S.project.ref) }); M.addObject(o, false); S.selection.clear(); S.selection.add(o.id);
        M.commit(`Draw ${el.name}`); refresh(); U.toast(`${el.name}: ${f2(G.polylineLength(pts))} m.`); });
    } else {
      const rect = P.areaMode === "rect";
      hint(rect ? `Draw ${el.name.toLowerCase()}: click one corner, then the opposite corner. Switch to polygon in the Elements tab for any shape.` : `Draw ${el.name.toLowerCase()}: click each corner; click the first corner or press Enter to close.`);
      C.setMode(rect ? "draw-rect" : "draw-area", {}, (pts) => { hideHint(); syncToolbar(); if (!pts || pts.length < 3) return; if (G.area(pts) < 0.01) return U.toast("That area is too small.", { err: true });
        const o = quoteDefault({ id: M.uid(), kind: "area", type, poly: pts, label: "", traced: !!(S.project.cad || S.project.ref) }); M.addObject(o, false); S.selection.clear(); S.selection.add(o.id);
        M.commit(`Draw ${el.name}`); refresh(); U.toast(`${el.name}: ${m2(G.area(pts))}.`); });
    }
    syncToolbar();
  }
  M.on("drop-item", ({ item, w }) => {
    if (ro()) return;
    if (item.code) { const p = DPCat.BY[item.code]; if (!p || !p.dims) return; const o = newProductObj(item.code, w); M.addObject(o, false); S.selection.clear(); S.selection.add(o.id); M.commit(`Add ${p.code}`, { audit: { action: "Added product", detail: `${p.code} ${p.name}` } }); }
    else if (item.type) { const el = DPCat.EL[item.type]; if (el.kind !== "point") return startDraw(item.type); const o = newPointObj(item.type, w); M.addObject(o, false); S.selection.clear(); S.selection.add(o.id); M.commit(`Add ${el.name}`); }
    refresh();
  });

  /* ---------------- left panel ---------------- */
  function left() {
    const L = $("#left");
    L.innerHTML = `<div class="tabs" role="tablist">${[["site", "Site"], ["products", "Products"], ["elements", "Elements"], ["layers", "Layers"]].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${P.tab === k ? "is-on" : ""}" aria-selected="${P.tab === k}">${l}</button>`).join("")}</div><div id="left-body"></div>`;
    $$("[data-tab]", L).forEach((b) => (b.onclick = () => { P.tab = b.dataset.tab; left(); }));
    const B = $("#left-body");
    if (P.tab === "site") siteTab(B); else if (P.tab === "products") productsTab(B); else if (P.tab === "elements") elementsTab(B); else layersTab(B);
  }
  function planTab(t) { P.tab = t; left(); }

  /* --- site tab --- */
  function siteTab(B) {
    const site = S.project.site, c = S.project.cad, r = S.project.ref, mt = M.metrics(), w = !ro();
    B.innerHTML = `<div class="panel">
      <div class="sect"><h4>Site boundary</h4>
        ${site ? `<dl class="kv"><dt>Area</dt><dd>${m2(mt.siteArea)}</dd><dt>Perimeter</dt><dd>${f2(mt.perimeter)} m</dd><dt>Extent</dt><dd>${f2(mt.bbox.w)} × ${f2(mt.bbox.h)} m</dd><dt>Corners</dt><dd>${site.poly.length}</dd></dl>` : `<p class="small muted">No boundary yet. Enter the site size, draw any shape, or import the client's drawing.</p>`}
        <form class="grid2" id="rect-form" style="align-items:end"><label class="field"><span>Width</span><div class="unit"><input class="in num sm" id="rw" type="number" min="1" step="0.1" value="${site && site.dims ? site.dims.w : ""}" ${w ? "" : "disabled"}><em>m</em></div></label><label class="field"><span>Length</span><div class="unit"><input class="in num sm" id="rl" type="number" min="1" step="0.1" value="${site && site.dims ? site.dims.l : ""}" ${w ? "" : "disabled"}><em>m</em></div></label>
          <button class="btn sm" style="grid-column:1/-1" ${w ? "" : "disabled"}>${site ? "Replace with rectangle" : "Create rectangular site"}</button></form>
        <div class="row"><button type="button" class="btn ghost sm" id="draw-site" ${w ? "" : "disabled"}>Draw any shape</button>${site ? `<button type="button" class="btn ghost sm" id="edit-site" ${w ? "" : "disabled"}>${C.editVerts === "site" ? "Finish editing corners" : "Edit corners"}</button>` : ""}${S.cadData && S.cadData.candidates && S.cadData.candidates.length ? `<button type="button" class="btn ghost sm" id="pick-site" ${w ? "" : "disabled"}>Pick from drawing</button>` : ""}</div>
        ${C.editVerts === "site" ? `<p class="tiny muted">Drag corners. Double-click an edge to add a corner; select a corner and press Delete to remove it. Shift keeps edges straight.</p>` : ""}
      </div>
      <div class="sect"><h4>Orientation</h4><label class="field"><span>North direction (degrees clockwise from up)</span><input class="in num sm" id="north-in" type="number" step="1" value="${site ? site.north || 0 : 0}" ${w && site ? "" : "disabled"}></label></div>
      <div class="sect"><h4>Client drawing</h4>
        <p class="small muted">Import the site as DXF (ASCII, any version), a PDF page or an image, then confirm the scale. DWG must be exported to DXF first.</p>
        <button type="button" class="btn ghost sm" id="imp" ${w ? "" : "disabled"}>Import DXF, PDF or image…</button>
        ${c ? cadCard(c) : ""}${r ? refCard(r) : ""}
      </div>
      <div class="sect"><h4>Zones on site</h4><div class="row"><button type="button" class="btn ghost xs" data-el="restricted" ${w ? "" : "disabled"}>+ No-build zone</button><button type="button" class="btn ghost xs" data-el="existing" ${w ? "" : "disabled"}>+ Existing obstacle</button><button type="button" class="btn ghost xs" data-el="tree-existing" ${w ? "" : "disabled"}>+ Existing tree</button><button type="button" class="btn ghost xs" data-el="clearance" ${w ? "" : "disabled"}>+ Clearance area</button></div></div>
    </div>`;
    const rf = $("#rect-form", B); rf.onsubmit = async (e) => { e.preventDefault(); const W = +$("#rw", B).value, Lx = +$("#rl", B).value; if (!(W > 0 && Lx > 0)) return U.toast("Enter a width and length greater than zero.", { err: true });
      if (site && !(await U.ask("Replace the site boundary?", "<p>The current boundary is replaced by a rectangle. Products and elements stay where they are.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Replace", value: true }]))) return;
      setSite([[0, 0], [W, 0], [W, Lx], [0, Lx]], "rect", { w: W, l: Lx }); };
    const ds = $("#draw-site", B); if (ds) ds.onclick = () => { hint("Click to add corners. Shift = straight edges. Click the first corner or press Enter to close. Backspace removes the last corner."); C.setMode("draw-site", {}, (pts) => { hideHint(); syncToolbar(); if (pts) setSite(pts, S.project.cad || S.project.ref ? "trace" : "manual"); }); };
    const es = $("#edit-site", B); if (es) es.onclick = () => { C.editVerts = C.editVerts === "site" ? null : "site"; C.selVertex = -1; S.selection.clear(); left(); C.req(); };
    const ps = $("#pick-site", B); if (ps) ps.onclick = () => { hint("Click inside a closed shape on the drawing to use it as the site boundary."); C.setMode("pick-boundary", {}, (i) => { hideHint(); if (i == null) return; const poly = C.cadPathWorld(i); if (poly) setSite(poly, "cad"); }); };
    const ni = $("#north-in", B); if (ni) ni.onchange = () => { S.project.site.north = G.normAngle(+ni.value || 0); M.commit("Set north"); scalebar(); };
    $("#imp", B).onclick = () => U.pickFile(".dxf,.dwg,.pdf,.png,.jpg,.jpeg", importDrawing);
    $$("[data-el]", B).forEach((b) => (b.onclick = () => placeElement(b.dataset.el)));
    bindScale(B);
  }
  function setSite(poly, source, dims) {
    if (poly.length < 3 || G.area(poly) < 0.01) return U.toast("That shape has no area.", { err: true });
    if (G.selfIntersects(poly)) U.toast("The boundary crosses itself; check the corners.", { err: true });
    S.project.site = { poly: poly.map((p) => p.slice()), source, north: (S.project.site && S.project.site.north) || 0, dims: dims || null };
    M.commit("Set site boundary", { audit: { action: "Set site boundary", detail: `${m2(G.area(poly))} (${source})` } }); C.fit(); refresh(); U.toast(`Site set: ${m2(G.area(poly))}.`);
  }
  function cadCard(c) {
    const st = { header: ["ok", `Units from file: ${c.unitName}`], calibration: ["ok", "Calibrated with two points"], manual: ["warn", `Units chosen${c.unitName ? `: ${c.unitName}` : ""}`], unverified: ["err", "Scale not verified"] }[c.scaleSource];
    const d = S.cadData;
    return `<div class="card stack" style="padding:12px"><div class="row between"><b class="small">${esc(c.fileName)}</b><span class="pill ${st[0]}">${esc(st[1])}</span></div>
      ${c.scaleSource === "unverified" ? `<div class="note err">The file does not state its units. Choose them or calibrate before relying on any size.</div>` : ""}
      ${d ? `<dl class="kv"><dt>1 drawing unit</dt><dd>${c.scale >= 0.01 ? f2(c.scale) + " m" : (c.scale * 1000).toFixed(3) + " mm"}</dd><dt>Extent</dt><dd>${f2((d.bbox.x1 - d.bbox.x0) * c.scale)} × ${f2((d.bbox.y1 - d.bbox.y0) * c.scale)} m</dd></dl>` : `<p class="small muted">Drawing data not available on this device; re-import to see it.</p>`}
      <label class="field"><span>Drawing units</span><select class="in sm" id="cad-units"><option value="">— choose —</option>${[[4, "Millimetres"], [5, "Centimetres"], [14, "Decimetres"], [6, "Metres"], [1, "Inches"], [2, "Feet"]].map(([k, n]) => `<option value="${k}" ${c.scaleSource !== "calibration" && G.unitsFactor(k).factor === c.scale ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <div class="row"><button type="button" class="btn sm" data-cal="cad">Calibrate with two points</button><button type="button" class="btn ghost sm" data-rm="cad">Remove drawing</button></div>
      ${d && d.layers.length ? `<details><summary class="small"><b>Layers (${d.layers.length})</b></summary><div class="stack" style="gap:2px;margin-top:6px;max-height:200px;overflow:auto">${d.layers.map((L, i) => `<label class="check small"><input type="checkbox" data-cl="${i}" ${c.hidden[i] ? "" : "checked"}> ${esc(L.name)} <span class="muted">${L.count}</span></label>`).join("")}</div></details>` : ""}</div>`;
  }
  function refCard(r) {
    const st = { calibration: ["ok", "Calibrated"], paper: ["warn", "Scaled from drawing scale"], unverified: ["err", "Scale not verified"] }[r.scaleSource];
    return `<div class="card stack" style="padding:12px"><div class="row between"><b class="small">${esc(r.fileName)}${r.page ? ` · p.${r.page}` : ""}</b><span class="pill ${st[0]}">${st[1]}</span></div>
      ${r.scaleSource === "unverified" ? `<div class="note err">Pictures have no real-world units. Calibrate on a known dimension before relying on any size.</div>` : ""}
      <dl class="kv"><dt>Reference size</dt><dd>${f2(r.w * r.mpp)} × ${f2(r.h * r.mpp)} m</dd></dl>
      <button type="button" class="btn sm" data-cal="ref">Calibrate with two points</button>
      ${r.kind === "pdf" && r.paperMmPerPx ? `<form class="grid2" id="paper-form" style="align-items:end"><label class="field"><span>Or printed scale 1 :</span><input class="in sm num" type="number" id="paper-den" min="1" step="1" placeholder="100" value="${r.paperDen || ""}"></label><button class="btn ghost sm">Apply</button></form><p class="tiny muted">Only valid when the PDF page is at true paper size (${Math.round(r.pageMm[0])} × ${Math.round(r.pageMm[1])} mm).</p>` : ""}
      <label class="field"><span>Opacity</span><input type="range" id="ref-op" min="0.1" max="1" step="0.05" value="${r.opacity}"></label>
      <button type="button" class="btn ghost sm" data-rm="ref">Remove reference</button></div>`;
  }
  function bindScale(B) {
    const cu = $("#cad-units", B); if (cu) cu.onchange = () => { if (!cu.value) return; const u = G.unitsFactor(+cu.value); const r = DPIO.setScale("cad", u.factor, S.project.cad.insunits === +cu.value ? "header" : "manual"); S.project.cad.unitName = u.name; afterScale(r); };
    $$("[data-cal]", B).forEach((b) => (b.onclick = () => calibrate(b.dataset.cal)));
    $$("[data-rm]", B).forEach((b) => (b.onclick = async () => { if (!(await U.ask("Remove the imported drawing?", "<p>Your boundary, products and elements stay.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Remove", value: true }]))) return;
      if (b.dataset.rm === "cad") { S.project.cad = null; S.cadData = null; } else { S.project.ref = null; S.refImage = null; } M.commit("Remove drawing"); refresh(); }));
    $$("[data-cl]", B).forEach((x) => (x.onchange = () => { S.project.cad.hidden[+x.dataset.cl] = !x.checked; if (S.cadData) delete S.cadData._idx; M.commit("Layer visibility"); }));
    const pf = $("#paper-form", B); if (pf) pf.onsubmit = (e) => { e.preventDefault(); const den = +$("#paper-den", B).value; if (!(den > 0)) return; const r = S.project.ref; r.paperDen = den; afterScale(DPIO.setScale("ref", r.paperMmPerPx / 1000 * den, "paper")); };
    const op = $("#ref-op", B); if (op) op.oninput = () => { S.project.ref.opacity = +op.value; C.req(); };
  }
  function calibrate(target) {
    hint(target === "cad" ? "Click two points of a known distance on the drawing (it snaps to drawing corners). Esc cancels." : "Click two points of a known distance on the reference. Esc cancels.");
    C.setMode("calibrate", {}, async (pts) => {
      hideHint(); syncToolbar(); if (!pts || pts.length < 2) return; const d = G.dist(pts[0], pts[1]); if (!(d > 1e-9)) return U.toast("Pick two different points.", { err: true });
      const r = await U.form("Real distance between the points", [{ id: "d", label: "Distance", type: "number", unit: "m", step: "any", min: 0.001, required: true }], { intro: `Currently measures ${f2(d)} m on the plan.`, submit: "Set scale" }); if (!r) return;
      try { const f = G.calibrationFactor(pts[0], pts[1], r.d), cur = target === "cad" ? S.project.cad.scale : S.project.ref.mpp; afterScale(DPIO.setScale(target, cur * f, "calibration")); } catch (e) { U.toast(e.message, { err: true }); }
    });
  }
  function afterScale(r) { M.commit("Set scale", { audit: { action: "Set drawing scale", detail: `×${r.factor.toFixed(4)}` } }); C.fit(); refresh(); const n = S.project.objects.filter((o) => o.kind === "product").length; U.toast(n ? `Scale updated. ${n} products kept their true size; review their positions.` : "Scale updated.", { ms: 6000 }); }
  async function importDrawing(file) {
    let info; try { info = await DPIO.validateFile(file); } catch (e) { return importError(file, e); }
    if (info.kind === "json") return U.toast("Open project files from the Projects page.", { err: true });
    if ((S.project.cad || S.project.ref) && !(await U.ask("Replace the current drawing?", "<p>Your boundary and products stay.</p>", [{ label: "Cancel", value: false, cls: "ghost" }, { label: "Replace", value: true }]))) return;
    const ctl = new AbortController(); const b = U.busy("Reading " + file.name + "…");
    try {
      if (info.kind === "dxf") {
        const text = await DPIO.readText(file); const data = await DPIO.parseDxf(text, file.name, (m) => b.set(`${m.stage}… ${m.pct || 0}%`), ctl.signal);
        S.project.ref = null; S.refImage = null; const r = DPIO.installCad(data, file.name); b.done(); M.commit("Import DXF", { audit: { action: "Imported drawing", detail: file.name } }); C.fit(); P.tab = "site"; refresh();
        const big = data.candidates[0];
        U.openModal(`<h2>Drawing imported</h2><dl class="kv"><dt>File</dt><dd>${esc(file.name)}</dd><dt>Units</dt><dd>${r.verified ? esc(r.units.name) + " (from file)" : '<span style="color:var(--red)">Not stated</span>'}</dd><dt>Layers</dt><dd>${data.layers.length}</dd><dt>Shapes</dt><dd>${data.paths.length.toLocaleString()}</dd><dt>Closed shapes</dt><dd>${data.candidates.length}</dd>${big && r.verified ? `<dt>Largest closed shape</dt><dd>${m2(big.area * S.project.cad.scale ** 2)}</dd>` : ""}</dl>
          <div class="note ${r.verified ? "" : "err"}">${r.verified ? "Next: measure one known dimension to confirm the scale, then pick the site boundary from the drawing." : "The drawing does not state its units. Choose units or calibrate in the Site tab before placing anything."}</div><div class="acts"><button class="btn" id="ok-x">Continue</button></div>`, (m) => ($("#ok-x", m).onclick = () => U.closeModal()));
      } else if (info.kind === "pdf") {
        const doc = await DPIO.pdfOpen(file); let page = 1;
        if (doc.numPages > 1) { b.done(); const r = await U.form("Choose a page", [{ id: "p", label: `Page (1–${doc.numPages})`, type: "number", value: 1, min: 1, required: true }], { submit: "Use page" }); if (!r) return; page = Math.min(doc.numPages, Math.max(1, Math.round(r.p))); U.busy("Rendering page…"); }
        const r = await DPIO.pdfRender(doc, page); S.project.cad = null; S.cadData = null; DPIO.installRef("pdf", file.name, r, { page }); U.closeModal();
        M.commit("Import PDF", { audit: { action: "Imported drawing", detail: `${file.name} p.${page}` } }); C.fit(); P.tab = "site"; refresh(); U.toast("PDF page placed as a reference. Calibrate it before relying on sizes.", { ms: 7000 });
      } else if (info.kind === "image") {
        const r = await DPIO.readImage(file); S.project.cad = null; S.cadData = null; DPIO.installRef("image", file.name, r); b.done();
        M.commit("Import image", { audit: { action: "Imported drawing", detail: file.name } }); C.fit(); P.tab = "site"; refresh(); U.toast("Image placed as a reference. Calibrate it with two points.", { ms: 6000 });
      }
    } catch (e) { U.closeModal(); if (e && e.code === "cancelled") return U.toast("Import cancelled."); importError(file, e); }
  }
  function importError(file, e) { U.openModal(`<h2>Couldn't import ${esc(file.name)}</h2><div class="note err">${esc(e && e.message ? e.message : "The file could not be read.")}</div><p class="small muted">Supported: DXF (ASCII), PDF, PNG and JPG. Nothing on your plan was changed.</p><div class="acts"><button class="btn" id="ok-x">Close</button></div>`, (m) => ($("#ok-x", m).onclick = () => U.closeModal())); }

  /* --- products tab --- */
  function productsTab(B) {
    const cols = DPCat.COLLECTIONS.concat(DPCat.customProducts.length ? [{ key: "custom", short: "Custom" }] : []);
    B.innerHTML = `<div class="panel"><div class="search"><svg viewBox="0 0 24 24">${U.ICON.search}</svg><input class="in sm" id="pq" placeholder="Search name, code or feature" value="${esc(P.q)}"></div>
      <div class="chips">${[{ key: "", short: "All" }].concat(cols).map((c) => `<button type="button" class="chip ${P.coll === c.key ? "is-on" : ""}" data-coll="${c.key}">${esc(c.short)}</button>`).join("")}</div>
      <label class="check small"><input type="checkbox" id="pfits" ${P.fits ? "checked" : ""}> Only what fits the free space</label>
      <p class="tiny muted" id="pcount"></p><div class="lib" id="plib"></div></div>`;
    $("#pq", B).oninput = (e) => { P.q = e.target.value; libList(); };
    $$("[data-coll]", B).forEach((b) => (b.onclick = () => { P.coll = b.dataset.coll; productsTab(B); }));
    $("#pfits", B).onchange = (e) => { P.fits = e.target.checked; libList(); };
    libList();
  }
  const fitCache = new Map();
  function fits(p) {
    const site = S.project.site && S.project.site.poly; if (!site || !p.dims || !root.DPFit) return null;
    const key = p.code + "|" + M.hist.current.length + "|" + S.project.objects.length; if (fitCache.has(key)) return fitCache.get(key);
    const r = !!DPFit.findSpot(p, site, blockersForFit(), { maxTests: 6000 }); fitCache.set(key, r); return r;
  }
  function libList() {
    const q = P.q.trim().toLowerCase(), box = $("#plib"); if (!box) return;
    let list = DPCat.PRODUCTS.filter((p) => !p.inactive && (!P.coll || p.collection === P.coll) && (!q || [p.code, p.displayCode, p.name, p.description, p.collectionName].join(" ").toLowerCase().includes(q)));
    if (P.fits) list = list.filter((p) => fits(p) !== false);
    $("#pcount").textContent = `${list.length} of ${DPCat.PRODUCTS.length} products · true size from the manufacturer's published dimensions`;
    const price = (p) => { const pb = (App.sample && App.samplePrices ? App.samplePrices : App.config.pricebook).items[p.code]; return pb && pb.sell != null && pb.sell !== "" ? DPPricing.fmtMoney(DPPricing.toMinor(pb.sell), (App.sample && App.samplePrices ? App.samplePrices : App.config.pricebook).currency) : "No price"; };
    box.innerHTML = list.slice(0, 120).map((p) => `<div class="pitem ${p.dims ? "" : "off"}" draggable="${p.dims && !ro() ? "true" : "false"}" data-code="${esc(p.code)}" title="Hover to see the plan symbol">
      <div class="thumbs">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ""}<canvas width="128" height="104" data-sym="${esc(p.code)}"></canvas></div>
      <div><b>${esc(p.name)}</b><div class="meta">${esc(p.displayCode || p.code)} · ${p.dims ? `${f2(p.dims.l)} × ${f2(p.dims.w)} m` : "size per site plan"}${p.age ? " · " + esc(p.age) : ""}</div>
        <div class="meta">Zone ${esc(p.zone ? p.zone.text : "—")} · ${esc(price(p))}${(p.flags || []).some((f) => f.sev !== "info") ? ' · <span style="color:var(--amber)">data note</span>' : ""}</div></div>
      ${p.dims && !ro() ? `<button type="button" class="add" data-add="${esc(p.code)}" title="Add to the plan">+</button>` : ""}</div>`).join("") || `<div class="empty small">No products match.</div>`;
    $$(".pitem", box).forEach((it) => {
      it.ondragstart = (e) => { e.dataTransfer.setData("text/dp-item", JSON.stringify({ code: it.dataset.code })); e.dataTransfer.effectAllowed = "copy"; };
      it.onclick = (e) => { if (e.target.closest("[data-add]")) return; if (!ro() && DPCat.BY[it.dataset.code].dims) placeProduct(it.dataset.code); };
    });
    $$("[data-add]", box).forEach((b) => (b.onclick = () => quickAddProduct(b.dataset.add)));
    $$("canvas[data-sym]", box).forEach((cv) => symbolThumb(cv, DPCat.BY[cv.dataset.sym]));
  }
  /** Draw a product/element symbol into a small canvas. */
  function symbolThumb(cv, p, el) {
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    const L = p ? (p.dims ? p.dims.l : 1) : (el.l || el.d || 4), W = p ? (p.dims ? p.dims.w : 1) : (el.w || el.d || 3);
    const s = Math.min((cv.width - 10) / L, (cv.height - 10) / W);
    const Pn = new DPPen({ kind: "canvas", ctx, minLine: 0.6 }); Pn.setMatrix([s, 0, 0, s, cv.width / 2, cv.height / 2]);
    if (p) { if (p.dims) DPSymbols.drawProduct(Pn, p, { lod: s, mode: "design" }); }
    else if (el.kind === "point") DPSymbols.drawPointElement(Pn, el, L, W, { lod: s });
    else if (el.kind === "area") { const a = 3.2, b = 2.4; Pn.setMatrix([cv.width / 4.2 / 1, 0, 0, cv.height / 3.2, cv.width / 2, cv.height / 2]); DPSymbols.drawArea(Pn, el, [[-a / 2 + 0.3, -b / 2 + 0.1], [a / 2, -b / 2 + 0.3], [a / 2 - 0.2, b / 2], [-a / 2 + 0.1, b / 2 - 0.2]], {}); }
    else { const k = cv.width / 6; Pn.setMatrix([k, 0, 0, k, cv.width / 2, cv.height / 2]); DPSymbols.drawLine(Pn, el, [[-2.4, 0.9], [-0.6, -0.8], [0.8, 0.6], [2.4, -0.6]], { width: Math.min(el.width, 0.9), textSize: 9 }); }
  }

  /* --- elements tab --- */
  function elementsTab(B) {
    const w = !ro();
    B.innerHTML = `<div class="panel"><div class="chips">${DPCat.GROUPS.filter((g) => !["terrain", "play"].includes(g.key) || U.planner3dOn()).map((g) => `<button type="button" class="chip ${P.group === g.key ? "is-on" : ""}" data-grp="${g.key}">${esc(g.label)}</button>`).join("")}</div>
      <div class="row between"><span class="small muted">Areas are drawn as</span><div class="seg"><button type="button" data-am="rect" class="${P.areaMode === "rect" ? "is-on" : ""}">Rectangle</button><button type="button" data-am="poly" class="${P.areaMode === "poly" ? "is-on" : ""}">Polygon</button></div></div>
      <div class="etiles">${DPCat.ELEMENTS.filter((e) => e.group === P.group && (!e.added3d || U.planner3dOn())).map((e) => `<button type="button" class="etile" data-etype="${e.id}" draggable="${e.kind === "point" && w ? "true" : "false"}" ${w ? "" : "disabled"} title="${esc(e.note || e.name)}"><canvas width="104" height="80" data-esym="${e.id}"></canvas>${esc(e.name)}<small>${e.kind === "point" ? (e.shape === "circle" ? `⌀ ${e.d} m` : `${e.l} × ${e.w} m`) : e.kind === "line" ? "draw a route · " + (e.unit === "m2" ? "m²" : "m") : "draw an area · m²"}${e.costable ? "" : " · not priced"}</small></button>`).join("")}</div>
      ${P.group === "generic" ? `<div class="note warn small">Generic items are not Dupedia catalogue products. Their sizes are typical starting points: set the real dimensions and enter the supplier's safety clearance in the properties.</div>` : ""}
      ${P.group === "custom" ? `<p class="tiny muted">Custom areas, objects and lines can carry their own price and category (set in the properties panel).</p>` : ""}</div>`;
    $$("[data-grp]", B).forEach((b) => (b.onclick = () => { P.group = b.dataset.grp; elementsTab(B); }));
    $$("[data-am]", B).forEach((b) => (b.onclick = () => { P.areaMode = b.dataset.am; elementsTab(B); }));
    $$("[data-etype]", B).forEach((b) => { b.onclick = () => placeElement(b.dataset.etype); b.ondragstart = (e) => { e.dataTransfer.setData("text/dp-item", JSON.stringify({ type: b.dataset.etype })); }; });
    $$("canvas[data-esym]", B).forEach((cv) => symbolThumb(cv, null, DPCat.EL[cv.dataset.esym]));
  }

  /* --- layers tab --- */
  function layersTab(B) {
    const groups = [["Products", (o) => o.kind === "product"], ["Objects", (o) => o.kind === "point"], ["Lines", (o) => o.kind === "line"], ["Areas", (o) => o.kind === "area"]];
    const per = C.validation.per;
    B.innerHTML = `<div class="panel">${S.project.objects.length ? groups.map(([g, f]) => { const list = S.project.objects.filter(f); if (!list.length) return "";
      return `<div class="sect"><h4>${g} (${list.length})</h4><div class="layers">${list.slice().reverse().map((o) => { const iss = per[o.id] || [], e = iss.some((i) => i.sev === "error"), w = iss.some((i) => i.sev === "warning");
        return `<div class="lyr ${S.selection.has(o.id) ? "is-sel" : ""} ${o.hidden ? "hid" : ""}" data-lid="${o.id}"><span class="ic">${o.kind === "product" ? "P" : o.kind === "point" ? "O" : o.kind === "line" ? "L" : "A"}</span><span class="nm">${esc(M.objName(o))}${e ? ' <span class="pill err">!</span>' : w ? ' <span class="pill warn">!</span>' : ""}</span>
        <button type="button" data-lh="${o.id}" title="${o.hidden ? "Show" : "Hide"}">${svg(o.hidden ? "eyeOff" : "eye")}</button><button type="button" data-ll="${o.id}" title="${o.locked ? "Unlock" : "Lock"}">${svg(o.locked ? "lock" : "unlock")}</button></div>`; }).join("")}</div></div>`; }).join("") : `<div class="empty small">Nothing on the plan yet.</div>`}
      <p class="tiny muted">Top of each list is drawn on top. Use Arrange › Bring to front / Send to back to change the order.</p></div>`;
    $$("[data-lid]", B).forEach((r) => (r.onclick = (e) => { if (e.target.closest("button")) return; const id = r.dataset.lid; if (e.shiftKey || e.metaKey || e.ctrlKey) { S.selection.has(id) ? S.selection.delete(id) : S.selection.add(id); } else { S.selection.clear(); S.selection.add(id); } const o = M.byId(id); const b = M.bounds(o); if (b) C.centerOn([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]); refresh(); }));
    $$("[data-lh]", B).forEach((b) => (b.onclick = () => { if (ro()) return; const o = M.byId(b.dataset.lh); o.hidden = !o.hidden; if (o.hidden) S.selection.delete(o.id); M.commit(o.hidden ? "Hide" : "Show"); refresh(); }));
    $$("[data-ll]", B).forEach((b) => (b.onclick = () => { if (ro()) return; const o = M.byId(b.dataset.ll); o.locked = !o.locked; M.commit(o.locked ? "Lock" : "Unlock"); refresh(); }));
  }

  /* ---------------- right panel: properties ---------------- */
  function right() {
    ensureTerrain();
    const R = $("#right"), sel = M.selected(), w = !ro();
    if (!sel.length) return R.innerHTML = summaryPanel();
    if (sel.length > 1) {
      const kinds = {}; sel.forEach((o) => (kinds[o.kind] = (kinds[o.kind] || 0) + 1));
      R.innerHTML = `<div class="panel"><span class="eyebrow">Selection</span><h3>${sel.length} items</h3><p class="small muted">${Object.entries(kinds).map(([k, n]) => `${n} ${k === "point" ? "object" : k}${n > 1 ? "s" : ""}`).join(", ")}. Drag any of them to move the group.</p>
        <div class="row"><button class="btn sm ghost" data-a="rotate" ${w ? "" : "disabled"}>Rotate ${C.angle}°</button><button class="btn sm ghost" data-a="duplicate" ${w ? "" : "disabled"}>Duplicate</button><button class="btn sm ghost" data-a="lock" ${w ? "" : "disabled"}>Lock / unlock</button><button class="btn sm danger" data-a="delete" ${w ? "" : "disabled"}>Delete</button></div>
        <div class="sect"><h4>Align</h4><div class="row">${[["left", "Left"], ["hcenter", "Centre"], ["right", "Right"], ["top", "Top"], ["vcenter", "Middle"], ["bottom", "Bottom"]].map(([k, l]) => `<button class="btn ghost xs" data-al="${k}" ${w ? "" : "disabled"}>${l}</button>`).join("")}</div>
        <div class="row"><button class="btn ghost xs" data-al="dh" ${sel.length > 2 && w ? "" : "disabled"}>Distribute ↔</button><button class="btn ghost xs" data-al="dv" ${sel.length > 2 && w ? "" : "disabled"}>Distribute ↕</button></div></div></div>`;
      $$("[data-a]", R).forEach((b) => (b.onclick = () => act(b.dataset.a))); $$("[data-al]", R).forEach((b) => (b.onclick = () => arrange(b.dataset.al)));
      return;
    }
    const o = sel[0]; R.innerHTML = o.kind === "product" ? productProps(o) : o.kind === "point" ? pointProps(o) : o.kind === "line" ? lineProps(o) : areaProps(o);
    const hv = $("canvas[data-psym]", R); if (hv) symbolThumb(hv, o.kind === "product" ? DPCat.BY[o.code] : null, o.kind !== "product" ? DPCat.EL[o.type] : null);
    bindProps(R, o);
  }
  const pos = (o, w) => `<div class="grid3"><label class="field"><span>X</span><div class="unit"><input class="in sm num" data-f="x" type="number" step="0.01" value="${f2(o.x).replace(/,/g, "")}" ${w ? "" : "disabled"}><em>m</em></div></label><label class="field"><span>Y</span><div class="unit"><input class="in sm num" data-f="y" type="number" step="0.01" value="${f2(o.y).replace(/,/g, "")}" ${w ? "" : "disabled"}><em>m</em></div></label><label class="field"><span>Rotation</span><div class="unit"><input class="in sm num" data-f="rot" type="number" step="1" value="${Math.round((o.rot || 0) * 10) / 10}" ${w ? "" : "disabled"}><em>°</em></div></label></div>`;
  const heightField = (o, w) => (U.planner3dOn() ? `<label class="field"><span>Height above ground</span><div class="unit"><input class="in sm num" data-f="z" type="number" min="-20" max="50" step="0.05" value="${o.z || 0}" ${w ? "" : "disabled"}><em>m</em></div></label><p class="tiny muted">Shown in 3D, added to the ground height. Quantities, prices and checks don't use it yet.</p>${groundLine(o)}${o.kind === "product" ? libraryFields(o, w) : ""}${o.kind === "point" ? structureFields(o, w) : ""}` : "");
  /** What the 3D library knows about this product. Shown once 3D has been opened, because its data loads with the 3D view. */
  function libraryFields(o, w) {
    if (!root.DPScene3D) return ""; const r = root.DPScene3D.libraryRecord(o.code, root.DP_MODELS, (App.config.catalog || {}).models), acc = r ? r.accuracy : "block-out", cols = (r && r.colours) || [], mats = (r && r.materials) || [];
    const say = { "block-out": "Block-out: catalogue size, not the real shape.", approximate: "Approximate model: catalogue size, details interpreted. Not for manufacturing.", reviewed: `Reviewed model${r && r.reviewedBy ? ` (${esc(r.reviewedBy)})` : ""}. Not an engineering drawing.` }[acc];
    return `<p class="tiny muted"><b>3D:</b> ${say}</p>${mats.length ? `<p class="tiny muted"><b>Materials:</b> ${esc(mats.join(", "))}</p>` : ""}${cols.length ? `<label class="field"><span>Colour (recorded. Shows on block-outs, not yet on models)</span><select class="in sm" data-f="finish" ${w ? "" : "disabled"}><option value="">Not chosen</option>${cols.map((c) => `<option value="${esc(c.id)}"${o.finish === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}`;
  }
  const common = (o, w) => `<label class="field"><span>Note (internal)</span><textarea class="in sm" data-f="note" rows="2" ${w ? "" : "disabled"} placeholder="Visible to the team, not on the proposal">${esc(o.note || "")}</textarea></label>
    <div class="row"><button class="btn ghost sm" data-a="duplicate" ${w ? "" : "disabled"}>Duplicate</button><button class="btn ghost sm" data-a="lock" ${w ? "" : "disabled"}>${o.locked ? "Unlock" : "Lock"}</button><button class="btn ghost sm" data-a="hide" ${w ? "" : "disabled"}>Hide</button><button class="btn danger sm" data-a="delete" ${w && !o.locked ? "" : "disabled"}>Delete</button></div>`;
  const issuesFor = (o) => { const iss = C.validation.per[o.id] || []; return iss.length ? `<div class="issues">${iss.map((i) => `<div class="iss ${i.sev}"><i></i><span>${esc(i.msg)}</span></div>`).join("")}</div>` : `<div class="note ok small">No conflicts found for this item.</div>`; };
  const priceLine = (key) => { const r = App.pricing && App.pricing.lines.find((l) => l.key === key); if (!r) return ""; return `<dl class="kv"><dt>Unit price</dt><dd>${r.unitMinor == null ? '<span style="color:var(--red)">Not priced</span>' : esc(U.money(r.unitMinor))}</dd><dt>Quantity in quote</dt><dd>${esc(DPPricing.fmtQty(r.qty, r.unit))} ${esc(DPPricing.UNIT_LABEL[r.unit])}</dd><dt>Line total</dt><dd>${r.counted ? esc(U.money(r.totalMinor)) : "—"}</dd></dl>`; };
  function productProps(o) {
    const s = M.shapes(o), p = s.p, w = !ro() && !o.locked;
    if (!p) return `<div class="panel"><h3>${esc(o.code)}</h3><div class="note err">This product is no longer in the catalogue.</div>${common(o, !ro())}</div>`;
    const same = DPCat.PRODUCTS.filter((x) => x.dims && !x.inactive);
    const flags = (p.flags || []).filter((f) => f.sev !== "info");
    return `<div class="panel"><div class="prop-head"><canvas data-psym="1" width="144" height="112"></canvas><div><span class="eyebrow">${esc(p.collectionName || "Product")}</span><h3>${esc(p.name)}</h3><p class="small muted">${esc(p.displayCode || p.code)}${p.age ? " · " + esc(p.age) : ""}</p></div></div>
      ${p.thumb ? `<img src="${esc(p.thumb)}" alt="${esc(p.name)} photograph" style="width:100%;border-radius:10px;border:1px solid var(--line)">` : ""}
      <dl class="kv"><dt>Footprint</dt><dd>${f2(p.dims.l)} × ${f2(p.dims.w)} m${p.dims.h ? ` · H ${f2(p.dims.h)}` : ""}</dd><dt>Footprint area</dt><dd>${m2(p.dims.l * p.dims.w)}</dd><dt>Published safety zone</dt><dd>${esc(p.zone ? p.zone.text : "—")}</dd>${s.zone ? `<dt>Zone area</dt><dd>${m2(G.area(s.zone))}</dd>` : ""}${p.platform ? `<dt>Platform</dt><dd>${esc(p.platform)}</dd>` : ""}</dl>
      ${!s.zone || s.zoneEntered ? `<details ${s.zoneEntered ? "open" : ""}><summary class="small"><b>Site-specific safety zone</b></summary><p class="tiny muted">Only from the manufacturer's site layout for this product. It is shown as employee-entered on all outputs.</p>
        <div class="grid2"><label class="field"><span>Length</span><div class="unit"><input class="in sm num" data-z="l" type="number" min="0" step="0.05" value="${o.zoneEntered ? o.zoneEntered.l : ""}" ${w ? "" : "disabled"}><em>m</em></div></label><label class="field"><span>Width</span><div class="unit"><input class="in sm num" data-z="w" type="number" min="0" step="0.05" value="${o.zoneEntered ? o.zoneEntered.w : ""}" ${w ? "" : "disabled"}><em>m</em></div></label></div>
        <label class="field"><span>Source</span><input class="in sm" data-z="source" value="${esc(o.zoneEntered ? o.zoneEntered.source || "" : "")}" placeholder="e.g. Soliwood layout drawing rev B, 12 Oct 2026" ${w ? "" : "disabled"}></label></details>` : ""}
      ${flags.length ? `<div class="note warn small">${flags.map((f) => esc(f.text)).join("<br>")}</div>` : ""}
      <div class="sect"><h4>Position</h4>${pos(o, w)}${heightField(o, w)}</div>
      <label class="field"><span>Replace with another product</span><select class="in sm" data-replace ${w ? "" : "disabled"}>${same.map((x) => `<option value="${esc(x.code)}"${x.code === o.code ? " selected" : ""}>${esc((x.displayCode || x.code) + " · " + x.name)}</option>`).join("")}</select><small>Keeps position and rotation; quantities and prices follow.</small></label>
      <div class="sect"><h4>Price</h4>${priceLine(o.code)}</div>
      ${engineeringFor(o)}<div class="sect"><h4>Checks</h4>${issuesFor(o)}</div>${common(o, !ro())}</div>`;
  }
  function pointProps(o) {
    const el = DPCat.EL[o.type], w = !ro() && !o.locked; if (!el) return `<div class="panel"><div class="note err">Unknown element.</div>${common(o, !ro())}</div>`;
    const circle = el.shape === "circle", custom = el.group === "custom", costable = o.costable != null ? o.costable : el.costable;
    return `<div class="panel"><div class="prop-head"><canvas data-psym="1" width="144" height="112"></canvas><div><span class="eyebrow">${esc(DPCat.GROUPS.find((g) => g.key === el.group).label)}</span><h3>${esc(el.name)}</h3>${el.note ? `<p class="tiny muted">${esc(el.note)}</p>` : ""}</div></div>
      ${el.id === "label" ? `<label class="field"><span>Text</span><input class="in" data-f="label" value="${esc(o.label || "")}" ${w ? "" : "disabled"}></label><label class="field"><span>Text height</span><div class="unit"><input class="in sm num" data-f="w" type="number" min="0.1" step="0.05" value="${o.w}" ${w ? "" : "disabled"}><em>m</em></div></label>`
        : `<label class="field"><span>Label on plan (optional)</span><input class="in sm" data-f="label" value="${esc(o.label || "")}" ${w ? "" : "disabled"}></label>
      <div class="sect"><h4>Size</h4>${circle ? `<label class="field"><span>Diameter</span><div class="unit"><input class="in sm num" data-f="d" type="number" min="0.05" step="0.05" value="${o.l}" ${w ? "" : "disabled"}><em>m</em></div></label>` : `<div class="grid2"><label class="field"><span>Length</span><div class="unit"><input class="in sm num" data-f="l" type="number" min="0.05" step="0.05" value="${o.l}" ${w ? "" : "disabled"}><em>m</em></div></label><label class="field"><span>Width</span><div class="unit"><input class="in sm num" data-f="w" type="number" min="0.05" step="0.05" value="${o.w}" ${w ? "" : "disabled"}><em>m</em></div></label></div>`}</div>`}
      <div class="sect"><h4>Position</h4>${pos(o, w)}${heightField(o, w)}</div>
      ${el.generic ? `<details ${o.zoneEntered ? "open" : ""}><summary class="small"><b>Supplier safety clearance</b></summary><div class="grid2"><label class="field"><span>${circle ? "Diameter" : "Length"}</span><div class="unit"><input class="in sm num" data-z="l" type="number" min="0" step="0.05" value="${o.zoneEntered ? o.zoneEntered.l : ""}" ${w ? "" : "disabled"}><em>m</em></div></label>${circle ? "" : `<label class="field"><span>Width</span><div class="unit"><input class="in sm num" data-z="w" type="number" min="0" step="0.05" value="${o.zoneEntered ? o.zoneEntered.w : ""}" ${w ? "" : "disabled"}><em>m</em></div></label>`}</div><label class="field"><span>Source</span><input class="in sm" data-z="source" value="${esc(o.zoneEntered ? o.zoneEntered.source || "" : "")}" ${w ? "" : "disabled"}></label></details>` : ""}
      ${el.id !== "label" && (el.group !== "terrain" || el.priced3d) ? `<div class="sect"><h4>Quotation</h4>${quoteNote(o)}<label class="check"><input type="checkbox" data-f="costable" ${costable ? "checked" : ""} ${w ? "" : "disabled"}> Include in the quotation</label>
        <label class="field"><span>Material / colour / specification</span><input class="in sm" data-f="material" value="${esc(o.material || "")}" ${w ? "" : "disabled"}></label>
        <label class="field"><span>Code (optional)</span><input class="in sm" data-f="code" value="${esc(o.code || "")}" ${w ? "" : "disabled"}></label>
        ${custom ? customPriceFields(o, w) : costable ? priceLine(M.priceKey(o)) : ""}</div>` : ""}
      ${engineeringFor(o)}<div class="sect"><h4>Checks</h4>${issuesFor(o)}</div>${common(o, !ro())}</div>`;
  }
  function customPriceFields(o, w) {
    const cp = (S.project.pricing.customPrices || {})["obj:" + o.id] || {};
    return `<div class="grid2"><label class="field"><span>Category</span><select class="in sm" data-f="cat" ${w ? "" : "disabled"}>${DPPricing.CAT_ORDER.filter((c) => c !== "additional").map((c) => `<option value="${c}"${(o.cat || DPCat.EL[o.type].cat) === c ? " selected" : ""}>${esc(DPPricing.CAT_LABEL[c])}</option>`).join("")}</select></label>
      <label class="field"><span>Unit price</span><input class="in sm num" data-cp="1" type="number" min="0" step="0.01" value="${cp.unitPrice != null ? cp.unitPrice : ""}" ${w ? "" : "disabled"}></label></div><p class="tiny muted">Recorded with your name; shown as a manual price in the quotation.</p>`;
  }
  function lineProps(o) {
    const el = DPCat.EL[o.type], w = !ro() && !o.locked; const { gaps } = M.gateHosts(); const L = M.lineLengths(o, gaps[o.id]);
    const sameKind = DPCat.ELEMENTS.filter((e) => e.kind === "line" && ((e.group !== "terrain" && !e.added3d) || e.id === o.type || U.planner3dOn())), costable = o.costable != null ? o.costable : el.costable;
    return `<div class="panel"><div class="prop-head"><canvas data-psym="1" width="144" height="112"></canvas><div><span class="eyebrow">Line</span><h3>${esc(el.name)}</h3></div></div>${structureFields(o, w)}
      <dl class="kv"><dt>Length</dt><dd>${f2(L.gross)} m</dd>${L.openings ? `<dt>Gates / openings</dt><dd>− ${f2(L.openings)} m</dd><dt>Net length</dt><dd>${f2(L.net)} m</dd>` : ""}${el.unit === "m2" ? `<dt>Area (net × width)</dt><dd>${m2(L.net * (o.width || el.width))}</dd>` : ""}<dt>Corners</dt><dd>${o.pts.length}</dd></dl>
      <label class="field"><span>Type</span><select class="in sm" data-type ${w ? "" : "disabled"}>${sameKind.map((e) => `<option value="${e.id}"${e.id === o.type ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label>
      <div class="grid2"><label class="field"><span>Width</span><div class="unit"><input class="in sm num" data-f="width" type="number" min="0.01" step="0.01" value="${o.width || el.width}" ${w ? "" : "disabled"}><em>m</em></div></label><label class="field"><span>Label</span><input class="in sm" data-f="label" value="${esc(o.label || "")}" ${w ? "" : "disabled"}></label></div>
      <button class="btn ghost sm" data-a="verts" ${w ? "" : "disabled"}>${C.editVerts === o.id ? "Finish editing corners" : "Edit corners"}</button>
      ${C.editVerts === o.id ? `<p class="tiny muted">Drag corners; double-click a segment to add a corner; select a corner and press Delete to remove it.</p>` : ""}
      ${["fence", "wall", "hedge"].includes(o.type) ? `<p class="tiny muted">Gates placed on this line are deducted from its length automatically. Add one from Elements › Site infrastructure.</p>` : ""}
      ${el.annotation || (el.group === "terrain" && !el.priced3d) ? "" : `<div class="sect"><h4>Quotation</h4>${quoteNote(o)}<label class="check"><input type="checkbox" data-f="costable" ${costable ? "checked" : ""} ${w ? "" : "disabled"}> Include in the quotation</label><label class="field"><span>Material / specification</span><input class="in sm" data-f="material" value="${esc(o.material || "")}" ${w ? "" : "disabled"}></label>${el.group === "custom" ? customPriceFields(o, w) : costable ? priceLine(M.priceKey(o)) : ""}</div>`}
      ${engineeringFor(o)}<div class="sect"><h4>Checks</h4>${issuesFor(o)}</div>${common(o, !ro())}</div>`;
  }
  /* ---------------- terrain panel ---------------- */
  const groundFeatures = () => (root.DPTerrain ? root.DPTerrain.features(S.project) : []);
  function ensureTerrain() { if ((root.DPTerrain && root.DPChecks3D) || P.terrainLoading || !U.planner3dOn() || !S.project.objects.length) return; P.terrainLoading = true; (root.DPTerrain ? Promise.resolve() : DPProposal.loadScript("app/terrain.js")).then(() => (root.DPChecks3D ? null : DPProposal.loadScript("app/checks3d.js"))).then(() => { P.terrainLoading = false; right(); }).catch(() => { P.terrainLoading = false; }); }
  /* ---------------- engineering review prompts ---------------- */
  let engineeringMemo = { key: null, result: null };
  /** The prompts for the current design, worked out once per change. Null while dragging or with the switch off. */
  function engineering() {
    if (P.live || !U.planner3dOn() || !root.DPChecks3D || !root.DPTerrain) return null; const limits = U.engineeringLimits(), models = (App.config.catalog || {}).models, key = JSON.stringify([S.project.objects, S.project.site, limits, models]);
    if (engineeringMemo.key !== key) { const lib = root.DPScene3D; engineeringMemo = { key, result: root.DPChecks3D.run(S.project, limits, { record: lib ? (code) => lib.libraryRecord(code, root.DP_MODELS, models) : null }) }; } return engineeringMemo.result;
  }
  const engRow = (i) => `<div class="iss ${i.sev === "warning" ? "warning" : "info"}"><i></i><span>${esc(i.msg)}</span></div>`;
  function engineeringFor(o) { const r = engineering(); if (!r) return ""; const list = r.per[o.id] || []; return list.length ? `<div class="sect"><h4>Engineering review</h4><div class="issues">${list.map(engRow).join("")}</div><p class="tiny muted">${esc(root.DPChecks3D.DISCLAIMER)}</p></div>` : ""; }
  function engineeringSummary() {
    const r = engineering(); if (!r || (!r.issues.length && !r.counts.within)) return ""; const shown = r.issues.slice(0, 12), src = r.source, who = src.standard || src.suppliedBy ? `${r.limitsSet} of ${r.limitsTotal} limits entered${src.standard ? `, from ${esc(src.standard)}` : ""}${src.suppliedBy ? `, supplied by ${esc(src.suppliedBy)}` : ""}.` : r.limitsSet ? `${r.limitsSet} of ${r.limitsTotal} limits entered, with no source recorded.` : "No limits have been entered yet, so these can only ask for a review.";
    return `<div class="sect"><h4>Engineering review · ${r.counts.warning} warnings · ${r.counts.review} to review</h4><p class="tiny muted">${who}${U.isAdmin() ? " Set them in Admin › Engineering limits." : ""}</p>
      <div class="issues">${shown.map((i) => (i.ids.length ? `<button type="button" class="eng-row" data-eng="${esc(i.ids[0])}" style="all:unset;display:block;cursor:pointer;width:100%">${engRow(i)}</button>` : engRow(i))).join("")}</div>${r.issues.length > shown.length ? `<p class="tiny muted">and ${r.issues.length - shown.length} more. Select an item to see its own.</p>` : ""}
      <div class="note warn small">${esc(root.DPChecks3D.DISCLAIMER)}</div></div>`;
  }
  function terrainFields(o, el, w) {
    if (!U.planner3dOn()) return `<div class="sect"><h4>Terrain</h4><p class="tiny muted">The 3D view is turned off, so this shape's height can't be edited.</p></div>`;
    if (P.live) return `<div class="sect"><h4>Terrain</h4><p class="tiny muted">Figures update when you let go.</p></div>`;
    const T = root.DPTerrain, lim = T ? T.LIMITS[el.terrain] : null, t = T ? T.params(o) : null, field = (label, key, value, extra = "") => `<label class="field"><span>${label}</span><div class="unit"><input class="in sm num" data-tp="${key}" type="number" step="0.05" value="${value}" ${extra} ${w ? "" : "disabled"}><em>m</em></div></label>`;
    if (!T) return `<div class="sect"><h4>Terrain</h4><p class="tiny muted">Open the 3D view to edit this shape's height.</p></div>`;
    const f = groundFeatures().find((x) => x.id === o.id), s = f ? T.stats(f) : null, pct = s && s.slopePct != null ? `${Math.round(s.slopePct)}%${s.slopeRatio ? ` (1 in ${f2(s.slopeRatio)})` : ""}` : "Vertical sides";
    return `<div class="sect"><h4>Terrain</h4>${field(el.terrain === "level" ? "Height (below 0 sinks it)" : "Height", "height", t.height, `min="${lim.min}" max="${lim.max}"`)}
      ${el.terrain === "platform" ? "" : field(el.terrain === "hill" ? "Slope length, from edge to full height (blank: to the middle)" : "Slope length, from edge to full height", "run", t.run == null ? "" : t.run, `min="0"`)}
      ${el.terrain === "hill" ? `<label class="field"><span>Shape</span><select class="in sm" data-tp="profile" ${w ? "" : "disabled"}><option value="round"${t.round ? " selected" : ""}>Rounded</option><option value="straight"${t.round ? "" : " selected"}>Straight sides</option></select></label>` : ""}
      <label class="field"><span>Surface colour</span><select class="in sm" data-tp="surface" ${w ? "" : "disabled"}>${Object.entries(T.SURFACES).map(([k, v]) => `<option value="${k}"${t.surface === k ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
      ${s ? `<dl class="kv"><dt>Highest point</dt><dd>${f2(s.peak)} m</dd><dt>Steepest slope</dt><dd>${pct}</dd><dt>${t.height < 0 ? "Earth removed, about" : "Volume, about"}</dt><dd>${f2(s.volume)} m³</dd></dl>` : ""}
      ${s && !s.reachesHeight ? `<div class="note warn small">This shape is too small for that slope, so it only reaches ${f2(s.peak)} m. Shorten the slope or make the shape larger.</div>` : ""}
      <p class="tiny muted">Estimates for planning, not survey figures or engineering checks. An item reaches the quotation only when it's included and priced.</p></div>`;
  }
  /** Ramps, stairs, walls and tunnels: their real-world dimensions and what those work out to. States figures, never a pass or fail. */
  function structureFields(o, w) {
    const el = DPCat.EL[o.type], T = root.DPTerrain; if (!el || !el.structure || !T || !U.planner3dOn()) return ""; if (P.live) return `<div class="sect"><h4>Dimensions</h4><p class="tiny muted">Figures update when you let go.</p></div>`;
    const t = T.structureParams(o), fs = groundFeatures(), field = (label, key, value, unit, step) => { const l = T.STRUCTURE_LIMITS[el.structure][key]; return `<label class="field"><span>${label}</span><div class="${unit ? "unit" : ""}"><input class="in sm num" data-tp="${key}" type="number" step="${step}" min="${l.min}" max="${l.max}" value="${value}" ${w ? "" : "disabled"}>${unit ? `<em>${unit}</em>` : ""}</div></label>`; };
    const kv = (rows) => `<dl class="kv">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`, note = `<p class="tiny muted">Figures only, not an engineering or accessibility check. Have them reviewed.</p>`;
    if (el.structure === "ramp") { const r = T.rampInfo(o, fs); return `<div class="sect"><h4>Ramp</h4>${field("Rise, low end to high end", "rise", t.rise, "m", 0.05)}${t.rise > 0 ? kv([["Slope", `${f2(r.slopePct)}% (1 in ${f2(r.ratio)})`], ["Low end stands at", `${f2(r.lowY)} m`], ["High end reaches", `${f2(r.highY)} m`], ["Ground at the high end", `${f2(r.groundHigh)} m`]]) : `<p class="tiny muted">Enter a rise to give it a slope in 3D.</p>`}${t.rise > 0 && Math.abs(r.gap) > 0.02 ? `<div class="note warn small">The high end is ${f2(Math.abs(r.gap))} m ${r.gap > 0 ? "above" : "below"} the ground there.</div>` : ""}${note}</div>`; }
    if (el.structure === "stairs") { const r = T.stairInfo(o); return `<div class="sect"><h4>Stairs</h4><div class="grid2">${field("Total rise", "rise", t.rise, "m", 0.05)}${field("Steps", "steps", t.steps, "", 1)}</div>${kv([["Each step rises", `${f2(r.riser * 100)} cm`], ["Each step goes", `${f2(r.going * 100)} cm`], ["Slope", `${f2(r.pitch)}°`]])}${note}</div>`; }
    if (el.structure === "retaining") { const r = T.wallInfo(o, fs); return `<div class="sect"><h4>Retaining wall</h4>${field("Height, from the lowest ground", "height", t.height, "m", 0.05)}${kv([["Top of wall", `${f2(r.top)} m`], ["Length", `${f2(r.length)} m`], ["Face area, about", `${f2(r.face)} m²`], ["Wall volume, about", `${f2(r.volume)} m³`]])}${r.overtop > 0.01 ? `<div class="note warn small">The ground rises ${f2(r.overtop)} m above the top of this wall. Raise it or move it.</div>` : ""}${note}</div>`; }
    if (el.structure === "custom") return `<div class="sect"><h4>Size</h4>${field("Height", "height", t.height, "m", 0.05)}<p class="tiny muted">A custom shape: the height is yours to set. Not a checked design.</p></div>`;
    if (el.structure === "bridge") { const r = T.bridgeInfo(o, fs); return `<div class="sect"><h4>Bridge</h4>${field("Deck above the ground at its ends", "lift", t.lift, "m", 0.05)}${kv([["Length", `${f2(r.length)} m`], ["Deck at the start", `${f2(r.ya)} m`], ["Deck at the end", `${f2(r.yb)} m`], ["Slope", `${f2(Math.abs(r.slopePct))}%`], ["Highest above the ground", `${f2(r.clearance)} m`]])}${note}</div>`; }
    const r = T.tunnels({ objects: [o] }, fs)[0]; return `<div class="sect"><h4>Tunnel</h4>${field("Clear height inside", "clear", t.clear, "m", 0.05)}${kv([["Length", `${f2(r.length)} m`], ["Floor slope", `${f2(Math.abs(r.gradePct))}%`], ["Under the ground", `${f2(r.covered)} m`], ["In the open", `${f2(r.exposed)} m`], ["Least earth above it, away from the mouths", r.covered > 0 ? `${f2(r.leastCover)} m` : "None"], ["Earth to remove, about", `${f2(r.removed)} m³`]])}${note}</div>`;
  }
  function terrainAreaNote(o) {
    if (P.live || !U.planner3dOn()) return ""; const fs = groundFeatures(); if (!fs.length || !root.DPTerrain) return ""; const r = root.DPTerrain.surfaceArea(fs, o.poly); if (Math.abs(r.actual - r.plan) < 0.01) return "";
    return `<div class="note small">On sloping ground this surface covers about ${m2(r.actual)}, against ${m2(r.plan)} on plan. The quotation uses the area on the ground and shows both figures.</div>`;
  }
  function groundLine(o) { if (P.live) return ""; const fs = groundFeatures(); if (!fs.length || !root.DPTerrain) return ""; const s = M.shapes(o); if (s.missing || !s.foot) return ""; const u = root.DPTerrain.under(fs, s.foot); if (Math.abs(u.max) < 0.001 && u.varies < 0.001) return "";
    return `<p class="tiny muted"><b>Ground here:</b> ${f2(u.max)} m at its highest point.${u.varies > 0.02 ? ` It varies by ${f2(u.varies)} m under this item, which stands on the highest point. Check this on site.` : ""}</p>`; }
  function areaProps(o) {
    const el = DPCat.EL[o.type], w = !ro() && !o.locked, A = G.area(o.poly), costable = o.costable != null ? o.costable : el.costable;
    const kinds = DPCat.ELEMENTS.filter((e) => e.kind === "area" && ((!e.terrain && !e.added3d) || e.id === o.type || U.planner3dOn()));
    return `<div class="panel"><div class="prop-head"><canvas data-psym="1" width="144" height="112"></canvas><div><span class="eyebrow">Area</span><h3>${esc(el.name)}</h3></div></div>
      <dl class="kv"><dt>Area</dt><dd>${m2(A)}</dd><dt>Perimeter</dt><dd>${f2(G.perimeter(o.poly))} m</dd><dt>Corners</dt><dd>${o.poly.length}</dd></dl>
      <label class="field"><span>Type</span><select class="in sm" data-type ${w ? "" : "disabled"}>${kinds.map((e) => `<option value="${e.id}"${e.id === o.type ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Label on plan</span><input class="in sm" data-f="label" value="${esc(o.label || "")}" ${w ? "" : "disabled"}></label>
      <button class="btn ghost sm" data-a="verts" ${w ? "" : "disabled"}>${C.editVerts === o.id ? "Finish editing corners" : "Edit corners"}</button>
      ${el.terrain ? terrainFields(o, el, w) : terrainAreaNote(o)}${structureFields(o, w)}${el.annotation || el.noBuild || el.existing || (el.terrain && !el.priced3d) ? "" : `<div class="sect"><h4>Quotation</h4>${quoteNote(o)}<label class="check"><input type="checkbox" data-f="costable" ${costable ? "checked" : ""} ${w ? "" : "disabled"}> Include in the quotation</label><label class="field"><span>Material / colour / thickness</span><input class="in sm" data-f="material" value="${esc(o.material || "")}" ${w ? "" : "disabled"} placeholder="e.g. EPDM 40 mm, lime"></label>${el.group === "custom" ? customPriceFields(o, w) : costable ? priceLine(M.priceKey(o)) : ""}</div>`}
      ${engineeringFor(o)}<div class="sect"><h4>Checks</h4>${issuesFor(o)}</div>${common(o, !ro())}</div>`;
  }
  function bindProps(R, o) {
    $$("[data-a]", R).forEach((b) => (b.onclick = () => { const a = b.dataset.a;
      if (a === "verts") { C.editVerts = C.editVerts === o.id ? null : o.id; C.selVertex = -1; right(); C.req(); return; }
      if (a === "hide") { o.hidden = true; S.selection.delete(o.id); M.commit("Hide"); refresh(); return; } act(a); }));
    $$("[data-f]", R).forEach((inp) => (inp.onchange = () => {
      const f = inp.dataset.f; let v = inp.type === "checkbox" ? inp.checked : inp.value;
      if (inp.type === "number") { v = +v; if (!isFinite(v)) return U.toast("Enter a number.", { err: true }); }
      if (["l", "w", "d", "width"].includes(f) && !(v > 0)) return U.toast("Sizes must be greater than zero.", { err: true });
      if (f === "z") { if (!(v >= -20 && v <= 50)) return U.toast("Enter a height between -20 and 50 m.", { err: true }); if (!v) { delete o.z; M.commit("Edit height"); return refresh(); } }
      if (f === "d") { o.l = o.w = v; } else if (f === "rot") o.rot = G.normAngle(v); else if (f === "costable") o.costable = v; else o[f] = v;
      M.commit("Edit " + f, f === "costable" ? { audit: { action: v ? "Included in quotation" : "Excluded from quotation", detail: M.objName(o) } } : undefined); refresh();
    }));
    $$("[data-tp]", R).forEach((inp) => (inp.onchange = () => {
      const k = inp.dataset.tp, T = root.DPTerrain, el = DPCat.EL[o.type]; if (!T || !(el.terrain || el.structure)) return; let v = inp.value;
      if (el.structure) { v = +v; const lim = T.STRUCTURE_LIMITS[el.structure][k]; if (inp.value === "" || !isFinite(v)) return U.toast("Enter a number.", { err: true }); if (!(v >= lim.min && v <= lim.max)) return U.toast(`Enter a value between ${lim.min} and ${lim.max}.`, { err: true }); if (k === "steps" && !Number.isInteger(v)) return U.toast("Enter a whole number of steps.", { err: true }); o.terrain = Object.assign({}, o.terrain || {}, { [k]: v }); M.commit("Edit dimensions"); return refresh(); }
      if (inp.type === "number") { if (k === "run" && v === "") v = null; else { v = +v; if (inp.value === "" || !isFinite(v)) return U.toast("Enter a number.", { err: true }); } const lim = T.LIMITS[el.terrain];
        if (k === "height" && !(v >= lim.min && v <= lim.max)) return U.toast(`Enter a height between ${lim.min} and ${lim.max} m.`, { err: true }); if (k === "height" && v === 0) return U.toast("A height of 0 changes nothing. Enter a height, or delete this shape.", { err: true }); if (k === "run" && v != null && v < 0) return U.toast("A slope length can't be negative.", { err: true }); }
      o.terrain = Object.assign({}, o.terrain || {}, { [k]: v }); M.commit("Edit terrain"); refresh();
    }));
    $$("[data-z]", R).forEach((inp) => (inp.onchange = () => {
      const z = o.zoneEntered || { l: 0, w: 0, source: "" }; const k = inp.dataset.z; z[k] = k === "source" ? inp.value.trim() : +inp.value || 0;
      if (DPCat.EL[o.type] && DPCat.EL[o.type].shape === "circle") z.w = z.l;
      o.zoneEntered = z.l > 0 && z.w > 0 ? Object.assign(z, { by: U.userInfo().name || "", at: new Date().toISOString() }) : (z.l || z.w || z.source ? z : null);
      M.commit("Safety zone", { audit: { action: "Entered safety zone", detail: `${M.objName(o)}: ${z.l} × ${z.w} m, source: ${z.source || "not given"}` } }); refresh();
    }));
    const rp = $("[data-replace]", R); if (rp) rp.onchange = () => { const old = o.code; o.code = rp.value; o.zoneEntered = null; M.commit("Replace product", { audit: { action: "Replaced product", detail: `${old} → ${o.code}` } }); refresh(); };
    const ty = $("[data-type]", R); if (ty) ty.onchange = () => { const old = o.type; o.type = ty.value; if (o.kind === "line") o.width = DPCat.EL[o.type].width; M.commit("Change type", { audit: { action: "Changed type", detail: `${old} → ${o.type}` } }); refresh(); };
    const cp = $("[data-cp]", R); if (cp) cp.onchange = () => { const key = "obj:" + o.id, v = cp.value === "" ? null : +cp.value; S.project.pricing.customPrices = S.project.pricing.customPrices || {};
      if (v == null) delete S.project.pricing.customPrices[key]; else if (!(v >= 0)) return U.toast("Enter a price of zero or more.", { err: true }); else S.project.pricing.customPrices[key] = { unitPrice: v, by: U.userInfo().name || "local user", at: new Date().toISOString() };
      M.commit("Custom price", { audit: { action: "Set custom item price", detail: `${M.objName(o)}: ${v == null ? "cleared" : v}` } }); refresh(); };
  }
  function terrainTotals() { if (P.live || !U.planner3dOn()) return ""; const fs = groundFeatures(); if (!fs.length) return ""; const v = root.DPTerrain.volumes(fs); return `<dt>Terrain fill, about</dt><dd>${f2(v.fill)} m³</dd>${v.cut ? `<dt>Terrain cut, about</dt><dd>${f2(v.cut)} m³</dd>` : ""}<dt>Highest ground</dt><dd>${f2(v.peak)} m</dd>`; }
  function summaryPanel() {
    const m = M.metrics(), v = C.validation, r = App.pricing;
    const surf = Object.entries(m.surfaces).map(([k, a]) => `<dt>${esc(DPCat.EL[k].name)}</dt><dd>${m2(a)}</dd>`).join("");
    const lens = Object.entries(m.lengths).map(([k, L]) => `<dt>${esc(DPCat.EL[k].name)}</dt><dd>${f2(L.net)} m${L.net !== L.gross ? ` <span class="muted">(${f2(L.gross)} gross)</span>` : ""}</dd>`).join("");
    return `<div class="panel"><span class="eyebrow">Plan summary</span><h3>${esc(S.project.meta.name)}</h3>
      <dl class="kv"><dt>Site area</dt><dd>${m.siteArea ? m2(m.siteArea) : "—"}</dd><dt>Products</dt><dd>${m.products} (${m.productTypes} types)</dd><dt>Equipment footprint</dt><dd>${m2(m.footArea)}</dd><dt>Safety zones (drawn)</dt><dd>${m2(m.zoneArea)}</dd>
        ${m.allocated != null ? `<dt>Allocated (footprint ∪ zones)</dt><dd>${m2(m.allocated)}</dd><dt>Available usable area</dt><dd>${m2(m.usable)}</dd>` : ""}${surf}${lens}${terrainTotals()}</dl>
      ${r ? `<div class="card flat stack" style="padding:12px"><div class="row between"><span class="small muted">Quotation total</span><b class="num">${esc(U.money(r.total))}</b></div>${r.issues.filter((i) => i.code === "unpriced").length ? `<span class="pill err">${r.issues.filter((i) => i.code === "unpriced").length} items not priced</span>` : `<span class="pill ok">All items priced</span>`}<button class="btn sm ghost" id="open-drawer">Open price panel</button></div>` : ""}
      ${engineeringSummary()}<div class="sect"><h4>Checks · ${v.counts.error} errors · ${v.counts.warning} warnings · ${v.counts.info} notes</h4>
        <div class="issues">${v.issues.slice(0, 60).map((i, n) => `<button type="button" class="iss ${i.sev}" data-iss="${n}"><i></i><span>${esc(i.msg)}</span></button>`).join("") || `<div class="note ok small">No conflicts found.</div>`}</div></div>
      <p class="disclaimer">${esc(M.DISCLAIMER)}</p>
      <details><summary class="small"><b>Keyboard shortcuts</b></summary><p class="tiny muted" style="margin-top:6px">V select · H pan · M measure · R rotate (Shift 90°) · L lock · Del delete · Ctrl+D duplicate · Ctrl+C/V copy/paste · Ctrl+Z/Y undo/redo · arrows nudge 10 cm (Shift 1 m, Alt 1 cm) · F fit · Space+drag pan · double-click a line or area to edit its corners.</p></details></div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-iss]"); if (b && App.view === "plan") { const i = C.validation.issues[+b.dataset.iss]; if (i && i.ids.length) { S.selection.clear(); i.ids.forEach((id) => S.selection.add(id)); const bb = G.bbox(i.ids.map(M.byId).filter(Boolean).flatMap((o) => M.outline(o).flat())); if (bb.w >= 0) C.centerOn([(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2]); refresh(); } }
    if (e.target.closest("#open-drawer")) { P.drawer = true; drawer(); }
  });

  /* ---------------- status bar & drawer ---------------- */
  function status() {
    const m = M.metrics(), v = C.validation, r = App.pricing;
    const fence = m.lengths.fence ? m.lengths.fence.net : 0;
    $("#status").innerHTML = `<div class="m"><b>${m.siteArea ? m2(m.siteArea) : "—"}</b><span>Site</span></div><div class="m"><b>${m.products}</b><span>Products</span></div><div class="m"><b>${m2(m.footArea)}</b><span>Footprint</span></div><div class="m"><b>${m2(m.zoneArea)}</b><span>Safety zones</span></div><div class="m"><b>${m2(m.flooring)}</b><span>Flooring</span></div><div class="m"><b>${f2(fence)} m</b><span>Fence (net)</span></div>
      <button type="button" class="m" id="st-iss" title="Show checks"><b>${v.counts.error ? `<span style="color:var(--red)">${v.counts.error} errors</span>` : "0 errors"} · ${v.counts.warning} warn.</b><span>Checks</span></button>
      <span class="sp"></span>${r ? `<button type="button" class="m total-btn" id="st-total" title="Open the price panel"><b>${esc(U.money(r.total))}</b><span>${r.blocking ? "Total · incomplete" : `Total${r.discountPct ? ` · ${r.discountPct}% off` : ""}${r.taxPct ? ` · incl. ${esc(r.taxLabel)}` : ""}`}</span></button>` : ""}`;
    $("#st-iss").onclick = () => { S.selection.clear(); right(); mobile("right"); };
    const t = $("#st-total"); if (t) t.onclick = () => { P.drawer = !P.drawer; drawer(); };
  }
  function drawer() {
    const d = $("#drawer"); if (!P.drawer) { d.hidden = true; return; }
    const r = App.pricing; d.hidden = false; const allowed = DPPricing.allowedDiscounts(U.role(), App.config.settings);
    d.innerHTML = `<div class="drawer-head"><b>Price panel</b><span class="small muted">Live from the plan</span><span class="sp" style="margin-left:auto"></span>
      <div class="seg" role="group" aria-label="Discount">${[0, 5, 10].map((p) => `<button type="button" data-dpct="${p}" class="${r.discountPct === p ? "is-on" : ""}" ${allowed.includes(p) && !ro() ? "" : "disabled"} title="${allowed.includes(p) ? "" : "Not permitted for your role"}">${p ? p + "%" : "No discount"}</button>`).join("")}</div>
      <b class="num">${esc(U.money(r.total))}</b><button class="btn sm" id="dr-quote">Full quotation</button><button class="btn ghost sm" id="dr-x">Close</button></div>
      <div class="drawer-body"><table class="qtable"><tbody>${r.lines.filter((l) => !l.derived).map((l) => `<tr class="${l.status === "unpriced" ? "unpriced" : ""}"><td><span class="code">${esc(l.code || "")}</span> ${esc(l.name)}</td><td class="r">${esc(DPPricing.fmtQty(l.qty, l.unit))} ${esc(DPPricing.UNIT_LABEL[l.unit])}</td><td class="r">${l.unitMinor == null ? '<span class="pill err">No price</span>' : esc(U.money(l.unitMinor))}</td><td class="r">${l.counted ? esc(U.money(l.totalMinor)) : l.status === "exception" ? esc(l.exMode) : "—"}</td></tr>`).join("")}
        <tr><td colspan="3" class="r">Subtotal</td><td class="r">${esc(U.money(r.subtotal))}</td></tr>${r.discount ? `<tr><td colspan="3" class="r">Discount ${r.discountPct}%</td><td class="r">− ${esc(U.money(r.discount))}</td></tr>` : ""}${r.tax ? `<tr><td colspan="3" class="r">${esc(r.taxLabel)} ${r.taxPct}%</td><td class="r">${esc(U.money(r.tax))}</td></tr>` : ""}<tr><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${esc(U.money(r.total))}</b></td></tr></tbody></table></div>`;
    $$("[data-dpct]", d).forEach((b) => (b.onclick = () => DPUI.setDiscount(+b.dataset.dpct)));
    $("#dr-quote", d).onclick = () => U.go("quote"); $("#dr-x", d).onclick = () => { P.drawer = false; drawer(); };
  }

  /* ---------------- versions / templates / exports ---------------- */
  async function saveMenu(k) {
    if (k === "save") return U.save();
    if (k === "saveas") { // 1.1: a separate copy under a new id; the original stays exactly as last saved
      const r = await U.form("Save as a new project", [{ id: "name", label: "New project name", value: `${S.project.meta.name || "Project"} (copy)`, required: true }], { intro: "The current plan, products and project details are saved as a new draft. The original project is not changed." }); if (!r) return;
      if (!App.sample && S.dirty) { const ok = await U.save(); if (!ok) return; }
      const p = JSON.parse(JSON.stringify(S.project)), from = p.meta.ref || p.meta.name;
      Object.assign(p.meta, { id: M.uid("p-"), ownerId: DPStore.st.userId || "local", name: r.name, ref: U.nextRef(), status: "draft", issuedAt: null, issuedBy: null, rev: 0, orderId: null, acceptedAt: null, created: new Date().toISOString() }); p.audit = [];
      U.startProject(p, { cadData: S.cadData, refImage: S.refImage }); App.samplePrices = null; M.audit("Saved as a new project", `from ${from}`);
      const ok = await U.save({ force: true }); if (ok) U.toast(`Saved as “${r.name}”. You are now editing the new project.`, { ms: 6000 }); return; }
    if (k === "version") { const r = await U.form("Save a named version", [{ id: "label", label: "Version name", value: `Option ${new Date().toLocaleDateString()}`, required: true }], { intro: "A snapshot you can compare or restore later. The working project keeps going." }); if (!r) return;
      try { await U.save(); const vid = await DPStore.saveVersion(S.project, r.label, U.userInfo()); M.audit("Saved version", r.label); U.scheduleAutosave(); U.toast(`Version “${r.label}” saved.`); void vid; } catch (e) { U.toast(e.message, { err: true }); } }
    if (k === "versions") versions();
    if (k === "template") { const r = await U.form("Save layout as a template", [{ id: "name", label: "Template name", value: S.project.meta.type ? `${S.project.meta.type} layout` : "Layout", required: true }, { id: "description", label: "Description", type: "textarea", value: "" }], { intro: "The site, products and elements are saved. Client details, prices and notes are not." }); if (!r) return;
      const proj = { site: S.project.site, objects: S.project.objects.map((o) => Object.assign({}, o, { note: "" })) };
      try { await DPStore.saveTemplate({ name: r.name, description: r.description, project: proj, at: new Date().toISOString(), by: U.userInfo().name || "", byId: U.userInfo().id }); U.toast("Template saved. Find it on the Projects page."); } catch (e) { U.toast(e.message, { err: true }); } }
    if (k === "audit") auditLog();
  }
  async function versions() {
    if (App.sample) return U.toast("The sample project has no saved versions.");
    let list = []; try { list = await DPStore.listVersions(S.project.meta.id, S.project.meta.ownerId); } catch (e) { return U.toast("Versions could not be loaded.", { err: true }); }
    U.openModal(`<h2>Versions</h2><p class="small muted">Restoring replaces the working plan with the version (the current state is saved as a version first, so nothing is lost).</p>
      ${list.length ? `<div class="tablewrap"><table class="plist"><thead><tr><th>Version</th><th>Saved</th><th>Objects</th><th></th></tr></thead><tbody>${list.map((v) => `<tr><td><b>${esc(v.label || v.id)}</b></td><td class="small">${esc(new Date(v.at).toLocaleString())}<div class="tiny muted">${esc(v.by || "")}</div></td><td class="num">${v.objects}</td><td><button class="btn ghost xs" data-rv="${esc(v.id)}" ${U.canWrite() ? "" : "disabled"}>Restore</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty small">No versions yet. Use “Save a named version” to keep an option.</div>`}
      <div class="acts"><button class="btn" id="v-x">Close</button></div>`, (m) => {
      $("#v-x", m).onclick = () => U.closeModal();
      $$("[data-rv]", m).forEach((b) => (b.onclick = async () => { const v = await DPStore.getVersion(S.project.meta.id, b.dataset.rv, S.project.meta.ownerId); if (!v) return;
        await DPStore.saveVersion(S.project, `Before restoring ${list.find((x) => x.id === b.dataset.rv).label}`, U.userInfo());
        const keep = { id: S.project.meta.id, clientLogo: S.project.meta.clientLogo, cover: S.project.proposal.coverImage, audit: S.project.audit };
        S.project.site = v.site; S.project.objects = v.objects; S.project.pricing = Object.assign(M.newProject().pricing, v.pricing); S.project.proposal = Object.assign(M.newProject().proposal, v.proposal, { coverImage: keep.cover });
        S.project.audit = keep.audit; M.commit("Restore version", { audit: { action: "Restored version", detail: list.find((x) => x.id === b.dataset.rv).label } }); U.closeModal(); C.fit(); refresh(); U.scheduleAutosave(); U.toast("Version restored."); }));
    }, { wide: true });
  }
  function auditLog() {
    const a = (S.project.audit || []).slice().reverse();
    U.openModal(`<h2>Change log</h2><p class="small muted">Product changes, price overrides, discounts, exceptions and issue events, with who and when.</p>
      ${a.length ? `<div class="tablewrap" style="max-height:60vh"><table class="plist"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${a.map((e) => `<tr><td class="small">${esc(new Date(e.at).toLocaleString())}</td><td class="small">${esc(e.by)}${e.role === "admin" ? ' <span class="pill dark">admin</span>' : ""}</td><td class="small"><b>${esc(e.action)}</b></td><td class="small">${esc(e.detail)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty small">No changes recorded yet.</div>`}
      <div class="acts"><button class="btn" id="a-x">Close</button></div>`, (m) => ($("#a-x", m).onclick = () => U.closeModal()), { wide: true });
  }
  async function doExport(k) {
    try {
      if (k === "png" || k === "pngd") { const b = U.busy("Rendering the plan…"); const out = await DPIO.exportPng(4000, k === "png" ? "presentation" : "design", k === "png" ? { dims: true } : {}); b.done(); return U.downloadOut(out, "Plan image"); }
      if (k === "dxf") return U.downloadOut(await DPIO.exportDxf(), "Technical drawing");
      if (k === "csv") return U.downloadOut(DPIO.exportScheduleCsv(), "Product schedule");
      if (k === "json") return U.downloadOut(DPIO.exportJson(), "Project file");
      if (k === "tech") { const b = U.busy("Building the technical drawing…"); const out = await DPProposal.technical(); b.done(); return U.downloadOut(out, "Technical drawing"); }
    } catch (e) { U.closeModal(); U.toast(e.message || "Export failed.", { err: true }); }
  }

  /* ---------------- mobile ---------------- */
  function mobile(which) {
    if (window.innerWidth > 860) return; P.mobile = which; $("#view-plan").dataset.m = which;
    $$(".mtabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.mt === which));
    if (which === "canvas") setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
  }

  /* ---------------- 3D view (off unless an administrator turned it on; its code loads on first use) ---------------- */
  const is3D = () => !!(root.DPView3D && root.DPView3D.isOpen);
  function sync3D() { const b = $("#tb-3d"); if (!b) return; if (is3D() && !U.planner3dOn()) root.DPView3D.close(); b.hidden = !U.planner3dOn(); b.classList.toggle("lime", is3D()); b.setAttribute("aria-pressed", is3D() ? "true" : "false"); b.textContent = is3D() ? "2D" : "3D"; b.title = is3D() ? "Back to the 2D plan" : "Show this plan in 3D"; }
  function close3D() { if (is3D()) { root.DPView3D.close(); sync3D(); window.dispatchEvent(new Event("resize")); } }
  async function toggle3D() {
    if (is3D()) return close3D();
    const b = $("#tb-3d"); if (!U.planner3dOn() || !b || b.disabled) return;
    b.disabled = true; b.textContent = "Loading…";
    try {
      if (!root.DPTerrain) await DPProposal.loadScript("app/terrain.js");
      if (!root.DPChecks3D) await DPProposal.loadScript("app/checks3d.js");
      if (!root.DPScene3D) await DPProposal.loadScript("app/scene3d.js");
      if (!root.DP_MODELS) await DPProposal.loadScript("models/manifest.js").catch(() => { root.DP_MODELS = {}; });   // without the list, every product is simply a block-out
      if (!root.DPView3D) await DPProposal.loadScript("app/view3d.js");
      await root.DPView3D.open($("#canvas-wrap"));
    } catch (e) { U.toast(e.code === "webgl" ? e.message : "3D could not load. Check the connection. The 2D plan keeps working.", { err: true }); }
    b.disabled = false; sync3D();
  }

  /* ---------------- refresh & render ---------------- */
  let rafR = 0;
  function refresh() { U.pricing(); C.validation = M.validate(); syncToolbar(); right(); status(); if (P.drawer) drawer(); if (P.tab === "layers" || P.tab === "site") left(); C.req(); U.header(); }
  function renderPlan() {
    if (!P.inited) {
      toolbar(); C.init($("#cv")); P.inited = true;
      $("#right").addEventListener("click", (e) => { const b = e.target.closest("[data-eng]"); if (!b) return; const o = M.byId(b.dataset.eng); if (!o) return; S.selection.clear(); S.selection.add(o.id); M.emit("select"); right(); });
      const mt = document.createElement("nav"); mt.className = "mtabs"; mt.innerHTML = `<button data-mt="left">Library</button><button data-mt="canvas" class="is-on">Plan</button><button data-mt="right">Properties</button>`;
      $("#view-plan").insertBefore(mt, $(".work")); mt.onclick = (e) => { const b = e.target.closest("[data-mt]"); if (b) mobile(b.dataset.mt); };
      M.on("select", () => { syncToolbar(); right(); if (P.tab === "layers") left(); });
      M.on("change", () => { if (App.view !== "plan") return; cancelAnimationFrame(rafR); rafR = requestAnimationFrame(refresh); U.scheduleAutosave(); });
      M.on("live", () => { if (App.view === "plan") { cancelAnimationFrame(rafR); rafR = requestAnimationFrame(() => { P.live = true; right(); P.live = false; }); } });   // while dragging, terrain figures wait until release
      M.on("mode", () => { if (C.mode) close3D(); syncToolbar(); });
      M.on("view", () => zoomLabel());
      M.on("loaded", () => { P.drawer = false; });
    }
    C.readOnly = ro(); left(); refresh();
  }
  U.register("plan", renderPlan);
  Object.assign(DPUI, { planTab, refreshPlan: refresh, versions, auditLog, symbolThumb, placeProduct, quickAddProduct, placeElement, startDraw, setSite, act, arrange, planState: P });
})(typeof self !== "undefined" ? self : this);
