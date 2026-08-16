# AI Pixel Construction — Experiment Findings

Date: 2026-08-16 · Baseline: 64×64, scaled to 128×128 and 256×256 · Engine: zero-dependency (Node + browser)

---

## 1. What was built

A minimal experimental prototype that lets a coding LLM construct pixel art
**declaratively**, without outputting pixels one by one.

```
scenes/<name>.json          ← the LLM's artifact (structured representation)
    ↓
engine/pixel-engine.js      ← rasterizer + tools + PNG encoder (zero deps)
    ↓
cli.js                      ← render → inspect → zoom loop (Node)
out/<name>.png / .html      ← exports + interactive preview
prototype.html              ← browser sandbox (paste JSON → render → click-inspect)
```

### The representation (scene document)

```json
{
  "size": 64,
  "palette": { "sky": "#7EC8E3", "roof": "#C25B3A", ... },
  "layers": [ { "id": "roof", "type": "poly",
                "points": [[13,28],[51,28],[32,11]], "color": "roof" }, ... ],
  "pixels": { "25,36": "dark", "30,43": "gold" }
}
```

- **Layers** are named shapes (`fill`, `rect`, `rectout`, `ellipse`, `line`,
  `poly`, `polyout`) painted in order — painter's algorithm.
- **`pixels`** is a sparse override map for fine detail (window crosses, door
  knobs, stars). `null` clears.
- Colors are **palette keys**, never raw hex, so the agent reasons about
  semantic names (`roofDark`, `logDark`) and the palette guarantees consistency.

### The tool API (plan's toolset, realized)

| plan tool | engine function |
|---|---|
| create_canvas() | `create_canvas(size, background)` |
| set_pixel() | `set_pixel(scene, x, y, color)` |
| fill_region() | `fill_region(scene, x, y, w, h, color)` |
| draw_shape() | `draw_shape(scene, type, params)` |
| read_region() | `read_region(scene, x, y, w, h, {scale, mode})` |
| render() | `render(scene)` |
| inspect() | `inspect(scene)` — per-color counts + bounding boxes |
| export() | `export_png(scene, path)` / `encode_png(scene)` |

The whole engine is **~700 lines, zero dependencies**. PNG encoding uses a
hand-rolled fixed-Huffman DEFLATE + greedy LZ77 (RFC 1951 §3.2.6) with a
zlib wrapper and CRC32/ADLER32, so it works identically in Node and browser.

---

## 2. The experiment loop

The agent iterates like this (this is what was actually done):

```
1. WRITE scenes/house.json            (the structured representation)
2. node cli.js scenes/house.json --png out/house.png --html out/house.html
3. READ the ASCII preview + inspect() stats   ← the LLM's "eyes"
4. ZOOM: node cli.js ... --zoom x,y,w,h  (full-res ASCII of a region)
5. EDIT ONLY the affected layer(s)/pixels in the JSON
6. re-run → repeat
7. VISUAL QA: open out/<name>.html in a browser, probe rendered pixels
```

Token economy of one iteration (64×64):
- full-canvas ASCII preview auto-scales to **32×32 chars ≈ 1.1 KB**
- `inspect()` stats: ~400 B (color counts + bounding boxes)
- a full-res zoom (26×21): ~700 B
- Total per render loop: **~2 KB of "vision"**, vs 4,096 pixels if the agent
  had to read every pixel.

`inspect()` bounding boxes are the highest-value signal — they immediately
reveal misalignment (e.g. a window bbox that should be `[22,33,6,6]`).

---

## 3. Experiment 1 — House (geometry, symmetry, outlines, palette, multi-object)

Scene: sky fill, sun, 3-ellipse cloud, ground, chimney (behind roof), roof
triangle + outline, wall + outline, door + outline + knob, two symmetric
windows with frames + cross panes (pixel overrides).

**Design intent**: the roof triangle is drawn AFTER the chimney so the roof
covers the chimney base; windows use layer order + 12 pixel overrides each
for the crosses; the door knob is a single pixel override.

**Verification (all passed, exact pixel probes):**

| probe | result |
|---|---|
| roof apex (32,11) | roofDark (outline tip — intended) |
| roof silhouette row y20 | sky→roof→dark outline→sky, symmetric around x=32 |
| window glass (23,34) | #9BD4F0; frame (22,34) + cross (25,36) dark |
| door outline (28,39)/(35,39) | dark; interior (31,43) door; knob (30,43) gold |
| chimney (42,17) | #8E6B4A; outline (40,16)/(44,16) dark |
| browser render | all 10 palette colors present on canvas; 18/20 probes matched expectations, 2 mismatches were wrong expectations on my side (probing outline columns expecting fill) |

**Notes**: 18 layers + 23 pixel overrides produced a clean 64×64 house.
The engine's `inspect()` counts cross-checked exactly (window glass = 18 px =
2 × (16 − 7 cross pixels)).

---

## 4. Experiment 2 — Campfire (radial composition, layered glow, cross-object)

