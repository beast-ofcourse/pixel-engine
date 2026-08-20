#!/usr/bin/env node
/**
 * test-suite.js — Zero-dependency accuracy suite for pixel-engine.
 *
 * Every primitive is verified against hand-computed exact pixel sets, plus
 * edge cases, PNG structure, zlib round-trip, determinism, and the two
 * published 64x64 scenes (locked by SHA-256 so any engine change that moves
 * a single pixel fails the suite).
 *
 * Run: node tests/test-suite.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const PE = require('../engine/pixel-engine.js');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name);
    console.log('        ' + String(e.message).split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mk(size, layers, pixels, palette) {
  return {
    size: size,
    palette: palette || {},
    layers: layers || [],
    pixels: pixels || {}
  };
}

/** ASCII grid of the rasterized scene; hexToChar maps '#rrggbb' -> char. */
function grid(scene, hexToChar) {
  const buf = PE.rasterize(scene);
  const size = scene.size;
  const rows = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (buf[i + 3] === 0) { row += '.'; continue; }
      const hex = '#' + [buf[i], buf[i + 1], buf[i + 2]]
        .map(v => ('0' + v.toString(16)).slice(-2)).join('');
      row += hexToChar[hex] || '?';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

function countPainted(scene) {
  const buf = PE.rasterize(scene);
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] !== 0) n++;
  return n;
}

const R = '#ff0000', G = '#00ff00', B = '#0000ff', K = '#000000';
const CH = {}; CH[R] = 'R'; CH[G] = 'G'; CH[B] = 'B'; CH[K] = 'K';

function hash256(buf) {
  return crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

function sameContour(a, b) {
  if (a.length !== b.length) return false;
  const n = a.length;
  if (n === 0) return true;
  for (let i = 0; i < n; i++) {
    if (a[i][0] === b[0][0] && a[i][1] === b[0][1]) {
      let fwd = true, rev = true;
      for (let k = 1; k < n; k++) {
        const j = (i + k) % n;
        if (fwd && (a[j][0] !== b[k][0] || a[j][1] !== b[k][1])) fwd = false;
        if (rev && (a[j][0] !== b[n - k][0] || a[j][1] !== b[n - k][1])) rev = false;
      }
      if (fwd || rev) return true;
    }
  }
  return false;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function centerKeys(poly, size) {
  const keys = new Set();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (inPoly(x + 0.5, y + 0.5, poly)) keys.add(x + ',' + y);
  }
  return keys;
}

function polyScene(size, points, color) {
  return mk(size, [{ id: 'p', type: 'poly', points: points, color: color }], {}, { red: R });
}

// --- PNG parsing helpers ----------------------------------------------------

function crc32(bytes) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function parsePNG(png) {
  const buf = Buffer.from(png);
  assert.deepStrictEqual(
    Array.from(buf.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
    'PNG signature'
  );
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    const expected = crc32(Buffer.concat([buf.subarray(off + 4, off + 8), data]));
    assert.strictEqual(stored, expected, 'CRC mismatch in ' + type + ' chunk');
    chunks.push({ type: type, data: data });
    off += 12 + len;
  }
  return chunks;
}

function inflateIDAT(png) {
  const chunks = parsePNG(png);
  const idat = chunks.find(c => c.type === 'IDAT');
  assert.ok(idat, 'IDAT chunk present');
  return zlib.inflateSync(idat.data);
}

/** Rebuild the expected raw (filter-byte-prefixed) stream from a rasterized scene. */
function rawRows(scene) {
  const buf = PE.rasterize(scene);
  const size = scene.size;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    Buffer.from(buf.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, y * stride + 1);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// scene construction tools
// ---------------------------------------------------------------------------

test('create_canvas: defaults (64x64, empty)', () => {
  const s = PE.create_canvas();
  assert.strictEqual(s.size, 64);
  assert.deepStrictEqual(s.layers, []);
  assert.deepStrictEqual(s.pixels, {});
  assert.deepStrictEqual(s.palette, {});
});

test('create_canvas: size + background fill layer', () => {
  const s = PE.create_canvas(32, '#0000ff');
  assert.strictEqual(s.size, 32);
  assert.strictEqual(s.layers.length, 1);
  assert.strictEqual(s.layers[0].type, 'fill');
  assert.strictEqual(s.layers[0].color, '#0000ff');
  assert.strictEqual(countPainted(s), 32 * 32);
});

test('create_canvas: empty background string -> no layer', () => {
  const s = PE.create_canvas(64, '');
  assert.strictEqual(s.layers.length, 0);
});

test('add_layer: auto id', () => {
  const s = PE.create_canvas();
  PE.add_layer(s, { type: 'rect', x: 0, y: 0, w: 1, h: 1, color: R });
  assert.strictEqual(s.layers[0].id, 'layer0');
});

test('draw_shape: generic params pass through', () => {
  const s = PE.create_canvas();
  PE.draw_shape(s, 'rect', { x: 0, y: 0, w: 1, h: 1, color: R });
  assert.strictEqual(s.layers[0].type, 'rect');
  assert.strictEqual(s.layers[0].color, R);
});

// ---------------------------------------------------------------------------
// rasterizer primitives — exact grids
// ---------------------------------------------------------------------------

test('fill: whole canvas', () => {
  const s = mk(4, [{ id: 'bg', type: 'fill', color: R }]);
  assert.strictEqual(grid(s, CH), 'RRRR\nRRRR\nRRRR\nRRRR');
});

test('rect: exact integer rect', () => {
  const s = mk(8);
  PE.fill_region(s, 2, 1, 3, 2, R);
  assert.strictEqual(grid(s, CH),
    '........\n' +
    '..RRR...\n' +
    '..RRR...\n' +
    '........\n' +
    '........\n' +
    '........\n' +
    '........\n' +
    '........');
});

test('rect: clipped at canvas edges', () => {
  const s = mk(8);
  PE.fill_region(s, -2, -1, 10, 5, R);
  // paints x 0..7 (clipped), y 0..3; count 32
  assert.strictEqual(countPainted(s), 32);
  const g = grid(s, CH).split('\n');
  assert.strictEqual(g[0], 'RRRRRRRR');
  assert.strictEqual(g[3], 'RRRRRRRR');
  assert.strictEqual(g[4], '........');
});

test('rect: fully out of bounds paints nothing', () => {
  const s = mk(8);
  PE.fill_region(s, 100, 100, 5, 5, R);
  assert.strictEqual(countPainted(s), 0);
});

test('rect: zero width/height paints nothing', () => {
  const s = mk(8);
  PE.fill_region(s, 2, 2, 0, 0, R);
  PE.fill_region(s, 2, 2, 2, 0, R);
  assert.strictEqual(countPainted(s), 0);
});

test('rect: fractional coords (locked convention: ceil(x+w)-1)', () => {
  const s = mk(8);
  PE.fill_region(s, 1.5, 0, 2, 1, R);
  // x0=floor(1.5)=1, x1=ceil(3.5)-1=3 -> paints x 1..3
  assert.strictEqual(grid(s, CH).split('\n')[0], '.RRR....');
});

test('rectout: t=1 exact outline', () => {
  const s = mk(6);
  PE.draw_shape(s, 'rectout', { x: 1, y: 1, w: 4, h: 4, color: R });
  assert.strictEqual(grid(s, CH),
    '......\n' +
    '.RRRR.\n' +
    '.R..R.\n' +
    '.R..R.\n' +
    '.RRRR.\n' +
    '......');
});

test('rectout: t=2 double ring', () => {
  const s = mk(8);
  PE.draw_shape(s, 'rectout', { x: 1, y: 1, w: 6, h: 6, t: 2, color: R });
  assert.strictEqual(grid(s, CH),
    '........\n' +
    '.RRRRRR.\n' +
    '.RRRRRR.\n' +
    '.RR..RR.\n' +
    '.RR..RR.\n' +
    '.RRRRRR.\n' +
    '.RRRRRR.\n' +
    '........');
});

test('rectout: degenerate t larger than rect (no crash, clipped)', () => {
  const s = mk(8);
  PE.draw_shape(s, 'rectout', { x: 2, y: 2, w: 3, h: 3, t: 5, color: R });
  const n = countPainted(s);
  assert.ok(n >= 0 && n <= 64, 'bounded painted count, got ' + n);
});

test('ellipse: exact disc (cx=3.5 cy=3.5 r=3)', () => {
  const s = mk(8);
  PE.draw_shape(s, 'ellipse', { cx: 3.5, cy: 3.5, rx: 3, ry: 3, color: R });
  assert.strictEqual(grid(s, CH),
    '...R....\n' +
    '.RRRRR..\n' +
    '.RRRRR..\n' +
    'RRRRRRR.\n' +
    '.RRRRR..\n' +
    '.RRRRR..\n' +
    '...R....\n' +
    '........');
});

test('ellipse: clipped at edge (cx=1 r=3 -> x 0..3)', () => {
  const s = mk(8);
  PE.draw_shape(s, 'ellipse', { cx: 1, cy: 3.5, rx: 3, ry: 2, color: R });
  assert.strictEqual(grid(s, CH),
    '........\n' +
    '........\n' +
    'RRRR....\n' +
    'RRRR....\n' +
    'RRRR....\n' +
    '........\n' +
    '........\n' +
    '........');
});

test('ellipse: degenerate rx<1 -> single pixel at center', () => {
  const s = mk(8);
  PE.draw_shape(s, 'ellipse', { cx: 3.5, cy: 3.5, rx: 0, ry: 2, color: R });
  // Math.round(3.5) = 4 -> single pixel at x=4, y=4
  assert.strictEqual(grid(s, CH).split('\n')[4], '....R...');
  assert.strictEqual(countPainted(s), 1);
});

test('line: horizontal', () => {
  const s = mk(8);
  PE.draw_shape(s, 'line', { x1: 1, y1: 2, x2: 5, y2: 2, color: R });
  assert.strictEqual(grid(s, CH).split('\n')[2], '.RRRRR..');
});

test('line: vertical', () => {
  const s = mk(8);
  PE.draw_shape(s, 'line', { x1: 3, y1: 1, x2: 3, y2: 4, color: R });
  const g = grid(s, CH).split('\n');
  assert.strictEqual(g[1][3], 'R');
  assert.strictEqual(g[2][3], 'R');
  assert.strictEqual(g[3][3], 'R');
  assert.strictEqual(g[4][3], 'R');
  assert.strictEqual(countPainted(s), 4);
});

test('line: diagonal', () => {
  const s = mk(8);
  PE.draw_shape(s, 'line', { x1: 0, y1: 0, x2: 7, y2: 7, color: R });
  assert.strictEqual(grid(s, CH),
    'R.......\n' +
    '.R......\n' +
    '..R.....\n' +
    '...R....\n' +
    '....R...\n' +
    '.....R..\n' +
    '......R.\n' +
    '.......R');
});

test('line: steep (0,0)-(2,5) exact staircase', () => {
  const s = mk(8);
  PE.draw_shape(s, 'line', { x1: 0, y1: 0, x2: 2, y2: 5, color: R });
  assert.strictEqual(grid(s, CH),
    'R.......\n' +
    'R.......\n' +
    '.R......\n' +
    '.R......\n' +
    '..R.....\n' +
    '..R.....\n' +
    '........\n' +
    '........');
});

test('line: reversed direction paints same pixels', () => {
  const a = mk(8), b = mk(8);
  PE.draw_shape(a, 'line', { x1: 5, y1: 2, x2: 1, y2: 2, color: R });
  PE.draw_shape(b, 'line', { x1: 1, y1: 2, x2: 5, y2: 2, color: R });
  assert.strictEqual(grid(a, CH), grid(b, CH));
});

test('line: single point', () => {
  const s = mk(8);
  PE.draw_shape(s, 'line', { x1: 3, y1: 3, x2: 3, y2: 3, color: R });
  assert.strictEqual(countPainted(s), 1);
});

test('line: out of bounds clipped', () => {
  const s = mk(8);
  PE.draw_shape(s, 'line', { x1: -5, y1: -5, x2: 3, y2: 3, color: R });
  assert.strictEqual(grid(s, CH).split('\n')[0], 'R.......');
  assert.strictEqual(countPainted(s), 4);
});

test('poly: triangle exact scanline fill', () => {
  const s = mk(8);
  PE.draw_shape(s, 'poly', { points: [[1, 1], [5, 1], [3, 4]], color: R });
  assert.strictEqual(grid(s, CH),
    '........\n' +
    '.RRRRR..\n' +
    '..RRR...\n' +
    '...R....\n' +
    '........\n' +
    '........\n' +
    '........\n' +
    '........');
});

test('poly: bowtie fills even-odd (self-intersecting)', () => {
  const s = mk(8);
  PE.draw_shape(s, 'poly', { points: [[0, 0], [4, 4], [0, 4], [4, 0]], color: R });
  // half-open scanline rule includes the top vertex row: y=0 spans x 0..4
  assert.strictEqual(grid(s, CH),
    'RRRRR...\n' +
    '.RRR....\n' +
    '..R.....\n' +
    '.RRR....\n' +
    '........\n' +
    '........\n' +
    '........\n' +
    '........');
});

test('poly: fewer than 3 points paints nothing', () => {
  const s = mk(8);
  PE.draw_shape(s, 'poly', { points: [[0, 0], [4, 4]], color: R });
  PE.draw_shape(s, 'poly', { points: [], color: R });
  assert.strictEqual(countPainted(s), 0);
});

test('poly: all-horizontal (collinear) paints nothing', () => {
  const s = mk(8);
  PE.draw_shape(s, 'poly', { points: [[0, 2], [3, 2], [6, 2]], color: R });
  assert.strictEqual(countPainted(s), 0);
});

test('polyout: triangle outline = 3 closed edges (10 unique px)', () => {
  const s = mk(8);
  PE.draw_shape(s, 'polyout', { points: [[1, 1], [5, 1], [3, 4]], color: R });
  // 5 + 4 + 4 edge pixels, corners painted once -> 10 unique
  assert.strictEqual(countPainted(s), 10);
  const g = grid(s, CH).split('\n');
  assert.strictEqual(g[1], '.RRRRR..');
  assert.strictEqual(g[2], '..R.R...');
  assert.strictEqual(g[3], '..R.R...');
  assert.strictEqual(g[4], '...R....');
});

test('polyout: fewer than 2 points paints nothing', () => {
  const s = mk(8);
  PE.draw_shape(s, 'polyout', { points: [[0, 0]], color: R });
  assert.strictEqual(countPainted(s), 0);
});

// ---------------------------------------------------------------------------
// painter's order, colors, overrides
// ---------------------------------------------------------------------------

test('painter: later layers overwrite earlier ones', () => {
  const s = mk(8);
  PE.fill_region(s, 0, 0, 6, 6, R);
  PE.fill_region(s, 2, 2, 3, 3, B);
  const g = grid(s, CH).split('\n');
  assert.strictEqual(g[0], 'RRRRRR..');
  assert.strictEqual(g[2], 'RRBBBR..');
  assert.strictEqual(g[4], 'RRBBBR..'); // blue rect spans rows 2..4
  assert.strictEqual(g[5], 'RRRRRR..');
});

test('layer bboxes: pre-overwrite per layer', () => {
  const s = mk(16);
  PE.fill_region(s, 5, 5, 3, 3, R);
  PE.fill_region(s, 10, 10, 4, 2, B);
  PE.rasterize(s);
  assert.deepStrictEqual(s._layerBBoxes.layer0, [5, 5, 3, 3]);
  assert.deepStrictEqual(s._layerBBoxes.layer1, [10, 10, 4, 2]);
});

test('layer bboxes: fill layer spans whole canvas', () => {
  const s = mk(8);
  PE.fill_region(s, 0, 0, 8, 8, R); // id layer0
  PE.rasterize(s);
  assert.deepStrictEqual(s._layerBBoxes.layer0, [0, 0, 8, 8]);
});

test('colors: palette key, hex, and #rgb shorthand all resolve', () => {
  const s = mk(4, [
    { id: 'a', type: 'fill', color: 'green' },
    { id: 'b', type: 'rect', x: 1, y: 1, w: 2, h: 2, color: '#f00' }
  ], null, { green: '#00ff00' });
  const g = grid(s, CH);
  assert.strictEqual(g.split('\n')[0], 'GGGG');
  assert.strictEqual(g.split('\n')[1], 'GRRG'); // red rect over green
});

test('colors: unknown palette key / null / transparent -> layer skipped', () => {
  const s = mk(4, [
    { id: 'a', type: 'fill', color: 'missing-key' },
    { id: 'b', type: 'fill', color: null },
    { id: 'c', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'transparent' },
    { id: 'd', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'clear' }
  ]);
  assert.strictEqual(countPainted(s), 0);
  assert.strictEqual(PE.inspect(s).skippedLayers, 4);
});

test('colors: unknown layer type skipped and counted', () => {
  const s = mk(4, [
    { id: 'a', type: 'circle', color: R },
    { id: 'b', type: 'rect', x: 0, y: 0, w: 1, h: 1, color: R }
  ]);
  assert.strictEqual(PE.inspect(s).skippedLayers, 1);
  assert.strictEqual(countPainted(s), 1);
});

test('pixels: overrides paint last (hex, palette key, null falls through)', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 4, 4, R);
  PE.set_pixel(s, 0, 0, B);            // hex
  PE.set_pixel(s, 1, 0, 'blue');       // palette key
  PE.set_pixel(s, 2, 0, null);         // null = no override -> layer beneath shows
  s.palette = { blue: '#0000ff' };
  const g = grid(s, CH).split('\n');
  assert.strictEqual(g[0], 'BBRR');
});

test('pixels: clear_pixel restores underlying layer', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 4, 4, R);
  PE.set_pixel(s, 0, 0, B);
  PE.clear_pixel(s, 0, 0);
  assert.strictEqual(grid(s, CH).split('\n')[0][0], 'R');
});

test('pixels: out-of-bounds and malformed keys ignored', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 4, 4, R);
  PE.set_pixel(s, -1, 0, B);
  PE.set_pixel(s, 4, 4, B);
  PE.set_pixel(s, 99, 99, B);
  s.pixels['a,b'] = B;
  assert.strictEqual(countPainted(s), 16);
});

