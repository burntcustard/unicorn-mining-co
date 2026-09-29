import assert from 'node:assert/strict';
import {
  motionFixture,
  replayMotion,
} from '../benchmarking/remote-motion-workload';
import { RemoteMotion } from '../src/client/remote-motion';
import type { ReplicatedEntity } from '../src/shared/protocol/network';
import * as Vec from '../src/shared/vector';
import { simulationStep } from '../src/shared/settings';

for (const players of [4, 8, 16]) {
  for (const scenario of ['steady', 'jitter', 'burst', 'slow', 'outage']) {
    const quality = replayMotion(motionFixture([players, scenario]), true);

    assert.equal(
      quality.backwards,
      0,
      `${players} ${scenario}: forward playback`,
    );
    assert(quality.meanLagMs < 150, `${scenario}: bounded presentation delay`);

    if (['steady', 'jitter', 'slow'].includes(scenario)) {
      assert(
        quality.stalls === 0,
        `${scenario}: motion should continue between packets`,
      );
    }
  }
}

const motion = new RemoteMotion();
const entity = (x: number, dockedTo?: number): ReplicatedEntity => ({
  id: 2,
  kind: 'ship',
  position: Vec.create(x),
  radius: 10,
  rotation: 0,
  spin: 0,
  dockedTo,
});
const receive = (tick: number, now: number, x: number, dockedTo?: number) =>
  motion.receive({
    tick,
    now,
    entities: [entity(x, dockedTo)],
    entityIds: [2],
    shipId: 1,
  });

// Steady 30 Hz snapshots render exactly two ticks behind: the existing one
// plus one extra tick. Abrupt movement/turn stops must settle on that schedule.
const step = simulationStep * 1000;

for (let tick = 0; tick <= 20; tick++) {
  const packet = entity(Math.min(tick, 12) * 10);

  packet.rotation = Math.max(0, Math.min(tick - 8, 2)) * 0.2;
  motion.receive({
    tick,
    now: tick * step + 40,
    entities: [packet],
    entityIds: [2],
  });

  for (const fraction of [0, 0.5]) {
    const pose = motion.sample({ now: (tick + fraction) * step + 40 }).get(2)!;

    if (tick < 4) continue;
    assert(
      Math.abs(pose.position.x - Math.min(tick + fraction - 2, 12) * 10) < 1e-8,
      'movement and stopping add exactly one tick of buffering',
    );
    assert(
      Math.abs(
        pose.rotation - Math.max(0, Math.min(tick + fraction - 10, 2)) * 0.2,
      ) < 1e-8,
      'short turns settle without overshoot or a longer queue',
    );
  }
}
// Rendering continues through an outage. Once normal updates resume, catch up
// within two ticks of the newest state without slowly draining a large buffer.
assert.equal(motion.sample({ now: 9900 }).get(2)!.position.x, 120);
receive(100, 10000, 1000);
motion.sample({ now: 10000 });
receive(101, 10000 + step, 1010);
assert(motion.sample({ now: 10000 + step }).get(2)!.position.x >= 980);
motion.reset();
// A very long packet gap cannot enlarge the one-tick buffer.
receive(1, 0, 0);
receive(2, 10000, 10);
assert.equal(motion.sample({ now: 10000 + step / 2 }).get(2)!.position.x, 0);
assert(
  Math.abs(motion.sample({ now: 10000 + step * 1.5 }).get(2)!.position.x - 5) <
    1e-8,
);
receive(3, 10080, 20);
motion.sample({ now: 10090 });
const held = motion.sample({ now: 12000 });

assert.equal(held.get(2)!.position.x, 20, 'outages reach the newest endpoint');
assert.deepEqual(
  motion.sample({ now: 22000 }),
  held,
  'outages hold the endpoint',
);
receive(4, 22001, 5000);
assert.equal(
  motion.sample({ now: 22001 }).get(2)!.position.x,
  5000,
  'teleports reset history',
);
receive(5, 22034, 5100, 8);
assert.equal(
  motion.sample({ now: 22034 }).get(2)!.position.x,
  5100,
  'docking resets history',
);
motion.receive({ tick: 6, now: 22067, entities: [], entityIds: [] });
assert.equal(
  motion.sample({ now: 22067 }).size,
  0,
  'unloaded tracks are removed',
);
motion.reset();
receive(0, 0, 0);
receive(1, step, 10);
assert.equal(motion.sample({ now: step * 1.5 }).get(2)!.position.x, 0);
receive(2, step * 2, 20);
assert(
  Math.abs(motion.sample({ now: step * 2.5 }).get(2)!.position.x - 5) < 1e-8,
  'reconnect starts with only the one-tick buffer',
);
// Isolated asteroids are sampled sparsely. Between samples, their tracks
// continue the last drift and spin on the ordinary one-tick buffer.
motion.reset();
const asteroid = (tick: number): ReplicatedEntity => ({
  id: 3,
  kind: 'asteroid',
  position: Vec.create(tick * 2),
  radius: 50,
  rotation: tick * 0.01,
  spin: 0.01 / simulationStep,
  velocity: Vec.create(2 / simulationStep),
});

for (let tick = 0; tick <= 16; tick++) {
  motion.receive({
    tick,
    now: tick * step,
    entities: tick % 8 ? [] : [asteroid(tick)],
    entityIds: [3],
  });

  if (tick < 4) continue;
  const pose = motion.sample({ now: tick * step }).get(3)!;

  assert(
    Math.abs(pose.position.x - (tick - 2) * 2) < 1e-8 &&
      Math.abs(pose.rotation - (tick - 2) * 0.01) < 1e-8,
    'sparse asteroid samples keep moving on the usual buffer',
  );
}
console.log(
  'Remote motion bounds extra buffering to one tick, catches up after stalls and resets cleanly',
);
