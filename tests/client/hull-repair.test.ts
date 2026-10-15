import assert from 'node:assert/strict';
import { Ship } from '../../src/client/objects/ship';
import { PowerPlant } from '../../src/client/objects/modules';
import {
  encodeClientMessage,
  decodeClientMessage,
} from '../../src/client/protocol/binary-control';

const ship = new Ship();
const account = { credits: 100 };
const health = ship.hullHealth;

health[0] = 2.5;
health[1] = 10;
ship.hullHealth = health;
const action = { action: 'repairHull' as const, hullIndex: 0 };

assert.deepEqual(
  decodeClientMessage(encodeClientMessage({ type: 'dock', ...action })),
  { type: 'dock', ...action },
);
assert(ship.applyDockAction(action, account));
assert.equal(account.credits, 90);
assert.equal(ship.hullHealth[0], ship.hullSegments[0].health);
assert.equal(ship.hullHealth[1], 10, 'repair leaves other hull pieces damaged');
assert.equal(
  ship.applyDockAction(action, account),
  undefined,
  'full-health repair is rejected',
);
assert.equal(
  ship.applyDockAction({ action: 'repairHull', hullIndex: -1 }, account),
  undefined,
);
assert.equal(
  ship.applyDockAction({ action: 'repairHull', hullIndex: 1 }, { credits: 0 }),
  undefined,
);
const plant = new PowerPlant();

ship.fit(plant, ship.mounts[3]);
assert.equal(ship.mounts[3].hull.module, ship.hullSegments[3]);
const restored = new Ship();

restored.moduleStates = ship.moduleStates;
assert(restored.mounts[3].module instanceof PowerPlant);
assert.equal(restored.mounts[3].module.powerGenerated, plant.powerGenerated);