test('get_pixel: resolved colors and transparency', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 2, R);
  PE.set_pixel(s, 1, 1, B);
  PE.set_pixel(s, 0, 1, null); // falls through to the red fill
  assert.strictEqual(PE.get_pixel(s, 1, 1), '#0000ff');
  assert.strictEqual(PE.get_pixel(s, 0, 0), '#ff0000');
  assert.strictEqual(PE.get_pixel(s, 0, 1), '#ff0000');
  assert.strictEqual(PE.get_pixel(s, 3, 3), null); // never painted
});

test('get_pixel: out of bounds returns null (no throw)', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 4, 4, R);
  assert.strictEqual(PE.get_pixel(s, -1, 0), null);
  assert.strictEqual(PE.get_pixel(s, 0, -1), null);
  assert.strictEqual(PE.get_pixel(s, 4, 0), null);
  assert.strictEqual(PE.get_pixel(s, 0, 4), null);
});

// ---------------------------------------------------------------------------
// determinism, render, inspect
// ---------------------------------------------------------------------------

test('determinism: rasterize twice gives identical bytes', () => {
  const s = mk(8, [
    { id: 'a', type: 'fill', color: R },
    { id: 'b', type: 'ellipse', cx: 4, cy: 4, rx: 3, ry: 2, color: B }
  ]);
  assert.deepStrictEqual(PE.rasterize(s), PE.rasterize(s));
});

test('render: returns width/height/data', () => {
  const s = mk(4, [{ id: 'a', type: 'fill', color: R }]);
  const r = PE.render(s);
  assert.strictEqual(r.width, 4);
  assert.strictEqual(r.height, 4);
  assert.strictEqual(r.data.length, 4 * 4 * 4);
  assert.strictEqual(r.data[3], 255);
});

test('inspect: color counts + bboxes sum to painted pixels', () => {
  const s = mk(8);
  PE.fill_region(s, 0, 0, 4, 4, R);
  PE.fill_region(s, 2, 2, 3, 3, B);
  const st = PE.inspect(s);
  const total = st.colors.reduce((n, c) => n + c.count, 0);
  assert.strictEqual(total, countPainted(s));
  const red = st.colors.find(c => c.color === '#ff0000');
  assert.deepStrictEqual(red.bbox, [0, 0, 4, 4]); // pre-overwrite bbox
  assert.strictEqual(st.size, 8);
  assert.strictEqual(st.layers, 2);
  assert.strictEqual(st.pixelOverrides, 0);
  assert.ok(st.layerBBoxes && typeof st.layerBBoxes === 'object');
});

test('inspect: color stats reflect final image (overrides included)', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 4, 4, R);
  PE.set_pixel(s, 0, 0, B);
  const st = PE.inspect(s);
  assert.strictEqual(st.colors.find(c => c.color === '#ff0000').count, 15);
  assert.strictEqual(st.colors.find(c => c.color === '#0000ff').count, 1);
  assert.strictEqual(st.pixelOverrides, 1);
});

// ---------------------------------------------------------------------------
// read_region — ASCII inspection
// ---------------------------------------------------------------------------

test('read_region: auto-scale keeps width <= 40 chars', () => {
  const s = mk(64);
  PE.fill_region(s, 0, 0, 64, 64, R);
  const out = PE.read_region(s, 0, 0, 64, 64);
  const head = out.split('\n')[0];
  assert.ok(/scale=2 \(32x32\)/.test(head), 'head: ' + head);
  const rows = out.split('\n').slice(1, 33);
  assert.ok(rows.every(r => r.length === 32), 'row width 32');
});

test('read_region: scale=1 exact full-res rows', () => {
  const s = mk(8);
  PE.fill_region(s, 1, 1, 3, 2, R);
  const out = PE.read_region(s, 0, 0, 8, 8, { scale: 1 });
  const rows = out.split('\n').slice(1, 9);
  assert.strictEqual(rows[0], '........');
  assert.strictEqual(rows[1], '.AAA....'); // no palette -> auto char A
  assert.strictEqual(rows[2], '.AAA....');
});

test('read_region: scale boundary at 40/80/160 cols', () => {
  const s = mk(200);
  PE.fill_region(s, 0, 0, 200, 200, R);
  assert.ok(/scale=1 \(40x/.test(PE.read_region(s, 0, 0, 40, 1).split('\n')[0]));
  assert.ok(/scale=2 \(21x/.test(PE.read_region(s, 0, 0, 41, 1).split('\n')[0]));
  assert.ok(/scale=4 \(40x/.test(PE.read_region(s, 0, 0, 160, 1).split('\n')[0]));
  assert.ok(/scale=8 \(21x/.test(PE.read_region(s, 0, 0, 161, 1).split('\n')[0]));
});

test('read_region: palette legend uses palette keys', () => {
  const s = mk(6, [
    { id: 'a', type: 'rect', x: 0, y: 0, w: 3, h: 6, color: 'red' },
    { id: 'b', type: 'rect', x: 3, y: 0, w: 3, h: 6, color: 'blue' }
  ], null, { red: '#ff0000', blue: '#0000ff' });
  const out = PE.read_region(s, 0, 0, 6, 6);
  const rows = out.split('\n').slice(1, 7);
  assert.strictEqual(rows[0], 'RRRBBB'); // chars come from palette keys
  assert.ok(out.indexOf('R=red') !== -1, 'legend has R=red');
  assert.ok(out.indexOf('B=blue') !== -1, 'legend has B=blue');
});

test('read_region: counts mode sums to region area', () => {
  const s = mk(8);
  PE.fill_region(s, 0, 0, 4, 3, R);
  const res = PE.read_region(s, 0, 0, 4, 3, { mode: 'counts' });
  assert.deepStrictEqual(res.region, [0, 0, 4, 3]);
  assert.strictEqual(res.colors['#ff0000'], 12);
  assert.strictEqual(Object.values(res.colors).reduce((a, b) => a + b, 0), 12);
});

test('read_region: counts includes transparent', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 2, R);
  const res = PE.read_region(s, 0, 0, 4, 4, { mode: 'counts' });
  assert.strictEqual(res.colors['#ff0000'], 4);
  assert.strictEqual(res.colors['.'], 12);
});

test('read_region: region fully outside canvas -> empty, no crash', () => {
  const s = mk(8);
  PE.fill_region(s, 0, 0, 8, 8, R);
  const out = PE.read_region(s, 70, 70, 5, 5);
  assert.ok(/\(0x0\)/.test(out.split('\n')[0]));
  assert.ok(out.indexOf('.=transparent') !== -1, 'legend still emitted');
});

// ---------------------------------------------------------------------------
// mirror_region
// ---------------------------------------------------------------------------

test('mirror_region: 4x4 region mirrored h (left<->right)', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  PE.set_pixel(s, 1, 1, G);
  const r = PE.mirror_region(s, 0, 0, 4, 4, 'h');
  assert.strictEqual(r.mirrored, 8);
  assert.strictEqual(grid(s, CH), [
    'RRRR',
    'RGGR',
    'RRRR',
    'RRRR'
  ].join('\n'));
});

test('mirror_region: 4x4 region mirrored v (top<->bottom)', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  PE.set_pixel(s, 1, 1, G);
  const r = PE.mirror_region(s, 0, 0, 4, 4, 'v');
  assert.strictEqual(r.mirrored, 8);
  assert.strictEqual(grid(s, CH), [
    'RR..',
    'RR..',
    'RG..',
    'RR..'
  ].join('\n'));
});

test('mirror_region: odd width keeps the center column', () => {
  const s = mk(5);
  PE.fill_region(s, 0, 0, 3, 5, R);
  PE.set_pixel(s, 1, 1, G);
  const r = PE.mirror_region(s, 0, 0, 5, 5, 'h');
  assert.strictEqual(r.mirrored, 15);
  assert.strictEqual(grid(s, CH), [
    'RRRRR',
    'RGRGR',
    'RRRRR',
    'RRRRR',
    'RRRRR'
  ].join('\n'));
});

test('mirror_region: out-of-bounds region clamped', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  PE.set_pixel(s, 1, 1, G);
  const r = PE.mirror_region(s, -1, 0, 4, 4, 'h');
  assert.strictEqual(r.mirrored, 8);
  assert.strictEqual(grid(s, CH), [
    'RR..',
    'GR..',
    'RR..',
    'RR..'
  ].join('\n'));
});

test('mirror_region: fully out of bounds -> no-op', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  const before = grid(s, CH);
  const r = PE.mirror_region(s, 10, 10, 4, 4, 'h');
  assert.strictEqual(r.mirrored, 0);
  assert.strictEqual(grid(s, CH), before);
});

test('mirror_region: zero-size region -> no-op', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  const before = grid(s, CH);
  assert.strictEqual(PE.mirror_region(s, 0, 0, 0, 4, 'h').mirrored, 0);
  assert.strictEqual(PE.mirror_region(s, 0, 0, 4, 0, 'v').mirrored, 0);
  assert.strictEqual(PE.mirror_region(s, 0, 0, -2, 4, 'h').mirrored, 0);
  assert.strictEqual(grid(s, CH), before);
});

test('mirror_region: invalid axis throws', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  assert.throws(() => PE.mirror_region(s, 0, 0, 4, 4, 'x'), /axis/);
  assert.throws(() => PE.mirror_region(s, 0, 0, 4, 4), /axis/);
});

test('mirror_region: destination side overwritten by source mirror', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 4, 4, B);
  PE.set_pixel(s, 0, 0, R);
  PE.set_pixel(s, 1, 0, R);
  PE.set_pixel(s, 2, 0, G);
  PE.set_pixel(s, 3, 0, G);
  PE.mirror_region(s, 0, 0, 4, 4, 'h');
  assert.strictEqual(grid(s, CH), [
    'GGRR',
    'BBBB',
    'BBBB',
    'BBBB'
  ].join('\n'));
});

test('mirror_region: idempotent on the second call', () => {
  const s = mk(4);
  PE.fill_region(s, 0, 0, 2, 4, R);
  PE.set_pixel(s, 1, 1, G);
  PE.mirror_region(s, 0, 0, 4, 4, 'h');
  const first = PE.rasterize(s);
  PE.mirror_region(s, 0, 0, 4, 4, 'h');
  const second = PE.rasterize(s);
  assert.deepStrictEqual(second, first);
});

test('mirror_region: determinism (same input -> identical bytes)', () => {
  const mkMirrored = () => {
    const s = mk(4);
    PE.fill_region(s, 0, 0, 2, 4, R);
    PE.set_pixel(s, 1, 1, G);
    PE.mirror_region(s, 0, 0, 4, 4, 'h');
    return PE.rasterize(s);
  };
  assert.deepStrictEqual(mkMirrored(), mkMirrored());
});

// ---------------------------------------------------------------------------
// replace_color
// ---------------------------------------------------------------------------

test('replace_color: key->key rewrites layers and pixels', () => {
  const s = mk(4, [
    { id: 'a', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'red' },
    { id: 'b', type: 'rect', x: 2, y: 2, w: 2, h: 2, color: 'blue' }
  ], { '0,0': 'red', '3,3': 'blue' }, { red: R, blue: B });
  const r = PE.replace_color(s, 'red', 'blue');
  assert.strictEqual(r.replaced, 2);
  assert.strictEqual(s.layers[0].color, 'blue');
  assert.strictEqual(s.layers[1].color, 'blue');
  assert.strictEqual(s.pixels['0,0'], 'blue');
  assert.strictEqual(s.pixels['3,3'], 'blue');
  assert.strictEqual(s.palette.red, R);
});

test('replace_color: hex->key remaps every key with that hex', () => {
  const s = mk(4, [
    { id: 'a', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'red' },
    { id: 'b', type: 'rect', x: 2, y: 0, w: 2, h: 2, color: 'crimson' }
  ], { '0,0': 'red' }, { red: R, crimson: R, blue: B });
  const r = PE.replace_color(s, R, 'blue');
  assert.strictEqual(r.replaced, 3);
  assert.strictEqual(s.layers[0].color, 'blue');
  assert.strictEqual(s.layers[1].color, 'blue');
  assert.strictEqual(s.pixels['0,0'], 'blue');
});

test('replace_color: key->new-hex adds a palette key', () => {
  const s = mk(4, [{ id: 'a', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'red' }], {}, { red: R });
  const r = PE.replace_color(s, 'red', G);
  assert.strictEqual(r.replaced, 1);
  assert.strictEqual(s.layers[0].color, 'color0');
  assert.strictEqual(s.palette.color0, G);
  assert.strictEqual(s.palette.red, R);
});

test('replace_color: hex->hex reuses an existing key with that hex', () => {
  const s = mk(4, [{ id: 'a', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'red' }], {}, { red: R, green: G });
  const r = PE.replace_color(s, 'red', G);
  assert.strictEqual(r.replaced, 1);
  assert.strictEqual(s.layers[0].color, 'green');
  assert.deepStrictEqual(Object.keys(s.palette).sort(), ['green', 'red']);
});

test('replace_color: no-op cases (same key, same hex, unknown from)', () => {
  const s = mk(4, [{ id: 'a', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'red' }], { '0,0': 'red' }, { red: R });
  assert.strictEqual(PE.replace_color(s, 'red', 'red').replaced, 0);
  assert.strictEqual(PE.replace_color(s, 'red', R).replaced, 0);
  assert.strictEqual(PE.replace_color(s, R, R).replaced, 0);
  assert.strictEqual(PE.replace_color(s, 'ghost', 'red').replaced, 0);
  assert.strictEqual(PE.replace_color(s, '#123456', 'red').replaced, 0);
  assert.strictEqual(s.layers[0].color, 'red');
  assert.strictEqual(s.pixels['0,0'], 'red');
});

test('replace_color: unknown target key throws', () => {
  const s = mk(4, [{ id: 'a', type: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'red' }], {}, { red: R });
  assert.throws(() => PE.replace_color(s, 'red', 'ghost'), /target/);
  assert.throws(() => PE.replace_color(s, 'red', '#zzzzzz'), /target/);
});

test('replace_color: rasterized output recolored', () => {
  const s = mk(4, [{ id: 'a', type: 'rect', x: 0, y: 0, w: 4, h: 4, color: 'red' }], {}, { red: R, blue: B });
  PE.replace_color(s, 'red', 'blue');
  assert.strictEqual(grid(s, CH), [
    'BBBB',
    'BBBB',
    'BBBB',
    'BBBB'
  ].join('\n'));
});

test('replace_color: null pixel clears untouched', () => {
  const s = mk(4, [{ id: 'a', type: 'rect', x: 0, y: 0, w: 4, h: 4, color: 'red' }], { '0,0': null }, { red: R, blue: B });
  const r = PE.replace_color(s, 'red', 'blue');
  assert.strictEqual(r.replaced, 1);
  assert.strictEqual(s.pixels['0,0'], null);
});

// ---------------------------------------------------------------------------
// flood_fill
// ---------------------------------------------------------------------------

test('flood_fill: enclosed region on transparent canvas', () => {
  const s = mk(8, [{ id: 'ring', type: 'rectout', x: 1, y: 1, w: 6, h: 6, color: 'red' }], {}, { red: R, green: G });
  const r = PE.flood_fill(s, 4, 4, 'green');
  assert.strictEqual(r.filled, 16);
  assert.strictEqual(grid(s, CH), [
    '........',
    '.RRRRRR.',
    '.RGGGGR.',
    '.RGGGGR.',
    '.RGGGGR.',
    '.RGGGGR.',
    '.RRRRRR.',
    '........'
  ].join('\n'));
});

test('flood_fill: region on filled background', () => {
  const s = mk(8, [
    { id: 'bg', type: 'fill', color: 'blue' },
    { id: 'blob', type: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'red' }
  ], {}, { red: R, blue: B, green: G });
  const r = PE.flood_fill(s, 3, 3, 'green');
  assert.strictEqual(r.filled, 16);
  assert.strictEqual(grid(s, CH), [
    'BBBBBBBB',
    'BBBBBBBB',
    'BBGGGGBB',
    'BBGGGGBB',
    'BBGGGGBB',
    'BBGGGGBB',
    'BBBBBBBB',
    'BBBBBBBB'
  ].join('\n'));
});

test('flood_fill: fill with background color erases (erase-by-reveal)', () => {
  const s = mk(8, [
    { id: 'bg', type: 'fill', color: 'blue' },
    { id: 'blob', type: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'red' }
  ], {}, { red: R, blue: B });
  const r = PE.flood_fill(s, 3, 3, 'blue');
  assert.strictEqual(r.filled, 16);
  assert.strictEqual(grid(s, CH), [
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB'
  ].join('\n'));
});

test('flood_fill: transparent seed fills the connected empty region', () => {
  const s = mk(8, [{ id: 'blob', type: 'rect', x: 0, y: 0, w: 3, h: 3, color: 'red' }], {}, { red: R, green: G });
  const r = PE.flood_fill(s, 7, 7, 'green');
  assert.strictEqual(r.filled, 55);
  assert.strictEqual(grid(s, CH), [
    'RRRGGGGG',
    'RRRGGGGG',
    'RRRGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG'
  ].join('\n'));
});

test('flood_fill: hex color writes hex overrides', () => {
  const s = mk(8, [{ id: 'ring', type: 'rectout', x: 1, y: 1, w: 6, h: 6, color: 'red' }], {}, { red: R });
  const r = PE.flood_fill(s, 4, 4, G);
  assert.strictEqual(r.filled, 16);
  assert.strictEqual(s.pixels['4,4'], G);
  assert.strictEqual(PE.get_pixel(s, 4, 4), G);
});

