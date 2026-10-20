import * as Vec from '../utilities/vector';
import { simulationStep } from '../../specs/simulation';
import { packPlayerInput, unpackPlayerInput } from './input';
import type { ClientMessage, ServerMessage } from './network';
import { controlMessageIds, dockActionIds } from '../../specs/protocol';
import { paintColors } from '../../specs/colors';

type ServerControl = Extract<
  ServerMessage,
  { type: 'welcome' | 'respawn' | 'progress' | 'profile' | 'sounds' | 'chat' }
>;

const {
  hello,
  input,
  dock,
  respawn,
  snapshotAck,
  welcome,
  progress,
  activity,
  prepare,
  play,
  profile,
  sounds,
  gateAccess,
  chat,
} = controlMessageIds;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = '0123456789abcdef';

export const isPlayerToken = (value: string | null): value is string =>
  value !== null && uuidPattern.test(value);

class ControlWriter {
  private bytes: number[];
  private numberBuffer = new ArrayBuffer(8);
  private numberBytes = new Uint8Array(this.numberBuffer);
  private numberView = new DataView(this.numberBuffer);

  byte(value: number) {
    this.bytes.push(value);
  }

  constructor(type: number) {
    this.bytes = [0x55, 0x43, 1, type];
  }

  finish(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.bytes);
  }

  number(value: number) {
    if (!Number.isFinite(value)) {
      throw new RangeError('Invalid binary control number');
    }

    this.numberView.setFloat64(0, value || 0, true);
    this.bytes.push(...this.numberBytes);
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

  uuid(value: string) {
    if (!isPlayerToken(value)) {
      throw new RangeError('Invalid binary control token');
    }

    const digits = value.replaceAll('-', '');

    for (let index = 0; index < 32; index += 2) {
      this.byte(Number.parseInt(digits.slice(index, index + 2), 16));
    }
  }

  text(value: string) {
    const bytes = new TextEncoder().encode(value);

    if (Array.from(value).length > 240) {
      throw new RangeError('Message is too long');
    }

    this.unsigned(bytes.length);
    this.bytes.push(...bytes);
  }

  string(value: string) {
    if (Array.from(value).length > 16) throw new RangeError('Name is too long');
    const bytes = new TextEncoder().encode(value);

    this.byte(bytes.length);
    this.bytes.push(...bytes);
  }
}

class ControlReader {
  private bytes: Uint8Array;
  private offset = 0;
  readonly type: number;
  get remaining() {
    return this.bytes.length - this.offset;
  }
  private view: DataView;

  byte() {
    if (this.offset >= this.bytes.length) {
      throw new Error('Invalid binary control');
    }

    return this.bytes[this.offset++];
  }

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

