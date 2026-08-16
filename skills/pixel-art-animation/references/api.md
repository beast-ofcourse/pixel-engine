# pixel-engine API reference (animations)

Verified against `engine/animation.js` (zero dependencies, UMD: `require('./engine/animation.js')` in Node, `window.PixelAnimation` in the browser). The engine's scene functions remain available for single-frame work.

## Animation document

```json
{
  "width": 16, "height": 16, "fps": 8,
  "palette": { "key": "#RRGGBB" },
  "keyframes": { "frame-0": true },
  "frames": [
    { "id": "frame-0", "scene": { "size": 16, "palette": {}, "layers": [], "pixels": {} } }
  ]
}
```

- `width === height` (square) — enforced at creation and on load.
- `fps`: positive integer, global (default 8).
- `keyframes`: map frameId → true (markers only).
- `frames`: each `{ id, scene }`; scene is a standard scene document. Missing `scene.palette` is seeded from `anim.palette` at every access.

## Animation functions

| function | purpose |
|---|---|
| `create_animation(w, h, opts)` | new animation; throws if `w !== h`; `opts { fps, background }` |
| `add_frame(anim, scene?)` | append a frame; id `frame-N` via collision-free allocator |
| `duplicate_frame(anim, frameId)` | deep copy (frame + keyframe flag); returns new id |
| `delete_frame(anim, frameId)` | remove; returns bool |
| `frame_ids(anim)` | ids in order |
| `resolve_frame(anim, frameId)` | RGBA buffer for a frame |
| `set_frame_pixel(anim, frameId, x, y, color)` | sparse override on the frame scene |
| `get_frame_pixel(anim, frameId, x, y)` | resolved hex or `null` |
| `clear_frame_pixel(anim, frameId, x, y)` | remove override (layer beneath shows) |
| `fill_frame_region(anim, frameId, x, y, w, h, color)` | rect layer on the frame scene |
| `move_frame_region(anim, frameId, x, y, w, h, dx, dy)` | `{ moved }`; clears all source pixels before writing destinations; sources become `null` overrides |
| `copy_frame_region(anim, srcId, dstId, x, y, w, h, dx, dy)` | `{ copied }`; dstId defaults to srcId |
| `set_keyframe(anim, frameId, value?)` | mark/unmark (markers only) |
| `is_keyframe(anim, frameId)` | bool |
| `diff_frames(anim, aId, bId)` | `{ changed_pixels, unchanged_pixels, change_percentage, bounding_box, changes[] }`; `changes` = `[{ x, y, from, to }]` |
| `validate_change(anim, aId, bId, allowed_region)` | `{ pass, total_changes, unexpected_changes, unexpected[] }`; allowed region `[x, y, w, h]` |
| `frame_palette(anim, frameId)` | `{ total, colors }` used by the frame scene |
| `palette_drift(anim)` | frames whose palette keys are missing from `anim.palette` |
| `encode_spritesheet(anim, opts)` | PNG bytes; `opts { columns }`; throws on empty animation / invalid columns |
| `export_spritesheet(anim, path, opts)` | write PNG file (Node) |
| `animation_to_html(anim, opts)` | interactive preview; `opts { scale, title, path }` — play/pause/restart/step, fps control, keyframe badge, frame download, click-to-inspect via `ctx.getImageData(x*scale, y*scale, 1, 1)` |

## CLI

```text
node cli.js anim <anim.json> [--diff a,b] [--validate a,b,x,y,w,h]
                             [--ascii frameId] [--sheet out.png] [--html out.html] [--fps n]
```

- Prints animation summary: dimensions, fps, frame ids (+keyframe markers), `palette_drift`.
- `--diff` prints per-frame change counts, percentage, bounding box.
- `--validate` prints PASS/FAIL + unexpected changes; **exits 1 on FAIL**.
- `--ascii` prints the auto-scaled ASCII preview for one frame.
- `--fps` overrides playback fps; must be a positive integer (partial/zero/negative/non-numeric rejected).
- Errors exit 1 with `error: …`.

## Verification

- `node tests/test-suite.js` — 117 tests incl. locked per-frame hashes (`ball.json` frames), exact diffs (30/11.72% and 50/19.53%), spritesheet byte-hash (out/ball-sheet.png, 328 B).
- Browser == Node: canvas sampling in the HTML preview must match Node `resolve_frame` probes pixel-for-pixel.