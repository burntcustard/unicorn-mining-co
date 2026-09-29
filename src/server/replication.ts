/*
 * JSON snapshot reference used by tests and benchmarks. The production server
 * imports replication-common and binary-replication directly.
 */
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
import {
  ballisticReplicateEvery,
  updateTiers,
  visibleRange,
} from '../shared/settings';
import {
  readModules,
  sameSegments,
  copySegments,
  ReplicationView,
} from './replication-common';

const entityLoad = 2000;
const entityUnload = 2500;
const markerLoad = 10000;
const markerUnload = 11000;

// Cache encodings only for arrays owned by replication and kept immutable.
const ownedArrayEncodings = new WeakMap<object, string>();

const readOracleModules = (entity: Craft) => {
  const states = readModules(entity);

  if (states && !ownedArrayEncodings.has(states)) {
    ownedArrayEncodings.set(states, JSON.stringify(states));
  }
  return states;
};

const records = new WeakMap<GameObject, ReplicationRecord>();

type ReplicationRecord = {
  entity: ReplicatedEntity;
  // The simulated object, and the snapshot batch that last prepared it.
  replicated: GameObject;
  batch?: ReplicationRecords;
  revision: number;
  previousRevision: number;
  recentDelta: ReplicatedEntity | null | undefined;
  changes: ReplicationRecord['fields'];
  changeCount: number;
  fields: {
    key: string;
    value: any;
    revision: number;
  }[];
};

// History stores observer revisions and retains comparison values across ticks.
const createRecord = (entity: GameObject): ReplicationRecord => {
  // Keep this key order aligned with the updateField calls below. Literal keys
  // pass through the same property mangling as the client and server protocol.
  const keys = {
    ...(entity instanceof Asteroid && {
      contents: 0,
      decay: 0,
      maxHealth: 0,
      shapeOutline: 0,
      segments: 0,
    }),
    ...(entity instanceof Craft && {
      cargoContents: 0,
      credits: 0,
      dockedTo: 0,
      ...(!(entity instanceof Station) && {
        hullHealth: 0,
      }),
      launching: 0,
      maxSpeed: 0,
      modules: 0,
      wreckage: 0,
      decay: 0,
      shades: 0,
    }),
    ...(entity instanceof Ship && {
      thrust: 0,
      turn: 0,
    }),
    friction: 0,
    health: 0,
    label: 0,
    message: 0,
    paint: 0,
    playerId: 0,
    pointCount: 0,
    radiusEven: 0,
    resource: 0,
    id: 0,
    kind: 0,
    mass: 0,
    pendingUpdateTime: 0,
    position: 0,
    radius: 0,
    rotation: 0,
    spin: 0,
    velocity: 0,
  };

  return {
    entity: {} as ReplicatedEntity,
    replicated: entity,
    revision: 0,
    previousRevision: 0,
    recentDelta: undefined,
    changes: [],
    changeCount: 0,
    fields: Object.keys(keys).map((key) => ({
      key,
      value: undefined as ReplicationRecord['fields'][number]['value'],
      revision: 0,
    })),
  };
};

const updateField = (
  record: ReplicationRecord,
  field: ReplicationRecord['fields'][number],
  value: any,
  segments = false,
) => {
  segments &&= value !== undefined;
  const normalized = segments
    ? value
    : Array.isArray(value)
      ? (ownedArrayEncodings.get(value) ?? JSON.stringify(value))
      : typeof value === 'number' && !Number.isFinite(value)
        ? null
        : value;

  if (Array.isArray(value)) {
    (record.entity as Record<string, unknown>)[field.key] = value;
  }

  if (
    segments
      ? sameSegments(value, field.value)
      : normalized === field.value ||
        (normalized &&
          field.value &&
          typeof normalized === 'object' &&
          normalized.x === field.value.x &&
          normalized.y === field.value.y)
  ) {
    return;
  }
  field.value = segments
    ? copySegments(value)
    : normalized && typeof normalized === 'object'
      ? Vec.clone(normalized)
      : normalized;
  field.revision = ++record.revision;
  record.changes[record.changeCount++] = field;

  if (value === undefined) {
    delete record.entity[field.key as keyof ReplicatedEntity];
  } else {
    (record.entity as Record<string, unknown>)[field.key] = Array.isArray(value)
      ? value
      : field.value;
  }
};

