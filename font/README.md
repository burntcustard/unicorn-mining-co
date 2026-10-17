# Gemetric

Edit [glyph-paths.ts](glyph-paths.ts) using whole-number coordinates, with
half-unit horizontal offsets where needed for optical alignment. Stars use
fractional coordinates to keep all five tips evenly spaced. The initial
`M` is implicit; use `M` for additional subpaths and `Z` to close them. Empty
strings are placeholders and aren't included in the font.

The stars `★` and `☆` use identical paths. The generator fills the closed path for
`★`, keeping its outer edge identical to the outlined `☆`.
Both use a thinner outline with pointed joins instead of the usual bevels.

Letters, digits and other symbols have a 13-unit advance. Full stops and commas
use a 6-unit advance, with the same stroke weight, so numbers stay compact.
This spacing is built into the font and needs no CSS feature setting. Canvas
text uses native alignment to respect these widths.

The thin space (`U+2009`, `&#8201;` in HTML) advances 6.5 units, exactly half
the width of the regular space, and has no visible outline.

- Preview: `npm run tool:font-viewer`, then open [localhost:3000](http://localhost:3000/)
  with the other frontend stopped. Saving glyphs updates the preview automatically.
- Generate: `npm run font` writes `gemetric.woff2`. Production builds also do this.
- Test: `npm run test font-generation font-viewer text-rendering`.
