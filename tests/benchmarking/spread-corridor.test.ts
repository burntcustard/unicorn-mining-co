import assert from 'node:assert/strict';
import test from 'node:test';
import {
  proposeSpreadCorridors,
  reserveSpreadCorridors,
  spreadCorridorClear,
  spreadCorridorDeviation,
  spreadCruiseControls,
  spreadCruiseSpeed,
  spreadLateralAllowance,
  spreadRemainingDistance,
  type SpreadCorridor,
} from '../../benchmarking/server/workloads.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

const stations = {
  'corral-5': { dockingBays: [0], localMovementRadius: 600 },
};

const ship: ReplicatedEntity = {
  id: 1,
  kind: 'ship',
  position: Vec.create(),
  radius: 40,
  velocity: Vec.create(),
  rotation: 0,
  spin: 0,
};

const corridor: SpreadCorridor = {
  index: 0,
  start: Vec.create(),
  heading: 0,
  length: 1800,
  speed: 50,
};

const rock = (x: number, y: number): ReplicatedEntity => ({
  id: 2,
  kind: 'asteroid',
  position: Vec.create(x, y),
  radius: 10,
  rotation: 0,
  spin: 0,
});

test('cruise duration fits observed distance, runup, and reserve without slowing below30', () => {
  assert.equal(spreadCruiseSpeed(10), 50);
  assert.equal(spreadCruiseSpeed(30), 38.125);
  const speed = spreadCruiseSpeed(35);

  assert(speed >= 30 && speed < 50);
  assert(Math.abs((speed + 15) * 37 + 100 - corridor.length) < 1e-6);
  assert.throws(() => spreadCruiseSpeed(35.1), /repetitions/);
  assert.throws(() => spreadCruiseSpeed(36), /repetitions/);
  assert.throws(() => spreadCruiseSpeed(0), /positive/);
  assert.throws(() => spreadCruiseSpeed(Infinity), /positive/);
});

test('fresh remaining distance budgets thrust overshoot and larger actual velocity', () => {
  const planned = { ...corridor, speed: spreadCruiseSpeed(30) };

  assert.equal(
    spreadRemainingDistance({ ship, corridor: planned, seconds: 30 }),
    1693.75,
  );

  assert.equal(
    spreadRemainingDistance({
      ship: { ...ship, velocity: Vec.create(0, 60) },
      corridor: planned,
      seconds: 30,
    }),
    1900,
  );

  assert(
    !spreadCorridorClear({
      ship,
      corridor: planned,
      entities: [],
      stations,
      remaining: spreadRemainingDistance({
        ship: { ...ship, velocity: Vec.create(0, 60) },
        corridor: planned,
        seconds: 30,
      }),
    }),
    'An observed overspeed cannot silently extend fresh eligibility beyond the reserved endpoint',
  );
});

test('whole observed segments include end caps and lateral drift clearance', () => {
  const clear = (entities: ReplicatedEntity[]) =>
    spreadCorridorClear({ ship, corridor, entities, stations });

  assert(clear([ship, rock(-500, 0)]));
  assert(
    !clear([rock(1700, 0)]),
    'An obstacle beyond the former500-unit lookahead blocks the proposal',
  );
  assert(
    !clear([rock(1850, 0)]),
    'The reserved endpoint has a physical end cap',
  );
  assert(clear([rock(900, 190)]), 'Exact expanded-circle tangency is accepted');
  assert(
    !clear([rock(900, 189)]),
    'The60-unit drift allowance is included beyond hull+80',
  );
  assert(!clear([{ ...rock(900, 0), kind: 'station' }]));
  assert(!clear([{ ...rock(900, 0), kind: 'ship' }]));
  assert(!clear([{ ...rock(900, 0), kind: 'jumpGate' }]));
  assert(!clear([{ ...rock(900, 0), kind: 'wormhole' }]));
  assert(clear([{ ...rock(900, 0), kind: 'projectile' }]));
});

