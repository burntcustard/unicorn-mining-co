import * as Vec from '../../../src/client/utilities/vector';
import {
  createWorld,
  addEntity,
  addPlayer,
} from '../../../src/client/simulation/world';
import { createShip } from '../../../src/client/objects/create-ship';
import { Station } from '../../../src/client/objects/station';
import { createAsteroid } from '../../../src/client/simulation/asteroid';
import {
  ShieldGenerator,
  moduleTypesById,
} from '../../../src/client/objects/modules/index';
import type { ModuleId } from '../../../src/definitions/modules/index';
import { Item } from '../../../src/client/objects/item';
import { diamond as diamondDefinition } from '../../../src/definitions/items/index';
import { Craft } from '../../../src/client/objects/craft';
import { Ship } from '../../../src/client/objects/ship';
import { GameObject } from '../../../src/client/objects/game-object';
import { updateWorld } from '../../../src/client/simulation/update-world';
import { emptyPlayerInput } from '../../../src/client/protocol/input';
import {
  GameCollisions,
  isBallistic,
} from '../../../src/client/collision/game-collisions';

let contacts: unknown[] = [];
// The wrapper invokes the original with its original receiver.
// oxlint-disable-next-line typescript/unbound-method
const step = GameCollisions.prototype.step;

GameCollisions.prototype.step = function (options) {
  const found = step.call(this, options);

  contacts = found.map((c) => ({
    a: c.collider.owner.id,
    b: c.other.owner.id,
    depth: c.depth,
    point: c.point,
    normal: c.normal,
  }));
  return found;
};
const record = (entity: GameObject) => ({
  id: entity.id,
  kind: entity.kind,
  position: entity.position,
  velocity: entity.velocity,
  rotation: entity.rotation,
  spin: entity.spin,
  mass: entity.mass,
  health: entity.health ?? null,
  radius: entity.radius,
  pendingUpdateTime: entity.pendingUpdateTime,
  ballistic: isBallistic(entity),
  ...(entity instanceof Craft && {
    hullHealth: entity.hullHealth,
    modules: entity.moduleStates,
    cargo: entity.cargoContents.map(({ id }) => id),
    segments: entity.segments.map((segment) => ({
      health: segment.health ?? null,
      active: segment.active,
      progress: segment.activationProgress,
      localPosition: segment.localPosition,
    })),
  }),
  ...(entity instanceof Ship && {
    launching: entity.launching || 0,
    dockedTo: entity.dockedTo || null,
    forward: entity.forward,
    turn: entity.turn,
  }),
});
const cases = [
  { name: 'flight', count: 4, ticks: 900 },
  { name: 'convoy', count: 8, ticks: 180 },
  { name: 'contact', count: 4, ticks: 150 },
  { name: 'drill', count: 1, ticks: 180 },
  { name: 'docking', count: 1, ticks: 120 },
  { name: 'shield', count: 1, ticks: 180 },
  ...(
    [
      'thrusterSingle',
      'thrusterDualMd',
      'thrusterDualXl',
      'thrusterTriple',
    ] satisfies ModuleId[]
  ).map((engine) => ({ name: engine, engine, count: 1, ticks: 300 })),
].map((scenario) => {
  const world = createWorld({ seed: 25 });

  for (let i = 0; i < scenario.count; i++) {
    const position =
      scenario.name === 'flight'
        ? Vec.create(i * 5000, i * 2000)
        : scenario.name === 'convoy'
          ? Vec.create(i * 120, 0)
          : scenario.name === 'contact'
            ? Vec.create(i * 65, 0)
            : Vec.create();
    const ship = addEntity(
      world,
      createShip(world, {
        id: i + 1,
        playerId: i + 1,
        position,
        rotation: scenario.name === 'contact' && i % 2 ? Math.PI : 0,
      }),
    );

    if (scenario.name === 'shield') {
      ship.fit(new ShieldGenerator({ id: -2000 }));
    }

    if ('engine' in scenario) {
      const Type = moduleTypesById.get(scenario.engine)!;

      ship.fit(new Type({ id: -2000 }));
      ship.launch();
    }
    ship.modules.forEach((module, index) => {
      module.id = -1000 - i * 100 - index;
    });
    addPlayer(world, { id: i + 1, shipId: ship.id });
  }

  if (scenario.name === 'drill') {
    addEntity(
      world,
      createAsteroid(world, {
        id: 100,
        position: Vec.create(85, 0),
        radius: 25,
        contents: [0, 1],
      }).lockGeometry(),
    );
  }

  if (scenario.name === 'shield') {
    addEntity(
      world,
      new Item(diamondDefinition, {
        world,
        id: 100,
        position: Vec.create(54, 0),
      }),
    );
  }

  if (scenario.name === 'docking') {
    addEntity(
      world,
      new Station({ id: 100, world, position: Vec.create(), spin: 0.05 }),
    );
  }
  const snapshots = [];

  for (let tick = 0; tick < scenario.ticks; tick++) {
    const inputs = new Map(
      [...world.players.keys()].map((id) => [
        id,
        {
          ...emptyPlayerInput(),
          thrust: ['docking', 'shield'].includes(scenario.name)
            ? 0
            : tick % 100 < 70
              ? 1
              : 0,
          shieldGenerator: scenario.name === 'shield' && tick < 90,
          turn:
            scenario.name === 'flight'
              ? tick % 180 < 60
                ? -1
                : tick % 180 < 120
                  ? 1
                  : 0
              : 0,
          hornDrill: scenario.name === 'drill',
          cargoHatch: tick % 120 < 60,
          searchLight: tick % 180 < 90,
        },
      ]),
    );
    const events = updateWorld({ world, inputs });

    if (
      scenario.name === 'drill' ||
      tick % 10 === 0 ||
      events.length ||
      tick === scenario.ticks - 1
    ) {
      snapshots.push(
        structuredClone({
          tick,
          events,
          contacts,
          nextEntityId: world.nextEntityId,
          entities: [...world.entities.values()].map(record),
        }),
      );
    }
  }
  return { ...scenario, snapshots };
});

GameCollisions.prototype.step = step;

export default cases;
