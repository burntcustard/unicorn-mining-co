import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';

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
      import { GameCollisions } from '${process.cwd()}/src/client/collision/game-collisions.ts';
      import { simulationStep as dt } from '${process.cwd()}/src/specs/simulation.ts';
      import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
      export const results = [];
      for (const [opening, openingTarget, transitTime, rotation = 0] of [[0,0,0], [1,1,0], [.5,1,0], [.5,0,0], [0,0,-1], [0,0,1], [0,0,0,.71], [1,1,0,.71], [.5,1,0,.71], [.5,0,0,.71]]) {
        const world = createWorld({seed:1});
        const gate = new JumpGate({id:100, opening, openingTarget, rotation});
        const ship = createPlayerShip(world, {id:1, position:Vec.create(-600,50), velocity:Vec.create(200,0)});
        addEntity(world, ship);
        addEntity(world, gate);
        const collisions = new GameCollisions();
        const frames = [];
        for (let tick = 0; tick < 90; tick++) {
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
          frames.push({position:Vec.clone(ship.position), velocity:Vec.clone(ship.velocity), rotation:ship.rotation, spin:ship.spin, health:ship.hullHealth, contacts:contacts.length});
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
