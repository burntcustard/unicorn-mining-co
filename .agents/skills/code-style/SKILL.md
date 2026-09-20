---
name: code-style
description: Apply Unicorn Mining Co.'s local source-style conventions when writing or refactoring code.
---

# Code style

- Represent positions, offsets, velocities, and other `{ x, y }` values with
  the project's `Vector` and its helpers wherever possible.
- Declare at most one TypeScript `interface` per file. Move another public
  interface to the file that owns it; use a local type alias for a private
  shape when a separate interface would add no value.
- Format documentation comments above functions as multiline comments, even
  when their text fits on one line.
