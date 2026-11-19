import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import type { NetworkClient } from '../../src/client/network/network.ts';
import type {
  ReplicatedEntity,
  ServerMessage,
} from '../../src/client/protocol/network.ts';
import { openLatencyBrowser, type LatencyPage } from '../latency/browser.ts';
import { parseLatencyOptions } from '../latency/options.ts';
import { measureLinearMovement } from './metrics.ts';

type Sample = {
  tick: number;
  speed: number;
  spin: number;
  thrust: number;
  turn: number;
  fuel: number;
  position: ReplicatedEntity['position'];
};

type Fit = {
  thruster: string;
  name: string;
  stock: boolean;
  moduleIndex: number;
};

/*
 * Tap the normal client's decoded entity records before prediction or rendering.
 * Leave message handling and the storage of snapshot deltas with the client.
 */
function captureMovement({
  moduleIndex,
  mount,
}: {
  moduleIndex: number;
  mount: number;
}) {
  type Capture = {
    samples: Sample[];
    issue: string;
    ready: boolean;
    worldSeed?: number;
  };

  type Receive = (packet: { message: ServerMessage }) => void;

  const page = globalThis as typeof globalThis & {
    network: NetworkClient;
    movement: Capture;
  };

  const network = page.network as unknown as {
    receive: Receive;
    shipId: number;
    entityRecords: Map<number, ReplicatedEntity>;
    worldSeed: number;
  };

  const capture: Capture = { samples: [], issue: '', ready: false };
  const receive = network.receive;
  let health: string;

  page.movement = capture;

  network.receive = function (packet) {
    receive.call(this, packet);
    const { message } = packet;

    if (message.type !== 'load' && message.type !== 'snapshot') return;
    const ship = network.entityRecords.get(network.shipId);
    const last = capture.samples.at(-1);

    if (last && last.tick >= message.serverTick) return;

    if (
      ship?.kind !== 'ship' ||
      (ship.definitionId || 'mustang') !== 'mustang' ||
      ship.dockedTo ||
      ship.launching ||
      ship.transitTime ||
      ship.modules?.find((module) => module.mount === mount)?.type !==
        moduleIndex
    ) {
      capture.issue =
        'Expected the fixture’s undocked Mustang and fitted thruster';
      return;
    }

    const condition = JSON.stringify([
      ship.hullHealth,
      ship.modules.map(({ type, mount, health }) => [type, mount, health]),
    ]);

    if (health && health !== condition) {
      capture.issue = 'Ship condition changed during the run';
    }

    health = condition;
    capture.ready = true;
    capture.worldSeed = network.worldSeed;

    capture.samples.push({
      tick: message.serverTick,
      speed: Math.hypot(ship.velocity?.x || 0, ship.velocity?.y || 0),
      spin: ship.spin || 0,
      thrust: ship.thrust || 0,
      turn: ship.turn || 0,
      fuel: ship.fuel,
      position: ship.position,
    });
  };
}

/*
 * Wait in the browser, where progress is available on each server snapshot.
 */
const waitFor = (page: LatencyPage, condition: string, description: string) =>
  page.evaluate(
    `(async () => {
      const deadline = performance.now() + 22000;
      while (!(${condition})) {
        if (globalThis.movement?.issue) throw Error(globalThis.movement.issue);
        if (performance.now() > deadline) {
          const detail = document.querySelector('#profile-status')?.textContent;
          throw Error(${JSON.stringify(description)} + (detail ? ': ' + detail : ''));
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    })()`,
    { timeoutMs: 23000 },
  );

const phases = [
  {
    phase: 'thrust',
    key: 'ArrowUp',
    edge: 'keyDown',
    control: 'thrust',
    value: 1,
    seconds: 4,
  },
  {
    phase: 'coast',
    key: 'ArrowUp',
    edge: 'keyUp',
    control: 'thrust',
    value: 0,
    seconds: 13,
  },
  {
    phase: 'turn',
    key: 'ArrowRight',
    edge: 'keyDown',
    control: 'turn',
    value: 1,
    seconds: 1.5,
  },
  {
    phase: 'turn-release',
    key: 'ArrowRight',
    edge: 'keyUp',
    control: 'turn',
    value: 0,
    seconds: 1,
  },
] as const;

/*
 * Use the first full simulation ticks after each turn edge. The edge tick
 * itself can contain a partial input interval from the browser keyboard event.
 */
function summarize(raw: Sample[], starts: number[], simulationStep: number) {
  const [thrust, coast, turn, release] = phases.map(({ phase }, index) => {
    const start = starts[index] - 1;

    return raw.slice(start, starts[index + 1]).map((sample) => ({
      ...sample,
      phase,
      seconds: (sample.tick - raw[start].tick) * simulationStep,
    }));
  });

  const turnSlope = (samples: Sample[]) => {
    const first = samples[1];
    const fourth = samples[4];

    assert.equal(
      fourth.tick - first.tick,
      3,
      'Missing snapshot in the initial slope window',
    );
    return (fourth.spin - first.spin) / (3 * simulationStep);
  };

  const linear = measureLinearMovement({ thrust, coast });
  const turnRate = Math.max(...turn.map(({ spin }) => spin));

  assert(
    thrust[0].speed < 0.01 && Math.abs(turn[0].spin) < 0.001,
    'Expected to start at rest',
  );
  assert(
    coast.at(-1).speed < 0.01 && Math.abs(release.at(-1).spin) < 0.001,
    'Expected to settle at rest',
  );
  assert(
    linear.topSpeed > 0 && turnRate > 0,
    'Expected authoritative forward and turning motion',
  );
  assert(
    linear.topSpeed - thrust.at(-1).speed < 0.5,
    'Speed fell under sustained thrust',
  );
  assert(
    raw.every(
      ({ position, fuel }) =>
        Math.abs(position.y - thrust[0].position.y) < 1 && fuel > 6,
    ),
    'Ship left the straight flight lane or ran low on fuel',
  );

  return {
    samples: [...thrust, ...coast, ...turn, ...release],
    metrics: {
      ...linear,
      turnAcceleration: turnSlope(turn),
      turnRate,
      turnDeceleration: -turnSlope(release),
    },
  };
}

