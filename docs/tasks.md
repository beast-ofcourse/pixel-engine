# pixel-engine — Extreme Pixel-Art Accuracy Development Loop

## Mission

You are continuing development of **`pixel-engine`**.

The engine already supports:

- static pixel-art generation
- resolutions from approximately **8×8 through 256×256**
- 16×16 multi-frame animation
- pixel-level manipulation
- AI-agent-controlled construction
- rendering/export

The core engine is functional.

**Do not spend this phase building a human editor or integrating an AI chat UI into an editor.**

The current objective is much narrower:

> **Make a non-vision coding LLM capable of producing extremely high-quality, structurally coherent, deliberate pixel art.**

The target assets include:

- characters
- swords
- axes
- bows
- tools
- potions
- items
- creatures
- environmental assets
- game sprites
- animated sprites

The project should progress from:

```text
"recognizable pixel art"
```

to:

```text
"high-quality pixel art"
```

to:

```text
"production-quality game asset"
```

to:

```text
"extremely accurate, deliberately constructed pixel art"
```

---

# 1. Core Principle

Do NOT optimize for one-shot generation.

The system should operate as an iterative construction loop:

```text
PLAN
  ↓
CONSTRUCT
  ↓
RENDER
  ↓
INSPECT
  ↓
DIAGNOSE
  ↓
SELECT PROBLEM
  ↓
SURGICALLY MODIFY
  ↓
RENDER
  ↓
COMPARE
  ↓
VERIFY
  ↓
REPEAT
```

The most important rule:

> **Never make a broad regeneration when a localized correction is sufficient.**

If the sword's guard is wrong, modify the guard.

Do not regenerate the sword.

If the character's left leg is wrong, modify the leg.

Do not regenerate the character.

If the highlight is wrong, modify the highlight.

Do not rebuild the entire sprite.

---

# 2. The Agent Must Think Hierarchically

The agent should not begin with random individual pixels.

Construction should happen approximately in this order:

```text
1. Canvas
2. Composition
3. Bounding box
4. Silhouette
5. Major shapes
6. Secondary shapes
7. Internal structure
8. Outline
9. Palette
10. Shadows
11. Midtones
12. Highlights
13. Texture/details
14. Cleanup
15. Final verification
```

The exact sequence may differ by asset.

The important principle is:

> **Large structural decisions first. Pixel-level decisions last.**

---

# 3. Asset-Specific Planning

Before generating an asset, the agent should create a compact internal plan.

For example, for a sword:

```text
Asset:
  sword

Canvas:
  64×64

Bounding box:
  x=18..45
  y=8..56

Orientation:
  diagonal, bottom-left → top-right

Primary silhouette:
  blade
  guard
  grip
  pommel

Light source:
  upper-left

Palette:
  dark outline
  blade shadow
  blade midtone
  blade highlight
  grip dark
  grip midtone
  accent
```

For a character:

```text
Asset:
  humanoid character

Canvas:
  64×64

Bounding box:
  x=14..49
  y=5..59

Major regions:
  head
  torso
  left arm
  right arm
  left leg
  right leg

Pose:
  three-quarter stance

Light:
  upper-left
```

Do not require verbose plans.

The plan exists to preserve structural consistency.

---

# 4. Pixel-Art Rules

The agent should follow deliberate pixel-art principles.

## Silhouette

The silhouette must remain readable without internal details.

Test:

> If all internal colors/details were removed, would the asset still be identifiable?

If no, fix the silhouette before adding detail.

---

## Pixel Clusters

Prefer deliberate clusters.

Avoid unnecessary isolated pixels.

Bad:

```text
█ . █ . █
. █ . █ .
```

when the pixels do not communicate structure.

Good pixel art should have purposeful clusters representing:

- planes
- shadows
- highlights
- material
- edges
- texture

---

## Diagonals

Pay attention to pixel stair-stepping.

Avoid inconsistent accidental slopes.

The agent should prefer intentional pixel patterns for diagonals.

For example, rather than random staircase changes:

```text
##
 ##
  ##
   ##
```

reason about the slope and maintain a consistent rhythm.

---

## Outlines

Outlines should be intentional.

Avoid:

- inconsistent thickness
- random gaps
- accidental double outlines
- excessive black borders
- outlines that conflict with lighting

