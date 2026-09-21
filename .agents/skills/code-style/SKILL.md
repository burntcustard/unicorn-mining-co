---
name: code-style
description: Apply Unicorn Mining Co.'s local source-style conventions when writing or refactoring code.
---

# Code style

- Represent positions, offsets, velocities, and other `{ x, y }` values with
  the project's `Vector` and its helpers wherever possible.
- Type vector values with the exported `Vector` type instead of deriving
  `ReturnType<typeof Vector>`. When the factory and type share an import, alias
  the type as `VectorValue`.
- Declare at most one TypeScript `interface` per file. Move another public
  interface to the file that owns it; use a local type alias for a private
  shape when a separate interface would add no value.
- Format documentation comments above functions as multiline comments, even
  when their text fits on one line.
- Do not create pass-through modules whose only purpose is importing and
  re-exporting one implementation. Import directly from the file that owns the
  implementation. Coherent public barrel modules that export several related
  APIs are still appropriate.
