/* Site Planner: what the 2D editor does with real pointer gestures (move, snap, align, rotate, resize, select, lock, read-only).
   The real app/canvas.js runs here with a stand-in for the browser. The baseline in edit2d.json was recorded from the untouched
   canvas.js before 3D editing began, so sharing its logic with 3D cannot quietly change 2D.

     node qa/planner/edit2d.test.js            compare with the baseline
     node qa/planner/edit2d.test.js --update   rewrite it (only for a 2D change you approved) */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app"), GOLD = path.join(__dirname, "edit2d.json");

const ls = {}, doc = { getElementById: () => null, querySelector: () => null, activeElement: null, addEventListener() {} };
const noopCtx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const cv = { style: {}, listeners: {}, width: 0, height: 0, parentElement: { addEventListener() {} }, focus() {}, setPointerCapture() {}, getContext: () => noopCtx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }), addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); } };
const ctx = { console, document: doc, requestAnimationFrame: () => 0, ResizeObserver: class { observe() {} }, devicePixelRatio: 1, Image: class {} };
ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = (k, f) => { (ls[k] = ls[k] || []).push(f); }; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "planrender", "canvas"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPCanvas: C } = ctx;
C.init(cv);

/* screen = world × 20 px per metre, so a world point maps exactly onto the pointer */
const px = (w) => ({ clientX: w[0] * 20, clientY: w[1] * 20 });
const ev = (w, o = {}) => Object.assign({ pointerId: 1, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} }, px(w), o);
const fire = (k, e) => cv.listeners[k].forEach((f) => f(e));
const gesture = (from, steps, o = {}) => { fire("pointerdown", ev(from, o)); for (const w of steps) fire("pointermove", ev(w, o)); fire("pointerup", ev(steps[steps.length - 1] || from, o)); };
const SITE = { poly: [[0, 0], [40, 0], [40, 30], [0, 30]], north: 0 };
function start(objects, { readOnly = false, snap = true, step = 0.5, angle = 15, guides = true } = {}) {
  const p = M.newProject(); p.site = SITE; p.objects = objects; M.load(p); M.S.selection.clear(); Object.assign(C, { readOnly, snap, step, angle, guides, tool: "select", mode: null, editVerts: null, v: { scale: 20, ox: 0, oy: 0 }, W: 1000, H: 800 });
}
const state = () => JSON.parse(JSON.stringify({ objects: M.S.project.objects, selected: [...M.S.selection].sort(), history: M.hist.past.length, label: M.hist.lastLabel || null }));
const P = (id, code, x, y, rot = 0, extra = {}) => Object.assign({ id, kind: "product", code, x, y, rot }, extra);
const T = (id, type, x, y, l, w, rot = 0, extra = {}) => Object.assign({ id, kind: "point", type, x, y, l, w, rot }, extra);
const handle = (o) => C.toW ? null : null;

