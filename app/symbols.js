/* Dupedia Site Planner 2.0 — top-view (plan) symbols.
   Every product is composed from real components (towers, roofs, slides, swing beams, bridges, nets, walls, trampolines…)
   laid out inside its published footprint (L × W). The outline never exceeds the footprint, so the drawing stays accurate.
   Coordinates: box frame (0,0)…(L,W) in metres; the caller has already moved the pen to the item centre and rotation.
   Layouts are interpretive plan symbols drawn from the product photographs, not manufacturer drawings. */
/* global DPCat */
(function (root) {
  "use strict";
  const PAL = {
    ink: "#262626", graphite: "#45453F", pebble: "#5E5E58", stone: "#EAE8E1", cream: "#FBFAF6", white: "#FFFFFF",
    deck: "#E6DAC0", plank: "#B9A784", roof: "#3B3B36", roofLine: "#77776E", roofLight: "#56564F",
    lime: "#B8D241", limeDark: "#8FA82B", limeInk: "#5B6B12", limeTint: "#E3EDB8",
    seat: "#262626", rope: "#9A8763", sand: "#F0E4C0", sandDot: "#CDB98A", mat: "#2F2F2B",
    canopy: "#A9C64A", canopyDark: "#7C9A26", canopyLight: "#C9DD7A", trunk: "#6B5A3E",
    red: "#B3261E", amber: "#D99A00",
  };
  const LW = { out: 0.035, det: 0.02, fine: 0.012 };

  /* ---------------- primitive components (box coords, metres) ---------------- */
  const C = {};
  /** Platform deck with plank lines and corner posts; optional roof (hip | gable | flat | none). */
  C.deck = (P, x, y, w, h, o = {}) => {
    P.begin().rect(x, y, w, h).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out });
    if (o.lod > 10) { // planks
      P.begin(); const along = w >= h, n = Math.floor((along ? h : w) / 0.16);
      for (let i = 1; i < n; i++) { const t = i * 0.16; if (along) P.line(x, y + t, x + w, y + t); else P.line(x + t, y, x + t, y + h); }
      P.stroke(PAL.plank, LW.fine);
    }
    if (o.roof) C.roof(P, x, y, w, h, o.roof, o);
    else C.posts(P, x, y, w, h);
  };
  C.posts = (P, x, y, w, h, s = 0.1) => { P.begin(); for (const [px, py] of [[x, y], [x + w - s, y], [x + w - s, y + h - s], [x, y + h - s]]) P.rect(px, py, s, s); P.fill(PAL.ink); };
  /** Roof seen from above with ridge/hip lines. */
  C.roof = (P, x, y, w, h, kind, o = {}) => {
    const ov = Math.min(0.12, w * 0.08, h * 0.08), X0 = x - ov, Y0 = y - ov, W = w + 2 * ov, H = h + 2 * ov;
    const fx = Math.max(x - ov, o.bx0 == null ? -1e9 : o.bx0), fy = Math.max(y - ov, o.by0 == null ? -1e9 : o.by0);
    const rx0 = Math.max(X0, 0), ry0 = Math.max(Y0, 0), rx1 = Math.min(X0 + W, o.L || 1e9), ry1 = Math.min(Y0 + H, o.W || 1e9);
    void fx; void fy;
    const RX = rx0, RY = ry0, RW = rx1 - rx0, RH = ry1 - ry0;
    const fill = o.roofColor || PAL.roof;
    P.begin().rect(RX, RY, RW, RH).fill(fill);
    const shade = (pts, a, white) => P.begin().poly(pts).fill(white ? "#FFFFFF" : "#000000", a);
    if (kind === "gable") {
      if (RW >= RH) { shade([[RX, RY], [RX + RW, RY], [RX + RW, RY + RH / 2], [RX, RY + RH / 2]], 0.14, true); shade([[RX, RY + RH / 2], [RX + RW, RY + RH / 2], [RX + RW, RY + RH], [RX, RY + RH]], 0.12, false); }
      else { shade([[RX, RY], [RX + RW / 2, RY], [RX + RW / 2, RY + RH], [RX, RY + RH]], 0.14, true); shade([[RX + RW / 2, RY], [RX + RW, RY], [RX + RW, RY + RH], [RX + RW / 2, RY + RH]], 0.12, false); }
      P.begin(); if (RW >= RH) P.line(RX, RY + RH / 2, RX + RW, RY + RH / 2); else P.line(RX + RW / 2, RY, RX + RW / 2, RY + RH); P.stroke(PAL.roofLine, LW.det);
    } else if (kind === "flat") {
      P.begin().rect(RX + 0.08, RY + 0.08, RW - 0.16, RH - 0.16).stroke(PAL.roofLine, LW.det);
    } else { // hip / pyramid: four shaded facets
      const m = Math.min(RW, RH) / 2;
      const a = RW >= RH ? [RX + m, RY + RH / 2] : [RX + RW / 2, RY + m], b = RW >= RH ? [RX + RW - m, RY + RH / 2] : [RX + RW / 2, RY + RH - m];
      shade([[RX, RY], [RX + RW, RY], b, a], 0.16, true);          // north: lit
      shade([[RX, RY], a, [RX, RY + RH]], 0.07, true);              // west
      shade([[RX + RW, RY], [RX + RW, RY + RH], b], 0.1, false);   // east
      shade([[RX, RY + RH], [RX + RW, RY + RH], b, a], 0.18, false);// south: shade
      P.begin().line(RX, RY, a[0], a[1]).line(RX, RY + RH, a[0], a[1]).line(RX + RW, RY, b[0], b[1]).line(RX + RW, RY + RH, b[0], b[1]);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) P.line(a[0], a[1], b[0], b[1]);
      P.stroke(PAL.roofLine, LW.fine);
    }
    P.begin().rect(RX, RY, RW, RH).stroke(PAL.ink, LW.out);
    if (o.flag) { P.begin().moveTo(RX + RW / 2, RY + RH / 2).lineTo(RX + RW / 2 + 0.35, RY + RH / 2 - 0.1).lineTo(RX + RW / 2, RY + RH / 2 - 0.2).close().fill(PAL.lime); }
  };
  /** Slide: chute from (x1,y1) [top, at deck] to (x2,y2) [exit]. kind: straight | wave | tube */
  C.slide = (P, x1, y1, x2, y2, w = 0.5, kind = "straight", col) => {
    const L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.05) return;
    const a = Math.atan2(y2 - y1, x2 - x1);
    P.save().translate(x1, y1).rotate(a);
    const hw = w / 2, run = Math.min(0.45, L * 0.25);
    const bed = col || PAL.lime;
    P.begin().moveTo(0, -hw).lineTo(L - run, -hw).quadTo(L, -hw, L, 0).quadTo(L, hw, L - run, hw).lineTo(0, hw).close().paint({ fill: bed, stroke: PAL.ink, width: LW.out });
    P.begin().moveTo(0.05, -hw + 0.07).lineTo(L - run, -hw + 0.07).moveTo(0.05, hw - 0.07).lineTo(L - run, hw - 0.07).stroke(PAL.limeInk, LW.det);
    if (kind === "wave") { P.begin(); for (let t = L * 0.3; t < L - run; t += L * 0.25) P.line(t, -hw + 0.07, t, hw - 0.07); P.stroke(PAL.limeInk, LW.fine); }
    if (kind === "tube") { P.begin(); for (let t = 0.25; t < L - run; t += 0.3) P.line(t, -hw, t, hw); P.stroke(PAL.limeInk, LW.det); }
    // direction chevron
    P.begin().moveTo(L * 0.45, -hw * 0.35).lineTo(L * 0.55, 0).lineTo(L * 0.45, hw * 0.35).stroke(PAL.limeInk, LW.det, { cap: "round", join: "round" });
    P.restore();
  };
  /** Ladder / stairs along a run with rungs. */
  C.ladder = (P, x1, y1, x2, y2, w = 0.5, stairs = false) => {
    const L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.05) return; const a = Math.atan2(y2 - y1, x2 - x1);
    P.save().translate(x1, y1).rotate(a);
    if (stairs) P.begin().rect(0, -w / 2, L, w).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.det });
    P.begin().line(0, -w / 2, L, -w / 2).line(0, w / 2, L, w / 2).stroke(PAL.ink, LW.out);
    P.begin(); for (let t = 0.22; t < L - 0.05; t += 0.25) P.line(t, -w / 2, t, w / 2); P.stroke(PAL.graphite, LW.det);
    P.restore();
  };
  /** Bridge: planks across, rope/rail sides. */
  C.bridge = (P, x1, y1, x2, y2, w = 0.7, rope = false) => {
    const L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.05) return; const a = Math.atan2(y2 - y1, x2 - x1);
    P.save().translate(x1, y1).rotate(a);
    P.begin().rect(0, -w / 2, L, w).fill(PAL.deck);
    P.begin(); for (let t = 0.12; t < L; t += 0.16) P.line(t, -w / 2 + 0.05, t, w / 2 - 0.05); P.stroke(PAL.plank, LW.det);
    P.begin().line(0, -w / 2, L, -w / 2).line(0, w / 2, L, w / 2).stroke(rope ? PAL.rope : PAL.ink, rope ? LW.det * 1.5 : LW.out, rope ? { dash: [0.12, 0.06] } : {});
    P.restore();
  };
  /** Swing beam with A-frame legs and seats. seats: array of 'flat'|'toddler'|'basket'|'tire'|'surf'. */
  C.swing = (P, x1, y1, x2, y2, spread, seats = ["flat", "flat"]) => {
    const L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.1) return; const a = Math.atan2(y2 - y1, x2 - x1);
    P.save().translate(x1, y1).rotate(a);
    const s = spread / 2;
    // legs (A-frame seen from above: lines out to the feet)
    P.begin().line(0, 0, 0.18, -s).line(0, 0, 0.18, s).line(L, 0, L - 0.18, -s).line(L, 0, L - 0.18, s).stroke(PAL.ink, 0.07, { cap: "round" });
    P.begin(); for (const [fx, fy] of [[0.18, -s], [0.18, s], [L - 0.18, -s], [L - 0.18, s]]) P.circle(fx, fy, 0.06); P.fill(PAL.ink);
    // swing travel (dashed)
    const n = seats.length, pitch = L / (n + 0.0001);
    P.begin(); for (let i = 0; i < n; i++) { const cx = pitch * (i + 0.5); P.line(cx, -s * 0.85, cx, s * 0.85); } P.stroke(PAL.pebble, LW.fine, { dash: [0.1, 0.08] });
    // beam
    P.begin().line(0, 0, L, 0).stroke(PAL.ink, 0.11, { cap: "round" });
    for (let i = 0; i < n; i++) {
      const cx = pitch * (i + 0.5), k = seats[i];
      P.begin();
      if (k === "basket" || k === "tire") { P.circle(cx, 0, k === "basket" ? 0.48 : 0.36).paint({ fill: k === "basket" ? PAL.lime : PAL.mat, stroke: PAL.ink, width: LW.out }); if (k === "basket") { P.begin().circle(cx, 0, 0.3).stroke(PAL.limeInk, LW.det); } }
      else if (k === "toddler") { P.roundRect(cx - 0.22, -0.16, 0.44, 0.32, 0.08).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out }); }
      else if (k === "surf") { P.roundRect(cx - 0.7, -0.18, 1.4, 0.36, 0.18).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out }); }
      else { P.roundRect(cx - 0.24, -0.11, 0.48, 0.22, 0.05).paint({ fill: PAL.seat, stroke: PAL.ink, width: LW.det }); }
    }
    P.restore();
  };
  /** Monkey bars: two rails with rungs. */
  C.bars = (P, x1, y1, x2, y2, w = 0.6) => {
    const L = Math.hypot(x2 - x1, y2 - y1); const a = Math.atan2(y2 - y1, x2 - x1);
    P.save().translate(x1, y1).rotate(a);
    P.begin(); for (let t = 0.15; t < L - 0.05; t += 0.3) P.line(t, -w / 2, t, w / 2); P.stroke(PAL.graphite, 0.04, { cap: "round" });
    P.begin().line(0, -w / 2, L, -w / 2).line(0, w / 2, L, w / 2).stroke(PAL.ink, 0.07, { cap: "round" });
    P.restore();
  };
  /** Climbing / cargo net panel. */
  C.net = (P, x, y, w, h) => {
    P.save(); P.begin().rect(x, y, w, h).clip();
    P.begin().rect(x, y, w, h).fill(PAL.stone, 0.6);
    P.begin(); const st = 0.22; for (let t = -h; t < w + h; t += st) { P.line(x + t, y, x + t + h, y + h); P.line(x + t + h, y, x + t, y + h); } P.stroke(PAL.rope, LW.det);
    P.restore(); P.begin().rect(x, y, w, h).stroke(PAL.ink, LW.out);
  };
  /** A-frame climbing wall: ridge along the long axis, two inclined faces with holds. */
  C.climb = (P, x, y, w, h, holds = true) => {
    P.begin().rect(x, y, w, h).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out });
    P.begin(); if (w >= h) P.line(x, y + h / 2, x + w, y + h / 2); else P.line(x + w / 2, y, x + w / 2, y + h); P.stroke(PAL.ink, LW.out);
    P.begin(); const n = Math.floor((w >= h ? w : h) / 0.18); for (let i = 1; i < n; i++) { const t = i * 0.18; if (w >= h) P.line(x + t, y, x + t, y + h); else P.line(x, y + t, x + w, y + t); } P.stroke(PAL.plank, LW.fine);
    if (holds) { P.begin(); const rnd = mulberry(Math.round((x + y * 7 + w * 13) * 100)); const cnt = Math.min(60, Math.round(w * h * 6));
      for (let i = 0; i < cnt; i++) P.circle(x + 0.1 + rnd() * (w - 0.2), y + 0.1 + rnd() * (h - 0.2), 0.045); P.fill(PAL.limeDark); }
  };
  /** Trampoline: frame, pad ring, mat. */
  C.tramp = (P, x, y, w, h) => {
    P.begin().roundRect(x, y, w, h, Math.min(w, h) * 0.12).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out });
    const i = Math.min(w, h) * 0.13; P.begin().roundRect(x + i, y + i, w - 2 * i, h - 2 * i, Math.min(w, h) * 0.08).paint({ fill: PAL.mat, stroke: PAL.ink, width: LW.det });
    P.save(); P.begin().roundRect(x + i, y + i, w - 2 * i, h - 2 * i, Math.min(w, h) * 0.08).clip();
    P.begin(); for (let t = 0.2; t < w; t += 0.2) P.line(x + t, y, x + t, y + h); for (let t = 0.2; t < h; t += 0.2) P.line(x, y + t, x + w, y + t); P.stroke("#55554E", LW.fine); P.restore();
  };
  /** Sand pit with timber edge. */
  C.sand = (P, x, y, w, h) => {
    P.begin().rect(x, y, w, h).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out });
    const b = Math.min(0.14, w * 0.1, h * 0.1); P.begin().rect(x + b, y + b, w - 2 * b, h - 2 * b).fill(PAL.sand);
    P.begin(); const rnd = mulberry(Math.round((x * 31 + y * 17) * 100)); const n = Math.min(160, Math.round(w * h * 40)); for (let i = 0; i < n; i++) P.circle(x + b + rnd() * (w - 2 * b), y + b + rnd() * (h - 2 * b), 0.018); P.fill(PAL.sandDot);
  };
  /** Tunnel / crawl tube. */
  C.tube = (P, x1, y1, x2, y2, d = 0.7) => {
    const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
    P.save().translate(x1, y1).rotate(a);
    P.begin().rect(0, -d / 2, L, d).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out });
    P.begin(); for (let t = 0.2; t < L; t += 0.25) P.line(t, -d / 2, t, d / 2); P.stroke(PAL.limeInk, LW.det);
    P.restore();
  };
  /** Play panel / wall segment. */
  C.panel = (P, x, y, w, h) => { P.begin().rect(x, y, w, h).paint({ fill: PAL.graphite, stroke: PAL.ink, width: LW.det }); };
  /** Bench: slats along the length, end frames, optional backrest. */
  C.bench = (P, x, y, w, h, o = {}) => {
    const back = o.back, frame = o.frame || PAL.graphite, slat = o.slat || PAL.deck;
    const seatH = back ? h * 0.72 : h, sy = back ? y + h - seatH : y;
    const ins = Math.min(0.06, w * 0.04);
    P.begin().rect(x + ins, sy, w - 2 * ins, seatH).paint({ fill: slat, stroke: PAL.ink, width: LW.det });
    P.begin(); const n = Math.max(3, Math.round(seatH / 0.1)); for (let i = 1; i < n; i++) P.line(x + ins, sy + seatH * i / n, x + w - ins, sy + seatH * i / n); P.stroke(PAL.plank, LW.fine);
    if (back) P.begin().rect(x + ins, y, w - 2 * ins, h * 0.16).paint({ fill: slat, stroke: PAL.ink, width: LW.det });
    const fw = o.hoop ? 0.05 : 0.06;
    P.begin();
    for (const fx of [x + Math.min(0.2, w * 0.12), x + w - Math.min(0.2, w * 0.12) - fw]) P.rect(fx, y, fw, h);
    P.fill(frame);
  };
  /** Picnic table: table top flanked by two benches (or round). */
  C.table = (P, x, y, w, h, o = {}) => {
    if (o.round) {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      P.begin().circle(cx, cy, r * 0.55).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out });
      for (let i = 0; i < 4; i++) { const a0 = i * Math.PI / 2 + 0.25, a1 = a0 + Math.PI / 2 - 0.5;
        P.begin().arc(cx, cy, r, a0, a1, false, r, false).arc(cx, cy, r * 0.75, a1, a0, true, r * 0.75, true).close().paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.det }); }
      return;
    }
    const along = w >= h, bw = (along ? h : w) * 0.22;
    if (along) { C.bench(P, x, y, w, bw, {}); C.bench(P, x, y + h - bw, w, bw, {}); P.begin().rect(x + w * 0.04, y + bw * 1.35, w * 0.92, h - bw * 2.7).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out }); }
    else { P.save().translate(x + w, y).rotate(Math.PI / 2); C.table(P, 0, 0, h, w, o); P.restore(); }
    if (o.sandbox) { const tx = x + w * 0.3, ty = y + bw * 1.35 + 0.05; C.sand(P, tx, ty, w * 0.4, Math.max(0.1, h - bw * 2.7 - 0.1)); }
  };
  C.seesaw = (P, x, y, w, h) => {
    const cy = y + h / 2, bh = Math.min(h * 0.45, 0.28);
    P.begin().rect(x, cy - bh / 2, w, bh).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out });
    P.begin().rect(x + w / 2 - 0.12, y, 0.24, h).paint({ fill: PAL.graphite, stroke: PAL.ink, width: LW.det });
    P.begin(); for (const hx of [x + w * 0.16, x + w * 0.84]) P.line(hx, cy - h * 0.42, hx, cy + h * 0.42); P.stroke(PAL.lime, 0.05, { cap: "round" });
  };
  C.zip = (P, L, W) => {
    const cy = W / 2;
    C.deck(P, 0.1, cy - 0.6, 1.2, 1.2, { lod: 20 });
    P.begin().line(0.1, cy - 0.85, 0.6, cy).line(0.1, cy + 0.85, 0.6, cy).stroke(PAL.ink, 0.07, { cap: "round" });
    P.begin().line(L - 0.15, cy - 0.9, L - 0.6, cy).line(L - 0.15, cy + 0.9, L - 0.6, cy).stroke(PAL.ink, 0.08, { cap: "round" });
    P.begin().line(0.7, cy, L - 0.6, cy).stroke(PAL.ink, 0.03, { dash: [0.25, 0.12] });
    P.begin().circle(L * 0.45, cy, 0.18).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.det });
    P.begin().line(L * 0.3, cy - 0.5, L * 0.85, cy - 0.5).line(L * 0.3, cy + 0.5, L * 0.85, cy + 0.5).stroke(PAL.pebble, LW.fine, { dash: [0.1, 0.1] });
  };
  /** Ship hull (pirate fort). */
  C.hull = (P, x, y, w, h) => {
    P.begin().moveTo(x, y + h * 0.15).lineTo(x + w * 0.68, y).quadTo(x + w, y + h * 0.1, x + w, y + h / 2).quadTo(x + w, y + h * 0.9, x + w * 0.68, y + h).lineTo(x, y + h * 0.85).close()
      .paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.out });
    P.begin(); for (let t = 0.18; t < h; t += 0.18) P.line(x + 0.05, y + t, x + w * 0.85, y + t); P.save(); P.begin().moveTo(x, y + h * 0.15).lineTo(x + w * 0.68, y).quadTo(x + w, y + h * 0.1, x + w, y + h / 2).quadTo(x + w, y + h * 0.9, x + w * 0.68, y + h).lineTo(x, y + h * 0.85).close().clip();
    P.begin(); for (let t = 0.18; t < h; t += 0.18) P.line(x, y + t, x + w, y + t); P.stroke(PAL.plank, LW.fine); P.restore();
  };
  C.post = (P, x, y, s = 0.12) => P.begin().rect(x - s / 2, y - s / 2, s, s).fill(PAL.ink);
  C.palmPost = (P, x, y, r = 0.55) => { // decorative palm canopy on a post (Palm Grove set)
    P.begin(); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; P.moveTo(x, y).quadTo(x + Math.cos(a + 0.3) * r * 0.7, y + Math.sin(a + 0.3) * r * 0.7, x + Math.cos(a) * r, y + Math.sin(a) * r).quadTo(x + Math.cos(a - 0.3) * r * 0.5, y + Math.sin(a - 0.3) * r * 0.5, x, y); }
    P.paint({ fill: PAL.canopy, stroke: PAL.limeInk, width: LW.fine }); C.post(P, x, y, 0.1);
  };
  C.tictac = (P, x, y, w, h) => { P.begin().rect(x, y, w, h).paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.det }); P.begin(); for (let i = 1; i < 3; i++) P.circle(x + w * i / 3, y + h / 2, Math.min(h * 0.35, 0.05)); P.fill(PAL.limeInk); };

  /* deterministic random for repeatable textures */
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------------- product compositions (box coords; f = fractions helper) ---------------- */
  /* Each returns nothing and draws into P. L, W = published length/width. Helpers: X(f) = f·L, Y(f) = f·W. */
  const S = {};
  const h = (fn) => fn; // marker
  // Estate
  S["SW-E101"] = h((P, L, W, o) => { // four towers, bridges, seven slides, swing bay
    const t = 1.7;
    C.bridge(P, 0.3 + t, 1.15, 4.3, 1.15); C.bridge(P, 4.3 + t, 1.15, 8.7, 1.15); C.bridge(P, 5.15, 0.3 + t, 5.15, 3.7, 0.7, true);
    C.slide(P, 0.75, 0.3 + t, 0.75, 4.6, 0.55, "wave"); C.slide(P, 1.6, 0.3 + t, 1.6, 4.2, 0.55); C.slide(P, 9.2, 0.3 + t, 9.2, 4.6, 0.55, "wave"); C.slide(P, 10.1, 0.3 + t, 10.1, 4.0, 0.5);
    C.slide(P, 4.3, 4.55, 1.6, 5.6, 0.55); C.slide(P, 6.0, 4.55, 8.6, 5.5, 0.55, "wave"); C.slide(P, 5.1, 3.7 + t, 5.1, 6.85, 0.5);
    C.deck(P, 0.3, 0.3, t, t, Object.assign({ roof: "hip" }, o)); C.deck(P, 4.3, 0.3, t, t, Object.assign({ roof: "hip" }, o)); C.deck(P, 8.7, 0.3, t, t, Object.assign({ roof: "hip" }, o)); C.deck(P, 4.3, 3.7, t, t, Object.assign({ roof: "gable" }, o));
    C.ladder(P, 2.3, 2.6, 3.9, 2.6, 0.55); C.net(P, 6.4, 2.3, 1.8, 0.9);
    C.swing(P, 6.6, 6.35, 10.6, 6.35, 1.1, ["flat", "basket", "flat"]);
  });
  S["SW-E102"] = h((P, L, W, o) => { // three roofed cabins, swing & agility programme
    C.bridge(P, 1.6, 0.85, 2.5, 0.85, 0.6); C.bridge(P, 3.9, 0.85, 4.2, 0.85, 0.6);
    C.slide(P, 0.9, 1.5, 0.9, 3.15, 0.5, "wave"); C.ladder(P, 3.2, 1.5, 3.2, 2.5, 0.5);
    C.deck(P, 0.2, 0.15, 1.4, 1.4, Object.assign({ roof: "hip" }, o)); C.deck(P, 2.5, 0.15, 1.4, 1.4, Object.assign({ roof: "hip" }, o));
    C.bars(P, 1.6, 2.5, 4.1, 2.5, 0.55);
    C.swing(P, 4.4, 1.62, 8.6, 1.62, 3.0, ["flat", "tire", "flat"]);
  });
  S["SW-E103"] = h((P, L, W, o) => { // three roofed towers linked by tunnels, four slides, swing bay
    const t = 1.45, y0 = 0.25;
    C.tube(P, 0.2 + t, y0 + t / 2, 3.0, y0 + t / 2, 0.7); C.tube(P, 3.0 + t, y0 + t / 2, 5.8, y0 + t / 2, 0.7);
    C.slide(P, 0.9, y0 + t, 0.9, 3.85, 0.5, "wave"); C.slide(P, 3.7, y0 + t, 3.2, 3.85, 0.5); C.slide(P, 6.2, y0 + t, 6.2, 3.85, 0.5, "wave"); C.slide(P, 3.0, y0 + t / 2 + 0.3, 2.0, 3.6, 0.45);
    for (const x of [0.2, 3.0, 5.8]) C.deck(P, x, y0, t, t, Object.assign({ roof: "hip" }, o));
    C.swing(P, 7.4, 2.0, 9.4, 2.0, 3.2, ["flat", "toddler"]);
  });
  S["SW-E104"] = h((P, L, W, o) => { // twin peaked towers + bridge, sweeping slide, triple swing beam
    const t = 1.5;
    C.bridge(P, 0.2 + t, 1.0, 3.6, 1.0, 0.7, true);
    C.slide(P, 0.9, 0.25 + t, 0.9, 3.8, 0.55, "wave"); C.slide(P, 4.3, 0.25 + t, 4.0, 3.8, 0.55); C.ladder(P, 2.3, 2.2, 3.3, 3.4, 0.5);
    C.deck(P, 0.2, 0.25, t, t, Object.assign({ roof: "gable" }, o)); C.deck(P, 3.6, 0.25, t, t, Object.assign({ roof: "gable" }, o));
    C.swing(P, 5.6, 1.95, 9.25, 1.95, 3.2, ["flat", "flat", "toddler"]);
  });
  S["SW-E105"] = h((P, L, W, o) => { // central roofed tower flanked by swing beams, climbing wall, slide
    const t = 1.5, x = (L - t) / 2, y = (W - t) / 2;
    C.swing(P, 0.15, W / 2, x, W / 2, 2.6, ["flat", "flat"]); C.swing(P, x + t, W / 2, L - 0.15, W / 2, 2.6, ["toddler", "flat"]);
    C.climb(P, x + 0.15, y + t, t - 0.3, W - y - t - 0.02, true); C.ladder(P, x + 0.3, y, x + 0.3, 0.05, 0.4);
    C.deck(P, x, y, t, t, Object.assign({ roof: "hip", flag: true }, o));
  });
  S["SW-E106"] = h((P, L, W, o) => { // roofed tower, swing beam, climbing wall, slide
    const t = 1.5, x = 2.6, y = 0.3;
    C.swing(P, 0.15, 1.2, x, 1.2, 2.2, ["flat", "flat"]);
    C.slide(P, x + t, y + t / 2, L - 0.1, 2.6, 0.55, "wave"); C.climb(P, x + 0.1, y + t, 1.3, W - y - t - 0.05);
    C.deck(P, x, y, t, t, Object.assign({ roof: "hip", flag: true }, o)); C.deck(P, x + t, y + 0.2, 1.0, 1.1, Object.assign({}, o));
  });
  S["SW-E107"] = h((P, L, W, o) => { // pirate ship fort: hull deck, mast, slide, climbing wall, swings
    C.hull(P, 0.1, 0.4, 4.6, 4.0);
    P.begin().circle(2.3, 2.4, 0.12).fill(PAL.ink); P.begin().rect(1.4, 2.32, 1.8, 0.16).fill(PAL.white); P.begin().rect(1.4, 2.32, 1.8, 0.16).stroke(PAL.ink, LW.fine);
    C.deck(P, 4.4, 0.6, 1.6, 1.6, Object.assign({ roof: "flat" }, o)); C.slide(P, 5.2, 2.2, 5.6, 4.7, 0.55, "wave"); C.climb(P, 0.25, 0.7, 1.2, 1.0);
    C.swing(P, 6.3, 1.4, 8.4, 1.4, 2.0, ["flat", "flat"]); C.bridge(P, 4.0, 1.4, 4.4, 1.4, 0.6);
  });
  S["SW-E108"] = h((P, L, W, o) => { // play tower + trampolines in timber frame
    C.tramp(P, 0.15, 0.25, 2.4, 2.7); C.tramp(P, 2.75, 0.25, 2.4, 2.7);
    P.begin().rect(0.1, 0.1, 5.15, W - 0.2).stroke(PAL.ink, LW.det, { dash: [0.15, 0.08] });
    C.deck(P, 5.6, 0.4, 1.4, 1.4, Object.assign({ roof: "hip" }, o)); C.slide(P, 6.3, 1.8, 6.5, 3.15, 0.5, "wave"); C.ladder(P, 7.0, 1.1, 7.7, 1.1, 0.5, true);
  });
  S["SW-E109"] = h((P, L, W, o) => { // two forts and a bridge, slides
    C.deck(P, 0.1, 0.3, 1.4, 1.4, Object.assign({ roof: "hip" }, o)); C.deck(P, 3.5, 0.3, 1.4, 1.4, Object.assign({ roof: "gable" }, o));
    C.bridge(P, 1.5, 1.0, 3.5, 1.0, 0.6); C.slide(P, 0.8, 1.7, 0.8, 2.35, 0.45); C.slide(P, 4.2, 1.7, 4.4, 2.35, 0.45); C.ladder(P, 2.5, 1.35, 2.5, 2.3, 0.45, true);
  });
  S["SW-E111"] = h((P, L, W, o) => { // multi-block pavilion, slides each side
    C.deck(P, 2.3, 0.6, 1.15, 1.15, Object.assign({ roof: "hip" }, o)); C.deck(P, 3.45, 0.6, 1.15, 1.15, Object.assign({}, o)); C.tube(P, 4.6, 1.15, 5.4, 1.15, 0.6);
    C.slide(P, 2.3, 1.2, 0.1, 2.0, 0.5, "wave"); C.slide(P, 5.4, 1.15, 6.9, 2.3, 0.5); C.ladder(P, 3.0, 1.75, 3.0, 2.9, 0.5, true);
    P.begin().circle(5.6, 0.45, 0.35).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.det });
  });
  S["SW-E112"] = h((P, L, W, o) => { // double trampoline & swing combo
    C.tramp(P, 0.1, 0.15, 2.0, 2.1); C.tramp(P, 2.3, 0.15, 2.0, 2.1);
    P.begin().rect(0.05, 0.08, 4.3, W - 0.16).stroke(PAL.ink, LW.det, { dash: [0.15, 0.08] });
    C.swing(P, 4.6, W / 2, 8.7, W / 2, 2.2, ["flat", "flat", "basket"]);
  });
  // Tower
  S["SW-T201"] = h((P, L, W, o) => { C.deck(P, 0.15, 0.4, 1.4, 1.4, Object.assign({ roof: "flat" }, o)); C.slide(P, 0.85, 1.8, 0.85, 2.45, 0.5); C.slide(P, 0.15, 1.1, 0.02, 1.1, 0.5); C.swing(P, 1.55, 1.1, 4.4, 1.1, 1.9, ["flat", "flat"]); });
  S["SW-T202"] = h((P, L, W, o) => { C.deck(P, 1.4, 1.3, 1.5, 1.5, Object.assign({ roof: "hip", flag: true }, o)); C.slide(P, 1.4, 2.4, 0.1, 4.1, 0.5, "wave"); C.ladder(P, 2.9, 1.8, 4.6, 0.6, 0.5); C.climb(P, 1.6, 0.1, 1.1, 1.2); C.deck(P, 2.9, 2.2, 1.0, 0.9, Object.assign({}, o)); });
  S["SW-T203"] = h((P, L, W, o) => { C.deck(P, 0.1, 0.05, 1.15, 1.14, Object.assign({ roof: "hip" }, o)); C.slide(P, 1.25, 0.62, 3.85, 0.62, 0.5, "wave"); });
  S["SW-T204"] = h((P, L, W, o) => { C.deck(P, 1.6, 0.6, 1.6, 1.6, Object.assign({ roof: "gable" }, o)); C.slide(P, 3.2, 1.4, 4.85, 3.4, 0.55, "wave"); C.hull(P, 0.05, 2.6, 1.9, 2.2); C.ladder(P, 2.4, 2.2, 2.4, 3.6, 0.55, true); C.climb(P, 0.05, 0.4, 1.4, 1.2); C.bridge(P, 1.6, 1.8, 1.2, 2.7, 0.55); });
  S["SW-T205"] = h((P, L, W, o) => { C.deck(P, 0.1, 0.1, 1.4, 1.4, Object.assign({ roof: "gable" }, o)); C.climb(P, 1.6, 0.05, 2.3, 0.8); C.slide(P, 0.2, 1.3, 0.05, 1.6, 0.4); C.net(P, 1.6, 0.9, 2.3, 0.65); C.slide(P, 1.5, 0.8, 0.6, 1.6, 0.4); });
  S["SW-T206"] = h((P, L, W, o) => { C.deck(P, 0.15, 0.3, 1.35, 1.35, Object.assign({ roof: "gable" }, o)); C.slide(P, 1.5, 1.0, 3.85, 1.0, 0.5, "wave"); C.ladder(P, 0.8, 1.65, 0.8, 1.95, 0.5); C.climb(P, 0.05, 0.02, 1.5, 0.28, false); });
  S["SW-T207"] = h((P, L, W, o) => { C.deck(P, 0.1, 0.1, 1.2, 1.2, Object.assign({ roof: "hip" }, o)); C.deck(P, 1.3, 0.3, 1.0, 1.0, Object.assign({}, o)); C.slide(P, 2.3, 0.8, 3.2, 2.45, 0.45, "wave"); C.ladder(P, 0.6, 1.3, 0.6, 2.5, 0.5, true); C.climb(P, 1.4, 1.4, 0.8, 1.1); });
  S["SW-T208"] = h((P, L, W, o) => { C.deck(P, 1.0, 0.2, 1.5, 1.5, Object.assign({ roof: "gable" }, o)); C.deck(P, 2.5, 0.4, 1.0, 1.1, Object.assign({}, o)); C.slide(P, 3.5, 0.95, 4.55, 2.9, 0.5); C.climb(P, 0.05, 0.5, 0.95, 0.9); C.ladder(P, 2.0, 1.7, 2.0, 3.0, 0.5, true); });
  S["SW-T209"] = h((P, L, W, o) => { C.deck(P, 3.8, 0.5, 1.5, 1.5, Object.assign({ roof: "hip", flag: true }, o)); C.slide(P, 4.55, 2.0, 4.1, 3.75, 0.5, "wave"); C.ladder(P, 5.3, 1.2, 5.65, 2.8, 0.45); C.swing(P, 0.15, 1.25, 3.8, 1.25, 2.3, ["flat", "flat"]); });
  S["SW-T210"] = h((P, L, W, o) => { C.deck(P, 2.0, 0.4, 1.4, 1.4, Object.assign({ roof: "hip", flag: true }, o)); C.slide(P, 2.7, 1.8, 3.4, 3.2, 0.5, "wave"); C.ladder(P, 2.2, 1.8, 2.2, 3.0, 0.45); C.swing(P, 0.1, 1.1, 2.0, 1.1, 2.0, ["flat", "flat"]); });
  S["SW-T211"] = h((P, L, W, o) => { C.deck(P, 0.05, 0.05, 0.95, 0.95, Object.assign({ roof: "hip" }, o)); C.slide(P, 1.0, 0.5, 1.88, 0.5, 0.45); C.climb(P, 0.05, 1.0, 0.95, 0.38); });
  S["SW-T212"] = h((P, L, W, o) => { C.swing(P, 0.08, 0.9, 1.8, 0.9, 1.6, ["flat", "flat"]); C.deck(P, 1.85, 0.6, 0.6, 0.6, Object.assign({ roof: "flat", roofColor: PAL.lime }, o)); C.slide(P, 2.15, 1.2, 2.6, 1.78, 0.35); });
  // Early years
  S["SW-Y301"] = h((P, L, W, o) => { C.deck(P, 1.2, 0.1, 1.15, 1.15, Object.assign({ roof: "gable", roofColor: "#8A3B2E" }, o)); C.slide(P, 1.2, 0.7, 0.05, 1.25, 0.45); C.ladder(P, 2.35, 0.7, 3.2, 0.7, 0.45, true); C.table(P, 3.2, 0.2, 0.8, 1.1, {}); });
  S["SW-Y302"] = h((P, L, W, o) => { C.deck(P, 2.2, 0.4, 1.6, 1.6, Object.assign({ roof: "hip", flag: true }, o)); C.deck(P, 0.6, 0.7, 1.6, 1.2, Object.assign({ roof: "flat" }, o)); C.slide(P, 3.8, 1.2, 6.05, 2.5, 0.5, "wave"); C.ladder(P, 1.0, 1.9, 1.0, 3.4, 0.5, true); C.climb(P, 2.4, 2.0, 1.2, 1.4); });
  S["SW-Y303"] = h((P, L, W, o) => { C.climb(P, 0.05, 0.05, 1.3, 1.1); C.slide(P, 0.7, 1.15, 0.7, 2.35, 0.5, "wave"); });
  S["SW-Y304"] = h((P, L, W, o) => { C.climb(P, 0.02, 0.02, L - 0.04, W - 0.04); });
  S["SW-Y305"] = h((P, L, W, o) => { C.deck(P, 0.05, 0.05, 1.9, 1.3, Object.assign({ roof: "gable" }, o)); C.deck(P, 0.3, 1.35, 1.4, 0.4, Object.assign({}, o)); });
  S["SW-Y306"] = h((P, L, W, o) => { C.deck(P, 0.1, 0.6, 1.6, 1.4, Object.assign({ roof: "gable" }, o)); C.deck(P, 1.7, 0.1, 0.8, 0.8, Object.assign({ roof: "hip" }, o)); C.slide(P, 2.1, 0.9, 2.7, 2.6, 0.4); });
  S["SW-Y307"] = h((P, L, W, o) => { C.deck(P, 0.6, 0.3, 1.7, 1.7, Object.assign({ roof: "gable" }, o)); C.slide(P, 2.3, 1.15, 3.85, 2.2, 0.5); C.ladder(P, 0.6, 1.5, 0.05, 2.3, 0.45); });
  S["SW-Y308"] = h((P, L, W, o) => { C.deck(P, 0.05, 0.05, L - 0.1, W - 0.1, Object.assign({ roof: "gable" }, o)); });
  S["SW-Y309"] = h((P, L, W, o) => { C.deck(P, 0.05, 0.1, 1.15, 1.0, Object.assign({ roof: "gable" }, o)); C.deck(P, 1.2, 0.2, 1.2, 0.8, Object.assign({}, o)); C.deck(P, 2.4, 0.1, 1.15, 1.0, Object.assign({ roof: "gable" }, o)); P.begin(); for (const cx of [0.62, 1.8, 2.97]) P.circle(cx, 0.6, 0.18); P.stroke(PAL.ink, LW.det); });
  S["SW-Y310"] = h((P, L, W, o) => { C.deck(P, 0.05, 0.05, 1.6, 1.1, Object.assign({ roof: "gable" }, o)); C.sand(P, 1.75, 0.15, 1.3, 0.95); P.begin().rect(1.75, 0.05, 1.3, 0.3).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.det, fillAlpha: 0.9 }); });
  S["SW-Y311"] = h((P, L, W, o) => { C.sand(P, 0.05, 0.05, L - 0.1, W - 0.1); C.roof(P, 0.2, 0.2, L - 0.4, W - 0.4, "hip", { L, W }); });
  S["SW-Y312"] = h((P, L, W, o) => { C.table(P, 0.02, 0.02, L - 0.04, W - 0.04, { sandbox: true }); });
  S["SW-Y313"] = h((P, L, W, o) => { C.table(P, 0.02, 0.02, L - 0.04, W - 0.04, { round: true }); });
  S["SW-Y314"] = h((P, L, W, o) => { C.table(P, 0.02, 0.02, L - 0.04, W - 0.04, {}); });
  // Adventure
  S["SW-A401"] = h((P, L, W, o) => C.zip(P, L, W));
  S["SW-A402"] = h((P, L, W, o) => { C.climb(P, 0.02, 0.02, L - 0.04, W - 0.04); });
  S["SW-A403"] = h((P, L, W, o) => { // hexa climb: frame with walls, net and bars
    P.begin().rect(0.05, 0.05, L - 0.1, W - 0.1).stroke(PAL.ink, LW.out); C.climb(P, 0.05, 0.05, L - 0.1, 0.45); C.net(P, 0.05, W - 0.5, L - 0.1, 0.45); C.bars(P, 0.3, W / 2, L - 0.3, W / 2, 0.5);
    for (const [x, y] of [[0.05, 0.05], [L - 0.05, 0.05], [0.05, W - 0.05], [L - 0.05, W - 0.05]]) C.post(P, x, y, 0.14);
  });
  S["SW-A404"] = h((P, L, W, o) => { C.climb(P, 0.05, 0.1, 1.6, 0.9); C.climb(P, 2.2, 0.1, 1.2, 0.9); C.net(P, 1.65, 0.15, 0.55, 0.8); C.slide(P, 3.4, 0.55, 4.45, 0.55, 0.45); });
  S["SW-A405"] = h((P, L, W, o) => { // palm grove agility set
    C.deck(P, 0.4, 0.6, 1.2, 1.2, Object.assign({}, o)); C.deck(P, 3.2, 2.2, 1.2, 1.2, Object.assign({}, o)); C.deck(P, 5.6, 3.5, 1.2, 1.2, Object.assign({}, o));
    C.bars(P, 1.6, 1.2, 3.2, 2.6, 0.55); C.climb(P, 4.4, 2.5, 1.2, 0.9); C.bridge(P, 1.0, 1.8, 1.6, 4.6, 0.5, true);
    C.palmPost(P, 0.4, 0.6); C.palmPost(P, 4.4, 2.2); C.palmPost(P, 6.8, 4.7); C.palmPost(P, 3.2, 3.4);
  });
  S["SW-A406"] = h((P, L, W, o) => { C.deck(P, 0.05, 0.25, 1.1, 0.8, Object.assign({}, o)); C.bridge(P, 1.15, 0.65, 2.9, 0.65, 0.5, true); C.tube(P, 3.0, 0.65, 4.7, 0.65, 0.8); C.deck(P, 4.8, 0.25, 0.9, 0.8, Object.assign({}, o)); C.bars(P, 5.7, 0.65, 7.4, 0.65, 0.5); C.bridge(P, 7.5, 0.65, 9.45, 0.65, 0.4); });
  S["SW-A407"] = h((P, L, W, o) => { C.bridge(P, 0.25, W / 2, L - 0.25, W / 2, W - 0.14, true); for (const x of [0.12, L - 0.12]) { P.begin().rect(x - 0.08, 0.02, 0.16, W - 0.04).fill(PAL.deck); P.begin().rect(x - 0.08, 0.02, 0.16, W - 0.04).stroke(PAL.ink, LW.det); } });
  S["SW-A408"] = h((P, L, W, o) => C.seesaw(P, 0.02, 0.02, L - 0.04, W - 0.04));
  S["SW-A409"] = h((P, L, W, o) => C.swing(P, 0.08, W / 2, L - 0.08, W / 2, W - 0.1, ["flat", "flat"]));
  S["SW-A410"] = h((P, L, W, o) => C.tictac(P, 0, 0, L, W));
  S["SW-A411"] = h((P, L, W, o) => { C.deck(P, 1.0, 1.0, 2.0, 2.0, Object.assign({ roof: "hip", roofColor: "#C9A227" }, o)); C.climb(P, 0.05, 1.2, 0.95, 1.6); C.net(P, 3.0, 1.2, 0.95, 1.6); C.ladder(P, 2.0, 3.0, 2.0, 3.95, 0.5, true); C.slide(P, 2.0, 1.0, 2.0, 0.05, 0.5); });
  S["SW-A412"] = h((P, L, W, o) => { C.bridge(P, 0.2, W / 2, L - 0.2, W / 2, W * 0.6, true); for (const x of [0.1, L - 0.1]) { P.begin().rect(x - 0.08, 0.02, 0.16, W - 0.04).fill(PAL.deck); P.begin().rect(x - 0.08, 0.02, 0.16, W - 0.04).stroke(PAL.ink, LW.det); } });
  // Landscape
  S["SW-L501"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { back: true, frame: "#8C8C86" }));
  S["SW-L502"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { back: true, slat: "#B88C6A", frame: PAL.graphite }));
  S["SW-L503"] = h((P, L, W) => { // curved bench: one arc segment spanning L with rise W
    const R = (L * L / 4 + W * W) / (2 * W), cx = L / 2, cy = R, d = Math.min(0.6, W * 0.4), r0 = R - d;
    const a0 = Math.atan2(W - cy, 0 - cx), a1 = Math.atan2(W - cy, L - cx);
    P.save(); P.begin().rect(0, 0, L, W).clip();
    P.begin().arc(cx, cy, R, a0, a1, false, R, false).arc(cx, cy, r0, a1, a0, true, r0, true).close().paint({ fill: PAL.deck, stroke: PAL.ink, width: LW.det });
    P.begin(); for (let i = 1; i < 5; i++) { const r = r0 + d * i / 5; P.arc(cx, cy, r, a0, a1, false, r, false); } P.stroke(PAL.plank, LW.fine);
    P.begin(); for (let i = 0; i <= 4; i++) { const t = a0 + (a1 - a0) * (0.1 + 0.8 * i / 4); P.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0).lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); } P.stroke(PAL.graphite, 0.06);
    P.restore();
  });
  S["SW-L504"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { frame: "#9A9A94" }));
  S["SW-L505"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { back: true, frame: "#9A9A94" }));
  S["SW-L506"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { frame: PAL.ink }));
  S["SW-L507"] = h((P, L, W) => { C.bench(P, 0, 0, L, W, { back: true, frame: "#9A9A94" }); });
  S["SW-L508"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { frame: PAL.ink, hoop: true }));
  S["SW-L509"] = h((P, L, W) => C.bench(P, 0, 0, L, W, { frame: "#E3B505", hoop: true }));

  /** Generic fallback symbol for products without a composition (admin custom products): uses the chosen generic type. */
  function genericProduct(P, L, W, sym, o) {
    if (sym && ELEMENT_SYM[sym]) return ELEMENT_SYM[sym](P, L, W, o);
    P.begin().rect(0, 0, L, W).paint({ fill: PAL.limeTint, stroke: PAL.ink, width: LW.out });
    P.begin().line(0, 0, L, W).line(L, 0, 0, W).stroke(PAL.pebble, LW.fine);
  }

  /* ---------------- element symbols (point elements; box coords 0..L, 0..W) ---------------- */
  function canopy(P, cx, cy, r, fill, edge, lobes = 9, seed = 1) {
    const rnd = mulberry(seed); P.begin();
    for (let i = 0; i <= lobes; i++) { const a = i / lobes * Math.PI * 2, rr = r * (0.9 + 0.1 * rnd()), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (!i) P.moveTo(x, y); else { const am = (i - 0.5) / lobes * Math.PI * 2; P.quadTo(cx + Math.cos(am) * r * 1.12, cy + Math.sin(am) * r * 1.12, x, y); } }
    P.close().paint({ fill, stroke: edge, width: LW.det });
  }
  const ELEMENT_SYM = {
    tree: (P, L, W, o) => { const r = Math.min(L, W) / 2; canopy(P, L / 2, W / 2, r * 0.92, PAL.canopy, PAL.canopyDark, 11, 7); canopy(P, L / 2 - r * 0.15, W / 2 - r * 0.15, r * 0.55, PAL.canopyLight, PAL.canopy, 7, 3); P.begin().circle(L / 2, W / 2, Math.max(0.08, r * 0.07)).fill(PAL.trunk); },
    palm: (P, L, W) => { const r = Math.min(L, W) / 2, cx = L / 2, cy = W / 2; P.begin();
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.2; P.moveTo(cx, cy).quadTo(cx + Math.cos(a + 0.22) * r * 0.75, cy + Math.sin(a + 0.22) * r * 0.75, cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97).quadTo(cx + Math.cos(a - 0.2) * r * 0.55, cy + Math.sin(a - 0.2) * r * 0.55, cx, cy); }
      P.paint({ fill: PAL.canopy, stroke: PAL.canopyDark, width: LW.det }); P.begin().circle(cx, cy, Math.max(0.1, r * 0.1)).fill(PAL.trunk); },
    treeExisting: (P, L, W) => { const r = Math.min(L, W) / 2; P.begin().circle(L / 2, W / 2, r * 0.97).paint({ fill: PAL.stone, fillAlpha: 0.5, stroke: PAL.graphite, width: LW.det, dash: [0.25, 0.15] });
      P.begin().line(L / 2 - r * 0.25, W / 2, L / 2 + r * 0.25, W / 2).line(L / 2, W / 2 - r * 0.25, L / 2, W / 2 + r * 0.25).stroke(PAL.graphite, LW.det); P.begin().circle(L / 2, W / 2, Math.max(0.1, r * 0.08)).fill(PAL.trunk); },
    shrub: (P, L, W) => { const r = Math.min(L, W) / 2; canopy(P, L / 2, W / 2, r * 0.9, PAL.canopyDark, PAL.limeInk, 7, 5); },
    planter: (P, L, W) => { P.begin().rect(0, 0, L, W).paint({ fill: PAL.stone, stroke: PAL.ink, width: LW.out }); const b = Math.min(0.08, L * 0.1, W * 0.1); P.begin().rect(b, b, L - 2 * b, W - 2 * b).fill("#8C7B5B");
      const n = Math.max(1, Math.round(L / 0.45)); for (let i = 0; i < n; i++) canopy(P, (i + 0.5) * L / n, W / 2, Math.min(W / 2 - b, L / n / 2) * 0.85, PAL.canopy, PAL.canopyDark, 6, i + 2); },
    gate: (P, L, W) => { P.begin().rect(0, 0, L, W).paint({ fill: PAL.white, stroke: PAL.ink, width: LW.det }); P.begin().line(0.06, W / 2, L - 0.06, W / 2).stroke(PAL.ink, 0.05);
      P.begin().moveTo(0.06, W / 2).arc(0.06, W / 2, L - 0.12, 0, Math.PI / 2, false, L - 0.12, true).stroke(PAL.pebble, LW.fine, { dash: [0.08, 0.06] }); C.post(P, 0.03, W / 2, 0.1); C.post(P, L - 0.03, W / 2, 0.1); },
    gateDouble: (P, L, W) => { P.begin().line(0.06, W / 2, L - 0.06, W / 2).stroke(PAL.ink, 0.05); const r = L / 2 - 0.08;
      P.begin().moveTo(0.06, W / 2).arc(0.06, W / 2, r, 0, Math.PI / 2, false, r, true).moveTo(L - 0.06, W / 2).arc(L - 0.06, W / 2, r, Math.PI, Math.PI / 2, true, r, true).stroke(PAL.pebble, LW.fine, { dash: [0.08, 0.06] });
      C.post(P, 0.03, W / 2, 0.12); C.post(P, L - 0.03, W / 2, 0.12); },
    opening: (P, L, W) => { C.post(P, 0.04, W / 2, 0.12); C.post(P, L - 0.04, W / 2, 0.12); P.begin().line(0.1, W / 2, L - 0.1, W / 2).stroke(PAL.pebble, LW.det, { dash: [0.1, 0.08] });
      P.begin().moveTo(L / 2 - 0.15, W / 2 - 0.35).lineTo(L / 2, W / 2 - 0.12).lineTo(L / 2 + 0.15, W / 2 - 0.35).stroke(PAL.limeInk, 0.05, { cap: "round", join: "round" }); },
    ramp: (P, L, W) => { P.begin().rect(0, 0, L, W).paint({ fill: PAL.stone, stroke: PAL.ink, width: LW.out }); P.begin(); for (let t = 0.25; t < L; t += 0.25) P.line(t, 0.05, t, W - 0.05); P.stroke(PAL.pebble, LW.fine);
      P.begin().moveTo(L * 0.2, W / 2).lineTo(L * 0.8, W / 2).moveTo(L * 0.68, W / 2 - W * 0.18).lineTo(L * 0.8, W / 2).lineTo(L * 0.68, W / 2 + W * 0.18).stroke(PAL.ink, LW.det * 2, { cap: "round", join: "round" }); },
    benchGeneric: (P, L, W) => C.bench(P, 0, 0, L, W, { back: true }),
    picnicGeneric: (P, L, W) => C.table(P, 0, 0, L, W, {}),
    bin: (P, L, W) => { const r = Math.min(L, W) / 2; P.begin().circle(L / 2, W / 2, r).paint({ fill: PAL.graphite, stroke: PAL.ink, width: LW.det }); P.begin().circle(L / 2, W / 2, r * 0.6).fill(PAL.ink); },
    pergola: (P, L, W) => { P.begin().rect(0, 0, L, W).paint({ fill: PAL.deck, fillAlpha: 0.35, stroke: PAL.ink, width: LW.det, dash: [0.2, 0.1] }); P.begin(); for (let t = 0.3; t < L; t += 0.3) P.line(t, 0, t, W); P.stroke(PAL.plank, LW.det);
      P.begin().line(0, 0.1, L, 0.1).line(0, W - 0.1, L, W - 0.1).stroke(PAL.ink, 0.06); for (const [x, y] of [[0.1, 0.1], [L - 0.1, 0.1], [0.1, W - 0.1], [L - 0.1, W - 0.1]]) C.post(P, x, y, 0.15); },
    shade: (P, L, W) => { P.begin().moveTo(0, 0).quadTo(L / 2, W * 0.12, L, 0).quadTo(L * 0.88, W / 2, L, W).quadTo(L / 2, W * 0.88, 0, W).quadTo(L * 0.12, W / 2, 0, 0).close().paint({ fill: PAL.cream, fillAlpha: 0.7, stroke: PAL.ink, width: LW.det, dash: [0.25, 0.12] });
      P.begin().line(0, 0, L, W).line(L, 0, 0, W).stroke(PAL.pebble, LW.fine); for (const [x, y] of [[0, 0], [L, 0], [0, W], [L, W]]) C.post(P, x, y, 0.16); },
    light: (P, L, W) => { const r = Math.min(L, W) / 2; P.begin().circle(L / 2, W / 2, r * 0.45).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.det }); P.begin(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; P.line(L / 2 + Math.cos(a) * r * 0.6, W / 2 + Math.sin(a) * r * 0.6, L / 2 + Math.cos(a) * r, W / 2 + Math.sin(a) * r); } P.stroke(PAL.ink, LW.det); },
    bollard: (P, L, W) => { const r = Math.min(L, W) / 2; P.begin().circle(L / 2, W / 2, r).paint({ fill: PAL.ink, stroke: PAL.ink, width: LW.fine }); P.begin().circle(L / 2, W / 2, r * 0.45).fill(PAL.lime); },
    roundabout: (P, L, W) => { const r = Math.min(L, W) / 2, cx = L / 2, cy = W / 2; P.begin().circle(cx, cy, r).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out }); P.begin().circle(cx, cy, r * 0.82).stroke(PAL.limeInk, LW.det);
      P.begin(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; P.line(cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15, cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); } P.stroke(PAL.ink, LW.det * 1.5);
      P.begin().circle(cx, cy, r * 0.15).paint({ fill: PAL.ink }); P.begin(); for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.5; P.moveTo(cx + Math.cos(a - 0.4) * r * 0.55, cy + Math.sin(a - 0.4) * r * 0.55).arc(cx, cy, r * 0.55, a - 0.4, a + 0.4, false, r * 0.55, true); } P.stroke(PAL.ink, 0.05, { cap: "round" }); },
    springRider: (P, L, W) => { const cx = L / 2, cy = W / 2; P.begin().circle(cx, cy, Math.min(W * 0.48, 0.18)).paint({ fill: PAL.graphite }); P.begin().ellipse(cx, cy, L * 0.3, W * 0.32).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out });
      P.begin().circle(L * 0.84, cy, W * 0.26).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.out }); P.begin().line(L * 0.7, cy - W * 0.46, L * 0.7, cy + W * 0.46).stroke(PAL.ink, 0.04, { cap: "round" }); P.begin().ellipse(L * 0.13, cy, L * 0.1, W * 0.2).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.det }); P.begin().roundRect(cx - 0.12, cy - 0.08, 0.24, 0.16, 0.05).fill(PAL.ink); },
    trampoline: (P, L, W) => C.tramp(P, 0, 0, L, W),
    seesaw: (P, L, W) => C.seesaw(P, 0, 0, L, W),
    swing2: (P, L, W) => C.swing(P, 0.05, W / 2, L - 0.05, W / 2, W - 0.1, ["flat", "flat"]),
    basketSwing: (P, L, W) => C.swing(P, 0.05, W / 2, L - 0.05, W / 2, W - 0.1, ["basket"]),
    slideFree: (P, L, W) => { C.ladder(P, 0, W / 2, L * 0.25, W / 2, W * 0.6); C.deck(P, L * 0.25, W * 0.15, W * 0.7, W * 0.7, { lod: 20 }); C.slide(P, L * 0.25 + W * 0.7, W / 2, L, W / 2, W * 0.55); },
    spinner: (P, L, W) => { const r = Math.min(L, W) / 2, cx = L / 2, cy = W / 2; P.begin().circle(cx, cy, r).paint({ fill: PAL.stone, stroke: PAL.ink, width: LW.det }); P.begin(); for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; P.line(cx, cy, cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); } P.stroke(PAL.ink, 0.06, { cap: "round" }); P.begin().circle(cx, cy, r * 0.3).paint({ fill: PAL.lime, stroke: PAL.ink, width: LW.det }); },
    customObject: (P, L, W) => { P.begin().rect(0, 0, L, W).paint({ fill: PAL.stone, stroke: PAL.ink, width: LW.out }); P.begin().line(0, 0, L, W).line(L, 0, 0, W).stroke(PAL.pebble, LW.fine); },
    label: () => {},
  };

  /* ---------------- line & area styles ---------------- */
  const AREA_STYLE = {
    grass: { fill: "#D9E6B3", edge: "#9DB45A", tex: "grass" },
    planting: { fill: "#C6DB8C", edge: "#7C9A26", tex: "shrubs" },
    bed: { fill: "#DCCFB5", edge: "#9C8A66", tex: "dots", dot: "#A8977A" },
    gravel: { fill: "#E6E2D7", edge: "#A8A397", tex: "dots", dot: "#B9B3A5" },
    rubber: { fill: "#E3DFD3", edge: "#8C877A", tex: "speckle", dot: "#B8D241" },
    turf: { fill: "#C9DB97", edge: "#93AA4E", tex: "stripes" },
    sand: { fill: "#F0E4C0", edge: "#C6AE76", tex: "dots", dot: "#CDB98A" },
    safetyFloor: { fill: "#E3EDB8", edge: "#7E9420", tex: "hatch", hatch: "#9BB33A" },
    clearance: { fill: "#FFFFFF", fillAlpha: 0.0, edge: "#7E9420", dash: true, tex: "hatch", hatch: "#C9DD7A" },
    restricted: { fill: "#B3261E", fillAlpha: 0.06, edge: "#B3261E", dash: true, tex: "hatch", hatch: "#E2A29D" },
    existing: { fill: "#45453F", fillAlpha: 0.16, edge: "#45453F", tex: "hatch", hatch: "#8F8F87" },
    customArea: { fill: "#EAE8E1", edge: "#5E5E58" },
  };
  const LINE_STYLE = {
    fence: { kind: "fence" }, wall: { kind: "wall" }, hedge: { kind: "hedge" }, path: { kind: "band", fill: "#E9E5DA", edge: "#A8A397" },
    pathAccessible: { kind: "band", fill: "#E9E5DA", edge: "#45453F", chevrons: true }, routeEmergency: { kind: "band", fill: "#B3261E", fillAlpha: 0.05, edge: "#B3261E", dash: true, chevrons: true, chevronColor: "#B3261E" },
    dimension: { kind: "dimension" }, customLine: { kind: "plain" },
  };

  function texture(P, poly, st, k) {
    if (!st.tex) return;
    const bb = bboxOf(poly), area = bb.w * bb.h; if (!(area > 0)) return;
    P.save(); P.begin().poly(poly).clip();
    if (st.tex === "hatch") {
      const sp = Math.max(0.4, 7 / Math.max(k, 0.01)); P.begin(); let n = 0;
      for (let t = -bb.h; t < bb.w && n < 600; t += sp, n++) P.line(bb.x0 + t, bb.y1, bb.x0 + t + bb.h, bb.y0);
      P.stroke(st.hatch || "#999", LW.det);
    } else if (st.tex === "stripes") {
      const sp = Math.max(1.5, 14 / Math.max(k, 0.01)); P.begin(); let i = 0;
      for (let t = 0; t < bb.w && i < 300; t += sp, i++) if (i % 2 === 0) P.rect(bb.x0 + t, bb.y0, sp, bb.h);
      P.fill("#FFFFFF", 0.1);
    } else {
      const rnd = mulberry(Math.round(bb.x0 * 97 + bb.y0 * 31)), sp = Math.max(st.tex === "shrubs" ? 1.1 : st.tex === "speckle" ? 0.55 : 0.35, (st.tex === "shrubs" ? 14 : st.tex === "speckle" ? 9 : 6) / Math.max(k, 0.01));
      const nx = Math.ceil(bb.w / sp), ny = Math.ceil(bb.h / sp); const max = 2500; const step = Math.max(1, Math.ceil(nx * ny / max));
      if (st.tex === "shrubs") { let c = 0; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if ((c++) % step) continue; const x = bb.x0 + (i + 0.2 + rnd() * 0.6) * sp, y = bb.y0 + (j + 0.2 + rnd() * 0.6) * sp; canopy(P, x, y, sp * 0.32, PAL.canopy, PAL.canopyDark, 6, i * 31 + j); } }
      else if (st.tex === "grass") { P.begin(); let c = 0; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if ((c++) % step) continue; const x = bb.x0 + (i + rnd()) * sp, y = bb.y0 + (j + rnd()) * sp; P.line(x, y, x + sp * 0.12, y - sp * 0.25); } P.stroke("#9DB45A", LW.fine); }
      else { P.begin(); let c = 0; const r = Math.max(0.02, 1.0 / Math.max(k, 0.01)); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if ((c++) % step) continue; P.circle(bb.x0 + (i + rnd()) * sp, bb.y0 + (j + rnd()) * sp, st.tex === "speckle" ? r * 1.2 : r); } P.fill(st.dot || "#999"); }
    }
    P.restore();
  }
  function bboxOf(pts) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }

  /** Area element in world coords (pen already in world→device transform). */
  function drawArea(P, el, poly, o = {}) {
    const st = AREA_STYLE[el.sym] || AREA_STYLE.customArea, k = P.kpx, fill = o.color || st.fill;
    P.begin().poly(poly).paint({ fill, fillAlpha: st.fillAlpha == null ? 1 : st.fillAlpha });
    if (k > 3 && o.mode !== "simple") texture(P, poly, st, k);
    P.begin().poly(poly).paint({ stroke: st.edge, px: o.sel ? 2 : 1.1 * (o.pdf ? 0.18 : 1), dashPx: st.dash ? (o.pdf ? [1.2, 0.8] : [6, 4]) : null });
  }
  /** Line element in world coords. gaps: [[t0,t1],...] distance ranges along the route that are openings (gates). */
  function drawLine(P, el, pts, o = {}) {
    if (pts.length < 2) return;
    const st = LINE_STYLE[el.sym] || LINE_STYLE.customLine, w = o.width || el.width || 0.1, k = P.k, kl = P.kpx, pdf = !!o.pdf;
    const runs = o.gaps && o.gaps.length ? splitRuns(pts, o.gaps) : [pts];
    if (st.kind === "fence") {
      for (const r of runs) { P.begin().poly(r, false).paint({ stroke: PAL.ink, width: Math.max(w, 0.06), cap: "butt", join: "round", px: pdf ? Math.max(0.3, Math.max(w, 0.06) * k) : Math.max(1.6, w * k) });
        if (!pdf && w * k > 4) P.begin().poly(r, false).paint({ stroke: PAL.white, px: Math.max(0.6, w * k * 0.4) });
        if (kl > 4) { const L = polyLen(r), n = Math.floor(L / 2.5); P.begin(); for (let i = 0; i <= n; i++) { const a = along(r, Math.min(L, i * 2.5)); P.rect(a[0] - 0.09, a[1] - 0.09, 0.18, 0.18); } const e = r[r.length - 1]; P.rect(e[0] - 0.09, e[1] - 0.09, 0.18, 0.18); P.fill(PAL.ink); } }
    } else if (st.kind === "wall") {
      for (const r of runs) { P.begin().poly(r, false).paint({ stroke: PAL.ink, width: w, cap: "square", join: "miter" }); P.begin().poly(r, false).paint({ stroke: PAL.graphite, width: w * 0.6, cap: "square", join: "miter" }); }
    } else if (st.kind === "hedge") {
      for (const r of runs) { P.begin().poly(r, false).paint({ stroke: PAL.canopyDark, width: w, cap: "round", join: "round" }); P.begin().poly(r, false).paint({ stroke: PAL.canopy, width: w * 0.72, cap: "round", join: "round" });
        if (kl > 6) { const L = polyLen(r); P.begin(); for (let t = w / 2; t < L; t += w * 0.7) { const a = along(r, t); P.circle(a[0], a[1], w * 0.22); } P.fill(PAL.canopyLight); } }
    } else if (st.kind === "band") {
      for (const r of runs) { P.begin().poly(r, false).paint({ stroke: st.edge, width: w, cap: "butt", join: "round", alpha: st.dash ? 0.9 : 1 });
        P.begin().poly(r, false).paint({ stroke: st.fill, width: Math.max(0, w - (pdf ? 0.06 : 2.2 / k)), cap: "butt", join: "round", alpha: st.fillAlpha == null ? 1 : Math.max(st.fillAlpha, 0.05) });
        if (st.fillAlpha != null) { P.begin().poly(r, false).paint({ stroke: "#FFFFFF", width: Math.max(0, w - (pdf ? 0.08 : 3 / k)), cap: "butt", join: "round" }); }
        if (st.chevrons && kl > 3) { const L = polyLen(r), sp = Math.max(w * 1.6, 2); P.begin(); for (let t = sp / 2; t < L; t += sp) { const a = alongDir(r, t), s = w * 0.22, c = Math.cos(a.ang), sn = Math.sin(a.ang);
          P.moveTo(a.p[0] - c * s - sn * s, a.p[1] - sn * s + c * s).lineTo(a.p[0], a.p[1]).lineTo(a.p[0] - c * s + sn * s, a.p[1] - sn * s - c * s); } P.stroke(st.chevronColor || PAL.graphite, Math.max(0.04, w * 0.05), { cap: "round", join: "round" }); } }
    } else if (st.kind === "dimension") {
      const a = pts[0], b = pts[pts.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), t = 0.25, nx = -Math.sin(ang) * t, ny = Math.cos(ang) * t;
      P.begin().line(a[0], a[1], b[0], b[1]).line(a[0] - nx, a[1] - ny, a[0] + nx, a[1] + ny).line(b[0] - nx, b[1] - ny, b[0] + nx, b[1] + ny).paint({ stroke: PAL.ink, px: pdf ? 0.18 : 1.2 });
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let r = ang; if (r > Math.PI / 2) r -= Math.PI; if (r < -Math.PI / 2) r += Math.PI;
      P.text(fmtM(L), (a[0] + b[0]) / 2 - Math.sin(ang) * 0.35 * (pdf ? 1 : 1), (a[1] + b[1]) / 2 + Math.cos(ang) * -0.35, { size: o.textSize || 11, align: "center", baseline: "middle", rot: r, color: PAL.ink, halo: pdf ? 0 : 3 });
    } else {
      for (const r of runs) P.begin().poly(r, false).paint({ stroke: o.color || PAL.graphite, width: w, cap: "round", join: "round", px: pdf ? null : Math.max(1.2, w * k) });
    }
  }
  const fmtM = (m) => (Math.abs(m) >= 100 ? m.toFixed(1) : m.toFixed(2)) + " m";
  function polyLen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
  function alongDir(p, t) { let acc = 0; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (t <= acc + L || i === p.length - 1) { const u = L ? Math.min(1, Math.max(0, (t - acc) / L)) : 0; return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) }; } acc += L; } return { p: p[0], ang: 0 }; }
  const along = (p, t) => alongDir(p, t).p;
  function splitRuns(pts, gaps) {
    const L = polyLen(pts), g = gaps.map(([a, b]) => [Math.max(0, a), Math.min(L, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const runs = []; let t = 0;
    for (const [a, b] of g) { if (a > t) runs.push(slice(pts, t, a)); t = Math.max(t, b); }
    if (t < L) runs.push(slice(pts, t, L));
    return runs.filter((r) => r.length >= 2);
  }
  function slice(pts, t0, t1) { const out = []; let acc = 0;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), s0 = acc, s1 = acc + L;
      if (s1 >= t0 && s0 <= t1 && L > 0) { const u0 = Math.max(0, (t0 - s0) / L), u1 = Math.min(1, (t1 - s0) / L); const p0 = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0], p1 = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1];
        if (!out.length || Math.hypot(out[out.length - 1][0] - p0[0], out[out.length - 1][1] - p0[1]) > 1e-9) out.push(p0); out.push(p1); }
      acc = s1; } return out; }

  /**
   * Draw a product at the pen's current origin/rotation (centre of footprint).
   * o: {lod: device px per metre, mode: 'design'|'presentation', simple: bool}
   */
  function drawProduct(P, p, o = {}) {
    const L = p.dims.l, W = p.dims.w, lod = o.lod || P.kpx;
    P.save().translate(-L / 2, -W / 2);
    const fn = S[p.code];
    if (!fn || lod < 4 || o.simple) {
      P.begin().rect(0, 0, L, W).paint({ fill: o.mode === "presentation" ? PAL.deck : PAL.limeTint, stroke: PAL.ink, width: LW.out });
      if (!fn && !o.simple && lod >= 4) genericProduct(P, L, W, p.sym, { lod });
    } else {
      // faint footprint ground so the true extent is always readable
      P.begin().rect(0, 0, L, W).paint({ fill: o.mode === "presentation" ? PAL.cream : PAL.limeTint, fillAlpha: o.mode === "presentation" ? 0.55 : 0.6 });
      try { fn(P, L, W, { lod, L, W }); } catch (e) { if (typeof console !== "undefined") console.error("symbol", p.code, e); }
      if (o.mode !== "presentation") P.begin().rect(0, 0, L, W).paint({ stroke: PAL.ink, width: LW.det, dash: [0.12, 0.08], alpha: 0.55 });
    }
    P.restore();
  }
  /** Draw a point element at the pen's origin (centre), size L × W. */
  function drawPointElement(P, el, L, W, o = {}) {
    P.save().translate(-L / 2, -W / 2);
    const fn = ELEMENT_SYM[el.sym] || ELEMENT_SYM.customObject;
    if ((o.lod || P.kpx) < 2.5 && el.kind === "point") P.begin().rect(0, 0, L, W).paint({ fill: PAL.stone, stroke: PAL.ink, px: 0.8 });
    else fn(P, L, W, o);
    P.restore();
  }
  const hasSymbol = (code) => !!S[code];

  root.DPSymbols = { PAL, LW, C, drawProduct, drawPointElement, drawArea, drawLine, hasSymbol, AREA_STYLE, LINE_STYLE, ELEMENT_SYM, splitRuns, mulberry };
})(typeof self !== "undefined" ? self : this);
