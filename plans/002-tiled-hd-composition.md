# Plan 002: Tiled HD Composition (Scale to 1280×720)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 92dc059..HEAD -- engine/pixel-engine.js tests/test-suite.js cli.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 001 (token-efficient encoding helps but not required — can run in parallel; if 001 lands first, tiled scenes should use compact encoding for tile payloads)
- **Category**: tech-debt
- **Planned at**: commit `92dc059`, 2026-05-13
- **Issue**: —

## Why this matters

The engine today renders a single square scene (`size` = 16/32/64/128/256). A 1280×720 HD canvas is 900k pixels vs 4k for 64×64 (225×). Asking an LLM to emit a single HD scene in one context causes forgetting, mistakes, and token blow-up. Tiled composition lets the LLM work on one 64×64 tile at a time while the engine stitches a coherent HD image — the only path to HD that respects LLM context limits.

## Current state

Relevant files:
- `engine/pixel-engine.js:80-92` — `create_canvas(size, background)` creates a single square scene; `rasterize(scene)` assumes `scene.size` is square and returns `size*size*4` buffer
- `engine/pixel-engine.js:744-806` — `rasterize` painter's algorithm (layers → buffer → pixels), single buffer
- `cli.js` — renders one scene to PNG/HTML; no tiling concept
- `scenes/` — all scenes are square; no tiled asset exists

Excerpt — current square assumption (`engine/pixel-engine.js:744`):
```js
function rasterize(scene) {
  const size = scene.size || 64;
  const buf = new Uint8Array(size * size * 4);
```

