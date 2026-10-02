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
