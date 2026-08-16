---
name: pixel-engine
description: Technical reference for operating the pixel-engine. Use when working with the engine's internals, scene or animation document formats, API functions, coordinate system, colors, regions, frames, spritesheets, PNG export, rendering behavior, or known limitations and failure modes. Not an art skill — for art decisions use pixel-art-planner, pixel-art-builder, and pixel-art-critic; for animation work use pixel-animation.
---

# pixel-engine

"How do I operate this machine?" — the technical reference. Art decisions belong to the planner, builder, and critic skills; animation work belongs to pixel-animation. This skill is about the machine itself.

## Engine architecture

- `engine/pixel-engine.js` — UMD module (~700 lines, zero dependencies): scene documents, rasterizer, inspection tools, PNG encoder, HTML preview. `require()` in Node, `window.PixelEngine` in the browser.
- `engine/animation.js` — loads after pixel-engine and attaches to the same object: animation documents, frame ops, exact diffing, validation, spritesheets.
- `cli.js` — render / inspect / zoom / export driver, plus the `anim` subcommand.
- `serve.js` — zero-dependency static server for the browser sandbox (`prototype.html`).

## Canvas representation

- A canvas is a **scene document**: plain JSON `{ size, palette, layers, pixels }`.
- `size` is the square side length (16, 32, 64, 128, 256, ...).
- The canvas is **transparent by default** — there is no implicit background; a `fill` layer provides one when needed.

## Pixel representation

- The rasterized buffer is RGBA (`Uint8Array`, 4 bytes per pixel), produced by `rasterize(scene)` / `render(scene)`.
- The `pixels` map uses string keys `"x,y"` → palette key; `null` clears an override.
- Pixels are addressed `(x, y)` with **0-based coordinates, y down**: `(0,0)` is top-left, `(size-1, size-1)` is bottom-right.

## Coordinate system

- x: `0..size-1` left → right; y: `0..size-1` top → bottom.
- Shapes accept fractional parameters (e.g. ellipse `cx=7.5`, `rx=6.5`) — the rasterizer tests pixel centers.
- `read_region(scene, x, y, w, h, opts)` reads a sub-rectangle; `opts.scale` controls ASCII sampling (auto-scaled to ≤40 chars wide by default).

## Colors

- Palette: `{ key: "#hex" }`. Layers and pixels reference **keys, never raw hex** — the palette guarantees consistency and readable `inspect()` output.
- Editing a palette key's hex recolors every pixel using that key — the engine-native recolor.
- `inspect(scene)` reports per-color counts + bounding boxes keyed by hex.

## Regions

- `fill_region(scene, x, y, w, h, color, id)` — filled rect layer.
- `read_region(scene, x, y, w, h, opts)` — ASCII map or per-color counts.
- Frame-level region ops: `fill_frame_region`, `move_frame_region`, `copy_frame_region` (see Frames).

## Frames

- An animation document: `{ width, height, fps, palette, keyframes, frames }`; each frame is `{ id, scene }` where `scene` is a full scene document.
- Frames are complete scenes — deltas are computed, not stored.
- `duplicate_frame` deep-copies; the authoring model is duplicate + modify.
- `move_frame_region` / `copy_frame_region` operate on rasterized buffers and write pixel overrides — they erase by revealing the layers beneath; to erase over a filled background, fill the region with the background color instead.

## Animation API

Full table in `references/api.md` — frame lifecycle, pixel ops, region ops, keyframes, diffing, validation, palette consistency, spritesheets, HTML preview.

## Import / export

- `encode_png(scene)` → PNG bytes; `export_png(scene, path)` → PNG file.
- `encode_png_buffer(rgba, w, h)` → PNG bytes from an arbitrary RGBA buffer (spritesheets).
- `scene_to_html(scene, opts)` / `animation_to_html(anim, opts)` → self-contained interactive previews.
- CLI: `node cli.js <scene.json> --png out.png --html out.html`.

## Spritesheets

- `encode_spritesheet(anim, opts)` / `export_spritesheet(anim, path, opts)` — PNG sheet of all frames. Export format only — never the internal representation.

## Rendering

- `rasterize(scene)`: transparent buffer → layers painted in order (painter's algorithm) → `pixels` overrides applied last.
- Layer types: `fill`, `rect`, `rectout` (thickness `t`), `ellipse` (pixel-center test), `line` (Bresenham), `poly` (scanline fill), `polyout` (edge lines).
- Rect scan range: `floor(x)..ceil(x+w)-1`, clamped to the canvas. Ellipse scan range: `floor(cx-rx)..ceil(cx+rx)` — the pixel-center test decides which pixels actually paint, so verify real bounds with `inspect()`.

## Limitations

- PNG encoder uses a hand-rolled fixed-Huffman DEFLATE (RFC 1951) — byte-valid (round-trip verified against zlib), not the most compact compression.
- Frames are square like scenes (the engine rasterizes square canvases).
- ASCII inspection is the agent's primary "eyes" — pixel probes and `inspect()` stats are more reliable than eyeballing ASCII rows (FINDINGS §5).

## Known failure modes

- **Unused palette keys** — declared but never painted; the render is unaffected but the record is wrong. Check with `inspect()`.
- **Unexpected mutations** — pixel overrides landing outside the intended region; verify with `read_region` zooms + `inspect` bboxes.
- **Edge clipping** — shapes at the canvas edge get clamped; keep 1–2px margins.
- **Erase-by-reveal** — `move_frame_region` / `clear_frame_pixel` reveal layers beneath; fill with the background color to erase over a filled background.
- **Fractional drift** — fractional shape params rasterize by pixel-center test; verify actual bounds with `inspect()` rather than assuming.