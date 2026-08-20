# Plan 003: Taste-Guided Critic Loop (Wire Phase 5 into the Agent Loop)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 92dc059..HEAD -- engine/pixel-engine.js skills/pixel-art-builder/SKILL.md skills/pixel-art-critic/SKILL.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (Phase 5 engine functions already landed: `compare_scene_to_reference`, `analyze_values`, `check_hue_shift`)
- **Category**: direction
- **Planned at**: commit `92dc059`, 2026-05-13
- **Issue**: —

## Why this matters

Phase 5 built the taste engine (`check_hue_shift` correctly passes craft palette and fails flat palette, `compare_scene_to_reference` gives perfect IoU on self), but the AI's generation loop does not use it. Today a "cat" fails because the LLM has no taste signal during construction — it draws flat shading and pure-black outlines and never gets corrected. Wiring the taste checks into the render→inspect→fix loop (as provable FACT checks, not vibes) is the highest-leverage path to "cat doesn't mess up" without needing a learned reward model.

## Current state

Relevant files:
- `engine/pixel-engine.js: ~1750-1850` — `compare_scene_to_reference`, `analyze_values`, `check_hue_shift` are implemented and exported, tests pass (257 total)
- `skills/pixel-art-builder/SKILL.md` — "Craft rules" section lists 6 rules (hue-shifted shading, outline color, value compression, silhouette readability, detail economy, light-source consistency) but has no step that *runs* the checks
- `skills/pixel-art-critic/SKILL.md` (if exists; otherwise `skills/pixel-art-builder/SKILL.md` "The render → inspect → fix loop" at line ~100) — currently: `read_region`, `inspect`, `read_region` zoom, diagnose
- `docs/experiments/craft-rules.md` — demonstrates `scenes/craft/creature32.json` with old vs new palette and 6 PASS checks

Excerpt — current loop (`skills/pixel-art-builder/SKILL.md:100-109`):
```md
## The render → inspect → fix loop
After each construction phase:
1. `read_region(scene)` — auto-scaled ASCII preview
2. `inspect(scene)` — per-color counts + bboxes
3. `read_region(scene, x, y, w, h)` — full-resolution zoom
4. Diagnose, fix surgically, re-render
```

Repo conventions:
- Skills are markdown with `##` sections; code excerpts are illustrative, not executed
- Critic skill reports PASS/FAIL with evidence (see craft-rules.md verification section)
- Engine functions throw `Error('function: reason')` on bad input

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node tests/test-suite.js` | 257 passed, 0 failed |
| Manual taste | `node -e "const PE=require('./engine/pixel-engine.js'); const s=require('./scenes/craft/creature32.json'); console.log(PE.check_hue_shift(s.palette))"` | `{ pass: true, ... }` |

## Scope

**In scope**:
- `skills/pixel-art-builder/SKILL.md` (add taste-check steps to the loop)
- `skills/pixel-art-critic/SKILL.md` (create if absent, or update if present — this is the primary deliverable)
- `skills/pixel-engine/references/api.md` (ensure `analyze_values`/`check_hue_shift`/`compare_scene_to_reference` are already documented — just verify)
- `docs/experiments/craft-rules.md` (optional: add one paragraph on how the loop uses the checks)
- `tests/test-suite.js` (optional: add one integration test that runs the critic checks on craft vs flat scene — if you add it, keep it small)

**Out of scope**:
- `engine/pixel-engine.js` — taste engine is done; do not change its logic in this plan (fixing `familyOf` was already done)
- `mcp/` — MCP wiring is separate; do not add taste tools here (they already exist)
- Any new learned model or human-signal pipeline — explicitly out of scope for this plan (that's a future direction)

## Git workflow

- Branch: `advisor/003-taste-critic-loop`
- Commit per step; message style: `docs: wire taste checks into critic loop`
- Do NOT push or open PR unless instructed

## Steps

### Step 1: Create or update the critic skill's craft pass

If `skills/pixel-art-critic/SKILL.md` does not exist, create it with:

```md
---
name: pixel-art-critic
description: Critique pixel art with provable FACT checks and craft PASS/FAIL. Use after each construction phase.
---

# pixel-art-critic

## FACT checks (provable, blocking)

