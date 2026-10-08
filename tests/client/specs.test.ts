import { moduleSpecForSimulation } from '../../src/client/utilities/module-spec';
import assert from 'node:assert/strict';
import { itemTypes, diamond } from '../../src/specs/items';
import { itemDefaults } from '../../src/specs/items/defaults';
import type { ItemSpec } from '../../src/specs/items/types';
import { defaultFriction } from '../../src/specs/game-object';
import { moduleIds, moduleSpecList } from '../../src/specs/modules';
import { mustang, shipSpecsById, type ShipId } from '../../src/specs/ships';
import {
  corral5,
  corral6,
  stationSpecsById,
  type StationId,
} from '../../src/specs/stations';
import { Item } from '../../src/client/objects/item';
import {
  createShip,
  createPlayerShip,
} from '../../src/client/objects/create-ship';
import { Station } from '../../src/client/objects/station';
import { Ship } from '../../src/client/objects/ship';
import { CargoHatch } from '../../src/client/objects/modules/cargo-hatch';
import {
  Autogun,
  PlasmaAccelerator,
} from '../../src/client/objects/modules/weapon';
import { EntityState } from '../../src/client/simulation/entity-state';
import type { MountPointSpec } from '../../src/specs/mounts';
import {
  moduleTypes,
  moduleTypesById,
  thrusters,
} from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { cloneEntity } from '../../src/client/simulation/world-state';
import * as Vec from '../../src/client/utilities/vector';

assert.deepEqual(
  itemTypes.map((item) => item.resource),
  [0, 1, 2, 3, 4, 5],
);

for (const spec of itemTypes as readonly ItemSpec[]) {
  const item = new Item(spec);

  for (const [name, value] of Object.entries(itemDefaults)) {
    if (name !== 'radius') assert.equal(item[name], value);
  }

  assert.equal(item.friction, defaultFriction);
  assert.equal(item.resource, spec.resource);
  assert.equal(item.name, spec.name);
  assert.equal(item.price, spec.price);
  assert.equal(item.unlock, spec.unlock);
  assert.deepEqual(item.shapeOutline, spec.points);
  const radius = spec.points
    ? Math.max(...spec.points.map(([x, y]) => Math.hypot(x, y)))
    : (spec.radius ?? itemDefaults.radius);

  assert(Math.abs(item.radius - radius) <= 2e-8);

  const properties = {
    id: 100 + spec.resource,
    position: Vec.create(-2, 9),
    velocity: Vec.create(1, 2),
    mass: 12,
    health: 0.5,
    angularDrag: 0.25,
    radius: 8,
  };

  const overridden = new Item(spec, properties);

  for (const [name, value] of Object.entries(properties)) {
    if (name !== 'radius') assert.deepEqual(overridden[name], value);
  }

  assert(
    Math.abs(overridden.radius - (spec.points ? radius : properties.radius)) <=
      2e-8,
  );
  const [body, pickup] = overridden.hitbox();

  assert.equal(body.radius, overridden.radius);
  assert.equal(body.physics, true);
  assert.equal(body.bounciness, itemDefaults.bounciness);
  assert.equal(pickup.physics, false);
  assert.equal(pickup.pickupPoint, true);
  assert.equal(pickup.radius, 0);
  assert(pickup.contactFilter);
  assert.equal(pickup.contactFilter(pickup, body), false);
  assert.equal(
    pickup.contactFilter(pickup, { ...body, role: 'cargoHatch' }),
    true,
  );
}

assert.equal(moduleTypes.length, moduleIds.length);

moduleSpecList.forEach((spec, index) => {
  const Type = moduleTypes[index];
  const module = new Type();

  assert.equal(Type.definitionId, moduleIds[index]);
  assert.equal(module.name, spec.name);
  assert.equal(module.label, undefined);
  assert.equal(module.health, spec.health);
  assert.equal(module.price, spec.price);

  for (const [name, value] of Object.entries(moduleSpecForSimulation(spec))) {
    if (name !== 'model') assert.deepEqual(module[name], value);
  }

  const overridden = new Type({ health: 12, price: 34 });

  assert.equal(overridden.health, 12);
  assert.equal(overridden.price, 34);
  assert.equal(overridden.model, module.model);
});

assert.equal(thrusters.length, 8);

// Prediction may have destroyed a different mounting hull before reconciliation.
// Both histories must hydrate the same mount indexes from authoritative state.
for (const shipType of shipSpecsById.keys()) {
  const world = createWorld();
  const authority = createShip(world, { shipType });
  const predicted = createShip(world, { shipType });
  const fullHealth = authority.hullHealth;
  const mounted = authority.segments.filter(
    (segment) => segment.hull && segment.mounts?.length,
  );

  if (mounted.length < 2) continue;
  const planIndexes = mounted
    .slice(0, 2)
    .map((segment) => authority.hullSegments.indexOf(segment.module));

  authority.hullHealth = fullHealth.map((health, index) =>
    index === planIndexes[0] ? 0 : health,
  );

  predicted.hullHealth = fullHealth.map((health, index) =>
    index === planIndexes[1] ? 0 : health,
  );
  predicted.hullHealth = authority.hullHealth;

  assert.doesNotThrow(() => {
    predicted.moduleStates = authority.moduleStates;
  }, 'reconciliation preserves compatible mounts');

  assert.deepEqual(predicted.moduleStates, authority.moduleStates);
  authority.hullHealth = fullHealth;

  const repaired = createShip(world, { shipType });

  assert.deepEqual(
    authority.mounts.map((mount) => mount.fits),
    repaired.mounts.map((mount) => mount.fits),
    'repairs restore canonical mount order',
  );
}

