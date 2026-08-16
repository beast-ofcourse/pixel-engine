# API reference

Full signatures: see the **pixel-engine** skill (`skills/pixel-engine/references/api.md`) — the single source of truth, verified against `engine/pixel-engine.js` and `engine/animation.js`. Never call engine functions from memory.

Builder-relevant doctrine:

- **Bulk operations first** — `fill_region`, `draw_shape`, `fill_frame_region`, `move_frame_region`, `copy_frame_region` before any `set_pixel`/`clear_pixel` storm.
- `move_frame_region` / `copy_frame_region` operate on rasterized buffers and write pixel overrides. They erase by revealing the layers beneath — to erase over a filled background, fill the region with the background color instead.
- **There is no `replace_color()` function.** Recolor by editing the palette key's hex — every pixel using that key recolors in one edit.
- Frames are square like scenes (the engine rasterizes square canvases).