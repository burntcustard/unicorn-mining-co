import '../support/ignore-handshake-timeout.ts';

/* global Buffer, process */
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { stripIfdef } from '../../plugins/replace-pre-terser';
import { testBuildPlugin } from '../support/build-plugin';
import { fixtureSource } from '../support/fixture-source.ts';

const root = process.cwd();
const fixtureExecutable =
  'src/server/target/debug/examples/beam_visibility_fixture';
const server = 'Rust';
const fixture = execFileSync(fixtureExecutable, [], { encoding: 'utf8' });
const fixtureInput = fixtureSource(JSON.parse(fixture));

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
const fixture = ${fixtureInput};
const decode = hex => decodeBinarySnapshot(Uint8Array.from(Buffer.from(hex, 'hex')));
const connect = () => {
  const client = new NetworkClient({ url: 'test' });
  client.receive({ message: {
    type: 'welcome', playerId: 'test', playerNumber: 1, shipId: fixture.observerId,
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
const checkAim = (world, ship, aiming) => {
  const beam = ship.modules.find(module => module instanceof Laser);
  const target = world.entities.get(fixture.observerId);
  const mount = beam.mount.localPosition;
  const angle = Math.atan2(target.position.y - ship.position.y - mount.y, target.position.x - ship.position.x - mount.x);
  if (aiming) assert(angle !== 0 && Math.abs(angle) <= beam.aimLimit, 'the fixture target requires a turn within the example beam arc');
  const expected = aiming ? angle : 0;
  assert(Math.abs(beam.aimRotation - expected) < 1e-6, 'authoritative fixed weapon aim reaches the remote view');
};
const client = connect();
let now = performance.now() + 100;
for (const [index, hex] of fixture.packets.entries()) {
  const message = decode(hex);
  if (index === 1 || index === 2) {
    assert.equal(message.fullEntities.find(entity => entity.id === fixture.remoteId).firing,
      index === 1, 'both firing edges must be present in real ${server} deltas');
  }
  client.receive({ message });
  now += simulationStep * 1000;
  client.updateFrame({ input: emptyPlayerInput(), now, dt: 0 });
  const remote = client.world.entities.get(fixture.remoteId);
  const aiming = index === 1 || index === 3;
  assert.equal(remote.firing, index !== 0 && index !== 2,
    'remote firing comes from snapshots while observer controls stay idle');
  checkAim(client.world, remote, aiming);
  assert.equal(render(remote) > 0, aiming,
    'beam appears on fire, disappears on release, and stops immediately on retraction');
  const prediction = client.predictFrame({ now: now + 5 });
  const displayed = prediction.entities.get(fixture.remoteId);
  checkAim(prediction, displayed, aiming);
  assert.equal(render(displayed) > 0, aiming,
    'frame prediction retains remote beam visibility');
}
const joining = connect();
joining.receive({ message: decode(fixture.join) });
checkAim(joining.world, joining.world.entities.get(fixture.remoteId), true);
assert(render(joining.world.entities.get(fixture.remoteId)) > 0,
  'joining observers see an already firing beam from the initial snapshot');
console.log('Remote beams follow real ${server} snapshots, release, retraction, and joining');
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
