# Client input latency

The client already captures key changes synchronously and predicts the unfinished
30 Hz simulation tick on every display frame. The render loop, however, reused
the timestamp captured before its update work. A frame with a costly network
tick could therefore draw a ship pose several milliseconds old.

`node benchmarking/input-latency.mjs` runs the real keyboard handler, game loop,
and ship prediction against a controlled clock. It presses ArrowLeft 0.167 ms
before a 60 Hz frame and gives the update phase 8 ms of work. Both versions
paint on the next frame. The measured pose at the start of rendering is:

| Measure | Before | After |
| --- | ---: | ---: |
| Time from key event to render | 8.167 ms | 8.167 ms |
| Pose age at render | 8 ms | 0 ms |
| Steering simulated after key event | 0.167 ms | 8.167 ms |
| First frame rotation | -0.00000044 rad | -0.00104577 rad |

The render loop now samples the clock after update and canvas clearing, so the
next painted frame reflects controls through that work. Simulation ticks and
network messages still use their original timestamp. This is a deterministic
client timing test, not a physical display or input-device latency measurement;
browser scheduling and drawing time will vary by machine and scene.
