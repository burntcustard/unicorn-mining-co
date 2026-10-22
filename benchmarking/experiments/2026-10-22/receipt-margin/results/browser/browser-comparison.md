# Headful receipt-policy comparisons

All captures used the same probe and normal local ports. The server compiler
overlay selected one receipt policy and changed only new-player spawn to a real
docked starter ship. Combat bought/equipped the autogun and ammunition through
normal authoritative dock actions. No client readiness state was injected.

The Chrome desktop display ran at approximately 120 frames/s. Combat kept the
pilot at normal size 1.5 and observer at size 5. Network-stall captures retained
the historical size-5 continuity fixture and page-timer delay model: 50 ms in
each direction plus a 1.1-second queued outage. This is application dispatch and
receipt scheduling, not isolated wire latency. Each policy used the same ordered
queue-release probe.

## Normal combat, zero added delay

Each capture had 20 settled steering and 20 ready-fire edges. All 40 keydowns
were trusted, with zero readiness failures, missing local/remote responses,
browser errors, or remote ambiguity. Both had 19/20 fire responses on the first
eligible actual render frame and one on the following frame.

| Metric | Sticky lag | Stateless margin 4 |
| --- | ---: | ---: |
| Local steering p95 / p99, ms | 11.9 / 12.3 | 7.5 / 12.4 |
| Local actual projectile and muzzle feedback p95 / p99, ms | 9.9 / 10.9 | 9.8 / 10.7 |
| Remote fire feedback p95 / p99, ms | 52.9 / 72.2 | 52.2 / 64.0 |
| All-input send-to-ack p95 / p99, ms | 42.9 / 43.8 | 42.9 / 51.0 |
| Inputs acknowledged / sent | 83 / 83 | 83 / 83 |
| Pilot snapshot rate, /s | 29.93 | 29.97 |
| Pilot / observer receipt sends, /s | 4.272 / 4.272 | 5.974 / 5.974 |
| Pilot / observer longest snapshot gap, ms | 67.0 / 67.0 | 67.2 / 66.5 |
| Pilot / observer completed-frame p95, ms | 10.6 / 10.7 | 10.7 / 10.5 |

These single captures show similar local fire feedback with approximately 40%
more receipt sends for margin 4. They do not establish a steering-tail improvement;
input phase relative to the next frame varies between small trial sets.

## Ordered network outage, 50 ms application delay each way

All four captures passed the existing movement-continuity assertions, with zero
missing ships, pilot freezes, errors, or closes. Every pilot input completed.
There were only three pilot inputs per capture; p95 and p99 below are descriptive
sample maxima dominated by the deliberately injected outage.

| Pilot metric | Sticky lag | Margin 2 | Margin 3 | Margin 4 |
| --- | ---: | ---: | ---: | ---: |
| Input send-to-ack p95 / p99, ms | 968.2 / 968.2 | 1035.0 / 1035.0 | 1036.2 / 1036.2 | 1036.6 / 1036.6 |
| Longest snapshot gap, ms | 1109.9 | 1135.2 | 1135.8 | 1134.4 |
| Overall snapshots, /s | 22.49 | 22.83 | 22.74 | 22.80 |
| Overall receipt sends, /s | 12.37 | 7.56 | 9.04 | 12.68 |
| Before-outage snapshots, /s | 28.82 | 29.29 | 29.51 | 29.53 |
| Before-outage receipt sends, /s | 7.62 | 7.32 | 9.28 | 14.60 |
| Recovery snapshots, /s | 23.98 | 24.77 | 24.28 | 24.38 |
| Recovery receipt sends, /s | 23.18 | 11.19 | 12.74 | 15.98 |
| Longest silence wholly inside recovery window, ms | 100.4 | 131.9 | 130.9 | 131.4 |

The recovery snapshot-gap distribution also includes the gap ending with the
first post-outage snapshot, even when that gap started before the recovery
window. The separate longest-silence metric clips to window boundaries. Raw
traffic retains requested snapshot sequences, application receipt sends, every
input and acknowledgment, and pending/missing counts.

## Evidence and limits

Six `browser-{policy}-{combat,stall}.json.gz` captures and their matching
`-analysis.json` files are retained in this directory. The analysis records each
raw capture SHA-256, completed-frame distributions, trusted-edge counts, and
first-eligible-frame feedback counts. `browser-analysis.source.txt` is the
self-contained TypeScript postprocessor; save it as `.ts` and pass capture paths
as arguments to reproduce matching analysis files.

These are local Vite development-client captures with completed draw submission
as the feedback endpoint. They exclude hardware scanout and do not replace the
separate deterministic jitter, native TCP, CPU, or deployment measurements. A
p99 from fewer than 100 trials is an observed upper-tail diagnostic, not a stable
population estimate.
