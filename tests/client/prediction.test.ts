import * as Vec from '../../src/client/utilities/vector';
import assert from 'node:assert/strict';
import { createAsteroid } from '../../src/client/objects/asteroid';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import { type InputFrame } from '../../src/client/protocol/input-frame';
import {
  addEntity,
  addPlayer,
  createWorld,
} from '../../src/client/simulation/world';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { Item } from '../../src/client/objects/item';
import {
  diamond as diamondSpec,
  autogunAmmunition,
} from '../../src/specs/items/index';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
} from '../../src/client/simulation/world-state';
import { updateWorld } from '../../src/client/simulation/update-world';
import { PredictionManager } from '../../src/client/prediction/prediction';
import { RemoteMotion } from '../../src/client/prediction/remote-motion';
import { Station } from '../../src/client/objects/station';
import { FramePrediction } from '../../src/client/prediction/frame-prediction';
import { GameObject } from '../../src/client/objects/game-object';
import { CargoHatch } from '../../src/client/objects/modules/cargo-hatch';
import { HornDrill } from '../../src/client/objects/modules/horn-drill';
import { maxPredictionTicks } from '../../src/specs/prediction';
import { simulationStep } from '../../src/specs/simulation';

// Cached display prediction must follow the live horn's animation phase.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const horn = ship.segments.find(
    (segment) => segment.module instanceof HornDrill,
  )!;

  horn.active = 1;
  horn.activationProgress = 1;

  const frames = new FramePrediction();

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), hornDrill: true },
    changes: [],
  };

  let previousPhase = horn.phase;

  for (const elapsed of [
    0,
    simulationStep / 2,
    simulationStep / 2,
    simulationStep,
    0,
  ]) {
    ship.updateVisual(1 / 60);
    assert(
      horn.phase > previousPhase,
      'the active horn advances each display frame',
    );
    previousPhase = horn.phase;
    const predicted = frames.sample({ world, playerId: 1, input, elapsed });
    const drawn = predicted.entities
      .get(ship.id)!
      .segments.find(
        (segment: typeof horn) => segment.module instanceof HornDrill,
      );

    assert.notEqual(drawn, horn, 'rendering still uses isolated mechanics');
    assert.equal(
      drawn.phase,
      horn.phase,
      'the rendered horn uses the current visual phase',
    );
    assert.equal(
      horn.activationProgress,
      1,
      'sampling leaves live activation untouched',
    );
  }
}

// Snapshot refits and rollbacks must not restart the horn's visual rotation.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const horn = ship.segments.find(
    (segment) => segment.module instanceof HornDrill,
  )!;
  const moduleId = horn.module.id;

  horn.activationProgress = 1;
  horn.phase = 0.4;
  ship.updateVisual(1 / 60);
  const phase = horn.phase;
  const checkpoint = captureWorld({ world });
  const server = cloneEntity({ entity: ship }) as typeof ship;

  // A newly collected spare changes the module list and rebuilds fitted parts.
  server.cargoContents.push(new HornDrill({ id: 1000 }));
  prediction.reconcile({ tick: 0, entities: [server] });
  ship.updateVisual(1 / 60);
  const rebuilt = ship.segments.find(
    (segment) => segment.module.id === moduleId,
  )!;

  assert.notEqual(
    rebuilt,
    horn,
    'the snapshot actually rebuilt the horn segment',
  );
  assert(
    Math.abs(rebuilt.phase - phase - 1.5 / 60) < 1e-9,
    'a rebuilt horn continues from the last displayed phase',
  );

  const displayedPhase = rebuilt.phase;

  restoreWorld({ world, state: checkpoint });
  ship.updateVisual(1 / 60);
  assert(
    Math.abs(horn.phase - displayedPhase - 1.5 / 60) < 1e-9,
    'rollback to an older segment continues from the last displayed phase',
  );
}

