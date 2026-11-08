export type SoundWaveform =
  | 'sine'
  | 'triangle'
  | 'square'
  | 'pulse'
  | 'sawtooth'
  | 'noise'
  | 'crackle';

export type SoundCurve = 'linear' | 'exponential' | 'ease-in' | 'ease-out';

/**
 * All delays, envelope stages, loop lengths, fades, and sweep durations use milliseconds.
 */
export type SoundEffect = {
  volume: number;
  frequency?: number;
  attack: number;
  decay: number;
  cutoff?: number;
  endFrequency?: number;
  highpass?: number;
  waveform?: SoundWaveform;
  pulseWidth?: number;
  delay?: number;
  hold?: number;
  sustain?: number;
  release?: number;
  attackCurve?: SoundCurve;
  decayCurve?: SoundCurve;
  releaseCurve?: SoundCurve;
  pitchDuration?: number;
  pitchCurve?: SoundCurve;
  endCutoff?: number;
  filterDuration?: number;
  filterCurve?: SoundCurve;
  endHighpass?: number;
  resonance?: number;
  ring?: number;
  gainPoints?: number[];
  endResonance?: number;
};

export type EngineSoundSettings = {
  duration: number;
  frequency: number;
  fundamental: number;
  secondHarmonic: number;
  thirdHarmonic: number;
  motorVolume: number;
  noiseSmoothing: number;
  noiseFilter: number;
  noiseVolume: number;
  noisePulse: number;
  basePitch: number;
  revRange: number;
  idleVolume: number;
  volume: number;
  ramp: number;
};

export type HornDrillSoundSettings = {
  duration: number;
  frequency: number;
  volume: number;
  basePitch: number;
  activeVolume: number;
  bitingVolume: number;
  activePitch: number;
  bitingPitch: number;
  ramp: number;
};

/**
 * Resolve omitted sound properties consistently in playback and editor controls.
 */
export const resolveSoundEffect = ({
  volume,
  attack,
  decay,
  frequency = 0,
  cutoff = 0,
  endFrequency = frequency,
  highpass = 0,
  waveform = cutoff ? 'noise' : 'sine',
  pulseWidth = 0.5,
  delay = 0,
  hold = 0,
  sustain = 0.01,
  release = 0,
  attackCurve = 'linear',
  decayCurve = 'exponential',
  releaseCurve = 'exponential',
  pitchDuration = attack + decay + hold + release,
  pitchCurve = 'linear',
  endCutoff = cutoff,
  filterDuration = attack + decay + hold + release,
  filterCurve = 'linear',
  endHighpass = highpass,
  resonance = 0,
  ring = 50,
  gainPoints = [],
  endResonance = resonance,
}: SoundEffect): Required<SoundEffect> => ({
  volume,
  attack,
  decay,
  frequency,
  cutoff,
  endFrequency,
  highpass,
  waveform,
  pulseWidth,
  delay,
  hold,
  sustain,
  release,
  attackCurve,
  decayCurve,
  releaseCurve,
  pitchDuration,
  pitchCurve,
  endCutoff,
  filterDuration,
  filterCurve,
  endHighpass,
  resonance,
  ring,
  gainPoints,
  endResonance,
});

const sampleRate = 44100;

/**
 * Interpolate positive values geometrically, with finite exact zero endpoints.
 */
const interpolate = ({
  curve,
  from,
  to,
  progress,
}: {
  curve: SoundCurve;
  from: number;
  to: number;
  progress: number;
}) => {
  if (from === to || progress <= 0) return from;

  if (progress >= 1) return to;

  if (curve === 'exponential') {
    const offset = from && to ? 0 : Math.max(from, to, 1) * 0.0001;

    return (
      (from + offset) * ((to + offset) / (from + offset)) ** progress - offset
    );
  }

  const fraction =
    curve === 'ease-in'
      ? progress * progress
      : curve === 'ease-out'
        ? 1 - (1 - progress) ** 2
        : progress;

  return from + (to - from) * fraction;
};

/**
 * Smooth the discontinuities of square, pulse, and sawtooth oscillators.
 */
const bandLimit = ({
  phase,
  increment,
}: {
  phase: number;
  increment: number;
}) => {
  if (!increment) return 0;

  if (phase < increment) {
    const t = phase / increment;

    return t + t - t * t - 1;
  }

  if (phase > 1 - increment) {
    const t = (phase - 1) / increment;

    return t * t + t + t + 1;
  }

  return 0;
};

