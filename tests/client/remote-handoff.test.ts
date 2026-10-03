import assert from 'node:assert/strict';
import { replayHandoff } from '../../benchmarking/tools/remote-handoff-workload';

let worstSpeedRatio = 0;
let worstSpeedChange = 0;
let cases = 0;

for (const speed of [120, 272]) {
  for (const separation of [0, 85, 110, 160, 400]) {
    for (const latency of [40, 90]) {
      for (const fps of [30, 60, 144]) {
        for (const direction of [-1, 1]) {
          const result = replayHandoff([
            speed,
            separation,
            latency,
            fps,
            direction,
          ]);

          assert.equal(result.backwards, 0, JSON.stringify(result));
          assert(result.maxSpeedRatio <= 1.5, JSON.stringify(result));
          assert(result.maxSpeedChange < 0.1, JSON.stringify(result));
          worstSpeedRatio = Math.max(worstSpeedRatio, result.maxSpeedRatio);
          worstSpeedChange = Math.max(worstSpeedChange, result.maxSpeedChange);
          cases++;
        }
      }
    }
  }
}
console.log(JSON.stringify({ cases, worstSpeedRatio, worstSpeedChange }));
