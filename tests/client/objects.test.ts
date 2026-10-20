/* global Buffer, process */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins.ts';
import { testBuildPlugin } from '../support/build-plugin';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

assert.deepEqual(readdirSync('src').sort(), [
  'client',
  'font.d.ts',
  'reset.css',
  'server',
  'specs',
  'tools',
]);
const scenario = `
import { installExampleModules } from '${process.cwd()}/tests/support/example-modules.ts';
installExampleModules();
import assert from 'node:assert/strict';
import * as Vec from '${process.cwd()}/src/client/utilities/vector.ts';
import { GameObject } from '${process.cwd()}/src/client/objects/game-object.ts';
import { collidersCanContact } from '${process.cwd()}/src/client/collision/types.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { Craft } from '${process.cwd()}/src/client/objects/craft.ts';
import { Station } from '${process.cwd()}/src/client/objects/station.ts';
import { JumpGate } from '${process.cwd()}/src/client/objects/jump-gate.ts';
import { Wormhole } from '${process.cwd()}/src/client/objects/wormhole.ts';
import { ease, easeProgress } from '${process.cwd()}/src/client/utilities/ease.ts';
import { jumpGateSpec, jumpGateFlareDurationOuter, jumpGateFlareDurationInner } from '${process.cwd()}/src/specs/jump-gate.ts';
import { renderingLayers } from '${process.cwd()}/src/specs/rendering-layers.ts';
import { ThrusterSingleMd } from '${process.cwd()}/src/client/objects/modules/thruster.ts';
import { portalSpec } from '${process.cwd()}/src/specs/portal.ts';
import { mustang } from '${process.cwd()}/src/specs/ships/mustang.ts';
import { corral5 } from '${process.cwd()}/src/specs/stations/corral-5.ts';
import { Module } from '${process.cwd()}/src/client/objects/modules/module.ts';
import { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
import { Item } from '${process.cwd()}/src/client/objects/item.ts';
import { diamond as diamondSpec } from '${process.cwd()}/src/specs/items/index.ts';

import { Asteroid } from '${process.cwd()}/src/client/objects/asteroid.ts';
import {
  moduleTypes,
  HornDrill,
  SearchLight,
} from '${process.cwd()}/src/client/objects/modules/index.ts';
import { colors } from '${process.cwd()}/src/specs/colors.ts';
import { createWreckage } from '${process.cwd()}/src/client/objects/create-wreckage.ts';
import {
  createWorld,
  addEntity,
} from '${process.cwd()}/src/client/simulation/world.ts';
import {
  captureWorld,
  restoreWorld,
  cloneEntity,
} from '${process.cwd()}/src/client/simulation/world-state.ts';

const gate = new JumpGate({ position: Vec.create(500, 800), rotation: 0.71 });
assert(!(gate instanceof Craft), 'gates share hull construction without craft gameplay');
assert.equal(gate.health, undefined);
assert(gate.segments.length > 0);
assert(gate.hitbox().every(collider => !collider.dockSegment && collider.physics));
const fixedPosition = Vec.clone(gate.position);
for (const target of [1, 0]) {
  gate.opening = 1 - target;
  gate.openingTarget = target;
  const duration = (target ? jumpGateSpec.openingDuration : jumpGateSpec.closingDuration) / 1000;
  const transition = ease({ duration, from: Vec.create(1 - target, 0), to: Vec.create(target, 0) });
  for (let step = 0; step < 4; step++) {
    gate.update(duration / 4);
    const expected = easeProgress(transition(duration / 4).x) * jumpGateSpec.halfTravel;
    gate.hitbox().forEach((collider, index) => {
      const segment = gate.segments[index];
      assert(Math.abs(collider.localPosition.x - segment.middle[0] - segment.side * expected) < 1e-9,
        'gate collision hull follows the strengthened easing curve in both directions');
      const { x, y } = collider.localPosition;
      assert(Math.abs(collider.position.x - gate.position.x - x * Math.cos(gate.rotation) + y * Math.sin(gate.rotation)) < 1e-9);
      assert(Math.abs(collider.position.y - gate.position.y - x * Math.sin(gate.rotation) - y * Math.cos(gate.rotation)) < 1e-9);
      assert.equal(collider.rotation, gate.rotation, 'gate colliders rotate with the hull');
    });
  }
  assert.equal(gate.opening, target);
}
gate.openingTarget = 1;
gate.update(10);
assert.equal(gate.opening, 1);
assert.equal(gate.rotation, 0.71, 'gate opening preserves its fixed orientation');
assert.deepEqual(gate.position, fixedPosition);
const gateState = captureWorld({ world: addGateWorld(gate) });
gate.opening = 0;
restoreWorld({ world: gate.world, state: gateState });
assert.equal(gate.opening, 1, 'gate animation rewinds with simulation state');
const copiedGate = cloneEntity({ entity: gate });
assert(copiedGate instanceof JumpGate);
assert.equal(copiedGate.hitbox()[0].owner, copiedGate);
// Frame prediction refreshes the same render copy from unrendered mechanics.
// Its visual fades must keep progressing across those refreshes.
{
  const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
  const originalRender = Object.getOwnPropertyDescriptor(ThrusterSingleMd.prototype, 'render');
  const originalGlow = Object.getOwnPropertyDescriptor(ThrusterSingleMd.prototype, 'renderGlow');
  let now = 0;
  let flare = 0;
  let glow = 0;
  Object.defineProperty(performance, 'now', {configurable:true, value:() => now});
  ThrusterSingleMd.prototype.render = ({segment}) => { flare = Math.max(flare, segment.activationProgress); };
  ThrusterSingleMd.prototype.renderGlow = ({segment}) => { glow = Math.max(glow, segment.activationProgress); };
  const rotations = [];
  const ctx = {save(){}, restore(){}, translate(){}, scale(){}, rotate(angle){rotations.push(angle);}};
  try {
    for (const target of [0, 1]) {
      for (const opening of [.25, .75]) {
        const source = new JumpGate({opening, openingTarget:target, rotation:0.71});
        const copies = new WeakMap();
        const frame = () => {
          now += Math.max(jumpGateFlareDurationOuter, jumpGateFlareDurationInner) / 4;
          flare = glow = 0;
          const rendered = cloneEntity({entity:source, copies});
          for (const zIndex of [renderingLayers.modulesBelowStationHull, renderingLayers.glowBelowStations]) {
            rotations.length = 0;
            rendered.render({ctx, zIndex});
            assert.equal(rotations[0], source.rotation, 'gate engines and glows share the hull orientation');
          }
        };
        for (let i = 0; i < 8; i++) frame();
        assert.equal(flare, 1, 'gate flares ramp up despite repeated prediction copies');
        assert.equal(glow, 1, 'gate glows follow the preserved fade');
        source.opening = target;
        frame();
        assert(flare > 0, 'gate flares do not disappear immediately when movement stops');
        for (let i = 0; i < 8; i++) frame();
        assert.equal(flare, 0, 'gate flares finish fading out');
        assert.equal(glow, 0, 'gate glows finish fading out');
      }
    }
  } finally {
    if (originalNow) Object.defineProperty(performance, 'now', originalNow);
    else delete performance.now;
    if (originalRender) Object.defineProperty(ThrusterSingleMd.prototype, 'render', originalRender);
    else delete ThrusterSingleMd.prototype.render;
    if (originalGlow) Object.defineProperty(ThrusterSingleMd.prototype, 'renderGlow', originalGlow);
    else delete ThrusterSingleMd.prototype.renderGlow;
  }
}
const wormhole = new Wormhole();
assert.equal(wormhole.health, undefined);
assert.equal(wormhole.opening, 1);
assert.equal(wormhole.hitbox().length, 0);
function addGateWorld(object) { const world = createWorld(); addEntity(world, object); return world; }

assert.equal(Object.getPrototypeOf(Craft.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(Ship.prototype), Craft.prototype);
assert.equal(Object.getPrototypeOf(Module.prototype), GameObject.prototype);
assert(Module.prototype.isPrototypeOf(HornDrill.prototype));
assert.equal(Object.getPrototypeOf(Asteroid.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(Item.prototype), GameObject.prototype);
assert.equal(Object.getPrototypeOf(Station.prototype), Craft.prototype);
const bare = new Ship({});
assert.equal(
  new Ship({ shipType: 'viewerOnly', spec: { ...mustang, cargoSpace: 25 } })
    .cargoSpace,
  25,
  'unregistered ship specs work in source and production',
);
assert.equal(
  new Station({
    stationType: 'viewerOnly',
    spec: { ...corral5, localMovementRadius: 750 },
  }).localMovementRadius,
  750,
  'unregistered station specs work in source and production',
);
const intactSegments = bare.segments;
bare.hullHealth = bare.hullHealth;
assert.equal(
  bare.segments,
  intactSegments,
  'unchanged hull checkpoints preserve geometry',
);
const pendingDamage = new Ship({});
const brokenSegment = pendingDamage.segments.find(
  (segment) => segment.hull && segment.health > 0,
);
brokenSegment.health = 0;
pendingDamage.hullHealth = pendingDamage.hullHealth;
assert(
  !pendingDamage.segments.includes(brokenSegment),
  'matching health still removes pending destroyed hulls without spawning wreckage',
);
const arrayObject = new GameObject();
arrayObject.shapeOutline = [
  [1, 2],
  [3, 4],
];
arrayObject.shapeOutline.edges = [true, false];
arrayObject.alias = arrayObject.shapeOutline;
const arrayCopy = cloneEntity({ entity: arrayObject });
assert.equal(
  arrayCopy.shapeOutline,
  arrayCopy.alias,
  'array aliases survive rollback copying',
);
arrayCopy.shapeOutline[0][0] = 9;
arrayCopy.shapeOutline.edges[0] = false;
assert.equal(
  arrayObject.shapeOutline[0][0],
  1,
  'shapeOutline coordinates are isolated',
);
assert.equal(
  arrayObject.shapeOutline.edges[0],
  true,
  'shapeOutline collision metadata is isolated',
);
assert.equal(bare.modules.length, 0);
assert(bare.hitbox().length > 0);
assert.equal(bare.forwardThrust, 0);
const transitWorld = createWorld({ seed: 25 });
const transitPortal = addEntity(transitWorld, new Wormhole({ position: Vec.create(1000, 2000) }));
const transitShip = addEntity(transitWorld, createPlayerShip(transitWorld));
const pullDuration = portalSpec.pullDuration / 1000;
const scaleDuration = portalSpec.transitScaleDuration / 1000;
const holdDuration = portalSpec.arrivalHoldDuration / 1000;
transitShip.position = Vec.add(transitPortal.position, Vec.create(0, 100));
transitShip.transitGate = transitPortal.id;
transitShip.transitTime = -(pullDuration + scaleDuration);
const transitState = captureWorld({ world: transitWorld });
transitShip.update(pullDuration / 2);
assert(Vec.distance(transitShip.position, transitPortal.position) < 100);
assert(Vec.distance(transitShip.position, transitPortal.position) > 0);
assert.equal(transitShip.hitbox().length, 0);
restoreWorld({ world: transitWorld, state: transitState });
assert.equal(transitShip.transitTime, -(pullDuration + scaleDuration), 'prediction restores the transit phase');
transitShip.update(pullDuration);
assert.deepEqual(transitShip.position, transitPortal.position);
transitShip.update(scaleDuration);
assert.equal(transitShip.transitTime, -1e-6, 'wait for authoritative transfer');
transitShip.transitTime = scaleDuration + holdDuration;
transitShip.update(scaleDuration);
assert.equal(transitShip.launching || 0, 0);
assert.deepEqual(transitShip.position, transitPortal.position);
transitShip.update(holdDuration);
assert.equal(transitShip.transitTime, 0);
assert.equal(transitShip.transitGate, transitPortal.id);
assert.equal(transitShip.launching || 0, 0);
assert.equal(transitShip.forward, 0);
assert.deepEqual(transitShip.velocity, Vec.create());

const world = createWorld({ seed: 25 });
{
  const registry = [];
  const old = new GameObject({ id: 9001, world, collections: [registry] });
  const neighbour = new GameObject({
    id: 9002,
    world,
    collections: [registry],
  });
  old.add();
  neighbour.add();
  const replacement = new GameObject({
    id: old.id,
    world,
    collections: [registry],
  });
  replacement.add();
  old.remove();
  old.remove();
  assert.equal(
    world.entities.get(replacement.id),
    replacement,
    'retiring a stale object preserves its authoritative replacement',
  );
  assert.equal(
    neighbour.collections[0],
    registry,
    'removal preserves shared registry identity',
  );
  assert.deepEqual(
    registry,
    [neighbour, replacement],
    'repeated removal does not remove a neighbour',
  );
  neighbour.remove();
  replacement.remove();
  assert.equal(
    registry.length,
    0,
    'other members still remove themselves from the live registry',
  );
}
for (const Type of [Craft, Station, Station, Ship]) {
  const diamond = new Item(diamondSpec);
  const hornDrill = new HornDrill();
  const object = new GameObject();
  const craft = new Type({ cargoContents: [diamond, hornDrill, object] });
  assert.deepEqual(
    craft.cargoContents,
    [diamond, hornDrill, object],
    'every craft owns one heterogeneous cargo collection',
  );
  const copy = cloneEntity({ entity: craft });
  assert(
    copy.cargoContents[0] instanceof Item &&
      copy.cargoContents[0].resource === 0,
  );
  assert(copy.cargoContents[1] instanceof HornDrill);
  assert(copy.cargoContents[2] instanceof GameObject);
  assert.equal(
    copy.modules[0],
    copy.cargoContents[1],
    'stowed modules share their cargo instance',
  );
  if (craft instanceof Ship) {
    craft.fit(hornDrill);
    const mount = hornDrill.mount;
    assert.deepEqual(craft.cargoContents, [diamond, object]);
    craft.fit(hornDrill, mount);
    assert(
      craft.segmentsAtMount(mount).length > 0,
      'refitting the same module preserves its segments',
    );
    craft.fit(0, mount);
    assert.deepEqual(craft.cargoContents, [diamond, object, hornDrill]);
    assert.equal(
      craft.modules.filter((module) => module === hornDrill).length,
      1,
    );
  }
}
const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));
const gateCollider = gate.hitbox()[0];
const shipCollider = ship.hitbox()[0];
const savedPosition = Vec.clone(ship.position);
ship.position = Vec.add(gate.position, Vec.create(200, 0));
for (const opening of [0, .5, 1]) {
  gate.opening = opening;
  for (const speed of [-100, 0, 100]) {
    ship.velocity = Vec.create(speed, 0);
    assert(collidersCanContact(gateCollider, shipCollider), 'gate hulls remain solid for incoming, outgoing, and stationary ships');
  }
}
gate.opening = 0;
ship.position = savedPosition;
ship.velocity = Vec.create();

ship.setModuleActive({ module: HornDrill, active: true });
ship.update(0.1);
const moduleStates = ship.moduleStates;
const fitted = ship.modules.find((module) => module.constructor === HornDrill);
const segments = ship.segmentsAtMount(fitted.mount);
assert(
  segments[0].activationProgress > 0 && segments[0].activationProgress < 1,
);
ship.moduleStates = moduleStates;
assert.equal(
  ship.modules.find((module) => module.constructor === HornDrill),
  fitted,
  'snapshot preserves unchanged module instances',
);
assert.equal(ship.segmentsAtMount(fitted.mount)[0], segments[0]);
ship.cargoContents.push(new Item(diamondSpec, { resource: 0, world }));
const state = captureWorld({ world });
const expectedRandom = world.random.next();
ship.position.x = 200;
segments[0].active = 0;
fitted.mount.health = 1;
ship.cargoContents[0].health = 1;
restoreWorld({ world, state });
const restored = world.entities.get(ship.id);
assert(restored instanceof Ship);
assert.equal(restored.world, world);
assert.equal(
  world.random.next(),
  expectedRandom,
  'rollback restores random state',
);
assert.notEqual(restored.position.x, 200);
assert.deepEqual(restored.moduleStates, moduleStates);
assert.equal(restored.cargoContents[0].health, 100);
assert(restored.cargoContents[0] instanceof Item);
restored.modules.forEach((module) => {
  if (module.mount) {
    assert(restored.mounts.includes(module.mount));
    assert.equal(module.mount.module, module);
    assert(
      restored
        .segmentsAtMount(module.mount)
        .every((segment) => segment.module === module),
    );
  }
});
const before = Vec.add(restored.position, Vec.create());
restored.fly(1, 0);
restored.update(1 / 60);
assert(
  Vec.distance(restored.position, before) > 0,
  'restored original hull still flies',
);
const empty = cloneEntity({ entity: bare });
assert.equal(empty.modules.length, 0);
restored.moduleStates = [];
assert.equal(restored.forwardThrust, 0);
assert.equal(restored.modules.length, 0);
const custom = new moduleTypes[0]();
restored.cargoContents.push(custom);
restored.fit(custom);
assert(restored.forwardThrust > 0);
assert.equal(restored.moduleStates[0].type, 0);
restored.remove();
assert(!world.entities.has(restored.id));
const station = new Station({});
const stationParts = station.hitbox().length;
station.hullHealth = [...station.hullHealth];
assert.equal(
  station.hitbox().length,
  stationParts,
  'station walls survive snapshot restoration',
);
const damaged = addEntity(world, createPlayerShip(world));
damaged.segments.find(
  (segment) => segment.hull && segment.health === 12,
).health = 0;
damaged.update(0);
const fragment = [...world.entities.values()].find((entity) => entity.decay);
assert(fragment instanceof Craft);
const replica = addEntity(world, createPlayerShip(world));
replica.hullHealth = damaged.hullHealth;
replica.moduleStates = damaged.moduleStates;
const count = world.entities.size;
replica.update(0);
assert.equal(
  world.entities.size,
  count,
  'applying damaged hull state does not duplicate fragments',
);
const wreckage = createWreckage({
  properties: {
    position: fragment.position,
    rotation: fragment.rotation,
    decay: fragment.decay,
  },
  segments: fragment.wreckage,
});
assert.equal(wreckage.hitbox().length, fragment.hitbox().length);
assert.deepEqual(
  wreckage.hitbox().map((segment) => segment.shapeOutline),
  fragment.hitbox().map((segment) => segment.shapeOutline),
  'replicated wreckage keeps its actual geometry',
);
assert.equal(
  wreckage.cockpit,
  undefined,
  'wreckage must not materialise as a complete Ship',
);
for (const activationProgress of [0, 1]) {
  const lightWorld = createWorld({ seed: 25 });
  const lightShip = addEntity(
    lightWorld,
    createPlayerShip(lightWorld, { shades: colors.cyan }),
  );
  const light = lightShip.modules.find(
    (module) => module instanceof SearchLight,
  );
  const lightSegment = lightShip.segments.find(
    (segment) => segment.module === light,
  );

  lightSegment.activationProgress = activationProgress;
  lightShip.detach(light.mount);
  const debris = [...lightWorld.entities.values()].find(
    (entity) => entity !== lightShip && entity.decay,
  );
  const housing = light.constructor.model.filter(
    (segment) => segment.beam === false,
  );
  const roundGeometry = (value) => Math.round(value * 1e10) / 1e10;
  const roundedPoints = (points) =>
    points.map((point) => point.map(roundGeometry));
  const extent = (points) => [
    Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y)) -
      Math.min(...points.map(([, y]) => y)),
  ];
  assert.equal(
    debris.wreckage.length,
    housing.length,
    'every housing part becomes wreckage, excluding the beam',
  );
  assert.deepEqual(
    debris.shades,
    colors.cyan,
    'light debris keeps the module palette',
  );
  const replicatedDebris = createWreckage({
    properties: { shades: debris.shades, decay: debris.decay },
    segments: debris.wreckage,
  });
  housing.forEach((part, index) => {
    const wreckage = debris.wreckage[index];
    assert.deepEqual(
      extent(wreckage.shapeOutline).map(roundGeometry),
      extent(part.points).map(roundGeometry),
      'light debris keeps each housing part dimensions',
    );
    assert.equal(
      wreckage.fillShade,
      part.fillShade,
      'light debris keeps each model color',
    );
    assert.deepEqual(
      wreckage.stroke,
      [],
      'light debris preserves its geometry without an outline',
    );
    assert.deepEqual(
      roundedPoints(replicatedDebris.hitbox()[index].shapeOutline),
      roundedPoints(wreckage.shapeOutline),
      'replicated light debris keeps each housing shape',
    );
    assert.deepEqual(
      replicatedDebris.hitbox()[index].shapeOutline.edges,
      wreckage.shapeOutline.edges,
      'replicated light debris keeps each housing edge',
    );
    assert.equal(
      replicatedDebris.wreckage[index].fillShade,
      part.fillShade,
      'replicated light debris keeps each model shade',
    );
    assert.deepEqual(
      replicatedDebris.wreckage[index].stroke,
      [],
      'replicated light debris keeps its empty outlines',
    );
  });
}

console.log('Shared object hierarchy, flexible modules and rollback passed');
`;

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
      ...(production ? [testBuildPlugin()] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  for (const chunk of output) {
    if (chunk.type === 'chunk') {
      assert(
        Object.keys(chunk.modules).every((id) => !id.includes('/src/tools/')),
        'client objects never depend on development tools',
      );
    }
  }

  await bundle.close();
  const code = output[0].code;

  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
