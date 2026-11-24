import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import {
  decodeClientMessage,
  encodeServerControl,
} from '../../src/client/protocol/binary-control';
import { snapshotDeltaQuery } from '../../src/client/protocol/binary-snapshot';
import { maxPredictionTicks } from '../../src/specs/prediction';
import { testBuildPlugin } from '../support/build-plugin.ts';

const status = { hidden: true, textContent: '' };
const sockets: TestWebSocket[] = [];

class TestWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = TestWebSocket.OPEN;
  onclose?: (event: { code: number; reason: string }) => void;
  onopen?: () => void;
  onmessage?: (event: { data: Uint8Array | string }) => void;
  closed: number[] = [];
  sent: Uint8Array[] = [];
  text: string[] = [];

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(data: Uint8Array | string) {
    if (typeof data === 'string') {
      this.text.push(data);
    } else {
      this.sent.push(data);
    }
  }

  close(code = 1000) {
    assert(code === 1000 || (code >= 3000 && code <= 4999));
    this.readyState = TestWebSocket.CLOSED;
    this.closed.push(code);
    this.onclose?.({ code, reason: '' });
  }
}

class TestDataChannel {
  binaryType = 'blob';
  onopen?: () => void;
  onmessage?: (event: { data: ArrayBuffer | string }) => void;

  constructor(
    readonly label: string,
    readonly options: RTCDataChannelInit,
  ) {}
}

const peers: TestRTCPeerConnection[] = [];

class TestRTCPeerConnection extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription?: RTCSessionDescriptionInit;
  remoteDescription?: RTCSessionDescriptionInit;
  channel?: TestDataChannel;
  rejectAnswer = false;
  closes = 0;

  onconnectionstatechange?: () => void;

  constructor() {
    super();
    peers.push(this);
  }

  createDataChannel(label: string, options: RTCDataChannelInit) {
    this.channel = new TestDataChannel(label, options);
    return this.channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'initial offer' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    this.iceGatheringState = 'gathering';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;

    if (this.rejectAnswer) throw new Error('Invalid answer');
  }

  finishGathering() {
    this.localDescription = { type: 'offer', sdp: 'offer with candidates' };
    this.iceGatheringState = 'complete';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }

  close() {
    this.closes++;
    this.connectionState = 'closed';
  }
}

const settleRtc = () => new Promise<void>((resolve) => setImmediate(resolve));

const movementDatagram = (tick: bigint, id: bigint, position = 120) => {
  const data = new ArrayBuffer(40);
  const view = new DataView(data);

  view.setBigUint64(0, tick, true);
  view.setBigUint64(8, id, true);
  [position, -20, 3, -4, 0.5, -0.25].forEach((value, index) =>
    view.setFloat32(16 + index * 4, value, true),
  );
  return data;
};

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

const timers = new Map<number, { at: number; run: () => void }>();

let nextTimer = 0;
let elapsed = 0;

const advanceTimers = (duration: number) => {
  const end = elapsed + duration;

  for (;;) {
    const next = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];

    if (!next || next[1].at > end) break;
    const [id, { at, run }] = next;

    elapsed = at;
    timers.delete(id);
    run();
  }

  elapsed = end;
};

Object.assign(globalThis, {
  setTimeout: (run: () => void, delay: number) => {
    const id = ++nextTimer;

    timers.set(id, { at: elapsed + delay, run });
    return id;
  },
  clearTimeout: (id: number) => timers.delete(id),
});

Object.assign(globalThis, {
  document: {
    fonts: { check: () => false },
    getElementById: (id: string) =>
      id === 'connection-status' ? status : null,
  },
  location: { protocol: 'http:', host: 'localhost' },
  WebSocket: TestWebSocket,
  localStorage: {
    getItem: (): string | null => null,
    removeItem: () => {},
    setItem: () => {},
  },
  Path2D: class {
    addPath() {}
  },
});

const entry = resolve('src/__connection_test.ts');
const bannedMessage =
  'Sorry, you have been banned. Contact john@burnt.io if you think this was a mistake';

