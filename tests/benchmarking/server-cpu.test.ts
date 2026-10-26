import assert from 'node:assert/strict';
import { mock } from 'node:test';
import {
  compatibleWeaponMount,
  dockingControls,
  neutralInput,
} from '../../benchmarking/utilities/ship-controls.ts';
import {
  ownMiningFracture,
  ProtocolClient,
  replicatedAsteroidHealth,
} from '../../benchmarking/server/client.ts';
import {
  proposeMiningTargets,
  reserveMiningTargets,
  isOrdinaryAmmoItem,
  miningAreaContains,
  miningAimPosition,
  miningApproach,
  obstacleSafeTarget,
  obstacleSafeRoute,
  obstacleRadius,
  weaponForClient,
  weaponMeasurementLimit,
  weaponClearAhead,
  weaponStagingControls,
  workloadControls,
} from '../../benchmarking/server/workloads.ts';
import {
  selectServerCpuCases,
  validateProtocolCase,
  summarizeTickSkips,
} from '../../benchmarking/server/run.ts';
import {
  parseCpuList,
  selectServerCpus,
} from '../../benchmarking/server/cores.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

const matrix = selectServerCpuCases({});

assert.deepEqual(parseCpuList('0-2,5,8-9'), [0, 1, 2, 5, 8, 9]);
assert.deepEqual(selectServerCpus([2, 4, 6, 8, 10], 3), [2, 4, 6]);
assert.throws(() => selectServerCpus([2, 4], 3), /exceeds/);
assert.throws(() => selectServerCpus([2, 4], 0), /positive/);
assert.throws(() => selectServerCpus([2, 4], 1.5), /positive/);
assert.throws(() => parseCpuList('3-1'), /Invalid/);

const sharedSkips = summarizeTickSkips([
  {
    index: 0,
    serverTickSkips: [{ previousTick: 10, serverTick: 12, at: 100, gapMs: 66 }],
  },
  {
    index: 1,
    serverTickSkips: [
      { previousTick: 10, serverTick: 12, at: 101, gapMs: 66 },
      { previousTick: 20, serverTick: 23, at: 400, gapMs: 100 },
    ],
  },
]);

assert.equal(sharedSkips[0].sharedByAllClients, true);
assert.equal(sharedSkips[1].sharedByAllClients, false);
assert.deepEqual(sharedSkips[0].clients, [0, 1]);
const ammoCatalog = { ammoRounds: 200, ammoResource: 5 };

const ammoItem = {
  id: 9,
  kind: 'item',
  resource: 5,
  rounds: 200,
} as ReplicatedEntity;

assert(
  isOrdinaryAmmoItem(ammoItem, ammoCatalog),
  'Normal ammo cargo is identified by wire resource/rounds without an unsupported definitionId',
);
assert(!isOrdinaryAmmoItem({ ...ammoItem, resource: 0 }, ammoCatalog));
assert(!isOrdinaryAmmoItem({ ...ammoItem, rounds: 99999 }, ammoCatalog));

assert.equal(matrix.length, 20);

assert.deepEqual(
  matrix.slice(0, 5),
  ['convoy', 'spread', 'contact', 'module', 'weapon'].map((workload) => ({
    players: 4,
    workload,
  })),
);

assert.equal(
  weaponMeasurementLimit({ rounds: 200, fireInterval: 200 }),
  35,
  'One standard item supports30 seconds and a5-second reserve without additional ammunition',
);

assert.deepEqual(
  matrix
    .filter((item) => item.workload === 'weapon')
    .map((item) => item.players),
  [4, 8, 16, 32],
);
assert.deepEqual(selectServerCpuCases({ players: 16, workload: 'spread' }), [
  { players: 16, workload: 'spread' },
]);
assert.throws(() => selectServerCpuCases({ players: 12 }));
assert.throws(() => selectServerCpuCases({ workload: 'unknown' }));
assert.deepEqual(
  Array.from({ length: 8 }, (_, index) => weaponForClient(index)),
  [
    'none',
    'plasmaAccelerator',
    'autogun',
    'laser',
    'none',
    'plasmaAccelerator',
    'autogun',
    'laser',
  ],
);

assert.equal(
  compatibleWeaponMount({
    mounts: [['cargoHatch', 'autogun'], ['autogun']],
    weapon: 'autogun',
    occupied: [0],
  }),
  1,
);

assert.equal(
  compatibleWeaponMount({
    mounts: [['cargoHatch', 'autogun']],
    weapon: 'autogun',
    occupied: [0],
  }),
  0,
);

assert.equal(
  compatibleWeaponMount({
    mounts: [['cargoHatch']],
    weapon: 'autogun',
    occupied: [],
  }),
  undefined,
);

const station: ReplicatedEntity = {
  id: 1,
  kind: 'station',
  position: Vec.create(),
  radius: 300,
  rotation: 0,
  spin: 0,
  velocity: Vec.create(),
};

const ship: ReplicatedEntity = {
  id: 2,
  kind: 'ship',
  position: Vec.create(-500, 0),
  radius: 40,
  rotation: 0,
  spin: 0,
  velocity: Vec.create(),
};

const convoyAroundStation = workloadControls({
  workload: 'convoy',
  index: 0,
  players: 16,
  elapsed: 1,
  ship,
  entities: [station],
});

assert.notEqual(
  convoyAroundStation.turn,
  0,
  'The common convoy heading routes around a station instead of entering its bay',
);

assert.equal(
  workloadControls({
    workload: 'convoy',
    index: 0,
    players: 16,
    elapsed: 7,
    ship,
    entities: [station],
  }).thrust,
  0,
  'Station avoidance preserves the convoy coast interval',
);

const redockedConvoy = Object.assign(Object.create(ProtocolClient.prototype), {
  shipId: ship.id,
  entities: new Map([[ship.id, { ...ship, velocity: Vec.create(50, 0) }]]),
  requiredModules: [],
}) as ProtocolClient;

assert(redockedConvoy.workloadReady('convoy', []));
redockedConvoy.ship.dockedTo = station.id;
assert(
  !redockedConvoy.workloadReady('convoy', []),
  'Fresh readiness rejects a pilot that docked after its earlier moving confirmation',
);
assert(
  !redockedConvoy.measurementReady('convoy', []),
  'Post-warmup ship health still rejects docking',
);
delete redockedConvoy.ship.dockedTo;
redockedConvoy.ship.velocity = Vec.create(5, 0);
assert(
  !redockedConvoy.workloadReady('spread', []),
  'Initial flight confirmation still requires real movement',
);
assert(
  redockedConvoy.measurementReady('spread', []),
  'Temporary braking at the warmup boundary does not replace the measured flight-displacement gate',
);

const bouncingPair = [0, 1].map(
  (index) =>
    Object.assign(Object.create(ProtocolClient.prototype), {
      options: { index },
      shipId: index + 100,
      entities: new Map([
        [
          index + 100,
          { ...ship, id: index + 100, position: Vec.create(index * 117, 0) },
        ],
      ]),
      requiredModules: [],
    }) as ProtocolClient,
);

