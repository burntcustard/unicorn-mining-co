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
