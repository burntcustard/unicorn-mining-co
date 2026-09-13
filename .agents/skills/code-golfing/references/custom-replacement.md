# Custom replacement and pre-transform experiments (2026-09-13)

Measured with `npm run build:fast`, seed 13312, and 10 advzip iterations against the post-sound rewrite codebase (baseline ~13,316 B advzip).

## Retained customReplacement additions

- **Identifier pre-mangling in `plugins/vite-js13k.js`**:
  Added DOM-shadowed or un-mangled property identifiers to `customReplacement` (`_$1` prefix) so Terser compresses them into single letters:
  - `actions` (-3 B)
  - `detach` (-4 B)
  - `level` (-3 B)
  - `object` (-4 B)
  - `pitch` (-1 B)
  - `remove` (-8 B)
  - `span` (-1 B)
  - `target` (-4 B)
  - `toggle` (-3 B)
  - `unlock` (-3 B)

- **`2 * Math.PI` normalization**:
  Standardized `2 * Math.PI` to `Math.PI * 2` via `.replaceAll('2 * Math.PI', 'Math.PI * 2')`. Ensures consistent token alignment across canvas arcs, trigonometry, and procedural distribution.

## Tested and rejected transformations

| Transformation | Before → After | Cost | Reason |
|---|---|---|---|
| `x ** 2 + y ** 2` → `x * x + y * y` | 13316 → 13325B | +9B | Terser outputs `**2` as a concise 3-char token (`**2`). Repeated variable chains (`a.x * a.x + a.y * a.y ...`) introduce more unique identifiers that compress worse with Roadroller than repeated `**2` tokens. |
| Pre-mangling `color` | 13341 → 13364B | +23B | Canvas context `.color` / spark `.color` properties conflicted with native/DOM token frequencies. |
| Pre-mangling `image` | 13341 → 13365B | +24B | Canvas/DOM `.image` property clashed with Roadroller model contexts. |
| Pre-mangling `rate` | 13354 → 13384B | +30B | Collided with other identifier frequencies and audio rate automation. |
| Pre-mangling `fill` or `stroke` | 13391 → 13395B | +4B | Canvas context `.fillStyle`/`.strokeStyle` calls compress better when left un-aliased. |
| Pre-mangling `dx` and `dy` | 13379 → 13386B | +7B | Short 2-letter coordinate properties are already compact in Terser's local scope mangler. |
| Pre-mangling `canvas` | 13378 → 13406B | +28B | Clashed with `HTMLCanvasElement` / context object properties. |
| Inlining `Math.PI * 2 / 5` as `Math.PI * 0.4` | 13346 → 13345B | -1B | Minor win in station angle generation. |
| Replacing `Array.from({ length: N }, ...)` with `[...Array(N)].map(...)` | 13378 → 13387B | +9B | Array spread and mapping overhead outweighed the repeated `Array.from` token. |
