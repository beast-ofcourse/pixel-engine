# Experiment Record — sword16

| Field | Value |
|---|---|
| Asset | 16×16 sword (vertical: blade, guard, grip, pommel) |
| Model | orchestrator (direct) |
| Iterations | 1 |
| Total pixel modifications | 5 (blade highlight + guard highlight overrides) |
| Final unexpected mutations | 0 |
| Palette size | 11 (outline, bladeMid, bladeLight, bladeHighlight, guardDark, guardMid, guardLight, gripDark, gripMid, pommelDark, pommelMid) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 9 layers:
   - blade: outline poly [(8,1),(9,9),(7,9)] (tapered silhouette, tip at y=1), bladeLight rect x=7 (lit left edge), bladeMid rect x=8 (shadowed right edge)
   - guard: rectout x=4..12, y=9..10 (guardDark ring) + guardMid interior
   - grip: gripMid rect x=7..8, y=11..13 with gripDark top row (shadow under guard)
   - pommel: pommelMid rect x=7..8, y=13..14 with pommelDark top row
   - pixels: bladeHighlight (7,2),(7,3),(7,4) — brightest near tip on lit edge; guardLight (5,9),(6,9) — lit top edge of guard
   - Diagnosis: none blocking. Layout verified: y=1..14 (margins 1,1), x=4..12 (margins 3,3), centered. Blade base (y=9) hidden behind guard — blade emerges from guard. All 11 palette keys painted.

## Final inspect() summary

- guardMid 12px bbox[5,9,7,2], guardDark 4px, guardLight 2px (guard bar)
- bladeMid 7px bbox[8,2,1,7], bladeLight 4px bbox[7,5,1,4], bladeHighlight 3px bbox[7,2,1,3] (blade)
- gripDark 2px, gripMid 2px, pommelDark 2px, pommelMid 2px (grip + pommel)
- outline 1px bbox[8,1,1,1] (blade tip)
- Layers: 9, pixel overrides: 5