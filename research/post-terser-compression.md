# Post-Terser transformations for Roadroller and Zopfli

A small syntax pass between Terser and Roadroller reduces this game's final ZIP by **48 bytes**, from **13,312 to 13,264 bytes** with `build:full`. With `build:fast`, the reduction is **47 bytes**, from **13,316 to 13,269 bytes**. The full build now has 48 bytes of room below the 13,312-byte entry limit.

The retained pass quotes explicit object-property keys except `length`, parenthesizes bare single-parameter arrows, and expands decimal exponential literals when JavaScript's canonical number spelling differs. It adds **1,660 characters** to the program entering Roadroller. No identifiers, arithmetic operations, audio parameters, Roadroller settings, decoder code, or Terser settings change.

The results establish an opportunity for compression-aware syntax transformations, not a universal minification rule. Several shorter representations compressed worse, and the best combination cannot be predicted by adding its components' individual savings. The implementation is in [replace-post-terser.js](../plugins/replace-post-terser.js); all 77 isolated measurements are in [the CSV](post-terser-measurements.csv).

## The pipeline and the objective

The production path is:

```text
source files
  → DEBUG/BENCHMARK stripping and existing replacePreTerser
  → Vite bundling and Terser compression/mangling
  → replacePostTerser                    [new]
  → Roadroller JavaScript preparation
  → fixed context models and rANS packing
  → generated decoder embedded in minified HTML
  → JSZip archive
  → advzip / Zopfli recompression
```

The quantity being minimized is the size of that last archive. Source length, Roadroller's prepared input length, and ordinary gzip size are intermediate observations. They do not settle which candidate wins. Repeated syntax can improve prediction, but it can also change the abbreviation dictionary, quote-model activity, and the compressed payload encountered by DEFLATE.

Putting the transformation after Terser matters because its printer normally removes unnecessary parentheses and selects compact numeric spellings. Reapplying compression afterward can undo the intended changes. It also matters experimentally: modifying a fixed, already-mangled program holds its identifier assignment and optimizer decisions constant. The existing pre-Terser replacements remain useful for influencing those earlier decisions.

`dist/minified.js` now records the postprocessed program actually supplied to Roadroller. Both normal builds and the `build:search` input-generation path use the new pass. Parameter search was not run.

## The exact Roadroller branch

The installed dependency and the requested remote branch both identify commit `85f46f296b122648d997a7c015306164153916d0`. The installed `index.mjs` also matches the local fork checkout byte for byte. This analysis therefore concerns the hierarchical-mixer/SSE fork, not just upstream Roadroller documentation.

The relevant source mechanisms are:

- JavaScript preparation removes comments and redundant spaces, retains significant line terminators, and substitutes selected repeated identifiers or keywords with unused characters.
- The abbreviation heuristic ranks names by `name.length * (frequency - 1)`. The current build allows five replacements.
- Sparse models use selected recent bytes. A rolling word model accumulates bytes 65–122, including punctuation between uppercase and lowercase letters.
- Mixer weights combine global, previous-byte, previous-byte-pair, and current-bit-prefix contexts. SSE adds prediction corrections; the dynamic quote model distinguishes quoted content.
- The predicted bits feed a 6-bit-output rANS representation; the generated decoder reproduces the model updates and expands abbreviations. [1][2]

These details suggest testing syntax that creates predictable local character sequences while preserving useful dictionary entries. They do not provide an analytic formula for the winning JavaScript spelling: each changed byte affects subsequent model state. The measured outcomes below are stronger evidence than any individual explanation of why a candidate might work.

The active abbreviations for the baseline and retained result are:

```text
let    this    return    Math    length
```

Quoting every eligible key changes the fifth entry to `var`. Leaving the fourteen explicit `length` keys unquoted keeps the original list and performs better. That association is consistent with the dictionary mechanism; it does not isolate the dictionary's effect from all the accompanying changes in character context.

## What Zopfli contributes

DEFLATE represents data using literals and length/distance references, with Huffman codes and block-level coding decisions. Its match window reaches back 32 KiB; references can represent matches of 3–258 bytes. Zopfli produces a standard DEFLATE stream, so its extra compression effort does not require a special ZIP decoder. [3][4]

