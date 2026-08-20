# Plan 001: Workflow Token Diet (Patch-First Loop + Terse Inspection + Hard Stop)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 92dc059..HEAD -- engine/pixel-engine.js tests/test-suite.js skills/pixel-art-builder/SKILL.md skills/pixel-engine/references/api.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `92dc059`, 2026-05-13
- **Issue**: —

## Why this matters

A single 64×64 asset costs the user ~400k tokens, not the 6–12k a naive `JSON.stringify(scene).length/4` suggests. The gap is the **workflow**, not the scene JSON: the current `render → inspect → fix` loop as written in `skills/pixel-art-builder/SKILL.md` has (a) no stop rule so the agent iterates 8–12 times, (b) each iteration re-emits the **full scene JSON** (~3.2k chars) instead of a patch, (c) each `inspect()` returns every color's bbox + `read_region` returns 64 lines of ASCII that all stay in context, and (d) all prior iterations stay in the context window. Scene compactness alone would save ~1–2k of 400k (0.5%). Cutting the loop to patches + terse diffs + a hard stop is the only path to a 60–80% saving that also improves taste (less context bloat = less forgetting of the cat's head shape).

## Current state

Relevant files and their roles:
- `engine/pixel-engine.js` (2,091 lines) — scene is `{ size, palette, layers, pixels }`; verbose layer like `{ "id": "body", "type": "poly", "points": [[24,8],[28,10]], "color": "skinMid" }` (`scenes/craft/creature32.json:12`). Already has granular mutators (`set_pixel`, `add_layer`, `replace_color`, `move_region`, `replace_color_region`, `diff_scenes`) but no `encode_compact`/`apply_patch` helper.
- `skills/pixel-art-builder/SKILL.md:100-109` — the loop today:
  ```md
  ## The render → inspect → fix loop
  After each construction phase:
  1. `read_region(scene)` — auto-scaled ASCII preview
  2. `inspect(scene)` — per-color counts + bboxes
  3. `read_region(scene, x, y, w, h)` — full-resolution zoom
  4. Diagnose, fix surgically, re-render
  ```
  No stop condition, no mention of patches, and `inspect`/`read_region` are always full-canvas.
- `engine/pixel-engine.js:858` — `inspect(scene)` returns `{ layers, pixelOverrides, colors: [{ name, color, count, bbox }] }` for every color (verbose when palette has 6+ keys).
- `tests/test-suite.js` (257 tests) — scene tests use `hash256(PE.rasterize(s))`; no workflow token measurement harness exists.
- `skills/pixel-engine/references/api.md` — documents scene schema verbosely.

