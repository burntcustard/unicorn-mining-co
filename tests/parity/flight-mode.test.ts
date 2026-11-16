/* global process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { controlShip } from '../../src/client/objects/control-ship';
import { FlightMode } from '../../src/client/objects/modules';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import { createWorld } from '../../src/client/simulation/world';
import * as Vec from '../../src/client/utilities/vector';

const fixture = JSON.parse(
  execFileSync('go', ['run', './src/server/testtools/flight-mode'], {
    encoding: 'utf8',
    env: { ...process.env, GOEXPERIMENT: 'simd' },
  }),
);

const near = (actual: number, expected: number, label: string) =>
  assert(
    Math.abs(actual - expected) < 1e-6,
    `${label}: ${actual} != ${expected}`,
  );

const position = (actual: Vec.Value, expected: Vec.Value, label: string) => {
  near(actual.x, expected.x, `${label}.x`);
  near(actual.y, expected.y, `${label}.y`);
};

const world = createWorld({ seed: 1 });

const ship = createPlayerShip(world, {
  shipType: 'crescent',
  position: Vec.create(18, -29),
  rotation: 0.37,
});

fixture.steps.forEach((step: any, at: number) => {
  const label = `stage ${at}`;

  for (let frame = 0; frame < step.frames; frame++) {
    controlShip(
      ship,
      {
        ...emptyPlayerInput(),
        flightMode: step.active,
        thrust: step.thrust,
        turn: step.turn,
      },
      [],
    );

    ship.update(fixture.dt);
    world.tick++;
  }

  position(ship.position, step.position, `${label} position`);
  position(ship.velocity, step.velocity, `${label} velocity`);
  near(ship.rotation, step.rotation, `${label} rotation`);
  near(ship.spin, step.spin, `${label} spin`);
  near(ship.fuel, step.fuel, `${label} fuel`);
  near(ship.forwardThrust, step.forwardThrust, `${label} forward thrust`);
  near(ship.rotationalThrust, step.rotationalThrust, `${label} turn thrust`);
  near(ship.maxSpeed, step.maxSpeed, `${label} max speed`);
  near(
    ship.segments.find((segment) => segment.module instanceof FlightMode)!
      .activationProgress,
    step.progress,
    `${label} deployment`,
  );

  const hulls = ship.segments.filter((segment) => segment.hull);

  assert.equal(hulls.length, step.hulls.length);

  hulls.forEach((segment, index) => {
    assert.equal(
      ship.hullSegments.indexOf(segment.module),
      step.hulls[index].index,
    );
    position(
      segment.localPosition,
      step.hulls[index].position,
      `${label} hull ${index}`,
    );
  });

  assert.equal(ship.mounts.length, step.mounts.length);
  ship.mounts.forEach((mount, index) =>
    position(
      mount.localPosition,
      step.mounts[index].position,
      `${label} mount ${index}`,
    ),
  );

  const parts = ship.segments.filter(
    (segment) => !segment.hull && segment.mount,
  );

  assert.equal(parts.length, step.moduleParts.length);

  parts.forEach((segment, index) => {
    assert.equal(
      ship.mounts.indexOf(segment.mount!),
      step.moduleParts[index].mount,
    );
    position(
      segment.localPosition,
      step.moduleParts[index].position,
      `${label} module ${index}`,
    );
  });

  const colliders = ship.hitbox(true);

  assert.equal(
    colliders.length,
    step.colliders.length,
    `${label} collider count`,
  );

  colliders.forEach((collider, index) => {
    const expected = step.colliders[index];

    assert.equal(
      ship.hullSegments.indexOf(collider.segment!.module),
      expected.hullIndex,
    );
    position(
      collider.position,
      expected.position,
      `${label} collider ${index}`,
    );
    position(
      collider.localPosition!,
      expected.localPosition,
      `${label} local collider ${index}`,
    );
    near(collider.radius, expected.radius, `${label} radius ${index}`);
    assert.equal(collider.shapeOutline!.length, expected.points.length);
    collider.shapeOutline!.forEach((point, vertex) =>
      point.forEach((value, axis) =>
        near(
          value,
          expected.points[vertex][axis],
          `${label} collider ${index} vertex ${vertex}:${axis}`,
        ),
      ),
    );
  });
});
