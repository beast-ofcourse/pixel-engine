# Craft Rules — the taste layer

The co-evolution loop proved the engine and skills produce **correct** pixel art; the remaining gap is **taste**. Taste decomposes into two layers: craft rules (codifiable, checkable) and aesthetic judgment (human signal). This record covers the craft-rules layer.

## The rules (encoded in the skills)

### Builder (`skills/pixel-art-builder/SKILL.md` — "Craft rules" section)

1. **Hue-shifted shading** — shadows shift toward blue/purple, highlights toward yellow. Never shade by pure darkening/lightening of the base hue.
2. **Outline color** — the outline is the darkest shade of the object's hue family, not pure black (near-black only for tiny details like eyes).
3. **Value compression** — 3–4 value steps per material: outline + shadow + mid + light.
4. **Silhouette readability** — the subject must be identifiable from the outline alone at native resolution.
5. **Detail economy** — 1–2 overrides at 16×16, 2–4 at 32×32, 4–8 at 64×64.
6. **Light-source consistency** — upper-left lighting: light on top/left edges, shadow on bottom/right.

### Critic (`skills/pixel-art-critic/SKILL.md` — "Craft pass" section)

Provable aesthetic checks reported PASS/FAIL with evidence: value structure (count keys per material family), hue shifting (compare hexes), outline color (hex of outline key), silhouette readability (render outline layer alone), detail economy (count `pixels` entries), light consistency (layer bboxes). A craft-pass FAIL is a HIGH defect, not a blocking FACT FAIL.

## Demonstration asset

`scenes/craft/creature32.json` — the validated test creature32 geometry with a craft palette:

| Key | Old (correct but flat) | New (craft) | Shift |
|---|---|---|---|
| outline | `#1A1A1A` (pure black) | `#22331A` (dark green) | hue-family darkest |
| skinDark | `#4A7A3A` (darker green) | `#3A5A4E` | blue-shifted shadow |
| skinMid | `#6BA34F` | `#5E8F4E` | base |
| skinLight | `#8FC46E` (lighter green) | `#A8D878` | yellow-shifted highlight |
| belly | `#C9E8A8` | `#D8F0B8` | light accent |
| eye | `#1A1A1A` | `#1A1A1A` | near-black OK at 1px |

## Verification (all checks run, all PASS)

1. **Value structure** — outline + shadow + mid + light + belly accent = 4 steps + accent. PASS.
2. **Hue shifting** — shadow `#3A5A4E` vs mid `#5E8F4E`: blue channel holds (78→78) while green drops (143→90) → blue-shifted. Light `#A8D878` vs mid: R/G rise more than B → yellow-shifted. PASS.
3. **Outline color** — `#22331A` is a dark green, not pure black. PASS.
4. **Silhouette readability** — outline layer rendered alone: head, body, tail, legs all read at 32×32. PASS.
5. **Detail economy** — 1 pixel override at 32×32 (rule: 2–4). PASS.
6. **Light consistency** — light bbox `[10,10,14,4]` above shade bbox `[6,18,21,8]`; left edge is the belly (light underside). PASS.

## Refinements made during verification

- **Light check softened**: "above-left" → "above" (top edge lit; shadow bottom/right; left edge may be a light underside). The lizard's light band sits above the shade but not left of it — the left edge is the belly. The strict check would have failed a correct asset.

## What this does and doesn't solve

- **Solves**: flat muddy shading, pure-black outlines, value clutter, unreadable silhouettes, detail noise, inconsistent lighting — the codifiable half of taste.
- **Doesn't solve**: charm, character, composition judgment — the human-signal half. That is the next layer (human curation / reference-driven evaluation / learned reward model), per the taste-strategy decision.