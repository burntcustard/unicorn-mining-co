import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';

const makeShip = (plant: 'powerPlant2V' | 'powerPlant2H' | 'powerPlant2L') => {
  const ship = createPlayerShip(createWorld());
  const mount = ship.mounts.find(
    ({ module }) => module && module.behavior === 'powerPlant',
  );

  assert(mount);
  const Type = moduleTypesById.get(plant)!;

  ship.fit(new Type(), mount);
  return ship;
};

const standard = makeShip('powerPlant2V');
const heavy = makeShip('powerPlant2H');
const light = makeShip('powerPlant2L');

assert.equal(
  standard.mass,
  standard.hullMass +
    standard.mounts.reduce(
      (sum, mount) => sum + (mount.module ? mount.module.mass : 0),
      0,
    ),
);
assert(heavy.mass > standard.mass && light.mass < standard.mass);
assert(heavy.movementDrag() < standard.movementDrag());
assert(light.movementDrag() > standard.movementDrag());
assert.equal(heavy.maxSpeed, standard.maxSpeed);
assert.equal(light.maxSpeed, standard.maxSpeed);

for (const ship of [standard, heavy, light]) {
  ship.fly(1, 1);
  ship.update(1 / 30);
}

assert(heavy.velocity.x < standard.velocity.x);
assert(light.velocity.x > standard.velocity.x);
assert(heavy.spin < standard.spin);
assert(light.spin > standard.spin);

const damaged = makeShip('powerPlant2V');
const hullHealth = damaged.hullHealth;

hullHealth[3] = 0;
damaged.hullHealth = hullHealth;
assert.equal(
  damaged.mass,
  damaged.mounts.reduce(
    (mass, mount) => mass + (mount.module ? mount.module.mass : 0),
    damaged.hullMass,
  ),
  'destroyed hull mounts no longer add mass',
);