const oscillator = ({
  waveform,
  phase,
  increment,
  pulseWidth,
}: {
  waveform: SoundWaveform;
  phase: number;
  increment: number;
  pulseWidth: number;
}) => {
  if (waveform === 'noise') return Math.random() * 2 - 1;

  if (waveform === 'crackle') {
    return Math.random() < increment ? Math.random() * 2 - 1 : 0;
  }

  if (waveform === 'sine') return Math.sin(phase * Math.PI * 2);

  if (waveform === 'triangle') {
    return 1 - 4 * Math.abs(Math.round(phase) - phase);
  }

  const cycle = phase % 1;
  const correction = bandLimit({ phase: cycle, increment });

  if (waveform === 'sawtooth') return cycle * 2 - 1 - correction;
  const width = waveform === 'square' ? 0.5 : pulseWidth;

  return (
    (cycle < width ? 1 : -1) -
    (2 * width - 1) +
    correction -
    bandLimit({ phase: (cycle + 1 - width) % 1, increment })
  );
};

/**
 * Mix delayed layers into one reusable event buffer. All durations use milliseconds.
 * Finish every sample before playback.
 */
export const renderEffectBuffer = ({
  context,
  layers,
}: {
  context: Pick<BaseAudioContext, 'createBuffer'>;
  layers: SoundEffect[];
}) => {
  const prepared = layers.map((layer) => {
    const settings = resolveSoundEffect(layer);

    settings.attack /= 1000;
    settings.decay /= 1000;
    settings.hold /= 1000;
    settings.release /= 1000;
    settings.pitchDuration /= 1000;
    settings.filterDuration /= 1000;
    const duration =
      settings.attack + settings.decay + settings.hold + settings.release;

    return {
      settings,
      duration,
      length: Math.floor(duration * sampleRate),
      tail:
        settings.resonance || settings.endResonance
          ? Math.floor((settings.ring / 1000) * sampleRate)
          : 0,
      offset: Math.floor((settings.delay / 1000) * sampleRate),
    };
  });

  const length = Math.max(
    1,
    ...prepared.map(({ length, tail, offset }) => length + tail + offset),
  );
  const buffer = context.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);

  for (const { settings, duration, length, tail, offset } of prepared) {
    const {
      volume,
      frequency,
      attack,
      decay,
      cutoff,
      endFrequency,
      highpass,
      waveform,
      pulseWidth,
      hold,
      sustain,
      release,
      attackCurve,
      decayCurve,
      releaseCurve,
      pitchDuration,
      pitchCurve,
      endCutoff,
      filterDuration,
      filterCurve,
      endHighpass,
      resonance,
      ring,
      gainPoints,
      endResonance,
    } = settings;
    // Ring is the time for an undriven resonance to fall to 1 percent amplitude.
    const pole =
      resonance || endResonance ? 0.01 ** (1000 / (ring * sampleRate)) : 0;
    const feedback =
      2 * pole * Math.cos((2 * Math.PI * resonance) / sampleRate);
    // Keep white-noise loudness similar as the ring length changes.
    const resonanceGain =
      pole && ((1 - pole * pole) / 2) * Math.sqrt(-1 / Math.log(pole));
    const lowpass = cutoff ? cutoff / (cutoff + sampleRate) : 1;
    const endLowpass = endCutoff ? endCutoff / (endCutoff + sampleRate) : 1;
    const highpassRate = Math.min(1, (2 * Math.PI * highpass) / sampleRate);
    const endHighpassRate = Math.min(
      1,
      (2 * Math.PI * endHighpass) / sampleRate,
    );
    const legacyEnvelope =
      !hold &&
      !release &&
      sustain === 0.01 &&
      (!attack || attackCurve === 'linear') &&
      (!decay || decayCurve === 'exponential');
    const fullPitchDuration = Math.abs(pitchDuration - duration) <= 1e-9;
    const fullFilterDuration = Math.abs(filterDuration - duration) <= 1e-9;
    const maxHighpassRate = Math.max(highpassRate, endHighpassRate);
    const decayEnd = attack + decay;
    const holdEnd = decayEnd + hold;
    let filtered = 0;
    let bass = 0;
    let phase = 0;
    let input1 = 0;
    let input2 = 0;
    let output1 = 0;
    let output2 = 0;

    for (let i = 0; i < length + tail; i++) {
      const elapsed = i / sampleRate;
      const pitchProgress = pitchDuration
        ? Math.min(1, fullPitchDuration ? i / length : elapsed / pitchDuration)
        : 1;

      const pitch =
        pitchCurve === 'linear' && fullPitchDuration
          ? frequency + ((endFrequency - frequency) * i) / length
          : interpolate({
              curve: pitchCurve,
              from: frequency,
              to: endFrequency,
              progress: pitchProgress,
            });

      const increment = pitch / sampleRate;

      phase += increment;
      const wave = oscillator({ waveform, phase, increment, pulseWidth });
      let envelope = 0;

      if (i) {
        if (legacyEnvelope) {
          envelope = Math.min(
            attack ? elapsed / attack : 1,
            decay ? 0.01 ** ((elapsed - attack) / decay) : 1,
          );
        } else if (elapsed < attack) {
          envelope = interpolate({
            curve: attackCurve,
            from: 0,
            to: 1,
            progress: elapsed / attack,
          });
        } else if (elapsed < decayEnd) {
          envelope = interpolate({
            curve: decayCurve,
            from: 1,
            to: sustain,
            progress: (elapsed - attack) / decay,
          });
        } else if (elapsed < holdEnd) {
          envelope = sustain;
        } else if (release && i < length - 1) {
          envelope = interpolate({
            curve: releaseCurve,
            from: sustain,
            to: 0,
            progress: (elapsed - holdEnd) / release,
          });
        }
      }

      const filterProgress = filterDuration
        ? Math.min(
            1,
            fullFilterDuration ? i / length : elapsed / filterDuration,
          )
        : 1;

      const lowpassRate =
        lowpass === endLowpass
          ? lowpass
          : interpolate({
              curve: filterCurve,
              from: lowpass,
              to: endLowpass,
              progress: filterProgress,
            });

      const bassRate =
        highpassRate === endHighpassRate
          ? highpassRate
          : interpolate({
              curve: filterCurve,
              from: highpassRate,
              to: endHighpassRate,
              progress: filterProgress,
            });

      const bassMix =
        highpassRate && endHighpassRate
          ? 1
          : maxHighpassRate
            ? bassRate / maxHighpassRate
            : 0;
      const gainPosition =
        Math.min(1, i / Math.max(1, length - 1)) *
        Math.max(0, gainPoints.length - 1);
      const gainIndex = Math.floor(gainPosition);
      const gain = gainPoints.length
        ? gainPoints[gainIndex] +
          ((gainPoints[gainIndex + 1] ?? gainPoints[gainIndex]) -
            gainPoints[gainIndex]) *
            (gainPosition - gainIndex)
        : 1;
      const sample = i < length ? wave * envelope * volume * gain : 0;

      filtered += (sample - filtered) * lowpassRate;
      bass += (filtered - bass) * bassRate;
      let output = release && i === length - 1 ? 0 : filtered - bass * bassMix;

      if (pole) {
        const ringing =
          resonanceGain * (output - input2) +
          (resonance === endResonance
            ? feedback
            : 2 *
              pole *
              Math.cos(
                (2 *
                  Math.PI *
                  interpolate({
                    curve: filterCurve,
                    from: resonance,
                    to: endResonance,
                    progress: filterProgress,
                  })) /
                  sampleRate,
              )) *
            output1 -
          pole * pole * output2;

        input2 = input1;
        input1 = output;
        output2 = output1;
        output1 = ringing;
        output = ringing;
      }

      samples[offset + i] += output;
    }
  }

  return buffer;
};

