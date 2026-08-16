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
const PE_ANIM = require('./engine/animation.js'); // attaches to PE

function die(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

if (process.argv[2] === 'anim') {
  runAnim(process.argv.slice(3));
  process.exit(0);
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
let scene;
try {
  scene = JSON.parse(fs.readFileSync(opts.sceneFile, 'utf8'));
} catch (e) {
  die('cannot read scene file: ' + e.message);
}
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

console.log('\n--- layer bboxes (pre-overwrite, what each layer painted) ---');
const ids = Object.keys(stats.layerBBoxes);
if (ids.length) {
  for (const id of ids) {
    console.log('  ' + id + '  bbox[' + stats.layerBBoxes[id].join(',') + ']');
  }
} else {
  console.log('  (none)');
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

// ---------------------------------------------------------------------------
// anim mode — animation documents
// ---------------------------------------------------------------------------

/**
 * Usage: node cli.js anim <anim.json> [--diff a,b] [--validate a,b,x,y,w,h]
 *              [--ascii frameId] [--sheet out.png] [--html out.html] [--fps n]
 */
function runAnim(argv) {
  const opts = { file: null, diff: null, validate: null, ascii: null, sheet: null, html: null, fps: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--diff') opts.diff = argv[++i];
    else if (a === '--validate') opts.validate = argv[++i];
    else if (a === '--ascii') opts.ascii = argv[++i];
    else if (a === '--sheet') opts.sheet = argv[++i];
    else if (a === '--html') opts.html = argv[++i];
    else if (a === '--fps') opts.fps = parseInt(argv[++i], 10);
    else if (opts.file === null) opts.file = a;
    else die('unexpected argument: ' + a);
  }
  if (!opts.file) die('expected an animation file');

  let anim;
  try {
    anim = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  } catch (e) {
    die('cannot read animation file: ' + e.message);
  }
  PE_ANIM.normalize_animation(anim);
  if (opts.fps) anim.fps = opts.fps;

  console.log('animation: ' + path.basename(opts.file) + '  (' + anim.width + 'x' + anim.height + ', ' + anim.fps + ' fps)');
  console.log('frames: ' + anim.frames.length + '  palette: ' + Object.keys(anim.palette).join(', '));
  for (const fr of anim.frames) {
    console.log('  ' + fr.id + (anim.keyframes[fr.id] ? '  [keyframe]' : '') +
      '  layers=' + (fr.scene.layers || []).length + '  overrides=' + Object.keys(fr.scene.pixels || {}).length);
  }

  if (opts.diff) {
    const [aId, bId] = opts.diff.split(',');
    if (!aId || !bId) die('--diff expects frameA,frameB');
    const d = PE.diff_frames(anim, aId, bId);
    console.log('\n--- diff ' + aId + ' -> ' + bId + ' ---');
    console.log('changed=' + d.changed_pixels + '  unchanged=' + d.unchanged_pixels + '  ' + d.change_percentage + '%' +
      '  bbox=' + (d.bounding_box ? '[' + d.bounding_box.join(',') + ']' : 'none'));
    for (const c of d.changes) {
      console.log('  (' + c.x + ',' + c.y + ')  ' + (c.old_value || 'transparent') + ' -> ' + (c.new_value || 'transparent'));
    }
  }

  if (opts.validate) {
    const parts = opts.validate.split(',');
    if (parts.length !== 6) die('--validate expects frameA,frameB,x,y,w,h');
    const [aId, bId] = [parts[0], parts[1]];
    const region = parts.slice(2).map(Number);
    const v = PE.validate_change(anim, aId, bId, region);
    console.log('\n--- validate ' + aId + ' -> ' + bId + ' in [' + region.join(',') + '] ---');
    console.log((v.pass ? 'PASS' : 'FAIL') + '  total_changes=' + v.total_changes + '  unexpected=' + v.unexpected_changes);
    for (const c of v.unexpected) {
      console.log('  unexpected (' + c.x + ',' + c.y + ')  ' + (c.old_value || 'transparent') + ' -> ' + (c.new_value || 'transparent'));
    }
  }

  if (opts.ascii) {
    const fr = anim.frames.find(function (f) { return f.id === opts.ascii; });
    if (!fr) die('unknown frame: ' + opts.ascii);
    console.log('\n--- ascii ' + opts.ascii + ' ---');
    console.log(PE.read_region(fr.scene));
  }

  if (opts.sheet) {
    PE.export_spritesheet(anim, opts.sheet);
    console.log('\nwrote ' + opts.sheet + ' (' + fs.statSync(opts.sheet).size + ' bytes)');
  }
  if (opts.html) {
    PE.animation_to_html(anim, { path: opts.html, title: path.basename(opts.file, '.json') });
    console.log('wrote ' + opts.html);
  }
}