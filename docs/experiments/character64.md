# Experiment Record — character64

| Field | Value |
|---|---|
| Asset | 64×64 knight (plumed helm, armored torso, belt, sword at side) |
| Model | orchestrator (direct) |
| Iterations | 2 |
| Total pixel modifications | 16 (plume, eyes, mouth, chest emblem) |
| Final unexpected mutations | 0 |
| Palette size | 12 (outline, skin, helmDark, helmMid, helmLight, armorDark, armorMid, armorLight, clothDark, clothMid, clothLight, plume) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 38 layers: legs (x=25..29, x=32..36, y=42..56), boots (x=24..30, x=31..37, y=56..59), torso (x=21..40, y=24..41), belt + buckle, arms (x=17..20, x=41..44, y=25..38), shoulders (x=16..21, x=40..45, y=23..26), neck, head (helm x=26..35 y=11..15 + face x=27..34 y=15..19), sword (blade x=46..47 y=29..42, guard x=45..48 y=27..28, pommel x=46..47 y=42..43), 16 pixel overrides (7-plume diagonal crest, 2 eyes, 2-pixel mouth, 5-pixel chest diamond).
   - Diagnosis (PALETTE, LOW): `clothMid` and `clothLight` never painted — belt was single-tone clothDark.

2. **Cleanup** — belt split into three tones: clothLight top row (y=37), clothMid body (y=38), clothDark bottom row (y=39). Verify: all 12 palette keys painted; sword area zoomed (arm outline x=44 adjacent to guard x=45..48, blade x=46..47, pommel x=46..47) — correct.

## Final inspect() summary

- armorMid 315px bbox[17,24,28,32] (torso/arms/legs)
- outline 188px bbox[16,16,30,44] (silhouette)
- armorLight 122px bbox[17,23,28,37] (lit left edges)
- helmLight 53px bbox[26,11,22,31] (helm top, buckle, blade, emblem)
- helmMid 42px bbox[26,12,23,32] (helm, sword guard/pommel)
- clothDark/Mid/Light 14px each bbox[22,37,18,3] (belt)
- skin 36px bbox[27,16,8,7] (face, neck)
- armorDark 32px bbox[26,56,11,4] (boots)
- helmDark 10px bbox[26,14,10,1] (helm rim shadow)
- plume 7px bbox[32,4,4,4] (crest)
- Layers: 38, pixel overrides: 16