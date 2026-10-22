# Additional Go server CPU reduction — October 22, 2026

This investigation starts from the optimized server in the
[compiler investigation](go-server-cpu-lowering.md), with production-source
SHA-256 `52303a73a689203ada16c7223097f22baacb91f05f5e6e463647a1b0ae70d7ad`.
Earlier savings are excluded from this comparison.

The retained changes save **24.23% additional process CPU** in the
complete existing TCP game benchmark. Every case improves by more than 20%.
The equal-case mean saving is **23.59%**; the paired bootstrap
95% interval for the ratio-of-sums result is **22.42–25.97%**.
This interval describes repeat variation on this machine, not hardware or
production-workload uncertainty.

| Players | Activity | Before CPU ms/tick | After CPU ms/tick | CPU saved | Before input ack p95 ms | After input ack p95 ms |
| ------- | -------- | -----------------: | ----------------: | --------: | ----------------------: | ---------------------: |
| 4       | flight   |             0.4271 |            0.3296 |    22.83% |                   65.55 |                  66.45 |
| 4       | idle     |             0.4000 |            0.3124 |    21.92% |                   66.38 |                  66.30 |
| 8       | flight   |             0.5591 |            0.4338 |    22.42% |                   66.61 |                  65.15 |
| 8       | idle     |             0.5507 |            0.4338 |    21.24% |                   66.29 |                  66.29 |
| 16      | flight   |             0.9263 |            0.6886 |    25.65% |                   64.98 |                  66.64 |
| 16      | idle     |             0.8415 |            0.6365 |    24.36% |                   66.53 |                  66.23 |
| 32      | flight   |             1.6859 |            1.2684 |    24.77% |                   66.89 |                  66.31 |
| 32      | idle     |             1.4202 |            1.0575 |    25.54% |                   66.68 |                  66.65 |

Each p95 column is the median of each run's worst client. All snapshots remain
at least 29.9948 Hz; the minimum input rate is 29.8304 Hz, a one-input measurement
boundary difference. The largest observed snapshot gap is 36.01 ms. Input
acknowledgment p95 changes range from -1.46 to +1.66 ms, around the unchanged
two-tick input target. These are acknowledgment timings, not visual prediction
latency. There is no new input or snapshot batching timer.

Both executables use Go 1.27.1, CGO disabled, the existing SIMD experiment,
GOAMD64=v1, the identical PGO profile, GOGC=200 and GOMAXPROCS=2. The server is
pinned to distinct physical cores 0/1 of the Ryzen 7 5800X3D; the Node driver
runs on CPUs 2–15. Each of eight cases has five alternating before/after pairs,
120 warmup periods and 180 measured periods at 30 Hz: 80 measured server
processes. CPU is process user plus system time per tick. Builds, tests and
profiles are serialized with these measurements.

Receipts fall from approximately 30 to **4.33 per client per second** on this
loopback workload. At 32 players, allocations/tick fall from 427.6 to 320.4 in
idle and 566.2 to 459.4 in flight. Allocated bytes do not uniformly decrease:
pending entries are larger, and real-time join/input phase affects flight
trajectories. No blanket memory-saving claim is made.

A separate three-pair 8/32-player flight comparison holds the corrected receipt
logic constant. The nonblocking writer alone saves **5.32% aggregate CPU**
(4.18% and 5.72% in the two cases), supporting retention of its additional code.
With 250 ms added receipt delay, all 16 validation processes preserve cadence;
receipt requests approach every snapshot. That two-pair delayed-link capture
saves only 3.42% aggregate CPU. The 24.23% result is not a claim of a 20% saving
on high-latency links.

The improvement concerns the complete server over real TCP. The separate
simulation/replication benchmark is essentially unchanged. This is a local
two-core result, not a measurement of Fly.io, and receipt savings depend on
round-trip time. The existing benchmark continues to send 30 Hz inputs,
including repeated held controls; the production client already sends input
edges. No new player counts or gameplay workloads were added.

