---
name: code-style
description: Apply Unicorn Mining Co.'s local source-style conventions when writing or refactoring code.
---

# Code style

- Use TypeScript (`.ts`) for authored scripts and tests.

- Use American English (`en-US`) in game text, identifiers, comments, tests, and
  documentation. Specify `en-US` for locale-sensitive formatting.

- Specify visual alpha as a number from 0 to 1, including glow stops and
  `fillAlpha`. Use `withAlpha` from `src/client/utilities/color` when a canvas
  color needs opacity; do not append hex alpha digits to color strings.
  CSS color alpha also uses a number from 0 to 1.
- Use seconds for CSS transition and animation durations and delays.
- Specify JavaScript visual effect durations, delays and fade durations in
  milliseconds. Convert frame seconds to milliseconds at the effect update boundary.

- Prefer native array methods such as `filter`, `map`, `find`, `some`, and
  `includes` over one-off collection helpers. Use `filter` for removals when
  replacing the array is safe; preserve shared array identity with native
  mutation methods when other objects retain references to that array.
- Keep general-purpose helpers in `src/client/utilities` or `src/server/utilities`; put object-specific
  behavior on its owning class rather than in standalone helper files.
- Represent positions, offsets, velocities, and other `{ x, y }` values with
  `import * as Vec from '.../vector'`, using `Vec.create` and its operations.
  Pass an output vector when an existing object's identity must be preserved.
- Let local vector types be inferred. Use `Vec.Value` for parameters, fields,
  and public shapes that need an explicit type; it shares the `Vec` import.
- Declare at most one TypeScript `interface` per file. Move another public
  interface to the file that owns it; use a local type alias for a private
  shape when a separate interface would add no value.
- Format documentation comments above functions as multiline comments, even
  when their text fits on one line.
- Do not create pass-through modules whose only purpose is importing and
  re-exporting one implementation. Import directly from the file that owns the
  implementation. Coherent public barrel modules that export several related
  APIs are still appropriate.

## CSS and UI

- Leave blank lines between rules and at-rule blocks, including nested rules.
  Keep each comment with the block it describes.
- Use the `text-xs`, `text-sm`, `text-lg`, and `text-xl` utilities for UI font
  sizes. Inherit the base size where possible. Define font-size utilities in
  `utilities.css`. Use `rem` for font sizes and the `font` shorthand. A
  responsive `clamp()` can use `vw` between its `rem` limits. Stylelint rejects
  pixel font sizes and `cursor` declarations.
- Keep child and state rules together with native CSS nesting. Shared controls
  use `ui-` names such as `ui-button`, `ui-tab`, and `ui-input`. Keep HUD,
  docking, and chat layout in their `hud-`, `dock-`, and `chat-` families.
- Compose layout with utilities such as `flex items-center justify-between gap-3`.
  Use `data-action-group` for keyboard navigation within a group of buttons.
  Keep reusable spacing utilities in `utilities.css`, including unused sizes
  in an existing family.
- Keep browser resets in `src/reset.css`, imported before game and tool styles.
  Keep colors, typography choices, and layout in their own stylesheets. The UI
  targets current Firefox and Chrome.

## Formatting tools

Use `npm run format:check` for a read-only check. For scoped edits, use Oxfmt
with `.oxfmtrc.json`, Oxlint with `.oxlintrc.json`, and Stylelint with
`.stylelintrc.json`. The CSS check covers `src` and `font`. Use
`npm run lint:css` for CSS alone. `npm run format` and `npm run lint:fix`
can apply CSS spacing fixes across the project.

Rust uses the default rustfmt style and Clippy lints. `npm run lint` includes
both. Use `npm run lint:rust` to check Rust alone and
`rustup component add rustfmt clippy` if those tools are missing.
