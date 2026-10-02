import assert from 'node:assert/strict';
import { RemoteMotion } from '../src/client/remote-motion';
import * as Vec from '../src/shared/vector';
import { simulationStep } from '../src/shared/settings';
import { GameObject } from '../src/shared/game-object';
import { addEntity, createWorld } from '../src/shared/simulation/world';

const motion = new RemoteMotion();
const step = simulationStep * 1000;

// Correct mechanics immediately, while both displayed hulls stay continuous.
const world = createWorld();
const local = addEntity(world, new GameObject({ id: 1, radius: 40 }));
const remote = addEntity(
  world,
  new GameObject({ id: 2, radius: 40, position: Vec.create(45) }),
);

const before = motion.sample({ now: 0, world, shipId: 1 });

local.position.x += 20;
remote.position.x += 20;
remote.rotation = 0.2;
motion.correct({ before, now: 0, world, predicted: world, shipId: 1 });
const corrected = motion.sample({ now: 0, world, shipId: 1 });

assert.equal(corrected.get(1)!.position.x, 0);
assert.equal(corrected.get(2)!.position.x, 45);
assert(Math.abs(corrected.get(2)!.rotation) < 1e-12);
assert.deepEqual(
  [local.position.x, remote.position.x, remote.rotation],
  [20, 65, 0.2],
  'render corrections do not change mechanics',
);
const settling = motion.sample({ now: step, world, shipId: 1 });

assert(settling.get(2)!.position.x > 45 && settling.get(2)!.position.x < 65);
assert(settling.get(2)!.rotation > 0 && settling.get(2)!.rotation < 0.2);
assert(
  Math.abs(
    motion.sample({ now: 500, world, shipId: 1 }).get(2)!.position.x - 65,
  ) < 0.1,
);

// Repeated reconciliation without a new mechanical error must not restart
// the release and leave a ship lingering behind its corrected position.
const isolated = new RemoteMotion();
const repeated = new RemoteMotion();
const releaseWorld = createWorld();
const releaseShip = addEntity(releaseWorld, new GameObject({ id: 1 }));
const releaseBefore = isolated.sample({ now: 0, world: releaseWorld });

releaseShip.position.x = 20;

for (const presentation of [isolated, repeated]) {
  presentation.correct({
    before: releaseBefore,
    now: 0,
    world: releaseWorld,
    predicted: releaseWorld,
  });
}

for (let now = 5; now <= 200; now += 5) {
  const before = repeated.sample({ now, world: releaseWorld });

  repeated.correct({
    before,
    now,
    world: releaseWorld,
    predicted: releaseWorld,
  });
  assert(
    Vec.distance(
      repeated.sample({ now, world: releaseWorld }).get(1)!.position,
      isolated.sample({ now, world: releaseWorld }).get(1)!.position,
    ) < 1e-10,
    'unchanged reconciliation preserves correction release velocity',
  );
}

const reversed = repeated.sample({ now: 200, world: releaseWorld });

releaseShip.position.x = -20;
repeated.correct({
  before: reversed,
  now: 200,
  world: releaseWorld,
  predicted: releaseWorld,
});
let releasePosition = reversed.get(1)!.position.x;

for (let now = 200; now <= 500; now++) {
  const position = repeated.sample({ now, world: releaseWorld }).get(1)!
    .position.x;

  assert(
    position <= releasePosition + 1e-12 && position >= -20 - 1e-12,
    'a changed correction releases toward its new pose without overshooting',
  );
  releasePosition = position;
}

const beforeDock = motion.sample({ now: 100, world, shipId: 1 });

remote.dockedTo = 9;
motion.correct({
  before: beforeDock,
  now: 100,
  world,
  predicted: world,
  shipId: 1,
});
assert.equal(
  motion.sample({ now: 100, world, shipId: 1 }).get(2)!.position.x,
  65,
  'docking discards visual corrections immediately',
);
const beforeTeleport = motion.sample({ now: 100, world, shipId: 1 });

remote.position.x = 5000;

motion.correct({
  before: beforeTeleport,
  now: 100,
  world,
  predicted: world,
  shipId: 1,
});
assert.equal(
  motion.sample({ now: 100, world, shipId: 1 }).get(2)!.position.x,
  5000,
  'teleports are not eased through the world',
);
motion.reset();
assert.equal(motion.sample({ now: 100 }).size, 0);
console.log(
  'Prediction poses, continuous corrections, docking and teleport resets passed',
);
