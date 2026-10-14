/* global Buffer, process */
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import assert from 'node:assert/strict';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';
import { rolldown } from 'rolldown';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const scenario = `
import assert from 'node:assert/strict';
import { TestAudioContext } from '${process.cwd()}/tests/support/audio-context.ts';
import { continuousSound, playSound, ramp, tone, updateThrusterSound as updateEngineSound } from '${process.cwd()}/src/client/audio/sound.ts';
import { HornDrill } from '${process.cwd()}/src/client/objects/modules/horn-drill.ts';
import { updateHornDrillSounds } from '${process.cwd()}/src/client/audio/update-horn-drill-sounds.ts';
import { remoteSoundVolume } from '${process.cwd()}/src/client/audio/remote-sound-volume.ts';
import { presentWorldSounds } from '${process.cwd()}/src/client/audio/present-world-sounds.ts';
import { updateThrusterSounds } from '${process.cwd()}/src/client/audio/update-thruster-sounds.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { ThrusterDualMd } from '${process.cwd()}/src/client/objects/modules/thruster.ts';
let engineVoice = 0;
const updateThrusterSound = (power, load = 0) => engineVoice = updateEngineSound(engineVoice, { power, load }) || 0;
const hornDrill = new HornDrill();
const mount = { health: 100, module: hornDrill };
const updateHornDrill = (segment, dt) => {
  hornDrill.updateVisual({segments: [segment], dt});
  updateHornDrillSounds({crafts: [{id: 42, mounts: [mount], segmentsAtMount: () => [segment]}]});
};
const lastVoice = () => TestAudioContext.instances[0].sources.at(-1);

assert.equal(TestAudioContext.instances.length, 0, 'import does not initialize audio');
updateHornDrill({ phase: 0, activationProgress: 0 }, 1 / 60);
assert.equal(TestAudioContext.instances.length, 0, 'inactive horn drill does not initialize audio');
continuousSound(0, 1);
assert.equal(TestAudioContext.instances.length, 0, 'preloaded looped audio waits for a gesture');

const beep = tone();
assert.equal(beep.buffer.getChannelData(0).length, 1470, 'one cached cycle of the chopped 30 Hz horn drill');
assert.equal(beep.playbackRate.value, 0.4);
assert.equal(beep.starts, 1, 'a tone plays as soon as it is made');
assert.equal(beep.gain.value, 0, 'a tone starts silent');
assert(beep.destination, 'oscillator is connected');
assert.equal(TestAudioContext.instances[0].sources.length, 1, 'the chopped tone is premixed into one source');
ramp(beep.gain, .5);
assert.equal(beep.gain.value, .5, 'ramping reaches the level asked for');

playSound(2);
assert.equal(TestAudioContext.instances[0].sources.length, 2, 'a preset creates one buffer source');

const segment = { phase: 0, active: 0 };
updateHornDrill(segment, 1 / 60);
assert.equal(TestAudioContext.instances[0].sources.length, 2, 'silent when inactive');
segment.active = 1;
updateHornDrill(segment, 1 / 60);
const first = lastVoice();
assert.equal(first.starts, 1, 'horn drill starts a sound');
for (let i = 0; i < 120; i++) updateHornDrill(segment, 1 / 60);
assert.equal(lastVoice(), first, 'held horn drill does not restart');
assert.equal(first.stops, 0);
segment.active = 0;
updateHornDrill(segment, 1 / 60);
// The native stop is scheduled on the audio clock, at the end of the fade out.
assert.equal(first.stops, 1, 'stopping sound schedules native stop');
assert.equal(Math.round(first.stopTimes[0] * 100) / 100, 1.21, 'native stop is scheduled for the end of the fade');
assert.equal(first.gain.value, 0, 'stopping fades to silence');
for (let i = 0; i < 120; i++) updateHornDrill(segment, 1 / 60);
assert.equal(first.stops, 1, 'stopped source is not stopped again');
segment.active = 1;
updateHornDrill(segment, 1 / 60);
assert.notEqual(lastVoice(), first, 'restart creates a new sound');
const idle = lastVoice();
assert.equal(idle.starts, 1);
assert.equal(idle.gain.value, 2, 'a horn drill touching nothing uses half volume');
assert.equal(idle.playbackRate.value, 0.95, 'idle drill pitch stays the same');
segment.biting = true;
updateHornDrill(segment, 1 / 60);
assert.equal(lastVoice(), idle, 'biting ramps the sound rather than restarting it');
assert.equal(idle.gain.value, 4, 'biting rises to half the previous volume');
assert.equal(idle.playbackRate.value, 0.9, 'biting drill pitch stays the same');
assert.equal(idle.stops, 0, 'biting does not stop the sound');
segment.biting = false;
updateHornDrill(segment, 1 / 60);
assert.equal(idle.gain.value, 2, 'losing contact drops back to the idle level');
// Reconciliation replaces simulation objects, but must not orphan their audio.
const replacement = { ...segment };
updateHornDrill(replacement, 1 / 60);
assert.equal(lastVoice(), idle, 'replacement segment retains the existing voice');
replacement.active = 0;
updateHornDrill(replacement, 1 / 60);
assert.equal(idle.stops, 1, 'deactivation after rollback stops the original voice');
replacement.active = 1;
updateHornDrill(replacement, 1 / 60);
const removed = lastVoice();
updateHornDrillSounds({crafts: []});
assert.equal(removed.stops, 1, 'unloading a craft stops its horn drill');
updateHornDrill(replacement, 1 / 60);
const damaged = lastVoice();
mount.health = 0;
updateHornDrill(replacement, 1 / 60);
assert.equal(damaged.stops, 1, 'destroying a horn drill mount stops its voice');
mount.health = 100;
const remoteSegment = { active: 1 };
const localCraft = { id: 42, mounts: [mount], segmentsAtMount: () => [replacement] };
const remoteCraft = { id: 43, mounts: [mount], segmentsAtMount: () => [remoteSegment] };
const view = { view: { x: 100, y: 200 }, width: 800, height: 600 };
remoteCraft.position = { x: 500, y: 500 };
const volume = craft => craft.id === 42 ? 1 : remoteSoundVolume({ ...view, position: craft.position });
for (const position of [{ x: 100, y: 500 }, { x: 900, y: 500 }, { x: 500, y: 200 }, { x: 500, y: 800 }]) {
  assert.equal(remoteSoundVolume({ ...view, position }), .5, 'every screen edge retains half volume');
}
for (const position of [{ x: -50, y: 500 }, { x: 1050, y: 500 }, { x: 500, y: 50 }, { x: 500, y: 950 }]) {
  assert.equal(remoteSoundVolume({ ...view, position }), .25, 'every offscreen direction fades gradually');
}
assert.equal(remoteSoundVolume({ ...view, position: { x: 1080, y: 1040 } }), 0, 'corner attenuation uses distance to the viewport');
assert.equal(remoteSoundVolume({ ...view, width: 1600, height: 1200, position: { x: 2000, y: 500 } }), .25, 'fade distance follows viewport size');
updateHornDrillSounds({crafts: [localCraft], volume});
const localVoice = lastVoice();
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
const remoteVoice = lastVoice();
assert.notEqual(localVoice, remoteVoice, 'players have independent horn drill voices');
assert.equal(localVoice.gain.value, 2, 'local drill retains its effect volume');
assert.equal(remoteVoice.gain.value, 1, 'visible remote drill plays at half local volume');
remoteCraft.position.x = 1050;
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
assert.equal(lastVoice(), remoteVoice, 'moving offscreen retains the drill voice');
assert.equal(remoteVoice.gain.value, .5, 'remote drill fades beyond the edge');
assert.equal(remoteVoice.playbackRate.value, .95, 'distance does not change drill pitch');
view.view.x += 150;
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
assert.equal(remoteVoice.gain.value, 1, 'camera motion changes the audible viewport');
view.view.x -= 150;
remoteCraft.position.x = 1200;
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
assert.equal(remoteVoice.stops, 1, 'fully faded drill schedules a stop');
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
assert.equal(remoteVoice.stops, 1, 'inaudible drill is not stopped twice');
remoteCraft.position.x = 500;
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
const returningVoice = lastVoice();
assert.notEqual(returningVoice, remoteVoice, 'returning from silence creates a fresh voice');
assert.equal(returningVoice.gain.value, 1, 'returning drill restores half volume');
replacement.active = 0;
updateHornDrillSounds({crafts: [localCraft, remoteCraft], volume});
assert.equal(localVoice.stops, 1, 'local deactivation stops only its own drill');
assert.equal(returningVoice.stops, 0, 'remote horn drill keeps playing');
updateHornDrillSounds({crafts: []});
assert.equal(returningVoice.stops, 1, 'remote unload stops its horn drill');
const context = TestAudioContext.instances[0];
context.currentTime += 1;
playSound(0, { volume: 0 });
const beforeHatch = context.sources.length;
playSound(0, { volume: .25 });
assert.equal(context.sources.length, beforeHatch + 1, 'silent effect does not consume the repeat cooldown');
assert.equal(lastVoice().destination.gain.value, .25, 'volume multiplies its cached effect');
playSound(0);
assert.equal(lastVoice().destination.gain.value, 1, 'quiet remote effect cannot suppress a local effect');
for (const effect of [0, 1, 2, 3, 4, 5, 6, 7, 9]) {
  context.currentTime += 1;
  const count = context.sources.length;
  presentWorldSounds({ playerId: 1, view: { position: view.view, width: view.width, height: view.height }, sounds: [
    { effect, id: 42, by: 1, position: { x: 1200, y: 500 } },
    { effect, id: 43, by: 2, position: { x: 500, y: 500 } },
    { effect, id: 44, by: 3, position: { x: 1050, y: 500 } },
    { effect, id: 45, by: 4, position: { x: 1200, y: 500 } },
    { effect, id: 44, by: 5, position: { x: 500, y: 500 } },
  ] });
  assert.equal(context.sources.length, count + 4, 'nearby players all play the same gameplay effect, including on a shared object');
  assert.deepEqual(context.sources.slice(count).map(source => source.destination.gain.value), [1, .5, .25, .5], 'every gameplay effect applies ownership and offscreen attenuation');
}
const sourceCount = context.sources.length;
updateThrusterSound(0);
assert.equal(context.sources.length, sourceCount, 'idle thrusters create no voice');
context.state = 'suspended';
updateThrusterSound(1);
assert.equal(context.sources.length, sourceCount, 'suspended context creates no engine');
context.state = 'running';
updateThrusterSound(.01);
const engine = context.sources[sourceCount];
assert.equal(context.sources.length, sourceCount + 1, 'air and motor use one premixed source');
assert.equal(engine.gain.events[0][2], context.currentTime + .01, 'attack starts after 10 ms');
assert.equal(Math.round(engine.gain.events[0][3] * 100) / 100, .24, 'attack approaches its target over 1.2s');
assert.equal(engine.playbackRate.events[0][1], .7, 'idle engine starts at its base pitch');
assert.equal(engine.playbackRate.events[0][2], context.currentTime + .01, 'pitch follows the same short lead');
const pitchEvents = engine.playbackRate.events.length;
const gainEvents = engine.gain.events.length;
for (let i = 0; i < 120; i++) updateThrusterSound(.01);
assert.equal(engine.gain.events.length, gainEvents, 'held thrust leaves automation alone');
assert.equal(engine.playbackRate.events.length, pitchEvents, 'held revs leave pitch automation alone');
updateThrusterSound(1, 1);
assert.equal(context.sources.length, sourceCount + 1, 'changing power keeps the voice');
assert(Math.abs(engine.playbackRate.value - 1.9) < 1e-8, 'maximum load reaches the full rev range');
assert(Math.abs(engine.gain.value - 0.72) < 1e-8, 'full thrust uses half the previous volume');
assert.equal(engine.destination.gain, engine.gain, 'premixed air and motor connect to the envelope');
updateThrusterSound(0);
assert.equal(Math.round(engine.stopTimes[0] * 100) / 100, context.currentTime + 1.21, 'release stops at the end of its 1.2s fade');
assert.equal(engine.loop, true, 'exhaust noise loops continuously');
assert(engine.assignedSamples.some(sample => sample !== 0), 'noise is filled before buffer assignment');
updateThrusterSound(0);
assert.equal(engine.stops, 1, 'idle updates do not stop twice');
updateThrusterSound(1, 1);
assert.equal(context.sources.length, sourceCount + 2, 'rapid restart creates a fresh fading-in voice');
assert.equal(context.sources[sourceCount + 1].buffer, engine.buffer, 'restarts reuse the noise buffer');
updateThrusterSound(0);

const makeShip = id => {
  const ship = new Ship({ id });
  ship.fit(new ThrusterDualMd(), ship.mounts.find(mount => mount.fits.includes(ThrusterDualMd)));
  ship.fly(1, 0);
  return ship;
};
const localShip = makeShip(101);
const remoteShip = makeShip(102);
remoteShip.position = { x: 500, y: 500 };
const shipVolume = ship => ship.id === 101 ? 1 : remoteSoundVolume({ ...view, position: ship.position });
const beforeEngines = context.sources.length;
updateThrusterSounds({ crafts: [localShip, remoteShip], volume: shipVolume });
const localEngine = context.sources[beforeEngines];
const remoteEngine = context.sources[beforeEngines + 1];
assert.equal(context.sources.length, beforeEngines + 2, 'every player gets an independent engine');
assert.equal(localEngine.gain.value, .12, 'local engine keeps its original idle thrust volume');
assert.equal(remoteEngine.gain.value, .06, 'remote engine is half as loud');
remoteShip.position.x = 1050;
updateThrusterSounds({ crafts: [localShip, remoteShip], volume: shipVolume });
assert.equal(remoteEngine.gain.value, .03, 'engine fades past the screen edge');
assert.equal(remoteEngine.playbackRate.value, .7, 'distance keeps engine pitch intact');
remoteShip.dockedTo = 1;
updateThrusterSounds({ crafts: [localShip, remoteShip], volume: shipVolume });
assert.equal(remoteEngine.stops, 1, 'docking stops only that player engine');
assert.equal(localEngine.stops, 0);
remoteShip.dockedTo = 0;
remoteShip.position.x = 500;
updateThrusterSounds({ crafts: [localShip, remoteShip], volume: shipVolume });
const restartedEngine = lastVoice();
assert.notEqual(restartedEngine, remoteEngine, 'launch creates a new engine voice');
updateThrusterSounds({ crafts: [localShip], volume: shipVolume });
assert.equal(restartedEngine.stops, 1, 'unloading a remote ship retires its engine');
updateThrusterSounds({ crafts: [] });
assert.equal(localEngine.stops, 1, 'removing the local ship retires its engine too');

// Every effect is audible, finite, filled before assignment, cached and debounced.
for (const effect of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  context.currentTime += 1;
  const count = context.sources.length;
  playSound(effect);
  const voice = context.sources[count];
  const samples = voice.assignedSamples;
  assert(samples.every(Number.isFinite), 'effect samples are finite');
  assert(samples.some(sample => sample !== 0), 'effect is populated before assignment');
  assert.equal(samples[0], 0, 'effect begins silently');
  playSound(effect);
  assert.equal(context.sources.length, count + 1, 'immediate repeats are debounced');
  context.currentTime += 1;
  playSound(effect);
  assert.equal(context.sources[count + 1].buffer, voice.buffer, 'effect buffer is reused');
}

assert.equal(TestAudioContext.instances.length, 1, 'all effects reuse the first audio context');`;

