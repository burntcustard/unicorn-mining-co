# Combat server notes

The overdue-input path formerly acknowledged and overwrote late controls in Receive. A press/release pair received before the same tick became only the final held state, so an acknowledged short tap produced no authoritative shot or movement. Live overloaded captures reported median input lead around -10/-11 ticks; this is a relevant execution path.

The fix queues overdue controls into the current tick while retaining their original timestamps. Every positive interval between consecutive overdue edges advances a logical timeline; on-time edges provide an offset floor. A two-pass scale compresses an oversized shared timeline into one current tick, preserving short taps without replaying historical damage. A lone overdue press starts at offset zero. A received-sequence high-water rejects duplicates globally, while the acknowledged sequence advances only when simulation consumes controls. Excessive future timestamps retain the current-state fallback at offset zero. The existing future input ring and snapshot recovery policy remain in use.

The final targeted command passed (0.264 seconds package runtime):

```sh
GOEXPERIMENT=simd go test ./src/server/network -run '^(TestLateInput|TestInputs|TestSnapshot|TestGameServerInputEdges)' -count=1 -v
```

Seven new late-input tests cover decoded wire press/release with actual autogun shot, ammo consumption, thrust fuel use and motion; zero-offset lone presses; proportional compression across old ticks with only one shot; a current edge at the tick's end; 60 edges plus 60 rejected duplicates; interleaved late/current/late timing; future/newer/duplicate ordering and reconnect. Existing tick, catch-up, receipt-window and jitter/recovery tests also pass.

The interleaved regression first failed with all later edges clamped to 30 ms and ammo still 200; the final timeline produces a positive fire interval and ammo 199. Coalesced ticks keep each ring slot inside its own [i*step, (i+1)*step) interval. Older future controls are skipped after a newer current input is consumed.

SESSION_LATE_BURST=2 optionally injects a normal press/release pair; 16 provides a secondary stress case. Both inject alternating fire edges targeting the preceding tick at the normal input cadence in TestSessionBenchmark. Stock benchmark ships have no armed gun, so this exercises edge processing without adding projectile load. The existing 120-message server limit is unchanged. Outcomes can differ from the old collapsed-edge behavior, including floating-point motion through split updates, so use the report comparison mode rather than claiming parity for this diagnostic.

Normal paired matrix (run sequentially with matching current benchmark harness in both executables):

```sh
PLAYERS=4,32 WORKLOADS=convoy,contact,module TICKS=900 REPETITIONS=3 RESULT=benchmarking/local/combat-cpu-before.json node benchmarking/tools/go-cpu.ts combat-cpu-before /tmp/unicorn-combat-before.test
PLAYERS=4,32 WORKLOADS=convoy,contact,module TICKS=900 REPETITIONS=3 RESULT=benchmarking/local/combat-cpu-after.json node benchmarking/tools/go-cpu.ts combat-cpu-after /tmp/unicorn-combat-after.test benchmarking/local/combat-cpu-before.json
SESSION_LATE_BURST=2 PLAYERS=4,32 WORKLOADS=convoy,module TICKS=900 REPETITIONS=3 RESULT=benchmarking/local/combat-cpu-late-before.json node benchmarking/tools/go-cpu.ts combat-cpu-late-before /tmp/unicorn-combat-before.test
SESSION_LATE_BURST=2 PLAYERS=4,32 WORKLOADS=convoy,module TICKS=900 REPETITIONS=3 RESULT=benchmarking/local/combat-cpu-late-after.json node benchmarking/tools/go-cpu.ts combat-cpu-late-after /tmp/unicorn-combat-after.test benchmarking/local/combat-cpu-late-before.json
```

A separate native TCP phase probe avoids interpreting the historical lastSnapshotTick+1 benchmark's intentional extra tick as an unavoidable server floor:

```sh
node benchmarking/tools/input-authority.ts ws://127.0.0.1:3001/game-socket benchmarking/local/combat-input-authority.json.gz
```

The probe alternates thrust at 0/4/.../32 ms after snapshot receipt and targets either the latest observed tick or that tick plus one. It records send-to-ack and send-to-completed authoritative thrust state, actual phase, server input lead, and speed. It does not measure visual/input presentation or require new server hooks. The historical TCP benchmark remains unchanged. The serialized measurements below are complete.

