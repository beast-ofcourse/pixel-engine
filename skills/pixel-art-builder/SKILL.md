---
name: pixel-art-builder
description: Construct pixel-art assets with the pixel-engine. Use when building, editing, or fixing a sprite, scene, or asset from a plan (from the pixel-art-planner or a direct request), when constructing pixels with the engine API (create_canvas, fill_region, draw_shape, set_pixel, read_region, inspect), when shading, highlighting, or detailing pixel art, or when a render-inspect-fix loop is needed. Knows the engine's actual API — see references/api.md.
---

# pixel-art-builder

Build pixel art as structured scene documents, not pixel by pixel. The engine rasterizes shapes; you author shapes. Thousands of individual `set_pixel` calls are a failure mode, not a technique.

## Primitive selection — choose the shape to the geometry

The single most important construction decision is **which primitive fits the object's geometry**:

- **Organic curved form** (creature, flame, leaf, cloth, horn, tail, head) → `poly` / `polyout` contour. Never a rectangle.
- **Rectilinear form** (chest, building, platform, UI, mechanical block) → `rect` / `fill_region`.
- **Rounded form** (coin, potion body, orb, wheel) → `ellipse`.
- **Small detail** (eye, glint, seam, star) → pixel override or a tiny cluster.

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
8. **Cleanup** — verify: no unused palette keys, no unexpected mutations, 1–2px margins, every key painted, junctions connected.

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

Verify before concluding: silhouette bbox within 1–2px margins, every palette key painted, zero unexpected mutations, all part junctions connected.

## API reference

The full verified engine API is in `references/api.md` — consult it before calling any function you are unsure about. Never call engine functions from memory.