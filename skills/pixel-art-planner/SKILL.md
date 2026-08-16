---
name: pixel-art-planner
description: Plan a pixel-art asset before any pixels are touched. Use when starting a new sprite, scene, or asset at any size (16x16 to 256x256), when asked to design or plan pixel art, when a request needs canvas/resolution selection, bounding box, composition, silhouette, major regions, palette, lighting direction, or construction-order decisions, or before handing construction off to the pixel-art-builder. Produces the plan the builder executes.
---

# pixel-art-planner

Plan first, build second. The builder executes; the planner decides. A plan costs a few tokens; a wrong canvas, palette, or silhouette costs an entire rebuild.

## Pipeline

request → analyze → decompose → plan → hand off

1. **Analyze the request** — what is the subject, at what scale, in what style? Extract every constraint: size hints, palette hints, animation needs, game context, reference material.
2. **Decompose** — split the subject into its structural parts (sword = blade + guard + grip + pommel; house = roof + walls + door + windows; potion = cork + neck + body + liquid). Each part becomes a region or a layer.
3. **Plan** — write the plan document (below). Every section must be filled before the plan is done.
4. **Hand off** — pass the plan to the pixel-art-builder. The builder does not re-decide the plan; it executes it. Do not touch pixels yourself.

## The plan document

Write the plan as a compact markdown block with these nine sections, in order:

### 1. Canvas / resolution

- Size ladder: 16×16 basic object, 32×32 weapon/tool, 64×64 creature/character, 128×128 scene, 256×256 landscape.
- Rule: pick the smallest canvas that fits the subject's detail budget. Density scales with canvas — sparse at 16×16, detailed at 64×64. Same subject at two scales must keep its silhouette and material treatment.

### 2. Bounding box

- Target silhouette bbox with 1–2px margins on all sides — artwork never touches the canvas edge.
- State the intended bbox explicitly, e.g. "silhouette bbox [2,2,12,12] on 16×16".

### 3. Composition

- Placement: centered unless the subject dictates otherwise.
- Layering order (painter's algorithm): back to front. State the overlap relationships between parts.

### 4. Silhouette planning

- The outline shape first — it must read at native resolution before any interior work.
- Plan the silhouette as a set of primitive shapes (rects, ellipses, polys) that will become the outline layers.

### 5. Major regions

- The interior regions of the silhouette, each a named shape. Plan 2–4 tone regions per material (dark/mid/light).

### 6. Palette planning

- 5–12 named keys (never raw hex in layers or pixels).
- Material families: near-black outline, per-material dark/mid/light triads, one accent.
- Every planned key must be painted — no dead palette entries.

### 7. Lighting direction

- Upper-left lighting: light on top/left edges, shadow on bottom/right. State which regions get light and which get shadow.

### 8. Asset-specific structure

- The subject's anatomy: what parts, what order they overlap, what materials each part uses.

### 9. Construction order

- The exact layer sequence the builder will emit: outline → back forms → mid forms → front forms → shading → highlights → detail overrides.

## Completion criteria

The plan is done when:

- all nine sections are filled
- the bbox fits the canvas with 1–2px margins
- the palette is 5–12 keys, all planned to be painted
- the construction order is a valid painter's sequence (back to front)

Then hand off to the pixel-art-builder.