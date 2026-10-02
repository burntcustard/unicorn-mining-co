import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { GameSession } from '../src/server/game-session';
import { parseClientMessage } from '../src/server/parse-client-message';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { addEntity } from '../src/shared/simulation/world';

let now = 0;
let session: GameSession;
let delay = 0;
const originalPerformance = globalThis.performance;
const packets: { at: number; receive: () => void }[] = [];

class Socket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: Uint8Array }) => void;
  onclose?: (event: { code: number }) => void;
  peer = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: Uint8Array) => {
      const receive = () => this.onmessage?.({ data });

      if (delay) packets.push({ at: now + delay, receive });
      else receive();
    },
    close() {},
    terminate() {},
  };
  send(data: Uint8Array) {
    const message = parseClientMessage(Buffer.from(data));

    assert(message);
    const receive = () =>
      session.receive({ message, socket: this.peer as unknown as WebSocket });

    if (delay) packets.push({ at: now + delay, receive });
    else receive();
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
  const scenarios = [0, 8, 20].flatMap((phase) => [
    { phase, tapTicks: 0, separation: 600 },
    ...[18, 30].flatMap((tapTicks) =>
      [160, 1000].map((separation) => ({ phase, tapTicks, separation })),
    ),
  ]);

  for (const fps of [60, 144]) {
    for (const latency of [0, 10, 40]) {
      for (const { phase, tapTicks, separation } of scenarios) {
        if (latency && tapTicks) continue;
        now = delay = 0;
        packets.length = 0;
        session = new GameSession({ worldSeed: 25 });
        Reflect.get(session, 'regions').sync = () => {};
        const clients = Array.from(
          { length: 2 },
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
        ships.forEach((ship, index) => {
          Vec.set(ship.position, Vec.create(index * separation));
          Vec.set(ship.velocity, Vec.create());
          ship.rotation = ship.spin = 0;
          addEntity(session.world, ship);
        });
        session.tick();
        clients.forEach((client) =>
          client.updateFrame({
            input: emptyPlayerInput(),
            dt: 1 / 30,
            now,
          }),
        );
        delay = latency;
        const samples: { at: number; rotation: number }[][] = [[], []];
        let nextTick = phase + 1000 / 30;

        for (let frame = 1; frame <= fps * 8; frame++) {
          now = (frame * 1000) / fps;
          const input = {
            ...emptyPlayerInput(),
            turn: tapTicks
              ? now >= 1000 && now < 1000 + (tapTicks * 1000) / 30
                ? 1
                : 0
              : now < 1000
                ? 0
                : Math.floor((now - 1000) / 500) % 2
                  ? -1
                  : 1,
          };

          clients[0].recordInput({ input });
          const deliver = () => {
            while (true) {
              const at = packets.findIndex((packet) => packet.at <= now);

              if (at < 0) break;
              packets.splice(at, 1)[0].receive();
            }
          };

          deliver();

          while (nextTick <= now + 1e-6) {
            session.tick();
            nextTick += 1000 / 30;
          }
          deliver();
          clients.forEach((client, index) => {
            const pending = Reflect.get(client, 'pendingSnapshot');
            const updated = client.updateFrame({
              input: index ? emptyPlayerInput() : input,
              dt: 1 / fps,
              now,
            });

            assert(
              !pending || updated,
              'received state refreshes sprites even between simulation ticks',
            );
            const pose = client.remoteMotion
              .sample({
                now,
                world: client.world,
                predicted: client.predictFrame({ now }),
              })
              .get(ships[0].id)!;

            samples[index].push({ at: now, rotation: pose.rotation });
          });
        }
        const angle = (value: number) =>
          Math.atan2(Math.sin(value), Math.cos(value));

        // Exercise short releases at fixed server/frame phases so timer
        // scheduling cannot hide a reversal in either displayed ship.
        if (tapTicks) {
          const worstBacksteps = samples.map((frames, client) => {
            const worst = frames.reduce(
              (worst, pose, index) =>
                Math.max(
                  worst,
                  index
                    ? -angle(pose.rotation - frames[index - 1].rotation)
                    : 0,
                ),
              0,
            );

            assert(
              worst < 0.002,
              JSON.stringify({
                fps,
                phase,
                tapTicks,
                separation,
                client,
                worst,
              }),
            );
            assert(
              Math.abs(angle(frames.at(-1)!.rotation - ships[0].rotation)) <
                0.01,
              'a released turn settles at the authoritative stop',
            );
            return worst;
          });

          console.log(
            JSON.stringify({
              fps,
              phase,
              tapTicks,
              separation,
              worstBacksteps,
            }),
          );
          continue;
        }

        // Compare the rendered path of the very same ship on both clients.
        // The original buffered renderer adds about 100 ms even with no latency.
        const errors = Array.from({ length: 241 }, (_, index) => {
          const lag = index - 40;
          let squared = 0,
            count = 0;

          for (const own of samples[0]) {
            if (own.at < 2000 || own.at > 7000) continue;
            const target = ((own.at + lag) * fps) / 1000 - 1;
            const i = Math.floor(target),
              fraction = target - i;
            const a = samples[1][i],
              b = samples[1][i + 1];

            if (!a || !b) continue;
            squared +=
              angle(
                a.rotation +
                  angle(b.rotation - a.rotation) * fraction -
                  own.rotation,
              ) ** 2;
            count++;
          }
          return { lag, rms: Math.sqrt(squared / count) };
        }).sort((a, b) => a.rms - b.rms);
        const response = samples.map(
          (frames) =>
            frames.find(
              (frame) => frame.at >= 1000 && Math.abs(frame.rotation) > 0.0001,
            )!.at - 1000,
        );

        assert(
          Math.abs(response[1] - response[0]) < 50 + 2 * latency,
          JSON.stringify({ fps, latency, phase, response }),
        );
        const best = errors[0];

        assert(
          Math.abs(best.lag) < 50 + 2 * latency,
          JSON.stringify({ fps, latency, best }),
        );
        assert(best.rms < 0.12, JSON.stringify({ fps, latency, best }));
        console.log(
          JSON.stringify({
            fps,
            phase,
            oneWayLatency: latency,
            fittedLagMs: best.lag,
            firstResponseMs: response,
            rmsRadians: best.rms,
          }),
        );
      }
    }
  }
} finally {
  Object.assign(globalThis, { performance: originalPerformance });
}
