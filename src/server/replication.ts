import {
  type Entity,
  type EntityId,
  type ShipEntity,
} from '../shared/protocol/entities';
import {
  type PlayerCheckpoint,
  type ReplicatedEntity,
  type ReplicatedStationMarker,
  type ServerMessage,
} from '../shared/protocol/network';
import { type StationDescription } from '../shared/protocol/regions';
import { type SimulationWorld } from '../shared/simulation/world';

const entityLoad = 2000;
const entityUnload = 2500;
const markerLoad = 10000;
const markerUnload = 11000;

const replicateEntity = ({ entity }: { entity: Entity }): ReplicatedEntity => ({
  ...(entity.kind === 'asteroid' && { contents: entity.contents }),
  ...(entity.kind === 'asteroid' && { decay: entity.decay }),
  ...(entity.kind === 'asteroid' && { maxHealth: entity.maxHealth }),
  ...(entity.kind === 'asteroid' && { outline: entity.outline }),
  ...(entity.kind === 'asteroid' && { sections: entity.sections }),
  ...(entity.kind === 'ship' && { contents: entity.cargo }),
  ...(entity.kind === 'ship' && { dockedTo: entity.dockedTo }),
  ...(entity.kind === 'ship' && { drill: entity.drill }),
  ...(entity.kind === 'ship' && { hatch: entity.hatch }),
  ...(entity.kind === 'ship' && { launching: entity.launching }),
  ...(entity.kind === 'ship' && { light: entity.light }),
  ...(entity.kind === 'ship' && { maxSpeed: entity.maxSpeed }),
  ...(entity.kind === 'ship' && { shield: entity.shield }),
  ...(entity.kind === 'ship' && { thrust: entity.thrust }),
  ...(entity.kind === 'ship' && { turn: entity.turn }),
  ...('health' in entity && { health: entity.health }),
  ...('paint' in entity && { paint: entity.paint }),
  ...('playerId' in entity && { playerId: entity.playerId }),
  ...('points' in entity && { points: entity.points }),
  ...('radiusEven' in entity && { radiusEven: entity.radiusEven }),
  ...('resource' in entity && { resource: entity.resource }),
  id: entity.id,
  kind: entity.kind,
  mass: entity.mass,
  position: { x: entity.position.x, y: entity.position.y },
  radius: entity.radius,
  rotation: entity.rotation,
  spin: entity.spin,
  velocity: { x: entity.velocity.x, y: entity.velocity.y },
});

const replicateMarker = ({
  marker,
}: {
  marker: StationDescription;
}): ReplicatedStationMarker => ({
  id: marker.id,
  position: { x: marker.position.x, y: marker.position.y },
  radius: marker.radius,
  type: 'station',
});

const checkpoint = ({
  ship,
  tick,
  acknowledgedSequence,
  inputLead,
}: {
  ship: ShipEntity;
  tick: number;
  acknowledgedSequence?: number;
  inputLead?: number;
}): PlayerCheckpoint => ({
  ...(acknowledgedSequence !== undefined && { acknowledgedSequence }),
  ...(inputLead !== undefined && { inputLead }),
  ...(ship.dockedTo !== undefined && { dockedTo: ship.dockedTo }),
  ...(ship.launching !== undefined && { launching: ship.launching }),
  drill: ship.drill,
  entityId: ship.id,
  hatch: ship.hatch,
  health: ship.health,
  light: ship.light,
  playerId: ship.playerId!,
  position: { x: ship.position.x, y: ship.position.y },
  rotation: ship.rotation,
  shield: ship.shield,
  spin: ship.spin,
  thrust: ship.thrust,
  tick,
  turn: ship.turn,
  velocity: { x: ship.velocity.x, y: ship.velocity.y },
});

export class ReplicationManager {
  private entities = new Set<EntityId>();
  private markers = new Set<number>();

  initial({
    world,
    shipId,
    stationMarkers,
    acknowledgedSequence,
    inputLead,
  }: {
    world: SimulationWorld;
    shipId: EntityId;
    stationMarkers: StationDescription[];
    acknowledgedSequence?: number;
    inputLead?: number;
  }): ServerMessage {
    const ship = world.entities.get(shipId)!;
    const nearby = [...world.entities.values()].filter(
      (entity) =>
        entity.id === shipId ||
        entity.position.distanceTo(ship.position) <= entityLoad,
    );
    const markers = stationMarkers.filter(
      ({ position }) => position.distanceTo(ship.position) <= markerLoad,
    );

    this.entities = new Set(nearby.map(({ id }) => id));
    this.markers = new Set(markers.map(({ id }) => id));
    return {
      checkpoints: nearby
        .filter(
          (entity): entity is ShipEntity =>
            entity.id === shipId && entity.kind === 'ship',
        )
        .map((ship) =>
          checkpoint({
            acknowledgedSequence:
              ship.id === shipId ? acknowledgedSequence : undefined,
            inputLead: ship.id === shipId ? inputLead : undefined,
            ship,
            tick: world.tick,
          }),
        ),
      fullEntities: nearby.map((entity) => replicateEntity({ entity })),
      serverTick: world.tick,
      stationMarkers: markers.map((marker) => replicateMarker({ marker })),
      type: 'load',
    };
  }

  snapshot({
    world,
    shipId,
    stationMarkers,
    acknowledgedSequence,
    inputLead,
  }: {
    world: SimulationWorld;
    shipId: EntityId;
    stationMarkers: StationDescription[];
    acknowledgedSequence?: number;
    inputLead?: number;
  }): ServerMessage {
    const ship = world.entities.get(shipId)!;
    const candidates = [...world.entities.values()];
    const markerCandidates = stationMarkers;
    const nextEntities = new Set<EntityId>();
    const nextMarkers = new Set<number>();

    candidates.forEach((entity) => {
      const range = this.entities.has(entity.id) ? entityUnload : entityLoad;

      if (
        entity.id === shipId ||
        entity.position.distanceTo(ship.position) <= range
      )
        nextEntities.add(entity.id);
    });
    markerCandidates.forEach((marker) => {
      const range = this.markers.has(marker.id) ? markerUnload : markerLoad;

      if (marker.position.distanceTo(ship.position) <= range)
        nextMarkers.add(marker.id);
    });

    const unloadedEntityIds = [...this.entities].filter(
      (id) => !nextEntities.has(id),
    );
    const unloadedStationMarkerIds = [...this.markers].filter(
      (id) => !nextMarkers.has(id),
    );

    this.entities = nextEntities;
    this.markers = nextMarkers;
    return {
      checkpoints: candidates
        .filter(
          (entity): entity is ShipEntity =>
            nextEntities.has(entity.id) &&
            entity.kind === 'ship' &&
            entity.id === shipId,
        )
        .map((ship) =>
          checkpoint({
            acknowledgedSequence:
              ship.id === shipId ? acknowledgedSequence : undefined,
            inputLead: ship.id === shipId ? inputLead : undefined,
            ship,
            tick: world.tick,
          }),
        ),
      fullEntities: candidates
        .filter(({ id }) => nextEntities.has(id))
        .map((entity) => replicateEntity({ entity })),
      serverTick: world.tick,
      stationMarkers: markerCandidates
        .filter(({ id }) => nextMarkers.has(id))
        .map((marker) => replicateMarker({ marker })),
      type: 'snapshot',
      unloadedEntityIds,
      unloadedStationMarkerIds,
    };
  }

  hasEntity({ id }: { id: EntityId }) {
    return this.entities.has(id);
  }
}
