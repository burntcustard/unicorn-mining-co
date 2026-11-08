import {
  resolveSoundEffect,
  type EngineSoundSettings,
  type HornDrillSoundSettings,
  type SoundEffect,
} from '../../client/audio/synthesis.ts';
import type { NumberParameter } from '../number-control.ts';

export type Parameter = NumberParameter;

export type EffectNumberKey = {
  [K in keyof Required<SoundEffect>]: Required<SoundEffect>[K] extends number
    ? K
    : never;
}[keyof SoundEffect];

export type EffectChoiceKey = Exclude<
  keyof SoundEffect,
  EffectNumberKey | 'gainPoints' | 'gainPositions'
>;

export type ChoiceParameter = {
  label: string;
  options: readonly string[];
};

export const maxLayers = 32;

export const soundEvents = [
  'hatchOpen',
  'hatchClose',
  'pickup',
  'crash',
  'asteroidBreak',
  'shieldBounce',
  'shieldOn',
  'shieldOff',
  'ui',
  'searchLight',
] as const;

export const soundNames = [...soundEvents, 'engine', 'hornDrill'] as const;

export type SoundEvent = string;
export type SoundName = string;

export type SoundValues = Record<
  string,
  SoundEffect[] | EngineSoundSettings | HornDrillSoundSettings
> &
  Record<(typeof soundEvents)[number], SoundEffect[]> & {
    engine: EngineSoundSettings;
    hornDrill: HornDrillSoundSettings;
  };

export type SoundData = {
  effectData: Record<SoundEvent, SoundEffect[]>;
  continuousData: {
    engine: EngineSoundSettings;
    hornDrill: HornDrillSoundSettings;
  };
};

export type SoundDocument = SoundData & {
  revisions: Record<string, string>;
  unassigned: Record<string, SoundEffect>;
  layerRevisions: Record<string, string>;
};

export type SavedSound<N extends SoundName = SoundName> = {
  data: SoundValues[N];
  revision: string;
};

export const soundIds: Record<SoundName, string> = {
  hatchOpen: 'hatch-open',
  hatchClose: 'hatch-close',
  pickup: 'pickup',
  crash: 'crash',
  asteroidBreak: 'asteroid-break',
  shieldBounce: 'shield-bounce',
  shieldOn: 'shield-on',
  shieldOff: 'shield-off',
  ui: 'ui',
  searchLight: 'search-light',
  engine: 'engine',
  hornDrill: 'horn-drill',
};

/**
 * Give space-separated, camel case, and kebab case names one stable key.
 */
export const normalizeSoundName = (input: string) => {
  if (typeof input !== 'string') throw new Error('Enter a sound name.');
  const value = input.trim();

  if (
    !/^[A-Za-z][A-Za-z0-9]*(?:[ -]+[A-Za-z0-9]+)*$/.test(value) ||
    value.length > 64
  ) {
    throw new Error(
      'Use a name of at most 64 letters, numbers, spaces, or hyphens, starting with a letter.',
    );
  }

  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .split(/[ -]+/);
  const name =
    words[0] +
    words
      .slice(1)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join('');

  if (name.length > 64) throw new Error('The sound name is too long.');

  return name;
};

/**
 * Keep built-in URLs stable while supporting newly authored event names.
 */
export const soundId = (name: string) =>
  Object.hasOwn(soundIds, name)
    ? soundIds[name]
    : normalizeSoundName(name)
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();

const frequency = {
  min: 0,
  max: 22050,
  step: 1,
  scale: 'log',
  unit: 'Hz',
  integer: true,
} as const;

const volume = { min: 0, max: 16, step: 0.01, inputStep: 0.01 };

const duration = {
  min: 1,
  max: 10000,
  step: 1,
  scale: 'log',
  unit: 'ms',
  integer: true,
} as const;