const closingContact = workloadControls({
  workload: 'contact',
  index: 0,
  players: 4,
  elapsed: 0,
  ship: { ...ship, position: Vec.create(), velocity: Vec.create(100, 0) },
  partner: { ...ship, id: 3, position: Vec.create(200, 0) },
  entities: [],
});

assert.equal(
  closingContact.thrust,
  0,
  'A fast closing contact ship turns to brake rather than accelerating past its partner',
);
assert.notEqual(closingContact.turn, 0);

assert(
  !bouncingPair[0].workloadReady('contact', bouncingPair),
  'Initial contact confirmation remains within the strict30-unit surface gap',
);
assert(
  bouncingPair.every((client) =>
    client.measurementReady('contact', bouncingPair),
  ),
  'A briefly bouncing pair remains an intact contact workload; the unchanged measured gap gate must establish actual contact',
);
bouncingPair[1].entities.clear();
assert(
  !bouncingPair[0].measurementReady('contact', bouncingPair),
  'A missing partner cannot pass post-warmup contact health',
);

const around = dockingControls({ ship, station, bayAngles: [0] });

assert(!around.entering);
assert(
  Vec.length(around.target) >= station.radius + 170,
  'Route around the outer hull rather than across the station',
);

assert(
  !validateProtocolCase({
    clients: [],
    players: 4,
    seconds: 5,
    workload: 'spread',
  }).valid,
);

const entering = dockingControls({
  ship: { ...ship, position: Vec.create(450, 0) },
  station,
  bayAngles: [0],
});

assert(entering.entering);
assert.deepEqual(entering.target, station.position);
assert(
  !dockingControls({ ship, station, bayAngles: [0], entering: true }).entering,
  'Abort entry after losing bay alignment',
);

for (let index = 0; index < 4; index++) {
  const input = workloadControls({
    workload: 'weapon',
    index,
    players: 4,
    elapsed: 10,
    ship: { ...ship, rotation: (index * Math.PI) / 2 },
    entities: [],
  });

  assert.equal(!!input.fire, index !== 0);
  assert.equal(!!input.plasmaActive, index === 1);
  assert.equal(!!input.autogunActive, index === 2);
  assert.equal(!!input.laserActive, index === 3);

  assert(
    !workloadControls({
      workload: 'weapon',
      index,
      players: 4,
      elapsed: 1,
      ship,
      entities: [],
      fanout: true,
    }).fire,
  );
}

assert.equal(neutralInput().thrust, 0);

const surveyPair = [
  {
    ...ship,
    id: 13,
    position: Vec.create(-3973.1387445926666, 5941.445170998573),
    rotation: 2.596952974796295,
    velocity: Vec.create(0.6970692276954651, 2.671092987060547),
    thrust: 1,
  },
  {
    ...ship,
    id: 29,
    position: Vec.create(-4037.5326995253563, 5968.461567759514),
    rotation: -0.5516238808631897,
    velocity: Vec.create(0.2913740873336792, -2.940054774284363),
    thrust: 1,
  },
];

for (const miner of surveyPair) {
  const input = workloadControls({
    workload: 'module',
    index: miner.id,
    players: 32,
    elapsed: 600,
    ship: miner,
    entities: surveyPair,
    fanout: true,
  });

  assert.notEqual(
    input.turn,
    0,
    'Both survey miners steer away from the recorded peer hull overlap',
  );
  assert.equal(input.thrust, 0, 'Turn before resuming outward survey thrust');
}

const surveyThroughAsteroids = workloadControls({
  workload: 'module',
  index: 0,
  players: 32,
  elapsed: 0,
  ship,
  entities: [
    {
      ...ship,
      id: 99,
      kind: 'asteroid',
      position: Vec.add(ship.position, Vec.create(100, 0)),
      radius: 100,
    },
  ],
  fanout: true,
});

assert.equal(surveyThroughAsteroids.turn, 0);
assert.equal(
  surveyThroughAsteroids.thrust,
  1,
  'Peer avoidance preserves ordinary outward flight through asteroid fields',
);

const overspeedSurvey = workloadControls({
  workload: 'module',
  index: 0,
  players: 32,
  elapsed: 0,
  ship: { ...ship, velocity: Vec.create(110, 0) },
  entities: [],
  fanout: true,
});

assert.equal(
  overspeedSurvey.turn,
  0,
  'An aligned survey ship keeps its outward heading after overshooting speed',
);
assert.equal(overspeedSurvey.thrust, 0, 'Survey speed overshoot coasts');

const stationSurveyShip = {
  ...ship,
  id: 7,
  position: Vec.create(-2925.542061686516, 5788.979432582855),
  velocity: Vec.create(-5.202778458595276, -40.513952136039734),
  rotation: -2.2056318521499634,
  spin: -2.4856902360916138,
};

const stoppedSurveyPeer = {
  ...ship,
  id: 11,
  position: Vec.create(-2775.4932966828346, 6351.269274890423),
  thrust: 0,
};

const surveyStation = {
  ...station,
  id: 3970113972,
  position: Vec.create(-3382, 6243),
  radius: 400,
};

const stationSurveyDirection = Vec.create(
  Math.cos((7 * Math.PI) / 16),
  Math.sin((7 * Math.PI) / 16),
);
const stationSurveyDestination = Vec.addScaled(
  stationSurveyShip.position,
  stationSurveyDirection,
  4000,
);

const stoppedSurveyRoute = obstacleSafeRoute({
  ship: stationSurveyShip,
  target: stationSurveyDestination,
  entities: [surveyStation, stoppedSurveyPeer],
  avoidShips: true,
  checkDetours: true,
  lookahead: 500,
});

assert(!stoppedSurveyRoute.blocked);
assert.equal(
  stoppedSurveyRoute.routeChoice,
  'mirrored',
  'A stopped peer permits the clear side when the station blocks passing right',
);
assert(
  Vec.dot(
    Vec.subtract(stoppedSurveyRoute.target, stationSurveyShip.position),
    stationSurveyDirection,
  ) > 0,
  'The recorded station-side route makes outward progress instead of backing away',
);

assert.notEqual(
  obstacleSafeRoute({
    ship: stationSurveyShip,
    target: stationSurveyDestination,
    entities: [surveyStation, { ...stoppedSurveyPeer, thrust: 1 }],
    avoidShips: true,
    checkDetours: true,
    lookahead: 500,
  }).routeChoice,
  'mirrored',
  'A thrusting peer retains the shared right-side passing rule',
);

const warmingWeapon = workloadControls({
  workload: 'weapon',
  index: 2,
  players: 4,
  elapsed: 5,
  ship: { ...ship, rotation: Math.PI },
  entities: [],
  firing: false,
});

assert(
  !warmingWeapon.fire && warmingWeapon.autogunActive,
  'Warmup activates the ordinary weapon without spending ammunition',
);
assert.equal(
  warmingWeapon.thrust,
  0,
  'Weapons coast after the real preparation flyout',
);