Not every edge necessarily needs the same outline treatment.

---

## Palette

Keep palettes controlled.

Avoid introducing a new color for every tiny shading change.

The agent should think in terms of:

```text
outline
shadow
dark-mid
mid
light
highlight
accent
```

rather than arbitrary RGB noise.

---

## Lighting

Choose a light direction.

For example:

```text
Light source:
upper-left
```

Then maintain that direction throughout the asset.

Highlights and shadows must not contradict one another.

---

## Negative Space

Treat empty pixels as intentional design elements.

The agent should consider:

- holes
- gaps
- separation between limbs
- space between weapon components
- background around silhouette

---

# 5. Construction Loop

For every asset, follow this process.

## Phase A — Plan

Determine:

- resolution
- object bounds
- orientation
- silhouette
- major regions
- palette
- lighting
- intended style

Do not start detailing.

---

## Phase B — Silhouette

Construct only the major silhouette.

Render.

Evaluate:

```text
recognizable?
proportional?
balanced?
correct orientation?
```

If the silhouette is wrong:

**STOP.**

Fix it before continuing.

---

## Phase C — Major Forms

Add major internal structures.

For a sword:

```text
blade
guard
grip
pommel
```

For a character:

```text
head
torso
arms
legs
clothing
```

Render again.

---

## Phase D — Palette

Establish a controlled palette.

Verify:

- no accidental colors
- consistent material colors
- coherent light direction
- sufficient contrast
- readable value hierarchy

---

## Phase E — Shading

Add:

```text
shadow
midtone
light
highlight
```

according to the object's geometry and material.

Do not add random highlights just to make the sprite "look detailed."

---

## Phase F — Pixel Refinement

Now inspect individual clusters.

Look for:

- stray pixels
- broken diagonals
- awkward corners
- inconsistent outline thickness
- accidental gaps
- noisy texture
- unnecessary colors
- broken symmetry
- malformed curves

Fix these surgically.

---

## Phase G — Final Cleanup

Perform a dedicated cleanup pass.

Do NOT introduce new design ideas during cleanup unless a real defect is discovered.

Cleanup should primarily remove errors.

---

# 6. Render → Inspect → Diagnose Loop

After each meaningful construction stage:

```text
RENDER
  ↓
INSPECT
  ↓
DIAGNOSE
```

The diagnosis should classify defects.

Use categories such as:

```text
STRUCTURE
SILHOUETTE
PROPORTION
GEOMETRY
PALETTE
LIGHTING
SHADING
OUTLINE
PIXEL CLUSTERING
DETAIL
COMPOSITION
CONSISTENCY
```

Example:

```text
Problem:
The sword blade is too thick near the guard.

Category:
GEOMETRY

Severity:
HIGH

Region:
x=25..34
y=30..42

Correction:
Remove 2 pixels from each side.
```

Do not vaguely say:

> "The sword could look better."

Identify a concrete defect.

---

# 7. Surgical Modification

Every correction should define:

```text
WHAT
WHERE
WHY
EXPECTED EFFECT
```

Example:

```text
WHAT:
Remove 3 highlight pixels.

WHERE:
blade highlight region.

WHY:
Highlight is too wide and destroys the blade's curvature.

EXPECTED EFFECT:
Sharper blade shape while preserving the existing silhouette.
```

Then modify only that region.

---

# 8. Regression Protection

This is critical.

After every correction:

```text
BEFORE
  ↓
MODIFY
  ↓
AFTER
  ↓
COMPARE
```

Measure:

```text
changed pixels
changed regions
unexpected changes
palette changes
```

If the correction accidentally modifies unrelated regions:

```text
ROLL BACK
```

and attempt a more localized operation.

Never allow "fixes" to silently destroy previously correct work.

---

# 9. Pixel Diff

Use the engine's exact pixel-level diff capabilities.

For example:

```text
Before:
4096 pixels

After:
4096 pixels

Changed:
23 pixels

Unexpected:
0 pixels
```

For a localized correction:

```text
Requested region:
x=30..40
y=20..35

Actual changed region:
x=30..40
y=20..35

Status:
PASS
```

If the agent changes pixels outside the intended region:

```text
Status:
FAIL

Unexpected changes:
17 pixels
```

The agent should undo/revert and retry.

---

# 10. Accuracy Is Not Just Pixel Matching