const effectDuration = { ...duration, min: 0 };
const attackLimit = 250;
const decayLimit = 2500;
const holdLimit = 500;
const releaseLimit = 500;
const sweepLimit = attackLimit + decayLimit + holdLimit + releaseLimit;
const highpass = { ...frequency, max: 7000 };

const weight = { min: 0, max: 1, step: 0.001 };
const pitch = { min: 0.01, max: 8, step: 0.01, scale: 'log' } as const;

export const effectParameters: Record<EffectNumberKey, Parameter> = {
  volume: { label: 'Volume', ...volume },
  frequency: { label: 'Frequency', ...frequency },
  endFrequency: { label: 'End frequency', ...frequency },
  pitchDuration: {
    label: 'Pitch duration',
    ...effectDuration,
    max: sweepLimit,
  },
  pulseWidth: { label: 'Pulse width', min: 0.01, max: 0.99, step: 0.01 },
  delay: {
    label: 'Delay',
    ...effectDuration,
    max: 1000,
  },
  attack: {
    label: 'Attack',
    ...effectDuration,
    max: attackLimit,
    integer: false,
  },
  decay: { label: 'Decay', ...effectDuration, max: decayLimit },
  hold: { label: 'Hold', ...effectDuration, max: holdLimit, integer: false },
  sustain: { label: 'Sustain level', ...weight },
  release: {
    label: 'Release',
    ...effectDuration,
    max: releaseLimit,
    integer: false,
  },
  cutoff: { label: 'Low-pass', ...frequency },
  endCutoff: { label: 'End low-pass', ...frequency },
  highpass: { label: 'High-pass', ...highpass },
  endHighpass: { label: 'End high-pass', ...highpass },
  filterDuration: {
    label: 'Filter duration',
    ...effectDuration,
    max: sweepLimit,
  },
  resonance: { label: 'Resonance', ...frequency },
  endResonance: { label: 'End resonance', ...frequency },
  ring: { label: 'Ring', ...effectDuration, min: 1, max: 500, integer: false },
};

const curves = ['linear', 'exponential', 'ease-in', 'ease-out'] as const;

export const effectChoices: Record<EffectChoiceKey, ChoiceParameter> = {
  waveform: {
    label: 'Waveform',
    options: [
      'sine',
      'triangle',
      'square',
      'pulse',
      'sawtooth',
      'noise',
      'crackle',
    ],
  },
  attackCurve: { label: 'Attack curve', options: curves },
  decayCurve: { label: 'Decay curve', options: curves },
  releaseCurve: { label: 'Release curve', options: curves },
  pitchCurve: { label: 'Pitch curve', options: curves },
  filterCurve: { label: 'Filter curve', options: curves },
};

export const engineParameters: Record<keyof EngineSoundSettings, Parameter> = {
  duration: { label: 'Loop length', ...duration },
  frequency: { label: 'Frequency', ...frequency },
  fundamental: { label: 'Fundamental', ...weight },
  secondHarmonic: { label: 'Second harmonic', ...weight },
  thirdHarmonic: { label: 'Third harmonic', ...weight },
  motorVolume: { label: 'Motor volume', ...volume },
  noiseSmoothing: { label: 'Noise smoothing', ...weight, scale: 'log' },
  noiseFilter: { label: 'Noise filter', ...weight, scale: 'log' },
  noiseVolume: { label: 'Noise volume', ...volume },
  noisePulse: { label: 'Noise pulse', ...weight },
  basePitch: { label: 'Base pitch', ...pitch },
  revRange: { label: 'Rev range', ...pitch, min: 0 },
  idleVolume: { label: 'Idle volume', ...volume },
  volume: { label: 'Volume', ...volume },
  ramp: { label: 'Fade time', ...duration },
};

export const hornDrillParameters: Record<
  keyof HornDrillSoundSettings,
  Parameter
