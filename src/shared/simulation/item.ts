import { Vector, type Vector as VectorValue } from '../../vector';
import { type ItemEntity } from '../protocol/entities';
import { type SimulationWorld, entityId } from './world';
import { SimulationEntity } from './entity';

const itemMass = 6;
const itemRadius = 8;

export class Item extends SimulationEntity implements ItemEntity {
  kind = 'item' as const;
  resource: number;

  constructor({
    resource,
    ...properties
  }: ConstructorParameters<typeof SimulationEntity>[0] & { resource: number }) {
    super(properties);
    this.resource = resource;
  }
}

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
): ItemEntity =>
  new Item({
    id,
    mass: itemMass,
    position,
    radius: itemRadius,
    resource,
    velocity,
  });