/**
 * Render the same engine or horn drill loop used in gameplay and the editor.
 */
export const renderContinuousBuffer = ({
  context,
  kind,
  settings,
}: {
  context: Pick<BaseAudioContext, 'createBuffer'>;
  kind: 'engine' | 'hornDrill';
  settings: EngineSoundSettings | HornDrillSoundSettings;
}) => {
  const length = Math.max(
    1,
    Math.floor((settings.duration / 1000) * sampleRate),
  );
  const buffer = context.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);
  let air = 0;
  let filtered = 0;

  samples.forEach((_, i) => {
    const phase = i / length;
    const p = (i / sampleRate) * settings.frequency;

    if (kind === 'engine') {
      const engine = settings as EngineSoundSettings;

      air += (Math.random() * 2 - 1 - air) * engine.noiseSmoothing;
      filtered += (air - filtered) * engine.noiseFilter;
      const angle = p * Math.PI * 2;
      const fundamental = Math.sin(angle);
      const stroke =
        fundamental * engine.fundamental +
        Math.sin(angle * 2) * engine.secondHarmonic +
        Math.sin(angle * 3) * engine.thirdHarmonic;

      samples[i] =
        stroke * engine.motorVolume +
        filtered * (engine.noiseVolume + engine.noisePulse * fundamental);
    } else {
      const wave = 1 - 4 * Math.abs(Math.round(p) - p);
      const envelope = phase < 0.5 ? phase * 2 : (1 - phase) * 2;

      samples[i] = wave * envelope * settings.volume;
    }
  });

  return buffer;
};
