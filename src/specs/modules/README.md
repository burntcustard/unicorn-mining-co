# Module specs

Place module specs in `core`, `offense`, or `utility` and export each complete
spec from that folder's `index.ts`. The core power plant and thruster families
live in their own subfolders. Keep shared family defaults (such as `thruster.ts`
and `shield.ts`) beside their variants without exporting them from the index.
Every module has a mass that contributes to its ship's movement when installed.
Specs satisfy `ModuleSpec` and do not declare a `category`.

The main index assigns the folder's named category to its exported specs.
These static indexes work in both the browser build and the Node script that
generates the embedded server catalog. Moving a spec between folder indexes changes its
category; update any direct imports to its new path.

Register new modules in the main index and append their IDs to `moduleIds`.
Never reorder existing IDs: their indexes are used by saves and the binary
protocol. Keep `moduleSpecs` in that same order so `moduleSpecList` preserves
the wire order. Cargo regenerates the embedded catalog during the server build.
