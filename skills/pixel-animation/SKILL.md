---
name: pixel-animation
description: "Animate pixel-art scenes with the engine's animation subsystem. Use when creating or extending an animation (frame planning, keyframes, fps, timing), when duplicating and locally modifying frames, when diffing or validating frame changes, when checking temporal consistency across frames, or when exporting spritesheets or playback previews. Follows the keyframe → duplicate → modify → diff → validate loop."
---

# pixel-animation

Two halves: the **principles** below teach what good animation is (readability, timing, poses, weight); the **engine workflow** at the end teaches how to build it with this engine (duplicate + modify, diff = motion, validate).

## Animation Principles

## Purpose

This skill teaches an AI agent to **design, generate, evaluate, debug, and improve animations** using fundamental animation principles.

The goal is not merely to make frames change over time.

The goal is to make motion:

* readable
* intentional
* believable
* expressive
* visually coherent
* temporally well-paced
* economical
* stylistically consistent

This skill is especially optimized for **pixel-art animation**, sprite animation, game animation, procedural animation, and AI-generated frame sequences.

---

## Core Philosophy

Animation is the controlled change of **shape, position, timing, and visual emphasis over time**.

A good animation should answer three questions:

1. **What is moving?**
2. **Why is it moving that way?**
3. **What should the viewer perceive from that movement?**

Never optimize for frame-to-frame similarity alone.

A sequence can have extremely smooth transitions and still be a bad animation.

Prioritize:

**Readability → Intent → Motion → Timing → Consistency → Detail**

Do not reverse this hierarchy.

---

## 1. Pose Before Motion

The most important frames are usually the **key poses**.

Before generating intermediate frames, establish:

* starting pose
* anticipation pose
* action/extreme pose
* contact/impact pose
* recovery pose
* ending pose

A strong animation with fewer excellent poses is better than a smooth animation with weak poses.

### Rule

> If the key poses do not communicate the action when viewed individually, interpolation will not fix the animation.

---

## 2. Silhouette Readability

At small resolutions, especially pixel art, the silhouette carries enormous amounts of information.

Evaluate every important frame as a solid silhouette.

Check:

* body/limb separation
* negative space
* direction of movement
* pose readability
* balance
* center of mass
* recognizable action

### Hard rule

If the animation's intended action cannot be recognized from the silhouette, improve the pose before adding detail.

---

## 3. Anticipation

Major actions generally benefit from preparation.

Examples:

* punch → arm/body pulls back first
* jump → character compresses before launching
* sword swing → weapon/body winds up
* throw → torso and arm load backward
* landing → body prepares to absorb impact

Anticipation tells the viewer what is about to happen.

### Exception

Extremely fast or surprising actions may intentionally minimize anticipation.

Do not apply anticipation mechanically.

---

## 4. Squash and Stretch

Use deformation to communicate:

* acceleration
* force
* weight
* impact
* elasticity
* speed

Typical pattern:

**squash → stretch → normal**

or:

**stretch → impact squash → recovery**

Preserve perceived volume unless intentional stylization requires otherwise.

At low resolutions, even a few pixels of deformation can create a major perceptual effect.

---

## 5. Timing

Timing is one of the strongest determinants of animation quality.

Never assume:

> Every frame should have equal duration.

Use timing to communicate physical and emotional properties.

### Slow timing

Can suggest:

* weight
* deliberation
* anticipation
* hesitation
* dramatic emphasis

### Fast timing

Can suggest:

* speed
* aggression
* surprise
* lightness
* impact

### Holds

A held frame can emphasize:

* anticipation
* impact
* expression
* dramatic poses
* reaction

Timing should be intentionally designed rather than inherited from a uniform frame rate.

---

## 6. Spacing

Timing answers:

> **When does movement happen?**

Spacing answers:

> **How far does the object move between frames?**

These are separate concepts.

For acceleration:

`small → medium → large → very large`

For deceleration:

`very large → large → medium → small`

For constant motion:

`similar → similar → similar`

Avoid automatically using linear spacing.

Linear movement often feels mechanical.

---

## 7. Ease-In and Ease-Out

Most meaningful movement should not behave like a constant-speed interpolation unless the action specifically requires it.

Common motion patterns:

### Ease-in

Slow → fast

### Ease-out

Fast → slow

### Ease-in-out

Slow → fast → slow

### Overshoot

Move beyond the target → return

### Snap

Very fast movement → immediate stop

Select the motion curve based on the physical or stylistic intent.

---

## 8. Arcs

Natural movement frequently follows arcs rather than arbitrary straight-line paths.

Check:

* hands
* feet
* weapons
* heads
* tails
* projectiles
* camera movement
* swinging objects

Track important points across frames.

