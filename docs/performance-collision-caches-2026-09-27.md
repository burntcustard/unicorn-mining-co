# Collision cache follow-up — 27 September 2026

This pass retains three small changes in shared physics. They reduce repeated
work without changing collision bounds, pair ordering, solver iterations or
simulation frequency. Production code grows by 30 lines net.

## Retained changes

- **Persistent motion records:** each collision body retains its input velocity
  vector and spin. The step reuses its motion array and entity-membership set,
  instead of allocating temporary records and vectors for every entity.
- **Cached geometry quantization:** fixture records retain both their original
  geometry and its rounded comparison values. Exact comparisons still run first;
  otherwise only incoming coordinates need rounding. The existing 1e-6 tolerance,
  mutable geometry checks, mass/inertia updates and material updates remain.
- **Tighter rotation bound:** bounds synchronization previously charged
  `radius * (abs(deltaSin) + abs(deltaCos))` against its cached margin. It now uses
  `radius * sqrt(deltaSin² + deltaCos²)`. The rotation-difference matrix scales
  every vector's length by this factor, so it still bounds coordinate movement
  conservatively. It spends less margin unnecessarily and avoids more polygon
  scans. The actual broad-phase boxes and their padding are unchanged.

This uses some additional memory for motion scratch data and rounded geometry.
It does not cache away checks that detect changing geometry.

## Three-player production measurements

Local Node.js 26.8.2 production-build replays, pinned to CPUs 2 and 3, with
`--max-semi-space-size=16` on both versions. Each invocation measures 3,600 ticks
(120 simulated seconds), with a separate warm cycle and session warm-ups:
260 simulated seconds total. Each child has a 290-second wall timeout.
No live server deployment or live CPU measurement was performed.

Runs execute serially in baseline/candidate/candidate/baseline order for convoy,
spread and contact. Because convoy results were mixed, another reversed sequence
was run. The table uses all retained timing runs: four per version for convoy,
two per version for each other route.

| Three-player route | Before CPU ms/tick | After CPU ms/tick |                   Reduction |
| ------------------ | -----------------: | ----------------: | --------------------------: |
| Convoy             |             0.6169 |            0.6159 | 0.2%; effectively unchanged |
| Separated players  |             0.9535 |            0.8337 |                       12.6% |
| Asteroid contacts  |             0.7388 |            0.7075 |                        4.2% |

These are total process CPU measurements, including background V8 work, not just
collision timings. Stub sockets include serialization but exclude actual network
transport and TLS. Results do not predict an identical percentage reduction on
Fly hardware. There is visible run-to-run variation; the initial spread screening
showed a smaller gain than the final comparison. Convoy provides no convincing
CPU improvement.

Every final timing run matches its route's baseline packet hash, byte count,
packet count, positions, entity count and maximum entity count.

Separate diagnostic runs incremented a counter at polygon `computeAABB` entry in
both saved production bundles. Counts include warm-up and measured work; their
CPU timings are not used above. They also preserve each route's packet hash.

| Route             | Before polygon-bound evaluations |     After | Reduction |
| ----------------- | -------------------------------: | --------: | --------: |
| Convoy            |                        2,121,068 | 1,701,984 |     19.8% |
| Separated players |                        3,236,764 | 2,578,052 |     20.4% |
| Asteroid contacts |                        2,427,668 | 1,942,924 |     20.0% |

Candidate peak RSS was 174–195 MiB for convoy, 206–210 MiB for spread, and
183–187 MiB for contact. Baseline ranges were 160–164, 207–211 and 182–188 MiB.
RSS includes V8 heap growth and warm-up; these differences are not measurements
of the retained caches alone. No large memory reservation is introduced.

## Rejected experiments

- Sharing body-neighbour search results between fixture queries preserved the
  spread replay but showed no benefit in its initial timing trial. Reverted.
- Increasing broad-phase padding from 10 to 40 changed trajectories and entity
  populations. Its CPU result therefore was not a like-for-like comparison;
  it was reverted rather than presented as an optimization.

## Validation and resource sizes

`npm test`, including production build, packet, collision, prediction, simulation
and lazy-chunk tests, passes. `npm run lint` passes. Additional collision tests
cover positive/negative rounding boundaries, signature refresh after rebuilding,
and mass/inertia changes. The 4,000-step bounds equivalence test now traverses all
four rotation quadrants, retaining movement, teleport, swept rotation and fixture
replacement checks against uncached synchronization.

| Resource    | Raw change | gzip level 1 change | Final gzip bytes |
| ----------- | ---------: | ------------------: | ---------------: |
| Main client |     +141 B |               +46 B |           42,285 |
| Server      |     +143 B |               +68 B |           34,025 |
| Docked      |        0 B |                -2 B |            2,445 |
| Sound       |        0 B |                 0 B |              942 |
| HTML        |        0 B |                +2 B |            1,952 |

The existing main-client 14 KB warning remains. Loading triggers are unchanged.

Raw runs and diagnostic counts:
[collision cache results](../benchmarking/results/2026-09-27-collision-caches.json).

To repeat the timing comparison, save a bundle before and after the changes:

```sh
node benchmarking/production-flight.mjs --save=/tmp/collision-before.mjs --warm --ticks=3600 --scenario=spread --semi-space=16
node benchmarking/production-flight.mjs --save=/tmp/collision-after.mjs --warm --ticks=3600 --scenario=spread --semi-space=16
```

Then replay each saved bundle serially with `--bundle`, retaining identical
options and CPU affinity. Repeat for `convoy` and `contact`, alternating order.
