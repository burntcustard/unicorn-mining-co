import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { createTestSession } from './helpers/create-session';
import type { GameSession } from '../src/server/game-session';
import { parseClientMessage } from '../src/server/parse-client-message';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { addEntity } from '../src/shared/simulation/world';
import { detectCollisions } from '../src/shared/collision/detect-collisions';

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
    session.receive({ message, socket: this.peer as unknown as WebSocket });
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

  for (const separation of [0, 85, 110, 160, 400]) {
    for (const latency of [40, 90]) {
      now = 0;
      delay = 0;
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
      await Promise.all(clients.map((client) => client.ready));
      const observer = session.world.entities.get(clients[0].shipId!)!;
      const pilot = session.world.entities.get(clients[1].shipId!)!;

      session.world.entities.clear();
      addEntity(session.world, observer);
      addEntity(session.world, pilot);
      Vec.set(observer.position, Vec.create(0, separation));
      Vec.set(observer.velocity, Vec.create());
      Vec.set(pilot.position, Vec.create(-300));
      Vec.set(pilot.velocity, Vec.create(240));
      const rock = addEntity(
        session.world,
        createAsteroid(session.world, {
          id: 999,
          position: Vec.create(70),
          radius: 45,
          mass: 1e9,
        }),
      );
      let last: Vec.Value | undefined;
      let lastAdvance = Vec.create();
      let maxJump = 0;
      let maxAcceleration = 0;
      let maxReceiveJump = 0;
      let maxUpdateJump = 0;
      let maxSnapshotJump = 0;
      let collisionTicks = 0;
      const viewer = clients[0];
      const correct = viewer.remoteMotion.correct.bind(viewer.remoteMotion);

      viewer.remoteMotion.correct = (options) => {
        correct(options);
        const before = options.before.get(pilot.id);
        const after = viewer.remoteMotion.sample(options).get(pilot.id);

        if (before && after) {
          maxSnapshotJump = Math.max(
            maxSnapshotJump,
            Vec.distance(before.position, after.position),
          );
        }
      };
      const render = () =>
        viewer.remoteMotion
          .sample({
            now,
            world: viewer.world,
            predicted: viewer.predictFrame({ now }),
            shipId: viewer.shipId,
          })
          .get(pilot.id)?.position;

      // The steering release is at five seconds; two more seconds cover
      // subsequent contacts and delayed reconciliation.
      for (let frame = 1; frame <= 420; frame++) {
        now = (frame * 1000) / 60;
        delay = frame > 10 ? latency + (frame % 12 === 0 ? 20 : 0) : 0;

        if (frame % 2 === 0) {
          session.tick();

          if (
            detectCollisions({
              entities: [...session.world.entities.values()],
            }).some(
              (contact) =>
                contact.collider.physics !== false &&
                contact.other.physics !== false &&
                (contact.collider.owner.id === pilot.id ||
                  contact.other.owner.id === pilot.id),
            )
          ) {
            collisionTicks++;
          }
        }
        const beforeReceive = render();

        packets
          .filter((packet) => packet.at <= now)
          .forEach((packet) => packet.receive());
        const retained = packets.filter((packet) => packet.at > now);

        packets.splice(0, packets.length, ...retained);
        const beforeReconcile = render();

        clients.forEach((client, index) =>
          client.updateFrame({
            input: {
              ...emptyPlayerInput(),
              thrust: index === 1 ? 1 : 0,
              turn: index === 1 && frame >= 240 && frame < 300 ? 1 : 0,
            },
            dt: 1 / 60,
            now,
          }),
        );
        const pose = render();

        if (frame > 30 && pose && last) {
          const advance = Vec.subtract(pose, last);

          maxJump = Math.max(maxJump, Vec.length(advance));
          maxAcceleration = Math.max(
            maxAcceleration,
            Vec.distance(advance, lastAdvance),
          );

          if (beforeReceive && beforeReconcile) {
            maxReceiveJump = Math.max(
              maxReceiveJump,
              Vec.distance(beforeReceive, beforeReconcile),
            );
            const jump = Vec.distance(beforeReconcile, pose);

            maxUpdateJump = Math.max(maxUpdateJump, jump);
          }
          lastAdvance = advance;
        }
        last = pose && Vec.clone(pose);
      }
      assert(collisionTicks > 0, 'the replay must contain collisions');
      assert(session.world.entities.has(rock.id));
      assert(
        session.world.entities.has(pilot.id),
        'the pilot survives the collision replay',
      );
      assert(
        maxReceiveJump < 1e-7,
        'packet bursts must not jump the displayed ship',
      );
      assert(
        maxSnapshotJump < 1e-7,
        'snapshot reconciliation must preserve the displayed ship',
      );
      console.log(
        JSON.stringify({
          separation,
          latency,
          collisionTicks,
          maxJump,
          maxAcceleration,
          maxReceiveJump,
          maxUpdateJump,
          maxSnapshotJump,
          finalPosition: pilot.position,
          finalVelocity: pilot.velocity,
        }),
      );
    }
  }
} finally {
  Object.assign(globalThis, { performance: originalPerformance });
}
