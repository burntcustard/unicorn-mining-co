import { readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { GameSession } from '../../src/server/game-session';
import { GameCollisions } from '../../src/shared/collision/game-collisions';
import { createAsteroid } from '../../src/shared/simulation/asteroid';
import { addEntity } from '../../src/shared/simulation/world';
import { emptyPlayerInput } from '../../src/shared/protocol/input';
import { Ship } from '../../src/shared/craft/ship';
import type { SimulationEvent } from '../../src/shared/protocol/events';
import * as Vec from '../../src/shared/vector';
import { movePoint } from '../../src/shared/geometry';

const count = Number(process.env.SESSION_PLAYERS);
const ticks = Number(process.env.SESSION_TICKS);
const workload = process.env.SESSION_WORKLOAD!;
const trace = !!process.env.SESSION_TRACE;

class Socket {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  packets = 0;
  bytes = 0;
  sequence = 0;
  trace: string[] = [];
  record = false;
  send(packet: Uint8Array) {
    this.packets++;
    this.bytes += packet.length;

    if (packet[1] === 0x4d) {
      // Read just the snapshot sequence, keeping client decoding outside server measurements.
      let offset = 4;
      const unsigned = () => {
        let value = 0,
          shift = 0,
          part: number;

        do {
          part = packet[offset++];
          value += (part & 127) * 2 ** shift;
          shift += 7;
        } while (part & 128);
        return value;
      };

      unsigned();
      unsigned();

      if (packet[3] & 4) unsigned();

      if (packet[3] & 8) unsigned();

      if (packet[3] & 16) this.sequence = unsigned();
    }

    if (this.record) this.trace.push(Buffer.from(packet).toString('hex'));
  }
  terminate() {}
  close() {}
}
let contacts = 0,
  stepEvents: SimulationEvent[] = [];
const contactTrace: unknown[] = [];
// The wrapper invokes the original with its original receiver.
// oxlint-disable-next-line typescript/unbound-method
const step = GameCollisions.prototype.step;

GameCollisions.prototype.step = function (options) {
  const found = step.call(this, options);

  contacts += found.length;

  if (process.env.CONTACT_TRACE) {
    contactTrace.push(
      found.map((c) => ({
        a: c.collider.owner.id,
        b: c.other.owner.id,
        point: c.point,
        normal: c.normal,
        depth: c.depth,
      })),
    );
  }
  stepEvents = options.events || [];
  return found;
};
const session = new GameSession({ worldSeed: 25 });
const sockets = Array.from({ length: count }, () => new Socket());

sockets.forEach((socket) =>
  session.receive({
    socket: socket as unknown as WebSocket,
    message: { type: 'hello', playerToken: null },
  }),
);
const ships = [...session.world.players.values()].map(
  (player) => session.world.entities.get(player.shipId) as Ship,
);

ships.forEach((ship, i) => {
  let x = i * 120,
    y = 10000;

  if (workload === 'spread') {
    x = i * 5000;
    y += i * 2000;
  }

  if (workload === 'contact') {
    x = Math.floor(i / 2) * 400 + (i % 2) * 65;

    if (i % 2) ship.rotation = Math.PI;
  }

  if (workload === 'module') x = i * 400;
  Vec.setXY(ship.position, x, y);

  if (workload === 'module') {
    addEntity(
      session.world,
      createAsteroid(session.world, {
        position: Vec.create(x + 85, y),
        radius: 25,
        contents: [0, 1],
      }).lockGeometry(),
    );
  }
  sockets[i].packets = 0;
  sockets[i].bytes = 0;
  sockets[i].record = trace;
});
const events: Record<string, number> = {};
let nearZeroCollisions = 0;
const eventTrace: unknown[] = [];
const run = (tick: number) => {
  if (workload === 'module' && tick >= 120 && tick % 120 === 0) {
    ships.forEach((ship) => {
      if (session.world.entities.has(ship.id)) {
        addEntity(
          session.world,
          createAsteroid(session.world, {
            position: movePoint(ship.position, ship.rotation, 85),
            radius: 25,
            contents: [0, 1],
          }).lockGeometry(),
        );
      }
    });
  }

  sockets.forEach((socket, i) => {
    const ws = socket as unknown as WebSocket;

    session.receive({
      socket: ws,
      message: { type: 'snapshotAck', sequence: socket.sequence },
    });

    if (tick % 15 === 0) {
      session.receive({
        socket: ws,
        message: {
          type: 'input',
          tick: session.world.tick,
          sequence: tick + 1,
          offset: 0.01,
          input: {
            ...emptyPlayerInput(),
            thrust: 1,
            turn: workload === 'spread' ? (i % 3) - 1 : 0,
            hornDrill: workload === 'module',
            cargoHatch: workload === 'module' && tick % 120 < 60,
            searchLight: workload === 'module' && tick % 180 < 90,
          },
        },
      });
    }
  });
  session.tick();

  if (trace) {
    stepEvents.forEach((event) => {
      if (event.type === 'collision') {
        eventTrace.push({
          tick: session.world.tick,
          a: event.a,
          b: event.b,
          impact: event.impact,
        });
      }
    });
  }
  stepEvents.forEach((event) => {
    if (event.type === 'collision' && event.impact <= 2e-8) {
      nearZeroCollisions++;
    } else events[event.type] = (events[event.type] || 0) + 1;
  });
};

for (let tick = 0; tick < 120; tick++) run(tick);
contacts = 0;
nearZeroCollisions = 0;
Object.keys(events).forEach((key) => delete events[key]);
sockets.forEach((socket) => {
  socket.packets = 0;
  socket.bytes = 0;
  socket.trace = [];
});
const samples: number[] = [];
const cpu = process.cpuUsage();
const start = performance.now();

for (let tick = 120; tick < 120 + ticks; tick++) {
  const before = performance.now();

  run(tick);
  samples.push(performance.now() - before);
}
const elapsed = performance.now() - start;
const used = process.cpuUsage(cpu);

samples.sort((a, b) => a - b);
const result = {
  nearZeroCollisions,
  eventTrace,
  contactTrace,
  runtime: 'node',
  players: count,
  workload,
  ticks,
  cpuMsPerTick: (used.user + used.system) / 1000 / ticks,
  wallMsPerTick: elapsed / ticks,
  p95Ms: samples[Math.floor(ticks * 0.95)],
  p99Ms: samples[Math.floor(ticks * 0.99)],
  maxMs: samples.at(-1),
  rssBytes:
    Number(
      readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/)![1],
    ) * 1024,
  heapBytes: process.memoryUsage().heapUsed,
  contacts,
  events,
  packets: sockets.reduce((sum, socket) => sum + socket.packets, 0),
  bytes: sockets.reduce((sum, socket) => sum + socket.bytes, 0),
  entities: session.world.entities.size,
  states: ships.map((ship) => ({
    id: ship.id,
    position: ship.position,
    velocity: ship.velocity,
    rotation: ship.rotation,
    spin: ship.spin,
    hullHealth: ship.hullHealth,
    cargo: ship.cargoContents.length,
    modules: ship.moduleStates,
  })),
  traces: trace ? sockets.map((socket) => socket.trace) : [],
};

writeFileSync(process.env.SESSION_RESULT!, JSON.stringify(result));
