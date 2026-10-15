/* global Buffer, process */
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { stripIfdef } from '../../plugins/replace-pre-terser';
import { testBuildPlugin } from '../support/build-plugin';

const root = process.cwd();
const fixture = execFileSync(
  'go',
  ['run', 'src/server/testtools/beam-visibility/main.go'],
  { encoding: 'utf8' },
);

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  localStorage: { getItem: (): null => null, setItem() {} },
  WebSocket: class {
    static OPEN = 1;
    readyState = 1;
    send() {}
  },
});

const scenario = `
import assert from 'node:assert/strict';
import { NetworkClient } from '${root}/src/client/network/network.ts';
import { decodeBinarySnapshot } from '${root}/src/client/protocol/binary-snapshot.ts';
import { emptyPlayerInput } from '${root}/src/client/protocol/input.ts';
import { installExampleModules } from '${root}/tests/support/example-modules.ts';
import { Laser } from '${root}/src/client/objects/modules/index.ts';
import { game } from '${root}/src/client/game.ts';
import { simulationStep } from '${root}/src/specs/simulation.ts';
installExampleModules();
globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
let strokes = 0;
game.ctx = {
  save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {},
  moveTo() {}, lineTo() {}, arc() {}, fill() {},
  stroke(path) { if (!path) strokes++; },
  createRadialGradient() { return { addColorStop() {} }; },
};
game.scale = 1;
const fixture = ${fixture};
const decode = hex => decodeBinarySnapshot(Uint8Array.from(Buffer.from(hex, 'hex')));
const connect = () => {
  const client = new NetworkClient({ url: 'test' });
  client.receive({ message: {
    type: 'welcome', playerToken: 'test', playerId: 1, shipId: fixture.observerId,
    worldSeed: 25, serverTick: 0, spawn: { x: 0, y: 0 },
  }});
  return client;
};
const render = ship => {
  const beam = ship.modules.find(module => module instanceof Laser);
  const before = strokes;
  for (const segment of ship.segmentsAtMount(beam.mount)) {
    beam.render({ segment, craft: ship });
  }
  return strokes - before;
};
const client = connect();
let now = performance.now() + 100;
for (const [index, hex] of fixture.packets.entries()) {
  const message = decode(hex);
  if (index === 1 || index === 2) {
    assert.equal(message.fullEntities.find(entity => entity.id === fixture.remoteId).firing,
      index === 1, 'both firing edges must be present in real Go deltas');
  }
  client.receive({ message });
  now += simulationStep * 1000;
  client.updateFrame({ input: emptyPlayerInput(), now, dt: 0 });
  const remote = client.world.entities.get(fixture.remoteId);
  assert.equal(remote.firing, index !== 0 && index !== 2,
    'remote firing comes from snapshots while observer controls stay idle');
  assert.equal(render(remote) > 0, index === 1 || index === 3,
    'beam appears on fire, disappears on release, and stops immediately on retraction');
  const displayed = client.predictFrame({ now: now + 5 }).entities.get(fixture.remoteId);
  assert.equal(render(displayed) > 0, index === 1 || index === 3,
    'frame prediction retains remote beam visibility');
}
const joining = connect();
joining.receive({ message: decode(fixture.join) });
assert(render(joining.world.entities.get(fixture.remoteId)) > 0,
  'joining observers see an already firing beam from the initial snapshot');
console.log('Remote beams follow real Go snapshots, release, retraction, and joining');
`;
const entryId = `${root}/src/__beam_visibility_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'beam-visibility-fixture',
        resolveId: (id) => (id === entryId ? id : undefined),
        load(id) {
          if (id === entryId) {
            return production
              ? stripIfdef(
                  scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : scenario;
          }

          if (id.endsWith('/src/client/audio/sound-loader.ts')) {
            return 'export const unlockAudio=()=>{};export const playSound=()=>{};export const updateThrusterSound=()=>{};';
          }
        },
      },
      buildPrePlugin(),
      ...(production ? [testBuildPlugin()] : []),
    ],
  });

  try {
    const { output } = await bundle.generate({
      format: 'esm',
      minify: production,
    });

    await import(
      'data:text/javascript;base64,' +
        Buffer.from(output[0].code).toString('base64')
    );
  } finally {
    await bundle.close();
  }
}