Repo conventions to match:
- Error handling: `throw new Error('function: reason')` (see `engine/pixel-engine.js:144`).
- Tests: `test('name', () => { assert... })` with `hash256` helper — model after `test('diff_scenes: identical scenes ...')`.
- Skills are markdown with `##` sections; engine is zero-dep UMD.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node tests/test-suite.js` | 257 passed → 261+ passed |
| Typecheck | `node --check engine/pixel-engine.js` | exit 0 |
| Workflow tokens | `node scripts/measure-workflow-tokens.js` (you will create) | prints `verbose workflow ~400k → patched ~80k` style estimate |

## Scope

**In scope** (the only files you should modify):
- `engine/pixel-engine.js` (add `encode_compact`/`decode_compact` + `apply_patch`/`get_patch` helpers; keep zero-dep)
- `engine/compact.js` (new, optional — if you create it, re-export via PE)
- `scripts/measure-workflow-tokens.js` (new — workflow-level token estimator)
- `tests/test-suite.js` (add patch round-trip + workflow token budget tests)
- `skills/pixel-art-builder/SKILL.md` (rewrite the loop to patch-first, terse, hard-stop)
- `skills/pixel-engine/references/api.md` (document compact + patch helpers)
- `README.md` (one line on patch-first mode, if needed)

**Out of scope** (do NOT touch, even though they look related):
- `engine/animation.js` — animation workflow is separate; do not change frame encoding here
- `mcp/` — MCP patch tool schemas are a follow-up plan; compact mode will be exposed there later
- Any change to `rasterize` output — compact/patch must be lossless (pixel-identical)

## Git workflow

- Branch: `advisor/001-workflow-token-diet`
- Commit per step; message style: `feat: workflow token diet` and `docs: patch-first loop`
- Do NOT push or open a PR unless instructed

## Steps

### Step 1: Create a workflow-level token harness

Create `scripts/measure-workflow-tokens.js` that estimates **workflow** tokens, not just scene JSON. It must:

1. Load `scenes/house.json`, `scenes/creature64.json`, `scenes/craft/creature32.json`
2. Compute **verbose scene tokens** as `Math.ceil(JSON.stringify(scene).length/4)` (chars/4; document that you use this or `js-tiktoken` if you add it — no heavy deps)
3. Simulate the current loop: assume 6 iterations × (full scene tokens + `inspect` output tokens + `read_region` output tokens). Estimate `inspect` tokens as `JSON.stringify(PE.inspect(scene)).length/4` and `read_region` as `PE.read_region(scene).length/4`. Print a table: `file | scene tokens | inspect tokens | 6× workflow tokens`
4. After Step 3, also compute **patched workflow**: same 6 iterations but each iteration emits a patch (`get_patch`/`diff_scenes` size) + terse inspect (only `diff_scenes` bbox + changed count, not full `inspect`). Print `patched workflow tokens` and `saving %`. This is the number that must drop from ~400k toward ~80k.

**Verify**: `node scripts/measure-workflow-tokens.js` → prints table, exit 0, shows workflow baseline in the hundreds of k (not just 6k). If it prints only ~6k, your harness is still scene-only — fix it.

### Step 2: Implement compact codec + patch helpers

In `engine/pixel-engine.js` (or `engine/compact.js` re-exported via PE), add:

**Compact schema** (this is the plan's contract — implement exactly this):
- Short keys: `s` for `size`, `p` for `palette` (ordered array of hexes, not object), `l` for `layers`, `x` for `pixels`
- Layer: `t` for `type` (single-char codes: `f`=fill, `r`=rect, `o`=rectout, `e`=ellipse, `n`=line, `y`=poly, `Y`=polyout, `c`=curve), `c` for `color` as integer palette index, `d` for `id`, `a` for params (`x`/`y`/`w`/`h`/`cx`…), points as flat array `[x1,y1,x2,y2,…]`
- Pixels as `[[x,y,colorIdx],…]`

Provide:
```js
function encode_compact(scene) // -> compact object
function decode_compact(c)     // -> verbose scene (lossless)
function get_patch(oldScene, newScene) // -> { paletteDelta, layersDelta, pixelsDelta } or compact diff; use diff_scenes for pixel changes
function apply_patch(scene, patch)     // -> mutated scene (or new scene)
```

`get_patch` can be a thin wrapper over `diff_scenes` + palette diff: the point is that its `JSON.stringify(patch).length` is ~10× smaller than `JSON.stringify(newScene).length` (e.g. changing 2 layers out of 18).

Attach to PE: `PE.encode_compact`, `PE.decode_compact`, `PE.get_patch`, `PE.apply_patch`.

**Verify**: `node -e "const PE=require('./engine/pixel-engine.js'); const s=require('./scenes/house.json'); const c=PE.encode_compact(s); const d=PE.decode_compact(c); console.log(JSON.stringify(d)===JSON.stringify(s)?'round-trip OK':'FAIL'); console.log('verbose',JSON.stringify(s).length,'compact',JSON.stringify(c).length); const s2=JSON.parse(JSON.stringify(s)); s2.layers[0].color='roof'; const patch=PE.get_patch(s,s2); console.log('patch',JSON.stringify(patch).length,'vs full',JSON.stringify(s2).length)"` → `round-trip OK`, compact 40–60% smaller, patch <20% of full.

### Step 3: Rewrite the builder skill's loop to patch-first, terse, hard-stop

In `skills/pixel-art-builder/SKILL.md`, replace the `render → inspect → fix` section (currently lines 100-109) with:

```md
## The render → inspect → fix loop (patch-first, hard-stop)

