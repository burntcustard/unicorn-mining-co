# Measurement commands

All commands run from the repository root. The before-build sticky source,
binary, and dist tree were frozen under `/tmp/unicorn-receipt-baseline` before
policy experiments. Production `game-session.go` was never changed by this
comparison; compiler overlays supply candidates. The final production source
hash and resource comparison are retained under `results/checks/`.

## Deterministic and permanent jitter tests

```sh
npm run build > /tmp/unicorn-receipt-build-before.log 2>&1
RECEIPT_MARGIN_BASELINE=/tmp/unicorn-receipt-baseline \
  node benchmarking/tools/receipt-margin.ts > /tmp/unicorn-receipt-margin-sweep.log 2>&1
GOEXPERIMENT=simd go test ./src/server/network -run '^TestSnapshot' -count=1 -v
GOEXPERIMENT=simd go test \
  -overlay=/tmp/unicorn-receipt-policies/margin4/updated-tests-overlay.json \
  ./src/server/network -run '^TestSnapshotReceiptJitter$' -count=1 -v
```

The last command is an expected failure. Its candidate test source removes only
the obsolete `receiptLag` field assertions to compile the stateless overlay;
cadence, caps, stalls, recovery deadlines, and reset assertions are preserved.
The reusable runner's default baseline was subsequently made portable by using
`src/server/network` instead of a private `/tmp` directory. The exact runner used
and its final version are both retained.

## Real TCP CPU

`sources/tcp/main.go.txt` restores the earlier production-GameServer transport
harness. Compile sticky and each margin using the matching compiler overlay:

```sh
CGO_ENABLED=0 GOEXPERIMENT=simd go build -trimpath \
  -pgo=src/server/default.pgo \
  -overlay=/tmp/unicorn-receipt-policies/margin4/overlay.json \
  -o /tmp/unicorn-receipt-tcp-margin4 /tmp/unicorn-receipt-tcp-main.go
node benchmarking/local/receipt-margin/tcp-sweep.ts \
  > /tmp/unicorn-receipt-tcp-sweep.log 2>&1
```

The sticky compile omits `-overlay`; margins 2/3 replace the margin4 names.
The retained driver builds no binaries during capture. It fixes two physical
cores, `GOMAXPROCS=2`, `GOGC=200`, 32 clients, flight, zero added delay, 120 warmup
and 300 measured ticks. Three repetitions rotate sticky/margins 2/3/4 order.
The Go child owns a private kernel-selected TCP listener for this internal
transport harness; browser tests use the standard 3000/3001 pair throughout.

## Browser captures

No servers were running before this session. The investigation started and later
stopped its own standard Go/Vite services:

```sh
GOGC=200 GOMAXPROCS=2 \
  GOFLAGS=-overlay=/tmp/unicorn-receipt-browser/overlay.json \
  DATABASE_PATH=/tmp/unicorn-receipt-browser/world.sqlite npm run dev:server
npm run dev -- --strictPort
INPUT_RESPONSE_HEADFUL=1 COMBAT_RESPONSE=1 \
  node benchmarking/tools/input-response-browser.ts \
  benchmarking/local/receipt-margin/browser-sticky-combat.json.gz 0 chrome
INPUT_RESPONSE_HEADFUL=1 node benchmarking/tools/stall-browser.ts \
  benchmarking/local/receipt-margin/browser-sticky-stall.json.gz 50 network
```

The browser overlay maps real `game-session.go` to `/tmp/.../active.go`. Each
variant also applies the same docked-spawn fixture from the combat investigation:
fresh accounts use the authoritative station respawn pose, then buy/fit equipment,
launch and charge through normal gameplay. Receipt policy is the only difference
between server variants. To switch policies, copy its retained source to active.go
and touch the real source to notify the existing dev-server watcher; wait for a
fresh listening message before capturing. No build runs during a capture.

Run the stall command for sticky, margin2, margin3, and margin4, and combat for
sticky and margin4. All stateless variants already fail deterministic jitter;
combat verifies ordinary local feedback for the closest candidate. The stall
probe preserves original outgoing WebSocket application order when resuming;
it measures scheduled/application events, not wire transit. Its sparse inputs
make p95/p99 descriptive maxima, not statistically reliable tail estimates.

## Final checks

```sh
npm run build
npm run test -- --skip-build
npm run lint
npm run format:go:check
GOEXPERIMENT=simd node benchmarking/tools/go-transport-check.ts --race
```

The retained check logs record actual outcomes. The browser fixture is removed
by stopping the owned dev service; the final production build uses no overlay.
