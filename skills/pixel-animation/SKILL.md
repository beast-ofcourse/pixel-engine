---
name: pixel-animation
description: "Animate pixel-art scenes with the engine's animation subsystem. Use when creating or extending an animation (frame planning, keyframes, fps, timing), when duplicating and locally modifying frames, when diffing or validating frame changes, when checking temporal consistency across frames, or when exporting spritesheets or playback previews. Follows the keyframe → duplicate → modify → diff → validate loop."
---

# pixel-animation

Animation is duplicate + modify: copy a frame, make localized changes, and the diff between consecutive frames IS the motion. You never redraw a frame from scratch.

## Core workflow

keyframe → duplicate → localized modification → diff → validate → next frame

1. **Keyframe** — author the base frame as a full scene document; mark it with `set_keyframe(anim, id, true)`.
2. **Duplicate** — `duplicate_frame(anim, id)` deep-copies the frame.
3. **Localized modification** — change only what must move: `set_frame_pixel`, `fill_frame_region`, `move_frame_region`, `copy_frame_region`. Never rebuild the whole frame.
4. **Diff** — `diff_frames(anim, aId, bId)` — exact changed/unchanged counts, percentage, bbox, per-pixel changes. The diff must match the intended motion.
5. **Validate** — `validate_change(anim, aId, bId, allowed_region)` — PASS/FAIL against the region the motion should occupy.
6. **Next frame** — repeat from step 2.

## Frame planning

- Start small: prove the motion at 16×16, 8 frames before jumping to 16×16, 24 frames. Progressive complexity — never jump straight to a big canvas with many frames.
- fps: pick for the motion (8 fps = chunky bounce, 24 fps = smooth).
- Keyframes anchor the cycle; intermediate frames are duplicates with localized edits.

## Temporal consistency

- `palette_drift(anim)` must be empty — the same palette keys across frames.
- `frame_palette(anim, id)` per frame — colors stay in the material families.
- Consecutive-frame diffs should be small and localized — a big diff means the motion is not localized.

## Spritesheet layout

- `encode_spritesheet(anim, opts)` / `export_spritesheet(anim, path, opts)` — PNG sheet of all frames; `opts.columns` controls layout. Export format only — never the internal representation.

## Validation

- `normalize_animation(anim)` — document integrity.
- `diff_frames` + `validate_change` — motion correctness.
- `animation_to_html(anim, opts)` — playback preview for the visual check.

## Rules

- Never redraw a frame from scratch — duplicate + modify.
- The diff between consecutive frames is the motion: if the diff is wrong, the motion is wrong.
- API signatures: see the pixel-engine skill.