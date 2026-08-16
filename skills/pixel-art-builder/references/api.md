# pixel-engine API reference

Verified against `engine/pixel-engine.js` and `engine/animation.js` in this repo. Never call engine functions from memory — check this table first.

## Scene document

A scene is plain JSON:

```json
{
  "size": 64,
  "palette": { "sky": "#7EC8E3", "roof": "#C25B3A" },
  "layers": [
    { "id": "sky", "type": "fill", "color": "sky" },
    { "id": "roof", "type": "poly", "points": [[13,28],[51,28],[32,11]], "color": "roof" }
  ],
  "pixels": { "25,36": "dark", "30,43": "gold" }
}
```

- `size`: square canvas size
- `palette`: `{ key: "#hex" }` — layers and pixels reference **keys, never raw hex**
- `layers`: painted in order (painter's algorithm). Layer types: `fill`, `rect`, `rectout`, `ellipse`, `line`, `poly`, `polyout`
- `pixels`: sparse override map `{ "x,y": key }`; `null` clears

## pixel-engine.js — scene-level API

| Function | Signature | Purpose |
|---|---|---|
| `create_canvas` | `(size, background)` | New scene document |
| `add_layer` | `(scene, layer)` | Append a layer |
| `fill_region` | `(scene, x, y, w, h, color, id)` | Filled rect layer |
| `draw_shape` | `(scene, type, params)` | Generic shape layer |
| `set_pixel` | `(scene, x, y, color)` | Sparse override |
| `clear_pixel` | `(scene, x, y)` | Clear an override |
| `get_pixel` | `(scene, x, y)` | Resolved color at a coordinate |
| `rasterize` | `(scene)` | RGBA pixel buffer |
| `render` | `(scene)` | RGBA pixel buffer (alias) |
| `inspect` | `(scene)` | Per-color counts + bounding boxes |
| `read_region` | `(scene, x, y, w, h, opts)` | ASCII map or color counts (multi-resolution) |
| `encode_png` | `(scene)` | PNG bytes |
| `export_png` | `(scene, path)` | PNG file |
| `encode_png_buffer` | `(rgba, w, h)` | PNG bytes from an arbitrary RGBA buffer (spritesheets) |
| `scene_to_html` | `(scene, opts)` | Interactive preview HTML |

## animation.js — frame-level API

| Function | Signature | Purpose |
|---|---|---|
| `create_animation` | `(w, h, opts)` | New animation document |
| `normalize_animation` | `(anim)` | Validate / normalize |
| `add_frame` | `(anim, scene)` | Append a frame |
| `duplicate_frame` | `(anim, frameId)` | Deep-copy a frame |
| `delete_frame` | `(anim, frameId)` | Remove a frame |
| `frame_ids` | `(anim)` | List of frame ids |
| `resolve_frame` | `(anim, frameId)` | RGBA buffer of a frame |
| `set_frame_pixel` | `(anim, frameId, x, y, color)` | Frame pixel override |
| `get_frame_pixel` | `(anim, frameId, x, y)` | Frame pixel read |
| `clear_frame_pixel` | `(anim, frameId, x, y)` | Frame pixel clear |
| `fill_frame_region` | `(anim, frameId, x, y, w, h, color)` | Frame region fill |
| `move_frame_region` | `(anim, frameId, x, y, w, h, dx, dy)` | Move a region within a frame |
| `copy_frame_region` | `(anim, srcId, dstId, x, y, w, h, dx, dy)` | Copy a region between frames |
| `set_keyframe` | `(anim, frameId, value)` | Keyframe marker |
| `is_keyframe` | `(anim, frameId)` | Keyframe check |
| `diff_frames` | `(anim, aId, bId)` | Exact diff: changed/unchanged counts, %, bbox, per-pixel changes |
| `validate_change` | `(anim, aId, bId, allowed_region)` | PASS/FAIL against an allowed region + unexpected list |
| `frame_palette` | `(anim, frameId)` | Resolved color usage |
| `palette_drift` | `(anim)` | Palette consistency across frames |
| `encode_spritesheet` | `(anim, opts)` | PNG sheet (export only) |
| `export_spritesheet` | `(anim, path, opts)` | PNG sheet file |
| `animation_to_html` | `(anim, opts)` | Self-contained playback preview HTML |

## Notes

- `move_frame_region` / `copy_frame_region` operate on rasterized buffers and write pixel overrides. They erase by revealing the layers beneath — to erase over a filled background, fill the region with the background color instead.
- **There is no `replace_color()` function.** Recolor by editing the palette key's hex — every pixel using that key recolors in one edit.
- Frames are square like scenes (the engine rasterizes square canvases).