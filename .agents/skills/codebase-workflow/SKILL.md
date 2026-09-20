---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

- Read `CHUNK_LOADING.md` before changing imports, chunks, or loading triggers.
- Use static imports for first-frame code and `import()` only for a concrete
  later trigger. Document loading-trigger changes in `CHUNK_LOADING.md`.
- Prefer named options objects to multiple positional helper arguments.

For functional source or configuration changes, run `npm run build` before and
after, plus relevant tests and `npm run lint` afterward. Report changed resource
sizes. Skip the build for comment or whitespace-only changes.

TypeScript runs through `npm run typecheck` before production builds. Prefer
inference unless an annotation is required to clarify an exported API.