/*
 * Keep primitive fields out of the generic array/vector path. Most are
 * unchanged, so compare before normalizing nonfinite numbers.
 */
const updateScalar = (
  record: ReplicationRecord,
  field: ReplicationRecord['fields'][number],
  value: string | number | boolean | null | undefined,
) => {
  if (value === field.value) return;

  if (typeof value === 'number' && !Number.isFinite(value)) {
    if (field.value === null) return;
    value = null;
  }
  field.value = value;
  field.revision = ++record.revision;
  record.changes[record.changeCount++] = field;

  if (value === undefined) {
    delete record.entity[field.key as keyof ReplicatedEntity];
  } else {
    (record.entity as Record<string, unknown>)[field.key] = value;
  }
};

const replicateEntity = ({ entity }: { entity: GameObject }) => {
  let record = records.get(entity);

  if (!record) {
    record = createRecord(entity);
    records.set(entity, record);
  }

  record.recentDelta = undefined;
  record.previousRevision = record.revision;
  record.changeCount = 0;
  let cursor = 0;

  if (entity instanceof Asteroid) {
    updateField(
      record,
      record.fields[cursor++],
      entity.contents.length ? entity.contents : undefined,
    );
    updateScalar(record, record.fields[cursor++], entity.decay);
    updateField(
      record,
      record.fields[cursor++],
      entity.maxHealth !== entity.radius * 2 ? entity.maxHealth : undefined,
    );
    updateField(record, record.fields[cursor++], entity.shapeOutline);
    updateField(
      record,
      record.fields[cursor++],
      entity.shapeOutline || entity.damaged ? entity.segments : undefined,
      true,
    );
  }

  if (entity instanceof Craft) {
    updateField(
      record,
      record.fields[cursor++],
      (() => {
        if (!entity.cargoContents.length) return;
        const modules = entity.modules;

        return entity.cargoContents.map((object) =>
          object instanceof Module
            ? { moduleIndex: modules.indexOf(object) }
            : { ...replicateEntity({ entity: object }).entity },
        );
      })(),
    );
    updateScalar(record, record.fields[cursor++], entity.credits);
    updateScalar(record, record.fields[cursor++], entity.dockedTo);

    if (!(entity instanceof Station)) {
      updateField(record, record.fields[cursor++], entity.hullHealth);
    }
    updateScalar(record, record.fields[cursor++], entity.launching);
    updateScalar(record, record.fields[cursor++], entity.maxSpeed);
    updateField(record, record.fields[cursor++], readOracleModules(entity));
    updateField(record, record.fields[cursor++], entity.wreckage);
    updateScalar(record, record.fields[cursor++], entity.decay);
    updateField(
      record,
      record.fields[cursor++],
      entity.shades === (entity.constructor as typeof Craft).shades
        ? undefined
        : entity.shades,
    );
  }

  if (entity instanceof Ship) {
    updateScalar(record, record.fields[cursor++], entity.thrust);
    updateScalar(record, record.fields[cursor++], entity.turn);
  }
  updateScalar(
    record,
    record.fields[cursor++],
    entity.friction !== (entity.constructor as typeof GameObject).friction
      ? entity.friction
      : undefined,
  );
  updateScalar(
    record,
    record.fields[cursor++],
    (entity instanceof Asteroid && entity.health === entity.radius * 2) ||
      (entity instanceof Craft && entity.health === 100)
      ? undefined
      : entity.health,
  );
  updateScalar(record, record.fields[cursor++], entity.label);
  updateScalar(record, record.fields[cursor++], entity.message);
  updateScalar(record, record.fields[cursor++], entity.paint);
  updateScalar(record, record.fields[cursor++], entity.playerId);
  updateScalar(record, record.fields[cursor++], entity.pointCount);
  updateScalar(record, record.fields[cursor++], entity.radiusEven);
  updateScalar(record, record.fields[cursor++], entity.resource);
  updateScalar(record, record.fields[cursor++], entity.id);
  updateScalar(
    record,
    record.fields[cursor++],
    entity instanceof Asteroid
      ? 'asteroid'
      : entity instanceof Item
        ? 'item'
        : entity instanceof Station
          ? 'station'
          : entity instanceof Craft
            ? 'ship'
            : 'object',
  );
  updateScalar(
    record,
    record.fields[cursor++],
    entity instanceof Asteroid && entity.mass === 0.4 * entity.radius ** 2
      ? undefined
      : entity.mass,
  );
  updateScalar(
    record,
    record.fields[cursor++],
    entity.pendingUpdateTime || undefined,
  );
  updateField(record, record.fields[cursor++], entity.position);
  updateScalar(record, record.fields[cursor++], entity.radius);
  updateScalar(record, record.fields[cursor++], entity.rotation);
  updateScalar(record, record.fields[cursor++], entity.spin);
  updateField(
    record,
    record.fields[cursor++],
    entity.velocity.x || entity.velocity.y ? entity.velocity : undefined,
  );
  return record;
};

