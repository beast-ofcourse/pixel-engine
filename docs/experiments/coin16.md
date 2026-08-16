# Experiment Record — coin16

| Field | Value |
|---|---|
| Asset | 16×16 coin |
| Model | orchestrator (direct) |
| Iterations | 2 |
| Total pixel modifications | 12 (final override count: emblem + highlight + shadow overrides; the iteration-2 centering fix re-placed these 12 overrides) |
| Final unexpected mutations | 0 |
| Palette size | 7 (outline, rimDark, rimMid, faceMid, faceLight, accent, emblem) |
| Structural issues | 0 |
| Pixel-art issues | 0 |
| Final assessment | production candidate |

## Iterations

1. **Initial authoring** — 4 concentric ellipses (outline rx=6.5 → rim rx=5.5 → face rx=4.5 → raised rx=3.5) at cx=7.5, cy=7.5; diamond emblem (4 px) + accent center; 4-px highlight arc; 3-px bottom-right shadow.
   - Diagnosis (GEOMETRY, MEDIUM): silhouette bbox [1,1,13,13] — coin off-center by 1px (right/bottom margin 2 vs left/top 1).

2. **Centering fix** — cx/cy 7.5 → 8.0 for all ellipses; emblem diamond shifted +1 → (8,7),(7,8),(9,8),(8,9), center accent (8,8); highlight arc moved onto the rim ring → (4,4),(5,3),(6,3),(3,5); shadow moved to bottom-right rim → (11,13),(12,12),(13,11).
   - Verify: silhouette bbox now [2,2,12,12] — margins 2,2,2,2, perfectly centered. Highlight sits on the rim annulus (between rx=4.5 and rx=5.5); shadow on bottom-right rim.

3. **Cleanup** — removed unused `rimLight` palette key (was never painted; 7 colors final).

## Final inspect() summary

- outline 35px bbox[2,2,12,12] (silhouette ring)
- faceMid 28px bbox[4,4,8,8], faceLight 27px bbox[5,5,6,6] (raised center)
- rimMid 24px bbox[3,3,10,10]
- accent 5px, emblem 4px, rimDark 3px
- Layers: 4, pixel overrides: 12
