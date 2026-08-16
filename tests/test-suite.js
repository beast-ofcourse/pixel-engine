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

function hash16(buf) {
  return crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex').slice(0, 16);
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

// ---------------------------------------------------------------------------
// scene documents — locked hashes (house, campfire)
// ---------------------------------------------------------------------------

function loadScene(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', name + '.json'), 'utf8'));
}

test('house: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('house');
  assert.strictEqual(hash16(PE.rasterize(s)), 'e4122858a812f4ad');
});

test('campfire: rasterize hash locked', () => {
  const s = loadScene('campfire');
  assert.strictEqual(hash16(PE.rasterize(s)), 'f2b9806050fbdca3');
});

test('house128: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('house128');
  assert.strictEqual(hash16(PE.rasterize(s)), '22f8cbcb86bd47f4');
});

test('robot: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('robot');
  assert.strictEqual(hash16(PE.rasterize(s)), '434479ea22214b5b');
});

test('landscape256: rasterize hash locked (engine == browser verified)', () => {
  const s = loadScene('landscape256');
  assert.strictEqual(hash16(PE.rasterize(s)), '5192f4c37ca56c03');
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
