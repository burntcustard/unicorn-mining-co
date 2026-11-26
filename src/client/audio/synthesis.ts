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
  lowpassOrder?: number;
  endFrequency?: number;
  highpass?: number;
  waveform?: SoundWaveform;
  noiseSeed?: number;
  phaseOffset?: number;
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
  pitchPoints?: number[];
  modulationRate?: number;
  modulationDepth?: number;
  fmRatio?: number;
  fmDepth?: number;
  partials?: number[];
  partialRatio?: number;
  endCutoff?: number;
  filterDuration?: number;
  filterCurve?: SoundCurve;
  endHighpass?: number;
  resonance?: number;
  ring?: number;
  gainPoints?: number[];
  gainPositions?: number[];
  endResonance?: number;
  resonancePoints?: number[];
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
  highpass: number;
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
  lowpassOrder = 1,
  endFrequency = frequency,
  highpass = 0,
  waveform = cutoff ? 'noise' : 'sine',
  noiseSeed = 0,
  phaseOffset = 0,
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
  pitchPoints = [],
  modulationRate = 0,
  modulationDepth = 0,
  fmRatio = 0,
  fmDepth = 0,
  partials = [],
  partialRatio = 1,
  endCutoff = cutoff,
  filterDuration = attack + decay + hold + release,
  filterCurve = 'linear',
  endHighpass = highpass,
  resonancePoints = [],
  resonance = resonancePoints[0] ?? 0,
  ring = 50,
  gainPoints = [],
  gainPositions = [],
  endResonance = resonancePoints.at(-1) ?? resonance,
}: SoundEffect): Required<SoundEffect> => ({
  volume,
  attack,
  decay,
  frequency: pitchPoints[0] ?? frequency,
  cutoff,
  lowpassOrder,
  endFrequency: pitchPoints.at(-1) ?? endFrequency,
  highpass,
  waveform,
  noiseSeed,
  phaseOffset,
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
  pitchPoints,
  modulationRate,
  modulationDepth,
  fmRatio,
  fmDepth,
  partials,
  partialRatio,
  endCutoff,
  filterDuration,
  filterCurve,
  endHighpass,
  resonance: resonancePoints[0] ?? resonance,
  ring,
  gainPoints,
  gainPositions,
  endResonance: resonancePoints.at(-1) ?? endResonance,
  resonancePoints,
});

const sampleRate = 44100;

const interpolatePoints = (
  points: number[],
  index: number,
  fraction: number,
) => {
  const from = points[index];

  return from + ((points[index + 1] ?? from) - from) * fraction;
};

const samplePoints = (points: number[], progress: number) => {
  const position = progress * (points.length - 1);
  const index = Math.floor(position);

  return interpolatePoints(points, index, position - index);
};

/**
 * Interpolate positive values geometrically, with finite exact zero endpoints.
 */
