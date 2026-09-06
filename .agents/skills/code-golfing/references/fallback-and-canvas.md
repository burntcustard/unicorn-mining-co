# September 2026 fallback and canvas experiments

Measured on 2026-09-06 with `npm run build:fast`, fixed seed 13312 and 10
advzip iterations. Each candidate was built separately against the retained
source at that point. Final advzip result: **13346 -> 13320B (-26B)**.
These measurements are context-dependent; fewer calls or source characters
alone did not predict a smaller ZIP.

## Retained changes

| Change | Advzip before -> after | Saving |
| --- | --- | --- |
| Delete `Item.update`, inheriting `Sprite.update` directly | 13346 -> 13341B | 5B |
| Remove the nested save/restore around the item's final glint | 13341 -> 13340B | 1B |
| Drop `!cache.image` from the docking glow cache refresh guard | 13340 -> 13336B | 4B |
| Chain background dot/sparkle assignments as `ctx.shadowColor = ctx.fillStyle = color` | 13336 -> 13329B | 7B |
| Replace the one-element space-key `forEach` with direct `bindKeys` | 13329 -> 13325B | 4B |
| Give `shapeOf` a default mount `{ x: 0, y: 0 }`, removing two coordinate fallbacks | 13325 -> 13324B | 1B |
| Use the background `forEach` callback's image instead of indexing `tiles[i]` | 13324 -> 13322B | 2B |
| Set the item's stroke style before its fill style and rainbow branch | 13322 -> 13320B | 2B |

The deletions rely on specific invariants:

- `Item.update` only guarded `buried` and called its superclass; `Sprite.update`
  already returns for buried items. Keep that guard in the inherited method.
- The glint is the last drawing operation in `Item.render`. The outer
  save/restore still isolates its transform and fill style from other objects.
  Adding drawing after the glint would require reconsidering that isolation.
- A docking glow's cache scale starts undefined while `game.scale` is numeric
  before rendering. The image and scale are populated together, so a scale
  mismatch already detects the initial empty cache. Restore an image check if
  images can later be cleared independently of their scale.
- Supplied mounts have both numeric coordinates; only an absent mount needs
  the origin default. This does not generalize to partial or null mounts.
- Background image references cannot change midway through the synchronous
  render loop; bitmap completion callbacks run after it yields.
- Stroke/fill assignments and their ordering can match existing drawing idioms
  without changing the drawing. Measure the exact order: consistency alone
  does not guarantee a saving.

## Rejected changes

Each row starts from its own then-current retained baseline. All were reverted,
including the neutral direct-context import.

| Candidate | Advzip before -> after | Cost |
| --- | --- | --- |
| Remove floodlight's explicit `activationDuration: 0.1`, equal to the fallback | 13329 -> 13330B | +1B |
| Remove Mustang's unused empty `name` and zero `price` properties | 13329 -> 13332B | +3B |
| Precompute item fill alpha in its constructor | 13325 -> 13330B | +5B |
| Hoist controls' fill style out of the module loop and chain it with stroke style | 13324 -> 13343B | +19B |
| Replace `Vector(...point).length()` with `Math.hypot(...point)` for item radius and remove its Vector import | 13324 -> 13336B | +12B |
| Import `context` directly in Sprite instead of calling `getContext()` | 13324 -> 13324B | 0B |
| Divide docking glow image width by `game.scale` instead of `cache.scale` | 13322 -> 13339B | +17B |

Removing a runtime allocation, moving a constant assignment out of a loop, or
eliminating a fallback can still increase compressed size. Keep these results
alongside the successful deletions when selecting future candidates.
