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

  /** encode_png(scene) -> Uint8Array of PNG bytes. */
  function encode_png(scene) {
    const size = scene.size;
    const rgba = rasterize(scene);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, size);
    dv.setUint32(4, size);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    const stride = size * 4 + 1;
    const raw = new Uint8Array(stride * size);
    for (let y = 0; y < size; y++) {
      raw[y * stride] = 0; // filter: none
      raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
    }

    return joinBytes([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateStream(raw)),
      chunk('IEND', new Uint8Array(0))
    ]);
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
    // raster + inspection
    rasterize: rasterize,
    render: render,
    inspect: inspect,
    read_region: read_region,
    // export
    encode_png: encode_png,
    export_png: export_png,
    scene_to_html: scene_to_html
  };
});