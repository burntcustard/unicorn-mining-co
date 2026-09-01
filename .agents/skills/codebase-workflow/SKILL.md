---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

## Project rules

- The finished entry has to fit in 13,312 bytes, but going over while building a feature out is fine; it gets golfed back down afterwards.
- Do not modify generated files in `dist/` by hand; produce them with the build command.
- Never shorten names of variables, properties, functions, etc. Terser will do that for us.
- For optimizing, minifying or code-golfing work, use the code-golfing skill.

## Before and after making a code change

- Do not run a build at all if you are only editing comments, whitespace, or other non-functional changes.
- Use `npm run build:fast` for a single-line or small, localized change.
- Use `npm run build:slow` for multi-file changes, refactors, new gameplay behavior, or build-system changes. It runs 100 advzip iterations, making its results more representative of the 1,000-iteration full build while remaining faster.
- Before editing, run the appropriate build and record the ZIP size as the baseline.
- Run `npm run lint` after source or configuration changes, but only report it if it fails.
- After editing, run the same build again and compare its ZIP size with the baseline.
- Report only the before/after advzip sizes and difference; omit the unoptimized ZIP and pre-Roadroller sizes.
- All builds pass Roadroller the fixed seed `13312`, so compare their ZIP sizes directly.
- Do not use `npm run build:full` for before/after comparisons while golfing or iterating: it runs far more Terser passes, is too slow for quick iteration, and its absolute size is not the number to chase mid-session. Only use it when a full build is explicitly requested, to check a release. `npm run build` is an alias, but prefer the explicit command.
- At the end of the competition, we can use repeated `npm run build:full-random` builds to search for a smaller final ZIP.