test('fresh remaining segments stay inside the originally reserved corridor', () => {
  const clear = (position: Vec.Value, remaining: number) =>
    spreadCorridorClear({
      ship: { ...ship, position },
      corridor,
      entities: [],
      stations,
      remaining,
    });

  assert(clear(Vec.create(100, spreadLateralAllowance), 1500));
  assert(!clear(Vec.create(100, spreadLateralAllowance + 0.01), 1500));
  assert(
    clear(Vec.create(-30, 0), 1600),
    'Small backward drift remains within the reserved start cap',
  );
  assert(!clear(Vec.create(-61, 0), 1600));
  assert(
    !clear(Vec.create(100, 0), 1761),
    'A fresh check cannot extend the reserved end cap',
  );
  assert(!clear(Vec.create(100, 0), -1));
  assert(!clear(Vec.create(100, 0), Infinity));

  assert(
    !spreadCorridorClear({
      ship: { ...ship, position: Vec.create(100, 50) },
      corridor,
      remaining: 1000,
      entities: [rock(900, 239)],
      stations,
    }),
    'The refreshed ray checks actual displaced geometry rather than only its original centerline',
  );
});

test('corridors exclude a station movement frame even when decoded velocity is zero', () => {
  const station: ReplicatedEntity = {
    ...rock(0, 0),
    kind: 'station',
    radius: 400,
    spin: -0.025,
  };

  const carried = { ...ship, position: Vec.create(585, 0) };
  const reserved = { ...corridor, start: Vec.clone(carried.position) };

  const clear = (distance: number, radius = 600) =>
    spreadCorridorClear({
      ship: { ...ship, position: Vec.create(distance, 0) },
      corridor: { ...corridor, start: Vec.create(distance, 0) },
      entities: [station],
      stations: {
        'corral-5': { dockingBays: [0], localMovementRadius: radius },
      },
    });

  assert(
    Vec.distance(carried.position, station.position) >
      station.radius + ship.radius + 80 + spreadLateralAllowance,
    'The reproduced585-unit pose passed the former static hull clearance',
  );
  assert.equal(Vec.length(carried.velocity || Vec.create()), 0);
  assert(!clear(585), 'A stationary ship can still be carried by the station');
  assert(
    !clear(660),
    'Allowed drift must stay strictly outside the movement frame',
  );
  assert(clear(660.01));
  assert(
    !clear(860, 800),
    'Eligibility follows the supplied station specification',
  );
  assert(clear(860.01, 800));

  assert(
    !spreadCorridorClear({
      ship: carried,
      corridor: reserved,
      entities: [{ ...station, definitionId: 'unknown-station' }],
      stations,
    }),
    'Unknown movement geometry cannot qualify a corridor',
  );

  const rotation = station.spin * 15;
  const worldPosition = Vec.create(
    carried.position.x * Math.cos(rotation),
    carried.position.x * Math.sin(rotation),
  );

  assert(
    spreadCorridorDeviation({ position: worldPosition, corridor: reserved }) >
      spreadLateralAllowance,
    'Normal station rotation changes world position despite zero relative velocity',
  );

  for (const players of [4, 8, 16, 32]) {
    assert.equal(
      proposeSpreadCorridors({
        ship: carried,
        index: 0,
        players,
        entities: [station],
        stations,
        speed: 38.125,
      }).candidates.length,
      0,
      'The same station envelope applies at every player count',
    );
  }
});

test('measured deviation detects lateral drift and longitudinal endpoint overruns', () => {
  assert.equal(
    spreadCorridorDeviation({ position: Vec.create(900, 60), corridor }),
    60,
  );
  assert.equal(
    spreadCorridorDeviation({ position: Vec.create(-61, 0), corridor }),
    61,
  );
  assert.equal(
    spreadCorridorDeviation({ position: Vec.create(1861, 0), corridor }),
    61,
  );
  assert.equal(
    spreadCorridorDeviation({ position: Vec.create(2000, 0), corridor }),
    200,
  );
  assert(
    spreadCorridorDeviation({ position: Vec.create(1860, 60), corridor }) >
      spreadLateralAllowance,
  );
});

