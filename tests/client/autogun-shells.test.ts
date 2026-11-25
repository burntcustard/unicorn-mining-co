import assert from 'node:assert/strict';
import {
  clearAutogunShells,
  ejectAutogunShell,
  renderAutogunShells,
} from '../../src/client/effects/autogun-shells';
import { createShip } from '../../src/client/objects/create-ship';
import { GameObject } from '../../src/client/objects/game-object';
import { Autogun } from '../../src/client/objects/modules/weapon';
import { createWorld } from '../../src/client/simulation/world';
import { type Pose } from '../../src/client/types';
import * as Vec from '../../src/client/utilities/vector';

Object.assign(globalThis, {
  Path2D: class {
    closePath() {}
    lineTo() {}
    moveTo() {}
    rect() {}
  },
});

const view = { position: Vec.create(-500, -500), width: 1000, height: 1000 };

const frame = (
  dt: number,
  objects: GameObject[] = [],
  poses?: Map<number, Pose>,
) => {
  const positions: Vec.Value[] = [];
  let position: Vec.Value;

  const ctx = {
    globalAlpha: 1,
    fill() {
      positions.push(position);
    },
    restore() {},
    rotate() {},
    save() {},
    translate(x: number, y: number) {
      position = Vec.create(x, y);
    },
  } as unknown as CanvasRenderingContext2D;

  renderAutogunShells({ ctx, dt, objects, poses, view });

  return positions;
};

const random = Math.random;

Math.random = () => 0.75;

try {
  const world = createWorld();
  const craft = createShip(world);
  const mounts = craft.mounts.filter(({ fits }) => fits.includes(Autogun));

  assert.equal(mounts.length, 2);

  for (const mount of mounts) {
    const weapon = new Autogun();

    craft.fit(weapon, mount);
    weapon.presentShot({ craft, deadline: 1 });
    weapon.presentShot({ craft, deadline: 1 });
  }

  const pose = { position: Vec.create(100, 200), rotation: Math.PI / 2 };
  const poses = new Map([[craft.id, pose]]);
  const spawned = frame(0, [], poses).sort((a, b) => a.x - b.x);
  const moved = frame(16, [], poses).sort((a, b) => a.x - b.x);

  assert.equal(spawned.length, 2, 'each gun ejects one shell per shot');
  assert(spawned[0].x < pose.position.x && spawned[1].x > pose.position.x);
  assert(moved[0].x < spawned[0].x && moved[1].x > spawned[1].x);
  assert.equal(world.entities.size, 0, 'shells stay out of simulation state');

  const eject = () => {
    clearAutogunShells();
    ejectAutogunShell({ craft, position: Vec.create(), rotation: 0, side: 1 });

    return frame(0)[0];
  };

  const start = eject();
  const direction = Vec.normalize(Vec.subtract(frame(16)[0], start));

  const obstacle = new GameObject({
    position: Vec.addScaled(start, direction, 15),
    radius: 5,
    health: 10,
  });

  const position = Vec.clone(obstacle.position);
  let previous = eject();
  let reflected = false;

  for (let i = 0; i < 16; i++) {
    const [next] = frame(16, [obstacle]);

    reflected ||= Vec.dot(Vec.subtract(next, previous), direction) < 0;
    previous = next;
  }

  assert(reflected, 'a physical collider deflects the shell');
  assert.deepEqual(obstacle.position, position);
  assert.deepEqual(obstacle.velocity, Vec.create());
  assert.equal(obstacle.spin, 0);
  assert.equal(obstacle.health, 10);

  eject();

  for (let i = 0; i < 31; i++) assert.equal(frame(16).length, 1);

  for (let i = 0; i < 31; i++) frame(16);

  assert.equal(frame(16).length, 0, 'a shell expires within one second');
} finally {
  clearAutogunShells();
  Math.random = random;
}
