/* Dupedia Site Planner 2.0 — catalogue: verified products (products.js) + site element library + pricing categories.
   Products keep their published data and flags untouched; admin overrides (codes, dimensions, zones) are applied on top at runtime. */
/* global DP_PRODUCTS, DP_COLLECTIONS */
(function (root) {
  "use strict";

  const CATEGORIES = [
    { key: "equipment", label: "Playground equipment" },
    { key: "landscape", label: "Landscape & infrastructure" },
    { key: "flooring", label: "Safety flooring & surfaces" },
    { key: "installation", label: "Installation" },
    { key: "services", label: "Other services" },
    { key: "additional", label: "Additional charges" },
  ];
  const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

  const PROJECT_TYPES = ["Residential compound", "School", "Nursery / early years", "Hotel & resort", "Public park", "Sporting club", "Municipality", "Shopping mall", "Entertainment facility", "Private villa", "Other"];

  /* Element library. kind: point (placed object) | line (drawn route) | area (drawn polygon).
     unit: each | m | m2.  cat: pricing category.  costable: priced by default.  blocks: physical, used in overlap checks.
     Nothing here carries a price: prices live in the admin price book. */
  const GROUPS = [
    { key: "landscape", label: "Landscape" },
    { key: "infrastructure", label: "Site infrastructure" },
    { key: "surfaces", label: "Safety & circulation" },
    { key: "generic", label: "Generic equipment" },
    { key: "custom", label: "Custom & annotation" },
  ];
  const E = (o) => Object.assign({ costable: true, blocks: true, unit: "each", cat: "landscape", resizable: true }, o);
  const ELEMENTS = [
    // landscape
    E({ id: "tree", name: "Tree", group: "landscape", kind: "point", shape: "circle", d: 4, sym: "tree", note: "Canopy diameter; trunk at centre." }),
    E({ id: "palm", name: "Palm tree", group: "landscape", kind: "point", shape: "circle", d: 3, sym: "palm" }),
    E({ id: "tree-existing", name: "Existing tree (retain)", group: "landscape", kind: "point", shape: "circle", d: 5, sym: "treeExisting", costable: false, existing: true }),
    E({ id: "shrub", name: "Shrub", group: "landscape", kind: "point", shape: "circle", d: 1.2, sym: "shrub", blocks: false }),
    E({ id: "planter", name: "Planter", group: "landscape", kind: "point", shape: "rect", l: 1.2, w: 0.6, sym: "planter" }),
    E({ id: "grass", name: "Natural grass", group: "landscape", kind: "area", unit: "m2", sym: "grass", blocks: false }),
    E({ id: "planting", name: "Planting area", group: "landscape", kind: "area", unit: "m2", sym: "planting", blocks: true }),
    E({ id: "bed", name: "Landscape bed", group: "landscape", kind: "area", unit: "m2", sym: "bed", blocks: true }),
    E({ id: "gravel", name: "Decorative gravel / stone", group: "landscape", kind: "area", unit: "m2", sym: "gravel", blocks: false }),
    E({ id: "hedge", name: "Hedge", group: "landscape", kind: "line", width: 0.8, unit: "m", sym: "hedge" }),
    // infrastructure
    E({ id: "fence", name: "Fence", group: "infrastructure", kind: "line", width: 0.08, unit: "m", sym: "fence", note: "Length is net of gates placed on it." }),
    E({ id: "wall", name: "Wall", group: "infrastructure", kind: "line", width: 0.25, unit: "m", sym: "wall" }),
    E({ id: "gate", name: "Entrance gate", group: "infrastructure", kind: "point", shape: "rect", l: 1.2, w: 0.12, sym: "gate", gate: true, blocks: false, note: "Place on a fence: its width is deducted from the fence length." }),
    E({ id: "gate-exit", name: "Exit gate", group: "infrastructure", kind: "point", shape: "rect", l: 1.2, w: 0.12, sym: "gate", gate: true, blocks: false }),
    E({ id: "gate-double", name: "Double / maintenance gate", group: "infrastructure", kind: "point", shape: "rect", l: 3.0, w: 0.12, sym: "gateDouble", gate: true, blocks: false }),
    E({ id: "opening", name: "Pedestrian entrance (opening)", group: "infrastructure", kind: "point", shape: "rect", l: 1.5, w: 0.12, sym: "opening", gate: true, costable: false, blocks: false }),
    E({ id: "path", name: "Pathway", group: "infrastructure", kind: "line", width: 1.5, unit: "m2", sym: "path", blocks: false, note: "Priced by area (length × width)." }),
    E({ id: "ramp", name: "Ramp", group: "infrastructure", kind: "point", shape: "rect", l: 3, w: 1.5, sym: "ramp" }),
    E({ id: "bench", name: "Bench (generic)", group: "infrastructure", kind: "point", shape: "rect", l: 1.8, w: 0.6, sym: "benchGeneric" }),
    E({ id: "picnic", name: "Picnic table (generic)", group: "infrastructure", kind: "point", shape: "rect", l: 1.8, w: 1.6, sym: "picnicGeneric" }),
    E({ id: "bin", name: "Waste bin", group: "infrastructure", kind: "point", shape: "circle", d: 0.6, sym: "bin" }),
    E({ id: "pergola", name: "Pergola", group: "infrastructure", kind: "point", shape: "rect", l: 4, w: 4, sym: "pergola", blocks: false, overhead: true }),
    E({ id: "shade", name: "Shade structure", group: "infrastructure", kind: "point", shape: "rect", l: 6, w: 6, sym: "shade", blocks: false, overhead: true }),
    E({ id: "light", name: "Lighting fixture", group: "infrastructure", kind: "point", shape: "circle", d: 0.4, sym: "light" }),
    E({ id: "bollard", name: "Bollard", group: "infrastructure", kind: "point", shape: "circle", d: 0.25, sym: "bollard" }),
    // safety & circulation
    E({ id: "rubber", name: "Rubber safety flooring", group: "surfaces", kind: "area", unit: "m2", cat: "flooring", sym: "rubber", blocks: false, surface: true }),
    E({ id: "turf", name: "Artificial grass", group: "surfaces", kind: "area", unit: "m2", cat: "flooring", sym: "turf", blocks: false, surface: true }),
    E({ id: "sand", name: "Sand zone", group: "surfaces", kind: "area", unit: "m2", cat: "flooring", sym: "sand", blocks: false, surface: true }),
    E({ id: "safety-floor", name: "Safety flooring zone", group: "surfaces", kind: "area", unit: "m2", cat: "flooring", sym: "safetyFloor", blocks: false, surface: true }),
    E({ id: "path-accessible", name: "Accessible pathway", group: "surfaces", kind: "line", width: 1.8, unit: "m2", sym: "pathAccessible", blocks: false }),
    E({ id: "route-emergency", name: "Emergency access route", group: "surfaces", kind: "line", width: 3.5, unit: "m", sym: "routeEmergency", costable: false, blocks: false, annotation: true }),
    E({ id: "clearance", name: "Safety clearance area", group: "surfaces", kind: "area", unit: "m2", sym: "clearance", costable: false, blocks: false, annotation: true, keepClear: true }),
    E({ id: "restricted", name: "Restricted / no-build zone", group: "surfaces", kind: "area", unit: "m2", sym: "restricted", costable: false, blocks: true, noBuild: true }),
    E({ id: "existing", name: "Existing obstacle", group: "surfaces", kind: "area", unit: "m2", sym: "existing", costable: false, blocks: true, existing: true }),
    // generic equipment (not catalogue products: dimensions and clearance must come from the chosen supplier)
    E({ id: "g-roundabout", name: "Roundabout", group: "generic", kind: "point", shape: "circle", d: 2.0, sym: "roundabout", cat: "equipment", generic: true }),
    E({ id: "g-spring", name: "Spring rider", group: "generic", kind: "point", shape: "rect", l: 0.9, w: 0.35, sym: "springRider", cat: "equipment", generic: true }),
    E({ id: "g-trampoline", name: "In-ground trampoline", group: "generic", kind: "point", shape: "rect", l: 2.0, w: 2.0, sym: "trampoline", cat: "equipment", generic: true }),
    E({ id: "g-seesaw", name: "Seesaw", group: "generic", kind: "point", shape: "rect", l: 3.0, w: 0.5, sym: "seesaw", cat: "equipment", generic: true }),
    E({ id: "g-swing", name: "Swing (2 seats)", group: "generic", kind: "point", shape: "rect", l: 3.6, w: 1.8, sym: "swing2", cat: "equipment", generic: true }),
    E({ id: "g-basket", name: "Basket swing", group: "generic", kind: "point", shape: "rect", l: 3.0, w: 2.0, sym: "basketSwing", cat: "equipment", generic: true }),
    E({ id: "g-slide", name: "Freestanding slide", group: "generic", kind: "point", shape: "rect", l: 3.5, w: 0.9, sym: "slideFree", cat: "equipment", generic: true }),
    E({ id: "g-spinner", name: "Spinner", group: "generic", kind: "point", shape: "circle", d: 1.0, sym: "spinner", cat: "equipment", generic: true }),
    // custom
    E({ id: "custom-area", name: "Custom area", group: "custom", kind: "area", unit: "m2", sym: "customArea", blocks: false }),
    E({ id: "custom-object", name: "Custom object", group: "custom", kind: "point", shape: "rect", l: 1, w: 1, sym: "customObject" }),
    E({ id: "custom-line", name: "Custom line", group: "custom", kind: "line", width: 0.1, unit: "m", sym: "customLine", blocks: false }),
    E({ id: "label", name: "Text label", group: "custom", kind: "point", shape: "rect", l: 2, w: 0.6, sym: "label", costable: false, blocks: false, annotation: true, resizable: false }),
    E({ id: "dimension", name: "Dimension line", group: "custom", kind: "line", width: 0.02, unit: "m", sym: "dimension", costable: false, blocks: false, annotation: true }),
  ];
  const EL = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));

  /* ---------- products (verified data; admin overrides layered on at runtime) ---------- */
  const BASE = (root.DP_PRODUCTS || []).map((p) => Object.assign({}, p));
  const COLLECTIONS = root.DP_COLLECTIONS || [];
  let overrides = {};       // code → {name, displayCode, dims:{l,w,h}, zone:{l,w}, active, description}
  let customProducts = [];  // admin-added: {code, name, collection:'custom', dims, zone, sym, description, active}
  let PRODUCTS = [], BY = {};

  function rebuild() {
    PRODUCTS = BASE.map((p) => {
      const o = overrides[p.code]; if (!o) return p;
      const q = Object.assign({}, p, { overridden: true });
      if (o.name) q.name = o.name;
      if (o.displayCode) q.displayCode = o.displayCode;
      if (o.description) q.description = o.description;
      if (o.dims && o.dims.l > 0 && o.dims.w > 0) { q.dims = Object.assign({}, p.dims || { unit: "m" }, { l: +o.dims.l, w: +o.dims.w, h: o.dims.h ? +o.dims.h : (p.dims && p.dims.h) || null }); q.dims.text = `L ${q.dims.l.toFixed(2)} × W ${q.dims.w.toFixed(2)}${q.dims.h ? ` × H ${(+q.dims.h).toFixed(2)}` : ""} m`; q.plannerReady = true; }
      if (o.zone && o.zone.l > 0 && o.zone.w > 0) q.zone = { kind: "rect", l: +o.zone.l, w: +o.zone.w, text: `${(+o.zone.l).toFixed(2)} × ${(+o.zone.w).toFixed(2)} m (admin)` };
      if (o.active === false) q.inactive = true;
      return q;
    });
    for (const c of customProducts) PRODUCTS.push(Object.assign({ collection: "custom", collectionName: "Custom products", flags: [], plannerReady: true, custom: true, age: c.age || "", thumb: null }, c,
      { dims: Object.assign({ unit: "m" }, c.dims, { text: `L ${(+c.dims.l).toFixed(2)} × W ${(+c.dims.w).toFixed(2)}${c.dims.h ? ` × H ${(+c.dims.h).toFixed(2)}` : ""} m` }),
        zone: c.zone && c.zone.l > 0 ? { kind: "rect", l: +c.zone.l, w: +c.zone.w, text: `${(+c.zone.l).toFixed(2)} × ${(+c.zone.w).toFixed(2)} m` } : { kind: "plan", text: "Not set" } }));
    BY = Object.fromEntries(PRODUCTS.map((p) => [p.code, p]));
    API.PRODUCTS = PRODUCTS; API.BY = BY;
  }
  function setCatalogConfig(cfg) { overrides = (cfg && cfg.overrides) || {}; customProducts = (cfg && cfg.custom) || []; rebuild(); }

  /** Pricing category of a product. */
  const productCat = (p) => (p && p.collection === "landscape" ? "landscape" : "equipment");
  /** Unique pricing key for anything that can carry a price. */
  const priceKey = (o) => (o.kind === "product" ? o.code : "el:" + o.type);

  const API = { CATEGORIES, CAT, PROJECT_TYPES, GROUPS, ELEMENTS, EL, COLLECTIONS, PRODUCTS, BY, setCatalogConfig, rebuild, productCat, priceKey,
    get overrides() { return overrides; }, get customProducts() { return customProducts; } };
  rebuild();
  root.DPCat = API;
})(typeof self !== "undefined" ? self : this);
