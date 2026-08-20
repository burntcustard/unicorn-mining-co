---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

## Project rules

- Only full builds must keep `dist/game.zip` under 13,312 bytes.
- Do not modify generated files in `dist/` by hand; produce them with the build command.

## After making a code change

- Run `npm run lint` after source or configuration changes.
- Use `npm run build:fast` for a single-line or small, localized change.
- Use `npm run build:slow` for multi-file changes, refactors, new gameplay behavior, or build-system changes.
- For size-relevant changes, record the ZIP size before editing and compare it with the same build type afterward.
- Roadroller is nondeterministic, so treat small size differences as noise, and for reliable results, compare 5 builds.
- Use `npm run build:full` for release output and confirm `dist/game.zip` is under 13,312 bytes. `npm run build` is an alias for this but you should run `npm run build:full` to make it clear.
