# Experiment Record — chest32

| Field | Value |
|---|---|
| Asset | 32×32 chest (arched wooden lid, banded body, gold lock plate, feet) |
| Model | orchestrator (direct) |
| Iterations | 2 |
| Total pixel modifications | 14 (keyhole, lock/band highlights, wood grain, lid glint overrides) |
| Final unexpected mutations | 0 |
| Palette size | 10 (outline, woodDark, woodMid, woodLight, woodHighlight, metalMid, metalLight, goldDark, goldMid, goldLight) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 12 layers: body outline rect (x=6..25, y=10..24) + woodMid interior + woodLight top strip; metalMid side bands (x=9..10, x=21..22); arched lid poly [[6,10],[8,5],[13,4],[19,4],[24,5],[25,10]] + woodMid inset + woodLight top strip; gold lock plate (rectout x=14..17, y=14..19 + goldMid interior); woodDark feet (x=8..11, x=20..23, y=25..26). Pixels: keyhole (15,16),(16,16),(16,17); goldLight lock top (15,14),(16,14); metalLight band tops (9,10),(9,11),(21,10),(21,11); woodHighlight lid glint (9,5); woodDark grain (12,16),(13,16),(18,20),(19,20).
   - Diagnosis (PALETTE, LOW): `metalDark` palette key never painted — dead color.

2. **Cleanup** — removed `metalDark` (10 colors final). Verify: all 10 palette keys painted; chest spans y=4..26 (margins 4/5), x=6..25 (margins 6/6), centered.

## Final inspect() summary

- woodMid 186px bbox[7,6,18,18] (lid + body wood)
- outline 82px bbox[6,4,20,21] (silhouette)
- metalMid 56px bbox[9,10,14,15] (side bands)
- woodLight 40px, woodDark 20px (strips + grain + feet)
- goldDark 12px, goldMid 7px, goldLight 2px (lock plate)
- metalLight 4px, woodHighlight 1px (highlights)
- Layers: 12, pixel overrides: 14