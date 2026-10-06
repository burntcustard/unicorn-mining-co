import assert from 'node:assert/strict';
import { RemoteMotion } from '../../src/client/prediction/remote-motion';
import * as Vec from '../../src/client/utilities/vector';
import { simulationStep } from '../../src/specs/simulation';
import { GameObject } from '../../src/client/objects/game-object';
import { addEntity, createWorld } from '../../src/client/simulation/world';

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

// A speculative projectile ID can become an authoritative fragment ID.
// Its old pose belongs to another body and must not offset the new fragment.
const replacementWorld = createWorld();
const projectile = addEntity(
  replacementWorld,
  new GameObject({ id: 1, position: Vec.create(64, -25) }),
);

projectile.kind = 'projectile';
const replacementBefore = motion.sample({ now: 0, world: replacementWorld });

Object.assign(replacementBefore.get(1)!, { kind: projectile.kind });
const fragment = new GameObject({ id: 1, position: Vec.create(140, -43) });

fragment.kind = 'asteroid';
replacementWorld.entities.set(1, fragment);

motion.correct({
  before: replacementBefore,
  now: 0,
  world: replacementWorld,
  predicted: replacementWorld,
});

assert.deepEqual(
  motion.sample({ now: 0, world: replacementWorld }).get(1)!.position,
  fragment.position,
  'an authoritative fragment must not ease from the position of a speculative projectile with the same ID',
);

// Equal-radius fragments can reuse speculative IDs despite different geometry.
fragment.radius = 24;
fragment.shapeOutline = [
  [12, 18],
  [-24, 0],
  [12, -18],
];
const fragmentBefore = motion.sample({ now: 0, world: replacementWorld });

Object.assign(fragmentBefore.get(1)!, {
  kind: fragment.kind,
  shapeOutline: fragment.shapeOutline,
});

fragment.shapeOutline = [
  [24, 0],
  [-12, 18],
  [-12, -18],
];
Vec.set(fragment.position, Vec.create(184, -24));

motion.correct({
  before: fragmentBefore,
  now: 0,
  world: replacementWorld,
  predicted: replacementWorld,
});

assert.deepEqual(
  motion.sample({ now: 0, world: replacementWorld }).get(1)!.position,
  fragment.position,
  'different asteroid fragments sharing an ID and radius do not inherit each other’s pose',
);

const unchangedBefore = motion.sample({ now: 0, world: replacementWorld });

Object.assign(unchangedBefore.get(1)!, {
  kind: fragment.kind,
  shapeOutline: fragment.shapeOutline,
});

fragment.shapeOutline = fragment.shapeOutline.map((point: number[]) =>
  point.map((value) => value + 1e-8),
);
fragment.position.x += 1;

motion.correct({
  before: unchangedBefore,
  now: 0,
  world: replacementWorld,
  predicted: replacementWorld,
});

assert.equal(
  motion.sample({ now: 0, world: replacementWorld }).get(1)!.position.x,
  unchangedBefore.get(1)!.position.x,
  'wire rounding of unchanged asteroid geometry retains ordinary motion smoothing',
);
console.log(
  'Prediction poses, continuous corrections, docking and teleport resets passed',
);
