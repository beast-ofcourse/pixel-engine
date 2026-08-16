#!/usr/bin/env node
/**
 * cli.js — Experiment loop driver for the pixel engine.
 *
 * Usage:
 *   node cli.js scenes/house.json [--png out/house.png] [--html out/house.html]
 *                                  [--zoom x,y,w,h] [--scale n] [--counts x,y,w,h]
 *
 * Prints: scene summary, inspect() stats, full-canvas ASCII preview (auto-scaled),
 * and optionally a full-resolution zoom region or color counts for a region.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const PE = require('./engine/pixel-engine.js');

function die(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { png: null, html: null, zoom: null, counts: null, scale: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--png') opts.png = argv[++i];
    else if (a === '--html') opts.html = argv[++i];
    else if (a === '--zoom') opts.zoom = argv[++i];
    else if (a === '--counts') opts.counts = argv[++i];
    else if (a === '--scale') opts.scale = parseInt(argv[++i], 10);
    else rest.push(a);
  }
  if (rest.length !== 1) die('expected exactly one scene file');
  opts.sceneFile = rest[0];
  return opts;
}

function parseRegion(spec, scene) {
  const parts = spec.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) die('bad region spec: ' + spec);
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) die('region must have positive w/h: ' + spec);
  if (x < 0 || y < 0 || x + w > scene.size || y + h > scene.size) {
    die('region out of bounds (canvas ' + scene.size + 'x' + scene.size + '): ' + spec);
  }
  return { x, y, w, h };
}

const opts = parseArgs(process.argv.slice(2));
const scene = JSON.parse(fs.readFileSync(opts.sceneFile, 'utf8'));
if (!scene.size) scene.size = 64;

// 1. Summary
console.log('scene: ' + path.basename(opts.sceneFile) + '  (' + scene.size + 'x' + scene.size + ')');
console.log('palette: ' + Object.keys(scene.palette || {}).join(', '));
console.log('layers: ' + (scene.layers || []).length + '  pixel overrides: ' + Object.keys(scene.pixels || {}).length);

// 2. Inspect stats
const stats = PE.inspect(scene);
console.log('\n--- color stats (count / bbox) ---');
for (const c of stats.colors) {
  const name = c.name ? c.name + ' ' : '';
  console.log('  ' + name + c.color + '  ' + c.count + 'px  bbox[' + c.bbox.join(',') + ']');
}

// 3. Full-canvas ASCII preview (auto-scaled for context economy)
console.log('\n--- preview ---');
console.log(PE.read_region(scene, 0, 0, scene.size, scene.size, opts.scale ? { scale: opts.scale } : {}));

// 4. Optional zoom (full-res region read)
if (opts.zoom) {
  const r = parseRegion(opts.zoom, scene);
  console.log('\n--- zoom ' + r.x + ',' + r.y + ',' + r.w + ',' + r.h + ' (full res) ---');
  console.log(PE.read_region(scene, r.x, r.y, r.w, r.h, { scale: 1 }));
}

// 5. Optional counts for a region
if (opts.counts) {
  const r = parseRegion(opts.counts, scene);
  const res = PE.read_region(scene, r.x, r.y, r.w, r.h, { mode: 'counts' });
  console.log('\n--- counts ' + r.x + ',' + r.y + ',' + r.w + ',' + r.h + ' ---');
  for (const hex of Object.keys(res.colors)) {
    console.log('  ' + (hex === '.' ? 'transparent' : hex) + ': ' + res.colors[hex]);
  }
}

// 6. Outputs
if (opts.png) {
  PE.export_png(scene, opts.png);
  console.log('\nwrote ' + opts.png + ' (' + fs.statSync(opts.png).size + ' bytes)');
}
if (opts.html) {
  PE.scene_to_html(scene, { path: opts.html, title: path.basename(opts.sceneFile, '.json') });
  console.log('wrote ' + opts.html);
}