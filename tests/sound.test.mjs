/* global Buffer, process */
import assert from 'node:assert/strict';
import { minify } from 'terser';
import { rolldown } from 'rolldown';
import viteConfig from '../vite.config.js';
import { viteJs13kPre } from '../plugins/vite-js13k.js';

const scenario = `
import { TestAudioContext } from '${process.cwd()}/tests/audio-context.mjs';
import assert from 'node:assert/strict';
import { ramp, tone } from '${process.cwd()}/src/sound.js';
import { horn } from '${process.cwd()}/src/modules/horn.js';

assert.equal(TestAudioContext.instances.length, 0, 'import does not initialize audio');
horn.update({ phase: 0, activationProgress: 0 }, 1 / 60);
assert.equal(TestAudioContext.instances.length, 0, 'inactive drill does not initialize audio');

const beep = tone(440, 'sine');
assert.equal(beep.type, 'sine');
assert.equal(beep.frequency.value, 440);
assert.equal(beep.starts, 1, 'a tone plays as soon as it is made');
assert.equal(beep.gain.value, 0, 'a tone starts silent');
assert(beep.destination, 'oscillator is connected');
assert.equal(TestAudioContext.instances[0].sources.length, 2, 'a tone is chopped by a second oscillator');
ramp(beep.gain, .5);
assert.equal(beep.gain.value, .5, 'ramping reaches the level asked for');

const segment = { phase: 0, activationProgress: .5 };
horn.update(segment, 1 / 60);
assert(!segment.drillSound, 'silent at activation threshold');
segment.activationProgress = .6;
horn.update(segment, 1 / 60);
const first = segment.drillSound;
assert.equal(first.starts, 1, 'drill starts a sound');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(segment.drillSound, first, 'held drill does not restart');
assert.equal(first.stops, 0);
segment.activationProgress = .5;
horn.update(segment, 1 / 60);
// The native stop is scheduled on the audio clock, at the end of the fade out.
assert.equal(first.stops, 1, 'crossing threshold stops sound');
assert.equal(first.stopTimes[0], .2, 'native stop is scheduled for the end of the fade');
assert.equal(first.gain.value, 0, 'stopping fades to silence');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(first.stops, 1, 'stopped source is not stopped again');
segment.activationProgress = 1;
horn.update(segment, 1 / 60);
assert.notEqual(segment.drillSound, first, 'restart creates a new sound');
const idle = segment.drillSound;
assert.equal(idle.starts, 1);
assert.equal(idle.gain.value, .06, 'a drill touching nothing idles quietly');
segment.biting = true;
horn.update(segment, 1 / 60);
assert.equal(segment.drillSound, idle, 'biting ramps the sound rather than restarting it');
assert.equal(idle.gain.value, .2, 'biting rises to full volume');
assert.equal(idle.stops, 0, 'biting does not stop the sound');
segment.biting = false;
horn.update(segment, 1 / 60);
assert.equal(idle.gain.value, .06, 'losing contact drops back to the idle level');
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
build.terserOptions.mangle.properties.reserved.push('equal', 'notEqual');
const compressed = await minify(output[0].code, build.terserOptions);

for (const code of [output[0].code, compressed.code]) {
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

assert(compressed.code.includes('createOscillator'), 'Web Audio methods stay unmangled');
console.log('Tones, ramps and drill start/stop passed, including production mangling.');
