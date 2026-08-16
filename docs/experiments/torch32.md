# Experiment Record — torch32

| Field | Value |
|---|---|
| Asset | 32×32 torch (teardrop flame, wrapped head, wooden handle) |
| Model | orchestrator (direct) |
| Iterations | 1 |
| Total pixel modifications | 6 (flame tip + core overrides) |
| Final unexpected mutations | 0 |
| Palette size | 11 (outline, woodDark, woodMid, woodLight, wrapDark, wrapMid, wrapLight, flameOuter, flameMid, flameInner, flameCore) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 11 layers:
   - flame: 3 concentric ellipses (flameOuter cx=16 cy=10 rx=4.5 ry=5.5 → flameMid rx=3 ry=4 → flameInner cx=16 cy=10.5 rx=2 ry=2.5) + tip pixel (16,4) + 5-px flameCore (15,10),(16,9),(16,10),(16,11),(17,10)
   - head: outline rect x=12..19 y=15..20, wrapMid interior, wrapDark top 2 rows (shadow under flame), wrapLight left edge
   - handle: outline rect x=14..17 y=21..29, woodMid interior, woodLight lit left edge, woodDark cap y=28..29
   - Diagnosis: none blocking. Layout verified: flame y=4..14, head y=15..20, handle y=21..29; x=12..20 (margins 12/11), centered. Flame base (y=14) narrower than head top (y=15) — flame sits on the head.

## Final inspect() summary

- flameOuter 37px bbox[12,4,8,11] (flame silhouette)
- outline 26px bbox[12,15,8,13] (head + handle)
- flameMid 20px, flameInner 11px, flameCore 5px (flame layers)
- wrapMid 20px, wrapDark 10px, wrapLight 6px (head)
- woodMid 7px, woodLight 7px, woodDark 8px (handle)
- Layers: 11, pixel overrides: 6