export type ReplicationRecords = Map<EntityId, ReplicationRecord>;

const entityMarker = JSON.stringify({ fullEntities: [] }).slice(1, -1);

/*
 * Share only entity fragments within one completed simulation batch. Receiver
 * headers, membership and revision cursors remain independent. A replaced ID
 * with receiver-specific clears bypasses sharing. Shared snapshots must be
 * encoded before the next world mutation; callers must not edit their records.
 */
export class SnapshotEncoder {
  private encoded = new Map<ReplicatedEntity, string>();

  encodeSnapshot(message: ServerMessage) {
    if (
      (message.type !== 'load' && message.type !== 'snapshot') ||
      message.fullEntities.length < 2
    ) {
      return JSON.stringify(message);
    }
    const fragments = message.fullEntities.map((entity) => {
      let encoded = this.encoded.get(entity);

      if (encoded === undefined) {
        encoded = JSON.stringify(entity);
        this.encoded.set(entity, encoded);
      }
      return encoded;
    });
    // Derive the marker from a literal key so production property rewriting
    // stays identical to the normal JSON encoder. Replacement is a callback:
    // user strings containing $& or $' must remain literal JSON content.

    return JSON.stringify({ ...message, fullEntities: [] }).replace(
      entityMarker,
      () => entityMarker.slice(0, -1) + fragments.join(',') + ']',
    );
  }
}

type SnapshotOptions = {
  replicationRecords?: ReplicationRecords;
  replicationView?: ReplicationView;
  packetEncoder?: SnapshotEncoder;
  // Internal send path only; omitted for independent public snapshots.
  fullEntitiesScratch?: ReplicatedEntity[];
  world: SimulationWorld;
  shipId: EntityId;
  position?: Vec.Value;
  acknowledgedSequence?: number;
  inputLead?: number;
};

export class ReplicationManager {
  private snapshotTick = 0;
  private stamp = 0;
  // Loaded entities and each one's last sent record revision.
  private members = new Map<
    EntityId,
    { record: ReplicationRecord; revision: number; seen: number }
  >();

  initial(options: SnapshotOptions): ServerMessage {
    this.members.clear();
    return { ...this.snapshot(options), entityIds: undefined, type: 'load' };
  }

