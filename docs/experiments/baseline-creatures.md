# Baseline Record — Organic Creatures (current system)

Phase 2 of the co-evolution loop. Generated with the **current** engine + skills (no modifications). Subject: lizard/creature at 16×16, 32×32, 64×64. The 64×64 data point is the existing hash-locked dragon (`scenes/creature64.json`, record in `creature64.md`).

## Assets

| Asset | Size | Layers | Pixel overrides | Palette | Iterations | Final assessment |
|---|---|---|---|---|---|---|
| `scenes/baseline/creature16.json` | 16×16 | 11 | 1 | 6 keys | 3 | acceptable, tail tip outline-dominated |
| `scenes/baseline/creature32.json` | 32×32 | 11 | 1 | 6 keys | 2 | acceptable, tail taper outline-dominated |
| `scenes/creature64.json` (dragon) | 64×64 | 28 | 29 | 12 keys | 2 | production candidate |

## Failure taxonomy (plan §6)

### creature16 — primary: SILHOUETTE; secondary: COMPOSITION, SKILL_LIMITATION

1. **Iteration 1 — dead palette key**: `outline` declared but never painted (FACT FAIL). The builder skill's silhouette step says "outline shapes first" but the first construction omitted outlines entirely.
2. **Iteration 1 — legs hidden**: back legs painted before the shade layer → completely overwritten, invisible. Layer-ordering trap: shade must not cover legs; legs must be painted after shade.
3. **Iteration 2 — interior outline lines**: per-part `polyout` layers (body/head/tail each outlined) painted after fills → the body's outline cuts across the head interior. Fix: **one single silhouette contour** around the whole creature (matches the dragon's approach).
4. **Iteration 3 — tail swallowed by outline**: the 4px tail's interior is mostly covered by its own outline; reads as a dark blob. Small parts need either thicker interiors or no outline on the tip.

### creature32 — primary: GEOMETRY; secondary: CURVE_QUALITY, SKILL_LIMITATION

1. **Iteration 1 — tail/body gap**: transparent pixel at the tail junction. The concave thin tail polygon produces a degenerate scanline (odd edge crossings) and the body's bottom-right corner doesn't reach the tail. Fix: convex tail trapezoid + body corner extended to (24,24).
2. **Iteration 1 — outline bands**: shallow diagonal contour edges paint 2px outline bands (rows 24–25), thickening the silhouette unevenly.
3. **Tail taper**: the tip interior disappears into the outline — same small-part issue as creature16.

### creature64 (dragon, existing record)

1. Mouth line painted on the head's outline row — invisible (outline on outline).
2. Cleanup verified all 12 palette keys painted.

## Objective metrics

| Metric | creature16 | creature32 | creature64 |
|---|---|---|---|
| changed_pixels (final iteration) | 0 unexpected | 0 unexpected | 0 unexpected |
| palette_size | 6 | 6 | 12 |
| canvas_size | 16 | 32 | 64 |
| operation_count (layers + overrides) | 12 | 12 | 57 |
| poly usage | 8 layers | 8 layers | 6 layers |

## Baseline conclusion

The engine's existing primitives (`poly`, `polyout`, `line`) are **sufficient** for organic construction — all three creatures used polys successfully. Every failure encountered was a **procedure/skill deficiency**, not an engine deficiency:

1. No contour-first procedure (single silhouette contour, not per-part outlines)
2. No primitive-selection doctrine (when poly vs rect vs ellipse)
3. No layer-ordering rules (outline last, legs after shade)
4. No small-part guidance (outline thickness vs part size, tail taper)
5. No connection guidance (part junctions, concave-poly degeneracy)

No engine change is indicated by the baseline. The intervention target is the **builder skill** (and possibly a shape-construction skill per plan §12).