for (const production of [false, true]) {
  const entryId = `${process.cwd()}/src/__sound_test.ts`;
  const audioContextId = `${process.cwd()}/src/__sound_audio_context.ts`;
  const audioContextPath = `${process.cwd()}/tests/support/audio-context.ts`;

  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'sound-test-entry',
        resolveId: (id, importer) => {
          if (id === entryId) return entryId;

          // Test-owned fields must follow the same source mangling as the scenario.
          if (id === audioContextPath) return audioContextId;

          if (
            id === './sound-loader' &&
            /\/src\/client\/audio\/(?:update-horn-drill-sounds|update-thruster-sounds|present-world-sounds)\.ts$/.test(
              importer || '',
            )
          ) {
            return `${process.cwd()}/src/client/audio/sound.ts`;
          }

          if (
            id === '../../game' ||
            id === '../game' ||
            id === '../../../game'
          ) {
            return '\0mock-game';
          }
        },
        load: (id) => {
          if (id === '\0mock-game') return 'export const game = {ctx:{}};';

          if (id === audioContextId) {
            return readFileSync(audioContextPath, 'utf8');
          }

          if (id === entryId) {
            return stripIfdef(
              production
                ? scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  )
                : scenario,
            );
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
  const code = output[0].code;

  await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );

  assert(
    code.includes('createBufferSource') && code.includes('setTargetAtTime'),
    'Web Audio methods stay unmangled',
  );
}

