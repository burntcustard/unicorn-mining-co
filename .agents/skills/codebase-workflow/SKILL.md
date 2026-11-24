---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

- Read `docs/chunk-loading.md` before changing imports, chunks, or loading triggers.
- Use static imports for first-frame code and `import()` only for a concrete
  later trigger. Document loading-trigger changes in `docs/chunk-loading.md`.
- Before adding or renaming serialized fields or app-owned properties, review
  `plugins/property-names.ts`. Add names Terser leaves long, one per line;
  avoid native APIs; quoted import paths are protected by the source rewrite regex.
- Before changing gameplay tag literals, review `plugins/protocol-tags.ts` for
  short client replacements. Stable wire IDs live in `src/specs/protocol.ts`.
  Run `npm run test snapshot server-integration` when changing the wire contract.
- Lazy modules expose a typed `default` API object, loaded as in `sound-loader`.
- Test lazy features with separately emitted production chunks and exercise
  their real loader. A test that bundles both sides into one file does not
  validate the boundary; see the production docking fixture in `scripts/check-ui.ts`.
- After changing a lazy module boundary, inspect the production importer and
  imported chunk to confirm the API names agree, then exercise the
  loading trigger.
- Prefer named options objects to multiple positional helper arguments.

Keep shared game data and authored schemas in `src/specs`, with runtime logic
beside its owner. Use the [content-authoring workflow](references/content-authoring.md)
for spec defaults, viewer checks, and procedural sector changes.

For functional source or configuration changes, run `npm run build` before and
after, plus relevant tests and `npm run lint` afterward. Report changed resource
sizes. Skip the build for comment or whitespace-only changes.
For standalone changes to existing values in `src/specs`, skip builds, tests,
and lint unless the user requests them.

TypeScript runs through `npm run typecheck` before production builds. Prefer
inference unless an annotation is required to clarify an exported API.

Vite production CSS passes through PurgeCSS. Its scan covers client HTML,
TypeScript, SVGs, and shared specs. When adding a class for a lazy screen or
a dynamic row, verify it survives in the production stylesheet.

Test visual effect rendering with synthetic specs covering each part type
and its supported properties. Do not assert the colors, sizes or timing of
individual effect specs; those are visual design choices edited in data.

## Testing references

Use the [testing workflow](references/testing.md) for selective runs,
production and parity fixtures, browser test setup, and movement telemetry.
Keep Vite's proxy to the authoritative Rust server when testing the browser.