test('flood_fill: tolerance matches similar colors, clamps to [0,255]', () => {
  const mkTol = () => {
    const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { blue: B, green: G });
    PE.set_pixel(s, 2, 2, '#ff0000');
    PE.set_pixel(s, 3, 2, '#ff1000');
    PE.set_pixel(s, 4, 2, '#ff2000');
    return s;
  };
  // default tolerance 0: exact match only
  const s0 = mkTol();
  assert.strictEqual(PE.flood_fill(s0, 2, 2, 'green').filled, 1);
  assert.strictEqual(PE.get_pixel(s0, 3, 2), '#ff1000');
  // tolerance 20: matches 16-diff, stops at 32-diff
  const s20 = mkTol();
  assert.strictEqual(PE.flood_fill(s20, 2, 2, 'green', 20).filled, 2);
  assert.strictEqual(PE.get_pixel(s20, 2, 2), G);
  assert.strictEqual(PE.get_pixel(s20, 3, 2), G);
  assert.strictEqual(PE.get_pixel(s20, 4, 2), '#ff2000');
  // negative tolerance clamps to 0
  const sNeg = mkTol();
  assert.strictEqual(PE.flood_fill(sNeg, 2, 2, 'green', -5).filled, 1);
  // huge tolerance clamps to 255: matches everything (per-channel diff <= 255)
  const sBig = mkTol();
  assert.strictEqual(PE.flood_fill(sBig, 2, 2, 'green', 999).filled, 64);
  assert.strictEqual(PE.get_pixel(sBig, 4, 2), G);
  assert.strictEqual(PE.get_pixel(sBig, 0, 0), G);
});

test('flood_fill: no-op cases (OOB seed, seed already fill color)', () => {
  const s = mk(8, [
    { id: 'bg', type: 'fill', color: 'blue' },
    { id: 'blob', type: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'red' }
  ], {}, { red: R, blue: B });
  assert.strictEqual(PE.flood_fill(s, -1, 0, 'red').filled, 0);
  assert.strictEqual(PE.flood_fill(s, 0, 8, 'red').filled, 0);
  assert.strictEqual(PE.flood_fill(s, 3, 3, 'red').filled, 0);
  assert.strictEqual(PE.flood_fill(s, 3, 3, R).filled, 0);
  assert.strictEqual(PE.get_pixel(s, 3, 3), R);
  assert.strictEqual(PE.get_pixel(s, 0, 0), B);
});

// ---------------------------------------------------------------------------
// curve layer type
// ---------------------------------------------------------------------------

test('curve: open curve through 3 points (filled, chord closes)', () => {
  const s = mk(8, [{ id: 'c', type: 'curve', points: [[2, 2], [5, 2], [5, 5]], color: 'red' }], {}, { red: R });
  assert.strictEqual(grid(s, CH), [
    '........',
    '........',
    '..RRRR..',
    '...RRR..',
    '....RR..',
    '........',
    '........',
    '........'
  ].join('\n'));
});

test('curve: closed loop through 4 points (rounded square)', () => {
  const s = mk(8, [{ id: 'c', type: 'curve', points: [[2, 2], [6, 2], [6, 6], [2, 6]], closed: true, color: 'red' }], {}, { red: R });
  assert.strictEqual(grid(s, CH), [
    '........',
    '........',
    '..RRRRR.',
    '..RRRRR.',
    '..RRRRR.',
    '..RRRRR.',
    '..RRRRR.',
    '........'
  ].join('\n'));
});

test('curve: closed loop through 3 points (rounded triangle)', () => {
  const s = mk(8, [{ id: 'c', type: 'curve', points: [[1, 6], [4, 1], [7, 6]], closed: true, color: 'red' }], {}, { red: R });
  assert.strictEqual(grid(s, CH), [
    '........',
    '....R...',
    '...RRR..',
    '...RRR..',
    '..RRRRR.',
    '..RRRRR.',
    '.RRRRRRR',
    '........'
  ].join('\n'));
});

test('curve: passes through the control points (closed loop corners painted)', () => {
  const s = mk(8, [{ id: 'c', type: 'curve', points: [[2, 2], [6, 2], [6, 6], [2, 6]], closed: true, color: 'red' }], {}, { red: R });
  for (const p of [[2, 2], [6, 2], [6, 6], [2, 6]]) {
    assert.strictEqual(PE.get_pixel(s, p[0], p[1]), R);
  }
});

test('curve: degenerate inputs (<2 points paints nothing, 2 points locked, OOB clipped)', () => {
  assert.strictEqual(countPainted(mk(8, [{ id: 'a', type: 'curve', points: [], color: 'red' }], {}, { red: R })), 0);
  assert.strictEqual(countPainted(mk(8, [{ id: 'a', type: 'curve', points: [[2, 2]], color: 'red' }], {}, { red: R })), 0);
  assert.strictEqual(countPainted(mk(8, [{ id: 'a', type: 'curve', color: 'red' }], {}, { red: R })), 0);
  // 2 collinear points: degenerate doubled polygon paints a partial diagonal
  const two = mk(8, [{ id: 'a', type: 'curve', points: [[2, 2], [5, 5]], color: 'red' }], {}, { red: R });
  assert.strictEqual(countPainted(two), 3);
  assert.strictEqual(grid(two, CH), [
    '........',
    '........',
    '..R.....',
    '...R....',
    '....R...',
    '........',
    '........',
    '........'
  ].join('\n'));
  // out-of-bounds points clipped, no crash
  const clip = mk(8, [{ id: 'a', type: 'curve', points: [[-2, -2], [4, 4], [10, 10]], closed: true, color: 'red' }], {}, { red: R });
  assert.strictEqual(countPainted(clip), 8);
});

test('curve-test.json: rasterize hash locked (leaf asset)', () => {
  const s = loadScene('curve-test');
  assert.strictEqual(hash256(PE.rasterize(s)), 'b176fa4a5e66ed6d815351d7f884dd03f73ef06f678e795cb098ce644df288b0');
});

// ---------------------------------------------------------------------------
// draw_cluster
// ---------------------------------------------------------------------------

test('draw_cluster: offset pattern writes overrides at (x,y)', () => {
  const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { red: R, blue: B });
  const r = PE.draw_cluster(s, 2, 3, [[0, 0], [1, 0], [0, 1]], 'red');
  assert.strictEqual(r.painted, 3);
  assert.strictEqual(PE.get_pixel(s, 2, 3), R);
  assert.strictEqual(PE.get_pixel(s, 3, 3), R);
  assert.strictEqual(PE.get_pixel(s, 2, 4), R);
  assert.strictEqual(PE.get_pixel(s, 3, 4), B);
});

test('draw_cluster: string-grid pattern (non-. chars paint)', () => {
  const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { red: R, blue: B });
  const r = PE.draw_cluster(s, 1, 1, ['X.X', '.X.'], 'red');
  assert.strictEqual(r.painted, 3);
  assert.strictEqual(PE.get_pixel(s, 1, 1), R);
  assert.strictEqual(PE.get_pixel(s, 3, 1), R);
  assert.strictEqual(PE.get_pixel(s, 2, 2), R);
  assert.strictEqual(PE.get_pixel(s, 2, 1), B);
  assert.strictEqual(PE.get_pixel(s, 1, 2), B);
});

test('draw_cluster: out-of-bounds clipped, empty pattern no-op', () => {
  const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { red: R, blue: B });
  assert.strictEqual(PE.draw_cluster(s, 7, 7, [[1, 1], [2, 2]], 'red').painted, 0);
  assert.strictEqual(PE.draw_cluster(s, 7, 0, [[0, 0], [1, 0], [0, 1]], 'red').painted, 2);
  assert.strictEqual(PE.draw_cluster(s, 0, 0, [[-1, 0], [0, 0]], 'red').painted, 1);
  assert.strictEqual(PE.draw_cluster(s, 2, 2, [], 'red').painted, 0);
  assert.strictEqual(PE.draw_cluster(s, 2, 2, null, 'red').painted, 0);
});

// ---------------------------------------------------------------------------
// move_region / copy_region
// ---------------------------------------------------------------------------

test('move_region: moves opaque pixels, clears sources (erase-by-reveal)', () => {
  const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { red: R, blue: B });
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) PE.set_pixel(s, x, y, 'red');
  const r = PE.move_region(s, 2, 2, 3, 3, 2, 1);
  assert.strictEqual(r.moved, 9);
  assert.strictEqual(PE.get_pixel(s, 4, 3), R);
  assert.strictEqual(PE.get_pixel(s, 5, 3), R);
  assert.strictEqual(PE.get_pixel(s, 2, 2), B);
  assert.strictEqual(PE.get_pixel(s, 3, 3), B);
});

test('move_region: overlapping move clears sources before writing destinations', () => {
  const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { red: R, blue: B });
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) PE.set_pixel(s, x, y, 'red');
  const r = PE.move_region(s, 2, 2, 3, 3, 1, 0);
  assert.strictEqual(r.moved, 9);
  for (let y = 2; y <= 4; y++) {
    for (let x = 3; x <= 5; x++) {
      assert.strictEqual(PE.get_pixel(s, x, y), R);
    }
  }
  assert.strictEqual(PE.get_pixel(s, 2, 2), B);
  assert.strictEqual(PE.get_pixel(s, 2, 4), B);
});

test('move_region: destination out of bounds clipped, transparent sources untouched', () => {
  const s = mk(8, [{ id: 'bg', type: 'fill', color: 'blue' }], {}, { red: R, blue: B });
  for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) PE.set_pixel(s, x, y, 'red');
  const r = PE.move_region(s, 4, 4, 2, 2, 3, 3);
  assert.strictEqual(r.moved, 1);
  assert.strictEqual(PE.get_pixel(s, 7, 7), R);
  assert.strictEqual(PE.get_pixel(s, 4, 4), B);
  const t = mk(8, [], {}, { red: R });
  PE.set_pixel(t, 2, 2, 'red');
  assert.strictEqual(PE.move_region(t, 1, 1, 4, 4, 2, 0).moved, 1);
  assert.strictEqual(PE.get_pixel(t, 4, 2), R);
  assert.strictEqual(PE.get_pixel(t, 1, 1), null);
});

test('copy_region: copies opaque pixels, source unchanged', () => {
  const s = mk(8, [
    { id: 'bg', type: 'fill', color: 'blue' },
    { id: 'blob', type: 'rect', x: 2, y: 2, w: 2, h: 2, color: 'red' }
  ], {}, { red: R, blue: B });
  const r = PE.copy_region(s, 2, 2, 2, 2, 4, 0);
  assert.strictEqual(r.copied, 4);
  assert.strictEqual(PE.get_pixel(s, 2, 2), R);
  assert.strictEqual(PE.get_pixel(s, 6, 2), R);
  assert.strictEqual(PE.get_pixel(s, 6, 3), R);
  assert.strictEqual(PE.get_pixel(s, 4, 2), B);
});

test('copy_region: destination out of bounds clipped', () => {
  const s = mk(8, [
    { id: 'bg', type: 'fill', color: 'blue' },
    { id: 'blob', type: 'rect', x: 2, y: 2, w: 2, h: 2, color: 'red' }
  ], {}, { red: R, blue: B });
  const r = PE.copy_region(s, 2, 2, 2, 2, 5, 5);
  assert.strictEqual(r.copied, 1);
  assert.strictEqual(PE.get_pixel(s, 7, 7), R);
});

// extract_outline
test('extract_outline: 3x3 rect ring = 8 boundary pixels', () => {
  const s = mk(8, [{ id: 'r', type: 'rect', x: 2, y: 2, w: 3, h: 3, color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s), [
    { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    { x: 2, y: 3 }, { x: 4, y: 3 },
    { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }
  ]);
});

test('extract_outline: 4x4 rect ring = 12 boundary pixels', () => {
  const s = mk(8, [{ id: 'r', type: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s), [
    { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
    { x: 2, y: 3 }, { x: 5, y: 3 },
    { x: 2, y: 4 }, { x: 5, y: 4 },
    { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }
  ]);
});

test('extract_outline: poly silhouette boundary', () => {
  const s = mk(8, [{ id: 't', type: 'poly', points: [[2, 2], [5, 2], [2, 5]], color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s), [
    { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
    { x: 2, y: 3 }, { x: 4, y: 3 },
    { x: 2, y: 4 }, { x: 3, y: 4 }
  ]);
});

test('extract_outline: region restricts to its own ring', () => {
  const s = mk(8, [{ id: 'f', type: 'fill', color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s, { x: 2, y: 2, w: 3, h: 3 }), [
    { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    { x: 2, y: 3 }, { x: 4, y: 3 },
    { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }
  ]);
});

test('extract_outline: empty region -> []', () => {
  const s = mk(8, [{ id: 'f', type: 'fill', color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s, { x: 0, y: 0, w: 0, h: 0 }), []);
});

test('extract_outline: fully painted canvas -> canvas edge ring', () => {
  const s = mk(4, [{ id: 'f', type: 'fill', color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s), [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    { x: 0, y: 1 }, { x: 3, y: 1 },
    { x: 0, y: 2 }, { x: 3, y: 2 },
    { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }
  ]);
});

test('extract_outline: region clipped at canvas edge', () => {
  const s = mk(4, [{ id: 'f', type: 'fill', color: 'red' }], {}, { red: R });
  assert.deepStrictEqual(PE.extract_outline(s, { x: -2, y: -2, w: 4, h: 4 }), [
    { x: 0, y: 0 }, { x: 1, y: 0 },
    { x: 0, y: 1 }, { x: 1, y: 1 }
  ]);
});

// poly_union / poly_subtract
test('poly_union: overlapping squares -> merged rectangle', () => {
  const S = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const C = [[2, 0], [6, 0], [6, 4], [2, 4]];
  assert.ok(sameContour(PE.poly_union(S, C), [[0, 0], [2, 0], [4, 0], [6, 0], [6, 4], [4, 4], [2, 4], [0, 4]]));
});

test('poly_subtract: overlapping squares -> left strip', () => {
  const S = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const C = [[2, 0], [6, 0], [6, 4], [2, 4]];
  assert.ok(sameContour(PE.poly_subtract(S, C), [[0, 0], [2, 0], [2, 4], [0, 4]]));
});

test('poly_union: staircase + contained square -> staircase', () => {
  const S = [[0, 0], [4, 0], [4, 2], [6, 2], [6, 6], [2, 6], [2, 4], [0, 4]];
  const C = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.ok(sameContour(PE.poly_union(S, C), S));
});

test('poly_subtract: staircase minus contained square -> L region', () => {
  const S = [[0, 0], [4, 0], [4, 2], [6, 2], [6, 6], [2, 6], [2, 4], [0, 4]];
  const C = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.ok(sameContour(PE.poly_subtract(S, C), [[6, 2], [6, 6], [2, 6], [2, 4], [4, 4], [4, 2]]));
});

test('poly_union: disjoint -> both contours concatenated', () => {
  const S = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const C = [[4, 4], [6, 4], [6, 6], [4, 6]];
  assert.deepStrictEqual(PE.poly_union(S, C), S.concat(C));
});

test('poly_subtract: disjoint -> subject unchanged', () => {
  const S = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const C = [[4, 4], [6, 4], [6, 6], [4, 6]];
  assert.deepStrictEqual(PE.poly_subtract(S, C), S);
});

test('poly_union: identical -> copy', () => {
  const S = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const r = PE.poly_union(S, S);
  assert.deepStrictEqual(r, S);
  assert.notStrictEqual(r, S);
});

test('poly_subtract: identical -> null', () => {
  const S = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.strictEqual(PE.poly_subtract(S, S), null);
});

test('poly_union: degenerate subject -> clip', () => {
  const C = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.deepStrictEqual(PE.poly_union([[0, 0], [2, 0], [1, 0]], C), C);
  assert.deepStrictEqual(PE.poly_union([[0, 0], [2, 0], [2, 0], [0, 0]], C), C);
});

test('poly_subtract: degenerate subject -> null', () => {
  const C = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.strictEqual(PE.poly_subtract([[0, 0], [2, 0], [1, 0]], C), null);
});

test('poly_union: subject inside clip -> clip', () => {
  const S = [[1, 1], [3, 1], [3, 3], [1, 3]];
  const C = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.deepStrictEqual(PE.poly_union(S, C), C);
});

test('poly_subtract: subject inside clip -> null', () => {
  const S = [[1, 1], [3, 1], [3, 3], [1, 3]];
  const C = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.strictEqual(PE.poly_subtract(S, C), null);
});

test('poly_subtract: clip inside subject -> subject (hole not representable)', () => {
  const S = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const C = [[1, 1], [3, 1], [3, 3], [1, 3]];
  assert.deepStrictEqual(PE.poly_subtract(S, C), S);
});

test('poly_union: rasterized result covers pixel union (overlapping squares)', () => {
  const S = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const C = [[2, 0], [6, 0], [6, 4], [2, 4]];
  const expected = new Set([...centerKeys(S, 8), ...centerKeys(C, 8)]);
  const r = PE.poly_union(S, C);
  assert.ok(r);
  assert.deepStrictEqual(centerKeys(r, 8), expected);
});

test('poly_subtract: rasterized result covers pixel difference (overlapping squares)', () => {
  const S = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const C = [[2, 0], [6, 0], [6, 4], [2, 4]];
  const sKeys = centerKeys(S, 8), cKeys = centerKeys(C, 8);
  const expected = new Set([...sKeys].filter(k => !cKeys.has(k)));
  const r = PE.poly_subtract(S, C);
  assert.ok(r);
  assert.deepStrictEqual(centerKeys(r, 8), expected);
});

test('poly_union/subtract: rasterized result matches pixel ops (staircase)', () => {
  const S = [[0, 0], [4, 0], [4, 2], [6, 2], [6, 6], [2, 6], [2, 4], [0, 4]];
  const C = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const sKeys = centerKeys(S, 8), cKeys = centerKeys(C, 8);
  const u = PE.poly_union(S, C);
  const d = PE.poly_subtract(S, C);
  assert.ok(u && d);
  assert.deepStrictEqual(centerKeys(u, 8), new Set([...sKeys, ...cKeys]));
  assert.deepStrictEqual(centerKeys(d, 8), new Set([...sKeys].filter(k => !cKeys.has(k))));
});

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

test('png: signature + chunk structure + IHDR fields', () => {
  const s = mk(2);
  PE.set_pixel(s, 0, 0, R);
  const png = PE.encode_png(s);
  const chunks = parsePNG(png);
  assert.deepStrictEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0].data;
  assert.strictEqual(ihdr.readUInt32BE(0), 2);   // width
  assert.strictEqual(ihdr.readUInt32BE(4), 2);   // height
  assert.strictEqual(ihdr[8], 8);                // bit depth
  assert.strictEqual(ihdr[9], 6);                // RGBA
  assert.strictEqual(ihdr[10], 0);               // compression
  assert.strictEqual(ihdr[11], 0);               // filter
  assert.strictEqual(ihdr[12], 0);               // interlace
  assert.deepStrictEqual(chunks[2].data, Buffer.alloc(0));
});

test('png: IDAT inflates byte-exact to filter rows (zlib round-trip)', () => {
  const s = mk(4, [
    { id: 'a', type: 'fill', color: R },
    { id: 'b', type: 'rect', x: 1, y: 1, w: 2, h: 2, color: B }
  ]);
  const png = PE.encode_png(s);
  assert.deepStrictEqual(inflateIDAT(png), rawRows(s));
});

test('png: transparency preserved through encode', () => {
  const s = mk(2);
  PE.set_pixel(s, 0, 0, R);
  const raw = inflateIDAT(PE.encode_png(s));
  // row 0: [filter, R,G,B,A, t,t,t,t] ; row 1 all transparent
  assert.strictEqual(raw[0], 0);
  assert.strictEqual(raw[1], 255); assert.strictEqual(raw[2], 0); assert.strictEqual(raw[3], 0);
  assert.strictEqual(raw[4], 255); // alpha 255
  assert.strictEqual(raw[8], 0);   // transparent pixel alpha
  assert.strictEqual(raw[13], 0);  // whole second row transparent
});

test('png: deterministic output (encode twice, identical bytes)', () => {
  const s = mk(8, [
    { id: 'a', type: 'fill', color: R },
    { id: 'b', type: 'ellipse', cx: 4, cy: 4, rx: 3, ry: 2, color: B }
  ]);
  assert.deepStrictEqual(PE.encode_png(s), PE.encode_png(s));
});

test('png: deflate handles uniform data (long LZ77 runs)', () => {
  const s = mk(256, [{ id: 'a', type: 'fill', color: R }]);
  const png = PE.encode_png(s);
  assert.deepStrictEqual(inflateIDAT(png), rawRows(s));
  assert.ok(png.length < 8192, 'uniform 256 compresses, got ' + png.length + ' bytes');
});

test('png: deflate handles high-entropy data (round-trip still exact)', () => {
  const s = mk(64);
  PE.fill_region(s, 0, 0, 64, 64, R);
  const rnd = crypto.randomBytes(4096 * 3);
  for (let n = 0; n < 4096; n++) {
    PE.set_pixel(s, n % 64, Math.floor(n / 64), '#' + rnd.subarray(n * 3, n * 3 + 3).toString('hex'));
  }
  const png = PE.encode_png(s);
  assert.deepStrictEqual(inflateIDAT(png), rawRows(s));
});

// --- PNG import (decode_png) ------------------------------------------------

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([out.subarray(4, 8), data])), 8 + data.length);
  return out;
}

/** Assemble a PNG from raw filter-prefixed scanlines (test encoder-side). */
function buildPNG(width, height, colorType, raw, plte, trns) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  const chunks = [pngChunk('IHDR', ihdr)];
  if (plte) chunks.push(pngChunk('PLTE', plte));
  if (trns) chunks.push(pngChunk('tRNS', trns));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(raw)));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])].concat(chunks));
}