Repo conventions:
- Scene documents are plain JSON; engine is zero-dep UMD; tests use `PE.rasterize(scene)` and `hash256`
- Error handling: throw `Error('function: reason')`

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node tests/test-suite.js` | 257 passed → 260+ passed |
| Manual stitch | `node -e "const PE=require('./engine/pixel-engine.js'); ..."` | prints tiled PNG dimensions |
| CLI | `node cli.js scenes/tiled.json --png out/tiled.png` (after) | writes PNG |

## Scope

**In scope**:
- `engine/pixel-engine.js` (add `create_tiled_canvas`, `rasterize_tiled`, `encode_png_tiled` etc. OR extend `rasterize` to handle tiled scenes — choose one and document)
- `engine/tiling.js` (new, optional — if you create a separate module, re-export via PE)
- `tests/test-suite.js` (new tiled tests)
- `skills/pixel-engine/references/api.md`, `README.md` (tiled API rows)
- `cli.js` (optional: add `--tiled` flag — if you add it, keep it minimal)

**Out of scope**:
- `engine/animation.js` — animation tiling is a separate follow-up; do not touch
- `mcp/` — tiled MCP tools are follow-up
- Any change to existing square-scene rasterization — must remain pixel-identical (hash-locked)

## Git workflow

- Branch: `advisor/002-tiled-hd`
- Commit per step; message style: `feat: tiled HD composition`
- Do NOT push or open PR unless instructed

## Steps

### Step 1: Design the tiled scene document

Choose and document one schema (do not invent a second):

**Recommended schema** — `tiled scene`:
```json
{
  "tileSize": 64,
  "width": 1280,
  "height": 720,
  "tiles": {
    "0,0": { "size": 64, "palette": {...}, "layers": [...], "pixels": {...} },
    "1,0": { ... }
  },
  "palette": { "shared": "#hex" } // optional global palette fallback
}
```

- `tileSize` is the square tile edge (ladder size, e.g. 64)
- `width`/`height` are HD dimensions (must be multiples of `tileSize` for v1; if not, clamp last tile)
- `tiles` is a map `"tx,ty"` → scene document for that tile (each tile is a normal scene)
- Global `palette` is optional; tile palettes may inherit

**Verify**: Write the schema down in a comment at top of `engine/pixel-engine.js` tiled section and in `api.md` draft — no code yet, just the schema.

### Step 2: Implement tiled rasterization

Add to `engine/pixel-engine.js`:

- `create_tiled_canvas(width, height, tileSize, background)` → tiled scene skeleton (empty tiles map)
- `rasterize_tiled(tiledScene)` → `Uint8Array` of `width*height*4` by rasterizing each tile and blitting into the HD buffer (nearest tile lookup, handle missing tiles as transparent)
- `encode_png_tiled(tiledScene)` → PNG bytes via existing `encode_png_buffer` on the HD buffer (use `encode_png_buffer(rgba, width, height)` — you already have it)
- `get_tile(tiledScene, tx, ty)` / `set_tile(tiledScene, tx, ty, scene)` helpers

Each tile rasterizes via existing `PE.rasterize(tileScene)` — reuse, do not duplicate raster logic.

Handle edge cases:
- Missing tile → transparent
- `width`/`height` not multiple of `tileSize` → last row/col tiles are clipped (blit only the visible `w*h` subrect)
- `tileSize` must be a ladder size; otherwise throw `create_tiled_canvas: tileSize must be one of ...`

**Verify**: `node -e "const PE=require('./engine/pixel-engine.js'); const t=PE.create_tiled_canvas(128,64,64); const tile=PE.create_canvas(64,'#ff0000'); PE.fill_region(tile,0,0,64,64,'#ff0000'); PE.set_tile(t,0,0,tile); const buf=PE.rasterize_tiled(t); console.log(buf.length, buf.length===128*64*4)"` → `true`.

### Step 3: Add hash-locked tiled tests

In `tests/test-suite.js`:

- `test('tiled: 128x64 composes two 64x64 tiles pixel-identical', ...)` — left red, right blue, check center pixels
- `test('tiled: 1280x720 empty is transparent', ...)` — or 128x128 if you want fast test (avoid 900k in CI — use 128x64 for speed, note HD is same logic)
- `test('tiled: encode_png_tiled round-trip', ...)` — encode then `PE.decode_png` and compare buffers
- `test('tiled: missing tile is transparent, clipped edge', ...)`

**Verify**: `node tests/test-suite.js` → 261+ passed, 0 failed.

### Step 4: CLI and docs

- Optionally add `cli.js` flag: `node cli.js --tiled tiled.json --png out.png` (if you add it, keep it behind `if (tiledScene.tiles)` check)
- Update `skills/pixel-engine/references/api.md` — add `create_tiled_canvas`, `rasterize_tiled`, `encode_png_tiled` rows
- Update `README.md` — one paragraph: "HD via tiling: compose 1280×720 from 64×64 tiles — the LLM generates one tile at a time"

**Verify**: `grep -n "rasterize_tiled" skills/pixel-engine/references/api.md` → found.

## Test plan

- New tests: tiled composition correctness (2-tile 128×64 is fast, full HD 1280×720 is same code path but test with small proxy to keep CI <2s), clipping, missing tile, PNG round-trip, determinism
- Model after: `test('diff_scenes: identical scenes ...')` — same raster-compare pattern
- Verification: `node tests/test-suite.js` all pass; manual HD buffer length check above

## Done criteria

- [ ] `node tests/test-suite.js` exits 0, shows 261+ passed, includes `tiled:` tests
- [ ] `node -e "const PE=require('./engine/pixel-engine.js'); const t=PE.create_tiled_canvas(1280,720,64); console.log(t.width===1280&&t.height===720)"` prints `true`
- [ ] `grep -rn "rasterize_tiled" skills/pixel-engine/references/api.md` returns 1+ matches
- [ ] Existing square-scene hash-locked tests still pass (no regression)
- [ ] No files outside in-scope list modified

## STOP conditions

- If `rasterize_tiled` changes the output of existing square `rasterize(scene)` for any hash-locked scene → STOP, you broke the painter's algorithm; revert and isolate tiled path.
- If tiled PNG encode is not round-trip identical via `decode_png` → STOP, the blit math is wrong (check tile offset calculation).
- If `tileSize` not on ladder but you chose to allow it → STOP, enforce ladder sizes per spec; file an ADR if you believe non-ladder tiles are needed.

## Maintenance notes

- Future `analyze_values` / `check_hue_shift` should be extended to tiled scenes (iterate tiles) — note as follow-up.
- The tile map key `"tx,ty"` must remain stable; if you later add `get_tile` convenience for pixel coords, keep the string key as the canonical form.
- Reviewers: scrutinize the blit offset math (`dstY*width + dstX`) — off-by-one here corrupts the whole HD image; the tiled tests must assert center pixels of each tile, not just buffer length.
