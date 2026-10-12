# Module specs

Place module specs in `core`, `offense`, or `utility` and export each complete
spec from that folder's `index.ts`. Keep shared family defaults (such as
`thruster.ts` and `shield.ts`) in the same folder without exporting them from
the index. Specs satisfy `ModuleSpec` and do not declare a `category`.

The main index assigns the folder's named category to its exported specs.
These static indexes work in both the browser build and the Node script that
generates the Go catalog. Moving a spec between folder indexes changes its
category; update any direct imports to its new path.

Register new modules in the main index and append their IDs to `moduleIds`.
Never reorder existing IDs: their indexes are used by saves and the binary
protocol. Keep `moduleSpecs` in that same order so `moduleSpecList` preserves
the wire order. Run `npm run catalog:go` after changing spec data.
