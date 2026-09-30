import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';
import { GameSession } from '../src/server/game-session';
import {
  encodeClientMessage,
  decodeServerControl,
} from '../src/shared/protocol/binary-control';
import { decodeBinarySnapshot } from '../src/shared/protocol/binary-snapshot';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import type { ClientMessage } from '../src/shared/protocol/network';

import { Ship } from '../src/shared/craft/ship';
import { Diamond } from '../src/shared/items/diamond';

type Action = {
  kind: string;
  socket: number;
  message?: ClientMessage;
  ticks?: number;
  buffer?: number;
};
const actions: Action[] = [];

for (let socket = 0; socket < 4; socket++) {
  actions.push({
    kind: 'receive',
    socket,
    message: { type: 'hello', playerToken: null },
  });
}

for (let tick = 0; tick < 180; tick++) {
  for (let socket = 0; socket < 4; socket++) {
    if (tick % 2 === 0) {
      actions.push({
        kind: 'receive',
        socket,
        message: { type: 'snapshotAck', sequence: tick / 2 + 1 },
      });
    }

    if (tick % 15 === 0) {
      actions.push({
        kind: 'receive',
        socket,
        message: {
          type: 'input',
          tick,
          sequence: tick + 1,
          offset: 0.01,
          input: {
            ...emptyPlayerInput(),
            thrust: 1,
            turn: socket % 2 ? 1 : -1,
            hornDrill: tick % 30 === 0,
          },
        },
      });
    }
  }
  actions.push({ kind: 'tick', socket: 0, ticks: 1 });
}
actions.push(
  { kind: 'disconnect', socket: 0 },
  { kind: 'reconnect', socket: 4, buffer: 0 },
);
actions.push(
  { kind: 'buffer', socket: 1, buffer: 200000 },
  { kind: 'tick', socket: 0, ticks: 8 },
  { kind: 'buffer', socket: 1, buffer: 0 },
);

for (let socket = 0; socket < 5; socket++) {
  actions.push({
    kind: 'receive',
    socket,
    message: { type: 'snapshotAck', sequence: 91 },
  });
}
actions.push({ kind: 'tick', socket: 0, ticks: 4 });
actions.push({ kind: 'dockSetup', socket: 4 });

for (const message of [
  { type: 'dock', action: 'repair' },
  { type: 'dock', action: 'paint', paint: 2 },
  { type: 'dock', action: 'sell', objectIds: [123456] },
  { type: 'dock', action: 'buy', module: 7, moduleId: -9000 },
  { type: 'dock', action: 'equip', moduleId: -9000, mount: 1 },
  { type: 'dock', action: 'paint', moduleId: -9000, mount: 1, paint: 3 },
  { type: 'dock', action: 'remove', mount: 1 },
] satisfies ClientMessage[]) {
  actions.push(
    { kind: 'ackLatest', socket: 4 },
    { kind: 'receive', socket: 4, message },
  );
}
actions.push(
  { kind: 'ackLatest', socket: 4 },
  { kind: 'destroy', socket: 4 },
  { kind: 'receive', socket: 4, message: { type: 'respawn' } },
  { kind: 'ackLatest', socket: 4 },
  { kind: 'tick', socket: 0, ticks: 4 },
);
class Socket {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  packets: string[] = [];
  code = 0;
  send(packet: Uint8Array) {
    this.packets.push(Buffer.from(packet).toString('hex'));
  }
  terminate() {
    this.readyState = WebSocket.CLOSED;
  }
  close(code = 1000) {
    this.code = code;
    this.readyState = WebSocket.CLOSED;
  }
}
const session = new GameSession({ worldSeed: 25 });
const sockets: Record<number, Socket> = {};

for (const action of actions) {
  const socket = (sockets[action.socket] ??= new Socket());
  const ws = socket as unknown as WebSocket;

  if (action.kind === 'receive') {
    session.receive({ socket: ws, message: action.message! });
  } else if (action.kind === 'dockSetup') {
    const ship = session.world.entities.get(
      session.world.players.get(1)!.shipId,
    ) as Ship;

    ship.dockedTo = 999;
    ship.credits = 10000;
    const health = ship.hullHealth;

    health[0] = 1;
    ship.hullHealth = health;
    ship.cargoContents.push(new Diamond({ id: 123456 }));
  } else if (action.kind === 'destroy') {
    session.world.entities.delete(session.world.players.get(1)!.shipId);
  } else if (action.kind === 'ackLatest') {
    const packet = Buffer.from(socket.packets.at(-1)!, 'hex');

    if (packet[1] === 0x4d) {
      session.receive({
        socket: ws,
        message: {
          type: 'snapshotAck',
          sequence: decodeBinarySnapshot(packet).snapshotSequence!,
        },
      });
    }
  } else if (action.kind === 'tick') session.tick({ ticks: action.ticks });
  else if (action.kind === 'disconnect') session.disconnect({ socket: ws });
  else if (action.kind === 'buffer') socket.bufferedAmount = action.buffer!;
  else if (action.kind === 'reconnect') {
    const welcome = decodeServerControl(
      Buffer.from(sockets[action.buffer!].packets[0], 'hex'),
    );

    assert(welcome.type === 'welcome');
    session.receive({
      socket: ws,
      message: { type: 'hello', playerToken: welcome.playerToken },
    });
  }
}
const go = JSON.parse(
  execFileSync('go', ['run', './tests/go-fixtures/session'], {
    input: JSON.stringify(
      actions.map((action) => ({
        ...action,
        packet: action.message
          ? Buffer.from(encodeClientMessage(action.message)).toString('hex')
          : undefined,
      })),
    ),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);

function decoded(packet: string) {
  const data = Buffer.from(packet, 'hex');

  if (data[1] === 0x43) {
    const message = decodeServerControl(data);

    if (message.type === 'welcome') message.playerToken = 'token';
    return message;
  }
  return decodeBinarySnapshot(data);
}
function compare(a: unknown, b: unknown, path: string) {
  if (typeof a === 'number' && typeof b === 'number') {
    assert(Math.abs(a - b) <= 2e-8, `${path}: ${a} != ${b}`);
    return;
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);

    for (const key of Object.keys(a)) {
      compare(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
  } else assert.deepEqual(a, b, path);
}
let packets = 0;

for (const [id, socket] of Object.entries(sockets)) {
  assert.equal(go[id].code, socket.code, `socket ${id} close`);
  assert.equal(
    go[id].packets.length,
    socket.packets.length,
    `socket ${id} packet count`,
  );
  socket.packets.forEach((packet, index) => {
    compare(
      decoded(go[id].packets[index]),
      decoded(packet),
      `socket ${id} packet ${index}`,
    );
    packets++;
  });
}
console.log(
  `Go and Node complete sessions match: ${packets} decoded packets, timed inputs, reconnect, catch-up and backpressure`,
);
