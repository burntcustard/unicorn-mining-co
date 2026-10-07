/* global Buffer, process */
import { execFileSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const fixtures = execFileSync(
  'go',
  ['run', 'src/server/testtools/muzzle-flashes/main.go'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);

// NetworkClient also exports the normal singleton; supply browser APIs before
// evaluating either bundle, and drive packet receipt independently of rendering.
Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  localStorage: {
    setItem() {},
    getItem(): null {
      return null;
    },
  },
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
import { simulationStep } from '${root}/src/specs/simulation.ts';
import { effects } from '${root}/src/client/effects/effect.ts';
globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
const fixtures = ${fixtures};
const decode = hex => decodeBinarySnapshot(Uint8Array.from(Buffer.from(hex, 'hex')));
for (const fixture of fixtures) for (const delay of [0, 1, 3, 8]) for (const skipTick of [-1, 35]) {
  effects.length = 0;
  const network = new NetworkClient({ url: 'test' });
  network.receive({ message: {
    type: 'welcome', playerToken: 'test', playerId: 1, shipId: 1,
    worldSeed: 25, serverTick: 0, spawn: { x: 0, y: 0 }, unlockedPaints: [],
  }});
  network.receive({ message: decode(fixture.initial) });
  let now = performance.now() + 1;
  let shots = 0;
  let previousCooldown = Infinity;
  for (let tick = 0; tick < fixture.frames.length; tick++) {
    const frame = fixture.frames[tick];
    for (const [offset, fire] of frame.edges) {
      network.prediction.recordInput({
        input: { ...emptyPlayerInput(), plasmaActive: true, autogunActive: true, fire }, offset, send() {},
      });
    }
    const packet = fixture.frames[tick - delay]?.packet;
    if (packet) network.receive({ message: decode(packet) });
    now += simulationStep * 1000;
    const ship = network.world.entities.get(1);
    const before = effects.length;
    network.updateFrame({
      input: { ...emptyPlayerInput(), plasmaActive: true, autogunActive: true, fire: frame.edges.at(-1)[1] },
      now, dt: tick === skipTick ? 0 : simulationStep,
    });
    ship.updateVisual(simulationStep);
    const gun = ship.modules.find(module => module.definitionId === fixture.weapon);
    const shown = effects.length - before;
    assert(shown <= 1, 'snapshot replay cannot duplicate a muzzle flash');
    // Once holding, a wrapped cooldown is evidence of a new actual shot even
    // when the snapshot supplies it before local prediction reaches that shot.
    if (
      tick % 90 > 35 && tick % 90 < 80 &&
      gun.fireCooldown > simulationStep &&
      gun.fireCooldown > previousCooldown + simulationStep
    ) {
      shots++;
      assert.equal(
        shown, 1,
        fixture.weapon + ': missing flash after tap/hold transition at tick ' + tick +
        ', delay=' + delay + ', skipTick=' + skipTick,
      );
    }
    previousCooldown = gun.fireCooldown;
    const presented = effects.length;
    network.predictFrame({ now: now + 5 });
    ship.updateVisual(.2);
    assert.equal(effects.length, presented, 'display pauses and partial prediction do not invent flashes');
  }
  assert(shots > 0, 'the regression checks sustained firing after tap/hold transitions');
  assert.equal(
    effects.length, fixture.frames.reduce((sum, frame) => sum + frame.shots, 0),
    fixture.weapon + ': every Go shot produces one flash, delay=' + delay + ', skipTick=' + skipTick,
  );
}
console.log('Tap/hold muzzle flashes survive real Go snapshots and clock corrections');
`;

const entryId = `${root}/src/__muzzle_flash_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'muzzle-flash-test',
        resolveId: (id) => (id === entryId ? entryId : undefined),
        load(id: string) {
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
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
