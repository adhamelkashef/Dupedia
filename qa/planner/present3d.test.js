/* Phase 9: what client documents and the engineering page may say. Every price here is made up to exercise the logic. */
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const APP = path.join(__dirname, "..", "..", "app");
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["products", "geom", "catalogue", "pen", "symbols", "model", "pricing", "commission", "terrain", "present3d", "fontcover"]) vm.runInContext(fs.readFileSync(path.join(APP, f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const { DPModel: M, DPCat: CAT, DPPricing: PR, DPPresent: PS, DPTerrain: T, DP_FONT_COVER: COVER } = ctx;
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n     " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const A = (id, type, poly, terrain, extra) => Object.assign({ id, kind: "area", type, poly }, terrain ? { terrain } : {}, extra || {}), L = (id, type, pts, width, terrain) => Object.assign({ id, kind: "line", type, pts, width }, terrain ? { terrain } : {}), P = (id, type, x, y, l, w, rot, terrain) => Object.assign({ id, kind: "point", type, x, y, l, w, rot }, terrain ? { terrain } : {});
const project = (objects, views3d) => { const p = M.newProject(); p.site = { poly: rect(0, 0, 80, 60), north: 0 }; p.objects = objects; if (views3d) p.views3d = views3d; M.load(p); T.measureProject(M.S.project); return M.S.project; };
const everything = () => [A("h", "hill", rect(5, 5, 20, 20), { height: 2, run: 5, profile: "straight" }), A("lv", "level", rect(30, 5, 20, 20), { height: -1, run: 2 }), A("pf", "platform", rect(55, 5, 10, 10), { height: 0.6 }), P("r", "ramp", 10, 40, 6, 1.5, 0, { rise: 0.6 }), P("s", "stairs", 25, 40, 2.4, 1.2, 0, { rise: 0.9, steps: 5 }), L("w", "retaining-wall", [[35, 40], [45, 40]], 0.25, { height: 1.5 }), L("t", "tunnel", [[50, 40], [60, 40]], 1.4, { clear: 1.2 }), L("b", "bridge", [[62, 30], [72, 30]], 1.2, { lift: 0.5 }), P("u", "umbrella", 70, 50, 3, 3, 0), A("w2", "splash-pad", rect(60, 45, 5, 5))];
const item = (rows, type) => rows.find((r) => r.type === type), fig = (r, label) => { const f = r.figures.find(([k]) => k === label); return f && f[1]; };
const inFont = (ch, kind = "sans") => COVER[kind].some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);

/* ---------------- camera views ---------------- */
const SAVED = [{ id: "a", name: "From the gate", pos: [1, 2, 3], target: [0, 0, 0] }, { id: "b", name: "Over the slide", pos: [4, 5, 6], target: [0, 0, 0] }];
t("With nothing saved, four views from different sides", () => assert.deepStrictEqual(plain(PS.defaultShots(project([]))), ["corner", "front", "right", "back"]));
t("Views the salesperson saved come first", () => assert.deepStrictEqual(plain(PS.defaultShots(project([], SAVED))), ["saved:a", "saved:b", "corner", "front"]));
t("A saved view keeps its own camera and name", () => { const s = PS.resolveShots(project([], SAVED), ["saved:b"])[0]; assert.strictEqual(s.name, "Over the slide"); assert.deepStrictEqual(plain(s.pos), [4, 5, 6]); });
t("A damaged saved view is left out, not aimed at nothing", () => { const p = project([], [{ id: "x", name: "Bad", pos: [1, "a", 3], target: [0, 0, 0] }]); assert.deepStrictEqual(plain(PS.resolveShots(p, ["saved:x", "corner"]).map((s) => s.id)), ["corner"]); });
t("A deleted saved view that's still ticked is simply skipped", () => assert.deepStrictEqual(plain(PS.resolveShots(project([]), ["saved:gone", "top"]).map((s) => s.id)), ["top"]));
t("No more than 8 views, whatever is asked for", () => assert.strictEqual(PS.resolveShots(project([], SAVED), ["saved:a", "saved:b", "corner", "front", "right", "back", "left", "top"].concat(["corner"])).length, 8));
t("Unticking every view gives none, not the defaults", () => assert.strictEqual(PS.resolveShots(project([]), []).length, 0));

/* ---------------- the note that travels with renders ---------------- */
const NOTE = (i) => PS.renderNote(Object.assign({ blockouts: 0, approx: 0, reviewed: 0 }, i));
t("Every render page says it's illustrative and not for construction", () => { assert.ok(/Illustrative/.test(NOTE({}))); assert.ok(/Not for construction/.test(NOTE({}))); });
t("Block-outs are named as not the real shape", () => { assert.ok(/One product is shown as a plain block at catalogue size, not its real shape/.test(NOTE({ blockouts: 1 }))); assert.ok(/3 products are shown/.test(NOTE({ blockouts: 3 }))); });
t("Approximate models are named as approximate", () => assert.ok(/2 products use approximate models/.test(NOTE({ approx: 2 }))));
t("Even a reviewed model isn't called an engineering drawing", () => assert.ok(/not an engineering drawing/.test(NOTE({ reviewed: 1 }))));
t("The note never claims accuracy", () => { const s = NOTE({ blockouts: 1, approx: 1, reviewed: 1 }); for (const w of ["accurate", "certified", "approved", "guarantee", "exact"]) assert.ok(!new RegExp(w, "i").test(s), w); });

/* ---------------- site schedule, against hand figures ---------------- */
const rows = () => PS.siteItems(project(everything()));
t("Each shaped item is listed once, numbered in order", () => { const r = rows(); assert.strictEqual(r.length, 10); assert.deepStrictEqual(plain(r.map((x) => x.tag)), plain(r.map((_, i) => String(i + 1)))); });
t("Terrain first, then structures, then other new items", () => { const r = rows().map((x) => x.type); assert.ok(r.indexOf("hill") < r.indexOf("ramp")); assert.ok(r.indexOf("tunnel") < r.indexOf("umbrella")); });
t("A platform: 10 × 10 m, 0.6 m high, about 60 m3", () => { const r = item(rows(), "platform"); assert.strictEqual(fig(r, "Plan area"), "100.00 m²"); assert.strictEqual(fig(r, "Height"), "0.60 m"); assert.strictEqual(fig(r, "Volume, about"), "60.0 m3"); });
t("A hill states its 40% slope (2 m over 5 m)", () => { assert.strictEqual(fig(item(rows(), "hill"), "Steepest slope"), "40.0%"); });
t("A sunken level says depth, not height, and a positive number", () => { const r = item(rows(), "level"); assert.strictEqual(fig(r, "Depth"), "1.00 m"); assert.strictEqual(fig(r, "Height"), undefined); });
t("A ramp: 0.6 m over 6 m is 10%", () => { const r = item(rows(), "ramp"); assert.strictEqual(fig(r, "Slope"), "10.0%"); assert.strictEqual(fig(r, "Width"), "1.50 m"); });
t("Stairs: 5 steps in 0.9 m and 2.4 m is 18 cm high, 48 cm deep", () => assert.strictEqual(fig(item(rows(), "stairs"), "Each step"), "18.0 cm high, 48.0 cm deep"));
t("A wall: 10 m at 1.5 m is 15 m² of face", () => { const r = item(rows(), "retaining-wall"); assert.strictEqual(fig(r, "Length"), "10.00 m"); assert.strictEqual(fig(r, "Face, about"), "15.0 m²"); });
t("A tunnel states its clear height and skips a 0% slope", () => { const r = item(rows(), "tunnel"); assert.strictEqual(fig(r, "Clear height"), "1.20 m"); assert.strictEqual(fig(r, "Floor slope"), undefined); });
t("A bridge states length and width", () => { const r = item(rows(), "bridge"); assert.strictEqual(fig(r, "Length"), "10.00 m"); assert.strictEqual(fig(r, "Width"), "1.20 m"); });
t("A generic item says to confirm its size with the supplier; a splash pad doesn't claim to be generic", () => { assert.ok(item(rows(), "umbrella").confirm); assert.ok(!item(rows(), "splash-pad").confirm); assert.ok(/Confirm its size/.test(PS.CONFIRM_NOTE)); });
t("Tunnels and walls are flagged for a qualified engineer; a ramp isn't", () => { const r = rows(); assert.ok(item(r, "tunnel").engineer && item(r, "retaining-wall").engineer); assert.ok(!item(r, "ramp").engineer); assert.ok(/qualified engineer/.test(PS.ENGINEER_NOTE)); });
t("The page says it isn't a survey, a design or an approval", () => { for (const w of ["survey", "engineering design", "approval"]) assert.ok(PS.SCHEDULE_NOTE.includes(w), w); });
t("A tag sits at the middle of its item", () => assert.deepStrictEqual(plain(item(rows(), "platform").at), [60, 10]));
t("A line's tag sits halfway along it, not in the space it wraps around: an L of 10 + 10 m has its middle at the corner", () => { const r = PS.siteItems(project([L("w", "retaining-wall", [[10, 10], [20, 10], [20, 20]], 0.25, { height: 1 })]))[0]; assert.deepStrictEqual(plain(r.at), [20, 10]); });
t("Tags that would collide slide apart, and lone tags stay exactly where they belong", () => { const out = plain(PS.spreadTags([[10, 10], [10.5, 10], [50, 50], [10, 10.5]], 2.4)); assert.deepStrictEqual(out[0], [10, 10]); assert.deepStrictEqual(out[2], [50, 50]); for (let i = 0; i < out.length; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(out[i][0] - out[j][0], out[i][1] - out[j][1]) >= 2.4 * 2.3 - 1e-9, `${i},${j}`); });
t("Hidden items and old elements stay off this schedule", () => { const r = PS.siteItems(project([A("a", "hill", rect(5, 5, 20, 20), { height: 2 }, { hidden: true }), A("s", "rubber", rect(30, 5, 10, 10)), L("f", "fence", [[1, 50], [9, 50]], 0.1), { id: "p", kind: "product", code: CAT.PRODUCTS[0].code, x: 5, y: 5, rot: 0 }])); assert.strictEqual(r.length, 0); });
t("Plans with none of these give an empty schedule, so no page is added", () => assert.strictEqual(PS.siteItems(project([])).length, 0));
t("Every character on the schedule exists in the PDF font", () => { for (const r of rows()) for (const ch of r.name + r.figures.flat().join(" ")) assert.ok(inFont(ch), `${r.type}: ${ch}`); for (const ch of PS.SCHEDULE_NOTE + PS.ENGINEER_NOTE + PS.CONFIRM_NOTE + NOTE({ blockouts: 2, approx: 2, reviewed: 2 })) assert.ok(inFont(ch), ch); });

/* ---------------- no money where it mustn't be ---------------- */
const moneyWords = /sell|price|cost|margin|commission|minor|EGP|\bunit\b/i;
t("The site schedule, which engineering also receives, holds no money", () => { const p = project(everything().map((o) => Object.assign(o, { costable: true }))); p.pricing.overrides = { "el:hill": { unitPrice: 123, by: "t", reason: "r" } }; const s = JSON.stringify(PS.siteItems(p)); assert.ok(!moneyWords.test(s), s.match(moneyWords)); assert.ok(!s.includes("123")); });
const priced = () => { const p = project([A("a", "platform", rect(10, 10, 10, 10), { height: 1 }, { costable: true }), A("s", "rubber", rect(30, 30, 10, 10))]); p.pricing.discountPct = 10; return PR.compute({ project: p, takeoff: M.takeoff(p), pricebook: { currency: "EGP", items: { "el:platform": { sell: 100, install: 10 }, "el:rubber": { sell: 50, delivery: 5 } } }, settings: { taxPct: 14, taxLabel: "VAT" }, costs: { "el:platform": 60, "el:rubber": 30 } }); };
const bd = () => PS.breakdown(priced(), PR.CAT_ORDER, PR.CAT_LABEL);
t("The breakdown holds no cost, margin or commission, even when an admin builds it", () => { const r = priced(); assert.ok(r.margin, "the admin's figures exist"); const s = JSON.stringify(PS.breakdown(r, PR.CAT_ORDER, PR.CAT_LABEL)); for (const w of ["margin", "cost", "commission", "noCommission", "serviceCosts"]) assert.ok(!s.includes(w), w); assert.ok(!s.includes(String(r.margin.costMinor))); });
t("Largest items are ordered, without internal figures", () => { const b = bd(); assert.ok(b.largest.length >= 2); for (let i = 1; i < b.largest.length; i++) assert.ok(b.largest[i - 1].totalMinor >= b.largest[i].totalMinor); assert.deepStrictEqual(plain(Object.keys(b.largest[0])).sort(), ["name", "totalMinor"]); });
t("Its categories add up to the subtotal, and shares to 100%", () => { const b = bd(); assert.strictEqual(b.cats.reduce((a, c) => a + c.totalMinor, 0), b.subtotal); assert.ok(Math.abs(b.cats.reduce((a, c) => a + c.share, 0) - 1) < 1e-9); });
t("Its total is exactly the quotation's", () => { const r = priced(), b = PS.breakdown(r, PR.CAT_ORDER, PR.CAT_LABEL); for (const k of ["subtotal", "discount", "afterDiscount", "tax", "total"]) assert.strictEqual(b[k], r[k], k); });
t("Items handled as exceptions or still unpriced are named, not hidden", () => { const p = project([A("a", "rubber", rect(1, 1, 5, 5)), L("f", "fence", [[1, 50], [9, 50]], 0.1), P("g", "bench", 5, 30, 1.5, 0.5, 0)]); p.pricing.exceptions = { "el:rubber": { mode: "excluded", reason: "r" }, "el:fence": { mode: "separate", reason: "r" } }; const r = PR.compute({ project: p, takeoff: M.takeoff(p), pricebook: { currency: "EGP", items: {} }, settings: {} }), b = PS.breakdown(r, PR.CAT_ORDER, PR.CAT_LABEL); assert.ok(b.excluded.some((x) => /rubber/i.test(x))); assert.strictEqual(b.separate.length, 1); assert.strictEqual(b.unpriced.length, 1); });
t("An empty quote doesn't divide by zero", () => { const p = project([]), r = PR.compute({ project: p, takeoff: [], pricebook: { currency: "EGP", items: {} }, settings: {} }); assert.deepStrictEqual(plain(PS.breakdown(r, PR.CAT_ORDER, PR.CAT_LABEL).cats), []); });

/* ---------------- the wiring, read from the source ---------------- */
const src = (f) => fs.readFileSync(path.join(APP, f), "utf8"), pdf = src("proposal.js"), view = src("view3d.js"), ui = src("ui-proposal.js");
t("Other callers get the same PDF as before: new sections default to off", () => assert.ok(/views3d: false, siteItems: false, breakdown: false/.test(pdf)));
t("With the 3D switch off, no new page and nothing extra loads", () => { assert.ok(/on3d = !!\(DPUI\.planner3dOn && DPUI\.planner3dOn\(\)\)/.test(pdf)); assert.ok(/views3d: on3d && sec\.views3d/.test(pdf)); assert.ok(/breakdown: on3d && sec\.breakdown/.test(pdf)); assert.ok(/wantItems = on3d && sec\.siteItems/.test(pdf)); });
t("A failed render never stops the proposal: it's reported instead", () => assert.ok(/could not be made on this device, so they are left out/.test(pdf)));
t("Renders are never written to the project", () => { assert.ok(!/S\.project\.[a-zA-Z.]*=\s*.*toDataURL/.test(pdf)); assert.ok(!/p\.(stills|hero|renders)\s*=/.test(pdf)); assert.ok(/X\.stills = await stillsFor/.test(pdf)); });
t("The 3D note leads with its safety wording, so a phone's two visible lines still say it", () => { const m = view.match(/const parts = \[`<b>([^<]*)<\/b>/); assert.ok(m && /Not for construction/.test(m[1]), m && m[1]); assert.ok(/-webkit-line-clamp:2/.test(view)); assert.ok(/classList\.toggle\("open"\)/.test(view)); });
t("A lost 3D context is an error, not a blank picture in a client document", () => assert.ok(/isContextLost\(\)\) throw/.test(view)));
t("Renders ignore the current selection, handles and grid", () => { assert.ok(/const sel = !V\.still &&/.test(view)); assert.ok(/V\.grid\.visible = false/.test(view)); const body = view.slice(view.indexOf("async function renderStills"), view.indexOf("function syncPlanButton")); assert.ok(!/refreshHandles/.test(body)); });
t("Renders put the open 3D view's state back, even if they fail", () => { const body = view.slice(view.indexOf("async function renderStills"), view.indexOf("function syncPlanButton")); assert.ok(/finally \{ V = outer; \}/.test(body)); assert.ok(!/await/.test(body.slice(body.indexOf("const outer = V"))), "no waiting while standing in for the view"); });
t("Models in renders load through the loader that keeps their textures", () => { const body = view.slice(view.indexOf("async function stillModel"), view.indexOf("async function renderStills")); assert.ok(/gltfLoader\(\)\.parse/.test(body)); assert.ok(/checkModel/.test(body)); });
t("The engineering page is built without quotation data", () => { const body = pdf.slice(pdf.indexOf("function pagesSiteItems"), pdf.indexOf("function pageBreakdown")); for (const w of ["X.r", "fmtMoney", "pricing", "margin"]) assert.ok(!body.includes(w), w); });
t("The screen offers new sections only with the switch on", () => assert.ok(/on3d \? \[\["views3d", "3D views"\]\] : \[\]/.test(ui)));

console.log(`${n - fail} of ${n} tests passed`.replace(/^(\d+) of \1 tests passed$/, "$1 tests passed"));
if (fail) process.exit(1);
