import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { createTestSession } from './helpers/create-session';
import type { GameSession } from '../src/server/game-session';
import { parseClientMessage } from '../src/server/parse-client-message';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { addEntity } from '../src/shared/simulation/world';
import { maxPredictionTicks, simulationStep } from '../src/shared/settings';

let now = 0;
let session: GameSession;
let delay = 0;
let mode = '';
let index = 0;
const stalled = () => now >= 2000 && now < 3100;
const originalPerformance = globalThis.performance;
const packets: { at: number; receive: () => void; blocked: () => boolean }[] =
  [];

class Socket {
  static OPEN = 1;
  readyState = 1;
  id = index++;
  onopen?: () => void;
  onmessage?: (event: { data: Uint8Array }) => void;
  peer = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: Uint8Array) => {
      const receive = () => this.onmessage?.({ data });

      packets.push({
        at: now + delay,
        receive,
        blocked: () =>
          this.id === 0 &&
          stalled() &&
          ['downstream', 'network', 'client'].includes(mode),
      });
    },
    close() {},
    terminate() {},
  };
  send(data: Uint8Array) {
    const message = parseClientMessage(Buffer.from(data));

    assert(message);
    packets.push({
      at: now + delay,
      receive: () =>
        session.receive({ message, socket: this.peer as unknown as WebSocket }),
      blocked: () => this.id === 0 && stalled() && mode === 'network',
    });
  }
  close() {}
}

Object.assign(globalThis, {
  performance: { now: () => now },
  WebSocket: Socket,
  localStorage: { getItem: () => null, setItem() {} },
  location: { protocol: 'http:', host: 'test' },
});

try {
  const { NetworkClient } = await import('../src/client/network');

  for (const active of [false, true]) {
    for (const fps of [60, 144]) {
      for (const latency of [5, 25, 50]) {
        for (const profile of [
          'steady',
          'downstream',
          'network',
          'server',
          'client',
        ]) {
          now = delay = index = 0;
          mode = '';
          packets.length = 0;
          session = createTestSession({ worldSeed: 25 });
          Reflect.get(session, 'regions').sync = () => {};
          const clients = Array.from(
            { length: 2 },
            () => new NetworkClient({ url: 'ws://test' }),
          );

          clients.forEach((client) =>
            (Reflect.get(client, 'socket') as Socket).onopen?.(),
          );
          const deliver = () => {
            while (true) {
              const i = packets.findIndex(
                (packet) => packet.at <= now && !packet.blocked(),
              );

              if (i < 0) break;
              packets.splice(i, 1)[0].receive();
            }
          };

          deliver();
          await Promise.all(clients.map((client) => client.ready));
          const ships = clients.map((client) =>
            session.world.entities.get(client.shipId!)!,
          );

          session.world.entities.clear();
          ships.forEach((ship, i) => {
            Vec.set(ship.position, Vec.create(i * 600));
            Vec.set(ship.velocity, Vec.create(120));
            ship.drag = 0;
            ship.rotation = ship.spin = 0;
            addEntity(session.world, ship);
          });
          session.tick();
          deliver();
          clients.forEach((client) => {
            client.updateFrame({ input: emptyPlayerInput(), dt: 0, now });
            client.world.entities.forEach((entity) => {
              entity.drag = 0;
            });
          });
          mode = profile;
          delay = latency;
          let nextTick = 1000 / 30;
          let nextFrame = 1000 / fps;
          let lastFrame = [0, 0];
          let previous: { at: number; x: number } | undefined;
          let freezes = 0,
            backwards = 0,
            maxSpeedError = 0,
            recoveryJump = 0,
            maxRotationStep = 0;
          let previousRotation = 0;

          for (now = 1; now <= 6000; now++) {
            deliver();

            if (!(mode === 'server' && stalled())) {
              while (nextTick <= now) {
                const ticks = Math.min(
                  6,
                  Math.floor((now - nextTick) / (1000 / 30)) + 1,
                );

                session.tick({ ticks });
                nextTick += (ticks * 1000) / 30;
              }
            }
            deliver();

            if (nextFrame > now) continue;
            nextFrame += 1000 / fps;
            clients.forEach((client, i) => {
              if (mode === 'client' && i === 0 && stalled()) return;
              const input = {
                ...emptyPlayerInput(),
                thrust: active && i === 0 && now >= 2100 && now < 2900 ? 1 : 0,
                turn: active && i === 0 && now >= 2200 && now < 2700 ? 1 : 0,
              };

              client.recordInput({ input });
              client.updateFrame({
                input,
                dt: Math.min(
                  maxPredictionTicks * simulationStep,
                  (now - lastFrame[i]) / 1000,
                ),
                now,
              });
              lastFrame[i] = now;
            });

            if (mode === 'client' && stalled()) continue;
            const client = clients[0];
            const pose = client.remoteMotion
              .sample({
                now,
                world: client.world,
                predicted: client.predictFrame({ now }),
              })
              .get(ships[0].id)!;

            if (previous && now > 1000) {
              const distance = pose.position.x - previous.x;
              const expected = (now - previous.at) * 0.12;
              const speed = distance / ((now - previous.at) / 1000);

              if (distance < 0.01) freezes++;

              if (distance < -0.01) backwards++;
              maxSpeedError = Math.max(maxSpeedError, Math.abs(speed - 120));

              if (now >= 3100 && now < 3500) {
                recoveryJump = Math.max(
                  recoveryJump,
                  Math.abs(distance - expected),
                );
              }
            }
            maxRotationStep = Math.max(
              maxRotationStep,
              Math.abs(pose.rotation - previousRotation),
            );
            previousRotation = pose.rotation;
            previous = { at: now, x: pose.position.x };

            if (active && mode !== 'client' && now >= 2600 && now < 2700) {
              assert(
                pose.rotation > 0.3,
                'steering remains responsive during the outage',
              );
            }
          }
          const result = {
            active,
            fps,
            oneWayLatency: latency,
            mode,
            freezes,
            backwards,
            maxSpeedError,
            recoveryJump,
            maxRotationStep,
          };

          console.log(JSON.stringify(result));

          if (!process.env.STALL_REPORT_ONLY) {
            assert.equal(freezes, 0, JSON.stringify(result));
            assert.equal(backwards, 0, JSON.stringify(result));
            assert(maxSpeedError < (active ? 160 : 15), JSON.stringify(result));
            assert(recoveryJump < (active ? 3 : 0.01), JSON.stringify(result));
            assert(maxRotationStep < 4 / fps, JSON.stringify(result));
            const client = clients[0];
            const pose = client.remoteMotion
              .sample({
                now,
                world: client.world,
                predicted: client.predictFrame({ now }),
              })
              .get(ships[0].id)!;

            assert(
              Vec.distance(pose.position, ships[0].position) < 8,
              'recovery converges to the authoritative trajectory',
            );
            assert(
              Reflect.get(Reflect.get(client, 'prediction'), 'history').size <=
                maxPredictionTicks,
              'prediction history stays bounded',
            );
          }
        }
      }
    }
  }
} finally {
  Object.assign(globalThis, { performance: originalPerformance });
}
