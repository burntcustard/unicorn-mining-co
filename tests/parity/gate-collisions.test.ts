import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { detectCollisions } from '../../src/client/collision/detect-collisions';
import { GameCollisions } from '../../src/client/collision/game-collisions';
import { Craft } from '../../src/client/objects/craft';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { JumpGate } from '../../src/client/objects/jump-gate';
import { addEntity, createWorld } from '../../src/client/simulation/world';
import { rotatePoint } from '../../src/client/utilities/geometry';
import * as Vec from '../../src/client/utilities/vector';
import { linearSlop } from '../../src/specs/physics';
import { simulationStep as dt } from '../../src/specs/simulation';

const jawCases = [
  [0.35, 1, 0, 0.71, 242],
  [0.35, 0, 0, 0.71, 242],
  [0.35, 0, 0, 0.71, 50, -310],
];
const hornCases = [
  [0.35, 0, 0, Math.PI, 0, 0, -4, 0],
  [0.35, 0, 0, 0.71, 0, 0, 2, 1],
];
const frameFaces = new Map([
  [1, [-378, 0, -1, 0]],
  [7, [319.5, 144, Math.SQRT1_2, Math.SQRT1_2]],
]);
const frameCases = [-1, 7].map((face) => [1, 1, 0, 0.71, 0, 0, 0, 0, face]);
const cases = [[0, 0, -1], ...jawCases, ...hornCases, ...frameCases];
const gatePosition = Vec.create(1234, -5678);

function simulate([
  opening,
  openingTarget,
  transitTime,
  rotation = 0,
  jawY = 0,
  jawX = 0,
  tipDepth = 0,
  detached = 0,
  frameCase = 0,
]: number[]) {
  const world = createWorld({ seed: 1 });
  const gate = new JumpGate({ id: 100, opening, openingTarget, rotation });

  const ship = createPlayerShip(world, {
    id: 1,
    position: Vec.create(-600, 50),
    velocity: Vec.create(200, 0),
  });

  if (jawY || tipDepth || frameCase) Vec.set(gate.position, gatePosition);

  if (jawY) {
    Vec.add(
      gate.position,
      rotatePoint(Vec.create(jawX, jawY), rotation),
      ship.position,
    );
    Vec.setXY(ship.velocity, 0, 0);
    ship.rotation = rotation + 0.4;
  }

  if (tipDepth) {
    const side = Math.sign(tipDepth);
    const tip = Vec.create(0, -side * (329 - Math.abs(tipDepth)));

    Vec.add(gate.position, rotatePoint(tip, rotation), ship.position);
    Vec.setXY(ship.velocity, 0, 0);
    ship.rotation = rotation + (side * Math.PI) / 2;
  }

  if (frameCase) {
    const [x, y, nx, ny] = frameFaces.get(Math.abs(frameCase))!;
    const direction = Math.sign(frameCase);
    const distance = direction > 0 ? -91 : 150;
    const position = Vec.create(x + nx * distance, y + ny * distance);
    const velocity = Vec.create(nx * direction * 200, ny * direction * 200);

    Vec.add(gate.position, rotatePoint(position, rotation), ship.position);
    Vec.set(ship.velocity, rotatePoint(velocity, rotation));
    ship.rotation = rotation + Math.atan2(ny * direction, nx * direction);
  }

  addEntity(world, ship);
  addEntity(world, gate);
  let body: Craft = ship;

  if (detached) {
    const mount = ship.mounts.find(
      (candidate) => candidate.module && candidate.module.grinds,
    );

    assert(mount, 'test ship has a grinding module');
    ship.detach(mount);
    const wreckage = [...world.entities.values()].find(
      (entity) => entity instanceof Craft && entity !== ship,
    );

    assert(wreckage instanceof Craft, 'detachment creates collidable wreckage');
    world.entities.delete(ship.id);
    body = wreckage;
    Vec.setXY(body.velocity, 0, 0);
    body.spin = 0;
  }

  const collisions = new GameCollisions();
  const frames = [];
  const ticks = frameCase ? 45 : jawY || tipDepth ? 180 : 6;

  for (let tick = 0; tick < ticks; tick++) {
    if (transitTime && tick === 1) {
      ship.transitTime = transitTime;
      Vec.setXY(ship.position, -260, 50);
      Vec.setXY(ship.velocity, 0, 0);
    }

    if (transitTime && tick === 4) ship.transitTime = 0;
    collisions.capturePoses(world.entities);
    Vec.addScaled(body.position, body.velocity, dt, body.position);
    body.rotation += body.spin * dt;
    gate.update(dt);

    const contacts = collisions.step({
      entities: world.entities,
      dt,
      events: [],
    });

    const depth =
      jawY || tipDepth || frameCase
        ? Math.max(
            0,
            ...detectCollisions({ entities: [body, gate] })
              .filter(
                ({ collider, other }) =>
                  collider.physics !== false && other.physics !== false,
              )
              .map((contact) => contact.depth),
          )
        : 0;

    frames.push({
      position: Vec.clone(body.position),
      velocity: Vec.clone(body.velocity),
      rotation: body.rotation,
      spin: body.spin,
      health: body.hullHealth,
      contacts: contacts.length,
      opening: gate.opening,
      depth,
    });
  }

  return frames;
}

