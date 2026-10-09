/* global Buffer, process */
import { readFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { renderingLayers } from '${root}/src/specs/rendering-layers.ts';
import { makeEntity } from '${root}/src/client/network/network.ts';
import { applyEntity } from '${root}/src/client/prediction/prediction.ts';
import { game } from '${root}/src/client/game.ts';
import { createWorld, addEntity } from '${root}/src/client/simulation/world.ts';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
} from '${root}/src/client/simulation/world-state.ts';
import { Projectile } from '${root}/src/client/objects/projectile.ts';
import { crotus } from '${root}/src/specs/ships/crotus.ts';
import { Ship } from '${root}/src/client/objects/ship.ts';
import { createPlayerShip } from '${root}/src/client/objects/create-ship.ts';
import { Station } from '${root}/src/client/objects/station.ts';
import {
  moduleTypesById,
  SearchLight,
  CargoHatch,
  HornDrill,
  ShieldGenerator,
  ShieldGeneratorMd,
  ThrusterSingleSm,
  ThrusterSingleMd,
  ThrusterSingleLg,
  ThrusterSingleXl,
  thrusters,
  PlasmaAccelerator,
  Autogun,
} from '${root}/src/client/objects/modules/index.ts';
import {
  moduleSpecs,
  moduleIds,
  moduleSpecList,
} from '${root}/src/specs/modules/index.ts';
import { cargoHatchGeometry } from '${root}/src/client/objects/modules/cargo-hatch.ts';
import { Item } from '${root}/src/client/objects/item.ts';
import { diamond as diamondSpec } from '${root}/src/specs/items/index.ts';