Scene: night fill, moon + 12 stars (pixels), ground, **glow halo ellipse**
behind a 3-layer flame teardrop (outer/mid/core), two crossed logs, 6 stones,
9 ember sparks (pixels).

**Design intent**: concentric teardrops (poly) create a "gradient" flame
without any blending; the halo reads as firelight; logs drawn after flames so
they sit in front; stones after logs so they overlap log edges.

**Verification (all passed):**

| check | result |
|---|---|
| flame column (32,y) | outer(22) → flame(28) → core(34..43) → flame(46) → outer(49) |
| flame row y40 | halo→outer→flame→core→flame→outer→halo — **perfectly symmetric** around x=32 |
| 9 symmetry probes (L vs R at dx=2/5/8, y=30/38/46) | all equal |
| logs crossed | logDark x16–26, log x38–46 at y54; stones correctly overlap edges |
| browser render | 12/12 object probes matched |

---

## 5. Failures found and fixed (the point of measuring)

1. **PNG encoder emitted raw DEFLATE instead of zlib-wrapped DEFLATE**
   (missing CMF/FLG header + ADLER32 trailer).
   - Symptom: Node's `zlib.inflateSync` → `incorrect header check`; Chromium
     leniently "decoded" it to a **fully transparent 64×64 image** (no crash,
     no error — silent failure).
   - Detection: browser pixel probes returned all-zeros; my own naive deflate
     walker didn't notice because it skips the zlib header entirely.
   - Fix: wrap stored blocks with `0x78 0x01` + append ADLER32. Verified with
     `zlib.inflateSync` + browser decode.
   - **Lesson for the skill**: verify exports with an independent decoder, not
     just your own reader. Silent transparency is worse than a loud crash.

2. **ASCII hand-counting is unreliable for defect detection.**
   Three times a "defect" suspected from reading ASCII rows turned out to be
   a miscount on my side; `get_pixel` probes were always right. → The skill
   should trust `inspect()` stats + targeted pixel probes over eyeballing
   ASCII; use ASCII only for coarse spatial layout.

3. **Probe-coordinate errors on my side** (probing outside an ellipse, probing
   a window cross expecting wall). → Cheap, caught immediately by the legend
   + bbox stats. Not an engine bug.

No engine rasterization defects were found across ~2,700 pixels of probes:
scanline polygon fill (even-odd), ellipse fill, Bresenham lines, layer order,
sparse overrides all behaved exactly as specified on first use.

---

## 5b. Accuracy hardening — full-pixel equivalence + test suite

After the baseline scenes, the whole pipeline's accuracy was locked down:

1. **Browser == Node, pixel-for-pixel (both scenes, 0/4096 diffs).**
   A full-canvas diff initially reported 2,080 "differences" tracing the
   house shape. Investigation showed the *harness* had a sampling bug (canvas
   row index `y*512` instead of `(y*8)*512`), not the engine — with the index
   fixed, all 4,096 pixels match for house and campfire, and the in-page
   engine rasterize SHA-256 equals the Node hash exactly. Lesson: verify the
   verifier before blaming the engine.

2. **tests/test-suite.js — 75 zero-dependency tests, all green.**
   Every primitive is locked against hand-computed exact pixel grids (rect,
   rectout t=1/2, ellipse incl. degenerate rx<1, line incl. steep/reversed,
   poly incl. even-odd bowtie, polyout), plus edge cases (clipping, OOB,
   fractional coords, malformed keys, null overrides), inspection tools
   (read_region scale boundaries 40/80/160, counts mode, legends), PNG
   structure (signature, IHDR fields, per-chunk CRC, IDAT zlib round-trip
   byte-exact, determinism, uniform + high-entropy data), CLI behavior
   (render/png/html/zoom/counts, error exits), and — for every published
   scene — a locked rasterize hash plus pixel probes.

3. **Scene hashes locked.** house, campfire, house128, robot, and
   landscape256 rasterize buffers are pinned by SHA-256 in the suite — any
   engine change that moves a single pixel fails the run. Each scaled scene
   was also re-verified pixel-exact in a real browser (canvas sample hash ==
   Node hash).

4. **Engine defects found and fixed by the suite:**
   - `get_pixel` with out-of-bounds coordinates crashed (negative index →
     `hexOf([undefined…])` throws). Now returns `null`.
   - CLI missing-scene-file crashed with an ENOENT stack trace. Now exits 1
     with `error: cannot read scene file: …`.

5. **Semantics locked by tests (deliberate):** `null` pixel override means
   "no override — layer beneath shows" (not an alpha-0 hole); `rect`
   fractional widths use `ceil(x+w)-1`; polygon scanline rule is half-open
   (top vertex row included); `Math.round` ties round up (degenerate ellipse
   at cx=3.5 lands on x=4).

Run with `node tests/test-suite.js`.

---

## 6. Answers to the research questions (64×64 baseline)

**RQ1 — Can a coding LLM construct a recognizable 64×64 image this way?**
Yes. Both scenes were authored, iterated, and verified in this session with
zero pixel-level output. The house and campfire are immediately
recognizable (subjectively), with correct geometry, symmetry, outlines, and
layering. The declarative layer model turns "image generation" into
"coordinate geometry + palette choices", which coding models are good at.

