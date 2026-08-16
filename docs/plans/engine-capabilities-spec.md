# Engine Capabilities — Implementation Spec

Scope: the full capability backlog discussed for `pixel-engine` (37 functions today: 15 core + 22 animation). Every item below follows the repo's existing conventions:

- **Zero-dependency core** — `engine/pixel-engine.js` + `engine/animation.js` stay dependency-free (Node built-ins only). Anything needing a third-party dep (MCP SDK) lives in a separate package.
- **UMD attach** — new functions attach to the PE object, documented in `references/api.md` and the pixel-engine skill.
- **Document model** — scene `{ size, palette, layers, pixels }`; animation `{ width, height, fps, palette, keyframes, frames }`. Buffer-level ops (flood fill, region ops) write pixel overrides and erase by revealing layers beneath — the documented limitation of `move_frame_region` applies to all of them.
- **Test discipline** — every function lands with tests in `tests/test-suite.js`; new assets get hash-locked; the suite (127 today) must stay green.
- **Release cadence** — each phase ships as a minor npm release (no breaking API changes planned).

---

## Phase 1 — Primitives & geometry (pure additions, no dependencies)

### 1.1 `mirror_region(scene, x, y, w, h, axis)`

- **Purpose**: symmetry for creatures/characters — build one side, mirror the other.
- **API**: `axis` = `'h'` (mirror left↔right across the region's vertical centerline) | `'v'` (top↔bottom). Mutates the region in place on the resolved buffer, writing pixel overrides.
- **Behavior**: read the region, write mirrored pixels as overrides. Odd-width regions keep the center column.
- **Edge cases**: out-of-bounds region → clamp (consistent with `fill_region`); empty/zero-size → no-op; mirroring onto itself is idempotent on the second call.
- **Tests**: 4×4 region mirrored h/v, odd width, clipping, determinism (rasterize twice → identical bytes).
- **Effort**: S.

### 1.2 `replace_color(scene, from, to)`

- **Purpose**: recolor by palette key or hex — document-level, survives re-render (unlike a buffer op).
- **API**: `from`/`to` = palette key or hex. If `from` is a hex, remap every key whose hex equals it. Rewrites layer colors and pixel overrides; if `to` is a hex not in the palette, add it as a key.
- **Edge cases**: `from` matches nothing → no-op; `from === to` → no-op; unknown `to` key → error.
- **Tests**: key→key, hex→key, key→new-hex (palette grows), no-op cases.
- **Effort**: S.

### 1.3 `flood_fill(scene, x, y, color, tolerance?)`

- **Purpose**: enclosed-region touch-ups (fill a bounded area without knowing its polygon).
- **API**: seed point, target color key/hex, optional `tolerance` (0 = exact match, default). Buffer-level: writes pixel overrides.
- **Edge cases**: seed out of bounds → no-op; seed already the fill color → no-op; tolerance clamps to [0, 255]; fill over a filled background behaves like the documented erase-by-reveal (fill with the background color to erase).
- **Tests**: enclosed region on transparent canvas, region on filled background, tolerance matching, no-op cases.
- **Effort**: S.

### 1.4 `curve` layer type

- **Purpose**: smooth organic curves — the gap that forced polygon workarounds.
- **API**: new layer type `{ "type": "curve", "points": [[x,y],...], "color": key, "closed": false }`. Rasterizer samples the curve (Catmull-Rom through the points) with the same pixel-center test as `ellipse`.
- **Edge cases**: <2 points → paints nothing (like `poly`); closed curve joins the last point to the first; out-of-bounds clipped.
- **Tests**: open curve through 3–5 points, closed loop, degenerate inputs, hash-lock one curve asset.
- **Effort**: M.

### 1.5 `draw_cluster(scene, x, y, pattern, color)`

- **Purpose**: reusable pixel patterns (scales, feathers, leaves, stars) without per-pixel calls.
- **API**: `pattern` = array of `[dx, dy]` offsets (or a small string grid, e.g. `["X.X", ".X."]`). Writes pixel overrides.
- **Edge cases**: out-of-bounds offsets clipped; empty pattern → no-op.
- **Tests**: offset pattern, string-grid pattern, clipping.
- **Effort**: S.

### 1.6 `move_region(scene, x, y, w, h, dx, dy)` / `copy_region(scene, x, y, w, h, dx, dy)`

- **Purpose**: scene-level parity with the frame-level region ops.
- **API**: identical semantics to `move_frame_region` / `copy_frame_region` (buffer-level, override writes, erase-by-reveal; overlapping move clears sources before writing destinations).
- **Edge cases**: destination out of bounds → clipped; overlapping move (the frame version's tested behavior).
- **Tests**: mirror the frame-region tests (move diff, copy across, overlap ordering).
- **Effort**: S.

### 1.7 `extract_outline(scene, region?)`

- **Purpose**: boundary pixels of the painted silhouette — feeds the critic's silhouette checks and outline painting.
- **API**: returns `[{x, y}, ...]` — 4-connected boundary pixels (painted pixel adjacent to transparent/out-of-region).
- **Edge cases**: empty region → `[]`; fully painted region → `[]` (no boundary inside).
- **Tests**: rectangle boundary, poly boundary, region-restricted boundary.
- **Effort**: S.

### 1.8 `poly_union(a, b)` / `poly_subtract(a, b)`

- **Purpose**: build complex silhouettes as single contours (boolean ops on point arrays).
- **API**: both take two point arrays, return a point array (or `null` for empty result). General-polygon clipping (Weiler–Atherton); convex fast-path (Sutherland–Hodgman).
- **Edge cases**: disjoint polygons (union returns both, subtract returns the first), identical polygons, degenerate (collinear) inputs.
- **Tests**: convex union/subtract, concave cases, disjoint, identical, degenerate.
- **Effort**: M–L (computational geometry — the fiddliest item in this phase).

---

## Phase 2 — Import / export

### 2.1 `encode_apng(anim, opts)` / `export_apng(anim, path, opts)`

- **Purpose**: animations as real animated files (currently HTML + spritesheet only).
- **API**: reuses the existing PNG encoder; adds `acTL` after IHDR, `fcTL` before each frame, `fdAT` for frames 2+. `opts`: `{ fps }` (defaults to `anim.fps`), `{ loop }` (default 0 = infinite).
- **Edge cases**: empty animation → error (like `encode_spritesheet`); single frame → valid APNG with one frame.
- **Tests**: chunk structure (acTL/fcTL/fdAT present, correct counts), frame extraction round-trip (decode our own APNG back to per-frame buffers), determinism.
- **Effort**: M.

### 2.2 `encode_gif(anim, opts)` / `export_gif(anim, path, opts)`

- **Purpose**: GIF89a export — the universal pixel-art animation format.
- **API**: hand-rolled LZW (GIF's LZW is simpler than DEFLATE; ~150 lines). Palette ≤ 256 colors (engine palettes are ≤ 12 — fine). `opts`: `{ fps, loop }`.
- **Edge cases**: palette > 256 → quantize (see 2.4) or error; single frame; transparency (GIF has 1-bit transparency via GCE).
- **Tests**: header/LSD/GCE/image-descriptor/trailer structure, pixel round-trip via a minimal GIF reader written for the tests, determinism.
- **Effort**: M.

### 2.3 `decode_png(bytes)` → `{ width, height, rgba }`

- **Purpose**: PNG import — unlocks reference-driven evaluation (Phase 5) and scene-from-image workflows.
- **API**: Node backend uses built-in `zlib.inflateSync` (zero-dep). Browser backend: canvas `drawImage` + `getImageData` when a DOM exists; pure-JS inflate (dynamic Huffman, ~300–400 lines) for DOM-less browsers — decide during implementation whether the pure-JS inflate is in scope for v1 (Node + canvas first).
- **Behavior**: filter reconstruction for all 5 filter types; support 8-bit RGB/RGBA/palette; reject other bit depths with a clear error (expand 1/2/4-bit later if needed).
- **Edge cases**: truncated/corrupt input → clean error, no crash; non-PNG signature → error.
- **Tests**: round-trip (encode → decode → identical buffer) across the hash-locked assets; corrupt-input errors; filter-type coverage.
- **Effort**: M–L (inflate is the real work).

### 2.4 `quantize_palette(rgba, maxColors)` → `{ palette, indices }`

- **Purpose**: extract a palette from imported art (median-cut or popularity algorithm).
- **API**: RGBA buffer → palette (≤ `maxColors`, default 16) + per-pixel index map.
- **Edge cases**: fewer unique colors than `maxColors` → exact palette; fully transparent input → empty palette.
- **Tests**: known-color input produces the exact palette; count cap respected; determinism.
- **Effort**: M.

### 2.5 `validate_scene(scene)` → `{ valid, errors[] }`

- **Purpose**: scene-document integrity — the scene-side mirror of `normalize_animation`.
- **API**: checks `size` (square, ladder sizes), palette (keys valid, 5–12 keys), layers (known types, valid params, in-bounds), pixels (valid keys, in-bounds).
- **Edge cases**: every invalid case returns the specific error, not a generic one.
- **Tests**: valid scenes pass; each invalid case fails with the right error message.
- **Effort**: S.

---

## Phase 3 — Agent-loop tools (better "eyes")

### 3.1 `diff_scenes(a, b)`

- **Purpose**: compare two scene documents — the co-evolution loop's iteration comparison.
- **API**: same shape as `diff_frames`: `{ changed, unchanged, pct, bbox, changes[] }` on resolved buffers.
- **Edge cases**: different sizes → error; identical scenes → 0 changed, null bbox.
- **Tests**: mirror the diff_frames tests.
- **Effort**: S (reuses the frame diff logic).

### 3.2 `replace_color_region(scene, x, y, w, h, fromHex, toHex)`

- **Purpose**: recolor within a region (buffer-level, writes overrides) — complements the document-level `replace_color`.
- **Edge cases**: region empty → no-op; `from === to` → no-op.
- **Tests**: region-limited recolor, clipping.
- **Effort**: S.

### 3.3 `measure_distance(x1, y1, x2, y2)` + region area via `inspect()`

- **Purpose**: provable proportion checks for the critic (the PROPORTION category is currently eyeballed).
- **API**: `measure_distance` returns Euclidean distance; area/counts already exist in `inspect()`.
- **Tests**: known distances.
- **Effort**: S.

### 3.4 `check_symmetry(scene, axis, region?)` → `{ symmetric, diffCount, diffPixels[] }`

- **Purpose**: critic FACT — verify left/right (or top/bottom) consistency.
- **API**: compares the region against its mirror on the resolved buffer.
- **Edge cases**: empty region → symmetric (vacuously); odd widths (center column ignored).
- **Tests**: symmetric asset passes, asymmetric fails with the diff list.
- **Effort**: S.

### 3.5 `dither_region(scene, x, y, w, h, opts?)`

- **Purpose**: gradients at low resolution (ordered/Bayer dithering between two colors).
- **API**: `opts`: `{ from, to, pattern }` (default 4×4 Bayer). Writes overrides.
- **Edge cases**: region empty → no-op; `from === to` → no-op.
- **Tests**: known Bayer pattern output, determinism.
- **Effort**: S–M.

---

## Phase 4 — Integration

### 4.1 MCP server (separate package: `pixel-engine-mcp`)

- **Purpose**: expose the engine as MCP tools so any agent calls it directly instead of via CLI.
- **API**: wraps the 37+ functions as tools (`render`, `inspect`, `read_region`, `diff_frames`, `validate_change`, `encode_png`, …). One dependency: `@modelcontextprotocol/sdk` — the zero-dep core stays untouched; the MCP package is a thin adapter.
- **Tests**: protocol smoke tests (tool list, one call per tool class).
- **Effort**: M.

### 4.2 CI — `.github/workflows/test.yml`

- **Purpose**: the README admits "no CI"; run the 127-test suite on push/PR.
- **API**: GitHub Actions, Node 18/20/22 (or 24), `npm test`.
- **Tests**: the workflow itself is verified by a green run.
- **Effort**: S.

### 4.3 Release automation

- **Purpose**: script the manual release we just did (version bump → test → npm publish → tag → gh release).
- **API**: `scripts/release.js` (or a workflow) taking the version bump type; release notes assembled from the git log since the last tag.
- **Tests**: dry-run mode.
- **Effort**: S–M.

---

## Phase 5 — Taste layer (depends on Phase 2 import)

### 5.1 `compare_scene_to_reference(scene, refRgba, opts)` → metrics

- **Purpose**: reference-driven evaluation — the taste-layer machinery discussed with the user.
- **API**: metrics: silhouette IoU (painted-vs-transparent overlap), palette distance (per-key nearest-hex), value-histogram distance. `opts`: `{ region }`.
- **Edge cases**: size mismatch → error or scale option (decide: error first).
- **Tests**: identical scene vs itself → perfect scores; known-different scenes → expected deltas.
- **Effort**: M.

### 5.2 Craft checks as engine tools

- **Purpose**: automate what the critic currently reads by hand.
- **API**: `analyze_values(scene)` → value steps per material family (count distinct palette keys per family); `check_hue_shift(palette)` → per-family shift verdicts (shadow shifted toward blue/purple, highlight toward yellow — the craft rules from `docs/experiments/craft-rules.md`).
- **Edge cases**: single-key families (no shift possible) → PASS with note.
- **Tests**: the craft palette passes; the old flat palette fails with the expected verdicts.
- **Effort**: S–M.

---

## Skill integration (with each phase)

- **Phase 1** → builder skill: `mirror_region` (symmetry construction), `curve` (organic forms), `replace_color` (recolor), `draw_cluster` (patterns).
- **Phase 3** → critic skill: `check_symmetry`, `measure_distance`, `diff_scenes` as provable FACT checks; `dither_region` in the builder.
- **Phase 5** → critic skill: reference comparison + craft checks as the craft pass's provable core.
- `references/api.md` and the pixel-engine skill's API table update with every new function.

## Release plan

| Phase | Version | Contents |
|---|---|---|
| 1 | 1.3.0 | Primitives & geometry (8 items) |
| 2 | 1.4.0 | Import/export (5 items) |
| 3 | 1.5.0 | Agent-loop tools (5 items) |
| 4 | 1.6.0 | MCP server, CI, release automation |
| 5 | 1.7.0 | Taste layer (2 items) |

Each release: suite green (127 + new tests), hash-locks for new assets, `references/api.md` + skills updated, npm publish + tag + gh release.

## Open decisions (flag before implementation)

1. **Pure-JS inflate scope** (2.3): Node zlib + browser canvas first, or full pure-JS inflate in v1? (Effort difference: ~1 day.)
2. **`poly_subtract` algorithm** (1.8): Weiler–Atherton for general polygons vs convex-only Sutherland–Hodgman first?
3. **GIF transparency** (2.2): 1-bit transparency via GCE, or opaque-only v1?
4. **MCP package location** (4.1): in-repo `mcp/` subpackage vs separate repo?
5. **`compare_scene_to_reference` size mismatch** (5.1): error vs auto-scale?