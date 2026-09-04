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
- Use `npm run build:fast` for small, localized changes and size comparisons while iterating. It runs 10 advzip iterations, making its results quick while still reflecting real recompression.
- Before editing, run the appropriate build and record the ZIP size as the baseline.
- Run `npm run lint` after source or configuration changes, but only report it if it fails.
- After editing, run the same build again and compare its ZIP size with the baseline.
- Report only the before/after advzip sizes and difference; omit the unoptimized ZIP and pre-Roadroller sizes.
- Roadroller always runs with the same fixed encoder parameters, so ZIP sizes are directly comparable across builds.
- Do not use `npm run build:full` for before/after comparisons while golfing or iterating: it runs far more Terser passes, is too slow for quick iteration, and its absolute size is not the number to chase mid-session. Only use it when a full build is explicitly requested, to check a release, or for larger changes. `npm run build` is an alias, but prefer the explicit command.
- `npm run build:search` doesn't produce a ZIP; it builds `dist/minified.js` like `build:full` and then runs an indefinite Roadroller CLI search for better encoder parameters. Only run it when the user explicitly asks to search for parameters, since it never terminates on its own.
