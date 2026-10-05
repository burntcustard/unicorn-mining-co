# Live benchmark results

## 2 October 2026 at 14:50:45 BST

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 76.7                  | 101.0              | 6.0–28.5              |
| 8       | 30.00            | 71.0                  | 98.6               | 6.7–33.1              |
| 16      | 30.00            | 103.2                 | 146.6              | 8.9–81.6              |
| 32      | 29.98–30.09      | 316.4                 | 528.0              | 16.2–106.9            |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

## 2 October 2026 at 17:01:34 BST

Post-deployment run after merging `go-server` into `main` (`bc0237f`). Same browser, viewport, warmup and measurement durations as the earlier run; all 16 cases completed.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 37.9                  | 107.2              | 8.5–53.8              |
| 8       | 30.00            | 44.1                  | 63.1               | 10.4–93.0             |
| 16      | 29.98–30.02      | 123.5                 | 330.0              | 11.4–120.1            |
| 32      | 30.04–30.21      | 331.9                 | 1019.0             | 32.6–88.0             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

Module cases recorded 76, 975, 2,604 and 115 client exceptions at 4, 8, 16 and 32 players respectively, involving undefined `forEach`/`X` properties and `e.nt` not being a function. These errors limit module-workload comparisons. The other activities recorded no client exceptions.

## 2 October 2026 at 22:13:00 BST

Repeat run against the same deployed entry asset as the 17:01 run (`index-RaZVaM7F.js`), using Chrome 153.0.8010.12, a 320 × 200 viewport, 15 seconds of warmup and 60 seconds of measurement per case, and 120-second cooldowns between player counts. All 16 cases completed.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 36.5                  | 51.7               | 8.9–50.5              |
| 8       | 30.00–30.01      | 46.6                  | 109.2              | 8.7–95.5              |
| 16      | 29.98–30.03      | 126.1                 | 350.5              | 11.1–120.8            |
| 32      | 30.04–30.12      | 327.9                 | 1136.6             | 37.2–74.5             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

Module cases recorded 253, 1,634, 3,639 and 142 client exceptions at 4, 8, 16 and 32 players respectively. The 32-player contact case also recorded 192 client exceptions. Errors involved undefined `forEach`/`X` properties and `e.nt` not being a function, limiting comparisons for these cases. The remaining cases recorded no client exceptions.

## 3 October 2026 at 13:38:08 BST

Run against deployed entry asset `index-DHaB6QQo.js`, using Chrome 153.0.8010.12, a 320 × 200 viewport, 15 seconds of warmup and 60 seconds of measurement per case, and 120-second cooldowns between player counts. All 16 cases completed with no client exceptions.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00            | 36.1                  | 63.4               | 8.5–49.0              |
| 8       | 30.00–30.04      | 43.5                  | 77.2               | 9.6–66.0              |
| 16      | 29.98–30.00      | 105.1                 | 207.1              | 10.8–156.9            |
| 32      | 30.09–30.11      | 323.5                 | 1142.8             | 34.8–99.9             |

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.

## 5 October 2026 at 13:48:17 BST

Post-persistence run against deployed revision `5d3500c` (Fly release 44) and
entry asset `index-fr0pAOYG.js`. One London Machine used the `game_data` volume
and `/data/world.sqlite`. All 16 cases completed with zero client exceptions
and zero WebSocket closes during measurement; every client observed world seed 25.

Comparison baseline: 3 October at 13:38:08 BST. Both captures used the identical
runner hash, Intel Core Ultra X7 358H host with 16 logical CPUs, Chrome
153.0.8010.12, 320 × 200 viewport, 15-second warmup, 60-second measurement and
120-second cooldowns between player counts. No deployment or production restart
was performed during this check.

| Players | Observed ticks/s | Snapshot gap p95 (ms) | Input ack p95 (ms) | Download KiB/s/client |
| ------- | ---------------- | --------------------- | ------------------ | --------------------- |
| 4       | 30.00–30.02      | 38.1                  | 46.4               | 9.1–39.7              |
| 8       | 30.00            | 48.0                  | 79.9               | 10.0–101.3            |
| 16      | 29.98–30.00      | 117.5                 | 255.2              | 12.2–124.2            |
| 32      | 30.05–30.08      | 291.8                 | 1070.4             | 36.0–105.1            |

Observed tick cadence remained approximately 30 Hz throughout. Worst-workload
input acknowledgement p95 changed from 63.4 to 46.4 ms at 4 players, 77.2 to
79.9 ms at 8, 207.1 to 255.2 ms at 16, and 1142.8 to 1070.4 ms at 32. The
16-player increase came from the module workload; the other three activities
were close to baseline. Worst snapshot-gap p95 rose about 12% at 16 players,
but fell about 10% at 32.

Median client FPS by activity, shown as **baseline → persistence**:

| Players | Convoy      | Spread      | Contact     | Module      |
| ------- | ----------- | ----------- | ----------- | ----------- |
| 4       | 60.0 → 60.0 | 60.0 → 60.0 | 60.0 → 60.0 | 60.0 → 60.0 |
| 8       | 59.9 → 60.0 | 60.0 → 60.0 | 60.0 → 60.0 | 59.7 → 56.9 |
| 16      | 40.1 → 40.8 | 59.3 → 59.9 | 35.7 → 28.2 | 28.9 → 23.9 |
| 32      | 11.8 → 11.3 | 26.1 → 23.8 | 6.0 → 7.0   | 5.8 → 6.4   |

The material rendering drops were 21% for 16-player contact and 17% for
16-player modules. Both captures saturated the local host at roughly 99% CPU
in these cases and all 32-player cases. Persistent world contents also change
between activities and runs: contact clients at 16 players observed a median
31 entities versus 25 previously. This is a comparison of deployed behavior,
not an isolated measurement of SQLite overhead, and one run cannot establish
whether those FPS changes are repeatable. No builds or other browser captures
competed with measurements; local recovery tests ran during the 4-to-8-player
cooldown.

Functional verification also passed:

- Existing SQLite store and session persistence tests, covering recovery,
  backups, atomic cargo transfers, checkpoints and module state.
- Existing executable/WebSocket integration test covering reconnect, graceful
  restart and abrupt process kill.
- A separate live disconnect/reconnect retained private identity, player ID,
  ship ID, credits and paint unlocks; `/healthz` returned HTTP 200 afterward.
- Fly health checks passed before, during and after the suite. Production logs
  showed no new server restart, SQLite failure, backup failure or panic during
  the benchmark window.

Raw capture: ignored `benchmarking/local/2026-10-05T12-48-17.625Z.json.gz`.
Final deployment status and server logs are retained locally alongside it as
`persistence-live-2026-10-05-deployment.json` and
`persistence-live-2026-10-05-server.log`.

Rates are ranges of client medians across workloads; delays are the worst workload p95. Snapshot gaps use browser transport timestamps; download measures WebSocket payload.

Local saturation affected this run’s network timings. These are observed service/network measurements, not server CPU measurements.