// Match the original activation-driven speed through wraps, snapshots and release.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const moduleId = ship.modules.find(
    (module) => module instanceof HornDrill,
  )!.id;
  const dt = 1 / 120;
  let phase = 0;
  let wraps = 0;
  let previousSpeed = 0;

  for (const active of [true, false]) {
    ship.setModuleActive({ module: HornDrill, active });

    for (let frame = 0; frame < 360; frame++) {
      if (frame % 8 === 0) {
        const server = cloneEntity({ entity: ship }) as typeof ship;

        server.cargoContents.push(new HornDrill({ id: 1000 + frame }));
        prediction.reconcile({ tick: world.tick, entities: [server] });
      }

      ship.updateModules(dt);
      ship.updateVisual(dt);
      const horn = ship.segments.find(
        (segment) => segment.module.id === moduleId,
      )!;
      const speed = horn.activationProgress * 1.5;
      const expected = (phase + dt * speed) % 1;

      assert(
        Math.abs(horn.phase - expected) < 1e-9,
        'rotation keeps the original activation-based speed without resetting',
      );
      assert(
        active ? speed >= previousSpeed : speed <= previousSpeed,
        'the horn speeds up on activation and slows down on release',
      );

      if (expected < phase) wraps++;
      phase = horn.phase;
      previousSpeed = speed;
      const rendered = prediction
        .predictFrame({ elapsed: simulationStep / 2 })
        .entities.get(ship.id)!
        .segments.find(
          (segment: typeof horn) => segment.module.id === moduleId,
        );

      assert.equal(
        rendered.phase,
        phase,
        'the displayed phase stays continuous',
      );
    }
  }

  assert(wraps > 1, 'the test covers multiple complete rotations');
  assert.equal(previousSpeed, 0, 'the horn finishes slowing down');
  assert(phase > 0, 'the stopped horn retains its final phase');
}

// Restoring an older checkpoint must not release IDs reserved by the server.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));
  const authoritative = cloneEntity({ entity: ship });

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });

  prediction.step({ input: emptyPlayerInput(), send: () => {} });

  authoritative.position.x = 100;

  prediction.reconcile({
    entities: [authoritative],
    nextEntityId: 1000,
    tick: 0,
  });

  assert.equal(
    world.nextEntityId,
    1000,
    'rollback preserves server ID reservations',
  );
  assert.equal(
    prediction.predictFrame({ elapsed: simulationStep }).nextEntityId,
    1000,
    'frame prediction uses the corrected allocator',
  );
}

// All visible bodies receive fractional prediction, even far from the pilot.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });

  const rock = addEntity(
    world,
    createAsteroid(world, {
      id: 2,
      position: Vec.create(700),
      velocity: Vec.create(120),
      radius: 30,
    }),
  );

  const item = addEntity(
    world,
    new Item(diamondSpec, {
      world,
      id: 3,
      position: Vec.create(800),
      velocity: Vec.create(120),
    }),
  );

  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const motion = new RemoteMotion();
  const starts = [rock.position.x, item.position.x];
  let last = -Infinity;

  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const predicted = prediction.predictFrame({
      elapsed: fraction * simulationStep,
    });

    const poses = motion.sample({
      now: fraction * simulationStep * 1000,
      world,
      predicted,
    });

    for (const entity of [rock, item]) {
      assert.deepEqual(
        poses.get(entity.id)!.position,
        predicted.entities.get(entity.id)!.position,
      );
    }

    assert(
      poses.get(rock.id)!.position.x > last,
      'scenery advances on intermediate frames',
    );
    last = poses.get(rock.id)!.position.x;
  }

  assert.deepEqual(
    [rock.position.x, item.position.x],
    starts,
    'rendering cannot advance mechanics',
  );
  world.entities.delete(rock.id);
  assert(
    !motion.sample({ world }).has(rock.id),
    'unloaded scenery has no stale pose',
  );
}

// Rendering predicts the unfinished tick, not the previous tick's pose.
// Sampling more frames must not advance history or change the eventual solve.
for (const fps of [60, 120, 144]) {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  addEntity(world, new GameObject({ id: 100, position: Vec.create(8000) }));
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const input = { ...emptyPlayerInput(), thrust: 1, turn: -1 };
  let messages = 0;

  const send = () => {
    messages++;
  };

  prediction.recordInput({ input, offset: 0.001, send });
  const frame = prediction.predictFrame({ elapsed: 1 / fps });
  const drawn = frame.entities.get(ship.id)!;

  assert(
    Vec.length(drawn.velocity) > 0,
    `${fps} FPS: thrust reacts this frame`,
  );
  assert(drawn.rotation < 0, `${fps} FPS: steering reacts this frame`);
  assert.equal(world.tick, 0, 'frames do not consume a network tick');
  assert.equal(ship.rotation, 0, 'frames do not mutate committed history');
  assert.equal(Vec.length(ship.velocity), 0);
  assert.notEqual(
    frame.entities.get(100),
    world.entities.get(100),
    'remote render copies are isolated from mechanics',
  );
  const position = Vec.add(drawn.position, Vec.create());
  const rotation = drawn.rotation;
  const repeated = prediction
    .predictFrame({ elapsed: 1 / fps })
    .entities.get(ship.id)!;

  assert(Vec.distance(position, repeated.position) < 1e-9);
  assert.equal(
    repeated.rotation,
    rotation,
    'resampling does not accumulate drift',
  );

  prediction.recordInput({ input: emptyPlayerInput(), offset: 0.018, send });
  const released = prediction
    .predictFrame({ elapsed: 0.024 })
    .entities.get(ship.id)!;

  assert.equal(released.turn, 0, 'release is applied before the network tick');
  assert.equal(released.thrust, 0);
  const endpoint = prediction
    .predictFrame({ elapsed: simulationStep })
    .entities.get(ship.id)!;
  const endPosition = Vec.add(endpoint.position, Vec.create());
  const endRotation = endpoint.rotation;
  const stalled = prediction
    .predictFrame({ elapsed: 2 })
    .entities.get(ship.id)!;

  assert(
    Vec.distance(stalled.position, endPosition) < 1e-9,
    'a stalled connection cannot predict beyond one unfinished tick',
  );
  prediction.step({ input: emptyPlayerInput(), send });
  assert(Vec.distance(ship.position, endPosition) < 1e-9);
  assert.equal(
    ship.rotation,
    endRotation,
    'frame endpoint equals committed physics',
  );
  assert.equal(messages, 2, 'rendering does not send more network messages');
  const corrected = cloneEntity({ entity: ship });

  corrected.position.x += 100;
  prediction.reconcile({ tick: world.tick, entities: [corrected] });
  assert.equal(
    prediction.predictFrame({ elapsed: 0 }).entities.get(ship.id)!.position.x,
    corrected.position.x,
    'a correction invalidates the cached frame even at the same tick',
  );
}

