import { Vector } from '../../vector';
import { type ItemEntity, type ShipEntity } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from './world';

const cargoSpace = 12;
const scoopReach = 32;

export const scoop = (
  world: SimulationWorld,
  ship: ShipEntity,
  events: SimulationEvent[],
) => {
  if (!ship.hatch || ship.playerId === undefined) return;

  const forward = Vector(Math.cos(ship.rotation), Math.sin(ship.rotation));
  const cargo = ship.cargo || (ship.cargo = []);

  for (const [id, entity] of world.entities) {
    if (entity.kind !== 'item' || cargo.length >= cargoSpace) continue;

    const item = entity as ItemEntity;
    const offset = item.position.subtract(ship.position);
    const distance = offset.length();

    if (
      offset.dot(forward) >= 0 &&
      distance <= ship.radius + scoopReach + item.radius
    ) {
      cargo.push(item.resource);
      world.entities.delete(id);
      events.push({
        by: ship.playerId,
        itemId: id,
        resource: item.resource,
        type: 'itemCollected',
      });
    }
  }
};
