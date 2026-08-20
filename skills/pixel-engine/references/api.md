# pixel-engine API reference

Verified against `engine/pixel-engine.js` and `engine/animation.js` in this repo. Never call engine functions from memory — check this table first.

## Scene document

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

- `size`: square canvas size
- `palette`: `{ key: "#hex" }` — layers and pixels reference **keys, never raw hex**
- `layers`: painted in order (painter's algorithm). Layer types: `fill`, `rect`, `rectout`, `ellipse`, `line`, `poly`, `polyout`, `curve`
- `pixels`: sparse override map `{ "x,y": key }`; `null` clears

## pixel-engine.js — scene-level API

| Function | Signature | Purpose |
|---|---|---|
| `create_canvas` | `(size, background)` | New scene document |
| `add_layer` | `(scene, layer)` | Append a layer |
| `fill_region` | `(scene, x, y, w, h, color, id)` | Filled rect layer |
| `draw_shape` | `(scene, type, params)` | Generic shape layer |
| `set_pixel` | `(scene, x, y, color)` | Sparse override |
| `clear_pixel` | `(scene, x, y)` | Clear an override |
| `get_pixel` | `(scene, x, y)` | Resolved color at a coordinate |
| `mirror_region` | `(scene, x, y, w, h, axis)` | Mirror a region across its centerline (`'h'`/`'v'`), writes overrides |
| `replace_color` | `(scene, from, to)` | Document-level recolor by palette key or hex |
| `flood_fill` | `(scene, x, y, color, tolerance?)` | Fill the 4-connected region of the seed's color, writes overrides |
| `draw_cluster` | `(scene, x, y, pattern, color)` | Paint a reusable pixel pattern (offset array or string grid), writes overrides |
| `move_region` | `(scene, x, y, w, h, dx, dy)` | Move a region's opaque pixels, writes overrides (erase-by-reveal) |
| `copy_region` | `(scene, x, y, w, h, dx, dy)` | Copy a region's opaque pixels, writes overrides |
| `extract_outline` | `(scene, region?)` | Boundary pixels `[{x, y}]` of the painted silhouette (4-neighbor transparent/out-of-canvas/out-of-region) |
| `poly_union` | `(a, b)` | Point array of the union of two polygon point arrays (single contour; disjoint inputs concatenate both contours) |
| `poly_subtract` | `(a, b)` | Point array of `a` minus `b` (single contour; `a` fully inside `b` → `null`; hole results return `a` — holes are not representable) |
| `rasterize` | `(scene)` | RGBA pixel buffer |
| `render` | `(scene)` | RGBA pixel buffer (alias) |
| `inspect` | `(scene)` | Per-color counts + bounding boxes |
| `read_region` | `(scene, x, y, w, h, opts)` | ASCII map or color counts (multi-resolution) |
| `encode_png` | `(scene)` | PNG bytes |
| `export_png` | `(scene, path)` | PNG file |
| `encode_png_buffer` | `(rgba, w, h)` | PNG bytes from an arbitrary RGBA buffer (spritesheets) |
| `encode_apng_buffer` | `(frames, w, h, opts)` | APNG bytes from frame buffers (opts: `fps`, `loop`) |
| `decode_png` | `(bytes)` | `{ width, height, rgba }` — PNG import (Node zlib backend; 8-bit RGB/RGBA/palette) |
| `quantize_palette` | `(rgba, maxColors)` | `{ palette, indices }` — median-cut palette extraction (default 16; `-1` = transparent) |
| `validate_scene` | `(scene)` | `{ valid, errors[] }` — scene-document integrity (size ladder, palette 5–12, layer/pixel bounds) |
| `diff_scenes` | `(a, b)` | `{ changed, unchanged, pct, bbox, changes[] }` + aliases (`changed_pixels`, `bounding_box`, …) on resolved buffers |
| `replace_color_region` | `(scene, x, y, w, h, from, to)` | Buffer-level recolor limited to a region, writes overrides (clamped; empty/from===to → no-op) |
| `measure_distance` | `(x1, y1, x2, y2)` | Euclidean distance (float) |
| `check_symmetry` | `(scene, axis, region?)` | `{ symmetric, diffCount, diffPixels[] }` — region vs its mirror (`'h'`/`'v'`; center skipped) |
| `dither_region` | `(scene, x, y, w, h, opts)` | Ordered Bayer 4×4 dithering between two colors `{ from, to }`, writes overrides (gradient left→right) |
| `compare_scene_to_reference` | `(scene, refRgba, opts?)` | `{ silhouetteIoU, paletteDistance, histogramDistance, perKeyDistance }` (auto-scales ref; `region` opts) |
| `analyze_values` | `(scene)` | `{ families, totalFamilies, warnings[] }` — value steps per material family |
| `check_hue_shift` | `(palette)` | `{ results: [{ family, status, note }], pass }` — hue-shifted shading check |
| `encode_compact` | `(scene)` | Compact scene encoding `{ s, p, l, x }` (short keys, palette indices, flat points) |
| `decode_compact` | `(compact)` | Decode compact to verbose scene (lossless) |
| `get_patch` | `(oldScene, newScene)` | `{ p, l, x, s }` patch (palette/layers/pixels deltas, <30% of full scene) |
| `apply_patch` | `(scene, patch)` | Apply patch in place (mutates scene) |
| `scene_to_html` | `(scene, opts)` | Interactive preview HTML |

## animation.js — frame-level API

| Function | Signature | Purpose |
|---|---|---|
| `create_animation` | `(w, h, opts)` | New animation document |
| `normalize_animation` | `(anim)` | Validate / normalize |
| `add_frame` | `(anim, scene)` | Append a frame |
| `duplicate_frame` | `(anim, frameId)` | Deep-copy a frame |
| `delete_frame` | `(anim, frameId)` | Remove a frame |
| `frame_ids` | `(anim)` | List of frame ids |
| `resolve_frame` | `(anim, frameId)` | RGBA buffer of a frame |
| `set_frame_pixel` | `(anim, frameId, x, y, color)` | Frame pixel override |
| `get_frame_pixel` | `(anim, frameId, x, y)` | Frame pixel read |
| `clear_frame_pixel` | `(anim, frameId, x, y)` | Frame pixel clear |
| `fill_frame_region` | `(anim, frameId, x, y, w, h, color)` | Frame region fill |
| `move_frame_region` | `(anim, frameId, x, y, w, h, dx, dy)` | Move a region within a frame |
| `copy_frame_region` | `(anim, srcId, dstId, x, y, w, h, dx, dy)` | Copy a region between frames |
| `set_keyframe` | `(anim, frameId, value)` | Keyframe marker |
| `is_keyframe` | `(anim, frameId)` | Keyframe check |
| `diff_frames` | `(anim, aId, bId)` | Exact diff: changed/unchanged counts, %, bbox, per-pixel changes |
| `validate_change` | `(anim, aId, bId, allowed_region)` | PASS/FAIL against an allowed region + unexpected list |
| `frame_palette` | `(anim, frameId)` | Resolved color usage |
| `palette_drift` | `(anim)` | Palette consistency across frames |
| `encode_spritesheet` | `(anim, opts)` | PNG sheet (export only) |
| `export_spritesheet` | `(anim, path, opts)` | PNG sheet file |
| `encode_apng` | `(anim, opts)` | APNG bytes (opts: `fps`, `loop`) |
| `export_apng` | `(anim, path, opts)` | APNG file |
| `encode_gif` | `(anim, opts)` | GIF89a bytes (opts: `fps`, `loop`; >256 colors → error) |
| `export_gif` | `(anim, path, opts)` | GIF file |
| `animation_to_html` | `(anim, opts)` | Self-contained playback preview HTML |

## Notes

- `move_frame_region` / `copy_frame_region` operate on rasterized buffers and write pixel overrides. They erase by revealing the layers beneath — to erase over a filled background, fill the region with the background color instead.
- `mirror_region` operates on the rasterized buffer and writes pixel overrides (transparent pixels are skipped — nothing is erased). Out-of-bounds regions are clamped; odd widths keep the center column; mirroring twice is idempotent.
- `replace_color(scene, from, to)` recolors document-level (survives re-render): `from`/`to` are palette keys or hexes. If `from` is a hex, every key whose hex equals it is remapped. Layer colors and pixel overrides are rewritten; a `to` hex not in the palette is added as a key (`color0`, `color1`, …). `from` matching nothing or `from === to` is a no-op; an unknown `to` key throws.
- `flood_fill(scene, x, y, color, tolerance?)` fills the 4-connected region of the seed's resolved color, writing pixel overrides. `tolerance` (0 = exact, default) is the max per-channel RGB difference, clamped to [0, 255]. A transparent seed fills the connected transparent region. Seed out of bounds or already the fill color → no-op; fill with the background color to erase (erase-by-reveal).
- `curve` layers are smooth Catmull-Rom splines through `points` (pixel-center fill, scanline rasterized like `poly`). `closed: true` fills the loop; an open curve fills the region bounded by the spline and its closing chord. <2 points paints nothing; out-of-bounds points are clipped.
- `draw_cluster(scene, x, y, pattern, color)` paints a pattern at (x, y) as pixel overrides. `pattern` is an array of `[dx, dy]` offsets or a string grid (each row a string; any char other than `.` or space paints). Out-of-bounds offsets are skipped; an empty pattern is a no-op.
- `move_region` / `copy_region` mirror the frame-level ops: buffer-level, override writes, erase-by-reveal (move clears sources with null overrides — to erase over a filled background, fill the region with the background color instead). Overlapping moves clear every source before writing destinations; destinations out of bounds are clipped.
- `extract_outline(scene, region?)` returns the 4-connected boundary pixels of the painted silhouette as `[{x, y}, ...]` in row-major order. A boundary pixel is painted and has a 4-neighbor that is transparent, out of canvas, or out of the optional `{x, y, w, h}` region (whole canvas when omitted). Empty region → `[]`; a fully painted canvas returns the canvas edge ring.
- `poly_union(a, b)` / `poly_subtract(a, b)` operate on polygon point arrays (`[[x, y], ...]`) via a Weiler–Atherton traversal; results are single contours. Disjoint union returns both contours concatenated — rasterize those separately (a single even-odd fill of the concatenation draws a spurious wedge). A hole result (subtract with the clip fully inside the subject) returns the subject — holes are not representable as one contour. Degenerate inputs (fewer than 3 points, zero area) are handled: union returns the other polygon (or `null`), subtract returns `null` for a degenerate subject.
- Frames are square like scenes (the engine rasterizes square canvases).