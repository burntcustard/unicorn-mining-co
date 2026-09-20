---
name: code-golfing
description: Reduce Unicorn Mining Co.'s production JavaScript while preserving its loading behavior.
---

# Code golfing

Read `CHUNK_LOADING.md` before moving code across an import boundary. Measure
with `npm run build`; size policy and loading tiers live there.

- Compare the affected gzip chunk, initial-tier total, and request count; a
  saving in one resource can merely move cost elsewhere.
- Keep dynamic imports only for real later triggers. Sound and docked UI have
  established lazy-loading behavior.
- Property mangling cannot safely follow computed keys. Quote properties used
  as computed or external names so Terser's `keep_quoted` protection applies.
- Run strictly-relevant tests and lint after a change.
