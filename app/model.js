/* Dupedia Site Planner 2.0 — project model: state, history, geometry of objects, take-off quantities, metrics, validation.
   No DOM. All coordinates are metres in a y-down plane. */
/* global DPGeom, DPCat */
(function (root) {
  "use strict";
  const G = DPGeom;
  const uid = (p = "o") => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------------- events ---------------- */
  const listeners = {};
  const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; };
  const emit = (ev, data) => (listeners[ev] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error(ev, e); } });

  /* ---------------- project ---------------- */
  function newProject(o = {}) {
    const id = uid("p-");
    return {
      format: "dupedia-sp2-project", v: 2,
      meta: Object.assign({ id, ref: "", name: "Untitled project", client: "", location: "", type: "", preparedBy: "", date: today(), description: "",
        status: "draft", created: new Date().toISOString(), updated: null, createdBy: null, updatedBy: null, rev: 0, clientLogo: null, images: [] }, o.meta || {}),
      site: o.site || null,                 // {poly, source, north (deg), dims:{w,l}}
      objects: o.objects || [],
      cad: null, ref: null,
      pricing: Object.assign({ currency: null, fx: null, discountPct: 0, taxEnabled: true, overrides: {}, exceptions: {}, extras: [], customPrices: {} }, o.pricing || {}),
      proposal: Object.assign({ objectives: "", scope: "", assumptions: "", exclusions: "", installation: "", payment: "", delivery: "", validity: "", warranty: "", acceptance: "", coverImage: null }, o.proposal || {}),
      audit: [],
    };
  }
  const S = { project: newProject(), selection: new Set(), cadData: null, refImage: null, user: { id: null, name: "", role: "employee" }, dirty: false };

  /* ---------------- migration: v1 (public planner) → v2 ---------------- */
  function migrateV1(file) {
    const p = file.plan, out = newProject();
    out.meta.name = p.meta && p.meta.name || "Imported plan"; out.meta.location = p.meta && p.meta.location || "";
    out.site = p.site ? Object.assign({ north: 0 }, p.site) : null;
    for (const it of p.items || []) out.objects.push({ id: it.id || uid(), kind: "product", code: it.code, x: it.x, y: it.y, rot: it.rot || 0 });
    for (const ob of p.obstacles || []) out.objects.push({ id: ob.id || uid(), kind: "area", type: "existing", poly: ob.poly, label: ob.label || "Obstacle", traced: !!ob.traced });
    out.cad = p.cad || null; out.ref = p.ref || null;
    return { project: out, cadData: file.cadData || null, refImage: file.refImage || null };
  }

  /* ---------------- object geometry ---------------- */
  const BY = () => DPCat.BY, EL = () => DPCat.EL;
  /** Shapes for overlap/containment tests and drawing. */
  function shapes(o) {
    if (o.kind === "product") {
      const p = BY()[o.code]; if (!p || !p.dims) return { missing: true };
      const foot = G.rectCorners(o.x, o.y, p.dims.l, p.dims.w, o.rot);
      const zsrc = o.zoneEntered && o.zoneEntered.l > 0 ? o.zoneEntered : (p.zone && p.zone.kind === "rect" ? p.zone : null);
      const zone = zsrc ? G.rectCorners(o.x, o.y, zsrc.l, zsrc.w, o.rot) : null;
      return { p, foot, zone, zoneEntered: !!(o.zoneEntered && o.zoneEntered.l > 0), convex: true, blocks: true };
    }
    const el = EL()[o.type]; if (!el) return { missing: true };
    if (o.kind === "point") {
      const circle = el.shape === "circle";
      const foot = circle ? G.circlePoly(o.x, o.y, o.l / 2, 20) : G.rectCorners(o.x, o.y, o.l, o.w, o.rot || 0);
      const zone = o.zoneEntered && o.zoneEntered.l > 0 ? (circle ? G.circlePoly(o.x, o.y, o.zoneEntered.l / 2, 24) : G.rectCorners(o.x, o.y, o.zoneEntered.l, o.zoneEntered.w, o.rot || 0)) : null;
      return { el, foot, zone, convex: true, blocks: !!el.blocks && !el.overhead, circle };
    }
    if (o.kind === "line") return { el, quads: G.bandQuads(o.pts, o.width || el.width || 0.1), blocks: !!el.blocks };
    if (o.kind === "area") return { el, poly: o.poly, blocks: !!el.blocks, convex: G.isConvex(o.poly) };
    return { missing: true };
  }
  /** Outline polygon(s) used for hit testing and selection bounds. */
  function outline(o) {
    const s = shapes(o); if (s.missing) return [];
    if (o.kind === "product" || o.kind === "point") return [s.foot];
    if (o.kind === "line") return s.quads;
    return [s.poly];
  }
  function bounds(o) { const ps = outline(o).flat(); return ps.length ? G.bbox(ps) : null; }
  function objName(o) {
    if (o.kind === "product") { const p = BY()[o.code]; return p ? `${p.displayCode || p.code} ${p.name}` : o.code; }
    const el = EL()[o.type]; return (o.label && o.kind !== "point" ? o.label + " · " : "") + (el ? el.name : o.type);
  }
  const shortName = (o) => (o.kind === "product" ? (BY()[o.code] ? (BY()[o.code].displayCode || o.code) : o.code) : (o.label || (EL()[o.type] ? EL()[o.type].name : o.type)));

  /* ---------------- gates on fences ---------------- */
  /** For each fence/wall/hedge line: gaps [[t0,t1,gateId]] from gate objects lying on it. For each gate: host line id or null. */
  function gateHosts(objects = S.project.objects) {
    const lines = objects.filter((o) => o.kind === "line" && ["fence", "wall", "hedge"].includes(o.type) && !o.hidden);
    const gates = objects.filter((o) => o.kind === "point" && EL()[o.type] && EL()[o.type].gate);
    const gaps = {}, host = {};
    for (const g of gates) {
      let best = null;
      for (const L of lines) { const pr = G.projectOnPolyline(L.pts, [g.x, g.y]); if (pr && pr.d <= Math.max(0.35, (L.width || 0.1)) && (!best || pr.d < best.pr.d)) best = { L, pr }; }
      if (best) { (gaps[best.L.id] = gaps[best.L.id] || []).push([best.pr.t - g.l / 2, best.pr.t + g.l / 2, g.id]); host[g.id] = best.L.id; }
      else host[g.id] = null;
    }
    return { gaps, host };
  }
  function lineLengths(o, gaps) {
    const gross = G.polylineLength(o.pts), L = gross;
    let open = 0; for (const [a, b] of gaps || []) open += Math.max(0, Math.min(L, b) - Math.max(0, a));
    return { gross, net: Math.max(0, gross - open), openings: open };
  }

  /* ---------------- take-off: quantities by pricing key ---------------- */
  /** Returns rows {key, kind:'product'|'element'|'custom', code|type, name, unit, qty, cat, costable, ids[], basis} grouped by key. */
  function takeoff(project = S.project) {
    const rows = {}, { gaps } = gateHosts(project.objects);
    const add = (key, base, qty, id) => { const r = rows[key] || (rows[key] = Object.assign({ key, qty: 0, ids: [] }, base)); r.qty += qty; r.ids.push(id); };
    for (const o of project.objects) {
      if (o.excludeFromQuote) continue;
      if (o.kind === "product") {
        const p = BY()[o.code];
        add(o.code, { kind: "product", code: o.code, name: p ? p.name : o.code, displayCode: p ? (p.displayCode || p.code) : o.code, unit: "each", cat: DPCat.productCat(p), costable: true, missing: !p }, 1, o.id);
        continue;
      }
      const el = EL()[o.type]; if (!el) continue;
      const costable = o.costable != null ? !!o.costable : el.costable; if (!costable) continue;
      const custom = el.group === "custom";
      const key = custom ? "obj:" + o.id : "el:" + el.id;
      const base = { kind: custom ? "custom" : "element", type: el.id, name: custom ? (o.label || el.name) : el.name, unit: el.unit, cat: o.cat || el.cat, costable: true, code: o.code || null };
      if (o.kind === "point") add(key, base, 1, o.id);
      else if (o.kind === "line") {
        const len = lineLengths(o, (gaps[o.id] || [])), w = o.width || el.width || 0.1;
        add(key, Object.assign(base, { unit: el.unit === "m2" ? "m2" : "m", basis: el.unit === "m2" ? `${w.toFixed(2)} m wide` : (len.openings ? "net of gates" : null) }), el.unit === "m2" ? len.net * w : len.net, o.id);
      } else if (o.kind === "area") add(key, Object.assign(base, { unit: "m2" }), G.area(o.poly), o.id);
    }
    const out = Object.values(rows);
    for (const r of out) r.qty = r.unit === "each" ? r.qty : Math.round(r.qty * 100) / 100;
    const order = { equipment: 0, landscape: 1, flooring: 2, installation: 3, services: 4, additional: 5 };
    return out.sort((a, b) => (order[a.cat] - order[b.cat]) || String(a.code || a.key).localeCompare(String(b.code || b.key)));
  }

  /* ---------------- metrics ---------------- */
  function metrics(project = S.project) {
    const site = project.site && project.site.poly && project.site.poly.length >= 3 ? project.site.poly : null;
    const prods = project.objects.filter((o) => o.kind === "product"), sh = prods.map(shapes).filter((s) => !s.missing);
    const foot = sh.reduce((a, s) => a + G.area(s.foot), 0), zonesSum = sh.reduce((a, s) => a + (s.zone ? G.area(s.zone) : 0), 0);
    const surf = {}, len = {}, counts = {}, { gaps } = gateHosts(project.objects);
    for (const o of project.objects) {
      const el = o.kind !== "product" && EL()[o.type]; if (!el) continue;
      if (o.kind === "area") surf[el.id] = (surf[el.id] || 0) + G.area(o.poly);
      if (o.kind === "line") { const L = lineLengths(o, gaps[o.id]); len[el.id] = len[el.id] || { gross: 0, net: 0 }; len[el.id].gross += L.gross; len[el.id].net += L.net; }
      if (o.kind === "point") counts[el.id] = (counts[el.id] || 0) + 1;
    }
    // allocated area = union of product footprints and drawn zones (sampled within the site bbox)
    let allocated = null, usable = null, blocked = null;
    if (site) {
      const alloc = sh.map((s) => s.zone || s.foot);
      const blockers = project.objects.filter((o) => o.kind === "area" && EL()[o.type] && (EL()[o.type].noBuild || EL()[o.type].existing)).map((o) => o.poly);
      const siteA = G.area(site);
      allocated = alloc.length ? G.coveredArea(site, alloc, 90) : 0;
      blocked = blockers.length ? G.coveredArea(site, blockers, 90) : 0;
      usable = Math.max(0, siteA - (alloc.length || blockers.length ? G.coveredArea(site, alloc.concat(blockers), 90) : 0));
    }
    const flooring = Object.entries(surf).filter(([k]) => EL()[k] && EL()[k].surface).reduce((a, [, v]) => a + v, 0);
    return { siteArea: site ? G.area(site) : 0, perimeter: site ? G.perimeter(site) : 0, bbox: site ? G.bbox(site) : null,
      products: prods.length, productTypes: new Set(prods.map((o) => o.code)).size, footArea: foot, zoneArea: zonesSum, allocated, usable, blocked,
      surfaces: surf, flooring, lengths: len, counts, objects: project.objects.length };
  }

  /* ---------------- validation ---------------- */
  const DISCLAIMER = "Automated geometry check only — not an engineering or safety certification. Safety zones come from the manufacturer's published figures, drawn centred on the equipment because their exact position is not published; they must be verified against the manufacturer's layout and the applicable standard before construction.";
  function validate(project = S.project) {
    const issues = [], per = {};
    const add = (sev, code, msg, ids = []) => { issues.push({ sev, code, msg, ids }); ids.forEach((id) => (per[id] = per[id] || []).push({ sev, msg, code })); };
    const site = project.site && project.site.poly && project.site.poly.length >= 3 ? project.site.poly : null;
    if (!site) add("info", "no-site", "No site boundary yet. Define the site to check containment and areas.");
    else if (G.selfIntersects(site)) add("error", "site-self", "The site boundary crosses itself. Edit its corners so the edges do not cross.");
    const objs = project.objects.filter((o) => !o.hidden);
    const all = objs.map((o) => ({ o, s: shapes(o) }));
    const prods = all.filter((x) => x.o.kind === "product");
    const name = (o) => shortName(o);
    const seen = new Set();
    for (const { o, s } of all) if (s.missing) add("error", "unknown", `${o.kind === "product" ? o.code : o.type}: not found in the catalogue (removed or renamed). Replace or delete it.`, [o.id]);
    for (const { o, s } of prods) {
      if (s.missing) continue;
      const p = s.p;
      if (p.inactive) add("warning", "inactive", `${name(o)}: this product is marked inactive in the catalogue.`, [o.id]);
      if (site) {
        if (!G.polygonInside(s.foot, site)) add("error", "foot-outside", `${name(o)}: equipment extends outside the site boundary.`, [o.id]);
        else if (s.zone && !G.polygonInside(s.zone, site)) add("warning", "zone-outside", `${name(o)}: safety zone extends outside the site boundary.`, [o.id]);
      }
      if (!s.zone) add("info", "zone-missing", `${name(o)}: no drawable safety zone (${p.zone ? p.zone.text : "not published"}). Clearance must come from the manufacturer's site layout.`, [o.id]);
      if (s.zoneEntered) add("info", "zone-entered", `${name(o)}: safety zone entered by an employee${o.zoneEntered.source ? ` (source: ${o.zoneEntered.source})` : " (no source recorded)"}; verify before issue.`, [o.id]);
      for (const f of p.flags || []) if ((f.sev === "high" || f.sev === "medium") && !seen.has(p.code + f.text)) { seen.add(p.code + f.text); add("info", "data-flag", `${p.displayCode || p.code} catalogue note: ${f.text}`, [o.id]); }
    }
    // product vs product
    for (let i = 0; i < prods.length; i++) for (let j = i + 1; j < prods.length; j++) {
      const A = prods[i], B = prods[j]; if (A.s.missing || B.s.missing) continue;
      if (G.convexOverlap(A.s.foot, B.s.foot)) { add("error", "foot-foot", `${name(A.o)} and ${name(B.o)}: equipment overlaps (${G.convexOverlapArea(A.s.foot, B.s.foot).toFixed(2)} m²).`, [A.o.id, B.o.id]); continue; }
      const ab = A.s.zone && G.convexOverlap(A.s.zone, B.s.foot), ba = B.s.zone && G.convexOverlap(B.s.zone, A.s.foot);
      if (ab || ba) add("warning", "zone-foot", `${name(ab ? B.o : A.o)} stands inside the safety zone of ${name(ab ? A.o : B.o)}.`, [A.o.id, B.o.id]);
      else if (A.s.zone && B.s.zone && G.convexOverlap(A.s.zone, B.s.zone)) add("info", "zone-zone", `${name(A.o)} and ${name(B.o)}: safety zones overlap. Whether shared zones are allowed depends on the equipment and the standard; verify.`, [A.o.id, B.o.id]);
    }
    // other objects vs products
    for (const X of all) {
      const { o, s } = X; if (o.kind === "product" || s.missing) continue;
      const el = s.el;
      if (o.kind === "point") {
        if (site && !el.annotation && !G.polygonInside(s.foot, site) && !el.gate) add("warning", "el-outside", `${name(o)} lies partly outside the site boundary.`, [o.id]);
        if (el.generic) add("info", "generic", `${name(o)}: generic item, not a Dupedia catalogue product. Confirm its dimensions and safety clearance with the supplier.`, [o.id]);
        if (el.gate && gateHosts(project.objects).host[o.id] == null) add("info", "gate-free", `${name(o)} is not on a fence or wall line, so no fence length is deducted.`, [o.id]);
        for (const P of prods) { if (P.s.missing) continue;
          if (s.blocks || el.generic) {
            if (G.convexOverlap(s.foot, P.s.foot)) add("error", "el-foot", `${name(o)} overlaps the equipment ${name(P.o)}.`, [o.id, P.o.id]);
            else if (P.s.zone && G.convexOverlap(s.foot, P.s.zone)) add("warning", "el-zone", `${name(o)} is inside the safety zone of ${name(P.o)}.`, [o.id, P.o.id]);
          } else if (el.overhead && G.convexOverlap(s.foot, P.s.foot)) add("info", "overhead", `${name(o)} is above ${name(P.o)}: confirm head-room and fall-height clearance.`, [o.id, P.o.id]);
        }
      } else if (o.kind === "line" && s.blocks) {
        for (const P of prods) { if (P.s.missing) continue;
          if (s.quads.some((q) => G.convexOverlap(q, P.s.foot))) add("error", "line-foot", `${name(o)} crosses the equipment ${name(P.o)}.`, [o.id, P.o.id]);
          else if (P.s.zone && s.quads.some((q) => G.convexOverlap(q, P.s.zone))) add("warning", "line-zone", `${name(o)} crosses the safety zone of ${name(P.o)}.`, [o.id, P.o.id]);
        }
      } else if (o.kind === "area") {
        if (o.poly.length < 3 || G.area(o.poly) < 0.01) add("error", "area-small", `${name(o)} has no area. Redraw it.`, [o.id]);
        else if (G.selfIntersects(o.poly)) add("warning", "area-self", `${name(o)}: its outline crosses itself, so its area may be wrong.`, [o.id]);
        const strict = el.noBuild || el.existing;
        for (const P of prods) { if (P.s.missing) continue;
          if ((strict || el.blocks) && G.polygonsOverlap(P.s.foot, o.poly)) add(strict ? "error" : "warning", "area-foot", `${name(P.o)} stands on ${el.noBuild ? "a restricted / no-build zone" : el.existing ? `the existing obstacle "${o.label || el.name}"` : name(o)}.`, [o.id, P.o.id]);
          else if (strict && P.s.zone && G.polygonsOverlap(P.s.zone, o.poly)) add("warning", "area-zone", `Safety zone of ${name(P.o)} overlaps ${el.noBuild ? "a restricted zone" : `the obstacle "${o.label || el.name}"`}.`, [o.id, P.o.id]);
          else if (el.keepClear && G.polygonsOverlap(P.s.foot, o.poly)) add("warning", "clearance", `${name(P.o)} stands inside the marked clearance area "${o.label || el.name}".`, [o.id, P.o.id]);
        }
        if (strict) for (const Y of all) { if (Y.o.kind !== "point" || Y.s.missing || !Y.s.blocks || Y.s.el.gate) continue; if (G.polygonsOverlap(Y.s.foot, o.poly)) add("warning", "area-el", `${name(Y.o)} is on ${el.noBuild ? "a restricted zone" : `the obstacle "${o.label || el.name}"`}.`, [o.id, Y.o.id]); }
      }
    }
    // safety surfacing reminder (not a rule: prompts a check)
    const surfaces = objs.filter((o) => o.kind === "area" && EL()[o.type] && EL()[o.type].surface).map((o) => o.poly);
    for (const P of prods) { if (P.s.missing || !P.s.zone) continue;
      const cov = surfaces.length ? G.coveredArea(P.s.zone, surfaces, 30) / G.area(P.s.zone) : 0;
      if (cov < 0.95) add("info", "surfacing", `${name(P.o)}: ${surfaces.length ? Math.round(cov * 100) + "% of" : "no"} safety surfacing drawn under its safety zone. Confirm the surfacing requirement.`, [P.o.id]);
    }
    const order = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => order[a.sev] - order[b.sev]);
    const counts = { error: 0, warning: 0, info: 0 }; issues.forEach((i) => counts[i.sev]++);
    return { issues, per, counts };
  }

  /* ---------------- history ---------------- */
  const hist = { past: [], future: [], limit: 150, current: null };
  const snapshot = () => JSON.stringify({ site: S.project.site, objects: S.project.objects, cad: S.project.cad, ref: S.project.ref, pricing: S.project.pricing, meta: { name: S.project.meta.name } });
  function commit(label, opts = {}) {
    hist.past.push(hist.current); hist.future = [];
    if (hist.past.length > hist.limit) hist.past.shift();
    hist.current = snapshot(); hist.lastLabel = label;
    if (opts.audit) audit(opts.audit.action || label, opts.audit.detail || "");
    touch(); emit("change", { label });
  }
  function restore(json) {
    const o = JSON.parse(json); S.project.site = o.site; S.project.objects = o.objects; S.project.cad = o.cad; S.project.ref = o.ref; S.project.pricing = o.pricing;
    for (const id of [...S.selection]) if (!S.project.objects.some((x) => x.id === id)) S.selection.delete(id);
    hist.current = json; touch(); emit("change", { label: "history" });
  }
  const undo = () => { if (!hist.past.length || hist.past[hist.past.length - 1] == null) return false; hist.future.push(hist.current); restore(hist.past.pop()); return true; };
  const redo = () => { if (!hist.future.length) return false; hist.past.push(hist.current); restore(hist.future.pop()); return true; };
  function resetHistory() { hist.past = []; hist.future = []; hist.current = snapshot(); }
  function touch() { S.project.meta.updated = new Date().toISOString(); S.dirty = true; emit("dirty"); }

  /* ---------------- audit ---------------- */
  function audit(action, detail) {
    const e = { at: new Date().toISOString(), by: S.user.name || S.user.id || "local user", byId: S.user.id || null, role: S.user.role, action, detail: String(detail || "").slice(0, 400) };
    S.project.audit = (S.project.audit || []).concat([e]).slice(-300);
    emit("audit", e); return e;
  }

  /* ---------------- object helpers ---------------- */
  function addObject(o, label) { if (!o.id) o.id = uid(); S.project.objects.push(o); if (label !== false) commit(label || "Add"); return o; }
  function byId(id) { return S.project.objects.find((o) => o.id === id); }
  function selected() { return S.project.objects.filter((o) => S.selection.has(o.id)); }
  function removeIds(ids) { const set = new Set(ids); S.project.objects = S.project.objects.filter((o) => !set.has(o.id)); ids.forEach((id) => S.selection.delete(id)); }
  function cloneObj(o, dx = 0, dy = 0) {
    const c = JSON.parse(JSON.stringify(o)); c.id = uid(); c.locked = false;
    if (c.pts) c.pts = c.pts.map(([x, y]) => [x + dx, y + dy]); if (c.poly) c.poly = c.poly.map(([x, y]) => [x + dx, y + dy]);
    if (c.x != null) { c.x += dx; c.y += dy; } return c;
  }
  function translateObj(o, dx, dy) { if (o.pts) o.pts = o.pts.map(([x, y]) => [x + dx, y + dy]); if (o.poly) o.poly = o.poly.map(([x, y]) => [x + dx, y + dy]); if (o.x != null) { o.x += dx; o.y += dy; } }
  function centerOf(o) { if (o.x != null) return [o.x, o.y]; const b = bounds(o); return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0, 0]; }
  function rotateObj(o, deg, about) {
    const c = about || centerOf(o);
    if (o.x != null) { const p = G.rotPt([o.x, o.y], c, deg); o.x = p[0]; o.y = p[1]; o.rot = G.normAngle((o.rot || 0) + deg); }
    if (o.pts) o.pts = o.pts.map((p) => G.rotPt(p, c, deg)); if (o.poly) o.poly = o.poly.map((p) => G.rotPt(p, c, deg));
  }

  /* ---------------- project file ---------------- */
  function projectFile(full = true) { return { format: "dupedia-sp2-project", version: 2, exportedAt: new Date().toISOString(), units: "metres", project: S.project, cadData: full ? S.cadData : null, refImage: full ? S.refImage : null }; }
  function checkProject(obj) {
    if (obj && obj.format === "dupedia-planner-project" && obj.version === 1) return "v1";
    if (!obj || obj.format !== "dupedia-sp2-project" || !obj.project) throw new Error("This is not a Dupedia Site Planner project file.");
    const p = obj.project, num = (v) => typeof v === "number" && isFinite(v), pt = (q) => Array.isArray(q) && q.length === 2 && num(q[0]) && num(q[1]);
    if (!Array.isArray(p.objects) || !p.meta) throw new Error("The project file is incomplete.");
    if (p.objects.length > 5000) throw new Error("The project file has too many objects.");
    for (const o of p.objects) {
      if (!o || typeof o.id !== "string" || !["product", "point", "line", "area"].includes(o.kind)) throw new Error("The project file contains an invalid object.");
      if ((o.kind === "product" || o.kind === "point") && !(num(o.x) && num(o.y))) throw new Error("The project file contains an object without a position.");
      if (o.kind === "line" && !(Array.isArray(o.pts) && o.pts.length >= 2 && o.pts.every(pt))) throw new Error("The project file contains an invalid line.");
      if (o.kind === "area" && !(Array.isArray(o.poly) && o.poly.length >= 3 && o.poly.every(pt))) throw new Error("The project file contains an invalid area.");
    }
    if (p.site && !(Array.isArray(p.site.poly) && p.site.poly.length >= 3 && p.site.poly.every(pt))) throw new Error("The project file contains an invalid site boundary.");
    return "v2";
  }
  function load(project, { cadData = null, refImage = null } = {}) {
    S.project = Object.assign(newProject(), project);
    S.project.meta = Object.assign(newProject().meta, project.meta || {});
    S.project.pricing = Object.assign(newProject().pricing, project.pricing || {});
    S.project.proposal = Object.assign(newProject().proposal, project.proposal || {});
    S.cadData = cadData; S.refImage = refImage; S.selection.clear(); resetHistory(); S.dirty = false;
    emit("loaded", {}); emit("change", { label: "load" });
  }

  root.DPModel = { S, uid, today, on, emit, newProject, migrateV1, shapes, outline, bounds, objName, shortName, gateHosts, lineLengths, takeoff, metrics, validate, DISCLAIMER,
    hist, commit, undo, redo, resetHistory, touch, audit, addObject, byId, selected, removeIds, cloneObj, translateObj, rotateObj, centerOf, projectFile, checkProject, load };
})(typeof self !== "undefined" ? self : this);
