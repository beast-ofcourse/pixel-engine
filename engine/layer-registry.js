/**
 * layer-registry.js — single source of truth for layer types.
 * Deep module with small interface: register is the seam.
 * Zero-dep, CommonJS. Used by rasterize, validate_scene, and compact codec.
 */
const TYPE_TO_CODE = { fill: 'f', rect: 'r', rectout: 'o', ellipse: 'e', line: 'n', poly: 'y', polyout: 'Y', curve: 'c' };
const CODE_TO_TYPE = { f: 'fill', r: 'rect', o: 'rectout', e: 'ellipse', n: 'line', y: 'poly', Y: 'polyout', c: 'curve' };

const LAYER_DEFS = {
  fill: { code: 'f', params: ['color'], points: false },
  rect: { code: 'r', params: ['x', 'y', 'w', 'h', 'color'], points: false },
  rectout: { code: 'o', params: ['x', 'y', 'w', 'h', 'color', 't'], points: false },
  ellipse: { code: 'e', params: ['cx', 'cy', 'rx', 'ry', 'color'], points: false },
  line: { code: 'n', params: ['x1', 'y1', 'x2', 'y2', 'color'], points: false },
  poly: { code: 'y', params: ['points', 'color'], points: true },
  polyout: { code: 'Y', params: ['points', 'color'], points: true },
  curve: { code: 'c', params: ['points', 'color', 'closed'], points: true },
};

function listTypes() { return Object.keys(LAYER_DEFS); }
function getDef(type) { return LAYER_DEFS[type] || null; }
function isKnown(type) { return !!LAYER_DEFS[type]; }
function codeFor(type) { return TYPE_TO_CODE[type] || type; }
function typeFor(code) { return CODE_TO_TYPE[code] || code; }

module.exports = {
  TYPE_TO_CODE,
  CODE_TO_TYPE,
  LAYER_DEFS,
  listTypes,
  getDef,
  isKnown,
  codeFor,
  typeFor,
};
