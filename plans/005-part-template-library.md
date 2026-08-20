# Plan 005: Part Template Library for Complex Subjects

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 92dc059..HEAD -- engine/pixel-engine.js scenes/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (uses existing `poly`, `poly_union`, `curve`; benefits from 001's compact encoding but does not require it)
- **Category**: direction
- **Planned at**: commit `92dc059`, 2026-05-13
- **Issue**: —

## Why this matters

"Generate a cat and boom the AI messes it up" happens because the LLM must invent cat anatomy (head, body, legs, tail, ears) as raw poly coordinates with no prior. Each part is a few polys; a cat is ~8 parts. Without templates, the LLM guesses coordinates, producing the complexity collapse the user observes. A part library gives the LLM composable, anatomically plausible primitives (cat_head, cat_body, …) that it positions and recolors instead of drawing from scratch — trading invention for assembly.

## Current state

Relevant files:
- `engine/pixel-engine.js` — primitives: `poly`, `poly_union`/`poly_subtract`, `curve`, `draw_cluster`, `extract_outline`; no part library
- `scenes/craft/creature32.json` — one craft creature with explicit polys for body, belly, shade, legs, light, outline (hard-coded, not reusable)
- `scenes/` — 13 scenes (house, creature64, etc.), none are part templates
- `skills/pixel-art-builder/SKILL.md` — "Contour-first construction" tells the LLM to draw one silhouette poly for the whole creature, not per-part outlines — but there is no library of silhouette parts to compose

Repo conventions:
- Scenes are JSON with `size`, `palette`, `layers` (each `{ id, type, points, color }`), `pixels`
- Tests hash-lock scenes via `hash256(PE.rasterize(scene))`

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node tests/test-suite.js` | 257 passed → 260+ passed |
| Manual part | `node -e "const P=require('./engine/parts.js'); console.log(Object.keys(P.templates))"` | prints `cat_head, cat_body, ...` |

## Scope

**In scope**:
- `engine/parts.js` (new — part template definitions: cat, dog, humanoid base, or generic `templates/` directory)
- `scenes/templates/` (new — optional JSON files per part, if you choose file-based over code-based)
- `engine/pixel-engine.js` (add `get_part(name)`, `place_part(scene, name, opts)` helpers; keep thin)
- `tests/test-suite.js` (add part library tests)
- `skills/pixel-art-builder/SKILL.md` (add "Part library" subsection)
- `docs/experiments/` (optional: one example `cat32.json` assembled from parts)

**Out of scope**:
- `engine/animation.js` — animation parts are follow-up
- `mcp/` — MCP part tools are follow-up
- Any change to rasterizer or poly boolean ops — parts are data, not new geometry

## Git workflow

- Branch: `advisor/005-part-templates`
- Commit per step; message style: `feat: cat part template library`
- Do NOT push or open PR unless instructed

## Steps

### Step 1: Define the part template format

Create `engine/parts.js` (or `scenes/templates/`) with:

```js
// Each template is a layer or array of layers with relative coordinates (0..1 or 0..size)
// and a palette key placeholder.
export const templates = {
  cat_head: {
    size: 32,
    palette: { furMid: "#...", furDark: "#...", eye: "#...", nose: "#..." },
    layers: [
      { type: "poly", points: [[...]], color: "furMid" },
      // ears, eyes, nose as separate layers
    ]
  },
  cat_body: { ... },
  cat_tail: { ... },
  cat_leg: { ... },
};
```

Keep templates at 32×32 canonical size; `place_part` will scale/translate to the target scene's tile.

Start with **one subject: cat** (4 parts: head, body, tail, leg) — do not build a zoo. Add `dog_head` etc. only if cat is done and tests pass.

**Verify**: `node -e "import('./engine/parts.js').then(m=>console.log(Object.keys(m.templates)))"` → prints `cat_head` etc. (or `require` if you use CommonJS).

### Step 2: Add placement helpers to the engine

In `engine/pixel-engine.js`, add:

```js
function get_part(name) { /* return deep copy of template */ }
function place_part(scene, name, opts) {
  // opts: { x, y, scale?, palette? }
  // - Look up template, scale points by scale (default 1), translate by (x,y)
  // - Remap palette keys if opts.palette given
  // - Add layers to scene (prefix ids with name to avoid collision)
  // - Returns { placed: N }
}
```

Scale math: `pt = [x + (origX * scale), y + (origY * scale)]` where `orig` is in template's 32×32 space.

**Verify**: `node -e "const PE=require('./engine/pixel-engine.js'); const s=PE.create_canvas(64); PE.place_part(s,'cat_head',{x:10,y:10}); console.log(s.layers.length>0)"` → `true`.

### Step 3: Assemble a demo cat and add tests

Create `scenes/cat32.json` (or `scenes/demo/cat32.json`) assembled from parts:

```js
const s = PE.create_canvas(32);
s.palette = { ...templates.cat_head.palette, ...templates.cat_body.palette };
PE.place_part(s, 'cat_head', { x: 8, y: 4 });
PE.place_part(s, 'cat_body', { x: 6, y: 14 });
// ... tail, legs
```

Add tests in `tests/test-suite.js`:

- `test('parts: cat_head template rasterizes non-empty', ...)` — `PE.get_part('cat_head')` has layers, rasterizes to >0 painted pixels
- `test('parts: place_part composes cat with all parts', ...)` — assembled cat has expected layer count, hash-locked raster (or at least silhouette IoU >0.5 vs reference if you have one)
- `test('parts: place_part scale/translate', ...)` — placed part at (0,0) vs (10,10) has bbox shifted by 10

**Verify**: `node tests/test-suite.js` → 260+ passed, includes `parts:` tests; `hash256(PE.rasterize(catScene))` is stable.

### Step 4: Document the library

In `skills/pixel-art-builder/SKILL.md`, add subsection under "Bulk operations first" or new "Part library":

```md
### Part library (complex subjects)

- `get_part(name)` / `place_part(scene, name, { x, y, scale?, palette? })` — composable anatomy primitives (cat_head, cat_body, cat_tail, cat_leg). Use these instead of inventing cat anatomy from scratch.
- Assemble: `cat_head` at (8,4), `cat_body` at (6,14), `cat_tail`, `cat_leg` ×4 — then run taste checks.
```

In `skills/pixel-engine/references/api.md`, add `get_part` / `place_part` rows.

**Verify**: `grep -n "place_part" skills/pixel-engine/references/api.md` → found.

## Test plan

- New tests: template existence, raster non-empty, placement shift, composition hash (model after `test('poly_union: convex ...')`)
- Existing hash-locked scenes must still pass (no rasterizer change)
- Verification: `node tests/test-suite.js` all pass

## Done criteria

- [ ] `node -e "const PE=require('./engine/pixel-engine.js'); console.log(typeof PE.get_part==='function' && typeof PE.place_part==='function')"` prints `true`
- [ ] `node tests/test-suite.js` exits 0, includes `parts:` tests, 260+ passed
- [ ] `grep -rn "cat_head" engine/parts.js` returns 1+ matches
- [ ] `grep -rn "place_part" skills/pixel-engine/references/api.md` returns 1+ matches
- [ ] No files outside in-scope list modified

## STOP conditions

- If a part template's raster is empty (no painted pixels) → STOP, the points are likely in template-local coords that need translation; fix the template data, do not change the rasterizer.
- If `place_part` with `scale=2` produces out-of-bounds layers that are clipped and the silhouette test expects no clipping → STOP, the scale math is wrong; check whether `scale` should be applied to points or to the whole tile.
- If the repo already has a `scenes/templates/` directory for an unrelated purpose (check drift) → STOP, use `engine/parts.js` instead.

## Maintenance notes

- New subjects (dog, bird, human) should follow the same template shape: one file per subject or one entry per part in `engine/parts.js`; keep the canonical size at 32.
- Reviewers: verify that `place_part` deep-copies the template (no shared array mutation) — `JSON.parse(JSON.stringify(template))` is the current pattern for `duplicate_frame`.
- Follow-up: expose `get_part`/`place_part` via MCP and add a "cat from parts" example to `docs/experiments/`.
```

