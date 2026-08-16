---
name: pixel-art-builder
description: Construct pixel-art assets with the pixel-engine. Use when building, editing, or fixing a sprite, scene, or asset from a plan (from the pixel-art-planner or a direct request), when constructing pixels with the engine API (create_canvas, fill_region, draw_shape, set_pixel, read_region, inspect), when shading, highlighting, or detailing pixel art, or when a render-inspect-fix loop is needed. Knows the engine's actual API — see references/api.md.
---

# pixel-art-builder

Build pixel art as structured scene documents, not pixel by pixel. The engine rasterizes shapes; you author shapes. Thousands of individual `set_pixel` calls are a failure mode, not a technique.

## Construction pipeline

silhouette → major forms → internal structure → palette → shading → highlights → details → cleanup

1. **Silhouette** — outline shapes first (`draw_shape` with `poly`/`rect`/`ellipse` in the outline color). The silhouette must read at native resolution before any interior work.
2. **Major forms** — the big interior regions, back to front (painter's algorithm).
3. **Internal structure** — sub-forms inside the major regions (windows, blades, faces, liquid).
4. **Palette** — assign the planned named keys (5–12 colors, no dead keys). Editing a palette key's hex recolors every pixel using that key — the engine-native way to replace a color.
5. **Shading** — dark/mid/light per material; upper-left lighting (light on top/left edges, shadow on bottom/right).
6. **Highlights** — sparse bright pixels on lit edges.
7. **Details** — sparse pixel overrides for the last 5% (glints, crosses, stars, seams).
8. **Cleanup** — verify: no unused palette keys, no unexpected mutations, 1–2px margins, every key painted.

## Bulk operations first

Prefer region operations over individual `set_pixel` calls:

- `fill_region(scene, x, y, w, h, color)` — fill a rectangular region
- `draw_shape(scene, type, params)` — any shape: `fill`, `rect`, `rectout`, `ellipse`, `line`, `poly`, `polyout`
- `move_frame_region(anim, frameId, x, y, w, h, dx, dy)` — move a region within a frame
- `copy_frame_region(anim, srcId, dstId, x, y, w, h, dx, dy)` — copy a region between frames
- `fill_frame_region(anim, frameId, x, y, w, h, color)` — fill a frame region
- Palette edits — recolor by changing the palette key's hex

Use `set_pixel`/`clear_pixel` only for sparse detail overrides (the scene's `pixels` map). If you are writing more than a handful of `set_pixel` calls for the same region, stop — use a shape or a region operation instead.

## The render → inspect → fix loop

After each construction phase:

1. `read_region(scene)` — auto-scaled ASCII preview of the whole canvas
2. `inspect(scene)` — per-color counts + bounding boxes
3. `read_region(scene, x, y, w, h)` — full-resolution zoom on problem areas
4. Diagnose, fix surgically, re-render

Verify before concluding: silhouette bbox within 1–2px margins, every palette key painted, zero unexpected mutations.

## API reference

The full verified engine API is in `references/api.md` — consult it before calling any function you are unsure about. Never call engine functions from memory.