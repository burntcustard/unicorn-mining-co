import autogunClick from '../../specs/sounds/autogun-click';
import autogunMotor from '../../specs/sounds/autogun-motor';
import railgunReady from '../../specs/sounds/railgun-ready';
import railgunCharge from '../../specs/sounds/railgun-charge';
import plasmaAcceleratorFire from '../../specs/sounds/plasma-accelerator-fire';
import plasmaAcceleratorAmmoExplode from '../../specs/sounds/plasma-accelerator-ammo-explode';
import loseTarget from '../../specs/sounds/lose-target';
import wormholeIn from '../../specs/sounds/wormhole-in';
import wormholeOut from '../../specs/sounds/wormhole-out';
import jumpGateOpen from '../../specs/sounds/jump-gate-open';
import mainMenuClose from '../../specs/sounds/main-menu-close';
import mainMenuOpen from '../../specs/sounds/main-menu-open';
import chatMessage from '../../specs/sounds/chat-message';
import autogunFire from '../../specs/sounds/autogun-fire';
import autogunAmmoExplode from '../../specs/sounds/autogun-ammo-explode';
import hatchOpen from '../../specs/sounds/hatch-open';
import hatchClose from '../../specs/sounds/hatch-close';
import pickup from '../../specs/sounds/pickup';
import crash from '../../specs/sounds/crash';
import asteroidBreak from '../../specs/sounds/asteroid-break';
import shieldBounce from '../../specs/sounds/shield-bounce';
import shieldOn from '../../specs/sounds/shield-on';
import shieldOff from '../../specs/sounds/shield-off';
import ui from '../../specs/sounds/ui';
import uiNavUp from '../../specs/sounds/ui-nav-up';
import uiNavNeutral from '../../specs/sounds/ui-nav-neutral';
import uiNavDown from '../../specs/sounds/ui-nav-down';
import uiNavSelect from '../../specs/sounds/ui-nav-select';
import uiNavUnselect from '../../specs/sounds/ui-nav-unselect';
import searchLight from '../../specs/sounds/search-light';
import acquireTarget from '../../specs/sounds/acquire-target';
import engineSettings from '../../specs/sounds/engine';
import hornDrillSettings from '../../specs/sounds/horn-drill';
import {
  generateContinuousBuffer,
  generateEffectBuffer,
  generateLoopBuffer,
  type SoundEffect,
} from './synthesis';
import { audio, unlockAudio } from './audio-context';
import { prepareBuffer, type BufferPreparation } from './buffer-preparation';

// Continuous sounds reuse looped buffers with smooth parameter ramps.
const loopBuffers: BufferPreparation[] = [
  {
    render: (context) =>
      generateContinuousBuffer({
        context,
        kind: 'hornDrill',
        settings: hornDrillSettings,
      }),
  },
  {
    render: (context) =>
      generateContinuousBuffer({
        context,
        kind: 'engine',
        settings: engineSettings,
      }),
  },
  {
    render: (context) => generateLoopBuffer({ context, layers: autogunMotor }),
  },
];

const loopSettings = [
  hornDrillSettings,
  engineSettings,
  { basePitch: 1, ramp: 180 },
];

const effectBuffer = (layers: SoundEffect[]): BufferPreparation => ({
  render: (context) => generateEffectBuffer({ context, layers }),
});

const navigationBuffers = [
  uiNavUp,
  uiNavNeutral,
  uiNavDown,
  uiNavUnselect,
  uiNavSelect,
].map(effectBuffer);

const effectNextPlay = new Map<string, [number, number]>();
// Numeric IDs belong to the protocol; keep their event mapping explicit.
const effects = [
  [0, hatchOpen],
  [1, hatchClose],
  [2, pickup],
  [3, crash],
  [4, asteroidBreak],
  [5, shieldBounce],
  [6, shieldOn],
  [7, shieldOff],
  [8, ui],
  [9, searchLight],
  ['acquire-target', acquireTarget],
  ['lose-target', loseTarget],
  ['wormhole-in', wormholeIn],
  ['wormhole-out', wormholeOut],
  ['jump-gate-open', jumpGateOpen],
  ['main-menu-close', mainMenuClose],
  ['main-menu-open', mainMenuOpen],
  ['chat-message', chatMessage],
  ['autogun-fire', autogunFire],
  ['autogun-ammo-explode', autogunAmmoExplode],
  ['railgun-ready', railgunReady],
  ['plasma-accelerator-fire', plasmaAcceleratorFire],
  ['plasma-accelerator-ammo-explode', plasmaAcceleratorAmmoExplode],
  ['railgun-charge', railgunCharge],
  ['autogun-click', autogunClick],
] as const;

