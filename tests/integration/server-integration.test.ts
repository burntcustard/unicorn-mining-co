import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { rolldown } from 'rolldown';
import { ProtocolClient } from '../../benchmarking/server/client.ts';
import { loadProtocolRuntime } from '../../benchmarking/utilities/protocol-runtime.ts';
import { paintColors } from '../../src/specs/colors.ts';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import {
  decodeServerControl,
  encodeClientMessage,
} from '../../src/client/protocol/binary-control';
import {
  decodeBinarySnapshot,
  mergeModuleStates,
} from '../../src/client/protocol/binary-snapshot';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import type {
  ReplicatedEntity,
  ReplicatedModule,
} from '../../src/client/protocol/network';

// Exercise production-mangled field access and tags against the actual Go wire.
const entry = resolve('src/__wire_integration.ts');

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'wire-fixture',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `
        import {encodeClientMessage,decodeServerControl} from '${resolve('src/client/protocol/binary-control.ts')}';
        import {decodeBinarySnapshot} from '${resolve('src/client/protocol/binary-snapshot.ts')}';
        import {emptyPlayerInput} from '${resolve('src/client/protocol/input.ts')}';
        export default [
          token=>encodeClientMessage({type:'hello',playerToken:token}),
          tick=>encodeClientMessage({type:'input',tick,sequence:1,input:{...emptyPlayerInput(),thrust:1}}),
          sequence=>encodeClientMessage({type:'snapshotAck',sequence}),
          packet=>{const message=decodeServerControl(packet);return [message.type==='welcome',message.playerToken,message.playerId,message.shipId,message.serverTick,message.unlockedPaints,message.credits];},
          packet=>{const message=decodeBinarySnapshot(packet);return [message.type==='load',message.snapshotSequence,message.acknowledgedSequence,message.serverTick,message.fullEntities.length];},
          ()=>encodeClientMessage({type:'activity'}),
          packet=>{const message=decodeServerControl(packet);return message.type==='sounds' ? message.sounds.map(sound=>[sound.effect,sound.id,sound.by,sound.position.x,sound.position.y]) : undefined;},
          position=>encodeClientMessage({type:'sectorMap',position}),
          packet=>{const message=decodeServerControl(packet);return message.type==='sectorMap' ? message.mapMarkers.map(marker=>[marker.kind==='field',marker.kind==='ship',marker.id,marker.position.x,marker.position.y,marker.radius,marker.name,marker.definitionId,marker.color]) : undefined;},
        ];`
          : undefined,
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const production = (
  await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  )
).default;

assert.deepEqual(
  production[0](null),
  encodeClientMessage({
    type: 'hello',
    playerToken: null,
  }),
);

const decodeSounds = (packet: Uint8Array) => {
  const message = decodeServerControl(packet);

  return message.type === 'sounds'
    ? message.sounds.map((sound) => [
        sound.effect,
        sound.id,
        sound.by,
        sound.position.x,
        sound.position.y,
      ])
    : undefined;
};

const source = [
  (playerToken: string | null) =>
    encodeClientMessage({ type: 'hello', playerToken }),
  (tick: number) =>
    encodeClientMessage({
      type: 'input',
      tick,
      sequence: 1,
      input: { ...emptyPlayerInput(), thrust: 1 },
    }),
  (sequence: number) => encodeClientMessage({ type: 'snapshotAck', sequence }),
  (packet: Uint8Array) => {
    const message = decodeServerControl(packet);

    assert(message.type === 'welcome' || message.type === 'progress');

    if (message.type === 'progress') {
      return [
        false,
        null,
        null,
        null,
        null,
        message.unlockedPaints,
        message.credits,
      ];
    }

    return [
      true,
      message.playerToken,
      message.playerId,
      message.shipId,
      message.serverTick,
      message.unlockedPaints,
      message.credits,
    ];
  },
  (packet: Uint8Array) => {
    const message = decodeBinarySnapshot(packet);

    return [
      message.type === 'load',
      message.snapshotSequence,
      message.acknowledgedSequence,
      message.serverTick,
      message.fullEntities.length,
    ];
  },
  () => encodeClientMessage({ type: 'activity' }),
  (packet: Uint8Array) => {
    const message = decodeServerControl(packet);

    return message.type === 'sounds'
      ? message.sounds.map((sound) => [
          sound.effect,
          sound.id,
          sound.by,
          sound.position.x,
          sound.position.y,
        ])
      : undefined;
  },
];

const sockets: WebSocket[] = [];
const paintClients: ProtocolClient[] = [];
let paintPulse: ReturnType<typeof setInterval>;

const databaseDirectory = mkdtempSync(
  resolve(tmpdir(), 'unicorn-integration-'),
);