assert(
  !weaponClearAhead({
    ship,
    entities: [{ ...station, position: Vec.create(-300, 0), radius: 40 }],
  }),
  'A near forward rock or hull prevents unsafe fire',
);

assert(
  weaponClearAhead({
    ship,
    entities: [{ ...station, position: Vec.create(500, 0), radius: 40 }],
  }),
);

const radarApproach = workloadControls({
  workload: 'module',
  index: 0,
  players: 4,
  elapsed: 0,
  ship,
  entities: [],
  asteroidPositions: [Vec.create(2000, 0)],
});

assert.equal(
  radarApproach.thrust,
  1,
  'Use real radar contacts to reach the asteroid field before geometry enters replication range',
);
assert(
  !radarApproach.hornDrill &&
    radarApproach.cargoHatch &&
    radarApproach.searchLight,
);

const miningShip = { ...ship, position: Vec.create(), rotation: 0 };

const fracturedAim = miningAimPosition({
  asteroid: {
    ...station,
    kind: 'asteroid',
    position: Vec.create(),
    rotation: Math.PI / 2,
    segments: [
      {
        health: 0,
        shapeOutline: [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ],
      },
      {
        health: 20,
        shapeOutline: [
          [100, -20],
          [140, -20],
          [140, 20],
          [100, 20],
        ],
      },
    ] as ReplicatedEntity['segments'],
  },
  position: Vec.create(0, 200),
});

assert(
  Math.abs(fracturedAim.x) < 1e-6 &&
    fracturedAim.y > 130 &&
    fracturedAim.y < 140,
  'Aim inside the nearest rotated living polygon face, not a removed central segment',
);

const faceRock = {
  ...station,
  id: 100,
  kind: 'asteroid',
  position: Vec.create(110, 0),
  radius: 20,
  shapeOutline: [
    [-10, -20],
    [10, -20],
    [10, 20],
    [-10, 20],
  ],
} as ReplicatedEntity;

const fittedDrillTip = { position: Vec.create(46, 0), radius: 3 };

const faceApproach = miningApproach({
  ship: miningShip,
  asteroid: faceRock,
  drillTip: fittedDrillTip,
});

assert.equal(faceApproach.reach, 46);
assert.equal(faceApproach.aim.x - faceApproach.target.x, 46);

const sibling: ReplicatedEntity = {
  ...faceRock,
  id: 101,
  position: Vec.create(180, 0),
  radius: 35,
  shapeOutline: undefined,
};

const miningRoute = (target: Vec.Value, entities: ReplicatedEntity[]) =>
  obstacleSafeRoute({
    ship: miningShip,
    target,
    entities,
    excludedId: faceRock.id,
    avoidShips: true,
    asteroidMargin: 20,
    checkDetours: true,
    lookahead: 500,
  });

assert(
  miningRoute(faceApproach.aim, [faceRock, sibling]).obstacle,
  'A sibling circle covers the drill face',
);
assert.equal(
  miningRoute(faceApproach.target, [faceRock, sibling]).target,
  faceApproach.target,
  'The ordinary ship-center standoff remains clear without ignoring the sibling',
);
assert(
  miningRoute(faceApproach.target, [
    faceRock,
    { ...sibling, position: Vec.create(70, 0) },
  ]).obstacle,
  'A sibling that really blocks the ship-center corridor still participates in the complete safety check',
);

assert.equal(
  workloadControls({
    workload: 'module',
    index: 0,
    players: 4,
    elapsed: 0,
    ship: { ...miningShip, position: Vec.create(61, 0) },
    entities: [faceRock, sibling],
    miningAsteroid: faceRock,
    drillTip: fittedDrillTip,
  }).thrust,
  0,
  'The near controller uses the same fitted drill-center reach as the route endpoint',
);

const opaqueRock: ReplicatedEntity = { ...faceRock, shapeOutline: undefined };

assert.equal(
  miningApproach({
    ship: miningShip,
    asteroid: opaqueRock,
    drillTip: fittedDrillTip,
  }).target,
  opaqueRock.position,
  'An opaque procedural rock retains its conservative center route',
);

const assignedAsteroid: ReplicatedEntity = {
  ...station,
  id: 10,
  kind: 'asteroid',
  position: Vec.create(120, 0),
  radius: 100,
};

const transitShip = { ...miningShip, position: Vec.create(-1000, 0) };
const transitTarget = { ...assignedAsteroid, position: Vec.create(1000, 0) };

const firstRock = {
  ...assignedAsteroid,
  id: 11,
  position: Vec.create(0, 0),
  radius: 50,
};

const largerRock = {
  ...assignedAsteroid,
  id: 12,
  position: Vec.create(100, 0),
  radius: 300,
};

const transitHop = obstacleSafeTarget({
  ship: transitShip,
  target: transitTarget.position,
  entities: [firstRock, transitTarget, largerRock],
  excludedId: transitTarget.id,
});

assert(
  Vec.distance(
    transitHop,
    Vec.create(100 - 1100 * Math.cos(0.35), 1100 * Math.sin(0.35)),
  ) < 1e-6,
  'Detour around the first circle entered, even when its center is farther away',
);

assert.equal(
  obstacleSafeTarget({
    ship: transitShip,
    target: transitTarget.position,
    entities: [transitTarget],
    excludedId: transitTarget.id,
  }),
  transitTarget.position,
  'The assigned asteroid remains directly approachable',
);

const northbound = {
  ...ship,
  id: 20,
  position: Vec.create(0, 100),
  rotation: -Math.PI / 2,
};

const southbound = {
  ...ship,
  id: 21,
  position: Vec.create(0, -100),
  rotation: Math.PI / 2,
};

const northHop = obstacleSafeTarget({
  ship: northbound,
  target: Vec.create(0, -1000),
  entities: [northbound, southbound],
  avoidShips: true,
});

const southHop = obstacleSafeTarget({
  ship: southbound,
  target: Vec.create(0, 1000),
  entities: [northbound, southbound],
  avoidShips: true,
});

assert(
  northHop.x > 0 && southHop.x < 0,
  'Opposing miners choose opposite world sides while both pass to their own right',
);
assert(
  Vec.distance(northHop, southbound.position) >
    northbound.radius + southbound.radius + 80,
);
assert(
  Vec.distance(southHop, northbound.position) >
    northbound.radius + southbound.radius + 80,
);
const noOtherShipTarget = Vec.create(0, -1000);

assert.equal(
  obstacleSafeTarget({
    ship: northbound,
    target: noOtherShipTarget,
    entities: [northbound],
    avoidShips: true,
  }),
  noOtherShipTarget,
  'Own hull is never a navigation obstacle',
);

assert.equal(
  obstacleSafeTarget({
    ship: northbound,
    target: noOtherShipTarget,
    entities: [northbound, southbound],
  }),
  noOtherShipTarget,
  'Static-only callers retain their existing obstacle set',
);

