import { createRandom, type Random } from '../seeded-random';
import {
  type EntityId,
  type Player,
  type PlayerId,
} from '../protocol/entities';
import { type GameObject } from '../game-object';

export interface SimulationWorld {
  entities: Map<EntityId, GameObject>;
  movementParents?: GameObject[];
  nextEntityId: EntityId;
  players: Map<PlayerId, Player>;
  random: Random;
  tick: number;
}

export const createWorld = ({
  seed = 1,
}: {
  seed?: number;
} = {}): SimulationWorld => ({
  entities: new Map<EntityId, GameObject>(),
  nextEntityId: 1,
  players: new Map<PlayerId, Player>(),
  random: createRandom(seed),
  tick: 0,
});

export const addEntity = <Object extends GameObject>(
  world: SimulationWorld,
  entity: Object,
) => {
  entity.world = world;
  world.entities.set(entity.id, entity);
  world.nextEntityId = Math.max(world.nextEntityId, entity.id + 1);
  return entity;
};

export const addPlayer = (world: SimulationWorld, player: Player) => {
  world.players.set(player.id, player);
  return player;
};

export const entityId = (world: SimulationWorld) => world.nextEntityId++;
