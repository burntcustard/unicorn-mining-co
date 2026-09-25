import * as Vec from '../vector';
import { Craft } from './craft';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { Ship } from './ship';

export class Station extends Craft {
  kind = 'station';
  handleContacts({
    contacts,
    events,
  }: {
    contacts: Contact[];
    events: SimulationEvent[];
  }) {
    contacts.forEach(({ collider, other }) => {
      const bay =
        collider.owner === this
          ? collider
          : other.owner === this
            ? other
            : undefined;

      if (!bay?.dockSegment) return;
      const ship = (bay === collider ? other : collider).owner;

      if (
        !(ship instanceof Ship) ||
        !ship.cockpit ||
        ship.dockedTo ||
        ship.launching
      ) {
        return;
      }
      ship.dockedTo = this.id;
      Vec.set(ship.position, this.position);
      ship.rotation = this.rotation;
      Vec.set(ship.velocity, Vec.create());
      ship.spin = 0;

      if (ship.playerId !== undefined) {
        events.push({
          playerId: ship.playerId,
          stationId: this.id,
          type: 'docked',
        });
      }
    });
  }
  holds(child: { position: Vec.Value }) {
    return (
      Vec.distance(child.position, this.position) <= this.localMovementRadius
    );
  }
}
