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
  fields: {
    key: string;
    read: () => any;
    value: any;
    revision: number;
  }[];
};

// Readers capture the entity once. History stores only observer revisions;
// unchanged field values and their comparison copies survive across ticks.
const createRecord = (entity: GameObject): ReplicationRecord => {
  const readers = {
    ...(entity instanceof Asteroid && {
      contents: () => (entity.contents.length ? entity.contents : undefined),
      decay: () => entity.decay,
      maxHealth: () =>
        entity.maxHealth !== entity.radius * 2 ? entity.maxHealth : undefined,
      shapeOutline: () => entity.shapeOutline,
      segments: () =>
        entity.shapeOutline ||
        entity.segments?.some(({ health, maxHealth }) => health !== maxHealth)
          ? entity.segments
          : undefined,
    }),
    ...(entity instanceof Craft && {
      cargoContents: () => {
        if (!entity.cargoContents.length) return;
        const modules = entity.modules;

        return entity.cargoContents.map((object) =>
          object instanceof Module
            ? { moduleIndex: modules.indexOf(object) }
            : { ...replicateEntity({ entity: object }).entity },
        );
      },
      credits: () => entity.credits,
      dockedTo: () => entity.dockedTo,
      ...(!(entity instanceof Station) && {
        hullHealth: () => entity.hullHealth,
      }),
      launching: () => entity.launching,
      maxSpeed: () => entity.maxSpeed,
      modules: () => readModules(entity),
      wreckage: () => entity.wreckage,
      decay: () => entity.decay,
      shades: () =>
        entity.shades === (entity.constructor as typeof Craft).shades
          ? undefined
          : entity.shades,
    }),
    ...(entity instanceof Ship && {
      thrust: () => entity.thrust,
      turn: () => entity.turn,
    }),
    friction: () =>
      entity.friction !== (entity.constructor as typeof GameObject).friction
        ? entity.friction
        : undefined,
    health: () =>
      (entity instanceof Asteroid && entity.health === entity.radius * 2) ||
      (entity instanceof Craft && entity.health === 100)
        ? undefined
        : entity.health,
    label: () => entity.label,
    message: () => entity.message,
    paint: () => entity.paint,
    playerId: () => entity.playerId,
    pointCount: () => entity.pointCount,
    radiusEven: () => entity.radiusEven,
    resource: () => entity.resource,
    id: () => entity.id,
    kind: () =>
      entity instanceof Asteroid
        ? 'asteroid'
        : entity instanceof Item
          ? 'item'
          : entity instanceof Station
            ? 'station'
            : entity instanceof Craft
              ? 'ship'
              : 'object',
    mass: () =>
      entity instanceof Asteroid && entity.mass === 0.4 * entity.radius ** 2
        ? undefined
        : entity.mass,
    pendingUpdateTime: () => entity.pendingUpdateTime || undefined,
    position: () => entity.position,
    radius: () => entity.radius,
    rotation: () => entity.rotation,
    spin: () => entity.spin,
    velocity: () =>
      entity.velocity.x || entity.velocity.y ? entity.velocity : undefined,
  };

  return {
    entity: {} as ReplicatedEntity,
    revision: 0,
    fields: Object.entries(readers).map(([key, read]) => ({
      key,
      read,
      value: undefined as ReplicationRecord['fields'][number]['value'],
      revision: 0,
    })),
  };
};

const replicateEntity = ({ entity }: { entity: GameObject }) => {
  let record = records.get(entity);

  if (!record) {
    record = createRecord(entity);
    records.set(entity, record);
  }

  for (const field of record.fields) {
    const value = field.read();
    const segments =
      entity instanceof Asteroid &&
      value !== undefined &&
      value === entity.segments;
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
      continue;
    }
    field.value = segments
      ? copySegments(value)
      : normalized && typeof normalized === 'object'
        ? Vec.clone(normalized)
        : normalized;
    field.revision = ++record.revision;

    if (value === undefined) {
      delete record.entity[field.key as keyof ReplicatedEntity];
    } else {
      (record.entity as Record<string, unknown>)[field.key] = Array.isArray(
        value,
      )
        ? value
        : field.value;
    }
  }
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
          return full;
        }
        let changed: ReplicatedEntity | undefined;

        for (const field of prepared.fields) {
          if (field.revision <= revision) continue;
          changed ||= { id: entity.id } as ReplicatedEntity;
          (changed as Record<string, unknown>)[field.key] =
            prepared.entity[field.key as keyof ReplicatedEntity] ?? null;
        }
        return changed;
      })
      .filter((record) => record !== undefined);

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
