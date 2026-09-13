// The drill and engine use looped audio buffers with smooth parameter ramps.
let audio = 0;
const loopBuffers = [];

// Must run synchronously inside a real user gesture (keydown/click) to count
// as one for autoplay purposes - a rAF-driven call a frame later is too late
// for some browsers (Firefox in particular), which then leave the context
// suspended forever with no error, so start() silently does nothing.
export const unlockAudio = () => {
  audio ||= new AudioContext();
  audio.resume();
};

/**
 * Slide an AudioParam smoothly to a target value using setTargetAtTime.
 *
 * @returns {number} The audio-clock time the fade is effectively complete.
 */
export const ramp = (param, value, duration = 1) => {
  const time = audio.currentTime + 0.01;

  param.setTargetAtTime(value, time, duration / 5);

  return time + duration;
};

/**
 * Start a looped sound, silent: the caller ramps `gain` and `playbackRate`
 * to the levels it wants.
 */
export const tone = (engine) => {
  unlockAudio();

  const source = audio.createBufferSource();
  const gain = audio.createGain();

  let air = 0;
  let filtered = 0;

  const length = engine ? 44100 : 1470;

  source.buffer = loopBuffers[engine ? 1 : 0] ||= soundBuffer(length, (i) => {
    const phase = i / length;

    if (engine) {
      air += (Math.random() * 2 - 1 - air) * 0.02;
      filtered += (air - filtered) * 0.02;
      const p = phase * Math.PI * 44;
      const stroke = Math.sin(p) * 0.5 + Math.sin(p * 2) * 0.3 + Math.sin(p * 3) * 0.2;
      return stroke * 0.4 + filtered * (0.6 + 0.4 * Math.sin(p));
    }

    const t = phase * 35 / 30;
    const wave = 1 - 4 * Math.abs(Math.round(t) - t);
    const env = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return wave * env * 0.3;
  });

  source.loop = true;
  source.connect(gain);
  gain.connect(audio.destination);

  source.gain = gain.gain;
  source.gain.value = 0;
  source.playbackRate.value = engine ? 0.7 : 0.4;
  source.start();

  return source;
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

// Volume, frequency, attack, decay, optional noise cutoff, end frequency.
// Tonal effects are sine waves; a cutoff selects filtered noise instead.
export const soundEffects = {
  hatchOpen: [0.7, 0, 0.03, 0.25, 160],
  hatchClose: [0.9, 0, 0.025, 0.35, 140],
  pickup: [0.1, 660, 0.001, 0.08, 0, 1320],
  crash: [3, 0, 0.05, 0.5, 70],
  shieldBounce: [0.08, 190, 0.01, 0.3, 0, 190],
  shieldOn: [0.1, 120, 0.02, 0.3, 0, 480],
  shieldOff: [0.03, 480, 0.02, 0.5, 0, 120],
  ui: [0.03, 800, 0.005, 0.04],
  light: [0.1, 0, 0.001, 0.12, 3000],
};

export const playSound = (effect) => {
  // A real key gesture unlocks audio. Drop effects before that first gesture.
  if (!effect || !audio || audio.state !== 'running') return;
  const time = audio.currentTime;

  if (time < (effect.nextPlay || 0)) return;
  effect.nextPlay = time + 0.1;

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

export const continuousSound = (sound, level, playbackRate = level ? (level > 0.5 ? 0.9 : 0.95) : 0.4, engine = 0) => {
  if (!sound && !level) return sound;
  sound ||= tone(engine);

  const duration = engine ? 1.2 : 1;

  if (sound.targetRate !== playbackRate) {
    ramp(sound.playbackRate, playbackRate, duration);
    sound.targetRate = playbackRate;
  }

  if (level === sound.level) return sound;

  const time = ramp(sound.gain, level, duration);
  sound.level = level;

  if (!level) {
    sound.stop(time);
    return 0;
  }

  return sound;
};

let thrusterSound;

// One engine voice for the whole ship, independent of its nozzle count.
export const updateThrusterSound = (power, load = 0) => {
  if (!audio || audio.state !== 'running') return;
  const revs = Math.max(0, Math.min(1, load));

  thrusterSound = continuousSound(
    thrusterSound,
    power * (0.2 + revs) * 0.12,
    0.7 + revs * 1.2,
    1,
  );
};