- `validate_scene(scene)` → `{ valid, errors[] }` — size, palette, layers, pixels
- `diff_scenes(a,b)`, `check_symmetry`, `measure_distance`, `compare_scene_to_reference`

## Craft pass (taste, HIGH defect if FAIL)

Run after FACT checks pass:

1. `analyze_values(scene)` → check `warnings` for value steps per family (expect 3-4, except single-key families like eye)
2. `check_hue_shift(palette)` → must be `pass: true`; if FAIL, report which family and hue diff (e.g. `skin: highlight not hue-shifted (3.0°)` )
3. `compare_scene_to_reference(scene, refRgba)` if a reference is available → `silhouetteIoU` should be >0.9, `paletteDistance` <20 for craft palette

Each check reports PASS/FAIL with evidence; a craft FAIL is a HIGH defect (fix before concluding), not a blocking FACT FAIL.
```

If the file already exists, merge this craft pass into its existing "Craft pass" section (do not duplicate).

**Verify**: `ls skills/pixel-art-critic/SKILL.md` → exists; `grep -n "check_hue_shift" skills/pixel-art-critic/SKILL.md` → found.

### Step 2: Wire the checks into the builder's loop

In `skills/pixel-art-builder/SKILL.md`, after "The render → inspect → fix loop" section, add a 5th step:

```md
5. **Taste check** (after FACT checks pass): `analyze_values(scene)` and `check_hue_shift(palette)` — if either FAILs, fix palette hue/value before adding more geometry. If a reference image is available, `compare_scene_to_reference(scene, refRgba)` should be >0.9 IoU.
```

Also in the "Construction pipeline" cleanup step (line ~79: `Run validate_scene`), extend to:

```md
Run `validate_scene(scene)` and the craft checks (`analyze_values`, `check_hue_shift`) as the final gate.
```

**Verify**: `grep -n "analyze_values" skills/pixel-art-builder/SKILL.md` → found.

### Step 3: Add one integration test (optional but recommended)

In `tests/test-suite.js`, add:

```js
test('critic loop: craft scene passes taste, flat scene fails', () => {
  const craft = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/craft/creature32.json'), 'utf8'));
  assert.strictEqual(PE.analyze_values(craft).families.skin.count, 3);
  assert.strictEqual(PE.check_hue_shift(craft.palette).pass, true);
  const flat = { outline:'#1A1A1A', skinDark:'#4A7A3A', skinMid:'#6BA34F', skinLight:'#8FC46E', belly:'#C9E8A8', eye:'#1A1A1A' };
  assert.strictEqual(PE.check_hue_shift(flat).pass, false);
});
```

**Verify**: `node tests/test-suite.js` → 258+ passed.

## Test plan

- New test (if added): craft vs flat palette as above — model after `test('check_hue_shift: craft palette passes, flat palette fails', ...)` already in suite.
- Existing taste tests already cover the engine functions; this plan's value is skill wiring, not new engine logic.
- Verification: `node tests/test-suite.js` all pass; manual `node -e "require('./engine/pixel-engine.js').check_hue_shift(...)"` shows PASS/FAIL.

## Done criteria

- [ ] `ls skills/pixel-art-critic/SKILL.md` → file exists and contains `check_hue_shift` and `analyze_values`
- [ ] `grep -n "Taste check" skills/pixel-art-builder/SKILL.md` → found (or `analyze_values` in that file)
- [ ] `node tests/test-suite.js` exits 0 (258+ passed if you added the test, else 257)
- [ ] No files outside in-scope list modified

## STOP conditions

- If `skills/pixel-art-critic/SKILL.md` already has a craft pass that contradicts `craft-rules.md` (e.g. demands pure-black outlines) → STOP, the skill and the doc disagree; report which is wrong instead of adding a second contradictory section.
- If `check_hue_shift` or `analyze_values` are not exported on `PE` (drift) → STOP, engine change is missing; do not re-implement engine here.

## Maintenance notes

- When `familyOf` grouping changes (e.g. new naming convention), update both the engine and the skill's note on families.
- Reviewers should verify that the critic skill's craft FAIL is marked HIGH (not blocking) per `craft-rules.md` — a flat-shaded but correct silhouette should not block iteration, but should be fixed before ship.
```

