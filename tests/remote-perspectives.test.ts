import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { GameSession } from '../src/server/game-session';
import { parseClientMessage } from '../src/server/parse-client-message';
import { decodeBinarySnapshot } from '../src/shared/protocol/binary-snapshot';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { addEntity } from '../src/shared/simulation/world';
import { detectCollisions } from '../src/shared/collision/detect-collisions';

let now = 0;
let session: GameSession;
let profile = 'setup';
let index = 0;
const originalPerformance = globalThis.performance;
const originalDateNow = Date.now;
const packets: { at: number; receive: () => void }[] = [];
const latency = (peer: number) =>
  profile === 'setup'
    ? 0
    : 40 +
      (peer % 3) * 20 +
      (profile === 'jitter' ? Math.abs(Math.sin(now / 47 + peer)) * 25 : 0) +
      (profile === 'burst' && now % 700 < 100 ? 80 : 0);

class Socket {
  static OPEN = 1;
  readyState = 1;
  id = index++;
  downstreamAt = 0;
  upstreamAt = 0;
  ticks: number[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: Uint8Array }) => void;
  onclose?: (event: { code: number }) => void;
  peer = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: Uint8Array) => {
      const receive = () => {
        if (data[1] === 0x4d) {
          this.ticks.push(decodeBinarySnapshot(data).serverTick);
        }
        this.onmessage?.({ data });
      };

      if (profile === 'setup') receive();
      else {
        this.downstreamAt = Math.max(
          this.downstreamAt + 0.001,
          now + latency(this.id),
        );
        packets.push({ at: this.downstreamAt, receive });
      }
    },
    close() {},
    terminate() {},
  };
  send(data: Uint8Array) {
    const message = parseClientMessage(Buffer.from(data));

    assert(message);
    const receive = () =>
      session.receive({ message, socket: this.peer as unknown as WebSocket });

    if (profile === 'setup') receive();
    else {
      this.upstreamAt = Math.max(
        this.upstreamAt + 0.001,
        now + latency(this.id),
      );
      packets.push({ at: this.upstreamAt, receive });
    }
  }
  close() {}
}

Object.assign(globalThis, {
  performance: { now: () => now },
  WebSocket: Socket,
  localStorage: { getItem: () => null, setItem() {} },
  location: { protocol: 'http:', host: 'test' },
});

Date.now = () => now;

