---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

## Project rules

- Full builds must keep `dist/game.zip` under 13,312 bytes.
- Do not modify generated files in `dist/` by hand; produce them with the build command.

## Before and after making a code change

- Use `npm run build:fast` for a single-line or small, localized change.
- Use `npm run build:slow` for multi-file changes, refactors, new gameplay behavior, or build-system changes.
- Before editing, run the appropriate build and record the ZIP size as the baseline.
- Run `npm run lint` after source or configuration changes.
- After editing, run the same build again and compare its ZIP size with the baseline.
- Fast, slow, and full builds pass Roadroller the fixed seed `13312`, so compare their ZIP sizes directly.
- Use `npm run build:full` for reproducible release output and confirm `dist/game.zip` is under 13,312 bytes. `npm run build` is an alias, but prefer the explicit command.
- At the end of the competition, we can use repeated `npm run build:full-random` builds to search for a smaller final ZIP that must be under 13,312 bytes.
