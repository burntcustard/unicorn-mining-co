import assert from 'node:assert/strict';
import { moduleSpecForSimulation } from '../../src/client/utilities/module-spec';
import type { ModuleSpec } from '../../src/specs/modules/types';
import { renderingLayers } from '../../src/specs/rendering-layers';

const spec: ModuleSpec = {
  behavior: 'weapon',
  name: 'Timing fixture',
  health: 10,
  price: 20,
  zIndex: renderingLayers.modulesBelowShipHull,
  activationDuration: 125.5,
  chargeDuration: 0,
  dischargeDuration: 300,
  rechargeDuration: 700,
  coverDuration: 200,
  fireInterval: 1000 * (1 / 30),
  damage: 4,
  damageStepsPerSecond: 60,
  barrelLength: 10,
  muzzleFlash: [
    { type: 'glow', color: '#fff', radius: 3, duration: 120, delay: 40 },
  ],
  projectile: {
    speed: 400,
    lifetime: 1500,
    fadeOut: 200,
    radius: 2,
    color: '#fff',
  },
  model: [
    {
      outline: true,
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      rechargeDelay: 0.75,
    },
  ],
};

const before = structuredClone(spec);
const runtime = moduleSpecForSimulation(spec);

assert.equal(runtime.activationDuration, 0.1255);
assert.equal(runtime.chargeDuration, 0);
assert.equal(runtime.dischargeDuration, 0.3);
assert.equal(runtime.rechargeDuration, 0.7);
assert.equal(runtime.coverDuration, 0.2);
assert.equal(runtime.fireInterval, 1 / 30);
assert.equal(runtime.projectile?.lifetime, 1.5);
assert.equal(runtime.model[0].rechargeDelay, 0.00075);
assert.equal(runtime.projectile?.fadeOut, 200);
assert.equal(runtime.projectile?.speed, 400);
assert.equal(runtime.damageStepsPerSecond, 60);
assert.equal(runtime.muzzleFlash, spec.muzzleFlash);
assert.deepEqual(
  spec,
  before,
  'runtime conversion must not change authored milliseconds',
);
assert.notEqual(runtime.projectile, spec.projectile);
assert.notEqual(runtime.model[0], spec.model[0]);

const optional = { ...spec };

delete optional.chargeDuration;
assert.equal(moduleSpecForSimulation(optional).chargeDuration, undefined);
