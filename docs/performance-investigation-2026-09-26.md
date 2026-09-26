# Server slowdown investigation — 26 September 2026

The reproduced live slowdown is an authoritative simulation stall, while the
browser continues rendering at approximately 60 FPS. Fly CPU throttling explains
the stalls, but substantial avoidable work in the game contributes to exhausting
the CPU allowance. The previous report's conclusion that the simulation had
been ruled out was too strong.

A separate local reproduction found that holding thrust without changing any
controls triggers the five-minute idle disconnect. Both issues have local fixes;
this investigation did not deploy them or change Fly machine resources.

## Evidence from actual games

The running Fly machine reported deployment commit
`69eadd092b1d24ca7719aedc84e8b0f2ba07f784`, matching the original checkout. It is
one `shared` CPU in LHR with 512 MB RAM.

Chrome sessions used a clean profile, a 1280×800 headless window, an injected
`requestAnimationFrame` counter and a WebSocket message listener. Measurements
were collected in ten-second windows. Flight used a short turn followed by held
thrust, without mining. These are browser frame intervals, not a GPU benchmark.

| Test                                      | Browser frames                                   | Server snapshots           | Outcome                                                                              |
| ----------------------------------------- | ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| Live flight, 7 minutes                    | 59.6–60 FPS in ten-second windows                | 2.5–13/s                   | Slow motion and irregular authoritative updates; worst message gap 1,819 ms          |
| Fresh live stationary session, 2 minutes  | About 60 FPS                                     | 29.6–30.1/s                | Server can recover under a lighter workload                                          |
| Local source game, 6 minutes after fixes  | About 60 FPS                                     | 29.8–30.1/s                | Held thrust remained connected through the complete run                              |
| Local source game, 6 minutes before fixes | About 60 FPS, with occasional local frame misses | 30/s until idle disconnect | Held thrust incorrectly disconnected after five minutes without a control transition |

During the dense part of the live flight, several consecutive windows received
only 25–34 updates per ten seconds. Median gaps were often 300–360 ms. Local
median gaps stayed approximately 33 ms before the idle disconnect, and the
largest observed local message gap was 94 ms. The zero-message windows after the
local disconnect are not performance measurements.

Actual frame rendering did **not** fall to 1 FPS in these tests. The client's
network clock allows only a small lead beyond the latest authoritative tick,
and fractional prediction is limited to one tick. When snapshots stall, the
browser repeatedly renders nearly the same simulation state. This explains the
appearance of very low FPS without a corresponding rendering-rate collapse.

A read-only `/proc` sample during live flight also found substantial CPU steal
and roughly stable process RSS around 101–102 MiB. The supplied dashboard is
more specific: burst balance reaches zero and quota throttling rises sharply.
Steal alone would not distinguish quota throttling from host contention.

The live tests used one test player at a time. Other users on the live server
were not controlled, and the local and live flights did not traverse identical
positions: the server's slowdown itself changes distance travelled per minute.
The live stationary test also created a new player rather than restoring the
first player's token. These tests demonstrate the symptoms, not an isolated
production capacity limit.

## Why a small game can exhaust this CPU