type Effect = number | (typeof effects)[number][0];

const effectBuffers = new Map<Effect, BufferPreparation>();

for (const [effect, layers] of effects) {
  if (layers.length) effectBuffers.set(effect, effectBuffer(layers));
}

const autogunClickBuffer = effectBuffers.get('autogun-click');

interface Sound extends AudioBufferSourceNode {
  gain: AudioParam;
  level?: number;
  pitch?: number;
}

// Start warmup with the sound chunk, before a gesture opens the audio device.
if (typeof document !== 'undefined' && typeof AudioBuffer === 'function') {
  const buffers: Pick<BaseAudioContext, 'createBuffer'> = {
    createBuffer: (numberOfChannels, length, sampleRate) =>
      new AudioBuffer({ numberOfChannels, length, sampleRate }),
  };

  for (const entry of [
    ...navigationBuffers,
    ...loopBuffers,
    ...effectBuffers.values(),
  ]) {
    prepareBuffer(entry, buffers, false);
  }
}

const playWhenReady = (
  entry: BufferPreparation,
  play: (buffer: AudioBuffer) => void,
) => {
  const deadline = performance.now() + 150;

  // Keep only the latest cue for a cold buffer.
  entry.ready = (buffer) => {
    if (performance.now() <= deadline) play(buffer);
  };
};

const playNavigationSound = (cue: -1 | 0 | 1 | 'select' | 'unselect') => {
  if (!audio || audio.state === 'closed') return;
  const context = audio;
  const index = cue === 'select' ? 4 : cue === 'unselect' ? 3 : cue + 1;
  const entry = navigationBuffers[index];
  const prepared = prepareBuffer(entry, context);

  const play = (buffer: AudioBuffer) => {
    if (context.state === 'closed') return;
    const source = context.createBufferSource();

    source.buffer = buffer;
    source.connect(context.destination);
    // Queue the cue while the context resumes so it can start on the audio clock.
    source.start();
  };

  if (prepared) {
    play(prepared);
  } else {
    playWhenReady(entry, play);
  }
};

/**
 * Slide an AudioParam smoothly over a duration in milliseconds using setTargetAtTime.
 *
 * Returns the audio-clock time when the fade is effectively complete.
 */
export const ramp = (
  param: AudioParam,
  value: number,
  duration = 1200,
): number => {
  const time = (audio as AudioContext).currentTime + 0.01;

  param.setTargetAtTime(value, time, duration / 5000);

  return time + duration / 1000;
};

const startSound = (
  context: AudioContext,
  buffer: AudioBuffer,
  { volume, time, pitch }: { volume: number; time?: number; pitch?: number },
) => {
  const source = context.createBufferSource();
  const gain = context.createGain();

  source.buffer = buffer;
  gain.gain.value = volume;

  if (pitch !== undefined) {
    (source as Sound).gain = gain.gain;
    source.loop = true;
    source.playbackRate.value = pitch;
  }

  source.connect(gain);
  gain.connect(context.destination);
  source.start(time);
  return source;
};

/**
 * Start a looped sound, silent: the caller ramps `gain` and `playbackRate`
 * to the levels it wants.
 */
export const tone = (engine = 0) => {
  unlockAudio();

  const context = audio as AudioContext;
  const buffer = prepareBuffer(loopBuffers[engine], context);

  if (!buffer) return;

  return startSound(context, buffer, {
    volume: 0,
    pitch: loopSettings[engine].basePitch,
  }) as Sound;
};

// @ifdef DEBUG
// An audible beep, for telling "Web Audio doesn't work at all here" apart from
// "the game's sounds specifically are wrong".
export const testTone = () => {
  const sound = tone();

  if (!sound) return;
  sound.playbackRate.value = 440 / 30;
  ramp(sound.gain, 0.5);
  setTimeout(() => sound.stop(ramp(sound.gain, 0)), 1000);
};
// @endif