If the trajectory produces an unintended zigzag, jitter, or unnatural corner, correct it.

For stylized pixel art, arcs may be intentionally stepped, but the **underlying motion should still feel coherent**.

---

## 9. Follow-Through

Different parts of an object do not necessarily stop simultaneously.

When the main body stops:

* hair may continue
* cloth may continue
* weapon may continue
* tail may continue
* accessories may continue

This creates inertia.

Follow-through should depend on the fictional object's:

* mass
* flexibility
* attachment
* speed
* material

---

## 10. Overlapping Action

Different components can have different timing.

For example:

**body moves → clothing follows → hair follows**

Avoid synchronizing every component unless the material is rigid.

Overlapping motion creates depth and organic movement.

---

## 11. Secondary Motion

Secondary motion reinforces the primary action.

Examples:

### Character jumps

Primary:

* body rises

Secondary:

* hair moves
* clothing moves
* arms adjust
* accessories swing

### Character lands

Primary:

* body stops downward motion

Secondary:

* body compresses
* hair continues
* clothing settles
* dust expands

Secondary motion should **support** the primary action.

Do not add motion merely because something can move.

---

## 12. Weight and Inertia

Motion should communicate implied mass.

Heavy object:

* slower acceleration
* stronger anticipation
* larger impact
* longer settling
* more pronounced recoil

Light object:

* rapid acceleration
* quick direction changes
* smaller impact
* faster settling

The same timing should not automatically be used for every object.

---

## 13. Contact and Impact

Impact frames are extremely important.

At contact:

* exaggerate compression
* emphasize direction
* temporarily alter silhouette
* use stronger contrast when appropriate
* consider a brief hold
* add secondary effects if stylistically appropriate

Examples:

* hit flash
* dust
* particles
* recoil
* screen shake
* slash trail

Effects should reinforce the impact rather than hide a weak animation.

---

## 14. Recoil

After a forceful action, the subject often reacts.

Examples:

**Punch → arm extends → body recoils**

**Explosion → character moves away → recovery**

**Sword impact → weapon stops → arm/body reacts**

Recoil makes force feel consequential.

---

## 15. Recovery

After an extreme pose, return the subject to a stable state.

Typical structure:

**anticipation → action → extreme → recoil → recovery**

Do not abruptly teleport from the extreme pose into the idle pose unless that snap is intentional.

---

## 16. Exaggeration

Animation frequently communicates better when motion is exaggerated beyond literal physics.

Especially at low resolution:

* larger poses
* stronger anticipation
* clearer arcs
* more extreme squash/stretch
* stronger recoil
* more obvious impacts

can improve readability.

### Rule

> Optimize for perceived motion, not literal simulation.

Physical accuracy is subordinate to visual communication unless realism is the explicit goal.

---

## 17. Staging

The viewer should immediately understand the important action.

Control:

* silhouette
* contrast
* composition
* direction
* pose
* timing
* visual clutter

Avoid secondary elements competing with the primary action.

The most important motion should have the strongest visual readability.

---

## 18. Frame Economy

More frames do not automatically mean better animation.

Ask of every frame:

> What information does this frame contribute?

Remove frames that:

* add no meaningful change
* duplicate another frame
* weaken timing
* make the action feel sluggish
* introduce unnecessary visual noise

Pixel animation often benefits from deliberate, economical frame counts.

---

## 19. Pixel-Specific Motion Rules

For pixel art, do not treat pixels as miniature vector graphics.

Respect:

* intentional pixel clusters
* deliberate stair-stepping
* consistent pixel scale
* clean silhouettes
* controlled diagonals
* limited palette
* selective detail
* stable proportions

Avoid:

* subpixel-looking noise
* accidental anti-aliasing
* random isolated pixels
* inconsistent pixel density
* noisy outlines
* excessive interpolation artifacts

### Important

Do not automatically smooth every movement.

A crisp stepped movement can look significantly better than mathematically smooth interpolation.

---

## 20. Pixel Cluster Integrity

During animation, preserve meaningful clusters whenever possible.

A cluster should generally behave as a visual unit.

When changing a shape:

1. preserve the major mass
2. reshape the cluster intentionally
3. preserve important contour information
4. avoid randomly moving individual pixels

Think in terms of **shape transformation**, not pixel displacement.

---

## 21. Consistency Across Frames

Maintain visual continuity in:

* proportions
* anatomy
* palette
* lighting
* outline style
* perspective
* pixel scale
* material representation
* character identity

A frame may be individually beautiful and still be wrong if it breaks continuity.

### Principle

> Animation quality is evaluated across the sequence, not merely frame-by-frame.

---

## 22. Motion Continuity

Check transitions between consecutive frames.

Look for:

* jitter
* unintended teleportation
* sudden scale changes
* broken arcs
* inconsistent limb lengths
* accidental direction reversals
* unstable silhouettes
* flickering details

A change should either be:

**intentional motion**

or

**intentional stylization.**

Everything else is an error candidate.

---

## 23. Directional Readability

Movement should communicate its direction.

Use:

* body lean
* limb extension
* trailing elements
* smear shapes
* directional particles
* asymmetric silhouettes

Avoid perfectly symmetrical poses during highly directional actions unless symmetry is intentional.

---

## 24. Animation Structure

When designing an animation, reason in phases.

A useful generic structure:

**Setup**
→ **Anticipation**
→ **Acceleration**
→ **Action**
→ **Impact/Extreme**
→ **Follow-through**
→ **Recovery**
→ **Settle**

Not every animation requires every phase.

The agent must select phases based on the action.

---

## 25. Animation Type Matters

Different animations require different principles.

### Idle

Prioritize:

* subtle weight shifts
* breathing
* secondary motion
* looping continuity

### Walk

Prioritize:

* contact
* passing
* weight transfer
* leg/arm opposition
* body bounce

### Run

Prioritize:

* larger poses
* stronger lean
* greater stride
* faster timing
* stronger arm movement

### Attack

Prioritize:

* anticipation
* acceleration
* extreme pose
* impact
* recoil
* recovery

### Jump

Prioritize:

* compression
* launch
* airborne pose
* apex
* descent
* landing
* recovery

### Hit Reaction

Prioritize:

* impact
* directional deformation
* recoil
* delayed recovery

### Death

Prioritize:

* readable cause
* loss of balance
* weight
* follow-through
* final pose

Do not apply one universal animation template to every action.

---

## 26. Loop Quality

For looping animations, the transition from the final frame back to the first must be intentional.

Check:

* position continuity
* velocity continuity
* silhouette continuity
* timing continuity
* secondary motion
* phase alignment

Avoid:

`Frame N → sudden teleport → Frame 1`

unless the teleport is deliberately part of the style.

For idle animations, the loop should often feel cyclical rather than obviously repetitive.

---

## 27. Animation Critique Protocol

When evaluating an animation, inspect it in this order:

### Pass 1 — Intent

What action is the animation supposed to communicate?

### Pass 2 — Silhouette

Can the action be understood without internal detail?

### Pass 3 — Key Poses

Are the major poses strong?

### Pass 4 — Timing

Does the action have the correct rhythm?

### Pass 5 — Spacing

Does movement accelerate/decelerate appropriately?

### Pass 6 — Arcs

Are trajectories coherent?

### Pass 7 — Weight

Does the motion communicate mass and force?

### Pass 8 — Secondary Motion

Do dependent elements react appropriately?

### Pass 9 — Consistency

Does the subject remain visually stable?

### Pass 10 — Pixel Integrity

Are clusters, edges, palette, and pixel scale clean?

### Pass 11 — Economy

Can any frames or pixels be removed without reducing quality?

---

## 28. Failure Diagnosis

When an animation looks bad, do not randomly modify frames.

Identify the failure category first.

### Looks robotic

Check:

* linear spacing
* synchronized motion
* lack of anticipation
* lack of secondary motion
* insufficient timing variation

### Looks floaty

Check:

* weak acceleration
* weak contact
* insufficient gravity cues
* poor spacing
* missing impact/recovery

### Looks jittery

Check:

* inconsistent anchor points
* unstable silhouettes
* accidental pixel movement
* broken arcs
* inconsistent proportions

### Looks stiff

Check:

* weak pose changes
* insufficient deformation
* weak anticipation
* lack of overlapping action

### Looks like teleportation

Check:

* excessive positional change between frames
* missing anticipation
* missing intermediate motion
* incorrect spacing

### Looks noisy

Check:

* excessive detail
* unstable pixel clusters
* random secondary motion
* inconsistent lighting
* unnecessary effects

### Looks smooth but bad

Do not automatically add more frames.

First inspect:

* key poses
* timing
* silhouette
* spacing
* action readability

Smoothness is not the same as quality.

---

## 29. AI Animation Generation Protocol

When generating an animation, follow this process:

## Step 1 — Identify the action

Explicitly define:

* subject
* action
* direction
* intended emotion
* approximate speed
* style
* loop/non-loop

## Step 2 — Define key poses

Create the minimum set of poses necessary to communicate the action.

## Step 3 — Define timing

Assign frame durations to each pose.

Do not assume uniform timing.

## Step 4 — Define motion paths

Identify important moving points and their trajectories.

## Step 5 — Add extremes

Exaggerate important moments where necessary.

## Step 6 — Add transitions

Create intermediate poses according to the intended spacing.

## Step 7 — Add secondary motion

Only after the primary motion works.

