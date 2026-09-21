import { Craft } from '../shared/craft/craft';
import { Module } from '../shared/modules/module';
import { type EntityId } from '../shared/protocol/entities';
import {
  type ReplicatedEntity,
  type ServerMessage,
} from '../shared/protocol/network';
import { type SimulationWorld } from '../shared/simulation/world';
import { type WorldObject } from '../shared/simulation/world';
import { Ship } from '../shared/craft/ship';
import { Asteroid } from '../shared/simulation/asteroid';
import { Item } from '../shared/items/item';
import { Station } from '../shared/craft/station';
import { updateTier } from '../shared/simulation/update-tier';

const entityLoad = 2000;
const entityUnload = 2500;
const markerLoad = 10000;
const markerUnload = 11000;

const replicateEntity = ({
  entity,
}: {
  entity: WorldObject;
}): ReplicatedEntity => ({
  ...(entity instanceof Asteroid && { contents: entity.contents }),
  ...(entity instanceof Asteroid && { decay: entity.decay }),
  ...(entity instanceof Asteroid && { maxHealth: entity.maxHealth }),
  ...(entity instanceof Asteroid && { outline: entity.outline }),
  ...(entity instanceof Asteroid && { sections: entity.sections }),
  ...(entity instanceof Craft && {
    cargoContents: entity.cargoContents.map((object) =>
      object instanceof Module
        ? { moduleIndex: entity.modules.indexOf(object) }
        : replicateEntity({ entity: object }),
    ),
  }),
  ...(entity instanceof Craft && { dockedTo: entity.dockedTo }),
  ...(entity instanceof Craft && { hullHealth: entity.hullHealth }),
  ...(entity instanceof Craft && { launching: entity.launching }),
  ...(entity instanceof Craft && { maxSpeed: entity.maxSpeed }),
  ...(entity instanceof Craft && {
    modules: entity.moduleStates,
    wreckage: entity.wreckage,
    decay: entity.decay,
    shades: entity.shades,
  }),
  ...(entity instanceof Ship && { thrust: entity.thrust }),
  ...(entity instanceof Ship && { turn: entity.turn }),
  ...('health' in entity && { health: entity.health }),
  ...('label' in entity && { label: entity.label }),
  ...('paint' in entity && { paint: entity.paint }),
  ...('playerId' in entity && { playerId: entity.playerId }),
  ...('points' in entity && { points: entity.points }),
  ...('radiusEven' in entity && { radiusEven: entity.radiusEven }),
  ...('resource' in entity && { resource: entity.resource }),
  id: entity.id,
  kind:
    entity instanceof Asteroid
      ? 'asteroid'
      : entity instanceof Item
        ? 'item'
        : entity instanceof Station
          ? 'station'
          : entity instanceof Craft
            ? 'ship'
            : 'object',
  mass: entity.mass,
  pendingUpdateTime: entity.pendingUpdateTime,
  position: { x: entity.position.x, y: entity.position.y },
  radius: entity.radius,
  rotation: entity.rotation,
  spin: entity.spin,
  velocity: { x: entity.velocity.x, y: entity.velocity.y },
});

type SnapshotOptions = {
  world: SimulationWorld;
  shipId: EntityId;
  acknowledgedSequence?: number;
  inputLead?: number;
};

export class ReplicationManager {
  private entities = new Set<EntityId>();

  initial(options: SnapshotOptions): ServerMessage {
    this.entities.clear();
    return { ...this.snapshot(options), type: 'load' };
  }

  snapshot({
    world,
    shipId,
    acknowledgedSequence,
    inputLead,
  }: SnapshotOptions) {
    const ship = world.entities.get(shipId)!;
    const visible = [...world.entities.values()].filter((entity) => {
      const loaded = this.entities.has(entity.id);
      const range =
        entity instanceof Station
          ? loaded
            ? markerUnload
            : markerLoad
          : loaded
            ? entityUnload
            : entityLoad;
      return (
        entity.id === shipId ||
        entity.position.distanceTo(ship.position) <= range
      );
    });
    const fullEntities = visible
      .filter(
        (entity) =>
          !this.entities.has(entity.id) ||
          world.tick %
            updateTier({ entity, observers: [ship] }).replicateEvery ===
            0,
      )
      .map((entity) => replicateEntity({ entity }));

    this.entities = new Set(visible.map((entity) => entity.id));
    return {
      acknowledgedSequence,
      inputLead,
      entityIds: [...this.entities],
      fullEntities,
      serverTick: world.tick,
      type: 'snapshot' as const,
    };
  }
}
