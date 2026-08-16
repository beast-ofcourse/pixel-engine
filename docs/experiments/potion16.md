# Experiment Record — potion16

| Field | Value |
|---|---|
| Asset | 16×16 potion (glass bottle, cork, red liquid) |
| Model | orchestrator (direct) |
| Iterations | 2 |
| Total pixel modifications | 7 (glint + right-edge shadow overrides) |
| Final unexpected mutations | 0 |
| Palette size | 8 (outline, glassDark, glassMid, liquidMid, liquidLight, corkDark, corkMid, glint) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 8 layers: body outline ellipse (cx=8, cy=10.5, rx=6.5, ry=5.5), neck outline rect (x=6..9, y=3..5), neck glass, body glass, liquid, liquid highlight, cork (y=0..2), cork top. Glint streak (6 px) + right-edge shadow (3 px).
   - Diagnosis (COMPOSITION, HIGH): body outline painted through row 15 — the bottle bottom touched the canvas bottom edge with no margin.

2. **Layout fix** — body ellipses cy 10.5→10, ry 5.5→5.0 (bodyOutline) / 4.5→4.0 (bodyGlass); liquid cy 11→10; liquidLight cy 11.5→10.5. Glint re-placed onto the glass edge: (6,7),(6,8),(6,9),(7,10) (previous x=4..5 coords were outside the smaller glass).
   - Verify: bottom row now 13 (2px margin below), widest row x=2..13 (margins 2,2). Glint sits on the left glass edge; glassDark shadow on the right edge reads as secondary light shading.

3. **Cleanup** — removed unused `liquidDark` palette key (8 colors final).

## Final inspect() summary

- outline 41px bbox[2,3,12,12] (cork+neck+body silhouette)
- liquidLight 25px, glassMid 22px, liquidMid 15px (body + liquid)
- corkMid 8px, corkDark 4px (cork)
- glassDark 5px (neck interior + right-edge shadow), glint 4px
- Layers: 8, pixel overrides: 7
