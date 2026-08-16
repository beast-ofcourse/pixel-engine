---
name: pixel-art-generation
description: "Create pixel art with pixel-engine: author declarative scene documents (square canvas, palette keys, ordered shape layers, sparse pixel overrides), render, inspect, and iterate. Use when building pixel art, sprites, icons, or game art as structured JSON scenes; when rendering scenes via cli.js; when debugging why a scene renders wrong; when verifying pixel-exact output. Covers the render→inspect→fix loop, palette discipline, layer ordering, and hash-locked verification."
---

# Pixel Art Generation with pixel-engine

Build pixel art as **declarative scene documents** — layers, palette, sparse
pixel overrides — then render → inspect → fix with the engine's tools. Never
emit pixels one by one: reason about ~15–20 shapes instead of thousands of
pixels. The engine is zero-dependency and runs in Node and the browser.

## The scene document

```json
{
  "size": 64,
  "palette": { "sky": "#7EC8E3", "roof": "#C25B3A", "dark": "#2B2B2B" },
  "layers": [
    { "id": "sky", "type": "fill", "color": "sky" },
    { "id": "roof", "type": "poly", "points": [[13,28],[51,28],[32,11]], "color": "roof" }
  ],
  "pixels": { "25,36": "dark", "30,43": "gold" }
}
```

Rules that keep the representation consistent:

- **`size` must be square** (64, 128, 256…). The engine rasterizes square canvases only.
- **Colors are palette keys, never raw hex** in the document. Semantic names (`roofDark`, `logDark`) make `inspect()` stats readable and mistakes visible.
- **Layers paint in order** (painter's algorithm) — later layers overwrite earlier ones. Layer order *is* the compositing: chimney behind roof, logs in front of flames.
- **`pixels` is a sparse override map** for sub-shape detail (window crosses, door knobs, stars). `null` clears — the layer beneath shows through.
- **Layer types**: `fill` (whole canvas), `rect` (x,y,w,h), `rectout` (x,y,w,h,t), `ellipse` (cx,cy,rx,ry), `line` (x1,y1,x2,y2), `poly` (points), `polyout` (points). Every layer takes `color`; `id` is optional (auto `layerN`).

## Workflow

1. **Compose before detail** — silhouette first: what shapes, in what order, with what palette (5–12 colors). Declare symmetry by centering shapes on the canvas midline (x=32 for 64), not by drawing both sides.
2. **Author the scene** — palette → layers back-to-front → pixel overrides for sub-shape detail only.
3. **Render + inspect** — `node cli.js scenes/<name>.json --png out/<name>.png --html out/<name>.html`. Done when the CLI prints stats and writes both files.
4. **Read the eyes** — the ASCII preview (auto-scaled ≤40 chars) for coarse layout; `inspect()` stats (per-color counts + bounding boxes) for exactness. The bboxes are the highest-value signal: a window bbox that should be `[22,33,6,6]` reveals misalignment instantly.
5. **Fix locally** — edit only the affected layer(s)/pixels in the JSON, re-run. Never rewrite the whole scene for one defect.
6. **Verify** — lock the rasterize hash + pixel probes in `tests/test-suite.js`; confirm browser == Node (canvas sample hash equals the Node hash). Done when the suite is green and the browser render matches.

## Lessons (hard-won, from the experiment log)

- **ASCII eyeballing is unreliable for defect detection.** Three times a "defect" read from ASCII rows was a miscount; `get_pixel` probes were always right. Trust `inspect()` stats + targeted pixel probes; use ASCII only for coarse spatial layout.
- **Verify exports with an independent decoder** (zlib.inflateSync or a browser), not just your own reader. A missing zlib wrapper decoded silently to a fully transparent image — silent transparency is worse than a loud crash.
- **Probe discipline**: lock probes *and* hashes together. The hash is ground truth; probes document intent. Probe coordinates can land on the wrong element — check the legend + bbox stats before trusting a probe.
- **Verify the verifier before blaming the engine.** A full-canvas diff once reported 2,080 "differences" that traced the house shape — the harness had a sampling bug, not the engine.
- **Semantics locked by tests**: `null` pixel override means "no override — layer beneath shows" (not an alpha-0 hole); `rect` fractional widths use `ceil(x+w)-1`; polygon scanline is half-open; `Math.round` ties round up.

## CLI

```text
node cli.js <scene.json> [--png out.png] [--html out.html]
                        [--zoom x,y,w,h] [--counts x,y,w,h] [--scale n]
```

- `--zoom` prints a full-resolution ASCII region (the workhorse at 128×128+).
- `--counts` prints per-color pixel counts in a region.
- `--scale` overrides ASCII preview sampling (default: auto ≤40 chars).

## Verification

- `node tests/test-suite.js` — 117-test accuracy suite; every published scene is hash-locked (any engine change that moves a single pixel fails the run).
- Browser: `node serve.js` → http://localhost:8734 → open `out/<name>.html`, probe rendered pixels.

## Reference

Full API tables (engine functions, layer params, CLI): `references/api.md`.