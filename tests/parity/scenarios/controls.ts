import {
  encodeClientMessage,
  encodeServerControl,
} from '../../../src/client/protocol/binary-control';
import { emptyPlayerInput } from '../../../src/client/protocol/input';
import type { ClientMessage } from '../../../src/client/protocol/network';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const token = '01234567-89ab-cdef-0123-456789abcdef';

const client: ClientMessage[] = [
  { type: 'sectorMap', position: { x: -12500.25, y: 62000.5 } },
  { type: 'hangar', command: 'LIST', shipId: 0, value: '' },
  { type: 'hangar', command: 'BUY', shipId: 0, value: 'kestrel' },
  { type: 'hangar', command: 'RENAME', shipId: 2 ** 48, value: '🦄 <&> ship' },
  { type: 'hangar', command: 'SELL', shipId: 2 ** 48, value: '' },
  { type: 'hangar', command: 'PILOT', shipId: 2 ** 48, value: '' },
  { type: 'hangar', command: 'REPAIR', shipId: 2 ** 48, value: '' },
  { type: 'hangar', command: 'REFUEL', shipId: 2 ** 48, value: '' },
  { type: 'hangar', command: 'PAINT', shipId: 2 ** 48, value: '2' },
  { type: 'gateAccess', gateId: 2 ** 45 },
  { type: 'chat', channel: 0, text: 'Hello 🦄 <&>' },
  { type: 'chat', channel: 1, text: '🦄'.repeat(240) },
  { type: 'hello', playerToken: null },
  { type: 'hello', playerToken: token },
  { type: 'prepare', playerToken: null },
  { type: 'prepare', playerToken: token },
  { type: 'play' },
  { type: 'profile', displayName: 'aé🦄 <&>\u0000' },
  { type: 'input', tick: 130, sequence: 52, input: emptyPlayerInput() },
  {
    type: 'input',
    tick: 131,
    sequence: 53,
    offset: 0.0125,
    input: {
      ...emptyPlayerInput(),
      hornDrill: true,
      shieldGenerator: true,
      thrust: 1,
      turn: -1,
    },
  },
  { type: 'dock', action: 'buy', module: 7, moduleId: -42 },
  { type: 'dock', action: 'buy', module: 7, moduleId: -43, mount: 0 },
  {
    type: 'dock',
    action: 'buy',
    module: 7,
    moduleId: -44,
    mount: 5,
    sequence: 8,
  },
  { type: 'dock', action: 'buy', module: 7, moduleId: Number.MAX_SAFE_INTEGER },
  {
    type: 'dock',
    action: 'buy',
    module: 7,
    moduleId: -Number.MAX_SAFE_INTEGER,
  },
  { type: 'dock', action: 'sell', objectIds: [-3, 9, 128] },
  { type: 'dock', action: 'buyStock', objectIds: [42] },
  { type: 'dock', action: 'equip', moduleId: -15, mount: 5 },
  { type: 'dock', action: 'remove', mount: 4 },
  { type: 'dock', action: 'paint', paint: 6, moduleId: -22, mount: 2 },
  { type: 'dock', action: 'paint', paint: 8 },
  { type: 'dock', action: 'repair', moduleId: -22 },
  { type: 'dock', action: 'repairHull', hullIndex: 4 },
  { type: 'dock', action: 'refuel' },
  { type: 'respawn' },
  { type: 'snapshotAck', sequence: 16384 },
  { type: 'activity' },
];

const server = [
  {
    type: 'sectorMap' as const,
    mapMarkers: (
      ['field', 'station', 'ship', 'jumpGate', 'wormhole'] as const
    ).map((kind, index) => ({
      kind,
      id: 2 ** 45 + index,
      position: { x: -12500.25, y: 62000.5 },
      radius: kind === 'field' ? 3500 : 0,
      name: kind === 'ship' ? 'Pilot 🦄' : '',
      definitionId: kind === 'station' ? 'corral-6' : '',
      color: kind === 'ship' ? '#4df' : '',
      ...(kind === 'ship' ? { senderRole: 'admin' } : {}),
    })),
  },
  ...['user', 'owner', 'friendly', 'admin', 'hostile'].map((senderRole) => ({
    type: 'chat' as const,
    channel: 1,
    senderRole,
    sender: 'Pilot 🦄',
    text: 'Hello sectors',
  })),
  {
    type: 'sounds' as const,
    sounds: [0, 1, 2, 3, 4, 5, 6, 7, 9].map((effect) => ({
      effect,
      id: -130,
      by: 2,
      position: { x: -400.25, y: 250.5 },
    })),
  },
  ...[0, 281474976710999].map((cargoDemand) => ({
    type: 'chat' as const,
    channel: 0,
    sender: 'Pirate',
    senderRole: 'hostile',
    text: '',
    cargoDemand,
  })),
  { type: 'profile' as const, displayName: 'aé🦄 <&>\u0000' },
  {
    type: 'welcome' as const,
    playerId: 2,
    shipId: 5,
    serverTick: 80,
    playerToken: token,
    worldSeed: 25,
    spawn: { x: -400, y: 250 },
    unlockedPaints: 486,
    credits: 500,
    displayName: 'aé🦄 <&>\u0000',
    sectorName: 'Hippokoon',
  },
  {
    type: 'welcome' as const,
    playerId: 2,
    shipId: 5,
    serverTick: 80,
    playerToken: token,
    worldSeed: 25,
    spawn: { x: -400, y: 250 },
  },
  { type: 'respawn' as const, shipId: 22 },
  { type: 'progress' as const, unlockedPaints: 511, credits: 1234 },
];

export default {
  client: client.map((message) => ({
    message,
    hex: hex(encodeClientMessage(message)),
  })),
  server: server.map((message) => ({
    message,
    hex: hex(encodeServerControl(message)),
  })),
};
