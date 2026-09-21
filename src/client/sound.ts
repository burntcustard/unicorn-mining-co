// The drill and engine use looped audio buffers with smooth parameter ramps.
let audio: AudioContext | 0 = 0;
const loopBuffers: (AudioBuffer | undefined)[] = [];
const effectBuffers: (AudioBuffer | undefined)[] = [];
const effectNextPlay: number[] = [];

interface Sound extends AudioBufferSourceNode {
  gain: AudioParam;
  level?: number;
  pitch?: number;
}

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
 * Returns the audio-clock time when the fade is effectively complete.
 */
export const ramp = (
  param: AudioParam,
  value: number,
  duration = 1.2,
): number => {
  const time = (audio as AudioContext).currentTime + 0.01;

  param.setTargetAtTime(value, time, duration / 5);

  return time + duration;
};

/**
 * Start a looped sound, silent: the caller ramps `gain` and `playbackRate`
 * to the levels it wants.
 */
export const tone = (engine = 0) => {
  unlockAudio();

  const context = audio as AudioContext;
  const source = context.createBufferSource() as Sound;
  const gain = context.createGain();

  let air = 0;
  let filtered = 0;

  const length = engine ? 44100 : 1470;

  source.buffer = loopBuffers[length] ||= soundBuffer(length, (i: number) => {
    const phase = i / length;

    if (engine) {
      air += (Math.random() * 2 - 1 - air) * 0.02;
      filtered += (air - filtered) * 0.02;
      const p = phase * Math.PI * 44;
      const fundamental = Math.sin(p);
      const stroke =
        fundamental * 0.5 + Math.sin(p * 2) * 0.3 + Math.sin(p * 3) * 0.2;
      return stroke * 0.4 + filtered * (0.6 + 0.4 * fundamental);
    }

    const t = (phase * 35) / 30;
    const wave = 1 - 4 * Math.abs(Math.round(t) - t);
    const env = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return wave * env * 0.3;
  });

  source.loop = true;
  source.connect(gain);
  gain.connect(context.destination);

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
const soundBuffer = (length: number, sample: (index: number) => number) => {
  const buffer = (audio as AudioContext).createBuffer(1, length, 44100);

  buffer.getChannelData(0).forEach((_, i, samples) => (samples[i] = sample(i)));
  return buffer;
};

// Volume, frequency, attack, decay, optional noise cutoff, end frequency.
// Tonal effects are sine waves; a cutoff selects filtered noise instead.
const effectData = (
  '2,0,0.01,0.1,1000,0,' + // hatchOpen
  '4,0,0.01,0.1,200,0,' + // hatchClose
  '0.1,660,0.01,0.1,0,1000,' + // pickup
  '30,0,0.05,0.5,70,0,' + // crash
  '8,75,0.01,0.2,0,18,' + // asteroidBreak
  '1,190,0.01,0.3,0,200,' + // shieldBounce
  '1,120,0.02,0.3,0,480,' + // shieldOn
  '0.2,480,0.01,0.5,0,100,' + // shieldOff
  '0.2,800,0.01,0.1,0,800,' + // ui
  '0.1,1200,0.01,0.05,0,1200'
) // light
  .split(',')
  .map(Number);

export const playSound = (effect: number) => {
  // A real key gesture unlocks audio. Drop effects before that first gesture.
  if (!audio || audio.state !== 'running') return;
  const time = audio.currentTime;

  if (time < effectNextPlay[effect]) return;
  effectNextPlay[effect] = time + 0.1;

  // Render each complete effect once. Rapid playback then reuses one buffer.
  if (!effectBuffers[effect]) {
    const [volume, frequency, attack, decay, cutoff, endFrequency = frequency] =
      effectData.slice(effect * 6, effect * 6 + 6);
    const sampleRate = 44100;
    const length = ((attack + decay) * sampleRate) | 0;

    let filtered = 0;
    let t = 0;

    effectBuffers[effect] = soundBuffer(length, (i: number) => {
      t += (frequency + ((endFrequency - frequency) * i) / length) / sampleRate;
      const wave = cutoff ? Math.random() * 2 - 1 : Math.sin(t * Math.PI * 2);
      const elapsed = i / sampleRate;
      const envelope = Math.min(
        elapsed / attack,
        0.01 ** ((elapsed - attack) / decay),
      );
      const sample = wave * envelope * volume;

      return (filtered +=
        (sample - filtered) * (cutoff ? cutoff / (cutoff + sampleRate) : 1));
    });
  }

  const source = (audio as AudioContext).createBufferSource();

  source.buffer = effectBuffers[effect];
  source.connect((audio as AudioContext).destination);
  source.start();
};

export const continuousSound = (
  sound: Sound | 0,
  level: number,
  playbackRate = level ? 1 - level / 80 : 0.4,
  engine = 0,
) => {
  if (!sound && !level) return;
  sound ||= tone(engine);

  if (sound.pitch !== playbackRate)
    ramp(sound.playbackRate, (sound.pitch = playbackRate));

  if (level === sound.level) return sound;

  const time = ramp(sound.gain, level);
  sound.level = level;

  if (!level) return sound.stop(time);

  return sound;
};

let thrusterSound: Sound | 0 = 0;

// One engine voice for the whole ship, independent of its nozzle count.
export const updateThrusterSound = (power: number, load = 0) => {
  if (!audio || audio.state !== 'running') return;
  const revs = load * 1.2;

  thrusterSound =
    continuousSound(thrusterSound, power * (0.24 + revs), 0.7 + revs, 1) || 0;
};

export default {
  unlockAudio,
  playSound,
  continuousSound,
  updateThrusterSound,
  // @ifdef DEBUG
  testTone,
  // @endif
};
