# pixel-engine

**A coding LLM constructs 64×64 pixel art from a structured scene document — layers, palette, and sparse pixel overrides — instead of emitting pixels one by one.**

This is an **experimental research prototype**, not a product. The question it exists to answer:

> How far can a normal language/coding model go at constructing a visual artifact when given a good intermediate representation, tools, and iterative feedback?

The engine is a single zero-dependency file that works in Node and the browser. It rasterizes a declarative scene document to a pixel buffer, renders it to PNG, and exposes inspection tools (ASCII previews, color stats, region zoom) so an agent can render → inspect → fix → re-render without ever reasoning about all 4,096 pixels at once.

## Results so far

Five scenes were authored and verified with this loop (see [docs/FINDINGS.md](docs/FINDINGS.md) for the full experiment log, token economics, and the bugs found):

| House — 64×64, 18 layers | Campfire — 64×64, 15 layers | House 2× — 128×128, 55 layers |
|---|---|---|
| ![64x64 pixel-art house](out/house-preview.png) | ![64x64 pixel-art campfire](out/campfire-preview.png) | render via `node cli.js scenes/house128.json --png out/house128.png` |

| Robot — 128×128, 28 layers | Landscape — 256×256, 111 layers |
|---|---|
| render via `node cli.js scenes/robot.json --png out/robot.png` | render via `node cli.js scenes/landscape256.json --png out/landscape256.png` |

All five were verified pixel-exact in a real browser (canvas-sample SHA-256
== Node rasterize hash, 0 diffs) and are hash-locked by the test suite.

## How it works

```
scenes/<name>.json          ← the agent's artifact: a structured scene document
    ↓
engine/pixel-engine.js      ← rasterizer + tools + PNG encoder (zero deps)
    ↓
cli.js                      ← render → inspect → zoom loop
out/<name>.png / .html      ← exports + interactive preview
```

A scene document is plain JSON:

```json
{
  "size": 64,
  "palette": { "sky": "#7EC8E3", "roof": "#C25B3A" },
  "layers": [
    { "id": "sky", "type": "fill", "color": "sky" },
    { "id": "roof", "type": "poly", "points": [[13,28],[51,28],[32,11]], "color": "roof" }
  ],
  "pixels": { "25,36": "dark", "30,43": "gold" }
}
```

- **Layers** are named shapes painted in order (painter's algorithm): `fill`, `rect`, `rectout`, `ellipse`, `line`, `poly`, `polyout`.
- **Colors** are palette keys, never raw hex — the palette guarantees consistency and makes `inspect()` stats readable.
- **`pixels`** is a sparse override map for sub-shape detail (window crosses, door knobs, stars). `null` clears.

The agent reasons about ~15–20 objects instead of 4,096 pixels.

## Install

```bash
npm install pixel-engine-zero
```

As a library:

```js
const PE = require('pixel-engine-zero');

const scene = {
  size: 64,
  palette: { "sky": "#7EC8E3", "roof": "#C25B3A" },
  layers: [
    { "id": "sky", "type": "fill", "color": "sky" },
    { "id": "roof", "type": "poly", "points": [[13,28],[51,28],[32,11]], "color": "roof" }
  ],
  pixels: {}
};

const rgba = PE.rasterize(scene);      // Uint8Array RGBA buffer
const png = PE.encode_png(scene);      // Uint8Array PNG bytes
console.log(PE.read_region(scene));    // ASCII preview
console.log(PE.inspect(scene));        // color stats + bboxes
```

As a CLI (or `npx pixel-engine-zero`):

```bash
pixel-engine scenes/house.json --png out/house.png --html out/house.html
```

## Requirements

- Node.js (developed and tested on v24.18.0; only built-in modules are used — no dependencies)

## Quick start

```bash
# Render a scene to PNG + interactive HTML preview
node cli.js scenes/house.json --png out/house.png --html out/house.html

# Full inspection loop: stats + auto-scaled ASCII preview + full-res zoom
node cli.js scenes/house.json --zoom 19,28,26,21

# Browser sandbox (paste JSON → render → click pixels → export PNG)
node serve.js
# then open http://localhost:8734

# Run the accuracy suite (75 tests: primitives, edge cases, PNG, hashes, CLI)
node tests/test-suite.js
```

The CLI prints color stats (count + bounding box per color), a full-canvas ASCII preview (auto-scaled to ≤40 chars wide to keep context small), and optionally a full-resolution zoom region or per-color counts for a region.

## CLI reference

```
node cli.js <scene.json> [--png out.png] [--html out.html]
                        [--zoom x,y,w,h] [--counts x,y,w,h] [--scale n]
```

| Flag | Purpose |
|---|---|
| `--png <path>` | Write a PNG export |
| `--html <path>` | Write a self-contained interactive preview (click pixels to inspect, export PNG) |
| `--zoom x,y,w,h` | Full-resolution ASCII read of a region |
| `--counts x,y,w,h` | Per-color pixel counts in a region |
| `--scale n` | Override ASCII preview sampling (default: auto) |

## Engine API

`engine/pixel-engine.js` is a UMD module: `require('./engine/pixel-engine.js')` in Node, `window.PixelEngine` in the browser.

| Function | Purpose |
|---|---|
| `create_canvas(size, background)` | New scene document |
| `fill_region(scene, x, y, w, h, color)` | Filled rect layer |
| `draw_shape(scene, type, params)` | Generic shape layer |
| `set_pixel(scene, x, y, color)` / `clear_pixel` | Sparse override |
| `get_pixel(scene, x, y)` | Resolved color at a coordinate |
| `read_region(scene, x, y, w, h, opts)` | ASCII map or color counts (multi-resolution) |
| `inspect(scene)` | Per-color counts + bounding boxes |
| `render(scene)` | RGBA pixel buffer |
| `encode_png(scene)` / `export_png(scene, path)` | PNG bytes / file |
| `scene_to_html(scene, opts)` | Interactive preview HTML |

## Project structure

```
engine/pixel-engine.js   engine + tools (~700 lines, zero deps)
tests/test-suite.js      75-test accuracy suite (node tests/test-suite.js)
cli.js                   render/inspect/zoom/export driver
serve.js                 zero-dependency static server for the sandbox
prototype.html           browser sandbox
scenes/                  experiment scenes (64×64 house/campfire, 128×128 house128/robot, 256×256 landscape)
out/                     generated PNGs, previews, screenshots
docs/FINDINGS.md         experiment log, failures, research answers
```

## Status and next steps

The 64×64 baseline is validated and **hash-locked by a 75-test accuracy
suite** — any engine change that moves a single pixel fails the run. The
representation also scales: 128×128 and 256×256 scenes were authored and
verified pixel-exact (including a 2× upscale of the house). Documented next
experiments (in `docs/FINDINGS.md`):

1. Stress the repair loop: deliberately flawed scenes, measure render→inspect→fix cycles
2. Package the workflow as an installable agent skill (`pixel-art-generation`)
3. Optionally expose the tool API as MCP tools

## Known limitations

- Experimental prototype: no CI, no packaging
- PNG encoder uses a hand-rolled fixed-Huffman DEFLATE (RFC 1951) — byte-valid
  (round-trip verified against zlib), but not the most compact compression
- ASCII inspection is the agent's primary "eyes" — pixel probes and `inspect()` stats are more reliable than eyeballing ASCII rows (see FINDINGS §5)