const stalledShip = {
  ...ship,
  position: Vec.create(-4977.418406546116, 1581.6949640512466),
  rotation: 1.0050927996635437,
};

const neighboringFragment = {
  ...assignedAsteroid,
  id: 31,
  position: Vec.create(-5388.5732598900795, 1847.1721359491348),
  radius: 58.743746241632934,
};

const reachableFace = Vec.create(-5283.923531441261, 1782.2429181576292);

assert.equal(
  obstacleSafeTarget({
    ship: stalledShip,
    target: reachableFace,
    entities: [neighboringFragment],
    asteroidMargin: 20,
    avoidShips: true,
  }),
  reachableFace,
  'A real reachable mining face outside physical hulls is not blocked by an unrelated80-unit transit padding',
);

assert.notEqual(
  obstacleSafeTarget({
    ship: stalledShip,
    target: reachableFace,
    entities: [neighboringFragment],
  }),
  reachableFace,
  'Default and weapon asteroid padding remains80',
);

const tinyDeltaShip = { ...ship, position: Vec.create(500, 0) };

const tinyDeltaRock = {
  ...assignedAsteroid,
  position: Vec.create(),
  radius: 60,
};

const usefulHop = obstacleSafeTarget({
  ship: tinyDeltaShip,
  target: Vec.create(80, 2),
  entities: [tinyDeltaRock],
  asteroidMargin: 20,
});

assert(
  Vec.distance(usefulHop, tinyDeltaShip.position) > 16,
  'A genuinely blocked nearly radial route produces a hop beyond the stationary approach deadzone',
);
assert(
  Vec.distance(usefulHop, tinyDeltaRock.position) >
    tinyDeltaRock.radius + tinyDeltaShip.radius + 20,
);

const detourShip = { ...ship, position: Vec.create(-500, 0) };

const detourRock = {
  ...assignedAsteroid,
  id: 32,
  position: Vec.create(),
  radius: 100,
};

const detourTarget = Vec.create(500, 0);

const distantShip = { ...ship, position: Vec.create(), rotation: 0 };

const distantTarget = Vec.create(2500, 0);

const distantRock = {
  ...detourRock,
  id: 36,
  position: Vec.create(1800, 0),
};

const distantTrap = [
  distantRock,
  { ...detourRock, id: 37, position: Vec.create(54, 309) },
  { ...detourRock, id: 38, position: Vec.create(54, -309) },
  { ...detourRock, id: 39, position: Vec.create(-200, 0) },
];

assert(
  obstacleSafeRoute({
    ship: distantShip,
    target: distantTarget,
    entities: distantTrap,
    asteroidMargin: 20,
    checkDetours: true,
  }).blocked,
  'Premature hops around a distant blocker can all intersect local rocks despite a clear immediate approach',
);

assert.equal(
  obstacleSafeRoute({
    ship: distantShip,
    target: distantTarget,
    entities: distantTrap,
    asteroidMargin: 20,
    checkDetours: true,
    lookahead: 500,
  }).target,
  distantTarget,
  'Continue the clear local approach before planning a detour around a blocker more than500 units ahead',
);

assert.equal(
  workloadControls({
    workload: 'module',
    index: 0,
    players: 32,
    elapsed: 0,
    ship: distantShip,
    entities: distantTrap,
    miningAnchor: distantTarget,
  }).thrust,
  1,
  'A distant blocked hop cannot neutralize the actual mining approach input forever',
);

const largeNearEdge = obstacleSafeRoute({
  ship: distantShip,
  target: distantTarget,
  entities: [{ ...distantRock, position: Vec.create(700, 0), radius: 200 }],
  asteroidMargin: 20,
  checkDetours: true,
  lookahead: 500,
});

assert(largeNearEdge.obstacle.routeEntry < 500);
assert.notEqual(
  largeNearEdge.target,
  distantTarget,
  'A large obstacle with a nearby inflated edge still requires a checked detour even when its center is beyond500 units',
);
assert(!largeNearEdge.blocked);

const uncheckedHop = obstacleSafeTarget({
  ship: detourShip,
  target: detourTarget,
  entities: [detourRock],
  asteroidMargin: 20,
});

const endpointRock = {
  ...detourRock,
  id: 33,
  position: Vec.create(-450, 210),
  radius: 50,
};

const mirroredRoute = obstacleSafeRoute({
  ship: detourShip,
  target: detourTarget,
  entities: [detourRock, endpointRock],
  asteroidMargin: 20,
  checkDetours: true,
});

assert(
  Vec.distance(uncheckedHop, endpointRock.position) <
    endpointRock.radius + detourShip.radius,
  'The old preferred hop can enter another actual bounding hull',
);
assert.equal(mirroredRoute.routeChoice, 'mirrored');
assert(
  mirroredRoute.target.y < 0,
  'Use the checked opposite static side when the preferred endpoint intersects another rock',
);

const segmentRock = {
  ...detourRock,
  id: 34,
  position: Vec.scale(Vec.add(detourShip.position, uncheckedHop), 0.5),
  radius: 1,
};

assert(
  Vec.distance(uncheckedHop, segmentRock.position) >
    segmentRock.radius + detourShip.radius + 20,
  'An endpoint-only check would accept this hop',
);

assert.equal(
  obstacleSafeRoute({
    ship: detourShip,
    target: detourTarget,
    entities: [detourRock, segmentRock],
    asteroidMargin: 20,
    checkDetours: true,
  }).routeChoice,
  'mirrored',
  'Reject a clear endpoint whose approach segment crosses another rock',
);

const insideShip = { ...ship, position: Vec.create(-150, 0) };

const escapeRoute = obstacleSafeRoute({
  ship: insideShip,
  target: detourTarget,
  entities: [detourRock],
  asteroidMargin: 20,
  checkDetours: true,
});

const escapeStep = Vec.subtract(escapeRoute.target, insideShip.position);

assert(!escapeRoute.blocked);
assert(escapeRoute.initialOverlapIds.includes(detourRock.id));
assert(
  Vec.dot(Vec.subtract(insideShip.position, detourRock.position), escapeStep) >=
    0,
  'Initial-overlap escape never moves deeper into the circle',
);
assert(
  Vec.distance(escapeRoute.target, detourRock.position) >
    Vec.distance(insideShip.position, detourRock.position),
);

const constrainedRoute = obstacleSafeRoute({
  ship: { ...ship, position: Vec.create() },
  target: Vec.create(1000, 0),
  entities: [
    { ...detourRock, position: Vec.create(-100, 0), radius: 40 },
    { ...detourRock, id: 35, position: Vec.create(100, 0), radius: 40 },
  ],
  asteroidMargin: 20,
  checkDetours: true,
});

assert(
  constrainedRoute.blocked,
  'Report a blocked route when every bounded candidate enters another circle',
);
assert.deepEqual(
  constrainedRoute.target,
  Vec.create(),
  'A blocked route stops instead of returning a known unsafe hop',
);

