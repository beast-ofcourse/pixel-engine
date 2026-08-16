---
name: pixel-art-animation
description: "Create pixel-art animations with pixel-engine: author frame sequences by duplicating and modifying scene documents, diff frames exactly, validate motion regions, export spritesheets, preview playback. Use when animating pixel art, building frame-by-frame motion (bounces, walk cycles, any multi-frame scene), diffing frames, validating change regions, or exporting spritesheets. Builds on pixel-art-generation: each frame is a static scene document."
---

# Pixel Art Animation with pixel-engine

Animate pixel art by **duplicating a scene document and modifying it locally** —
the diff between consecutive frames *is* the motion. No interpolation, no
tweening, no second pixel system: every frame is a complete scene document and
all pixel work delegates to the verified engine. Start from the
`pixel-art-generation` skill for the static-scene rules this builds on.

## The animation document

```json
{
  "width": 16, "height": 16, "fps": 8,
  "palette": { "bg": "#1A1A2E", "ball": "#E94560" },
  "keyframes": { "frame-0": true },
  "frames": [
    { "id": "frame-0", "scene": { "size": 16, "palette": { "bg": "#1A1A2E", "ball": "#E94560" },
        "layers": [ { "id": "bg", "type": "fill", "color": "bg" },
                    { "id": "ball", "type": "ellipse", "cx": 8, "cy": 5, "rx": 3, "ry": 3, "color": "ball" } ],
        "pixels": {} } },
    { "id": "frame-1", "scene": { "size": 16, "palette": { "bg": "#1A1A2E", "ball": "#E94560" },
        "layers": [ { "id": "bg", "type": "fill", "color": "bg" },
                    { "id": "ball", "type": "ellipse", "cx": 8, "cy": 7, "rx": 3, "ry": 3, "color": "ball" } ],
        "pixels": {} } }
  ]
}
```

Rules:

- **`width === height`** — frames are square like scenes (the engine rasterizes square canvases only).
- **Each frame is an ordinary scene document** — same palette/layers/pixels rules as static scenes.
- **Authoring model: duplicate + modify.** Copy a frame, change only what moves (a `cy` value, a region). Frames 1–3 of `animations/ball.json` differ from frame-0 by exactly two numbers.
- **Frame ids are `frame-N`** — the engine allocates them collision-free across delete/add/duplicate; never hand-number them.
- **`fps` is a positive integer, global** to the animation (default 8), separate from the frame count.
- **Keyframes are markers, not behavior** — stable reference points for the agent (frame-0 of ball.json).

## Workflow

1. **Author the base frame** — the pixel-art-generation workflow: palette → layers back-to-front → overrides. Done when the static scene renders correctly.
2. **Duplicate + modify** — `duplicate_frame`, then move/fill/set only the moving parts (`move_frame_region`, `set_frame_pixel`, `fill_frame_region`). Done when each frame differs from the previous only where motion happens.
3. **Diff exactly** — `diff_frames` reports changed/unchanged counts, percentage, bounding box, and per-pixel old/new values. Done when the diff matches your intent (e.g. a bounce column, not the whole canvas).
4. **Validate the motion** — `validate_change` against the allowed region: PASS/FAIL with the exact unexpected-change list. Done when PASS with 0 unexpected.
5. **Preview** — `animation_to_html` → `out/<name>.html`: play/pause/restart/step, fps control, keyframe badge, click-to-inspect. Done when playback loops correctly in a browser.
6. **Export** — `encode_spritesheet` (export-only PNG; never the internal representation). Done when the sheet decodes with the expected dimensions.
7. **Verify** — lock per-frame hashes + diffs in `tests/test-suite.js`; confirm browser == Node pixel-for-pixel.

## Motion ops

- `move_frame_region(anim, id, x, y, w, h, dx, dy)` → `{ moved }` — moves opaque pixels of a region; source pixels become `null` overrides (layers beneath show). Clears all sources before writing destinations, so overlapping moves are safe.
- `copy_frame_region(anim, srcId, dstId, x, y, w, h, dx, dy)` → `{ copied }` — copies resolved pixels onto another frame (dstId defaults to srcId).
- `set_frame_pixel` / `get_frame_pixel` / `clear_frame_pixel` / `fill_frame_region` — delegate to the engine's scene ops.
- `set_keyframe(anim, id, value?)` / `is_keyframe` — markers only.

## Lessons

- **The diff is the motion**: keep consecutive frames identical except the moving pixels; `validate_change` catches unintended drift (a too-narrow region on ball.json reports 41 unexpected changes).
- **`move_frame_region`/`clear_frame_pixel` erase by revealing the layers beneath** — to erase over a filled background, fill the region with the background color instead.
- **Palette consistency across frames**: `palette_drift` reports frame scenes whose palette keys are missing from `anim.palette`; frame scenes are seeded from `anim.palette` at every access, so palette-set-after-add works.
- **Spritesheets are export-only**: frames stay complete scenes; deltas are computed on demand (`diff_frames`), never stored.
- **Frames are square**; a non-square animation is rejected at creation and on load.

## CLI

```text
node cli.js anim <anim.json> [--diff a,b] [--validate a,b,x,y,w,h]
                             [--ascii frameId] [--sheet out.png] [--html out.html] [--fps n]
```

- `--validate` prints PASS/FAIL and **exits 1 on FAIL** (CI-friendly).
- `--fps` requires a positive integer; partial/zero/negative/non-numeric values are rejected.

## Verification

- `node tests/test-suite.js` — 117 tests incl. locked per-frame hashes, exact diffs, spritesheet bytes.
- Browser: `out/<name>.html` — play/pause/step/restart verified; click-to-inspect reads the rendered canvas (getImageData), not the engine.

## Reference

Full API tables (animation functions, CLI, document schema): `references/api.md`.