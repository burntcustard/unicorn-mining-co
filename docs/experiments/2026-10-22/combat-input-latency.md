# Combat input latency — October 22, 2026

This follows the [input acknowledgment investigation](input-acknowledgment.md).
Acknowledgment measures authoritative progress, while combat responsiveness also
depends on when a player's own movement and weapon feedback reach a drawn frame.
The changes here address both paths without increasing the server tick rate.

## Findings and implementation

Dedicated module toggle keys waited for key release. A unique toggle now applies
and sends on keydown; its keyup does not toggle again. Shared bindings retain
their release/hold arbitration. HUD module controls also send before unlocking
audio, matching the keyboard path.

The server's overdue-input fallback overwrote each control with the latest state
and acknowledged it before simulation. A late press followed by release in the
same owner drain could therefore acknowledge a fire tap without firing. Overdue
edges now enter the current tick with their relative intervals preserved. A
backlog is compressed into one current tick, including interleaved current and
late edges, rather than replaying historical damage. A lone overdue press starts
at offset zero. Received-sequence tracking rejects duplicates; acknowledgment
advances when simulation consumes the queued controls.

Fractional frame prediction already solved the next full tick in an isolated
world, but gameplay rendered projectiles only after a committed tick. Drawing
every speculative entity would expose future input, cooldown, and charge results.
An optional shot observer now records actual successful shots and their causal
birth times during that existing isolated solve. Rendering exposes only due own
shots, with a causal muzzle pose and firing velocity. Full-tick mechanics,
projectile endpoints, ammo, IDs, damage, and random state retain their existing
behavior. Charge or deployment completed inside a substep is conservatively
presented at its end. Muzzle flashes share their existing absolute firing-deadline
history so sampling, replay, and commit do not duplicate them.

A second regression covered a newborn projectile killed later in the full solve.
Its future death initially hid earlier frames too. Only this case now makes an
additional read-only cast against the cached impact geometry along the display
trajectory. An isolated display copy survives until that impact; an immediate
muzzle obstruction remains hidden. Actual collision resolution and its endpoint
remain unchanged.

The roughly 180 ms steering reversal in earlier tests includes authored angular
braking. The new repeated steering test measures the first signed movement from
a neutral, settled ship; it does not change steering physics to improve a metric.

## Measurement method

`COMBAT_RESPONSE=1` selects repeated onset and ready-autogun trials in
`input-response-browser.ts`; its historical reversal mode remains the default.
Two real Chrome clients use the normal Vite WebSocket proxy. Each capture retains
20 neutral steering trials and 20 ready-weapon trials, including readiness
failures and missing responses. Trusted DOM keydown, synchronous input send,
authoritative snapshot acknowledgment, speculative shot creation, actual
`Projectile.render`, muzzle-flash draw calls, and completed game frames are
recorded separately. Flash observations require a nontransparent draw on the
actual world context inside the viewport; creating an effect is insufficient.
Only the observer zooms out to retain the pilot in view. The pilot keeps the
normal 1.5 view size. Current-trial births distinguish new projectiles even when
speculative IDs are reused. Historical global-ID exclusion incorrectly reported
four missing local responses in one exploratory run and is superseded here.

Fresh accounts normally start in flight. A local compiler overlay changes only
their spawn to the same authoritative docked station pose used by respawn. The
pilot then buys and fits an autogun, buys ammunition, launches, deploys, and
charges through normal game actions. No client weapon or readiness state is
injected. Both browser variants use this same server fixture and overdue-input
fix. The baseline predates fractional-shot presentation; it already includes the
dedicated-key change. These combat captures use Vite development modules, unlike
the earlier production-asset acknowledgment suite. The focused regression
fixture additionally runs with production transforms and property mangling.

Times end at completed browser draw submission, excluding display scanout and
physical keyboard hardware. Headless graphics and instrumentation affect frame
timing, so these are local comparisons, not a promise for every device or network.
Server CPU measurements run separately with no browser captures or builds.

## Browser results

The matched visible-window Chrome baseline completed frames at 10.8 ms p95.
Ready firing feedback was 34.5 ms p95, with 12 of 20 trials waiting one or more
extra rendered frames. Speculative shot mechanics had already run at 8.5 ms p95.
This isolates presentation delay beyond input dispatch or simulation prediction.

All values below are p95 milliseconds from trusted keydown. Each column is one
capture with 20 trials per phase; injected delay applies independently in each
direction through the development proxy.

| Measurement                        | Before | Fixed | Fixed, +50 ms each way | Fixed, +100 ms each way |
| ---------------------------------- | -----: | ----: | ---------------------: | ----------------------: |
| Local steering onset               |   12.5 |  11.7 |                   10.2 |                     9.5 |
| Local projectile draw              |   34.5 |  10.0 |                   10.1 |                    10.4 |
| Local muzzle-flash draw            |   34.5 |  10.0 |                   10.1 |                    10.4 |
| Local firing feedback, either draw |   34.5 |  10.0 |                   10.1 |                    10.4 |
| Remote firing feedback             |   62.7 |  53.0 |                  142.1 |                   239.5 |
| Authoritative fire acknowledgment  |   51.4 |  41.1 |                  130.7 |                   229.3 |
| Completed frame interval, pilot    |   10.8 |  10.7 |                   10.8 |                    11.0 |