console.log(
  'Tones, ramps and horn drill start/stop passed, including production mangling.',
);

// Exercise volume forwarding through the real loader and a separate audio chunk.
const directory = await mkdtemp(join(tmpdir(), 'sound-loader-'));
const loaderEntry = `${process.cwd()}/src/__sound_loader_test.ts`;
const loaderContextId = `${process.cwd()}/src/__sound_loader_context.ts`;

const loaderBundle = await rolldown({
  input: loaderEntry,
  external: ['node:assert/strict'],
  plugins: [
    {
      name: 'sound-loader-test',
      resolveId: (id) =>
        id === loaderEntry || id === loaderContextId ? id : undefined,
      load: (id) => {
        if (id === loaderContextId) {
          return readFileSync('tests/support/audio-context.ts', 'utf8');
        }

        if (id === loaderEntry) {
          return `
import assert from 'node:assert/strict';
import { TestAudioContext } from '${loaderContextId}';
import { preloadSound, unlockAudio, playSound, updateThrusterSound } from './client/audio/sound-loader';
export async function check() {
  await preloadSound();
  assert.equal(TestAudioContext.instances.length, 0);
  await unlockAudio();
  playSound(0, { volume: .25 });
  const context = TestAudioContext.instances[0];
  assert.equal(context.sources[0].destination.gain.value, .25);
  context.currentTime += 1;
  playSound(0);
  assert.equal(context.sources[1].destination.gain.value, 1);
  assert.equal(context.sources[0].buffer, context.sources[1].buffer);
  const engine = updateThrusterSound(undefined, { power: 1, load: 1, volume: .5 });
  assert(Math.abs(engine.gain.value - .36) < 1e-8);
  assert(Math.abs(engine.playbackRate.value - 1.9) < 1e-8);
  updateThrusterSound(engine, { power: 0 });
  assert.equal(engine.stops, 1);
}`.replace(/assert\.(\w+)/g, (_, method) => `Reflect.get(assert, '${method}')`);
        }
      },
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await loaderBundle.write({
    dir: directory,
    format: 'esm',
    minify: true,
    entryFileNames: 'entry.mjs',
    chunkFileNames: '[name]-[hash].mjs',
  });

  assert.equal(output.filter((item) => item.type === 'chunk').length, 2);
  const { check } = await import(
    pathToFileURL(join(directory, 'entry.mjs')).href
  );

  await check();
  console.log(
    'Sound volume passed through the separately emitted production loader.',
  );
} finally {
  await loaderBundle.close();
  await rm(directory, { recursive: true, force: true });
}
