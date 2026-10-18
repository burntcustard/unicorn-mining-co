import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { createWorld, addEntity } from '${root}/src/client/simulation/world.ts';
import { createPlayerShip } from '${root}/src/client/objects/create-ship.ts';
import { Craft } from '${root}/src/client/objects/craft.ts';
import { createWreckage } from '${root}/src/client/objects/create-wreckage.ts';
import { moduleTypesById } from '${root}/src/client/objects/modules/index.ts';
import { Module } from '${root}/src/client/objects/modules/module.ts';
import { JumpGate } from '${root}/src/client/objects/jump-gate.ts';
import { GameCollisions } from '${root}/src/client/collision/game-collisions.ts';
import { rotatePoint } from '${root}/src/client/utilities/geometry.ts';
import { simulationStep } from '${root}/src/specs/simulation.ts';
import { updateWorld } from '${root}/src/client/simulation/update-world.ts';
import { captureWorld, restoreWorld } from '${root}/src/client/simulation/world-state.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';

const hydrate = (body, world) => createWreckage({
  properties: {
    id: body.id, world, position: Vec.clone(body.position), rotation: body.rotation,
    velocity: Vec.clone(body.velocity), spin: body.spin, mass: body.mass,
    health: body.health, decay: body.decay, shades: body.shades,
  },
  segments: body.wreckage,
});
const geometry = body => body.hitbox().map(c => ({
  position: Vec.clone(c.position), radius: c.radius, rotation: c.rotation,
  outline: c.shapeOutline, physics: c.physics, friction: c.friction,
  bounciness: c.bounciness,
}));
const record = world => [...world.entities.values()].map(e => ({
  id: e.id, position: Vec.clone(e.position), velocity: Vec.clone(e.velocity),
  rotation: e.rotation, spin: e.spin, health: e.health,
  hull: e instanceof Craft ? e.hullHealth : [],
}));
const scene = ({ type = 'cargoHatch', progress = .75, side = -1, destroy = true, rotation = .4 } = {}) => {
  const world = createWorld({seed:25});
  world.nextEntityId = 1000;
  const ship = addEntity(world, createPlayerShip(world, {id:1, position:Vec.create(0,-242), rotation}));
  const gate = addEntity(world, new JumpGate({id:100, opening:.35, openingTarget:0}));
  const Type = moduleTypesById.get(type);
  const mount = ship.mounts.find(m => m.fits.includes(Type) && (!m.localPosition.y || Math.sign(m.localPosition.y) === side));
  ship.fit(new Type(), mount);
  for (const segment of ship.segmentsAtMount(mount)) {
    segment.active = 1;
    segment.activationProgress = progress;
  }
  if (destroy) {
    mount.health = 0;
    ship.update(0);
  }
  const debris = [...world.entities.values()].find(e => e instanceof Craft && e !== ship);
  if (destroy) {
    assert(debris, type + ': destruction leaves one fragment');
    assert.equal([...world.entities.values()].filter(e => e instanceof Craft && e !== ship).length, 1);
  }
  return {world,ship,gate,debris,mount};
};

// A solid frame still leaves the gap between its open halves clear for entry
// and departure; ships do not need an exception that disables hull contacts.
for (const rotation of [0,.71]) {
  const world=createWorld({seed:25});
  addEntity(world,new JumpGate({id:100,rotation,opening:1,openingTarget:1}));
  const ship=addEntity(world,createPlayerShip(world,{
    id:1,rotation:rotation+Math.PI/2,
    position:rotatePoint(Vec.create(0,-400),rotation),
    velocity:rotatePoint(Vec.create(0,200),rotation),
  }));
  const collisions=new GameCollisions();
  for (let tick=0;tick<90;tick++) {
    collisions.capturePoses(world.entities);
    Vec.addScaled(ship.position,ship.velocity,simulationStep,ship.position);
    const contacts=collisions.step({entities:world.entities,dt:simulationStep});
    assert.equal(contacts.length,0,'the open gap admits a ship without touching the frame');
  }
  assert(rotatePoint(ship.position,-rotation).y>190,'the ship passes through the open gap');
}

// A module's animation, material, health target, and obsolete mount must not
// survive as behavior that a newly received wreckage snapshot cannot reproduce.
for (const type of ['hornDrill','cargoHatch','plasmaAccelerator','shieldGeneratorSm']) {
  for (const progress of [0,.75,1]) {
    for (const side of [-1,1]) {
      const {world,ship,debris} = scene({type,progress,side});
      const before = JSON.stringify(debris.wreckage);
      assert.equal(debris.modules.length,0);
      assert.equal(debris.mounts.length,0);
      assert(debris.segments.every(s => !(s.module instanceof Module) && !s.mount));
      for (let tick=0;tick<10;tick++) debris.update(.01);
      assert.equal(JSON.stringify(debris.wreckage),before,type + ': debris geometry is frozen');
      assert.deepEqual(geometry(debris),geometry(hydrate(debris,world)),type + ': fresh and replicated debris have identical physical surfaces');
      assert.equal(ship.segments.some(s => s.mount?.health < 1),false);
    }
  }
}

// Predicting an original fragment or its received snapshot must produce the
// same squeeze out of a gate, including partially open hatch shapes.
for (const type of ['hornDrill','cargoHatch']) {
  for (const progress of [.25,.75,1]) {
    const runs=[];
    for(const received of [false,true]) {
      const {world,ship,debris}=scene({type,progress});
      world.entities.delete(ship.id);
      Vec.setXY(debris.position,0,-259.5);
      Vec.setXY(debris.velocity,0,0);
      debris.spin=0;
      const body=received?hydrate(debris,world):debris;
      world.entities.set(body.id,body);
      const frames=[];
      for(let tick=0;tick<90;tick++) {
        updateWorld({world,inputs:new Map()});
        frames.push(record(world));
        assert.equal(world.entities.size,2,'detached debris does not spawn another module');
      }
      runs.push(frames);
    }
    assert.deepEqual(runs[0],runs[1],type + ': snapshot reconciliation preserves wreckage motion');
  }
}

// Replaying a crushing tick must not carry fixture/contact order from the later
// debris timeline back to the hatch's starting state.
for (const destroy of [true,false]) {
  const {world,mount}=scene({destroy,rotation:destroy?.4:0});
  const checkpoint=captureWorld({world});
  let expected;
  for(let replay=0;replay<3;replay++) {
    restoreWorld({world,state:checkpoint});
    const frames=[];
    for(let tick=0;tick<60;tick++) {
      updateWorld({world,inputs:new Map()});
      frames.push(record(world));
    }
    assert(!mount.module,'the closing gate destroys the fitted hatch during replay');
    if(expected) assert.deepEqual(frames,expected,'replaying destruction preserves debris identities and motion');
    else expected=frames;
  }
}
`;

for (const production of [false, true]) {
  const entry = `${root}/src/__gate_modules_test.ts`;

  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'gate-modules',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? production
              ? scenario.replace(
                  /assert\.(\w+)/g,
                  (_, method) => `Reflect.get(assert, '${method}')`,
                )
              : scenario
            : undefined,
      },
      buildPrePlugin(),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  await assert.doesNotReject(
    import(
      'data:text/javascript;base64,' +
        Buffer.from(output[0].code).toString('base64')
    ),
    production
      ? 'production gate module regressions'
      : 'source gate module regressions',
  );
}
