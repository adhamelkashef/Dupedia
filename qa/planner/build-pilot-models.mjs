/* Builds the five pilot 3D models as GLB files, using only code, the published catalogue dimensions and the product photographs.
   Nothing is downloaded or sent anywhere, and no third-party artwork is used. These are APPROXIMATE models: they show the kind of
   product at its real overall size. Their parts are interpreted from photographs, so they are not for manufacturing or engineering.

     node qa/planner/build-pilot-models.mjs       writes models/*.glb and models/manifest.js

   Every model follows the library's rule: metres, +X is the catalogue length, +Z the width, +Y up, origin at the centre of the base.
   A better model (from an artist or elsewhere) replaces a file here and goes through the same check in app/scene3d.js. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = {}; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, "app/products.js"), "utf8"), ctx);
const BY = Object.fromEntries(ctx.DP_PRODUCTS.map((p) => [p.code, p]));

/* ---------------- geometry: every part becomes triangles grouped by material ---------------- */
const MAT = { timber: ["#B98A52", 0.85], darkTimber: ["#5A3A24", 0.85], paleTimber: ["#D9BE8E", 0.85], roof: ["#A9713F", 0.9], rope: ["#C9B48A", 0.95], seat: ["#2B5D45", 0.7], yellow: ["#F2C230", 0.35], slats: ["#A8683A", 0.7], sand: ["#EAD7A6", 1], lime: ["#9CCB3B", 0.45], green: ["#2F7D4F", 0.45], flag: ["#D9C53A", 0.8], holdA: ["#2F8FC4", 0.6], holdB: ["#D8452F", 0.6], holdC: ["#2FB59A", 0.6] };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = (a) => Math.hypot(a[0], a[1], a[2]), unit = (a) => mul(a, 1 / (len(a) || 1));

class Model {
  constructor() { this.tris = {}; }
  tri(m, a, b, c) { (this.tris[m] = this.tris[m] || []).push([a, b, c]); }
  quad(m, a, b, c, d) { this.tri(m, a, b, c); this.tri(m, a, c, d); }
  box(m, x0, x1, y0, y1, z0, z1) {
    const p = (x, y, z) => [x, y, z];
    this.quad(m, p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)); this.quad(m, p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0));
    this.quad(m, p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0)); this.quad(m, p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1));
    this.quad(m, p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1)); this.quad(m, p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0));
  }
  /** Square-section timber from a to b. */
  beam(m, a, b, w, h = w) {
    const d = unit(sub(b, a)), ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], s = mul(unit(cross(d, ref)), w / 2), u = mul(unit(cross(s, d)), h / 2);
    const c = (e, i, j) => add(add(e, mul(s, i)), mul(u, j)), A = [c(a, -1, -1), c(a, 1, -1), c(a, 1, 1), c(a, -1, 1)], B = [c(b, -1, -1), c(b, 1, -1), c(b, 1, 1), c(b, -1, 1)];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(m, A[i], A[j], B[j], B[i]); }
    this.quad(m, A[3], A[2], A[1], A[0]); this.quad(m, B[0], B[1], B[2], B[3]);
  }
  /** Round bar from a to b. */
  rod(m, a, b, r, sides = 8) {
    const d = unit(sub(b, a)), ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], s = unit(cross(d, ref)), u = unit(cross(s, d));
    const ring = (e) => Array.from({ length: sides }, (_, i) => { const t = i / sides * Math.PI * 2; return add(add(e, mul(s, Math.cos(t) * r)), mul(u, Math.sin(t) * r)); }), A = ring(a), B = ring(b);
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; this.quad(m, A[i], A[j], B[j], B[i]); }
  }
  tube(m, pts, r, sides = 8) { for (let i = 1; i < pts.length; i++) this.rod(m, pts[i - 1], pts[i], r, sides); }
  /** A gable roof of separate planks, ridge along X, with a little daylight between them. */
  gable(m, x0, x1, eaveY, ridgeY, halfZ, planks = 7, zc = 0) {
    const th = 0.03;
    for (const sign of [-1, 1]) for (let i = 0; i < planks; i++) { const a = i / planks, b = (i + 0.7) / planks, z = (t) => zc + sign * halfZ * t, y = (t) => ridgeY - (ridgeY - eaveY) * t;
      this.quad(m, [x0, y(a), z(a)], [x1, y(a), z(a)], [x1, y(b), z(b)], [x0, y(b), z(b)]); this.quad(m, [x0, y(a) - th, z(a)], [x1, y(a) - th, z(a)], [x1, y(b) - th, z(b)], [x0, y(b) - th, z(b)]); }
  }
  /** A slide: a curved bed with raised sides, following the path. Width runs along the given horizontal axis. */
  slide(m, path, halfW, wall = 0.14) {
    for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], [ax, ay, az] = a, [bx, by, bz] = b, dir = unit([bx - ax, 0, bz - az]), s = [-dir[2] * halfW, 0, dir[0] * halfW];
      const L = add(a, s), R = sub(a, s), L2 = add(b, s), R2 = sub(b, s); this.quad(m, L, R, R2, L2);
      for (const [p, q] of [[L, L2], [R, R2]]) { this.quad(m, p, q, add(q, [0, wall, 0]), add(p, [0, wall, 0])); } }
  }
  /** A three-part swing hung from a beam along X. */
  swing(x, top, seatY, zs = 0.16) { this.rod("rope", [x, top, -zs], [x, seatY, -zs], 0.012, 5); this.rod("rope", [x, top, zs], [x, seatY, zs], 0.012, 5); this.box("seat", x - 0.1, x + 0.1, seatY - 0.03, seatY + 0.02, -zs - 0.03, zs + 0.03); }
  posts(m, xs, zs, y0, y1, w) { for (const x of xs) for (const z of zs) this.beam(m, [x, y0, z], [x, y1, z], w); }
}

