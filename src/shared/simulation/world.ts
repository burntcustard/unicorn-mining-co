import { createRandom, type Random } from '../../seeded-random';
import {
  type Entity,
  type EntityId,
  type Player,
  type PlayerId,
} from '../protocol/entities';

export interface SimulationWorld {
  entities: Map<EntityId, Entity>;
  nextEntityId: EntityId;
  players: Map<PlayerId, Player>;
  random: Random;
  tick: number;
}

export const createWorld = ({ seed = 1 }: { seed?: number } = {}) => ({
  entities: new Map<EntityId, Entity>(),
  nextEntityId: 1,
  players: new Map<PlayerId, Player>(),
  random: createRandom(seed),
  tick: 0,
});

export const addEntity = <WorldEntity extends Entity>(
  world: SimulationWorld,
  entity: WorldEntity,
) => {
  world.entities.set(entity.id, entity);
  world.nextEntityId = Math.max(world.nextEntityId, entity.id + 1);
  return entity;
};

export const addPlayer = (world: SimulationWorld, player: Player) => {
  world.players.set(player.id, player);
  return player;
};

export const entityId = (world: SimulationWorld) => world.nextEntityId++;