import { amethyst as amethystSpec } from '${root}/src/specs/items/index.ts';
import {
  Asteroid,
  createAsteroid,
} from '${root}/src/client/objects/asteroid.ts';
import { Craft } from '${root}/src/client/objects/craft.ts';
import { createWreckage } from '${root}/src/client/objects/create-wreckage.ts';
import * as Vec from '${root}/src/client/utilities/vector.ts';
import {
  revealBuriedItems,
  tint,
} from '${root}/src/client/utilities/lighting.ts';
import { colors } from '${root}/src/specs/colors.ts';
import { withAlpha } from '${root}/src/client/utilities/color.ts';
import { renderControls } from '${root}/src/client/ui/controls.ts';
import { presentEvents } from '${root}/src/client/effects/present-events.ts';
import { sparks } from '${root}/src/client/effects/shrapnel.ts';
const soundCount = Reflect.get(globalThis, 'sounds').length;
presentEvents({
  playerId: 1,
  events: [{ type: 'itemCollected', by: 1, itemId: 888, resource: 0 }],
});
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  soundCount + 1,
  'collecting cargo plays a sound',
);
assert.equal(
  Reflect.get(globalThis, 'sounds').at(-1),
  2,
  'pickup uses the original pickup effect',
);
presentEvents({
  playerId: 1,
  events: [{ type: 'itemCollected', by: 2, itemId: 889, resource: 0 }],
});
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  soundCount + 1,
  'other pilots do not play our cargo notification',
);
const collision = {
  type: 'collision',
  a: 10,
  b: 11,
  impact: 400,
  colors: ['#f00', '#0af'],
  damage: [0, 0],
  position: Vec.create(7, 3),
};
presentEvents({ shipId: 10, events: [collision] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  soundCount + 1,
  'a harmless ship collision does not play the crash effect',
);
assert.equal(
  sparks.length,
  0,
  'a fast collision without damage produces no sparks',
);
const crashCount = Reflect.get(globalThis, 'sounds').length;
presentEvents({ shipId: 12, events: [{ ...collision, damage: [0, 2] }] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  crashCount,
  'other objects colliding do not play our crash sound',
);
assert.equal(sparks.length, 4, 'only the damaged surface produces sparks');
assert(
  sparks.every((spark) => spark.color === '#0af'),
  'the undamaged surface emits no sparks in its colour',
);
assert(
  sparks.every((spark) => spark.position.x === 7 && spark.position.y === 3),
  'sparks appear at the contact point',
);
sparks.length = 0;
presentEvents({ shipId: 10, events: [{ ...collision, damage: [0, 2] }] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  crashCount,
  'damaging only the object hit by our ship does not play a crash',
);
sparks.length = 0;
presentEvents({ shipId: 11, events: [{ ...collision, damage: [2, 0] }] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  crashCount,
  'the undamaged ship stays silent with either collider order',
);
assert(
  sparks.every((spark) => spark.color === '#f00'),
  'damage follows its own surface in either collider order',
);
sparks.length = 0;
presentEvents({ shipId: 10, events: [{ ...collision, damage: [2, 0] }] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  crashCount + 1,
  'damage to our ship hull or an attached module plays a crash',
);
assert.equal(
  Reflect.get(globalThis, 'sounds').at(-1),
  3,
  'ship damage uses the crash effect',
);
sparks.length = 0;
presentEvents({ shipId: 11, events: [{ ...collision, damage: [0, 2] }] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  crashCount + 2,
  'damage to our ship plays a crash with either collider order',
);
sparks.length = 0;
const slowCrashCount = Reflect.get(globalThis, 'sounds').length;
presentEvents({ shipId: 10, events: [{ ...collision, impact: 1 }] });
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  slowCrashCount,
  'resting contact does not play a crash',
);
presentEvents({
  shipId: 10,
  events: [{ ...collision, impact: 1, damage: [0, 2] }],
});
assert.equal(
  sparks.length,
  4,
  'damaging contacts produce sparks even below the crash-sound speed threshold',
);
assert.equal(
  Reflect.get(globalThis, 'sounds').length,
  slowCrashCount,
  'slow damage still does not play the crash sound',
);
sparks.length = 0;
const packet = JSON.parse(Reflect.get(globalThis, 'packet'));
const world = createWorld();
const hydratedProjectile = makeEntity({
  world,
  entity: {
    id: 9998,
    kind: 'projectile',
    definitionId: 'autogun',
    radius: 1,
    health: 1.25,
    position: Vec.create(),
    velocity: Vec.create(600, 0),
    rotation: 0,
    spin: 0,
    playerId: 1,
  },
});
assert(hydratedProjectile instanceof Projectile);
assert.equal(hydratedProjectile.health, 1.25);
const hydratedSlate = makeEntity({
  entity: {
    id: 9999,
    kind: 'item',
    resource: 4,
    message: 'GOLD ORE 100/200',
    position: Vec.create(),
    radius: 8,
    rotation: 0,
    spin: 0,
  },
  world,
});
assert.equal(
  hydratedSlate.message,
  'GOLD ORE 100/200',
  'the replicated slate keeps its field coordinates',
);
const hydratedAmmo = makeEntity({
  world,
  entity: {
    kind: 'item',
    id: 9997,
    resource: 5,
    rounds: 137,
    position: Vec.create(),
    radius: 6,
    rotation: 0,
    spin: 0,
  },
});
assert.equal(
  hydratedAmmo.rounds,
  137,
  'replicated packs retain their remaining rounds instead of refilling',
);
const objects = packet['fullEntities'].map((entity) =>
  makeEntity({ entity, world }),
);
assert.throws(
  () =>
    makeEntity({
      entity: { ...packet['fullEntities'][0], kind: 'unknown' },
      world,
    }),
  /Unknown replicated entity kind/,
  'unknown wire kinds must not turn into ships',
);
const remote = objects.find((entity) => entity instanceof Ship);
const station = objects.find((entity) => entity instanceof Station);
assert(remote && station, 'wire descriptions restore concrete classes');
assert.equal(
  station.segments.filter(
    (segment) => segment.zIndex === renderingLayers.stationFloor,
  ).length,
  1,
  'the explicit floor layer 0 survives station hull inheritance',
);
assert(
  station.segments.every(
    (segment) => Number.isInteger(segment.zIndex) && segment.zIndex >= 0,
  ),
  'station layers are nonnegative integers',
);
assert(
  remote.segments
    .filter((segment) => segment.hull)
    .every((segment) => segment.zIndex === renderingLayers.shipHull),
  'ship hulls inherit the default hull layer',
);
const floorModule = new HornDrill();
floorModule.zIndex = renderingLayers.stationFloor;
const floorShip = new Ship({ shades: colors.white });
floorShip.cargoContents.push(floorModule);
floorShip.fit(floorModule);
assert(
  floorShip.segments
    .filter((segment) => segment.module === floorModule)
    .every((segment) => segment.zIndex === renderingLayers.stationFloor),
  'a module layer 0 survives hull inheritance',
);
assert(
  remote.moduleActive({ module: SearchLight }) &&
    remote.moduleActive({ module: CargoHatch }),
  'wire activation restores module instances',
);
assert.deepEqual(
  remote.shades,
  colors.cyan,
  'authoritative ship palette survives the wire',
);
assert.deepEqual(
  station.shades,
  colors.white,
  'station retains its own palette',
);
for (const craft of [remote, station]) {
  assert.equal(
    craft.cargoContents.length,
    3,
    'mixed cargo replicates without double-counting loose modules',
  );
  assert(
    craft.cargoContents[0] instanceof Item &&
      craft.cargoContents[0].resource === 0,
  );
  assert.equal(
    craft.cargoContents[0].name,
    'Diamond',
    'item names come from the shared spec',
  );
  assert(craft.cargoContents[1] instanceof HornDrill);
  assert(
    craft.modules.includes(craft.cargoContents[1]),
    'replicated modules and cargo contents reference the same module',
  );
}
assert.deepEqual(
  remote.cargoContents.map((object) => object.id),
  [321, 322, 323],
  'cargo order and identities survive the wire',
);
assert.equal(
  remote.cargoContents[0].health,
  42,
  'item damage survives replication',
);
assert.equal(
  remote.cargoContents[2].label,
  'CRATE',
  'generic cargo state survives replication',
);
for (const craft of [remote, station]) {
  const predicted = cloneEntity({ entity: craft });
  for (let tick = 0; tick < 3; tick++)
    applyEntity({ entity: predicted, server: craft });
  assert.deepEqual(
    predicted.cargoContents.map((object) => object.id),
    craft.cargoContents.map((object) => object.id),
    'repeated reconciliation preserves mixed cargo without duplicates',
  );
  assert(
    predicted.modules.includes(predicted.cargoContents[1]),
    'reconciliation preserves the cargo/module alias',
  );
}
const draws = [];
const strokes = [];
const strokePaths = [];
const styles = [];
const transforms = [];
let saves = 0,
  gradients = 0,
  boxes = 0,
  clips = 0,
  glowImages = 0;
game.ctx = {
  strokeText() {},
  fillText() {},
  strokeStyle: '#000',
  fillStyle: '#000',
  save() {
    saves++;
    styles.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle });
  },
  restore() {
    saves--;
    Object.assign(this, styles.pop());
  },
  translate(x, y) {
    transforms.push([x, y]);
  },
  rotate(angle) {
    transforms.push(angle);
  },
  scale() {},
  beginPath() {},
  arc() {},
  stroke(path) {
    strokes.push(this.strokeStyle);
    strokePaths.push(path);
  },
  clip() {
    clips++;
  },
  resetTransform() {},
  setLineDash() {},
  createLinearGradient() {
    gradients++;
    return {
      stops: [],
      addColorStop(offset, color) {
        this.stops.push(color);
      },
    };
  },
  createRadialGradient() {
    return { addColorStop() {} };
  },
  fill(path, rule) {
    draws.push({ path, rule, style: this.fillStyle, glowImages });
  },
  fillRect() {
    boxes++;
  },
  drawImage(image) {
    glowImages++;
    assert(image.width > 0, 'glows use a real canvas after prediction cloning');
  },
};
Object.assign(game, { scale: 1, uiScale: 1, uiWidth: 640, uiHeight: 480 });
const transparentItem = new Item(amethystSpec, { fillAlpha: 0 });
transparentItem.render();
assert.equal(
  draws[0].style,
  '#dd33dd00',
  'zero item alpha is transparent rather than falling back to an opaque fill',
);
assert.equal(
  strokes.at(-1),
  colors.violet[2],
  'item alpha does not fade the opaque outline',
);
draws.length = strokes.length = transforms.length = 0;
const local = cloneEntity({ entity: remote });
const physicsPosition = Vec.add(remote.position, Vec.create());
const physicsRotation = remote.rotation;
remote.render({
  zIndex: renderingLayers.shipHull,
  pose: { position: Vec.create(123, 456), rotation: 0.75 },
});
assert.deepEqual(
  transforms[0],
  [123, 456],
  'remote hull renders at the buffered position',
);
assert.equal(
  transforms[1],
  0.75,
  'remote hull renders at the buffered rotation',
);
assert.deepEqual(
  remote.position,
  physicsPosition,
  'presentation never changes collision position',
);
assert.equal(
  remote.rotation,
  physicsRotation,
  'presentation never changes collision rotation',
);
for (const ship of [local, remote]) {
  assert(
    !Object.hasOwn(ship, 'render'),
    'rendering lives on the shared class prototype',
  );
  const nozzles = ship.segments.filter((segment) =>
    thrusters.some((Type) => segment.module instanceof Type),
  );
  draws.length = 0;
  for (const segment of nozzles) segment.module.render({ segment: segment });
  assert.equal(
    draws.length,
    nozzles.length,
    'each active local/remote nozzle renders a flare',
  );
  assert(
    draws.every(({ path }) =>
      Reflect.get(path, 'vertices').some(([x]) => x < 0),
    ),
    'flares extend behind the nozzle',
  );
  const searchLightSegment = ship.segments.find(
    (segment) => segment.module instanceof SearchLight,
  );
  const before = gradients;
  searchLightSegment.module.render({
    segment: searchLightSegment,
    craft: ship,
    scenery: [],
  });
  assert(
    gradients > before,
    'active local/remote search light draws a beam gradient',
  );
  const housing = ship.segments.find(
    (segment) =>
      segment.module instanceof SearchLight && segment.beam === false,
  );
  assert(
    housing.zIndex < HornDrill.zIndex,
    'the lamp housing stays underneath the horn drill regardless of fitting order',
  );
  const housingProgress = housing.activationProgress;
  for (const activationProgress of [0, 1]) {
    housing.activationProgress = activationProgress;
    draws.length = 0;
    const beforeHousing = gradients;
    housing.module.render({ segment: housing, craft: ship, scenery: [] });
    assert(
      draws.length > 0,
      'the attached lamp housing renders with its light on or off',
    );
    assert.equal(
      gradients,
      beforeHousing,
      'the housing does not project an extra beam',
    );
  }
  housing.activationProgress = housingProgress;
  const beforeBoxes = boxes;
  renderControls(game, ship);
  assert.equal(
    boxes - beforeBoxes,
    2,
    'cargo hatch and search light checkboxes reflect replicated activation',
  );
  draws.length = 0;
  const beforeHull = gradients;
  ship.render({ zIndex: renderingLayers.shipHull });
  assert(gradients > beforeHull, 'ship hulls retain gradient shading');
  const cyanTints = Array.from({ length: 64 }, (_, i) =>
    tint(colors.cyan, 1, i / 63),
  );
  assert(
    draws.some((draw) =>
      draw.style.stops?.every((stop) => cyanTints.includes(stop)),
    ),
    'remote hull is lit from the authoritative colour',
  );
  const hornDrillSegment = ship.segments.find(
    (segment) => segment.module instanceof HornDrill,
  );
  draws.length = 0;
  strokes.length = 0;
  hornDrillSegment.module.render({ segment: hornDrillSegment });
  assert(
    draws.some((draw) => draw.style === colors.yellow[0]),
    'modules are filled with their darkest shade',
  );
  assert(
    strokes.every((color) => color === colors.yellow[2]),
    'horn drill shapeOutline and flutes retain their colour across parent canvas restore',
  );
  const hatchDoor = ship.segments.find(
    (segment) => segment.module instanceof CargoHatch && !segment.catches,
  );
  draws.length = 0;
  hatchDoor.module.render({ segment: hatchDoor });
  assert(
    draws.some((draw) => draw.style === colors.violet[2]),
    'attached cargo hatch uses its light shade',
  );
  const sounds = Reflect.get(globalThis, 'sounds');
  const beforeSound = sounds.length;
  ship.updateVisual(1 / 60);
  assert(
    sounds.slice(beforeSound).includes(0),
    'opening a replicated cargo hatch plays its sound',
  );
  ship.setModuleActive({ module: CargoHatch, active: false });
  ship.updateVisual(1 / 60);
  assert(
    sounds.slice(beforeSound).includes(1),
    'closing a replicated cargo hatch plays its sound',
  );
}
for (const y of [-29, 29]) {
  const craft = new Ship({ shades: colors.cyan });
  const mount = craft.mounts.find(
    (mount) => mount.fits.includes(CargoHatch) && mount.localPosition.y === y,
  );
  const hatch = new CargoHatch();
  craft.fit(hatch, mount);
  const segments = craft.segments.filter((segment) => segment.module === hatch);
  const door = segments.find((segment) => !segment.catches);
  assert(
    segments.every((segment) => segment.localPosition.y === Math.sign(y) * 13),
    'door and pickup geometry stay 16 units inward from the mount',
  );
  for (const progress of [0, 0.5, 1]) {
    door.activationProgress = progress;
    const expected = cargoHatchGeometry.doorShapeOutline({
      progress,
      side: Math.sign(y),
    });
    draws.length = 0;
    hatch.render({ segment: door });
    assert.deepEqual(
      Reflect.get(draws[0].path, 'vertices'),
      expected,
      'offset hatches retain their rendered door shape',
    );
  }
}
for (const [Type, size] of [
  [ThrusterSingleSm, 5],
  [ThrusterSingleMd, 7],
  [ThrusterSingleLg, 9],
  [ThrusterSingleXl, 11],
]) {
  const craft = new Ship({
    shades: colors.cyan,
    hullSegments: [
      {
        health: 100,
        core: true,
        points: [
          [-16, -20],
          [8, 0],
          [-16, 20],
        ],
        mounts: [[{ x: -16, y: 0, fits: [Type.definitionId] }]],
      },
    ],
  });
  const engine = new Type();
  craft.fit(engine);
  craft.fly(1, 0);
  craft.updateModules(1);
  const segment = craft.segments.find((segment) => segment.module === engine);
  draws.length = 0;
  engine.render({ segment });
  assert.deepEqual(
    Reflect.get(draws[0].path, 'vertices'),
    [
      [0, -size],
      [-size * 2.5, 0],
      [0, size],
    ],
    'single thruster size controls its rendered flare',
  );
  assert.equal(
    craft.forwardThrust,
    22,
    'all single sizes retain the existing forward thrust',
  );
}
for (const [Type, radius] of [
  [ShieldGenerator, 50],
  [ShieldGeneratorMd, 60],
]) {
  const shieldCraft = new Ship({ spec: crotus, shades: colors.cyan });
  const shield = new Type();
  shieldCraft.fit(shield);
  const body = shieldCraft.segments.find(
    (segment) => segment.module === shield && !segment.covers,
  );
  const bubble = shieldCraft.segments.find(
    (segment) => segment.module === shield && segment.covers,
  );
  assert.equal(
    body.radius(body),
    7,
    'both generator bodies retain their original size',
  );
  bubble.active = 1;
  bubble.activationProgress = 0.5;
  assert.equal(
    bubble.radius(bubble),
    radius / 2,
    'bubble growth uses the variant radius',
  );
  bubble.activationProgress = 1;
  assert.equal(
    shieldCraft.hitbox()[0].radius,
    radius,
    'the fully active collision bubble uses the variant radius',
  );
  strokes.length = 0;
  shield.render({ segment: body });
  assert.equal(
    strokes.at(-1),
    colors.violet[2],
    'both generators retain their violet plus',
  );
  shield.render({ segment: bubble });
  assert.equal(
    draws.at(-1).style,
    withAlpha({ color: colors.violet[2], alpha: bubble.fillAlpha }),
    'shield bubbles use their configured opacity',
  );
  bubble.fillAlpha = 0;
  shield.render({ segment: bubble });
  assert.equal(
    draws.at(-1).style,
    '#ee66ff00',
    'zero module alpha remains transparent',
  );
}
const customShieldSpec = {
  ...ShieldGenerator,
  shieldRadius: 80,
  coverDuration: 0.4,
  model: [
    {
      radius: 11,
      color: colors.orange[1],
      lines: [
        [
          [-3, 2],
          [5, -4],
        ],
      ],
    },
    { covers: true, fillAlpha: 0.5 },
  ],
};
const customShield = new ShieldGenerator({
  model: ShieldGenerator.createModel(customShieldSpec),
});
const customShieldCraft = new Ship({ spec: crotus });
customShieldCraft.fit(customShield);
const customShieldParts = customShieldCraft.segments.filter(
  (segment) => segment.module === customShield,
);
const customBody = customShieldParts.find((segment) => !segment.covers);
const customCover = customShieldParts.find((segment) => segment.covers);
assert.equal(
  customShieldParts.length,
  2,
  'circle models create exactly the specified generator and cover',
);
assert.equal(
  customBody.radius(customBody),
  11,
  'generator collision radius comes from its model',
);
customBody.phase = 0.3;
customShield.render({ segment: customBody });
assert.equal(
  draws.at(-1).style,
  colors.orange[1],
  'model color controls the generator fill independently of its paint',
);
customBody.fillAlpha = 0.5;
customShield.render({ segment: customBody });
assert.equal(
  draws.at(-1).style,
  withAlpha({ color: colors.orange[1], alpha: 0.5 }),
  'model opacity applies to its explicit colour',
);
assert.deepEqual(
  Reflect.get(strokePaths.at(-1), 'vertices'),
  customShieldSpec.model[0].lines.flat(),
  'generator markings come from its model',
);
assert.equal(
  transforms.at(-1),
  0.3,
  'model markings rotate with the generator phase',
);
customCover.activationProgress = 0.5;
assert.equal(
  customCover.radius(customCover),
  40,
  'the cover model scales with activation',
);
assert.equal(
  customCover.rate,
  1 / 0.4,
  'the cover model uses the configured activation duration',
);
customShield.render({ segment: customCover });
assert.equal(
  draws.at(-1).style,
  '#ee66ff80',
  'cover opacity comes from its model',
);
// Every behavior consumes the same per-part outline setting, including a mix.
for (const [id, Type] of moduleTypesById) {
  const spec = moduleSpecList[moduleIds.indexOf(id)];
  const fillsByPart = new Map();
  for (const mode of ['current', true, false, 'mixed']) {
    const model = spec.model.map((part, index) => ({
      ...part,
      outline:
        mode === 'current'
          ? part.outline
          : mode === 'mixed'
            ? index % 2 === 0
            : mode,
    }));
    const module = new Type({ model: Type.createModel({ ...spec, model }) });
    const craft = new Craft(
      { shades: colors.cyan },
      {
        hullSegments: [
          {
            health: 10,
            points: [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
            ],
            mounts: [[{ x: 0, y: 10, fits: [id] }]],
          },
        ],
      },
    );
    craft.fit(module);
    const parts = craft.segments.filter(
      (segment) =>
        segment.module === module &&
        !(module instanceof SearchLight && segment.beam !== false),
    );
    assert.equal(
      parts.length,
      model.length,
      'each spec part retains one runtime segment',
    );
    parts.forEach((segment, index) => {
      if (segment.catches) return;
      segment.activationProgress = 0.75;
      segment.phase = 0.25;
      const beforeDraw = draws.length;
      const beforeStroke = strokePaths.length;
      module.render({ segment, craft, scenery: [] });
      const fill = draws[beforeDraw];
      assert(fill, 'each visible model part draws its fill');
      if (model[index].outline)
        assert.equal(
          strokePaths[beforeStroke],
          fill.path,
          'outlined parts stroke their silhouette',
        );
      else
        assert.deepEqual(
          Reflect.get(strokePaths[beforeStroke], 'vertices'),
          [],
          'fill-only parts leave their silhouette unstroked',
        );
      const appearance = {
        fill: fill.style,
        points: Reflect.get(fill.path, 'vertices'),
        radius: segment.radius?.(segment),
        markings: strokePaths
          .slice(beforeStroke + draws.length - beforeDraw)
          .map((path) => Reflect.get(path, 'vertices')),
      };
      if (mode === 'current') fillsByPart.set(index, appearance);
      else
        assert.deepEqual(
          appearance,
          fillsByPart.get(index),
          'outline selection preserves geometry, fill, and animated markings',
        );
    });
  }
}
// Both outline choices survive detachment, replication, and prediction cloning.
const mixedWorld = createWorld();
const mixedShip = addEntity(mixedWorld, createPlayerShip(mixedWorld));
const mixedSpec = {
  ...moduleSpecs.autogun,
  model: moduleSpecs.autogun.model.map((part, index) => ({
    ...part,
    outline: index % 2 === 0,
  })),
};
const mixedGun = new Autogun({ model: Autogun.createModel(mixedSpec) });
mixedShip.fit(
  mixedGun,
  mixedShip.mounts.find((mount) => mount.fits.includes(Autogun)),
);
{
  const parts = mixedShip.segmentsAtMount(mixedGun.mount);
  const barrels = () => {
    const before = draws.length;
    parts.slice(0, 2).forEach((segment) => mixedGun.render({ segment }));
    return draws.slice(before).map(({ path }) => Reflect.get(path, 'vertices'));
  };
  const centers = (shapes) => shapes.map(
    (points) => points.reduce((sum, [, y]) => sum + y, 0) / points.length,
  );
  const initial = centers(barrels());
  assert.equal(initial.length, 4, 'the bundle renders four barrels');
  assert.equal(
    new Set(initial.map((y) => y.toFixed(6))).size,
    2,
    'the initial view stacks the lower pair underneath the upper pair',
  );
  mixedShip.updateVisual(mixedGun.fireInterval / 4);
  assert.deepEqual(centers(barrels()), initial, 'retracted barrels stay still');
  mixedShip.setModuleActive({ module: Autogun, active: true });
  mixedShip.updateModules(mixedGun.activationDuration + mixedGun.chargeDuration);
  mixedShip.updateVisual(mixedGun.fireInterval / 4);
  assert.notDeepEqual(centers(barrels()), initial, 'deployed idle barrels keep spinning');
  mixedShip.updateVisual(mixedGun.fireInterval * 4 - mixedGun.fireInterval / 4);
  centers(barrels()).forEach((y, index) => assert(Math.abs(y - initial[index]) < 1e-9));
  for (const cooldown of [mixedGun.fireInterval, mixedGun.fireInterval / 2, 1e-10]) {
    mixedGun.fireCooldown = cooldown;
    const shapes = centers(barrels());
    if (cooldown === mixedGun.fireInterval || cooldown === 1e-10)
      assert(
        Math.abs(shapes.at(-1)) < 1e-8,
        'the upper firing barrel is centered at each end of the shot interval',
      );
    else
      assert(Math.abs(shapes.at(-1)) > 1e-8, 'the bundle rotates between shots');
  }
  mixedGun.fireCooldown = 0;
}
mixedShip.detach(mixedGun.mount);
const mixedDebris = [...mixedWorld.entities.values()].find(
  (entity) => entity !== mixedShip && entity.decay,
);
const mixedReplica = createWreckage({
  properties: { decay: mixedDebris.decay, shades: mixedDebris.shades },
  segments: mixedDebris.wreckage,
});
for (const fragment of [
  mixedDebris,
  mixedReplica,
  cloneEntity({ entity: mixedDebris }),
  cloneEntity({ entity: mixedReplica }),
]) {
  assert.equal(fragment.wreckage.length, mixedSpec.model.length);
  fragment.wreckage.forEach((part, index) => {
    if (mixedSpec.model[index].outline)
      assert.equal(
        part.stroke,
        undefined,
        'outlined wreckage retains its silhouette stroke',
      );
    else
      assert.deepEqual(
        part.stroke,
        [],
        'fill-only wreckage keeps its empty stroke',
      );
  });
}
let revealed = 0;
const litRock = {
  scenery: true,
  segments: [{}],
  position: Vec.add(remote.position, Vec.create(60)),
  rotation: 0,
  radius: 20,
  shapeOutline: [
    [-20, -20],
    [20, -20],
    [20, 20],
    [-20, 20],
  ],
  renderContents: [
    {
      render() {
        revealed++;
      },
    },
  ],
};
const remotePose = { position: Vec.create(900, 800), rotation: 0.3 };
const remotePrediction = cloneEntity({ entity: remote });
const predictedLamp = remotePrediction.segments.find(
  (segment) => segment.module instanceof SearchLight,
);
const remoteLamp = remote.segments.find(
  (segment) => segment.module instanceof SearchLight,
);
const reveal = () =>
  revealBuriedItems({
    sprites: [remote, litRock],
    predicted: new Map([[remote.id, remotePrediction]]),
    poses: new Map([[remote.id, remotePose]]),
  });
transforms.length = 0;
const clipsBefore = clips;
reveal();
assert.equal(revealed, 1, 'an active remote lamp reveals buried cargo');
assert.equal(
  clips - clipsBefore,
  2,
  'the cargo is clipped to the remote beam and rock slice',
);
assert.deepEqual(
  transforms[0],
  [900, 800],
  'the remote light uses its displayed pose',
);
predictedLamp.activationProgress = 0;
reveal();
assert.equal(
  revealed,
  1,
  'the predicted lamp state controls remote cargo reveal',
);
remoteLamp.activationProgress = 0;
predictedLamp.activationProgress = 1;
reveal();
assert.equal(
  revealed,
  2,
  'predicted light can reveal cargo while the base sprite is stale',
);
const before = gradients;
// Global layers must put either ship's horn drill behind both hulls, irrespective
// of the order the two craft entered the renderer.
const drilling = cloneEntity({ entity: remote });
drilling.segments = drilling.segments.filter(
  (segment) => segment.hull || segment.module instanceof HornDrill,
);
const receiving = new Ship({ shades: colors.cyan });
const hornDrillSegment = drilling.segments.find(
  (segment) => segment.module instanceof HornDrill,
);
const hullSegment = receiving.segments.find(
  (segment) => segment.hull && Array.isArray(segment.points),
);
assert(
  hornDrillSegment.zIndex < hullSegment.zIndex,
  'the horn drill belongs below the hull layer',
);
for (const craftOrder of [
  [drilling, receiving],
  [receiving, drilling],
]) {
  draws.length = 0;
  for (const zIndex of [
    renderingLayers.modulesBelowShipHull,
    renderingLayers.shipHull,
    renderingLayers.modulesAboveShipHull,
  ])
    for (const craft of craftOrder) craft.render({ zIndex });
  const hornDrillIndex = draws.findIndex(
    (draw) =>
      JSON.stringify(Reflect.get(draw.path, 'vertices')) ===
      JSON.stringify(hornDrillSegment.points),
  );
  const hullIndex = draws.findIndex(
    (draw) =>
      JSON.stringify(Reflect.get(draw.path, 'vertices')) ===
      JSON.stringify(hullSegment.points),
  );
  assert(
    hornDrillIndex >= 0 && hullIndex > hornDrillIndex,
    'overlapping hulls cover the horn drill in either craft order',
  );
}
station.render({ zIndex: renderingLayers.stationHull });
assert(gradients > before, 'station hulls retain gradient shading');
// Both translucent bay halves must cover the lower glow and sit below the upper
// glow. Drawing a glow between their fills makes a brightness seam.
draws.length = 0;
const beforeBayGlows = glowImages;
// Warm the docking glow before cloning, as rendering does between network ticks.
for (const zIndex of Object.values(renderingLayers)) {
  const beforeGlow = glowImages;
  station.render({ zIndex });
  const expected = Number(
    zIndex === renderingLayers.stationFloor ||
      zIndex === renderingLayers.glowAboveStations,
  );
  assert.equal(
    glowImages - beforeGlow,
    expected,
    'station bay glows draw once below the floor and above the ceiling',
  );
}
const bayFills = draws.filter((draw) =>
  station.segments.some(
    (segment) =>
      segment.glow &&
      JSON.stringify(segment.points) ===
        JSON.stringify(Reflect.get(draw.path, 'vertices')),
  ),
);
assert.equal(bayFills.length, 2, 'both bay halves render');
assert(
  bayFills.every((draw) => draw.glowImages === beforeBayGlows + 1),
  'both bay fills must render between the same two glows to avoid a brightness seam',
);
const predictedStation = cloneEntity({ entity: station });
for (const zIndex of [
  renderingLayers.stationFloor,
  renderingLayers.glowAboveStations,
])
  predictedStation.render({ zIndex });
const stationGlow = station.segments.find((segment) => segment.glow).glow;
assert.equal(
  predictedStation.segments.find((segment) => segment.glow).glow,
  stationGlow,
  'prediction shares the immutable glow spec and its render cache',
);
game.scale = 2;
for (const craft of [predictedStation, station])
  for (const zIndex of [
    renderingLayers.stationFloor,
    renderingLayers.glowAboveStations,
  ])
    craft.render({ zIndex });
game.scale = 1;
for (const segment of station.segments.filter((segment) => segment.glow)) {
  const health = segment.health;
  segment.health = 0;
  const beforeGlow = glowImages;
  for (const zIndex of [
    renderingLayers.stationFloor,
    renderingLayers.glowAboveStations,
  ])
    station.render({ zIndex });
  assert.equal(
    glowImages - beforeGlow,
    1,
    'destroyed bay segments stop drawing their glow',
  );
  segment.health = health;
}

const wreckage = createWreckage({
  properties: { shades: colors.cyan, decay: 1 },
  segments: [
    {
      shapeOutline: [
        [0, 0],
        [20, 0],
        [0, 20],
      ],
      radius: 20,
      offset: Vec.create(),
      health: 2,
      fillShade: 2,
    },
  ],
});
draws.length = 0;
const beforeWreck = gradients;
for (const zIndex of new Set(
  wreckage.segments.map((segment) => segment.zIndex),
))
  wreckage.render({ zIndex });
assert(draws.length > 0, 'bare Craft wreckage retains its own hull rendering');
assert(
  draws.some((draw) => draw.style === colors.cyan[2]),
  'detached wreckage keeps its light fill shade',
);
assert.equal(
  gradients,
  beforeWreck,
  'wreckage does not inherit station gradients',
);

for (const Weapon of [PlasmaAccelerator, Autogun])
  for (const side of [-1, 1]) {
    const weaponWorld = createWorld();
    const weaponShip = addEntity(weaponWorld, createPlayerShip(weaponWorld));
    const mount = weaponShip.mounts.find(
      (mount) =>
        mount.fits.includes(Weapon) && mount.localPosition.y * side > 0,
    );
    const gun = new Weapon();
    weaponShip.fit(gun, mount);
    weaponShip.detach(mount);
    const debris = [...weaponWorld.entities.values()].find(
      (entity) => entity !== weaponShip && entity.decay,
    );
    const replicated = createWreckage({
      properties: { decay: debris.decay, shades: debris.shades },
      segments: debris.wreckage,
    });
    for (const fragment of [
      debris,
      cloneEntity({ entity: debris }),
      replicated,
      cloneEntity({ entity: replicated }),
    ]) {
      assert(
        fragment.wreckage.every(
          (segment) =>
            Array.isArray(segment.stroke) && segment.stroke.length === 0,
        ),
        'weapon wreckage preserves its empty stroke',
      );
      draws.length = 0;
      const beforeStroke = strokePaths.length;
      for (const zIndex of Object.values(renderingLayers))
        fragment.render({ zIndex });
      assert.equal(
        draws.length,
        gun.model.length,
        'all detached weapon parts render',
      );
      assert(
        fragment.segments.every((segment, index) => segment.fillShade === gun.model[index].fillShade),
        'weapon wreckage retains its painted fill colours',
      );
      assert(
        strokePaths
          .slice(beforeStroke)
          .every((path) => Reflect.get(path, 'vertices').length === 0),
        'detached weapon strokes contain no visible outline',
      );
    }
  }
const diamond = new Item(diamondSpec);
// A destroyed lamp retains its module spec and warmed beam cache in the
// local fragment. Render that fragment as fixed wreckage through every path.
for (const active of [false, true])
  for (const destruction of ['detach', 'health']) {
    const lightWorld = createWorld();
    const lightShip = addEntity(
      lightWorld,
      createPlayerShip(lightWorld, { shades: colors.cyan }),
    );
    lightShip.setModuleActive({ module: SearchLight, active });
    lightShip.updateModules(1);
    const detachedLight = lightShip.modules.find(
      (module) => module instanceof SearchLight,
    );
    const lamp = lightShip.segments.find(
      (segment) => segment.module === detachedLight,
    );
    for (const zIndex of Object.values(renderingLayers))
      lightShip.render({ zIndex, scenery: [litRock] });
    assert.equal(
      Boolean(lamp.prism),
      active,
      'active lights warm their beam cache before destruction',
    );
    const lightCheckpoint = captureWorld({ world: lightWorld });
    if (destruction === 'health') {
      detachedLight.mount.health = 0;
      lightShip.update(0);
    } else lightShip.detach(detachedLight.mount);
    assert(
      !lightShip.modules.includes(detachedLight),
      'destroyed lights leave the surviving ship',
    );
    const lightDebris = [...lightWorld.entities.values()].find(
      (entity) => entity !== lightShip && entity.decay,
    );
    assert(
      lightDebris instanceof Craft && !(lightDebris instanceof Ship),
      'a detached light is bare Craft wreckage',
    );
    assert(
      lightDebris.segments.some((segment) => segment.module === detachedLight),
      'local wreckage retains the former light spec',
    );
    const replicatedDebris = createWreckage({
      properties: {
        id: lightDebris.id,
        decay: lightDebris.decay,
        shades: lightDebris.shades,
        position: Vec.clone(lightDebris.position),
      },
      segments: lightDebris.wreckage,
    });
    for (const fragment of [
      lightDebris,
      cloneEntity({ entity: lightDebris }),
      replicatedDebris,
      cloneEntity({ entity: replicatedDebris }),
    ]) {
      const beforeBeam = gradients;
      draws.length = 0;
      for (const zIndex of Object.values(renderingLayers))
        fragment.render({ zIndex, scenery: [litRock] });
      assert.equal(
        gradients,
        beforeBeam,
        'destroyed lights never project beams, including after replication and prediction cloning',
      );
      assert(
        draws.length > 0,
        'destroyed lights still draw their fixed debris geometry',
      );
      const beforeReveal = revealed;
      revealBuriedItems({
        sprites: [fragment, litRock],
        predicted: new Map([[fragment.id, cloneEntity({ entity: fragment })]]),
        poses: new Map(),
      });
      assert.equal(
        revealed,
        beforeReveal,
        'destroyed lights do not reveal buried cargo',
      );
    }
    restoreWorld({ world: lightWorld, state: lightCheckpoint });
    assert(
      !lightWorld.entities.has(lightDebris.id),
      'rollback removes speculative light wreckage',
    );
    assert(
      lightShip.modules.includes(detachedLight),
      'rollback restores the original light instance',
    );
    assert(
      lightShip.segments.every((segment) => segment.module),
      'rollback restores every segment module',
    );
    for (const restored of [lightShip, cloneEntity({ entity: lightShip })]) {
      for (const zIndex of Object.values(renderingLayers))
        restored.render({ zIndex, scenery: [litRock] });
    }
  }
draws.length = 0;
diamond.render();
assert(draws.length > 0, 'concrete items inherit the Item renderer');
assert.equal(saves, 0, 'parent renderers balance all canvas state');
for (const [index, stage] of packet.drillingStages.entries()) {
  const entities = stage.map((entity) => makeEntity({ entity, world }));
  assert(
    !entities.some((entity) => entity instanceof Craft),
    'drilled loot must never hydrate as a ship or wreck',
  );
  const rocks = entities.filter((entity) => entity instanceof Asteroid);
  assert.equal(
    rocks.length,
    index === 0 ? 2 : 1,
    'split replaces the parent with an arm and remainder',
  );
  for (const asteroid of rocks) {
    assert.equal(
      asteroid.resource,
      1,
      'every descendant retains its purple material',
    );
    const predicted = cloneEntity({ entity: asteroid });
    predicted.resource = undefined;
    applyEntity({ entity: predicted, server: asteroid });
    assert.equal(
      predicted.resource,
      1,
      'reconciliation restores asteroid material',
    );
    predicted.addToScene();
    draws.length = 0;
    strokes.length = 0;
    predicted.render();
    assert.equal(draws[0].style, '#22113399');
    assert.equal(strokes[0], colors.violet[2]);
    assert.equal(
      predicted.renderContents.length,
      predicted.contents.length,
      'cargo stays visible in a detached leaf',
    );
    const origin = Vec.add(predicted.position, Vec.create());
    const cargoPositions = predicted.renderContents.map((item) =>
      Vec.add(item.position, Vec.create()),
    );
    const offset = Vec.create(123, 456);
    predicted.render({
      pose: {
        position: Vec.add(origin, offset),
        rotation: predicted.rotation + Math.PI / 2,
      },
    });
    predicted.renderContents.forEach((item, index) => {
      const relative = Vec.subtract(cargoPositions[index], origin);
      const expected = Vec.add(
        Vec.add(origin, offset),
        Vec.create(-relative.y, relative.x),
      );
      assert(
        Vec.distance(item.position, expected) < 1e-8,
        'buried cargo follows the same interpolated pose as its asteroid',
      );
    });
    assert(
      Vec.distance(predicted.position, origin) < 1e-8,
      'render poses do not change asteroid physics',
    );
  }
  if (index === 1) {
    const loot = entities.filter(
      (entity) => entity instanceof Item && entity.resource === 1,
    );
    assert.equal(
      loot.length,
      1,
      'destroying the arm releases an amethyst, not a Ship',
    );
    assert.equal(loot[0].velocity.x, 5);
    assert.equal(loot[0].velocity.y, 2);
  }
}
const panelShip = cloneEntity({ entity: remote });
transforms.length = 0;
strokes.length = 0;
renderControls(game, panelShip);
const panelPositions = structuredClone(transforms),
  panelStrokes = [...strokes];
panelShip.mounts.push(
  { module: new PlasmaAccelerator() },
  { module: new Autogun() },
);
transforms.length = 0;
strokes.length = 0;
renderControls(game, panelShip);
assert.deepEqual(
  strokes,
  panelStrokes,
  'fitted weapons add no controls panel labels or checkboxes',
);
assert.deepEqual(
  transforms,
  panelPositions,
  'weapons do not change the controls panel layout',
);
for (const direct of [false, true]) {
  const miningWorld = createWorld();
  const rock = addEntity(
    miningWorld,
    createAsteroid(miningWorld, {
      id: 73,
      radius: 57,
      contents: [0, 1, 2, 3, 4, 5],
      rotation: 0.71,
      spin: 0.18,
      position: Vec.create(17, -23),
    }),
  );
  rock.render();
  const buried = rock.renderContents.map((item) => ({
    resource: item.resource,
    position: Vec.clone(item.position),
    rotation: item.rotation,
  }));
  let rocks = [rock];
  if (!direct) {
    for (let split = 0; split < 3; split++) {
      const parent = rocks.find((rock) => rock.segments?.length > 1);
      const children = parent.detach({
        asteroidSegment:
          parent.segments.find((segment) => segment.contents.length) ||
          parent.segments[0],
        world: miningWorld,
      });
      rocks = rocks.filter((rock) => rock !== parent).concat(children);
      for (const child of children) {
        child.render();
        for (const item of child.renderContents) {
          const original = buried.find(
            (candidate) =>
              candidate.resource === item.resource &&
              Vec.distance(candidate.position, item.position) < 1e-6,
          );
          assert(original, 'split items retain their world position');
          assert(
            Math.abs(Math.sin((item.rotation - original.rotation) / 2)) < 1e-7,
            'split items retain their world angle across repeated splits',
          );
        }
      }
    }
  }
  for (const chunk of rocks) {
    chunk.rotation += 0.43;
    chunk.render();
    const before = chunk.renderContents.map((item) => ({
      resource: item.resource,
      position: Vec.clone(item.position),
      rotation: item.rotation,
    }));
    const checkpoint = captureWorld({ world: miningWorld });
    const release = () => {
      chunk.health = 0;
      chunk.fracture({ by: 1, events: [], world: miningWorld });
      return [...miningWorld.entities.values()].filter(
        (entity) =>
          entity instanceof Item &&
          before.some(
            (item) => Vec.distance(item.position, entity.position) < 1e-6,
          ),
      );
    };
    const drops = release();
    assert.equal(drops.length, before.length);
    drops.forEach((item, index) => {
      assert.equal(item.resource, before[index].resource);
      assert(
        Vec.distance(item.position, before[index].position) < 1e-7,
        'released items keep the rendered position',
      );
      assert.equal(
        item.rotation,
        before[index].rotation,
        'released items keep the rendered rotation',
      );
      assert(
        item.spin !== chunk.spin && Math.abs(item.spin - chunk.spin) <= 0.25,
        'release adds a small spin to inherited motion',
      );
    });
    const spins = drops.map((item) => item.spin);
    restoreWorld({ world: miningWorld, state: checkpoint });
    assert.deepEqual(
      release().map((item) => item.spin),
      spins,
      'rollback reproduces release spin',
    );
  }
}
const holeWorld = createWorld();
const solid = addEntity(
  holeWorld,
  createAsteroid(holeWorld, { radius: 150, pointCount: 7 }),
);
const pieces = solid.detach({
  asteroidSegment: solid.segments[0],
  world: holeWorld,
});
const remainder = pieces.find((piece) => piece.segments?.length);
const predictedRemainder = cloneEntity({ entity: remainder });
applyEntity({ entity: predictedRemainder, server: remainder });
assert.equal(
  predictedRemainder.segments[0].shapeOutline.edges,
  undefined,
  'prediction copies polygon points without cached edge marks',
);
predictedRemainder.addToScene();
draws.length = 0;
predictedRemainder.render();
const painted = draws[0];
const area = (shapeOutline) =>
  Math.abs(
    shapeOutline.reduce((sum, [x, y], index) => {
      const [nextX, nextY] = shapeOutline[(index + 1) % shapeOutline.length];
      return sum + x * nextY - nextX * y;
    }, 0),
  ) / 2;
const ringAreas = Reflect.get(painted.path, 'contours')
  .map(area)
  .sort((a, b) => b - a);
assert.equal(painted.rule, 'evenodd', 'asteroid fill handles interior holes');
assert.equal(
  ringAreas.length,
  2,
  'the renderer draws the outer edge and the drilled hole',
);
assert(
  Math.abs(
    ringAreas[0] -
      ringAreas[1] -
      remainder.segments.reduce(
        (sum, segment) => sum + area(segment.shapeOutline),
        0,
      ),
  ) < 1e-8,
  'rendered rock area equals the remaining segments',
);
console.log(
  'Replicated flares, light beams, module checkboxes, palettes, render inheritance and asteroid holes passed',
);
`;

// Private fields enforce canvas receiver identity, like the browser's DOM getters.
class TestCanvas {
  #width = 0;

  getContext() {
    return { translate() {}, scale() {}, fill() {} };
  }

  get width() {
    return this.#width;
  }

  set width(value: number) {
    this.#width = value;
  }
}

Object.assign(globalThis, {
  document: {
    createElement: () => new TestCanvas(),
    getElementById: () => null as null,
  },
});

Object.assign(globalThis, { canvas: { getContext: () => ({}) } });

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
});

Object.assign(globalThis, { WebSocket: class {} });

Object.assign(globalThis, {
  localStorage: {
    getItem: () => null as null,
  },
});

Object.assign(globalThis, { sounds: [] });

Object.assign(globalThis, {
  Path2D: class {
    declare current: number[][];
    declare vertices: number[][];
    declare contours: number[][][];

    addPath(other: { contours: number[][][]; vertices: number[][] }) {
      this.contours.push(
        ...other.contours.map((contour) => contour.map((point) => [...point])),
      );
      this.vertices.push(...other.vertices.map((point) => [...point]));
      this.current = undefined as number[][] | undefined;
    }

    arc() {}

    closePath() {
      this.current = undefined as number[][] | undefined;
    }

    constructor() {
      this.vertices = [] as number[][];
      this.contours = [] as number[][][];
      this.current = undefined as number[][] | undefined;
    }

    lineTo(x: number, y: number) {
      if (!this.current) {
        this.current = [];
        this.contours.push(this.current);
      }

      this.current.push([x, y]);
      this.vertices.push([x, y]);
    }

    moveTo(x: number, y: number) {
      this.current = [];
      this.contours.push(this.current);
      this.lineTo(x, y);
    }

    rect() {}
  },
});

const fixture = readFileSync('tests/fixtures/rendering.json', 'utf8');

Object.assign(globalThis, { packet: fixture });

for (const production of [false, true]) {
  const entry = production ? `${root}/src/__render-test.ts` : 'render-test';
  // The fixed fixture and its consumers share one production property map.
  const source = production
    ? scenario.replace("JSON.parse(Reflect.get(globalThis, 'packet'))", fixture)
    : scenario;

  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'render-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load(id: string) {
          if (id.endsWith('/src/client/audio/sound-loader.ts')) {
            return "export const playSound=value=>Reflect.get(globalThis, 'sounds').push(value);export const continuousSound=()=>undefined;export const unlockAudio=()=>{};export const updateThrusterSound=()=>{};";
          }

          if (id === entry) {
            return production
              ? stripIfdef(
                  source.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : source;
          }
        },
        transform(code: string, id: string) {
          if (id.endsWith('/src/client/network/network.ts')) {
            return code + '\nexport {makeEntity};';
          }

          if (id.endsWith('/src/client/prediction/prediction.ts')) {
            return code + '\nexport {applyEntity};';
          }
        },
      },
      buildPrePlugin({ DEBUG: !production }),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  const code = output[0].code;

  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
