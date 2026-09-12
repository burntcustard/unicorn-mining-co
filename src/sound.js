/**
 * Continuous motor sounds use Web Audio oscillators.
 * A running oscillator has no loop point, so there is no seam to click at, and
 * anything about a playing sound is changed by ramping one of its params.
 * A looped buffer sounded fine loud but crackly quiet: its seam is broadband
 * while its fundamental is low enough that quietening it takes the tone below
 * audibility long before it takes the clicks with it.
 */
let audio = 0;

// Must run synchronously inside a real user gesture (keydown/click) to count
// as one for autoplay purposes - a rAF-driven call a frame later is too late
// for some browsers (Firefox in particular), which then leave the context
// suspended forever with no error, so start() silently does nothing.
export const unlockAudio = () => {
  audio ||= new AudioContext();
  audio.resume();
};

// Long enough that a change never clicks, short enough that the drill biting
// into rock is heard as it happens rather than swelling in afterwards
const rampTime = 0.1;

/**
 * Slide an AudioParam to a value from wherever it is now - jumping straight
 * there clicks, and so does stopping a sound mid-wave. The ramp is anchored a
 * little ahead of the clock because the audio thread has already rendered
 * past it, and an event landing in that gap is skipped rather than played,
 * which pops the front off a fade in.
 *
 * @returns {number} The audio-clock time the ramp lands on that value.
 */
export const ramp = (param, value, duration = rampTime, leadTime = rampTime) => {
  const time = audio.currentTime + leadTime;

  param.cancelScheduledValues(time);
  param.setValueAtTime(param.value, time);
  param.linearRampToValueAtTime(value, time + duration);

  return time + duration;
};

/**
 * Start a sound, silent: the caller ramps `gain` up to the level it wants, and
 * can go on ramping it for as long as the sound plays.
 *
 * The tone is chopped in and out of silence at its own pitch by a second
 * oscillator, which is what makes it purr like a running motor rather than
 * hum like a held note - every chop then contains the same stretch of
 * waveform, so it repeats steadily instead of drifting in and out of phase.
 */
export const tone = (frequency, type) => {
  unlockAudio();

  const oscillator = audio.createOscillator();
  const pulse = audio.createOscillator();
  const depth = audio.createGain();
  const chop = audio.createGain();
  const gain = audio.createGain();

  oscillator.type = pulse.type = type;
  oscillator.frequency.value = pulse.frequency.value = frequency;
  // An oscillator always swings a full -1 to 1, so its reach is set on the way
  depth.gain.value = chop.gain.value = 0.5;

  pulse.connect(depth);
  depth.connect(chop.gain);
  oscillator.connect(chop);
  chop.connect(gain);
  gain.connect(audio.destination);

  oscillator.pulseFrequency = pulse.frequency;
  oscillator.gain = gain.gain;
  oscillator.gain.value = 0;
  oscillator.start();
  pulse.start();

  const stop = oscillator.stop.bind(oscillator);

  // Use the audio clock so the native stops stay on the end of the fade out.
  oscillator.stop = (leadTime = rampTime) => {
    const time = ramp(oscillator.gain, 0, rampTime, leadTime);

    pulse.stop(time);
    stop(time);
  };

  return oscillator;
};

// @ifdef DEBUG
// An audible beep, for telling "Web Audio doesn't work at all here" apart from
// "the game's sounds specifically are wrong".
export const testTone = () => {
  const sound = tone(440, 'sine');

  ramp(sound.gain, 0.5);
  setTimeout(() => sound.stop(), 1000);
};
// @endif

// One reusable noise bed supplies filtered air, grit and mechanical transients.
let noiseBuffer;

const noiseSource = (context = audio) => {
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const samples = noiseBuffer.getChannelData(0);

    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();

  source.buffer = noiseBuffer;
  source.loop = true;
  return source;
};

// ZzFXMicro-style: volume, randomness, frequency, attack, sustain, release,
// shape, shape curve, slide, delta slide. The adapter's cutoff follows those.
// [volume] [randomness] [frequency] [attack] [sustain] [release] [shape]
// [shape curve] [slide] [delta slide] [filter cutoff]
export const soundEffects = {
  hatchOpen: [0.7, 0, 0, 0.03, 0, 0.25, 4, 0.5, 160],
  hatchClose: [0.9, 0, 0, 0.025, 0, 0.35, 4, 0.5, 140],
  pickup: [0.3, 0, 250, 0.001, 0.02, 0.08, 0, 1, 1900],
  crash: [1, 0, 0, 0.05, 0, 0.5, 4, 0.5, 70],
  shieldBounce: [0.08, 0, 190, 0.01, 0.08, 0.19, 1, 1],
  shieldOn: [0.06, 0, 65, 0.01, 0.1, 0.3, 1, 1],
  shieldOff: [0.06, 0, 240, 0.01, 0.1, 0.24, 1, 1],
  ui: [0.03, 0, 800, 0.005, 0.01, 0.025, 0, 1],
  light: [0.1, 0, 0, 0.001, 0, 0.12, 4, 0.5, 3000],
  // Accidentally found a really nice drum sound lol
  // drum: [90, 135, .16, .29, 0, 1500, .006, 420, 8, .022],
};