// A contact projection must not jump to its full separation on the first
// tiny display fraction. The full endpoint still equals committed physics.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });

  addEntity(
    world,
    new GameObject({
      id: 100,
      radius: 40,
      mass: 1e9,
      position: Vec.create(10),
    }),
  );

  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const endpoint = Vec.clone(
    prediction.predictFrame({ elapsed: simulationStep }).entities.get(ship.id)!
      .position,
  );

  assert(
    Vec.distance(endpoint, ship.position) > 1,
    'fixture exercises a contact projection',
  );
  const first = prediction
    .predictFrame({ elapsed: 0.000001 })
    .entities.get(ship.id)!;

  assert(
    Vec.distance(first.position, ship.position) < 0.01,
    'contact presentation is continuous at the tick boundary',
  );

  prediction.step({ input: emptyPlayerInput(), send() {} });

  assert(
    Vec.distance(ship.position, endpoint) < 1e-9,
    'drawing a contact does not change its eventual solve',
  );
}

// Two immediate transitions in one tick must retain the duration of a short tap.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });

  const sent: { offset: number; input: ReturnType<typeof emptyPlayerInput> }[] =
    [];

  const send = (message: (typeof sent)[number]) => {
    sent.push(message);
  };

  prediction.recordInput({
    input: { ...emptyPlayerInput(), thrust: 1 },
    offset: 0.005,
    send,
  });

  prediction.recordInput({ input: emptyPlayerInput(), offset: 0.015, send });
  assert.equal(
    sent.length,
    2,
    'both transitions are sent before simulation runs',
  );
  prediction.step({ input: emptyPlayerInput(), send });
  assert(
    Vec.length(ship.velocity) > 0,
    'a released short tap still produces movement',
  );
  assert.equal(ship.thrust, 0);
  const expected = createWorld();
  const authoritative = addEntity(
    expected,
    createPlayerShip(expected, { playerId: 1 }),
  );

  addPlayer(expected, { id: 1, shipId: authoritative.id });

  updateWorld({
    world: expected,
    inputs: new Map([[1, { input: emptyPlayerInput(), changes: sent }]]),
  });

  assert(Vec.distance(ship.position, authoritative.position) < 1e-9);
  assert(Vec.distance(ship.velocity, authoritative.velocity) < 1e-9);
}

// A server hatch correction must apply even when the ship's motion matches.
// Rapid toggles can leave the command and animation at different stages.
for (const { active, progress } of [
  { active: 0, progress: 0 },
  { active: 1, progress: 0.15 },
]) {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  const open = { ...emptyPlayerInput(), cargoHatch: true };

  for (let tick = 0; tick < 8; tick++) {
    prediction.step({ input: open, send() {} });
  }

  const authoritative = cloneEntity({ entity: ship }) as typeof ship;

  authoritative.segments
    .filter((segment) => segment.module instanceof CargoHatch)
    .forEach((segment) => {
      segment.active = active;
      segment.activationProgress = progress;
    });

  prediction.step({ input: emptyPlayerInput(), send() {} });

  prediction.reconcile({ tick: 8, entities: [authoritative] });

  const hatches = ship.segments.filter(
    (segment) => segment.module instanceof CargoHatch,
  );
  const expected = Math.max(0, progress - simulationStep / 0.7);

  assert(hatches.length > 0);

  hatches.forEach((segment) => {
    assert.equal(segment.active, 0);
    assert(
      Math.abs(segment.activationProgress - expected) < 1e-8,
      'hatch animation resumes from the server state after reconciliation',
    );
  });
}

