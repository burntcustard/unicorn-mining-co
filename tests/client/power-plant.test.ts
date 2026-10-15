import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { Ship } from '../../src/client/objects/ship';
import { PowerPlant } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { shipIds } from '../../src/specs/ships';
import { installExampleModules } from '../support/example-modules';

installExampleModules();

for (const shipType of shipIds) {
  const ship = createPlayerShip(createWorld(), { shipType });
  const plants = ship.modules.filter((module) => module instanceof PowerPlant);

  assert.equal(plants.length, 1, `${shipType} starts with one power plant`);
  const plant = plants[0];
  const mount = plant.mount;
  const mountIndex = ship.mounts.indexOf(mount);

  assert(mount && plant.powerGenerated > 0);
  assert.equal(
    ship.segmentsAtMount(mount).length,
    0,
    'internal plants have no geometry',
  );

  mount.health = 40;
  const restored = new Ship({ shipType });

  restored.moduleStates = ship.moduleStates;
  assert(restored.mounts[mountIndex].module instanceof PowerPlant);
  assert.equal(restored.mounts[mountIndex].health, 40);
  assert.equal(
    restored.mounts[mountIndex].module.powerGenerated,
    plant.powerGenerated,
  );

  ship.fit(0, mount);
  assert(
    ship.cargoContents.includes(plant),
    'an internal plant can be removed to cargo',
  );
  ship.fit(plant, mount);
  assert(!ship.cargoContents.includes(plant));
  assert(ship.modules.includes(plant), 'an internal plant can be refitted');
}
