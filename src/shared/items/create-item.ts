import { Vector, type Vector as VectorValue } from '../vector';
import { type SimulationWorld, entityId } from '../simulation/world';
import { itemTypes } from './index';
import { type Item } from './item';

export const createItem = (
  world: SimulationWorld,
  {
    id = entityId(world),
    position = Vector(),
    resource,
    velocity = Vector(),
  }: {
    id?: number;
    position?: VectorValue;
    resource: number;
    velocity?: VectorValue;
  },
): Item =>
  new itemTypes[resource]({
    world,
    id,
    position,
    resource,
    velocity,
  });
