---
name: code-golfing
description: Shrink Unicorn Mining Co.'s production JavaScript resources toward a 14 KiB-per-resource target.
---

# Code golfing

Size is judged by the final post-minification UTF-8 byte count of each executable resource.
The target is 14 KiB (14,336 bytes) per resource, including the JavaScript
inlined into `index.html`; exceeding it produces a warning, not a failed build.
Total transferred bytes and request count are useful secondary measures.

Read `CHUNK_LOADING.md` before moving code across an import boundary. For
pipeline details and chunk accounting, use the build-size-analysis skill.

## How to measure

- Run `npm run build` before and after a candidate. Vite prints each
  external output once; `CHUNK_LOADING.md` records its trigger.
- Compare the affected chunk, the largest chunk, and total JavaScript bytes.
  A local saving can merely move import/export glue into another resource.
- Change one idea at a time. Record the candidate, before/after sizes, retained
  or reverted status, and behavior checks.
- Use the same Oxc plus Terser-mangling production build for iteration and
  release checks so every measurement is directly comparable.
- Compression ratios are deployment diagnostics, not the code-golf score.
- Preserve behavior and loading timing unless the user authorizes a change.
  Documentation-only changes need no build.
- Run relevant tests and `npm run lint` afterward.

## Chunk-boundary pitfalls

- Static imports execute before their importer and are part of the initial
  graph. Dynamic `import()` is the boundary for later execution.
- A lazy facade must not itself start loading from a frame-loop call. Give the
  load a real trigger, cache its promise, and decide explicitly whether calls
  made while loading are queued or dropped.
- Shared modules can add import/export glue or create circular chunks. Always
  inspect the emitted files and run the game after changing a grouping rule.
- Prefetch downloads without intentionally executing. Use it only for a likely
  next chunk; prefetching every lazy chunk makes the download eager again.
- ES module scripts are deferred automatically. Classic blocking scripts,
  `async`, and `defer` are not substitutes for a module dependency graph.

## Property-mangling pitfalls

`plugins/vite-build.js` mangles every property name Terser can find. It renames literal
property access consistently, but cannot follow a value used as a computed key.
An object written as `object[key]` and read as `object.Up` can therefore break.
The shared `nameCache` in the Terser options is also required so independently
minified chunks use the same mangled name for cross-chunk properties.

Write concrete occurrences of computed or external property names with quoted
property syntax so Terser's `keep_quoted` option leaves them unchanged. Terser
also protects standard JavaScript and DOM/browser API properties by default.
Verify the production build, not only dev mode.

## Audio invariant

Finish filling every `AudioBuffer` sample before assigning the buffer to a
source. Reversing that order can play silence in Firefox despite passing Node
and Chromium checks. Keep the real implementation in `sound.js` and the
interaction-triggered facade in `sound-loader.js`.

## What tends to work

- Delete unused code, properties, arguments, and return values.
- Inline a simple local used once or twice, while measuring whether a longer
  repeated expression was cheaper.
- Prefer truthy checks and omitted properties when falsy values are equivalent.
- Share genuinely substantial repeated bodies; tiny helpers often cost more in
  calls and cross-chunk exports than they save.
- Keep readable source names and let the production minifiers mangle them.
- Put optional code behind an existing real-world trigger when doing so also
  improves startup behavior.

## Areas to avoid

- Do not golf `scripts/world-preview.js`, `src/benchmark.js`, or code removed by
  the production `DEBUG`/`BENCHMARK` pass.
- The text glyph data is already highly optimized.
- Avoid moving code into `main.js` unless it materially improves a measured
  chunk, because the inline entry should remain understandable.
