import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { pirateControls } from '../../benchmarking/rendering/pirate-controls.ts';
import {
  packPlayerInput,
  sameInput,
  unpackPlayerInput,
} from '../../src/client/protocol/input.ts';
import * as Vec from '../../src/client/utilities/vector.ts';

const ship = {
  id: 1,
  position: Vec.create(),
  velocity: Vec.create(),
  rotation: 0,
  spin: 0,
  radius: 40,
};

const target = { ...ship, id: 2, position: Vec.create(500, 0) };
const direct = pirateControls({ ship, target, asteroids: [] });

assert.equal(direct.thrust, 1);
assert.equal(direct.turn, 0);
assert(
  direct.fire,
  'An aligned reachable opponent is aimed at, rather than blind constant fire',
);

for (const position of [
  Vec.create(500, 0),
  Vec.create(-500, 0),
  Vec.create(0, 500),
  Vec.create(0, -500),
]) {
  for (const asteroids of [
    [],
    [{ position: Vec.create(150, 0), radius: 70 }],
  ]) {
    const input = pirateControls({
      ship,
      target: { ...target, position },
      asteroids,
    });

    assert(
      sameInput(input, unpackPlayerInput(packPlayerInput(input))),
      'Predicted steering exactly matches the discrete input sent to Go',
    );
  }
}

const blocked = pirateControls({
  ship,
  target,
  asteroids: [{ position: Vec.create(150, 0), radius: 70 }],
});

assert.notEqual(blocked.turn, 0, 'Steer around a real intervening asteroid');
assert.equal(blocked.thrust, 0, 'Turn before thrusting into a blocking rock');

assert(
  !pirateControls({
    ship,
    target: { ...target, position: Vec.create(0, 500) },
    asteroids: [],
  }).fire,
);

// Execute the controller through the actual production transforms. A helper
// outside src must be included in the fixture, otherwise its vector/property
// names disagree with the transformed game even though direct TS tests pass.
const root = process.cwd();
const entry = resolve('src/__rendering_controls_test.ts');
const source = (
  await readFile('benchmarking/rendering/pirate-controls.ts', 'utf8')
).replaceAll('../../src/', `${root}/src/`);

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'rendering-controls-test',
      resolveId: (id) => (id === entry ? id : undefined),
      load: (id) =>
        id === entry
          ? `${source}
const ship={id:1,position:Vec.create(),velocity:Vec.create(),rotation:0,spin:0,radius:40};
const target={...ship,id:2,position:Vec.create(500,0)};
const direct=pirateControls({ship,target,asteroids:[]});
const blocked=pirateControls({ship,target,asteroids:[{position:Vec.create(150,0),radius:70}]});
if(direct.thrust!==1 || direct.turn!==0 || !direct.fire || blocked.thrust!==0 || !blocked.turn)throw Error('Production controller lost its normal steering or obstacle avoidance');
const action='/prepare';
Reflect.set(globalThis,'rendering-action-label',action);
Reflect.set(globalThis,'rendering-controls-verified',true);`
          : undefined,
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await bundle.generate({ format: 'esm' });

  await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  );
  assert.equal(Reflect.get(globalThis, 'rendering-controls-verified'), true);
  assert.equal(Reflect.get(globalThis, 'rendering-action-label'), '/prepare');
} finally {
  await bundle.close();
  Reflect.deleteProperty(globalThis, 'rendering-controls-verified');
  Reflect.deleteProperty(globalThis, 'rendering-action-label');
}
