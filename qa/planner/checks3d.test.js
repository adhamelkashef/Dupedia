/* Engineering review prompts: every check has a case inside its limit and a case beyond it, and with no limit it only asks for a review.
   The test limits below are made up to exercise the logic. They are not engineering advice and must never be shipped as defaults. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app");
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "terrain", "scene3d", "checks3d"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPCat: CAT, DPChecks3D: K, DPScene3D: S3 } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], plain = (v) => JSON.parse(JSON.stringify(v));
const project = (objects) => { const p = M.newProject(); p.site = { poly: rect(0, 0, 80, 60), north: 0 }; p.objects = objects; M.load(p); return M.S.project; };
const P = (id, type, x, y, l, w, rot, terrain) => ({ id, kind: "point", type, x, y, l, w, rot, terrain }), L = (id, type, pts, width, terrain) => ({ id, kind: "line", type, pts, width, terrain }), A = (id, type, poly, terrain) => ({ id, kind: "area", type, poly, terrain }), Pr = (id, code, x, y, rot = 0, extra = {}) => Object.assign({ id, kind: "product", code, x, y, rot }, extra);
const run = (objs, limits, opts) => plain(K.run(project(objs), limits || {}, opts || {}));
const hits = (r, code) => r.issues.filter((i) => i.code === code);

/* The same three cases for each limit: blank asks for a review, within is quiet, beyond warns. */
function trio(name, objs, code, key, within, beyond, extra = {}) {
  t(`${name}: with no limit it asks for a review, and states the figure`, () => { const h = hits(run(objs, extra), code); assert.ok(h.length >= 1, "a prompt"); assert.ok(h.every((i) => i.sev === "review"), "only a review"); assert.ok(/\d/.test(h[0].msg), "states a figure"); assert.ok(/No limit/i.test(h[0].msg)); });
  t(`${name}: inside the limit it stays quiet and is counted`, () => { const r = run(objs, Object.assign({}, extra, { [key]: within })); assert.strictEqual(hits(r, code).length, 0, JSON.stringify(hits(r, code))); assert.ok(r.counts.within >= 1); });
  t(`${name}: beyond the limit it warns, naming both figures`, () => { const h = hits(run(objs, Object.assign({}, extra, { [key]: beyond })), code); assert.ok(h.length >= 1, "a warning"); assert.strictEqual(h[0].sev, "warning"); assert.ok(/limit entered/.test(h[0].msg), h[0].msg); });
}
const platform = (h = 2) => A("pf", "platform", rect(20, 10, 10, 10), { height: h });
const level = () => A("lv", "level", rect(20, 20, 20, 20), { height: 2, run: 4 });          // 50% sides
const ramp = () => P("r", "ramp", 10, 10, 6, 1.5, 0, { rise: 0.6 });                        // 10%
const stairs = () => P("s", "stairs", 10, 20, 2.4, 1.2, 0, { rise: 0.9, steps: 5 });        // 18 cm rise, 48 cm going
const tunnel = () => [A("h", "hill", rect(20, 20, 24, 20), { height: 5, profile: "straight" }), L("t", "tunnel", [[18, 30], [46, 30]], 1.4, { clear: 1.2 })];

