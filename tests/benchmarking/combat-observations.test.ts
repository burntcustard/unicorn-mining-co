import assert from 'node:assert/strict';
import { createCombatObservations } from '../../benchmarking/rendering/workload.ts';

const combat = createCombatObservations();

const ship = {
  id: 1,
  playerId: 10,
  role: 'player',
  definition: 'Courser',
  position: { x: 0, y: 0 },
  visible: true,
  alive: true,
  firing: true,
  health: 100,
  ammunition: 200,
  cooldowns: [{ id: 1, remaining: 0.8 }],
};

const beam: typeof ship = {
  ...ship,
  id: 2,
  playerId: 20,
  role: 'pirate',
  definition: 'Arrow',
  ammunition: 0,
  cooldowns: [],
};

combat.observe({
  ships: [ship, beam],
  projectiles: [{ id: 90, playerId: 10 }],
});

combat.observe({
  ships: [
    {
      ...ship,
      position: { x: 3, y: 4 },
      ammunition: 199,
      cooldowns: [{ id: 1, remaining: 0.6 }],
    },
    { ...beam, health: 97 },
  ],
  projectiles: [
    { id: 90, playerId: 10 },
    { id: 91, playerId: 10 },
    { id: 92, playerId: 30 },
  ],
});

combat.observe({
  ships: [
    {
      ...ship,
      position: { x: 6, y: 8 },
      ammunition: 198,
      cooldowns: [{ id: 1, remaining: 0.99 }],
    },
    { ...beam, health: 97 },
  ],
  projectiles: [{ id: 91, playerId: 10 }],
});

const [player, laser] = combat.summary();

assert.equal(player['ship-type'], 'Courser');
assert.equal(player.movement, 10);
assert.equal(player['path-distance'], 10);
assert.equal(player['visible-samples'], 3);
assert.equal(player['firing-samples'], 3);
assert.equal(player['rounds-used'], 2);
assert.deepEqual(player['new-projectile-ids'], [91]);
assert.equal(
  player['new-cooldown-cycles'],
  1,
  'A carried or decreasing cooldown is not a new firing cycle',
);
assert.equal(
  laser['hp-decrease'],
  3,
  'Damage remains attributed to the affected combatant',
);
assert.equal(laser['rounds-used'], 0, 'Beam weapons do not require ammunition');
assert.deepEqual(laser['new-projectile-ids'], []);
