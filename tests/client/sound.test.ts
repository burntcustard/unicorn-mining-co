/* global Buffer, process */
import { buildPrePlugin } from '../../plugins/build-plugins.ts';
import assert from 'node:assert/strict';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';
import { rolldown } from 'rolldown';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testBuildPlugin } from '../support/build-plugin.ts';

const scenario = `
import assert from 'node:assert/strict';
import { TestAudioContext } from '${process.cwd()}/tests/support/audio-context.ts';
import { continuousSound, playSound, ramp, tone, updateThrusterSound as updateEngineSound } from '${process.cwd()}/src/client/audio/sound.ts';
import uiEffects from '${process.cwd()}/src/specs/sounds/ui.ts';
import engineSettings from '${process.cwd()}/src/specs/sounds/engine.ts';
import hornDrillSettings from '${process.cwd()}/src/specs/sounds/horn-drill.ts';
import { renderEffectBuffer, renderContinuousBuffer, resolveSoundEffect } from '${process.cwd()}/src/client/audio/synthesis.ts';
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
assert.equal(beep.buffer.getChannelData(0).length, 1455, 'one cached cycle of the chopped 30 Hz horn drill');
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

// Compact source specs and editor-resolved controls generate identical samples.
const compactTone = { volume: .1, attack: 10, decay: 100, frequency: 440 };
assert.deepEqual(resolveSoundEffect(compactTone), {
  ...compactTone, cutoff: 0, endFrequency: 440, highpass: 0,
  waveform: 'sine', pulseWidth: .5, delay: 0, hold: 0, sustain: .01, release: 0,
  attackCurve: 'linear', decayCurve: 'exponential', releaseCurve: 'exponential',
  pitchDuration: compactTone.attack + compactTone.decay, pitchCurve: 'linear',
  endCutoff: 0, filterDuration: compactTone.attack + compactTone.decay,
  filterCurve: 'linear', endHighpass: 0, resonance: 0, ring: 50,
  gainPoints: [], gainPositions: [], endResonance: 0,
}, 'all omitted properties resolve consistently, including dependent defaults');
assert.deepEqual(
  renderEffectBuffer({context, layers: [compactTone]}).getChannelData(0),
  renderEffectBuffer({context, layers: [resolveSoundEffect(compactTone)]}).getChannelData(0),
  'omitted tonal defaults match the fully resolved editor settings',
);
const compactNoise = { volume: .2, attack: 10, decay: 100, cutoff: 1000 };
const previousRandom = Math.random;
Math.random = () => .75;
const compactNoiseSamples = renderEffectBuffer({context, layers: [compactNoise]}).getChannelData(0);
const resolvedNoiseSamples = renderEffectBuffer({context, layers: [resolveSoundEffect(compactNoise)]}).getChannelData(0);
Math.random = previousRandom;
assert.deepEqual(compactNoiseSamples, resolvedNoiseSamples, 'noise requires no frequency properties');
assert(compactNoiseSamples.every(Number.isFinite) && compactNoiseSamples.some(sample => sample !== 0), 'compact noise stays audible and finite');

// Legacy defaults retain their exact envelope, filter order, and pitch clock.
const legacySamples = (effect) => {
  const {volume, frequency = 0, attack, decay, cutoff = 0, endFrequency = frequency, highpass = 0} = effect;
  const length = Math.floor(((attack + decay) / 1000) * 44100);
  const samples = new Float32Array(Math.max(1, length));
  let filtered = 0;
  let bass = 0;
  let phase = 0;
  for (let i = 0; i < length; i++) {
    phase += (frequency + ((endFrequency - frequency) * i) / length) / 44100;
    const wave = cutoff ? Math.random() * 2 - 1 : Math.sin(phase * Math.PI * 2);
    const elapsed = i / 44100;
    const envelope = i === 0 ? 0 : Math.min(attack ? elapsed / (attack / 1000) : 1, decay ? .01 ** ((elapsed - attack / 1000) / (decay / 1000)) : 1);
    filtered += (wave * envelope * volume - filtered) * (cutoff ? cutoff / (cutoff + 44100) : 1);
    bass += (filtered - bass) * Math.min(1, (2 * Math.PI * highpass) / 44100);
    samples[i] = filtered - bass;
  }
  return samples;
};
const render = (effect) => renderEffectBuffer({context, layers: [effect]}).getChannelData(0);
const stableRandom = Math.random;
Math.random = () => .75;
for (const effect of [
  {volume: .3, frequency: 680, attack: 13, decay: 91, endFrequency: 1280},
  {volume: .7, frequency: 93, attack: 11, decay: 217, endFrequency: 17, highpass: 26},
  {volume: .5, attack: 37, decay: 421, cutoff: 123},
  {volume: .3, frequency: 400, attack: 0, decay: 103},
  {volume: .3, frequency: 400, attack: 21, decay: 0},
  {volume: .3, frequency: 0, attack: 0, decay: 0},
]) {
  const original = legacySamples(effect);
  const current = render(effect);
  assert.equal(current.length, original.length);
  assert(current.every((sample, index) => Math.abs(sample - original[index]) <= 1e-6), 'existing effects preserve their original samples');
}
Math.random = stableRandom;

const waveforms = ['sine', 'triangle', 'square', 'pulse', 'sawtooth', 'noise', 'crackle'];
const curves = ['linear', 'exponential', 'ease-in', 'ease-out'];
const extended = {volume: .3, frequency: 440, attack: 2, decay: 2, hold: 20, sustain: .6, release: 2};
for (const waveform of waveforms) {
  const samples = render({...extended, waveform, pulseWidth: .2});
  assert(samples.every(Number.isFinite) && samples.some(sample => sample !== 0), 'every oscillator shape renders audible finite samples');
  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), 0, 'release ends in silence');
}
assert.deepEqual(render({...extended, waveform: 'square'}), render({...extended, waveform: 'pulse', pulseWidth: .5}), 'square is the 50 percent pulse shape');
assert.notDeepEqual(render({...extended, waveform: 'pulse', pulseWidth: .2}), render({...extended, waveform: 'pulse', pulseWidth: .8}), 'pulse width changes the wave shape');
for (const pulseWidth of [0, 1]) {
  assert(render({...extended, waveform: 'pulse', pulseWidth}).every(sample => Math.abs(sample) < 1e-6), 'extreme pulse widths stay finite and DC centered');
}
const pulse = render({volume: 1, waveform: 'pulse', pulseWidth: .2, frequency: 1000, attack: 0, decay: 0, hold: 100, sustain: 1});
assert(Math.abs(pulse.reduce((sum, sample) => sum + sample, 0) / pulse.length) < .005, 'asymmetric pulse has no sustained DC offset');

const delayedEffect = {...extended, waveform: 'triangle', endFrequency: 710};
const withoutDelay = render(delayedEffect);
const withDelay = render({...delayedEffect, delay: 10});
assert.equal(withDelay.length, withoutDelay.length + 441, 'delay is measured in milliseconds');
assert(withDelay.slice(0, 441).every(sample => sample === 0), 'delay inserts silence before the oscillator starts');
assert.deepEqual(withDelay.slice(441), withoutDelay, 'delayed oscillators start with the same phase and envelope');

const crackle = render({volume: 1, waveform: 'crackle', frequency: 2000, attack: 0, decay: 0, hold: 500, sustain: 1});
const impulses = crackle.filter(sample => sample !== 0).length;
assert(impulses > 800 && impulses < 1200, 'crackle frequency sets impulses per second');
const rung = {volume: 1, frequency: 1000, attack: 0, decay: 0, hold: 50, sustain: 1};
const energy = (samples) => samples.reduce((sum, sample) => sum + sample * sample, 0);
assert.equal(render({...rung, resonance: 1000, ring: 40}).length, render(rung).length + 1764, 'ring extends the layer so the resonance can decay');
assert(energy(render({...rung, resonance: 1000})) > 10 * energy(render({...rung, resonance: 3000})), 'resonance emphasizes nearby frequencies');
const ringTail = (ring) => { const samples = render({...rung, resonance: 1000, ring}); return energy(samples.slice(2205, 2205 + 441)) / energy(samples.slice(0, 2205)); };
assert(ringTail(80) > 2 * ringTail(20), 'longer rings sustain after the input stops');
assert(render({...rung, resonance: 1000, ring: 1}).every(Number.isFinite), 'short rings stay finite');

const stages = {volume: 1, waveform: 'triangle', frequency: 0, attack: 10, decay: 10, hold: 10, sustain: .4, release: 10, decayCurve: 'linear', releaseCurve: 'linear'};
const envelopeSamples = render(stages);
assert.equal(envelopeSamples[441], 1, 'attack reaches full volume before decay');
assert(Math.abs(envelopeSamples[882] - .4) < 1e-6, 'decay reaches the sustain level');
assert(Math.abs(envelopeSamples[1102] - .4) < 1e-6, 'hold keeps the sustain level');
assert(envelopeSamples[1543] < .21 && envelopeSamples[1543] > .19, 'release fades from sustain toward silence');
assert.equal(envelopeSamples.at(-1), 0);
const attackMidpoints = new Map();
for (const curve of curves) {
  const attack = render({...stages, attack: 20, decay: 0, hold: 20, sustain: 1, release: 0, attackCurve: curve});
  attackMidpoints.set(curve, attack[441]);
  assert.equal(attack[882], 1, 'every attack curve reaches its endpoint');
  for (const sustain of [0, .3, 1]) {
    const samples = render({...stages, sustain, attackCurve: curve, decayCurve: curve, releaseCurve: curve});
    assert(samples.every(sample => Number.isFinite(sample) && sample >= 0 && sample <= 1), 'all envelope curves support zero and nonzero endpoints');
    assert.equal(samples.at(-1), 0);
  }
  const zero = render({volume: 1, frequency: 0, attack: 0, decay: 0, hold: 0, release: 0, attackCurve: curve, decayCurve: curve, releaseCurve: curve, pitchDuration: 0, pitchCurve: curve, filterDuration: 0, filterCurve: curve});
  assert.equal(zero.length, 1);
  assert(zero.every(sample => sample === 0), 'all-zero durations render a finite silent buffer');
}
assert.equal(attackMidpoints.get('linear'), .5);
assert.equal(attackMidpoints.get('ease-in'), .25);
assert.equal(attackMidpoints.get('ease-out'), .75);
assert(attackMidpoints.get('exponential') < .1, 'exponential attack has a distinct gradual onset');

const sweep = {volume: .3, waveform: 'sine', frequency: 100, endFrequency: 1000, attack: 0, decay: 0, hold: 60, sustain: 1};
assert.deepEqual(render({...sweep, pitchDuration: 0}), render({...sweep, frequency: 1000}), 'zero pitch duration immediately selects the endpoint');
const crossings = (samples, start, end) => samples.slice(start + 1, end).filter((sample, index) => sample > 0 && samples[start + index] <= 0).length;
for (const pitchCurve of curves) {
  const samples = render({...sweep, pitchDuration: 10, pitchCurve});
  const count = crossings(samples, 882, 1764);
  assert(count >= 19 && count <= 21, 'pitch stays at the endpoint after its independent sweep duration');
  assert(render({...sweep, frequency: 0, endFrequency: 0, pitchDuration: 0, pitchCurve}).every(sample => sample === 0), 'pitch curves handle zero endpoints without NaN');
}
assert.notDeepEqual(render({...sweep, pitchCurve: 'linear'}), render({...sweep, pitchCurve: 'exponential'}), 'pitch curves change the sweep independently of the envelope');

const filteredEffect = {...sweep, frequency: 4000, endFrequency: 4000};
const bypass = render(filteredEffect);
const rms = (samples) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
for (const filterCurve of curves) {
  const closed = render({...filteredEffect, cutoff: 0, endCutoff: 70, filterDuration: 10, filterCurve});
  assert(rms(closed.slice(882, 1764)) < rms(bypass.slice(882, 1764)) / 10, 'explicit tonal oscillators support low-pass filter sweeps');
  const open = render({...filteredEffect, cutoff: 70, endCutoff: 0, filterDuration: 10, filterCurve});
  assert.deepEqual(open.slice(882), bypass.slice(882), 'zero low-pass endpoint opens the filter fully');
  const highOpen = render({...filteredEffect, highpass: 2000, endHighpass: 0, filterDuration: 10, filterCurve});
  assert.deepEqual(highOpen.slice(882), bypass.slice(882), 'zero high-pass endpoint bypasses without retaining DC state');
  assert(closed.every(Number.isFinite) && open.every(Number.isFinite) && highOpen.every(Number.isFinite), 'filter curves stay finite through zero endpoints');
  const instant = render({...filteredEffect, cutoff: 70, endCutoff: 0, highpass: 2000, endHighpass: 0, filterDuration: 0, filterCurve});
  assert.deepEqual(instant, bypass, 'zero filter duration selects final cutoff values immediately');
}
const noiseWithoutFilter = render({...extended, waveform: 'noise', cutoff: 0});
assert(noiseWithoutFilter.every(Number.isFinite) && noiseWithoutFilter.some(sample => sample !== 0), 'noise can be selected with its low-pass filter disabled');
const fractionalDuration = {...extended, waveform: 'sine', attack: 20, decay: 200, hold: 60, release: 80, endFrequency: 1380, cutoff: 70, endCutoff: 0, highpass: 50, endHighpass: 0};
const fullDuration = fractionalDuration.attack + fractionalDuration.decay + fractionalDuration.hold + fractionalDuration.release;
assert.deepEqual(render({...fractionalDuration, pitchDuration: fullDuration + 5e-10, filterDuration: fullDuration - 5e-10}), render(fractionalDuration), 'near-equal dependent sweep durations retain identical sample clocks');

// Layers start together, retain independent durations, and use the same mix in gameplay.
const shortLayer = { volume: .3, frequency: 300, attack: 10, decay: 30, cutoff: 0, endFrequency: 600, highpass: 0 };
const longLayer = { volume: .2, frequency: 900, attack: 20, decay: 80, cutoff: 0, endFrequency: 500, highpass: 0 };
const shortSamples = renderEffectBuffer({context, layers: [shortLayer]}).getChannelData(0);
const longSamples = renderEffectBuffer({context, layers: [longLayer]}).getChannelData(0);
const mixedSamples = renderEffectBuffer({context, layers: [shortLayer, longLayer]}).getChannelData(0);
assert.equal(mixedSamples.length, longSamples.length, 'mix lasts until the longest layer ends');
for (let i = 0; i < mixedSamples.length; i++) {
  assert(Math.abs(mixedSamples[i] - ((shortSamples[i] || 0) + longSamples[i])) < 1e-7, 'every layer begins at the same sample');
}
const originalUiLayers = [...uiEffects];
uiEffects.splice(0, uiEffects.length, shortLayer, longLayer);
context.currentTime += 1;
const beforeLayers = context.sources.length;
playSound(8, { volume: .25 });
assert.equal(context.sources.length, beforeLayers + 1, 'layered event uses one reusable premixed voice');
assert.deepEqual(lastVoice().assignedSamples, mixedSamples, 'gameplay uses the editor synthesis and all event layers');
assert.equal(lastVoice().destination.gain.value, .25, 'distance scales the entire layered event');
uiEffects.splice(0, uiEffects.length, ...originalUiLayers);
const silentSamples = renderEffectBuffer({context, layers: []}).getChannelData(0);
assert(silentSamples.length && silentSamples.every(sample => sample === 0), 'empty layer list renders a finite silent buffer');
for (const timing of [{ attack: 0, decay: 100 }, { attack: 100, decay: 0 }, { attack: 0, decay: 0 }]) {
  const samples = renderEffectBuffer({context, layers: [{ ...shortLayer, ...timing, highpass: 22050 }]}).getChannelData(0);
  assert(samples.every(Number.isFinite), 'zero envelope times and the largest high-pass cutoff stay finite');
}
const beforeInvalid = context.sources.length;
playSound(-1);
playSound(1000);
assert.equal(context.sources.length, beforeInvalid, 'unknown event IDs do not create voices');
for (const kind of ['engine', 'hornDrill']) {
  const settings = kind === 'engine' ? engineSettings : hornDrillSettings;
  const changed = { ...settings, duration: 10, frequency: 100 };
  const samples = renderContinuousBuffer({context, kind, settings: changed}).getChannelData(0);
  assert.equal(samples.length, 441, 'continuous duration controls its generated buffer');
  assert(samples.every(Number.isFinite) && samples.some(sample => sample !== 0), 'edited continuous sounds remain audible and finite');
}

// Playback tuning comes from the saved data, including envelope timing.
const originalEngine = { ...engineSettings };
Object.assign(engineSettings, { volume: .25, basePitch: 1.1, revRange: .7, idleVolume: .4, ramp: 500 });
const editedTone = tone(1);
assert.equal(editedTone.playbackRate.value, 1.1, 'engine starts at the configured pitch before its first ramp');
editedTone.stop();
updateThrusterSound(1, .5);
const editedEngine = lastVoice();
assert(Math.abs(editedEngine.gain.value - .1875) < 1e-8, 'engine applies edited volume and idle gain');
assert(Math.abs(editedEngine.playbackRate.value - 1.45) < 1e-8, 'engine applies edited base pitch and rev range');
assert.equal(editedEngine.gain.events[0][3], .1, 'engine uses its edited fade duration');
updateThrusterSound(0);
Object.assign(engineSettings, originalEngine);
const originalDrill = { ...hornDrillSettings };
Object.assign(hornDrillSettings, { basePitch: .6, activeVolume: .7, bitingVolume: 1.1, activePitch: 1.3, bitingPitch: .8, ramp: 250 });
const editedDrillTone = tone();
assert.equal(editedDrillTone.playbackRate.value, .6, 'drill starts at its edited base pitch');
editedDrillTone.stop();
updateHornDrillSounds({crafts: [remoteCraft]});
const editedDrill = lastVoice();
assert.equal(editedDrill.gain.value, .7, 'active drill uses its edited gain');
assert.equal(editedDrill.playbackRate.value, 1.3, 'active drill uses its edited pitch');
assert.equal(editedDrill.gain.events[0][3], .05, 'drill uses its edited fade duration');
remoteSegment.biting = true;
updateHornDrillSounds({crafts: [remoteCraft]});
assert.equal(lastVoice(), editedDrill, 'edited biting parameters retain the active voice');
assert.equal(editedDrill.gain.value, 1.1, 'biting drill uses its edited gain');
assert.equal(editedDrill.playbackRate.value, .8, 'biting drill uses its edited pitch');
updateHornDrillSounds({crafts: []});
Object.assign(hornDrillSettings, originalDrill);

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
      ...(production ? [testBuildPlugin()] : []),
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

// Exercise the real loader with audio and tuning emitted as separate chunks.
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
import { preloadSound, playNavigationSound, playSound, updateThrusterSound } from './client/audio/sound-loader';
import uiNavUp from './specs/sounds/ui-nav-up';
import uiNavDown from './specs/sounds/ui-nav-down';
import uiNavNeutral from './specs/sounds/ui-nav-neutral';
import uiNavSelect from './specs/sounds/ui-nav-select';
import uiNavUnselect from './specs/sounds/ui-nav-unselect';
import acquireTarget from './specs/sounds/acquire-target';
import chosen0 from './specs/sounds/lose-target';
import chosen1 from './specs/sounds/wormhole-in';
import chosen2 from './specs/sounds/wormhole-out';
import chosen3 from './specs/sounds/jump-gate-open';
import chosen4 from './specs/sounds/main-menu-close';
import chosen5 from './specs/sounds/main-menu-open';
import chosen6 from './specs/sounds/chat-message';
import chosen7 from './specs/sounds/autogun-fire';
import chosen8 from './specs/sounds/autogun-ammo-explode';
import { renderEffectBuffer } from './client/audio/synthesis';
import engineSettings from './specs/sounds/engine';
import hornDrillSettings from './specs/sounds/horn-drill';
export async function check() {
  assert.equal(TestAudioContext.instances.length, 0);
  const previousRandom = Math.random;
  Math.random = () => .75;
  try {
    playNavigationSound(-1);
    assert.equal(TestAudioContext.instances.length, 1, 'first menu move opens audio before the chunk loads');
    await preloadSound();
    await Promise.resolve();
    const context = TestAudioContext.instances[0];
    playNavigationSound(1);
    playNavigationSound(0);
    playNavigationSound(0);
    const navigation = context.sources.splice(0);
    assert.equal(navigation.length, 4, 'each menu move plays a cue, including rapid repeats');
    for (const [index, layers] of [uiNavUp, uiNavDown, uiNavNeutral].entries()) {
      assert.deepEqual(navigation[index].assignedSamples, renderEffectBuffer({context, layers}).getChannelData(0));
    }
    assert.equal(navigation[2].buffer, navigation[3].buffer, 'repeat moves reuse the navigation buffer');
    playNavigationSound('select');
    playNavigationSound('unselect');
    playNavigationSound('unselect');
    const selections = context.sources.splice(0);
    assert.equal(selections.length, 3, 'select and unselect play through the real loader, including rapid repeats');
    for (const [index, layers] of [uiNavSelect, uiNavUnselect].entries()) {
      assert.deepEqual(selections[index].assignedSamples, renderEffectBuffer({context, layers}).getChannelData(0));
    }
    assert.equal(selections[1].buffer, selections[2].buffer, 'repeated unselects reuse the navigation buffer');
    for (const [name, layers] of [['lose-target', chosen0], ['wormhole-in', chosen1], ['wormhole-out', chosen2], ['jump-gate-open', chosen3], ['main-menu-close', chosen4], ['main-menu-open', chosen5], ['chat-message', chosen6], ['autogun-fire', chosen7], ['autogun-ammo-explode', chosen8]]) {
      playSound(name);
      assert.deepEqual(context.sources.pop().assignedSamples, renderEffectBuffer({context, layers}).getChannelData(0), name);
    }
  } finally {
    Math.random = previousRandom;
  }
  const context = TestAudioContext.instances[0];
  context.state = 'suspended';
  let finishResume;
  context.resume = () => new Promise((resolve) => { finishResume = resolve; });
  playNavigationSound(0);
  assert.equal(context.sources.pop()?.starts, 1, 'a menu move queues audio before resume settles');
  context.state = 'running';
  finishResume();
  playSound(0, { volume: .25 });
  assert.equal(context.sources[0].destination.gain.value, .25);
  context.currentTime += 1;
  playSound(0);
  assert.equal(context.sources[1].destination.gain.value, 1);
  assert.equal(context.sources[0].buffer, context.sources[1].buffer);
  engineSettings.volume = .25;
  const engine = updateThrusterSound(undefined, { power: 1, load: 1, volume: .5 });
  assert(Math.abs(engine.gain.value - .18) < 1e-8, 'loader audio shares tuning with the separate data chunk');
  assert(Math.abs(engine.playbackRate.value - 1.9) < 1e-8);
  updateThrusterSound(engine, { power: 0 });
  assert.equal(engine.stops, 1);
  assert.equal(hornDrillSettings.activePitch, .95);
  const originalRandom = Math.random;
  Math.random = () => .75;
  try {
    context.currentTime += 1;
    const count = context.sources.length;
    playSound('acquire-target', {id: 42});
    const acquired = context.sources.at(-1);
    assert.equal(context.sources.length, count + 1, 'named targeting cue plays through the real lazy loader');
    assert.deepEqual(acquired.assignedSamples, renderEffectBuffer({context, layers: acquireTarget}).getChannelData(0), 'targeting plays the selected procedural spec');
    playSound('acquire-target', {id: 43});
    assert.equal(context.sources.length, count + 2, 'rapid acquisition of a different target is audible');
    assert.equal(context.sources.at(-1).buffer, acquired.buffer, 'target acquisitions reuse the cached mix');
    context.state = 'suspended';
    playSound('acquire-target', {id: 44});
    assert.equal(context.sources.length, count + 2, 'target acquisition respects suspended audio');
    context.state = 'running';
  } finally {
    Math.random = originalRandom;
  }
}`.replace(/assert\.(\w+)/g, (_, method) => `Reflect.get(assert, '${method}')`);
        }
      },
    },
    buildPrePlugin(),
    testBuildPlugin(),
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

  assert.equal(output.filter((item) => item.type === 'chunk').length, 3);
  const { check } = await import(
    pathToFileURL(join(directory, 'entry.mjs')).href
  );

  await check();
  console.log(
    'Sound volume and shared tuning passed through separately emitted production chunks.',
  );
} finally {
  await loaderBundle.close();
  await rm(directory, { recursive: true, force: true });
}
