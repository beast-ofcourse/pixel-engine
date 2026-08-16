# Test Record — Organic Creatures (builder skill intervention)

Phase 6 of the co-evolution loop. Generated with the **intervention** builder skill (`skills/pixel-art-builder/SKILL.md`: contour-first construction, primitive selection, layer-ordering rules, small-part guidance, connection guidance) and the **unchanged** engine. Same subject ladder as the baseline: lizard/creature at 16×16, 32×32, 64×64. The 64×64 baseline data point remains the hash-locked dragon (`scenes/creature64.json`).

## Assets

| Asset | Size | Layers | Pixel overrides | Palette | Iterations | Fixes needed | Final assessment |
|---|---|---|---|---|---|---|---|
| `scenes/test/creature16.json` | 16×16 | 9 | 1 | 6 keys | 2 | 1 (shade geometry) | clean: single contour, belly visible, tail interior visible |
| `scenes/test/creature32.json` | 32×32 | 9 | 1 | 6 keys | 1 | 0 | clean: single contour, belly visible, tail connected + interior visible |
| `scenes/test/creature64.json` | 64×64 | 9 | 1 | 6 keys | 1 | 1 (belly ordering) | clean: single contour, belly framed by shade, tapering tail |

## Construction (per the intervention skill)

All three assets follow the same procedure:

1. **One silhouette contour** — a single `poly` around the whole creature (head + body + tail in one polygon), no per-part outlines.
2. **Interior fills** — belly poly after the main form.
3. **Shade** — bottom-edge band, painted after interior fills.
4. **Legs** — rects painted AFTER shade (never covered).
5. **Light** — top-edge highlight band.
6. **Outline LAST** — one `polyout` with the same contour points.
7. **Eye** — single pixel override.

## Fixes during the test

### creature16 — 1 fix (iteration 2)

- **Shade covered the belly**: my first shade poly was a full-width band that painted over the belly. Fix: reuse the baseline-proven shade geometry (a band whose degenerate top rows leave the belly visible). This was a geometry choice, not a skill gap — the skill's ordering rule (shade after interior fills) was followed; the band shape was wrong.

### creature32 — 0 fixes

- Built correctly on the first render: single contour, belly visible (rows 18–21), shade below (rows 19–25), legs after shade (rows 22–27), light (rows 10–13), single outline last, tail connected with visible interior. The baseline's tail/body gap and outline-dominated tail tip did not occur.

### creature64 — 1 fix (iteration 2)

- **Belly covered by shade at 64×64**: at this scale the shade band is large enough to fully cover the belly. Fix: paint the belly **after** the shade so the shade frames it (light underside on top of the dark band). This is a genuine ordering refinement — added to the skill as rule 4 ("The light underside (belly) is painted after the shade so the shade frames it").

## Comparison vs baseline

| Metric | Baseline 16 | Test 16 | Baseline 32 | Test 32 | Baseline 64 (dragon) | Test 64 |
|---|---|---|---|---|---|---|
| Layers | 11 | **9** | 11 | **9** | 28 | **9** |
| Pixel overrides | 1 | 1 | 1 | 1 | 29 | **1** |
| Palette keys | 6 | 6 | 6 | 6 | 12 | **6** |
| Iterations | 3 | **2** | 2 | **1** | 2 | **1** |
| Failures/fixes | 4 | **1** | 2 | **0** | 1 | **1** |
| Unexpected mutations | 0 | 0 | 0 | 0 | 0 | 0 |
| Tail/body gap | — | none | **yes** | none | — | none |
| Tail tip readable | poor | **yes** | poor | **yes** | — | **yes** |
| Belly visible | yes | yes | yes | yes | — | yes (framed) |

## Test conclusion

The intervention skill eliminates the baseline failure classes:

1. **No per-part outline lines** — single contour procedure worked at all three scales (baseline failure #3 at 16×16).
2. **No legs hidden by shade** — legs-after-shade ordering held (baseline failure #2 at 16×16).
3. **No tail/body gap** — convex tail + single contour (baseline failure #1 at 32×32).
4. **Tail tip readable** — single outline last leaves the tip interior visible (baseline failure #4 at 16×16, #3 at 32×32).
5. **Fewer iterations** — 2/1/1 vs baseline 3/2/2; the 32×32 asset needed zero fixes.

One refinement was added to the skill during the test (belly after shade, rule 4) — an evidence-driven skill change, not an engine change.

The engine remains untouched. No engine deficiency was demonstrated at any scale.