> = {
  duration: { label: 'Loop length', ...duration },
  frequency: { label: 'Frequency', ...frequency },
  volume: { label: 'Wave volume', ...volume },
  basePitch: { label: 'Starting pitch', ...pitch },
  activeVolume: { label: 'Active volume', ...volume },
  bitingVolume: { label: 'Biting volume', ...volume },
  activePitch: { label: 'Active pitch', ...pitch },
  bitingPitch: { label: 'Biting pitch', ...pitch },
  ramp: { label: 'Fade time', ...duration },
};

const objectWithKeys = (
  value: unknown,
  keys: readonly string[],
  path: string,
  optional: readonly string[] = [],
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }

  const actual = Object.keys(value);

  if (
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !optional.includes(key) && !actual.includes(key))
  ) {
    throw new Error(
      optional.length
        ? `${path} requires ${keys.filter((key) => !optional.includes(key)).join(', ')}; supported properties: ${keys.join(', ')}.`
        : `${path} must contain exactly: ${keys.join(', ')}.`,
    );
  }

  return value as Record<string, unknown>;
};

const validateNumbers = (
  settings: Record<string, unknown>,
  parameters: Record<string, Parameter>,
  path: string,
  optional: readonly string[] = [],
) => {
  for (const [key, { min, max, integer }] of Object.entries(parameters)) {
    if (optional.includes(key) && !(key in settings)) continue;
    const number = settings[key];

    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < min ||
      number > max
    ) {
      throw new Error(
        `${path}.${key} must be a finite number from ${min} to ${max}.`,
      );
    }

    if (integer) settings[key] = Math.round(number);
  }
};

const validateParameters = (
  value: unknown,
  parameters: Record<string, Parameter>,
  path: string,
) =>
  validateNumbers(
    objectWithKeys(value, Object.keys(parameters), path),
    parameters,
    path,
  );

/**
 * Omit default or unused optional values while retaining the rendered sound.
 */
export const compactOptional = (effect: SoundEffect): SoundEffect => {
  const {
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
    gainPositions,
    endResonance,
  } = resolveSoundEffect(effect);
  const compact: SoundEffect = { volume, attack, decay };
  const fullDuration = attack + decay + hold + release;
  const matchesDuration = (duration: number) =>
    Math.abs(duration - fullDuration) <= 1e-9;

  if (delay) compact.delay = delay;

  if (hold) compact.hold = hold;

  if (release) compact.release = release;

  if (sustain !== 0.01 && (decay || hold || release)) compact.sustain = sustain;

  if (attack && attackCurve !== 'linear') compact.attackCurve = attackCurve;

  if (decay && sustain !== 1 && decayCurve !== 'exponential') {
    compact.decayCurve = decayCurve;
  }

  if (release && sustain !== 0 && releaseCurve !== 'exponential') {
    compact.releaseCurve = releaseCurve;
  }

  if (waveform !== (cutoff ? 'noise' : 'sine')) compact.waveform = waveform;

  if (waveform === 'pulse' && pulseWidth !== 0.5) {
    compact.pulseWidth = pulseWidth;
  }

  if (waveform !== 'noise') {
    if (frequency) compact.frequency = frequency;

    if (endFrequency !== frequency) {
      compact.endFrequency = endFrequency;

      if (!matchesDuration(pitchDuration)) {
        compact.pitchDuration = pitchDuration;
      }

      if (pitchDuration && pitchCurve !== 'linear') {
        compact.pitchCurve = pitchCurve;
      }
    }
  }

  if (cutoff) compact.cutoff = cutoff;

  if (highpass) compact.highpass = highpass;

  if (endCutoff !== cutoff) compact.endCutoff = endCutoff;

  if (endHighpass !== highpass) compact.endHighpass = endHighpass;

  if (
    endCutoff !== cutoff ||
    endHighpass !== highpass ||
    endResonance !== resonance
  ) {
    if (!matchesDuration(filterDuration)) {
      compact.filterDuration = filterDuration;
    }

    if (filterDuration && filterCurve !== 'linear') {
      compact.filterCurve = filterCurve;
    }
  }

  if (gainPoints.length) compact.gainPoints = [...gainPoints];

  if (gainPositions.length) compact.gainPositions = [...gainPositions];

  if (endResonance !== resonance) compact.endResonance = endResonance;

  if (resonance || endResonance) {
    compact.resonance = resonance;

    if (ring !== 50) compact.ring = ring;
  }

  return compact;
};

