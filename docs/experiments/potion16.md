# Experiment Record — potion16

| Field | Value |
|---|---|
| Asset | 16×16 potion (glass bottle, cork, red liquid) |
| Model | orchestrator (direct) |
| Iterations | 3 |
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

4. **Margin fix (review)** — CodeRabbit flagged the cork starting at y=0 (no top margin). Cork y 0→1, h 3→2; corkTop y 0→1; bodyOutline ry 5.0→4.5 so the bottle fits with margins on both axes.
   - Verify: artwork spans y=1..13 — margins 1 top / 2 bottom / 2 left / 2 right, all within the 1–2px rule. Bottle silhouette and shading read unchanged.

## Final inspect() summary

- outline 25px bbox[2,3,12,11] (cork+neck+body silhouette)
- liquidLight 25px bbox[4,8,8,5], glassMid 22px bbox[3,6,10,8], liquidMid 15px bbox[4,7,8,6] (body + liquid)
- corkMid 4px bbox[6,2,4,1], corkDark 4px bbox[6,1,4,1] (cork)
- glassDark 5px (neck interior + right-edge shadow), glint 4px
- Layers: 8, pixel overrides: 7
