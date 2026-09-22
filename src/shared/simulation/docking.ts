import { type SimulationEvent } from '../protocol/events';
import { Vector } from '../vector';
import { type Contact } from '../physics/collision/types';
import { Ship } from '../craft/ship';
import { Station } from '../craft/station';

/**
 * Latch a ship only when its actual hull touches a station's docking segment.
 */
export const dock = ({
  contacts,
  events,
}: {
  contacts: Contact[];
  events: SimulationEvent[];
}) => {
  contacts.forEach(({ collider, other }) => {
    const bay = collider.dockSegment ? collider : other;
    const ship = (bay === collider ? other : collider).owner;
    const station = bay.owner;
    if (
      !bay.dockSegment ||
      !(station instanceof Station) ||
      !(ship instanceof Ship) ||
      !ship.cockpit ||
      ship.dockedTo ||
      ship.launching
    )
      return;
    ship.dockedTo = station.id;
    ship.position.set(station.position);
    ship.rotation = station.rotation;
    ship.velocity.set(Vector());
    ship.spin = 0;
    if (ship.playerId !== undefined)
      events.push({
        playerId: ship.playerId,
        stationId: station.id,
        type: 'docked',
      });
  });
};

/**
 * Begin the shared automatic launch; Ship.update advances its timer.
 */
export const launch = (ship: Ship) => {
  ship.dockedTo = undefined;
  ship.launching = 3;
};
