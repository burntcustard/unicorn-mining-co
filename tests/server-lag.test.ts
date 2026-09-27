import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { RemoteMotion } from '../src/client/remote-motion';
import { GameSession } from '../src/server/game-session';
import { parseClientMessage } from '../src/server/parse-client-message';
import { ReplicationManager } from '../src/server/replication';
import { GameObject } from '../src/shared/game-object';
import { createStation } from '../src/shared/craft/create-station';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { createShip } from '../src/shared/craft/create-ship';
import { Ship } from '../src/shared/craft/ship';
import {
  addEntity,
  addPlayer,
  createWorld,
} from '../src/shared/simulation/world';
import { updateWorld } from '../src/shared/simulation/update-world';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { SearchLight } from '../src/shared/modules';
import { maxPredictionTicks, simulationStep } from '../src/shared/settings';
import { type InputFrame } from '../src/shared/protocol/input-frame';
import { type ServerMessage } from '../src/shared/protocol/network';

// Batched movement preserves short input edges, including edges in later ticks.
const runInputs = (batched: boolean) => {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const off = emptyPlayerInput(),
    on = { ...off, thrust: 1, turn: 1 };
  const changes = [
    { input: on, offset: simulationStep + 0.007 },
    { input: off, offset: 2 * simulationStep + 0.013 },
  ];

  if (batched) {
    updateWorld({
      world,
      inputs: new Map([[1, { input: off, changes }]]),
      dt: 0.1,
      ticks: 3,
    });
  } else {
    for (let tick = 0; tick < 3; tick++) {
      const frame: InputFrame = {
        input: tick === 2 ? on : off,
        changes: changes
          .filter((c) => Math.floor(c.offset / simulationStep) === tick)
          .map((c) => ({ ...c, offset: c.offset - tick * simulationStep })),
      };

      updateWorld({ world, inputs: new Map([[1, frame]]) });
    }
  }
  return { ship, world };
};
const batched = runInputs(true),
  regular = runInputs(false);

assert.equal(batched.world.tick, 3);
assert(Vec.distance(batched.ship.position, regular.ship.position) < 1e-5);
assert(Vec.distance(batched.ship.velocity, regular.ship.velocity) < 1e-5);
assert.equal(batched.ship.thrust, 0);
assert.equal(batched.ship.turn, 0);

