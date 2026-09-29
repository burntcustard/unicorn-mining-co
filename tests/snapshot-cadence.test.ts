import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { GameSession } from '../src/server/game-session';
import { decodeServerControl } from '../src/shared/protocol/binary-control';
import { decodeBinarySnapshot } from '../src/shared/protocol/binary-snapshot';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { type ServerMessage } from '../src/shared/protocol/network';

type SnapshotMessage = Extract<ServerMessage, { type: 'load' | 'snapshot' }>;
import { createStation } from '../src/shared/craft/create-station';
import { addEntity } from '../src/shared/simulation/world';

const session = new GameSession({ worldSeed: 25 });

Reflect.get(session, 'regions').sync = () => {};
const packets: ServerMessage[] = [];
const socket = {
  readyState: 1,
  bufferedAmount: 0,
  send(data: Uint8Array) {
    const packet =
      data[1] === 0x4d ? decodeBinarySnapshot(data) : decodeServerControl(data);

    packets.push(packet);

    if (packet.type === 'load' || packet.type === 'snapshot') {
      session.receive({
        socket: socket as WebSocket,
        message: { type: 'snapshotAck', sequence: packet.snapshotSequence! },
      });
    }
  },
  close() {},
  terminate() {},
} as unknown as WebSocket;

session.receive({ socket, message: { type: 'hello', playerToken: null } });
assert.deepEqual(
  packets.map((packet) => packet.type),
  ['welcome', 'load'],
  'hello sends the welcome and initial world immediately',
);
const player = [
  ...(
    Reflect.get(session, 'players') as Map<
      string,
      {
        pendingSnapshots: number[];
        lastSequence: number;
        ship: { dockedTo?: number; credits: number };
        shipId: number;
      }
    >
  ).values(),
][0];

assert(player);
assert.equal(player.pendingSnapshots.length, 0);

for (let index = 0; index < 8; index++) {
  const sequence = index + 1;

  session.receive({
    socket,
    message: {
      type: 'input',
      tick: session.world.tick,
      sequence,
      input: { ...emptyPlayerInput(), thrust: sequence % 2 },
    },
  });
  session.tick();
  assert.equal(player.lastSequence, sequence, 'input runs at 30 Hz');
}
const snapshots = packets.filter(
  (packet): packet is SnapshotMessage => packet.type === 'snapshot',
);

assert.deepEqual(
  snapshots.map((packet) => packet.serverTick),
  [2, 4, 6, 8],
  'ordinary snapshots run at 15 Hz',
);
assert.deepEqual(
  snapshots.map((packet) => packet.acknowledgedSequence),
  [2, 4, 6, 8],
);
assert.equal(player.pendingSnapshots.length, 0);

session.tick({ ticks: 3 });
assert.equal(packets.at(-1)?.type, 'snapshot');
assert.equal((packets.at(-1) as SnapshotMessage).serverTick, 11);

player.ship.dockedTo = -1;
player.ship.credits = 1000;
const beforeDock = packets.length;

session.receive({
  socket,
  message: { type: 'dock', action: 'paint', paint: 1 },
});
assert.equal(packets.length, beforeDock + 1);
assert.equal(packets.at(-1)?.type, 'snapshot');
assert.equal((packets.at(-1) as SnapshotMessage).serverTick, 11);

session.world.entities.delete(player.shipId);
const station = addEntity(
  session.world,
  createStation({ id: 900, position: Vec.create() }),
);

Reflect.set(session, 'nearestStation', () => station);
const beforeRespawn = packets.length;

session.receive({ socket, message: { type: 'respawn' } });
assert.deepEqual(
  packets.slice(beforeRespawn).map((packet) => packet.type),
  ['respawn', 'load'],
  'respawn sends its control and replacement world immediately',
);
assert.equal((packets.at(-1) as SnapshotMessage).serverTick, 11);
assert.equal(player.pendingSnapshots.length, 0);
