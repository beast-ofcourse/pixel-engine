# Experiment Record — axe64

| Field | Value |
|---|---|
| Asset | 64×64 battle axe (curved steel blade, dark poll, wood eye, haft with metal cap) |
| Model | orchestrator (direct) |
| Iterations | 2 |
| Total pixel modifications | 9 (blade edge highlight, cap shadow) |
| Final unexpected mutations | 0 |
| Palette size | 11 (outline, steelDark, steelMid, steelLight, steelHighlight, woodDark, woodMid, woodLight, metalDark, metalMid, metalLight) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 11 layers: haft (outline rect x=33..36 y=27..54 + woodMid + woodLight lit left edge), metal cap (outline x=32..37 y=53..55 + metalMid + metalLight), head (outline poly with curved cutting edge [[17,9],[51,9],[51,25],[17,27],[13,23],[12,19],[13,15],[15,11]] + steelMid inset + steelLight top strip + steelDark poll rect x=43..49 + woodDark eye rect x=33..36 y=11..24), 5 steelHighlight pixels along the cutting edge curve.
   - Diagnosis (PALETTE, LOW): `metalDark` never painted — dead color.

2. **Cleanup** — 4 metalDark pixels on the cap's bottom row (33,55),(34,55),(35,55),(36,55) — cap shadow. Verify: all 11 palette keys painted; head y=9..26, haft y=27..54, cap y=53..55; x=12..51 centered.

## Final inspect() summary

- steelMid 347px bbox[14,11,37,15] (head body)
- outline 157px bbox[12,9,40,47] (silhouette)
- steelDark 98px bbox[43,12,7,14] (poll)
- steelLight 62px bbox[18,10,33,2] (head top)
- woodDark 56px bbox[33,11,4,14] (eye)
- woodLight 26px, woodMid 26px (haft)
- metalMid 9px, metalDark 4px, metalLight 3px (cap)
- steelHighlight 5px (cutting edge)
- Layers: 11, pixel overrides: 9