const blockedMovingInput = workloadControls({
  workload: 'module',
  index: 0,
  players: 32,
  elapsed: 0,
  ship: {
    ...ship,
    position: Vec.create(),
    rotation: 0,
    velocity: Vec.create(-30, 0),
  },
  entities: [
    { ...detourRock, position: Vec.create(-100, 0), radius: 40 },
    { ...detourRock, id: 35, position: Vec.create(100, 0), radius: 40 },
  ],
  miningAnchor: Vec.create(1000, 0),
});

assert.equal(
  blockedMovingInput.thrust,
  0,
  "A moving ship on a blocked mining route must not apply the approach controller's braking thrust",
);
assert(blockedMovingInput.cargoHatch && blockedMovingInput.searchLight);

assert.deepEqual(
  obstacleSafeTarget({
    ship: detourShip,
    target: detourTarget,
    entities: [detourRock, endpointRock],
    asteroidMargin: 20,
  }),
  uncheckedHop,
  'Default weapon routing retains its prior unchecked choice',
);

const outlineObstacle = {
  ...firstRock,
  position: Vec.create(0, 200),
  rotation: Math.PI / 2,
  radius: 10,
  shapeOutline: [
    [-150, -150],
    [150, -150],
    [150, 150],
    [-150, 150],
  ],
};

assert.notEqual(
  obstacleSafeTarget({
    ship: transitShip,
    target: transitTarget.position,
    entities: [outlineObstacle],
    excludedId: transitTarget.id,
  }),
  transitTarget.position,
  'Supplied polygon extents bound an intervening rock independently of its radius and rotation',
);

const nearBlockedShip = { ...miningShip, position: Vec.create(-250, 0) };

const nearBlockedTarget = {
  ...transitTarget,
  position: Vec.create(0, 0),
  radius: 200,
};

const nearBlocker = { ...firstRock, position: Vec.create(-160, 0), radius: 25 };

const blockedInput = workloadControls({
  workload: 'module',
  index: 0,
  players: 4,
  elapsed: 0,
  ship: nearBlockedShip,
  entities: [nearBlocker, nearBlockedTarget],
  miningAsteroid: nearBlockedTarget,
  miningAnchor: nearBlockedTarget.position,
  mining: false,
});

assert.equal(
  blockedInput.thrust,
  0,
  'A transit obstruction also overrides the near-target heading branch',
);
assert.notEqual(blockedInput.turn, 0);
assert(
  !blockedInput.hornDrill,
  'Preparation transit retains the drill-off barrier',
);

const nearerOwnedRock = {
  ...firstRock,
  position: Vec.create(-400, 0),
  radius: 100,
};

const approachingMiner = Object.assign(
  Object.create(ProtocolClient.prototype),
  {
    options: { runtime: { catalog: { moduleIds: [], ships: {} } } },
    shipId: 101,
    entities: new Map([
      [101, { ...transitShip, id: 101 }],
      [transitTarget.id, { ...transitTarget, position: Vec.create(400, 0) }],
      [nearerOwnedRock.id, nearerOwnedRock],
    ]),
    miningAnchor: Vec.create(),
    miningAsteroidId: transitTarget.id,
    miningTargetIds: new Set([transitTarget.id]),
    miningReplans: [],
    miningEnabled: false,
  },
) as ProtocolClient;

assert.equal(
  approachingMiner.miningAsteroid.id,
  transitTarget.id,
  "Initial approach preserves the globally reserved real asteroid instead of silently switching to another client's candidate",
);

const miningClock = mock.method(performance, 'now', () => 0);

approachingMiner.enableMining();
approachingMiner.ship.position = Vec.create(-800, 0);
approachingMiner.lastInput = { ...neutralInput(), hornDrill: true };
miningClock.mock.mockImplementation(() => 120000);
assert.equal(
  approachingMiner.miningAsteroid.id,
  transitTarget.id,
  'A normal transit longer than five seconds retains its live owned target instead of blacklisting it',
);

assert(
  workloadControls({
    workload: 'module',
    index: 0,
    players: 32,
    elapsed: 120,
    ship: approachingMiner.ship,
    entities: [...approachingMiner.entities.values()],
    miningAnchor: approachingMiner.miningAnchor,
    miningAsteroid: approachingMiner.miningAsteroid,
  }).hornDrill,
  'Long ordinary transit inside the working area does not manufacture a no-target powered-duty gap',
);

approachingMiner.entities.get(transitTarget.id).health = 0;
assert.equal(
  approachingMiner.miningAsteroid.id,
  nearerOwnedRock.id,
  'A depleted target releases its binding and selects another live owned rock',
);
nearerOwnedRock.segments = [{ health: 0 }] as ReplicatedEntity['segments'];
assert.equal(
  approachingMiner.miningAsteroid,
  undefined,
  'A zero-health polygon shell cannot remain a mining target',
);

nearerOwnedRock.segments = [
  {
    health: 1,
    shapeOutline: [
      [0, 0],
      [10, 0],
      [0, 10],
    ],
  },
] as ReplicatedEntity['segments'];

assert.equal(
  approachingMiner.miningAsteroid.id,
  nearerOwnedRock.id,
  'An available living face is immediately eligible without an artificial ten-second ignore period',
);
delete nearerOwnedRock.segments;
miningClock.mock.restore();

const openWholeRock = {
  ...assignedAsteroid,
  id: 50,
  position: Vec.create(500, 500),
  radius: 150,
};

const hiddenBehindRock = {
  ...assignedAsteroid,
  id: 51,
  position: Vec.create(1000, 0),
  radius: 150,
};

const proposal = proposeMiningTargets({
  index: 0,
  ship: miningShip,
  entities: [
    openWholeRock,
    hiddenBehindRock,
    { ...assignedAsteroid, id: 52, position: Vec.create(500, 0), radius: 30 },
    { ...assignedAsteroid, id: 53, position: Vec.create(-500, 500), decay: 1 },
    {
      ...assignedAsteroid,
      id: 54,
      position: Vec.create(-500, -500),
      shapeOutline: [
        [-50, 0],
        [50, 0],
        [0, 50],
      ],
    },
    {
      ...assignedAsteroid,
      id: 55,
      position: Vec.create(500, -500),
      segments: [
        {
          health: 10,
          shapeOutline: [
            [-50, 0],
            [50, 0],
            [0, 50],
          ],
        },
      ] as ReplicatedEntity['segments'],
    },
  ],
});

assert.deepEqual(
  proposal.candidates.map((candidate) => candidate.asteroidId),
  [openWholeRock.id],
  'Propose only a visible whole live rock with a clear full approach, excluding fragmented, decaying and occluded targets',
);
assert.equal(proposal.wholeRocks, 2);

const sustainedMining = proposeMiningTargets({
  index: 0,
  ship: miningShip,
  entities: [
    {
      ...openWholeRock,
      id: 70,
      position: Vec.create(400, 0),
      radius: 66.85356454,
    },
    {
      ...openWholeRock,
      id: 71,
      position: Vec.create(-700, 700),
      radius: 149.21813034,
    },
    {
      ...openWholeRock,
      id: 72,
      position: Vec.create(900, 900),
      radius: 158.70816465,
    },
  ],
});

