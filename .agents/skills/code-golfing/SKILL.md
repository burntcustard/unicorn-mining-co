---
name: code-golfing
description: Reduce Unicorn Mining Co.'s production JavaScript while preserving its loading behavior.
---

# Code golfing

Read `docs/CHUNK_LOADING.md` before moving code across an import boundary. Measure
with `npm run build`; size policy and loading tiers live there.

- Compare the affected gzip chunk, initial-tier total, and request count; a
  saving in one resource can merely move cost elsewhere.
- Keep dynamic imports only for real later triggers. Sound and docked UI have
  established lazy-loading behavior.
- Property mangling cannot safely follow names constructed at runtime. The build annotates
  constant checkpoint keys in `entity-state.ts` with `@__KEY__`; protect reflected/external names
  explicitly. Quoting or concatenating strings does not reserve a name, since
  the bundler can fold those expressions before mangling.
- Run strictly-relevant tests and lint after a change.