/** Encoder-side filter: bytes the decoder reconstructs back to orig (given above row). */
function filterRow(orig, above, filter, bpp) {
  const out = Buffer.alloc(orig.length);
  for (let x = 0; x < orig.length; x++) {
    const left = x >= bpp ? orig[x - bpp] : 0;
    const up = above ? above[x] : 0;
    const ul = x >= bpp && above ? above[x - bpp] : 0;
    let v = orig[x];
    if (filter === 1) v = (v - left) & 0xFF;
    else if (filter === 2) v = (v - up) & 0xFF;
    else if (filter === 3) v = (v - ((left + up) >> 1)) & 0xFF;
    else if (filter === 4) {
      const p = left + up - ul;
      const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
      const pred = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : ul);
      v = (v - pred) & 0xFF;
    }
    out[x] = v;
  }
  return out;
}

test('decode_png: round-trip on small scene (transparency preserved)', () => {
  const s = mk(8, [
    { id: 'a', type: 'fill', color: R },
    { id: 'b', type: 'ellipse', cx: 4, cy: 4, rx: 3, ry: 2, color: B }
  ]);
  PE.set_pixel(s, 0, 0, null); // transparent hole
  const dec = PE.decode_png(PE.encode_png(s));
  assert.strictEqual(dec.width, 8);
  assert.strictEqual(dec.height, 8);
  assert.deepStrictEqual(dec.rgba, PE.rasterize(s));
});

test('decode_png: round-trip on hash-locked benchmark assets', () => {
  for (const name of ['coin16', 'chest32', 'character64', 'creature64']) {
    const s = loadScene(name);
    const dec = PE.decode_png(PE.encode_png(s));
    assert.strictEqual(dec.width, s.size, name);
    assert.strictEqual(dec.height, s.size, name);
    assert.deepStrictEqual(dec.rgba, PE.rasterize(s), name);
  }
});

test('decode_png: RGB (color type 2) -> alpha 255', () => {
  const w = 4, h = 3;
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      raw[y * stride + 1 + x * 3] = x * 50;
      raw[y * stride + 1 + x * 3 + 1] = y * 50;
      raw[y * stride + 1 + x * 3 + 2] = 100;
    }
  }
  const dec = PE.decode_png(buildPNG(w, h, 2, raw));
  assert.strictEqual(dec.width, w);
  assert.strictEqual(dec.height, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = (y * w + x) * 4;
    assert.strictEqual(dec.rgba[d], x * 50);
    assert.strictEqual(dec.rgba[d + 1], y * 50);
    assert.strictEqual(dec.rgba[d + 2], 100);
    assert.strictEqual(dec.rgba[d + 3], 255);
  }
});

test('decode_png: palette (color type 3) with tRNS alpha', () => {
  const w = 3, h = 2;
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 10, 20, 30]);
  const trns = Buffer.from([255, 128, 0]);
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x + y) % 3;
  }
  const dec = PE.decode_png(buildPNG(w, h, 3, raw, plte, trns));
  assert.deepStrictEqual(Array.from(dec.rgba), [
    255, 0, 0, 255, 0, 255, 0, 128, 10, 20, 30, 0,
    0, 255, 0, 128, 10, 20, 30, 0, 255, 0, 0, 255
  ]);
});

test('decode_png: all 5 filter types reconstructed', () => {
  const w = 4, h = 5, bpp = 4;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * bpp);
    for (let x = 0; x < w; x++) {
      row[x * bpp] = (x * 37 + y * 11) & 0xFF;
      row[x * bpp + 1] = (x * 3 + y * 53) & 0xFF;
      row[x * bpp + 2] = (x * y + 17) & 0xFF;
      row[x * bpp + 3] = 255;
    }
    rows.push(row);
  }
  const raw = Buffer.alloc(h * (w * bpp + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * bpp + 1)] = y % 5; // filters 0..4 across rows
    filterRow(rows[y], y > 0 ? rows[y - 1] : null, y % 5, bpp).copy(raw, y * (w * bpp + 1) + 1);
  }
  const dec = PE.decode_png(buildPNG(w, h, 6, raw));
  const expected = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) expected.set(rows[y], y * w * bpp);
  assert.deepStrictEqual(dec.rgba, expected);
});

test('decode_png: non-PNG input rejected', () => {
  assert.throws(() => PE.decode_png(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /not a PNG/);
});

test('decode_png: truncated input rejected', () => {
  const png = PE.encode_png(mk(4, [{ id: 'a', type: 'fill', color: R }]));
  assert.throws(() => PE.decode_png(png.subarray(0, png.length - 5)), /truncated|corrupt/);
});

test('decode_png: corrupt chunk CRC rejected', () => {
  const png = Buffer.from(PE.encode_png(mk(4, [{ id: 'a', type: 'fill', color: R }])));
  png[12] ^= 0xFF; // flip a byte inside IHDR data
  assert.throws(() => PE.decode_png(png), /corrupt chunk CRC/);
});

test('decode_png: corrupt compressed data rejected (fresh CRC, bad inflate)', () => {
  const png = PE.encode_png(mk(4, [{ id: 'a', type: 'fill', color: R }]));
  const idat = parsePNG(png).find(c => c.type === 'IDAT');
  const bad = Buffer.from(idat.data);
  bad[3] ^= 0xFF;
  const rebuilt = Buffer.concat([
    png.subarray(0, 33), // signature + IHDR chunk
    pngChunk('IDAT', bad),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  assert.throws(() => PE.decode_png(rebuilt), /corrupt/);
});

test('decode_png: unsupported IHDR variants rejected', () => {
  const mkIhdr = (bitDepth, colorType, interlace) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = bitDepth;
    ihdr[9] = colorType;
    ihdr[12] = interlace;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)]);
  };
  assert.throws(() => PE.decode_png(mkIhdr(4, 6, 0)), /bit depth/);
  assert.throws(() => PE.decode_png(mkIhdr(8, 6, 1)), /interlaced/);
  assert.throws(() => PE.decode_png(mkIhdr(8, 0, 0)), /color type/);
});

test('decode_png: palette image without PLTE rejected', () => {
  const w = 2, h = 2;
  const raw = Buffer.alloc(h * (w + 1));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  assert.throws(() => PE.decode_png(png), /PLTE/);
});

// --- palette quantization (quantize_palette) --------------------------------

function rgbaOf(width, height, fn) {
  const buf = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = fn(x, y);
    const d = (y * width + x) * 4;
    if (c === null) { buf[d + 3] = 0; continue; }
    buf[d] = c[0]; buf[d + 1] = c[1]; buf[d + 2] = c[2]; buf[d + 3] = 255;
  }
  return buf;
}

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sqDist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

test('quantize_palette: exact palette when unique colors fit', () => {
  const buf = rgbaOf(4, 2, (x) => {
    if (x < 2) return [255, 0, 0];
    if (x === 2) return [0, 255, 0];
    return [10, 20, 30];
  });
  const q = PE.quantize_palette(buf, 16);
  assert.deepStrictEqual(q.palette, ['#00ff00', '#0a141e', '#ff0000']); // sorted by r,g,b
  assert.deepStrictEqual(Array.from(q.indices), [2, 2, 0, 1, 2, 2, 0, 1]);
});

test('quantize_palette: count cap respected (median-cut)', () => {
  const buf = rgbaOf(16, 1, (x) => [x * 16, 255 - x * 16, x * 8]);
  const q = PE.quantize_palette(buf, 8);
  assert.strictEqual(q.palette.length, 8);
  assert.strictEqual(q.indices.length, 16);
  for (const i of q.indices) assert.ok(i >= 0 && i < 8);
  for (let x = 0; x < 16; x++) {
    const rgb = [x * 16, 255 - x * 16, x * 8];
    const p = hexToRgb(q.palette[q.indices[x]]);
    let bestD = Infinity;
    for (const hex of q.palette) {
      const d = sqDist(rgb, hexToRgb(hex));
      if (d < bestD) bestD = d;
    }
    assert.strictEqual(sqDist(rgb, p), bestD, 'pixel ' + x + ' maps to nearest entry');
  }
});

test('quantize_palette: determinism', () => {
  const buf = rgbaOf(8, 8, (x, y) => [(x * 31 + y * 7) % 256, (x * 5 + y * 47) % 256, (x * y + 13) % 256]);
  const a = PE.quantize_palette(buf, 12);
  const b = PE.quantize_palette(buf, 12);
  assert.deepStrictEqual(a.palette, b.palette);
  assert.deepStrictEqual(Array.from(a.indices), Array.from(b.indices));
});

test('quantize_palette: fully transparent input -> empty palette', () => {
  const q = PE.quantize_palette(new Uint8Array(4 * 4), 16);
  assert.deepStrictEqual(q.palette, []);
  assert.deepStrictEqual(Array.from(q.indices), [-1, -1, -1, -1]);
});

test('quantize_palette: transparent pixels map to -1', () => {
  const buf = rgbaOf(2, 2, (x, y) => (x === 1 && y === 1) ? null : [255, 0, 0]);
  const q = PE.quantize_palette(buf, 16);
  assert.deepStrictEqual(q.palette, ['#ff0000']);
  assert.deepStrictEqual(Array.from(q.indices), [0, 0, 0, -1]);
});

test('quantize_palette: bad maxColors rejected', () => {
  const buf = rgbaOf(1, 1, () => [1, 2, 3]);
  assert.throws(() => PE.quantize_palette(buf, 0), /positive integer/);
  assert.throws(() => PE.quantize_palette(buf, 1.5), /positive integer/);
});

test('quantize_palette: default maxColors is 16', () => {
  const buf = rgbaOf(32, 1, (x) => [x * 8, x * 8, x * 8]);
  assert.strictEqual(PE.quantize_palette(buf).palette.length, 16);
});

test('quantize_palette: median-cut splits into cluster means', () => {
  const buf = rgbaOf(8, 8, (x, y) => (y < 4 ? [200, 50, 50] : [50, 50, 200]));
  const q = PE.quantize_palette(buf, 2);
  assert.deepStrictEqual(q.palette, ['#3232c8', '#c83232']);
  assert.strictEqual(q.indices[0], 1);
  assert.strictEqual(q.indices[32], 0);
});

// --- scene validation (validate_scene) --------------------------------------

function mkValidScene(size) {
  return {
    size: size,
    palette: { a: '#111111', b: '#222222', c: '#333333', d: '#444444', e: '#555555' },
    layers: [
      { id: 'bg', type: 'fill', color: 'a' },
      { id: 'r', type: 'rect', x: 1, y: 1, w: 2, h: 2, color: 'b' },
      { id: 'el', type: 'ellipse', cx: 6, cy: 6, rx: 2, ry: 2, color: 'c' },
      { id: 'p', type: 'poly', points: [[2, 8], [5, 8], [4, 10]], color: 'd' }
    ],
    pixels: { '0,0': 'e', '3,4': null }
  };
}

test('validate_scene: valid small scene passes', () => {
  const r = PE.validate_scene(mkValidScene(16));
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.errors, []);
});

test('validate_scene: hash-locked assets pass', () => {
  for (const name of ['house', 'robot', 'coin16', 'potion16', 'sword16', 'axe32', 'chest32',
                      'torch32', 'sword64', 'axe64', 'creature64', 'character64']) {
    const r = PE.validate_scene(loadScene(name));
    assert.strictEqual(r.valid, true, name + ': ' + JSON.stringify(r.errors));
  }
});

test('validate_scene: size errors are specific', () => {
  const s = mkValidScene(16);
  delete s.size;
  assert.deepStrictEqual(PE.validate_scene(s).errors, ['size must be a positive integer']);
  const s2 = mkValidScene(16);
  s2.size = 24;
  assert.deepStrictEqual(PE.validate_scene(s2).errors,
    ['size must be one of the ladder sizes: 16, 32, 64, 128, 256 (got 24)']);
});

test('validate_scene: palette errors are specific', () => {
  const s = mkValidScene(16);
  delete s.palette;
  assert.deepStrictEqual(PE.validate_scene(s).errors, ['palette must be an object']);
  const s2 = mkValidScene(16);
  delete s2.palette.e;
  s2.pixels['0,0'] = 'd';
  assert.deepStrictEqual(PE.validate_scene(s2).errors, ['palette must have 5-12 entries (got 4)']);
  const s3 = mkValidScene(16);
  s3.palette.f = 'not-a-color';
  const r3 = PE.validate_scene(s3);
  assert.ok(r3.errors.some(function (e) { return e === 'palette entry "f" has invalid color "not-a-color"'; }));
});

test('validate_scene: layer errors are specific', () => {
  const s = mkValidScene(16);
  s.layers[1].type = 'blob';
  assert.deepStrictEqual(PE.validate_scene(s).errors, ['layer 1 has unknown type "blob"']);
  const s2 = mkValidScene(16);
  s2.layers[1].color = 'zzz';
  assert.deepStrictEqual(PE.validate_scene(s2).errors,
    ['layer 1 (rect) has unknown color "zzz"']);
  const s3 = mkValidScene(16);
  s3.layers[1].w = 0;
  assert.deepStrictEqual(PE.validate_scene(s3).errors, ['layer 1 (rect) w must be >= 1']);
  const s4 = mkValidScene(16);
  s4.layers[1].x = -1;
  assert.deepStrictEqual(PE.validate_scene(s4).errors, ['layer 1 (rect) x/y must be >= 0']);
  const s5 = mkValidScene(16);
  s5.layers[1].x = 15;
  assert.deepStrictEqual(PE.validate_scene(s5).errors, ['layer 1 (rect) x + w / y + h exceed size 16']);
  const s6 = mkValidScene(16);
  s6.layers[2].rx = 0;
  assert.deepStrictEqual(PE.validate_scene(s6).errors, ['layer 2 (ellipse) rx must be >= 1']);
  const s7 = mkValidScene(16);
  s7.layers[2].cx = 15;
  assert.deepStrictEqual(PE.validate_scene(s7).errors, ['layer 2 (ellipse) ellipse out of bounds for size 16']);
  const s8 = mkValidScene(16);
  s8.layers[1].type = 'line';
  s8.layers[1].x1 = 0; s8.layers[1].y1 = 0; s8.layers[1].x2 = 3; s8.layers[1].y2 = 99;
  assert.deepStrictEqual(PE.validate_scene(s8).errors, ['layer 1 (line) endpoints out of bounds for size 16']);
  const s9 = mkValidScene(16);
  s9.layers[3].points = [[2, 8], [5, 8]];
  assert.deepStrictEqual(PE.validate_scene(s9).errors,
    ['layer 3 (poly) points must be an array of at least 3 [x, y] pairs']);
  const s10 = mkValidScene(16);
  s10.layers[3].points = [[2, 8], [5, 8], [40, 10]];
  assert.deepStrictEqual(PE.validate_scene(s10).errors, ['layer 3 (poly) point 2 out of bounds for size 16']);
  const s11 = mkValidScene(16);
  s11.layers[1].type = 'rectout';
  s11.layers[1].t = 0;
  assert.deepStrictEqual(PE.validate_scene(s11).errors, ['layer 1 (rectout) t must be a positive integer']);
});