try {
  const { NetworkClient } = await import('../src/client/network');
  const playerCounts = (process.env.REMOTE_PLAYERS || '4')
    .split(',')
    .map(Number);
  const frameRates = (process.env.REMOTE_FPS || '60,144')
    .split(',')
    .map(Number);

  for (const players of playerCounts) {
    for (const delivery of ['steady', 'jitter', 'burst']) {
      for (const fps of frameRates) {
        now = 0;
        index = 0;
        profile = 'setup';
        packets.length = 0;
        session = new GameSession({ worldSeed: 25 });
        Reflect.get(session, 'regions').sync = () => {};
        const clients = Array.from(
          { length: players },
          () => new NetworkClient({ url: 'ws://test' }),
        );

        clients.forEach((client) =>
          (Reflect.get(client, 'socket') as Socket).onopen?.(),
        );
        await Promise.all(clients.map((client) => client.ready));
        const ships = clients.map((client) =>
          session.world.entities.get(client.shipId!)!,
        );

        session.world.entities.clear();
        ships.forEach((ship, i) => {
          const pair = Math.floor(i / 2);

          Vec.set(
            ship.position,
            Vec.create(
              (pair % 4) * 450 + (i % 2 ? -220 : 0),
              Math.floor(pair / 4) * 300 + (i % 2 ? 0 : 110),
            ),
          );
          Vec.set(ship.velocity, Vec.create(i % 2 ? 240 : 0));
          addEntity(session.world, ship);

          if (i % 2) {
            addEntity(
              session.world,
              createAsteroid(session.world, {
                id: 999 + pair,
                position: Vec.create(
                  (pair % 4) * 450 + 70,
                  Math.floor(pair / 4) * 300,
                ),
                radius: 45,
                mass: 1e9,
              }),
            );
          }
        });
        // Deliver the scene at zero latency before introducing the connection profiles.
        session.tick();
        clients.forEach((client) =>
          client.updateFrame({ input: emptyPlayerInput(), dt: 1 / 30, now }),
        );
        profile = delivery;
        const histories = clients.map(
          () => new Map<number, { position: Vec.Value; advance: Vec.Value }>(),
        );
        let samples = 0;
        let squaredChange = 0;
        let maxChange = 0;
        let maxReceiveJump = 0;
        let maxSnapshotJump = 0;
        let collisionTicks = 0;

        clients.forEach((client) => {
          const correct = client.remoteMotion.correct.bind(client.remoteMotion);

          client.remoteMotion.correct = (options) => {
            correct(options);
            const after = client.remoteMotion.sample(options);

            options.before.forEach((before, id) => {
              const pose = after.get(id);

              if (pose) {
                maxSnapshotJump = Math.max(
                  maxSnapshotJump,
                  Vec.distance(before.position, pose.position),
                );
              }
            });
          };
        });
        const sampledPeers = clients.map(() => new Set<number>());
        const poses = () =>
          clients.map((client) =>
            client.remoteMotion.sample({
              now,
              world: client.world,
              predicted: client.predictFrame({ now }),
              shipId: client.shipId,
            }),
          );
        let nextTick = 1000 / 30;
        const seconds = 6;

        for (let frame = 1; frame <= seconds * fps; frame++) {
          now = (frame * 1000) / fps;

          while (nextTick <= now + 1e-6) {
            session.tick();
            nextTick += 1000 / 30;

            if (
              detectCollisions({
                entities: [...session.world.entities.values()],
              }).some(
                (contact) =>
                  contact.collider.physics !== false &&
                  contact.other.physics !== false,
              )
            ) {
              collisionTicks++;
            }
          }
          const beforeReceive = poses();
          // Preserve FIFO in each direction, including receipts generated by delivery.

          while (true) {
            const at = packets.findIndex((packet) => packet.at <= now);

            if (at < 0) break;
            packets.splice(at, 1)[0].receive();
          }
          const beforeUpdate = poses();

          clients.forEach((client, i) =>
            client.updateFrame({
              input: {
                ...emptyPlayerInput(),
                thrust: i % 2 ? 1 : 0,
                turn:
                  i % 2 && frame > 2 * fps && frame < 3 * fps
                    ? i % 4 === 1
                      ? 1
                      : -1
                    : 0,
              },
              dt: 1 / fps,
              now,
            }),
          );
          const after = poses();

          clients.forEach((client, i) => {
            ships.forEach((ship) => {
              if (ship.id === client.shipId) return;
              const pose = after[i].get(ship.id);

              if (!pose) {
                histories[i].delete(ship.id);
                return;
              }
              const last = histories[i].get(ship.id);
              const advance = last
                ? Vec.subtract(pose.position, last.position)
                : Vec.create();

              if (frame > fps && last) {
                sampledPeers[i].add(ship.id);
                const change = Vec.distance(advance, last.advance);

                squaredChange += change * change;
                maxChange = Math.max(maxChange, change);
                samples++;
                const received = beforeReceive[i].get(ship.id);
                const updated = beforeUpdate[i].get(ship.id);

                if (received && updated) {
                  const jump = Vec.distance(
                    received.position,
                    updated.position,
                  );

                  maxReceiveJump = Math.max(maxReceiveJump, jump);
                }
              }
              histories[i].set(ship.id, {
                position: Vec.clone(pose.position),
                advance,
              });
            });
          });
        }
        assert(collisionTicks > 0);
        assert(
          sampledPeers.every((peers) => peers.size > 0),
          'every client observes moving peers',
        );
        assert(
          maxReceiveJump < 1e-5,
          JSON.stringify({ players, delivery, fps, maxReceiveJump }),
        );
        assert(
          maxSnapshotJump < 1e-5,
          JSON.stringify({ players, delivery, fps, maxSnapshotJump }),
        );
        const sockets = clients.map(
          (client) => Reflect.get(client, 'socket') as Socket,
        );
        const gaps = sockets.map((socket) =>
          socket.ticks.slice(1).map((tick, i) => tick - socket.ticks[i]),
        );

        if (delivery === 'steady') {
          assert(
            gaps.every((values) => values.slice(20).every((gap) => gap === 1)),
            'steady 80–160ms round trips must deliver 30 Hz',
          );
        }
        console.log(
          JSON.stringify({
            players,
            delivery,
            fps,
            samples,
            collisionTicks,
            peerCounts: sampledPeers.map((peers) => peers.size),
            rmsChange: Math.sqrt(squaredChange / samples),
            maxChange,
            maxReceiveJump,
            maxSnapshotJump,
            maxSnapshotGap: Math.max(...gaps.flat()),
            finalPositions: ships.map((ship) => Vec.clone(ship.position)),
            finalVelocities: ships.map((ship) => Vec.clone(ship.velocity)),
          }),
        );
      }
    }
  }
} finally {
  Object.assign(globalThis, { performance: originalPerformance });
  Date.now = originalDateNow;
}
