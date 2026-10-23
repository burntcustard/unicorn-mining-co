import assert from 'node:assert/strict';
import test from 'node:test';
import {
  miningNavigationReserve,
  miningTargetContained,
  miningWorkingRadius,
  obstacleSafeRoute,
  reserveMiningTargets,
  workloadControls,
  type MiningProposal,
} from '../../benchmarking/server/workloads.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

const anchor = Vec.create();
const drillTip = { position: Vec.create(46, 0), radius: 3 };

const ship: ReplicatedEntity = {
  id: 1,
  kind: 'ship',
  position: Vec.create(),
  radius: 40,
  rotation: 0,
  spin: 0,
  velocity: Vec.create(),
};

const rock = (
  id: number,
  position: Vec.Value,
  radius = 50,
): ReplicatedEntity => ({
  id,
  kind: 'asteroid',
  position,
  radius,
  rotation: 0,
  spin: 0,
  velocity: Vec.create(),
  health: 100,
});

test('the recorded nearby mining targets cannot reserve overlapping working areas', () => {
  const recorded: MiningProposal[] = [
    {
      index: 2,
      position: Vec.create(-1456.5196758508682, 8995.31939303875),
      radius: 40,
      wholeRocks: 1,
      candidates: [
        {
          asteroidId: 4214743014,
          asteroidRadius: 90.06863102,
          anchor: Vec.create(-1525.9983277320862, 9104.009923398495),
          contact: Vec.create(-1455.9439373237226, 8994.41872320464),
          distance: 1.068962582,
        },
      ],
    },
    {
      index: 1,
      position: Vec.create(-1406.9640014767647, 7643.277032732964),
      radius: 40,
      wholeRocks: 1,
      candidates: [
        {
          asteroidId: 591763273,
          asteroidRadius: 86.15087494,
          anchor: Vec.create(-1222, 9124),
          contact: Vec.create(-1237.636571514248, 8998.821963270679),
          distance: 1366.07973312,
        },
      ],
    },
  ];

  const [first, second] = recorded.map((proposal) => proposal.candidates[0]);

  assert(Vec.distance(first.contact, second.contact) > 200);
  assert(Vec.distance(first.anchor, second.anchor) < 305);
  assert.equal(reserveMiningTargets({ proposals: recorded }).length, 1);
});

test('disjoint working areas include both hulls and the ordinary peer guard', () => {
  const proposal = (index: number, x: number): MiningProposal => ({
    index,
    position: Vec.create(x, -500),
    radius: 40,
    wholeRocks: 1,
    candidates: [
      {
        asteroidId: index + 20,
        asteroidRadius: 50,
        anchor: Vec.create(x, 0),
        contact: Vec.create(x, -90),
        distance: 410,
      },
    ],
  });

  assert.equal(miningWorkingRadius, 900);
  assert.equal(miningNavigationReserve, 250);
  assert.equal(
    reserveMiningTargets({ proposals: [proposal(0, 0), proposal(1, 2000)] })
      .length,
    2,
  );
  assert.equal(
    reserveMiningTargets({ proposals: [proposal(0, 0), proposal(1, 1999.99)] })
      .length,
    1,
  );
});

test('fragment containment accounts for its complete living shape and navigation reserve', () => {
  const escaped = {
    ...rock(30, Vec.create(726, 0), 20),
    shapeOutline: [
      [0, 0],
      [153, -1],
      [153, 1],
    ],
  };

  const contained = {
    ...rock(31, Vec.create(300, 100), 20),
    shapeOutline: [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ],
  };

  assert(!miningTargetContained({ ship, asteroid: escaped, anchor, drillTip }));
  assert(
    miningTargetContained({ ship, asteroid: contained, anchor, drillTip }),
  );
});

test('active miners recover toward their anchor while initial inbound flight remains unrestricted', () => {
  const recovering = {
    ...ship,
    position: Vec.create(700, 0),
    rotation: Math.PI,
  };

  const asteroid = rock(40, Vec.create(0, 450));

  const input = (mining: boolean) =>
    workloadControls({
      workload: 'module',
      index: 0,
      players: 4,
      elapsed: 0,
      ship: recovering,
      entities: [asteroid],
      miningAnchor: anchor,
      miningAsteroid: asteroid,
      drillTip,
      mining,
    });

  const active = input(true);
  const inbound = input(false);

  assert.equal(active.turn, 0);
  assert.equal(active.thrust, 1);
  assert.equal(inbound.turn, -1);
  assert.equal(inbound.thrust, 0);
  assert(
    active.hornDrill,
    'Anchorward recovery keeps a safely powered drill deployed',
  );
  assert(!inbound.hornDrill);
});

test('powered recovery still respects the hard working radius and nearby hulls', () => {
  const asteroid = rock(41, Vec.create(0, 450));

  const controls = (position: Vec.Value, peers: ReplicatedEntity[] = []) =>
    workloadControls({
      workload: 'module',
      index: 0,
      players: 4,
      elapsed: 0,
      ship: { ...ship, position, rotation: Math.PI },
      entities: [asteroid, ...peers],
      miningAnchor: anchor,
      miningAsteroid: asteroid,
      drillTip,
      mining: true,
    });

  assert(controls(Vec.create(700, 0)).hornDrill);
  assert(!controls(Vec.create(900, 0)).hornDrill);
  assert(
    !controls(Vec.create(700, 0), [
      { ...ship, id: 2, position: Vec.create(700, 170) },
    ]).hornDrill,
  );
});

test('bounded mining detours retain complete obstacle checks', () => {
  const miner = { ...ship, position: Vec.create(500, 0) };
  const obstacles = [
    rock(50, Vec.create(250, 0), 80),
    rock(51, Vec.create(440, 70), 10),
  ];
  const bounds = { position: anchor, radius: 650 };

  const route = obstacleSafeRoute({
    ship: miner,
    target: anchor,
    entities: obstacles,
    asteroidMargin: 20,
    checkDetours: true,
    bounds,
  });

  assert(!route.blocked);
  assert(
    route.target.y < 0,
    'The upper obstacle still rejects the preferred detour',
  );
  assert(Vec.distance(route.target, anchor) < 650);
  const step = Vec.subtract(route.target, miner.position);

  for (const obstacle of obstacles) {
    const along = Math.max(
      0,
      Math.min(
        1,
        Vec.dot(Vec.subtract(obstacle.position, miner.position), step) /
          Vec.lengthSquared(step),
      ),
    );

    assert(
      Vec.distance(
        Vec.addScaled(miner.position, step, along),
        obstacle.position,
      ) >=
        obstacle.radius + miner.radius + 20,
    );
  }

  const outside = obstacleSafeRoute({
    ship: miner,
    target: Vec.create(650, 0),
    entities: [],
    checkDetours: true,
    bounds,
  });

  assert(outside.blocked);
  assert.deepEqual(outside.target, miner.position);
});