assert.deepEqual(
  sustainedMining.candidates.map((candidate) => candidate.asteroidId),
  [72, 71],
  'Reserve a larger intact deposit ahead of nearer rocks that can deplete during the drilling window',
);
assert.equal(
  Math.round(
    Vec.distance(proposal.candidates[0].contact, openWholeRock.position),
  ),
  openWholeRock.radius + miningShip.radius,
  'The nominal contact reservation uses observed bounding radii; physical drill contact remains separately required',
);

const firstReservation = reserveMiningTargets({ proposals: [proposal] });

const secondProposal = {
  index: 1,
  position: Vec.create(-2000, -500),
  radius: 40,
  wholeRocks: 3,
  candidates: [
    { ...proposal.candidates[0], distance: 1 },
    {
      ...proposal.candidates[0],
      asteroidId: 56,
      contact: Vec.add(proposal.candidates[0].contact, Vec.create(100, 0)),
      distance: 2,
    },
    {
      asteroidId: 57,
      asteroidRadius: 100,
      anchor: Vec.create(-2000, 500),
      contact: Vec.create(-2000, 360),
      distance: 860,
    },
  ],
};

const reservations = reserveMiningTargets({
  proposals: [secondProposal],
  reserved: firstReservation,
});

assert.equal(reservations.length, 2);
assert.equal(
  reservations[1].asteroidId,
  57,
  'Global reservations reject shared IDs and overlapping hull contact poses, choosing another real proposed approach',
);
assert.equal(firstReservation.length, 1, 'Reservation input remains unchanged');

assert.equal(
  reserveMiningTargets({
    proposals: [
      { ...secondProposal, candidates: secondProposal.candidates.slice(0, 2) },
    ],
    reserved: firstReservation,
  }).length,
  1,
  'Insufficient clear exclusive targets remain unassigned instead of fabricating or sharing a rock',
);

const crossingReservation = reserveMiningTargets({
  proposals: [
    {
      ...secondProposal,
      position: Vec.create(-2500, 0),
      candidates: [
        {
          asteroidId: 58,
          asteroidRadius: 100,
          anchor: Vec.create(2500, 0),
          contact: Vec.create(2360, 0),
          distance: 4860,
        },
      ],
    },
  ],
  reserved: [
    {
      ...firstReservation[0],
      position: Vec.create(),
      contact: Vec.create(),
      anchor: Vec.create(0, -140),
    },
  ],
});

assert.equal(
  crossingReservation.length,
  1,
  'A new approach cannot pass through an earlier prepared ship even when its endpoint is separated',
);

const crossingApproaches = reserveMiningTargets({
  proposals: [
    {
      index: 0,
      position: Vec.create(-2000, 0),
      radius: 40,
      wholeRocks: 1,
      candidates: [
        {
          asteroidId: 60,
          asteroidRadius: 60,
          anchor: Vec.create(2100, 0),
          contact: Vec.create(2000, 0),
          distance: 4000,
        },
      ],
    },
    {
      index: 1,
      position: Vec.create(0, -2000),
      radius: 40,
      wholeRocks: 1,
      candidates: [
        {
          asteroidId: 61,
          asteroidRadius: 60,
          anchor: Vec.create(0, 2100),
          contact: Vec.create(0, 2000),
          distance: 4000,
        },
      ],
    },
  ],
});

assert.equal(
  crossingApproaches.length,
  1,
  'Simultaneous perpendicular approaches cannot cross even when both endpoints clear the other route',
);

assert.equal(
  reserveMiningTargets({
    proposals: [
      { ...secondProposal, candidates: secondProposal.candidates.slice(2) },
    ],
    reserved: [
      { ...firstReservation[0], position: firstReservation[0].contact },
    ],
  }).length,
  2,
  'An earlier completed zero-length route does not create a spurious crossing',
);

assert.equal(
  replicatedAsteroidHealth({ ...assignedAsteroid, health: 17 }),
  17,
  'Single-piece fragment damage is carried in normal entity health',
);

assert.equal(
  replicatedAsteroidHealth({
    ...assignedAsteroid,
    health: 100,
    segments: [{ health: 3 }, { health: 4 }] as ReplicatedEntity['segments'],
  }),
  7,
  'Multi-piece rock damage uses segment health rather than its coarse entity field',
);

assert.equal(
  replicatedAsteroidHealth({
    ...assignedAsteroid,
    health: 100,
    segments: [{ health: 0 }] as ReplicatedEntity['segments'],
  }),
  0,
);

const miningInput = (entities: ReplicatedEntity[], mining = true) =>
  workloadControls({
    workload: 'module',
    index: 0,
    players: 8,
    elapsed: 0,
    ship: miningShip,
    entities,
    miningAnchor: assignedAsteroid.position,
    miningAsteroid: assignedAsteroid,
    mining,
  });

assert(
  miningInput([assignedAsteroid]).hornDrill,
  'Drill at the close, aligned assigned rock',
);
assert(
  !miningInput([assignedAsteroid], false).hornDrill,
  'Keep every drill off until the global preparation barrier',
);
assert(
  !miningInput([
    assignedAsteroid,
    { ...ship, id: 9, position: Vec.create(60, 20) },
  ]).hornDrill,
  'A nearby peer disables the drill instead of taking friendly damage',
);

assert(
  !workloadControls({
    workload: 'module',
    index: 0,
    players: 8,
    elapsed: 0,
    ship: miningShip,
    entities: [assignedAsteroid],
    miningAnchor: Vec.create(2000, 0),
  }).hornDrill,
  'A different nearby asteroid must not silently replace the assigned area',
);

assert(
  miningAreaContains({
    position: Vec.create(400, 0),
    anchor: Vec.create(),
  }),
  'A drifting fragment remains inside its own reserved working disk',
);

assert(
  !miningAreaContains({
    position: Vec.create(0, 900),
    anchor: Vec.create(),
  }),
  'The working-disk boundary is excluded',
);

assert(
  !miningAreaContains({ position: Vec.create(1000, 0), anchor: Vec.create() }),
  'Mining target search stays bounded to a local area',
);

const healthy = {
  index: 0,
  snapshotsPerSecond: 30,
  requestedReceipts: 150,
  sentReceipts: 150,
  receiptFailures: 0,
  receiptWritesCompleted: 150,
  receiptWritesPending: 0,
  missingInputAcknowledgments: 0,
  longestSnapshotSilenceMs: 34,
  longestSnapshotGapMs: 34,
  serverTickGap: { max: 1 },
  errors: [],
  closedUnexpectedly: false,
  deaths: 0,
  shipAlive: true,
  activity: {
    maximumDisplacement: 100,
    movingFraction: 1,
    maximumCorridorDeviation: 0,
    weaponFlyout: { displacement: 100 },
  },
  snapshots: 150,
  weapon: {
    kind: 'autogun',
    activeSnapshots: 150,
    firingSnapshots: 150,
    activeFraction: 1,
    firingFraction: 1,
    fireCooldownStarts: 24,
    ammoStart: 200,
    ammoEnd: 175,
    minimumAmmo: 175,
    cooldownSnapshots: 100,
  },
} as unknown as Parameters<typeof validateProtocolCase>[0]['clients'][number];