[Fly's CPU performance documentation](https://docs.fly.io/machines/cpu-performance/)
states that a shared vCPU currently has a baseline allowance of **5 ms per 80 ms**,
or **6.25%** of a core, with accumulated burst credit above that allowance.
At 30 ticks/s, that is only **2.083 ms of CPU time per tick**, before networking,
V8 background work, HTTP handling and other VM processes. Quota scheduling also
introduces pauses within that average budget.

A 2 ms tick on a developer's CPU therefore does not demonstrate ample capacity
on this VM. CPU hardware, optimization state, multiplayer density and per-tick
serialization all matter. CPU time and wall-clock tick time are different once
the host stops scheduling the process. Exhausting a credit balance provides a
natural explanation for an initially smooth session degrading after minutes;
it does not require a sudden increase in entity count or memory use.

A local `systemd-run` quota experiment was discarded: the user cgroup exposed no
`cpu.max` controller despite accepting the quota settings. Its results do not
constitute a reproduction of Fly throttling.

## Measured code costs and changes

`GameCollisions.sync()` rebuilt a nested geometry description and ran
`JSON.stringify()` with a rounding replacer over every vertex, for every entity,
on every tick. It did this even when no asteroid had been touched. The string
was used only to detect whether collision fixtures needed rebuilding.

Instrumentation and a local V8 CPU profile identified this geometry preparation
and comparison as the largest cost: approximately 57–69% of tick time in the
initial stationary scenarios. Region queries and replication also cost CPU, but
neither was the dominant contributor in those measurements.

The fix compares a flat numeric geometry signature. It retains the same 1e-6
rounding, shape boundaries, optional collision-margin distinction, mass/inertia,
and collision flags. Fixtures still rebuild when these values change. Material
and contact metadata still refresh every tick. Simulation positions and collision
resolution were not simplified.

Warmed source-server measurements below average the last two 1,000-tick blocks
of each scenario. Both include packet JSON serialization, but use socket stubs
and exclude actual network transport. They are local measurements, not predictions
of the live machine's sustainable player count.

| Scenario                                    | Wall ms/tick before → after | CPU ms/tick before → after |
| ------------------------------------------- | --------------------------- | -------------------------- |
| Spawn, one player                           | 0.718 → 0.491               | 0.780 → 0.564              |
| Northern field, one player                  | 1.287 → 0.653               | 1.352 → 0.716              |
| Spawn, three players                        | 1.209 → 0.888               | 1.237 → 0.922              |
| Northern field, three players               | 2.067 → 1.219               | 2.150 → 1.281              |
| Ten minutes of simulated travel, one player | 1.782 → 1.110               | 1.890 → 1.219              |

That is approximately **25–47% less process CPU** in these scenarios. The
northern three-player geometry phase itself fell from 1.151 to 0.329 ms/tick.
Small timing differences between repeated runs are expected.

A follow-up at the actual live trace's dense coordinates, approximately
`(-3727, -8190)`, loaded **89 entities with one player** and **105 with three**.
Its process CPU cost fell from **3.67 to 1.98 ms/tick** for one player and from
**5.12 to 2.83 ms/tick** for three. This is a materially heavier case than the
20-entity northern location in the previous report. Even on the local CPU,
2.83 ms × 30 exceeds the shared vCPU's sustained allowance, and 1.98 ms leaves
little room for networking. The optimization is useful but cannot establish
that shared-cpu-1x supports every dense multiplayer situation.

Holding thrust at the later live contact location, `(-3814, -10013)`, was also
checked. Process CPU fell from 3.15 to 2.07 ms/tick for one player and 7.40 to
4.34 ms/tick for three. The three-player run reached 172 active entities after
physical contact. No mining controls were sent, but physical collisions can
still damage objects and create fragments. These tests reinforce the need to
measure contact-heavy scenes, not just parked ships in lightly populated areas.

The travel benchmark advances 18,000 simulation ticks while directly moving a
player through a fixed route at 300 world units per simulated second. It is
accelerated simulation, not ten minutes of wall-clock browser play. Active
entity counts at sample boundaries varied from 2 to 107 and fell again in empty
areas; 144 regions remained loaded. Saved region descriptions increased as new
areas were explored, as expected for world persistence. The observed cost
followed density, with no persistent five-minute cliff. This does not rule out
all possible long-session or destruction-related accumulation bugs.

The independent idle bug was caused by `PredictionManager.recordInput()` sending
only control transitions while `GameSession.tick()` measured inactivity from the
last received message. Held thrust and turning now refresh activity on the
server. Latched module switches do not prevent an otherwise idle timeout.

## Validation and remaining limits

- Before/after temporary Node bundles emitted identical snapshot SHA-256 hashes
  across 9,000 ticks with three players and two position changes. This comparison
  isolated the geometry optimization and included actual packet serialization.
- Regression tests cover fixture reuse under rigid motion and rounding noise,
  shape/radius/vertex changes, optional margins, collision flags, mass/inertia,
  material refresh, and disabling/re-enabling colliders.
- Server tests cover held thrust and turning across the idle deadline, plus
  continued idle eviction when only a latched search light remains enabled.
- `npm test`, including production packet compatibility, collision, prediction,
  reconnect, docking, sound and input tests, passed. `npm run lint` passed.
  The repository-wide formatting check reports only the pre-existing untracked
  `benchmarking/session-tick.mjs`; it was left untouched.
- Production builds passed before and after. The main client chunk changed from
  95.47 to 95.65 kB, and gzip-level-1 size from 41,986 to 42,037 bytes (+51).
  The existing 14 KB chunk-size warning remains. Lazy chunk sizes were unchanged
  at the build report's precision; the docked chunk hash changed.

The fixes still require a production rollout and another sustained measurement
on the existing shared CPU. The optimization substantially reduces measured work,
but it does not establish that every dense field or multiplayer session fits the
shared allowance. Further work, if needed, should be guided by production tick
CPU/wall timings and density; region queries and replication are the next
measured costs. A performance CPU upgrade is not required to try these fixes.

Reproduce local phase measurements with:

```sh
node --import tsx benchmarking/server-performance.mjs
node --import tsx benchmarking/server-performance.mjs --flight
```

Sanitized per-window browser measurements and before/after phase measurements
are retained in
[`benchmarking/results/2026-09-26-server-performance.json`](../benchmarking/results/2026-09-26-server-performance.json).
The pre-existing `benchmarking/session-tick.mjs` and user's `docs/todo.md` changes
were preserved.

## Follow-up CPU configuration

At the user's request, `fly.toml` now selects two shared CPUs with 512 MB RAM
for the next deployment. Their pooled allowance is 10 ms per 80 ms period,
or 12.5% of one core (about 4.17 ms of CPU time per tick at 30 Hz). The
heaviest post-fix local contact test used 4.34 ms per tick before transport
overhead, so this tier needs a sustained live test after rollout. Four shared
CPUs would provide 25% (about 8.33 ms per tick) if this tier still throttles.
The live machine has not been resized by this config edit.