trio("Hill and level slope", [level()], "terrain-slope", "terrainSlopeMaxPct", 60, 40);
trio("Ramp slope", [ramp()], "ramp-slope", "rampSlopeMaxPct", 12, 8);
trio("Ramp width", [ramp()], "ramp-width", "rampWidthMin", 1, 2);
trio("Bridge slope", [platform(1), A("p2", "platform", rect(40, 10, 10, 10), { height: 2 }), L("b", "bridge", [[30, 15], [40, 15]], 1.2)], "bridge-slope", "bridgeSlopeMaxPct", 12, 5);
trio("Tunnel floor slope", [A("p3", "platform", rect(40, 25, 10, 10), { height: 2 }), L("t", "tunnel", [[20, 30], [42, 30]], 1.4, { clear: 1.2 })], "tunnel-slope", "tunnelSlopeMaxPct", 12, 5);
trio("Accessible path width", [L("a", "path-accessible", [[5, 5], [15, 5]], 1.5)], "access-width", "accessWidthMin", 1, 2);
trio("Accessible path slope", [level(), L("a", "path-accessible", [[10, 30], [24, 30]], 1.5)], "access-slope", "accessSlopeMaxPct", 60, 40);
trio("Gate width", [P("g", "gate", 10, 10, 1.2, 0.12, 0)], "gate-width", "gateWidthMin", 1, 1.5);
trio("Step rise, highest", [stairs()], "stair-riser-high", "stairRiserMax", 0.2, 0.15);
trio("Step going", [stairs()], "stair-going", "stairGoingMin", 0.4, 0.6);
trio("Tunnel headroom", tunnel(), "tunnel-headroom", "headroomMin", 1, 2);
trio("Earth above a tunnel", tunnel(), "tunnel-cover", "tunnelCoverMin", 0.1, 4);
trio("Platform edge drop", [platform(2)], "edge-drop", "edgeDropMax", 3, 1);
trio("Retaining wall height", [L("w", "retaining-wall", [[5, 5], [15, 5]], 0.25, { height: 2 })], "wall-height", "retainingHeightMax", 3, 1);
trio("Ground varying under a product", [level(), Pr("a", "SW-A409", 21, 30)], "ground-vary", "groundVaryMax", 5, 0.1);
trio("Ground varying across a safety zone", [level(), Pr("a", "SW-A409", 22, 30)], "zone-vary", "zoneVaryMax", 5, 0.1);
t("Lowest step: only checked once a limit is entered; inside quiet, beyond warns", () => { assert.strictEqual(hits(run([stairs()]), "stair-riser-low").length, 0); assert.strictEqual(hits(run([stairs()], { stairRiserMin: 0.1 }), "stair-riser-low").length, 0); assert.strictEqual(hits(run([stairs()], { stairRiserMin: 0.2 }), "stair-riser-low")[0].sev, "warning"); });

/* Physical clashes need no limit */
const tall = "SW-E101", low = "SW-L509";
t("Equipment taller than a pergola above it warns, with no limit needed; 3.3 m against 2.6 m", () => { const r = run([P("g", "pergola", 20, 20, 4, 4, 0), Pr("a", tall, 20, 20)]), h = hits(r, "overhead-clash"); assert.strictEqual(h[0].sev, "warning"); assert.ok(/3\.3 m/.test(h[0].msg) && /2\.6 m/.test(h[0].msg)); assert.ok(/illustrative/.test(h[0].msg), "says the height is only a drawn value"); });
t("Low equipment under the same pergola doesn't", () => { assert.strictEqual(hits(run([P("g", "pergola", 20, 20, 4, 4, 0), Pr("a", low, 20, 20)]), "overhead-clash").length, 0); });
t("Equipment beside a pergola doesn't", () => { assert.strictEqual(hits(run([P("g", "pergola", 20, 20, 4, 4, 0), Pr("a", tall, 50, 40)]), "overhead-clash").length, 0); });
t("Standing on a platform counts: a 0.75 m bench on a 2.2 m platform under a pergola on the ground clashes", () => { assert.ok(hits(run([A("pf", "platform", rect(10, 10, 20, 20), { height: 2.2 }), Pr("a", low, 20, 20)].concat([Object.assign(P("g", "pergola", 20, 20, 4, 4, 0), { z: -2.2 })])), "overhead-clash").length >= 1); });
t("Equipment under a bridge deck warns; low enough, it doesn't", () => { const span = (h) => [A("a1", "platform", rect(10, 10, 5, 10), { height: h }), A("a2", "platform", rect(30, 10, 5, 10), { height: h }), L("b", "bridge", [[15, 15], [30, 15]], 3)]; assert.strictEqual(hits(run(span(1).concat([Pr("x", "SW-A409", 22, 15)])), "bridge-clash")[0].sev, "warning"); assert.strictEqual(hits(run(span(3).concat([Pr("x", "SW-L509", 22, 15)])), "bridge-clash").length, 0); });
t("Ground above a retaining wall warns; a wall tall enough doesn't", () => { const objs = (h) => [platform(2), L("w", "retaining-wall", [[15, 15], [25, 15]], 0.25, { height: h })]; assert.strictEqual(hits(run(objs(1)), "wall-overtop")[0].sev, "warning"); assert.strictEqual(hits(run(objs(3)), "wall-overtop").length, 0); });
t("A product above a tunnel always asks for an engineer", () => { assert.ok(hits(run(tunnel().concat([Pr("a", "SW-L509", 32, 30)])), "over-tunnel").length >= 1); assert.strictEqual(hits(run(tunnel().concat([Pr("a", "SW-L509", 32, 38)])), "over-tunnel").length, 0); });
t("A tunnel always asks for structural design, whatever the limits say", () => { const h = hits(run(tunnel(), { headroomMin: 1, tunnelCoverMin: 0.01 }), "tunnel-design"); assert.strictEqual(h.length, 1); assert.strictEqual(h[0].sev, "review"); });
t("Existing overlap checks still work on terrain: overlapping products on a platform are flagged, apart they aren't", () => { const a = M.validate(project([platform(1), Pr("a", low, 25, 15), Pr("b", low, 25.2, 15)])); assert.ok(a.issues.some((i) => i.code === "foot-foot")); const b = M.validate(project([platform(1), Pr("a", low, 22, 12), Pr("b", low, 28, 18)])); assert.ok(!b.issues.some((i) => i.code === "foot-foot")); });