const item = new Item(diamond, { health: 10 });
const copy = cloneEntity({ entity: item });

assert.equal(
  copy.item,
  diamond,
  'prediction retains spec identity used by cargo grouping',
);
copy.health = 1;
assert.equal(copy.name, 'Diamond', 'prediction retains the item display name');
assert.equal(item.health, 10, 'cloned mechanics remain independent');

const shipId = 'testScout' as ShipId;
const stationId = 'testDepot' as StationId;

const previewShip = new Ship({
  shipType: shipId,
  spec: { ...mustang, cargoSpace: 25 },
});

const previewStation = new Station({
  stationType: stationId,
  spec: { ...corral5, localMovementRadius: 750 },
});

assert.equal(previewShip.cargoSpace, 25);
assert.equal(previewShip.name, 'Mustang');
assert.equal(previewStation.localMovementRadius, 750);
assert.equal(
  shipSpecsById.has(shipId),
  false,
  'direct specs need no game registration',
);
assert.equal(stationSpecsById.has(stationId), false);
const Engine = moduleTypesById.get('thrusterSingleMd')!;
const engineMount = previewShip.mounts.find((mount) =>
  mount.fits.includes(Engine),
);

assert(engineMount, 'direct ship specs convert module IDs to real classes');
previewShip.fit(new Engine(), engineMount);
assert.equal(previewShip.modules.length, 1);
assert.notEqual(previewShip.mounts[0], mustang.hullSegments[1].mounts[0]);

const mountPoints: MountPointSpec[] = [
  { x: 3, y: -29, fits: ['cargoHatch'] },
  { x: 9, y: -6, fits: ['autogun'] },
  { x: 21, y: -8, fits: ['plasmaAccelerator'] },
];

const hullSegments = [
  {
    health: 100,
    points: [
      [-30, -30],
      [30, -30],
      [30, 30],
      [-30, 30],
    ],
    mounts: [mountPoints],
  },
];

for (const craft of [
  new Ship({ spec: { ...mustang, hullSegments } }),
  new Station({ spec: { ...corral5, hullSegments } }),
]) {
  const mount = craft.mounts[0];
  const hatch = new CargoHatch();

  assert.equal(
    craft.mounts.length,
    1,
    'coordinate groups share one mount slot',
  );
  craft.fit(hatch);
  assert.equal(mount.module, hatch, 'automatic fitting checks every group');
  assert.deepEqual(mount.localPosition, Vec.create(3, -29));
  assert(
    craft
      .segmentsAtMount(mount)
      .every((segment) => segment.localPosition.y === -13),
  );
  const checkpoint = new EntityState(craft);
  const cannon = new Autogun();

  craft.fit(cannon, mount);
  assert.deepEqual(mount.localPosition, Vec.create(9, -6));
  assert(
    craft
      .segmentsAtMount(mount)
      .every(
        (segment) =>
          segment.localPosition.x === 9 && segment.localPosition.y === -6,
      ),
  );
  const states = craft.moduleStates;

  craft.fit(0, mount);
  craft.moduleStates = states;
  assert.deepEqual(
    mount.localPosition,
    Vec.create(9, -6),
    'restored modules select their coordinates',
  );
  checkpoint.restore();
  assert.equal(mount.module, hatch);
  assert.deepEqual(
    mount.localPosition,
    Vec.create(3, -29),
    'rollback restores the mount position',
  );
  const plasma = new PlasmaAccelerator();

  craft.fit(plasma, mount);
  assert.deepEqual(mount.localPosition, Vec.create(21, -8));
  assert(
    craft
      .segmentsAtMount(mount)
      .every(
        (segment) =>
          segment.localPosition.x === 21 && segment.localPosition.y === -8,
      ),
  );
  const copy = cloneEntity({ entity: craft }) as Ship;

  copy.fit(new CargoHatch(), copy.mounts[0]);
  assert.deepEqual(
    mount.localPosition,
    Vec.create(21, -8),
    'cloned fittings are independent',
  );
  assert.deepEqual(
    mountPoints[1],
    { x: 9, y: -6, fits: ['autogun'] },
    'fitting leaves specs unchanged',
  );
}

shipSpecsById.set(shipId, { ...mustang, cargoSpace: 20 });
stationSpecsById.set(stationId, { ...corral5, localMovementRadius: 900 });

