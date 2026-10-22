import assert from 'node:assert/strict';
import { type SimulationWorld } from '../../src/client/simulation/world';
import {
  createWorld,
  addEntity,
  addPlayer,
} from '../../src/client/simulation/world.ts';
import { createPlayerShip } from '../../src/client/objects/create-ship.ts';
import { Autogun } from '../../src/client/objects/modules/weapon.ts';
import { Item } from '../../src/client/objects/item.ts';
import { Projectile } from '../../src/client/objects/projectile.ts';
import { Craft } from '../../src/client/objects/craft.ts';
import { GameObject } from '../../src/client/objects/game-object.ts';
import { emptyPlayerInput } from '../../src/client/protocol/input.ts';
import { type InputFrame } from '../../src/client/protocol/input-frame.ts';
import { FramePrediction } from '../../src/client/prediction/frame-prediction.ts';
import { autogunAmmo } from '../../src/specs/items/index.ts';
import { simulationStep } from '../../src/specs/simulation.ts';
import { updateWorld } from '../../src/client/simulation/update-world.ts';
import { effects } from '../../src/client/effects/effect.ts';
import * as Vec from '../../src/client/utilities/vector.ts';

Object.assign(globalThis, {
  Path2D: class {
    moveTo() {}
    lineTo() {}
    closePath() {}
  },
});

const world = createWorld();
const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

addPlayer(world, { id: 1, shipId: ship.id });
const gun = new Autogun();

ship.fit(
  gun,
  ship.mounts.find((mount) => mount.fits.includes(Autogun)),
);
ship.cargoContents.push(new Item(autogunAmmo));
ship.setModuleActive({ module: Autogun, active: true });
ship.updateModules(gun.activationDuration + gun.chargeDuration + 1);
gun.fireCooldown = gun.chargeCooldown = 0;
const frame = new FramePrediction();

const input: InputFrame = {
  input: { ...emptyPlayerInput(), autogunActive: true },
  changes: [
    {
      offset: simulationStep * 0.75,
      input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
    },
  ],
};

const before = frame.sample({
  world,
  playerId: 1,
  input,
  elapsed: simulationStep / 4,
});

const early = [...before.entities.values()].filter(
  (entity) => entity instanceof Projectile,
).length;

assert.equal(
  early,
  0,
  'fractional prediction must not expose a projectile before its input edge',
);

const after = frame.sample({
  world,
  playerId: 1,
  input,
  elapsed: simulationStep * 0.8,
});

assert(
  [...after.entities.values()].some((entity) => entity instanceof Projectile),
  'a ready gun produces a preview projectile on the first frame after its input edge',
);
assert.equal(world.tick, 0);
assert.equal(
  [...world.entities.values()].filter((entity) => entity instanceof Projectile)
    .length,
  0,
);

const summarize = (world: SimulationWorld) => ({
  tick: world.tick,
  nextEntityId: world.nextEntityId,
  random: world.random.state,
  entities: [...world.entities.values()].map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    position: { ...entity.position },
    velocity: { ...entity.velocity },
    rotation: entity.rotation,
    spin: entity.spin,
    health: entity.health,
    rounds:
      entity instanceof Craft
        ? entity.cargoContents.map((item) => item.rounds)
        : undefined,
    modules: entity instanceof Craft ? entity.moduleStates : undefined,
  })),
});

const endpoint = summarize(
  frame.sample({ world, playerId: 1, input, elapsed: simulationStep }),
);

updateWorld({ world, inputs: new Map([[1, input]]) });
assert.deepEqual(
  summarize(world),
  endpoint,
  'normal physics and fractional endpoint remain identical',
);

const fixture = () => {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const gun = new Autogun();

  ship.fit(
    gun,
    ship.mounts.find((mount) => mount.fits.includes(Autogun)),
  );
  const ammo = new Item(autogunAmmo);

  ship.cargoContents.push(ammo);
  ship.setModuleActive({ module: Autogun, active: true });
  ship.updateModules(gun.activationDuration + gun.chargeDuration + 1);
  gun.fireCooldown = gun.chargeCooldown = 0;
  return { world, ship, gun, ammo, frame: new FramePrediction() };
};