Local fire p95 falls **71.0%**, with essentially unchanged frame pacing. Its fixed
zero-delay median is 5.0 ms. Adding 100 or 200 ms round-trip transit leaves local
feedback near 10 ms p95 while remote feedback and acknowledgment include transit.
These figures support prompt own-control feedback, not instant authoritative hit
confirmation over the Internet.

First eligible actual-render-frame feedback rises from 8/20 before to 19/20,
18/20, and 18/20 after. The other fixed trials take one additional frame. Their
first frame's stable rAF timestamp precedes the key edge by 0.1–0.9 ms, despite
render execution beginning afterward. Shot eligibility retains this stable
simulation clock; the three fixed captures' maximum local feedback is 13.1 ms.
The count uses actual render execution time separately from the rAF timestamp.

All four captures have 40 trusted keydowns and zero untrusted edges, readiness
failures, missing local or remote steering/fire responses, remote-ID ambiguity,
or browser errors. The observer's completed-frame p95 is 10.6–11.1 ms. Headless
exploration reached only about 30–40 FPS and masked the display-frame gain; those
captures are retained separately and excluded from this matched table.

## Server CPU and authoritative timing

Both server executables use the same benchmark harness, Go compiler/PGO settings,
two fixed physical cores, `GOMAXPROCS=2`, and `GOGC=200`. Each case has 120 warmup
ticks, 900 measured ticks, and three repetitions. Values below are median process
CPU milliseconds per tick, without concurrent browsers, builds, or tests.

| Input workload       | Players | Scenario |   Before |    After | Change |
| -------------------- | ------: | -------- | -------: | -------: | -----: |
| Normal               |       4 | Convoy   | 0.044913 | 0.043472 |  −3.2% |
| Normal               |       4 | Contact  | 0.066473 | 0.063014 |  −5.2% |
| Normal               |       4 | Module   | 0.133508 | 0.131917 |  −1.2% |
| Normal               |      32 | Convoy   | 0.361940 | 0.359991 |  −0.5% |
| Normal               |      32 | Contact  | 0.384631 | 0.389540 |  +1.3% |
| Normal               |      32 | Module   | 1.406088 | 1.383903 |  −1.6% |
| Two-edge overdue tap |       4 | Convoy   | 0.043926 | 0.044080 |  +0.4% |
| Two-edge overdue tap |       4 | Module   | 0.187907 | 0.185663 |  −1.2% |
| Two-edge overdue tap |      32 | Convoy   | 0.362118 | 0.356963 |  −1.4% |
| Two-edge overdue tap |      32 | Module   | 1.295524 | 1.275862 |  −1.5% |

These short repetitions show no material routine CPU regression. A separate
16-edge overdue burst does more work than the old policy, which discarded those
intervals. At 32 players it adds 0.0542 ms/tick for convoy (+15.0%) and 0.0712
ms/tick for module (+4.8%). This stress case is retained rather than presented as
free. Its stock ships are unarmed, isolating control processing and subdivision
without adding projectile load. The client presentation changes do not execute
on the Go server.

A native WebSocket phase sweep through the normal local proxy alternated thrust
at nine phases across a tick, with 72 samples for each target policy. The same
snapshot carried the changed authoritative control and its acknowledgment.

| Target tick              |   Median |      p95 |
| ------------------------ | -------: | -------: |
| Latest observed tick     | 17.41 ms | 33.44 ms |
| Latest observed tick + 1 | 50.62 ms | 66.65 ms |

The older TCP benchmark deliberately targets the following tick. Its roughly
67 ms result therefore includes an additional tick. This phase sweep compares
target choices within the final server; it is not a before/after server speedup
or a measurement of visible response or Internet transit.

## Validation and reproduction

The final build, all 70 Node test files, all Go packages, repository lint, and Go
format checks pass. Race-enabled transport, snapshot, and overdue-input tests
also pass. New cases check actual decoded-wire fire/thrust taps and ammo/fuel
use; duplicate/future ordering and reconnect; bounded backlog compression;
fractional births, cooldowns and readiness; repeated sampling; flash deduplication;
moving muzzle and future-impact timing; isolated state and full-tick parity.

The final production build still emits nine JavaScript chunks. Their combined
raw size grows from 277,360 to 279,557 bytes; the sum of individually gzipped
chunks at level 1 grows from 115,775 to 116,875 bytes (+1,100). The stripped Go
binary changes from 13,521,056 to 13,516,960 bytes (−4,096); level-1 gzip changes
from 6,249,683 to 6,248,897 bytes (−786). Import loading triggers are unchanged.

Retained raw results, source variants, commands, and checks are in the
[evidence directory](../../../benchmarking/experiments/2026-10-22/combat-input-latency/README.md).