// Crossing distant replication deadlines must work even when tick IDs skip them.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  const item = addEntity(
    world,
    createStation({ id: 900, position: Vec.create(2500), spin: 1 }),
  );
  const replication = new ReplicationManager();

  world.tick = 1;
  replication.initial({ world, shipId: ship.id });

  for (const tick of [5, 9, 13]) {
    world.tick = tick;
    item.rotation += 0.1;
    assert(
      replication
        .snapshot({ world, shipId: ship.id })
        .fullEntities.some((entity) => entity.id === item.id),
      'skipped modulo deadlines still replicate distant entities',
    );
  }
}
// Continuous collision detection must sweep the whole overdue movement span.
{
  const world = createWorld();
  const moving = addEntity(
    world,
    new GameObject({
      id: 1,
      position: Vec.create(-40),
      velocity: Vec.create(500),
      radius: 5,
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  addEntity(
    world,
    new GameObject({
      id: 2,
      radius: 101,
      mass: 1e9,
      shapeOutline: [
        [-1, -100],
        [1, -100],
        [1, 100],
        [-1, 100],
      ],
    }),
  );
  updateWorld({ world, inputs: new Map(), dt: 0.1, ticks: 3 });
  assert(
    moving.position.x < 0,
    '100ms sweep cannot tunnel through a thin wall',
  );
}

// A stationary pilot need not occur in a delta packet: remote cadence still adapts.
{
  const motion = new RemoteMotion();
  const entity = {
    id: 2,
    kind: 'object' as const,
    position: Vec.create(),
    radius: 10,
    rotation: 0,
    spin: 0,
  };

  motion.receive({
    entities: [entity],
    entityIds: [2],
    shipId: 1,
    tick: 1,
    now: 0,
  });
  motion.receive({
    entities: [{ ...entity, position: Vec.create(10) }],
    entityIds: [2],
    shipId: 1,
    tick: 4,
    now: 100,
  });
  assert(
    Math.abs(motion.sample({ now: 150 }).get(2)!.position.x - 5) < 1e-9,
    'remote movement spans the whole 100ms packet interval without a local ship delta',
  );
}

// A batch must consume each queued tick and retain later input transitions.
{
  const queued = new GameSession({ worldSeed: 25 });

  Reflect.get(queued, 'regions').sync = () => {};
  const sent: ServerMessage[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
    close() {},
    terminate() {},
  } as unknown as WebSocket;

  queued.receive({ socket, message: { type: 'hello', playerToken: null } });
  const player = [...Reflect.get(queued, 'players').values()][0];

  for (const [tick, sequence, thrust] of [
    [1, 1, 1],
    [2, 2, 0],
    [4, 3, 1],
  ]) {
    queued.receive({
      socket,
      message: {
        type: 'input',
        tick,
        sequence,
        input: { ...emptyPlayerInput(), thrust },
        offset: 0.007,
      },
    });
  }
  queued.tick({ ticks: 3 });
  assert.equal(player.lastSequence, 2);
  assert.equal(player.ship.thrust, 0);
  assert(player.inputs.has(4), 'future transitions survive a catch-up batch');
  queued.tick({ ticks: 2 });
  assert.equal(player.lastSequence, 3);
  assert.equal(player.ship.thrust, 1);

  queued.receive({
    socket,
    message: {
      type: 'input',
      tick: queued.world.tick + 180,
      sequence: 4,
      input: { ...emptyPlayerInput(), searchLight: true },
    },
  });
  assert.equal(player.lastSequence, 4);
  assert.equal(player.inputs.size, 0, 'far-ahead controls are not parked');
  queued.tick();
  assert(player.ship.moduleActive({ module: SearchLight }));

  const packetsBeforeCongestion = sent.length;

  Reflect.set(socket, 'bufferedAmount', 128 * 1024 + 1);
  player.ship.position.x += 100;
  queued.tick();
  assert.equal(sent.length, packetsBeforeCongestion);
  Reflect.set(socket, 'bufferedAmount', 0);
  queued.tick();
  const resumed = sent.at(-1);

  assert(resumed?.type === 'snapshot');
  assert(
    resumed.fullEntities.some(
      (entity) =>
        entity.id === player.shipId &&
        entity.position?.x === player.ship.position.x,
    ),
    'the resumed snapshot includes changes since the last one sent',
  );
}

// Every snapshot path shares one receipt window, including dock and respawn.
{
  const game = new GameSession({ worldSeed: 25 });

  Reflect.get(game, 'regions').sync = () => {};
  const sent: ServerMessage[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
    close() {},
    terminate() {},
  } as unknown as WebSocket;

  game.receive({
    socket,
    message: {
      type: 'hello',
      playerToken: null,
      snapshotAcknowledgements: true,
    },
  });
  const player = [...Reflect.get(game, 'players').values()][0];
  const acknowledge = (sequence: number) =>
    game.receive({ socket, message: { type: 'snapshotAck', sequence } });

  game.tick();
  assert.equal(sent.length, 3);
  acknowledge(1000);
  game.tick();
  assert.equal(
    sent.length,
    3,
    'unsent acknowledgements cannot bypass the window',
  );
  const lastInputAt = player.lastInputAt;

  acknowledge(1);
  assert.equal(
    player.lastInputAt,
    lastInputAt,
    'receipts do not defeat idle timeout',
  );
  game.tick();
  acknowledge(1);
  game.tick();
  assert.equal(
    sent.length,
    4,
    'duplicate acknowledgements do not free another slot',
  );

  player.ship.dockedTo = -1;
  player.ship.credits = 1000;
  const previousShades = player.ship.shades;

  game.receive({
    socket,
    message: { type: 'dock', action: 'paint', paint: 1 },
  });
  assert.equal(sent.length, 4, 'dock actions cannot bypass congestion');
  assert.notDeepEqual(player.ship.shades, previousShades);
  acknowledge(3);
  game.tick();
  const resumed = sent.at(-1);

  assert(resumed?.type === 'snapshot');
  assert(
    resumed.fullEntities.some(
      (entity) =>
        entity.id === player.shipId &&
        JSON.stringify(entity.shades) === JSON.stringify(player.ship.shades),
    ),
  );
  game.tick();
  const beforeRespawn = sent.length;

  game.world.entities.delete(player.shipId);
  const station = addEntity(
    game.world,
    createStation({ id: 900, position: Vec.create() }),
  );

  Reflect.set(game, 'nearestStation', () => station);
  game.receive({ socket, message: { type: 'respawn' } });
  assert.equal(
    sent.length,
    beforeRespawn + 1,
    'respawn control is immediate, its load waits for capacity',
  );
  assert.equal(sent.at(-1)?.type, 'respawn');
  acknowledge(5);
  game.tick();
  const load = sent.at(-1);

  assert(load?.type === 'load');
  assert(load.fullEntities.some((entity) => entity.id === player.shipId));

  const replacement = {
    readyState: 1,
    bufferedAmount: 0,
    close() {},
    terminate() {},
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
  } as WebSocket;

  game.disconnect({ socket });
  game.receive({
    socket: replacement,
    message: {
      type: 'hello',
      playerToken: player.token,
      snapshotAcknowledgements: true,
    },
  });
  const reloaded = sent.at(-1);

  assert(reloaded?.type === 'load');
  assert.equal(reloaded.snapshotSequence, 1);
  acknowledge(1);
  assert.deepEqual(
    player.pendingSnapshots,
    [1],
    'old connections cannot acknowledge the replacement load',
  );
}

let now = 0;
let session: GameSession;
const originalPerformance = globalThis.performance;

class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: ({ data }: { data: string }) => void;
  onclose?: ({ code }: { code: number }) => void;
  peer = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => this.onmessage?.({ data }),
    close() {},
    terminate() {},
  };
  send(data: string) {
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

  // Reproduce the live phase lock: packets arrive after the synthetic tick
  // boundary but before RAF. Continuous traffic must never starve application.
  {
    now = 0;
    session = new GameSession({ worldSeed: 25 });
    Reflect.get(session, 'regions').sync = () => {};
    const clients = Array.from(
      { length: 3 },
      () => new NetworkClient({ url: 'ws://test' }),
    );

    clients.forEach((client) =>
      (Reflect.get(client, 'socket') as Socket).onopen?.(),
    );
    await Promise.all(clients.map((client) => client.ready));
    const pending: { data: string }[][] = clients.map(() => []);
    const receivers = clients.map((client, index) => {
      const socket = Reflect.get(client, 'socket') as Socket;
      const receive = socket.onmessage!;

      socket.onmessage = (message) => pending[index].push(message);
      return receive;
    });

    now = 10;
    clients.forEach((client) =>
      client.updateFrame({ input: emptyPlayerInput(), dt: 0.01, now }),
    );
    const start = clients.map((client) =>
      Vec.clone(client.world.entities.get(client.shipId!)!.position),
    );
    let largestLag = 0;

    for (let frame = 1; frame <= 600; frame++) {
      now = (frame * 1000) / 60;

      if (frame % 2 === 0) session.tick();
      clients.forEach((client, index) => {
        now = (frame * 1000) / 60 + [-5, 5, 9][index];
        pending[index].splice(0).forEach(receivers[index]);
        now = (frame * 1000) / 60 + 10;
        client.updateFrame({
          input: { ...emptyPlayerInput(), thrust: 1, searchLight: true },
          dt: 1 / 60,
          now,
        });
        largestLag = Math.max(
          largestLag,
          session.world.tick - client.serverTick,
        );
      });
    }
    assert.equal(
      largestLag,
      0,
      'every arriving snapshot applies in the next whole simulation step',
    );
    clients.forEach((client, index) => {
      const ship = client.world.entities.get(client.shipId!) as Ship;

      assert(Vec.distance(start[index], ship.position) > 1000);
      assert(
        ship.segments.some(
          (segment) =>
            segment.module instanceof SearchLight &&
            segment.activationProgress > 0.9,
        ),
      );
    });
    console.log(
      'Three arrival phases: all 300 snapshots applied, movement and lights progress',
    );
  }

  // Replay the observed ~3.1 KB packets over a 5 KiB/s downstream link.
  // The proxy accepts writes immediately: Node bufferedAmount stays zero.
  // Pad small isolated-world packets to the size recorded in the asteroid field.
  for (const flowControlled of [false, true]) {
    now = 0;
    session = new GameSession({ worldSeed: 25 });
    Reflect.get(session, 'regions').sync = () => {};
    const clients = Array.from(
      { length: 3 },
      () => new NetworkClient({ url: 'ws://test' }),
    );

    clients.forEach((client) =>
      (Reflect.get(client, 'socket') as Socket).onopen?.(),
    );
    await Promise.all(clients.map((client) => client.ready));
    const player = [...Reflect.get(session, 'players').values()][0];

    player.snapshotAcknowledgements = flowControlled;
    const socket = Reflect.get(clients[0], 'socket') as Socket;
    const receive = socket.onmessage!;
    const queue: { data: string; remaining: number }[] = [];

    socket.onmessage = ({ data }) => {
      const packet = JSON.parse(data);

      packet.padding = ' '.repeat(Math.max(0, 3100 - Buffer.byteLength(data)));
      data = JSON.stringify(packet);
      queue.push({ data, remaining: Buffer.byteLength(data) });
    };
    let largestQueue = 0;
    let largestLag = 0;
    let healthyLag = 0;
    let recoveryFrames = 0;

    for (let frame = 1; frame <= 780; frame++) {
      now = (frame * 1000) / 60;

      if (frame % 2 === 0) session.tick();
      let bytes = (frame <= 720 ? 5 * 1024 : 100 * 1024) / 60;

      while (queue.length && bytes > 0) {
        const packet = queue[0];
        const consumed = Math.min(bytes, packet.remaining);

        bytes -= consumed;
        packet.remaining -= consumed;

        if (packet.remaining <= 0) {
          queue.shift();
          receive({ data: packet.data });
        }
      }
      clients.forEach((client) =>
        client.updateFrame({
          input: { ...emptyPlayerInput(), thrust: 1, searchLight: true },
          dt: 1 / 60,
          now,
        }),
      );
      largestQueue = Math.max(largestQueue, queue.length);
      largestLag = Math.max(
        largestLag,
        session.world.tick - clients[0].serverTick,
      );
      healthyLag = Math.max(
        healthyLag,
        ...clients
          .slice(1)
          .map((client) => session.world.tick - client.serverTick),
      );

      if (
        frame > 720 &&
        !recoveryFrames &&
        session.world.tick - clients[0].serverTick <= 2
      ) {
        recoveryFrames = frame - 720;
      }
    }
    assert.equal(
      healthyLag,
      0,
      'the slow receiver never holds up other players',
    );

    if (flowControlled) {
      assert(largestQueue <= 2);
      assert(
        largestLag < 60,
        'slow delivery cannot accumulate seconds of stale snapshots',
      );
      assert(
        recoveryFrames > 0 && recoveryFrames <= 6,
        'current state arrives within 100ms of bandwidth recovery',
      );
      assert.equal(socket.peer.bufferedAmount, 0);
      const clientShip = clients[0].world.entities.get(
        clients[0].shipId!,
      ) as Ship;

      assert(
        clientShip.segments.some(
          (segment) =>
            segment.module instanceof SearchLight &&
            segment.activationProgress > 0.9,
        ),
      );
    } else {
      assert(
        largestQueue > 250,
        'without receipt acknowledgements the observed backlog reproduces',
      );
      assert(
        largestLag >= 279,
        'the old sender reproduces at least the live 9.3-second backlog',
      );
    }
    console.log(
      JSON.stringify({
        flowControlled,
        largestQueue,
        largestLag,
        healthyLag,
        recoveryFrames,
      }),
    );
  }

  for (const [interval, frameStep] of [
    [2, 1],
    [6, 1],
    [12, 1],
    [6, 6],
  ]) {
    now = 0;
    session = new GameSession({ worldSeed: 25 });
    // Isolate the real session/protocol/prediction clocks from random contacts.
    Reflect.get(session, 'regions').sync = () => {};
    const clients = Array.from(
      { length: 3 },
      () => new NetworkClient({ url: 'ws://test' }),
    );

    clients.forEach((client) =>
      (Reflect.get(client, 'socket') as Socket).onopen?.(),
    );
    await Promise.all(clients.map((client) => client.ready));
    const players = [...Reflect.get(session, 'players').values()];

    players.forEach((player, index) => {
      Vec.setXY(player.ship.position, index * 500, 0);
      Vec.setXY(player.ship.velocity, 100, 0);
      player.ship.drag = 0;
      player.socket.send(
        JSON.stringify(
          player.replication.initial({
            world: session.world,
            shipId: player.shipId,
          }),
        ),
      );
      // drag is a model property, not replicated; set it on both test worlds.
      clients[index].world.entities.forEach((entity) => {
        entity.drag = 0;
      });
    });
    const start = clients.map(
      (client) =>
        client.predictFrame({ now }).entities.get(client.shipId!)!.position.x,
    );
    const previous = [...start];
    let pausedFrames = 0,
      largestAdvance = 0,
      pausedRemoteFrames = 0;
    let previousRemote = 0;

    for (let frame = frameStep; frame <= 1800; frame += frameStep) {
      now = (frame * 1000) / 60;

      if (frame % interval === 0) session.tick({ ticks: interval / 2 });
      clients.forEach((client, index) => {
        client.updateFrame({
          input: emptyPlayerInput(),
          dt: frameStep / 60,
          now,
        });
        const x = client.predictFrame({ now }).entities.get(client.shipId!)!
          .position.x;

        if (frame > 60 && x - previous[index] < 0.01) pausedFrames++;

        if (frame > 60) {
          largestAdvance = Math.max(largestAdvance, x - previous[index]);
        }
        previous[index] = x;
      });
      const remote = clients[0].remoteMotion
        .sample({ now })
        .get(clients[1].shipId!)?.position.x;

      if (remote !== undefined) {
        if (frame > 60 && remote - previousRemote < 0.01) pausedRemoteFrames++;
        previousRemote = remote;
      }
    }
    assert.equal(
      session.world.tick,
      900,
      'server accounts for all elapsed time',
    );
    players.forEach((player) =>
      assert(
        Math.abs(
          player.ship.position.x - (players.indexOf(player) * 500 + 3000),
        ) < 0.01,
      ),
    );
    clients.forEach((client, index) =>
      assert(
        Math.abs(previous[index] - start[index] - 3000) < 10,
        'prediction advances at real-time speed',
      ),
    );
    assert(
      pausedFrames < 12,
      `clients must keep moving between ${interval / 60}s snapshots: ${pausedFrames} paused frames`,
    );
    assert(
      pausedRemoteFrames < 4,
      'remote ships interpolate continuously at the slower cadence',
    );
    console.log(
      JSON.stringify({
        pausedRemoteFrames,
        snapshotMs: (interval * 1000) / 60,
        clientFrameMs: (frameStep * 1000) / 60,
        serverTick: session.world.tick,
        pausedFrames,
        largestAdvance,
        clientTravel: previous.map((x, i) => x - start[i]),
      }),
    );
    // One pilot misses ten seconds of snapshots while others stay current.
    const delayed = clients[0];
    const socket = Reflect.get(delayed, 'socket') as Socket;
    const receive = socket.onmessage;
    const delayedMessages: { data: string }[] = [];
    const delayedTicks = interval === 2 && frameStep === 1 ? 300 : 24;
    let delayedTravel = 0;

    if (delayedTicks === 300) {
      for (let index = 0; index < 8; index++) {
        addEntity(
          session.world,
          createAsteroid(session.world, {
            position: Vec.create(
              players[1].ship.position.x + 1400 + (index % 4) * 30,
              Math.floor(index / 4) * 30,
            ),
            radius: 25,
            velocity: Vec.create(index % 2 ? -10 : 10),
          }),
        );
      }
    }

    socket.onmessage = (message) => delayedMessages.push(message);

    for (let tick = 0; tick < delayedTicks; tick++) {
      now += 1000 / 30;
      session.tick();
      const before = delayed.world.entities.get(delayed.shipId!)!.position.x;
      const input = {
        ...emptyPlayerInput(),
        searchLight: tick >= 180,
      };

      clients.forEach((client, index) =>
        client.updateFrame({
          input: index === 0 ? input : emptyPlayerInput(),
          dt: 1 / 30,
          now,
        }),
      );

      if (tick >= 18) {
        delayedTravel +=
          delayed.world.entities.get(delayed.shipId!)!.position.x - before;
      }
    }
    assert(delayedTravel > 10, 'prediction bridges short delivery gaps');
    assert(
      delayedMessages.length <= 2,
      'an outage queues at most two snapshots',
    );
    assert(delayed.world.tick <= delayed.serverTick + 2 * maxPredictionTicks);
    assert(clients[1].serverTick > delayed.serverTick);

    if (delayedTicks === 300) {
      const ship = players[0].ship;

      assert(ship instanceof Ship);
      const light = ship.segments.find(
        (segment) => segment.module instanceof SearchLight,
      );

      assert(light);
      assert(
        light.activationProgress > 0.9,
        'stale-tick controls still activate the authoritative light',
      );
      assert(
        Reflect.get(Reflect.get(delayed, 'prediction'), 'history').size <= 60,
        'long gaps retain bounded prediction history',
      );
    }
    socket.onmessage = receive;
    delayedMessages.forEach((message) => receive?.(message));
    now += 1000 / 30;
    session.tick();
    delayed.updateFrame({ input: emptyPlayerInput(), dt: 1 / 30, now });
    assert(
      Math.abs(delayed.world.tick - clients[1].world.tick) <= 2,
      'delayed pilot catches up when snapshots resume',
    );

    // A genuine outage bounds prediction, but input releases still reach the server.

    for (let i = 0; i < 120; i++) {
      now += 1000 / 60;
      delayed.updateFrame({ input: emptyPlayerInput(), dt: 1 / 60, now });
    }
    assert(delayed.world.tick <= delayed.serverTick + 2 * maxPredictionTicks);
  }
} finally {
  Object.assign(globalThis, { performance: originalPerformance });
}
console.log(
  'Elapsed-time movement, input edges, replication and 3-client stalled-server prediction passed',
);
