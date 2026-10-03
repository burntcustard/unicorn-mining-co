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
  { type: 'dock', action: 'equip', moduleId: -15, mount: 5 },
  { type: 'dock', action: 'remove', mount: 4 },
  { type: 'dock', action: 'paint', paint: 6, moduleId: -22, mount: 2 },
  { type: 'dock', action: 'repair', moduleId: -22 },
  { type: 'respawn' },
  { type: 'snapshotAck', sequence: 16384 },
];

const server = [
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