## Receipt requests use the game's existing cumulative semantics

The client already acknowledges a snapshot only when its optional
`snapshotSequence` field is present. Every receipt cumulatively acknowledges
the preceding snapshots. Ordering and prediction use `serverTick` and the
unchanged input acknowledgment field. Requesting a receipt for every state
therefore causes avoidable control decoding, socket reads, queue traffic,
allocations, and runtime transitions.

The server now measures receipt lag in simulation ticks and requests receipts
less often on fast links. Its interval is the existing window minus measured
lag and two reserve slots, with a minimum of one. Loads and direct replies,
including docking updates, always request a receipt. Snapshots and input
acknowledgments still go out at the existing cadence; input processing never
waits for a receipt. No client production source or protocol version changed.

The original two-slot slow-link and nine-slot healthy-link windows remain the
base allowance. Receipt spacing adds at most six metadata slots. Each pending
snapshot records the allowance under which it was sent, so a later receipt
cannot prematurely shrink that allowance. A current-state probe handles an
unrequested tail after a window reduction. The maximum pending metadata bound
is 16; the socket-byte, snapshot-byte, and asynchronous queue limits remain.
Pending entries hold sequence/tick/docking metadata, not packet copies.

The first prototype exposed why this needs explicit flow-control testing:
a delayed receipt could shrink the window around an unrequested tail and
stop delivery permanently. Merely omitting the sequence periodically was
incorrect. The retained allowance and probe rules resolve that case.

## A nonblocking Linux send avoids unnecessary runtime work

An empty outgoing queue now permits one immediate nonblocking `sendto` attempt.
The payload is still copied into owned storage. A mutex serializes producers;
an atomic pending-frame count includes zero-length ping/pong frames, so those
cannot be overtaken. Partial writes retain their exact wire offset and queue
the remainder. `EAGAIN` and `EINTR` queue the complete unsent frame. The original
writer, ten-second deadline, short-write checks, and buffer recycling handle
the queued path. Unsupported connections and non-Linux builds use that path.

The descriptor comes from the public `syscall.RawConn` API and stays protected
for the callback's lifetime. `MSG_DONTWAIT` prevents waiting for socket space;
`MSG_NOSIGNAL` suppresses SIGPIPE. Buffer lifetime is retained across the
syscall. This implementation uses Go and the already present `x/sys` version;
that module is now correctly classified as a direct dependency.

Actual executable disassembly, rather than Go assembly spelling alone, shows:

- The callback loads syscall number 44 with `MOVL $0x2c, AX` and flags
  `MSG_DONTWAIT | MSG_NOSIGNAL` with `MOVL $0x4040, SI`.
- `syscall.RawSyscall6` reaches the Linux ABI wrapper, which moves descriptor,
  pointer, length, and flags into `DI`, `SI`, `DX`, and `R10`, then executes
  `SYSCALL` (`0f 05`) and checks the returned errno range.
- Ordinary `syscall.Syscall`/`Syscall6` additionally call
  `runtime.entersyscall` and `runtime.exitsyscall`. The nonblocking attempt
  avoids these scheduler transitions. It still performs an actual kernel send.
- The baseline ordinary write also prepares the poll descriptor and sets a
  write deadline. Go's deadline implementation locks the poll descriptor and
  modifies its timer. The successful direct path avoids this per-frame work
  and the writer-queue handoff; blocked writes retain normal Go parking.