/* ---------------- the five pilots, read from their photographs ---------------- */
const PILOTS = {
  "SW-A409": (M) => { // A-frame swing: one long beam, A-frames at each end, three seats
    M.beam("timber", [-2, 2.25, 0], [2, 2.25, 0], 0.11, 0.13);
    for (const x of [-1.9, 1.9]) { for (const z of [-1.2, 1.2]) M.beam("timber", [x, 2.25, 0], [x, 0, z], 0.09); M.beam("timber", [x, 0.85, -0.8], [x, 0.85, 0.8], 0.06, 0.09); }
    for (const x of [-1.15, 0, 1.15]) M.swing(x, 2.18, 0.55);
  },
  "SW-L509": (M) => { // Yellow hoop ends, timber slats between them
    const H = (x) => { const pts = [[x, 0, -0.2], [x, 0.53, -0.2]]; for (let i = 1; i <= 10; i++) { const t = Math.PI - i / 10 * Math.PI; pts.push([x, 0.53 + Math.sin(t) * 0.2, Math.cos(t) * 0.2]); } pts.push([x, 0, 0.2]); M.tube("yellow", pts, 0.025, 10); };
    H(-0.72); H(0.72); for (const z of [-0.14, 0, 0.14]) M.box("slats", -0.72, 0.72, 0.42, 0.455, z - 0.065, z + 0.065); for (const x of [-0.72, 0.72]) M.beam("yellow", [x, 0.4, -0.19], [x, 0.4, 0.19], 0.03);
  },
  "SW-Y311": (M) => { // Espresso sand house: boxed base, sand, four posts, plank gable, gable flags
    const a = 0.72; for (const [p, q] of [[[-a, 0.1, -a], [a, 0.1, -a]], [[-a, 0.1, a], [a, 0.1, a]], [[-a, 0.1, -a], [-a, 0.1, a]], [[a, 0.1, -a], [a, 0.1, a]]]) M.beam("darkTimber", p, q, 0.08, 0.2);
    M.box("sand", -a, a, 0, 0.12, -a, a); M.posts("darkTimber", [-a, a], [-a, a], 0, 1.35, 0.09);
    for (const z of [-a, a]) M.beam("darkTimber", [-a, 1.35, z], [a, 1.35, z], 0.08, 0.1); for (const x of [-a, a]) M.beam("darkTimber", [x, 1.35, -a], [x, 1.35, a], 0.08, 0.1);
    for (const x of [-a, a]) { M.beam("darkTimber", [x, 1.35, -a], [x, 2.08, 0], 0.07); M.beam("darkTimber", [x, 1.35, a], [x, 2.08, 0], 0.07); M.beam("darkTimber", [x, 1.35, 0], [x, 2.08, 0], 0.06); }
    M.beam("darkTimber", [-a, 2.08, 0], [a, 2.08, 0], 0.08); M.gable("darkTimber", -0.75, 0.75, 1.32, 2.1, 0.75, 8);
    for (const x of [-a, a]) { M.rod("rope", [x, 2.05, 0], [x, 2.25, 0], 0.01, 5); M.tri("flag", [x, 2.25, 0], [x, 2.14, 0], [x + (x < 0 ? -0.03 : 0.03), 2.2, 0.17]); }
  },
  "SW-T211": (M) => { // Pale tower: tall posts, deck at 0.6, plank wall, lime slide one way, climbing wall the other, sand frame below
    const x0 = -0.15, x1 = 0.45, z = 0.34; M.posts("paleTimber", [x0, x1], [-z, z], 0, 1.8, 0.09); M.box("paleTimber", x0, x1, 0.57, 0.62, -z, z);
    for (const y of [1.15, 1.55]) { M.beam("paleTimber", [x0, y, -z], [x1, y, -z], 0.05, 0.09); M.beam("paleTimber", [x0, y, z], [x1, y, z], 0.05, 0.09); M.beam("paleTimber", [x1, y, -z], [x1, y, z], 0.05, 0.09); }
    for (let i = 0; i < 5; i++) { const zz = -z + 0.06 + i * 0.145; M.box("paleTimber", x0 - 0.02, x0 + 0.02, 0.62, 1.6, zz - 0.06, zz + 0.06); }
    for (const [xx, yy] of [[x1, 1.05]]) M.tube("yellow", [[xx, yy, -0.16], [xx + 0.03, yy + 0.2, -0.16]], 0.015, 6);
    M.tube("yellow", [[x0 + 0.02, 0.8, -0.34], [x0 + 0.02, 1.15, -0.34]], 0.015, 6); M.tube("yellow", [[x1, 0.8, 0.34], [x1, 1.15, 0.34]], 0.015, 6);
    const path = []; for (let i = 0; i <= 8; i++) { const t = i / 8; path.push([x0 - t * 0.8, 0.6 - 0.56 * (t < 0.15 ? t * 0.6 : 0.09 + (t - 0.15) * 1.07), 0]); } M.slide("lime", path, 0.21, 0.13);
    M.beam("paleTimber", [x1 + 0.03, 0.6, 0], [0.95, 0.02, 0], 0.62, 0.05); [["holdA", 0.72, 0.28, -0.12], ["holdB", 0.82, 0.18, 0.14], ["holdC", 0.62, 0.42, 0.12], ["holdB", 0.58, 0.48, -0.17]].forEach(([m, x, y, zz]) => M.box(m, x - 0.035, x + 0.035, y, y + 0.06, zz - 0.04, zz + 0.04));
    for (const zz of [-0.6, 0.6]) M.beam("paleTimber", [-0.45, 0.06, zz], [0.5, 0.06, zz], 0.07, 0.12); for (const xx of [-0.45, 0.5]) M.beam("paleTimber", [xx, 0.06, -0.6], [xx, 0.06, 0.6], 0.07, 0.12); M.box("sand", -0.45, 0.5, 0, 0.05, -0.6, 0.6);
  },
  "SW-E104": (M) => { // Twin peaked towers, bridge, green slide, climbing wall, swing beam with three seats
    const tower = (x0, x1, peak) => { const z = 0.6; M.posts("timber", [x0, x1], [-z, z], 0, 2.35, 0.11); M.box("timber", x0 - 0.04, x1 + 0.04, 1.44, 1.5, -z - 0.04, z + 0.04);
      for (let i = 0; i <= 8; i++) { const t = i / 8; for (const zz of [-z, z]) M.beam("timber", [x0 + (x1 - x0) * t, 1.5, zz], [x0 + (x1 - x0) * t, 2.0, zz], 0.035, 0.05); }
      for (const zz of [-z, z]) M.beam("timber", [x0, 2.0, zz], [x1, 2.0, zz], 0.05, 0.07);
      for (const x of [x0, x1]) { M.beam("timber", [x, 2.35, -z - 0.1], [x, peak, 0], 0.08); M.beam("timber", [x, 2.35, z + 0.1], [x, peak, 0], 0.08); }
      M.gable("roof", x0 - 0.12, x1 + 0.12, 2.3, peak + 0.02, z + 0.2, 9); M.rod("rope", [(x0 + x1) / 2, peak, 0], [(x0 + x1) / 2, 3.3, 0], 0.012, 5); M.tri("flag", [(x0 + x1) / 2, 3.3, 0], [(x0 + x1) / 2, 3.12, 0], [(x0 + x1) / 2 + 0.22, 3.2, 0]);
      M.beam("timber", [x0, 2.35, -z], [x1, 2.35, -z], 0.06, 0.09); M.beam("timber", [x0, 2.35, z], [x1, 2.35, z], 0.06, 0.09); };
    tower(-3.85, -2.75, 3.05); tower(-1.25, -0.15, 3.05);
    for (let i = 0; i < 11; i++) { const x = -2.75 + i * 0.15; M.box("timber", x, x + 0.11, 1.44, 1.48, -0.42, 0.42); } // bridge deck planks
    for (const z of [-0.42, 0.42]) { M.beam("timber", [-2.75, 2.0, z], [-1.25, 2.0, z], 0.05, 0.07); M.beam("timber", [-2.75, 1.48, z], [-1.25, 1.48, z], 0.05, 0.07); for (let i = 0; i <= 8; i++) { const x = -2.75 + i * 1.5 / 8; M.beam("timber", [x, 1.48, z], [x, 2.0, z], 0.03, 0.04); } }
    const path = []; for (let i = 0; i <= 10; i++) { const t = i / 10; path.push([-0.7 - t * 0.5, 1.48 - 1.36 * (t < 0.12 ? t * 0.5 : 0.06 + (t - 0.12) * 1.068), 0.62 + t * 1.33]); } M.slide("green", path, 0.26, 0.15);
    M.beam("timber", [-3.9, 1.5, 0], [-4.66, 0.02, 0], 0.95, 0.06); [["holdA", -4.2, 1.0, -0.2], ["holdB", -4.4, 0.6, 0.22], ["holdC", -4.1, 1.2, 0.2], ["holdB", -4.5, 0.42, -0.2], ["holdA", -4.3, 0.82, 0.08]].forEach(([m, x, y, z]) => M.box(m, x - 0.05, x + 0.05, y, y + 0.1, z - 0.05, z + 0.05));
    M.beam("timber", [-0.15, 2.7, 0], [4.45, 2.7, 0], 0.12, 0.14); M.posts("timber", [-0.15], [0], 2.3, 2.75, 0.11); for (const z of [-1.2, 1.2]) M.beam("timber", [4.45, 2.7, 0], [4.45, 0, z], 0.1); M.beam("timber", [4.45, 1.0, -0.78], [4.45, 1.0, 0.78], 0.07, 0.1); M.beam("timber", [4.45, 2.7, 0], [4.67, 2.7, 0], 0.1);
    for (const x of [1.05, 2.25, 3.45]) M.swing(x, 2.62, 0.5);
  },
};

