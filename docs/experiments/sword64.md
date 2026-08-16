# Experiment Record — sword64

| Field | Value |
|---|---|
| Asset | 64×64 diagonal sword (lit blade, gold crossguard, wrapped grip, shaded pommel) |
| Model | orchestrator (direct) |
| Iterations | 4 |
| Total pixel modifications | 17 (guard light edge, grip wrap, pommel light/shadow) |
| Final unexpected mutations | 0 |
| Palette size | 12 (outline, bladeMid, bladeLight, bladeHighlight, guardDark, guardMid, guardLight, gripDark, gripMid, pommelDark, pommelMid, pommelLight) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — blade as 3 nested polys + highlight line; guard/grip/pommel as diagonal bands. Diagnosis (STRUCTURE, HIGH): blade layers were shifted *along* the blade direction instead of inset *perpendicular* — bladeLight (painted last) covered the whole blade; outline only peeked at the tip. Guard too long (27px vs 33px blade); grip sat beside the guard instead of behind it.

2. **Blade fix** — proper parallelogram blade, direction (-1,1), 6px perpendicular width: outline [[50,9],[56,15],[28,43],[22,37]], mid inset 1px, light inset 2px, highlight line on the light's top edge. Render: blade cross-section O O B B A L L L L B B O O — bright top edge, light body, dark bottom. Guard shortened to 16px, grip re-tucked. Diagnosis (STRUCTURE, HIGH): grip outline/mid polys were degenerate — all four corners on the same x+y=65 line (width offset along (1,-1) is *parallel* to the band direction, not perpendicular) — grip had no outline.

3. **Grip geometry fix** — width offset along (1,1) (the true perpendicular to (-1,1)): gripOutline [[31,42],[27,38],[17,48],[21,52]], gripMid [[30,41],[28,39],[18,47],[20,49]]; grip top tucked behind the guard (painted before guard); pommel moved to cx=19,cy=50; pommelDark shadow pixels added (was unused). Diagnosis: none blocking.

4. **Verify** — zoom on guard/grip junction: grip outline band (O) with mid (P) and wrap line (I) emerges from behind the guard; pommel (outline + mid + light + dark) covers the grip end. All 12 palette keys painted.

## Final inspect() summary

- guardMid 171px bbox[19,27,20,22] (crossguard)
- outline 133px bbox[16,9,41,44] (blade + grip + pommel rings)
- bladeMid 88px, bladeLight 88px, bladeHighlight 22px (lit blade)
- guardDark 40px, guardLight 6px (guard shading)
- gripMid 18px, gripDark 6px (wrapped grip)
- pommelMid 14px, pommelDark 3px, pommelLight 2px (shaded pommel)
- Layers: 10, pixel overrides: 17