These observations follow the installed Go 1.27.1
[syscall wrappers](https://github.com/golang/go/blob/go1.27.1/src/syscall/syscall_linux.go),
[Linux AMD64 ABI adapter](https://github.com/golang/go/blob/go1.27.1/src/internal/runtime/syscall/linux/asm_linux_amd64.s),
[ordinary write implementation](https://github.com/golang/go/blob/go1.27.1/src/internal/poll/fd_unix.go),
and [deadline implementation](https://github.com/golang/go/blob/go1.27.1/src/runtime/netpoll.go).
Removing scheduler transitions is appropriate here because this attempt cannot
wait for socket capacity. It is not a general replacement for blocking Go I/O.

The separate 30-second, 32-player flight profiles contain 1.48 seconds of CPU
samples before and 1.13 seconds after. Flat syscall-wrapper samples fall from
760 to 520 ms; futex samples fall from 70 ms to no recorded samples. These coarse samples support
the runtime/kernel explanation, not an exact attribution of the saving.

Inherited user-mode counters, including setup and warmup, record 2.691 billion
cycles before and 2.382 billion after; instructions fall from 4.852 to 4.344
billion. All six counters ran without multiplexing in these captures. Whole-child
voluntary context switches fall from 118,683 to 96,380. Peak RSS is 42,348 versus
43,908 KiB. The wrapper now also records Linux rusage for CPU, context switches,
and RSS. These instrumented captures are diagnostic and are excluded from the
acceptance statistics; generic cache events are not identified as L3 misses.

## Broader Go repository review

I enumerated all 61 repositories returned for the
[Go organization](https://github.com/orgs/golang/repositories?type=all), reviewed
their purpose and available overview documents, and inspected selected actual
implementation sections in addition to documentation. The evidence inventory
distinguishes overview-only repositories from implementation reads; it does
not claim every file in every repository was read. Historical/editor/build
repositories did not justify adding dependencies to the running server.

| Repository and inspected implementation                                                                                                                                          | Consequence for this investigation                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [go: compiler AMD64 rules](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/_gen/AMD64.rules), integer range proofs, poller and syscall implementations     | Verify actual lowering and runtime boundaries. `AtomicAdd64` lowers to locked operations; floating division and square roots lower to scalar hardware instructions. Removing whole receipt and queue operations offers a larger TCP ceiling than another arithmetic substitution. |
| [arch: x86 decoder](https://github.com/golang/arch/blob/master/x86/x86asm/decode.go)                                                                                             | Check decoding machinery used by Go tooling and interpret the executable's actual instructions.                                                                                                                                                                                   |
| [perf: benchstat](https://github.com/golang/perf/blob/master/cmd/benchstat/main.go), [benchmarks: Sweet](https://github.com/golang/benchmarks/blob/master/sweet/README.md)       | Separate macrobenchmarks, diagnostic profiles, repeated comparisons, and uncertainty. A simulation-only gain does not establish a socket/server gain.                                                                                                                             |
| [website: GC guide](https://github.com/golang/website/blob/master/_content/doc/gc-guide.html) and [PGO guide](https://github.com/golang/website/blob/master/_content/doc/pgo.md) | Keep GC and PGO fixed for attribution; reduce work and allocations rather than obtain a result by changing the memory budget.                                                                                                                                                     |
| [groupcache](https://github.com/golang/groupcache/blob/master/groupcache.go)                                                                                                     | Its already-populated destination and duplicate-load checks illustrate avoiding repeated work. Exact contact/observer cache prototypes were measured, rather than assuming caching would help.                                                                                    |
| [sync: singleflight](https://github.com/golang/sync/blob/master/singleflight/singleflight.go), errgroup                                                                          | Deduplicating work must fit ownership and concurrency. No additional goroutine pool was added to the authoritative world.                                                                                                                                                         |
| [time: rate limiter](https://github.com/golang/time/blob/master/rate/rate.go)                                                                                                    | State-based accounting can avoid a timer per event. Receipt requests reuse simulation ticks instead of adding a batching timer.                                                                                                                                                   |
| [net: HTTP/2 writes](https://github.com/golang/net/blob/master/http2/write.go)                                                                                                   | Inspect frame ownership, flushing, and coalescing; preserve ordered control/data writes without delaying gameplay snapshots.                                                                                                                                                      |
| [sys: Linux calls](https://github.com/golang/sys/blob/master/unix/syscall_linux.go)                                                                                              | Check nonblocking flags, errno handling, and low-level syscall interfaces.                                                                                                                                                                                                        |
| [snappy: encoder](https://github.com/golang/snappy/blob/master/encode.go)                                                                                                        | Safe fast paths require explicit buffer margins and fallback rules. Adding compression would be a separate client/protocol tradeoff.                                                                                                                                              |
| [image: scaler](https://github.com/golang/image/blob/master/draw/scale.go)                                                                                                       | Precompute reusable work and retain scratch storage where reuse exists; existing geometric caches already do this. Larger caches were not automatically beneficial.                                                                                                               |
| [geo: rectangles](https://github.com/golang/geo/blob/master/r2/rect.go), S2 shape index                                                                                          | Conservative rejection and small-list specialization motivated the swept-bound prototype. A bound on planned motion alone is insufficient to establish identical collision behavior after solver redirection.                                                                     |
| [leveldb: memory table](https://github.com/golang/leveldb/blob/master/memdb/memdb.go)                                                                                            | Pointer-free offset arenas illustrate a larger layout alternative. Prior packed-physics results and cache costs argue for measuring a complete layout, not assuming a narrower representation wins.                                                                               |
| [exp: mmap](https://github.com/golang/exp/blob/master/mmap/mmap_unix.go)                                                                                                         | Review storage/lifetime tradeoffs; mapping static data does not eliminate this server's live simulation and socket work.                                                                                                                                                          |
| [crypto: ChaCha](https://github.com/golang/crypto/blob/master/chacha20/chacha_generic.go)                                                                                        | Bounds hints, fixed blocks, precomputation, and instruction-friendly rotates are useful when the workload has those invariants. Existing SIMD remains runtime gated.                                                                                                              |
| [glog](https://github.com/golang/glog/blob/master/glog.go)                                                                                                                       | Inspect pooled metadata and avoid evaluating disabled logging work. No per-frame production logging was introduced.                                                                                                                                                               |
| [text: compact tag index](https://github.com/golang/text/blob/master/internal/tag/tag.go)                                                                                        | Inspect compact immutable indexing; do not replace all game dictionaries with maps or linear searches by habit.                                                                                                                                                                   |
| [telemetry: counters](https://github.com/golang/telemetry/blob/master/internal/counter/counter.go)                                                                               | Cached pointers and atomic state still have instruction and synchronization costs. PMU diagnostics remain outside the game loop.                                                                                                                                                  |
| [protobuf: wire adapter](https://github.com/golang/protobuf/blob/master/proto/wire.go)                                                                                           | The legacy package delegates to the modern implementation. Replacing our existing compact delta format was not supported by a measured bottleneck.                                                                                                                                |
| [tools: stringer](https://github.com/golang/tools/blob/master/cmd/stringer/stringer.go), command invocation                                                                      | Specialize according to data shape and keep fallbacks; generated table/linear/map choices are contextual.                                                                                                                                                                         |
| [gofrontend overview](https://github.com/golang/gofrontend/blob/master/README.md)                                                                                                | An alternate frontend is not evidence that replacing this compiler or runtime would reduce the measured kernel/receipt work. No unmeasured language rewrite was retained.                                                                                                         |

The prior [compiler investigation](go-server-cpu-lowering.md) preserves its
AMD Zen 3 instruction research, SIMD/ISA experiments, bounds-check diagnostic,
inlining experiments, packed geometry work, and earlier rejected network paths.
The [normal-scheduling network experiment](../2026-10-02/go-network-multicore-2026-10-02.md)
also identified remaining syscall/scheduler cost. The present result retains
two execution CPUs and does not revive the rejected one-CPU restriction.

## Other Go servers with TypeScript clients

I inspected both sides of
[Centrifuge's Go writer](https://github.com/centrifugal/centrifuge/blob/master/writer.go)
and [TypeScript client](https://github.com/centrifugal/centrifuge-js/blob/master/src/centrifuge.ts).
Its optional delayed batching, buffer pooling, and synchronous ownership rules
illustrate why message count and wakeups matter. Our change batches receipt
requests while continuing immediate gameplay-state delivery. The
[Centrifugo protocol documentation](https://centrifugal.dev/docs/transports/client_protocol)
discusses the syscall cost of many small messages.

I also inspected
[Nakama's Go WebSocket session](https://github.com/heroiclabs/nakama/blob/master/server/session_ws.go)
and [TypeScript socket](https://github.com/heroiclabs/nakama-js/blob/master/packages/nakama-js/socket.ts).
The TypeScript match-data path sends without creating a request/response
promise for every state. Its
[authoritative multiplayer documentation](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/)
recommends reducing message count where possible. These are design references,
not transferable benchmark percentages. This game already has reliable ordered
WebSockets and cumulative receipt semantics, which permit the measured change.

## Other screened ideas

- Full exact-manifold caching combined with a 32-observer membership cache
  preserved screened outcomes but regressed CPU roughly 2–6%. This does not
  isolate either cache's contribution or rule out a smaller representation.
- Avoiding unconditional pose-version changes for identical transforms
  preserved screened outcomes but produced no reliable CPU gain.
- Swept whole-body AABB rejection changed the 16-player convoy contact total
  from 7,708 to 7,272. It was not retained. An earlier stride-error run produced
  invalid results and is explicitly excluded from performance conclusions.
- The first cumulative-receipt prototype failed jitter/slow-link delivery;
  its timing screens were exploratory. Only the corrected allowance/probe
  implementation is used for acceptance.
- An early TCP capture stopped on a harness assertion that incorrectly
  equated absolute server ticks with packet numbers. Its partial results are
  preserved separately and excluded from final acceptance. The corrected
  driver validates packet order, advancing ticks, and consecutive measured
  ticks on undelayed links, allowing startup ticks before joining.

## Validation and resources

Production builds before and after, all **69 Node test files**, all Go packages,
and lint pass. The session parity fixture permits omission only of the existing
optional receipt-request field on snapshots; all other fields, every transmitted
sequence, loads, direct replies, and packet counts remain checked.

The independent 4/8/16/32-player convoy/spread/contact/module matrix runs 3,000
measured ticks with five alternating pairs per case. All **80 pairs** exactly
match states, contacts, events, entities, packets and near-zero collision counts.
Byte totals differ because receipt metadata is omitted. Simulation/replication
CPU changes by just **0.09%**, with a 95% repeat interval of
**-0.07–0.57%**: essentially flat. The largest case median RSS
changes from 112,435,200 to 117,178,368 bytes. Physics and gameplay algorithms
are unchanged in this follow-up.

The Linux regression test forces actual socket-buffer exhaustion, partial
writes, partial headers at seven byte offsets, `EINTR`, a closed peer, payload
reuse, zero-payload control-frame ordering, and concurrent producers. The race
detector passes. It also checks receipt delays of 2/6/8/18 simulation ticks and
three jitter patterns against baseline behavior. All inputs are consumed on
their intended tick; healthy and jittery cases retain all 120 measured snapshots.
The 18-tick slow case retains the baseline two-slot behavior and 12 snapshots.
The non-Linux fallback compiles for Darwin/AMD64.

The stripped executable changes from 13,512,864 to 13,521,056 bytes: **8,192
additional bytes**. Gzip level-1 size changes from 6,245,814 to 6,249,771 bytes:
**3,957 additional bytes**. All **14 client assets are byte-identical**.
The 38,612-byte PGO profile and all dependency versions are unchanged.

The [evidence archive](../../../benchmarking/experiments/2026-10-22/go-cpu-transport/README.md)
contains raw results, source/profile snapshots, disassembly, rejected prototypes,
research inventory, regression logs, checksums and standalone before/after build
instructions. It preserves unsuccessful captures separately from acceptance.
