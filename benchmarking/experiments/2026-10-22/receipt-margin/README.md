# Stateless receipt-margin comparison

See the [report](../../../../docs/experiments/2026-10-22/receipt-margin.md)
for the decision and measurement limits. Margins 2, 3, and 4 were tested and
rejected; production retains sticky receipt lag and one-second recovery.

- `results/deterministic/`: all 60 authoritative-session scenarios, their source
  manifest, and completed-sweep summary. `healthyCadencePass` is the acceptance
  result; a successful sweep executable does not make every candidate acceptable.
- `results/tcp/`: 12 serial 32-player TCP runs and a compact summary. CPU excludes
  the Node client process. ACK percentiles in the summary are medians of each
  run's worst-client percentile; receipt rates are medians of client means.
- `results/browser/`: visible-window Chrome captures with the normal local
  Go/Vite proxy. Combat uses 20 steering and 20 ready-autogun trials; all four
  policies have a network-stall capture at 50 ms each way. Analysis files derive
  from the corresponding raw captures and retain missing observations.
- `results/checks/`: builds, full validation, passing sticky jitter tests, and
  expected candidate failures. `margin4-new-tests.log` fails intentionally and
  demonstrates why that candidate was rejected.
- `sources/`: exact compiler input variants, generated logical-tick harness,
  browser fixture, TCP harness/client/driver, instrumented browser tools,
  regression tests, and the runner used for measurement. Source uses `.txt`
  extensions to keep historical snapshots out of active builds and linting.
- `commands.md`: measurement/reproduction commands and fixture details.
- `SHA256SUMS`: hashes of retained files other than this checksum file.

The baseline includes the uncommitted input fixes from the preceding experiments,
at repository HEAD `47ee8f14e2eceb4f440a523da98d8056215a5fd4`; it is **not** a clean
checkout of that commit. Exact source snapshots distinguish it. Original absolute
scratch paths and executable hashes are retained as measurement metadata; remap
the compiler overlay paths when reproducing elsewhere. No live deployment was
modified. No database, player tokens, or browser profiles are retained here.
