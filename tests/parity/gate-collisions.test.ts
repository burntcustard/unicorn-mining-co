import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';

const cases = [
  [0, 0, 0],
  [1, 1, 0],
  [0.5, 1, 0],
  [0.5, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 0, 0, 0.71],
  [1, 1, 0, 0.71],
  [0.5, 1, 0, 0.71],
  [0.5, 0, 0, 0.71],
  ...[0, 1, 0.35].flatMap((target) =>
    [0, 0.71].flatMap((rotation) =>
      [225, 242, 259.5, -225, -242, -259.5].map((y) => [
        0.35,
        target,
        0,
        rotation,
        y,
      ]),
    ),
  ),
  ...[0, 0.71].map((rotation) => [0.35, 0, 0, rotation, 50, -310]),
];

const hornCaseStart = cases.length;

cases.push(
  ...[0, 0.71, Math.PI].flatMap((rotation) =>
    [0.25, 2, 4, -0.25, -2, -4].flatMap((depth) =>
      [0, 1].map((detached) => [0.35, 0, 0, rotation, 0, 0, depth, detached]),
    ),
  ),
);

const frameCaseStart = cases.length;
// Points and outward normals on each inner face of the two open halves.
const frameFaces = [-1, 1].flatMap((side) =>
  [
    [378, 0, 1, 0],
    [319.5, 144, Math.SQRT1_2, Math.SQRT1_2],
    [225, 202.5, 0, 1],
    [319.5, -144, Math.SQRT1_2, -Math.SQRT1_2],
    [225, -202.5, 0, -1],
  ].map(([x, y, nx, ny]) => [side * x, y, side * nx, ny]),
);

cases.push(
  ...[0, 0.71].flatMap((rotation) =>
    frameFaces.flatMap((_, index) =>
      [-1, 1].map((direction) => [
        1,
        1,
        0,
        rotation,
        0,
        0,
        0,
        0,
        direction * (index + 1),
      ]),
    ),
  ),
);