const welcome = {
  data: encodeServerControl({
    type: 'welcome',
    playerNumber: 1,
    shipId: 7,
    playerId: '01234567-89ab-cdef-0123-456789abcdef',
    serverTick: 0,
    worldSeed: 25,
    spawn: { x: 0, y: 0 },
  }),
};

const loadSnapshot = (tick: number) => ({
  data: Uint8Array.from([0x55, 0x4d, 1, 1, tick, 8, 0]),
});

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entry,
    plugins: [
      {
        name: 'connection-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? `import {NetworkClient} from '${resolve('src/client/network/network.ts')}';
               import {emptyPlayerInput} from '${resolve('src/client/protocol/input.ts')}';
               export default (url = 'test', deferred = false) => new NetworkClient({url, deferred});
               export const startPlaying = client => client.enterWorld();
               export const returnToMenu = client => client.leaveWorld();
               export const inspectSnapshot = client => [
                 [...client.entityRecords.keys()],
                 [...client.pendingEntities.keys()],
                 client.asteroidPositions.map(position => position.x),
               ];
               export const inspectModule = client => {
                 const module = client.entityRecords.get(7).modules[0];
                 return [module.shades, module.segments[0].active];
               };
               export const receiveStationStock = client => {
                 const stationId = 7;
                 const receive = (serverTick, fullEntities, stationStock, type = 'snapshot') => {
                   client.receive({message: {type, serverTick, fullEntities, stationStock, entityIds: [stationId], nextEntityId: 104}});
                 };
                 const read = () => {
                   client.updateFrame({input: emptyPlayerInput(), now: performance.now() + 1, dt: 0});
                   const station = client.world.entities.get(stationId);
                   return [Math.round(station.position.x), station.rotation.toFixed(3), station.cargoContents.map(item => item.id)];
                 };

                 receive(1, [{id: stationId, kind: 'station', position: {x: 100, y: 0}, velocity: {x: 30, y: 0}, radius: 100, spin: 1, rotation: 0}],
                   {stationId, replace: true, removedIds: [], entries: [{id: 100, resource: 0}, {id: 101, resource: 0}]}, 'load');
                 client.connected = true;
                 receive(3, [], {stationId, replace: false, removedIds: [100], entries: [{id: 102, resource: 0}]});
                 const patched = read();

                 receive(4, [{id: stationId, position: {x: 200, y: 0}, rotation: 0.5}],
                   {stationId, replace: false, removedIds: [], entries: [{id: 103, resource: 0}]});
                 receive(6, [], {stationId, replace: false, removedIds: [101], entries: []});
                 const batched = read();

                 receive(8, [], {stationId: 0, replace: false, removedIds: [], entries: []});
                 return [patched, batched, read()];
               };
               export const switchDockedShip = client => {
                 client.connected = true;
                 client.playerNumber = 1;
                 client.shipId = 7;
                 client.world.players.set(1, {playerNumber: 1, shipId: 7});
                 client.world.entities.set(7, {id: 7, dockedTo: 100, dead: false});
                 client.receive({message: {type: 'respawn', shipId: 8}});
                 const during = client.shipDestroyed;
                 client.world.entities.delete(7);
                 client.applySnapshot({message: {type: 'load', fullEntities: [], entityIds: [], nextEntityId: 1, serverTick: 1}});
                 return [during, client.shipDestroyed];
               };
               export const inspectMovement = client => [
                 client.connected,
                 client.serverTick,
                 [...client.remoteMotion.pendingMovement.values()].map(sample => [
                   sample.id, sample.tick, sample.position.x, sample.position.y,
                   sample.velocity.x, sample.velocity.y, sample.rotation, sample.spin,
                 ]),
               ];
               export const setWorldTick = (client, tick) => {
                 client.world.tick = tick;
               };`
            : undefined,
      },
      ...(production ? [buildPrePlugin(), testBuildPlugin()] : []),
    ],
  });

  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  );
  const connect = built.default;

  assert.deepEqual(
    built.switchDockedShip(connect()),
    [false, true],
    'a docked ship switch stays available until the replacement snapshot is applied',
  );

  assert.deepEqual(
    built.receiveStationStock(connect()),
    [
      [102, '0.067', [101, 102]],
      [202, '0.567', [102, 103]],
      [204, '0.633', []],
    ],
    'stock updates and clearing preserve station pose ticks across applied and batched snapshots',
  );

  for (const [code, reason, expected] of [
    [4003, bannedMessage, bannedMessage],
    [4001, 'Session opened elsewhere', 'GAME OPEN IN ANOTHER TAB'],
    [4002, 'Idle timeout', 'AWAY TOO LONG - RELOAD TO PLAY'],
  ] as const) {
    connect();
    let retries = 0;
    const setTimeout = globalThis.setTimeout;

    Object.assign(globalThis, {
      setTimeout: () => {
        retries++;
        return 0;
      },
    });

    try {
      sockets.at(-1)!.onclose!({ code, reason });
      assert.equal(status.hidden, false);
      assert.equal(status.textContent, expected);
      assert.equal(retries, 0);
    } finally {
      globalThis.setTimeout = setTimeout;
    }
  }

  timers.clear();
  connect('test', true);
  advanceTimers(999);
  assert.equal(status.hidden, true);
  advanceTimers(1);
  assert.equal(status.textContent, 'CONNECTING TO GAME...');
  sockets.at(-1)!.onmessage!(welcome);
  assert.equal(status.hidden, true);

  connect('test', true);
  const preparedSocket = sockets.at(-1)!;

  preparedSocket.onmessage!(welcome);
  advanceTimers(1000);
  assert.equal(status.hidden, true);

  preparedSocket.onclose!({ code: 1006, reason: '' });
  advanceTimers(600);
  const retrySocket = sockets.at(-1)!;

  assert.notEqual(retrySocket, preparedSocket);
  retrySocket.onmessage!(welcome);
  advanceTimers(400);
  assert.equal(status.hidden, true);

  const socketUrl = 'ws://localhost/game-socket';

  for (const code of [4002, 1006]) {
    timers.clear();
    const client = connect(socketUrl, true);
    const firstSocket = sockets.at(-1)!;
    const load = loadSnapshot(1);

    firstSocket.onopen!();
    firstSocket.onmessage!(welcome);
    const firstReady = built.startPlaying(client);

    firstSocket.onmessage!(load);
    await firstReady;
    built.returnToMenu(client);
    assert.equal(decodeClientMessage(firstSocket.sent.at(-1)!).type, 'leave');
    firstSocket.onmessage!({ data: encodeServerControl({ type: 'leave' }) });
    firstSocket.readyState = TestWebSocket.CLOSED;
    firstSocket.onclose!({ code, reason: '' });
    const socketCount = sockets.length;

    if (code === 4002) {
      advanceTimers(1000);
      assert.equal(sockets.length, socketCount);
      assert.equal(
        status.textContent,
        'AWAY TOO LONG - PRESS PLAY TO RECONNECT',
      );
    }

    const nextReady = built.startPlaying(client);
    const newSocket = sockets.at(-1)!;

    assert.equal(newSocket.url, firstSocket.url);
    assert.equal(sockets.length, socketCount + 1);
    assert.equal(built.startPlaying(client), nextReady);
    newSocket.onopen!();
    assert.deepEqual(
      newSocket.sent.map((frame) => decodeClientMessage(frame).type),
      ['prepare'],
    );
    newSocket.onmessage!(welcome);
    assert.deepEqual(
      newSocket.sent.map((frame) => decodeClientMessage(frame).type),
      ['prepare', 'play'],
    );
    newSocket.onmessage!(load);
    await nextReady;
    advanceTimers(1000);
    assert.equal(sockets.length, socketCount + 1);
    assert.equal(status.hidden, true);
  }

  const extended = connect(socketUrl);
  const extendedSocket = sockets.at(-1)!;

  assert.equal(extendedSocket.url, `${socketUrl}?${snapshotDeltaQuery}`);
  extendedSocket.onopen!();

  const point = (x: number) => {
    const bytes = Buffer.alloc(16);

    bytes.writeDoubleLE(x);
    return [...bytes];
  };

  extendedSocket.onmessage!({
    data: Uint8Array.from([
      0x55,
      0x4d,
      1,
      64,
      1,
      10,
      3,
      ...point(0),
      ...point(1),
      ...point(2),
      2,
      7,
      0,
      8,
      0,
    ]),
  });

  extendedSocket.onmessage!({
    data: Uint8Array.from([
      0x55,
      0x4d,
      1,
      128,
      3,
      2,
      10,
      1,
      1,
      1,
      ...point(9),
      1,
      7,
      1,
      9,
      0,
    ]),
  });

  assert.deepEqual(built.inspectSnapshot(extended), [
    [8, 9],
    [8, 9],
    [0, 9, 2],
  ]);

  connect(socketUrl);
  const rejectedSocket = sockets.at(-1)!;

  assert.equal(rejectedSocket.url, `${socketUrl}?${snapshotDeltaQuery}`);
  rejectedSocket.onclose!({ code: 1006, reason: '' });
  assert.equal(sockets.at(-1)!.url, socketUrl);
  assert.notEqual(sockets.at(-1), rejectedSocket);

  // Received deltas must be merged before a later render can coalesce them.
  timers.clear();
  const stream = connect();
  const socket = sockets.at(-1)!;

  socket.onopen!();
  socket.onmessage!(welcome);
  const packet = (tick: number, modules: number[]) =>
    Uint8Array.from([0x55, 0x4d, 1, 0, tick, 2, 1, 7, 1, 34, ...modules]);

  // A full red module, a repaint to orange, then an animation and an
  // unchanged module update all arrive before the game renders.
  socket.onmessage!({ data: packet(1, [2, 5, 8, 0, 2, 0, 0]) });
  socket.onmessage!({ data: packet(2, [2, 5, 8, 0, 2, 1, 0]) });
  socket.onmessage!({ data: packet(3, [3, 1, 129, 8, 0, 2, 1, 1]) });
  socket.onmessage!({ data: packet(4, [3, 0]) });
  assert.deepEqual(socket.closed, []);

  assert.deepEqual(built.inspectModule(stream), [
    ['#c61', '#e82', '#fa3', '#930', '#f80'],
    1,
  ]);

  // Partial updates cannot be applied to a module that was never received.
  const previousError = console.error;

  try {
    console.error = () => {};

    socket.onmessage!({
      data: Uint8Array.from([0x55, 0x4d, 1, 0, 5, 2, 1, 8, 1, 34, 3, 0]),
    });
  } finally {
    console.error = previousError;
  }

  assert.deepEqual(socket.closed, [4004]);
  advanceTimers(600);
  const stalledRetry = sockets.at(-1)!;

  assert.notEqual(stalledRetry, socket);
  assert.equal(stalledRetry.url, socket.url);
  stalledRetry.onclose!({ code: 1006, reason: '' });
  advanceTimers(399);
  assert.equal(status.hidden, true);
  advanceTimers(1);
  assert.equal(status.textContent, 'CONNECTION LOST - RETRYING...');
  advanceTimers(1000);
  assert.equal(status.textContent, 'CONNECTION LOST - RETRYING...');
  timers.clear();

  const originalRtc = globalThis.RTCPeerConnection;

  Object.assign(globalThis, { RTCPeerConnection: TestRTCPeerConnection });

  try {
    const startMovement = () => {
      const client = connect(socketUrl);
      const socket = sockets.at(-1)!;
      const peerCount = peers.length;

      assert.equal(socket.url, `${socketUrl}?${snapshotDeltaQuery}&movement=1`);
      socket.onopen!();
      socket.onmessage!(welcome);
      socket.onmessage!(loadSnapshot(1));
      socket.onmessage!({ data: 'movement' });
      assert.equal(peers.length, peerCount + 1);
      return { client, socket, peer: peers.at(-1)! };
    };

    const { client, socket: movementSocket, peer } = startMovement();
    const channel = peer.channel!;

    assert.equal(channel.label, 'movement');

    assert.deepEqual(channel.options, {
      ordered: false,
      maxPacketLifeTime: 32,
    });

    assert.equal(channel.binaryType, 'arraybuffer');
    movementSocket.onmessage!({ data: 'movement' });
    assert.equal(peers.at(-1), peer, 'a repeated advertisement keeps one peer');

    await settleRtc();
    assert.deepEqual(
      movementSocket.text,
      [],
      'ICE gathering must finish first',
    );
    peer.finishGathering();
    await settleRtc();
    assert.deepEqual(movementSocket.text, ['movement\noffer with candidates']);
    movementSocket.onmessage!({ data: 'movement\nanswer from server' });
    await settleRtc();

    assert.deepEqual(peer.remoteDescription, {
      type: 'answer',
      sdp: 'answer from server',
    });

    channel.onopen!();
    advanceTimers(8000);
    assert.equal(
      peer.closes,
      0,
      'an open channel cancels its negotiation timeout',
    );

    for (const data of [
      'not binary',
      new ArrayBuffer(8),
      new ArrayBuffer(41),
      new ArrayBuffer(8 + 7 * 32),
      movementDatagram(2n ** 53n, 7n),
      movementDatagram(2n, 0n),
      movementDatagram(2n, 2n ** 53n),
      movementDatagram(2n, 7n, NaN),
      movementDatagram(2n, 7n, Infinity),
    ]) {
      channel.onmessage!({ data });
      assert.deepEqual(built.inspectMovement(client), [true, 1, []]);
    }

    built.setWorldTick(client, 1 + maxPredictionTicks);

    channel.onmessage!({
      data: movementDatagram(BigInt(2 + maxPredictionTicks), 7n),
    });

    assert.deepEqual(built.inspectMovement(client), [true, 1, []]);

    channel.onmessage!({
      data: movementDatagram(BigInt(maxPredictionTicks), 7n),
    });

    const movement = [
      true,
      1,
      [[7, maxPredictionTicks, 120, -20, 3, -4, 0.5, -0.25]],
    ];

    assert.deepEqual(built.inspectMovement(client), movement);

    peer.connectionState = 'failed';
    peer.onconnectionstatechange!();
    assert.equal(peer.closes, 1);

    channel.onmessage!({
      data: movementDatagram(BigInt(1 + maxPredictionTicks), 7n),
    });

    assert.deepEqual(
      built.inspectMovement(client),
      movement,
      'a closed peer cannot add poses',
    );
    movementSocket.onmessage!(loadSnapshot(3));
    assert.deepEqual(built.inspectMovement(client).slice(0, 2), [true, 3]);
    assert.deepEqual(movementSocket.closed, []);

    const timeout = startMovement();

    await settleRtc();
    advanceTimers(7999);
    assert.equal(timeout.peer.closes, 0);
    advanceTimers(1);
    assert.equal(timeout.peer.closes, 1);
    timeout.peer.finishGathering();
    await settleRtc();
    assert.deepEqual(
      timeout.socket.text,
      [],
      'timed-out ICE cannot send an offer',
    );
    timeout.socket.onmessage!(loadSnapshot(2));
    assert.deepEqual(built.inspectMovement(timeout.client), [true, 2, []]);
    assert.deepEqual(timeout.socket.closed, []);

    const failed = startMovement();

    await settleRtc();
    failed.peer.finishGathering();
    await settleRtc();
    failed.peer.rejectAnswer = true;
    failed.socket.onmessage!({ data: 'movement\ninvalid answer' });
    await settleRtc();
    assert.equal(failed.peer.closes, 1);
    failed.socket.onmessage!(loadSnapshot(2));
    assert.deepEqual(built.inspectMovement(failed.client), [true, 2, []]);
    assert.deepEqual(failed.socket.closed, []);
  } finally {
    Object.assign(globalThis, { RTCPeerConnection: originalRtc });
    timers.clear();
  }
}

Object.assign(globalThis, {
  setTimeout: originalSetTimeout,
  clearTimeout: originalClearTimeout,
});