/* Accessibility, whole-design prompt */
t("Levels with no accessible path ask about it; drawing one stops that", () => { assert.strictEqual(hits(run([platform(1)]), "no-access-path").length, 1); assert.strictEqual(hits(run([platform(1), L("a", "path-accessible", [[1, 1], [5, 1]], 1.5)]), "no-access-path").length, 0); assert.strictEqual(hits(run([Pr("a", low, 20, 20)]), "no-access-path").length, 0); });
t("A flat accessible path has no slope prompt", () => { assert.strictEqual(hits(run([L("a", "path-accessible", [[1, 1], [5, 1]], 1.5)]), "access-slope").length, 0); });

/* Fall height */
t("Reading the catalogue honestly", () => { const R = (s) => plain(K.readFall(s)); assert.deepStrictEqual(R("1.50 m"), { kind: "platform", height: 1.5 }); assert.deepStrictEqual(R("1.50 m / 1.20 m"), { kind: "platform", height: 1.5 }); assert.deepStrictEqual(R("1.20 – 1.50 m (typical)"), { kind: "platform", height: 1.5 }); assert.deepStrictEqual(R("Seat 54 cm"), { kind: "seat", height: 0.54 }); assert.deepStrictEqual(R("Seat 0.55 m"), { kind: "seat", height: 0.55 }); assert.deepStrictEqual(R("Ground level"), { kind: "ground", height: 0 }); assert.deepStrictEqual(R("—"), { kind: "none", height: 0 }); });
t("A plan size or a vague phrase is never read as a height", () => { for (const s of ["Platform 1.15 × 1.15 m", "Deck level", "Trampoline deck level", "Ground floor + elevated deck", "Ground level with elevated sections", "Pivot level", "", null]) { const r = plain(K.readFall(s)); assert.ok(r.height == null || r.kind === "none", s + " " + JSON.stringify(r)); } });
t("Every product in the catalogue reads without error, and none gets a made-up height", () => { let unknown = 0; for (const p of CAT.PRODUCTS) { const r = K.readFall(p.platform); if (r.kind === "unknown") { unknown++; assert.strictEqual(r.height, null); } else assert.ok(r.height >= 0 && r.height < 4, p.code + " " + r.height); } assert.strictEqual(unknown, 9); });
const onRubber = (code, extra) => [A("r", "rubber", rect(5, 5, 40, 40)), Pr("a", code, 25, 25, 0, extra)];
const platformProduct = () => CAT.PRODUCTS.find((p) => p.dims && K.readFall(p.platform).kind === "platform" && K.readFall(p.platform).height === 1.5).code;
t("Fall height, no rated surface drawn: asks for a review, and says the figure is only a guide", () => { const h = hits(run([Pr("a", platformProduct(), 25, 25)]), "fall-no-surface"); assert.strictEqual(h[0].sev, "review"); assert.ok(/1\.5 m/.test(h[0].msg) && /guide/.test(h[0].msg)); });
t("Fall height, surface with no rating: asks for a review", () => { const h = hits(run(onRubber(platformProduct())), "fall-unrated"); assert.strictEqual(h[0].sev, "review"); assert.ok(/Rubber/.test(h[0].msg)); });
t("Fall height, within a rating: quiet and counted", () => { const r = run(onRubber(platformProduct()), { fall_rubber: 2 }); assert.strictEqual(hits(r, "fall-over").length, 0); assert.strictEqual(hits(r, "fall-unrated").length, 0); assert.ok(r.counts.within >= 1); });
t("Fall height, beyond a rating: warns, naming the figure and the surface", () => { const h = hits(run(onRubber(platformProduct()), { fall_rubber: 1 }), "fall-over"); assert.strictEqual(h[0].sev, "warning"); assert.ok(/1\.5 m/.test(h[0].msg) && /1 m/.test(h[0].msg) && /Rubber/.test(h[0].msg)); });
t("Each surface has its own rating", () => { const objs = [A("e", "epdm", rect(5, 5, 40, 40)), Pr("a", platformProduct(), 25, 25)]; assert.strictEqual(hits(run(objs, { fall_rubber: 1, fall_epdm: 2 }), "fall-over").length, 0); assert.strictEqual(hits(run(objs, { fall_rubber: 2, fall_epdm: 1 }), "fall-over").length, 1); });
t("An unreadable catalogue figure asks for a confirmed one, never guesses", () => { const code = CAT.PRODUCTS.find((p) => p.dims && K.readFall(p.platform).kind === "unknown").code, h = hits(run(onRubber(code), { fall_rubber: 0.01 }), "fall-unknown"); assert.strictEqual(h[0].sev, "review"); assert.ok(/Admin/.test(h[0].msg)); });
t("A confirmed figure from the library replaces the catalogue text, with no 'guide' caveat", () => { const code = CAT.PRODUCTS.find((p) => p.dims && K.readFall(p.platform).kind === "unknown").code, h = hits(run(onRubber(code), { fall_rubber: 1 }, { record: () => ({ fallHeight: 1.4 }) }), "fall-over"); assert.strictEqual(h[0].sev, "warning"); assert.ok(/recorded fall height 1\.4 m/.test(h[0].msg)); assert.ok(!/guide/.test(h[0].msg)); });
t("Ground-level and landscape items raise no fall prompt", () => { const code = CAT.PRODUCTS.find((p) => p.dims && K.readFall(p.platform).kind === "ground").code; const r = run([Pr("a", code, 25, 25)]); assert.strictEqual(r.issues.filter((i) => i.group === "Fall height").length, 0); });