export const playSound = (effect) => {
  // A real key gesture unlocks audio. Drop effects before that first gesture.
  if (!effect || !audio || audio.state !== 'running' || audio.currentTime < (effect.nextPlay || 0)) return;
  effect.nextPlay = audio.currentTime + (effect === soundEffects.crash ? 0.6 : effect === soundEffects.shieldBounce ? 0.18 : 0.06);

  // Render each complete effect once. Rapid playback then reuses one buffer.
  if (!effect.buffer) {
    const [volume, randomness, frequency, attack, sustain, release, shape, curve] = effect;
    const modern = effect.length > 10;
    const slide = modern ? effect[8] : 0;
    const cutoff = modern ? effect[10] : effect[8];
    const endFrequency = modern ? frequency * (1 + slide) : effect[9] ?? frequency;
    const endCutoff = cutoff / 3;
    const sampleRate = audio.sampleRate;
    const attackSamples = attack * sampleRate;
    const sustainSamples = sustain * sampleRate;
    const releaseSamples = release * sampleRate;
    const length = attackSamples + sustainSamples + releaseSamples | 0;
    const buffer = audio.createBuffer(1, length, sampleRate);
    const samples = buffer.getChannelData(0);
    const phase = (frequency * (1 + randomness * (2 * Math.random() - 1))) * Math.PI * 2 / sampleRate;

    let filtered = 0;

    for (let i = 0, t = 0; i < length; i++) {
      const frequencyAt = frequency + (endFrequency - frequency) * i / length;
      t += phase * frequencyAt / frequency || phase;
      const wave = shape > 3 ? Math.random() * 2 - 1 : shape > 2 ? (t / Math.PI / 2 % 1 < curve / 2) * 2 - 1 : shape > 1 ? 1 - (2 * t / Math.PI / 2 % 2 + 2) % 2 : shape ? 1 - 4 * Math.abs(Math.round(t / Math.PI / 2) - t / Math.PI / 2) : Math.sin(t);
      const envelope = i < attackSamples ? i / attackSamples : cutoff ? 0.01 ** ((i - attackSamples) / (length - attackSamples)) : i < attackSamples + sustainSamples ? 1 : (length - i) / releaseSamples;
      let sample = wave * envelope * volume;

      if (cutoff) {
        const frequency = cutoff * (endCutoff / cutoff) ** (i / length);
        filtered += (sample - filtered) * frequency / (frequency + sampleRate);
        sample = filtered;
      }

      samples[i] = sample;
    }

    effect.buffer = buffer;
  }

  const source = audio.createBufferSource();

  source.buffer = effect.buffer;
  source.connect(audio.destination);
  source.start();
};

let thrusterSound;
let thrusterAir;
let thrusterGain;
let thrusterFilter;
let thrusterLevel = 0;

// One engine mix for the whole player ship, so extra nozzles do not add volume.
// Reuse the motor and noise: low mechanical throbbing under a resonant howl.
// Audio-clock ramps spool both pitches and levels without restarting each tick.
export const updateThrusterSound = (power) => {
  if (!audio || audio.state !== 'running') return;
  const level = power > 0 ? 0.03 + power * 0.03 : 0;

  if (level === thrusterLevel) return;

  if (level && !thrusterSound) {
    thrusterSound = tone(32, 'triangle');
    thrusterAir = noiseSource();
    thrusterFilter = audio.createBiquadFilter();
    thrusterGain = audio.createGain();
    thrusterFilter.frequency.value = 180;
    thrusterFilter.Q.value = 2;
    thrusterGain.gain.value = 0;
    thrusterAir.connect(thrusterFilter);
    thrusterFilter.connect(thrusterGain);
    thrusterGain.connect(audio.destination);
    thrusterAir.start();
  }

  const duration = !level ? rampTime : level > thrusterLevel ? 0.5 : 0.3;
  const pitch = 32 + power * 16;

  // Keep the motor's chopping oscillator at the same pitch as its carrier.
  ramp(thrusterSound.frequency, pitch, duration, 0.01);
  ramp(thrusterSound.pulseFrequency, pitch, duration, 0.01);
  ramp(thrusterFilter.frequency, 180 + power * 420, duration, 0.01);
  // Thrust is audible immediately; only the pitch and resonance spool slowly.
  if (level) ramp(thrusterSound.gain, level, 0.04, 0.01);
  ramp(thrusterGain.gain, level * 0.7, 0.04, 0.01);
  thrusterLevel = level;

  if (!level) {
    const air = thrusterAir;
    const filter = thrusterFilter;
    const gain = thrusterGain;

    thrusterSound.stop(0.01);
    air.stop(audio.currentTime + rampTime * 2);

    air.onended = () => {
      air.disconnect();
      filter.disconnect();
      gain.disconnect();
    };

    thrusterSound = 0;
  }
};