assert(
  !validateProtocolCase({
    clients: [healthy],
    players: 4,
    seconds: 5,
    workload: 'weapon',
  }).valid,
);

assert(
  validateProtocolCase({ clients: [healthy], seconds: 5, workload: 'weapon' })
    .valid,
);

for (const adverse of [
  { snapshots: 0 },
  { sentReceipts: 149 },
  { receiptWritesCompleted: 149 },
  { receiptWritesPending: 1 },
  { missingInputAcknowledgments: 1 },
  { deaths: 1 },
  { loadoutIntact: false },
  { missingModuleSnapshots: 1 },
  { weapon: { ...healthy.weapon, ammoEnd: 200 } },
  { weapon: { ...healthy.weapon, minimumAmmo: 0 } },
  { weapon: { ...healthy.weapon, activeSnapshots: 0, activeFraction: 0 } },
  {
    weapon: {
      ...healthy.weapon,
      activeSnapshots: 1,
      firingSnapshots: 1,
      activeFraction: 1 / 150,
      firingFraction: 1 / 150,
      fireCooldownStarts: 1,
    },
  },
  { weapon: { ...healthy.weapon, fireCooldownStarts: 0 } },
]) {
  assert(
    !validateProtocolCase({
      clients: [{ ...healthy, ...adverse } as typeof healthy],
      seconds: 5,
      workload: 'weapon',
    }).valid,
    JSON.stringify(adverse),
  );
}

for (const cadence of [
  { snapshotsPerSecond: 29 },
  { longestSnapshotSilenceMs: 200 },
  { serverTickGap: { max: 2 } },
]) {
  const result = validateProtocolCase({
    clients: [{ ...healthy, ...cadence } as typeof healthy],
    seconds: 5,
    workload: 'weapon',
  });

  assert(
    result.valid,
    'Isolated server cadence issues do not prove the load client failed to consume emitted packets',
  );
  assert(
    !result.serverCadence.valid,
    'Cadence concerns remain explicit even when CPU load qualification passes',
  );
}

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        network: { bufferedBytesAtEnd: 10 },
      } as unknown as typeof healthy,
    ],
    seconds: 5,
    workload: 'weapon',
  }).valid,
);

const miningActivity = {
  ...healthy.activity,
  drillFraction: 1,
  hatchFraction: 1,
  lightFraction: 1,
  minimumAsteroidSurfaceGap: 10,
  minimumAssignedAsteroidSurfaceGap: 10,
  assignedAsteroidDamageChanges: 1,
  maximumMiningAnchorDistance: 100,
  asteroidDamageChanges: 1,
};

const ownFracture = {
  sound: { effect: 4, id: 10, by: 7, position: Vec.create(10, 0) },
  playerId: 7,
  drilling: true,
  anchor: Vec.create(),
};

assert(ownMiningFracture(ownFracture));

assert(
  ownMiningFracture({
    ...ownFracture,
    targetIds: new Set([10]),
    sound: { ...ownFracture.sound, position: Vec.create(340, 0) },
  }),
  'The authoritative ID preserves attribution when an assigned rock face extends over an abstract cell boundary',
);

assert(
  !ownMiningFracture({ ...ownFracture, playerId: 8 }),
  "Another player's nearby fracture cannot prove own mining",
);
assert(
  !ownMiningFracture({ ...ownFracture, drilling: false }),
  'A fracture while the drill was off cannot prove active drilling',
);

assert(
  !ownMiningFracture({
    ...ownFracture,
    sound: { ...ownFracture.sound, position: Vec.create(1000, 0) },
  }),
  'Fractures outside the reserved working disk do not count',
);

assert(
  validateProtocolCase({
    clients: [{ ...healthy, activity: miningActivity } as typeof healthy],
    seconds: 5,
    workload: 'module',
  }).valid,
);

for (const maximumMiningAnchorDistance of [900, 934.69, Infinity, NaN]) {
  assert(
    !validateProtocolCase({
      clients: [
        {
          ...healthy,
          activity: { ...miningActivity, maximumMiningAnchorDistance },
        } as typeof healthy,
      ],
      seconds: 5,
      workload: 'module',
    }).valid,
    'Real damage and powered duty cannot conceal a miner outside its working disk',
  );
}

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: { ...miningActivity, drillFraction: 1 / 150 },
      } as typeof healthy,
    ],
    seconds: 5,
    workload: 'module',
  }).valid,
  'One active drill observation must not conceal a mostly idle mining workload',
);

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: { ...miningActivity, assignedAsteroidDamageChanges: 0 },
      } as typeof healthy,
    ],
    seconds: 5,
    workload: 'module',
  }).valid,
  'Damage elsewhere in the sector cannot stand in for mining at the assigned rock',
);

assert(
  workloadControls({
    workload: 'module',
    index: 0,
    players: 8,
    elapsed: 0,
    ship: { ...miningShip, rotation: Math.PI },
    entities: [assignedAsteroid],
    miningAnchor: assignedAsteroid.position,
    miningAsteroid: assignedAsteroid,
  }).hornDrill,
  'Keep the drill powered while reorienting within a clear reserved mining area',
);

assert(
  workloadControls({
    workload: 'module',
    index: 0,
    players: 8,
    elapsed: 10,
    ship: { ...miningShip, position: Vec.create(0, 400) },
    entities: [{ ...assignedAsteroid, position: Vec.create(0, 320) }],
    miningAnchor: Vec.create(),
    miningAsteroid: { ...assignedAsteroid, position: Vec.create(0, 320) },
  }).hornDrill,
  'A miner may safely approach its owned boundary rock from either side when other hulls are clear',
);

assert(
  workloadControls({
    workload: 'module',
    index: 0,
    players: 8,
    elapsed: 10,
    ship: miningShip,
    entities: [{ ...assignedAsteroid, position: Vec.create(500, 0) }],
    miningAnchor: Vec.create(),
    miningAsteroid: { ...assignedAsteroid, position: Vec.create(500, 0) },
  }).hornDrill,
  'Once prepared, normal local fragment pursuit keeps the drill powered within its bounded clear owned cell',
);

assert(
  validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: {
          ...miningActivity,
          assignedAsteroidDamageChanges: 0,
          asteroidDamageChanges: 0,
          ownMiningFractures: [
            { ...ownFracture.sound, at: 1, boundTarget: true },
          ],
        },
      } as typeof healthy,
    ],
    seconds: 5,
    workload: 'module',
  }).valid,
  'A responsible-player fracture covers a target that disappears before another health observation',
);