  snapshot({
    world,
    shipId,
    position,
    acknowledgedSequence,
    inputLead,
    replicationRecords = new Map(),
    replicationView,
    packetEncoder,
    fullEntitiesScratch,
  }: SnapshotOptions) {
    const ship = world.entities.get(shipId) || { position: position! };
    const fullEntities = fullEntitiesScratch ?? [];

    fullEntities.length = 0;
    const entityIds: EntityId[] = [];
    const members = this.members;
    const stamp = ++this.stamp;
    const previousSize = members.size;
    let retained = 0;
    let membershipChanged = false;
    const view = replicationView || new ReplicationView(world);
    const list = view.entities();
    const { kinds, phases } = view;
    const shipX = ship.position.x;
    const shipY = ship.position.y;

    for (let index = 0; index < list.length; index++) {
      const entity = list[index];
      const dx = entity.position.x - shipX;
      const dy = entity.position.y - shipY;
      const distanceSquared = dx * dx + dy * dy;
      const station = (kinds[index] & 1) === 1;

      if (
        distanceSquared > entityUnload * entityUnload &&
        entity.id !== shipId &&
        (distanceSquared > markerUnload * markerUnload || !station)
      ) {
        continue;
      }
      const previous = members.get(entity.id);
      const loaded = previous !== undefined;
      const range = station
        ? loaded
          ? markerUnload
          : markerLoad
        : loaded
          ? entityUnload
          : entityLoad;

      if (entity.id !== shipId && !(distanceSquared <= range * range)) {
        continue;
      }
      entityIds.push(entity.id);

      if (loaded) {
        previous.seen = stamp;
        retained++;
      } else membershipChanged = true;

      const tierInterval =
        distanceSquared <= visibleRange * visibleRange
          ? updateTiers.visible.replicateEvery
          : updateTiers.distant.replicateEvery;
      const ballistic = kinds[index] > 1;
      const interval = ballistic
        ? Math.max(tierInterval, ballisticReplicateEvery)
        : tierInterval;
      // Spread ballistic samples across ticks rather than sending them together.
      const phase = ballistic ? phases[index] : 0;

      if (
        loaded &&
        (world.tick + phase) % interval &&
        Math.floor((world.tick + phase) / interval) ===
          Math.floor((this.snapshotTick + phase) / interval)
      ) {
        continue;
      }
      const previousRecord = previous?.record;
      let prepared =
        previousRecord?.replicated === entity &&
        previousRecord.batch === replicationRecords
          ? previousRecord
          : replicationRecords.get(entity.id);

      if (!prepared) {
        prepared = replicateEntity({ entity });
        prepared.batch = replicationRecords;
        replicationRecords.set(entity.id, prepared);
      }
      const revision = previousRecord === prepared ? previous!.revision : -1;

      if (previous) {
        previous.record = prepared;
        previous.revision = prepared.revision;
      } else {
        members.set(entity.id, {
          record: prepared,
          revision: prepared.revision,
          seen: stamp,
        });
      }

      const shareDelta =
        packetEncoder && revision === prepared.previousRevision;

      if (shareDelta && prepared.recentDelta !== undefined) {
        if (prepared.recentDelta) fullEntities.push(prepared.recentDelta);
        continue;
      }

      if (revision < 0) {
        const full =
          packetEncoder && !previousRecord
            ? prepared.entity
            : { ...prepared.entity };
        // Receivers merge records even when kind is present. Replacing an
        // object under an existing ID must clear the old optional fields.

        previousRecord?.fields.forEach(({ key }) => {
          if (!(key in full)) (full as Record<string, unknown>)[key] = null;
        });
        fullEntities.push(full);
        continue;
      }
      let changed: ReplicatedEntity | undefined;

      // Most observers need only this preparation's changes. A distant or
      // returning observer may need revisions from several preparations ago.
      const recent = revision >= prepared.previousRevision;
      const fields = recent ? prepared.changes : prepared.fields;
      const count = recent ? prepared.changeCount : fields.length;

      for (let index = 0; index < count; index++) {
        const field = fields[index];

        if (field.revision <= revision) continue;
        changed ||= { id: entity.id } as ReplicatedEntity;
        (changed as Record<string, unknown>)[field.key] =
          prepared.entity[field.key as keyof ReplicatedEntity] ?? null;
      }

      if (shareDelta) prepared.recentDelta = changed ?? null;

      if (changed) fullEntities.push(changed);
    }
    membershipChanged ||= retained !== previousSize;
    this.snapshotTick = world.tick;

    if (membershipChanged) {
      members.forEach(({ seen }, id) => {
        if (seen !== stamp) members.delete(id);
      });
    }
    return {
      acknowledgedSequence,
      inputLead,
      entityIds: membershipChanged ? entityIds : undefined,
      fullEntities,
      nextEntityId: world.nextEntityId,
      serverTick: world.tick,
      type: 'snapshot' as const,
    };
  }
}