Zopfli's `squeeze.c` computes low-cost paths through possible literal and match choices. It repeatedly updates symbol-cost estimates, retains the best parse found, and perturbs statistics after stagnation. The shortest-path optimization is conditional on its current cost model; this is not a proof of a globally minimal DEFLATE stream. [5]

Block splitting weighs the coding cost of separate regions against keeping them together. Each new dynamic block has a Huffman-tree description cost, so a split only helps when the improved coding pays for that overhead. The implementation's block-size calculations include the symbols, extra bits, and tree representation. [6][7]

In this game, Zopfli sees **the HTML wrapper, encoded payload, and decoder**, rather than the original game statements. Roadroller's README specifically distinguishes the relatively incompressible payload from the much more compressible decoder. Consequently, adding repeated text to the game is not equivalent to adding a repeated DEFLATE match in the final HTML. Its principal opportunity is to improve Roadroller's predictions; Zopfli then evaluates the resulting representation. [2]

This also explains why small rankings need full-strength confirmation. Two candidates may produce different payload bytes, matches, or block choices, and the preferred parse can change with more optimization effort. The research used the actual installed `advzip` executable and ZIP structure, rather than a gzip approximation.

## The fork's Zopfli scorer versus the game build

The fork's optional search scorer first compares one-iteration Zopfli results. Candidates within eight bytes are compared at 100 iterations; those within four bytes there are compared at 1,000 iterations. Remaining ties use input length. It can include the HTML wrapper around the complete generated decoder. [8]

The normal game build does **not** invoke this adaptive search scorer. It calls `makeDecoder()` with fixed settings, creates the archive, then runs AdvanceCOMP's `advzip`. Fast builds use 10 iterations and full builds use 6,000. The fork's `node-zopfli-es` scorer and the installed AdvanceCOMP 2.1 binary are separate implementations/integrations; their scores should not be treated as interchangeable.

The distinction matters operationally: copying the search scorer would not prove an improvement to the release ZIP. The measured archive remains the acceptance criterion. No scoring thresholds or compressor parameters were modified.

## Measurement method

The starting game revision was `e4532a64aa47176514672eab2519d2cbadd4e00b`. The tool versions were Terser 5.50.0, Acorn 8.18.0, Node 26.5.0, and AdvanceCOMP 2.1. The Roadroller options came unchanged from `plugins/roadroller-args.js`.

A fresh Vite fast build supplied the fixed Terser program. Its SHA-256 was:

```text
25ddfbd794c56e2a4d817c07d3a5b917360e9b0b7838e7e150208c9b9ae4e74f
```

A bounded harness transformed that snapshot, parsed each candidate, packed it with the installed fork, inserted the complete decoder into the same HTML wrapper, created the same dated `index.html` ZIP entry, and invoked the installed advzip binary. Its baseline reproduced the real fast build exactly: **13,316 bytes**. The harness performed 69 fast measurements, including unchanged controls, and eight 6,000-iteration measurements.

Real `build:full` runs then verified both baseline and final integration. In this revision, fast and full Terser passes generated identical programs before postprocessing, so the harness's full-strength recompression comparisons also match the actual full-build inputs. That equivalence must be rechecked after future source or configuration changes.

Except for explicitly combined rows, the CSV compares candidates independently against the same snapshot. Its deltas are relative to 13,316 bytes for fast results and 13,312 for full-strength results. They are not cumulative savings. Rejected syntax experiments were never integrated into the game.

## Results and interpretation

