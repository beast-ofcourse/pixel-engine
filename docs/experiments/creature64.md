# Experiment Record — creature64

| Field | Value |
|---|---|
| Asset | 64×64 dragon (horns, swept wing, belly, spade tail, claws) |
| Model | orchestrator (direct) |
| Iterations | 2 |
| Total pixel modifications | 29 (horns, eye+pupil, nostril, mouth, teeth, wing shadow, claws) |
| Final unexpected mutations | 0 |
| Palette size | 12 (outline, scaleDark, scaleMid, scaleLight, bellyDark, bellyLight, wingDark, wingMid, hornDark, hornLight, eye, claw) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 28 layers: tail (x=40..49 y=38..41) + diamond spade tip (poly [[49,35],[51,35],[54,38],[50,42],[46,38]]), legs (x=22..26, x=36..40, y=42..51), feet + 3 claws each, swept wing (outline poly [[28,29],[47,10],[49,10],[51,14],[51,24],[40,29]] + membrane poly), body (x=20..41 y=28..41) + belly, neck, head (poly with slanted snout [[8,16],[10,12],[18,12],[20,16],[20,22],[8,22]]), 29 pixel overrides (2 horns × 5px, eye+pupil, nostril, mouth, teeth, 5 wing-shadow pixels, 6 claws).
   - Diagnosis (PIXEL, LOW): mouth line at y=20 sat on the head's outline row — invisible (outline on outline).

2. **Cleanup** — mouth moved up to y=19 (on the headMid), teeth moved to y=18. Verify: mouth visible as dark line, teeth above it; all 12 palette keys painted; wing shadow strip bbox[41,23,10,5] matches the 5 placed pixels.

## Final inspect() summary

- scaleMid 275px bbox[9,13,45,38] (body/head/neck/tail/legs)
- outline 194px bbox[8,10,47,44] (silhouette)
- wingMid 175px bbox[31,11,20,17] (wing membrane)
- bellyDark 108px bbox[22,35,18,6] (belly)
- scaleLight 90px bbox[11,13,35,38] (lit tops/left edges)
- scaleDark 24px bbox[22,51,19,3] (feet)
- bellyLight 18px bbox[22,34,18,1] (belly top)
- hornLight 8px, claw 6px, wingDark 5px, hornDark 4px, eye 1px
- Layers: 28, pixel overrides: 29