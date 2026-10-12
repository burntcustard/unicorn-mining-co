---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

- Read `docs/CHUNK_LOADING.md` before changing imports, chunks, or loading triggers.
- Use static imports for first-frame code and `import()` only for a concrete
  later trigger. Document loading-trigger changes in `docs/CHUNK_LOADING.md`.
- Before adding or renaming serialized fields or app-owned properties, review
  `plugins/property-names.ts`. Add names Terser leaves long, one per line;
  avoid native APIs; quoted import paths are protected by the source rewrite regex.
- Before changing gameplay tag literals, review `plugins/protocol-tags.ts` for
  short client replacements. They do not encode Go protocol strings. Stable
  wire IDs live in `src/specs/protocol.ts`; run `npm run test snapshot server-integration`
  when changing the wire contract.
- Lazy modules expose a typed `default` API object, loaded as in `sound-loader`.
- Test lazy features with separately emitted production chunks and exercise
  their real loader. A test that bundles both sides into one file does not
  validate the boundary; see the production docking fixture in `scripts/check-ui.ts`.
- After changing a lazy module boundary, inspect the production importer and
  imported chunk to confirm the API names agree, then exercise the
  loading trigger.
- Prefer named options objects to multiple positional helper arguments.

`src/specs` holds concrete game data and tuning shared by the client and the
Go server catalog, plus the schemas for that data. It is not a general home for
type or interface declarations. Put runtime types beside the implementation that
owns them; client-only visual effect options belong under `src/client/effects`,
even when a spec configures that effect. Spec files may reference these types
through type-only imports, but must not import client or server runtime code.
Regenerate `src/server/specs/catalog_gen.go` after spec data changes.
The Go server is the only authoritative server; preserve the normal Vite proxy.

For functional source or configuration changes, run `npm run build` before and
after, plus relevant tests and `npm run lint` afterward. Report changed resource
sizes. Skip the build for comment or whitespace-only changes.

TypeScript runs through `npm run typecheck` before production builds. Prefer
inference unless an annotation is required to clarify an exported API.

Test visual effect rendering with synthetic specs covering each part type
and its supported properties. Do not assert the colors, sizes or timing of
individual effect specs; those are visual design choices edited in data.

## Local browser testing

- Before a browser testing session, inspect host processes and listening ports.
  Confirm which game server and frontend belong to this checkout from their
  commands and working directories, then reuse the running `npm run dev:server`
  and `npm run dev` services at their existing URLs throughout the work.
- Let Vite reloads and the game server watcher apply changes. Wait for their
  reload or rebuild to finish and verify the updated behavior before considering
  a manual restart. Editing source or beginning a new testing session is not
  itself a reason to stop, restart, or duplicate a running service.
- Start a service only when a required one is missing, or restart only the
  affected service when evidence shows it is necessary, such as a failed
  watcher or a configuration change that requires a restart. Explain the
  concrete reason before acting. Preserve the user's running services,
  including any replacement needed for a necessary restart.
- When starting a missing service, use `npm run dev:server` (port 3001) and
  `npm run dev -- --strictPort` (port 3000). Use `npm run preview -- --strictPort`
  only when production testing requires it and no suitable preview is running.
  Preserve the normal WebSocket proxy; do not add `PORT`, `GAME_SERVER_URL`,
  or alternate-port overrides to testing commands. If a required port is
  occupied, report the conflict instead of stopping its service or choosing
  another port merely to make room for a new process.
- Track pre-existing services separately from temporary processes started for
  the investigation. When testing finishes, stop only those temporary processes,
  including browser automation; leave the user's services running. Do not
  accumulate servers between attempts.
- Finish builds before starting browser captures so rebuilds and page reloads
  do not invalidate the run. Workflow-only edits do not require starting or
  stopping game servers.
