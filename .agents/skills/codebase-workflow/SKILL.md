---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

## Project rules

- Every production JavaScript resource should target at most 14 KiB (14,336
  UTF-8 bytes) after minification. The build warns rather than fails above that size,
  and the inline entry counts as one JavaScript resource.
- Do not modify generated files in `dist/` by hand; produce them with a build.
- Never shorten names of variables, properties, or functions. The production
  minifiers do that.
- Prefer one options object with named properties over multiple positional
  parameters when designing or changing helper APIs.
- Preserve the loading tiers and document new triggers in `CHUNK_LOADING.md`.
- A static import joins the initial load. Use `import()` only when code has a
  concrete later trigger and can safely initialize at that time.
- For optimization, minification, or code-golfing work, use the code-golfing
  skill too.

## Before and after a code change

- Do not build for comment-only or whitespace-only edits.
- Before a functional change, run `npm run build` and record the affected
  chunk sizes and the largest chunk. The build report is the source of truth.
- Run the relevant tests and `npm run lint` after source or configuration
  changes. Report lint only when it fails.
- After editing, run `npm run build` again and compare the same resources.
- Report raw per-resource sizes and deltas. Do not report ZIP, Roadroller, gzip,
  or Brotli estimates as the acceptance metric.
- The same Oxc plus Terser-mangling production build is used for iteration and
  release checks.

## TypeScript

- TypeScript 7 runs through `npm run typecheck` before every production build.
- Vite handles JavaScript and TypeScript module transforms. Source can migrate
  from `.js` to `.ts` incrementally.
- Prefer inferred types. Add annotations only when TypeScript cannot infer a
  useful type from the initializer or surrounding context, such as exported
  function parameters.
- Let obvious return types be inferred; do not annotate `void` just to state
  that a function returns nothing.
- Keep `module: preserve` and `moduleResolution: bundler` unless the browser
  bundling model changes.
