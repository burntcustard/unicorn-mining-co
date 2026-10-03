import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';

const [executable, ...options] = process.argv.slice(2);

assert(
  executable,
  'Usage: node benchmarking/tools/websocket-transport.mjs EXECUTABLE [GO FLAGS]',
);
const affinity = process.env.BENCH_CPU_AFFINITY;
const game = options.includes('-game');
const ackDelayMs = Number(process.env.ACK_DELAY_MS || 0);

assert(Number.isFinite(ackDelayMs) && ackDelayMs >= 0);
let controls, snapshots;

if (game) {
  const { rolldown } = await import('rolldown');
  const load = async (input) => {
    const bundle = await rolldown({ input });
    const { output } = await bundle.generate({ format: 'esm' });

    await bundle.close();
    return import(
      `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
    );
  };

  controls = await load('src/client/protocol/binary-control.ts');
  snapshots = await load('src/client/protocol/binary-snapshot.ts');
}
const child = spawn(
  affinity ? 'taskset' : executable,
  affinity ? ['-c', affinity, executable, ...options] : options,
  { stdio: [game ? 'pipe' : 'ignore', 'pipe', 'inherit'] },
);
const sockets = [];
let failure;
const completion = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code !== 0 || signal) {
      reject(new Error(`Server exited: ${code}, ${signal}`));
    } else resolve();
  });
});
const lines = createInterface({ input: child.stdout });
const sizeAt = options.indexOf('-size');
const size = sizeAt < 0 ? 2048 : Number(options[sizeAt + 1]);
const playersAt = options.indexOf('-players');
const players = playersAt < 0 ? 32 : Number(options[playersAt + 1]);
const states = [];
let measuring = false;
let finished = false;
const activity = process.env.ACTIVITY || 'flight';
const quantile = (values, fraction) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length * fraction)] ?? 0;

try {
  for await (const line of lines) {
    const result = JSON.parse(line);

    if (result.measuring) {
      measuring = true;
      states.forEach((state) => {
        state.count = 0;
        state.bytes = 0;
        state.gaps = [];
        state.delays = [];
        state.inputs = 0;
      });
      continue;
    }

    if (!result.address) {
      assert(!failure, failure);
      result.affinity = affinity || null;
      result.gogc = process.env.GOGC || '100';

      if (game) {
        finished = true;
        result.activity = activity;
        result.ackDelayMs = ackDelayMs;
        result.clients = states.map((state) => ({
          snapshots: state.count,
          snapshotHz: (state.count * 1000) / result.wallMs,
          bytes: state.bytes,
          inputHz: (state.inputs * 1000) / result.wallMs,
          snapshotGapP95Ms: quantile(state.gaps, 0.95),
          inputAckP95Ms: quantile(state.delays, 0.95),
          maxSnapshotGapMs: Math.max(0, ...state.gaps),
          maxInputAckMs: Math.max(0, ...state.delays),
        }));
        assert(
          result.clients.every(
            (client) =>
              client.snapshotHz >= 28.5 &&
              client.inputHz >= 28.5 &&
              client.inputAckP95Ms > 0,
          ),
          'A client fell below the 30 Hz benchmark cadence',
        );
      }
      console.log(JSON.stringify(result));
      continue;
    }

    for (let i = 0; i < players; i++) {
      const socket = new WebSocket(result.address, {
        perMessageDeflate: false,
      });
      let previous = -1n;
      const state = {
        welcomed: false,
        count: 0,
        bytes: 0,
        gaps: [],
        delays: [],
        sent: new Map(),
        sequence: 0,
        acknowledged: 0,
        lastAt: 0,
        tick: 0,
        inputs: 0,
        nextAt: 0,
        timer: null,
      };

      states.push(state);

      sockets.push(socket);
      socket.on('error', (error) => {
        failure = String(error);
        child.kill('SIGTERM');
      });

      if (game) {
        socket.on('open', () =>
          socket.send(
            controls.encodeClientMessage({ type: 'hello', playerToken: null }),
          ),
        );
      }
      socket.on('message', (data, binary) => {
        try {
          if (game) {
            assert(binary, 'Game sent a text frame');

            if (data[1] === 0x43) {
              const message = controls.decodeServerControl(data);

              assert.equal(message.type, 'welcome');
              state.welcomed = true;
              return;
            }
            const message = snapshots.decodeBinarySnapshot(data);
            const sequence = BigInt(message.snapshotSequence);

            assert.equal(
              sequence,
              previous < 0 ? 1n : previous + 1n,
              'Game snapshot lost, duplicated or reordered',
            );
            previous = sequence;
            state.tick = message.serverTick;
            assert(
              Number.isSafeInteger(message.acknowledgedSequence) &&
                message.acknowledgedSequence >= state.acknowledged &&
                message.acknowledgedSequence <= state.sequence,
              'Invalid input acknowledgement sequence',
            );
            state.acknowledged = message.acknowledgedSequence;
            const now = performance.now();

            if (measuring) {
              state.count++;
              state.bytes += data.length;

              if (state.lastAt) state.gaps.push(now - state.lastAt);
            }
            state.lastAt = now;

            for (const [sequence, at] of state.sent) {
              if (sequence > message.acknowledgedSequence) break;

              if (measuring) state.delays.push(now - at);
              state.sent.delete(sequence);
            }
            const acknowledge = () => {
              if (finished || socket.readyState !== WebSocket.OPEN) return;
              socket.send(
                controls.encodeClientMessage({
                  type: 'snapshotAck',
                  sequence: message.snapshotSequence,
                }),
              );
            };

            if (ackDelayMs) setTimeout(acknowledge, ackDelayMs).unref();
            else acknowledge();

            if (!state.timer) {
              state.nextAt = now + (i * 1000) / (30 * players);
              const sendInput = () => {
                if (finished || socket.readyState !== WebSocket.OPEN) return;
                const now = performance.now();

                state.sequence++;
                state.sent.set(state.sequence, now);

                if (measuring) state.inputs++;
                socket.send(
                  controls.encodeClientMessage({
                    type: 'input',
                    tick: state.tick + 1,
                    sequence: state.sequence,
                    input: {
                      hornDrill: false,
                      cargoHatch: false,
                      searchLight: false,
                      shieldGenerator: false,
                      launch: false,
                      thrust: activity === 'idle' ? 0 : 1,
                      turn: 0,
                    },
                  }),
                );

                if (
                  states.length === players &&
                  states.every(
                    (state) => state.welcomed && state.sequence > 0,
                  ) &&
                  child.stdin.writable
                ) {
                  child.stdin.end('ready\n');
                }
                state.nextAt += 1000 / 30;
                state.timer = setTimeout(
                  sendInput,
                  Math.max(0, state.nextAt - performance.now()),
                );
              };

              state.timer = setTimeout(
                sendInput,
                Math.max(0, state.nextAt - now),
              );
            }
            return;
          }
          assert(
            binary && data.length === size,
            'Unexpected frame type or size',
          );
          const sequence = data.readBigUInt64LE();

          assert.equal(
            sequence,
            previous + 1n,
            'Frame lost, duplicated or reordered',
          );
          previous = sequence;

          for (let at = 8; at < data.length; at++) {
            assert.equal(data[at], at & 255, 'Payload corruption');
          }
          const message = Buffer.alloc(32);

          message.writeBigUInt64LE(sequence, 8);
          socket.send(message);
          const acknowledgement = Buffer.from(message);

          acknowledgement[0] = 1;
          socket.send(acknowledgement);
        } catch (error) {
          failure = String(error);
          child.kill('SIGTERM');
        }
      });
    }
  }
  await completion;
  assert(!failure, failure);
} finally {
  states.forEach((state) => clearTimeout(state.timer));
  sockets.forEach((socket) => socket.terminate());

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }
}
