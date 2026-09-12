// Drill tones use continuous oscillators; the thruster mixes turbulent air and a motor undertone.
// Parameter ramps avoid abrupt waveform jumps when either changes level.
let audio = 0;
let noiseBuffer;
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
export const ramp = (param, value, duration = rampTime) => {
  const time = audio.currentTime + 0.01;

  param.cancelScheduledValues(time);
  param.setValueAtTime(param.value, time);
  param.linearRampToValueAtTime(value, time + duration);

  return time + duration;
};

/**
 * Start a sound, silent: the caller ramps `gain` up to the level it wants, and
 * can go on ramping it for as long as the sound plays.
 *
 * The drill is chopped at its own pitch for its mechanical purr. The engine
 * mixes rounded exhaust pulses and a quiet air bed through one low-pass filter.
 */
export const tone = (frequency, type, engine) => {
  unlockAudio();

  const oscillator = engine ? audio.createBufferSource() : audio.createOscillator();
  const gain = audio.createGain();
  const pulse = audio.createOscillator();
  const depth = audio.createGain();
  const filter = engine ? audio.createBiquadFilter() : audio.createGain();

  if (engine) {
    if (!noiseBuffer) {
      let pressure = 0;

      noiseBuffer = soundBuffer(44100, () => pressure = pressure * 0.95 + Math.random() * 0.06 - 0.03);

      // Closely spaced pressure pulses retain a little cylinder-to-cylinder weight.
      // Taper the upper harmonics so the growl has body without a buzzy edge.
      motorWave = audio.createPeriodicWave(
        [0, 2, 10, 1, 8, 2, 7, 1, 5, 1, 0, 1, 3, 0, 2, 0, 1],
        [0, 0, 2, 0, 3, 0, 2, 0, 2, 0, 1, 0, 1, 0, 1, 0, 0],
      );
    }

    // Fill before assigning: Firefox can snapshot the buffer on assignment.
    oscillator.buffer = noiseBuffer;
    oscillator.loop = true;

    filter.frequency.value = 200;
    oscillator.frequency = filter.frequency;

    pulse.setPeriodicWave(motorWave);
    pulse.frequency.value = 12;
    // Keep some combustion texture underneath the pressurized exhaust.
    depth.gain.value = 0.3;
    oscillator.motorFrequency = pulse.frequency;
  } else {
    oscillator.type = pulse.type = type;
    oscillator.frequency.value = pulse.frequency.value = frequency;
    depth.gain.value = filter.gain.value = 0.5;
  }

  pulse.connect(depth);
  depth.connect(engine ? filter : filter.gain);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);

  oscillator.gain = gain.gain;
  oscillator.gain.value = 0;
  oscillator.start();
  pulse.start();

  const stop = oscillator.stop;

  // Use the audio clock so the native stops stay on the end of the fade out.
  oscillator.stop = (duration = rampTime) => {
    const time = ramp(oscillator.gain, 0, duration);

    pulse.stop(time);
    stop.call(oscillator, time);
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

// Finish writing every sample before a source receives the buffer (Firefox).
const soundBuffer = (length, sample) => {
  const buffer = audio.createBuffer(1, length, 44100);

  buffer.getChannelData(0).forEach((_, i, samples) => samples[i] = sample(i));
  return buffer;
};

// Volume, frequency, attack, sustain, release, waveform, optional cutoff, optional endFrequency.
// Waveforms used by the game: sine (0), triangle (1), noise (4).
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

// Both motors keep their voice while held. Engine pitch follows motion/load; gain
// follows thrust, so changes in speed do not keep restarting the volume attack.
export const continuousSound = (sound, level, frequency, engine = false) => {
  if (!sound && !level) return sound;
  sound ||= tone(frequency, 'triangle', engine);

  const duration = level ? 0.04 : 0.3;

  if (engine && sound.targetFrequency !== frequency) {
    // Append short pitch ramps without cancelling their previous endpoints.
    // Re-anchoring every speed update made the revs lag and catch up late.
    const time = audio.currentTime + duration;

    sound.frequency.linearRampToValueAtTime(frequency, time);
    sound.motorFrequency.linearRampToValueAtTime(12 + (frequency - 200) / 30, time);
    sound.targetFrequency = frequency;
  }

  if (level === sound.level) return sound;

  if (!level) {
    sound.stop(engine ? duration : rampTime);
    return 0;
  }

  ramp(sound.gain, level, engine ? 0.04 : rampTime);
  sound.level = level;
  return sound;
};

let thrusterSound;

// One engine voice for the whole ship, independent of its nozzle count.
export const updateThrusterSound = (power, load = 0) => {
  if (!audio || audio.state !== 'running') return;
  // Translation and steering share one rev range; combining them cannot over-rev.
  const pace = Math.max(0, Math.min(1, load));
  const revs = power > 0 ? pace : 0;

  thrusterSound = continuousSound(thrusterSound, power > 0 ? 0.09 + power * 0.06 : 0, 200 + revs * 480, true);
};
