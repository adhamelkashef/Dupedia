/* X FORCE Site Planner 3D — the 3D view. Loaded only when someone presses the 3D button, and it loads the engine the same way,
   so nobody else downloads anything.

   There is one design and two views of it. Edits here run the same calculations as the 2D plan (DPCanvas.editOps) on the same
   objects and finish with the same M.commit, so snapping, undo, autosave, locks and read-only all behave as they do in 2D.
   While dragging, only the items being moved are redrawn and the checks wait until release. It only draws when something
   changes (the camera, the project, the window), so an idle view uses no processor or battery. */
/* global XF3D, DPModel, DPScene3D, DPUI, DPProposal, DPCanvas, DPCat */
(function (root) {
  "use strict";
  const ENGINE = "vendor/three-0.187-xf.min.js", FOV = 40, LABELS_UP_TO = 30, LIME = "#B8D241";
  const VIEWS = [["corner", "Corner"], ["top", "Top"], ["front", "Front"], ["back", "Back"], ["left", "Left"], ["right", "Right"]];
  const PICKABLE = new Set(["product", "element", "surface"]);
  const M = () => root.DPModel, S3 = () => root.DPScene3D, C = () => root.DPCanvas;
  let V = { open: false, wrap: null, el: null, renderer: null, scene: null, camera: null, controls: null, content: null, handles: null, grid: null, sun: null, ro: null, off: [], mats: new Map(), labels: new Map(),
    show: { zones: true, labels: true }, view: "corner", last: null, timer: 0, renders: 0, ray: null, plane: null, drag: null, down: null, drawn: new Set(), hover: 0, models: new Map(), modelIds: new Set(), held: 0, gen: 0 };

  function css() {
    if (document.getElementById("v3d-css")) return;
    const s = document.createElement("style"); s.id = "v3d-css";
    s.textContent = `.v3d{position:absolute;inset:0;background:#E9E7DF;z-index:2;overflow:hidden}.v3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none}
.v3d-bar{position:absolute;left:10px;right:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;pointer-events:none}.v3d-bar>*{pointer-events:auto}
.v3d-bar .seg{background:var(--surface);box-shadow:0 1px 4px rgba(0,0,0,.18)}.v3d-bar .seg button.is-on{background:#B8D241;color:#262626}.v3d-bar .seg select{border:0;background:transparent;color:var(--fg);font:inherit;font-size:12.5px;font-weight:600;padding:5px 8px;max-width:150px;border-radius:999px}
.v3d-note{position:absolute;left:10px;right:10px;bottom:10px;font-size:11.5px;line-height:1.4;color:var(--fg2);background:var(--surface);border-radius:8px;padding:6px 10px;box-shadow:0 1px 4px rgba(0,0,0,.18);max-width:560px;pointer-events:none}
.v3d-note b{font-weight:600;color:var(--fg)}@media (max-width:600px){.v3d-note{pointer-events:auto;cursor:pointer;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.v3d-note.open{display:block}}#view-plan.v3d-on .tg-zoom{opacity:.35;pointer-events:none}`;
    document.head.appendChild(s);
  }

  /* ---------------- drawing ---------------- */
  const req = () => { if (!V.open || V.pending) return; V.pending = true; requestAnimationFrame(() => { V.pending = false; draw(); }); };
  function draw() { if (!V.open || !V.renderer) return; V.renderer.render(V.scene, V.camera); V.renders++; }
  function mat(color, alpha = 1) {
    const k = color + "|" + alpha; let m = V.mats.get(k);
    if (!m) { m = new XF3D.MeshLambertMaterial({ color, transparent: alpha < 1, opacity: alpha, side: XF3D.DoubleSide, depthWrite: alpha >= 1 }); V.mats.set(k, m); }
    return m;
  }
  /** Tints a selected item towards the brand lime, keeping enough of its own colour to tell surfaces apart. */
  function tint(hex) { const a = new XF3D.Color(hex), b = new XF3D.Color(LIME); a.lerp(b, 0.55); return "#" + a.getHexString(); }
  function flatGeo(poly, y, holes) {
    const sh = new XF3D.Shape(poly.map((p) => new XF3D.Vector2(p[0], p[1]))); for (const h of holes || []) sh.holes.push(new XF3D.Path(h.map((p) => new XF3D.Vector2(p[0], p[1])))); const g = new XF3D.ShapeGeometry(sh);
    g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g;
  }
  /** A surface laid over the terrain, following the ground, keeping its exact outline. */
  function drapedGeo(it) {
    const base = new XF3D.ShapeGeometry(new XF3D.Shape(it.poly.map((p) => new XF3D.Vector2(p[0], p[1])))), pos = base.attributes.position, ix = base.index, tris = [];
    for (let i = 0; i < ix.count; i += 3) { const v = (k) => [pos.getX(ix.getX(i + k)), pos.getY(ix.getX(i + k))]; tris.push([v(0), v(1), v(2)]); } base.dispose();
    const tun = V.last.tunnels || [], open = tun.length ? (x, y, e) => root.DPTerrain.tunnelOpen(tun, x, y, e) : null, m = root.DPTerrain.draped(V.last.terrain, tris, it.drape, it.y + bridge(it), open), g = new XF3D.BufferGeometry(); g.setAttribute("position", new XF3D.Float32BufferAttribute(m.positions, 3)); g.setIndex(m.indices); g.computeVertexNormals(); return g;
  }
  /** Two meshes over one slope bend at different points, so a surface lying on terrain rides just high enough to clear it. */
  const bridge = (it) => (it.type === "hill" || it.type === "level" ? 0 : Math.min(0.08, it.drape * 0.15));
  function drapedOutline(it, color) {
    const pts = [], T = root.DPTerrain, n = it.poly.length; for (let i = 0; i < n; i++) { const a = it.poly[i], b = it.poly[(i + 1) % n], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / it.drape)); for (let s = 0; s < k; s++) { const x = a[0] + (b[0] - a[0]) * s / k, y = a[1] + (b[1] - a[1]) * s / k; pts.push(x, T.elevAt(V.last.terrain, x, y) + it.y + bridge(it) + 0.01, y); } }
    const g = new XF3D.BufferGeometry(); g.setAttribute("position", new XF3D.Float32BufferAttribute(pts, 3)); return new XF3D.LineLoop(g, lineMat(color));
  }
  function prismGeo(poly, y0, y1) {
    const sh = new XF3D.Shape(poly.map((p) => new XF3D.Vector2(p[0], p[1]))), g = new XF3D.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, y1, 0); return g;   // the shape's z runs downward after the turn, so it starts at the top
  }
  function outline(poly, y, color) {
    const pts = []; for (const p of poly) pts.push(p[0], y, p[1]);
    const g = new XF3D.BufferGeometry(); g.setAttribute("position", new XF3D.Float32BufferAttribute(pts, 3));
    return new XF3D.LineLoop(g, lineMat(color));
  }
  /** An unseen box at the exact footprint: clicks and drags on a model use the same shape the 2D plan does. */
  function hitMat() { let m = V.mats.get("hit"); if (!m) { m = new XF3D.MeshBasicMaterial({ visible: false }); V.mats.set("hit", m); } return m; }
  function lineMat(color) { const k = "line|" + color; let m = V.mats.get(k); if (!m) { m = new XF3D.LineBasicMaterial({ color }); V.mats.set(k, m); } return m; }
  function labelSprite(text) {
    let tx = V.labels.get(text);
    if (!tx) { const c = document.createElement("canvas"), x = c.getContext("2d"), font = "600 40px " + (getComputedStyle(document.body).fontFamily || "sans-serif"); x.font = font;
      const w = Math.ceil(x.measureText(text).width) + 36; c.width = w; c.height = 68; x.font = font; x.fillStyle = "#262626"; x.beginPath(); x.roundRect(0, 0, w, 68, 12); x.fill(); x.fillStyle = "#FFFFFF"; x.textBaseline = "middle"; x.fillText(text, 18, 36);
      tx = { map: new XF3D.CanvasTexture(c), aspect: w / 68 }; tx.map.colorSpace = XF3D.SRGBColorSpace; V.labels.set(text, tx); }
    const sp = new XF3D.Sprite(new XF3D.SpriteMaterial({ map: tx.map, depthTest: false, sizeAttenuation: false })); sp.scale.set(0.024 * tx.aspect, 0.024, 1); sp.renderOrder = 10; return sp;
  }
  /* ---------------- product models ---------------- */
  /** Each model is fetched once, measured against the catalogue, and only then shown. Until then, or if it fails, the block-out stays. */
  function ensureModel(code, rec) {
    if (V.models.has(code)) return V.models.get(code); const st = { status: "loading", scene: null, info: null, why: "" }, gen = V.gen; V.models.set(code, st);
    (async () => {
      const res = await fetch(rec.file); if (!res.ok) throw new Error("The model file wasn't found."); const buf = await res.arrayBuffer(), info = S3().glbInfo(buf), chk = S3().checkModel(info, DPCat.BY[code]); st.info = info;
      if (!chk.ok) { st.status = "problem"; st.why = chk.problems[0]; return; }
      const parsed = await new Promise((ok, no) => gltfLoader().parse(buf, "", ok, no)); if (gen !== V.gen) { freeModel(parsed.scene); return; }
      parsed.scene.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); st.scene = parsed.scene; st.status = "ready";
    })().catch((e) => { st.status = "problem"; st.why = (e && e.message) || "The model couldn't be read."; }).finally(() => { if (!V.open || gen !== V.gen || !V.last) return;
      const ids = new Set(V.last.items.filter((i) => i.role === "product" && i.code === code).map((i) => i.id)); refreshIds(ids); note(V.last); });
    return st;
  }
  function freeModel(sc) { sc.traverse((m) => { if (m.geometry) m.geometry.dispose(); const list = m.material ? [].concat(m.material) : []; for (const x of list) { if (x.map) x.map.dispose(); x.dispose(); } }); }
  /** Which placed products can show their full model on this device. The rest stay block-outs, and the note says so. */
  function planModels(sc) {
    const small = Math.min(root.innerWidth || 1200, root.innerHeight || 800), budget = small < 500 ? 200000 : small < 900 ? 500000 : 1500000, allowed = new Set(); let spent = 0, held = 0;
    for (const it of sc.items) { if (it.role !== "product" || !it.model) continue; const st = V.models.get(it.code); if (!st || st.status !== "ready") continue; const t = st.info.triangles; if (spent + t > budget) { held++; continue; } spent += t; allowed.add(it.id); }
    V.modelIds = allowed; V.held = held; V.spent = spent;
  }
  function disposeObj(o) { if (o.isSprite) o.material.dispose(); else if (o.geometry) o.geometry.dispose(); }
  function clearContent() { if (!V.content) return; V.content.children.forEach(disposeObj); V.scene.remove(V.content); V.content = null; }
  function addItem(G, it) {
    if (it.role === "zone" && !V.show.zones) return;
    const sel = !V.still && M().S.selection.has(it.id) && PICKABLE.has(it.role), col = sel ? tint(it.color) : it.color, alpha = it.alpha == null ? 1 : it.alpha;
    const tag = (o) => { o.userData = { id: it.id, role: it.role, code: it.code || null }; G.add(o); return o; };
    if (it.t === "flat") { const m = tag(new XF3D.Mesh(it.drape ? drapedGeo(it) : flatGeo(it.poly, it.y, it.holes), mat(col, alpha))); m.receiveShadow = true; if (it.drape && it.top > 0.01 && it.role === "surface" && (it.type === "hill" || it.type === "level")) m.castShadow = true;
      if (it.edge || sel) tag(it.drape ? drapedOutline(it, sel ? "#5B6B12" : it.edge) : outline(it.poly, it.y + 0.002, sel ? "#5B6B12" : it.edge));
      if (it.label && it.labelAt && V.show.labels) { const s = labelSprite(it.label); s.position.set(...it.labelAt); tag(s); } }
    else if (it.t === "prism") { if (it.role === "product" && it.model) ensureModel(it.code, it.model);
      const st = it.role === "product" && it.model && V.modelIds.has(it.id) ? V.models.get(it.code) : null;
      if (st && st.status === "ready") { const inst = st.scene.clone(true); inst.position.set(it.x, it.y0, it.y); inst.rotation.y = -it.rot * Math.PI / 180; tag(inst); }
      const m = tag(new XF3D.Mesh(prismGeo(it.poly, it.y0, it.y1), st && st.status === "ready" ? hitMat() : mat(col, alpha))); m.castShadow = !!it.shadow && !st; m.receiveShadow = !st;
      if ((it.edges && !st) || sel) tag(new XF3D.LineSegments(new XF3D.EdgesGeometry(m.geometry), lineMat(sel ? "#5B6B12" : "#45453F")));
      if (it.label && V.show.labels) { const c = it.poly.reduce((a, p) => [a[0] + p[0] / it.poly.length, a[1] + p[1] / it.poly.length], [0, 0]), s = labelSprite(it.label); s.position.set(c[0], it.y1 + 0.5, c[1]); tag(s); } }
    else if (it.t === "mesh") { const g0 = new XF3D.BufferGeometry(); g0.setAttribute("position", new XF3D.Float32BufferAttribute(it.positions, 3)); g0.setIndex(it.indices); const g = g0.toNonIndexed(); g0.dispose(); g.computeVertexNormals(); const m = tag(new XF3D.Mesh(g, mat(col))); m.castShadow = true; m.receiveShadow = true; }
    else if (it.t === "cyl") { const g = new XF3D.CylinderGeometry(it.d / 2, it.d / 2, it.y1 - it.y0, 18); g.translate(it.x, (it.y0 + it.y1) / 2, it.y); tag(new XF3D.Mesh(g, mat(col))).castShadow = true; }
    else if (it.t === "ball") { const g = new XF3D.SphereGeometry(it.d / 2, 18, 12); g.scale(1, it.sy, 1); g.translate(it.x, it.cy, it.y); const b = tag(new XF3D.Mesh(g, mat(col, alpha))); b.castShadow = it.shadow !== false; }
  }
  const scene = () => S3().buildScene(M().S.project, { modelFor: (code) => S3().libraryRecord(code, root.DP_MODELS, (DPUI.App.config.catalog || {}).models) });
  function build() {
    if (!V.open) return;
    const sc = scene(); V.last = sc; planModels(sc); clearContent();
    if (!V.labelsChosen) { V.show.labels = sc.products <= LABELS_UP_TO; syncBar(); }   // on a busy plan, labels would bury the view until asked for
    const G = new XF3D.Group(); G.name = "content"; for (const it of sc.items) addItem(G, it);
    V.content = G; V.scene.add(G); V.drawn = new Set(M().S.selection); fitGround(sc.bounds); note(sc); refreshHandles(); req();
  }
  /** Redraws only these items from the live project: fast enough to follow a pointer on a large plan. */
  function refreshIds(ids) {
    if (!V.open || !V.content) return; const sc = scene(); V.last = sc; planModels(sc);
    for (const c of [...V.content.children]) if (ids.has(c.userData.id)) { disposeObj(c); V.content.remove(c); }
    for (const it of sc.items) if (ids.has(it.id)) addItem(V.content, it);
    refreshHandles(); req();
  }
  function fitGround(b) {
    const box = b || { cx: 0, cy: 0, w: 30, h: 20, top: 0 }, r = Math.max(10, Math.hypot(box.w, box.h) / 2), half = Math.ceil(r * 1.5 / 5) * 5, size = half * 2;
    if (V.grid) { V.scene.remove(V.grid); V.grid.geometry.dispose(); V.grid.material.dispose(); }
    V.grid = new XF3D.GridHelper(size, size / 5, "#C9C7BE", "#D8D6CD"); V.grid.position.set(Math.round(box.cx / 5) * 5, -0.004, Math.round(box.cy / 5) * 5); V.scene.add(V.grid);
    const s = V.sun, cam = s.shadow.camera, R = r * 1.5; s.position.set(box.cx - R * 0.6, R * 1.3, box.cy + R * 0.5); s.target.position.set(box.cx, 0, box.cy); s.target.updateMatrixWorld();
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = R * 4; cam.updateProjectionMatrix();
  }
  function note(sc) {
    const n = V.el && V.el.querySelector(".v3d-note"); if (!n) return; const esc = DPUI.esc, w = !C().readOnly;
    const parts = [`<b>3D preview. Not for construction.</b> Other heights are illustrative. ${w ? "Tap or click to select. Drag a selected item to move it. Green dot rotates, white square resizes. " : ""}Grid: 5 m.`];
    const prods = sc.items.filter((i) => i.role === "product"), shown = prods.filter((i) => V.modelIds.has(i.id)), blocks = prods.length - shown.length, reviewed = shown.filter((i) => i.accuracy === "reviewed").length, approx = shown.length - reviewed;
    if (blocks) parts.push(`<b>${blocks} block-out${blocks > 1 ? "s" : ""}:</b> catalogue size, not the real shape.`);
    if (approx) parts.push(`<b>${approx} approximate model${approx > 1 ? "s" : ""}:</b> catalogue size, details interpreted. Not for manufacturing.`);
    if (reviewed) parts.push(`<b>${reviewed} reviewed model${reviewed > 1 ? "s" : ""}.</b> Not an engineering drawing.`);
    if (sc.terrain && sc.terrain.length) parts.push("Terrain is calculated from its dimensions.");
    if (V.held) parts.push(`${V.held} kept as block-outs to stay smooth on this device.`);
    for (const [code, st] of V.models) if (st.status === "problem" && prods.some((i) => i.code === code)) parts.push(`<b>${esc(code)} model not shown:</b> ${esc(st.why)}`);
    if (sc.skipped.length) parts.push(`<b>Not shown:</b> ${sc.skipped.slice(0, 6).map((s) => `${esc(s.name)} (${esc(s.why)})`).join(", ")}${sc.skipped.length > 6 ? ` and ${sc.skipped.length - 6} more` : ""}.`);
    parts.push(...sc.notes.map(esc)); n.innerHTML = parts.join(" ");
  }

  /* ---------------- pointer maths ---------------- */
  const size2 = () => { const r = V.renderer.domElement.getBoundingClientRect(); return { r, W: r.width || 1, H: r.height || 1 }; };
  function aim(e) { const { r, W, H } = size2(); V.ray.setFromCamera(new XF3D.Vector2((e.clientX - r.left) / W * 2 - 1, -((e.clientY - r.top) / H) * 2 + 1), V.camera); }
  /** Where the pointer's line of sight meets a flat level, in plan metres. Null when it runs off towards the horizon. */
  function planPoint(e, level) {
    aim(e); V.plane.constant = -level; const hit = V.ray.ray.intersectPlane(V.plane, new XF3D.Vector3()); if (!hit) return null;
    const reach = (V.reach || 200) * 2.5; if (hit.distanceTo(V.camera.position) > reach) return null;
    return [hit.x, hit.z];
  }
  const metresPerPixel = () => { const d = V.camera.position.distanceTo(V.controls.target); return 2 * d * Math.tan(FOV * Math.PI / 360) / size2().H; };
  function pick(e) { aim(e); const list = V.content ? V.content.children.filter((c) => c.isMesh && PICKABLE.has(c.userData.role)) : []; const hit = V.ray.intersectObjects(list, false)[0]; return hit ? { id: hit.object.userData.id, point: hit.point } : null; }
  function screenOf(p) { const { r, W, H } = size2(), v = new XF3D.Vector3(...p).project(V.camera); return [(v.x + 1) / 2 * W + r.left, (1 - v.y) / 2 * H + r.top]; }

  /* ---------------- handles (same rules as the 2D plan: one unlocked placed item) ---------------- */
  function handleTarget() {
    if (C().readOnly) return null; const sel = M().selected(); if (sel.length !== 1) return null; const o = sel[0];
    if (!(o.kind === "product" || o.kind === "point") || o.locked || o.hidden) return null; const s = M().shapes(o); return s.missing ? null : { o, s };
  }
  function handleTex(kind) {
    let tx = V.labels.get("handle:" + kind); if (tx) return tx.map; const c = document.createElement("canvas"); c.width = c.height = 48; const x = c.getContext("2d"); x.lineWidth = 6; x.strokeStyle = "#262626";
    if (kind === "rotate") { x.fillStyle = LIME; x.beginPath(); x.arc(24, 24, 20, 0, Math.PI * 2); x.fill(); x.stroke(); } else { x.fillStyle = "#FFFFFF"; x.fillRect(6, 6, 36, 36); x.strokeRect(6, 6, 36, 36); }
    tx = { map: new XF3D.CanvasTexture(c), aspect: 1 }; tx.map.colorSpace = XF3D.SRGBColorSpace; V.labels.set("handle:" + kind, tx); return tx.map;
  }
  function refreshHandles() {
    if (V.handles) { V.handles.children.forEach(disposeObj); V.scene.remove(V.handles); V.handles = null; } V.handlePts = {};
    const t = handleTarget(); if (!t) return; const { o, s } = t, y = (typeof o.z === "number" ? o.z : 0) + (V.last && V.last.terrain && V.last.terrain.length ? root.DPTerrain.under(V.last.terrain, s.foot).max : 0) + 0.06, G = new XF3D.Group(), { H } = size2(), scale = 15 / H * 2 * Math.tan(FOV * Math.PI / 360);
    const sprite = (kind, p) => { const sp = new XF3D.Sprite(new XF3D.SpriteMaterial({ map: handleTex(kind), depthTest: false, sizeAttenuation: false })); sp.scale.set(scale, scale, 1); sp.renderOrder = 20; sp.position.set(p[0], y, p[1]); G.add(sp); V.handlePts[kind] = [p[0], y, p[1]]; };
    const reach = Math.max(...s.foot.map((p) => Math.hypot(p[0] - o.x, p[1] - o.y))) + 26 * metresPerPixel(), a = (o.rot || 0) * Math.PI / 180, rh = [o.x + Math.cos(a) * reach, o.y + Math.sin(a) * reach];
    const ln = new XF3D.BufferGeometry(); ln.setAttribute("position", new XF3D.Float32BufferAttribute([o.x, y, o.y, rh[0], y, rh[1]], 3)); let lm = V.mats.get("handle-line"); if (!lm) { lm = new XF3D.LineBasicMaterial({ color: "#262626", depthTest: false }); V.mats.set("handle-line", lm); } const line = new XF3D.Line(ln, lm); line.renderOrder = 19; G.add(line);
    sprite("rotate", rh);
    if (o.kind === "point" && DPCat.EL[o.type] && DPCat.EL[o.type].resizable) sprite("resize", C().editOps.resizeHandle(o));
    V.handles = G; V.scene.add(G);
  }
  function handleAt(e) {
    const near = e.pointerType === "touch" ? 24 : 13, t = handleTarget(); if (!t) return null;
    for (const kind of ["resize", "rotate"]) { const p = (V.handlePts || {})[kind]; if (!p) continue; const s = screenOf(p), d = Math.hypot(s[0] - e.clientX, s[1] - e.clientY); if (d >= near) continue;
      // on screen a small item's handle sits close to its middle: a press nearer the middle means "move it"
      const c = screenOf([t.o.x, p[1], t.o.y]); if (Math.hypot(c[0] - e.clientX, c[1] - e.clientY) < d) continue; return kind; }
    return null;
  }

  /* ---------------- editing ---------------- */
  const label = { move: "Move", rotate: "Rotate", resize: "Resize" };
  function startDrag(e, d) { V.drag = Object.assign({ moved: false, sx: e.clientX, sy: e.clientY, pointerId: e.pointerId }, d); V.controls.enabled = false; try { V.renderer.domElement.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer has nothing to capture */ } }
  function onDown(e) {
    if (e.button !== 0 || V.drag) return;
    if (!e.isPrimary) { V.down = null; return; }   // a second finger means pinch or orbit, not a tap
    V.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (C().readOnly) return;
    const kind = handleAt(e);
    if (kind) { const t = handleTarget(); startDrag(e, { kind, o: t.o, level: (V.handlePts[kind] || [0, 0])[1], ids: new Set([t.o.id]) }); return; }
    const hit = pick(e); if (!hit || !M().S.selection.has(hit.id)) return;   // dragging anything else orbits, so looking around can't move the design
    const movers = M().selected().filter((o) => !o.locked), lead = M().byId(hit.id); if (!lead || lead.locked || !movers.length) return;
    const w0 = planPoint(e, hit.point.y); if (!w0) return;
    startDrag(e, Object.assign({ kind: "move", w0, level: hit.point.y, ids: new Set(movers.map((o) => o.id)), terrain: movers.some((o) => DPCat.EL[o.type] && DPCat.EL[o.type].terrain) }, C().editOps.moveStart(lead, movers)));
  }
  function applyDrag(e) {
    const d = V.drag, far = Math.hypot(e.clientX - d.sx, e.clientY - d.sy); if (!d.moved && far < (e.pointerType === "touch" ? 6 : 3)) return;
    const w = planPoint(e, d.level); if (!w) return; d.moved = true; const ops = C().editOps;
    if (d.kind === "move") ops.moveTo(d, d.w0, w, { free: e.altKey, axis: e.shiftKey, tol: 7 * metresPerPixel() });
    else if (d.kind === "rotate") ops.rotateTo(d.o, w, e.altKey); else ops.resizeTo(d.o, w, e.altKey);
    if (d.terrain) { if (!V.buildQueued) { V.buildQueued = true; requestAnimationFrame(() => { V.buildQueued = false; build(); }); } } else refreshIds(d.ids);
    M().emit("live");
  }
  function onMove(e) {
    if (V.drag) { if (e.pointerId === V.drag.pointerId) applyDrag(e); return; }
    if (e.pointerType === "mouse" && !e.buttons && !V.hover) V.hover = requestAnimationFrame(() => { V.hover = 0; if (!V.open || V.drag) return; let cur = "";
      if (handleAt(e)) cur = "grab"; else { const h = pick(e); if (h) { const o = M().byId(h.id); cur = !M().S.selection.has(h.id) ? "pointer" : o && o.locked ? "not-allowed" : C().readOnly ? "default" : "move"; } }
      V.renderer.domElement.style.cursor = cur; });
  }
  function onUp(e) {
    if (V.drag) { if (e.pointerId !== V.drag.pointerId) return; const d = V.drag; V.drag = null; V.down = null; V.controls.enabled = true; C().guidesNow = []; if (d.moved) M().commit(label[d.kind]); refreshHandles(); req(); return; }
    const dn = V.down; V.down = null; if (!dn || dn.id !== e.pointerId || e.button !== 0) return; if (Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > (e.pointerType === "touch" ? 8 : 4)) return;   // that was an orbit, not a tap
    const hit = pick(e), S = M().S, add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (hit) { if (add) { S.selection.has(hit.id) ? S.selection.delete(hit.id) : S.selection.add(hit.id); } else if (!(S.selection.size === 1 && S.selection.has(hit.id))) { S.selection.clear(); S.selection.add(hit.id); } }
    else if (!add && S.selection.size) S.selection.clear(); else return;
    M().emit("select");
  }
  function onSelect() { if (!V.open || !V.content) return; const now = new Set(M().S.selection), ids = new Set([...V.drawn, ...now]); V.drawn = now; refreshIds(ids); }

  /* ---------------- camera ---------------- */
  function aimCamera(pos, target, dist) {
    V.setting = true; V.camera.position.set(...pos); V.controls.target.set(...target); V.camera.near = Math.max(0.05, dist / 500); V.camera.far = dist * 8; V.camera.updateProjectionMatrix();
    V.controls.minDistance = 1; V.controls.maxDistance = dist * 3; V.reach = dist * 3; V.controls.update(); V.setting = false; refreshHandles(); syncBar(); req();
  }
  function setView(view) {
    V.view = view; V.savedId = null; const r = V.wrap.getBoundingClientRect(), c = S3().cameraFor(view, V.last && V.last.bounds, FOV, r.width / Math.max(1, r.height));
    aimCamera(c.pos, c.target, c.dist);
  }
  function applySaved(id) {
    const v = S3().savedViews(M().S.project).find((x) => x.id === id); if (!v) return; const r = V.wrap.getBoundingClientRect(), fit = S3().cameraFor("corner", V.last && V.last.bounds, FOV, r.width / Math.max(1, r.height));
    V.view = null; V.savedId = id; aimCamera(v.pos, v.target, Math.max(fit.dist, Math.hypot(v.pos[0] - v.target[0], v.pos[1] - v.target[1], v.pos[2] - v.target[2])));
  }
  async function saveView() {
    const list = S3().savedViews(M().S.project), r = await DPUI.form("Save this view", [{ id: "name", label: "View name", value: `View ${list.length + 1}`, required: true }], { submit: "Save view", intro: "Saved with the project, so everyone working on it can return to this camera." }); if (!r || !V.open) return;
    try { const p = V.camera.position, t = V.controls.target, v = S3().addView(M().S.project, r.name, [p.x, p.y, p.z], [t.x, t.y, t.z]); V.savedId = v.id; V.view = null; viewsChanged(`Saved view "${v.name}"`); } catch (e) { DPUI.toast(e.message, { err: true }); }
  }
  function deleteView() { const v = S3().savedViews(M().S.project).find((x) => x.id === V.savedId); if (!v) return; S3().removeView(M().S.project, v.id); V.savedId = null; viewsChanged(`Deleted view "${v.name}"`); }
  function viewsChanged(what) { M().audit(what, "3D view"); M().touch(); DPUI.scheduleAutosave(); syncBar(); }
  function syncBar() {
    if (!V.el) return;
    V.el.querySelectorAll("[data-v3v]").forEach((b) => b.classList.toggle("is-on", b.dataset.v3v === V.view));
    V.el.querySelectorAll("[data-v3s]").forEach((b) => { const on = !!V.show[b.dataset.v3s]; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    const box = V.el.querySelector("[data-v3saved]"); if (!box) return; const esc = DPUI.esc, list = S3().savedViews(M().S.project), w = !C().readOnly;
    box.hidden = !w && !list.length;
    box.innerHTML = `${list.length ? `<select data-v3pick aria-label="Saved views"><option value="">Saved views</option>${list.map((v) => `<option value="${esc(v.id)}"${v.id === V.savedId ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select>` : ""}${w ? `<button type="button" data-v3save>Save view</button>` : ""}${w && V.savedId ? `<button type="button" data-v3del>Delete</button>` : ""}`;
    const pk = box.querySelector("[data-v3pick]"); if (pk) pk.onchange = () => { if (pk.value) applySaved(pk.value); else { V.savedId = null; syncBar(); } };
  }

  /* ---------------- open and close ---------------- */
  function size() { const r = V.wrap.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; V.renderer.setSize(r.width, r.height, false); V.camera.aspect = r.width / r.height; V.camera.updateProjectionMatrix(); refreshHandles(); draw(); }
  async function open(wrap) {
    if (V.open) return true;
    if (!root.XF3D) await root.DPProposal.loadScript(ENGINE, 30000);
    css(); V.wrap = wrap; const el = document.createElement("div"); el.className = "v3d"; el.id = "v3d";
    el.innerHTML = `<div class="v3d-bar"><div class="seg" role="group" aria-label="Camera view">${VIEWS.map(([k, l]) => `<button type="button" data-v3v="${k}">${l}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Saved views" data-v3saved></div>
      <div class="seg" role="group" aria-label="Show in 3D"><button type="button" data-v3s="zones">Safety zones</button><button type="button" data-v3s="labels">Labels</button></div></div><div class="v3d-note" role="note"></div>`;
    let r;
    try { r = new XF3D.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false }); }
    catch (e) { throw Object.assign(new Error("This device can't show 3D. The 2D plan keeps working."), { code: "webgl" }); }
    r.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2)); r.outputColorSpace = XF3D.SRGBColorSpace; r.shadowMap.enabled = true; r.setClearColor("#E9E7DF");
    el.insertBefore(r.domElement, el.firstChild); r.domElement.setAttribute("aria-label", "3D view of the site plan"); wrap.appendChild(el);
    r.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (V.renderer !== r) return;   /* closing 3D releases this on purpose */ close(); syncPlanButton(); DPUI.toast("3D stopped because the device ran low on graphics memory. The 2D plan keeps working.", { err: true }); });
    V.el = el; V.renderer = r; V.open = true; V.scene = new XF3D.Scene(); V.camera = new XF3D.PerspectiveCamera(FOV, 1, 0.1, 2000); V.ray = new XF3D.Raycaster(); V.plane = new XF3D.Plane(new XF3D.Vector3(0, 1, 0), 0);
    V.scene.add(new XF3D.HemisphereLight("#FFFFFF", "#B9B6AB", 2.2));
    V.sun = new XF3D.DirectionalLight("#FFFFFF", 2); V.sun.castShadow = true; V.sun.shadow.mapSize.set(2048, 2048); V.sun.shadow.bias = -0.0005; V.scene.add(V.sun, V.sun.target);
    // these run before the orbit control's own listener, so a drag on a selected item can claim the pointer first
    r.domElement.addEventListener("pointerdown", onDown, true); r.domElement.addEventListener("pointermove", onMove); r.domElement.addEventListener("pointerup", onUp); r.domElement.addEventListener("pointercancel", onUp);
    V.controls = new XF3D.OrbitControls(V.camera, r.domElement); V.controls.enableDamping = false; V.controls.screenSpacePanning = false; V.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    V.controls.addEventListener("change", () => { if (!V.open) return; if (!V.setting && !V.drag && (V.view || V.savedId)) { V.view = null; V.savedId = null; syncBar(); } refreshHandles(); req(); });
    el.addEventListener("click", (e) => { const nt = e.target.closest(".v3d-note"); if (nt) { nt.classList.toggle("open"); return; } const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.v3v) setView(b.dataset.v3v);
      if (b.dataset.v3s) { V.show[b.dataset.v3s] = !V.show[b.dataset.v3s]; if (b.dataset.v3s === "labels") V.labelsChosen = true; syncBar(); build(); }
      if ("v3save" in b.dataset) saveView();
      if ("v3del" in b.dataset) deleteView(); });
    // Library items dropped here land where the pointer meets the ground, with the same grid snap as the 2D plan. The plan's own
    // drop handler sits behind this view and would read the pointer through the hidden 2D zoom, so it must not see these events.
    const isItem = (e) => [...(e.dataTransfer.types || [])].includes("text/dp-item");
    el.addEventListener("dragover", (e) => { if (!isItem(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; });
    el.addEventListener("drop", (e) => { if (!isItem(e)) return; e.preventDefault(); e.stopPropagation(); const v = e.dataTransfer.getData("text/dp-item"), w = v && planPoint(e, 0); if (!w) return;
      const G = root.DPGeom, c = C(); M().emit("drop-item", { item: JSON.parse(v), w: [c.snap ? G.snap(w[0], c.step) : w[0], c.snap ? G.snap(w[1], c.step) : w[1]] }); });
    V.ro = new ResizeObserver(size); V.ro.observe(wrap);
    const again = () => { clearTimeout(V.timer); V.timer = setTimeout(build, 120); };
    V.off = [M().on("change", again), M().on("select", onSelect), M().on("loaded", () => { V.savedId = null; V.labelsChosen = false; build(); setView("corner"); })];
    document.getElementById("view-plan").classList.add("v3d-on");
    size(); build(); setView("corner"); return true;
  }
  function close() {
    if (!V.open) return; V.open = false; clearTimeout(V.timer); if (V.hover) { cancelAnimationFrame(V.hover); V.hover = 0; } V.off.forEach((f) => f()); V.off = []; if (V.ro) V.ro.disconnect();
    // a drag cut short (the view closing mid-gesture) must not leave items half moved
    if (V.drag && V.drag.moved) M().commit(label[V.drag.kind]); V.drag = null; V.down = null;
    V.gen++; V.models.forEach((st) => { if (st.scene) freeModel(st.scene); }); V.models.clear(); V.modelIds = new Set();
    clearContent(); if (V.handles) { V.handles.children.forEach(disposeObj); V.handles = null; } if (V.grid) { V.grid.geometry.dispose(); V.grid.material.dispose(); V.grid = null; }
    V.mats.forEach((m) => m.dispose()); V.mats.clear(); V.labels.forEach((l) => l.map.dispose()); V.labels.clear();
    V.controls.dispose(); if (V.sun.shadow.map) V.sun.shadow.map.dispose(); V.renderer.dispose(); V.renderer.forceContextLoss(); if (V.el) V.el.remove();
    Object.assign(V, { el: null, renderer: null, scene: null, camera: null, controls: null, sun: null, last: null, savedId: null, handlePts: null });
    const vp = document.getElementById("view-plan"); if (vp) vp.classList.remove("v3d-on");
  }
  /* ---------------- still images for client documents ---------------- */
  /** Reads a model without touching the open view's own copies. Anything that fails stays a block-out, and the document's note says so. */
  async function stillModel(code, rec) {
    const st = { status: "problem", scene: null, info: null };
    try { const res = await fetch(rec.file); if (!res.ok) return st; const buf = await res.arrayBuffer(), info = S3().glbInfo(buf); st.info = info; if (!S3().checkModel(info, DPCat.BY[code]).ok) return st; const parsed = await new Promise((ok, no) => gltfLoader().parse(buf, "", ok, no)); parsed.scene.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); st.scene = parsed.scene; st.status = "ready"; } catch (e) { st.status = "problem"; }
    return st;
  }
  /** Renders each shot off screen and returns JPEGs, kept in memory only: a picture this size would not survive a project save anyway.
   *  It borrows the view's own drawing code by standing in for its state, with no waiting while it does, so an open 3D view is never disturbed.
   *  shots: [{ id, name, view | pos+target, w, h }] */
  async function renderStills(project, shots) {
    if (!root.XF3D) await root.DPProposal.loadScript(ENGINE, 30000);
    const sc = S3().buildScene(project, { modelFor: (code) => S3().libraryRecord(code, root.DP_MODELS, (DPUI.App.config.catalog || {}).models) }), codes = new Map();
    for (const it of sc.items) if (it.role === "product" && it.model) codes.set(it.code, it.model);
    const models = new Map(); await Promise.all([...codes].map(async ([code, rec]) => { models.set(code, await stillModel(code, rec)); }));
    const outer = V, out = []; let r = null;
    try {
      r = new XF3D.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.outputColorSpace = XF3D.SRGBColorSpace; r.shadowMap.enabled = true; r.setClearColor("#EFEDE6");
      V = { open: false, still: true, renderer: r, scene: new XF3D.Scene(), camera: new XF3D.PerspectiveCamera(FOV, 1, 0.1, 2000), content: null, grid: null, sun: new XF3D.DirectionalLight("#FFFFFF", 2), mats: new Map(), labels: new Map(), show: { zones: false, labels: false }, last: sc, models, modelIds: new Set(), held: 0 };
      V.scene.add(new XF3D.HemisphereLight("#FFFFFF", "#B9B6AB", 2.2)); V.sun.castShadow = true; { const px = Math.min(root.innerWidth || 1200, root.innerHeight || 800) < 500 ? 2048 : 4096; V.sun.shadow.mapSize.set(px, px); } V.sun.shadow.bias = -0.0005; V.scene.add(V.sun, V.sun.target);
      planModels(sc); const G = new XF3D.Group(); for (const it of sc.items) addItem(G, it); V.content = G; V.scene.add(G); fitGround(sc.bounds); if (V.grid) V.grid.visible = false;
      const prods = sc.items.filter((i) => i.role === "product"), shown = prods.filter((i) => V.modelIds.has(i.id)), reviewed = shown.filter((i) => i.accuracy === "reviewed").length;
      const box = new XF3D.Box3().setFromObject(G), mid = box.getCenter(new XF3D.Vector3()), corners = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new XF3D.Vector3(x, y, z));
      /** Moves a preset camera along its own line until the design fills the frame, keeping a small margin. Saved cameras stay where they were put. */
      const closeIn = (c, aspect) => { const cam = V.camera, dir = new XF3D.Vector3(...c.pos).sub(mid).normalize(), far = new XF3D.Vector3(...c.pos).distanceTo(mid), aim = mid.clone(), tan = Math.tan(FOV * Math.PI / 360); cam.aspect = aspect; cam.updateProjectionMatrix();
        const place = (d) => { cam.position.copy(aim).addScaledVector(dir, d); cam.lookAt(aim); cam.updateMatrixWorld(); }, seen = () => corners.map((p) => p.clone().project(cam)), fits = (d) => { place(d); return seen().every((q) => Math.abs(q.x) <= 0.93 && Math.abs(q.y) <= 0.93 && q.z < 1); }; let best = far;
        for (let pass = 0; pass < 4; pass++) { let lo = far * 0.2, hi = far * 1.5; for (let i = 0; i < 18; i++) { const d = (lo + hi) / 2; if (fits(d)) hi = d; else lo = d; } best = hi; place(best); if (pass === 3) break; const q = seen(), xs = q.map((v) => v.x), ys = q.map((v) => v.y), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2; aim.addScaledVector(new XF3D.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), cx * best * tan * aspect).addScaledVector(new XF3D.Vector3().setFromMatrixColumn(cam.matrixWorld, 1), cy * best * tan); }
        return { pos: aim.clone().addScaledVector(dir, best).toArray(), target: aim.toArray() }; };
      for (const s of shots) { const aspect = s.w / s.h, c = s.pos ? { pos: s.pos, target: s.target } : closeIn(S3().cameraFor(s.view, sc.bounds, FOV, aspect), aspect); r.setSize(s.w, s.h, false); V.camera.aspect = aspect; V.camera.updateProjectionMatrix(); V.camera.position.set(...c.pos); V.camera.lookAt(...c.target); r.render(V.scene, V.camera); if (r.getContext().isContextLost()) throw new Error("The 3D context was lost."); out.push({ id: s.id, name: s.name, data: r.domElement.toDataURL("image/jpeg", 0.86), w: s.w, h: s.h }); }
      return { images: out, info: { blockouts: prods.length - shown.length, approx: shown.length - reviewed, reviewed } };
    } finally {
      try { clearContent(); if (V.grid) { V.grid.geometry.dispose(); V.grid.material.dispose(); } V.mats.forEach((m) => m.dispose()); if (V.sun && V.sun.shadow.map) V.sun.shadow.map.dispose(); models.forEach((st) => { if (st.scene) freeModel(st.scene); }); if (r) { r.dispose(); r.forceContextLoss(); } } finally { V = outer; }
    }
  }
  function syncPlanButton() { if (root.DPUI && root.DPUI.refreshPlan) { root.DPUI.refreshPlan(); root.dispatchEvent(new Event("resize")); } }
  /** GLB/glTF loader that works under the app's security policy. The default loader reads embedded textures with fetch(), which
   *  connect-src 'self' refuses for blob: addresses, and the model then loads with its textures missing and no error at all.
   *  Reading them as images (img-src allows blob:) keeps them. Tested in the browser; use this for every model. */
  function gltfLoader() { const L = new XF3D.GLTFLoader(); L.register((p) => { p.textureLoader = new XF3D.TextureLoader(p.options.manager); return { name: "xf_image_textures" }; }); return L; }
  root.DPView3D = { open, close, gltfLoader, renderStills, get isOpen() { return V.open; }, _debug: V };
})(typeof self !== "undefined" ? self : this);
