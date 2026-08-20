# Plan 004: Reference-Driven Vectorization (PNG Import → Scene)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 92dc059..HEAD -- engine/pixel-engine.js cli.js skills/pixel-engine/references/api.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (Phase 2 import `decode_png` + `quantize_palette` + Phase 5 `compare_scene_to_reference` already exist)
- **Category**: direction
- **Planned at**: commit `92dc059`, 2026-05-13
- **Issue**: —

## Why this matters

"Generate a cat" fails because the LLM must invent anatomy from scratch in vector form (polys, ellipses) with no visual grounding. A reference image (hand-drawn cat, photo, or diffusion output) gives the LLM something to *trace* and then critique via `compare_scene_to_reference`. Today `decode_png` + `quantize_palette` exist but there is no end-to-end "image → scene" workflow — the engine can import a PNG, but the agent has no skill telling it how to turn that import into a scene document. Closing that gap lets the LLM bootstrap complex subjects (cat) from a reference instead of from memory.

## Current state

Relevant files:
- `engine/pixel-engine.js:1205-1306` — `decode_png(bytes)` returns `{ width, height, rgba }` (Node zlib, 8-bit RGB/RGBA/palette)
- `engine/pixel-engine.js:1359-1410` — `quantize_palette(rgba, maxColors)` returns `{ palette, indices }` (median-cut)
- `engine/pixel-engine.js:1740+` — `compare_scene_to_reference(scene, refRgba, opts?)` returns `{ silhouetteIoU, paletteDistance, ... }`
- `skills/pixel-engine/references/api.md` — documents `decode_png`, `quantize_palette`, `compare_scene_to_reference` as separate rows, but no workflow
- `cli.js` — has `node cli.js scenes/house.json --png out/house.png` but no import path like `--import ref.png --scene out/scene.json`

Repo conventions:
- CLI is zero-dep Node; scene JSON is plain; tests use `PE.rasterize` + `hash256`
- Skills are markdown; the builder skill has "Import / export + agent-loop tools" section listing the primitives but not a workflow

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node tests/test-suite.js` | 257 passed → 260+ passed |
| CLI import | `node cli.js --import ref.png --scene out/scene.json` (you will add) | writes scene JSON |
| Manual import | `node -e "const PE=require('./engine/pixel-engine.js'); const fs=require('fs'); const d=PE.decode_png(fs.readFileSync('ref.png')); console.log(d.width)"` | prints dimensions |

## Scope

**In scope**:
- `engine/pixel-engine.js` (add `import_png_to_scene` helper that wraps decode+quantize+scene scaffolding)
- `cli.js` (add `--import` flag)
- `skills/pixel-art-builder/SKILL.md` (add "Reference-driven workflow" section)
- `skills/pixel-engine/references/api.md` (add `import_png_to_scene` row if you add it)
- `tests/test-suite.js` (add import workflow test)
- `scripts/import-reference.js` (new, optional CLI helper)

**Out of scope**:
- `engine/animation.js` — animation import is separate
- `mcp/` — MCP wiring is follow-up
- Any new ML model or external API (no diffusion API call in this plan; reference is a local PNG the user provides)
- Auto-vectorization that converts raster to polys automatically — that is a separate, much larger project; this plan scaffolds a scene with palette + raster reference for the LLM to trace, not auto-trace

## Git workflow

- Branch: `advisor/004-reference-vectorization`
- Commit per step; message style: `feat: reference-driven scene import`
- Do NOT push or open PR unless instructed

## Steps

### Step 1: Add `import_png_to_scene` helper to the engine

In `engine/pixel-engine.js`, after `quantize_palette`, add:

```js
/**
 * import_png_to_scene(bytes, opts?) -> { scene, rgba, width, height, palette, indices }
 * Decodes a PNG, quantizes its palette, and scaffolds a scene document whose
 * palette is the quantized palette and whose layers are empty (the LLM will
 * fill them by tracing). opts: { maxColors?: 16, tileSize?: 64 }.
 * This is a scaffolding helper, not an auto-vectorizer.
 */
