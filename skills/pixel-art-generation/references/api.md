# pixel-engine API reference (static scenes)

Verified against `engine/pixel-engine.js` (zero dependencies, UMD: `require('./engine/pixel-engine.js')` in Node, `window.PixelEngine` in the browser).

## Scene document

```json
{
  "size": 64,
  "palette": { "key": "#RRGGBB" },
  "layers": [ { "id": "name", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10, "color": "key" } ],
  "pixels": { "x,y": "key" }
}
```

- `size`: square integer (required).
- `palette`: key → hex. Colors in layers/pixels are palette keys (hex also resolves).
- `layers`: painted in array order; later layers overwrite earlier.
- `pixels`: sparse overrides painted last; `null` value clears (layer beneath shows).

## Layer types

| type | params | notes |
|---|---|---|
| `fill` | `color` | whole canvas |
| `rect` | `x, y, w, h, color` | fractional width uses `ceil(x+w)-1` |
| `rectout` | `x, y, w, h, t, color` | outline ring, thickness `t` (default 1) |
| `ellipse` | `cx, cy, rx, ry, color` | degenerate `rx<1` → single pixel at center |
| `line` | `x1, y1, x2, y2, color` | Bresenham; reversed direction paints same pixels |
| `poly` | `points: [[x,y],…], color` | even-odd scanline fill; half-open (top vertex row included) |
| `polyout` | `points: [[x,y],…], color` | closed-edge outline |

Unknown types / unresolvable colors are skipped and counted in `scene._skipCount`.

## Engine functions

| function | purpose |
|---|---|
| `create_canvas(size, background)` | new scene; `background` adds a `fill` layer |
| `add_layer(scene, layer)` | push a shape layer; auto id `layerN` |
| `fill_region(scene, x, y, w, h, color, id?)` | filled rect layer |
| `draw_shape(scene, type, params)` | generic shape layer |
| `set_pixel(scene, x, y, color)` | sparse override; `null` clears |
| `clear_pixel(scene, x, y)` | remove override |
| `get_pixel(scene, x, y)` | resolved hex or `null` (transparent / out of bounds) |
| `rasterize(scene)` | `Uint8Array` RGBA buffer |
| `render(scene)` | `{ width, height, data }` |
| `inspect(scene)` | `{ colors: [{name?, color, count, bbox}], layerBBoxes, skipCount }` |
| `read_region(scene, x, y, w, h, opts)` | ASCII map (`opts.scale`) or counts (`opts.mode: 'counts'`) |
| `encode_png(scene)` | PNG bytes |
| `export_png(scene, path)` | write PNG file (Node) |
| `encode_png_buffer(rgba, w, h)` | PNG bytes for an arbitrary RGBA buffer |
| `scene_to_html(scene, opts)` | interactive preview; `opts { path, title }` |

## CLI

```text
node cli.js <scene.json> [--png out.png] [--html out.html]
                        [--zoom x,y,w,h] [--counts x,y,w,h] [--scale n]
```

Prints: scene summary, `inspect()` color stats (count + bbox per color), layer bboxes (pre-overwrite), auto-scaled ASCII preview, then optional zoom/counts/outputs. Errors exit 1 with `error: …`.

## Verification

- `node tests/test-suite.js` — 117 tests; scene hashes locked (house, campfire, house128, robot, landscape256).
- Browser == Node: canvas sample SHA-256 must equal the Node rasterize hash.