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

const beep = tone(440, 'sine');
assert.equal(beep.type, 'sine');
assert.equal(beep.frequency.value, 440);
assert.equal(beep.starts, 1, 'a tone plays as soon as it is made');
assert.equal(beep.gain.value, 0, 'a tone starts silent');
assert(beep.destination, 'oscillator is connected');
assert.equal(TestAudioContext.instances[0].sources.length, 2, 'a tone is chopped by a second oscillator');
playSound();
ramp(beep.gain, .5);
assert.equal(beep.gain.value, .5, 'ramping reaches the level asked for');

playSound(soundEffects.pickup);
assert.equal(TestAudioContext.instances[0].sources.length, 3, 'a preset creates one buffer source');

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
assert.equal(Math.round(first.stopTimes[0] * 100) / 100, .51, 'native stop is scheduled for the end of the 0.5s fade');
assert.equal(first.gain.value, 0, 'stopping fades to silence');
for (let i = 0; i < 120; i++) horn.update(segment, 1 / 60);
assert.equal(first.stops, 1, 'stopped source is not stopped again');
segment.active = 1;
horn.update(segment, 1 / 60);
assert.notEqual(segment.drillSound, first, 'restart creates a new sound');
const idle = segment.drillSound;
assert.equal(idle.starts, 1);
assert.equal(idle.gain.value, .3, 'a drill touching nothing idles quietly');
segment.biting = true;
horn.update(segment, 1 / 60);
assert.equal(segment.drillSound, idle, 'biting ramps the sound rather than restarting it');
assert.equal(idle.gain.value, .5, 'biting rises to full volume');
assert.equal(idle.stops, 0, 'biting does not stop the sound');
segment.biting = false;
horn.update(segment, 1 / 60);
assert.equal(idle.gain.value, .3, 'losing contact drops back to the idle level');
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
assert.equal(context.sources.length, sourceCount + 2, 'any thrust starts a noise source and motor');
const motor = context.sources[sourceCount + 1];
assert.equal(motor.wave.real[0], 0, 'pressure waveform has no DC offset');
assert(motor.wave.real[8] > 0 && motor.wave.real[16] > 0, 'exhaust pulses retain their firing harmonics');
assert(Math.abs(motor.wave.real[1]) + Math.abs(motor.wave.imaginary[1]) > 0, 'a quieter mechanical fundamental remains');
assert.equal(engine.gain.events[0][2], .01, 'attack begins after only 10 ms');
assert.equal(engine.gain.events[1][2], .05, 'attack reaches volume at 50 ms');
assert.equal(engine.frequency.events[0][1], 180, 'starts with a low exhaust rumble');
assert.equal(engine.frequency.events[1][2], .36, 'whoosh opens fully within half a second');
const gainEvents = engine.gain.events.length;
for (let i = 0; i < 120; i++) updateThrusterSound(.01);
assert.equal(engine.gain.events.length, gainEvents, 'held thrust leaves automation alone');
updateThrusterSound(1);
assert.equal(context.sources.length, sourceCount + 2, 'changing power keeps the voice');
assert.equal(engine.frequency.value, 600, 'full thrust keeps the exhaust dark');
assert.equal(engine.motorFrequency.value, 10, 'motor spools to ten exhaust cycles per second');
assert(Math.abs(engine.gain.value * motor.destination.gain.value - .0255) < 1e-8, 'effective motor gain stays quiet');
assert.equal(engine.destination.destination.gain, engine.gain, 'air has an audible path through the filter and envelope');
assert.equal(motor.destination.destination, engine.destination, 'motor and air share the low-pass filter');
updateThrusterSound(0);
assert.equal(engine.frequency.value, 180, 'release closes the noise filter');
assert.equal(engine.stopTimes[0], .31, 'release stops at the end of its 300 ms fade');
assert.equal(context.sources[sourceCount + 1].stopTimes[0], .31, 'motor stops with the noise');
assert.equal(engine.loop, true, 'exhaust noise loops continuously');
assert(engine.assignedSamples.some(sample => sample !== 0), 'noise is filled before buffer assignment');
updateThrusterSound(0);
assert.equal(engine.stops, 1, 'idle updates do not stop twice');
updateThrusterSound(1);
assert.equal(context.sources.length, sourceCount + 4, 'rapid restart creates a fresh fading-in voice');
assert.equal(context.sources[sourceCount + 2].buffer, engine.buffer, 'restarts reuse the noise buffer');
assert.equal(context.sources[sourceCount + 3].wave, motor.wave, 'restarts reuse the waveform');
updateThrusterSound(0);

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
