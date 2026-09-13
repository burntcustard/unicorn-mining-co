# Custom replacement and pre-transform experiments (2026-09-13)

## Post-Terser syntax pass (2026-09-13)

The separate `replacePostTerser` in `plugins/replace-post-terser.js` runs after
Terser and before Roadroller in normal builds and search-input generation.
It quotes explicit identifier property keys except `length`, parenthesizes bare
single-identifier arrow parameters, and expands finite decimal exponent literals
to their canonical Number spelling. These are AST-located text edits: do not
replace them with regexes over arbitrary minified JavaScript or reminify afterward.

Fast ZIP **13,316 → 13,269 bytes (47 saved)**; full ZIP **13,312 → 13,264
bytes (48 saved)**. The added 1,660 input characters improve final compression.
The exact installed fork matches remote branch commit
`85f46f296b122648d997a7c015306164153916d0`; Roadroller and Terser settings remain
unchanged. Preserving bare `length` keeps its abbreviation slot. The retained
three-rule combination beats individually selected rules: exponent expansion
alone ties the full baseline, and adding arrow parentheses to key quoting alone
is neutral, but the complete combination saves another 7 full-build bytes.

The [research report](../../../../research/post-terser-compression.md) and
[all 77 measurements](../../../../research/post-terser-measurements.csv) record
the candidates, fork/Zopfli mechanisms and verification. Broad declaration
joining, bracket access, leading decimal zeros, return blocks, and top-level
var-to-let/const conversions lost. These post-mangling experiments are distinct
from the earlier pre-Terser trials below.

Follow-up on the current bundle (2026-09-13): changing the quoted property-key
spelling from double quotes (`"key"`) to single quotes (`'key'`) saved 1B
(`13354 -> 13353B`) after advzip. Identifier property names cannot contain a
single quote, so this remains syntax-equivalent. Quoting `length` as well was
retested and cost 56B (`13354 -> 13410B`); keep it bare for Roadroller's
abbreviation dictionary. Converting integer literals to scientific notation
was also retested against the current minified output: a broad rule for all
shorter spellings cost 9B (`13353 -> 13362B`), while targeting only `1000`,
`10000`, and `50000` cost 23B (`13353 -> 13376B`). Keep the existing exponent
expansion rule; shorter numeric source is not a ZIP win here.

Whole-game normalized AST equivalence, 23 differential runtime fixtures,
idempotence, the packed decoder round trip, real fast/full builds and lint pass.
No source-level sound expressions or timing changed. Final dist uses build:full.

## Earlier pre-Terser pass

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
