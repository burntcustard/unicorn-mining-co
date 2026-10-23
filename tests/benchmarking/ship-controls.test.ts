import assert from 'node:assert/strict';
import test from 'node:test';
import { headingControls } from '../../benchmarking/utilities/ship-controls.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

const ship: ReplicatedEntity = {
  id: 1,
  kind: 'ship',
  position: Vec.create(),
  radius: 40,
  rotation: 0,
  spin: 0,
};

test('ordinary heading controls retain their default deadband and angular braking', () => {
  for (const [rotation, spin, turn, thrust] of [
    [0, 0, 0, 1],
    [0.05, 0, 0, 1],
    [-0.05, 0, 0, 1],
    [0, 1, -1, 1],
    [0, -1, 1, 1],
    [1, 0, -1, 0],
    [-1, 0, 1, 0],
  ]) {
    const input = headingControls({
      ship: { ...ship, rotation, spin },
      angle: 0,
    });

    assert.equal(input.turn, turn);
    assert.equal(input.thrust, thrust);

    assert.deepEqual(
      input,
      headingControls({
        ship: { ...ship, rotation, spin },
        angle: 0,
        spinTolerance: 0.16,
      }),
    );
  }
});

test('a tighter spin tolerance corrects the observed settled heading bias with binary keys', () => {
  for (const direction of [-1, 1]) {
    const biased = { ...ship, rotation: direction * 0.05 };
    const ordinary = headingControls({ ship: biased, angle: 0 });

    const precise = headingControls({
      ship: biased,
      angle: 0,
      spinTolerance: 0.04,
    });

    assert.equal(
      ordinary.turn,
      0,
      'The original default accepts this settled bias',
    );
    assert.equal(
      precise.turn,
      -direction,
      'The tighter threshold steers back toward the corridor',
    );
    assert.equal(precise.thrust, ordinary.thrust);
    assert([-1, 0, 1].includes(precise.turn));
    assert([0, 1].includes(precise.thrust));
    assert.equal(
      headingControls({ ship, angle: 0, spinTolerance: 0.04 }).turn,
      0,
      'An aligned, nonspinning ship remains neutral',
    );
  }
});