const CASES = {
  "move snaps to the 0.5 m grid": () => { start([P("a", "SW-A409", 10, 10)]); gesture([10, 10], [[10, 10]]); gesture([10, 10], [[13.13, 12.37]]); },
  "alt moves freely, without snapping": () => { start([P("a", "SW-A409", 10, 10)]); gesture([10, 10], [[13.13, 12.37]], { altKey: true }); },
  "shift keeps the move on one axis": () => { start([P("a", "SW-A409", 10, 10)]); gesture([10, 10], [[14.4, 11.1]], { shiftKey: true }); },
  "a move aligns to a neighbour within 7 px": () => { start([P("a", "SW-A409", 10, 10), P("b", "SW-A409", 25, 20)]); gesture([10, 10], [[14.2, 20.1]]); },
  "guides off means grid only": () => { start([P("a", "SW-A409", 10, 10), P("b", "SW-A409", 25, 20)], { guides: false }); gesture([10, 10], [[14.2, 20.1]]); },
  "snap off moves exactly": () => { start([P("a", "SW-A409", 10, 10)], { snap: false, guides: false }); gesture([10, 10], [[11.234, 12.345]]); },
  "a tiny move under 3 px is not an edit": () => { start([P("a", "SW-A409", 10, 10)]); gesture([10, 10], [[10.1, 10.05]]); },
  "dragging a surface snaps its move to the grid": () => { start([{ id: "r", kind: "area", type: "rubber", poly: [[20, 5], [24, 5], [24, 9], [20, 9]] }]); gesture([22, 7], [[24.13, 8.37]]); },
  "alt drags a surface freely": () => { start([{ id: "r", kind: "area", type: "rubber", poly: [[20, 5], [24, 5], [24, 9], [20, 9]] }]); gesture([22, 7], [[24.13, 8.37]], { altKey: true }); },
  "dragging a line snaps its move to the grid": () => { start([{ id: "f", kind: "line", type: "fence", pts: [[2, 20], [8, 20], [8, 25]], width: 0.08 }]); gesture([5, 20], [[6.13, 22.37]]); },
  "with snap off a surface moves exactly": () => { start([{ id: "r", kind: "area", type: "rubber", poly: [[20, 5], [24, 5], [24, 9], [20, 9]] }], { snap: false }); gesture([22, 7], [[24.13, 8.37]]); },
  "several moves in one drag land where the last one says": () => { start([P("a", "SW-A409", 10, 10)]); gesture([10, 10], [[12, 12], [15, 9], [13.3, 11.1]]); },
  "selected items move together, keeping their spacing": () => { start([P("a", "SW-A409", 10, 10), T("t", "tree", 15, 10, 4, 4), { id: "r", kind: "area", type: "rubber", poly: [[20, 5], [24, 5], [24, 9], [20, 9]] }, { id: "f", kind: "line", type: "fence", pts: [[2, 20], [8, 20]], width: 0.08 }]);
    for (const id of ["a", "t", "r", "f"]) M.S.selection.add(id); gesture([10, 10], [[12.2, 13.3]]); },
  "a locked item stays put while the rest of the selection moves": () => { start([P("a", "SW-A409", 10, 10), P("b", "SW-A409", 20, 10, 0, { locked: true })]); M.S.selection.add("a"); M.S.selection.add("b"); gesture([10, 10], [[12, 12]]); },
  "clicking empty ground clears the selection": () => { start([P("a", "SW-A409", 10, 10)]); M.S.selection.add("a"); gesture([35, 28], [[35, 28]]); },
  "shift-click adds to the selection": () => { start([P("a", "SW-A409", 10, 10), P("b", "SW-A409", 25, 20)]); gesture([10, 10], []); gesture([25, 20], [], { shiftKey: true }); },
  "read-only selects but never edits": () => { start([P("a", "SW-A409", 10, 10)], { readOnly: true }); gesture([10, 10], [[15, 15]]); },
  "rotate handle snaps to the angle step": () => { const o = P("a", "SW-A409", 10, 10, 0); start([o]); M.S.selection.add("a"); const b = M.shapes(o).foot, r = Math.max(...b.map((p) => Math.hypot(p[0] - 10, p[1] - 10))) + 26 / 20; gesture([10 + r, 10], [[12, 14.4]]); },
  "alt rotates freely": () => { const o = P("a", "SW-A409", 10, 10, 0); start([o]); M.S.selection.add("a"); const b = M.shapes(o).foot, r = Math.max(...b.map((p) => Math.hypot(p[0] - 10, p[1] - 10))) + 26 / 20; gesture([10 + r, 10], [[12, 14.4]], { altKey: true }); },
  "rotating a rotated item measures from its centre": () => { const o = P("a", "SW-A409", 10, 10, 90); start([o]); M.S.selection.add("a"); const b = M.shapes(o).foot, r = Math.max(...b.map((p) => Math.hypot(p[0] - 10, p[1] - 10))) + 26 / 20; gesture([10, 10 + r], [[6, 7]]); },
  "resizing a rectangle snaps to its step": () => { start([T("t", "bench", 10, 10, 2, 1, 0)]); M.S.selection.add("t"); gesture([11, 10.5], [[13.13, 11.77]]); },
  "resizing a rotated rectangle follows its own axes": () => { const a = 30 * Math.PI / 180, hx = 1, hy = 0.5, h = [10 + hx * Math.cos(a) - hy * Math.sin(a), 10 + hx * Math.sin(a) + hy * Math.cos(a)]; start([T("t", "bench", 10, 10, 2, 1, 30)]); M.S.selection.add("t"); gesture(h, [[13.1, 12.9]]); },
  "resizing a circle changes its diameter": () => { start([T("t", "tree", 10, 10, 4, 4, 0)]); M.S.selection.add("t"); gesture([12, 12], [[13.5, 13.5]]); },
  "alt resizes freely": () => { start([T("t", "bench", 10, 10, 2, 1, 0)]); M.S.selection.add("t"); gesture([11, 10.5], [[13.13, 11.77]], { altKey: true }); },
  "a resize can never reach zero": () => { start([T("t", "bench", 10, 10, 2, 1, 0)]); M.S.selection.add("t"); gesture([11, 10.5], [[10.001, 10.001]], { altKey: true }); },
};

const update = process.argv.includes("--update");
const now = {}; for (const k of Object.keys(CASES)) { CASES[k](); now[k] = state(); }
if (update) { fs.writeFileSync(GOLD, JSON.stringify(now, null, 1) + "\n"); console.log(`Baseline written for ${Object.keys(now).length} gestures.`); }
const gold = JSON.parse(fs.readFileSync(GOLD, "utf8"));
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + String(e.message).split("\n").slice(0, 10).join("\n     ")); } };
for (const k of Object.keys(CASES)) t("2D unchanged: " + k, () => assert.deepStrictEqual(now[k], gold[k]));