const interpolate = (
  curve: SoundCurve,
  from: number,
  to: number,
  progress: number,
) => {
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
const bandLimit = (phase: number, increment: number) => {
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

const oscillator = (
  waveform: SoundWaveform,
  phase: number,
  increment: number,
  pulseWidth: number,
  random: () => number,
) => {
  if (waveform === 'noise') return random() * 2 - 1;

  if (waveform === 'crackle') {
    return random() < increment ? random() * 2 - 1 : 0;
  }

  if (waveform === 'sine') return Math.sin(phase * Math.PI * 2);

  if (waveform === 'triangle') {
    return 1 - 4 * Math.abs(Math.round(phase) - phase);
  }

  const cycle = phase % 1;
  const correction = bandLimit(cycle, increment);

  if (waveform === 'sawtooth') return cycle * 2 - 1 - correction;
  const width = waveform === 'square' ? 0.5 : pulseWidth;

  return (
    (cycle < width ? 1 : -1) -
    (2 * width - 1) +
    correction -
    bandLimit((cycle + 1 - width) % 1, increment)
  );
};

/**
 * Mix delayed layers into one reusable event buffer. All durations use milliseconds.
 * Finish every sample before playback.
 */
export function* generateEffectBuffer({
  context,
  layers,
}: {
  context: Pick<BaseAudioContext, 'createBuffer'>;
  layers: SoundEffect[];
}): Generator<void, AudioBuffer> {
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
      lowpassOrder,
      endFrequency,
      highpass,
      waveform,
      noiseSeed,
      phaseOffset,
      pulseWidth,
      hold,
      sustain,
      release,
      attackCurve,
      decayCurve,
      releaseCurve,
      pitchDuration,
      pitchCurve,
      pitchPoints,
      modulationRate,
      modulationDepth,
      fmRatio,
      fmDepth,
      partials,
      partialRatio,
      endCutoff,
      filterDuration,
      filterCurve,
      endHighpass,
      resonance,
      ring,
      gainPoints,
      gainPositions,
      endResonance,
      resonancePoints,
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
    const fullPitchDuration = Math.abs(pitchDuration - duration) <= 1e-9;
    const fullFilterDuration = Math.abs(filterDuration - duration) <= 1e-9;
    const maxHighpassRate = Math.max(highpassRate, endHighpassRate);
    const decayEnd = attack + decay;
    const holdEnd = decayEnd + hold;
    const partialScale =
      Math.sqrt(partials.reduce((sum, level) => sum + level * level, 0)) || 1;
    const centerPartial = Math.floor(partials.length / 2);
    let filtered = 0;
    const lowpassStages = new Float64Array(Math.max(0, lowpassOrder - 1));
    let bass = 0;
    let phase = phaseOffset;
    let input1 = 0;
    let input2 = 0;
    let output1 = 0;
    let output2 = 0;
    let timedGainIndex = 0;
    let noiseState = noiseSeed >>> 0;

    const random = noiseSeed
      ? () => {
          noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
          return noiseState / 4294967296;
        }
      : Math.random;

    for (let i = 0; i < length + tail; i++) {
      const elapsed = i / sampleRate;
      const modulation =
        modulationRate && modulationDepth
          ? 2 **
            ((modulationDepth / 1200) *
              Math.sin(2 * Math.PI * modulationRate * elapsed))
          : 1;
      const pitchProgress = pitchDuration
        ? Math.min(1, fullPitchDuration ? i / length : elapsed / pitchDuration)
        : 1;

      const pitch = pitchPoints.length
        ? samplePoints(pitchPoints, pitchProgress)
        : pitchCurve === 'linear' && fullPitchDuration
          ? frequency + ((endFrequency - frequency) * i) / length
          : interpolate(pitchCurve, frequency, endFrequency, pitchProgress);

      const increment =
        Math.min(sampleRate / 2, pitch * modulation) / sampleRate;

      phase += increment;
      // Sine FM adds inharmonic sidebands, rather than just slow vibrato.
      // Reduce the index near Nyquist to limit reflected high-frequency energy.
      const fmIndex =
        waveform === 'sine' && fmRatio && increment
          ? Math.min(fmDepth, Math.max(0, (0.45 / increment - 1) / fmRatio - 1))
          : 0;
      let wave = fmIndex
        ? Math.sin(
            phase * Math.PI * 2 +
              fmIndex * Math.sin(phase * Math.PI * 2 * fmRatio),
          )
        : oscillator(waveform, phase, increment, pulseWidth, random);

      if (waveform === 'sine' && partials.length) {
        wave = 0;

        for (let partial = 0; partial < partials.length; partial++) {
          const ratio = 1 + (partial - centerPartial) * partialRatio;

          if (ratio <= 0 || ratio * increment >= 0.45) continue;

          // Spread the phases so a resonant cluster does not become a pulse train.
          wave +=
            (partials[partial] / partialScale) *
            Math.sin(
              phase * Math.PI * 2 * ratio + partial * partial * 2.39996323,
            );
        }
      }

      let envelope = 0;

      if (i) {
        if (elapsed < attack) {
          envelope = interpolate(attackCurve, 0, 1, elapsed / attack);
        } else if (elapsed < decayEnd) {
          envelope = interpolate(
            decayCurve,
            1,
            sustain,
            (elapsed - attack) / decay,
          );
        } else if (elapsed < holdEnd) {
          envelope = sustain;
        } else if (release && i < length - 1) {
          envelope = interpolate(
            releaseCurve,
            sustain,
            0,
            (elapsed - holdEnd) / release,
          );
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
          : interpolate(filterCurve, lowpass, endLowpass, filterProgress);

      const bassRate =
        highpassRate === endHighpassRate
          ? highpassRate
          : interpolate(
              filterCurve,
              highpassRate,
              endHighpassRate,
              filterProgress,
            );

      const bassMix =
        highpassRate && endHighpassRate
          ? 1
          : maxHighpassRate
            ? bassRate / maxHighpassRate
            : 0;
      let gain = 1;

      if (gainPoints.length) {
        const progress = Math.min(1, i / Math.max(1, length - 1));

        if (
          gainPositions.length === gainPoints.length &&
          gainPositions.length > 1
        ) {
          while (
            timedGainIndex < gainPositions.length - 2 &&
            progress > gainPositions[timedGainIndex + 1]
          ) {
            timedGainIndex++;
          }

          const from = gainPositions[timedGainIndex];
          const to = gainPositions[timedGainIndex + 1];

          gain = interpolatePoints(
            gainPoints,
            timedGainIndex,
            (progress - from) / (to - from),
          );
        } else {
          gain = samplePoints(gainPoints, progress);
        }
      }

      const sample = i < length ? wave * envelope * volume * gain : 0;

      filtered += (sample - filtered) * lowpassRate;
      let lowpassed = filtered;

      for (let stage = 0; stage < lowpassStages.length; stage++) {
        lowpassStages[stage] +=
          (lowpassed - lowpassStages[stage]) * lowpassRate;
        lowpassed = lowpassStages[stage];
      }

      bass += (lowpassed - bass) * bassRate;
      let output = release && i === length - 1 ? 0 : lowpassed - bass * bassMix;

      if (pole) {
        const center = resonancePoints.length
          ? samplePoints(resonancePoints, filterProgress)
          : interpolate(filterCurve, resonance, endResonance, filterProgress);

        const ringing =
          resonanceGain * (output - input2) +
          (!resonancePoints.length &&
          resonance === endResonance &&
          modulation === 1
            ? feedback
            : 2 *
              pole *
              Math.cos(
                (2 * Math.PI * Math.min(sampleRate / 2, modulation * center)) /
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

      if ((i + 1) % 256 === 0) yield;
    }
  }

  return buffer;
}

export function finishBuffer(render: Generator<void, AudioBuffer>) {
  let step = render.next();

  while (!step.done) step = render.next();

  return step.value;
}

export const renderEffectBuffer = (
  options: Parameters<typeof generateEffectBuffer>[0],
) => finishBuffer(generateEffectBuffer(options));

/**
 * Sustain an effect's texture, discard filter startup, and blend the loop seam.
 * Its authored envelope remains the one-shot preview in the Sound Editor.
 */
export function* generateLoopBuffer({
  context,
  layers,
}: {
  context: Pick<BaseAudioContext, 'createBuffer'>;
  layers: SoundEffect[];
}): Generator<void, AudioBuffer> {
  const samples = (yield* generateEffectBuffer({
    context,
    layers: layers.map((layer): SoundEffect => ({
      ...layer,
      attack: 0,
      decay: 1200,
      hold: 0,
      release: 0,
      sustain: 1,
      gainPoints: [],
      gainPositions: [],
    })),
  })).getChannelData(0);

  const overlap = Math.floor(sampleRate / 10);
  const length = sampleRate - overlap;
  const buffer = context.createBuffer(1, length, sampleRate);
  const output = buffer.getChannelData(0);

  output.set(samples.subarray(overlap, overlap + length));

  for (let i = 0; i < overlap; i++) {
    const angle = ((i / overlap) * Math.PI) / 2;

    output[i] =
      samples[sampleRate + i] * Math.cos(angle) + output[i] * Math.sin(angle);

    if ((i + 1) % 256 === 0) yield;
  }

  return buffer;
}

export const renderLoopBuffer = (
  options: Parameters<typeof generateLoopBuffer>[0],
) => finishBuffer(generateLoopBuffer(options));

/**
 * Render the same engine or horn drill loop used in gameplay and the editor.
 */
export function* generateContinuousBuffer({
  context,
  kind,
  settings,
}: {
  context: Pick<BaseAudioContext, 'createBuffer'>;
  kind: 'engine' | 'hornDrill';
  settings: EngineSoundSettings | HornDrillSoundSettings;
}): Generator<void, AudioBuffer> {
  const length = Math.max(
    1,
    Math.floor((settings.duration / 1000) * sampleRate),
  );
  const buffer = context.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);
  let air = 0;
  let filtered = 0;

  for (let i = 0; i < length; i++) {
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

    if ((i + 1) % 256 === 0) yield;
  }

  if (kind === 'hornDrill') {
    const rate = Math.min(
      1,
      (2 * Math.PI * (settings as HornDrillSoundSettings).highpass) /
        sampleRate,
    );

    if (rate) {
      let bass = 0;

      for (let i = 0; i < length; i++) {
        bass += (samples[i] - bass) * rate;

        if ((i + 1) % 256 === 0) yield;
      }

      // Start in the filter's steady state so the loop has no filter reset.
      bass /= 1 - (1 - rate) ** length;

      for (let i = 0; i < length; i++) {
        bass += (samples[i] - bass) * rate;
        samples[i] -= bass;

        if ((i + 1) % 256 === 0) yield;
      }
    }
  }

  return buffer;
}

export const renderContinuousBuffer = (
  options: Parameters<typeof generateContinuousBuffer>[0],
) => finishBuffer(generateContinuousBuffer(options));
