import { Craft } from './craft';
import { Vector, type Vector as VectorValue } from '../vector';
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
      ship.position.set(this.position);
      ship.rotation = this.rotation;
      ship.velocity.set(Vector());
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
  holds(child: { position: VectorValue }) {
    return child.position.distanceTo(this.position) <= this.localMovementRadius;
  }
}
