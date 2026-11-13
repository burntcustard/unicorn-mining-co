import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { Ship } from '../../src/client/objects/ship';
import { PowerPlant } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { installExampleModules } from '../support/example-modules';

installExampleModules();

const ship = createPlayerShip(createWorld());
const plant = ship.modules.find((module) => module instanceof PowerPlant)!;
const mount = plant.mount;
const mountIndex = ship.mounts.indexOf(mount);

assert(mount && plant.powerGenerated > 0);
mount.health = 40;
const restored = new Ship();

restored.moduleStates = ship.moduleStates;
assert(restored.mounts[mountIndex].module instanceof PowerPlant);
assert.equal(restored.mounts[mountIndex].health, 40);

ship.fit(0, mount);
assert(ship.cargoContents.includes(plant));
ship.fit(plant, mount);
assert(!ship.cargoContents.includes(plant));
assert(ship.modules.includes(plant));