/* The rules this whole module exists under */
const SRC = fs.readFileSync(path.join(APP, "checks3d.js"), "utf8");
const everything = () => [level(), ramp(), stairs(), platform(1.2), L("a", "path-accessible", [[10, 30], [24, 30]], 1.5), P("g", "gate", 10, 40, 1.2, 0.12, 0), P("pg", "pergola", 50, 50, 4, 4, 0), Pr("x", tall, 50, 50), L("w", "retaining-wall", [[5, 5], [15, 5]], 0.25), L("t", "tunnel", [[18, 30], [46, 30]], 1.4), A("r", "rubber", rect(55, 5, 20, 20)), Pr("y", platformProduct(), 65, 15)];
t("It holds no limits of its own: with nothing entered, no figure is ever called over a limit", () => { const r = run(everything()); assert.strictEqual(r.limitsSet, 0); assert.ok(!r.issues.some((i) => /limit entered/.test(i.msg))); assert.ok(r.issues.filter((i) => i.sev === "warning").every((i) => ["overhead-clash", "bridge-clash", "wall-overtop"].includes(i.code)), "only physical clashes warn"); assert.strictEqual(r.counts.within, 0); });
t("No message ever claims approval", () => { for (const limits of [{}, Object.fromEntries(K.LIMITS.map((l) => [l.key, 0.5])), Object.fromEntries(K.LIMITS.map((l) => [l.key, 100]))]) for (const i of run(everything(), limits).issues) assert.ok(!/\b(pass|passes|passed|approved|compliant|complies|certified|safe)\b/i.test(i.msg), i.msg); });
t("The disclaimer says what these aren't", () => { assert.ok(/not engineering approval/.test(K.DISCLAIMER) && /certification/.test(K.DISCLAIMER) && /qualified engineer/.test(K.DISCLAIMER)); });
t("Every limit has a label and unit; surface limits match real surfaces", () => { const keys = new Set(); for (const l of K.LIMITS) { assert.ok(l.label && l.unit && l.group, l.key); assert.ok(!keys.has(l.key)); keys.add(l.key); if (l.surface) assert.ok(CAT.EL[l.surface] && CAT.EL[l.surface].surface, l.surface); } });
t("Every limit the checks read is one an administrator can set", () => { const used = [...SRC.matchAll(/"([a-zA-Z]+(?:Pct|Min|Max))"/g)].map((x) => x[1]); assert.ok(used.length >= 10); const keys = new Set(K.LIMITS.map((l) => l.key)); for (const k of used) assert.ok(keys.has(k), k); });
t("A broken limit is treated as blank, never as zero", () => { const r = run([ramp()], { rampSlopeMaxPct: "abc" }); assert.strictEqual(hits(r, "ramp-slope")[0].sev, "review"); const z = run([ramp()], { rampSlopeMaxPct: null }); assert.strictEqual(hits(z, "ramp-slope")[0].sev, "review"); });
t("Checks never change the project, the take-off or the history", () => { const p = project(everything()), a = JSON.stringify(p), to = JSON.stringify(M.takeoff(p)), h = M.hist.past.length; K.run(p, {}); assert.strictEqual(JSON.stringify(p), a); assert.strictEqual(JSON.stringify(M.takeoff(p)), to); assert.strictEqual(M.hist.past.length, h); });
t("They don't touch the existing validation, which the golden tests guard", () => { const objs = [Pr("x", "SW-A409", 20, 20)], before = JSON.stringify(M.validate(project(objs)).counts); run(objs); assert.strictEqual(JSON.stringify(M.validate(project(objs)).counts), before); });
t("The limits have their own settings key: settings.engineering holds the default engineer new orders go to", () => {
  const core = fs.readFileSync(path.join(APP, "ui-core.js"), "utf8"), adm = fs.readFileSync(path.join(APP, "admin3d.js"), "utf8"), sales = fs.readFileSync(path.join(APP, "sales.js"), "utf8");
  assert.ok(/settings\.engineering\.defaultEngineer/.test(sales), "that's what the existing key is for"); assert.ok(/settings\.engineeringLimits\b/.test(core)); assert.ok(!/settings\.engineering\)/.test(core)); assert.ok(/engineeringLimits: next/.test(adm)); assert.ok(!/\bengineering: next/.test(adm));
});
t("A level tunnel or bridge has no slope prompt to wade through", () => { assert.strictEqual(hits(run(tunnel()), "tunnel-slope").length, 0); assert.strictEqual(hits(run([platform(1), A("p2", "platform", rect(40, 10, 10, 10), { height: 1 }), L("b", "bridge", [[30, 15], [40, 15]], 1.2)]), "bridge-slope").length, 0); });
t("A hill's slope reads the same from the quick route and the full figures", () => { const f = M.newProject(); const o = A("h", "hill", rect(5, 5, 20, 20), { height: 3 }); const pr = project([o]), fsx = ctx.DPTerrain.features(pr); assert.strictEqual(ctx.DPTerrain.steepness(fsx[0]) * 100, ctx.DPTerrain.stats(fsx[0]).slopePct); });
t("Hidden objects are left out", () => { const r = ramp(); r.hidden = true; assert.strictEqual(hits(run([r]), "ramp-slope").length, 0); });
t("Prompts point at the objects they're about", () => { const r = run([ramp()]); assert.ok(r.per.r && r.per.r.length >= 2); });
console.log(fail ? `${fail} of ${n} FAILED` : `${n} tests passed`);
process.exit(fail ? 1 : 0);