Do not define quality solely as:

```text
number of pixels changed
```

A high-quality sprite can intentionally contain thousands of different pixels.

Evaluate multiple dimensions.

## Structural accuracy

- correct proportions
- correct silhouette
- correct placement
- correct geometry

## Pixel-art quality

- intentional clusters
- clean diagonals
- controlled outlines
- limited palette
- coherent shading

## Visual readability

- recognizable at native resolution
- readable silhouette
- good contrast
- clear object identity

## Consistency

- consistent lighting
- consistent palette
- consistent style
- consistent proportions

## Technical correctness

- correct dimensions
- correct transparency
- valid palette
- deterministic rendering
- no accidental pixels

---

# 11. Multi-Scale Inspection

Evaluate the sprite at multiple scales.

### Native resolution

This is the most important.

Ask:

> Does it actually read as pixel art at its intended resolution?

### Enlarged nearest-neighbor view

Use 4×, 8×, or similar integer scaling.

This exposes:

- broken clusters
- stray pixels
- bad diagonals
- inconsistent outlines

### Silhouette-only view

Hide internal colors.

This tests structural quality.

### Palette/value view

Inspect whether the color hierarchy makes sense.

Do not allow smoothing or anti-aliasing during these inspections.

---

# 12. Asset Difficulty Progression

Do not immediately jump to complex characters.

Build a benchmark ladder.

## Level 1 — Basic objects

```text
coin
gem
heart
potion
key
```

## Level 2 — Weapons/tools

```text
sword
axe
bow
spear
hammer
pickaxe
```

## Level 3 — Environment

```text
tree
rock
chest
torch
house
sign
```

## Level 4 — Organic objects

```text
fire
smoke
flower
plant
```

## Level 5 — Creatures

```text
slime
bird
small animal
monster
```

## Level 6 — Characters

```text
humanoid
character with equipment
character with pose
```

## Level 7 — Complex scenes

```text
character + weapon + environment
```

Increase complexity only when the previous level is reliable.

---

# 13. Resolution Strategy

Current engine support is approximately:

```text
8×8 → 256×256
```

Do not assume higher resolution automatically means better quality.

Test different resolutions deliberately.

For each asset type, determine what resolution is appropriate.

Examples:

```text
coin:
16×16

potion:
16×16 / 32×32

sword:
32×32 / 64×64

character:
32×32 / 64×64 / 128×128

large asset:
128×128 / 256×256
```

The agent should adapt its construction strategy to resolution.

At 16×16:

> Every pixel is extremely important.

At 256×256:

> The agent must manage larger regions and more hierarchy.

---

# 14. Style Consistency

Eventually create a style specification.

For example:

```text
Pixel-art style:
- limited palette
- hard edges
- no anti-aliasing
- strong silhouettes
- dark selective outlines
- upper-left lighting
- clustered shading
- minimal dithering
```

Every asset generated under that style should obey the same rules.

This is especially important if the goal is to create **game asset sets** rather than isolated images.

A sword, axe, character, potion, and chest should look like they belong to the same game.

---

# 15. Asset Set Benchmark

Do not only test individual assets.

Eventually generate a small coherent set:

```text
Sword
Axe
Pickaxe
Bow
Potion
Coin
Chest
Torch
Character
```

Then evaluate:

```text
palette compatibility
outline compatibility
lighting compatibility
pixel density
visual style
relative scale
```

The goal is:

> **The assets should look like they came from the same artist/style system.**

---

# 16. Animation Quality

Apply the same philosophy to the existing 16×16 animation system.

For each frame:

```text
render
inspect
diff
verify
```

Focus on:

- silhouette stability
- palette stability
- intentional motion
- minimal unintended pixel changes
- consistent proportions
- readable movement

Do not independently regenerate every frame.

Prefer:

```text
keyframe
→ localized change
→ frame
→ localized change
→ frame
```

---

# 17. AI Skill Design

The eventual agent skill should teach the model:

```text
Plan before drawing.

Build from large structure to small detail.

Preserve correct pixels.

Make localized changes.

Use exact engine operations.

Render frequently.

Measure differences.

Diagnose concrete defects.

Fix the highest-impact defect first.

Verify that corrections did not damage unrelated regions.

Repeat until the stopping criteria are satisfied.
```

The skill should NOT simply contain a huge list of aesthetic instructions.