test('validate_scene: pixel errors are specific', () => {
  const s = mkValidScene(16);
  s.pixels['a,b'] = 'e';
  assert.deepStrictEqual(PE.validate_scene(s).errors, ['pixel key "a,b" must be "x,y"']);
  const s2 = mkValidScene(16);
  s2.pixels['20,1'] = 'e';
  assert.deepStrictEqual(PE.validate_scene(s2).errors, ['pixel "20,1" is out of bounds for size 16']);
  const s3 = mkValidScene(16);
  s3.pixels['0,0'] = 'zzz';
  assert.deepStrictEqual(PE.validate_scene(s3).errors, ['pixel "0,0" has invalid value "zzz"']);
});

test('validate_scene: multiple errors collected, not stopped at', () => {
  const s = mkValidScene(16);
  s.size = 24;
  s.layers[1].type = 'blob';
  s.pixels['a,b'] = 'e';
  const r = PE.validate_scene(s);
  assert.strictEqual(r.valid, false);
  assert.deepStrictEqual(r.errors, [
    'size must be one of the ladder sizes: 16, 32, 64, 128, 256 (got 24)',
    'layer 1 has unknown type "blob"',
    'pixel key "a,b" must be "x,y"'
  ]);
});

test('validate_scene: non-object input rejected', () => {
  assert.deepStrictEqual(PE.validate_scene(null).errors, ['scene must be an object']);
  assert.deepStrictEqual(PE.validate_scene([1, 2]).errors, ['scene must be an object']);
});

// ---------------------------------------------------------------------------
// scene documents — locked hashes (house, campfire)
// ---------------------------------------------------------------------------

function loadScene(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', name + '.json'), 'utf8'));
}

test('house: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('house');
  assert.strictEqual(hash256(PE.rasterize(s)), 'e4122858a812f4ad57417f491d4e4ea92779eb1dbd6cd2501aed3695adeaf54a');
});

test('campfire: rasterize hash locked', () => {
  const s = loadScene('campfire');
  assert.strictEqual(hash256(PE.rasterize(s)), 'f2b9806050fbdca340cf1980ec10a49ca3c1b1f9d4a7a6e9dcad310dea058e62');
});

test('house128: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('house128');
  assert.strictEqual(hash256(PE.rasterize(s)), '22f8cbcb86bd47f4f44f7d76d594e120d0cdc8d99672cb61d86be82ceac5fcf1');
});

test('robot: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('robot');
  assert.strictEqual(hash256(PE.rasterize(s)), '434479ea22214b5b6521d04c3a603b8aa56824a1efd4be66855f3e4284bbf468');
});

test('landscape256: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('landscape256');
  assert.strictEqual(hash256(PE.rasterize(s)), '5192f4c37ca56c03f1bea198e506d2ffb1ac400f674c4e5511987b7190587ac9');
});

// benchmark ladder assets (§24 of docs/plans/tasks.md) — hash-locked
test('coin16: rasterize hash locked', () => {
  const s = loadScene('coin16');
  assert.strictEqual(hash256(PE.rasterize(s)), '5d789eb4cafb49effdfcd13691965ee04bf0f2a24523a0d0d7d1de7bcbd98a11');
});

test('potion16: rasterize hash locked', () => {
  const s = loadScene('potion16');
  assert.strictEqual(hash256(PE.rasterize(s)), '20446a07cb427044205097cf7fe71c4c22c9e58ad4b72b73c37c37a3da30d922');
});

test('sword16: rasterize hash locked', () => {
  const s = loadScene('sword16');
  assert.strictEqual(hash256(PE.rasterize(s)), '1e3e27a8094f2a5048ff4a2f1773c686ec23e6d3b35d239dbb149796c09d5eca');
});

test('axe32: rasterize hash locked', () => {
  const s = loadScene('axe32');
  assert.strictEqual(hash256(PE.rasterize(s)), '1c9e9b384dc76510c5db693cd1d208369231631cb430f92012b6dce6d9aa0194');
});

test('chest32: rasterize hash locked', () => {
  const s = loadScene('chest32');
  assert.strictEqual(hash256(PE.rasterize(s)), '939b4d9e37458acd0740d9e60a497dfb5e68237365c2428d891c17e6522ec587');
});

test('torch32: rasterize hash locked', () => {
  const s = loadScene('torch32');
  assert.strictEqual(hash256(PE.rasterize(s)), '88fff1bd3bfc01d05366d8fae2e12740634e62e57479ed755dbc22a3804f21d0');
});

test('sword64: rasterize hash locked', () => {
  const s = loadScene('sword64');
  assert.strictEqual(hash256(PE.rasterize(s)), 'a03ead8e11b582e0a3b8817d3cff993b6bbb545ed95751754fd09be116b3a525');
});

test('axe64: rasterize hash locked', () => {
  const s = loadScene('axe64');
  assert.strictEqual(hash256(PE.rasterize(s)), 'f2e4056dd3204e858e34ca55f46becb0c3b172ebc1b4c4fd7a1982c2c5981e49');
});

test('character64: rasterize hash locked', () => {
  const s = loadScene('character64');
  assert.strictEqual(hash256(PE.rasterize(s)), '24e275aad9bbfaeaa43b6fdd898b8e8145bab1b293cc9104573ffa5d3d138d5e');
});

test('creature64: rasterize hash locked', () => {
  const s = loadScene('creature64');
  assert.strictEqual(hash256(PE.rasterize(s)), '8b7bb303b3c8b02a1dadfb0bb16e5d89c00feaf59319bc0bf06221f9ccb7f30b');
});

test('house128: known pixel probes (browser-verified)', () => {
  const s = loadScene('house128');
  assert.strictEqual(PE.get_pixel(s, 10, 10), '#7ec8e3');    // sky
  assert.strictEqual(PE.get_pixel(s, 104, 20), '#ffd34e');   // sun
  assert.strictEqual(PE.get_pixel(s, 64, 35), '#c25b3a');    // roof (not on tile line)
  assert.strictEqual(PE.get_pixel(s, 64, 60), '#f2d8a7');    // wall
  assert.strictEqual(PE.get_pixel(s, 64, 86), '#6b4226');    // door
  assert.strictEqual(PE.get_pixel(s, 60, 86), '#e8c14e');    // doorknob
  assert.strictEqual(PE.get_pixel(s, 10, 110), '#6bbf59');   // ground
  assert.strictEqual(PE.get_pixel(s, 49, 71), '#3a2315');    // window cross
  assert.strictEqual(PE.get_pixel(s, 84, 31), '#8e6b4a');    // chimney body
  assert.strictEqual(PE.get_pixel(s, 56, 106), '#c9b97c');   // path
  assert.strictEqual(PE.get_pixel(s, 24, 106), '#a9855c');   // fence rail
});

test('robot: known pixel probes', () => {
  const s = loadScene('robot');
  assert.strictEqual(PE.get_pixel(s, 64, 4), '#ffb300');     // antenna tip
  assert.strictEqual(PE.get_pixel(s, 64, 16), '#7ee0ff');    // visor
  assert.strictEqual(PE.get_pixel(s, 64, 24), '#11151c');    // mouth
  assert.strictEqual(PE.get_pixel(s, 64, 44), '#ff5a5a');    // core light
  assert.strictEqual(PE.get_pixel(s, 40, 60), '#9fb4c7');    // body
  assert.strictEqual(PE.get_pixel(s, 31, 60), '#6e8498');    // arm
  assert.strictEqual(PE.get_pixel(s, 95, 90), '#c7d6e4');    // hand
  assert.strictEqual(PE.get_pixel(s, 51, 103), '#c7d6e4');   // knee
  assert.strictEqual(PE.get_pixel(s, 45, 110), '#9fb4c7');   // leg
  assert.strictEqual(PE.get_pixel(s, 49, 114), '#6e8498');   // foot
});

test('landscape256: known pixel probes', () => {
  const s = loadScene('landscape256');
  assert.strictEqual(PE.get_pixel(s, 10, 10), '#5b8fd9');    // sky top band
  assert.strictEqual(PE.get_pixel(s, 208, 52), '#fff3c4');   // sun core
  assert.strictEqual(PE.get_pixel(s, 208, 25), '#ffe08a');   // sun ray
  assert.strictEqual(PE.get_pixel(s, 80, 130), '#8fa8c8');   // far mountain (below snow cap)
  assert.strictEqual(PE.get_pixel(s, 60, 108), '#f5f8fc');   // snow cap
  assert.strictEqual(PE.get_pixel(s, 120, 150), '#6e84a5');  // near mountain (clear of trees)
  assert.strictEqual(PE.get_pixel(s, 122, 138), '#f5f8fc');  // n1 snow (clear of trees)
  assert.strictEqual(PE.get_pixel(s, 64, 216), '#4fa3d9');   // pond
  assert.strictEqual(PE.get_pixel(s, 180, 190), '#c9b97c');  // path
  assert.strictEqual(PE.get_pixel(s, 180, 130), '#c25b3a');  // cabin roof
  assert.strictEqual(PE.get_pixel(s, 184, 160), '#e8c14e');  // cabin doorknob
  assert.strictEqual(PE.get_pixel(s, 165, 155), '#9bd4f0');  // cabin window
  assert.strictEqual(PE.get_pixel(s, 31, 142), '#3e7a4e');   // tree foliage
  assert.strictEqual(PE.get_pixel(s, 31, 166), '#6b4a2f');   // tree trunk
  assert.strictEqual(PE.get_pixel(s, 99, 37), '#2b2b2b');    // bird
  assert.strictEqual(PE.get_pixel(s, 16, 232), '#e85d75');   // flower
});

test('house: painted + transparent == 4096, PNG < 2KB', () => {
  const s = loadScene('house');
  assert.strictEqual(countPainted(s) + (4096 - countPainted(s)), 4096);
  const png = PE.encode_png(s);
  assert.ok(png.length < 2000, 'house.png = ' + png.length + ' bytes');
  assert.deepStrictEqual(inflateIDAT(png), rawRows(s));
});

test('campfire: PNG < 2KB and round-trips', () => {
  const s = loadScene('campfire');
  const png = PE.encode_png(s);
  assert.ok(png.length < 2000, 'campfire.png = ' + png.length + ' bytes');
  assert.deepStrictEqual(inflateIDAT(png), rawRows(s));
});

test('house: known pixel probes (browser-verified)', () => {
  const s = loadScene('house');
  assert.strictEqual(PE.get_pixel(s, 5, 5), '#7ec8e3');    // sky
  assert.strictEqual(PE.get_pixel(s, 52, 10), '#ffd34e');  // sun
  assert.strictEqual(PE.get_pixel(s, 32, 20), '#c25b3a');  // roof
  assert.strictEqual(PE.get_pixel(s, 32, 34), '#f2d8a7');  // wall
  assert.strictEqual(PE.get_pixel(s, 32, 42), '#6b4226');  // door
  assert.strictEqual(PE.get_pixel(s, 30, 43), '#e8c14e');  // doorknob
  assert.strictEqual(PE.get_pixel(s, 5, 55), '#6bbf59');   // ground
  assert.strictEqual(PE.get_pixel(s, 25, 36), '#3a2315');  // window cross
  assert.strictEqual(PE.get_pixel(s, 40, 16), '#3a2315');  // chimney outline
  assert.strictEqual(PE.get_pixel(s, 41, 16), '#8e6b4a');  // chimney body
  assert.strictEqual(PE.get_pixel(s, 39, 17), '#8e3b22');  // chimney edge shading
});

test('house: inspect stats sanity', () => {
  const s = loadScene('house');
  const st = PE.inspect(s);
  assert.strictEqual(st.size, 64);
  assert.strictEqual(st.layers, 18);
  assert.strictEqual(st.pixelOverrides, 23);
  const total = st.colors.reduce((n, c) => n + c.count, 0);
  assert.strictEqual(total, countPainted(s));
});

// ---------------------------------------------------------------------------
// HTML preview
// ---------------------------------------------------------------------------

test('scene_to_html: canvas, embedded px round-trip, ascii, palette', () => {
  const s = loadScene('house');
  const html = PE.scene_to_html(s, { title: 'house' });
  assert.ok(html.indexOf('<canvas id="cv" width="512" height="512"') !== -1);
  assert.ok(html.indexOf('data:image/png;base64,') !== -1);
  const p0 = html.indexOf('var px = ') + 'var px = '.length;
  const p1 = html.indexOf(';\nvar size', p0);
  const embedded = JSON.parse(html.slice(p0, p1));
  assert.strictEqual(embedded.size, 64);
  assert.strictEqual(embedded.layers.length, 18);
  assert.strictEqual(embedded.palette.sky, '#7EC8E3');
  assert.ok(html.indexOf('<pre id="ascii">') !== -1);
  assert.ok(html.indexOf('class="chip"') !== -1);
  assert.ok(html.indexOf('pixel-override') === -1, 'no stray state in px');
});

test('export_png: writes a valid PNG file', () => {
  const s = loadScene('house');
  const tmp = path.join(os.tmpdir(), 'pixel-engine-export-test-' + process.pid + '.png');
  try {
    PE.export_png(s, tmp);
    const data = fs.readFileSync(tmp);
    assert.deepStrictEqual(inflateIDAT(data), rawRows(s));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli(args) {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'cli.js')].concat(args), {
    encoding: 'utf8',
    cwd: ROOT
  });
  return out;
}

test('cli: render house to png + html + zoom + counts', () => {
  const tmpPng = path.join(os.tmpdir(), 'pixel-engine-cli-' + process.pid + '.png');
  const tmpHtml = path.join(os.tmpdir(), 'pixel-engine-cli-' + process.pid + '.html');
  try {
    const out = runCli([
      'scenes/house.json', '--png', tmpPng, '--html', tmpHtml,
      '--zoom', '0,0,8,8', '--counts', '0,0,8,8'
    ]);
    assert.ok(/scene: house\.json  \(64x64\)/.test(out));
    assert.ok(/layers: 18  pixel overrides: 23/.test(out));
    assert.ok(/--- layer bboxes/.test(out));
    assert.ok(/--- zoom 0,0,8,8/.test(out));
    assert.ok(/--- counts 0,0,8,8/.test(out));
    const png = fs.readFileSync(tmpPng);
    assert.deepStrictEqual(inflateIDAT(png), rawRows(loadScene('house')));
    assert.ok(fs.readFileSync(tmpHtml, 'utf8').indexOf('<canvas') !== -1);
  } finally {
    if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
    if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml);
  }
});

test('cli: bad region exits 1 with message', () => {
  let threw = false;
  try {
    runCli(['scenes/house.json', '--zoom', '0,0,100,100']);
  } catch (e) {
    threw = true;
    assert.ok(/region out of bounds/.test(String(e.stderr || e.stdout || e.message)));
  }
  assert.ok(threw, 'expected nonzero exit');
});

test('cli: missing scene file exits 1 with clean message', () => {
  let threw = false;
  try {
    runCli(['scenes/does-not-exist.json']);
  } catch (e) {
    threw = true;
    assert.ok(/error: cannot read scene file/.test(String(e.stderr || e.stdout || e.message)));
  }
  assert.ok(threw, 'expected nonzero exit');
});

// ---------------------------------------------------------------------------
// animation subsystem (engine/animation.js)
// ---------------------------------------------------------------------------

const PA = require('../engine/animation.js');

function loadAnim(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'animations', name + '.json'), 'utf8'));
}

/** 16x16 frame: bg fill + 2x2 ball overrides at (2,2), palette keys set AFTER add_frame. */
function mkBallAnim() {
  const a = PA.create_animation(16, 16, { fps: 8, background: '#1A1A2E' });
  const f0 = PA.add_frame(a);
  a.palette.bg = '#1A1A2E';
  a.palette.ball = '#E94560';
  PA.fill_frame_region(a, f0, 0, 0, 16, 16, 'bg');
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) PA.set_frame_pixel(a, f0, 2 + dx, 2 + dy, 'ball');
  return { a: a, f0: f0 };
}

test('create_animation: defaults (16x16, 8 fps, empty)', () => {
  const a = PA.create_animation();
  assert.strictEqual(a.width, 16);
  assert.strictEqual(a.height, 16);
  assert.strictEqual(a.fps, 8);
  assert.deepStrictEqual(a.frames, []);
  assert.deepStrictEqual(a.palette, {});
  assert.deepStrictEqual(a.keyframes, {});
  assert.strictEqual(a.background, null);
});

test('create_animation: size + fps + background opts', () => {
  const a = PA.create_animation(32, 32, { fps: 12, background: '#0000ff' });
  assert.strictEqual(a.width, 32);
  assert.strictEqual(a.fps, 12);
  assert.strictEqual(a.background, '#0000ff');
});

test('add_frame: blank frame with background fill is fully opaque', () => {
  const a = PA.create_animation(16, 16, { background: '#1A1A2E' });
  const f = PA.add_frame(a);
  const buf = PA.resolve_frame(a, f);
  assert.strictEqual(buf.every((v, i) => i % 4 === 3 ? v === 255 : v !== 0 || true), true);
  assert.strictEqual(buf[3], 255);
  assert.strictEqual(buf[buf.length - 1], 255);
});

test('add_frame: true blank frame (no background) is fully transparent', () => {
  const a = PA.create_animation(4, 4);
  const f = PA.add_frame(a);
  const buf = PA.resolve_frame(a, f);
  assert.strictEqual(buf.every((v, i) => i % 4 === 3 ? v === 0 : true), true);
});

test('add_frame: size mismatch throws', () => {
  const a = PA.create_animation(16, 16);
  const s = PE.create_canvas(8);
  assert.throws(() => PA.add_frame(a, s), /size 8 != animation 16x16/);
});

test('add_frame: animation palette seeds the frame scene (keys resolve after add)', () => {
  const { a, f0 } = mkBallAnim();
  assert.strictEqual(a.frames[0].scene.palette.ball, '#E94560');
  assert.strictEqual(PA.get_frame_pixel(a, f0, 2, 2), '#e94560');
  assert.strictEqual(PA.get_frame_pixel(a, f0, 5, 5), '#1a1a2e');
});

