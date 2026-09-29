import * as Vec from '../vector';
import { simulationStep } from '../settings';
import { packPlayerInput, unpackPlayerInput } from './input';
import type { ClientMessage, ServerMessage } from './network';

type ServerControl = Extract<ServerMessage, { type: 'welcome' | 'respawn' }>;

const hello = 0;
const input = 1;
const dock = 2;
const respawn = 3;
const snapshotAck = 4;
const welcome = 5;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = '0123456789abcdef';

export const isPlayerToken = (value: string | null): value is string =>
  value !== null && uuidPattern.test(value);

class ControlWriter {
  private bytes: number[];
  private numberBuffer = new ArrayBuffer(8);
  private numberView = new DataView(this.numberBuffer);
  private numberBytes = new Uint8Array(this.numberBuffer);

  constructor(type: number) {
    this.bytes = [0x55, 0x43, 1, type];
  }

  byte(value: number) {
    this.bytes.push(value);
  }

  unsigned(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Invalid binary control integer');
    }

    do {
      const digit = value % 128;

      value = Math.floor(value / 128);
      this.byte(digit | (value ? 128 : 0));
    } while (value);
  }

  signed(value: number) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError('Invalid binary control integer');
    }
    let encoded = value < 0 ? -BigInt(value) * 2n - 1n : BigInt(value) * 2n;

    do {
      const digit = Number(encoded % 128n);

      encoded /= 128n;
      this.byte(digit | (encoded ? 128 : 0));
    } while (encoded);
  }

  number(value: number) {
    if (!Number.isFinite(value)) {
      throw new RangeError('Invalid binary control number');
    }
    this.numberView.setFloat64(0, value || 0, true);
    this.bytes.push(...this.numberBytes);
  }

  uuid(value: string) {
    if (!isPlayerToken(value)) {
      throw new RangeError('Invalid binary control token');
    }
    const digits = value.replaceAll('-', '');

    for (let index = 0; index < 32; index += 2) {
      this.byte(Number.parseInt(digits.slice(index, index + 2), 16));
    }
  }

  finish(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.bytes);
  }
}

class ControlReader {
  private bytes: Uint8Array;
  private view: DataView;
  private offset = 0;
  readonly type: number;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );

    if (this.byte() !== 0x55 || this.byte() !== 0x43 || this.byte() !== 1) {
      throw new Error('Invalid binary control');
    }
    this.type = this.byte();
  }

  byte() {
    if (this.offset >= this.bytes.length) {
      throw new Error('Invalid binary control');
    }
    return this.bytes[this.offset++];
  }

  unsigned() {
    let value = 0;
    let place = 1;

    for (let index = 0; index < 8; index++) {
      const part = this.byte();
      const digit = part & 127;

      if (digit > Math.floor((Number.MAX_SAFE_INTEGER - value) / place)) {
        throw new Error('Invalid binary control');
      }
      value += digit * place;

      if (!(part & 128)) {
        if (index && !digit) throw new Error('Invalid binary control');
        return value;
      }
      place *= 128;
    }
    throw new Error('Invalid binary control');
  }

  signed() {
    let value = 0n;
    let place = 1n;

    for (let index = 0; index < 8; index++) {
      const part = this.byte();
      const digit = part & 127;

      value += BigInt(digit) * place;

      if (!(part & 128)) {
        if (index && !digit) throw new Error('Invalid binary control');
        const decoded = value % 2n ? -(value + 1n) / 2n : value / 2n;

        if (
          decoded < -BigInt(Number.MAX_SAFE_INTEGER) ||
          decoded > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          throw new Error('Invalid binary control');
        }
        return Number(decoded);
      }
      place *= 128n;
    }
    throw new Error('Invalid binary control');
  }

  number() {
    if (this.bytes.length - this.offset < 8) {
      throw new Error('Invalid binary control');
    }
    const value = this.view.getFloat64(this.offset, true);

    this.offset += 8;

    if (!Number.isFinite(value)) throw new Error('Invalid binary control');
    return value || 0;
  }

  uuid() {
    if (this.bytes.length - this.offset < 16) {
      throw new Error('Invalid binary control');
    }
    let digits = '';

    for (let index = 0; index < 16; index++) {
      const value = this.byte();

      digits += hex[value >> 4] + hex[value & 15];
    }
    return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
  }

  finish() {
    if (this.offset !== this.bytes.length) {
      throw new Error('Invalid binary control');
    }
  }
}

/**
 * Encode browser controls without JSON or protocol string tags.
 */
export function encodeClientMessage(
  message: ClientMessage,
): Uint8Array<ArrayBuffer> {
  switch (message.type) {
    case 'hello': {
      const writer = new ControlWriter(hello);

      writer.byte(+(message.playerToken !== null));

      if (message.playerToken !== null) writer.uuid(message.playerToken);
      return writer.finish();
    }

    case 'input': {
      const writer = new ControlWriter(input);
      const code = packPlayerInput(message.input);

      writer.unsigned(message.tick);
      writer.unsigned(message.sequence);
      writer.byte(code);
      writer.byte(+(message.offset !== undefined));

      if (message.offset !== undefined) {
        if (message.offset < 0 || message.offset >= simulationStep) {
          throw new RangeError('Invalid binary input offset');
        }
        writer.number(message.offset);
      }
      return writer.finish();
    }

    case 'dock': {
      const writer = new ControlWriter(dock);

      switch (message.action) {
        case 'buy':
          writer.byte(0);
          writer.unsigned(message.module);
          writer.signed(message.moduleId);
          break;

        case 'sell':
          if (message.objectIds.length < 1 || message.objectIds.length > 100) {
            throw new RangeError('Invalid binary sell count');
          }
          writer.byte(1);
          writer.byte(message.objectIds.length);
          message.objectIds.forEach((id) => writer.signed(id));
          break;

        case 'equip':
          writer.byte(2);
          writer.signed(message.moduleId);
          writer.unsigned(message.mount);
          break;

        case 'remove':
          writer.byte(3);
          writer.unsigned(message.mount);
          break;
        case 'paint':

        case 'repair': {
          writer.byte(message.action === 'paint' ? 4 : 5);

          if (message.action === 'paint') writer.unsigned(message.paint);
          const mask =
            +(message.moduleId !== undefined) |
            (+(message.mount !== undefined) << 1);

          writer.byte(mask);

          if (message.moduleId !== undefined) writer.signed(message.moduleId);

          if (message.mount !== undefined) writer.signed(message.mount);
          break;
        }
      }
      return writer.finish();
    }

    case 'respawn':
      return new ControlWriter(respawn).finish();

    case 'snapshotAck': {
      const writer = new ControlWriter(snapshotAck);

      writer.unsigned(message.sequence);
      return writer.finish();
    }
  }
}