## Final serialized CPU results

All variants use matching current benchmark harnesses, fixed physical cores selected by go-cpu-environment.ts, GOMAXPROCS=2, GOGC=200, 900 measured ticks after warmup, and three repetitions per case. Browser port 9333 was closed before compilation and measurement. The prior production input policy comes from the archived final-game-session.go.txt overlay; the final executable uses the current overdue-edge fix. No browser, build, or test ran alongside the measurements.

| Mode | Players | Workload | Before ms/tick | After ms/tick | Change | Absolute ms/tick |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| normal | 4 | contact | 0.066473 | 0.063014 | -5.20% | -0.003459 |
| normal | 4 | convoy | 0.044913 | 0.043472 | -3.21% | -0.001441 |
| normal | 4 | module | 0.133508 | 0.131917 | -1.19% | -0.001591 |
| normal | 32 | contact | 0.384631 | 0.389540 | +1.28% | +0.004909 |
| normal | 32 | convoy | 0.361940 | 0.359991 | -0.54% | -0.001949 |
| normal | 32 | module | 1.406088 | 1.383903 | -1.58% | -0.022184 |
| 2-edge tap | 4 | convoy | 0.043926 | 0.044080 | +0.35% | +0.000154 |
| 2-edge tap | 4 | module | 0.187907 | 0.185663 | -1.19% | -0.002243 |
| 2-edge tap | 32 | convoy | 0.362118 | 0.356963 | -1.42% | -0.005154 |
| 2-edge tap | 32 | module | 1.295524 | 1.275862 | -1.52% | -0.019662 |
| 16-edge stress | 4 | convoy | 0.044342 | 0.051631 | +16.44% | +0.007289 |
| 16-edge stress | 4 | module | 0.137706 | 0.136211 | -1.09% | -0.001494 |
| 16-edge stress | 32 | convoy | 0.362034 | 0.416240 | +14.97% | +0.054206 |
| 16-edge stress | 32 | module | 1.470492 | 1.541729 | +4.84% | +0.071237 |

The normal matrix is within -5.2% to +1.3%; the primary two-edge tap matrix is within -1.5% to +0.4%. These short repeat results show no material routine CPU regression. The 16-edge stress convoy cases increase about 15-16%, with the 32-player absolute increase about 0.054 ms/tick; the 32-player module case adds about 0.070 ms/tick (4.8%). This reflects processing real control intervals previously discarded. Do not describe it as free or optimize away those edges. The four-player module stress result is essentially flat. These are process CPU measurements, not production Fly CPU.

Raw JSON: benchmarking/local/combat-cpu-{before,after,late-before,late-after,late16-before,late16-after}.json. Logs: /tmp/unicorn-combat-cpu-{before,after,late-before,late-after,late16-before,late16-after}.log.

## Native TCP phase results

The final probe ran through ws://localhost:3000/game-socket against the existing local proxy/backend. The backend fixture changes initial docking for browser provisioning; its input policy is the final fix. The probe sends one launch edge, waits for acknowledgment, clears launch immediately, then warms up for 120 snapshots. Holding launch would restart the launch timer every tick. Both undocked state and launching=0 are asserted before measurement. No new services were started; the temporary probe client terminated.

| Input target | Samples | Median completed-control/ack ms | p95 ms |
| --- | ---: | ---: | ---: |
| Latest observed tick | 72 | 17.41 | 33.44 |
| Latest observed tick + 1 | 72 | 50.62 | 66.65 |

The same snapshot carried the applied input acknowledgment and changed authoritative thrust. The approximately 33 ms difference comes from the deliberately later target tick, so the historical 67 ms benchmark does not establish an unavoidable two-tick authoritative latency floor. This is a phase-swept comparison within one final server, not a before/after server speedup; it does not measure visible frame response, weapon presentation, remote hit confirmation, or Internet latency.

Final flying capture: benchmarking/local/combat-input-authority.json.gz. Log: /tmp/unicorn-combat-input-authority.log. An earlier docked control-only capture was preserved separately as combat-input-authority-docked-control-only.json.gz and is excluded from the flying results.