| Transformation | Fast ZIP | Difference from baseline | Finding |
| --- | ---: | ---: | --- |
| Unmodified Terser output | 13,316 | 0 | Baseline |
| Quote eligible property keys | 13,298 | −18 | Promising despite longer source |
| Quote keys except `length` | 13,276 | −40 | Preserves the original abbreviation list |
| Parenthesize bare arrow parameters | 13,315 | −1 | Full result confirms a 3-byte saving alone |
| Expand exponential literals | 13,317 | +1 | Full result ties baseline; no standalone win |
| Keys except `length` + arrow parentheses | 13,276 | −40 | Same ZIP as key quoting alone |
| Keys except `length` + expanded exponents | 13,295 | −21 | Worse than key quoting alone |
| **Keys except `length` + arrows + exponents** | **13,269** | **−47** | **Retained combination** |
| Use Terser's `quote_keys` printer option | 13,305 | −11 | Broader printing change; less effective |
| Quote only single-character keys | 13,327 | +11 | Partial uniformity did not help |
| Quote only longer keys | 13,336 | +20 | Also loses |
| Quote only `length` keys | 13,356 | +40 | Dictionary/context change is unfavorable |
| Join adjacent lexical declarations | 13,391 | +75 | Shorter source, larger ZIP |
| Join all adjacent same-kind declarations | 13,407 | +91 | Same problem at larger scope |
| Add a leading zero to decimal fractions | 13,332 | +16 | Longer regular spelling loses here |
| Replace dot access with brackets throughout | 13,475 | +159 | Much worse |
| Convert expression arrows to return blocks | 13,360 | +44 | Extra repeated syntax did not pay |
| Replace statement semicolons with newlines via printer | 13,351 | +35 | Newline distribution survives preparation |
| Convert top-level `var` declarations to `let` | 13,347 | +31 | Loses; also has semantic risks |

Terser's `quote_keys` setting confirms that some of the opportunity is available through printing options. The selective pass performs better and preserves other existing output spellings. It excludes shorthand properties and class method definitions rather than expanding every possible property representation. [9]

The exponent result is an especially useful counterexample to greedy reasoning. It loses against key quoting alone, but improves the combination with arrow parentheses. The retained three-rule combination is therefore justified by its combined measurement, not by three independently positive savings.

| Full-strength comparison | Before | After | Saving |
| --- | ---: | ---: | ---: |
| Bare arrow parameters → parenthesized parameters alone | 13,312 | 13,309 | 3 |
| Exponential literals → canonical numbers alone | 13,312 | 13,312 | 0 |
| Key quoting except `length` | 13,312 | 13,271 | 41 |
| Add arrow parentheses to key quoting | 13,271 | 13,271 | 0 |
| Add exponent expansion to that combination | 13,271 | 13,264 | 7 |
| **Complete retained pass** | **13,312** | **13,264** | **48** |

Identical-output controls—such as forcing the already-used double quotes—needed no separate full build. No Roadroller parameter search was used to rescue a candidate.

## The retained transformation

Examples illustrate the changed spellings:

```js
// Before
var f=t=>({x:t,length:1});
var limit=1e3;

// After
var f=(t)=>({"x":t,length:1});
var limit=1000;
```

The pass deliberately keeps the `length` key bare. This is a measured choice for the current five-abbreviation configuration, not a reserved JavaScript or browser-API requirement.

Acorn identifies the source spans to edit. The pass then changes only those spans, from the end of the source backward, retaining every other character. Acorn was already installed through existing dependencies and is now explicitly declared as a build dependency. No game-runtime dependency was added.

Quoted explicit keys preserve their property names and computed/noncomputed status. Shorthand properties remain untouched. Parentheses surround only a bare identifier parameter; existing parenthesized parameters and more complicated parameter syntax remain unchanged.

Numeric expansion uses the parsed finite Number value and its canonical spelling. It skips BigInt and overflowing infinite literals, preserves a surrounding unary minus, adds a separator where needed after a keyword, and parenthesizes a numeric receiver when member-access syntax requires it. It does not alter arithmetic order or replace calculations with approximate constants. These distinctions matter under JavaScript's lexical rules. [10]

No further Terser compression or printing pass runs over this output. The HTML minifier does not reminify the embedded game program.

## Validation and limits

Validation covered the complete game and focused cases:

- The production hook's output exactly matches the measured winning candidate.
- Parsing before and after gives equivalent ASTs after normalizing only noncomputed property-key spelling and source-location/raw-text metadata. Numeric values, operators, bindings, evaluation order, and function bodies remain equal.
- Twenty-three differential runtime fixtures pass. They cover destructuring, shorthand, accessors, `__proto__`, computed properties, nested arrows, inferred names, numeric receivers, negative zero, underflow/overflow, BigInt, escaped identifiers, strings, regexes, and templates.
- Applying the pass twice produces the same result.
- The generated packed decoder recovers an AST-equivalent program.
- The actual fast and full Vite builds reproduce the measured sizes. Lint passes.