/**
 * Decode a client control frame; malformed or non-client frames throw.
 */
export function decodeClientMessage(
  data: ArrayBuffer | Uint8Array,
): ClientMessage {
  const reader = new ControlReader(data);
  let message: ClientMessage;

  switch (reader.type) {
    case hello: {
      const token = reader.byte();

      if (token > 1) throw new Error('Invalid binary control');
      message = {
        type: 'hello',
        playerToken: token ? reader.uuid() : null,
      };
      break;
    }

    case input: {
      const tick = reader.unsigned();
      const sequence = reader.unsigned();
      const code = reader.byte();
      const hasOffset = reader.byte();

      if (code >= 192 || hasOffset > 1) {
        throw new Error('Invalid binary control');
      }
      const offset = hasOffset ? reader.number() : undefined;

      if (offset !== undefined && (offset < 0 || offset >= simulationStep)) {
        throw new Error('Invalid binary control');
      }
      message = {
        type: 'input',
        tick,
        sequence,
        input: unpackPlayerInput(code),
        ...(offset !== undefined && { offset }),
      };
      break;
    }

    case dock: {
      const action = reader.byte();

      switch (action) {
        case 0:
          message = {
            type: 'dock',
            action: 'buy',
            module: reader.unsigned(),
            moduleId: reader.signed(),
          };
          break;

        case 1: {
          const count = reader.byte();

          if (count < 1 || count > 100) {
            throw new Error('Invalid binary control');
          }
          const objectIds: number[] = [];

          for (let index = 0; index < count; index++) {
            objectIds.push(reader.signed());
          }
          message = { type: 'dock', action: 'sell', objectIds };
          break;
        }

        case 2:
          message = {
            type: 'dock',
            action: 'equip',
            moduleId: reader.signed(),
            mount: reader.unsigned(),
          };
          break;

        case 3:
          message = {
            type: 'dock',
            action: 'remove',
            mount: reader.unsigned(),
          };
          break;
        case 4:

        case 5: {
          const paint = action === 4 ? reader.unsigned() : undefined;
          const mask = reader.byte();

          if (mask & ~3) throw new Error('Invalid binary control');
          const moduleId = mask & 1 ? reader.signed() : undefined;
          const mount = mask & 2 ? reader.signed() : undefined;

          message =
            action === 4
              ? {
                  type: 'dock',
                  action: 'paint',
                  paint: paint!,
                  ...(moduleId !== undefined && { moduleId }),
                  ...(mount !== undefined && { mount }),
                }
              : {
                  type: 'dock',
                  action: 'repair',
                  ...(moduleId !== undefined && { moduleId }),
                  ...(mount !== undefined && { mount }),
                };
          break;
        }

        default:
          throw new Error('Invalid binary control');
      }
      break;
    }

    case respawn:
      message = { type: 'respawn' };
      break;

    case snapshotAck:
      message = { type: 'snapshotAck', sequence: reader.unsigned() };
      break;

    default:
      throw new Error('Invalid binary control');
  }
  reader.finish();
  return message;
}

/**
 * Encode the two server controls; snapshots use the separate binary schema.
 */
export function encodeServerControl(
  message: ServerControl,
): Uint8Array<ArrayBuffer> {
  if (message.type === 'respawn') {
    const writer = new ControlWriter(respawn);

    writer.unsigned(message.shipId);
    return writer.finish();
  }
  const writer = new ControlWriter(welcome);

  writer.unsigned(message.playerId);
  writer.unsigned(message.shipId);
  writer.unsigned(message.serverTick);
  writer.uuid(message.playerToken);
  writer.number(message.worldSeed);
  writer.number(message.spawn.x);
  writer.number(message.spawn.y);
  return writer.finish();
}

/**
 * Decode a server control frame; snapshots use decodeBinarySnapshot.
 */
export function decodeServerControl(
  data: ArrayBuffer | Uint8Array,
): ServerControl {
  const reader = new ControlReader(data);
  let message: ServerControl;

  switch (reader.type) {
    case respawn:
      message = { type: 'respawn', shipId: reader.unsigned() };
      break;

    case welcome: {
      const playerId = reader.unsigned();
      const shipId = reader.unsigned();
      const serverTick = reader.unsigned();
      const playerToken = reader.uuid();
      const worldSeed = reader.number();
      const spawn = Vec.create(reader.number(), reader.number());

      message = {
        type: 'welcome',
        playerId,
        shipId,
        serverTick,
        playerToken,
        worldSeed,
        spawn,
      };
      break;
    }

    default:
      throw new Error('Invalid binary control');
  }
  reader.finish();
  return message;
}