try {
  const world = createWorld();

  assert.equal(createShip(world, { shipType: shipId }).modules.length, 0);
  assert.equal(
    createShip(world, { shipType: shipId, playerId: 1 }).modules.length,
    0,
  );
  const first = createPlayerShip(world, { shipType: shipId });
  const second = createPlayerShip(world, { shipType: shipId });

  assert(!Object.hasOwn(first, 'credits'));
  assert(!Object.hasOwn(first, 'startingCredits'));
  assert.equal(first.definitionId, shipId);
  assert.equal(first.cargoSpace, 20);
  assert.equal(first.modules.length, mustang.initialLoadout.length);
  first.mounts[0].health = 0;
  first.cargoContents.push(item);
  assert((second.mounts[0].health ?? 0) > 0, 'ships own their mount health');
  assert.equal(second.cargoContents.length, 0, 'ships own their cargo');
  assert.notEqual(
    first.modules[0],
    second.modules[0],
    'ships own their equipment',
  );
  const station = new Station({ stationType: stationId });

  assert.equal(station.definitionId, stationId);
  assert.equal(station.localMovementRadius, 900);
  assert(station.segments.some((segment) => segment.dockSegment));
} finally {
  shipSpecsById.delete(shipId);
  stationSpecsById.delete(stationId);
}

console.log(
  'Spec registries, generic content construction and independent instance state passed',
);

const arrowShip = createPlayerShip(createWorld(), { shipType: 'arrow' });

assert.equal(arrowShip.modules.length, 3);
assert.deepEqual(
  arrowShip.mounts.flatMap((mount) =>
    mount.module instanceof CargoHatch ? [mount.localPosition] : [],
  ),
  [Vec.create(-9, -24), Vec.create(-9, 24)],
);
assert(arrowShip.mounts[2].module);
assert.equal(arrowShip.mounts[2].module.definitionId, 'thrusterSingleMd');
assert.equal(
  createShip(createWorld(), { shipType: 'arrow' }).modules.length,
  0,
);

// Mount spacing belongs to the ship, even when the same module is refitted.
for (const id of ['thrusterDualMd', 'thrusterDualLg'] as const) {
  const world = createWorld();
  const wideShip = createPlayerShip(world, { shipType: 'crotus' });
  const standardShip = createShip(world);
  const thruster = new (moduleTypesById.get(id)!)();
  const wideMount = wideShip.mounts[2];
  const standardMount = standardShip.mounts[1];
  const offset = thruster.offset!;

  wideShip.fit(thruster, wideMount);
  assert.deepEqual(
    wideShip
      .segmentsAtMount(wideMount)
      .map((segment) => segment.localPosition.y),
    [-offset - 8, offset + 8],
  );
  standardShip.fit(thruster, standardMount);
  assert.deepEqual(
    standardShip
      .segmentsAtMount(standardMount)
      .map((segment) => segment.localPosition.y),
    [-offset, offset],
  );
  assert.equal(
    thruster.offset,
    offset,
    'fitting must not change the module offset',
  );
}

const crotusShip = createPlayerShip(createWorld(), { shipType: 'crotus' });

assert.equal(crotusShip.modules.length, 4);
assert.deepEqual(
  crotusShip.mounts.map((mount) =>
    mount.module ? mount.module.definitionId : null,
  ),
  ['autogun', null, 'thrusterDualMd', 'cargoHatch', 'cargoHatch', null],
);

assert.deepEqual(
  crotusShip.mounts
    .filter((mount) => mount.module)
    .map((mount) => mount.localPosition),
  [
    Vec.create(24, 0),
    Vec.create(-26, 0),
    Vec.create(-7, -22),
    Vec.create(-7, 22),
  ],
);

// Both variants retain center docking and share the bay presentation.
for (const [spec, sides, bays] of [
  [corral5, 5, 1],
  [corral6, 6, 2],
] as const) {
  assert.equal(spec.geometry.core.length, sides);
  assert.equal(spec.dockingBays.length, bays);
  assert.equal(spec.geometry.sides.filter((side) => side.opening).length, bays);
  assert.equal(spec.geometry.panels.length, sides - bays);
  assert.equal(
    spec.hullSegments.filter((segment) => 'dockSegment' in segment).length,
    1,
  );
  assert.equal(
    spec.hullSegments.filter((segment) => 'glow' in segment).length,
    bays * 2,
  );
}

assert.deepEqual(corral6.dockingBays, [0, Math.PI]);

// Launch selection works for any number of authored bays and replays after rollback.
const launchWorld = createWorld({ seed: 25 });

const launchStation = new Station({
  world: launchWorld,
  rotation: 0.7,
  spec: { ...corral6, dockingBays: [0, Math.PI / 2, Math.PI] },
});

launchWorld.entities.set(launchStation.id, launchStation);
const launchingShip = createPlayerShip(launchWorld);
const chosenBays = new Set<number>();

for (let attempt = 0; attempt < 100; attempt++) {
  launchingShip.dockedTo = launchStation.id;
  const checkpoint = new EntityState(launchingShip);

  launchingShip.launch();
  const rotation = launchingShip.rotation;
  const index = launchStation.dockingBays.findIndex(
    (bay) => rotation === launchStation.rotation + bay,
  );

  assert(index >= 0);
  chosenBays.add(index);
  checkpoint.restore();
  launchingShip.launch();
  assert.equal(launchingShip.rotation, rotation);
}

assert.equal(chosenBays.size, 3);
