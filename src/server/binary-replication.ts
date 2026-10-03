import * as Vec from '../shared/vector';
import {
  binaryFieldIds as Field,
  entityKindIds,
} from '../shared/specification/protocol';
import { Craft } from '../shared/craft/craft';
import { Ship } from '../shared/craft/ship';
import { Station } from '../shared/craft/station';
import { Asteroid } from '../shared/simulation/asteroid';
import { Item } from '../shared/items/item';
import { Module } from '../shared/modules/module';
import { GameObject } from '../shared/game-object';
import { type ModuleState } from '../shared/craft/module-state';
import { type WreckageSegment } from '../shared/craft/wreckage-segment';
import {
  type AsteroidSegment,
  type EntityId,
} from '../shared/protocol/entities';
import { type SimulationWorld } from '../shared/simulation/world';
import {
  ballisticReplicateEvery,
  updateTiers,
  visibleRange,
} from '../shared/settings';
import { simulationSpecification } from '../shared/specification/simulation';
import {
  readModules,
  sameSegments,
  copySegments,
  ReplicationView,
} from './replication-common';

// The numbers are shared with the client decoder. An entity ID is the record
// prefix, so the field catalog has no ID entry.
const fieldCount = Object.keys(Field).length;
const { entityLoad, entityUnload, markerLoad, markerUnload } =
  simulationSpecification.replication;

class ByteWriter {
  data: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(capacity = 256) {
    this.data = new Uint8Array(capacity);
    this.view = new DataView(this.data.buffer);
  }

  reset() {
    this.length = 0;
  }

  private reserve(count: number) {
    const required = this.length + count;

    if (required <= this.data.length) return;
    let capacity = this.data.length;

    while (capacity < required) capacity *= 2;
    const next = new Uint8Array(capacity);

    next.set(this.data.subarray(0, this.length));
    this.data = next;
    this.view = new DataView(next.buffer);
  }

  byte(value: number) {
    this.reserve(1);
    this.data[this.length++] = value;
  }

  countAt(index: number, value: number) {
    // Entity field counts fit in a single unsigned varint byte.
    this.data[index] = value;
  }

  unsigned(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Binary snapshot integer out of range');
    }

