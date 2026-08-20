/**
 * pixel-engine.js — Zero-dependency pixel-art construction engine (64x64 baseline).
 *
 * UMD: usable from Node (`require`) and browser (`window.PixelEngine`).
 *
 * ============================================================================
 * SCENE DOCUMENT (the structured representation the agent maintains)
 * ============================================================================
 * A scene is plain declarative JSON:
 *
 *   {
 *     "size": 64,
 *     "palette": { "sky": "#7EC8E3", "roof": "#C25B3A", ... },
 *     "layers": [ { "id": "roof", "type": "poly", "color": "roof",
 *                   "points": [[13,28],[51,28],[32,11]] }, ... ],   // paint order
 *     "pixels": { "25,36": "#3A2315", "30,43": null }               // sparse overrides (null = clear)
 *   }
 *
 * Layer types:
 *   fill     { color }                        whole canvas
 *   rect     { x, y, w, h }                   filled rectangle
 *   rectout  { x, y, w, h, t? }               rectangle outline (t = thickness, default 1)
 *   ellipse  { cx, cy, rx, ry }               filled ellipse
 *   line     { x1, y1, x2, y2 }               Bresenham line (thickness 1)
 *   poly     { points: [[x,y],...] }          filled polygon (scanline, even-odd)
 *   polyout  { points: [[x,y],...] }          polygon outline (edges drawn as lines)
 *
 * Colors: a palette key ("roof") or a hex string ("#C25B3A"). null / "transparent" skips.
 * Rasterization is painter's algorithm: later layers paint over earlier ones.
 * Sparse pixel overrides are applied last, on top of everything.
 * ============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PixelEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Color helpers
  // --------------------------------------------------------------------------

  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    let s = hex.trim();
    if (s[0] === '#') s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function hexOf(rgb) {
    if (!rgb) return null;
    return '#' + [rgb[0], rgb[1], rgb[2]].map(function (v) {
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  /** Resolve a layer color value (palette key or hex) to an rgb array; null if transparent. */
  function resolveColor(scene, color) {
    if (color === null || color === undefined) return null;
    if (typeof color === 'string') {
      const t = color.trim();
      if (t === '' || t === 'transparent' || t === 'clear') return null;
      if (t[0] === '#') return parseHex(t);
      if (scene.palette && Object.prototype.hasOwnProperty.call(scene.palette, t)) {
        return parseHex(scene.palette[t]);
      }
      return null; // unknown name -> transparent (treated as skip)
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Scene construction tools (the plan's tool API, snake_case)
  // --------------------------------------------------------------------------

  /** create_canvas(size, background) -> empty scene with an optional background fill layer. */
  function create_canvas(size, background) {
    size = size || 64;
    const scene = {
      size: size,
      palette: {},
      layers: [],
      pixels: {}
    };
    if (background !== undefined && background !== null && background !== '') {
      scene.layers.push({ id: 'background', type: 'fill', color: background });
    }
    return scene;
  }

  /** add_layer(scene, layer) -> pushes a shape layer (returns scene for chaining). */
  function add_layer(scene, layer) {
    if (!layer.id) layer.id = 'layer' + scene.layers.length;
    scene.layers.push(layer);
    return scene;
  }

  /** fill_region(scene, x, y, w, h, color, id?) -> filled rect layer. */
  function fill_region(scene, x, y, w, h, color, id) {
    return add_layer(scene, { id: id, type: 'rect', x: x, y: y, w: w, h: h, color: color });
  }

  /** draw_shape(scene, type, params) -> generic shape layer; params include color. */
  function draw_shape(scene, type, params) {
    const layer = Object.assign({}, params, { type: type });
    return add_layer(scene, layer);
  }

  /** set_pixel(scene, x, y, color) -> sparse override. null clears to underlying layer. */
  function set_pixel(scene, x, y, color) {
    scene.pixels[x + ',' + y] = color === null || color === undefined ? null : color;
    return scene;
  }

  /** clear_pixel(scene, x, y) -> remove override, expose underlying layers. */
  function clear_pixel(scene, x, y) {
    delete scene.pixels[x + ',' + y];
    return scene;
  }

  /** get_pixel(scene, x, y) -> resolved hex color at a coordinate (or null if transparent). */
  function get_pixel(scene, x, y) {
    const size = scene.size;
    if (!(x >= 0 && y >= 0 && x < size && y < size)) return null; // out of bounds
    const buf = rasterize(scene);
    const i = (y * size + x) * 4;
    if (buf[i + 3] === 0) return null;
    return hexOf([buf[i], buf[i + 1], buf[i + 2]]);
  }

  /**
   * mirror_region(scene, x, y, w, h, axis) -> mirrors the region's resolved
   * pixels across its centerline, writing pixel overrides. axis 'h' mirrors
   * left<->right (odd widths keep the center column), 'v' mirrors
   * top<->bottom. Out-of-bounds regions are clamped; empty/zero-size is a
   * no-op. Transparent pixels are skipped (nothing is erased). Returns
   * { mirrored }.
   */
  function mirror_region(scene, x, y, w, h, axis) {
    if (axis !== 'h' && axis !== 'v') {
      throw new Error("mirror_region: axis must be 'h' or 'v', got: " + axis);
    }
    if (!(w > 0 && h > 0)) return { mirrored: 0 };
    const size = scene.size;
    const buf = rasterize(scene);
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    const writes = [];
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * size + xx) * 4;
        if (buf[i + 3] === 0) continue;
        const mx = axis === 'h' ? x + (w - 1) - (xx - x) : xx;
        const my = axis === 'v' ? y + (h - 1) - (yy - y) : yy;
        if (mx < 0 || my < 0 || mx >= size || my >= size) continue;
        writes.push({ x: mx, y: my, hex: hexOf([buf[i], buf[i + 1], buf[i + 2]]) });
      }
    }
    writes.forEach(function (p) { set_pixel(scene, p.x, p.y, p.hex); });
    return { mirrored: writes.length };
  }

  /**
   * replace_color(scene, from, to) -> document-level recolor. from/to are
   * palette keys or hexes; if from is a hex, every key whose hex equals it
   * is remapped. Rewrites layer colors and pixel overrides; a to hex not in
   * the palette is added as a key. Returns { replaced }.
   */
  function replace_color(scene, from, to) {
    if (!scene.palette) scene.palette = {};
    const pal = scene.palette;
    // Same-hex from/to is a no-op.
    if (typeof from === 'string' && from[0] === '#' && typeof to === 'string' && to[0] === '#') {
      const fh = parseHex(from), th = parseHex(to);
      if (fh && th && hexOf(fh) === hexOf(th)) return { replaced: 0 };
    }
    // Resolve the target to a palette key, adding a key for a new hex.
    let toKey;
    if (typeof to === 'string' && Object.prototype.hasOwnProperty.call(pal, to)) {
      toKey = to;
    } else {
      const toHex = parseHex(to);
      if (!toHex) throw new Error('replace_color: unknown target color: ' + to);
      const toHexStr = hexOf(toHex);
      toKey = Object.keys(pal).find(function (k) { return hexOf(parseHex(pal[k])) === toHexStr; });
      if (!toKey) {
        let i = 0;
        do { toKey = 'color' + i++; } while (Object.prototype.hasOwnProperty.call(pal, toKey));
        pal[toKey] = toHexStr;
      }
    }
    // Resolve the source set: one key, or every key whose hex matches.
    const sources = new Set();
    if (typeof from === 'string' && Object.prototype.hasOwnProperty.call(pal, from)) {
      sources.add(from);
    } else {
      const fromHex = parseHex(from);
      if (!fromHex) return { replaced: 0 };
      const fromHexStr = hexOf(fromHex);
      for (const k of Object.keys(pal)) {
        if (hexOf(parseHex(pal[k])) === fromHexStr) sources.add(k);
      }
      if (sources.size === 0) return { replaced: 0 };
    }
    if (sources.size === 1 && sources.has(toKey)) return { replaced: 0 };
    let replaced = 0;
    for (const layer of scene.layers || []) {
      if (sources.has(layer.color)) { layer.color = toKey; replaced++; }
    }
    for (const key of Object.keys(scene.pixels || {})) {
      if (sources.has(scene.pixels[key])) { scene.pixels[key] = toKey; replaced++; }
    }
    return { replaced: replaced };
  }

  /**
   * flood_fill(scene, x, y, color, tolerance?) -> fills the 4-connected
   * region of the seed's resolved color with color, writing pixel overrides.
   * tolerance (0 = exact, default) is the max per-channel RGB difference,
   * clamped to [0, 255]. A transparent seed fills the connected transparent
   * region. Returns { filled }.
   */
  function flood_fill(scene, x, y, color, tolerance) {
    const size = scene.size;
    if (!(x >= 0 && y >= 0 && x < size && y < size)) return { filled: 0 };
    const tol = typeof tolerance === 'number' && isFinite(tolerance)
      ? Math.max(0, Math.min(255, tolerance)) : 0;
    const buf = rasterize(scene);
    const i = (y * size + x) * 4;
    const targetAlpha = buf[i + 3];
    const targetRgb = [buf[i], buf[i + 1], buf[i + 2]];
    const fillRgb = resolveColor(scene, color);
    if (fillRgb && targetAlpha === 255 &&
        fillRgb[0] === targetRgb[0] && fillRgb[1] === targetRgb[1] && fillRgb[2] === targetRgb[2]) {
      return { filled: 0 };
    }
    if (!fillRgb && targetAlpha === 0) return { filled: 0 };
    const matches = function (px, py) {
      const j = (py * size + px) * 4;
      if (buf[j + 3] !== targetAlpha) return false;
      if (targetAlpha === 0) return true;
      return Math.abs(buf[j] - targetRgb[0]) <= tol &&
             Math.abs(buf[j + 1] - targetRgb[1]) <= tol &&
             Math.abs(buf[j + 2] - targetRgb[2]) <= tol;
    };
    const visited = new Uint8Array(size * size);
    const queue = [[x, y]];
    visited[y * size + x] = 1;
    const writes = [];
    while (queue.length) {
      const p = queue.pop();
      writes.push(p);
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p[0] + d[0], ny = p[1] + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (visited[ni]) continue;
        if (matches(nx, ny)) { visited[ni] = 1; queue.push([nx, ny]); }
      }
    }
    writes.forEach(function (p) { set_pixel(scene, p[0], p[1], color); });
    return { filled: writes.length };
  }

  /** draw_cluster(scene, x, y, pattern, color) -> paints a reusable pixel pattern (scales, feathers, stars) at (x, y) as overrides; pattern is [dx,dy] offsets or a string grid (any char other than '.' or space paints); OOB offsets skipped. Returns { painted }. */
  function draw_cluster(scene, x, y, pattern, color) {
    const size = scene.size;
    let painted = 0;
    const paint = function (dx, dy) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
        set_pixel(scene, nx, ny, color);
        painted++;
      }
    };
    if (pattern && pattern.length && typeof pattern[0] === 'string') {
      for (let row = 0; row < pattern.length; row++) {
        for (let col = 0; col < pattern[row].length; col++) {
          const c = pattern[row][col];
          if (c !== '.' && c !== ' ') paint(col, row);
        }
      }
    } else {
      for (const off of pattern || []) {
        if (Array.isArray(off) && off.length >= 2) paint(off[0], off[1]);
      }
    }
    return { painted: painted };
  }

  /** move_region(scene, x, y, w, h, dx, dy) -> moves the region's opaque pixels to (x+dx, y+dy) as overrides; sources become null overrides (erase-by-reveal); overlapping moves clear every source before writing destinations. Returns { moved }. */
  function move_region(scene, x, y, w, h, dx, dy) {
    const size = scene.size;
    const buf = rasterize(scene);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    const writes = [];
    const clears = [];
    let moved = 0;
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const i = (yy * size + xx) * 4;
        if (buf[i + 3] === 0) continue;
        const hex = '#' + [buf[i], buf[i + 1], buf[i + 2]].map(function (v) {
          return ('0' + v.toString(16)).slice(-2);
        }).join('');
        const nx = xx + dx, ny = yy + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
          writes.push({ x: nx, y: ny, hex: hex });
          moved++;
        }
        clears.push({ x: xx, y: yy });
      }
    }
    clears.forEach(function (p) { set_pixel(scene, p.x, p.y, null); });
    writes.forEach(function (p) { set_pixel(scene, p.x, p.y, p.hex); });
    return { moved: moved };
  }

  /** copy_region(scene, x, y, w, h, dx, dy) -> copies the region's opaque pixels to (x+dx, y+dy) as overrides within the same scene (source unchanged). Returns { copied }. */
  function copy_region(scene, x, y, w, h, dx, dy) {
    const size = scene.size;
    const buf = rasterize(scene);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    let copied = 0;
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const i = (yy * size + xx) * 4;
        if (buf[i + 3] === 0) continue;
        const hex = '#' + [buf[i], buf[i + 1], buf[i + 2]].map(function (v) {
          return ('0' + v.toString(16)).slice(-2);
        }).join('');
        const nx = xx + dx, ny = yy + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
          set_pixel(scene, nx, ny, hex);
          copied++;
        }
      }
    }
    return { copied: copied };
  }

  /** extract_outline(scene, region?) -> boundary pixels [{x,y},...] of the painted silhouette: painted pixels whose 4-neighbor is transparent, out of canvas, or out of the optional region {x, y, w, h} (whole canvas when omitted). Empty region -> []. */
  function extract_outline(scene, region) {
    const size = scene.size;
    const buf = rasterize(scene);
    const rx = region && region.x !== undefined ? region.x : 0;
    const ry = region && region.y !== undefined ? region.y : 0;
    const rw = region ? region.w : size;
    const rh = region ? region.h : size;
    const x0 = Math.max(0, rx), y0 = Math.max(0, ry);
    const x1 = Math.min(size, rx + rw), y1 = Math.min(size, ry + rh);
    const covered = function (x, y) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      return buf[(y * size + x) * 4 + 3] !== 0;
    };
    const out = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!covered(x, y)) continue;
        if (!covered(x - 1, y) || !covered(x + 1, y) || !covered(x, y - 1) || !covered(x, y + 1)) {
          out.push({ x: x, y: y });
        }
      }
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // polygon boolean ops (Weiler-Atherton traversal)
  // --------------------------------------------------------------------------

  const POLY_EPS = 1e-9;

  function polyArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  function cleanPoly(poly) {
    const out = [];
    for (const p of poly) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > POLY_EPS) out.push([p[0], p[1]]);
    }
    if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= POLY_EPS) out.pop();
    return out;
  }

  function samePoly(a, b) {
    if (a.length !== b.length) return false;
    const n = a.length;
    for (let i = 0; i < n; i++) {
      if (Math.hypot(a[i][0] - b[0][0], a[i][1] - b[0][1]) <= POLY_EPS) {
        let fwd = true, rev = true;
        for (let k = 1; k < n; k++) {
          const j = (i + k) % n;
          if (fwd && Math.hypot(a[j][0] - b[k][0], a[j][1] - b[k][1]) > POLY_EPS) fwd = false;
          if (rev && Math.hypot(a[j][0] - b[n - k][0], a[j][1] - b[n - k][1]) > POLY_EPS) rev = false;
        }
        if (fwd || rev) return true;
      }
    }
    return false;
  }

  function segIntersect(a1, a2, b1, b2) {
    const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
    const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
    const denom = d1x * d2y - d1y * d2x;
    const out = [];
    if (Math.abs(denom) < POLY_EPS) {
      const cx = b1[0] - a1[0], cy = b1[1] - a1[1];
      if (Math.abs(cx * d1y - cy * d1x) > POLY_EPS) return out;
      const len2 = d1x * d1x + d1y * d1y;
      if (len2 < POLY_EPS) return out;
      const tb1 = (cx * d1x + cy * d1y) / len2;
      const tb2 = ((b2[0] - a1[0]) * d1x + (b2[1] - a1[1]) * d1y) / len2;
      const lo = Math.max(0, Math.min(tb1, tb2)), hi = Math.min(1, Math.max(tb1, tb2));
      if (lo > hi + POLY_EPS) return out;
      const len2b = d2x * d2x + d2y * d2y;
      const pts = [];
      if (lo >= -POLY_EPS && lo <= 1 + POLY_EPS) pts.push(lo);
      if (hi > lo + POLY_EPS && hi >= -POLY_EPS && hi <= 1 + POLY_EPS) pts.push(hi);
      for (const t of pts) {
        const px = a1[0] + t * d1x, py = a1[1] + t * d1y;
        const t2 = len2b < POLY_EPS ? 0 : ((px - b1[0]) * d2x + (py - b1[1]) * d2y) / len2b;
        out.push({ x: px, y: py, t1: t, t2: t2 });
      }
      return out;
    }
    const t1 = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / denom;
    const t2 = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / denom;
    if (t1 < -POLY_EPS || t1 > 1 + POLY_EPS || t2 < -POLY_EPS || t2 > 1 + POLY_EPS) return out;
    const c1 = Math.max(0, Math.min(1, t1)), c2 = Math.max(0, Math.min(1, t2));
    out.push({ x: a1[0] + c1 * d1x, y: a1[1] + c1 * d1y, t1: c1, t2: c2 });
    return out;
  }

  function pointOnSegment(x, y, p1, p2) {
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    const len2 = d1x * d1x + d1y * d1y;
    if (len2 < POLY_EPS * POLY_EPS) return Math.hypot(x - p1[0], y - p1[1]) < POLY_EPS;
    const t = ((x - p1[0]) * d1x + (y - p1[1]) * d1y) / len2;
    if (t < -POLY_EPS || t > 1 + POLY_EPS) return false;
    const px = p1[0] + t * d1x, py = p1[1] + t * d1y;
    return Math.hypot(x - px, y - py) < POLY_EPS;
  }

  function classifyPoint(x, y, poly) {
    for (let i = 0; i < poly.length; i++) {
      if (pointOnSegment(x, y, poly[i], poly[(i + 1) % poly.length])) return 'on';
    }
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside ? 'in' : 'out';
  }

  function polyKey(x, y) {
    return x.toFixed(6) + ',' + y.toFixed(6);
  }

  /** poly_union(a, b) -> point array of the union of two polygons (single contour; disjoint inputs return both contours concatenated — rasterize those separately). */
  function poly_union(a, b) { return booleanOp(a, b, 'union'); }

  /** poly_subtract(a, b) -> point array of a minus b (single contour; a fully containing b returns a — holes are not representable). */
  function poly_subtract(a, b) { return booleanOp(a, b, 'subtract'); }

  function booleanOp(subject, clip, op) {
    const S = cleanPoly(subject), C = cleanPoly(clip);
    if (S.length < 3 || polyArea(S) < POLY_EPS) {
      if (op === 'union') return (C.length >= 3 && polyArea(C) >= POLY_EPS) ? C.slice() : null;
      return null;
    }
    if (C.length < 3 || polyArea(C) < POLY_EPS) return S.slice();
    if (samePoly(S, C)) return op === 'union' ? S.slice() : null;
    const sLoc = new Map(), cLoc = new Map();
    const sFinal = [], cFinal = [];
    S.forEach(function (v) {
      const e = { x: v[0], y: v[1], inter: false, other: null };
      sFinal.push(e); sLoc.set(polyKey(e.x, e.y), e);
    });
    C.forEach(function (v) {
      const e = { x: v[0], y: v[1], inter: false, other: null };
      cFinal.push(e); cLoc.set(polyKey(e.x, e.y), e);
    });
    const sEdgeInts = S.map(function () { return []; });
    const cEdgeInts = C.map(function () { return []; });
    for (let i = 0; i < S.length; i++) {
      const a1 = S[i], a2 = S[(i + 1) % S.length];
      for (let j = 0; j < C.length; j++) {
        const ints = segIntersect(a1, a2, C[j], C[(j + 1) % C.length]);
        for (const it of ints) {
          sEdgeInts[i].push({ t: it.t1, x: it.x, y: it.y });
          cEdgeInts[j].push({ t: it.t2, x: it.x, y: it.y });
        }
      }
    }
    const insertInts = function (edgeInts, final, loc) {
      const perEdge = edgeInts.map(function () { return []; });
      for (let i = 0; i < edgeInts.length; i++) {
        edgeInts[i].sort(function (p, q) { return p.t - q.t; });
        let prev = null;
        for (const it of edgeInts[i]) {
          if (prev && Math.hypot(it.x - prev.x, it.y - prev.y) <= POLY_EPS) continue;
          prev = it;
          const k = polyKey(it.x, it.y);
          const existing = loc.get(k);
          if (existing) { existing.inter = true; continue; }
          const e = { x: it.x, y: it.y, inter: true, other: null };
          loc.set(k, e);
          perEdge[i].push(e);
        }
      }
      const merged = [];
      for (let i = 0; i < final.length; i++) {
        merged.push(final[i]);
        for (const e of perEdge[i]) merged.push(e);
      }
      return merged;
    };
    const sList = insertInts(sEdgeInts, sFinal, sLoc);
    const cList = insertInts(cEdgeInts, cFinal, cLoc);
    for (const e of sList) {
      if (e.inter) {
        const c = cLoc.get(polyKey(e.x, e.y));
        if (c) { e.other = c; c.other = e; }
      }
    }
    let anyInter = false;
    for (const e of sList) { if (e.inter) { anyInter = true; break; } }
    if (!anyInter) {
      const cInS = C.every(function (p) { return classifyPoint(p[0], p[1], S) !== 'out'; });
      const sInC = S.every(function (p) { return classifyPoint(p[0], p[1], C) !== 'out'; });
      if (op === 'union') {
        if (cInS) return S.slice();
        if (sInC) return C.slice();
        return S.concat(C);
      }
      if (sInC) return null;
      return S.slice();
    }
    for (const e of sList) if (!e.inter) e.c = classifyPoint(e.x, e.y, C);
    for (const e of cList) if (!e.inter) e.c = classifyPoint(e.x, e.y, S);
    let start = null;
    for (const e of sList) if (!e.inter && e.c === 'out') { start = e; break; }
    if (!start) {
      for (let i = 0; i < sList.length; i++) {
        const e = sList[i];
        if (e.inter) {
          const n = sList[(i + 1) % sList.length];
          if ((n.inter ? 'on' : n.c) === 'out') { start = e; break; }
        }
      }
      if (!start) return op === 'union' ? C.slice() : null;
    }
    const result = [];
    const visited = new Set();
    const idx = function (list, e) { return list.indexOf(e); };
    let cur = start, list = sList, dir = 1;
    while (true) {
      if (visited.has(cur)) break;
      visited.add(cur);
      result.push([cur.x, cur.y]);
      const i = idx(list, cur);
      const nextE = list[(i + dir + list.length) % list.length];
      if (cur.inter) {
        if (list === sList) {
          const c = nextE.inter ? 'on' : nextE.c;
          if (c !== 'out') {
            const cEntry = cur.other;
            if (!cEntry) break;
            const ci = idx(cList, cEntry);
            const n1 = cList[(ci + 1) % cList.length], n2 = cList[(ci - 1 + cList.length) % cList.length];
            const m1 = [(cEntry.x + n1.x) / 2, (cEntry.y + n1.y) / 2];
            const m2 = [(cEntry.x + n2.x) / 2, (cEntry.y + n2.y) / 2];
            const cm1 = classifyPoint(m1[0], m1[1], S);
            const cm2 = classifyPoint(m2[0], m2[1], S);
            let d = 1;
            if (op === 'union') {
              if (cm1 === 'out') d = 1;
              else if (cm2 === 'out') d = -1;
              else if (cm1 === 'on') d = 1;
              else if (cm2 === 'on') d = -1;
            } else {
              if (cm1 === 'in') d = 1;
              else if (cm2 === 'in') d = -1;
              else if (cm1 === 'on') d = 1;
              else if (cm2 === 'on') d = -1;
            }
            list = cList; dir = d;
            cur = cList[(ci + d + cList.length) % cList.length];
          } else {
            cur = nextE;
          }
        } else {
          const c = nextE.inter ? 'on' : nextE.c;
          const leave = op === 'union' ? c !== 'out' : c !== 'in';
          if (leave) {
            const sEntry = cur.other;
            if (!sEntry) break;
            const si = idx(sList, sEntry);
            list = sList; dir = 1;
            cur = sList[(si + 1) % sList.length];
          } else {
            cur = nextE;
          }
        }
      } else {
        cur = nextE;
      }
      if (cur === start && list === sList) break;
    }
    const res = [];
    for (const p of result) {
      const last = res[res.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > POLY_EPS) res.push(p);
    }
    if (res.length > 1 && Math.hypot(res[0][0] - res[res.length - 1][0], res[0][1] - res[res.length - 1][1]) <= POLY_EPS) res.pop();
    return res.length >= 3 ? res : null;
  }

  // --------------------------------------------------------------------------
  // Rasterizer
  // --------------------------------------------------------------------------

  function setPx(buf, w, x, y, rgb, track) {
    if (x < 0 || y < 0 || x >= w || y >= buf.length / (4 * w)) return;
    const i = (y * w + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
    if (track) {
      if (x < track.minX) track.minX = x;
      if (x > track.maxX) track.maxX = x;
      if (y < track.minY) track.minY = y;
      if (y > track.maxY) track.maxY = y;
    }
  }

  function fillRect(buf, w, h, x, y, rw, rh, rgb, track) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(w - 1, Math.ceil(x + rw) - 1), y1 = Math.min(h - 1, Math.ceil(y + rh) - 1);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) setPx(buf, w, xx, yy, rgb, track);
  }

  function fillEllipse(buf, w, h, cx, cy, rx, ry, rgb, track) {
    if (rx < 1 || ry < 1) { setPx(buf, w, Math.round(cx), Math.round(cy), rgb, track); return; }
    const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
    const rxs = rx * rx, rys = ry * ry;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if ((dx * dx) / rxs + (dy * dy) / rys <= 1) setPx(buf, w, x, y, rgb, track);
      }
    }
  }

  function drawLine(buf, w, h, x0, y0, x1, y1, rgb, track) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, e2;
    for (;;) {
      setPx(buf, w, x0, y0, rgb, track);
      if (x0 === x1 && y0 === y1) break;
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function fillPoly(buf, w, h, pts, rgb, track) {
    if (!pts || pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a[1] !== b[1]) edges.push([a, b]); // skip horizontal edges
    }
    if (!edges.length) return;
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (const [a, b] of edges) {
        const y1 = a[1], y2 = b[1];
        if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
          xs.push(a[0] + ((y - y1) * (b[0] - a[0])) / (y2 - y1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.max(0, Math.ceil(xs[i]));
        const x1 = Math.min(w - 1, Math.floor(xs[i + 1]));
        for (let x = x0; x <= x1; x++) setPx(buf, w, x, y, rgb, track);
      }
    }
  }

  function outlinePoly(buf, w, h, pts, rgb, track) {
    if (!pts || pts.length < 2) return;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      drawLine(buf, w, h, a[0], a[1], b[0], b[1], rgb, track);
    }
  }

  /** sampleCatmullRom(pts, closed) -> uniform Catmull-Rom samples through pts (~1px spacing). */
  function sampleCatmullRom(pts, closed) {
    const n = pts.length;
    const at = function (i) {
      if (closed) return pts[((i % n) + n) % n];
      return pts[Math.max(0, Math.min(n - 1, i))];
    };
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    out.push(at(segs));
    return out;
  }

  function rasterize(scene) {
    const size = scene.size || 64;
    const buf = new Uint8Array(size * size * 4); // transparent by default
    let skipCount = 0;
    const layerBBoxes = {};
    for (const layer of scene.layers || []) {
      const rgb = resolveColor(scene, layer.color);
      if (!rgb) { skipCount++; continue; }
      // Bbox of what this layer painted (pre-overwrite), for placement verification.
      const track = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      switch (layer.type) {
        case 'fill':
          fillRect(buf, size, size, 0, 0, size, size, rgb, track);
          break;
        case 'rect':
          fillRect(buf, size, size, layer.x, layer.y, layer.w, layer.h, rgb, track);
          break;
        case 'rectout': {
          const t = layer.t || 1;
          for (let i = 0; i < t; i++) {
            const x = layer.x + i, y = layer.y + i, rw = layer.w - i * 2, rh = layer.h - i * 2;
            drawLine(buf, size, size, x, y, x + rw - 1, y, rgb, track);
            drawLine(buf, size, size, x, y + rh - 1, x + rw - 1, y + rh - 1, rgb, track);
            drawLine(buf, size, size, x, y, x, y + rh - 1, rgb, track);
            drawLine(buf, size, size, x + rw - 1, y, x + rw - 1, y + rh - 1, rgb, track);
          }
          break;
        }
        case 'ellipse':
          fillEllipse(buf, size, size, layer.cx, layer.cy, layer.rx, layer.ry, rgb, track);
          break;
        case 'line':
          drawLine(buf, size, size, layer.x1, layer.y1, layer.x2, layer.y2, rgb, track);
          break;
        case 'poly':
          fillPoly(buf, size, size, layer.points, rgb, track);
          break;
        case 'polyout':
          outlinePoly(buf, size, size, layer.points, rgb, track);
          break;
        case 'curve':
          if (layer.points && layer.points.length >= 2) {
            fillPoly(buf, size, size, sampleCatmullRom(layer.points, !!layer.closed), rgb, track);
          }
          break;
        default:
          skipCount++;
      }
      if (track.minX !== Infinity && layer.id) {
        layerBBoxes[layer.id] = [track.minX, track.minY, track.maxX - track.minX + 1, track.maxY - track.minY + 1];
      }
    }
    for (const key of Object.keys(scene.pixels || {})) {
      const rgb = resolveColor(scene, scene.pixels[key]);
      const m = /^(-?\d+),(-?\d+)$/.exec(key);
      if (!m || !rgb) continue;
      const x = parseInt(m[1], 10), y = parseInt(m[2], 10);
      setPx(buf, size, x, y, rgb);
    }
    scene._skipCount = skipCount;
    scene._layerBBoxes = layerBBoxes;
    return buf;
  }

  // --------------------------------------------------------------------------
  // render / inspect
  // --------------------------------------------------------------------------

  /** render(scene) -> { width, height, data: Uint8Array (RGBA) } */
  function render(scene) {
    const buf = rasterize(scene);
    return { width: scene.size, height: scene.size, data: buf };
  }

  /** inspect(scene) -> summary stats: layer count, override count, per-color counts + bounding boxes. */
  function inspect(scene) {
    const buf = rasterize(scene);
    const size = scene.size;
    const colors = new Map(); // hex -> {count, minX, maxX, minY, maxY}
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (buf[i + 3] === 0) continue;
        const hex = hexOf([buf[i], buf[i + 1], buf[i + 2]]);
        let rec = colors.get(hex);
        if (!rec) { rec = { hex: hex, count: 0, minX: x, maxX: x, minY: y, maxY: y }; colors.set(hex, rec); }
        rec.count++;
        if (x < rec.minX) rec.minX = x;
        if (x > rec.maxX) rec.maxX = x;
        if (y < rec.minY) rec.minY = y;
        if (y > rec.maxY) rec.maxY = y;
      }
    }
    const list = Array.from(colors.values())
      .map(function (c) {
        return { color: c.hex, count: c.count, bbox: [c.minX, c.minY, c.maxX - c.minX + 1, c.maxY - c.minY + 1] };
      })
      .sort(function (a, b) { return b.count - a.count; });
    const nameOf = {};
    const palette = scene.palette || {};
    for (const key of Object.keys(palette)) {
      const hex = hexOf(parseHex(palette[key]));
      if (hex) nameOf[hex] = key;
    }
    return {
      size: size,
      layers: (scene.layers || []).length,
      pixelOverrides: Object.keys(scene.pixels || {}).length,
      skippedLayers: scene._skipCount || 0,
      layerBBoxes: scene._layerBBoxes || {},
      colors: list.map(function (c) { return { name: nameOf[c.color] || null, color: c.color, count: c.count, bbox: c.bbox }; })
    };
  }

  // --------------------------------------------------------------------------
  // read_region — ASCII inspection (the LLM's "eyes")
  // --------------------------------------------------------------------------

  const AUTO_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  function charFor(name, used) {
    const clean = String(name).replace(/[^a-zA-Z0-9]/g, '');
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i].toUpperCase();
      if (!used.has(c)) { used.add(c); return c; }
    }
    for (let i = 0; i < AUTO_CHARS.length; i++) {
      const c = AUTO_CHARS[i];
      if (!used.has(c)) { used.add(c); return c; }
    }
    return '?';
  }

  /**
   * read_region(scene, x?, y?, w?, h?, opts?) -> ASCII map of the region.
   * opts: { scale?: 1|2|4|8  (default: auto so width <= 40 chars), mode?: 'ascii'|'counts' }
   * Returns string for ascii mode, or { colors: {hex: count} } for counts mode.
   */
  function read_region(scene, x, y, w, h, opts) {
    opts = opts || {};
    x = x || 0; y = y || 0;
    const size = scene.size;
    if (w === undefined) w = size - x;
    if (h === undefined) h = size - y;
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);

    if (opts.mode === 'counts') {
      const buf = rasterize(scene);
      const counts = {};
      for (let yy = Math.max(0, y); yy < y1; yy++) {
        for (let xx = Math.max(0, x); xx < x1; xx++) {
          const i = (yy * size + xx) * 4;
          if (buf[i + 3] === 0) { counts['.'] = (counts['.'] || 0) + 1; continue; }
          const hex = hexOf([buf[i], buf[i + 1], buf[i + 2]]);
          counts[hex] = (counts[hex] || 0) + 1;
        }
      }
      return { region: [x, y, x1 - x, y1 - y], colors: counts };
    }

    let scale = opts.scale || 0;
    if (!scale) {
      const widthChars = Math.min(x1, size) - Math.max(0, x);
      scale = widthChars <= 40 ? 1 : widthChars <= 80 ? 2 : widthChars <= 160 ? 4 : 8;
    }
    const buf = rasterize(scene);

    // Build char map: palette keys first, then any extra colors in the region.
    const used = new Set();
    const charMap = {};
    const palette = scene.palette || {};
    for (const key of Object.keys(palette)) {
      const rgb = parseHex(palette[key]);
      if (rgb) charMap[hexOf(rgb)] = charFor(key, used);
    }
    charMap['.'] = '.';

    const rows = [];
    const present = new Set(['.']);
    const cols = Math.max(0, Math.ceil((Math.min(x1, size) - Math.max(0, x)) / scale));
    const nRows = Math.max(0, Math.ceil((Math.min(y1, size) - Math.max(0, y)) / scale));
    for (let r = 0; r < nRows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const px = x + c * scale, py = y + r * scale;
        const i = (py * size + px) * 4;
        let hex = '.';
        if (buf[i + 3] !== 0) hex = hexOf([buf[i], buf[i + 1], buf[i + 2]]);
        if (!charMap[hex]) charMap[hex] = charFor('auto' + (Object.keys(charMap).length), used);
        line += charMap[hex];
        present.add(hex);
      }
      rows.push(line);
    }

    // Legend: only colors present in the region.
    const legend = [];
    const ordered = Object.keys(charMap).filter(function (h) { return present.has(h) && h !== '.'; });
    ordered.sort(function (a, b) {
      return Object.keys(palette).indexOf(nameOfKey(palette, a)) - Object.keys(palette).indexOf(nameOfKey(palette, b));
    });
    // Simpler deterministic order: palette order first, then others by char.
    const paletteHexes = {};
    for (const key of Object.keys(palette)) paletteHexes[hexOf(parseHex(palette[key]))] = key;
    ordered.sort(function (a, b) {
      const ka = paletteHexes[a] !== undefined ? 0 : 1, kb = paletteHexes[b] !== undefined ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const h of ordered) {
      legend.push(charMap[h] + '=' + (paletteHexes[h] || h) + ' ' + h);
    }
    if (present.has('.')) legend.push('.=transparent');

    const head = 'region x=' + x + ' y=' + y + ' w=' + (x1 - x) + ' h=' + (y1 - y) +
      ' scale=' + scale + ' (' + cols + 'x' + nRows + ')';
    return head + '\n' + rows.join('\n') + (legend.length ? '\nlegend: ' + legend.join('  ') : '');
  }

  function nameOfKey(palette, hex) {
    for (const key of Object.keys(palette)) {
      if (hexOf(parseHex(palette[key])) === hex) return key;
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // PNG encoding (fixed-Huffman DEFLATE — zero deps, works in browser and Node)
  // --------------------------------------------------------------------------

  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function joinBytes(arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // Fixed-Huffman DEFLATE (RFC 1951 §3.2.6) + greedy LZ77 matcher.
  // Zero deps, works in browser and Node. Pixel art has long flat runs, so
  // this compresses to a fraction of the stored-block size.

  const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  function deflateFixed(raw) {
    const n = raw.length;
    const head = new Int32Array(65536); // 1-entry hash chain over 3-byte sequences
    head.fill(-1);
    const out = [];
    let acc = 0, nbits = 0;
    function pushBit(bit) {
      acc |= bit << nbits;
      if (++nbits === 8) { out.push(acc); acc = 0; nbits = 0; }
    }
    function writeHuffman(code, bits) {
      for (let i = bits - 1; i >= 0; i--) pushBit((code >> i) & 1);
    }
    function writeExtra(value, bits) {
      for (let i = 0; i < bits; i++) pushBit((value >> i) & 1);
    }
    function fixedLitCode(lit) {
      if (lit <= 143) return [0x30 + lit, 8];
      if (lit <= 255) return [0x190 + (lit - 144), 9];
      if (lit <= 279) return [lit - 256, 7];
      return [0xC0 + (lit - 280), 8];
    }
    function fixedLenCode(code) {
      if (code <= 279) return [code - 256, 7];
      return [0xC0 + (code - 280), 8];
    }
    // Block header: BFINAL=1, BTYPE=01 (fixed Huffman), bits LSB-first.
    writeExtra(1, 1);
    writeExtra(1, 2);
    const MAX_MATCH = 258, MAX_DIST = 32768;
    let i = 0;
    while (i < n) {
      let bestLen = 0, bestDist = 0;
      if (i + 2 < n) {
        const h = ((raw[i] << 8) ^ (raw[i + 1] << 4) ^ raw[i + 2]) & 0xFFFF;
        const pos = head[h];
        if (pos !== -1 && i - pos <= MAX_DIST) {
          let len = 0;
          while (len < MAX_MATCH && i + len < n && raw[pos + len] === raw[i + len]) len++;
          if (len >= 3) { bestLen = len; bestDist = i - pos; }
        }
        head[h] = i;
      }
      if (bestLen >= 3) {
        let lc = 0;
        while (lc < LENGTH_BASE.length - 1 && bestLen >= LENGTH_BASE[lc + 1]) lc++;
        const c = fixedLenCode(257 + lc);
        writeHuffman(c[0], c[1]);
        writeExtra(bestLen - LENGTH_BASE[lc], LENGTH_EXTRA[lc]);
        let dc = 0;
        while (dc < DIST_BASE.length - 1 && bestDist >= DIST_BASE[dc + 1]) dc++;
        writeHuffman(dc, 5);
        writeExtra(bestDist - DIST_BASE[dc], DIST_EXTRA[dc]);
        i += bestLen;
      } else {
        const c = fixedLitCode(raw[i]);
        writeHuffman(c[0], c[1]);
        i++;
      }
    }
    writeHuffman(0, 7); // EOB (literal/length code 256)
    if (nbits > 0) out.push(acc);
    return new Uint8Array(out);
  }

  /**
   * deflateStream(raw) — ZLIB wrapper: CMF/FLG header (2 bytes) + deflate
   * blocks + ADLER32 trailer (4 bytes, BE).
   */
  function deflateStream(raw) {
    let a = 1, b = 0;
    for (let i = 0; i < raw.length; i++) {
      a = (a + raw[i]) % 65521;
      b = (b + a) % 65521;
    }
    const adler = new Uint8Array(4);
    new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
    // CMF=0x78 (deflate, 32K window), FLG=0x01 (0x7801 % 31 === 0)
    return joinBytes([new Uint8Array([0x78, 0x01]), deflateFixed(raw), adler]);
  }

  /** encode_png_buffer(rgba, width, height) -> Uint8Array of PNG bytes for an arbitrary RGBA buffer. */
  function encode_png_buffer(rgba, width, height) {
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    const stride = width * 4 + 1;
    const raw = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      raw[y * stride] = 0; // filter: none
      raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
    }

    return joinBytes([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateStream(raw)),
      chunk('IEND', new Uint8Array(0))
    ]);
  }

  /**
   * encode_apng_buffer(frames, width, height, opts?) -> Uint8Array of APNG bytes.
   * frames: array of RGBA buffers (each width*height*4). opts: { fps?, loop? }
   * (fps default 8, loop default 0 = infinite). Structure: acTL after IHDR,
   * fcTL before every frame, IDAT for frame 1, fdAT for frames 2+ (fcTL and
   * fdAT share one sequence counter). Every frame is a full image, so
   * dispose_op = 0 (none) and blend_op = 0 (source).
   */
  function encode_apng_buffer(frames, width, height, opts) {
    opts = opts || {};
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('cannot encode apng: no frames');
    }
    const fps = opts.fps || 8;
    const loop = opts.loop === undefined ? 0 : opts.loop;
    if (!Number.isInteger(fps) || fps <= 0) {
      throw new Error('fps must be a positive integer (got ' + fps + ')');
    }
    if (!Number.isInteger(loop) || loop < 0) {
      throw new Error('loop must be a non-negative integer (got ' + loop + ')');
    }

    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    const actl = new Uint8Array(8);
    const adv = new DataView(actl.buffer);
    adv.setUint32(0, frames.length);
    adv.setUint32(4, loop);

    const stride = width * 4 + 1;
    const raw = new Uint8Array(stride * height);
    const parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('acTL', actl)
    ];
    let seq = 0;
    frames.forEach(function (frame, i) {
      for (let y = 0; y < height; y++) {
        raw[y * stride] = 0; // filter: none
        raw.set(frame.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
      }
      const fctl = new Uint8Array(26);
      const fdv = new DataView(fctl.buffer);
      fdv.setUint32(0, seq++);
      fdv.setUint32(4, width);
      fdv.setUint32(8, height);
      fdv.setUint32(12, 0); // x offset
      fdv.setUint32(16, 0); // y offset
      fdv.setUint16(20, 1); // delay_num
      fdv.setUint16(22, fps); // delay_den (delay = 1/fps seconds)
      fctl[24] = 0; // dispose_op: none
      fctl[25] = 0; // blend_op: source
      parts.push(chunk('fcTL', fctl));
      if (i === 0) {
        parts.push(chunk('IDAT', deflateStream(raw)));
      } else {
        const stream = deflateStream(raw);
        const fdat = new Uint8Array(4 + stream.length);
        new DataView(fdat.buffer).setUint32(0, seq++);
        fdat.set(stream, 4);
        parts.push(chunk('fdAT', fdat));
      }
    });
    parts.push(chunk('IEND', new Uint8Array(0)));
    return joinBytes(parts);
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  /**
   * decode_png(bytes) -> { width, height, rgba } — PNG import.
   * Node backend uses built-in zlib.inflateSync (zero-dep). Supports 8-bit
   * RGB (color type 2), RGBA (6), and palette (3, with optional tRNS alpha);
   * all five filter types are reconstructed; chunk CRCs are validated.
   * Other bit depths, interlacing, and non-PNG input raise clean errors.
   * Browser (no zlib) raises a clear error in v1.
   */
  function decode_png(bytes) {
    if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
      throw new Error('decode_png requires Node.js (zlib) in v1; browser decode is not implemented yet');
    }
    const zlib = require('zlib');
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (buf.length < 8 || sig.some(function (v, i) { return buf[i] !== v; })) {
      throw new Error('decode_png: not a PNG (bad signature)');
    }
    let off = 8;
    let ihdr = null, plte = null, trns = null;
    const idat = [];
    while (off < buf.length) {
      if (off + 8 > buf.length) throw new Error('decode_png: truncated chunk header');
      const len = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
      const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
      if (off + 12 + len > buf.length) throw new Error('decode_png: truncated chunk ' + type);
      const data = buf.subarray(off + 8, off + 8 + len);
      const crcInput = new Uint8Array(4 + len);
      crcInput.set(buf.subarray(off + 4, off + 8), 0);
      crcInput.set(data, 4);
      const stored = ((buf[off + 8 + len] << 24) | (buf[off + 9 + len] << 16) |
        (buf[off + 10 + len] << 8) | buf[off + 11 + len]) >>> 0;
      if (crc32(crcInput) !== stored) throw new Error('decode_png: corrupt chunk CRC (' + type + ')');
      if (type === 'IHDR') ihdr = data;
      else if (type === 'PLTE') plte = data;
      else if (type === 'tRNS') trns = data;
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      off += 12 + len;
    }
    if (!ihdr) throw new Error('decode_png: missing IHDR');
    if (ihdr.length !== 13) throw new Error('decode_png: bad IHDR');
    const width = (ihdr[0] << 24) | (ihdr[1] << 16) | (ihdr[2] << 8) | ihdr[3];
    const height = (ihdr[4] << 24) | (ihdr[5] << 16) | (ihdr[6] << 8) | ihdr[7];
    const bitDepth = ihdr[8];
    const colorType = ihdr[9];
    if (ihdr[10] !== 0) throw new Error('decode_png: unsupported compression method');
    if (ihdr[11] !== 0) throw new Error('decode_png: unsupported filter method');
    if (ihdr[12] !== 0) throw new Error('decode_png: interlaced PNG not supported');
    if (bitDepth !== 8) throw new Error('decode_png: unsupported bit depth ' + bitDepth + ' (only 8-bit)');
    if (colorType !== 2 && colorType !== 6 && colorType !== 3) {
      throw new Error('decode_png: unsupported color type ' + colorType + ' (only RGB, RGBA, palette)');
    }
    if (colorType === 3 && !plte) throw new Error('decode_png: palette image without PLTE');
    if (trns && colorType !== 3) throw new Error('decode_png: tRNS only supported for palette images');
    if (idat.length === 0) throw new Error('decode_png: missing IDAT');
    let raw;
    try {
      raw = zlib.inflateSync(Buffer.concat(idat.map(function (d) { return Buffer.from(d); })));
    } catch (e) {
      throw new Error('decode_png: corrupt compressed data');
    }
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    const stride = width * channels + 1;
    if (raw.length !== stride * height) {
      throw new Error('decode_png: corrupt image data (length mismatch)');
    }
    const rgba = new Uint8Array(width * height * 4);
    const prev = new Uint8Array(width * channels);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * stride];
      if (filter > 4) throw new Error('decode_png: corrupt image data (bad filter ' + filter + ')');
      const row = raw.subarray(y * stride + 1, (y + 1) * stride);
      const cur = new Uint8Array(width * channels);
      for (let x = 0; x < width * channels; x++) {
        const left = x >= channels ? cur[x - channels] : 0;
        const up = prev[x];
        const ul = x >= channels ? prev[x - channels] : 0;
        let v = row[x];
        if (filter === 1) v = (v + left) & 0xFF;
        else if (filter === 2) v = (v + up) & 0xFF;
        else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xFF;
        else if (filter === 4) v = (v + paeth(left, up, ul)) & 0xFF;
        cur[x] = v;
      }
      for (let x = 0; x < width; x++) {
        const s = x * channels, d = (y * width + x) * 4;
        if (colorType === 6) {
          rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = cur[s + 3];
        } else if (colorType === 2) {
          rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = 255;
        } else {
          const idx = cur[s];
          if (idx >= plte.length / 3) throw new Error('decode_png: palette index out of range');
          rgba[d] = plte[idx * 3]; rgba[d + 1] = plte[idx * 3 + 1]; rgba[d + 2] = plte[idx * 3 + 2];
          rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
        }
      }
      prev.set(cur);
    }
    return { width: width, height: height, rgba: rgba };
  }

  function totals(colors) {
    let rSum = 0, gSum = 0, bSum = 0, total = 0;
    for (let i = 0; i < colors.length; i++) {
      rSum += colors[i].r * colors[i].count;
      gSum += colors[i].g * colors[i].count;
      bSum += colors[i].b * colors[i].count;
      total += colors[i].count;
    }
    return { rSum: rSum, gSum: gSum, bSum: bSum, total: total };
  }

  function channelRange(colors) {
    let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      if (c.r < r0) r0 = c.r; if (c.r > r1) r1 = c.r;
      if (c.g < g0) g0 = c.g; if (c.g > g1) g1 = c.g;
      if (c.b < b0) b0 = c.b; if (c.b > b1) b1 = c.b;
    }
    const rr = r1 - r0, gg = g1 - g0, bb = b1 - b0;
    if (rr >= gg && rr >= bb) return { channel: 'r', range: rr };
    if (gg >= bb) return { channel: 'g', range: gg };
    return { channel: 'b', range: bb };
  }

  function medianCut(colors, maxColors) {
    const boxes = [{ colors: colors, sums: totals(colors) }];
    while (boxes.length < maxColors) {
      let best = -1, bestRange = -1;
      for (let i = 0; i < boxes.length; i++) {
        const range = channelRange(boxes[i].colors).range;
        if (range > bestRange) { bestRange = range; best = i; }
      }
      if (bestRange === 0) break;
      const box = boxes[best];
      const ch = channelRange(box.colors).channel;
      const sorted = box.colors.slice().sort(function (a, b) { return a[ch] - b[ch]; });
      const half = box.sums.total / 2;
      let splitAt = sorted.length - 1;
      let acc = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        acc += sorted[i].count;
        if (acc >= half) { splitAt = i + 1; break; }
      }
      const left = sorted.slice(0, splitAt);
      const right = sorted.slice(splitAt);
      boxes.splice(best, 1, { colors: left, sums: totals(left) }, { colors: right, sums: totals(right) });
    }
    return boxes;
  }

  /** quantize_palette(rgba, maxColors?) -> { palette, indices }.
   * rgba: RGBA buffer (4 bytes/pixel). palette: hex strings (<= maxColors, default 16);
   * indices: per-pixel palette index, -1 for fully transparent pixels.
   * Exact palette when unique colors fit; median-cut otherwise. */
  function quantize_palette(rgba, maxColors) {
    if (maxColors === undefined) maxColors = 16;
    if (!Number.isInteger(maxColors) || maxColors < 1) {
      throw new Error('quantize_palette: maxColors must be a positive integer');
    }
    const n = rgba.length / 4;
    if (!Number.isInteger(n)) throw new Error('quantize_palette: rgba length must be a multiple of 4');
    const counts = new Map();
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] === 0) continue;
      const key = rgba[i * 4] + ',' + rgba[i * 4 + 1] + ',' + rgba[i * 4 + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const colors = [];
    counts.forEach(function (count, key) {
      const p = key.split(',');
      colors.push({ r: +p[0], g: +p[1], b: +p[2], count: count });
    });
    colors.sort(function (a, b) { return a.r - b.r || a.g - b.g || a.b - b.b; });
    const indices = new Int32Array(n);
    if (colors.length === 0) {
      indices.fill(-1);
      return { palette: [], indices: indices };
    }
    let palRgb;
    if (colors.length <= maxColors) {
      palRgb = colors.map(function (c) { return [c.r, c.g, c.b]; });
    } else {
      palRgb = medianCut(colors, maxColors).map(function (box) {
        return [Math.round(box.sums.rSum / box.sums.total),
                Math.round(box.sums.gSum / box.sums.total),
                Math.round(box.sums.bSum / box.sums.total)];
      });
    }
    const palette = palRgb.map(hexOf);
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] === 0) { indices[i] = -1; continue; }
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      let best = 0, bestD = Infinity;
      for (let p = 0; p < palRgb.length; p++) {
        const dr = r - palRgb[p][0], dg = g - palRgb[p][1], db = b - palRgb[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; }
      }
      indices[i] = best;
    }
    return { palette: palette, indices: indices };
  }

  function colorResolvable(palette, color) {
    if (parseHex(color)) return true;
    return !!palette && typeof palette === 'object' && !Array.isArray(palette) &&
      Object.prototype.hasOwnProperty.call(palette, color);
  }

  /** validate_scene(scene) -> { valid, errors[] }.
   * Checks size (ladder), palette (5-12 keys, valid hex), layers (known types,
   * valid params, in-bounds), pixels (valid keys, in-bounds). Every invalid
   * case reports its specific error; all errors are collected, not stopped at. */
  function validate_scene(scene) {
    const errors = [];
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      return { valid: false, errors: ['scene must be an object'] };
    }
    const size = scene.size;
    const sizeOk = Number.isInteger(size) && size >= 1;
    if (!sizeOk) {
      errors.push('size must be a positive integer');
    } else if ([16, 32, 64, 128, 256].indexOf(size) === -1) {
      errors.push('size must be one of the ladder sizes: 16, 32, 64, 128, 256 (got ' + size + ')');
    }
    const palette = scene.palette;
    const paletteOk = !!palette && typeof palette === 'object' && !Array.isArray(palette);
    if (!paletteOk) {
      errors.push('palette must be an object');
    } else {
      const keys = Object.keys(palette);
      if (keys.length < 5 || keys.length > 12) {
        errors.push('palette must have 5-12 entries (got ' + keys.length + ')');
      }
      for (const key of keys) {
        if (typeof key !== 'string' || key.length === 0) {
          errors.push('palette key must be a non-empty string');
        } else {
          const hex = palette[key];
          if (typeof hex !== 'string' || !/^#?[0-9a-fA-F]{3}$/.test(hex) && !/^#?[0-9a-fA-F]{6}$/.test(hex)) {
            errors.push('palette entry "' + key + '" has invalid color "' + hex + '"');
          }
        }
      }
    }
    const layers = scene.layers;
    if (layers !== undefined && !Array.isArray(layers)) {
      errors.push('layers must be an array');
    } else {
      let knownTypes = ['fill', 'rect', 'rectout', 'ellipse', 'line', 'poly', 'polyout', 'curve'];
      try { const reg = typeof require !== 'undefined' ? require('./layer-registry.js') : null; if (reg && reg.listTypes) knownTypes = reg.listTypes(); } catch (_) {}
      (layers || []).forEach(function (layer, i) {
        const label = 'layer ' + i;
        if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
          errors.push(label + ' must be an object');
          return;
        }
        const type = layer.type;
        if (typeof type !== 'string' || knownTypes.indexOf(type) === -1) {
          errors.push(label + ' has unknown type "' + type + '"');
          return;
        }
        if (paletteOk && (typeof layer.color !== 'string' || !colorResolvable(palette, layer.color))) {
          errors.push(label + ' (' + type + ') has unknown color "' + layer.color + '"');
        }
        if (type === 'rect' || type === 'rectout') {
          if (!Number.isFinite(layer.x) || !Number.isFinite(layer.y) ||
              !Number.isFinite(layer.w) || !Number.isFinite(layer.h)) {
            errors.push(label + ' (' + type + ') x/y/w/h must be numbers');
          } else {
            if (layer.w < 1) errors.push(label + ' (' + type + ') w must be >= 1');
            if (layer.h < 1) errors.push(label + ' (' + type + ') h must be >= 1');
            if (sizeOk) {
              if (layer.x < 0 || layer.y < 0) errors.push(label + ' (' + type + ') x/y must be >= 0');
              if (layer.x + layer.w > size || layer.y + layer.h > size) {
                errors.push(label + ' (' + type + ') x + w / y + h exceed size ' + size);
              }
            }
          }
          if (type === 'rectout' && layer.t !== undefined &&
              (!Number.isInteger(layer.t) || layer.t < 1)) {
            errors.push(label + ' (rectout) t must be a positive integer');
          }
        } else if (type === 'ellipse') {
          if (!Number.isFinite(layer.cx) || !Number.isFinite(layer.cy) ||
              !Number.isFinite(layer.rx) || !Number.isFinite(layer.ry)) {
            errors.push(label + ' (ellipse) cx/cy/rx/ry must be numbers');
          } else {
            if (layer.rx < 1) errors.push(label + ' (ellipse) rx must be >= 1');
            if (layer.ry < 1) errors.push(label + ' (ellipse) ry must be >= 1');
            if (sizeOk && (layer.cx - layer.rx < 0 || layer.cy - layer.ry < 0 ||
                           layer.cx + layer.rx >= size || layer.cy + layer.ry >= size)) {
              errors.push(label + ' (ellipse) ellipse out of bounds for size ' + size);
            }
          }
        } else if (type === 'line') {
          for (const p of ['x1', 'y1', 'x2', 'y2']) {
            if (!Number.isFinite(layer[p])) errors.push(label + ' (line) ' + p + ' must be a number');
          }
          if (sizeOk && [layer.x1, layer.y1, layer.x2, layer.y2].every(Number.isFinite) &&
              [layer.x1, layer.y1, layer.x2, layer.y2].some(function (v) { return v < 0 || v >= size; })) {
            errors.push(label + ' (line) endpoints out of bounds for size ' + size);
          }
        } else if (type === 'poly' || type === 'polyout' || type === 'curve') {
          const pts = layer.points;
          const minPts = type === 'curve' ? 2 : 3;
          if (!Array.isArray(pts) || pts.length < minPts) {
            errors.push(label + ' (' + type + ') points must be an array of at least ' + minPts + ' [x, y] pairs');
          } else {
            pts.forEach(function (pt, pi) {
              if (!Array.isArray(pt) || pt.length < 2 ||
                  !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
                errors.push(label + ' (' + type + ') point ' + pi + ' must be an [x, y] pair of numbers');
              } else if (sizeOk && (pt[0] < 0 || pt[0] >= size || pt[1] < 0 || pt[1] >= size)) {
                errors.push(label + ' (' + type + ') point ' + pi + ' out of bounds for size ' + size);
              }
            });
          }
          if (type === 'curve' && layer.closed !== undefined && typeof layer.closed !== 'boolean') {
            errors.push(label + ' (curve) closed must be a boolean');
          }
        }
      });
    }
    const pixels = scene.pixels;
    if (pixels !== undefined && (typeof pixels !== 'object' || Array.isArray(pixels))) {
      errors.push('pixels must be an object');
    } else if (pixels) {
      for (const key of Object.keys(pixels)) {
        const m = /^(-?\d+),(-?\d+)$/.exec(key);
        if (!m) {
          errors.push('pixel key "' + key + '" must be "x,y"');
          continue;
        }
        const x = parseInt(m[1], 10), y = parseInt(m[2], 10);
        if (sizeOk && (x < 0 || x >= size || y < 0 || y >= size)) {
          errors.push('pixel "' + key + '" is out of bounds for size ' + size);
        }
        const v = pixels[key];
        if (paletteOk && v !== null && (typeof v !== 'string' || !colorResolvable(palette, v))) {
          errors.push('pixel "' + key + '" has invalid value "' + v + '"');
        }
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // --------------------------------------------------------------------------
  // Phase 3 — agent-loop tools (better "eyes")
  // --------------------------------------------------------------------------

  /** diff_scenes(a, b) -> { changed, unchanged, pct, bbox, changes[], ...aliases }
   * Compares two scene documents on their resolved RGBA buffers.
   * Same shape as diff_frames but for scenes: bbox = [x,y,w,h] or null.
   * Different sizes -> error; identical -> 0 changed, null bbox. */
  function diff_scenes(a, b) {
    if (!a || !b || typeof a.size !== 'number' || typeof b.size !== 'number') {
      throw new Error('diff_scenes: both scenes must have a size');
    }
    if (a.size !== b.size) {
      throw new Error('diff_scenes: size mismatch (' + a.size + ' vs ' + b.size + ')');
    }
    const w = a.size, h = a.size;
    const bufA = rasterize(a);
    const bufB = rasterize(b);
    const total = w * h;
    const changes = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const same = bufA[i] === bufB[i] && bufA[i + 1] === bufB[i + 1] && bufA[i + 2] === bufB[i + 2] && bufA[i + 3] === bufB[i + 3];
        if (same) continue;
        const oldVal = bufA[i + 3] === 0 ? null : hexOf([bufA[i], bufA[i + 1], bufA[i + 2]]);
        const newVal = bufB[i + 3] === 0 ? null : hexOf([bufB[i], bufB[i + 1], bufB[i + 2]]);
        changes.push({ x: x, y: y, old_value: oldVal, new_value: newVal });
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const changed = changes.length;
    const bbox = changed ? [minX, minY, maxX - minX + 1, maxY - minY + 1] : null;
    const pct = Math.round((changed / total) * 10000) / 100;
    return {
      changed: changed,
      unchanged: total - changed,
      pct: pct,
      bbox: bbox,
      changes: changes,
      width: w,
      height: h,
      changed_pixels: changed,
      unchanged_pixels: total - changed,
      change_percentage: pct,
      bounding_box: bbox
    };
  }

  /** replace_color_region(scene, x, y, w, h, from, to) -> { replaced }
   * Buffer-level recolor limited to the region (clamped). Writes pixel overrides.
   * from/to may be palette keys or hex strings. Region empty or from===to -> no-op. */
  function replace_color_region(scene, x, y, w, h, from, to) {
    if (!(w > 0 && h > 0)) return { replaced: 0 };
    if (from === to) return { replaced: 0 };
    if (typeof from === 'string' && typeof to === 'string' && from[0] === '#' && to[0] === '#') {
      const fh = parseHex(from), th = parseHex(to);
      if (fh && th && hexOf(fh) === hexOf(th)) return { replaced: 0 };
    }
    const size = scene.size;
    const fromRgb = resolveColor(scene, from);
    const toStr = to;
    if (!toStr) return { replaced: 0 };
    if (!resolveColor(scene, toStr) && !parseHex(toStr)) {
      if (typeof toStr === 'string' && !Object.prototype.hasOwnProperty.call(scene.palette || {}, toStr)) {
        throw new Error('replace_color_region: unknown target color: ' + to);
      }
    }
    const buf = rasterize(scene);
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    if (x0 >= x1 || y0 >= y1) return { replaced: 0 };
    let replaced = 0;
    const fromIsTransparent = fromRgb === null;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * size + xx) * 4;
        const a = buf[i + 3];
        const isFrom = fromIsTransparent ? a === 0 : (a !== 0 && buf[i] === fromRgb[0] && buf[i + 1] === fromRgb[1] && buf[i + 2] === fromRgb[2]);
        if (isFrom) {
          set_pixel(scene, xx, yy, toStr);
          replaced++;
        }
      }
    }
    return { replaced: replaced };
  }

  /** measure_distance(x1, y1, x2, y2) -> Euclidean distance (float). */
  function measure_distance(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    return Math.hypot(dx, dy);
  }

  /** check_symmetry(scene, axis, region?) -> { symmetric, diffCount, diffPixels[] }
   * Compares the region against its mirror on the resolved buffer.
   * axis 'h' mirrors left<->right across region centerline; 'v' top<->bottom.
   * Odd widths: center column/row maps to itself and is skipped.
   * Empty region -> symmetric vacuously. */
  function check_symmetry(scene, axis, region) {
    if (axis !== 'h' && axis !== 'v') {
      throw new Error("check_symmetry: axis must be 'h' or 'v', got: " + axis);
    }
    const size = scene.size;
    const rx = region && region.x !== undefined ? region.x : 0;
    const ry = region && region.y !== undefined ? region.y : 0;
    const rw = region ? region.w : size;
    const rh = region ? region.h : size;
    if (!(rw > 0 && rh > 0)) return { symmetric: true, diffCount: 0, diffPixels: [] };
    const buf = rasterize(scene);
    const x0 = Math.max(0, rx), y0 = Math.max(0, ry);
    const x1 = Math.min(size, rx + rw), y1 = Math.min(size, ry + rh);
    if (x0 >= x1 || y0 >= y1) return { symmetric: true, diffCount: 0, diffPixels: [] };
    const w = rw, h = rh;
    const diffPixels = [];
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const mx = axis === 'h' ? rx + (w - 1) - (xx - rx) : xx;
        const my = axis === 'v' ? ry + (h - 1) - (yy - ry) : yy;
        if (mx === xx && my === yy) continue;
        if (mx < x0 || mx >= x1 || my < y0 || my >= y1) continue;
        if (axis === 'h' && xx >= rx + Math.floor(w / 2)) continue;
        if (axis === 'v' && yy >= ry + Math.floor(h / 2)) continue;
        const i = (yy * size + xx) * 4;
        const j = (my * size + mx) * 4;
        const same = buf[i] === buf[j] && buf[i + 1] === buf[j + 1] && buf[i + 2] === buf[j + 2] && buf[i + 3] === buf[j + 3];
        if (!same) {
          const aHex = buf[i + 3] === 0 ? null : hexOf([buf[i], buf[i + 1], buf[i + 2]]);
          const bHex = buf[j + 3] === 0 ? null : hexOf([buf[j], buf[j + 1], buf[j + 2]]);
          diffPixels.push({ x: xx, y: yy, mx: mx, my: my, value: aHex, mirrorValue: bHex });
        }
      }
    }
    return { symmetric: diffPixels.length === 0, diffCount: diffPixels.length, diffPixels: diffPixels };
  }

  /** dither_region(scene, x, y, w, h, opts?) -> { dithered }
   * Ordered/Bayer dithering between two colors. Writes pixel overrides.
   * opts: { from, to, pattern? } default 4x4 Bayer at 50% mix.
   * When from===to or region empty -> no-op. Pattern is ignored in v1 (always Bayer 4x4);
   * horizontal gradient mode uses Bayer threshold vs x-fraction. */
  function dither_region(scene, x, y, w, h, opts) {
    opts = opts || {};
    const from = opts.from, to = opts.to;
    if (from === undefined || to === undefined) throw new Error('dither_region: opts.from and opts.to are required');
    if (!(w > 0 && h > 0)) return { dithered: 0 };
    const fromRgb = parseHex(from) || resolveColor(scene, from);
    const toRgb = parseHex(to) || resolveColor(scene, to);
    if (fromRgb && toRgb && fromRgb[0] === toRgb[0] && fromRgb[1] === toRgb[1] && fromRgb[2] === toRgb[2]) {
      return { dithered: 0 };
    }
    if (typeof from === 'string' && typeof to === 'string' && from === to) return { dithered: 0 };
    if (typeof from === 'string' && typeof to === 'string' && from[0] === '#' && to[0] === '#') {
      const fh = parseHex(from), th = parseHex(to);
      if (fh && th && hexOf(fh) === hexOf(th)) return { dithered: 0 };
    }
    const size = scene.size;
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    if (x0 >= x1 || y0 >= y1) return { dithered: 0 };
    const BAYER_4 = [
      0,  8,  2, 10,
      12, 4, 14, 6,
      3, 11, 1,  9,
      15, 7, 13, 5
    ];
    let dithered = 0;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const frac = w <= 1 ? 0.5 : (xx - x) / (w - 1);
        const pickTo = (BAYER_4[(yy % 4) * 4 + (xx % 4)] / 16) < frac;
        const color = pickTo ? to : from;
        set_pixel(scene, xx, yy, color);
        dithered++;
      }
    }
    return { dithered: dithered };
  }

  // --------------------------------------------------------------------------
  // Phase 5 — taste layer (reference comparison + craft checks)
  // --------------------------------------------------------------------------

  function scaleRgbaNearest(src, srcW, srcH, dstW, dstH) {
    const dst = new Uint8Array(dstW * dstH * 4);
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
        const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
        const si = (sy * srcW + sx) * 4;
        const di = (y * dstW + x) * 4;
        dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
      }
    }
    return dst;
  }

  /** compare_scene_to_reference(scene, refRgba, opts?) -> { silhouetteIoU, paletteDistance, histogramDistance, ... }
   * refRgba: Uint8Array RGBA or { width, height, rgba }. opts: { region?: {x,y,w,h} }.
   * Silhouette IoU is painted-vs-transparent overlap. Palette distance is per-key nearest-hex Euclidean average. Histogram distance is L1 over 16-bin value histogram of painted pixels. Size mismatch auto-scales reference to scene size. */
  function compare_scene_to_reference(scene, refRgba, opts) {
    opts = opts || {};
    const size = scene.size;
    if (!size) throw new Error('compare_scene_to_reference: scene must have a size');
    const sceneBuf = rasterize(scene);
    let ref = refRgba;
    let refW, refH, refBuf;
    if (ref && typeof ref === 'object' && !(ref instanceof Uint8Array) && (ref.rgba || ref.data)) {
      refW = ref.width || ref.w || ref.rgba && Math.sqrt(ref.rgba.length / 4) || Math.sqrt(ref.data.length / 4);
      refH = ref.height || ref.h || refW;
      refBuf = ref.rgba || ref.data;
      refBuf = refBuf instanceof Uint8Array ? refBuf : new Uint8Array(refBuf);
    } else if (ref instanceof Uint8Array) {
      refBuf = ref;
      const n = refBuf.length / 4;
      const sq = Math.sqrt(n);
      if (Number.isInteger(sq)) { refW = sq; refH = sq; }
      else if (opts.refWidth && opts.refHeight) { refW = opts.refWidth; refH = opts.refHeight; }
      else { refW = size; refH = size; }
    } else {
      throw new Error('compare_scene_to_reference: refRgba must be Uint8Array or { width, height, rgba }');
    }
    if (refW !== size || refH !== size) {
      refBuf = scaleRgbaNearest(refBuf, refW, refH, size, size);
      refW = size; refH = size;
    }
    const region = opts.region;
    const rx = region && region.x !== undefined ? region.x : 0;
    const ry = region && region.y !== undefined ? region.y : 0;
    const rw = region ? region.w : size;
    const rh = region ? region.h : size;
    const x0 = Math.max(0, rx), y0 = Math.max(0, ry);
    const x1 = Math.min(size, rx + rw), y1 = Math.min(size, ry + rh);
    let inter = 0, uni = 0;
    const refColors = new Map();
    const scenePaletteHexes = [];
    const palette = scene.palette || {};
    for (const k of Object.keys(palette)) {
      const rgb = parseHex(palette[k]);
      if (rgb) scenePaletteHexes.push({ key: k, rgb: rgb, hex: hexOf(rgb) });
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        const sA = sceneBuf[i + 3] !== 0;
        const rA = refBuf[i + 3] !== 0;
        if (sA || rA) uni++;
        if (sA && rA) inter++;
        if (rA) {
          const key = refBuf[i] + ',' + refBuf[i + 1] + ',' + refBuf[i + 2];
          refColors.set(key, [refBuf[i], refBuf[i + 1], refBuf[i + 2]]);
        }
      }
    }
    const silhouetteIoU = uni === 0 ? 1 : inter / uni;
    let paletteDistance = 0;
    const perKey = [];
    if (scenePaletteHexes.length && refColors.size) {
      const refList = Array.from(refColors.values());
      for (const e of scenePaletteHexes) {
        let best = Infinity;
        for (const c of refList) {
          const d = Math.hypot(e.rgb[0] - c[0], e.rgb[1] - c[1], e.rgb[2] - c[2]);
          if (d < best) best = d;
        }
        perKey.push({ key: e.key, hex: e.hex, distance: best });
        paletteDistance += best;
      }
      paletteDistance /= scenePaletteHexes.length;
    }
    const bins = 16;
    const hA = new Array(bins).fill(0), hB = new Array(bins).fill(0);
    let countA = 0, countB = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        if (sceneBuf[i + 3] !== 0) {
          const v = 0.299 * sceneBuf[i] + 0.587 * sceneBuf[i + 1] + 0.114 * sceneBuf[i + 2];
          hA[Math.min(bins - 1, Math.floor((v / 256) * bins))]++;
          countA++;
        }
        if (refBuf[i + 3] !== 0) {
          const v = 0.299 * refBuf[i] + 0.587 * refBuf[i + 1] + 0.114 * refBuf[i + 2];
          hB[Math.min(bins - 1, Math.floor((v / 256) * bins))]++;
          countB++;
        }
      }
    }
    if (countA) for (let i = 0; i < bins; i++) hA[i] /= countA;
    if (countB) for (let i = 0; i < bins; i++) hB[i] /= countB;
    let histogramDistance = 0;
    for (let i = 0; i < bins; i++) histogramDistance += Math.abs(hA[i] - hB[i]);
    histogramDistance /= 2;
    return {
      silhouetteIoU: silhouetteIoU,
      paletteDistance: paletteDistance,
      histogramDistance: histogramDistance,
      perKeyDistance: perKey,
      intersection: inter,
      union: uni,
      region: [x0, y0, x1 - x0, y1 - y0]
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return [h, s, v];
  }

  function familyOf(key) {
    const base = key.replace(/[A-Z].*$/, '').toLowerCase();
    if (!base) return key.toLowerCase();
    return base;
  }

  function groupPalette(palette) {
    const groups = {};
    for (const k of Object.keys(palette || {})) {
      const f = familyOf(k);
      if (!groups[f]) groups[f] = [];
      const rgb = parseHex(palette[k]);
      if (!rgb) continue;
      const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      groups[f].push({ key: k, hex: hexOf(rgb), rgb: rgb, hsv: hsv, v: hsv[2], h: hsv[0] });
    }
    for (const f of Object.keys(groups)) groups[f].sort(function (a, b) { return a.v - b.v; });
    return groups;
  }

  /** analyze_values(scene) -> { families: { family: { count, keys[] } }, totalFamilies, warnings[] } */
  function analyze_values(scene) {
    const palette = scene.palette || {};
    const groups = groupPalette(palette);
    const families = {};
    const warnings = [];
    for (const f of Object.keys(groups)) {
      const keys = groups[f].map(function (e) { return e.key; });
      families[f] = { count: keys.length, keys: keys };
      if (keys.length < 3) warnings.push(f + ': only ' + keys.length + ' value step(s) — expected 3-4');
      if (keys.length > 4) warnings.push(f + ': ' + keys.length + ' value steps — expected 3-4, consider merging');
    }
    return { families: families, totalFamilies: Object.keys(families).length, warnings: warnings };
  }

  /** check_hue_shift(palette) -> { results: [{ family, status, note }], pass } */
  function check_hue_shift(palette) {
    const groups = groupPalette(palette);
    const results = [];
    let pass = true;
    for (const f of Object.keys(groups)) {
      const arr = groups[f];
      if (arr.length < 2) {
        results.push({ family: f, status: 'PASS', note: 'single-key family — no shift possible' });
        continue;
      }
      if (arr.length < 3) {
        const dh = Math.min(Math.abs(arr[0].h - arr[1].h), 360 - Math.abs(arr[0].h - arr[1].h));
        if (dh < 5) {
          results.push({ family: f, status: 'FAIL', note: 'no hue shift between ' + arr[0].key + ' and ' + arr[1].key + ' (hue diff ' + dh.toFixed(1) + '°)' });
          pass = false;
        } else {
          results.push({ family: f, status: 'PASS', note: 'hue diff ' + dh.toFixed(1) + '°' });
        }
        continue;
      }
      const dark = arr[0], mid = arr[Math.floor(arr.length / 2)], light = arr[arr.length - 1];
      const dhDark = Math.min(Math.abs(dark.h - mid.h), 360 - Math.abs(dark.h - mid.h));
      const dhLight = Math.min(Math.abs(light.h - mid.h), 360 - Math.abs(light.h - mid.h));
      if (dhDark < 5 && dhLight < 5) {
        results.push({ family: f, status: 'FAIL', note: 'flat shading — no hue shift (dark ' + dhDark.toFixed(1) + '°, light ' + dhLight.toFixed(1) + '° from mid)' });
        pass = false;
      } else if (dhDark < 5) {
        results.push({ family: f, status: 'FAIL', note: 'shadow not hue-shifted (dark ' + dhDark.toFixed(1) + '° from mid, light ' + dhLight.toFixed(1) + '°)' });
        pass = false;
      } else if (dhLight < 5) {
        results.push({ family: f, status: 'FAIL', note: 'highlight not hue-shifted (light ' + dhLight.toFixed(1) + '° from mid, dark ' + dhDark.toFixed(1) + '°)' });
        pass = false;
      } else {
        results.push({ family: f, status: 'PASS', note: 'dark ' + dhDark.toFixed(1) + '°, light ' + dhLight.toFixed(1) + '° from mid' });
      }
    }
    return { results: results, pass: pass };
  }

  // --------------------------------------------------------------------------
  // Compact encoding + patch helpers (workflow token diet)
  // --------------------------------------------------------------------------

  let TYPE_TO_CODE, CODE_TO_TYPE;
  try {
    const reg = typeof require !== 'undefined' ? require('./layer-registry.js') : null;
    TYPE_TO_CODE = reg.TYPE_TO_CODE;
    CODE_TO_TYPE = reg.CODE_TO_TYPE;
  } catch (_) {
    TYPE_TO_CODE = { fill: 'f', rect: 'r', rectout: 'o', ellipse: 'e', line: 'n', poly: 'y', polyout: 'Y', curve: 'c' };
    CODE_TO_TYPE = { f: 'fill', r: 'rect', o: 'rectout', e: 'ellipse', n: 'line', y: 'poly', Y: 'polyout', c: 'curve' };
  }

  function encode_compact(scene) {
    const paletteKeys = Object.keys(scene.palette || {});
    const paletteVals = paletteKeys.map(function (k) { return scene.palette[k]; });
    const p = paletteKeys.map(function (k, i) { return [k, paletteVals[i]]; });
    const l = (scene.layers || []).map(function (layer) {
      const out = { t: TYPE_TO_CODE[layer.type] || layer.type, d: layer.id };
      const colorIdx = paletteKeys.indexOf(layer.color);
      out.c = colorIdx !== -1 ? colorIdx : layer.color;
      const pts = layer.points;
      if (pts) {
        out.a = pts.reduce(function (a, pt) { a.push(pt[0], pt[1]); return a; }, []);
        if (layer.type === 'curve' && layer.closed) out.a.push(1);
      } else if (layer.type === 'rect' || layer.type === 'rectout') out.a = [layer.x, layer.y, layer.w, layer.h].concat(layer.t !== undefined ? [layer.t] : []);
      else if (layer.type === 'ellipse') out.a = [layer.cx, layer.cy, layer.rx, layer.ry];
      else if (layer.type === 'line') out.a = [layer.x1, layer.y1, layer.x2, layer.y2];
      if (out.a && out.a.length === 0) delete out.a;
      return out;
    });
    const x = [];
    const pixels = scene.pixels || {};
    for (const k of Object.keys(pixels)) {
      const v = pixels[k];
      const parts = k.split(',');
      const px = parseInt(parts[0], 10), py = parseInt(parts[1], 10);
      if (v === null) x.push([px, py, null]);
      else {
        const idx = paletteKeys.indexOf(v);
        x.push([px, py, idx !== -1 ? idx : v]);
      }
    }
    return { s: scene.size, p: p, l: l, x: x };
  }

  function decode_compact(c) {
    const size = c.s;
    const p = c.p || [];
    const palette = {};
    p.forEach(function (pair) { palette[pair[0]] = pair[1]; });
    const paletteKeys = p.map(function (pair) { return pair[0]; });
    const layers = (c.l || []).map(function (cl) {
      const type = CODE_TO_TYPE[cl.t] || cl.t;
      const layer = { id: cl.d, type: type };
      const a = cl.a;
      if (a) {
        if (type === 'rect' || type === 'rectout') { layer.x = a[0]; layer.y = a[1]; layer.w = a[2]; layer.h = a[3]; if (a.length > 4) layer.t = a[4]; }
        else if (type === 'ellipse') { layer.cx = a[0]; layer.cy = a[1]; layer.rx = a[2]; layer.ry = a[3]; }
        else if (type === 'line') { layer.x1 = a[0]; layer.y1 = a[1]; layer.x2 = a[2]; layer.y2 = a[3]; }
        else if (type === 'poly' || type === 'polyout' || type === 'curve') {
          const pts = [];
          for (let i = 0; i < a.length; i += 2) {
            if (type === 'curve' && i === a.length - 1 && a.length % 2 === 1) { layer.closed = !!a[i]; break; }
            pts.push([a[i], a[i + 1]]);
          }
          layer.points = pts;
        }
      }
      const col = cl.c;
      layer.color = typeof col === 'number' ? paletteKeys[col] : col;
      return layer;
    });
    const pixels = {};
    (c.x || []).forEach(function (tri) {
      const k = tri[0] + ',' + tri[1];
      const v = tri[2];
      pixels[k] = v === null ? null : (typeof v === 'number' ? paletteKeys[v] : v);
    });
    return { size: size, palette: palette, layers: layers, pixels: pixels };
  }

  function get_patch(oldScene, newScene) {
    const patch = {};
    if (JSON.stringify(oldScene.palette) !== JSON.stringify(newScene.palette)) patch.p = newScene.palette;
    if (oldScene.size !== newScene.size) patch.s = newScene.size;
    const oldLayers = oldScene.layers || [], newLayers = newScene.layers || [];
    const layerDiff = [];
    const maxLen = Math.max(oldLayers.length, newLayers.length);
    for (let i = 0; i < maxLen; i++) {
      if (JSON.stringify(oldLayers[i]) !== JSON.stringify(newLayers[i])) layerDiff.push({ i: i, v: newLayers[i] === undefined ? null : newLayers[i] });
    }
    if (layerDiff.length) patch.l = layerDiff;
    const oldPixels = oldScene.pixels || {}, newPixels = newScene.pixels || {};
    const allKeys = new Set(Object.keys(oldPixels).concat(Object.keys(newPixels)));
    const pixelDiff = {};
    let pixelChanged = false;
    allKeys.forEach(function (k) {
      if (oldPixels[k] !== newPixels[k]) { pixelDiff[k] = newPixels[k] === undefined ? null : newPixels[k]; pixelChanged = true; }
    });
    if (pixelChanged) patch.x = pixelDiff;
    return patch;
  }

  function apply_patch(scene, patch) {
    if (patch.s !== undefined) scene.size = patch.s;
    if (patch.p !== undefined) scene.palette = patch.p;
    if (patch.l) {
      patch.l.forEach(function (e) {
        if (e.v === null) scene.layers.splice(e.i, 1);
        else if (e.i < scene.layers.length) scene.layers[e.i] = e.v;
        else scene.layers.push(e.v);
      });
    }
    if (patch.x) {
      if (!scene.pixels) scene.pixels = {};
      for (const k of Object.keys(patch.x)) {
        const v = patch.x[k];
        if (v === null && !(k in scene.pixels)) {
          // deletion of non-existent key: ensure key is absent (no-op if already absent)
          delete scene.pixels[k];
        } else if (v === null) {
          // deletion via null marker: delete the key if it exists, otherwise set null
          if (k in scene.pixels) delete scene.pixels[k];
          else scene.pixels[k] = null;
        } else {
          scene.pixels[k] = v;
        }
      }
    }
    return scene;
  }

  /** encode_png(scene) -> Uint8Array of PNG bytes. */
  function encode_png(scene) {
    const size = scene.size;
    return encode_png_buffer(rasterize(scene), size, size);
  }

  // --------------------------------------------------------------------------
  // export / HTML preview
  // --------------------------------------------------------------------------

  /** export_png(scene, path) — Node only. Writes PNG file. */
  function export_png(scene, path) {
    if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
      throw new Error('export_png requires Node.js');
    }
    const fs = require('fs');
    fs.writeFileSync(path, Buffer.from(encode_png(scene)));
  }

  /**
   * scene_to_html(scene, opts?) -> self-contained HTML preview string.
   * opts: { scale?: number (default 8), ascii?: bool, title?: string }
   * In Node, opts.path writes the file too.
   */
  function scene_to_html(scene, opts) {
    opts = opts || {};
    const scale = opts.scale || 8;
    const size = scene.size;
    const ascii = opts.ascii !== false;
    const title = opts.title || 'Pixel scene';
    const png = encode_png(scene);
    let b64 = '';
    if (typeof btoa === 'function') {
      let bin = '';
      for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
      b64 = btoa(bin);
    } else {
      b64 = Buffer.from(png).toString('base64');
    }
    const stats = inspect(scene);
    const asciiText = ascii ? read_region(scene) : '';
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>' +
      'body{font-family:ui-monospace,Consolas,monospace;background:#111;color:#ddd;margin:24px;}' +
      'h1{font-size:16px;color:#888;font-weight:400;}' +
      'canvas{image-rendering:pixelated;image-rendering:crisp-edges;border:1px solid #333;background:repeating-conic-gradient(#2a2a2a 0 25%,#222 0 50%) 0 0/16px 16px;}' +
      'pre{background:#0c0c0c;border:1px solid #2a2a2a;padding:12px;font-size:11px;line-height:1.15;overflow:auto;white-space:pre;}' +
      'table{border-collapse:collapse;font-size:12px;}td,th{border:1px solid #2a2a2a;padding:2px 8px;text-align:left;}' +
      '.chip{display:inline-block;width:10px;height:10px;border:1px solid #444;margin-right:4px;vertical-align:middle;}' +
      'button{background:#222;color:#ddd;border:1px solid #444;padding:6px 14px;cursor:pointer;}' +
      '</style></head><body>' +
      '<h1>' + title + ' — ' + size + '×' + size + ', ' + stats.layers + ' layers, ' + stats.pixelOverrides + ' pixel overrides</h1>' +
      '<canvas id="cv" width="' + (size * scale) + '" height="' + (size * scale) + '"></canvas>' +
      '<div id="info" style="margin:8px 0;font-size:12px;">click canvas to inspect pixel</div>' +
      '<button onclick="dl()">Export PNG</button> ' +
      '<button onclick="document.getElementById(\'ascii\').style.display=document.getElementById(\'ascii\').style.display===\'none\'?\'block\':\'none\'">Toggle ASCII</button>' +
      '<pre id="ascii">' + asciiText.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>' +
      '<h2 style="font-size:13px;color:#888;">Color stats</h2><table><tr><th>name</th><th>color</th><th>pixels</th><th>bbox (x,y,w,h)</th></tr>' +
      stats.colors.map(function (c) {
        return '<tr><td>' + (c.name || '') + '</td><td><span class="chip" style="background:' + c.color + '"></span>' + c.color + '</td><td>' + c.count + '</td><td>[' + c.bbox.join(', ') + ']</td></tr>';
      }).join('') +
      '</table>' +
      '<script>' +
      'var img = new Image(); img.onload = function(){ var cv=document.getElementById("cv"), ctx=cv.getContext("2d"); ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0,cv.width,cv.height); };\n' +
      'img.src = "data:image/png;base64,' + b64 + '";\n' +
      'var px = ' + JSON.stringify(JSON.parse(JSON.stringify(scene))) + ';\n' +
      'var size = ' + size + ', scale = ' + scale + ';\n' +
      'document.getElementById("cv").addEventListener("click", function(e){\n' +
      '  var r = this.getBoundingClientRect();\n' +
      '  var x = Math.floor((e.clientX - r.left) * size / this.width);\n' +
      '  var y = Math.floor((e.clientY - r.top) * size / this.height);\n' +
      '  var pe = window.PixelEngine;\n' +
      '  var hex = pe.get_pixel(px, x, y);\n' +
      '  document.getElementById("info").textContent = "(" + x + "," + y + ") -> " + (hex || "transparent");\n' +
      '});\n' +
      'function dl(){ var a=document.createElement("a"); a.href=img.src; a.download="scene.png"; a.click(); }\n' +
      '</script></body></html>';
    if (typeof process !== 'undefined' && process.versions && process.versions.node && opts.path) {
      const fs = require('fs');
      fs.writeFileSync(opts.path, html);
    }
    return html;
  }

  // --------------------------------------------------------------------------

  return {
    // scene construction
    create_canvas: create_canvas,
    add_layer: add_layer,
    fill_region: fill_region,
    draw_shape: draw_shape,
    set_pixel: set_pixel,
    clear_pixel: clear_pixel,
    get_pixel: get_pixel,
    mirror_region: mirror_region,
    replace_color: replace_color,
    flood_fill: flood_fill,
    draw_cluster: draw_cluster,
    move_region: move_region,
    copy_region: copy_region,
    extract_outline: extract_outline,
    poly_union: poly_union,
    poly_subtract: poly_subtract,
    // raster + inspection
    rasterize: rasterize,
    render: render,
    inspect: inspect,
    read_region: read_region,
    diff_scenes: diff_scenes,
    replace_color_region: replace_color_region,
    measure_distance: measure_distance,
    check_symmetry: check_symmetry,
    dither_region: dither_region,
    compare_scene_to_reference: compare_scene_to_reference,
    analyze_values: analyze_values,
    check_hue_shift: check_hue_shift,
    encode_compact: encode_compact,
    decode_compact: decode_compact,
    get_patch: get_patch,
    apply_patch: apply_patch,
    // export
    encode_png: encode_png,
    encode_png_buffer: encode_png_buffer,
    encode_apng_buffer: encode_apng_buffer,
    decode_png: decode_png,
    quantize_palette: quantize_palette,
    validate_scene: validate_scene,
    export_png: export_png,
    scene_to_html: scene_to_html
  };
});