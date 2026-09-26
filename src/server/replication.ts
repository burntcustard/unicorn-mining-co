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
  ...(entity instanceof Asteroid &&
    entity.contents.length && { contents: entity.contents }),
  ...(entity instanceof Asteroid && { decay: entity.decay }),
  ...(entity instanceof Asteroid &&
    entity.maxHealth !== entity.radius * 2 && { maxHealth: entity.maxHealth }),
  ...(entity instanceof Asteroid && { shapeOutline: entity.shapeOutline }),
  // Untouched procedural segments are recreated from the asteroid's ID and
  // other replicated fields. Damaged and split asteroids need their own state.
  ...(entity instanceof Asteroid &&
    (entity.shapeOutline ||
      entity.segments?.some(
        ({ health, maxHealth }) => health !== maxHealth,
      )) && {
      segments: entity.segments,
    }),
  ...(entity instanceof Craft &&
    entity.cargoContents.length && {
      cargoContents: entity.cargoContents.map((object) =>
        object instanceof Module
          ? { moduleIndex: entity.modules.indexOf(object) }
          : replicateEntity({ entity: object }),
      ),
    }),
  ...(entity instanceof Craft && { credits: entity.credits }),
  ...(entity instanceof Craft && { dockedTo: entity.dockedTo }),
  ...(entity instanceof Craft &&
    !(entity instanceof Station) && { hullHealth: entity.hullHealth }),
  ...(entity instanceof Craft && { launching: entity.launching }),
  ...(entity instanceof Craft && { maxSpeed: entity.maxSpeed }),
  ...(entity instanceof Craft && {
    modules: entity.modules.length
      ? entity.moduleStates.map((state, index) => ({
          ...state,
          id: entity.modules[index].id,
        }))
      : undefined,
    wreckage: entity.wreckage,
    decay: entity.decay,
    shades:
      entity.shades === (entity.constructor as typeof Craft).shades
        ? undefined
        : entity.shades,
  }),
  ...(entity instanceof Ship && { thrust: entity.thrust }),
  ...(entity instanceof Ship && { turn: entity.turn }),
  ...(entity.friction !==
    (entity.constructor as typeof GameObject).friction && {
    friction: entity.friction,
  }),
  ...('health' in entity && {
    health:
      (entity instanceof Asteroid && entity.health === entity.radius * 2) ||
      (entity instanceof Craft && entity.health === 100)
        ? undefined
        : entity.health,
  }),
  ...('label' in entity && { label: entity.label }),
  ...('message' in entity && { message: entity.message }),
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
  mass:
    entity instanceof Asteroid && entity.mass === 0.4 * entity.radius ** 2
      ? undefined
      : entity.mass,
  pendingUpdateTime: entity.pendingUpdateTime || undefined,
  position: { x: entity.position.x, y: entity.position.y },
  radius: entity.radius,
  rotation: entity.rotation,
  spin: entity.spin,
  velocity:
    entity.velocity.x || entity.velocity.y
      ? { x: entity.velocity.x, y: entity.velocity.y }
      : undefined,
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
  private previousFields = new Map<EntityId, Map<string, string>>();

  initial(options: SnapshotOptions): ServerMessage {
    this.entities.clear();
    this.previousFields.clear();
    return { ...this.snapshot(options), entityIds: undefined, type: 'load' };
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
      .map((entity) => {
        const full = replicateEntity({ entity });

        const fields = new Map(
          Object.entries(full)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, JSON.stringify(value)]),
        );
        const previous = this.previousFields.get(entity.id);

        this.previousFields.set(entity.id, fields);

        if (!previous) return full;

        // The client keeps each entity's first full record. Send only fields
        // whose serialized values changed, and null to clear an old field.
        return {
          id: entity.id,
          ...Object.fromEntries([
            ...Object.entries(full).filter(
              ([key, value]) =>
                key !== 'id' &&
                value !== undefined &&
                fields.get(key) !== previous.get(key),
            ),
            ...[...previous.keys()]
              .filter((key) => !fields.has(key))
              .map((key) => [key, null]),
          ]),
        } as ReplicatedEntity;
      })
      .filter((record) => Object.keys(record).length > 1);

    const entities = new Set(visible.map((entity) => entity.id));
    const membershipChanged =
      entities.size !== this.entities.size ||
      [...entities].some((id) => !this.entities.has(id));

    this.entities = entities;
    this.previousFields.forEach((_, id) => {
      if (!entities.has(id)) this.previousFields.delete(id);
    });
    return {
      acknowledgedSequence,
      inputLead,
      entityIds: membershipChanged ? [...entities] : undefined,
      fullEntities,
      nextEntityId: world.nextEntityId,
      serverTick: world.tick,
      type: 'snapshot' as const,
    };
  }
}