// Cargo and ammunition corrections apply even when ship motion matches.
for (const correction of ['cargo', 'rounds'] as const) {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  ship.cargoContents.push(new Item(autogunAmmunition, { world, id: 999 }));
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });

  prediction.step({ input: emptyPlayerInput(), send() {} });

  prediction.step({ input: emptyPlayerInput(), send() {} });

  const authoritative = cloneEntity({ entity: ship }) as typeof ship;

  if (correction === 'cargo') {
    authoritative.cargoContents.push(
      new Item(diamondSpec, { world, id: 1000 }),
    );
  } else authoritative.cargoContents[0].rounds = 37;

  prediction.step({ input: emptyPlayerInput(), send() {} });

  prediction.reconcile({ tick: 2, entities: [authoritative] });

  assert.deepEqual(
    ship.cargoContents.map(({ id }) => id),
    authoritative.cargoContents.map(({ id }) => id),
    `${correction} from the server reaches the predicted ship`,
  );
  assert.equal(
    ship.cargoContents[0].rounds,
    authoritative.cargoContents[0].rounds,
  );
}

// A clock reset must not leave a future input waiting to reactivate thrust.
{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  world.tick = 10;

  prediction.step({ input: { ...emptyPlayerInput(), thrust: 1 }, send() {} });

  world.tick = 0;
  prediction.reset();

  for (let tick = 0; tick < 12; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });
  }

  assert.equal(
    ship.thrust,
    0,
    'old future input must not come back after clock recovery',
  );
}

{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const drifting = addEntity(
    world,
    new GameObject({ id: 99, position: Vec.create(500), spin: 1 }),
  );
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });
  world.tick = 6;

  prediction.reconcile({
    tick: 6,
    entities: [
      cloneEntity({ entity: ship }),
      cloneEntity({ entity: drifting }),
    ],
    entityTicks: new Map([
      [ship.id, 6],
      [drifting.id, 2],
    ]),
  });

  assert(
    Math.abs(drifting.rotation - 4 / 30) < 1e-4,
    'batched slow-tier state retains its own original tick',
  );
  const checkpoint = [...world.entities.values()].map((entity) =>
    cloneEntity({ entity }),
  );

  for (let tick = 0; tick <= maxPredictionTicks; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });
  }

  prediction.reconcile({ tick: 6, entities: checkpoint });
  assert.equal(
    world.tick,
    6,
    'drift beyond the retained horizon rebases instead of replaying unbounded ticks',
  );
}

