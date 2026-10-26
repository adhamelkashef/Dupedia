/* Dupedia Site Planner 2.0 — Pen: one drawing API with two outputs.
   The planner canvas and the PDF proposal draw the same plan through this layer, so what employees see is what clients get.
   Transforms are applied here (not by the backend), arcs become Bézier curves, so any affine transform is exact on both outputs.
   Canvas backend: device pixels. PDF backend (jsPDF): millimetres. */
(function (root) {
  "use strict";
  const K = 0.5522847498; // Bézier circle constant

  function hexRgb(hex) {
    const h = String(hex || "#000").replace("#", ""), f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
  }
  const rgba = (hex, a = 1) => { const [r, g, b] = hexRgb(hex); return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`; };

  class Pen {
    /** backend: {kind:'canvas', ctx} or {kind:'pdf', doc, fonts:{sans,sansBold,serif,serifItalic}} */
    constructor(backend) {
      this.b = backend; this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.ops = []; this.cur = null; this.start = null;
      this.minPx = backend.minLine || 0;       // hairline floor in device units
    }
    /* ---------- transform ---------- */
    save() { this.stack.push(this.m.slice()); if (this.b.kind === "canvas") this.b.ctx.save(); else this.b.doc.saveGraphicsState(); return this; }
    restore() { this.m = this.stack.pop() || [1, 0, 0, 1, 0, 0]; if (this.b.kind === "canvas") this.b.ctx.restore(); else this.b.doc.restoreGraphicsState(); return this; }
    transform(a, b, c, d, e, f) { const m = this.m; this.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]; return this; }
    translate(x, y) { return this.transform(1, 0, 0, 1, x, y); }
    rotate(rad) { const c = Math.cos(rad), s = Math.sin(rad); return this.transform(c, s, -s, c, 0, 0); }
    rotateDeg(d) { return this.rotate(d * Math.PI / 180); }
    scale(sx, sy = sx) { return this.transform(sx, 0, 0, sy, 0, 0); }
    setMatrix(m) { this.m = m.slice(); return this; }
    T(x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
    /** Device units per local unit (uniform scale assumed for widths). */
    get k() { const m = this.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }
    /** Device units per local unit expressed in screen-pixel terms (PDF: ~4 px per mm), for level-of-detail decisions. */
    get kpx() { return this.k * (this.b.pxScale || 1); }
    get angle() { return Math.atan2(this.m[1], this.m[0]); }

    /* ---------- path ---------- */
    begin() { this.ops = []; this.cur = null; this.start = null; return this; }
    moveTo(x, y) { const p = this.T(x, y); this.ops.push(["M", p]); this.cur = [x, y]; this.start = [x, y]; return this; }
    lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.ops.push(["L", this.T(x, y)]); this.cur = [x, y]; return this; }
    bezierTo(x1, y1, x2, y2, x, y) { if (!this.cur) this.moveTo(x1, y1); this.ops.push(["C", this.T(x1, y1), this.T(x2, y2), this.T(x, y)]); this.cur = [x, y]; return this; }
    quadTo(cx, cy, x, y) { const [x0, y0] = this.cur || [cx, cy]; return this.bezierTo(x0 + 2 / 3 * (cx - x0), y0 + 2 / 3 * (cy - y0), x + 2 / 3 * (cx - x), y + 2 / 3 * (cy - y), x, y); }
    close() { if (this.start) { this.ops.push(["Z"]); this.cur = this.start.slice(); } return this; }
    /** Elliptical arc in local units, angles in radians, split into ≤90° Bézier segments. */
    arc(cx, cy, rx, a0, a1, ccw = false, ry = rx, connect = true) {
      let sweep = a1 - a0;
      if (!ccw && sweep < 0) sweep += Math.PI * 2; if (ccw && sweep > 0) sweep -= Math.PI * 2;
      if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) sweep = ccw ? -Math.PI * 2 : Math.PI * 2;
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), step = sweep / n;
      const P = (a) => [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
      const s = P(a0); if (!this.cur || !connect) this.moveTo(s[0], s[1]); else this.lineTo(s[0], s[1]);
      for (let i = 0; i < n; i++) {
        const t0 = a0 + i * step, t1 = t0 + step, h = 4 / 3 * Math.tan(step / 4);
        const p1 = [cx + rx * (Math.cos(t0) - h * Math.sin(t0)), cy + ry * (Math.sin(t0) + h * Math.cos(t0))];
        const p2 = [cx + rx * (Math.cos(t1) + h * Math.sin(t1)), cy + ry * (Math.sin(t1) - h * Math.cos(t1))], e = P(t1);
        this.bezierTo(p1[0], p1[1], p2[0], p2[1], e[0], e[1]);
      }
      return this;
    }
    circle(cx, cy, r) { this.moveTo(cx + r, cy); this.arc(cx, cy, r, 0, Math.PI * 2, false, r, true); return this.close(); }
    ellipse(cx, cy, rx, ry) { this.moveTo(cx + rx, cy); this.arc(cx, cy, rx, 0, Math.PI * 2, false, ry, true); return this.close(); }
    rect(x, y, w, h) { return this.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).close(); }
    roundRect(x, y, w, h, r) {
      const rr = Array.isArray(r) ? r : [r, r, r, r], m = Math.min(Math.abs(w), Math.abs(h)) / 2, [a, b, c, d] = rr.map((v) => Math.max(0, Math.min(v, m)));
      this.moveTo(x + a, y); this.lineTo(x + w - b, y); if (b) this.arc(x + w - b, y + b, b, -Math.PI / 2, 0);
      this.lineTo(x + w, y + h - c); if (c) this.arc(x + w - c, y + h - c, c, 0, Math.PI / 2);
      this.lineTo(x + d, y + h); if (d) this.arc(x + d, y + h - d, d, Math.PI / 2, Math.PI);
      this.lineTo(x, y + a); if (a) this.arc(x + a, y + a, a, Math.PI, Math.PI * 1.5);
      return this.close();
    }
    poly(pts, closed = true) { pts.forEach((p, i) => (i ? this.lineTo(p[0], p[1]) : this.moveTo(p[0], p[1]))); if (closed) this.close(); return this; }
    line(x1, y1, x2, y2) { return this.moveTo(x1, y1).lineTo(x2, y2); }

    /* ---------- paint ---------- */
    _emit() {
      if (this.b.kind === "canvas") {
        const c = this.b.ctx; c.beginPath();
        for (const o of this.ops) { if (o[0] === "M") c.moveTo(o[1][0], o[1][1]); else if (o[0] === "L") c.lineTo(o[1][0], o[1][1]); else if (o[0] === "C") c.bezierCurveTo(o[1][0], o[1][1], o[2][0], o[2][1], o[3][0], o[3][1]); else c.closePath(); }
      } else {
        const d = this.b.doc;
        for (const o of this.ops) { if (o[0] === "M") d.moveTo(o[1][0], o[1][1]); else if (o[0] === "L") d.lineTo(o[1][0], o[1][1]); else if (o[0] === "C") d.curveTo(o[1][0], o[1][1], o[2][0], o[2][1], o[3][0], o[3][1]); else d.close(); }
      }
    }
    _alpha(fa, sa) {
      if (this.b.kind !== "pdf") return;
      const d = this.b.doc, key = fa + "|" + sa; if (this._ga === key) return; this._ga = key;
      d.setGState(new d.GState({ opacity: fa, "stroke-opacity": sa }));
    }
    /** opts: {fill, fillAlpha, stroke, width (local units), px (device units, overrides width), alpha, dash (local units), dashPx, cap, join, evenOdd} */
    paint(o) {
      if (!this.ops.length) return this;
      const hasF = !!o.fill, hasS = !!o.stroke;
      let lw = o.px != null ? o.px : (o.width || 0) * this.k; if (this.minPx && hasS) lw = Math.max(lw, this.minPx);
      const dash = o.dashPx || (o.dash ? o.dash.map((v) => v * this.k) : null);
      const fa = o.fillAlpha != null ? o.fillAlpha : (o.alpha != null ? o.alpha : 1), sa = o.strokeAlpha != null ? o.strokeAlpha : (o.alpha != null ? o.alpha : 1);
      if (this.b.kind === "canvas") {
        const c = this.b.ctx; this._emit();
        if (hasF) { c.fillStyle = rgba(o.fill, fa); c.fill(o.evenOdd ? "evenodd" : "nonzero"); }
        if (hasS && lw > 0) { c.strokeStyle = rgba(o.stroke, sa); c.lineWidth = lw; c.lineCap = o.cap || "butt"; c.lineJoin = o.join || "miter"; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); }
      } else {
        const d = this.b.doc;
        this._alpha(hasF ? fa : 1, hasS ? sa : 1);
        if (hasF) d.setFillColor(...hexRgb(o.fill));
        if (hasS) { d.setDrawColor(...hexRgb(o.stroke)); d.setLineWidth(Math.max(lw, 0.01)); d.setLineCap(o.cap === "round" ? 1 : o.cap === "square" ? 2 : 0); d.setLineJoin(o.join === "round" ? 1 : o.join === "bevel" ? 2 : 0); d.setLineDashPattern(dash || [], 0); }
        if (hasF && hasS && fa === sa && lw > 0) { this._emit(); o.evenOdd ? d.fillStrokeEvenOdd() : d.fillStroke(); }
        else {
          if (hasF) { this._emit(); o.evenOdd ? d.fillEvenOdd() : d.fill(); }
          if (hasS && lw > 0) { this._alpha(1, sa); this._emit(); d.stroke(); }
        }
        if (hasS && dash) d.setLineDashPattern([], 0);
        this._alpha(1, 1);
      }
      return this;
    }
    fill(color, alpha = 1, evenOdd = false) { return this.paint({ fill: color, fillAlpha: alpha, evenOdd }); }
    stroke(color, width, more) { return this.paint(Object.assign({ stroke: color, width }, more || {})); }
    clip() {
      if (this.b.kind === "canvas") { this._emit(); this.b.ctx.clip(); }
      else { const d = this.b.doc; this._emit(); d.clip(); d.discardPath(); }
      return this;
    }

    /* ---------- text ---------- */
    /** size in device units unless opts.local (then local units). font: sans|sansBold|serif|serifItalic */
    text(str, x, y, o = {}) {
      str = String(str == null ? "" : str); if (!str) return this;
      const p = this.T(x, y), size = o.local ? o.size * this.k : (o.size || 10), rot = (o.rot || 0) + (o.followRotation ? this.angle : 0);
      const align = o.align || "left", base = o.baseline || "alphabetic", color = o.color || "#262626", font = o.font || "sans";
      if (this.b.kind === "canvas") {
        const c = this.b.ctx, fam = font.startsWith("serif") ? '"Fraunces", Georgia, serif' : '"Instrument Sans", Arial, sans-serif';
        const wt = font === "sansBold" ? 600 : font.startsWith("serif") ? 600 : 400, it = font === "serifItalic" ? "italic " : "";
        c.save(); c.translate(p[0], p[1]); if (rot) c.rotate(rot);
        c.font = `${it}${wt} ${size}px ${fam}`; if (font.startsWith("serif")) try { c.fontVariationSettings = '"SOFT" 100'; } catch (e) {}
        c.textAlign = align; c.textBaseline = base; c.fillStyle = rgba(color, o.alpha == null ? 1 : o.alpha);
        if (o.halo) { c.lineWidth = o.halo; c.strokeStyle = o.haloColor || "rgba(255,255,255,.9)"; c.lineJoin = "round"; c.strokeText(str, 0, 0); }
        c.fillText(str, 0, 0); c.restore();
      } else {
        const d = this.b.doc, f = this.b.fonts[font] || this.b.fonts.sans;
        d.setFont(f, "normal"); d.setFontSize(size / 0.3527777778); // mm → pt
        d.setTextColor(...hexRgb(color));
        str = this.b.safe ? this.b.safe(str, font) : str;
        const deg = -rot * 180 / Math.PI;
        // jsPDF baseline for rotated text is unreliable: offset manually
        const w = d.getTextWidth(str), ax = align === "center" ? -w / 2 : align === "right" ? -w : 0;
        const ay = base === "middle" ? size * 0.35 : base === "top" ? size * 0.75 : base === "bottom" ? -size * 0.22 : 0;
        const c = Math.cos(rot), s = Math.sin(rot), px = p[0] + ax * c - ay * s, py = p[1] + ax * s + ay * c;
        if (o.halo) { this._alpha(0.92, 1); d.setFillColor(255, 255, 255); }
        d.text(str, px, py, { angle: deg || 0 });
      }
      return this;
    }
    measure(str, size, font = "sans") {
      if (this.b.kind === "canvas") { const c = this.b.ctx; c.save(); c.font = `${font === "sansBold" || font.startsWith("serif") ? 600 : 400} ${size}px ${font.startsWith("serif") ? '"Fraunces", Georgia' : '"Instrument Sans", Arial'}`; const w = c.measureText(str).width; c.restore(); return w; }
      const d = this.b.doc; d.setFont(this.b.fonts[font] || this.b.fonts.sans, "normal"); d.setFontSize(size / 0.3527777778); return d.getTextWidth(String(str));
    }
    /** Image in local units, axis-aligned in device space (no rotation needed in this app). */
    image(img, x, y, w, h, fmt) {
      const p = this.T(x, y), q = this.T(x + w, y + h);
      if (this.b.kind === "canvas") { if (img && img.complete !== false) this.b.ctx.drawImage(img, p[0], p[1], q[0] - p[0], q[1] - p[1]); }
      else this.b.doc.addImage(img, fmt || "JPEG", p[0], p[1], q[0] - p[0], q[1] - p[1], undefined, "FAST");
      return this;
    }
  }
  Pen.hexRgb = hexRgb; Pen.rgba = rgba;
  if (typeof module === "object" && module.exports) module.exports = Pen; else root.DPPen = Pen;
})(typeof self !== "undefined" ? self : this);
