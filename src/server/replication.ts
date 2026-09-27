import * as Vec from '../shared/vector';
import { Craft } from '../shared/craft/craft';
import { Module } from '../shared/modules/module';
import { type ModuleState } from '../shared/craft/module-state';
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

const moduleEncodings = new WeakMap<object, string>();
const moduleRecords = new WeakMap<
  Craft,
  { modules: Module[]; states: ModuleState[] }
>();
const readModules = (entity: Craft) => {
  const modules = entity.modules;

  if (!modules.length) return;
  const mounts = entity.mounts;
  const previous = moduleRecords.get(entity);

  if (
    previous &&
    modules.length === previous.modules.length &&
    modules.every((module, index) => {
      const state = previous.states[index];

      if (
        module !== previous.modules[index] ||
        module.id !== state.id ||
        mounts.indexOf(module.mount) !== state.mount ||
        (module.mount ? module.mount.health : module.health) !== state.health ||
        module.shades?.length !== state.shades?.length ||
        module.shades?.some(
          (shade: string, i: number) => shade !== state.shades?.[i],
        )
      ) {
        return false;
      }
      let count = 0;

      for (const segment of entity.segments) {
        if (segment.mount !== module.mount || segment.module !== module) {
          continue;
        }
        const before = state.segments[count++];

        if (
          !before ||
          segment.active !== before.active ||
          segment.activationProgress !== before.activationProgress
        ) {
          return false;
        }
      }
      return count === state.segments.length;
    })
  ) {
    return previous.states;
  }
  const states = entity.moduleStates.map((state, index) => ({
    ...state,
    id: modules[index].id,
    shades: state.shades && [...state.shades],
  }));

  states.forEach((state) => {
    state.segments.forEach(Object.freeze);
    Object.freeze(state.segments);

    if (state.shades) Object.freeze(state.shades);
    Object.freeze(state);
  });
  Object.freeze(states);
  moduleEncodings.set(states, JSON.stringify(states));
  moduleRecords.set(entity, { modules, states });
  return states;
};

const records = new WeakMap<GameObject, ReplicationRecord>();

type ReplicationRecord = {
  entity: ReplicatedEntity;
  revision: number;
  previousRevision: number;
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
    revision: 0,
    previousRevision: 0,
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
      ? (moduleEncodings.get(value) ?? JSON.stringify(value))
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

const replicateEntity = ({ entity }: { entity: GameObject }) => {
  let record = records.get(entity);

  if (!record) {
    record = createRecord(entity);
    records.set(entity, record);
  }

  record.previousRevision = record.revision;
  record.changeCount = 0;
  let cursor = 0;

  if (entity instanceof Asteroid) {
    updateField(
      record,
      record.fields[cursor++],
      entity.contents.length ? entity.contents : undefined,
    );
    updateField(record, record.fields[cursor++], entity.decay);
    updateField(
      record,
      record.fields[cursor++],
      entity.maxHealth !== entity.radius * 2 ? entity.maxHealth : undefined,
    );
    updateField(record, record.fields[cursor++], entity.shapeOutline);
    updateField(
      record,
      record.fields[cursor++],
      entity.shapeOutline ||
        entity.segments?.some(({ health, maxHealth }) => health !== maxHealth)
        ? entity.segments
        : undefined,
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
    updateField(record, record.fields[cursor++], entity.credits);
    updateField(record, record.fields[cursor++], entity.dockedTo);

    if (!(entity instanceof Station)) {
      updateField(record, record.fields[cursor++], entity.hullHealth);
    }
    updateField(record, record.fields[cursor++], entity.launching);
    updateField(record, record.fields[cursor++], entity.maxSpeed);
    updateField(record, record.fields[cursor++], readModules(entity));
    updateField(record, record.fields[cursor++], entity.wreckage);
    updateField(record, record.fields[cursor++], entity.decay);
    updateField(
      record,
      record.fields[cursor++],
      entity.shades === (entity.constructor as typeof Craft).shades
        ? undefined
        : entity.shades,
    );
  }

  if (entity instanceof Ship) {
    updateField(record, record.fields[cursor++], entity.thrust);
    updateField(record, record.fields[cursor++], entity.turn);
  }
  updateField(
    record,
    record.fields[cursor++],
    entity.friction !== (entity.constructor as typeof GameObject).friction
      ? entity.friction
      : undefined,
  );
  updateField(
    record,
    record.fields[cursor++],
    (entity instanceof Asteroid && entity.health === entity.radius * 2) ||
      (entity instanceof Craft && entity.health === 100)
      ? undefined
      : entity.health,
  );
  updateField(record, record.fields[cursor++], entity.label);
  updateField(record, record.fields[cursor++], entity.message);
  updateField(record, record.fields[cursor++], entity.paint);
  updateField(record, record.fields[cursor++], entity.playerId);
  updateField(record, record.fields[cursor++], entity.pointCount);
  updateField(record, record.fields[cursor++], entity.radiusEven);
  updateField(record, record.fields[cursor++], entity.resource);
  updateField(record, record.fields[cursor++], entity.id);
  updateField(
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
  updateField(
    record,
    record.fields[cursor++],
    entity instanceof Asteroid && entity.mass === 0.4 * entity.radius ** 2
      ? undefined
      : entity.mass,
  );
  updateField(
    record,
    record.fields[cursor++],
    entity.pendingUpdateTime || undefined,
  );
  updateField(record, record.fields[cursor++], entity.position);
  updateField(record, record.fields[cursor++], entity.radius);
  updateField(record, record.fields[cursor++], entity.rotation);
  updateField(record, record.fields[cursor++], entity.spin);
  updateField(
    record,
    record.fields[cursor++],
    entity.velocity.x || entity.velocity.y ? entity.velocity : undefined,
  );
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

export type ReplicationRecords = Map<EntityId, ReplicationRecord>;

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
  private previousFields = new Map<
    EntityId,
    { record: ReplicationRecord; revision: number }
  >();

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
    const fullEntities: ReplicatedEntity[] = [];
    const entities = new Set<EntityId>();
    let membershipChanged = false;

    for (const entity of world.entities.values()) {
      const loaded = this.entities.has(entity.id);
      const range =
        entity instanceof Station
          ? loaded
            ? markerUnload
            : markerLoad
          : loaded
            ? entityUnload
            : entityLoad;

      if (
        entity.id !== shipId &&
        !(Vec.distanceSquared(entity.position, ship.position) <= range * range)
      ) {
        continue;
      }
      entities.add(entity.id);

      if (!loaded) membershipChanged = true;

      if (
        loaded &&
        world.tick % updateTier({ entity, observers: [ship] }).replicateEvery
      ) {
        continue;
      }
      const previous = this.previousFields.get(entity.id);
      let prepared = replicationRecords.get(entity.id);

      if (!prepared) {
        prepared = replicateEntity({ entity });
        replicationRecords.set(entity.id, prepared);
      }
      const previousRecord = previous?.record;
      const revision = previousRecord === prepared ? previous!.revision : -1;

      if (previous) {
        previous.record = prepared;
        previous.revision = prepared.revision;
      } else {
        this.previousFields.set(entity.id, {
          record: prepared,
          revision: prepared.revision,
        });
      }

      if (revision < 0) {
        const full = { ...prepared.entity };
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

      if (changed) fullEntities.push(changed);
    }
    membershipChanged ||= entities.size !== this.entities.size;
    this.entities = entities;

    if (membershipChanged) {
      this.previousFields.forEach((_, id) => {
        if (!entities.has(id)) this.previousFields.delete(id);
      });
    }
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
