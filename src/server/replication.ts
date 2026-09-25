import * as Vec from '../shared/vector';
import { Craft } from '../shared/craft/craft';
import { Module } from '../shared/modules/module';
import { type EntityId } from '../shared/protocol/entities';
import {
  type ReplicatedEntity,
  type ServerMessage,
} from '../shared/protocol/network';
import { type SimulationWorld } from '../shared/simulation/world';
import { GameObject } from '../shared/game-object';
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
  entity: GameObject;
}): ReplicatedEntity => ({
  ...(entity instanceof Asteroid && { contents: entity.contents }),
  ...(entity instanceof Asteroid && { decay: entity.decay }),
  ...(entity instanceof Asteroid && { maxHealth: entity.maxHealth }),
  ...(entity instanceof Asteroid && { outline: entity.outline }),
  ...(entity instanceof Asteroid && { segments: entity.segments }),
  ...(entity instanceof Craft && {
    cargoContents: entity.cargoContents.map((object) =>
      object instanceof Module
        ? { moduleIndex: entity.modules.indexOf(object) }
        : replicateEntity({ entity: object }),
    ),
  }),
  ...(entity instanceof Craft && { credits: entity.credits }),
  ...(entity instanceof Craft && { dockedTo: entity.dockedTo }),
  ...(entity instanceof Craft && { hullHealth: entity.hullHealth }),
  ...(entity instanceof Craft && { launching: entity.launching }),
  ...(entity instanceof Craft && { maxSpeed: entity.maxSpeed }),
  ...(entity instanceof Craft && {
    modules: entity.moduleStates.map((state, index) => ({
      ...state,
      id: entity.modules[index].id,
    })),
    wreckage: entity.wreckage,
    decay: entity.decay,
    shades: entity.shades,
  }),
  ...(entity instanceof Ship && { thrust: entity.thrust }),
  ...(entity instanceof Ship && { turn: entity.turn }),
  ...(entity.friction !==
    (entity.constructor as typeof GameObject).friction && {
    friction: entity.friction,
  }),
  ...('health' in entity && { health: entity.health }),
  ...('label' in entity && { label: entity.label }),
  ...('paint' in entity && { paint: entity.paint }),
  ...('playerId' in entity && { playerId: entity.playerId }),
  ...('pointCount' in entity && { pointCount: entity.pointCount }),
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
  position?: Vec.Value;
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
    position,
    acknowledgedSequence,
    inputLead,
  }: SnapshotOptions) {
    const ship = world.entities.get(shipId) || { position: position! };
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
        Vec.distance(entity.position, ship.position) <= range
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