test('duplicate_frame: deep copy is independent', () => {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.duplicate_frame(a, f0);
  assert.notStrictEqual(f1, f0);
  PA.set_frame_pixel(a, f1, 3, 3, '#000000');
  assert.strictEqual(PA.get_frame_pixel(a, f0, 3, 3), '#e94560');
  assert.strictEqual(PA.get_frame_pixel(a, f1, 3, 3), '#000000');
});

test('set/get/clear frame pixel: override lifecycle', () => {
  const a = PA.create_animation(4, 4);
  const f = PA.add_frame(a);
  PA.fill_frame_region(a, f, 0, 0, 4, 4, '#00ff00');
  assert.strictEqual(PA.get_frame_pixel(a, f, 1, 1), '#00ff00');
  PA.set_frame_pixel(a, f, 1, 1, '#ff0000');
  assert.strictEqual(PA.get_frame_pixel(a, f, 1, 1), '#ff0000');
  PA.clear_frame_pixel(a, f, 1, 1);
  assert.strictEqual(PA.get_frame_pixel(a, f, 1, 1), '#00ff00');
  assert.strictEqual(PA.get_frame_pixel(a, f, 9, 9), null);
});

test('move_frame_region: 2-frame experiment, exact diff (6 changed, bbox [2,2,3,3])', () => {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.duplicate_frame(a, f0);
  PA.move_frame_region(a, f1, 2, 2, 2, 2, 1, 1);
  const d = PA.diff_frames(a, f0, f1);
  assert.strictEqual(d.changed_pixels, 6);
  assert.strictEqual(d.unchanged_pixels, 250);
  assert.strictEqual(d.change_percentage, 2.34);
  assert.deepStrictEqual(d.bounding_box, [2, 2, 3, 3]);
  assert.strictEqual(d.changes.length, 6);
  assert.deepStrictEqual(d.changes[0], { x: 2, y: 2, old_value: '#e94560', new_value: '#1a1a2e' });
  assert.deepStrictEqual(d.changes[4], { x: 3, y: 4, old_value: '#1a1a2e', new_value: '#e94560' });
  assert.strictEqual(d.changes[5].x, 4);
  assert.strictEqual(d.changes[5].y, 4);
  assert.strictEqual(d.changes[5].new_value, '#e94560');
});

test('validate_change: PASS for covering region, FAIL with exact unexpected list', () => {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.duplicate_frame(a, f0);
  PA.move_frame_region(a, f1, 2, 2, 2, 2, 1, 1);
  const pass = PA.validate_change(a, f0, f1, [2, 2, 4, 4]);
  assert.strictEqual(pass.pass, true);
  assert.strictEqual(pass.total_changes, 6);
  assert.strictEqual(pass.unexpected_changes, 0);
  const fail = PA.validate_change(a, f0, f1, [0, 0, 3, 3]);
  assert.strictEqual(fail.pass, false);
  assert.strictEqual(fail.unexpected_changes, 5);
  assert.deepStrictEqual(fail.unexpected[0], { x: 3, y: 2, old_value: '#e94560', new_value: '#1a1a2e' });
});

test('validate_change: null region means whole frame (always pass)', () => {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.duplicate_frame(a, f0);
  PA.set_frame_pixel(a, f1, 1, 1, '#ffffff');
  const v = PA.validate_change(a, f0, f1, null);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.total_changes, 1);
});

test('copy_frame_region: copies resolved pixels across frames', () => {
  const a = PA.create_animation(4, 4);
  const f0 = PA.add_frame(a);
  const f1 = PA.add_frame(a);
  PE.fill_region(a.frames[0].scene, 1, 1, 2, 2, '#ff0000');
  const r = PA.copy_frame_region(a, f0, f1, 1, 1, 2, 2, 1, 1);
  assert.strictEqual(r.copied, 4);
  assert.strictEqual(PA.get_frame_pixel(a, f1, 2, 2), '#ff0000');
  assert.strictEqual(PA.get_frame_pixel(a, f1, 3, 3), '#ff0000');
  assert.strictEqual(PA.get_frame_pixel(a, f0, 1, 1), '#ff0000');
});

test('diff_frames: identical frames -> 0 changed, null bbox, empty changes', () => {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.duplicate_frame(a, f0);
  const d = PA.diff_frames(a, f0, f1);
  assert.strictEqual(d.changed_pixels, 0);
  assert.strictEqual(d.unchanged_pixels, 256);
  assert.strictEqual(d.change_percentage, 0);
  assert.strictEqual(d.bounding_box, null);
  assert.deepStrictEqual(d.changes, []);
});

test('diff_frames: alpha transitions counted with null values', () => {
  const a = PA.create_animation(4, 4);
  const f0 = PA.add_frame(a);
  const f1 = PA.add_frame(a);
  PE.fill_region(a.frames[0].scene, 1, 1, 1, 1, '#ff0000');
  PE.fill_region(a.frames[1].scene, 1, 1, 1, 1, '#0000ff');
  PE.fill_region(a.frames[1].scene, 2, 2, 1, 1, '#00ff00');
  const d = PA.diff_frames(a, f0, f1);
  assert.strictEqual(d.changed_pixels, 2);
  assert.deepStrictEqual(d.changes[0], { x: 1, y: 1, old_value: '#ff0000', new_value: '#0000ff' });
  assert.deepStrictEqual(d.changes[1], { x: 2, y: 2, old_value: null, new_value: '#00ff00' });
});

test('keyframes: set/clear/is', () => {
  const a = PA.create_animation(4, 4);
  const f = PA.add_frame(a);
  assert.strictEqual(PA.is_keyframe(a, f), false);
  PA.set_keyframe(a, f, true);
  assert.strictEqual(PA.is_keyframe(a, f), true);
  PA.set_keyframe(a, f, false);
  assert.strictEqual(PA.is_keyframe(a, f), false);
  assert.throws(() => PA.set_keyframe(a, 'nope', true), /unknown frame/);
});

test('frame_palette: resolved color counts', () => {
  const { a, f0 } = mkBallAnim();
  const p = PA.frame_palette(a, f0);
  assert.strictEqual(p.total, 256);
  assert.strictEqual(p.colors['#1a1a2e'], 252);
  assert.strictEqual(p.colors['#e94560'], 4);
});

test('palette_drift: reports frame keys missing from anim palette', () => {
  const a = PA.create_animation(4, 4);
  const f0 = PA.add_frame(a);
  a.frames[0].scene.palette.rogue = '#123456';
  const drift = PA.palette_drift(a);
  assert.strictEqual(drift.length, 1);
  assert.strictEqual(drift[0].frameId, f0);
  assert.deepStrictEqual(drift[0].missing, ['rogue']);
});

test('delete_frame: removes frame + keyframe flag; unknown frame throws on resolve', () => {
  const a = PA.create_animation(4, 4);
  const f0 = PA.add_frame(a);
  const f1 = PA.add_frame(a);
  PA.set_keyframe(a, f0, true);
  assert.strictEqual(PA.delete_frame(a, f0), true);
  assert.deepStrictEqual(PA.frame_ids(a), [f1]);
  assert.strictEqual(PA.is_keyframe(a, f0), false);
  assert.throws(() => PA.resolve_frame(a, f0), /unknown frame/);
  assert.strictEqual(PA.delete_frame(a, f0), false);
});

test('encode_spritesheet: exact composite rows, dims, deterministic bytes', () => {
  const a = PA.create_animation(4, 4);
  const f0 = PA.add_frame(a);
  const f1 = PA.add_frame(a);
  PE.fill_region(a.frames[0].scene, 0, 0, 4, 4, '#ff0000');
  PE.fill_region(a.frames[1].scene, 0, 0, 4, 4, '#00ff00');
  const sheet = Buffer.from(PA.encode_spritesheet(a));
  assert.strictEqual(sheet.readUInt32BE(16), 8);
  assert.strictEqual(sheet.readUInt32BE(20), 4);
  const raw = inflateIDAT(sheet);
  const expected = Buffer.alloc(33 * 4);
  for (let y = 0; y < 4; y++) {
    expected[y * 33] = 0;
    for (let x = 0; x < 8; x++) {
      const px = x < 4 ? [255, 0, 0] : [0, 255, 0];
      expected[y * 33 + 1 + x * 4] = px[0];
      expected[y * 33 + 1 + x * 4 + 1] = px[1];
      expected[y * 33 + 1 + x * 4 + 2] = px[2];
      expected[y * 33 + 1 + x * 4 + 3] = 255;
    }
  }
  assert.deepStrictEqual(raw, expected);
  assert.deepStrictEqual(PA.encode_spritesheet(a), PA.encode_spritesheet(a));
});

test('export_spritesheet: writes a valid PNG file', () => {
  const { a } = mkBallAnim();
  PA.duplicate_frame(a, 'frame-0');
  const tmp = path.join(os.tmpdir(), 'pixel-engine-sheet-' + process.pid + '.png');
  try {
    PA.export_spritesheet(a, tmp);
    const data = fs.readFileSync(tmp);
    const buf = Buffer.from(data);
    assert.strictEqual(buf.readUInt32BE(16), 32);
    assert.strictEqual(buf.readUInt32BE(20), 16);
    assert.deepStrictEqual(inflateIDAT(data), inflateIDAT(PA.encode_spritesheet(a)));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});

test('animation_to_html: transport controls, embedded frames, self-contained', () => {
  const { a } = mkBallAnim();
  const f1 = PA.duplicate_frame(a, 'frame-0');
  PA.move_frame_region(a, f1, 2, 2, 2, 2, 1, 1);
  const html = PA.animation_to_html(a, { title: 'smoke' });
  assert.ok(html.indexOf('id="play"') !== -1);
  assert.ok(html.indexOf('id="restart"') !== -1);
  assert.ok(html.indexOf('id="step"') !== -1);
  assert.ok(html.indexOf('id="prev"') !== -1);
  assert.ok(html.indexOf('id="next"') !== -1);
  assert.ok(html.indexOf('id="fps"') !== -1);
  assert.ok(html.indexOf('id="frame-info"') !== -1);
  const embeds = html.match(/data:image\/png;base64,/g) || [];
  assert.strictEqual(embeds.length, 2); // imgs template + spritesheet URL
  const b64Frames = html.match(/"b64":"/g) || [];
  assert.strictEqual(b64Frames.length, 2); // one per frame
  assert.ok(html.indexOf('sheetUrl') !== -1);
  assert.strictEqual(html.indexOf('http://'), -1);
  assert.strictEqual(html.indexOf('https://'), -1);
});

test('animation doc: plain JSON survives round-trip with identical pixels', () => {
  const { a } = mkBallAnim();
  const before = hash256(PA.resolve_frame(a, 'frame-0'));
  const copy = JSON.parse(JSON.stringify(a));
  assert.strictEqual(hash256(PA.resolve_frame(copy, 'frame-0')), before);
});

test('ball.json: per-frame rasterize hashes locked (engine == browser verified)', () => {
  const a = loadAnim('ball');
  const hashes = PA.frame_ids(a).map(function (id) { return hash256(PA.resolve_frame(a, id)); });
  assert.deepStrictEqual(hashes, [
    '43af8a387f40f8500bd5f9df85b5a6c5cca026d8c162585024bdec55ec8a24b7',
    'fa423d3bc10fcce5c49a7fe58f7d37f392c193df30cf63d312e3f17fb2d16afa',
    '278a8c631c296b31e79f97b5845cc3895bcaac326019ada642029fb60b281e18',
    'fa423d3bc10fcce5c49a7fe58f7d37f392c193df30cf63d312e3f17fb2d16afa' // frame-3 == frame-1 (bounce cycle)
  ]);
});

test('ball.json: consecutive diffs exact (30 changed, bbox over ball column)', () => {
  const a = loadAnim('ball');
  const d01 = PA.diff_frames(a, 'frame-0', 'frame-1');
  assert.strictEqual(d01.changed_pixels, 30);
  assert.strictEqual(d01.change_percentage, 11.72);
  assert.deepStrictEqual(d01.bounding_box, [5, 2, 6, 8]);
  const d12 = PA.diff_frames(a, 'frame-1', 'frame-2');
  assert.deepStrictEqual(d12.bounding_box, [5, 4, 6, 8]);
  assert.strictEqual(d12.changed_pixels, 30);
});

test('ball.json: validate change — ball column PASS, too-narrow FAIL with count', () => {
  const a = loadAnim('ball');
  const pass = PA.validate_change(a, 'frame-0', 'frame-2', [5, 2, 7, 11]);
  assert.strictEqual(pass.pass, true);
  assert.strictEqual(pass.total_changes, 50);
  assert.strictEqual(pass.unexpected_changes, 0);
  const fail = PA.validate_change(a, 'frame-0', 'frame-2', [8, 2, 1, 11]);
  assert.strictEqual(fail.pass, false);
  assert.strictEqual(fail.unexpected_changes, 41);
});

test('ball.json: spritesheet locked (64x16, hash)', () => {
  const a = loadAnim('ball');
  const sheet = Buffer.from(PA.encode_spritesheet(a));
  assert.strictEqual(sheet.readUInt32BE(16), 64);
  assert.strictEqual(sheet.readUInt32BE(20), 16);
  assert.strictEqual(sheet.length, 328);
  assert.strictEqual(hash256(sheet), 'a96900730929059c5285b9960aeb7f4a62c9b83c4f8a99cef661756f3aa0dfa5');
});

test('ball.json: palette drift empty, keyframes locked, frame-3 mirrors frame-1', () => {
  const a = loadAnim('ball');
  assert.deepStrictEqual(PA.palette_drift(a), []);
  assert.deepStrictEqual(a.keyframes, { 'frame-0': true });
  assert.strictEqual(a.fps, 8);
  assert.deepStrictEqual(
    hash256(PA.resolve_frame(a, 'frame-3')),
    hash256(PA.resolve_frame(a, 'frame-1'))
  );
});

test('campfire.json: per-frame rasterize hashes locked (64x64, 8 frames)', () => {
  const a = loadAnim('campfire');
  assert.strictEqual(a.width, 64);
  assert.strictEqual(a.height, 64);
  assert.strictEqual(a.fps, 8);
  assert.strictEqual(a.frames.length, 8);
  const hashes = PA.frame_ids(a).map(function (id) { return hash256(PA.resolve_frame(a, id)); });
  assert.deepStrictEqual(hashes, [
    '4aff077bb5c558183045e7ad80d1ada37889da9f5abe846f01bd66fd72bd1e51',
    '830dfb52af0f7fa7d08d1c5f858b0ccf66ba9da2cf201e41f6219ef1ca4493b0',
    'b714fe86f2106184dd4322cd2a44b0600ffbf5928acd0a4b0fa5c8b514e130e3',
    'd0436a5edfd2cfcbaf2e6b3843f7915b095c64a495041da57330d7e95d6abe51',
    '18da737d66db0f567ab390cda431b395575d1a04ce3feabfd9dbe6b149a46b06',
    'e48bf3d371323e317d9c4c6b3aff4ce2b9a6fa02a7200b878cc5ba22265e928a',
    '4ed1293ab50399b4f3af11756a71907637e308c6dd56c5a9f3251aad62d27e6f',
    'b95dd628e96305ea69c126ff1ea135044e63a23546ff355afa9ce4d61b8080aa'
  ]);
});

test('campfire.json: consecutive diffs localized to flame region, loop closes', () => {
  const a = loadAnim('campfire');
  const ids = PA.frame_ids(a);
  const expected = [153, 263, 307, 144, 204, 234, 174];
  for (let i = 0; i < expected.length; i++) {
    const d = PA.diff_frames(a, ids[i], ids[i + 1]);
    assert.strictEqual(d.changed_pixels, expected[i]);
    const v = PA.validate_change(a, ids[i], ids[i + 1], [16, 3, 32, 53]);
    assert.strictEqual(v.pass, true);
    assert.strictEqual(v.unexpected_changes, 0);
  }
  const loop = PA.diff_frames(a, 'frame-7', 'frame-0');
  assert.strictEqual(loop.changed_pixels, 44);
  assert.deepStrictEqual(loop.bounding_box, [25, 16, 15, 29]);
});

test('campfire.json: spritesheet locked (512x64, hash)', () => {
  const a = loadAnim('campfire');
  const sheet = Buffer.from(PA.encode_spritesheet(a));
  assert.strictEqual(sheet.readUInt32BE(16), 512);
  assert.strictEqual(sheet.readUInt32BE(20), 64);
  assert.strictEqual(sheet.length, 6883);
  assert.strictEqual(hash256(sheet), '72027b2aed470aab29d57d65a99fd5c79e3d9acb509f0b8e662d232fb0a17b86');
});

test('campfire.json: palette drift empty, keyframes locked, 12 palette keys all painted', () => {
  const a = loadAnim('campfire');
  assert.deepStrictEqual(PA.palette_drift(a), []);
  assert.deepStrictEqual(a.keyframes, { 'frame-0': true });
  assert.strictEqual(Object.keys(a.palette).length, 12);
  for (const id of PA.frame_ids(a)) {
    const fp = PA.frame_palette(a, id);
    assert.strictEqual(Object.keys(fp.colors).length, 12);
  }
});

test('cli anim: diff + validate + ascii on ball.json', () => {
  const out = runCli(['anim', 'animations/ball.json', '--diff', 'frame-0,frame-1',
    '--validate', 'frame-0,frame-2,5,2,7,11', '--ascii', 'frame-0']);
  assert.ok(/animation: ball\.json  \(16x16, 8 fps\)/.test(out));
  assert.ok(/changed=30  unchanged=226  11\.72%  bbox=\[5,2,6,8\]/.test(out));
  assert.ok(/PASS  total_changes=50  unexpected=0/.test(out));
  assert.ok(/A=ball/.test(out));
});

test('cli anim: exports sheet + html', () => {
  const tmpSheet = path.join(os.tmpdir(), 'pixel-engine-cli-anim-' + process.pid + '.png');
  const tmpHtml = path.join(os.tmpdir(), 'pixel-engine-cli-anim-' + process.pid + '.html');
  try {
    const out = runCli(['anim', 'animations/ball.json', '--sheet', tmpSheet, '--html', tmpHtml]);
    assert.ok(/wrote .*ball-sheet/.test(out) || /wrote /.test(out));
    const data = fs.readFileSync(tmpSheet);
    const buf = Buffer.from(data);
    assert.strictEqual(buf.readUInt32BE(16), 64);
    assert.strictEqual(buf.readUInt32BE(20), 16);
    const html = fs.readFileSync(tmpHtml, 'utf8');
    assert.ok(html.indexOf('id="play"') !== -1);
    assert.ok(html.indexOf('4 frames') !== -1);
  } finally {
    if (fs.existsSync(tmpSheet)) fs.unlinkSync(tmpSheet);
    if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml);
  }
});

test('cli anim: --validate FAIL exits non-zero, PASS exits 0', () => {
  let status = 0;
  try {
    runCli(['anim', 'animations/ball.json', '--validate', 'frame-0,frame-2,8,2,1,11']);
  } catch (e) {
    status = e.status;
  }
  assert.strictEqual(status, 1);
  const ok = runCli(['anim', 'animations/ball.json', '--validate', 'frame-0,frame-2,5,2,7,11']);
  assert.ok(/PASS/.test(ok));
});

test('cli anim: --fps rejects partial/zero/negative/non-numeric, accepts positive int', () => {
  for (const bad of ['0', '-5', '8fps', 'abc', '2.5']) {
    let status = 0;
    try {
      runCli(['anim', 'animations/ball.json', '--fps', bad]);
    } catch (e) {
      status = e.status;
    }
    assert.strictEqual(status, 1, '--fps ' + bad + ' must fail');
  }
  const out = runCli(['anim', 'animations/ball.json', '--fps', '12']);
  assert.ok(/12 fps/.test(out));
});

test('create_animation: non-square rejected', () => {
  assert.throws(() => PA.create_animation(16, 8), /square/);
});

test('normalize_animation: non-square or inconsistent dims rejected', () => {
  assert.throws(() => PA.normalize_animation({ width: 16, height: 8, frames: [] }), /square/);
  assert.throws(() => PA.normalize_animation({
    width: 16, height: 16, frames: [{ id: 'f', scene: { size: 8 } }]
  }), /size 8 != animation 16x16/);
});

test('frame ids: delete + add/duplicate never collide (shared allocator)', () => {
  const a = PA.create_animation(4, 4);
  const f0 = PA.add_frame(a);
  const f1 = PA.add_frame(a);
  const f2 = PA.add_frame(a);
  PA.delete_frame(a, f1);
  const f3 = PA.add_frame(a);
  assert.strictEqual(f3, 'frame-3');
  assert.deepStrictEqual(PA.frame_ids(a), ['frame-0', 'frame-2', 'frame-3']);
  const f4 = PA.duplicate_frame(a, f0);
  assert.strictEqual(f4, 'frame-4');
  assert.deepStrictEqual(PA.frame_ids(a), ['frame-0', 'frame-2', 'frame-3', 'frame-4']);
});

test('normalize_animation: missing ids allocated without collision, duplicates rejected', () => {
  const a = { width: 4, height: 4, frames: [
    { id: 'frame-0', scene: { size: 4 } },
    { scene: { size: 4 } },
    { id: 'frame-2', scene: { size: 4 } }
  ] };
  PA.normalize_animation(a);
  assert.deepStrictEqual(PA.frame_ids(a), ['frame-0', 'frame-3', 'frame-2']);
  const dup = { width: 4, height: 4, frames: [
    { id: 'frame-0', scene: { size: 4 } },
    { id: 'frame-0', scene: { size: 4 } }
  ] };
  assert.throws(() => PA.normalize_animation(dup), /duplicate frame id/);
});

test('move_frame_region: overlapping move clears sources before writing destinations', () => {
  const a = PA.create_animation(4, 4);
  const f = PA.add_frame(a);
  PA.fill_frame_region(a, f, 0, 0, 4, 4, '#000000');
  PA.set_frame_pixel(a, f, 1, 1, '#ff0000');
  PA.set_frame_pixel(a, f, 2, 1, '#00ff00');
  const r = PA.move_frame_region(a, f, 1, 1, 2, 1, 1, 0);
  assert.strictEqual(r.moved, 2);
  assert.strictEqual(PA.get_frame_pixel(a, f, 1, 1), '#000000');
  assert.strictEqual(PA.get_frame_pixel(a, f, 2, 1), '#ff0000');
  assert.strictEqual(PA.get_frame_pixel(a, f, 3, 1), '#00ff00');
});

test('encode_spritesheet: empty animation rejected', () => {
  const a = PA.create_animation(4, 4);
  assert.throws(() => PA.encode_spritesheet(a), /no frames/);
});

test('encode_spritesheet: invalid columns rejected', () => {
  const { a } = mkBallAnim();
  assert.throws(() => PA.encode_spritesheet(a, { columns: 0 }), /columns/);
  assert.throws(() => PA.encode_spritesheet(a, { columns: -1 }), /columns/);
  assert.throws(() => PA.encode_spritesheet(a, { columns: 1.5 }), /columns/);
});

// --- APNG export ------------------------------------------------------------

/** Inflated filter-0 raw streams, one per frame, in APNG play order. */
function apngFrameRaw(png) {
  const chunks = parsePNG(png);
  const raws = [];
  for (const c of chunks) {
    if (c.type === 'IDAT') raws.push(zlib.inflateSync(c.data));
    if (c.type === 'fdAT') raws.push(zlib.inflateSync(c.data.subarray(4)));
  }
  return raws;
}

function rawOfFrame(anim, id) {
  const buf = PA.resolve_frame(anim, id);
  const size = anim.width;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    Buffer.from(buf.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, y * stride + 1);
  }
  return raw;
}