for (const offset of [0.001, 0.008, 0.016, 0.024, 0.032]) {
  const { world, ship, ammo, frame } = fixture();
  const checkpoint = summarize(world);

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: true },
    changes: [
      {
        offset,
        input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
      },
    ],
  };

  const elapsed = Math.min(simulationStep, offset + 0.0001);
  const predicted = frame.sample({ world, playerId: 1, input, elapsed });

  assert.equal(
    frame.shots.length,
    1,
    'first frame immediately after a ready fire edge exposes its real shot',
  );
  assert(
    [...predicted.entities.values()].some(
      (entity) => entity instanceof Projectile,
    ),
  );
  assert.deepEqual(
    summarize(world),
    checkpoint,
    'preview does not consume ammo, IDs, damage, or random state',
  );
  const shot = frame.shots[0];

  effects.length = 0;
  shot.weapon.presentShot({ craft: ship, deadline: shot.deadline });
  shot.weapon.presentShot({ craft: ship, deadline: shot.deadline });
  assert.equal(effects.length, 1, 'cached preview presents one flash');
  ship.updateVisual(0);
  shot.weapon.presentShot({ craft: ship, deadline: shot.deadline });
  assert.equal(
    effects.length,
    1,
    'live precommit visual update does not reset predicted flash history',
  );
  updateWorld({ world, inputs: new Map([[1, input]]) });
  ship.updateVisual(0);
  assert.equal(
    effects.length,
    1,
    'committing the shot does not duplicate its flash',
  );
  assert.equal(ammo.rounds, checkpoint.entities[0].rounds.at(-1) - 1);

  const next = frame.sample({
    world,
    playerId: 1,
    input: { input: input.changes[0].input, changes: [] },
    elapsed: 0.001,
  });

  assert(
    [...next.entities.values()].some((entity) => entity instanceof Projectile),
    'the committed shot remains visible when the frame cache advances',
  );
}

for (const cooldown of [0.005, 0.02, 0.03]) {
  const { world, gun, frame } = fixture();

  gun.fireCooldown = cooldown;

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
    changes: [],
  };

  frame.sample({ world, playerId: 1, input, elapsed: cooldown / 2 });
  assert.equal(
    frame.shots.length,
    0,
    'a future cooldown deadline does not flash',
  );
  assert.equal(
    [
      ...frame
        .sample({ world, playerId: 1, input, elapsed: cooldown + 0.0001 })
        .entities.values(),
    ].filter((entity) => entity instanceof Projectile).length,
    1,
  );
}

for (const blocked of ['empty', 'retracted', 'charging', 'released']) {
  const { world, ship, gun, frame } = fixture();

  if (blocked === 'empty') ship.cargoContents.length = 0;

  if (blocked === 'charging') gun.chargeCooldown = 1;

  if (blocked === 'retracted') {
    ship.setModuleActive({ module: Autogun, active: false });
    ship.updateModules(gun.activationDuration + gun.dischargeDuration + 1);
  }

  if (blocked === 'released') gun.fireCooldown = 0.02;
  const active = blocked !== 'retracted';

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: active, fire: true },
    changes:
      blocked === 'released'
        ? [
            {
              offset: 0.01,
              input: {
                ...emptyPlayerInput(),
                autogunActive: true,
                fire: false,
              },
            },
          ]
        : [],
  };

  const preview = frame.sample({
    world,
    playerId: 1,
    input,
    elapsed: simulationStep,
  });

  assert.equal(
    frame.shots.length,
    0,
    blocked + ': no flash for an unsuccessful shot',
  );
  assert(
    ![...preview.entities.values()].some(
      (entity) => entity instanceof Projectile,
    ),
  );
}

{
  const { world, gun, frame } = fixture();

  gun.chargeCooldown = 0.025;

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
    changes: [],
  };

  frame.sample({ world, playerId: 1, input, elapsed: 0.03 });
  assert.equal(
    frame.shots.length,
    0,
    'charge completion within a segment remains conservatively hidden until its end',
  );
  frame.sample({ world, playerId: 1, input, elapsed: simulationStep });
  assert.equal(frame.shots.length, 1);
}

{
  const { world, frame } = fixture();

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: true },
    changes: [
      {
        offset: 0.004,
        input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
      },
      {
        offset: 0.009,
        input: { ...emptyPlayerInput(), autogunActive: true, fire: false },
      },
    ],
  };

  for (const elapsed of [0.003, 0.006, 0.002, 0.02, 0, 0.006]) {
    const preview = frame.sample({ world, playerId: 1, input, elapsed });

    assert.equal(
      frame.shots.length,
      elapsed >= 0.004 ? 1 : 0,
      'resampling and a short tap preserve causal visibility',
    );
    assert.equal(
      [...preview.entities.values()].filter(
        (entity) => entity instanceof Projectile,
      ).length,
      elapsed >= 0.004 ? 1 : 0,
    );
  }
}

