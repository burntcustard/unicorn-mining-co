import assert from 'node:assert/strict';
import { mock } from 'node:test';
import WebSocket from 'ws';
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
  advanceSurvey,
  proposeMiningTargets,
  reserveSpreadCorridors,
  spreadCorridorClear,
  spreadCruiseControls,
  spreadCruiseSpeed,
  spreadRemainingDistance,
  reserveMiningTargets,
  isOrdinaryAmmoItem,
  miningAreaContains,
  miningApproach,
  surveyTravelRoute,
  obstacleSafeTarget,
  obstacleSafeRoute,
  obstacleRadius,
  weaponForClient,
  weaponAmmoPacks,
  weaponClearAhead,
  weaponStagingControls,
  workloadControls,
} from '../../benchmarking/server/workloads.ts';
import {
  selectServerCpuCases,
  validateProtocolCase,
  summarizeTickSkips,
  beginProtocolCoreSetup,
  finishInterruptedProtocolCapture,
} from '../../benchmarking/server/run.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

const matrix = selectServerCpuCases({});

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
  weaponAmmoPacks({ seconds: 26.99, rounds: 200, fireInterval: 160 }),
  1,
  'One pack suffices just below the measurement and reserve boundary',
);
assert.equal(
  weaponAmmoPacks({ seconds: 27, rounds: 200, fireInterval: 160 }),
  2,
  'Exact exhaustion at the reserve boundary requires another pack',
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

const socket: { readyState: number } = { readyState: WebSocket.CONNECTING };

const redockedConvoy = Object.assign(Object.create(ProtocolClient.prototype), {
  socket,
  options: { index: 0 },
  errors: [],
  closedUnexpectedly: false,
  welcomed: true,
  measuring: false,
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

assert.throws(() => redockedConvoy.start(), /WebSocket is not open/);
redockedConvoy.assertHealthy({ allowConnecting: true });
socket.readyState = WebSocket.OPEN;

await assert.rejects(
  redockedConvoy.until(() => {
    socket.readyState = WebSocket.CLOSED;
    return false;
  }, 'Waiting for progress'),
  /WebSocket is not open/,
);

const surveyPilot = Object.assign(Object.create(ProtocolClient.prototype), {
  shipId: ship.id,
  entities: new Map([[ship.id, { ...ship, velocity: Vec.create() }]]),
  tick: 100,
  sequence: 7,
  snapshotInputSequence: 6,
}) as ProtocolClient;

surveyPilot.markSurveyHold();
assert(!surveyPilot.miningSurveySettled, 'A pre-hold snapshot is not enough');
surveyPilot.tick++;
assert(
  !surveyPilot.miningSurveySettled,
  'A newer snapshot must also acknowledge the hold input',
);
Object.assign(surveyPilot, { snapshotInputSequence: 7 });
assert(
  surveyPilot.miningSurveySettled,
  'An acknowledged settled ship can propose',
);
surveyPilot.ship.velocity = Vec.create(5, 0);
assert(
  !surveyPilot.miningSurveySettled,
  'A moving ship must continue settling',
);
surveyPilot.ship.velocity = Vec.create();
surveyPilot.ship.spin = 0.04;
assert(
  !surveyPilot.miningSurveySettled,
  'A turning ship must continue settling',
);
surveyPilot.ship.spin = 0;
surveyPilot.markSurveyHold();
assert(
  !surveyPilot.miningSurveySettled,
  'An unchanged neutral input still needs a snapshot after the next hold',
);
surveyPilot.tick++;
assert(surveyPilot.miningSurveySettled);

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

// A selected corridor can unnecessarily block a later ship even when the
// selected ship has another individually clear corridor.
const spreadLane = (index: number, x: number, y: number, heading: number) => ({
  index,
  start: Vec.create(x, y),
  heading,
  length: 1000,
  speed: 38,
});

const flexibleSpread = {
  index: 0,
  position: Vec.create(0, 0),
  radius: 40,
  candidates: [spreadLane(0, 0, 0, 0), spreadLane(0, 0, 0, Math.PI / 2)],
};

const blockedSpread = {
  index: 1,
  position: Vec.create(600, -500),
  radius: 40,
  candidates: [
    spreadLane(1, 600, -500, Math.PI / 2),
    spreadLane(1, 600, -500, Math.PI / 4),
  ],
};

const repairedSpread = reserveSpreadCorridors({
  proposals: [flexibleSpread, blockedSpread],
});

assert.deepEqual(
  repairedSpread.map(({ index, heading }) => ({ index, heading })),
  [
    { index: 0, heading: Math.PI / 2 },
    { index: 1, heading: Math.PI / 2 },
  ],
  'A previously selected ship can use a checked alternative to make room',
);

const cruise = {
  index: 0,
  start: ship.position,
  heading: 0,
  length: 1800,
  speed: spreadCruiseSpeed(30),
};

const remaining = spreadRemainingDistance({
  ship: { ...ship, velocity: Vec.create(0, 60) },
  corridor: cruise,
  seconds: 30,
});

assert(
  !spreadCorridorClear({
    ship,
    corridor: cruise,
    entities: [],
    stations: {},
    remaining,
  }),
  'A ship that overshot its planned speed cannot extend the reserved corridor',
);

const stations = { 'corral-5': { dockingBays: [0], localMovementRadius: 600 } };

for (const [distance, clear] of [
  [660, false],
  [661, true],
] as const) {
  const carried = { ...ship, position: Vec.create(distance, 0) };

  assert.equal(
    spreadCorridorClear({
      ship: carried,
      corridor: { ...cruise, start: carried.position },
      stations,
      entities: [station],
    }),
    clear,
    'Corridor clearance accounts for the station movement frame',
  );
}

const cruising = {
  ...ship,
  rotation: 0.05,
  velocity: Vec.create(cruise.speed + 1, 0),
};

const steering = spreadCruiseControls({ ship: cruising, corridor: cruise });

assert.equal(steering.turn, -1);
assert.equal(steering.thrust, 0);

const surveySearch = {
  origin: Vec.create(0, 0),
  activeSeconds: 0,
  headingOffset: 0,
};

advanceSurvey({
  state: surveySearch,
  position: Vec.create(500, 0),
  seconds: 15,
});

assert.equal(
  surveySearch.headingOffset,
  0,
  'A moving survey keeps its heading',
);

advanceSurvey({
  state: surveySearch,
  position: Vec.create(510, 10),
  seconds: 14,
});

assert.equal(
  surveySearch.headingOffset,
  0,
  'A short pause does not change heading',
);

advanceSurvey({
  state: surveySearch,
  position: Vec.create(510, 10),
  seconds: 1,
});

assert.equal(
  surveySearch.headingOffset,
  Math.PI / 4,
  'A trapped survey changes heading',
);

const rotatedSurvey = surveyTravelRoute({
  ship,
  index: 0,
  players: 32,
  entities: [],
  headingOffset: surveySearch.headingOffset,
});

assert(
  rotatedSurvey.target.y > ship.position.y,
  'The new heading directs the survey away from its old route',
);

const surveyObstacle = {
  ...ship,
  id: 99,
  kind: 'asteroid' as const,
  position: Vec.add(ship.position, Vec.create(300, 0)),
  radius: 100,
};

const surveyRoute = surveyTravelRoute({
  ship,
  index: 0,
  players: 32,
  entities: [surveyObstacle],
});

const thrustNearObstacle = workloadControls({
  workload: 'module',
  index: 0,
  players: 32,
  elapsed: 0,
  ship: {
    ...ship,
    velocity: Vec.create(110, 0),
    rotation: Math.atan2(
      surveyRoute.target.y - ship.position.y,
      surveyRoute.target.x - ship.position.x,
    ),
    spin: 0,
  },
  entities: [surveyObstacle],
  fanout: true,
});

assert(surveyRoute.obstacle, 'The nearby asteroid is in survey lookahead');
assert.equal(
  thrustNearObstacle.thrust,
  1,
  'Aligned survey thrusts along a checked detour',
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

const detourShip = { ...ship, position: Vec.create(-500, 0) };

const detourRock = {
  ...assignedAsteroid,
  id: 32,
  position: Vec.create(),
  radius: 100,
};

const detourTarget = Vec.create(500, 0);

const uncheckedHop = obstacleSafeTarget({
  ship: detourShip,
  target: detourTarget,
  entities: [detourRock],
  asteroidMargin: 20,
});

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

const outsideWorkingArea = obstacleSafeRoute({
  ship: detourShip,
  target: detourTarget,
  entities: [],
  bounds: { position: detourShip.position, radius: 650 },
});

assert(outsideWorkingArea.blocked);
assert.deepEqual(outsideWorkingArea.target, detourShip.position);

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

// In a recorded 32-player preparation, client 18's new proposal displaced
// client 19 after the latter had held this same asteroid for several minutes.
const contestedRock = {
  asteroidId: 1110309064,
  asteroidRadius: 143.01278944,
  anchor: Vec.create(-10749, 783),
};

const earlierOwner = {
  index: 19,
  position: Vec.create(-8923.8424, 111.1078),
  radius: 40,
  wholeRocks: 2,
  candidates: [
    {
      ...contestedRock,
      contact: Vec.create(-10577.2549, 719.7758),
      distance: 1761.888,
    },
  ],
};

const newContender = {
  index: 18,
  position: Vec.create(-10188.4957, 1344.0642),
  radius: 40,
  wholeRocks: 11,
  candidates: [
    {
      ...contestedRock,
      contact: Vec.create(-10619.655, 912.4742),
      distance: 610.056,
    },
  ],
};

const preferredOwner = new Map([[19, contestedRock.asteroidId]]);

const preserved = reserveMiningTargets({
  proposals: [newContender, earlierOwner],
  preferred: preferredOwner,
});

assert.deepEqual(
  preserved.map((target) => target.index),
  [19],
);
assert.deepEqual(preserved[0].position, earlierOwner.position);
assert.deepEqual(preserved[0].contact, earlierOwner.candidates[0].contact);

assert.deepEqual(
  reserveMiningTargets({
    proposals: [newContender, { ...earlierOwner, candidates: [] }],
    preferred: preferredOwner,
  }).map((target) => target.index),
  [18],
  'A preference cannot retain a candidate that is no longer clear',
);

assert.deepEqual(
  reserveMiningTargets({
    proposals: [earlierOwner],
    reserved: [{ ...preserved[0], index: 18 }],
    preferred: preferredOwner,
  }).map((target) => target.index),
  [18],
  'A preference cannot bypass compatibility with an existing reservation',
);

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
  !workloadControls({
    workload: 'module',
    index: 0,
    players: 8,
    elapsed: 0,
    ship: { ...miningShip, position: Vec.create(900, 0), rotation: Math.PI },
    entities: [assignedAsteroid],
    miningAsteroid: assignedAsteroid,
    miningAnchor: Vec.create(),
    drillTip: fittedDrillTip,
  }).hornDrill,
  'A miner outside its working area cannot drill while recovering',
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
  playerNumber: 7,
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
  !ownMiningFracture({ ...ownFracture, playerNumber: 8 }),
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
  entities: [
    station,
    { ...station, kind: 'asteroid', position: Vec.create(0, 10110) },
  ],
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

for (const position of [Vec.create(37, 10110), Vec.create(-176.8, 9018.7)]) {
  const peer = { ...ship, id: 88, position };

  const blockedStage = weaponStagingControls({
    ship: beyondOldTarget,
    index: 1,
    players: 4,
    entities: [peer],
  });

  assert(weaponClearAhead({ ship: beyondOldTarget, entities: [peer] }));
  assert(!blockedStage.ready && !blockedStage.clear);
  assert(
    blockedStage.input.turn || blockedStage.input.thrust,
    'Blocked staging resumes ordinary obstacle-aware navigation instead of parking permanently',
  );
}

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

const actions: string[] = [];
const report = { cleanupErrors: [] as string[] };
let foundPid: (pid: number) => void;

const discovery = new Promise<number>((resolve) => {
  foundPid = resolve;
});

const setup = beginProtocolCoreSetup({
  findPid: () => discovery,
  limit: async (pid) => {
    assert.equal(pid, 123);
    actions.push('limit');

    return {
      restore: async () => {
        actions.push('restore');
      },
    };
  },
});

const cleanup = finishInterruptedProtocolCapture({
  workers: [
    {
      close: async () => {
        actions.push('close');
        throw new Error('owned child did not exit');
      },
    },
  ],
  restore: async () => {
    await (await setup).restore();
  },
  removeDirectory: async () => {
    actions.push('remove');
  },
  save: async () => {
    actions.push('save');
    assert.deepEqual(report.cleanupErrors, [
      'protocol worker 0: owned child did not exit',
    ]);
  },
  report,
});

await Promise.resolve();
assert.deepEqual(actions, ['close']);
foundPid!(123);
await cleanup;
assert.deepEqual(actions, ['close', 'limit', 'restore', 'remove', 'save']);
