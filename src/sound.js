// The drill uses a cached loop; the engine mixes a motor with filtered air.
// Parameter ramps avoid abrupt waveform jumps when either changes level.
let audio = 0;
const loopBuffers = [];
let motorWave;

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
const rampTime = 0.5;

/**
 * Slide an AudioParam to a value from wherever it is now - jumping straight
 * there clicks, and so does stopping a sound mid-wave. The ramp is anchored a
 * little ahead of the clock; changing the target keeps the in-flight curve
 * continuous, which matters when thrust is tapped rapidly.
 *
 * @returns {number} The audio-clock time the fade is effectively complete.
 */
export const ramp = (param, value, duration = rampTime) => {
  const time = audio.currentTime + 0.01;

  param.setTargetAtTime(value, time, duration / 5);

  return time + duration;
};

/**
 * Start a sound, silent: the caller ramps `gain` up to the level it wants, and
 * can go on ramping it for as long as the sound plays.
 *
 * The drill buffer contains one chopped 30 Hz cycle. The engine restores its
 * separate exhaust motor and air bed, both softened by a shared low-pass filter.
 */
export const tone = (engine) => {
  unlockAudio();

  const oscillator = audio.createBufferSource();
  const gain = audio.createGain();

  let pressure = 0;

  // Both loops are completely filled before Firefox receives their buffers.
  oscillator.buffer = loopBuffers[engine ? 1 : 0] ||= soundBuffer(engine ? 44100 : 1470, (i) => {
    if (engine) {
      pressure = pressure * 0.96 + Math.random() * 0.06 - 0.03;
      return pressure;
    }

    const phase = i / 1470;
    const wave = 1 - 4 * Math.abs(Math.round(phase) - phase);

    return wave * 0.3;
  });

  oscillator.loop = true;

  if (engine) {
    const filter = audio.createBiquadFilter();
    const motor = audio.createOscillator();
    const depth = audio.createGain();

    motorWave ||= audio.createPeriodicWave(
      [0, 5, 2, 1],
      [0, 0, 0, 0],
    );
    motor.setPeriodicWave(motorWave);
    motor.frequency.value = 14;
    depth.gain.value = 0.2;
    filter.frequency.value = 200;
    motor.connect(depth);
    depth.connect(filter);
    oscillator.connect(filter);
    filter.connect(gain);
    oscillator.motor = motor;
    oscillator.frequency = filter.frequency;
    motor.start();
  } else {
    const filter = audio.createBiquadFilter();

    filter.frequency.value = 1000;
    oscillator.playbackRate.value = 0.5;
    oscillator.connect(filter);
    filter.connect(gain);
  }

  gain.connect(audio.destination);

  oscillator.gain = gain.gain;
  oscillator.gain.value = 0;
  oscillator.start();

  return oscillator;
};

// @ifdef DEBUG
// An audible beep, for telling "Web Audio doesn't work at all here" apart from
// "the game's sounds specifically are wrong".
export const testTone = () => {
  const sound = tone();

  sound.playbackRate.value = 440 / 30;

  ramp(sound.gain, 0.5);
  setTimeout(() => sound.stop(ramp(sound.gain, 0)), 1000);
};
// @endif

// Finish writing every sample before a source receives the buffer (Firefox).
const soundBuffer = (length, sample) => {
  const buffer = audio.createBuffer(1, length, 44100);

  buffer.getChannelData(0).forEach((_, i, samples) => samples[i] = sample(i));
  return buffer;
};

// Volume, frequency, attack, decay, optional noise cutoff, end frequency, cooldown.
// Tonal effects are sine waves; a cutoff selects filtered noise instead.
export const soundEffects = {
  hatchOpen: [0.7, 0, 0.03, 0.25, 160],
  hatchClose: [0.9, 0, 0.025, 0.35, 140],
  pickup: [0.08, 660, 0.001, 0.08, 0, 1320],
  crash: [4, 0, 0.05, 0.5, 70, 0, 0.6],
  shieldBounce: [0.08, 190, 0.01, 0.3, 0, 190, 0.18],
  shieldOn: [0.08, 120, 0.02, 0.3, 0, 480],
  shieldOff: [0.08, 480, 0.02, 0.3, 0, 120],
  ui: [0.03, 800, 0.005, 0.04],
  light: [0.1, 0, 0.001, 0.12, 3000],
};

export const playSound = (effect) => {
  // A real key gesture unlocks audio. Drop effects before that first gesture.
  if (!effect || !audio || audio.state !== 'running') return;
  const time = audio.currentTime;

  if (time < (effect.nextPlay || 0)) return;
  effect.nextPlay = time + (effect[6] || 0.06);

  // Render each complete effect once. Rapid playback then reuses one buffer.
  if (!effect.buffer) {
    const [volume, frequency, attack, decay, cutoff, endFrequency = frequency] = effect;
    const sampleRate = 44100;
    const length = (attack + decay) * sampleRate | 0;

    let filtered = 0;
    let t = 0;

    effect.buffer = soundBuffer(length, (i) => {
      t += (frequency + (endFrequency - frequency) * i / length) / sampleRate;
      const wave = cutoff ? Math.random() * 2 - 1 : Math.sin(t * Math.PI * 2);
      const elapsed = i / sampleRate;
      const envelope = Math.min(elapsed / attack, 0.01 ** ((elapsed - attack) / decay));
      const sample = wave * envelope * volume;

      return filtered += (sample - filtered) * (cutoff ? cutoff / (cutoff + sampleRate) : 1);
    });
  }

  const source = audio.createBufferSource();

  source.buffer = effect.buffer;
  source.connect(audio.destination);
  source.start();
};

// A zero playbackRate selects the drill; positive rates select the engine.
// Both motors keep their voice while held. Engine pitch follows motion/load; gain
// follows thrust, so changes in speed do not keep restarting the volume attack.
export const continuousSound = (sound, level, playbackRate = 0) => {
  if (!sound && !level) return sound;
  sound ||= tone(playbackRate);

  const duration = 0.3;

  if (playbackRate && sound.targetRate !== playbackRate) {
    ramp(sound.motor.frequency, playbackRate * 14, duration);
    ramp(sound.frequency, playbackRate * 360 - 160, duration);
    sound.targetRate = playbackRate;
  } else if (!playbackRate && sound.targetRate !== !!level) {
    ramp(sound.playbackRate, level ? 0.5 : 0.4);
    sound.targetRate = !!level;
  }

  if (level === sound.level) return sound;

  if (!level) {
    const time = ramp(sound.gain, 0, playbackRate ? duration : rampTime);

    if (playbackRate) {
      sound.level = 0;
      return sound;
    }

    sound.stop(time);
    return 0;
  }

  ramp(sound.gain, level, playbackRate ? duration : rampTime);
  sound.level = level;
  return sound;
};

let thrusterSound;

// One engine voice for the whole ship, independent of its nozzle count.
export const updateThrusterSound = (power, load = 0) => {
  if (!audio || audio.state !== 'running') return;
  // Translation and steering share one rev range; combining them cannot over-rev.
  const revs = Math.max(0, Math.min(1, load));

  thrusterSound = continuousSound(thrusterSound, power > 0 ? 0.09 + power * 0.06 : 0, 1 + revs * 4 / 3);
};