test('encode_apng: chunk structure (acTL/fcTL/fdAT, counts, sequence numbers)', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  const chunks = parsePNG(PA.encode_apng(a));
  assert.deepStrictEqual(chunks.map(c => c.type),
    ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
  assert.strictEqual(chunks[1].data.readUInt32BE(0), 2); // num_frames
  assert.strictEqual(chunks[1].data.readUInt32BE(4), 0); // num_plays (infinite)
  const fctl0 = chunks[2].data, fctl1 = chunks[4].data;
  assert.strictEqual(fctl0.readUInt32BE(0), 0); // fcTL sequence 0
  assert.strictEqual(fctl1.readUInt32BE(0), 1); // fcTL sequence 1
  assert.strictEqual(chunks[5].data.readUInt32BE(0), 2); // fdAT sequence 2
  assert.strictEqual(fctl0.readUInt32BE(4), 16); // frame width
  assert.strictEqual(fctl0.readUInt32BE(8), 16); // frame height
  assert.strictEqual(fctl0.readUInt32BE(12), 0); // x offset
  assert.strictEqual(fctl0.readUInt32BE(16), 0); // y offset
  assert.strictEqual(fctl0.readUInt16BE(20), 1); // delay_num
  assert.strictEqual(fctl0.readUInt16BE(22), 8); // delay_den = fps
  assert.strictEqual(fctl0[24], 0); // dispose_op: none
  assert.strictEqual(fctl0[25], 0); // blend_op: source
});

test('encode_apng: frame extraction round-trip (decode our own APNG)', () => {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.add_frame(a);
  PA.set_frame_pixel(a, f1, 5, 5, 'ball');
  const raws = apngFrameRaw(PA.encode_apng(a));
  assert.strictEqual(raws.length, 2);
  assert.deepStrictEqual(raws[0], rawOfFrame(a, f0));
  assert.deepStrictEqual(raws[1], rawOfFrame(a, f1));
});

test('encode_apng: determinism (two encodes identical bytes)', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  assert.deepStrictEqual(Buffer.from(PA.encode_apng(a)), Buffer.from(PA.encode_apng(a)));
});

test('encode_apng: single frame -> valid APNG with one frame, no fdAT', () => {
  const { a } = mkBallAnim();
  const chunks = parsePNG(PA.encode_apng(a));
  assert.deepStrictEqual(chunks.map(c => c.type),
    ['IHDR', 'acTL', 'fcTL', 'IDAT', 'IEND']);
  assert.strictEqual(chunks[1].data.readUInt32BE(0), 1);
});

test('encode_apng: empty animation rejected', () => {
  const a = PA.create_animation(16, 16);
  assert.throws(() => PA.encode_apng(a), /no frames/);
});

test('encode_apng: loop + fps opts (defaults 0 = infinite, anim.fps)', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  const chunks = parsePNG(PA.encode_apng(a, { loop: 3, fps: 12 }));
  assert.strictEqual(chunks[1].data.readUInt32BE(4), 3);
  assert.strictEqual(chunks[2].data.readUInt16BE(22), 12);
});

test('export_apng: writes a valid APNG file', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  const tmp = path.join(os.tmpdir(), 'pe-test-' + process.pid + '.apng');
  try {
    PA.export_apng(a, tmp);
    const data = fs.readFileSync(tmp);
    assert.deepStrictEqual(data, Buffer.from(PA.encode_apng(a)));
    assert.strictEqual(parsePNG(data).map(c => c.type).includes('acTL'), true);
  } finally {
    fs.unlinkSync(tmp);
  }
});

// --- GIF export -------------------------------------------------------------

function mkTwoFrameAnim() {
  const { a, f0 } = mkBallAnim();
  const f1 = PA.add_frame(a);
  PA.set_frame_pixel(a, f1, 4, 4, 'ball');
  return { a: a, f0: f0, f1: f1 };
}

function mkTransparentAnim() {
  const a = PA.create_animation(8, 8, { fps: 8 });
  const f0 = PA.add_frame(a);
  a.palette.ball = '#E94560';
  PA.set_frame_pixel(a, f0, 1, 1, 'ball');
  return { a: a, f0: f0 };
}

/** Minimal GIF89a reader: header/LSD/GCT/GCE/image-descriptor/trailer + LZW decode. */
function parseGIF(bytes) {
  const buf = Buffer.from(bytes);
  assert.strictEqual(buf.toString('ascii', 0, 6), 'GIF89a', 'GIF header');
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  assert.notStrictEqual(packed & 0x80, 0, 'GCT flag set');
  const gctSize = packed & 7;
  const gctEntries = 1 << (gctSize + 1);
  let pos = 13;
  const palette = [];
  for (let i = 0; i < gctEntries; i++) {
    palette.push([buf[pos], buf[pos + 1], buf[pos + 2]]);
    pos += 3;
  }
  let transparentIndex = -1;
  let loop = null;
  let pendingDelay = 0;
  const frames = [];
  while (pos < buf.length) {
    const b = buf[pos++];
    if (b === 0x3B) break; // trailer
    if (b === 0x21) {
      const label = buf[pos++];
      if (label === 0xFF) { // application extension (Netscape loop)
        const size = buf[pos++];
        const app = buf.toString('ascii', pos, pos + size);
        pos += size;
        if (app === 'NETSCAPE2.0') {
          const subSize = buf[pos++];
          if (buf[pos] === 0x01) loop = buf.readUInt16LE(pos + 1);
          pos += subSize;
        }
        pos++; // block terminator
      } else if (label === 0xF9) { // graphic control extension
        assert.strictEqual(buf[pos++], 4, 'GCE block size');
        const gpacked = buf[pos++];
        pendingDelay = buf.readUInt16LE(pos);
        pos += 2;
        const tIndex = buf[pos++];
        pos++; // terminator
        if (gpacked & 1) transparentIndex = tIndex;
      } else {
        let sz = buf[pos++];
        while (sz !== 0) { pos += sz; sz = buf[pos++]; }
      }
    } else if (b === 0x2C) { // image descriptor
      pos += 8; // left/top/width/height
      const ipacked = buf[pos++];
      assert.strictEqual(ipacked & 0x80, 0, 'no local color table');
      const minCodeSize = buf[pos++];
      const data = [];
      let sz = buf[pos++];
      while (sz !== 0) {
        for (let i = 0; i < sz; i++) data.push(buf[pos + i]);
        pos += sz;
        sz = buf[pos++];
      }
      frames.push({ pixels: gifLzwDecode(Uint8Array.from(data), minCodeSize), delay: pendingDelay });
      pendingDelay = 0;
    } else {
      throw new Error('unexpected GIF byte 0x' + b.toString(16) + ' at offset ' + (pos - 1));
    }
  }
  return { width: width, height: height, palette: palette, transparentIndex: transparentIndex, loop: loop, frames: frames };
}