    while (value >= 128) {
      this.byte((value % 128) | 128);
      value = Math.floor(value / 128);
    }
    this.byte(value);
  }

  signed(value: number) {
    if (
      !Number.isSafeInteger(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER / 2
    ) {
      throw new RangeError('Binary snapshot signed integer out of range');
    }
    this.unsigned(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  number(value: number | null | undefined) {
    this.reserve(8);
    // The decoder maps nonfinite values and negative zero exactly as JSON does.
    this.view.setFloat64(this.length, value ?? NaN, true);
    this.length += 8;
  }

  string(value: string) {
    this.unsigned(value.length);
    this.reserve(value.length * 2);

    for (let index = 0; index < value.length; index++) {
      this.view.setUint16(this.length, value.charCodeAt(index), true);
      this.length += 2;
    }
  }

  bytes(value: Uint8Array, from = 0, length = value.length - from) {
    this.reserve(length);
    this.data.set(value.subarray(from, from + length), this.length);
    this.length += length;
  }

  copy() {
    return this.data.slice(0, this.length);
  }
}

const canonical = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value === 0
      ? 0
      : value
    : null;

const sameNumbers = (a: readonly number[], b?: readonly number[]) =>
  b &&
  a.length === b.length &&
  a.every((value, index) => canonical(value) === canonical(b[index]));

const sameStrings = (a: readonly string[], b?: readonly string[]) =>
  b && a.length === b.length && a.every((value, index) => value === b[index]);

const sameOutline = (a: number[][], b?: number[][]) =>
  b &&
  a.length === b.length &&
  a.every((point, index) => sameNumbers(point, b[index]));

const copyOutline = (outline: number[][]) => outline.map((point) => [...point]);

const writeNumbers = (writer: ByteWriter, values: readonly number[]) => {
  writer.unsigned(values.length);

  for (const value of values) writer.number(value);
};

const writeStrings = (writer: ByteWriter, values: readonly string[]) => {
  writer.unsigned(values.length);

  for (const value of values) writer.string(value);
};

const writeOutline = (writer: ByteWriter, outline: number[][]) => {
  writer.unsigned(outline.length);

  for (const point of outline) writeNumbers(writer, point);
};

const writeStroke = (writer: ByteWriter, stroke: number[][][]) => {
  writer.unsigned(stroke.length);

  for (const outline of stroke) writeOutline(writer, outline);
};

const writeVector = (writer: ByteWriter, vector: Vec.Value) => {
  writer.number(vector.x);
  writer.number(vector.y);
};

const writeModules = (writer: ByteWriter, states: ModuleState[]) => {
  writer.unsigned(states.length);

  for (const state of states) {
    const mask =
      +(state.id !== undefined) |
      (+(state.health !== undefined) << 1) |
      (+(state.shades !== undefined) << 2);

    writer.byte(mask);
    writer.number(state.type);
    writer.number(state.mount);

    if (state.id !== undefined) writer.number(state.id);

    if (state.health !== undefined) writer.number(state.health);

    if (state.shades !== undefined) writeStrings(writer, state.shades);
    writer.unsigned(state.segments.length);

    for (const segment of state.segments) {
      writer.number(segment.active);
      writer.number(segment.activationProgress);
    }
  }
};

const writeWreckage = (writer: ByteWriter, segments: WreckageSegment[]) => {
  writer.unsigned(segments.length);

  for (const segment of segments) {
    const mask =
      +(segment.shapeOutline !== undefined) |
      (+(segment.fillShade !== undefined) << 1) |
      (+(segment.stroke !== undefined) << 2);

    writer.byte(mask);
    writer.number(segment.radius);
    writeVector(writer, segment.offset);
    writer.number(segment.health);

    if (segment.shapeOutline !== undefined) {
      writeOutline(writer, segment.shapeOutline);
    }

    if (segment.fillShade !== undefined) writer.number(segment.fillShade);

    if (segment.stroke !== undefined) writeStroke(writer, segment.stroke);
  }
};

const writeSegments = (writer: ByteWriter, segments: AsteroidSegment[]) => {
  writer.unsigned(segments.length);

  for (const segment of segments) {
    writeNumbers(writer, segment.contents);
    writer.number(segment.health);
    writer.number(segment.mass);
    writer.number(segment.maxHealth);
    writeOutline(writer, segment.shapeOutline);
  }
};

type FieldState = {
  id: number;
  compare: unknown;
  wire: unknown;
  revision: number;
};

type BinaryRecord = {
  source: GameObject;
  batchGeneration: number;
  revision: number;
  previousRevision: number;
  fields: FieldState[];
  recentChanges: FieldState[];
  recentCount: number;
  hulls?: Map<unknown, Craft['segments'][number]>;
  nested?: ByteWriter;
  fullGeneration: number;
  fullOffset: number;
  fullLength: number;
  deltaGeneration: number;
  deltaOffset: number;
  deltaLength: number;
};

const records = new WeakMap<GameObject, BinaryRecord>();

const recordOf = (source: GameObject) => {
  let record = records.get(source);

  if (!record) {
    record = {
      source,
      batchGeneration: -1,
      revision: 0,
      previousRevision: 0,
      fields: Array.from({ length: fieldCount + 1 }, (_, id): FieldState => ({
        id,
        compare: undefined,
        wire: undefined,
        revision: 0,
      })),
      recentChanges: [],
      recentCount: 0,
      fullGeneration: -1,
      fullOffset: 0,
      fullLength: 0,
      deltaGeneration: -1,
      deltaOffset: 0,
      deltaLength: 0,
    };
    records.set(source, record);
  }
  return record;
};

const markChanged = (record: BinaryRecord, field: FieldState) => {
  field.revision = ++record.revision;
  record.recentChanges[record.recentCount++] = field;
};

const changed = (
  record: BinaryRecord,
  field: FieldState,
  compare: unknown,
  wire: unknown,
) => {
  field.compare = compare;
  field.wire = wire;
  markChanged(record, field);
};

const scalar = (
  record: BinaryRecord,
  id: number,
  value: number | string | undefined,
) => {
  const field = record.fields[id];

  if (field.compare === value) return;
  const normalized = typeof value === 'number' ? canonical(value) : value;

  if (field.compare === normalized) return;
  changed(record, field, normalized, normalized);
};

const vector = (record: BinaryRecord, id: number, value?: Vec.Value) => {
  const field = record.fields[id];

  if (!value) {
    if (field.compare !== undefined) {
      changed(record, field, undefined, undefined);
    }
    return;
  }
  const before = field.compare as Vec.Value | undefined;

  if (before && before.x === value.x && before.y === value.y) return;

  if (before) Vec.set(before, value);
  else field.compare = Vec.clone(value);
  field.wire = value;
  markChanged(record, field);
};

const numberArray = (record: BinaryRecord, id: number, value?: number[]) => {
  const field = record.fields[id];

  if (!value) {
    if (field.compare !== undefined) {
      changed(record, field, undefined, undefined);
    }
    return;
  }

  if (sameNumbers(value, field.compare as number[] | undefined)) return;
  changed(record, field, [...value], value);
};

const stringArray = (
  record: BinaryRecord,
  id: number,
  value?: readonly string[],
) => {
  const field = record.fields[id];

  if (!value) {
    if (field.compare !== undefined) {
      changed(record, field, undefined, undefined);
    }
    return;
  }

  if (sameStrings(value, field.compare as string[] | undefined)) return;
  changed(record, field, [...value], value);
};

const outline = (record: BinaryRecord, id: number, value?: number[][]) => {
  const field = record.fields[id];

  if (!value) {
    if (field.compare !== undefined) {
      changed(record, field, undefined, undefined);
    }
    return;
  }

  if (sameOutline(value, field.compare as number[][] | undefined)) return;
  changed(record, field, copyOutline(value), value);
};

const asteroidSegments = (record: BinaryRecord, value?: AsteroidSegment[]) => {
  const field = record.fields[Field.segments];

  if (!value) {
    if (field.compare !== undefined) {
      changed(record, field, undefined, undefined);
    }
    return;
  }

  if (sameSegments(value, field.compare as AsteroidSegment[] | undefined)) {
    return;
  }
  const copy = copySegments(value);

  changed(record, field, copy, copy);
};

const modules = (record: BinaryRecord, value?: ModuleState[]) => {
  const field = record.fields[Field.modules];

  if (field.compare === value) return;
  changed(record, field, value, value);
};

const hullHealth = (entity: Craft, record: BinaryRecord) => {
  const hulls = (record.hulls ||= new Map<
    unknown,
    Craft['segments'][number]
  >());

  hulls.clear();

  for (const segment of entity.segments) {
    if (segment.hull && !hulls.has(segment.module)) {
      hulls.set(segment.module, segment);
    }
  }
  const field = record.fields[Field.hullHealth];
  const previous = field.wire as number[] | undefined;
  const plans = entity.hullSegments;
  let values =
    previous?.length === plans.length
      ? previous
      : Array.from({ length: plans.length }, () => 0);

  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    const value = plan.health === undefined ? -1 : hulls.get(plan)?.health || 0;

    if (
      previous &&
      values === previous &&
      canonical(previous[index]) !== canonical(value)
    ) {
      values = previous.slice();
    }

    if (values !== previous) values[index] = value;
  }

  if (values !== previous) {
    Object.freeze(values);
    changed(record, field, values, values);
  }
};

const sameBytes = (a: Uint8Array, b?: Uint8Array) => {
  if (!b || a.length !== b.length) return false;

  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const captureBytes = (
  record: BinaryRecord,
  id: number,
  write: (writer: ByteWriter) => void,
) => {
  const scratch = (record.nested ||= new ByteWriter());
  const field = record.fields[id];

  scratch.reset();
  write(scratch);

  if (
    sameBytes(
      scratch.data.subarray(0, scratch.length),
      field.compare as Uint8Array | undefined,
    )
  ) {
    return;
  }
  const bytes = scratch.copy();

  changed(record, field, bytes, bytes);
};

const clear = (record: BinaryRecord, id: number) => {
  const field = record.fields[id];

  if (field.compare !== undefined) changed(record, field, undefined, undefined);
};

const prepare = (
  source: GameObject,
  batch: BinarySnapshotBatch,
): BinaryRecord => {
  const record = recordOf(source);

  if (record.batchGeneration === batch.generation) return record;
  record.batchGeneration = batch.generation;
  record.previousRevision = record.revision;
  record.recentCount = 0;

  if (source instanceof Asteroid) {
    numberArray(
      record,
      Field.contents,
      source.contents.length ? source.contents : undefined,
    );
    scalar(record, Field.decay, source.decay);
    scalar(
      record,
      Field.maxHealth,
      source.maxHealth !== source.radius * 2 ? source.maxHealth : undefined,
    );
    outline(record, Field.shapeOutline, source.shapeOutline);
    asteroidSegments(
      record,
      source.shapeOutline || source.damaged ? source.segments : undefined,
    );
  }

  if (source instanceof Craft) {
    const cargo = source.cargoContents;

    if (cargo.length) {
      captureBytes(record, Field.cargoContents, (writer) => {
        writer.unsigned(cargo.length);
        const sourceModules = source.modules;

        for (const object of cargo) {
          if (object instanceof Module) {
            writer.byte(0);
            writer.number(sourceModules.indexOf(object));
          } else {
            writer.byte(1);
            writeRecord(writer, prepare(object, batch), -1);
          }
        }
      });
    } else clear(record, Field.cargoContents);
    scalar(record, Field.credits, source.credits);
    scalar(record, Field.dockedTo, source.dockedTo);

    if (!(source instanceof Station)) hullHealth(source, record);
    scalar(record, Field.launching, source.launching);
    scalar(record, Field.maxSpeed, source.maxSpeed);
    modules(record, readModules(source));
    const wreckage = source.wreckage;

    if (wreckage) {
      captureBytes(record, Field.wreckage, (writer) =>
        writeWreckage(writer, wreckage),
      );
    } else clear(record, Field.wreckage);
    scalar(record, Field.decay, source.decay);
    stringArray(
      record,
      Field.shades,
      source.shades === (source.constructor as typeof Craft).shades
        ? undefined
        : source.shades,
    );
  }

  if (source instanceof Ship) {
    scalar(record, Field.thrust, source.thrust);
    scalar(record, Field.turn, source.turn);
  }
  scalar(
    record,
    Field.friction,
    source.friction !== (source.constructor as typeof GameObject).friction
      ? source.friction
      : undefined,
  );
  scalar(
    record,
    Field.health,
    (source instanceof Asteroid && source.health === source.radius * 2) ||
      (source instanceof Craft && source.health === 100)
      ? undefined
      : source.health,
  );
  scalar(record, Field.label, source.label);
  scalar(record, Field.message, source.message);
  scalar(record, Field.paint, source.paint);
  scalar(record, Field.playerId, source.playerId);
  scalar(record, Field.pointCount, source.pointCount);
  scalar(record, Field.radiusEven, source.radiusEven);
  scalar(record, Field.resource, source.resource);
  scalar(
    record,
    Field.kind,
    source instanceof Asteroid
      ? 'asteroid'
      : source instanceof Item
        ? 'item'
        : source instanceof Station
          ? 'station'
          : source instanceof Craft
            ? 'ship'
            : 'object',
  );
  scalar(
    record,
    Field.mass,
    source instanceof Asteroid && source.mass === 0.4 * source.radius ** 2
      ? undefined
      : source.mass,
  );
  scalar(
    record,
    Field.pendingUpdateTime,
    source.pendingUpdateTime || undefined,
  );
  vector(record, Field.position, source.position);
  scalar(record, Field.radius, source.radius);
  scalar(record, Field.rotation, source.rotation);
  scalar(record, Field.spin, source.spin);
  vector(
    record,
    Field.velocity,
    source.velocity.x || source.velocity.y ? source.velocity : undefined,
  );
  return record;
};

const writeKind = (writer: ByteWriter, kind: string) => {
  writer.byte(
    kind === 'asteroid'
      ? entityKindIds.asteroid
      : kind === 'item'
        ? entityKindIds.item
        : kind === 'ship'
          ? entityKindIds.ship
          : kind === 'station'
            ? entityKindIds.station
            : entityKindIds.object,
  );
};

const writeField = (writer: ByteWriter, id: number, value: unknown) => {
  switch (id) {
    case Field.cargoContents:
    case Field.wreckage:
      writer.bytes(value as Uint8Array);
      break;
    case Field.contents:

    case Field.hullHealth:
      writeNumbers(writer, value as number[]);
      break;

    case Field.modules:
      writeModules(writer, value as ModuleState[]);
      break;

    case Field.shapeOutline:
      writeOutline(writer, value as number[][]);
      break;

    case Field.shades:
      writeStrings(writer, value as string[]);
      break;

    case Field.segments:
      writeSegments(writer, value as AsteroidSegment[]);
      break;
    case Field.position:

    case Field.velocity:
      writeVector(writer, value as Vec.Value);
      break;

    case Field.kind:
      writeKind(writer, value as string);
      break;
    case Field.label:

    case Field.message:
      writer.string(value as string);
      break;

    default:
      writer.number(value as number);
  }
};

const writeRecord = (
  writer: ByteWriter,
  record: BinaryRecord,
  baseline: number,
  replaced?: BinaryRecord,
) => {
  writer.unsigned(record.source.id);
  const countAt = writer.length;

  writer.byte(0);
  let count = 0;

  const recent = baseline >= 0 && baseline >= record.previousRevision;
  const fields = recent ? record.recentChanges : record.fields;
  const start = +!recent;
  const end = recent ? record.recentCount : fieldCount + 1;

  for (let index = start; index < end; index++) {
    const field = fields[index];
    const id = field.id;
    const removedFromReplacement =
      replaced?.fields[id].wire !== undefined && field.wire === undefined;
    const included =
      baseline < 0
        ? field.wire !== undefined || removedFromReplacement
        : field.revision > baseline;

    if (!included) continue;
    const clear = field.wire === undefined || field.wire === null;

    writer.byte((id << 1) | +clear);

    if (!clear) writeField(writer, id, field.wire);
    count++;
  }
  writer.countAt(countAt, count);
  return count;
};

type Fragment = { offset: number; length: number };

let nextBatchGeneration = 0;

export class BinarySnapshotBatch {
  readonly records = new Map<EntityId, BinaryRecord>();
  readonly arena = new ByteWriter(4096);
  generation = 0;
  view?: ReplicationView;

  begin(view: ReplicationView) {
    this.generation = ++nextBatchGeneration;
    this.view = view;
    this.records.clear();
    this.arena.reset();
    return this;
  }

  prepared(source: GameObject) {
    let record = this.records.get(source.id);

    if (!record || record.source !== source) {
      record = prepare(source, this);
      this.records.set(source.id, record);
    }
    return record;
  }

  fragment(
    record: BinaryRecord,
    baseline: number,
    replaced?: BinaryRecord,
  ): Fragment | undefined {
    const full = baseline < 0;

    if (full && !replaced && record.fullGeneration === this.generation) {
      return { offset: record.fullOffset, length: record.fullLength };
    }

    if (!full && baseline >= record.revision) return;

    if (
      !full &&
      baseline === record.previousRevision &&
      record.deltaGeneration === this.generation
    ) {
      return record.deltaLength
        ? { offset: record.deltaOffset, length: record.deltaLength }
        : undefined;
    }
    const offset = this.arena.length;
    const count = writeRecord(this.arena, record, baseline, replaced);
    const length = this.arena.length - offset;

    if (!count) this.arena.length = offset;

    if (full && !replaced) {
      record.fullGeneration = this.generation;
      record.fullOffset = offset;
      record.fullLength = count ? length : 0;
    }

    if (!full && baseline === record.previousRevision) {
      record.deltaGeneration = this.generation;
      record.deltaOffset = offset;
      record.deltaLength = count ? length : 0;
    }
    return count ? { offset, length } : undefined;
  }
}

type SnapshotOptions = {
  world: SimulationWorld;
  shipId: EntityId;
  position?: Vec.Value;
  acknowledgedSequence?: number;
  inputLead?: number;
  snapshotSequence?: number;
  replicationView?: ReplicationView;
  binaryBatch?: BinarySnapshotBatch;
};

export class BinaryReplicationManager {
  private snapshotTick = 0;
  private stamp = 0;
  private writer = new ByteWriter(4096);
  private entityIds: EntityId[] = [];
  private offsets: number[] = [];
  private lengths: number[] = [];
  private members = new Map<
    EntityId,
    { record: BinaryRecord; revision: number; seen: number }
  >();

  initial(options: SnapshotOptions) {
    this.members.clear();
    return this.encode(options, true);
  }

  snapshot(options: SnapshotOptions) {
    return this.encode(options, false);
  }

  private encode(
    {
      world,
      shipId,
      position,
      acknowledgedSequence,
      inputLead,
      snapshotSequence,
      replicationView,
      binaryBatch,
    }: SnapshotOptions,
    load: boolean,
  ) {
    const view = replicationView || new ReplicationView(world);
    const batch = binaryBatch || new BinarySnapshotBatch().begin(view);
    const list = view.entities();
    const { kinds, phases } = view;
    const ship = world.entities.get(shipId) || { position: position! };
    const shipX = ship.position.x;
    const shipY = ship.position.y;
    const members = this.members;
    const stamp = ++this.stamp;
    const previousSize = members.size;
    const entityIds = this.entityIds;
    let retained = 0;
    let membershipChanged = false;
    let updates = 0;

    entityIds.length = 0;

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
      const phase = ballistic ? phases[index] : 0;

      if (
        loaded &&
        (world.tick + phase) % interval &&
        Math.floor((world.tick + phase) / interval) ===
          Math.floor((this.snapshotTick + phase) / interval)
      ) {
        continue;
      }
      const prepared = batch.prepared(entity);
      const previousRecord = previous?.record;
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
      const fragment = batch.fragment(
        prepared,
        revision,
        previousRecord === prepared ? undefined : previousRecord,
      );

      if (fragment) {
        this.offsets[updates] = fragment.offset;
        this.lengths[updates++] = fragment.length;
      }
    }
    membershipChanged ||= retained !== previousSize;
    this.snapshotTick = world.tick;

    if (membershipChanged) {
      members.forEach(({ seen }, id) => {
        if (seen !== stamp) members.delete(id);
      });
    }
    const writer = this.writer;
    const flags =
      +load |
      (+(membershipChanged && !load) << 1) |
      (+(acknowledgedSequence !== undefined) << 2) |
      (+(inputLead !== undefined) << 3) |
      (+(snapshotSequence !== undefined) << 4);

    writer.reset();
    writer.byte(0x55);
    writer.byte(0x4d);
    writer.byte(1);
    writer.byte(flags);
    writer.unsigned(world.tick);
    writer.unsigned(world.nextEntityId);

    if (acknowledgedSequence !== undefined) {
      writer.unsigned(acknowledgedSequence);
    }

    if (inputLead !== undefined) writer.signed(inputLead);

    if (snapshotSequence !== undefined) writer.unsigned(snapshotSequence);

    if (membershipChanged && !load) {
      writer.unsigned(entityIds.length);

      for (const id of entityIds) writer.unsigned(id);
    }
    writer.unsigned(updates);

    for (let index = 0; index < updates; index++) {
      writer.bytes(batch.arena.data, this.offsets[index], this.lengths[index]);
    }
    // The socket can retain the packet after send; the writer's backing store
    // must not be reused until its contents have been copied.
    return writer.copy();
  }
}