test('proposals use real circles and discrete outward headings without changing poses', () => {
  const before = JSON.stringify(ship);

  const proposal = proposeSpreadCorridors({
    ship,
    index: 0,
    players: 32,
    entities: [rock(900, 0)],
    stations,
    speed: 50,
  });

  assert(proposal.candidates.length > 0);
  assert(
    proposal.candidates.every(
      (candidate) => Math.abs(candidate.heading) <= Math.PI / 2,
    ),
  );
  assert(
    proposal.candidates.every(
      (candidate) => candidate.length === 1800 && candidate.speed === 50,
    ),
  );

  assert(
    proposal.candidates.every((candidate) =>
      spreadCorridorClear({
        ship,
        corridor: candidate,
        entities: [rock(900, 0)],
        stations,
      }),
    ),
  );

  assert.notEqual(proposal.candidates[0].heading, 0);
  assert.equal(JSON.stringify(ship), before);

  assert.equal(
    proposeSpreadCorridors({
      ship,
      index: 0,
      players: 32,
      entities: [{ ...ship, id: 3 }],
      stations,
      speed: 50,
    }).candidates.length,
    0,
  );
});

const proposal = (index: number, start: Vec.Value, headings: number[]) => ({
  index,
  position: start,
  radius: 40,
  candidates: headings.map((heading) => ({
    ...corridor,
    index,
    start,
    heading,
  })),
});

test('global reservations reject crossing capsules and retain distinct alternative routes', () => {
  const first = proposal(0, Vec.create(-900, 0), [0]);
  const second = proposal(1, Vec.create(0, -900), [Math.PI / 2, -Math.PI / 2]);
  const before = JSON.stringify([first, second]);

  const selected = reserveSpreadCorridors({
    proposals: [first, second, second],
  });

  assert.equal(selected.length, 2);
  assert.equal(
    selected[1].heading,
    -Math.PI / 2,
    'Far endpoints do not hide a proper segment crossing',
  );
  assert.equal(
    new Set(selected.map((entry) => entry.index)).size,
    selected.length,
  );
  assert.equal(JSON.stringify([first, second]), before);
});

test('parallel reservation spacing includes both drift allowances and the hull guard', () => {
  const first = proposal(0, Vec.create(), [0]);

  const parallel = (gap: number) =>
    reserveSpreadCorridors({
      proposals: [first, proposal(1, Vec.create(0, gap), [0])],
    });

  assert.equal(parallel(300).length, 2);
  assert.equal(parallel(299.99).length, 1);
});

test('a constrained pilot reserves before a pilot with an available noncrossing alternative', () => {
  const flexible = proposal(0, Vec.create(-900, 0), [0, Math.PI]);
  const constrained = proposal(1, Vec.create(0, -900), [Math.PI / 2]);

  const selected = reserveSpreadCorridors({
    proposals: [flexible, constrained],
  });

  assert.equal(selected.length, 2);
  assert.equal(selected.find((entry) => entry.index === 0).heading, Math.PI);
  assert.equal(
    selected.find((entry) => entry.index === 1).heading,
    Math.PI / 2,
  );
});

test('cruise inputs hold one heading with ordinary binary thrust and coast at target speed', () => {
  const accelerating = spreadCruiseControls({ ship, corridor });

  assert.equal(accelerating.thrust, 1);
  assert.equal(accelerating.turn, 0);

  assert.equal(
    spreadCruiseControls({
      ship: { ...ship, rotation: 0.05 },
      corridor,
    }).turn,
    -1,
    'A settled0.05-radian heading bias receives normal corrective steering',
  );

  assert.equal(
    spreadCruiseControls({
      ship: { ...ship, velocity: Vec.create(51, 0) },
      corridor,
    }).thrust,
    0,
  );

  const turning = spreadCruiseControls({
    ship: { ...ship, rotation: Math.PI },
    corridor,
  });

  assert.equal(turning.thrust, 0);
  assert([-1, 0, 1].includes(turning.turn));
});
