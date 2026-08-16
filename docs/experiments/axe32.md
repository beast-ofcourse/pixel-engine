# Experiment Record — axe32

| Field | Value |
|---|---|
| Asset | 32×32 axe (curved cutting edge, steel head, brass wedge, wooden haft) |
| Model | orchestrator (direct) |
| Iterations | 1 |
| Total pixel modifications | 7 (cutting-edge highlight + back-edge light overrides) |
| Final unexpected mutations | 0 |
| Palette size | 10 (outline, steelDark, steelMid, steelLight, steelHighlight, woodDark, woodMid, woodLight, metalDark, metalMid) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 9 layers:
   - haft: outline rect x=14..17 y=8..28, woodMid interior, woodLight lit left edge, woodDark cap y=27..28
   - head: outline poly [[5,13],[7,6],[13,4],[24,4],[24,16],[15,16],[5,13]] (curved cutting edge left, flat poll right), steelMid inset poly, steelLight inner poly
   - wedge: rectout x=14..17 y=15..17 (metalDark ring) + metalMid interior
   - pixels: steelHighlight diagonal along cutting edge (6,12),(7,10),(8,8),(9,6); steelLight on back edge (23,5),(23,6),(23,7)
   - Diagnosis: none blocking. Layout verified: head y=4..16, wedge y=15..17, haft y=18..26, cap y=27..28; margins 4 top / 3 bottom, x=5..24 (margins 5/8). Head covers haft top; wedge covers head bottom + haft top junction.

## Final inspect() summary

- steelLight 105px bbox[7,5,17,9] (head face)
- outline 69px bbox[5,4,20,23] (head + haft silhouette)
- steelMid 41px bbox[7,5,17,10] (head midtone)
- woodLight 9px, woodMid 9px, woodDark 8px (haft)
- metalDark 6px, metalMid 6px (wedge)
- steelHighlight 4px (cutting edge)
- Layers: 9, pixel overrides: 7