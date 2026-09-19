---
name: build-size-analysis
description: Analyze Unicorn Mining Co.'s post-Terser JavaScript chunks, loading tiers, and 14 KiB warning threshold.
---

# Build size analysis

## Current pipeline

1. `npm run typecheck` runs the TypeScript 7 `tsc` binary with no emit.
2. `viteBuildPre` removes disabled `DEBUG` and `BENCHMARK` blocks, renames the
   selected shared words, and applies the other pre-minifier source rewrites to
   `.js` and `.ts` modules before Vite transforms them.
3. Rolldown tree-shakes and partitions the initial graph into semantic engine,
   gameplay, interface, rendering, and world groups. A dynamic import keeps
   `sound` outside that graph.
4. Oxc compresses and mangles local identifiers, then Terser runs with
   compression disabled to mangle properties using one cache shared by every
   chunk.
5. `viteBuild` inlines the entry in `index.html`, leaves the other chunks as
   normal files, adds the sound prefetch, and warns if any executable resource
   exceeds 14,336 bytes.

No packer, archive, compressed-size estimator, or ZIP stage is part of the
build. Vite empties and regenerates `dist/`.

## Measuring a build

Use `npm run build` while iterating. Vite's normal output summary lists each
external file once. Loading triggers are documented in `CHUNK_LOADING.md`.

The inlined entry does not exist as a separate file in `dist/`, but its size is
still checked for a warning. Exact external file sizes can be confirmed with:

```bash
find dist -maxdepth 1 -name '*.js' -printf '%f %sB\n' | sort
```

When comparing a change, sum all JavaScript resources as a secondary metric and
also compare the largest resource. Hash changes do not imply code-size changes.

## Understanding ownership

The semantic groups live in `vite.config.js`. Rolldown applies its `maxSize`
before Terser, so that value is a source-size partitioning hint, not the 14 KiB
warning threshold. The post-Terser plugin check is authoritative.

When a category is too large, Rolldown may emit numbered or hashed siblings with
the same prefix. If a module appears in an unexpected resource, temporarily
enable Vite sourcemaps and inspect the chunk's `moduleIds` in a diagnostic
plugin. Do not infer ownership from the hash.

## Loading analysis

- The entry is inlined and runs as a module after parsing.
- Its static dependencies are emitted as initial chunks and module-preloaded by
  Vite. They must all be available before the entry evaluates.
- `sound` is prefetched at low priority but not evaluated by prefetch.
- The first keyboard gesture calls the facade's dynamic import, evaluates the
  sound chunk, and unlocks Web Audio.

Keep `CHUNK_LOADING.md` synchronized whenever a dynamic boundary or trigger is
added, removed, or reordered.