export const playSound = (
  effect: Effect,
  {
    volume = 1,
    id = 0,
    by = 0,
    time = audio ? audio.currentTime : 0,
  }: { volume?: number; id?: number; by?: number; time?: number } = {},
) => {
  // A real key gesture unlocks audio. Drop effects before that first gesture.
  if (!audio || audio.state !== 'running' || volume <= 0) return;

  const entry = effectBuffers.get(effect);

  if (!entry) return;

  const context = audio;
  const key = `${effect}:${id}:${by}`;
  const previous = effectNextPlay.get(key);

  if (previous && time < previous[0] - 1e-9 && volume <= previous[1]) return;

  effectNextPlay.forEach(([deadline], key) => {
    if (deadline <= context.currentTime) {
      effectNextPlay.delete(key);
    }
  });

  effectNextPlay.set(key, [time + 0.1, volume]);

  const prepared = prepareBuffer(entry, context);

  if (prepared) {
    return startSound(context, prepared, { time, volume });
  }

  playWhenReady(entry, (buffer) => {
    if (context.state === 'running') {
      startSound(context, buffer, {
        time: Math.max(context.currentTime, time),
        volume,
      });
    }
  });
};

export const continuousSound = (
  sound: Sound | 0,
  level: number,
  playbackRate = level ? 1 - level / 80 : 0.4,
  engine = 0,
) => {
  if (!audio || audio.state !== 'running') return sound;

  if (!sound && !level) return;
  sound ||= tone(engine);

  if (!sound) return sound;
  const duration = loopSettings[engine].ramp;

  if (sound.pitch !== playbackRate) {
    ramp(sound.playbackRate, (sound.pitch = playbackRate), duration);
  }

  if (level === sound.level) return sound;

  const time = ramp(sound.gain, level, duration);

  sound.level = level;

  if (!level) return sound.stop(time);

  return sound;
};

/**
 * Keep the motor running while scheduling independent clicks on the audio clock.
 */
export const updateAutogunSound = (
  state:
    | {
        motor?: Sound;
        clickSource?: AudioBufferSourceNode;
        clickTime: number;
        speed: number;
      }
    | undefined,
  {
    level,
    speed = 0,
    interval = 0.2,
    id = 0,
    by = 0,
  }: {
    level: number;
    speed?: number;
    interval?: number;
    id?: number;
    by?: number;
  },
) => {
  if (!audio) return state;
  const time = audio.currentTime;

  if (!level) {
    if (state) {
      if (state.clickTime > time) state.clickSource?.stop();

      if (audio.state === 'running') {
        continuousSound(state.motor, 0, 1, 2);
      } else {
        state.motor?.stop();
      }
    }

    return;
  }

  if (audio.state !== 'running') return state;

  state ||= { clickTime: time, speed: 0 };
  state.motor = continuousSound(state.motor, level, 1, 2) || undefined;
  state.speed = speed;

  if (!speed) {
    if (state.clickTime > time) state.clickSource?.stop();
    state.clickSource = undefined;
    state.clickTime = time;
  } else {
    const next = state.clickTime + Math.max(0.1, interval / speed);

    if (
      next <= time + 0.04 + 1e-9 &&
      autogunClickBuffer &&
      prepareBuffer(autogunClickBuffer, audio)
    ) {
      state.clickTime = Math.max(time, next);

      state.clickSource = playSound('autogun-click', {
        volume: level,
        id,
        by,
        time: state.clickTime,
      });
    }
  }

  return state;
};

// One engine voice for the whole ship, independent of its nozzle count.
export const updateThrusterSound = (
  sound: Sound | 0 | undefined,
  {
    power,
    load = 0,
    volume = 1,
  }: { power: number; load?: number; volume?: number },
) => {
  const settings = engineSettings;
  const revs = load * settings.revRange;

  return continuousSound(
    sound,
    power * (settings.idleVolume + revs) * volume * settings.volume,
    settings.basePitch + revs,
    1,
  );
};

export default {
  unlockAudio,
  playNavigationSound,
  playSound,
  continuousSound,
  updateThrusterSound,
  updateAutogunSound,
  // @ifdef DEBUG
  testTone,
  // @endif
};
