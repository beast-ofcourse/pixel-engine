---
name: pixel-art-builder
description: Construct pixel-art assets with the pixel-engine. Use when building, editing, or fixing a sprite, scene, or asset from a plan (from the pixel-art-planner or a direct request), when constructing pixels with the engine API (create_canvas, fill_region, draw_shape, set_pixel, read_region, inspect), when shading, highlighting, or detailing pixel art, or when a render-inspect-fix loop is needed. Knows the engine's actual API — see references/api.md.
---

# pixel-art-builder

Build pixel art as structured scene documents, not pixel by pixel. The engine rasterizes shapes; you author shapes. Thousands of individual `set_pixel` calls are a failure mode, not a technique.

## Primitive selection — choose the shape to the geometry

The single most important construction decision is **which primitive fits the object's geometry**:

- **Organic curved form** (creature, flame, leaf, cloth, horn, tail, head) → `curve` (smooth spline blob) or `poly` / `polyout` contour. Never a rectangle.
- **Rectilinear form** (chest, building, platform, UI, mechanical block) → `rect` / `fill_region`.
- **Rounded form** (coin, potion body, orb, wheel) → `ellipse`.
- **Small detail** (eye, glint, seam, star) → pixel override or a tiny cluster via `draw_cluster`.

Rectangles are not forbidden — they are wrong only when the geometry is not rectangular. A creature built from rectangles is the classic failure; a chest built from polygons is equally wrong.

## Contour-first construction (organic forms)

For organic forms, construct the **outer contour before any interior work**:

1. **Contour** — one `poly` (filled) for the whole silhouette: head + body + tail as a single outline, not per-part shapes.
2. **Silhouette check** — render and verify the contour reads at native resolution before adding anything inside.
3. **Interior fill** — belly, chest, wing membranes as separate `poly` layers inside the contour.
4. **Major forms** — limbs, ears, horns, fins as their own shapes, overlapping the contour.
5. **Shading** — dark/mid/light per material; upper-left lighting (light on top/left edges, shadow on bottom/right).
6. **Pixel refinement** — sparse overrides for eyes, glints, claws, teeth.

**One silhouette contour, not per-part outlines.** Outlining each part separately paints interior lines where parts overlap — the body's outline cuts across the head. Draw ONE `polyout` around the whole creature's outer edge, last.

## Layer ordering rules

The painter's algorithm decides what is visible. Order matters:

1. Back forms first (tail behind body, far limbs behind torso).
2. Interior fills (belly, membranes) after the main forms.
3. Shade after interior fills — but **never after parts that must stay visible**: legs, feet, and overlapping parts are painted AFTER shade.
4. The light underside (belly) is painted **after** the shade so the shade frames it — a full-width shade band otherwise covers the belly.
5. Light/highlights after shade.
6. **Outline LAST** — a single `polyout` contour on top of everything.

## Part connection

- Parts must **overlap** their neighbors — a tail that merely touches the body leaves transparent gaps at the junction.
- Prefer **convex** part shapes. Concave thin polygons can produce degenerate scanline fills (odd edge crossings) that leave holes.
- After rendering, zoom the junctions and verify no transparent pixels separate connected parts.

## Small parts and outline thickness

- Parts smaller than ~4px across should not carry their own outline — the outline swallows the interior. Let the main contour outline them.
- Outline thickness is 1px. Shallow diagonal contour edges can paint 2px bands — check the silhouette for uneven thickness and adjust the contour points.
- A tapered tip (tail, horn) naturally loses its interior to the outline — that is correct; the taper reads as a point.

## Craft rules — what makes it look good, not just correct

Correctness is the floor; craft is the ceiling. These rules come from human pixel-art practice and are checkable:

1. **Hue-shifted shading** — shadows shift toward blue/purple, highlights shift toward yellow. Never shade by making the base hue darker or lighter only — a pure-darker shadow looks flat and muddy. Shadow = base hue + blue/purple; highlight = base hue + yellow.
2. **Outline color** — the outline is the darkest shade of the object's hue family, not pure black. Pure black outlines flatten the piece. Near-black (#1A1A1A) is reserved for tiny details (eyes, seams) where hue is invisible at 1px.
3. **Value compression** — 3–4 value steps per material: outline (darkest) + shadow + mid + light. Fewer steps at 16×16, more at 64×64+. If a material needs 5+ steps, merge two.
4. **Silhouette readability** — the subject must be identifiable from the outline alone at native resolution. Render the outline layer by itself and check.
5. **Detail economy** — 1–2 pixel overrides at 16×16, 2–4 at 32×32, 4–8 at 64×64. Every override must earn its pixel: eye, glint, seam. More than that is noise.
6. **Light-source consistency** — upper-left lighting: light on top/left edges, shadow on bottom/right. The light layer's bbox sits above-left of the shade layer's bbox.

## Construction pipeline

silhouette → major forms → internal structure → palette → shading → highlights → details → cleanup

1. **Silhouette** — the contour-first procedure above (organic) or the rect/ellipse composition (rectilinear).
2. **Major forms** — the big interior regions, back to front (painter's algorithm).
3. **Internal structure** — sub-forms inside the major regions (windows, blades, faces, liquid).
4. **Palette** — assign the planned named keys (5–12 colors, no dead keys), per the craft rules: hue-shifted shadow/highlight, hue-family outline, 3–4 value steps. Editing a palette key's hex recolors every pixel using that key — the engine-native way to replace a color.
5. **Shading** — dark/mid/light per material; upper-left lighting.
6. **Highlights** — sparse bright pixels on lit edges.
7. **Details** — sparse pixel overrides for the last 5% (glints, crosses, stars, seams).
8. **Cleanup** — verify: no unused palette keys, no unexpected mutations, 1–2px margins, every key painted, junctions connected. Run `validate_scene(scene)` and the craft checks (`analyze_values`, `check_hue_shift`) as the final gate — the craft checks are HIGH defects (fix before ship) even when FACT checks pass.

## Bulk operations first

Prefer region operations over individual `set_pixel` calls:

- `fill_region(scene, x, y, w, h, color)` — fill a rectangular region
- `mirror_region(scene, x, y, w, h, axis)` — mirror a region across its centerline (`'h'` left↔right, `'v'` top↔bottom); build one side of a creature, mirror the other
- `draw_shape(scene, type, params)` — any shape: `fill`, `rect`, `rectout`, `ellipse`, `line`, `poly`, `polyout`, `curve` (params: `points`, `closed?`)
- `move_frame_region(anim, frameId, x, y, w, h, dx, dy)` — move a region within a frame
- `copy_frame_region(anim, srcId, dstId, x, y, w, h, dx, dy)` — copy a region between frames
- `fill_frame_region(anim, frameId, x, y, w, h, color)` — fill a frame region
- `replace_color(scene, from, to)` — recolor document-level by palette key or hex (rewrites layers + pixels; a new hex is added to the palette)
- `flood_fill(scene, x, y, color, tolerance?)` — fill a bounded area from a seed point without knowing its polygon (writes overrides; fill with the background color to erase)
- `draw_cluster(scene, x, y, pattern, color)` — paint a reusable pattern (scales, feathers, leaves, stars): `[[dx,dy],...]` offsets or a string grid like `["X.X", ".X."]`
- `move_region(scene, x, y, w, h, dx, dy)` / `copy_region(scene, x, y, w, h, dx, dy)` — scene-level move/copy (same semantics as the frame versions)
- `extract_outline(scene, region?)` — boundary pixels of a painted silhouette (`[{x, y}]`, row-major); pass a `{x, y, w, h}` region to isolate a character's outline against a filled background
- `poly_union(a, b)` / `poly_subtract(a, b)` — combine polygon point arrays for shape editing (single-contour results; disjoint union concatenates both contours, holes aren't representable)
- `diff_scenes(a, b)` — scene diff on resolved buffers: `{ changed, unchanged, pct, bbox, changes[] }` (different sizes → error; identical → 0 changed, null bbox)
- `replace_color_region(scene, x, y, w, h, from, to)` — buffer-level recolor in a region (clamped; empty/from===to → no-op)
- `check_symmetry(scene, axis, region?)` — symmetry check: `{ symmetric, diffCount, diffPixels[] }` (`'h'` left↔right, `'v'` top↔bottom; center skipped; empty → symmetric)
- `dither_region(scene, x, y, w, h, opts)` — Bayer 4×4 ordered dithering between `{ from, to }` (gradient left→right, writes overrides)
- `measure_distance(x1, y1, x2, y2)` — Euclidean distance for proportion checks

Use `set_pixel`/`clear_pixel` only for sparse detail overrides (the scene's `pixels` map). If you are writing more than a handful of `set_pixel` calls for the same region, stop — use a shape or a region operation instead.

Prefer `place_part`/`add_layer`/`diff_scenes` patches over `JSON.stringify(scene)` — a full scene rewrite is a 400k-token failure mode. Emit `get_patch(oldScene, newScene)` or call granular mutators; never re-emit the unchanged 18-layer scene.

## The render → inspect → fix loop (patch-first, hard-stop)

After each construction phase:

1. `diff_scenes(prevScene, scene)` — terse diff: `{ changed, bbox, changes }` only. Do NOT re-emit the full scene; emit a patch (`get_patch`) or call granular mutators (`add_layer`, `set_pixel`, `place_part`, `replace_color_region`).
2. `inspect` only the bbox: `read_region(scene, bbox[0], bbox[1], bbox[2], bbox[3])` at scale 1, not the full canvas. Full-canvas `inspect` only on the first iteration.
3. Taste check: `validate_scene` + `analyze_values` + `check_hue_shift` — if FAIL, fix palette before adding geometry.
4. **Hard stop**: stop when `validate_scene` PASS and `check_hue_shift` PASS and (`compare_scene_to_reference` IoU>0.9 if reference exists), or after 5 iterations — whichever comes first. Do not iterate past 5.
5. Context pruning: keep only `last_scene + diff`, not the full history. The MCP server's `diff_scenes` is the only inspection that stays in context beyond the last turn.

Verify before concluding: silhouette bbox within 1–2px margins, every palette key painted, zero unexpected mutations, all part junctions connected.

## Import / export + agent-loop tools

- `decode_png(bytes)` → `{ width, height, rgba }` — import PNG art (8-bit RGB/RGBA/palette, all 5 filter types). Node zlib backend; browser decode is not implemented in v1.
- `quantize_palette(rgba, maxColors?)` → `{ palette, indices }` — extract a palette from imported art (median-cut; default 16; `-1` index = fully transparent).
- `validate_scene(scene)` → `{ valid, errors[] }` — scene-document integrity gate (size ladder, palette 5–12 keys, known layer types with in-bounds params, valid pixel keys/values).
- `encode_apng(anim, opts?)` / `export_apng(anim, path, opts?)` — lossless animated export (opts: `fps`, `loop`).
- `encode_gif(anim, opts?)` / `export_gif(anim, path, opts?)` — GIF89a export (≤256 unique colors; more → error).
- `diff_scenes(a, b)` / `check_symmetry` / `measure_distance` / `dither_region` / `replace_color_region` — iteration comparison and provable critic FACT checks (see Bulk operations).
- `compare_scene_to_reference(scene, refRgba, opts?)` — reference evaluation (silhouette IoU, palette & histogram distance; auto-scales ref).
- `analyze_values(scene)` / `check_hue_shift(palette)` — craft checks: value steps & hue-shifted shading per family.

## API reference

The full verified engine API is in `references/api.md` — consult it before calling any function you are unsure about. Never call engine functions from memory.