The decoder check captures the recovered program without running the game. It verifies packing consistency, rather than claiming an interactive browser playthrough. The round-trip uses a native Function with a capture-only `eval`. Existing gameplay suites were not run.

The whole-program AST comparison is particularly relevant to audio preservation: the sound sample calculations, preset values, random calls, and scheduling operations are unchanged. This result is syntax equivalence, not a subjective listening assessment.

## Further opportunities

The most useful next step after substantial game changes is to remeasure these three transformations both alone and together. Dictionary membership and the surrounding syntax distribution can change; a permanent guarantee of 48 bytes would be unjustified.

A bounded transformation search is more appropriate than blindly adding replacements. Parse once, construct independently selectable syntax rules, reject invalid or semantically unsafe candidates, and evaluate complete archives with fixed compressor settings. Keep actual full-build confirmation for close results and the retained final combination. Retain the smallest justified rule set rather than a long list of changes whose individual contributions are unknown.

Future hypotheses include selectively preserving additional abbreviated keys, trying alternate literal spellings in well-defined syntactic contexts, and studying parenthesis insertion around repeated expression shapes. Broad variants of these ideas lost in this pass; narrower variants need a new contextual reason and new measurements. No claim of a further saving is made here.

Whitespace padding and comments are weak starting points because Roadroller's preparation removes them. String-quote escaping also undergoes its own preparation step. Scope changes, reordering object properties, replacing strict comparisons with loose ones, and reordering arithmetic require semantic arguments beyond compression measurements. They should not be introduced through a blanket regex over minified code.

## Sources

1. BurntCustard/lifthrasiir, [Roadroller `index.mjs`, pinned fork commit](https://github.com/burntcustard/roadroller/blob/85f46f296b122648d997a7c015306164153916d0/index.mjs). Inspected through the matching installed source and local fork checkout. Remote branch hash verified separately. Relevant symbols: `Packer.prepareJs`, `SparseContextModel`, `WordContextModel`, `ContextualLogisticMixModel`, `DefaultModel`, `Packer.doPack`.
2. BurntCustard/lifthrasiir, [Roadroller README, pinned fork commit](https://github.com/burntcustard/roadroller/blob/85f46f296b122648d997a7c015306164153916d0/README.md). Installed/local source inspection; input preparation, payload/decoder distinction, SSE behavior, and rANS implementation references. GitHub's web-view fetch did not succeed; the matching local source supplied the contents.
3. P. Deutsch, [RFC 1951: DEFLATE Compressed Data Format Specification](https://www.rfc-editor.org/rfc/rfc1951), May 1996. Literal/match coding, history window, match limits, and Huffman blocks.
4. Google, [Zopfli repository and README](https://github.com/google/zopfli). Standard DEFLATE output and compatibility with existing decompressors.
5. Google, [Zopfli `squeeze.c`](https://github.com/google/zopfli/blob/master/src/zopfli/squeeze.c). Shortest-path cost optimization, repeated statistical estimates, and best-result retention. Also inspected the locally installed `node-zopfli-es` copy.
6. Google, [Zopfli `blocksplitter.c`](https://github.com/google/zopfli/blob/master/src/zopfli/blocksplitter.c). Split-cost evaluation and block selection.
7. Google, [Zopfli `deflate.c`](https://github.com/google/zopfli/blob/master/src/zopfli/deflate.c). Block/tree cost accounting and coding-type selection.
8. BurntCustard, [Fork `zopfli.mjs`, pinned commit](https://github.com/burntcustard/roadroller/blob/85f46f296b122648d997a7c015306164153916d0/zopfli.mjs). Matching installed-source inspection; adaptive 1/100/1,000-iteration scoring and thresholds.
9. Terser, [Options documentation](https://terser.org/docs/options/). `quote_keys`, `quote_style`, `semicolons`, and separation of compressor and formatting options.
10. Ecma International/TC39, [ECMAScript lexical grammar](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html). Numeric literals, token boundaries, strings, and template syntax.

Measurements were made on 13 September 2026. The CSV contains the observed archive sizes; source-based explanations and untested hypotheses are identified separately above.
