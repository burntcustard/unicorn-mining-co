---
name: codebase-workflow
description: Apply Unicorn Mining Co.'s project-specific rules and checks when changing the codebase.
---

# Codebase workflow

- Read `CHUNK_LOADING.md` before changing imports, chunks, or loading triggers.
- Use static imports for first-frame code and `import()` only for a concrete
  later trigger. Document loading-trigger changes in `CHUNK_LOADING.md`.
- Keep production object properties and wire keys unchanged. Do not reintroduce
  property mangling or regex-based identifier rewriting: a shared Terser name
  cache does not share quoted-property reservations between chunks.
- Lazy modules expose a typed `default` API object, loaded as in `sound-loader`.
- Test lazy features with separately emitted production chunks and exercise
  their real loader. A test that bundles both sides into one file does not
  validate the boundary; see `tests/lazy-docked.test.mjs`.
- After changing a lazy module boundary, inspect the production importer and
  imported chunk to confirm the API names agree, then exercise the
  loading trigger.
- Prefer named options objects to multiple positional helper arguments.

For functional source or configuration changes, run `npm run build` before and
after, plus relevant tests and `npm run lint` afterward. Report changed resource
sizes. Skip the build for comment or whitespace-only changes.

TypeScript runs through `npm run typecheck` before production builds. Prefer
inference unless an annotation is required to clarify an exported API.

## Local browser testing

- Before a browser testing session, inspect host processes and listening ports.
  Stop all existing game servers and Vite dev/preview servers belonging to this
  checkout, including any on alternate ports. Confirm ownership from the command
  and working directory; do not stop unrelated applications just because they
  occupy a desired port. Stop watcher parents as well as their server children
  so they cannot restart the old server, and verify the ports are released.
- Start one fresh game server with `npm run dev:server` (port 3001) and one
  frontend with `npm run dev -- --strictPort` (port 3000), or
  `npm run preview -- --strictPort` for production testing. Use the default
  WebSocket proxy; do not add `PORT`, `GAME_SERVER_URL`, or alternate-port
  overrides to testing commands. If an unrelated service blocks a default
  port, report the conflict instead of choosing another port.
- Reuse that pair throughout the investigation. Track the process sessions
  and stop them when testing finishes, including browser automation processes
  started for the investigation. Do not accumulate servers between attempts.
- Finish builds before starting browser captures so rebuilds and page reloads
  do not invalidate the run. Workflow-only edits do not require starting or
  stopping game servers.