const client = cases.map(simulate);

const server: typeof client = JSON.parse(
  execFileSync('src/server/target/debug/examples/gate_collisions_fixture', [], {
    encoding: 'utf8',
    input: JSON.stringify(cases),
    maxBuffer: 8 * 1024 * 1024,
  }),
);

function compare(actual: unknown, expected: unknown, path: string) {
  if (typeof expected === 'number') {
    assert(
      typeof actual === 'number' && Math.abs(actual - expected) < 1e-6,
      `${path}: client ${actual}, server ${expected}`,
    );
  } else if (expected && typeof expected === 'object') {
    assert(actual && typeof actual === 'object', path);
    const fields = expected as Record<string, unknown>;
    const values = actual as Record<string, unknown>;

    assert.deepEqual(
      Object.keys(values).sort(),
      Object.keys(fields).sort(),
      path,
    );

    for (const key of Object.keys(fields)) {
      compare(values[key], fields[key], `${path}.${key}`);
    }
  } else {
    assert.equal(actual, expected, path);
  }
}

for (const [index, frames] of client.entries()) {
  compare(frames, server[index], `gate case ${index}`);
  const [, target, transitTime, , jawY, jawX, tipDepth, , frameCase] =
    cases[index];
  const first = frames[0];
  const last = frames.at(-1)!;

  if (transitTime) {
    for (const frame of frames.slice(1, 4)) {
      assert.equal(frame.contacts, 0, 'transit clears cached hull fixtures');
      assert.deepEqual(frame.position, { x: -260, y: 50 });
      assert.deepEqual(frame.health, first.health);
    }

    assert(frames[4].contacts > 0, 'hull collisions resume after transit');
    continue;
  }

  assert(
    frames.every(({ depth }) => depth <= 3 * linearSlop + 1e-5),
    `remaining overlap in case ${index}`,
  );

  if (frameCase) {
    assert(
      frames.some(({ contacts }) => contacts > 0),
      'the open frame blocks ships',
    );
  } else if (tipDepth) {
    assert(last.depth < 1e-8, 'the tapered tip slides out of the gate');
    assert.deepEqual(
      last.health,
      first.health,
      'the tapered tip escapes intact',
    );
  } else if (jawY) {
    assert.equal(last.opening, target, 'the gate completes its movement');
    assert.equal(
      last.health.some((health, hull) => health < first.health[hull]),
      target === 0 && !jawX,
      'only the closing jaw traps and damages the hull',
    );
  }
}