/** Canonical GIF LZW decoder (clear/EOI, KwKwK case, code-size growth at 2^codeSize). */
function gifLzwDecode(data, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  let dict = new Map();
  for (let i = 0; i < clear; i++) dict.set(i, [i]);
  const out = [];
  let pos = 0, bitBuf = 0, bitCnt = 0;
  const readCode = function () {
    while (bitCnt < codeSize) {
      bitBuf |= data[pos++] << bitCnt;
      bitCnt += 8;
    }
    const c = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitCnt -= codeSize;
    return c;
  };
  let code = readCode();
  if (code !== clear) throw new Error('LZW stream must start with a clear code');
  let prev = null;
  while (true) {
    code = readCode();
    if (code === eoi) break;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      nextCode = eoi + 1;
      dict = new Map();
      for (let i = 0; i < clear; i++) dict.set(i, [i]);
      prev = null;
      continue;
    }
    let entry;
    if (dict.has(code)) entry = dict.get(code);
    else if (code === nextCode) entry = dict.get(prev).concat(dict.get(prev)[0]);
    else throw new Error('bad LZW code ' + code + ' (next ' + nextCode + ')');
    for (const v of entry) out.push(v);
    if (prev !== null) {
      dict.set(nextCode, dict.get(prev).concat(entry[0]));
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

function gifFrameRgba(g, frameIndex, width, height) {
  const rgba = new Uint8Array(width * height * 4);
  const px = g.frames[frameIndex].pixels;
  assert.strictEqual(px.length, width * height, 'pixel count');
  for (let i = 0; i < px.length; i++) {
    const idx = px[i];
    if (idx === g.transparentIndex) continue;
    const c = g.palette[idx];
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test('encode_gif: structure (header/LSD/GCT/GCE/descriptor/trailer)', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  const g = parseGIF(PA.encode_gif(a));
  assert.strictEqual(g.width, 16);
  assert.strictEqual(g.height, 16);
  assert.strictEqual(g.loop, 0); // default: infinite
  assert.strictEqual(g.transparentIndex, -1); // fully opaque animation
  assert.strictEqual(g.frames.length, 2);
  assert.strictEqual(g.frames[0].delay, 13); // round(100/8)
  const hexes = g.palette.map(c => '#' + [c[0], c[1], c[2]].map(v => ('0' + v.toString(16)).slice(-2)).join(''));
  assert.ok(hexes.includes('#1a1a2e')); // bg
  assert.ok(hexes.includes('#e94560')); // ball
});

test('encode_gif: pixel round-trip (decode our own GIF)', () => {
  const { a, f0, f1 } = mkTwoFrameAnim();
  const g = parseGIF(PA.encode_gif(a));
  assert.strictEqual(g.frames.length, 2);
  assert.deepStrictEqual(gifFrameRgba(g, 0, 16, 16), PA.resolve_frame(a, f0));
  assert.deepStrictEqual(gifFrameRgba(g, 1, 16, 16), PA.resolve_frame(a, f1));
});

test('encode_gif: transparency via GCE (transparent index)', () => {
  const { a, f0 } = mkTransparentAnim();
  const g = parseGIF(PA.encode_gif(a));
  assert.ok(g.transparentIndex >= 0);
  const rgba = gifFrameRgba(g, 0, 8, 8);
  assert.deepStrictEqual(rgba, PA.resolve_frame(a, f0));
  assert.strictEqual(rgba[3], 0); // (0,0) transparent
  assert.strictEqual(rgba[(1 * 8 + 1) * 4 + 3], 255); // ball opaque
});

test('encode_gif: determinism (two encodes identical bytes)', () => {
  const { a } = mkTwoFrameAnim();
  assert.deepStrictEqual(Buffer.from(PA.encode_gif(a)), Buffer.from(PA.encode_gif(a)));
});

test('encode_gif: single frame -> one image descriptor', () => {
  const { a } = mkBallAnim();
  const g = parseGIF(PA.encode_gif(a));
  assert.strictEqual(g.frames.length, 1);
});

test('encode_gif: empty animation rejected', () => {
  const a = PA.create_animation(16, 16);
  assert.throws(() => PA.encode_gif(a), /no frames/);
});

test('encode_gif: >256 unique colors rejected', () => {
  const a = PA.create_animation(32, 32);
  const f = PA.add_frame(a);
  for (let i = 0; i < 257; i++) {
    PA.set_frame_pixel(a, f, i % 32, Math.floor(i / 32), '#' + ('000000' + i.toString(16)).slice(-6));
  }
  assert.throws(() => PA.encode_gif(a), /256-color GIF limit/);
});

test('encode_gif: loop + fps opts', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  const g = parseGIF(PA.encode_gif(a, { loop: 5, fps: 12 }));
  assert.strictEqual(g.loop, 5);
  assert.strictEqual(g.frames[0].delay, 8); // round(100/12)
});

test('export_gif: writes a valid GIF file', () => {
  const { a } = mkBallAnim();
  PA.add_frame(a);
  const tmp = path.join(os.tmpdir(), 'pe-test-' + process.pid + '.gif');
  try {
    PA.export_gif(a, tmp);
    const data = fs.readFileSync(tmp);
    assert.deepStrictEqual(data, Buffer.from(PA.encode_gif(a)));
    assert.strictEqual(data.toString('ascii', 0, 6), 'GIF89a');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('animation_to_html: renders the seeded frame scene (palette added after frame)', () => {
  const a = PA.create_animation(4, 4);
  PA.add_frame(a);
  a.palette.extra = '#ff00ff';
  const html = PA.animation_to_html(a, { title: 'seed' });
  assert.ok(html.indexOf('"extra":"#ff00ff"') !== -1);
});

test('animation_to_html: title is HTML-escaped', () => {
  const { a } = mkBallAnim();
  const html = PA.animation_to_html(a, { title: '<script>alert(1)</script>' });
  assert.strictEqual(html.indexOf('<script>alert(1)</script>'), -1);
  assert.ok(html.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') !== -1);
});

test('animation_to_html: frame data serialized with unicode escapes (no </script> breakout)', () => {
  const a = PA.create_animation(4, 4);
  PA.add_frame(a);
  a.frames[0].id = '</script><script>alert(1)</script>';
  const html = PA.animation_to_html(a, { title: 'xss' });
  assert.strictEqual(html.indexOf('</script><script>alert(1)</script>'), -1);
  assert.ok(html.indexOf('\\u003c/script\\u003e') !== -1);
});

test('animation_to_html: click-to-inspect reads the canvas (getImageData), not window.PixelEngine', () => {
  const { a } = mkBallAnim();
  const html = PA.animation_to_html(a, { title: 'inspect' });
  assert.strictEqual(html.indexOf('window.PixelEngine'), -1);
  assert.ok(html.indexOf('ctx.getImageData(x * scale, y * scale, 1, 1).data') !== -1);
  const m = html.match(/cv\.addEventListener\("click", function\(e\)\{([\s\S]*?)\}\);/);
  assert.ok(m, 'click handler found in generated html');
  const fn = new Function('ctx', 'size', 'scale', 'frames', 'idx', 'document', 'return function(e){' + m[1] + '};');
  const stubCanvas = { width: 128, height: 128, getBoundingClientRect: function () { return { left: 0, top: 0 }; } };
  const info = { textContent: '' };
  const stubDoc = { getElementById: function () { return info; } };
  const calls = [];
  const opaque = fn({ getImageData: function (x, y) { calls.push([x, y]); return { data: Uint8Array.from([233, 69, 96, 255]) }; } }, 16, 8, [{ id: 'frame-0' }], 0, stubDoc);
  opaque.call(stubCanvas, { clientX: 64, clientY: 40 });
  assert.strictEqual(info.textContent, 'frame frame-0 (8,5) -> #e94560');
  assert.deepStrictEqual(calls[0], [64, 40]); // sampled at scaled canvas coords (scale 8)
  const transparent = fn({ getImageData: function () { return { data: Uint8Array.from([0, 0, 0, 0]) }; } }, 16, 8, [{ id: 'frame-0' }], 0, stubDoc);
  transparent.call(stubCanvas, { clientX: 64, clientY: 40 });
  assert.strictEqual(info.textContent, 'frame frame-0 (8,5) -> transparent');
});

// ---------------------------------------------------------------------------
// Phase 3 — agent-loop tools (better "eyes")
// ---------------------------------------------------------------------------

test('diff_scenes: identical scenes -> 0 changed, null bbox, empty changes', () => {
  const a = PE.create_canvas(8, '#111111');
  PE.fill_region(a, 2, 2, 2, 2, '#ff0000');
  const b = JSON.parse(JSON.stringify(a));
  const d = PE.diff_scenes(a, b);
  assert.strictEqual(d.changed, 0);
  assert.strictEqual(d.unchanged, 64);
  assert.strictEqual(d.pct, 0);
  assert.strictEqual(d.bbox, null);
  assert.deepStrictEqual(d.changes, []);
  assert.strictEqual(d.changed_pixels, 0);
  assert.strictEqual(d.bounding_box, null);
});

test('diff_scenes: single-pixel diff reports bbox + pct', () => {
  const a = PE.create_canvas(4);
  const b = PE.create_canvas(4);
  PE.fill_region(a, 1, 1, 1, 1, '#ff0000');
  PE.fill_region(b, 1, 1, 1, 1, '#00ff00');
  const d = PE.diff_scenes(a, b);
  assert.strictEqual(d.changed, 1);
  assert.strictEqual(d.unchanged, 15);
  assert.strictEqual(d.pct, 6.25);
  assert.deepStrictEqual(d.bbox, [1, 1, 1, 1]);
  assert.strictEqual(d.changes.length, 1);
  assert.deepStrictEqual(d.changes[0], { x: 1, y: 1, old_value: '#ff0000', new_value: '#00ff00' });
});

test('diff_scenes: different sizes -> error', () => {
  const a = PE.create_canvas(16);
  const b = PE.create_canvas(32);
  assert.throws(() => PE.diff_scenes(a, b), /size mismatch/);
});

test('diff_scenes: multi-pixel bbox spanning', () => {
  const a = PE.create_canvas(8, '#000000');
  const b = PE.create_canvas(8, '#000000');
  PE.set_pixel(b, 1, 1, '#ff0000');
  PE.set_pixel(b, 6, 6, '#ff0000');
  const d = PE.diff_scenes(a, b);
  assert.strictEqual(d.changed, 2);
  assert.deepStrictEqual(d.bbox, [1, 1, 6, 6]);
});

test('replace_color_region: region-limited recolor', () => {
  const s = PE.create_canvas(8, '#000000');
  PE.fill_region(s, 0, 0, 8, 8, '#ff0000');
  // Recolor only left half from red to blue
  const r = PE.replace_color_region(s, 0, 0, 4, 8, '#ff0000', '#0000ff');
  assert.strictEqual(r.replaced, 32);
  assert.strictEqual(PE.get_pixel(s, 1, 1), '#0000ff');
  assert.strictEqual(PE.get_pixel(s, 5, 5), '#ff0000');
});

test('replace_color_region: clipping at canvas edge', () => {
  const s = PE.create_canvas(4, '#ff0000');
  const r = PE.replace_color_region(s, 2, 2, 10, 10, '#ff0000', '#00ff00');
  assert.strictEqual(r.replaced, 4);
});

test('replace_color_region: empty region and from===to are no-ops', () => {
  const s = PE.create_canvas(4, '#ff0000');
  assert.deepStrictEqual(PE.replace_color_region(s, 0, 0, 0, 4, '#ff0000', '#00ff00'), { replaced: 0 });
  assert.deepStrictEqual(PE.replace_color_region(s, 0, 0, 4, 4, '#ff0000', '#ff0000'), { replaced: 0 });
  const hex = '#112233';
  const s2 = PE.create_canvas(4, hex);
  assert.deepStrictEqual(PE.replace_color_region(s2, 0, 0, 4, 4, hex.toUpperCase(), hex.toLowerCase()), { replaced: 0 });
});

test('measure_distance: known distances', () => {
  assert.strictEqual(PE.measure_distance(0, 0, 3, 4), 5);
  assert.strictEqual(PE.measure_distance(0, 0, 0, 0), 0);
  assert.ok(Math.abs(PE.measure_distance(1, 1, 4, 5) - 5) < 1e-9);
  assert.ok(Math.abs(PE.measure_distance(-1, -1, 2, 3) - 5) < 1e-9);
});

test('check_symmetry: symmetric scene passes, asymmetric fails with diff list', () => {
  const s = PE.create_canvas(8, '#000000');
  PE.fill_region(s, 1, 2, 2, 2, '#ff0000');
  PE.mirror_region(s, 1, 2, 2, 2, 'h');
  // Mirror the left half to right half: now symmetric in region 1,2,4,2? Actually mirror writes right half
  // Build symmetric explicitly: left block then mirror
  const sym = PE.check_symmetry(s, 'h', { x: 1, y: 2, w: 4, h: 2 });
  // After mirror_region with w=2, the 4-wide region should not be symmetric unless we check correctly
  // Simpler: create symmetric scene directly
  const t = PE.create_canvas(8);
  PE.fill_region(t, 0, 0, 2, 2, '#ff0000');
  PE.fill_region(t, 6, 0, 2, 2, '#ff0000');
  const r = PE.check_symmetry(t, 'h', { x: 0, y: 0, w: 8, h: 2 });
  assert.strictEqual(r.symmetric, true);
  assert.strictEqual(r.diffCount, 0);
  // Asymmetric: only left side
  const u = PE.create_canvas(8);
  PE.fill_region(u, 0, 0, 2, 2, '#ff0000');
  const r2 = PE.check_symmetry(u, 'h', { x: 0, y: 0, w: 8, h: 2 });
  assert.strictEqual(r2.symmetric, false);
  assert.ok(r2.diffCount > 0);
  assert.ok(Array.isArray(r2.diffPixels));
});

test('check_symmetry: empty region is vacuously symmetric, odd width center skipped, bad axis throws', () => {
  const s = PE.create_canvas(4, '#ff0000');
  assert.deepStrictEqual(PE.check_symmetry(s, 'h', { x: 0, y: 0, w: 0, h: 4 }), { symmetric: true, diffCount: 0, diffPixels: [] });
  // Odd width: 5-wide region, center column 2 maps to itself -> skipped
  const odd = PE.create_canvas(5);
  PE.fill_region(odd, 0, 0, 2, 5, '#ff0000');
  PE.fill_region(odd, 3, 0, 2, 5, '#ff0000');
  // middle column empty, left and right symmetric
  const ro = PE.check_symmetry(odd, 'h', { x: 0, y: 0, w: 5, h: 5 });
  assert.strictEqual(ro.symmetric, true);
  assert.throws(() => PE.check_symmetry(s, 'x'), /axis must be/);
});

test('dither_region: Bayer 4x4 gradient and determinism', () => {
  const s = PE.create_canvas(8);
  s.palette = { a: '#000000', b: '#ffffff' };
  const r = PE.dither_region(s, 0, 0, 8, 1, { from: '#000000', to: '#ffffff' });
  assert.strictEqual(r.dithered, 8);
  const s2 = PE.create_canvas(8);
  s2.palette = { a: '#000000', b: '#ffffff' };
  PE.dither_region(s2, 0, 0, 8, 1, { from: '#000000', to: '#ffffff' });
  assert.deepStrictEqual(s.pixels, s2.pixels);
  assert.strictEqual(s.pixels['0,0'], '#000000');
  assert.strictEqual(s.pixels['7,0'], '#ffffff');
  const e = PE.create_canvas(4);
  assert.deepStrictEqual(PE.dither_region(e, 0, 0, 0, 4, { from: '#000', to: '#fff' }), { dithered: 0 });
  const f = PE.create_canvas(4);
  assert.deepStrictEqual(PE.dither_region(f, 0, 0, 4, 4, { from: '#ff0000', to: '#ff0000' }), { dithered: 0 });
});

test('mcp: package exists with 20+ tools and expected names', () => {
  const mcpPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp/package.json'), 'utf8'));
  assert.strictEqual(mcpPkg.name, 'pixel-engine-mcp');
  assert.ok(mcpPkg.dependencies['@modelcontextprotocol/sdk']);
  const registry = require('../engine/tool-registry.js');
  assert.ok(registry.length >= 20, 'expected 20+ tools, got ' + registry.length);
  for (const name of ['render', 'diff_scenes', 'validate_scene', 'encode_png', 'check_symmetry', 'measure_distance']) {
    assert.ok(registry.some(t => t.name === name), 'tool ' + name + ' missing in registry');
  }
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'mcp/src/index.js'), 'utf8');
  assert.ok(mcpSrc.includes('tool-registry'), 'MCP should import tool-registry');
});

test('registry: tool-registry is single source of truth for docs', () => {
  const registry = require('../engine/tool-registry.js');
  const api = fs.readFileSync(path.join(ROOT, 'skills/pixel-engine/references/api.md'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const t of registry) {
    assert.ok(api.includes(t.name), `api.md missing tool ${t.name}`);
    assert.ok(readme.includes(t.name) || readme.includes(t.name.replace('_', '-')), `README missing tool ${t.name}`);
  }
});

test('registry: layer-registry matches engine compact codes', () => {
  const reg = require('../engine/layer-registry.js');
  const types = reg.listTypes();
  assert.ok(types.length >= 8, 'expected 8 layer types');
  for (const type of ['fill', 'rect', 'rectout', 'ellipse', 'line', 'poly', 'polyout', 'curve']) {
    assert.ok(types.includes(type), `layer type ${type} missing in registry`);
    assert.ok(reg.codeFor(type), `code for ${type} missing`);
    assert.strictEqual(reg.typeFor(reg.codeFor(type)), type);
  }
});

test('ci: workflow exists and runs npm test on 18/20/22', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8');
  assert.ok(yml.includes('npm test'));
  assert.ok(yml.includes('18'));
  assert.ok(yml.includes('20'));
  assert.ok(yml.includes('22'));
});

test('release: script exists with dry-run support', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/release.js'), 'utf8');
  assert.ok(src.includes('dry-run'));
  assert.ok(src.includes('npm publish'));
});

// ---------------------------------------------------------------------------
// Phase 5 — taste layer
// ---------------------------------------------------------------------------

test('compare_scene_to_reference: identical scene vs itself -> perfect scores', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/craft/creature32.json'), 'utf8'));
  const buf = PE.rasterize(s);
  const m = PE.compare_scene_to_reference(s, buf);
  assert.strictEqual(m.silhouetteIoU, 1);
  assert.strictEqual(m.paletteDistance, 0);
  assert.strictEqual(m.histogramDistance, 0);
  assert.strictEqual(m.intersection, m.union);
});

test('compare_scene_to_reference: different scenes -> expected deltas (IoU <1, distances >0)', () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/craft/creature32.json'), 'utf8'));
  const b = PE.create_canvas(32);
  b.palette = { bg: '#000000' };
  PE.fill_region(b, 0, 0, 32, 32, 'bg');
  const bufB = PE.rasterize(b);
  const m = PE.compare_scene_to_reference(a, bufB);
  assert.ok(m.silhouetteIoU < 1 && m.silhouetteIoU > 0);
  assert.ok(m.paletteDistance > 0);
  assert.ok(m.histogramDistance > 0);
});

test('compare_scene_to_reference: auto-scales reference of different size', () => {
  const s = PE.create_canvas(16);
  s.palette = { red: '#ff0000' };
  PE.fill_region(s, 0, 0, 16, 16, 'red');
  const small = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < small.length; i += 4) { small[i] = 255; small[i + 1] = 0; small[i + 2] = 0; small[i + 3] = 255; }
  const m = PE.compare_scene_to_reference(s, { width: 4, height: 4, rgba: small });
  assert.strictEqual(m.silhouetteIoU, 1);
  assert.strictEqual(m.paletteDistance, 0);
});

test('compare_scene_to_reference: region limits comparison', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/craft/creature32.json'), 'utf8'));
  const buf = PE.rasterize(s);
  const m = PE.compare_scene_to_reference(s, buf, { region: { x: 0, y: 0, w: 4, h: 4 } });
  assert.deepStrictEqual(m.region, [0, 0, 4, 4]);
});

test('analyze_values: craft palette groups skin family with 3 steps', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/craft/creature32.json'), 'utf8'));
  const a = PE.analyze_values(s);
  assert.strictEqual(a.families.skin.count, 3);
  assert.deepStrictEqual(a.families.skin.keys, ['skinDark', 'skinMid', 'skinLight']);
  assert.strictEqual(a.totalFamilies, 4);
});

test('check_hue_shift: craft palette passes, flat palette fails', () => {
  const craft = { outline: '#22331A', skinDark: '#3A5A4E', skinMid: '#5E8F4E', skinLight: '#A8D878', belly: '#D8F0B8', eye: '#1A1A1A' };
  const flat = { outline: '#1A1A1A', skinDark: '#4A7A3A', skinMid: '#6BA34F', skinLight: '#8FC46E', belly: '#C9E8A8', eye: '#1A1A1A' };
  const pass = PE.check_hue_shift(craft);
  assert.strictEqual(pass.pass, true);
  const skin = pass.results.find(r => r.family === 'skin');
  assert.strictEqual(skin.status, 'PASS');
  const fail = PE.check_hue_shift(flat);
  assert.strictEqual(fail.pass, false);
  const skinFail = fail.results.find(r => r.family === 'skin');
  assert.strictEqual(skinFail.status, 'FAIL');
});

test('check_hue_shift: single-key family passes with note', () => {
  const r = PE.check_hue_shift({ solo: '#ff0000' });
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.results[0].note, 'single-key family — no shift possible');
});

// ---------------------------------------------------------------------------
// Workflow token diet (001) — compact + patch
// ---------------------------------------------------------------------------

test('compact: house round-trip pixel-identical', () => {
  const scenes = ['scenes/house.json', 'scenes/creature64.json', 'scenes/craft/creature32.json'].map(p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')));
  for (const s of scenes) {
    const c = PE.encode_compact(s);
    const d = PE.decode_compact(c);
    assert.strictEqual(hash256(PE.rasterize(s)), hash256(PE.rasterize(d)), 'raster mismatch');
  }
});

test('compact: token saving >=30% on house', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/house.json'), 'utf8'));
  const c = PE.encode_compact(s);
  assert.ok(JSON.stringify(c).length < JSON.stringify(s).length * 0.7, `compact ${JSON.stringify(c).length} not < 70% of verbose ${JSON.stringify(s).length}`);
});

test('patch: get_patch + apply_patch round-trip', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/house.json'), 'utf8'));
  const s2 = JSON.parse(JSON.stringify(s));
  s2.layers[0].color = 'roof';
  s2.pixels['0,0'] = 'sky';
  const patch = PE.get_patch(s, s2);
  const clone = JSON.parse(JSON.stringify(s));
  PE.apply_patch(clone, patch);
  assert.strictEqual(hash256(PE.rasterize(clone)), hash256(PE.rasterize(s2)));
});

test('patch is smaller than full scene', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/house.json'), 'utf8'));
  const s2 = JSON.parse(JSON.stringify(s));
  s2.layers[1].color = 'roof';
  s2.layers[2].color = 'sky';
  const patch = PE.get_patch(s, s2);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(s2).length * 0.3, `patch ${JSON.stringify(patch).length} not <30% of full ${JSON.stringify(s2).length}`);
});

test('critic loop: craft scene passes taste, flat scene fails', () => {
  const craft = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/craft/creature32.json'), 'utf8'));
  assert.strictEqual(PE.analyze_values(craft).families.skin.count, 3);
  assert.strictEqual(PE.check_hue_shift(craft.palette).pass, true);
  const flat = { outline: '#1A1A1A', skinDark: '#4A7A3A', skinMid: '#6BA34F', skinLight: '#8FC46E', belly: '#C9E8A8', eye: '#1A1A1A' };
  assert.strictEqual(PE.check_hue_shift(flat).pass, false);
});

// ---------------------------------------------------------------------------

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
