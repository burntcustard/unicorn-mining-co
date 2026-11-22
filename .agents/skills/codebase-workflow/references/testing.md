# Testing workflow

## Select and run checks

- `npm test` builds the client and server, prepares fixtures, and runs the
  TypeScript suites. Pass a test name, filename, or directory to narrow the
  run. Use `npm test -- --skip-build` with current production artifacts.
- `npm run test:server` runs Rust unit and world integration tests, loopback
  transport checks, TypeScript parity, and server integration.
- `npm run test snapshot server-integration` checks server output with both
  source and production-mangled codecs and reports real WebSocket packet sizes.
  The optional local WebRTC movement channel uses UDP port 3001 for nearby
  ship poses during snapshot stalls. The WebSocket carries authoritative
  simulation, inputs, and snapshots. Use `MOVEMENT_DISABLED=1` for
  WebSocket-only testing.
- Network tests use isolated sessions, temporary databases, and ephemeral
  listeners so they can exercise real timeouts in parallel. Set
  `TEST_CONCURRENCY=1` to run Node tests sequentially.
- `npm run typecheck` and `npm run lint` check TypeScript source, tests, scripts,
  and benchmark tools. The test runner also type-checks where needed. Scripts
  use the project's Node 26 setup.

## Fixtures and authored tuning

Production fixtures share a property-name cache generated from current
sources. Each bundle still uses the production transforms and minifier.
Feed large packet histories as runtime JSON with transformed property names.
The runner removes its temporary cache when testing finishes.

`npm test -- projectile-prediction` selects autogun, plasma, repeated mining,
and triangle fracture suites. Use a suffixed test filename for one suite.
Drivers produce authoritative Rust snapshots for the corresponding source and
production client fixtures. Timing cases sample zero, one, three, and eight
ticks of delay across different geometries, along with batched frames,
reloads, and display pauses. Repeated mining checks five fractures and a
reload. Muzzle-flash tests replay two firing cycles with immediate, delayed,
and paused firing. The same cases run for development and deployment.

Use the nearby `example-*.ts` module specs for mechanics tests. Their geometry,
damage, and timing are independent of playable balance. They stay out of
category exports and the production catalog. Client tests install them with
`tests/support/example-modules.ts` in an isolated process using existing wire
slots. The runner calls `scripts/generate-example-modules.ts` for the matching
Rust catalog. Derive synthetic weapon variants from
`offense/example-weapon.ts` to exercise optional behavior. Test that playable
constructors consume their specs and use synthetic specs to cover visual
effect parts and properties.

Cross-language scenarios live in `tests/parity/scenarios`. The generator
`tests/parity/generate-fixtures.ts` writes results to `tests/fixtures`.
Treat scenario masses, seeds, coordinates, health values, and tick counts as
test inputs. Item construction and HTTP handling use direct tests.

## Browser tests

Finish `npm run build` before capturing or running the production UI fixture.
Inspect processes and listening ports to find the server and frontend for this
checkout, then reuse them. Allow watcher rebuilds and Vite reloads to finish
before judging a change. Restart only the affected service when a specific
problem requires it, and explain the reason first.

Start missing services with `npm run dev:server` (port 3001) and
`npm run dev -- --strictPort` (port 3000). A running production preview also
works. If a preview is needed and none is running, use
`npm run preview -- --strictPort`. Keep the normal proxy. Avoid `PORT`,
`GAME_SERVER_URL`, and alternate-port overrides for browser tests. Report
conflicts on required ports. Stop only the temporary services and browser
automation started for the test session. Leave replacements for user-owned
services running after a necessary troubleshooting restart.

Documentation and workflow edits need no browser services.

Run `npm run test:ui` after setup. Browser tests intercept static requests to
serve the built files, sending API and WebSocket requests through the normal
proxy. Set `CHROME_BIN` if Chromium uses a different executable name.

| Environment variable | Scope when set to `1`                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `UI_MENU_ONLY`       | Startup and menu loading                                                                     |
| `UI_DOCK_ONLY`       | Docking fixture                                                                              |
| `UI_HANGAR_ONLY`     | Hangar transactions, names, sale confirmation, keyboard navigation, paint, and empty hangars |
| `UI_HUD_ONLY`        | Static desktop HUD scenes                                                                    |

Set `UI_CAPTURE_DIR` to retain screenshots and geometry.

## Movement telemetry

Toggle telemetry with **V**, rebindable under Settings → Controls. It starts
off on each page load. While visible, `.hud-telemetry` refreshes at the 30 Hz
simulation cadence. Simulation shows the fixed-tick pose and native motion.
Rendered shows the displayed world pose and screen position in CSS viewport
pixels. The transform uses camera motion, zoom, canvas resolution, and viewport
offset. Frame time measures the interval between frames. Render time measures
CPU work inside the render callback, excluding telemetry refresh and GPU
completion.

Read visible text. Scope `.telemetry-player` and `.telemetry-target` to
`.telemetry-simulation` or `.telemetry-rendered`. The simulation group also
includes `.telemetry-closest` and `.telemetry-parent`. Distances are
center-to-center, and the closest-object and target rows show radius.
Positions are in meters, angles in radians, velocities in meters per second,
and spin in radians per second. Movement values have three decimal places.

Native motion excludes station-carried motion. When present,
`localMovementRate` is a dimensionless blend rate and `Carrier #` identifies
another record in the same panel. Shared parents appear once. A selected
parent uses the target record.

The tick and whole-second simulation time identify the sampled world update.
Snapshot age is elapsed time since the latest accepted server snapshot and
is unavailable before the first one. Missing or disconnected entities show
explanatory text. Check `hidden` before reading retained text because sampling
and DOM updates stop while the panel is hidden.

Settings → Graphics → Hide UI makes the in-game HUD container transparent and
persists across reloads. Its panels, chat, meters, controls, and telemetry
remain in the DOM. Menus, settings, and the docked UI remain visible.
