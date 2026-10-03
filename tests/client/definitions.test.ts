import assert from 'node:assert/strict';
import { itemTypes, diamond } from '../../src/definitions/items';
import { itemDefaults } from '../../src/definitions/items/defaults';
import type { ItemDefinition } from '../../src/definitions/items/types';
import { defaultFriction } from '../../src/definitions/game-object';
import { moduleIds, moduleDefinitionList } from '../../src/definitions/modules';
import {
  mustang,
  shipDefinitionsById,
  type ShipId,
} from '../../src/definitions/ships';
import {
  corral,
  stationDefinitionsById,
  type StationId,
} from '../../src/definitions/stations';
import { Item } from '../../src/client/objects/item';
import { createShip } from '../../src/client/objects/create-ship';
import { Station } from '../../src/client/objects/station';
import { moduleTypes, thrusters } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { cloneEntity } from '../../src/client/simulation/world-state';
import * as Vec from '../../src/client/utilities/vector';

assert.deepEqual(
  itemTypes.map((item) => item.resource),
  [0, 1, 2, 3, 4],
);

for (const definition of itemTypes as readonly ItemDefinition[]) {
  const item = new Item(definition);

  for (const [name, value] of Object.entries(itemDefaults)) {
    if (name !== 'radius') assert.equal(item[name], value);
  }

  assert.equal(item.friction, defaultFriction);
  assert.equal(item.resource, definition.resource);
  assert.equal(item.label, definition.label);
  assert.equal(item.price, definition.price);
  assert.equal(item.unlock, definition.unlock);
  assert.deepEqual(item.shapeOutline, definition.points);
  const radius = definition.points
    ? Math.max(...definition.points.map(([x, y]) => Math.hypot(x, y)))
    : (definition.radius ?? itemDefaults.radius);

  assert(Math.abs(item.radius - radius) <= 2e-8);

  const properties = {
    id: 100 + definition.resource,
    position: Vec.create(-2, 9),
    velocity: Vec.create(1, 2),
    mass: 12,
    health: 0.5,
    angularDrag: 0.25,
    radius: 8,
  };

  const overridden = new Item(definition, properties);

  for (const [name, value] of Object.entries(properties)) {
    if (name !== 'radius') assert.deepEqual(overridden[name], value);
  }

  assert(
    Math.abs(
      overridden.radius - (definition.points ? radius : properties.radius),
    ) <= 2e-8,
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

moduleDefinitionList.forEach((definition, index) => {
  const module = new moduleTypes[index]();

  assert.equal(module.label, definition.label);
  assert.equal(module.health, definition.health);
  assert.equal(module.price, definition.price);
});

assert.equal(thrusters.length, 4);
const item = new Item(diamond, { health: 10 });
const copy = cloneEntity({ entity: item });

assert.equal(
  copy.item,
  diamond,
  'prediction retains definition identity used by cargo grouping',
);
copy.health = 1;
assert.equal(item.health, 10, 'cloned mechanics remain independent');

const shipId = 'testScout' as ShipId;
const stationId = 'testDepot' as StationId;

shipDefinitionsById.set(shipId, { ...mustang, cargoSpace: 20 });
stationDefinitionsById.set(stationId, { ...corral, localMovementRadius: 900 });

try {
  const world = createWorld();
  const first = createShip(world, { shipType: shipId });
  const second = createShip(world, { shipType: shipId });

  assert.equal(first.definitionId, shipId);
  assert.equal(first.cargoSpace, 20);
  assert.equal(first.modules.length, mustang.startingModules.length);
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
  shipDefinitionsById.delete(shipId);
  stationDefinitionsById.delete(stationId);
}

console.log(
  'Definition registries, generic content construction and independent instance state passed',
);