/* ---------------- fit exactly to the published size, then write the GLB ---------------- */
function fit(model, d) {
  const all = Object.values(model.tris).flat(2); let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of all) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  const size = sub(mx, mn), want = [d.l, d.h, d.w], scale = want.map((w, i) => w / size[i]), stretch = Math.max(...scale.map((s) => Math.abs(s - 1)));
  if (stretch > 0.2) throw new Error(`The drawing is ${Math.round(stretch * 100)}% away from the published size. Redraw it rather than stretch it.`);
  const put = (p) => [(p[0] - (mn[0] + mx[0]) / 2) * scale[0], (p[1] - mn[1]) * scale[1], (p[2] - (mn[2] + mx[2]) / 2) * scale[2]];
  for (const m of Object.keys(model.tris)) model.tris[m] = model.tris[m].map((t) => t.map(put));
  return stretch;
}
const hexRgb = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
function glb(model, code, source) {
  const names = Object.keys(model.tris), chunks = [], views = [], accessors = [], prims = []; let off = 0, triangles = 0;
  const push = (arr, target) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); chunks.push(b, Buffer.alloc(pad)); off += b.length + pad; return views.length - 1; };
  names.forEach((m, mi) => {
    const verts = [], norms = [], idx = [], seen = new Map(); const r = (v) => Math.round(v * 1e5) / 1e5;
    for (const [a, b, c] of model.tris[m]) { const nv = cross(sub(b, a), sub(c, a)); if (len(nv) < 1e-10) continue; const n = unit(nv); triangles++;
      for (const p of [a, b, c]) { const k = [r(p[0]), r(p[1]), r(p[2]), Math.round(n[0] * 100), Math.round(n[1] * 100), Math.round(n[2] * 100)].join(); let i = seen.get(k); if (i == null) { i = verts.length / 3; seen.set(k, i); verts.push(p[0], p[1], p[2]); norms.push(n[0], n[1], n[2]); } idx.push(i); } }
    const pos = new Float32Array(verts), nor = new Float32Array(norms), ind = verts.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
    const vp = push(pos, 34962), vn = push(nor, 34962), vi = push(ind, 34963);
    accessors.push({ bufferView: vp, componentType: 5126, count: pos.length / 3, type: "VEC3", min: mn, max: mx }, { bufferView: vn, componentType: 5126, count: nor.length / 3, type: "VEC3" }, { bufferView: vi, componentType: ind instanceof Uint32Array ? 5125 : 5123, count: ind.length, type: "SCALAR" });
    prims.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: mi });
  });
  const json = { asset: { version: "2.0", generator: source }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: code }], meshes: [{ name: code, primitives: prims }],
    materials: names.map((m) => ({ name: m, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...hexRgb(MAT[m][0]), 1], metallicFactor: 0, roughnessFactor: MAT[m][1] } })), accessors, bufferViews: views, buffers: [{ byteLength: off }] };
  const bin = Buffer.concat(chunks); let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4E4F534A, 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004E4942, 4);
  return { data: Buffer.concat([head, c1, js, c2, bin]), triangles };
}

const SOURCE = "Built by code from the published catalogue dimensions and the product photograph";
const manifest = {}; mkdirSync(join(ROOT, "models"), { recursive: true });
for (const [code, draw] of Object.entries(PILOTS)) {
  const M = new Model(); draw(M); const d = BY[code].dims, stretch = fit(M, d), { data, triangles } = glb(M, code, "X FORCE pilot model builder"), file = `models/${code}.glb`;
  writeFileSync(join(ROOT, file), data);
  manifest[code] = { file, accuracy: "approximate", source: SOURCE };
  console.log(`${code} ${BY[code].name}: ${triangles} triangles, ${Math.round(data.length / 1024)} KB, fitted by ${(stretch * 100).toFixed(1)}%`);
}
writeFileSync(join(ROOT, "models/manifest.js"), `/* Generated by qa/planner/build-pilot-models.mjs. The product models shipped with the app. Administrators can add colours, materials and review details in Admin > 3D library. */\nwindow.DP_MODELS = ${JSON.stringify(manifest, null, 1)};\n`);