const {
  values: { output },
} = parseArgs({
  options: {
    output: {
      type: 'string',
      default: 'benchmarking/_local/movement/results.json',
    },
  },
});

const revision =
  process.env.MOVEMENT_REVISION ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const controller = new AbortController();
let close: () => Promise<void>;
const stop = () => controller.abort();

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  const browser = await openLatencyBrowser({
    options: {
      ...parseLatencyOptions(['--resolution', '1280x800']),
      networkPermission: null,
    },
    signal: controller.signal,
    registerClose: (callback) => (close = callback),
    pageCount: 1,
    backgroundRendering: true,
  });

  const [page] = browser.pages;

  const {
    fits,
    mount,
    fuelCapacity,
    simulationStep,
  }: {
    fits: Fit[];
    mount: number;
    fuelCapacity: number;
    simulationStep: number;
  } = await page.evaluate(`(async () => {
      const { mustang } = await import('/src/specs/ships/mustang.ts');
      const { moduleIds, moduleSpecs } = await import('/src/specs/modules/index.ts');
      const { simulationStep } = await import('/src/specs/simulation.ts');
      const mounts = mustang.hullSegments.flatMap(segment => segment.mounts || []);
      const mount = mounts.findIndex(group => group.some(point => point.fits.some(id => moduleSpecs[id].forwardThrust)));
      const stock = mustang.initialLoadout.find(fit => fit.mount === mount).module;
      const compatible = [...new Set(mounts[mount].flatMap(point => point.fits))];
      return { mount, simulationStep, fuelCapacity: mustang.fuelCapacity,
        fits: [stock, ...compatible.filter(id => id !== stock && moduleSpecs[id].forwardThrust)].map(id => ({
          thruster: id,
          name: moduleSpecs[id].name,
          stock: id === stock,
          moduleIndex: moduleIds.indexOf(id),
        })),
      };
    })()`);

  const cases = [];
  let worldSeed: number;
  let startPosition: ReplicatedEntity['position'];

  for (const fit of fits) {
    controller.signal.throwIfAborted();
    const query = `?movement=${fit.thruster}`;
    const pilot = `Bench ${fit.thruster.replace(/^thruster/, '')}`;

    await page.evaluate(`(() => {
      globalThis.network?.socket?.close();
      localStorage.removeItem('playerToken');
    })()`);
    await page.navigate(`http://localhost:3000/${query}`);
    await page.activate();

    // The server keeps a disconnected ship in flight for three seconds.
    if (cases.length) {
      await pause(3200, undefined, { signal: controller.signal });
    }

    await waitFor(
      page,
      `location.search === ${JSON.stringify(query)} && document.querySelector('[data-action="play"]')`,
      'Waiting for the game menu',
    );
    await page.evaluate(
      `document.querySelector('[data-action="play"]').dispatchEvent(new Event('ui-press', { bubbles: true }))`,
    );
    await waitFor(
      page,
      'globalThis.network && document.querySelector("#profile-name")',
      'Waiting for a new pilot profile',
    );
    await page.evaluate(
      `(${captureMovement.toString()})(${JSON.stringify({ moduleIndex: fit.moduleIndex, mount })})`,
    );
    await page.evaluate(`(() => {
      const input = document.querySelector('#profile-name');
      input.value = ${JSON.stringify(pilot)};
      input.form.requestSubmit();
    })()`);
    await waitFor(
      page,
      'movement.ready && !document.querySelector("#profile-name")',
      'Waiting for a flying Mustang',
    );

    const initial: { first: Sample; seed: number } = await page.evaluate(
      '({ first: movement.samples[0], seed: movement.worldSeed })',
    );

    assert.equal(
      initial.first.fuel,
      fuelCapacity,
      'Expected a full tank at the start',
    );
    worldSeed ??= initial.seed;
    startPosition ??= initial.first.position;
    assert.equal(initial.seed, worldSeed, 'World seed changed between cases');
    assert.deepEqual(
      initial.first.position,
      startPosition,
      'Flight lane changed between cases',
    );
    const starts: number[] = [];

    for (const { phase, key, edge, control, value, seconds } of phases) {
      controller.signal.throwIfAborted();
      const index: number = await page.evaluate('movement.samples.length');
      const ticks = Math.round(seconds / simulationStep);
      const label = `Mustang · ${fit.name}${fit.stock ? ' (stock)' : ''} · ${phase}`;

      await page.evaluate(`document.title = ${JSON.stringify(label)}`);
      console.error(label);
      await page.key(edge, key);
      const first = `movement.samples.findIndex((s, i) => i >= ${index} && s.${control} === ${value})`;

      await waitFor(
        page,
        `(() => {
        const first = ${first};
        return first > 0 && movement.samples.at(-1).tick >= movement.samples[first].tick + ${ticks};
      })()`,
        `Waiting for the server to complete ${phase}`,
      );
      starts.push(await page.evaluate(first));
    }

    const capture: { samples: Sample[]; issue: string } =
      await page.evaluate('movement');

    assert(!capture.issue, capture.issue);

    cases.push({
      thruster: fit.thruster,
      name: fit.name,
      stock: fit.stock,
      ...summarize(capture.samples, starts, simulationStep),
    });
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify({ revision, worldSeed, simulationStep, cases }) + '\n',
  );
  console.log(output);
} finally {
  await close?.();
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
