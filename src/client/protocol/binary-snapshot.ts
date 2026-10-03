import * as Vec from '../utilities/vector';
import type { ReplicatedEntity, ServerMessage } from './network';
import {
  binaryFieldIds as BinaryField,
  entityKindIds,
} from '../../definitions/protocol';

export { binaryFieldIds as BinaryField } from '../../definitions/protocol';

type SnapshotMessage = Extract<ServerMessage, { type: 'load' | 'snapshot' }>;

type WireEntity = { id: number } & {
  [Key in Exclude<keyof ReplicatedEntity, 'id'>]?: ReplicatedEntity[Key] | null;
};

/**
 * Read a fixed-schema snapshot, retaining the same record and clear-field
 * shapes as JSON snapshots so NetworkClient can use its usual reconciliation.
 */
export function decodeBinarySnapshot(
  data: ArrayBuffer | Uint8Array,
): SnapshotMessage {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const fail = (): never => {
    throw new Error('Invalid binary snapshot');
  };

  const byte = () => {
    if (offset >= bytes.length) return fail();
    return bytes[offset++];
  };

  const unsigned = () => {
    let value = 0;
    let place = 1;

    for (let index = 0; index < 8; index++) {
      const part = byte();
      const digit = part & 127;

      if (digit > Math.floor((Number.MAX_SAFE_INTEGER - value) / place)) {
        return fail();
      }

      value += digit * place;

      if (!(part & 128)) {
        if (index && !digit) return fail();
        return value;
      }

      place *= 128;
    }

    return fail();
  };

  const signed = () => {
    let value = 0n;
    let place = 1n;

    for (let index = 0; index < 8; index++) {
      const part = byte();
      const digit = part & 127;

      value += BigInt(digit) * place;

      if (!(part & 128)) {
        if (index && !digit) return fail();
        const decoded = value % 2n ? -(value + 1n) / 2n : value / 2n;

        if (
          decoded < -BigInt(Number.MAX_SAFE_INTEGER) ||
          decoded > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          return fail();
        }

        return Number(decoded);
      }

      place *= 128n;
    }

    return fail();
  };

  const count = (minimumBytes: number) => {
    const value = unsigned();

    if (value > Math.floor((bytes.length - offset) / minimumBytes)) {
      return fail();
    }

    return value;
  };

  const number = () => {
    if (bytes.length - offset < 8) return fail();
    const value = view.getFloat64(offset, true);

    offset += 8;
    return Number.isFinite(value) ? value || 0 : null;
  };

  const string = () => {
    const length = count(2);
    let value = '';

    for (let index = 0; index < length; index++) {
      value += String.fromCharCode(view.getUint16(offset, true));
      offset += 2;
    }

    return value;
  };

  const vector = () => Vec.create(number() as number, number() as number);

  const numbers = () => {
    const length = count(8);
    const values: number[] = [];

    for (let index = 0; index < length; index++) {
      values.push(number() as number);
    }

    return values;
  };

  const outline = () => {
    const length = count(1);
    const outlines: number[][] = [];

    for (let index = 0; index < length; index++) outlines.push(numbers());
    return outlines;
  };

  const shades = () => {
    const length = count(1);
    const values: string[] = [];

    for (let index = 0; index < length; index++) values.push(string());
    return values;
  };

  const modules = () => {
    const length = count(18);
    const values: NonNullable<ReplicatedEntity['modules']> = [];

    for (let index = 0; index < length; index++) {
      const mask = byte();

      if (mask & ~7) return fail();
      const type = number() as number;
      const mount = number() as number;
      const id = mask & 1 ? (number() as number) : undefined;
      const health = mask & 2 ? (number() as number) : undefined;
      const moduleShades = mask & 4 ? shades() : undefined;
      const segmentCount = count(16);
      const segments: (typeof values)[number]['segments'] = [];

      for (let segment = 0; segment < segmentCount; segment++) {
        segments.push({
          active: number() as number,
          activationProgress: number() as number,
        });
      }

      values.push({
        type,
        mount,
        ...(mask & 1 && { id }),
        ...(mask & 2 && { health }),
        ...(mask & 4 && { shades: moduleShades }),
        segments,
      });
    }

    return values;
  };

  const wreckage = () => {
    const length = count(33);
    const values: NonNullable<ReplicatedEntity['wreckage']> = [];

    for (let index = 0; index < length; index++) {
      const mask = byte();

      if (mask & ~7) return fail();
      const radius = number() as number;
      const segmentOffset = vector();
      const health = number() as number;
      const shapeOutline = mask & 1 ? outline() : undefined;
      const fillShade = mask & 2 ? (number() as number) : undefined;
      let stroke: number[][][] | undefined;

      if (mask & 4) {
        const strokeCount = count(1);

        stroke = [];

        for (let segment = 0; segment < strokeCount; segment++) {
          stroke.push(outline());
        }
      }

      values.push({
        radius,
        offset: segmentOffset,
        health,
        ...(mask & 1 && { shapeOutline }),
        ...(mask & 2 && { fillShade }),
        ...(mask & 4 && { stroke }),
      });
    }

    return values;
  };

  const segments = () => {
    const length = count(26);
    const values: NonNullable<ReplicatedEntity['segments']> = [];

    for (let index = 0; index < length; index++) {
      values.push({
        contents: numbers(),
        health: number() as number,
        mass: number() as number,
        maxHealth: number() as number,
        shapeOutline: outline(),
      });
    }

    return values;
  };

  const kind = (): ReplicatedEntity['kind'] => {
    switch (byte()) {
      case entityKindIds.asteroid:
        return 'asteroid';

      case entityKindIds.item:
        return 'item';

      case entityKindIds.ship:
        return 'ship';

      case entityKindIds.station:
        return 'station';

      case entityKindIds.object:
        return 'object';

      default:
        return fail();
    }
  };

  const record = (depth: number): ReplicatedEntity => {
    if (depth > 32) return fail();
    const entity: WireEntity = { id: unsigned() };
    const fieldCount = count(1);
    const seen = new Set<number>();

    for (let index = 0; index < fieldCount; index++) {
      const tag = unsigned();
      const field = Math.floor(tag / 2);
      const clear = !!(tag % 2);

      if (field < 1 || field > BinaryField.definitionId || seen.has(field)) {
        return fail();
      }

      seen.add(field);

      switch (field) {
        case BinaryField.cargoContents: {
          if (clear) {
            entity.cargoContents = null;
            break;
          }

          const length = count(3);
          const contents: NonNullable<ReplicatedEntity['cargoContents']> = [];

          for (let cargo = 0; cargo < length; cargo++) {
            switch (byte()) {
              case 0:
                contents.push({ moduleIndex: number() as number });
                break;

              case 1:
                contents.push(record(depth + 1));
                break;

              default:
                return fail();
            }
          }

          entity.cargoContents = contents;
          break;
        }

        case BinaryField.credits:
          entity.credits = clear ? null : number();
          break;

        case BinaryField.contents:
          entity.contents = clear ? null : numbers();
          break;

        case BinaryField.decay:
          entity.decay = clear ? null : number();
          break;

        case BinaryField.friction:
          entity.friction = clear ? null : number();
          break;

        case BinaryField.dockedTo:
          entity.dockedTo = clear ? null : number();
          break;

        case BinaryField.health:
          entity.health = clear ? null : number();
          break;

        case BinaryField.hullHealth:
          entity.hullHealth = clear ? null : numbers();
          break;

        case BinaryField.kind:
          entity.kind = clear ? null : kind();
          break;

        case BinaryField.definitionId:
          entity.definitionId = clear ? null : string();
          break;

        case BinaryField.label:
          entity.label = clear ? null : string();
          break;

        case BinaryField.launching:
          entity.launching = clear ? null : number();
          break;

        case BinaryField.mass:
          entity.mass = clear ? null : number();
          break;

        case BinaryField.message:
          entity.message = clear ? null : string();
          break;

        case BinaryField.pendingUpdateTime:
          entity.pendingUpdateTime = clear ? null : number();
          break;

        case BinaryField.maxSpeed:
          entity.maxSpeed = clear ? null : number();
          break;

        case BinaryField.maxHealth:
          entity.maxHealth = clear ? null : number();
          break;

        case BinaryField.modules:
          entity.modules = clear ? null : modules();
          break;

        case BinaryField.wreckage:
          entity.wreckage = clear ? null : wreckage();
          break;

        case BinaryField.shapeOutline:
          entity.shapeOutline = clear ? null : outline();
          break;

        case BinaryField.paint:
          entity.paint = clear ? null : number();
          break;

        case BinaryField.shades:
          entity.shades = clear ? null : shades();
          break;

        case BinaryField.playerId:
          entity.playerId = clear ? null : number();
          break;

        case BinaryField.pointCount:
          entity.pointCount = clear ? null : number();
          break;

        case BinaryField.position:
          entity.position = clear ? null : vector();
          break;

        case BinaryField.radius:
          entity.radius = clear ? null : number();
          break;

        case BinaryField.radiusEven:
          entity.radiusEven = clear ? null : number();
          break;

        case BinaryField.resource:
          entity.resource = clear ? null : number();
          break;

        case BinaryField.rotation:
          entity.rotation = clear ? null : number();
          break;

        case BinaryField.spin:
          entity.spin = clear ? null : number();
          break;

        case BinaryField.segments:
          entity.segments = clear ? null : segments();
          break;

        case BinaryField.thrust:
          entity.thrust = clear ? null : number();
          break;

        case BinaryField.turn:
          entity.turn = clear ? null : number();
          break;

        case BinaryField.velocity:
          entity.velocity = clear ? null : vector();
          break;
      }
    }

    return entity as ReplicatedEntity;
  };

  if (byte() !== 0x55 || byte() !== 0x4d || byte() !== 1) return fail();
  const flags = byte();

  if (flags & ~31) return fail();
  const serverTick = unsigned();
  const nextEntityId = unsigned();
  const acknowledgedSequence = flags & 4 ? unsigned() : undefined;
  let inputLead: number | undefined;

  if (flags & 8) inputLead = signed();
  const snapshotSequence = flags & 16 ? unsigned() : undefined;
  let entityIds: number[] | undefined;

  if (flags & 2) {
    const length = count(1);

    entityIds = [];

    for (let index = 0; index < length; index++) entityIds.push(unsigned());
  }

  const length = count(2);
  const fullEntities: ReplicatedEntity[] = [];

  for (let index = 0; index < length; index++) fullEntities.push(record(0));

  if (offset !== bytes.length) return fail();

  return {
    type: flags & 1 ? 'load' : 'snapshot',
    serverTick,
    nextEntityId,
    ...(acknowledgedSequence !== undefined && { acknowledgedSequence }),
    ...(inputLead !== undefined && { inputLead }),
    ...(snapshotSequence !== undefined && { snapshotSequence }),
    ...(entityIds && { entityIds }),
    fullEntities,
  };
}
