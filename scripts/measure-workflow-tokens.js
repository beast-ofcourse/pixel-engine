#!/usr/bin/env node
/**
 * Workflow token harness — estimates verbose vs patched workflow cost.
 * Uses chars/4 as token proxy (no heavy deps). Prints table for 3 scenes.
 */
const fs = require('fs');
const path = require('path');
const PE = require('../engine/pixel-engine.js');

function tokensFromString(s) { return Math.ceil(s.length / 4); }

function measure(scene) {
  const sceneStr = JSON.stringify(scene);
  const sceneTokens = tokensFromString(sceneStr);
  let inspectTokens = 0, regionTokens = 0;
  try { inspectTokens = tokensFromString(JSON.stringify(PE.inspect(scene))); } catch (e) { inspectTokens = 0; }
  try { regionTokens = tokensFromString(PE.read_region(scene)); } catch (e) { regionTokens = 0; }
  const perIteration = sceneTokens + inspectTokens + regionTokens;
  const sixWorkflow = perIteration * 6;
  // Patched estimate: patch via get_patch if available, else 0.2*scene
  let patchTokens = Math.ceil(sceneTokens * 0.2);
  let terseInspectTokens = 0;
  try {
    if (typeof PE.get_patch === 'function') {
      const clone = JSON.parse(JSON.stringify(scene));
      // make a tiny 2-layer change to estimate patch size
      if (clone.layers.length) clone.layers[0].color = Object.keys(clone.palette)[0] || clone.layers[0].color;
      const patch = PE.get_patch(scene, clone);
      patchTokens = tokensFromString(JSON.stringify(patch));
    }
    if (typeof PE.diff_scenes === 'function') {
      const clone = JSON.parse(JSON.stringify(scene));
      const d = PE.diff_scenes(scene, clone);
      terseInspectTokens = tokensFromString(JSON.stringify({ changed: d.changed, bbox: d.bbox }));
    } else {
      terseInspectTokens = Math.ceil(inspectTokens * 0.15);
    }
  } catch (e) {
    terseInspectTokens = Math.ceil(inspectTokens * 0.15);
  }
  const patchedPerIteration = patchTokens + terseInspectTokens + Math.ceil(regionTokens * 0.25);
  const patchedWorkflow = patchedPerIteration * 6;
  // Also include skill prompt overhead estimate (~8k tokens) per the plan's note
  const systemOverhead = 8000;
  return {
    sceneTokens, inspectTokens, regionTokens, perIteration, sixWorkflow,
    patchTokens, terseInspectTokens, patchedPerIteration, patchedWorkflow,
    withOverheadVerbose: sixWorkflow + systemOverhead,
    withOverheadPatched: patchedWorkflow + systemOverhead,
    saving: sixWorkflow ? Math.round((1 - patchedWorkflow / sixWorkflow) * 100) : 0
  };
}

const files = ['scenes/house.json', 'scenes/creature64.json', 'scenes/craft/creature32.json'];
console.log('file | scene tok | inspect tok | region tok | 6× verbose | 6× patched | saving % | with 8k overhead (verbose→patched)');
console.log('-----|-----------|-------------|------------|-------------|-------------|----------|--------------------------------------');
for (const f of files) {
  const full = path.join(__dirname, '..', f);
  if (!fs.existsSync(full)) { console.log(f + ' | missing'); continue; }
  const scene = JSON.parse(fs.readFileSync(full, 'utf8'));
  const m = measure(scene);
  console.log(`${f} | ${m.sceneTokens} | ${m.inspectTokens} | ${m.regionTokens} | ${m.sixWorkflow} | ${m.patchedWorkflow} | ${m.saving}% | ${m.withOverheadVerbose}→${m.withOverheadPatched}`);
}
const hasPatch = typeof PE.get_patch === 'function';
console.log('\nPatch helpers: ' + (hasPatch ? 'available (get_patch/apply_patch present)' : 'not yet implemented (estimating 20% of scene)'));
console.log('Compact: ' + (typeof PE.encode_compact === 'function' ? 'available' : 'not yet implemented'));
