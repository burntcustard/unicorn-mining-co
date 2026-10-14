import {
  encodeClientMessage,
  encodeServerControl,
} from '../../../src/client/protocol/binary-control';
import { emptyPlayerInput } from '../../../src/client/protocol/input';
import type { ClientMessage } from '../../../src/client/protocol/network';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const token = '01234567-89ab-cdef-0123-456789abcdef';

const client: ClientMessage[] = [
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
  { type: 'dock', action: 'repair', moduleId: -22 },
  { type: 'dock', action: 'repairHull', hullIndex: 4 },
  { type: 'dock', action: 'refuel' },
  { type: 'respawn' },
  { type: 'snapshotAck', sequence: 16384 },
  { type: 'activity' },
];

const server = [
  {
    type: 'sounds' as const,
    sounds: [0, 1, 2, 3, 4, 5, 6, 7, 9].map((effect) => ({
      effect,
      id: -130,
      by: 2,
      position: { x: -400.25, y: 250.5 },
    })),
  },
  { type: 'profile' as const, displayName: 'aé🦄 <&>\u0000' },
  {
    type: 'welcome' as const,
    playerId: 2,
    shipId: 5,
    serverTick: 80,
    playerToken: token,
    worldSeed: 25,
    spawn: { x: -400, y: 250 },
    unlockedPaints: 96,
    credits: 500,
    displayName: 'aé🦄 <&>\u0000',
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