  finish() {
    if (this.offset !== this.bytes.length) {
      throw new Error('Invalid binary control');
    }
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

  text() {
    const length = this.unsigned();

    if (length > 960 || length > this.remaining) {
      throw new Error('Invalid message');
    }

    const value = new TextDecoder('utf-8', { fatal: true }).decode(
      this.bytes.subarray(this.offset, this.offset + length),
    );

    this.offset += length;

    if (Array.from(value).length > 240) throw new Error('Message is too long');
    return value;
  }

  string() {
    const length = this.byte();

    if (length > 64 || length > this.remaining) throw new Error('Invalid name');

    const value = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(this.bytes.subarray(this.offset, this.offset + length));

    this.offset += length;

    if (Array.from(value).length > 16) throw new Error('Name is too long');
    return value;
  }
}

/**
 * Encode browser controls without JSON or protocol string tags.
 */
export function encodeClientMessage(
  message: ClientMessage,
): Uint8Array<ArrayBuffer> {
  switch (message.type) {
    case 'profile': {
      if (!message.displayName) throw new Error('Enter a name');
      const writer = new ControlWriter(profile);

      writer.string(message.displayName);
      return writer.finish();
    }
    case 'hello':

    case 'prepare': {
      const writer = new ControlWriter(
        message.type === 'hello' ? hello : prepare,
      );

      writer.byte(+(message.playerToken !== null));

      if (message.playerToken !== null) writer.uuid(message.playerToken);
      return writer.finish();
    }

    case 'input': {
      const writer = new ControlWriter(input);
      const code = packPlayerInput(message.input);

      writer.unsigned(message.tick);
      writer.unsigned(message.sequence);
      writer.byte(code & 255);
      writer.byte(+(message.offset !== undefined) | ((code >> 7) & 62));

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
        case 'refuel':
          writer.byte(dockActionIds.refuel);
          break;

        case 'buyAmmo':
          writer.byte(dockActionIds.buyAmmo);
          break;

        case 'buy':
          writer.byte(
            message.mount === undefined
              ? dockActionIds.buy
              : dockActionIds.buyEquipped,
          );
          writer.unsigned(message.module);
          writer.signed(message.moduleId);

          if (message.mount !== undefined) writer.unsigned(message.mount);
          break;

        case 'buyStock':
        case 'sell':
          if (message.objectIds.length < 1 || message.objectIds.length > 100) {
            throw new RangeError('Invalid binary sell count');
          }

          writer.byte(
            message.action === 'sell'
              ? dockActionIds.sell
              : dockActionIds.buyStock,
          );
          writer.byte(message.objectIds.length);
          message.objectIds.forEach((id) => writer.signed(id));
          break;

        case 'equip':
          writer.byte(dockActionIds.equip);
          writer.signed(message.moduleId);
          writer.unsigned(message.mount);
          break;

        case 'remove':
          writer.byte(dockActionIds.remove);
          writer.unsigned(message.mount);
          break;

        case 'repairHull':
          writer.byte(dockActionIds.repairHull);
          writer.unsigned(message.hullIndex);
          break;
        case 'paint':

        case 'repair': {
          writer.byte(
            message.action === 'paint'
              ? dockActionIds.paint
              : dockActionIds.repair,
          );

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

      if (message.sequence !== undefined) writer.unsigned(message.sequence);
      return writer.finish();
    }

    case 'respawn':
      return new ControlWriter(respawn).finish();

    case 'gateAccess': {
      const writer = new ControlWriter(gateAccess);

      writer.unsigned(message.gateId);
      return writer.finish();
    }

    case 'chat': {
      const writer = new ControlWriter(chat);

      if (message.channel !== 0 && message.channel !== 1) {
        throw new Error('Invalid channel');
      }

      writer.byte(message.channel);
      writer.text(message.text);
      return writer.finish();
    }

    case 'activity':
      return new ControlWriter(activity).finish();

    case 'play':
      return new ControlWriter(play).finish();

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
    case profile:
      message = { type: 'profile', displayName: reader.string() };

      if (!message.displayName) throw new Error('Enter a name');
      break;
    case hello:

    case prepare: {
      const token = reader.byte();

      if (token > 1) throw new Error('Invalid binary control');

      message = {
        type: reader.type === hello ? 'hello' : 'prepare',
        playerToken: token ? reader.uuid() : null,
      };

      break;
    }

    case input: {
      const tick = reader.unsigned();
      const sequence = reader.unsigned();
      const code = reader.byte();
      const hasOffset = reader.byte();

      if (code >= 192 || hasOffset > 63) {
        throw new Error('Invalid binary control');
      }

      const offset = hasOffset & 1 ? reader.number() : undefined;

      if (offset !== undefined && (offset < 0 || offset >= simulationStep)) {
        throw new Error('Invalid binary control');
      }

      message = {
        type: 'input',
        tick,
        sequence,
        input: unpackPlayerInput(code | ((hasOffset & 62) << 7)),
        ...(offset !== undefined && { offset }),
      };

      break;
    }

    case dock: {
      const action = reader.byte();

      switch (action) {
        case dockActionIds.refuel:
          message = { type: 'dock', action: 'refuel' };
          break;

        case dockActionIds.buyAmmo:
          message = {
            type: 'dock',
            action: 'buyAmmo',
          };

          break;

        case dockActionIds.buy:
        case dockActionIds.buyEquipped:
          message = {
            type: 'dock',
            action: 'buy',
            module: reader.unsigned(),
            moduleId: reader.signed(),
            ...(action === dockActionIds.buyEquipped && {
              mount: reader.unsigned(),
            }),
          };

          break;

        case dockActionIds.buyStock:
        case dockActionIds.sell: {
          const count = reader.byte();

          if (count < 1 || count > 100) {
            throw new Error('Invalid binary control');
          }

          const objectIds: number[] = [];

          for (let index = 0; index < count; index++) {
            objectIds.push(reader.signed());
          }

          message = {
            type: 'dock',
            action: action === dockActionIds.sell ? 'sell' : 'buyStock',
            objectIds,
          };

          break;
        }

        case dockActionIds.equip:
          message = {
            type: 'dock',
            action: 'equip',
            moduleId: reader.signed(),
            mount: reader.unsigned(),
          };

          break;

        case dockActionIds.remove:
          message = {
            type: 'dock',
            action: 'remove',
            mount: reader.unsigned(),
          };

          break;

        case dockActionIds.repairHull:
          message = {
            type: 'dock',
            action: 'repairHull',
            hullIndex: reader.unsigned(),
          };

          break;
        case dockActionIds.paint:

        case dockActionIds.repair: {
          const paint =
            action === dockActionIds.paint ? reader.unsigned() : undefined;
          const mask = reader.byte();

          if (mask & ~3) throw new Error('Invalid binary control');
          const moduleId = mask & 1 ? reader.signed() : undefined;
          const mount = mask & 2 ? reader.signed() : undefined;

          message =
            action === dockActionIds.paint
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

      if (reader.remaining) message.sequence = reader.unsigned();
      break;
    }

    case respawn:
      message = { type: 'respawn' };
      break;

    case gateAccess:
      message = { type: 'gateAccess', gateId: reader.unsigned() };
      break;

    case chat: {
      const channel = reader.byte();

      if (channel > 1) throw new Error('Invalid channel');
      message = { type: 'chat', channel, text: reader.text() };
      break;
    }

    case activity:
      message = { type: 'activity' };
      break;

    case play:
      message = { type: 'play' };
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
 * Encode server controls; snapshots use the separate binary schema.
 */
export function encodeServerControl(
  message: ServerControl,
): Uint8Array<ArrayBuffer> {
  if (message.type === 'chat') {
    const writer = new ControlWriter(chat);

    if (message.channel !== 0 && message.channel !== 1) {
      throw new Error('Invalid channel');
    }

    writer.byte(message.channel);
    writer.text(message.sender);
    writer.text(message.senderRole);
    writer.text(message.text);

    if (message.cargoDemand !== undefined) writer.unsigned(message.cargoDemand);
    return writer.finish();
  }

  if (message.type === 'sounds') {
    const writer = new ControlWriter(sounds);

    writer.unsigned(message.sounds.length);

    message.sounds.forEach((sound) => {
      if (
        !Number.isInteger(sound.effect) ||
        sound.effect < 0 ||
        sound.effect > 9 ||
        sound.effect === 8
      ) {
        throw new Error('Invalid gameplay sound');
      }

      writer.byte(sound.effect);
      writer.signed(sound.id);
      writer.unsigned(sound.by);
      writer.number(sound.position.x);
      writer.number(sound.position.y);
    });

    return writer.finish();
  }

  if (message.type === 'profile') {
    const writer = new ControlWriter(profile);

    writer.string(message.displayName);
    return writer.finish();
  }

  if (
    message.type !== 'respawn' &&
    message.credits !== undefined &&
    message.credits < 0
  ) {
    throw new RangeError('Invalid player balance');
  }

  if (message.type === 'progress') {
    const writer = new ControlWriter(progress);

    writer.unsigned(message.unlockedPaints);

    if (message.credits !== undefined) writer.number(message.credits);
    return writer.finish();
  }

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

  if (message.unlockedPaints !== undefined) {
    writer.unsigned(message.unlockedPaints);
  }

  if (message.credits !== undefined) {
    if (message.unlockedPaints === undefined) {
      throw new Error('Player balance requires paint state');
    }

    writer.number(message.credits);
  }

  if (message.displayName !== undefined) {
    if (message.credits === undefined) throw new Error('Name requires balance');
    writer.string(message.displayName);
  }

  if (message.sectorName !== undefined) {
    if (message.displayName === undefined) {
      throw new Error('Sector requires profile name');
    }

    writer.string(message.sectorName);
  }

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
    case chat: {
      const channel = reader.byte();

      if (channel > 1) throw new Error('Invalid channel');

      message = {
        type: 'chat',
        channel,
        sender: reader.text(),
        senderRole: reader.text(),
        text: reader.text(),
        ...(reader.remaining && { cargoDemand: reader.unsigned() }),
      };

      break;
    }

    case sounds: {
      const count = reader.unsigned();

      if (count > reader.remaining / 19) {
        throw new Error('Invalid binary control');
      }

      message = {
        type: 'sounds',
        sounds: Array.from({ length: count }, () => {
          const effect = reader.byte();

          if (effect > 9 || effect === 8) {
            throw new Error('Invalid gameplay sound');
          }

          return {
            effect,
            id: reader.signed(),
            by: reader.unsigned(),
            position: Vec.create(reader.number(), reader.number()),
          };
        }),
      };

      break;
    }

    case profile:
      message = { type: 'profile', displayName: reader.string() };
      break;

    case progress: {
      const unlockedPaints = reader.unsigned();

      if (unlockedPaints >= 1 << paintColors.length) {
        throw new Error('Invalid binary control');
      }

      message = { type: 'progress', unlockedPaints };

      if (reader.remaining) message.credits = reader.number();
      break;
    }

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

      if (reader.remaining) {
        const unlockedPaints = reader.unsigned();

        if (unlockedPaints >= 1 << paintColors.length) {
          throw new Error('Invalid binary control');
        }

        message.unlockedPaints = unlockedPaints;

        if (reader.remaining) message.credits = reader.number();

        if (reader.remaining) message.displayName = reader.string();

        if (reader.remaining) message.sectorName = reader.string();
      }

      break;
    }

    default:
      throw new Error('Invalid binary control');
  }

  reader.finish();

  if (
    message.type !== 'chat' &&
    message.type !== 'respawn' &&
    message.type !== 'profile' &&
    message.type !== 'sounds' &&
    message.credits !== undefined &&
    message.credits < 0
  ) {
    throw new Error('Invalid player balance');
  }

  return message;
}
