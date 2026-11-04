/* global process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { createWorld } from '../../src/client/simulation/world';
import type { ShipId } from '../../src/specs/ships';
import * as Vec from '../../src/client/utilities/vector';
import { sampleOutline } from '../../src/client/utilities/curves';

const fixtures = JSON.parse(
  execFileSync('go', ['run', './src/server/testtools/npc-ships'], {
    encoding: 'utf8',
    env: { ...process.env, GOEXPERIMENT: 'simd' },
  }),
);

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

for (const fixture of fixtures) {
  const world = createWorld();

  const ship = createPlayerShip(world, {
    shipType: fixture.shipType as ShipId,
    position: Vec.create(18, -29),
    rotation: fixture.rotation,
  });

  world.tick = fixture.tick;
  const colliders = ship.hitbox();

  assert.equal(
    colliders.length,
    fixture.colliders.length,
    `${fixture.shipType} collision part count`,
  );

  colliders.forEach((collider, index) => {
    const expected = fixture.colliders[index];

    assert.equal(
      ship.hullSegments.indexOf(collider.segment!.module),
      expected.hullIndex,
    );
    near(collider.radius, expected.radius);
    near(collider.position.x, expected.position.x);
    near(collider.position.y, expected.position.y);
    near(collider.localPosition!.x, expected.localPosition.x);
    near(collider.localPosition!.y, expected.localPosition.y);
    assert.equal(collider.shapeOutline!.length, expected.points.length);
    collider.shapeOutline!.forEach((point, at) =>
      point.forEach((value, axis) => near(value, expected.points[at][axis])),
    );
  });

  for (const [index, expected] of Object.entries(fixture.visual) as [
    string,
    number[][],
  ][]) {
    const segment = ship.segments.find(
      (segment) => segment.module === ship.hullSegments[Number(index)],
    )!;
    const outline = sampleOutline(segment.curvePoints);

    assert.equal(outline.length, expected.length);
    outline.forEach((point, at) =>
      point.forEach((value, axis) => near(value, expected[at][axis])),
    );
  }
}