It should teach an **engineering workflow for visual construction**.

---

# 18. Priority-Based Corrections

Do not fix random problems.

Prioritize:

```text
1. Incorrect silhouette
2. Incorrect proportions
3. Incorrect geometry
4. Major palette/value problems
5. Lighting inconsistencies
6. Broken outlines
7. Broken pixel clusters
8. Secondary details
9. Texture
10. Tiny cosmetic improvements
```

Never spend 20 iterations fixing highlights while the silhouette is wrong.

---

# 19. Stopping Criteria

Do not let the agent loop forever.

An iteration can stop when:

```text
No high-severity structural defects remain.
No major palette/lighting inconsistencies remain.
No obvious pixel-art violations remain.
No unexpected mutations remain.
Further modifications produce diminishing returns.
```

The agent should report:

```text
Iterations: 7

Remaining issues:
2 minor cosmetic issues

Structural status:
PASS

Palette status:
PASS

Unexpected mutations:
0

Final status:
ACCEPTABLE
```

The exact thresholds should be configurable.

---

# 20. Avoid Hallucinated Quality

Do not allow the model to declare:

> "This looks perfect."

without evidence.

The engine should provide objective information wherever possible.

Separate:

```text
ENGINE FACTS
```

from:

```text
MODEL JUDGMENT
```

For example:

```text
Engine:
Changed pixels = 14
Unexpected changes = 0

Model:
The blade silhouette appears too wide.
```

The model's aesthetic judgment should never be represented as a factual measurement.

---

# 21. Experimental Evaluation

For every benchmark asset, keep a record similar to:

```text
Asset:
64×64 sword

Model:
<model>

Iterations:
6

Total pixel modifications:
184

Final unexpected mutations:
0

Palette:
12 colors

Structural issues:
0

Pixel-art issues:
2 minor

Final assessment:
production candidate
```

This allows different:

- models
- prompts
- skills
- engine versions
- representations

to be compared objectively.

---

# 22. Do Not Blindly Optimize the Engine

The goal is not:

> Add more and more pixel APIs.

The goal is:

> **Determine which engine capabilities actually improve the model's visual construction ability.**

If a tool makes the model more reliable, keep it.

If a tool makes the model more confused, simplify or remove it.

Examples of potentially useful operations:

```text
move_region()
copy_region()
mirror_region()
replace_color()
sample_region()
diff_frames()
get_bounding_box()
validate_region()
```

But only implement them when experiments demonstrate value.

---

# 23. Main Development Loop

Use this loop throughout the project:

```text
┌─────────────────────────────┐
│        SELECT ASSET         │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       PLAN STRUCTURE        │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│      BUILD SILHOUETTE       │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       BUILD MAJOR FORMS     │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│      APPLY PALETTE/SHADING  │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│         RENDER              │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│         INSPECT             │
└──────────────┬──────────────┘
               ↓
       ┌───────┴────────┐
       │                │
   GOOD ENOUGH?        NO
       │                │
       │                ↓
       │       DIAGNOSE HIGHEST-
       │       IMPACT DEFECT
       │                ↓
       │       LOCALIZED FIX
       │                ↓
       │             RENDER
       │                │
       │                └───────┐
       │                        │
       └────────────────────────┘
                ↓
         FINAL VERIFICATION
                ↓
             EXPORT
```

---

# 24. First Objective

Do not start by trying to make the model generate everything.

Start with **benchmark assets**.

First targets:

```text
16×16:
- coin
- potion
- sword

32×32:
- axe
- chest
- torch

64×64:
- sword
- axe
- character
- creature
```

For each asset:

1. Generate.
2. Render.
3. Inspect.
4. Diagnose.
5. Fix one high-impact issue.
6. Diff.
7. Verify.
8. Repeat.
9. Stop when the quality criteria are satisfied.
10. Save the result and metrics.

---

# 25. Ultimate Goal

The project is no longer primarily about proving that an LLM can put pixels on a canvas.

That has already been demonstrated.

The next challenge is:

> **Can the system make the LLM behave like a disciplined pixel artist rather than a model randomly arranging pixels?**

The desired progression is:

```text
Can generate pixels
        ↓
Can generate recognizable objects
        ↓
Can maintain structure
        ↓
Can maintain style
        ↓
Can make precise corrections
        ↓
Can preserve correct regions
        ↓
Can construct high-quality game assets
        ↓
Can construct coherent asset sets
        ↓
Can animate them consistently
```

The final target is **production-quality pixel art generated through a non-vision coding agent using `pixel-engine`**.

---

# Immediate OpenCode Task

Do not rewrite `pixel-engine`.

First:

1. Inspect the current repository.
2. Identify the existing pixel representation and tools.
3. Identify current rendering/import/export capabilities.
4. Identify how the agent currently interacts with the engine.
5. Determine what is already sufficient for the accuracy loop.
6. Identify the minimum missing capabilities.
7. Implement only those capabilities.
8. Add automated tests.
9. Create the first benchmark assets.
10. Run the generation → inspection → diagnosis → correction loop.
11. Record failures.
12. Improve the representation/skill/tools based on observed failures.

**Do not assume that adding more instructions will automatically improve visual quality.**

Experiment.

Measure.

Change one important variable at a time where practical.

The objective is to discover the architecture, tools, representation, and agent workflow that produce the **highest-quality pixel art with the fewest unintended pixel changes**.

---

# Task Tracker — First Benchmark Ladder (§24)

Each asset is generated by a dedicated agent using the render → inspect →
diagnose → fix loop. Checkboxes are updated by the orchestrator as agents
complete. Assets are independent: each owns its scene file + experiment
record, and no agent touches shared files (engine, tests, cli, tasks.md).

## Level 1 — Basic objects (16×16)

- [x] coin — `scenes/coin16.json` + `docs/experiments/coin16.md`
- [x] potion — `scenes/potion16.json` + `docs/experiments/potion16.md`
- [x] sword — `scenes/sword16.json` + `docs/experiments/sword16.md`

## Level 2 — Weapons/tools (32×32)

- [x] axe — `scenes/axe32.json` + `docs/experiments/axe32.md`
- [x] chest — `scenes/chest32.json` + `docs/experiments/chest32.md`
- [x] torch — `scenes/torch32.json` + `docs/experiments/torch32.md`

## Level 2 — Weapons/tools (64×64)

- [x] sword — `scenes/sword64.json` + `docs/experiments/sword64.md`
- [x] axe — `scenes/axe64.json` + `docs/experiments/axe64.md`

## Level 5/6 — Creatures & characters (64×64)

- [x] creature — `scenes/creature64.json` + `docs/experiments/creature64.md`
- [x] character — `scenes/character64.json` + `docs/experiments/character64.md`

## Close-out

- [x] All 10 assets hash-locked in `tests/test-suite.js`; suite green (127 passed, 0 failed)
- [x] Asset-set coherence review (§15): palette/outline/lighting compatibility
- [x] Commit + report

### §15 coherence review (10-asset benchmark set)

| Criterion | Verdict | Evidence |
|---|---|---|
| Palette compatibility | PASS | Same material families across the set: steel `#7a8a9a`/`#b8c8d8` (sword16, axe32, sword64, axe64, character64), wood `#6b4226`-family (axe32, chest32, torch32, axe64), gold `#e8c14e`-family (coin16, sword64), armor/leather tones (character64), 2–3 tone dark/mid/light shading per material |
| Outline compatibility | PASS (note) | 8/10 share `#1a1a1a`; coin16 `#2b1d0e` and potion16 `#1c2026` are hue-tinted near-blacks (warm for gold, cool for glass) — deliberate, harmonize with subject, all within the near-black family |
| Lighting compatibility | PASS | Upper-left lighting everywhere: light on top/left edges, shadow on bottom/right (documented per asset in `docs/experiments/*.md`) |
| Pixel density | PASS | Density scales with canvas: sparse 16×16, medium 32×32, detailed 64×64; same subjects at two scales (sword16→sword64, axe32→axe64) keep silhouette + material treatment |
| Visual style | PASS | Same construction everywhere: outline + mid + light + dark layers, palette keys only (never raw hex), sparse pixel overrides for detail, transparent background, 1–2px margins |
| Relative scale | PASS | Ladder matches §24: basic objects 16×16, weapons/tools 32×32 and 64×64, creatures/characters 64×64; character and creature are the largest subjects |

Verdict: the set reads as one artist's work — same construction system, same lighting, same material palette families, near-black outlines throughout.