**RQ2 — Which representation is easiest for the LLM to maintain?**
So far: ordered shape layers + palette keys + sparse pixel overrides. The
agent reasons about ~15–20 objects instead of 4,096 pixels. Key design
choices that paid off:
- **paint order as the layering mechanism** (chimney behind roof, logs in
  front of flames) — expressed as data, not compositing logic;
- **palette-key colors** — `inspect()` counts group by name, and mistakes
  (e.g. reusing a name) become visible in stats;
- **pixel overrides only for sub-shape detail** (crosses, knobs, stars).

**RQ3 — Does hierarchical construction improve consistency?**
Evidence: yes, strongly. The flame is 3 nested shapes whose edges line up
exactly (verified row y40, 9 symmetry probes) because each layer is a small
delta on the previous. The roof/chimney interplay was correct on the first
render purely from layer order. Symmetry was achieved by *declaring* it
(shapes centered on x=32) rather than by drawing it.

**RQ4 — Does iterative rendering + localized correction improve quality?**
This session's iteration was mostly *verification* (both scenes passed
nearly first try) rather than repair. The loop did catch and fix the two real
bugs — but both were **engine bugs**, not scene bugs. Open question: how
much repair does a *weak* model need? That's the next experiment (below).

**RQ5 — Does the representation scale to larger canvases?**
Yes — proven at 128×128 and 256×256. Two scaled scenes were authored and
verified in this phase:

- `scenes/house128.json` (128×128, 55 layers, 1 pixel override) — a faithful
  2× upscale of the 64×64 house plus additions (smoke, path, fences, roof
  tile lines, plank lines, grass, and window crosses promoted from pixel
  overrides to line layers).
- `scenes/landscape256.json` (256×256, 111 layers, 13 pixel overrides) — a
  new multi-element landscape: 3-band sky, sun with 8 rays, 3 clouds, 2
  birds, 3 mountains with snow caps, pond with shine, 3 trees, a cabin with
  chimney smoke, path, fences, flowers, and scattered grass.
- `scenes/robot.json` (128×128, 28 layers, 3 pixel overrides) — a symmetric
  character (mirrored about x=64).

All three were verified **pixel-exact in a real browser** (canvas sample
SHA-256 == Node rasterize hash, 0 diffs) and are hash-locked in the suite.
Cost note: the ASCII preview auto-scales to ≤32×32 chars regardless of
canvas size, so per-iteration "vision" cost stays ~1–2 KB even at 256×256 —
but more layers means more edits per fix cycle, and region zooms become the
workhorse tool at higher resolution.

**RQ6 — Where is the bottleneck as resolution grows?**
Not the engine (rasterize + PNG are linear and fast at these sizes), and not
the ASCII preview (auto-scaled). The bottleneck is **scene authoring
discipline**: more layers to keep consistent, and more places for probe
coordinates to land on the wrong element. The hash lock + probe tests turn
"did I change a pixel" into a one-command answer.

**RQ7 — Ceiling without a dedicated image model?**
Not reached at 256×256. The declarative model keeps working; the practical
ceiling will come from scene complexity (layers × overlaps), not resolution
per se. The next deliberate test is a **flawed-scene repair loop** (§7-2).

---

## 7. Immediate next steps

1. **Stress the iteration loop**: deliberately write a flawed scene (bad
   alignment, color collision, broken symmetry) and measure how many
   render→inspect→fix cycles a model needs to repair it — the
   hypothesis-critical experiment.
2. **Probe discipline**: every published scene's probes are locked in the
   suite; new scenes should lock probes *and* hashes together (several
   probes in this phase initially landed on the wrong element — the hash
   lock is the ground truth, probes are documentation of intent).
3. **Wrap the tools as an installable skill** (`pixel-art-generation`
   SKILL.md) teaching: composition-before-detail, silhouette-first, palette
   discipline, layer-order thinking, inspect-stats-first debugging,
   localized edits, export verification with an independent decoder.
4. **Optional**: expose the tool API as MCP tools so a general agent can
   drive the loop without writing scene JSON by hand.

---

## Appendix — artifacts

```
engine/pixel-engine.js    engine + tools (~700 lines, zero deps)
tests/test-suite.js       75-test accuracy suite (node tests/test-suite.js)
cli.js                    render/inspect/zoom/export driver
prototype.html            browser sandbox (JSON → canvas → PNG)
scenes/house.json         64×64 house (18 layers, 23 overrides)
scenes/campfire.json      64×64 campfire (15 layers, 23 overrides)
scenes/house128.json      128×128 house 2× upscale + additions (55 layers, 1 override)
scenes/robot.json         128×128 robot character (28 layers, 3 overrides)
scenes/landscape256.json  256×256 landscape (111 layers, 13 overrides)
out/house.png|.html        exports + previews
out/campfire.png|.html
out/house128.png|.html
out/robot.png|.html
out/landscape256.png|.html
out/house-preview.png      browser screenshot (512×512)
out/campfire-preview.png
```