/* global Buffer, process */
import assert from 'node:assert/strict';
import { minify } from 'terser';
import { rolldown } from 'rolldown';
import viteConfig from '../vite.config.js';
import { viteJs13kPre } from '../plugins/vite-js13k.js';

const scenario = `
import { TestAudioContext } from '${process.cwd()}/tests/audio-context.mjs';
import assert from 'node:assert/strict';
import { zzfx } from '${process.cwd()}/src/sound.js';
import { horn } from '${process.cwd()}/src/modules/horn.js';

assert.equal(TestAudioContext.instances.length, 0, 'import does not initialize audio');
horn.update({ phase: 0, activationProgress: 0 }, 1 / 60);
assert.equal(TestAudioContext.instances.length, 0, 'inactive drill does not initialize audio');

// Keep every waveform reachable, including effects not yet used by the game.
for (const shape of [0, 1, 2, 3]) {
  const source = zzfx(.15, 0, 90, .02, .05, .05, shape, .5, .5);
  const buffer = source.buffer;
  const samples = buffer.getChannelData(0);
  assert.equal(buffer.sampleRate, 44100);
  assert.equal(samples.length, 5292);
  assert.equal(source.starts, 1);
  assert(source.destination, 'source is connected');
  assert(samples.every(Number.isFinite), 'finite samples');
  assert.equal(samples[0], 0, 'attack starts at zero');
  assert(Math.max(...samples) > .1 && Math.min(...samples) < -.1, 'audible waveform');
  assert(Math.abs(samples.at(-1)) < .001, 'release ends near zero');
}

const originalRandom = Math.random;
Math.random = () => .25;
const lower = zzfx(.15, .1, 90, .02, .05, .05, 0, .5, .5).buffer.getChannelData(0);
Math.random = () => .75;
const upper = zzfx(.15, .1, 90, .02, .05, .05, 0, .5, .5).buffer.getChannelData(0);
Math.random = originalRandom;
assert.notDeepEqual(lower, upper, 'randomness changes pitch');

const segment = { phase: 0, activationProgress: .5, rate: 2 };
horn.update(segment, 1 / 60);
assert(!segment.drillSound, 'silent at activation threshold');
segment.activationProgress = .6;
horn.update(segment, 1 / 60);
const first = segment.drillSound;
assert(first.loop && first.starts === 1, 'drill starts a loop');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(segment.drillSound, first, 'held drill does not restart');
assert.equal(first.stops, 0);
segment.activationProgress = .5;
horn.update(segment, 1 / 60);
// stop() itself fades the gain over half a second and only really stops once
// silent, so it doesn't click - wait for that to land before checking it happened
await new Promise((r) => setTimeout(r, 550));
assert.equal(first.stops, 1, 'crossing threshold stops sound');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(first.stops, 1, 'stopped source is not stopped again');
segment.activationProgress = 1;
horn.update(segment, 1 / 60);
assert.notEqual(segment.drillSound, first, 'restart creates a new source');
assert.equal(segment.drillSound.starts, 1);
assert.equal(TestAudioContext.instances.length, 1, 'all effects reuse the first audio context');
`;

const bundle = await rolldown({
  input: 'sound-scenario.js',
  external: ['node:assert/strict'],
  plugins: [{
    name: 'sound-test-entry',
    resolveId: (id) => id === 'sound-scenario.js' ? '\0sound-scenario.js' : undefined,
    load: (id) => id === '\0sound-scenario.js' ? scenario : undefined,
  }, viteJs13kPre()],
});
const { output } = await bundle.generate({ format: 'esm' });
await bundle.close();
const { build } = viteConfig({ mode: 'fast', command: 'build' });
// Node's assert methods are external to the bundled scenario, like Web Audio.
build.terserOptions.mangle.properties.reserved.push('equal', 'notEqual', 'notDeepEqual');
const compressed = await minify(output[0].code, build.terserOptions);

for (const code of [output[0].code, compressed.code]) {
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

assert(compressed.code.includes('getChannelData'), 'Web Audio methods stay unmangled');
console.log('Sound waveforms, randomized pitch and drill start/stop passed, including production mangling.');
