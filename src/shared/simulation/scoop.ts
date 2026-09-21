import { CargoScoop } from '../modules';
import { type SimulationEvent } from '../protocol/events';
import { Item } from '../items/item';
import { type Contact } from './physics';
import { Ship } from '../craft/ship';
import { type SimulationWorld } from './world';

/** Collect items whose centres have reached an open ship's scoop throat. */
export const scoop = ({
  contacts,
  events,
  world,
}: {
  contacts: Contact[];
  events: SimulationEvent[];
  world: SimulationWorld;
}) => {
  contacts.forEach(({ collider, other }) => {
    const throat = collider.role === 'scoop' ? collider : other;
    const cargoCollider = throat === collider ? other : collider;
    const ship = throat.owner;
    const item = cargoCollider.owner;

    if (
      throat.role !== 'scoop' ||
      !(ship instanceof Ship) ||
      !ship.moduleActive({ module: CargoScoop }) ||
      ship.playerId === undefined ||
      !(item instanceof Item) ||
      !world.entities.has(item.id) ||
      item.position.distanceTo(throat.position) > throat.radius
    )
      return;
    if (ship.cargoContents.length >= ship.cargoSpace) return;
    ship.cargoContents.push(item);
    item.remove();
    events.push({
      by: ship.playerId,
      itemId: item.id,
      resource: item.resource,
      type: 'itemCollected',
    });
  });
};