assert(
  validateProtocolCase({
    clients: [
      {
        ...healthy,
        weapon: {
          ...healthy.weapon,
          kind: 'plasmaAccelerator',
          fireCooldownStarts: 2,
          chargeSnapshots: 0,
        },
      },
    ],
    seconds: 5,
    workload: 'weapon',
  }).valid,
  'A settled charged plasma weapon proves new cycles through cooldown starts, without requiring leftover initial charge',
);

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        weapon: {
          ...healthy.weapon,
          kind: 'plasmaAccelerator',
          fireCooldownStarts: 0,
          cooldownSnapshots: 150,
          chargeSnapshots: 150,
        },
      },
    ],
    seconds: 5,
    workload: 'weapon',
  }).valid,
  'Residual cooldown/charge state does not establish a new shot',
);

const beyondOldTarget = {
  ...ship,
  position: Vec.create(0, 9000),
  rotation: Math.PI / 2,
};

const staged = weaponStagingControls({
  ship: beyondOldTarget,
  index: 1,
  players: 4,
  entities: [station],
});

assert(staged.ready && staged.clear);
assert.equal(staged.input.thrust, 0);

const stillCoasting = weaponStagingControls({
  ship: { ...beyondOldTarget, velocity: Vec.create(0, 100) },
  index: 1,
  players: 4,
  entities: [station],
});

assert(!stillCoasting.ready && stillCoasting.clear);
assert.equal(
  stillCoasting.input.thrust,
  0,
  'A clear ship physically coasts to a settled speed',
);

const blockedStage = weaponStagingControls({
  ship: beyondOldTarget,
  index: 1,
  players: 4,
  entities: [{ ...assignedAsteroid, position: Vec.create(0, 9200) }],
});

assert(!blockedStage.ready && !blockedStage.clear);
assert(
  blockedStage.input.turn || blockedStage.input.thrust,
  'Blocked staging resumes ordinary obstacle-aware navigation instead of parking permanently',
);

const recoveringWeapon = workloadControls({
  workload: 'weapon',
  index: 1,
  players: 4,
  elapsed: 15,
  ship: beyondOldTarget,
  entities: [{ ...assignedAsteroid, position: Vec.create(0, 9200) }],
  firing: false,
});

assert(!recoveringWeapon.fire && recoveringWeapon.plasmaActive);
assert(
  recoveringWeapon.turn || recoveringWeapon.thrust,
  'A lane blocked after initial settlement resumes ordinary nonfiring preparation during warmup',
);

assert.equal(
  workloadControls({
    workload: 'weapon',
    index: 1,
    players: 4,
    elapsed: 15,
    ship: beyondOldTarget,
    entities: [],
    firing: false,
  }).thrust,
  0,
  'Once the lane clears the same warmup controller coasts again',
);

const outward = workloadControls({
  workload: 'weapon',
  index: 1,
  players: 4,
  elapsed: 60,
  ship: beyondOldTarget,
  entities: [station],
});

assert.equal(outward.thrust, 0);
assert.equal(outward.turn, 0);
assert(
  outward.fire,
  'Hold outward fire while coasting instead of returning to the former fixed-radius target',
);

assert.equal(
  workloadControls({
    workload: 'weapon',
    index: 1,
    players: 4,
    elapsed: 0,
    ship: beyondOldTarget,
    entities: [],
    fanout: true,
  }).thrust,
  1,
  'Ordinary preparation flyout still uses thrust',
);

assert(
  validateProtocolCase({
    clients: [
      { ...healthy, activity: { ...healthy.activity, maximumDisplacement: 0 } },
    ],
    seconds: 5,
    workload: 'weapon',
  }).valid,
  'Weapon traffic uses retained preparation flight evidence rather than forcing in-window travel',
);

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: { ...healthy.activity, weaponFlyout: undefined },
      },
    ],
    seconds: 5,
    workload: 'weapon',
  }).valid,
  'The weapon fixture must prove an ordinary premeasurement flyout',
);

assert(
  !workloadControls({
    workload: 'weapon',
    index: 1,
    players: 4,
    elapsed: 60,
    ship: beyondOldTarget,
    entities: [station, { ...station, id: 3, position: Vec.create(0, 9400) }],
  }).fire,
  'Every nearby station must clear the safety radius, including a second station in the snapshot',
);

assert(
  !validateProtocolCase({
    clients: [
      { ...healthy, activity: { ...healthy.activity, maximumDisplacement: 0 } },
    ],
    seconds: 5,
    workload: 'spread',
  }).valid,
  'A ship that remains stationary during the actual flight window is still rejected',
);

const roundWreck: ReplicatedEntity = {
  ...ship,
  radius: 0,
  wreckage: [{ radius: 2, offset: Vec.create(3, 4), health: 1 }],
};

assert.equal(
  obstacleRadius(roundWreck),
  7,
  'A radius-zero detached craft retains its living round collider and local offset',
);

const polygonWreck: ReplicatedEntity = {
  ...roundWreck,
  wreckage: [
    {
      radius: 999,
      offset: Vec.create(10, -5),
      health: 2,
      shapeOutline: [
        [4, 3],
        [0, 0],
        [1, 2],
      ],
    },
    { radius: 100, offset: Vec.create(100, 100), health: 0.5 },
  ],
};

assert.equal(
  obstacleRadius(polygonWreck),
  Math.sqrt(200),
  'A living wreck polygon uses actual offset-plus-points geometry and excludes parts below one health',
);

assert.equal(
  obstacleRadius({
    ...roundWreck,
    wreckage: [{ ...roundWreck.wreckage[0], health: 0 }],
  }),
  0,
  'Dead detached parts do not enlarge the physical obstacle',
);

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: {
          ...healthy.activity,
          maximumDisplacement: 30,
          movingFraction: 1,
        },
      },
    ],
    seconds: 30,
    workload: 'spread',
  }).valid,
  'Thirty units over a thirty-second spread capture is not meaningful spreading',
);

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: {
          ...healthy.activity,
          maximumDisplacement: 1000,
          movingFraction: 0.1,
        },
      },
    ],
    seconds: 30,
    workload: 'spread',
  }).valid,
  'A brief initial flight followed by a jam fails the sustained-motion gate',
);

assert(
  validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: {
          ...healthy.activity,
          maximumDisplacement: 600,
          movingFraction: 0.8,
        },
      },
    ],
    seconds: 30,
    workload: 'spread',
  }).valid,
  'The documented spread displacement and eighty-percent motion boundaries are inclusive',
);

assert(
  !validateProtocolCase({
    clients: [
      {
        ...healthy,
        activity: {
          ...healthy.activity,
          maximumDisplacement: 1500,
          maximumCorridorDeviation: 61,
        },
      },
    ],
    seconds: 30,
    workload: 'spread',
  }).valid,
  'Meaningful forward motion cannot conceal leaving the physically reserved corridor',
);

console.log(
  'Server CPU matrix, physical approach, loadout, and invalid-load checks passed',
);