/**
 * Validate one sound independently before replacing its spec file.
 */
export function validateSound<N extends SoundName>(
  name: N,
  value: unknown,
): asserts value is SoundValues[N] {
  if (name === 'engine' || name === 'hornDrill') {
    validateParameters(
      value,
      name === 'engine' ? engineParameters : hornDrillParameters,
      name === 'engine' ? 'Engine' : 'Horn drill',
    );
    return;
  }

  if (!Array.isArray(value) || value.length > maxLayers) {
    throw new Error(
      `${name} must contain an array of at most ${maxLayers} sound layers.`,
    );
  }

  const keys = [
    ...Object.keys(effectParameters),
    ...Object.keys(effectChoices),
    'gainPoints',
    'gainPositions',
  ];
  const optional = keys.filter(
    (key) => !['volume', 'attack', 'decay'].includes(key),
  );

  value.forEach((layer, index) => {
    const path = `${name} layer ${index + 1}`;
    const settings = objectWithKeys(layer, keys, path, optional);

    validateNumbers(settings, effectParameters, path, optional);

    if ('gainPoints' in settings) {
      const points = settings.gainPoints;

      if (
        !Array.isArray(points) ||
        points.length === 1 ||
        points.length > 32 ||
        Array.from(points).some(
          (value) =>
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 1,
        )
      ) {
        throw new Error(
          `${path}.gainPoints must be empty or contain 2–32 numbers between 0 and 1.`,
        );
      }
    }

    if ('gainPositions' in settings) {
      const positions = settings.gainPositions;
      const gains = settings.gainPoints;

      if (
        !Array.isArray(positions) ||
        (positions.length &&
          (!Array.isArray(gains) ||
            positions.length !== gains.length ||
            positions[0] !== 0 ||
            positions.at(-1) !== 1 ||
            positions.some(
              (value, i) =>
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < 0 ||
                value > 1 ||
                (i > 0 && value <= positions[i - 1]),
            )))
      ) {
        throw new Error(
          `${path}.gainPositions must match gainPoints, increase strictly, and run from 0 to 1.`,
        );
      }
    }

    for (const [key, { options }] of Object.entries(effectChoices)) {
      if (!(key in settings)) continue;

      if (
        typeof settings[key] !== 'string' ||
        !options.includes(settings[key] as string)
      ) {
        throw new Error(
          `${path}.${key} must be one of: ${options.join(', ')}.`,
        );
      }
    }
  });
}

/**
 * Validate the full saved document before replacing any source data.
 */
export function validateSoundData(value: unknown): asserts value is SoundData {
  const data = objectWithKeys(
    value,
    ['effectData', 'continuousData'],
    'Sounds',
  );

  if (
    !data.effectData ||
    typeof data.effectData !== 'object' ||
    Array.isArray(data.effectData)
  ) {
    throw new Error('Events must be an object.');
  }

  const effects = data.effectData as Record<string, unknown>;

  for (const [event, value] of Object.entries(effects)) {
    if (
      normalizeSoundName(event) !== event ||
      ['engine', 'hornDrill', 'unassigned'].includes(event)
    ) {
      throw new Error(`Invalid sound event name: ${event}.`);
    }

    validateSound(event, value);
  }

  const continuous = objectWithKeys(
    data.continuousData,
    ['engine', 'hornDrill'],
    'Continuous sounds',
  );

  validateSound('engine', continuous.engine);
  validateSound('hornDrill', continuous.hornDrill);
}
