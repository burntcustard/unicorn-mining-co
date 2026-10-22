// Measure completed authoritative controls separately from client prediction.
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import WebSocket from 'ws';

const [address, destination] = process.argv.slice(2);

assert(
  address && destination,
  'Usage: node benchmarking/tools/input-authority.ts LOCAL_WEBSOCKET_URL OUTPUT.json.gz',
);
const url = new URL(address);

assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/game-socket');
const phases = (process.env.PHASES || '0,4,8,12,16,20,24,28,32')
  .split(',')
  .map(Number);
const leads = (process.env.TARGET_LEADS || '0,1').split(',').map(Number);
const repetitions = Number(process.env.SAMPLES_PER_PHASE || 8);

assert(phases.every((phase) => Number.isFinite(phase) && phase >= 0));
assert(leads.every((lead) => Number.isInteger(lead) && lead >= 0));
assert(Number.isInteger(repetitions) && repetitions > 0);

const load = async (input: string) => {
  const bundle = await rolldown({ input });
  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  return import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  );
};

const controls: typeof import('../../src/client/protocol/binary-control') =
  await load('src/client/protocol/binary-control.ts');
const snapshots: typeof import('../../src/client/protocol/binary-snapshot') =
  await load('src/client/protocol/binary-snapshot.ts');
const events = new EventEmitter();
const socket = new WebSocket(address, { perMessageDeflate: false });
let shipId: number;
let thrust = 0;
let speed = 0;
let dockedTo = 0;
let launching = 0;
let tick = 0;
let sequence = 0;
let closed = false;
const errors: string[] = [];

type Observation = {
  at: number;
  tick: number;
  acknowledged?: number;
  inputLead?: number;
  thrust: number;
  speed: number;
  dockedTo: number;
  launching: number;
};

const nextSnapshot = async (): Promise<Observation> =>
  (await once(events, 'snapshot', { signal: AbortSignal.timeout(5000) }))[0];

socket.on('error', (error) => {
  errors.push(error.message);
  events.emit('failure', error);
});

socket.on('close', (code, reason) => {
  if (!closed) errors.push(`Socket closed: ${code} ${reason.toString('utf8')}`);
});

socket.on('message', (raw, binary) => {
  try {
    assert(binary);
    const bytes = raw as Buffer;

    if (bytes[1] !== 0x4d) {
      const message = controls.decodeServerControl(bytes);

      if (message.type === 'welcome') shipId = message.shipId;
      return;
    }

    const message = snapshots.decodeBinarySnapshot(bytes);
    const at = performance.now();

    tick = message.serverTick;

    for (const entity of message.fullEntities) {
      if (entity.id !== shipId) continue;

      if (entity.thrust !== undefined) thrust = entity.thrust ?? 0;

      if (entity.dockedTo !== undefined) dockedTo = entity.dockedTo ?? 0;

      if (entity.launching !== undefined) launching = entity.launching ?? 0;

      if (entity.velocity !== undefined) {
        speed = entity.velocity
          ? Math.hypot(entity.velocity.x, entity.velocity.y)
          : 0;
      }
    }

    if (message.snapshotSequence !== undefined) {
      socket.send(
        controls.encodeClientMessage({
          type: 'snapshotAck',
          sequence: message.snapshotSequence,
        }),
      );
    }

    events.emit('snapshot', {
      at,
      tick,
      acknowledged: message.acknowledgedSequence,
      inputLead: message.inputLead,
      thrust,
      speed,
      dockedTo,
      launching,
    } satisfies Observation);
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : (JSON.stringify(error) ?? 'Unknown benchmark error'),
    );
  }
});

const results: {
  phaseMs: number;
  actualPhaseMs: number;
  targetLead: number;
  targetTick: number;
  sequence: number;
  thrust: number;
  acknowledgedAfterMs: number;
  authoritativeControlAfterMs: number;
  acknowledgedTick: number;
  reportedInputLead?: number;
  speedBefore: number;
  speedAfter: number;
}[] = [];

const sendInput = ({
  targetTick = tick,
  thrust = 0,
  launch = false,
}: { targetTick?: number; thrust?: number; launch?: boolean } = {}) => {
  socket.send(
    controls.encodeClientMessage({
      type: 'input',
      tick: targetTick,
      sequence: ++sequence,
      offset: 0,
      input: {
        thrust,
        turn: 0,
        hornDrill: false,
        cargoHatch: false,
        searchLight: false,
        shieldGenerator: false,
        launch,
      },
    }),
  );
};

try {
  await once(socket, 'open');
  const initial = nextSnapshot();

  socket.send(
    controls.encodeClientMessage({ type: 'hello', playerToken: null }),
  );
  await initial;

  let startup = nextSnapshot();

  sendInput({ launch: true });

  while ((await startup).acknowledged < sequence) startup = nextSnapshot();
  startup = nextSnapshot();
  // Launch is an edge: holding it would restart the launch animation each tick.
  sendInput();

  while ((await startup).acknowledged < sequence) startup = nextSnapshot();
  let ready: Observation;

  for (let warmup = 0; warmup < 120; warmup++) ready = await nextSnapshot();
  assert.equal(ready.dockedTo, 0, 'Probe ship did not undock');
  assert.equal(ready.launching, 0, 'Probe ship is still launching');

  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const phaseMs of phases) {
      for (const targetLead of repetition % 2 ? leads.toReversed() : leads) {
        const baseline = await nextSnapshot();

        if (phaseMs) {
          await new Promise((resolve) => setTimeout(resolve, phaseMs));
        }

        const sentAt = performance.now();
        const targetTick = tick + targetLead;
        const desired = (sequence + 1) % 2;
        let observation = nextSnapshot();

        sendInput({ targetTick, thrust: desired });
        let acknowledged: Observation;
        let applied: Observation;

        while (!applied) {
          const received = await observation;

          if (received.acknowledged >= sequence) {
            acknowledged ??= received;

            if (received.thrust === desired) applied = received;
          }

          assert(performance.now() - sentAt < 5000, 'Control never applied');

          if (!applied) observation = nextSnapshot();
        }

        results.push({
          phaseMs,
          actualPhaseMs: sentAt - baseline.at,
          targetLead,
          targetTick,
          sequence,
          thrust: desired,
          acknowledgedAfterMs: acknowledged.at - sentAt,
          authoritativeControlAfterMs: applied.at - sentAt,
          acknowledgedTick: acknowledged.tick,
          reportedInputLead: acknowledged.inputLead,
          speedBefore: baseline.speed,
          speedAfter: applied.speed,
        });
      }
    }
  }

  assert.deepEqual(errors, []);

  const distribution = (values: number[]) => {
    const sorted = values.toSorted((a, b) => a - b);

    return {
      count: sorted.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
    };
  };

  const summaries = leads.map((targetLead) => ({
    targetLead,
    acknowledgmentMs: distribution(
      results
        .filter((result) => result.targetLead === targetLead)
        .map((result) => result.acknowledgedAfterMs),
    ),
    authoritativeControlMs: distribution(
      results
        .filter((result) => result.targetLead === targetLead)
        .map((result) => result.authoritativeControlAfterMs),
    ),
  }));

  const capture = {
    date: new Date().toISOString(),
    url: address,
    node: process.version,
    repetitions,
    phases,
    leads,
    measurement:
      'Native local TCP send to completed authoritative thrust state; excludes prediction and presentation.',
    summaries,
    results,
    errors,
  };

  const json = JSON.stringify(capture, null, 2) + '\n';

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    destination.endsWith('.gz') ? gzipSync(json) : json,
  );
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  closed = true;
  socket.terminate();
}
