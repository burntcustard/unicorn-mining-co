import * as Vec from '../utilities/vector';
import { colors } from '../../specs/colors';
import type { ReplicatedEntity, ServerMessage } from './network';
import {
  binaryFieldIds as BinaryField,
  entityKindIds,
} from '../../specs/protocol';

export { binaryFieldIds as BinaryField } from '../../specs/protocol';

const motionView = new DataView(new ArrayBuffer(8));

type SnapshotMessage = Extract<ServerMessage, { type: 'load' | 'snapshot' }>;

type WireEntity = { id: number } & {
  [Key in Exclude<keyof ReplicatedEntity, 'id'>]?: ReplicatedEntity[Key] | null;
};

const modulePalettes = Object.values(colors);
const inheritedModule = {} as NonNullable<ReplicatedEntity['modules']>[number];
const inheritedShades: readonly string[] = Object.freeze([]);

/**
 * Restore module entries and shades before retaining a received snapshot.
 */
export const mergeModuleStates = (
  record: Pick<WireEntity, 'modules'>,
  previous?: Pick<ReplicatedEntity, 'modules'>,
) => {
  const modules = record.modules;

  if (!modules) return;

  for (let index = 0; index < modules.length; index++) {
    const module = modules[index];

    if (module !== inheritedModule && module.shades !== inheritedShades) {
      continue;
    }

    const before = previous?.modules?.[index];

    if (!before || previous?.modules?.length !== modules.length) {
      throw new Error('Missing module baseline');
    }

    if (module === inheritedModule) {
      modules[index] = before;
      continue;
    }

    if (
      module.id === undefined ||
      module.id !== before.id ||
      module.type !== before.type ||
      module.mount !== before.mount ||
      before.shades === undefined ||
      before.shades === inheritedShades
    ) {
      throw new Error('Missing module shade baseline');
    }

    module.shades = before.shades;
  }
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

  // Compact module integers stay within the exact Number-based zigzag range.
  const compactSigned = () => {
    const value = unsigned();

    return value % 2 ? -(value + 1) / 2 : value / 2;
  };

  const motionNumber = (omitted: 2 | 3) => {
    if (bytes.length - offset < 8 - omitted) return fail();
    const low =
      omitted === 2
        ? view.getUint16(offset, true) << 16
        : view.getUint8(offset) << 24;
    const high = view.getUint32(offset + 4 - omitted, true);

    offset += 8 - omitted;
    motionView.setUint32(0, low, true);
    motionView.setUint32(4, high, true);
    const value = motionView.getFloat64(0, true);

    return Number.isFinite(value) ? value || 0 : null;
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

  const control = () => {
    const code = byte();

    if (code === 3) return number();

    if (code > 2) return fail();
    return code === 2 ? -1 : code;
  };

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

  const modules = (allowPartial: boolean) => {
    const header = unsigned();
    const partial = header % 2 === 1;
    const length = Math.floor(header / 2);

    if (length > bytes.length * 8 || (partial && !allowPartial)) return fail();
    const changed: number[] = [];

    if (partial) {
      for (let index = 0; index < Math.ceil(length / 8); index++) {
        changed.push(byte());
      }

      if (length % 8 && changed.at(-1)! >> (length % 8)) return fail();
    }

    const values: NonNullable<ReplicatedEntity['modules']> = [];

    for (let index = 0; index < length; index++) {
      if (partial && !(changed[Math.floor(index / 8)] & (1 << (index % 8)))) {
        values.push(inheritedModule);
        continue;
      }

      const mask = byte();

      if (mask & 128 && (!partial || !(mask & 1) || mask & 4)) return fail();
      const type = compactSigned();
      const mount = compactSigned();
      const id = mask & 1 ? compactSigned() : undefined;
      const health = mask & 2 ? (number() as number) : undefined;
      let moduleShades: readonly string[] | undefined;

      if (mask & 4) {
        moduleShades = modulePalettes[byte()];

        if (!moduleShades) return fail();
      } else if (mask & 128) {
        moduleShades = inheritedShades;
      }

      const fireCooldown = mask & 8 ? (number() as number) : undefined;
      const chargeCooldown = mask & 16 ? (number() as number) : undefined;
      const healthActivated = mask & 32 ? (number() as number) : undefined;
      const aimRotation = mask & 64 ? (number() as number) : undefined;
      const segmentCount = count(1);
      const segments: (typeof values)[number]['segments'] = [];

      for (let segment = 0; segment < segmentCount; segment++) {
        const flags = byte();
        const activeCode = flags & 3;
        const progressCode = (flags >> 2) & 3;

        if (flags & 0xf0 || activeCode === 3 || progressCode === 3) {
          return fail();
        }

        const active = (activeCode === 2 ? number() : activeCode) as number;
        const activationProgress = (
          progressCode === 2 ? number() : progressCode
        ) as number;

        segments.push({ active, activationProgress });
      }

      values.push({
        type,
        mount,
        ...(mask & 1 && { id }),
        ...(mask & 2 && { health }),
        ...(mask & 132 && { shades: moduleShades }),
        ...(mask & 8 && { fireCooldown }),
        ...(mask & 16 && { chargeCooldown }),
        ...(mask & 32 && { healthActivated }),
        ...(mask & 64 && { aimRotation }),
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

      if (mask & ~15) return fail();
      const radius = number() as number;
      const segmentOffset = vector();
      const health = number() as number;
      const shapeOutline = mask & 1 ? outline() : undefined;
      const fillShade = mask & 2 ? (number() as number) : undefined;
      const color = mask & 8 ? string() : undefined;
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
        ...(mask & 8 && { color }),
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

      case entityKindIds.jumpGate:
        return 'jumpGate';

      case entityKindIds.wormhole:
        return 'wormhole';

      case entityKindIds.navBeacon:
        return 'navBeacon';

      case entityKindIds.station:
        return 'station';

      case entityKindIds.projectile:
        return 'projectile';

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
      let field = Math.floor(tag / 2);
      const clear = !!(tag % 2);
      let packedMotion = true;

      switch (tag) {
        case BinaryField.packedPosition * 2:
          field = BinaryField.position;
          break;

        case BinaryField.packedVelocity * 2:
          field = BinaryField.velocity;
          break;

        case BinaryField.packedRotation * 2:
          field = BinaryField.rotation;
          break;

        case BinaryField.packedSpin * 2:
          field = BinaryField.spin;
          break;

        default:
          packedMotion = false;
      }

      if (field < 1 || field > BinaryField.npcState || seen.has(field)) {
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

        case BinaryField.opening:
          entity.opening = clear ? null : number();
          break;

        case BinaryField.openingTarget:
          entity.openingTarget = clear ? null : number();
          break;

        case BinaryField.blockedBeams:
          entity.blockedBeams = clear ? null : number();
          break;

        case BinaryField.destinationName:
          entity.destinationName = clear ? null : string();
          break;

        case BinaryField.targetLabel:
          entity.targetLabel = clear ? null : string();
          break;

        case BinaryField.name:
          entity.name = clear ? null : string();
          break;

        case BinaryField.npcState:
          entity.npcState = clear ? null : string();
          break;

        case BinaryField.transitTime:
          entity.transitTime = clear ? null : number();
          break;

        case BinaryField.transitGate:
          entity.transitGate = clear ? null : number();
          break;

        case BinaryField.launching:
          entity.launching = clear ? null : number();
          break;

        case BinaryField.hostile: {
          const value = clear ? null : byte();

          if (value !== null && value > 1) return fail();
          entity.hostile = value === null ? null : value === 1;
          break;
        }

        case BinaryField.firing: {
          const value = clear ? null : byte();

          if (value !== null && value > 1) return fail();
          entity.firing = value === null ? null : value === 1;
          break;
        }

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
          entity.modules = clear ? null : modules(depth === 0 && !(flags & 1));
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
          entity.position = clear
            ? null
            : packedMotion
              ? Vec.create(motionNumber(2), motionNumber(2))
              : vector();
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
          entity.rotation = clear
            ? null
            : packedMotion
              ? motionNumber(3)
              : number();
          break;

        case BinaryField.spin:
          entity.spin = clear
            ? null
            : packedMotion
              ? motionNumber(3)
              : number();
          break;

        case BinaryField.segments:
          entity.segments = clear ? null : segments();
          break;

        case BinaryField.thrust:
          entity.thrust = clear ? null : control();
          break;

        case BinaryField.turn:
          entity.turn = clear ? null : control();
          break;

        case BinaryField.velocity:
          entity.velocity = clear
            ? null
            : packedMotion
              ? Vec.create(motionNumber(2), motionNumber(2))
              : vector();
          break;

        case BinaryField.storedPower:
          entity.storedPower = clear ? null : number();
          break;

        case BinaryField.fuel:
          entity.fuel = clear ? null : number();
          break;

        case BinaryField.rounds:
          entity.rounds = clear ? null : number();
          break;
      }
    }

    return entity as ReplicatedEntity;
  };

  if (byte() !== 0x55 || byte() !== 0x4d || byte() !== 1) return fail();
  const flags = byte();

  if (flags & ~127) return fail();
  const serverTick = unsigned();
  const nextEntityId = unsigned();
  const acknowledgedSequence = flags & 4 ? unsigned() : undefined;
  let inputLead: number | undefined;

  if (flags & 8) inputLead = signed();
  const snapshotSequence = flags & 16 ? unsigned() : undefined;
  const acknowledgedDockSequence = flags & 32 ? unsigned() : undefined;
  const credits = flags & 32 ? number() : undefined;
  const dockIds: [number, number][] = [];

  if (flags & 32) {
    if (credits === undefined || !Number.isFinite(credits) || credits < 0) {
      return fail();
    }

    const length = count(2);

    for (let index = 0; index < length; index++) {
      dockIds.push([signed(), signed()]);
    }
  }

  let asteroidPositions: Vec.Value[] | undefined;

  if (flags & 64) {
    const length = count(16);

    asteroidPositions = [];

    for (let index = 0; index < length; index++) {
      const x = number();
      const y = number();

      if (x === null || y === null) return fail();
      asteroidPositions.push(Vec.create(x, y));
    }
  }

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
    ...(acknowledgedDockSequence !== undefined && {
      acknowledgedDockSequence,
      credits,
      dockIds,
    }),
    ...(entityIds && { entityIds }),
    ...(asteroidPositions && { asteroidPositions }),
    fullEntities,
  };
}
