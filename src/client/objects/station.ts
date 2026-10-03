import {
  stationDefinitionsById,
  type StationId,
} from '../../definitions/stations';
import * as Vec from '../utilities/vector';
import { Craft } from './craft';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { Ship } from './ship';

export class Station extends Craft {
  constructor({
    stationType = 'corral',
    ...properties
  }: ConstructorParameters<typeof Craft>[0] & {
    stationType?: StationId;
  } = {}) {
    const definition = stationDefinitionsById.get(stationType);

    if (!definition) {
      throw new Error(`Unknown station definition: ${stationType}`);
    }
    super({ ...definition, ...properties });
    this.definitionId = stationType === 'corral' ? undefined : stationType;
  }

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
      Vec.distanceSquared(child.position, this.position) <=
      this.localMovementRadius ** 2
    );
  }
}