const server = spawn(resolve('bin/server'), [], {
  env: {
    ...process.env,
    PORT: '0',
    ASSET_DIR: resolve('dist'),
    APP_ENV: 'production',
    DATABASE_PATH: resolve(databaseDirectory, 'world.sqlite'),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});

const timeout = setTimeout(() => {
  sockets.forEach((socket) => socket.terminate());
  server.kill('SIGTERM');
}, 120000);

try {
  const address = await new Promise<string>((resolveAddress, reject) => {
    let log = '';

    server.on('error', reject);
    server.once('exit', (code) =>
      reject(new Error(`Server exited before startup: ${code}\n${log}`)),
    );

    server.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/listening on .*:(\d+)/);

      if (match) resolveAddress(`http://127.0.0.1:${match[1]}`);
    });
  });

  const health = await fetch(`${address}/healthz`);

  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const index = await fetch(address);

  assert.equal(index.headers.get('cache-control'), 'no-cache');
  const html = await index.text();
  const script = html.match(/src="([^"]+\.js)"/);

  assert(script, 'production index references a JavaScript chunk');
  const asset = await fetch(new URL(script[1], address));

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  assert.equal((await fetch(`${address}/missing`)).status, 404);

  const connect = async (codec: any[], token: string | null = null) => {
    const socket = new WebSocket(
      address.replace('http', 'ws') + '/game-socket',
      { origin: address.replace('http', 'https') },
    );

    sockets.push(socket);

    return new Promise<{ token: string; playerId: number; shipId: number }>(
      (resolveClient, reject) => {
        let welcome: any[];
        let received = 0;
        let acknowledged = false;
        let accountReceived = false;
        let loadBytes = 0;
        let snapshotBytes = 0;

        socket.on('error', reject);

        socket.on('close', (code) => {
          if (received < 3 || !acknowledged) {
            reject(new Error(`Socket closed before snapshots: ${code}`));
          }
        });

        socket.on('open', () => {
          socket.send(codec[0](token));
          socket.send(codec[5]());
        });

        socket.on('message', (data, binary) => {
          try {
            assert(binary);
            const packet = new Uint8Array(data as Buffer);

            if (packet[1] === 0x43) {
              const control = codec[3](packet);

              if (!control[0]) {
                assert.equal(control[5], 511);
                assert.equal(control[6], 2000);
                accountReceived = true;
                return;
              }

              welcome = control;
              assert(welcome[0]);
              assert.equal(welcome[5], 511);
              assert.equal(welcome[6], 2000);
              socket.send(codec[1](welcome[4]));

              // A purchase outside a station is rejected and returns account state.
              socket.send(
                encodeClientMessage({
                  type: 'dock',
                  action: 'buy',
                  module: 4,
                  moduleId: -999,
                }),
              );

              return;
            }

            const snapshot = codec[4](packet);

            received++;

            if (snapshot[0]) {
              loadBytes = packet.length;
            } else {
              snapshotBytes = packet.length;
            }

            if (snapshot[1] !== undefined) socket.send(codec[2](snapshot[1]));
            acknowledged ||= snapshot[2] === 1;

            if (welcome && received >= 3 && acknowledged && accountReceived) {
              console.log(
                `Go ${codec === source ? 'source' : 'production'} codec: load ${loadBytes} B, snapshot ${snapshotBytes} B`,
              );
              socket.removeAllListeners('message');
              socket.close();

              resolveClient({
                token: welcome[1],
                playerId: welcome[2],
                shipId: welcome[3],
              });
            }
          } catch (error) {
            reject(error);
          }
        });
      },
    );
  };

  const first = await connect(source);

  await once(sockets.at(-1)!, 'close');
  const resumed = await connect(production, first.token);

  assert.equal(resumed.playerId, first.playerId);
  assert.equal(resumed.shipId, first.shipId);
  await once(sockets.at(-1)!, 'close');

  // A second pilot receives the first pilot's actual server-generated audio.
  const join = () => {
    const socket = new WebSocket(
      address.replace('http', 'ws') + '/game-socket',
    );

    sockets.push(socket);

    return new Promise<{
      socket: WebSocket;
      playerId: number;
      shipId: number;
      tick: number;
      entities: Map<number, ReplicatedEntity>;
    }>((resolveClient, reject) => {
      const entities = new Map<number, ReplicatedEntity>();

      let welcome: Extract<
        ReturnType<typeof decodeServerControl>,
        { type: 'welcome' }
      >;

      socket.on('error', reject);

      socket.on('open', () =>
        socket.send(
          encodeClientMessage({
            type: 'hello',
            playerToken: null,
          }),
        ),
      );

      socket.on('message', (data) => {
        try {
          const packet = new Uint8Array(data as Buffer);

          if (packet[1] === 0x43) {
            const control = decodeServerControl(packet);

            if (control.type === 'welcome') welcome = control;
            return;
          }

          const snapshot = decodeBinarySnapshot(packet);

          if (snapshot.type === 'load') entities.clear();

          for (const record of snapshot.fullEntities) {
            const previous = entities.get(record.id);

            mergeModuleStates(record, previous);
            const entity = { ...previous, ...record } as ReplicatedEntity;

            for (const [key, value] of Object.entries(record)) {
              if (value === null) {
                delete (entity as unknown as Record<string, unknown>)[key];
              }
            }

            entities.set(record.id, entity);
          }

          if (snapshot.entityIds) {
            const ids = new Set(snapshot.entityIds);

            for (const id of entities.keys()) {
              if (!ids.has(id)) entities.delete(id);
            }
          }

          if (snapshot.snapshotSequence !== undefined) {
            socket.send(
              encodeClientMessage({
                type: 'snapshotAck',
                sequence: snapshot.snapshotSequence,
              }),
            );
          }

          if (welcome) {
            resolveClient({
              socket,
              playerId: welcome.playerId,
              shipId: welcome.shipId,
              tick: snapshot.serverTick,
              entities,
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  };

  const actor = await join();
  const observer = await join();

  const mapped = new Promise<any[]>((resolveMap, reject) => {
    actor.socket.on('message', (data) => {
      try {
        const packet = new Uint8Array(data as Buffer);

        if (packet[1] !== 0x43) return;
        const message = decodeServerControl(packet);

        if (message.type !== 'sectorMap') return;
        const markers = message.mapMarkers.map((marker) => [
          marker.kind === 'field',
          marker.kind === 'ship',
          marker.id,
          marker.position.x,
          marker.position.y,
          marker.radius,
          marker.name,
          marker.definitionId,
          marker.color,
        ]);

        assert.deepEqual(
          production[8](packet),
          markers,
          'production map properties decode Go markers',
        );
        assert(
          markers.every((marker) => !marker[0]),
          'fields are generated locally rather than streamed',
        );
        assert(
          markers.some((marker) => marker[1] && marker[2] === actor.shipId),
          'map includes own player',
        );
        assert(
          markers.some((marker) => marker[1] && marker[2] === observer.shipId),
          'map includes other player',
        );
        resolveMap(markers);
      } catch (error) {
        reject(error);
      }
    });
  });

  const mapRequest = encodeClientMessage({
    type: 'sectorMap',
    position: { x: 0, y: 0 },
  });

  assert.deepEqual(production[7]({ x: 0, y: 0 }), mapRequest);
  actor.socket.send(mapRequest);
  await mapped;

  // Both sockets observe the same changing ship through one shared batch.
  const mixedModules = new Promise<void>((resolveMixed, reject) => {
    const updates = new Map<number, Map<number, ReplicatedModule[]>>();

    const handlers: {
      socket: WebSocket;
      handle: (data: WebSocket.RawData) => void;
    }[] = [];

    for (const [index, { socket, entities }] of [actor, observer].entries()) {
      const handle = (data: WebSocket.RawData) => {
        try {
          const packet = new Uint8Array(data as Buffer);

          if (packet[1] !== 0x4d) return;
          const snapshot = decodeBinarySnapshot(packet);
          const modules = entities.get(actor.shipId)?.modules;

          if (snapshot.type !== 'snapshot' || !modules?.length) return;

          assert.deepEqual(production[4](packet), [
            false,
            snapshot.snapshotSequence,
            snapshot.acknowledgedSequence,
            snapshot.serverTick,
            snapshot.fullEntities.length,
          ]);

          const atTick = updates.get(snapshot.serverTick) ?? new Map();

          atTick.set(index, modules);
          updates.set(snapshot.serverTick, atTick);

          if (atTick.has(0) && atTick.has(1)) {
            assert.deepEqual(atTick.get(0), atTick.get(1));
            handlers.forEach(({ socket, handle }) =>
              socket.off('message', handle),
            );
            resolveMixed();
          }
        } catch (error) {
          reject(error);
        }
      };

      handlers.push({ socket, handle });
      socket.on('message', handle);
    }
  });

  const heard = new Promise<void>((resolveSound, reject) => {
    observer.socket.on('message', (data) => {
      try {
        const packet = new Uint8Array(data as Buffer);

        if (packet[1] !== 0x43) return;
        const original = decodeSounds(packet);
        const compact = production[6](packet);

        assert.deepEqual(
          compact,
          original,
          'production and source sound codecs agree on the Go audio packet',
        );

        if (
          original?.some(
            (sound: number[]) =>
              sound[0] === 0 &&
              sound[1] === actor.shipId &&
              sound[2] === actor.playerId,
          )
        ) {
          resolveSound();
        }
      } catch (error) {
        reject(error);
      }
    });
  });

  actor.socket.send(
    encodeClientMessage({
      type: 'input',
      tick: Math.max(actor.tick, observer.tick),
      sequence: 1,
      input: { ...emptyPlayerInput(), cargoHatch: true },
    }),
  );

  await Promise.all([heard, mixedModules]);
  const actorClosed = once(actor.socket, 'close');
  const observerClosed = once(observer.socket, 'close');

  actor.socket.close();
  observer.socket.close();
  await Promise.all([actorClosed, observerClosed]);

  // Paint a real fitted module through the station and observe later sparse updates.
  const { runtime } = await loadProtocolRuntime(
    resolve(databaseDirectory, 'runtime'),
  );

  const makePaintClient = (index: number, clientRuntime = runtime) => {
    const client = new ProtocolClient({
      url: address,
      index,
      players: 2,
      runtime: clientRuntime,
      preparationTimeoutMs: 90000,
    });

    paintClients.push(client);
    return client;
  };

  const painter = makePaintClient(0);
  let captureSparse = false;
  let sparsePackets = 0;

  const observerRuntime = {
    ...runtime,
    decodeBinarySnapshot(
      data: Parameters<typeof runtime.decodeBinarySnapshot>[0],
    ) {
      const snapshot = runtime.decodeBinarySnapshot(data);

      if (
        captureSparse &&
        snapshot.fullEntities.some(
          (entity) =>
            entity.id === painter.shipId &&
            entity.modules?.some(
              (module) =>
                module.type === undefined || module.shades?.length === 0,
            ),
        )
      ) {
        sparsePackets++;
      }

      return snapshot;
    },
  };

  const paintObserver = makePaintClient(1, observerRuntime);

  paintPulse = setInterval(
    () => paintClients.forEach((client) => client.activity()),
    5000,
  );
  await Promise.all(paintClients.map((client) => client.ready()));
  await painter.dock();

  const hatchType = runtime.catalog.moduleIds.indexOf('cargoHatch');
  const hatch = painter.ship.modules?.find(
    (module) => module.type === hatchType && module.mount >= 0,
  );

  assert(hatch?.id !== undefined, 'the actor has a fitted cargo hatch');
  const hatchId = hatch.id;
  const another = painter.ship.modules?.find((module) => module.id !== hatchId);
  const previousOtherShades = another?.shades;
  const ownHatch = () =>
    painter.ship?.modules?.find((module) => module.id === hatchId);
  const observedShip = () => paintObserver.entities.get(painter.shipId);
  const observedHatch = () =>
    observedShip()?.modules?.find((module) => module.id === hatchId);
  const isYellow = (shades?: readonly string[]) =>
    shades?.length === paintColors[2].length &&
    shades.every((shade, index) => shade === paintColors[2][index]);

  await painter.craftAction(
    { action: 'paint', mount: hatch.mount, moduleId: hatchId, paint: 2 },
    () => !!isYellow(ownHatch()?.shades),
  );
  await painter.launch();
  await paintObserver.until(
    () => !!isYellow(observedHatch()?.shades),
    'Observer sees the repainted hatch',
  );
  captureSparse = true;
  painter.input({ ...emptyPlayerInput(), cargoHatch: true });
  await paintObserver.until(
    () =>
      !!observedHatch()?.segments.some(
        (segment) => segment.active > 0 || segment.activationProgress > 0,
      ),
    'Observer sees the repainted hatch animate',
  );
  assert(sparsePackets > 0, 'the observer received sparse module updates');
  assert(
    isYellow(observedHatch()?.shades),
    'animation retains the repainted palette',
  );

  if (another) {
    assert.deepEqual(
      observedShip()?.modules?.find((module) => module.id === another.id)
        ?.shades,
      previousOtherShades,
      'painting one module preserves another module palette',
    );
  }

  assert.deepEqual(painter.errors, []);
  assert.deepEqual(paintObserver.errors, []);
  console.log(
    'Local actor and observer preserve painted module color during animation',
  );
  console.log(
    'Go assets, health, source/production UC+UM codecs, input acknowledgment and reconnect passed',
  );
} finally {
  clearTimeout(timeout);
  clearInterval(paintPulse);
  await Promise.all(paintClients.map((client) => client.close()));
  sockets.forEach((socket) => socket.terminate());

  if (server.exitCode === null) {
    const stopped = once(server, 'exit');

    server.kill('SIGTERM');
    await stopped;
  }

  rmSync(databaseDirectory, { recursive: true, force: true });
}