// A remote correction can cause contact even while the pilot's checkpoint
// still matches. Replay the pair together, as the authoritative solver does.
for (const localId of [1, 2]) {
  const world = createWorld();

  addEntity(
    world,
    createPlayerShip(world, {
      id: 1,
      playerId: 1,
      position: Vec.create(-85),
      velocity: Vec.create(300),
    }),
  );

  addEntity(
    world,
    createPlayerShip(world, {
      id: 2,
      playerId: 2,
      position: Vec.create(),
      rotation: Math.PI,
    }),
  );

  addPlayer(world, { id: localId, shipId: localId });
  const checkpoint = [...world.entities.values()].map((entity) =>
    cloneEntity({ entity }),
  );
  const remote = checkpoint.find((entity) => entity.id !== localId)!;

  remote.position.x += localId === 1 ? -20 : 20;
  const expected = createWorld();

  checkpoint.forEach((entity) => addEntity(expected, cloneEntity({ entity })));
  addPlayer(expected, { id: localId, shipId: localId });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: localId });

  for (let tick = 0; tick < 2; tick++) {
    prediction.step({ input: emptyPlayerInput(), send() {} });

    updateWorld({ world: expected, inputs: new Map() });
  }

  prediction.reconcile({ entities: checkpoint, tick: 0 });

  for (const id of [1, 2]) {
    const actual = world.entities.get(id)!;
    const correct = expected.entities.get(id)!;

    assert(
      Vec.distance(actual.position, correct.position) < 1e-8,
      `player ${localId}: ship ${id} must replay the collision, not coast through it`,
    );
    assert(Vec.distance(actual.velocity, correct.velocity) < 1e-8);
  }

  // Both pilots must see the same geometry that their own solver just used.
  const motion = new RemoteMotion();
  const local = world.entities.get(localId)!;
  const other = world.entities.get(localId === 1 ? 2 : 1)!;

  local.position.x += 8;
  other.position.x += 8;
  const pose = motion.sample({ now: 0, world, shipId: localId }).get(other.id)!;

  assert(
    Vec.distance(pose.position, other.position) < 1e-8,
    'contact presentation uses the collision position for both pilots',
  );
  const physicsPositions = [local.position.x, other.position.x];

  for (const elapsed of [1 / 144, 1 / 120, 1 / 60, simulationStep]) {
    const predicted = prediction.predictFrame({ elapsed });
    const poses = motion.sample({ now: 0, world, predicted, shipId: localId });

    for (const entity of [local, other]) {
      assert(
        Vec.distance(
          poses.get(entity.id)!.position,
          predicted.entities.get(entity.id)!.position,
        ) < 1e-8,
        'local and contacting remote ships use the same frame collision solve',
      );
    }
  }

  assert.deepEqual(
    [local.position.x, other.position.x],
    physicsPositions,
    'sampling presentation must not move physics bodies',
  );
  const endpoint = prediction.predictFrame({ elapsed: simulationStep });
  const framePositions = new Map(
    [...endpoint.entities].map(([id, entity]) => [
      id,
      Vec.add(entity.position, Vec.create()),
    ]),
  );

  prediction.step({ input: emptyPlayerInput(), send() {} });

  for (const id of [1, 2]) {
    assert(
      Vec.distance(world.entities.get(id)!.position, framePositions.get(id)!) <
        1e-8,
      'fractional contact prediction ends at the same solved tick',
    );
  }

  const beforeDock = local.position.x;

  local.dockedTo = 123;
  local.position.x += 500;
  assert.equal(
    motion.sample({ world, shipId: localId }).get(localId)!.position.x,
    beforeDock + 500,
    'docking resets presentation instead of interpolating through the station',
  );
}

console.log(
  'Both collision perspectives replay shared physics and render matching contact poses',
);

console.log(
  'Prediction checkpoints, fractional frames, rollback and recovery passed',
);

// An opposite-bay launch snaps the displayed angle at the timed input edge.
{
  const world = createWorld();
  const station = addEntity(
    world,
    new Station({ world, stationType: 'corral-6' }),
  );

  station.dockingBays = [Math.PI];
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  ship.dockedTo = station.id;
  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new FramePrediction();

  const input = {
    input: emptyPlayerInput(),
    changes: [
      {
        offset: simulationStep / 2,
        input: { ...emptyPlayerInput(), launch: true },
      },
    ],
  };

  const before = prediction
    .sample({ world, playerId: 1, input, elapsed: simulationStep / 4 })
    .entities.get(ship.id)!;

  assert(Math.abs(before.rotation) < 1e-6);
  const after = prediction
    .sample({ world, playerId: 1, input, elapsed: simulationStep * 0.75 })
    .entities.get(ship.id)!;

  assert(
    Math.cos(after.rotation) < -0.999,
    'the displayed ship instantly faces the opposite bay',
  );
  assert(Math.abs(after.spin) < 0.1);
}

// Escape is recorded before a fixed tick. An older docked snapshot must not
// bring back the menu while frame prediction is already launching.
{
  const world = createWorld();
  const station = addEntity(
    world,
    new Station({ world, stationType: 'corral-6' }),
  );
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  ship.dockedTo = station.id;
  addPlayer(world, { id: 1, shipId: ship.id });
  const prediction = new PredictionManager({ world });

  prediction.setLocalPlayer({ playerId: 1 });

  const send = () => {};

  prediction.step({ input: emptyPlayerInput(), send });
  const authoritative = cloneEntity({ entity: ship });

  assert(
    prediction
      .predictFrame({ elapsed: simulationStep / 4 })
      .entities.get(ship.id)!.dockedTo,
  );
  const launch = { ...emptyPlayerInput(), launch: true };

  prediction.recordInput({ input: launch, offset: simulationStep / 4, send });
  assert(
    !prediction
      .predictFrame({ elapsed: simulationStep / 2 })
      .entities.get(ship.id)!.dockedTo,
  );

  prediction.reconcile({
    entities: [authoritative],
    entityIds: [...world.entities.keys()],
    tick: world.tick,
  });

  assert(
    !prediction
      .predictFrame({ elapsed: simulationStep * 0.75 })
      .entities.get(ship.id)!.dockedTo,
    'pending launch survives an older docked snapshot',
  );
  prediction.step({ input: launch, send });
  assert(
    !world.entities.get(ship.id)!.dockedTo,
    'the fixed tick adopts the same predicted launch',
  );
}