/* The rule for 3D: the shared edit functions give exactly what the 2D pointer gestures gave. */
if (C.editOps) {
  const O = C.editOps, same = (a, b, name) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), name);
  const moveVia = (w0, w, mods = {}, ids = null) => { const lead = M.S.project.objects.find((o) => M.bounds(o) && o.id === (ids ? ids[0] : "a")), d = O.moveStart(lead, M.selected().filter((o) => !o.locked)); O.moveTo(d, w0, w, Object.assign({ tol: 7 / C.v.scale }, mods)); M.commit("Move"); };
  t("move: the shared function equals the 2D gesture, snapped", () => { start([P("a", "SW-A409", 10, 10), P("b", "SW-A409", 25, 20)]); M.S.selection.add("a"); moveVia([10, 10], [14.2, 20.1]); same(M.S.project.objects, gold["a move aligns to a neighbour within 7 px"].objects); });
  t("move: free", () => { start([P("a", "SW-A409", 10, 10)]); M.S.selection.add("a"); moveVia([10, 10], [13.13, 12.37], { free: true }); same(M.S.project.objects, gold["alt moves freely, without snapping"].objects); });
  t("move: one axis", () => { start([P("a", "SW-A409", 10, 10)]); M.S.selection.add("a"); moveVia([10, 10], [14.4, 11.1], { axis: true }); same(M.S.project.objects, gold["shift keeps the move on one axis"].objects); });
  t("move: a group, with a line and an area", () => { start([P("a", "SW-A409", 10, 10), T("t", "tree", 15, 10, 4, 4), { id: "r", kind: "area", type: "rubber", poly: [[20, 5], [24, 5], [24, 9], [20, 9]] }, { id: "f", kind: "line", type: "fence", pts: [[2, 20], [8, 20]], width: 0.08 }]); for (const id of ["a", "t", "r", "f"]) M.S.selection.add(id); moveVia([10, 10], [12.2, 13.3]); same(M.S.project.objects, gold["selected items move together, keeping their spacing"].objects); });
  t("move: a locked item stays put", () => { start([P("a", "SW-A409", 10, 10), P("b", "SW-A409", 20, 10, 0, { locked: true })]); M.S.selection.add("a"); M.S.selection.add("b"); moveVia([10, 10], [12, 12]); same(M.S.project.objects, gold["a locked item stays put while the rest of the selection moves"].objects); });
  t("move: a surface and a line follow the grid, free with alt", () => {
    const leadMove = (o, from, to, mods, name) => { start([o]); M.S.selection.add(o.id); const d = O.moveStart(M.S.project.objects[0], M.selected()); O.moveTo(d, from, to, Object.assign({ tol: 7 / C.v.scale }, mods)); same(M.S.project.objects, gold[name].objects, name); };
    const area = () => ({ id: "r", kind: "area", type: "rubber", poly: [[20, 5], [24, 5], [24, 9], [20, 9]] });
    leadMove(area(), [22, 7], [24.13, 8.37], {}, "dragging a surface snaps its move to the grid"); leadMove(area(), [22, 7], [24.13, 8.37], { free: true }, "alt drags a surface freely");
    leadMove({ id: "f", kind: "line", type: "fence", pts: [[2, 20], [8, 20], [8, 25]], width: 0.08 }, [5, 20], [6.13, 22.37], {}, "dragging a line snaps its move to the grid");
  });
  t("rotate: snapped and free", () => { start([P("a", "SW-A409", 10, 10, 0)]); O.rotateTo(M.byId("a"), [12, 14.4], false); same(M.S.project.objects, gold["rotate handle snaps to the angle step"].objects); start([P("a", "SW-A409", 10, 10, 0)]); O.rotateTo(M.byId("a"), [12, 14.4], true); same(M.S.project.objects, gold["alt rotates freely"].objects); });
  t("resize: rectangle, rotated, circle and free", () => {
    const go = (o, w, free, name) => { start([o]); O.resizeTo(M.S.project.objects[0], w, free); same(M.S.project.objects, gold[name].objects, name); };
    go(T("t", "bench", 10, 10, 2, 1, 0), [13.13, 11.77], false, "resizing a rectangle snaps to its step"); go(T("t", "bench", 10, 10, 2, 1, 30), [13.1, 12.9], false, "resizing a rotated rectangle follows its own axes");
    go(T("t", "tree", 10, 10, 4, 4, 0), [13.5, 13.5], false, "resizing a circle changes its diameter"); go(T("t", "bench", 10, 10, 2, 1, 0), [13.13, 11.77], true, "alt resizes freely"); go(T("t", "bench", 10, 10, 2, 1, 0), [10.001, 10.001], true, "a resize can never reach zero");
  });
}
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
