/* global Buffer, process */
import assert from 'node:assert/strict';
import { minify } from 'terser';
import { rolldown } from 'rolldown';
import viteConfig from '../vite.config.js';
import { viteJs13kPre } from '../plugins/vite-js13k.js';

const scenario = `
import { TestAudioContext } from '${process.cwd()}/tests/audio-context.mjs';
import assert from 'node:assert/strict';
import { playSound, ramp, soundEffects, tone, updateThrusterSound } from '${process.cwd()}/src/sound.js';
import { horn } from '${process.cwd()}/src/modules/horn.js';

assert.equal(TestAudioContext.instances.length, 0, 'import does not initialize audio');
horn.update({ phase: 0, activationProgress: 0 }, 1 / 60);
assert.equal(TestAudioContext.instances.length, 0, 'inactive drill does not initialize audio');

const beep = tone();
assert.equal(beep.buffer.getChannelData(0).length, 1470, 'one cached cycle of the chopped 30 Hz drill');
assert.equal(beep.playbackRate.value, 0.4);
assert.equal(beep.starts, 1, 'a tone plays as soon as it is made');
assert.equal(beep.gain.value, 0, 'a tone starts silent');
assert(beep.destination, 'oscillator is connected');
assert.equal(TestAudioContext.instances[0].sources.length, 1, 'the chopped tone is premixed into one source');
ramp(beep.gain, .5);
assert.equal(beep.gain.value, .5, 'ramping reaches the level asked for');

playSound(soundEffects.pickup);
assert.equal(TestAudioContext.instances[0].sources.length, 2, 'a preset creates one buffer source');

const segment = { phase: 0, active: 0 };
horn.update(segment, 1 / 60);
assert(!segment.drillSound, 'silent when inactive');
segment.active = 1;
horn.update(segment, 1 / 60);
const first = segment.drillSound;
assert.equal(first.starts, 1, 'drill starts a sound');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(segment.drillSound, first, 'held drill does not restart');
assert.equal(first.stops, 0);
segment.active = 0;
horn.update(segment, 1 / 60);
// The native stop is scheduled on the audio clock, at the end of the fade out.
assert.equal(first.stops, 1, 'stopping sound schedules native stop');
assert.equal(Math.round(first.stopTimes[0] * 100) / 100, 1.21, 'native stop is scheduled for the end of the fade');
assert.equal(first.gain.value, 0, 'stopping fades to silence');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(first.stops, 1, 'stopped source is not stopped again');
segment.active = 1;
horn.update(segment, 1 / 60);
assert.notEqual(segment.drillSound, first, 'restart creates a new sound');
const idle = segment.drillSound;
assert.equal(idle.starts, 1);
assert.equal(idle.gain.value, 4, 'a drill touching nothing idles quietly');
segment.biting = true;
horn.update(segment, 1 / 60);
assert.equal(segment.drillSound, idle, 'biting ramps the sound rather than restarting it');
assert.equal(idle.gain.value, 8, 'biting rises to full volume');
assert.equal(idle.stops, 0, 'biting does not stop the sound');
segment.biting = false;
horn.update(segment, 1 / 60);
assert.equal(idle.gain.value, 4, 'losing contact drops back to the idle level');
const context = TestAudioContext.instances[0];
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
assert.equal(engine.gain.events[0][2], .01, 'attack starts after 10 ms');
assert.equal(Math.round(engine.gain.events[0][3] * 100) / 100, .24, 'attack approaches its target over 1.2s');
assert.equal(engine.playbackRate.events[0][1], .7, 'idle engine starts at its base pitch');
assert.equal(engine.playbackRate.events[0][2], .01, 'pitch follows the same short lead');
const pitchEvents = engine.playbackRate.events.length;
const gainEvents = engine.gain.events.length;
for (let i = 0; i < 120; i++) updateThrusterSound(.01);
assert.equal(engine.gain.events.length, gainEvents, 'held thrust leaves automation alone');
assert.equal(engine.playbackRate.events.length, pitchEvents, 'held revs leave pitch automation alone');
updateThrusterSound(1, 1);
assert.equal(context.sources.length, sourceCount + 1, 'changing power keeps the voice');
assert(Math.abs(engine.playbackRate.value - 1.9) < 1e-8, 'maximum load reaches the full rev range');
assert(Math.abs(engine.gain.value - 1.44) < 1e-8, 'full thrust retains its master level');
assert.equal(engine.destination.gain, engine.gain, 'premixed air and motor connect to the envelope');
updateThrusterSound(0);
assert.equal(Math.round(engine.stopTimes[0] * 100) / 100, 1.21, 'release stops at the end of its 1.2s fade');
assert.equal(engine.loop, true, 'exhaust noise loops continuously');
assert(engine.assignedSamples.some(sample => sample !== 0), 'noise is filled before buffer assignment');
updateThrusterSound(0);
assert.equal(engine.stops, 1, 'idle updates do not stop twice');
updateThrusterSound(1, 1);
assert.equal(context.sources.length, sourceCount + 2, 'rapid restart creates a fresh fading-in voice');
assert.equal(context.sources[sourceCount + 1].buffer, engine.buffer, 'restarts reuse the noise buffer');
updateThrusterSound(0);

// Every effect is audible, finite, filled before assignment, cached and debounced.
for (const effect of Object.values(soundEffects)) {
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

assert(compressed.code.includes('createBufferSource') && compressed.code.includes('setTargetAtTime'), 'Web Audio methods stay unmangled');
console.log('Tones, ramps and drill start/stop passed, including production mangling.');
