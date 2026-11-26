import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import {
  createPiratePilot,
  pirateControls,
} from '../../benchmarking/rendering/pirate-controls.ts';
import {
  decodeClientMessage,
  encodeClientMessage,
} from '../../src/client/protocol/binary-control.ts';
import { sameInput } from '../../src/client/protocol/input.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import { cannonSm } from '../../src/specs/modules/offense/cannon-sm.ts';

const ship = {
  id: 1,
  position: Vec.create(),
  velocity: Vec.create(),
  rotation: 0,
  spin: 0,
  radius: 40,
  mass: 1,
  angularThrust: 1,
  rotationalThrust: 12,
};

const target = { ...ship, id: 2, position: Vec.create(500, 0) };
const direct = pirateControls({ ship, target, asteroids: [] });

assert.equal(direct.thrust, 1);
assert.equal(direct.turn, 0);
assert.equal(direct.targetId, target.id);
assert(
  direct.fire,
  'An aligned reachable opponent is aimed at, rather than blind constant fire',
);

const close = pirateControls({
  ship,
  target: { ...target, position: Vec.create(180, 0) },
  asteroids: [],
});

assert.equal(close.turn, 0, 'Hold the firing line on a nearby opponent');
assert.equal(close.fire, true);

const bearingAt = (angle: number) =>
  Vec.create(500 * Math.cos(angle), 500 * Math.sin(angle));

const short = pirateControls({
  ship: { ...ship, spin: 0.56 },
  target: { ...target, position: bearingAt(0.18) },
  asteroids: [],
});

assert.equal(short.turn, 1, 'Keep turning when braking would stop short');

const coasting = pirateControls({
  ship: { ...ship, spin: 1.2 },
  target: { ...target, position: bearingAt(0.06) },
  asteroids: [],
});

assert.equal(
  coasting.turn,
  0,
  'Coast when the current spin can finish the turn',
);

const lead = pirateControls({
  ship: { ...ship, rotation: Math.asin(0.55) },
  target: {
    ...target,
    velocity: Vec.create(
      0.25 * cannonSm.projectile.speed,
      0.55 * cannonSm.projectile.speed,
    ),
  },
  asteroids: [],
});

assert(lead.fire, 'Track the actual cannon intercept of a crossing target');

const pilot = {
  ...createPiratePilot(),
  targetId: target.id,
  passBearing: 0.65,
  passUntil: 800,
};

const departing = pirateControls({
  ship,
  target: { ...target, position: Vec.create(-50, 0) },
  asteroids: [],
  pilot,
  now: 100,
});

assert.equal(departing.thrust, 1, 'Power away while turning after the pass');

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

    const decoded = decodeClientMessage(
      encodeClientMessage({ type: 'input', sequence: 1, tick: 1, input }),
    );

    assert(decoded.type === 'input' && sameInput(input, decoded.input));
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
const ship={id:1,position:Vec.create(),velocity:Vec.create(),rotation:0,spin:0,radius:40,mass:1,angularThrust:1,rotationalThrust:12};
const target={...ship,id:2,position:Vec.create(500,0)};
const direct=pirateControls({ship,target,asteroids:[]});
const blocked=pirateControls({ship,target,asteroids:[{position:Vec.create(150,0),radius:70}]});
const short=pirateControls({ship:{...ship,spin:.56},target:{...target,position:Vec.create(500*Math.cos(.18),500*Math.sin(.18))},asteroids:[]});
const damaged=pirateControls({ship,target:{...target,hullTargetPosition:()=>Vec.create(500,100)},asteroids:[]});
if(direct.thrust!==1 || direct.turn!==0 || direct.targetId!==target.id || !direct.fire || blocked.thrust!==0 || !blocked.turn || short.turn!==1 || damaged.turn!==1 || damaged.fire)throw Error('Production controller lost course, targeting or obstacle avoidance');
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