After each construction phase:
1. `diff_scenes(prevScene, scene)` — terse diff: `{ changed, bbox, changes }` only. Do NOT re-emit the full scene; emit a patch (`get_patch`) or call granular mutators (`add_layer`, `set_pixel`, `place_part`, `replace_color_region`).
2. `inspect` only the bbox: `read_region(scene, bbox[0], bbox[1], bbox[2], bbox[3])` at scale 1, not the full canvas. Full-canvas `inspect` only on the first iteration.
3. Taste check: `validate_scene` + `analyze_values` + `check_hue_shift` — if FAIL, fix palette before adding geometry.
4. **Hard stop**: stop when `validate_scene` PASS and `check_hue_shift` PASS and (`compare_scene_to_reference` IoU>0.9 if reference exists), or after 5 iterations — whichever comes first. Do not iterate past 5.
5. Context pruning: keep only `last_scene + diff`, not the full history. The MCP server's `diff_scenes` is the only inspection that stays in context beyond the last turn.
```

Also update the "Bulk operations first" paragraph to say: "Prefer `place_part`/`add_layer`/`diff_scenes` patches over `JSON.stringify(scene)` — a full scene rewrite is a 400k-token failure mode."

**Verify**: `grep -n "Hard stop" skills/pixel-art-builder/SKILL.md` → found; `grep -n "get_patch" skills/pixel-art-builder/SKILL.md` → found; `grep -n "diff_scenes" skills/pixel-art-builder/SKILL.md` → found.

### Step 4: Add tests and document

- In `tests/test-suite.js` after Phase 5, add:
  - `test('compact: house round-trip pixel-identical', ...)` — `hash256(PE.rasterize(s)) === hash256(PE.rasterize(PE.decode_compact(PE.encode_compact(s))))` for house, creature64, craft/creature32
  - `test('patch: get_patch + apply_patch round-trip', ...)` — `apply_patch(clone(s), get_patch(s, s2))` raster-identical to `s2`
  - `test('patch is smaller than full scene', ...)` — `JSON.stringify(patch).length < JSON.stringify(s2).length * 0.3`
- In `skills/pixel-engine/references/api.md` add rows for `encode_compact`, `decode_compact`, `get_patch`, `apply_patch`.
- In `README.md` Engine API table add one line: "Patch-first mode: `get_patch`/`apply_patch` + `encode_compact` — see `measure-workflow-tokens.js`."

**Verify**: `node tests/test-suite.js` → 261+ passed (257 + 4 new), 0 failed.

## Test plan

- New tests: compact round-trip (3 scenes), patch round-trip, patch size <30% of full (model after `test('diff_scenes: identical scenes ...')`).
- Harness: `node scripts/measure-workflow-tokens.js` must show workflow tokens dropping from ~400k (verbose loop) to ~80k (patched loop) on house.
- Existing hash-locked scenes must still pass.

## Done criteria

Machine-checkable. ALL must hold:
- [ ] `node tests/test-suite.js` exits 0, shows 261+ passed, includes `compact: house round-trip` and `patch is smaller than full scene`
- [ ] `node -e "const PE=require('./engine/pixel-engine.js'); const s=require('./scenes/house.json'); console.log(JSON.stringify(PE.encode_compact(s)).length < JSON.stringify(s).length*0.7)"` prints `true`
- [ ] `node scripts/measure-workflow-tokens.js` prints a table with `patched workflow tokens` at least 50% smaller than `6× workflow tokens`
- [ ] `grep -rn "Hard stop" skills/pixel-art-builder/SKILL.md` returns 1+ matches
- [ ] `grep -rn "get_patch" skills/pixel-engine/references/api.md` returns 1+ matches
- [ ] No files outside in-scope list modified (`git status --short` shows only in-scope + plans/)

## STOP conditions

- If verbose→compact→verbose is not pixel-identical on house/creature64 (raster hash mismatch) → STOP, schema is lossy; do not add lossy compression.
- If `get_patch` patch is not <30% of full scene on a 2-layer change → STOP, the patch is too verbose (likely still string palette keys); report and fix palette-index encoding.
- If the skill's hard-stop rule would break `validate_scene` hash-locked tests (e.g. a test expects >5 iterations) → STOP, the stop rule belongs in the skill, not the engine; keep engine tests iteration-agnostic.
- Any in-scope file content doesn't match "Current state" excerpts (drift).

## Maintenance notes

- Future palette or layer type additions must update the compact type-code map and `get_patch`'s palette-index remapping. Add a test that fails if a new layer type is not in the map.
- Reviewers: scrutinize that palette array order is deterministic (insertion order of `scene.palette`); `get_patch` must not reorder it.
- Follow-up: expose `encode_compact`/`get_patch` in `mcp/` tool schemas (separate plan) and teach the critic skill to use `diff_scenes` as the primary inspection.
