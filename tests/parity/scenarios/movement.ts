import { simulationStep } from '../../../src/definitions/simulation';
import * as Vec from '../../../src/client/utilities/vector';
import { GameObject } from '../../../src/client/objects/game-object';
import { Ship } from '../../../src/client/objects/ship';
import {
  addEntity,
  addPlayer,
  createWorld,
} from '../../../src/client/simulation/world';
import { updateEntities } from '../../../src/client/simulation/update-tier';
import { emptyPlayerInput } from '../../../src/client/protocol/input';

const world = createWorld();

const objects = [
  {
    id: 1,
    position: Vec.create(4, 0),
    velocity: Vec.create(30, -4),
    spin: 0.3,
    angularDrag: 0.2,
  },
  {
    id: 2,
    position: Vec.create(50000, -2),
    velocity: Vec.create(800, 20),
    spin: -1,
  },
  {
    id: 3,
    position: Vec.create(-50000, 100),
    velocity: Vec.create(),
    spin: 0.2,
  },
  {
    id: 4,
    position: Vec.create(),
    velocity: Vec.create(0.00001, -0.00001),
    health: 5,
    decay: 0.5,
  },
  { id: 5, position: Vec.create(2, 7), velocity: Vec.create(1, 2), drag: 0 },
];

objects.forEach((properties) =>
  addEntity(world, new GameObject(structuredClone(properties))),
);
addPlayer(world, { id: 1, shipId: 1 });
const holder = addEntity(world, new GameObject({ id: 20, spin: 0.7 }));

holder.holds = (child: GameObject) =>
  Vec.distanceSquared(child.position, holder.position) <= 400;

holder.momentum = (position: Vec.Value) => {
  const offset = Vec.subtract(position, holder.position);

  return Vec.create(-offset.y * holder.spin, offset.x * holder.spin);
};

const snapshots = [];

for (let tick = 0; tick < 1800; tick++) {
  world.tick = tick;

  if (tick === 40) holder.remove();

  if (tick === 80) holder.add();

  if (tick === 120) world.entities.get(1)!.position = Vec.create(50000, 100);

  if (tick === 240) world.entities.get(2)!.velocity = Vec.create();

  if (tick === 400) world.entities.get(3)!.velocity = Vec.create(3, -8);

  if (tick === 500) world.entities.get(5)!.buried = true;

  if (tick === 560) world.entities.get(5)!.buried = false;

  if (tick === 600) world.players.clear();
  updateEntities({ world });

  if (tick % 15 === 0 || tick === 1799) {
    snapshots.push({
      tick,
      entities: structuredClone(
        [...world.entities.values()].map((entity) => ({
          id: entity.id,
          position: entity.position,
          velocity: entity.velocity,
          rotation: entity.rotation,
          spin: entity.spin,
          pendingUpdateTime: entity.pendingUpdateTime,
          health: entity.health ?? null,
          parent: entity.localMovementParent
            ? entity.localMovementParent.id
            : null,
          rate: entity.localMovementRate || 0,
        })),
      ),
    });
  }
}

const calls: { type: string; value: number }[] = [];

class ProbeShip extends Ship {
  fly(forward: number) {
    calls.push({ type: 'control', value: forward });
  }

  update(dt: number) {
    calls.push({ type: 'update', value: dt });
  }
}

const timedWorld = createWorld();

addEntity(timedWorld, new ProbeShip({ id: 1, playerId: 1, segments: [] }));
const step = simulationStep;
const input = emptyPlayerInput();

const frame = {
  input,
  changes: [-0.01, 0, step / 8, step / 4, step / 2, step - 1e-10, step].map(
    (offset, i) => ({ offset, input: { ...input, thrust: i % 2 } }),
  ),
};

updateEntities({ world: timedWorld, inputs: new Map([[1, frame]]) });
export default { objects, snapshots, frame, calls };