function import_png_to_scene(bytes, opts) {
  opts = opts || {};
  const decoded = decode_png(bytes);
  const q = quantize_palette(decoded.rgba, opts.maxColors || 16);
  const palette = {};
  q.palette.forEach((hex, i) => { palette['color' + i] = hex; });
  // Also preserve original hexes as keys if you want, but indexed palette is fine
  const size = decoded.width; // assume square for v1; if not square, use max and note in docs
  // For non-square HD refs, you will use tiled import later — v1 assumes square ladder size or scales
  const scene = {
    size: [16,32,64,128,256].includes(size) ? size : 64,
    palette: palette,
    layers: [], // LLM fills this
    pixels: {}
  };
  // Attach reference for compare_scene_to_reference
  scene._refRgba = decoded.rgba;
  scene._refWidth = decoded.width;
  scene._refHeight = decoded.height;
  return { scene, rgba: decoded.rgba, width: decoded.width, height: decoded.height, palette: q.palette, indices: q.indices };
}
```

Attach to PE: `PE.import_png_to_scene = import_png_to_scene`.

Keep it simple: the helper does NOT auto-trace polys; it gives the LLM a palette + empty canvas + reference buffer to compare against. The LLM then draws shapes and checks `compare_scene_to_reference(scene, decoded.rgba)` in a loop.

**Verify**: `node -e "const PE=require('./engine/pixel-engine.js'); const fs=require('fs'); const png=PE.encode_png(PE.create_canvas(16,'#ff0000')); const imp=PE.import_png_to_scene(png); console.log(imp.scene.palette, imp.width===16)"` → prints palette and `true`.

### Step 2: Add CLI import flag

In `cli.js`, add handling for `--import <png> --scene <out.json>`:

- If `args.import` is set, read the PNG file, call `PE.import_png_to_scene(fs.readFileSync(pngPath))`, write the scaffolded scene to `--scene` (or stdout if not given), and print `imported: <w>x<h>, <N> colors`.

Keep the existing `node cli.js scenes/house.json --png out.png` path untouched; add this as a new branch.

**Verify**: `node cli.js --import out/house-preview.png --scene /tmp/imported.json && cat /tmp/imported.json | head -20` → prints scene JSON with palette.

### Step 3: Document the workflow

In `skills/pixel-art-builder/SKILL.md`, under "Import / export + agent-loop tools", add a subsection:

```md
### Reference-driven workflow (complex subjects like cat)

1. `import_png_to_scene(bytes)` — decode + quantize → scaffolded scene (palette + empty layers) + `rgba` reference
2. LLM draws shapes (poly/curve) to approximate the reference
3. After each phase, `compare_scene_to_reference(scene, refRgba)` → check `silhouetteIoU` (>0.9) and `paletteDistance` (<20)
4. Iterate until IoU and palette distance are satisfactory, then run craft checks (`analyze_values`, `check_hue_shift`)
```

In `skills/pixel-engine/references/api.md`, add `import_png_to_scene` row.

**Verify**: `grep -n "import_png_to_scene" skills/pixel-engine/references/api.md` → found.

### Step 4: Add test

In `tests/test-suite.js`:

```js
test('import_png_to_scene: round-trip scaffold has correct palette and size', () => {
  const s = PE.create_canvas(16, '#ff0000');
  PE.fill_region(s, 2,2,4,4,'#00ff00');
  const png = PE.encode_png(s);
  const imp = PE.import_png_to_scene(png);
  assert.strictEqual(imp.width, 16);
  assert.ok(imp.palette.length >= 2);
  const m = PE.compare_scene_to_reference(imp.scene, imp.rgba);
  // Empty scene vs its own reference has low IoU (empty vs painted) — but palette should be close
  assert.ok(typeof m.silhouetteIoU === 'number');
});
```

**Verify**: `node tests/test-suite.js` → 258+ passed.

## Test plan

- New test: import scaffold round-trip with a 2-color scene → palette length, size, compare still works
- New test: CLI import flag writes valid JSON (spawn `node cli.js --import ...` and parse output)
- Model after: `test('decode_png: round-trip ...')` and `test('quantize_palette: ...')`

## Done criteria

- [ ] `node -e "const PE=require('./engine/pixel-engine.js'); console.log(typeof PE.import_png_to_scene==='function')"` prints `true`
- [ ] `node tests/test-suite.js` exits 0, includes `import_png_to_scene` test
- [ ] `grep -rn "import_png_to_scene" skills/pixel-engine/references/api.md` returns 1+ matches
- [ ] `grep -rn "Reference-driven" skills/pixel-art-builder/SKILL.md` returns 1+ matches
- [ ] No files outside in-scope list modified

## STOP conditions

- If `decode_png` returns non-square dimensions that are not in the ladder (e.g. 1280×720 reference) and `import_png_to_scene` cannot choose a `size` without tiling → STOP, the tiled import is needed; report and defer to Plan 002's tiled scaffolding instead of forcing a square scene.
- If `quantize_palette` on the reference produces >12 colors (violates `validate_scene` 5–12 rule) → STOP, the imported palette needs filtering or the validate rule needs revisiting; report instead of silently truncating.

## Maintenance notes

- The scaffolded scene has no layers — it is a starting point for the LLM, not a finished asset. Future work could add auto-vectorization (raster → poly) but that is explicitly out of scope here.
- Reviewers: verify that `import_png_to_scene` does not mutate the decoded `rgba` (it should be copied if stored on `scene._refRgba`).
- Follow-up: tiled reference import for HD (combine with Plan 002).
