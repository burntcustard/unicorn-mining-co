/* global Buffer, process */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

assert.deepEqual(readdirSync('src').sort(), [
  'client',
  'definitions',
  'server',
]);
const scenario = `
import assert from 'node:assert/strict';
import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
import { GameObject } from '${process.cwd()}/src/client/objects/game-object.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { Craft } from '${process.cwd()}/src/client/objects/craft.ts';
import { Station } from '${process.cwd()}/src/client/objects/station.ts';
import { Module } from '${process.cwd()}/src/client/objects/modules/module.ts';
import { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
import { Item } from '${process.cwd()}/src/client/objects/item.ts';
import { diamond as diamondDefinition } from '${process.cwd()}/src/definitions/items/index.ts';


import { Asteroid } from '${process.cwd()}/src/client/objects/asteroid.ts';
import { moduleTypes, HornDrill, SearchLight } from '${process.cwd()}/src/client/objects/modules/index.ts';
import { colors } from '${process.cwd()}/src/definitions/colors.ts';
import { createWreckage } from '${process.cwd()}/src/client/objects/create-wreckage.ts';
import { createWorld, addEntity } from '${process.cwd()}/src/client/simulation/world.ts';
import { captureWorld, restoreWorld, cloneEntity } from '${process.cwd()}/src/client/simulation/world-state.ts';

assert.equal(typeof document, 'undefined');
assert.equal(typeof window, 'undefined');
assert.equal(Object.getPrototypeOf(Craft.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(Ship.prototype), Craft.prototype);
assert.equal(Object.getPrototypeOf(Module.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(HornDrill.prototype), Module.prototype);
assert.equal(Object.getPrototypeOf(Asteroid.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(Item.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(Station.prototype), Craft.prototype);
const bare = new Ship({});
const intactSegments = bare.segments;
bare.hullHealth = bare.hullHealth;
assert.equal(bare.segments, intactSegments, 'unchanged hull checkpoints preserve geometry');
const pendingDamage = new Ship({});
const brokenSegment = pendingDamage.segments.find(segment => segment.hull && segment.health > 0);
brokenSegment.health = 0;
pendingDamage.hullHealth = pendingDamage.hullHealth;
assert(!pendingDamage.segments.includes(brokenSegment), 'matching health still removes pending destroyed hulls without spawning wreckage');
const arrayObject = new GameObject();
arrayObject.shapeOutline = [[1, 2], [3, 4]];
arrayObject.shapeOutline.edges = [true, false];
arrayObject.alias = arrayObject.shapeOutline;
const arrayCopy = cloneEntity({entity:arrayObject});
assert.equal(arrayCopy.shapeOutline, arrayCopy.alias, 'array aliases survive rollback copying');
arrayCopy.shapeOutline[0][0] = 9;
arrayCopy.shapeOutline.edges[0] = false;
assert.equal(arrayObject.shapeOutline[0][0], 1, 'shapeOutline coordinates are isolated');
assert.equal(arrayObject.shapeOutline.edges[0], true, 'shapeOutline collision metadata is isolated');
assert.equal(bare.modules.length, 0);
assert(bare.hitbox().length > 0);
assert.equal(bare.forwardThrust, 0);
const world = createWorld({seed:25});
{
  const registry = [];
  const old = new GameObject({id:9001, world, collections:[registry]});
  const neighbour = new GameObject({id:9002, world, collections:[registry]});
  old.add();
  neighbour.add();
  const replacement = new GameObject({id:old.id, world, collections:[registry]});
  replacement.add();
  old.remove();
  old.remove();
  assert.equal(world.entities.get(replacement.id),replacement,'retiring a stale object preserves its authoritative replacement');
  assert.equal(neighbour.collections[0],registry,'removal preserves shared registry identity');
  assert.deepEqual(registry,[neighbour,replacement],'repeated removal does not remove a neighbour');
  neighbour.remove();
  replacement.remove();
  assert.equal(registry.length,0,'other members still remove themselves from the live registry');
}
for (const Type of [Craft,Station,Station,Ship]) {
  const diamond = new Item(diamondDefinition, );
  const hornDrill = new HornDrill();
  const object = new GameObject();
  const craft = new Type({cargoContents:[diamond,hornDrill,object]});
  assert.deepEqual(craft.cargoContents,[diamond,hornDrill,object],'every craft owns one heterogeneous cargo collection');
  const copy=cloneEntity({entity:craft});
  assert(copy.cargoContents[0] instanceof Item && copy.cargoContents[0].resource === 0);
  assert(copy.cargoContents[1] instanceof HornDrill);
  assert(copy.cargoContents[2] instanceof GameObject);
  assert.equal(copy.modules[0],copy.cargoContents[1],'stowed modules share their cargo instance');
  if(craft instanceof Ship){
    craft.fit(hornDrill);
    const mount=hornDrill.mount;
    assert.deepEqual(craft.cargoContents,[diamond,object]);
    craft.fit(hornDrill,mount);
    assert(craft.segmentsAtMount(mount).length>0,'refitting the same module preserves its segments');
    craft.fit(0,mount);
    assert.deepEqual(craft.cargoContents,[diamond,object,hornDrill]);
    assert.equal(craft.modules.filter(module=>module===hornDrill).length,1);
  }
}
const ship = addEntity(world, createPlayerShip(world, {playerId:1}));
ship.setModuleActive({module:HornDrill,active:true});
ship.update(0.1);
const moduleStates = ship.moduleStates;
const fitted = ship.modules.find(module => module.constructor === HornDrill);
const segments = ship.segmentsAtMount(fitted.mount);
assert(segments[0].activationProgress > 0 && segments[0].activationProgress < 1);
ship.moduleStates = moduleStates;
assert.equal(ship.modules.find(module => module.constructor === HornDrill), fitted, 'snapshot preserves unchanged module instances');
assert.equal(ship.segmentsAtMount(fitted.mount)[0], segments[0]);
ship.cargoContents.push(new Item(diamondDefinition, {resource:0,world}));
const state = captureWorld({world});
const expectedRandom = world.random.next();
ship.position.x=200;
segments[0].active=0;
fitted.mount.health=1;
ship.cargoContents[0].health=1;
restoreWorld({world,state});
const restored=world.entities.get(ship.id);
assert(restored instanceof Ship);
assert.equal(restored.world, world);
assert.equal(world.random.next(),expectedRandom,'rollback restores random state');
assert.notEqual(restored.position.x,200);
assert.deepEqual(restored.moduleStates,moduleStates);
assert.equal(restored.cargoContents[0].health,100);
assert(restored.cargoContents[0] instanceof Item);
restored.modules.forEach(module => {
 if(module.mount) {
  assert(restored.mounts.includes(module.mount));
  assert.equal(module.mount.module,module);
  assert(restored.segmentsAtMount(module.mount).every(segment => segment.module === module));
 }
});
const before = Vec.add(restored.position, Vec.create());
restored.fly(1,0);
restored.update(1/60);
assert(Vec.distance(restored.position, before)>0,'restored original hull still flies');
const empty = cloneEntity({entity:bare});
assert.equal(empty.modules.length,0);
restored.moduleStates = [];
assert.equal(restored.forwardThrust,0);
assert.equal(restored.modules.length,0);
const custom = new moduleTypes[0]();
restored.cargoContents.push(custom);
restored.fit(custom);
assert(restored.forwardThrust > 0);
assert.equal(restored.moduleStates[0].type,0);
restored.remove();
assert(!world.entities.has(restored.id));
const station = new Station({});
const stationParts = station.hitbox().length;
station.hullHealth = [...station.hullHealth];
assert.equal(station.hitbox().length,stationParts,'station walls survive snapshot restoration');
const damaged = addEntity(world,createPlayerShip(world));
damaged.segments.find(segment => segment.hull && segment.health === 8).health = 0;
damaged.update(0);
const fragment = [...world.entities.values()].find(entity => entity.decay);
assert(fragment instanceof Craft);
const replica = addEntity(world,createPlayerShip(world));
replica.hullHealth = damaged.hullHealth;
replica.moduleStates = damaged.moduleStates;
const count = world.entities.size;
replica.update(0);
assert.equal(world.entities.size,count,'applying damaged hull state does not duplicate fragments');
const wreckage = createWreckage({properties:{position:fragment.position,rotation:fragment.rotation,decay:fragment.decay},segments:fragment.wreckage});
assert.equal(wreckage.hitbox().length,fragment.hitbox().length);
assert.deepEqual(wreckage.hitbox().map(segment=>segment.shapeOutline),fragment.hitbox().map(segment=>segment.shapeOutline),'replicated wreckage keeps its actual geometry');
assert.equal(wreckage.cockpit,undefined,'wreckage must not materialise as a complete Ship');
for (const activationProgress of [0, 1]) {
  const lightWorld = createWorld({seed:25});
  const lightShip = addEntity(lightWorld,createPlayerShip(lightWorld,{shades:colors.cyan}));
  const light = lightShip.modules.find(module=>module instanceof SearchLight);
  const lightSegment = lightShip.segments.find(segment=>segment.module===light);

  lightSegment.activationProgress = activationProgress;
  lightShip.detach(light.mount);
  const debris = [...lightWorld.entities.values()].find(entity=>entity!==lightShip && entity.decay);
  const shapeOutline = debris.wreckage[0].shapeOutline;
  const width = Math.max(...shapeOutline.map(([x])=>x)) - Math.min(...shapeOutline.map(([x])=>x));
  const height = Math.max(...shapeOutline.map(([,y])=>y)) - Math.min(...shapeOutline.map(([,y])=>y));

  assert.equal(width,8,'light debris is half the cargo door length');
  assert.equal(height,3,'light debris keeps the cargo door width');
  assert.equal(debris.wreckage[0].fillShade,2,'light debris keeps the lit color');
  assert.deepEqual(debris.shades,colors.cyan,'light debris keeps the module palette');
  const replicatedDebris = createWreckage({
    properties:{shades:debris.shades,decay:debris.decay},
    segments:debris.wreckage,
  });
  assert.deepEqual(replicatedDebris.hitbox()[0].shapeOutline,shapeOutline,'replicated light debris keeps its housing shape');
  assert.equal(replicatedDebris.wreckage[0].fillShade,2,'replicated light debris keeps its bright shade');
}

console.log('Shared object hierarchy, flexible modules and rollback passed');`;

const entryId = `${process.cwd()}/src/__objects_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'shared-objects-test',
        resolveId: (id) => (id === entryId ? entryId : undefined),
        load: (id) =>
          id === entryId
            ? production
              ? stripIfdef(
                  scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
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
  const code = output[0].code;

  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
