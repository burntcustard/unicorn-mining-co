import * as Vec from '../shared/vector';
import { Craft } from '../shared/craft/craft';
import { Module } from '../shared/modules/module';
import {
  type EntityId,
  type AsteroidSegment,
} from '../shared/protocol/entities';
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
}): ReplicatedEntity => {
  const record = {} as ReplicatedEntity;

  if (entity instanceof Asteroid) {
    if (entity.contents.length) record.contents = entity.contents;
    record.decay = entity.decay;

    if (entity.maxHealth !== entity.radius * 2) {
      record.maxHealth = entity.maxHealth;
    }
    record.shapeOutline = entity.shapeOutline;
    // Untouched segments are reconstructed from the procedural description.

    if (
      entity.shapeOutline ||
      entity.segments?.some(({ health, maxHealth }) => health !== maxHealth)
    ) {
      record.segments = entity.segments;
    }
  }

  if (entity instanceof Craft) {
    if (entity.cargoContents.length) {
      record.cargoContents = entity.cargoContents.map((object) =>
        object instanceof Module
          ? { moduleIndex: entity.modules.indexOf(object) }
          : replicateEntity({ entity: object }),
      );
    }
    record.credits = entity.credits;
    record.dockedTo = entity.dockedTo;

    if (!(entity instanceof Station)) record.hullHealth = entity.hullHealth;
    record.launching = entity.launching;
    record.maxSpeed = entity.maxSpeed;
    const modules = entity.modules;

    record.modules = modules.length
      ? entity.moduleStates.map((state, index) => ({
          ...state,
          id: modules[index].id,
        }))
      : undefined;
    record.wreckage = entity.wreckage;
    record.decay = entity.decay;
    record.shades =
      entity.shades === (entity.constructor as typeof Craft).shades
        ? undefined
        : entity.shades;
  }

  if (entity instanceof Ship) {
    record.thrust = entity.thrust;
    record.turn = entity.turn;
  }

  if (entity.friction !== (entity.constructor as typeof GameObject).friction) {
    record.friction = entity.friction;
  }

  if ('health' in entity) {
    record.health =
      (entity instanceof Asteroid && entity.health === entity.radius * 2) ||
      (entity instanceof Craft && entity.health === 100)
        ? undefined
        : entity.health;
  }

  if ('label' in entity) record.label = entity.label;

  if ('message' in entity) record.message = entity.message;

  if ('paint' in entity) record.paint = entity.paint;

  if ('playerId' in entity) record.playerId = entity.playerId;

  if ('pointCount' in entity) record.pointCount = entity.pointCount;

  if ('radiusEven' in entity) record.radiusEven = entity.radiusEven;

  if ('resource' in entity) record.resource = entity.resource;
  record.id = entity.id;
  record.kind =
    entity instanceof Asteroid
      ? 'asteroid'
      : entity instanceof Item
        ? 'item'
        : entity instanceof Station
          ? 'station'
          : entity instanceof Craft
            ? 'ship'
            : 'object';
  record.mass =
    entity instanceof Asteroid && entity.mass === 0.4 * entity.radius ** 2
      ? undefined
      : entity.mass;
  record.pendingUpdateTime = entity.pendingUpdateTime || undefined;
  record.position = Vec.clone(entity.position);
  record.radius = entity.radius;
  record.rotation = entity.rotation;
  record.spin = entity.spin;
  record.velocity =
    entity.velocity.x || entity.velocity.y
      ? Vec.clone(entity.velocity)
      : undefined;
  return record;
};

const sameSegments = (a: AsteroidSegment[], b?: AsteroidSegment[]) =>
  b &&
  a.length === b.length &&
  a.every((segment, index) => {
    const previous = b[index];

    return (
      segment.health === previous.health &&
      segment.maxHealth === previous.maxHealth &&
      segment.mass === previous.mass &&
      segment.contents.length === previous.contents.length &&
      segment.contents.every((value, i) => value === previous.contents[i]) &&
      (segment.shapeOutline === previous.shapeOutline ||
        (segment.shapeOutline.length === previous.shapeOutline.length &&
          segment.shapeOutline.every(
            (point, i) =>
              point.length === previous.shapeOutline[i].length &&
              point.every((value, j) => value === previous.shapeOutline[i][j]),
          )))
    );
  });

const copySegments = (segments: AsteroidSegment[]) =>
  segments.map((segment) => ({
    ...segment,
    contents: [...segment.contents],
    shapeOutline:
      Object.isFrozen(segment.shapeOutline) &&
      segment.shapeOutline.every(Object.isFrozen)
        ? segment.shapeOutline
        : segment.shapeOutline.map((point) => [...point]),
  }));

type SnapshotFields = Record<
  string,
  string | number | Vec.Value | AsteroidSegment[] | null
>;

export type ReplicationRecords = Map<
  EntityId,
  { entity: ReplicatedEntity; fields: SnapshotFields }
>;

type SnapshotOptions = {
  replicationRecords?: ReplicationRecords;
  world: SimulationWorld;
  shipId: EntityId;
  position?: Vec.Value;
  acknowledgedSequence?: number;
  inputLead?: number;
};

export class ReplicationManager {
  private entities = new Set<EntityId>();
  private previousFields = new Map<EntityId, SnapshotFields>();

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
    replicationRecords = new Map(),
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
        Vec.distanceSquared(entity.position, ship.position) <= range * range
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
        const previous = this.previousFields.get(entity.id);
        let prepared = replicationRecords.get(entity.id);

        if (!prepared) {
          const full = replicateEntity({ entity });
          const fields: SnapshotFields = {};

          for (const key in full) {
            const value = full[key as keyof ReplicatedEntity];

            // Vectors are already copied by replicateEntity. Only arrays need
            // an isolated value for detecting in-place mutations. Compare the
            // segment value, not a key literal that production mangling can miss.
            if (value !== undefined) {
              fields[key] = (
                value === full.segments
                  ? sameSegments(
                      value as AsteroidSegment[],
                      previous?.[key] as AsteroidSegment[] | undefined,
                    )
                    ? previous![key]
                    : copySegments(value as AsteroidSegment[])
                  : Array.isArray(value)
                    ? JSON.stringify(value)
                    : typeof value === 'number' && !Number.isFinite(value)
                      ? null
                      : value
              ) as SnapshotFields[string];
            }
          }

          prepared = { entity: full, fields };
          replicationRecords.set(entity.id, prepared);
        }
        const { entity: full, fields } = prepared;

        this.previousFields.set(entity.id, fields);

        if (!previous) return full;

        // Each player has independent deltas, but preparing the current state
        // only needs to happen once for everyone receiving this simulation tick.
        const changed: Record<string, unknown> = { id: entity.id };

        for (const key in fields) {
          const value = fields[key];
          const before = previous[key];

          if (
            value !== before &&
            (Array.isArray(value)
              ? !sameSegments(value, before as AsteroidSegment[] | undefined)
              : !value ||
                typeof value !== 'object' ||
                !before ||
                typeof before !== 'object' ||
                Array.isArray(before) ||
                value.x !== before.x ||
                value.y !== before.y)
          ) {
            changed[key] = full[key as keyof ReplicatedEntity];
          }
        }

        for (const key in previous) {
          if (!(key in fields)) changed[key] = null;
        }
        return changed as ReplicatedEntity;
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