## Step 8 — Repair pixel clusters

Ensure every frame remains stylistically coherent.

## Step 9 — Evaluate

Run the complete critique protocol.

## Step 10 — Iterate

Fix the **highest-impact failure first**.

Never make arbitrary simultaneous changes to every aspect.

---

## 30. Iterative Improvement Rule

When improving an animation:

**Do not optimize everything at once.**

Rank defects:

1. unreadable action
2. weak key poses
3. broken timing
4. broken spacing
5. broken motion arcs
6. inconsistent structure
7. weak secondary motion
8. pixel-art cleanup
9. micro-detail

Fix the highest-ranked problem first.

Then reevaluate the entire sequence.

---

## 31. Quality Gate

An animation should not be considered finished merely because it renders successfully.

Before approval, verify:

* [ ] Action is immediately understandable
* [ ] Key poses are strong
* [ ] Silhouettes are readable
* [ ] Timing communicates intent
* [ ] Spacing is intentional
* [ ] Motion paths are coherent
* [ ] Weight is believable
* [ ] Anticipation exists where useful
* [ ] Impact/recoil exists where useful
* [ ] Secondary motion supports the action
* [ ] Frames remain visually consistent
* [ ] Pixel clusters remain intentional
* [ ] No accidental jitter exists
* [ ] No unnecessary frames exist
* [ ] Loop transitions are clean when applicable
* [ ] Effects do not hide structural problems

Only approve the animation after it passes the quality gate.

---

## Core Rules to Remember

1. **Strong poses beat smooth interpolation.**
2. **Readability beats detail.**
3. **Timing beats frame count.**
4. **Spacing creates the feeling of acceleration.**
5. **Silhouette communicates before detail.**
6. **Primary motion comes before secondary motion.**
7. **Exaggeration is often necessary at small resolutions.**
8. **Every frame must have a purpose.**
9. **Pixel clusters should be treated as shapes, not random pixels.**
10. **Consistency across frames matters more than perfection of one frame.**
11. **Do not use smoothness to hide weak animation.**
12. **Fix structural problems before cosmetic problems.**
13. **Do not blindly apply animation principles; choose them according to the action.**
14. **Optimize for what the viewer perceives, not merely what the pixels mathematically do.**
15. **Animation should communicate intent before it demonstrates technical complexity.**

## Final Principle

> **The purpose of animation is not to show change. The purpose is to make the viewer perceive an intentional action.**

When uncertain, prioritize the animation's **readability, timing, silhouette, and key poses** over additional frames, effects, or detail.

## Engine workflow — how to build it here

Animation is duplicate + modify: copy a frame, make localized changes, and the diff between consecutive frames IS the motion. You never redraw a frame from scratch.

### Core workflow

keyframe → duplicate → localized modification → diff → validate → next frame

1. **Keyframe** — author the base frame as a full scene document; mark it with `set_keyframe(anim, id, true)`.
2. **Duplicate** — `duplicate_frame(anim, id)` deep-copies the frame.
3. **Localized modification** — change only what must move: `set_frame_pixel`, `fill_frame_region`, `move_frame_region`, `copy_frame_region`. Never rebuild the whole frame.
4. **Diff** — `diff_frames(anim, aId, bId)` — exact changed/unchanged counts, percentage, bbox, per-pixel changes. The diff must match the intended motion.
5. **Validate** — `validate_change(anim, aId, bId, allowed_region)` — PASS/FAIL against the region the motion should occupy.
6. **Next frame** — repeat from step 2.

### Frame planning

- Start small: prove the motion at 16×16, 8 frames before jumping to bigger canvases with more frames. Progressive complexity.
- fps: pick for the motion (8 fps = chunky bounce, 24 fps = smooth).
- Keyframes anchor the cycle; intermediate frames are duplicates with localized edits.
- Apply the principles above: key poses first (anticipation → action → impact → recovery), then timing/spacing, then secondary motion.

### Temporal consistency

- `palette_drift(anim)` must be empty — the same palette keys across frames.
- `frame_palette(anim, id)` per frame — colors stay in the material families.
- Consecutive-frame diffs should be small and localized — a big diff means the motion is not localized.

### Spritesheet layout

- `encode_spritesheet(anim, opts)` / `export_spritesheet(anim, path, opts)` — PNG sheet of all frames; `opts.columns` controls layout. Export format only — never the internal representation.

### Validation

- `normalize_animation(anim)` — document integrity.
- `diff_frames` + `validate_change` — motion correctness.
- `animation_to_html(anim, opts)` — playback preview for the visual check.

### Rules

- Never redraw a frame from scratch — duplicate + modify.
- The diff between consecutive frames is the motion: if the diff is wrong, the motion is wrong.
- API signatures: see the pixel-engine skill.