{
  const { world, ship, gun, frame } = fixture();

  ship.rotation = 0.4;
  ship.spin = 1.5;
  Vec.setXY(ship.velocity, 180, -40);
  const start = Vec.clone(ship.position);
  const muzzle = Vec.add(
    gun.mount.localPosition,
    Vec.create(gun.barrelLength + gun.projectile.radius + 1, 0),
  );
  const expectedPosition = Vec.add(
    start,
    Vec.create(
      muzzle.x * Math.cos(ship.rotation) - muzzle.y * Math.sin(ship.rotation),
      muzzle.x * Math.sin(ship.rotation) + muzzle.y * Math.cos(ship.rotation),
    ),
  );
  const expectedVelocity = Vec.add(
    ship.velocity,
    Vec.create(
      gun.projectile.speed * Math.cos(ship.rotation),
      gun.projectile.speed * Math.sin(ship.rotation),
    ),
  );

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
    changes: [
      {
        offset: 0.025,
        input: {
          ...emptyPlayerInput(),
          autogunActive: true,
          fire: true,
          turn: -1,
        },
      },
    ],
  };

  const preview = frame.sample({ world, playerId: 1, input, elapsed: 0.00001 });
  const shot = frame.shots[0];

  assert(
    Vec.distance(shot.position, expectedPosition) < 1e-9,
    'birth uses the causal muzzle rather than the future turning hull pose',
  );
  assert(
    Vec.distance(shot.velocity, expectedVelocity) < 1e-9,
    'birth uses causal firing direction and inherited velocity',
  );
  assert(
    Vec.distance(
      preview.entities.get(shot.projectile.id).velocity,
      expectedVelocity,
    ) < 1e-9,
  );
}

console.log(
  'Causal births, cooldowns, flash deduplication, fixed-tick handoff, isolated mechanics, moving muzzle, and endpoint parity passed',
);

// A full solve can remove a new shot after its earlier display birth. Preserve
// that interval without reviving it at the authoritative tick endpoint.
for (const mode of ['moving-target', 'moving-hull', 'immediate']) {
  const { world, ship, gun, frame } = fixture();
  const muzzle = Vec.add(
    ship.position,
    Vec.add(
      gun.mount.localPosition,
      Vec.create(gun.barrelLength + gun.projectile.radius + 1, 0),
    ),
  );

  addEntity(
    world,
    new GameObject({
      id: 100,
      mass: Infinity,
      health: 100,
      radius: mode === 'moving-hull' ? 1 : 2,
      position: Vec.add(
        muzzle,
        Vec.create(
          mode === 'moving-target' ? 36 : mode === 'moving-hull' ? 10 : 0,
        ),
      ),
      velocity: Vec.create(mode === 'moving-target' ? -1200 : 0),
    }),
  );

  if (mode === 'moving-hull') {
    ship.drag = 0;
    ship.engine.forwardThrust = 600 / 17;
    Vec.setXY(ship.velocity, 600, 0);
  }

  const checkpoint = summarize(world);

  const input: InputFrame = {
    input: { ...emptyPlayerInput(), autogunActive: true, fire: true },
    changes: [],
  };

  for (const elapsed of [0.003, 0.02, 0.0332, 0.003]) {
    const preview = frame.sample({ world, playerId: 1, input, elapsed });
    const shots = [...preview.entities.values()].filter(
      (entity) => entity instanceof Projectile,
    );

    assert.equal(
      shots.length,
      mode === 'immediate' || elapsed > 0.033 ? 0 : 1,
      mode + ': only a contact already reached can hide the display shot',
    );
    assert(
      shots.every((shot) => !shot.dead && shot.health > 0),
      'display copies retain birth health and can be sampled again before impact',
    );
    assert.deepEqual(
      summarize(world),
      checkpoint,
      'display impact queries cannot change live health, ammunition, IDs, or motion',
    );
  }

  const endpoint = summarize(
    frame.sample({ world, playerId: 1, input, elapsed: simulationStep }),
  );

  assert(
    !endpoint.entities.some((entity) => entity.kind === 'projectile'),
    'the completed endpoint retains the actual projectile removal',
  );
  updateWorld({ world, inputs: new Map([[1, input]]) });
  assert.deepEqual(
    summarize(world),
    endpoint,
    'display-only collision timing preserves the complete CCD endpoint',
  );
}

console.log(
  'Immediate and future projectile contacts retain causal display lifetimes',
);
