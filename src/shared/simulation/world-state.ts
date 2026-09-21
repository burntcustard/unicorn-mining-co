import {
  type EntityId,
  type Player,
  type PlayerId,
} from '../protocol/entities';
import { type SimulationWorld, type WorldObject } from './world';
import { GameObject } from '../game-object';
import { Module } from '../modules/module';
import { createRandom } from '../seeded-random';

export type SimulationWorldState = {
  entities: Map<EntityId, WorldObject>;
  nextEntityId: EntityId;
  players: Map<PlayerId, Player>;
  randomState: number;
  tick: number;
};

const omitted: Record<string, boolean> = {
  world: true,
  collections: true,
  ctx: true,
  render: true,
  renderContents: true,
  prism: true,
  updateVisual: true,
  path: true,
  hitbox: true,
  shapes: true,
  shapePass: true,
  localMovementParent: true,
  destroyed: true,
  docked: true,
  note: true,
};
const definitions: Record<string, boolean> = {
  hullSegments: true,
  item: true,
  fits: true,
  shades: true,
};
/*
 * Copy mutable mechanics, preserving prototype-based hull/module definitions
 * and the links between a ship's segments, mounts and inventory.
 * Presentation caches and world ownership never belong in a checkpoint.
 */
export const cloneEntity = ({
  entity,
}: {
  entity: WorldObject;
}): WorldObject => {
  const copies = new Map<object, any>();
  const special: Record<string, (value: any) => any> = {
    random: (value) => createRandom(value.state),
    dockedTo: (value) => (typeof value === 'object' ? value.id : value),
    module: (value) => (value instanceof Module ? clone(value) : value),
  };
  const clone = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (copies.has(value)) return copies.get(value);
    // Arrays contain mechanics data, not entity fields. Copy their elements
    // directly, retaining named metadata such as collision-outline edges.
    if (Array.isArray(value)) {
      // Allocate the known length without a second resize in this hot path.
      // oxlint-disable-next-line unicorn/no-new-array
      const copy: any[] = new Array(value.length);
      copies.set(value, copy);
      // Deliberately copy own enumerable metadata and preserve sparse holes,
      // without allocating a keys array for every coordinate tuple.
      // oxlint-disable-next-line typescript/no-for-in-array
      for (const key in value)
        if (Object.hasOwn(value, key)) copy[key] = clone(value[key]);
      return copy;
    }
    const copy = Object.create(Object.getPrototypeOf(value));
    copies.set(value, copy);
    Object.keys(value).forEach((name) => {
      if (omitted[name]) return;
      const member = value[name];
      copy[name] = definitions[name]
        ? member
        : member && special[name]
          ? special[name](member)
          : clone(member);
    });
    if (value instanceof GameObject) copy.collections = [];
    return copy;
  };
  return clone(entity);
};

export const captureWorld = ({
  world,
}: {
  world: SimulationWorld;
}): SimulationWorldState => ({
  entities: new Map(
    [...world.entities].map(([id, entity]) => [id, cloneEntity({ entity })]),
  ),
  nextEntityId: world.nextEntityId,
  players: new Map(
    [...world.players].map(([id, player]) => [id, { ...player }]),
  ),
  randomState: world.random.state,
  tick: world.tick,
});

export const restoreWorld = ({
  world,
  state,
}: {
  world: SimulationWorld;
  state: SimulationWorldState;
}) => {
  world.entities = new Map(
    [...state.entities].map(([id, entity]) => {
      const restored = cloneEntity({ entity });
      restored.world = world;
      restored.random = world.random;
      return [id, restored];
    }),
  );
  world.nextEntityId = state.nextEntityId;
  world.players = new Map(
    [...state.players].map(([id, player]) => [id, { ...player }]),
  );
  world.random.state = state.randomState;
  world.tick = state.tick;
};