const bundle = await rolldown({
  input: 'gate-collisions',
  plugins: [
    {
      name: 'gate-collision-parity',
      resolveId: (id) =>
        id === 'gate-collisions' ? '\0gate-collisions' : undefined,
      load: (id) =>
        id === '\0gate-collisions'
          ? `
      import { createWorld, addEntity } from '${process.cwd()}/src/client/simulation/world.ts';
      import { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
      import { JumpGate } from '${process.cwd()}/src/client/objects/jump-gate.ts';
      import { detectCollisions } from '${process.cwd()}/src/client/collision/detect-collisions.ts';
      import { rotatePoint } from '${process.cwd()}/src/client/utilities/geometry.ts';
      import { GameCollisions } from '${process.cwd()}/src/client/collision/game-collisions.ts';
      import { simulationStep as dt } from '${process.cwd()}/src/specs/simulation.ts';
      import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
      export const results = [];
      for (const [opening, openingTarget, transitTime, rotation = 0, jawY = 0, jawX = 0, tipDepth = 0, detached = 0, frameCase = 0] of ${JSON.stringify(cases)}) {
        const world = createWorld({seed:1});
        const gate = new JumpGate({id:100, opening, openingTarget, rotation});
        let ship = createPlayerShip(world, {id:1, position:Vec.create(-600,50), velocity:Vec.create(200,0)});
        if (jawY) {
          Vec.setXY(gate.position, 1234, -5678);
          Vec.add(gate.position, rotatePoint(Vec.create(jawX,jawY), rotation), ship.position);
          Vec.setXY(ship.velocity,0,0);
          ship.rotation = rotation + .4;
        }
        if (tipDepth) {
          Vec.setXY(gate.position, 1234, -5678);
          Vec.add(gate.position, rotatePoint(Vec.create(0,-Math.sign(tipDepth)*(329-Math.abs(tipDepth))), rotation), ship.position);
          Vec.setXY(ship.velocity,0,0);
          ship.rotation = rotation + Math.sign(tipDepth)*Math.PI/2;
        }
        if (frameCase) {
          const [x,y,nx,ny] = ${JSON.stringify(frameFaces)}[Math.abs(frameCase)-1];
          const direction = Math.sign(frameCase);
          const distance = direction > 0 ? -91 : 150;
          Vec.setXY(gate.position,1234,-5678);
          Vec.add(gate.position,rotatePoint(Vec.create(x+nx*distance,y+ny*distance),rotation),ship.position);
          Vec.set(ship.velocity,rotatePoint(Vec.create(nx*direction*200,ny*direction*200),rotation));
          ship.rotation = rotation + Math.atan2(ny*direction,nx*direction);
        }
        addEntity(world, ship);
        addEntity(world, gate);
        if (detached) {
          const source = ship;
          ship.detach(ship.mounts.find(m=>m.module?.grinds));
          ship = [...world.entities.values()].find(e=>e !== source && e !== gate);
          world.entities.delete(source.id);
          Vec.setXY(ship.velocity,0,0);
          ship.spin = 0;
        }
        const collisions = new GameCollisions();
        const frames = [];
        for (let tick = 0; tick < (frameCase ? 45 : jawY || tipDepth ? 600 : 90); tick++) {
          if (transitTime !== 0 && tick === 1) {
            ship.transitTime = transitTime;
            Vec.setXY(ship.position, -260, 50);
            Vec.setXY(ship.velocity, 0, 0);
          }
          if (transitTime !== 0 && tick === 4) ship.transitTime = 0;
          collisions.capturePoses(world.entities);
          Vec.addScaled(ship.position, ship.velocity, dt, ship.position);
          ship.rotation += ship.spin * dt;
          gate.update(dt);
          const contacts = collisions.step({entities:world.entities, dt, events:[]});
          frames.push({position:Vec.clone(ship.position), velocity:Vec.clone(ship.velocity), rotation:ship.rotation, spin:ship.spin, health:ship.hullHealth, contacts:contacts.length, depth:jawY || tipDepth || frameCase ? Math.max(0,...detectCollisions({entities:[ship,gate]}).filter(c => c.collider.physics !== false && c.other.physics !== false).map(c => c.depth)) : 0});
        }
        results.push(frames);
      }
    `
          : undefined,
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const { results } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(output[0].code).toString('base64')
);

const server = JSON.parse(
  execFileSync('go', ['run', './src/server/testtools/gate-collisions'], {
    encoding: 'utf8',
    input: JSON.stringify(cases),
    maxBuffer: 32 * 1024 * 1024,
  }),
);

const compare = (actual: any, expected: any, path = '') => {
  if (typeof expected === 'number') {
    assert(
      Math.abs(actual - expected) < 1e-6,
      `${path}: client ${actual}, server ${expected}`,
    );
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      path,
    );

    for (const key of Object.keys(expected)) {
      compare(actual[key], expected[key], path + '.' + key);
    }
  } else {
    assert.equal(actual, expected, path);
  }
};

compare(results, server);

for (const [name, frames] of [
  ['client', results[4]],
  ['server', server[4]],
  ['client arrival', results[5]],
  ['server arrival', server[5]],
] as const) {
  for (let tick = 1; tick < 4; tick++) {
    assert.equal(
      frames[tick].contacts,
      0,
      `${name}: transit must remove previously cached hull fixtures`,
    );
    assert.deepEqual(frames[tick].position, { x: -260, y: 50 });
    assert.deepEqual(frames[tick].health, frames[0].health);
  }

  assert(
    frames[4].contacts > 0,
    `${name}: hull collisions must resume after transit`,
  );
}

const initialHealth: number[] = results[0][0].health;

for (const [name, runs] of [
  ['client', results],
  ['server', server],
] as const) {
  for (const [index, frames] of runs.entries()) {
    if (index < 10) continue;

    for (const [tick, frame] of frames.entries()) {
      assert(
        frame.depth <= 1.50001,
        `${name} jaw case ${index} tick ${tick}: remaining overlap ${frame.depth}`,
      );
    }

    if (index >= frameCaseStart) {
      assert(
        frames.some((frame: { contacts: number }) => frame.contacts > 0),
        `${name} frame ${index}: the open frame must block ships from either direction`,
      );

      const frameCase = cases[index][8];
      const [x, y, nx, ny] = frameFaces[Math.abs(frameCase) - 1];
      const rotation = cases[index][3];
      const position = frames[20].position;
      const dx = position.x - 1234,
        dy = position.y + 5678;
      const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation);
      const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation);

      assert(
        ((localX - x) * nx + (localY - y) * ny) * Math.sign(frameCase) < 0,
        `${name} frame ${index}: the ship center must stay on its approach side`,
      );
      continue;
    }

    if (index >= hornCaseStart) {
      assert(
        frames.at(-1).depth < 1e-8,
        `${name} horn ${index}: the tip must completely escape the gate`,
      );
      assert.deepEqual(
        frames.at(-1).health,
        frames[0].health,
        `${name} horn ${index}: a tapered tip must slide out intact`,
      );

      for (let tick = 1; tick < frames.length; tick++) {
        const a = frames[tick - 1].position,
          b = frames[tick].position;

        assert(
          Math.hypot(a.x - b.x, a.y - b.y) < 3,
          `${name} horn ${index}: squeezing must not teleport the horn`,
        );
      }

      continue;
    }

    const damage = initialHealth.map(
      (health, i) => health - frames.at(-1).health[i],
    );

    if (cases[index][1] === 0 && !cases[index][5]) {
      assert(
        damage.some((amount) => amount >= 1000),
        `${name} jaw case ${index}: closing jaws must deal crushing damage`,
      );
    } else {
      assert(
        damage.every((amount) => amount === 0),
        `${name} case ${index}: opening, stationary, and exterior contacts must not crush`,
      );
    }
  }
}
