import plasmaAcceleratorReady from '../../specs/sounds/plasma-accelerator-ready';
import plasmaAcceleratorCharge from '../../specs/sounds/plasma-accelerator-charge';
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
import { renderContinuousBuffer, renderEffectBuffer } from './synthesis';
import { audio, unlockAudio } from './audio-context';

// The drill and engine use looped audio buffers with smooth parameter ramps.
const loopBuffers: (AudioBuffer | undefined)[] = [];
const effectBuffers: (AudioBuffer | undefined)[] = [];
const navigationBuffers: (AudioBuffer | undefined)[] = [];
const navigationSounds = [
  uiNavUp,
  uiNavNeutral,
  uiNavDown,
  uiNavUnselect,
  uiNavSelect,
];
const effectNextPlay = new Map<string, [number, number]>();
// Numeric IDs belong to the protocol; keep their event mapping explicit.
const events = [
  hatchOpen,
  hatchClose,
  pickup,
  crash,
  asteroidBreak,
  shieldBounce,
  shieldOn,
  shieldOff,
  ui,
  searchLight,
  // Client-only cue, addressed by name rather than a protocol sound ID.
  acquireTarget,
  loseTarget,
  wormholeIn,
  wormholeOut,
  jumpGateOpen,
  mainMenuClose,
  mainMenuOpen,
  chatMessage,
  autogunFire,
  autogunAmmoExplode,
  plasmaAcceleratorReady,
  plasmaAcceleratorFire,
  plasmaAcceleratorAmmoExplode,
  plasmaAcceleratorCharge,
];

interface Sound extends AudioBufferSourceNode {
  gain: AudioParam;
  level?: number;
  pitch?: number;
}

const navigationBuffer = (
  index: number,
  context: Pick<BaseAudioContext, 'createBuffer'>,
) =>
  (navigationBuffers[index] ||= renderEffectBuffer({
    context,
    layers: navigationSounds[index],
  }));

// Prepare the cues without opening an audio device before a user gesture.
if (
  typeof requestIdleCallback === 'function' &&
  typeof AudioBuffer === 'function'
) {
  const buffers: Pick<BaseAudioContext, 'createBuffer'> = {
    createBuffer: (numberOfChannels, length, sampleRate) =>
      new AudioBuffer({ numberOfChannels, length, sampleRate }),
  };

  const prepareNavigationSounds = (deadline: IdleDeadline) => {
    // Select is the longest cue, so give it the first idle window.
    for (let index = navigationSounds.length - 1; index >= 0; index--) {
      if (navigationBuffers[index]) continue;

      if (deadline.timeRemaining() < 5) {
        requestIdleCallback(prepareNavigationSounds);
        return;
      }

      navigationBuffer(index, buffers);
    }
  };

  requestIdleCallback(prepareNavigationSounds);
}

const playNavigationSound = (cue: -1 | 0 | 1 | 'select' | 'unselect') => {
  if (!audio || audio.state === 'closed') return;

  const index = cue === 'select' ? 4 : cue === 'unselect' ? 3 : cue + 1;
  const source = audio.createBufferSource();

  source.buffer = navigationBuffer(index, audio);
  source.connect(audio.destination);
  // Queue the cue while the context resumes so it can start on the audio clock.
  source.start();
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

/**
 * Start a looped sound, silent: the caller ramps `gain` and `playbackRate`
 * to the levels it wants.
 */
export const tone = (engine = 0) => {
  unlockAudio();

  const context = audio as AudioContext;
  const source = context.createBufferSource() as Sound;
  const gain = context.createGain();

  const kind = engine ? 'engine' : 'hornDrill';
  const settings = engine ? engineSettings : hornDrillSettings;

  source.buffer = loopBuffers[engine] ||= renderContinuousBuffer({
    context,
    kind,
    settings,
  });

  source.loop = true;
  source.connect(gain);
  gain.connect(context.destination);

  source.gain = gain.gain;
  source.gain.value = 0;
  source.playbackRate.value = settings.basePitch;
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

export const playSound = (
  effect:
    | number
    | 'acquire-target'
    | 'lose-target'
    | 'wormhole-in'
    | 'wormhole-out'
    | 'jump-gate-open'
    | 'main-menu-close'
    | 'main-menu-open'
    | 'chat-message'
    | 'autogun-fire'
    | 'autogun-ammo-explode'
    | 'plasma-accelerator-ready'
    | 'plasma-accelerator-charge'
    | 'plasma-accelerator-fire'
    | 'plasma-accelerator-ammo-explode',
  {
    volume = 1,
    id = 0,
    by = 0,
  }: { volume?: number; id?: number; by?: number } = {},
) => {
  if (typeof effect === 'string') {
    effect =
      [
        'acquire-target',
        'lose-target',
        'wormhole-in',
        'wormhole-out',
        'jump-gate-open',
        'main-menu-close',
        'main-menu-open',
        'chat-message',
        'autogun-fire',
        'autogun-ammo-explode',
        'plasma-accelerator-ready',
        'plasma-accelerator-fire',
        'plasma-accelerator-ammo-explode',
        'plasma-accelerator-charge',
      ].indexOf(effect) + 10;
  }

  // A real key gesture unlocks audio. Drop effects before that first gesture.
  if (
    !audio ||
    audio.state !== 'running' ||
    volume <= 0 ||
    !events[effect]?.length
  ) {
    return;
  }

  const time = audio.currentTime;

  const key = `${effect}:${id}:${by}`;
  const previous = effectNextPlay.get(key);

  if (previous && time < previous[0] && volume <= previous[1]) return;

  effectNextPlay.forEach(([deadline], key) => {
    if (deadline <= time) effectNextPlay.delete(key);
  });

  effectNextPlay.set(key, [time + 0.1, volume]);

  // All layers begin together; repeated events reuse the complete mix.
  effectBuffers[effect] ||= renderEffectBuffer({
    context: audio,
    layers: events[effect],
  });

  const source = (audio as AudioContext).createBufferSource();
  const gain = (audio as AudioContext).createGain();

  source.buffer = effectBuffers[effect];
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect((audio as AudioContext).destination);
  source.start();
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
  const duration = (engine ? engineSettings : hornDrillSettings).ramp;

  if (sound.pitch !== playbackRate) {
    ramp(sound.playbackRate, (sound.pitch = playbackRate), duration);
  }

  if (level === sound.level) return sound;

  const time = ramp(sound.gain, level, duration);

  sound.level = level;

  if (!level) return sound.stop(time);

  return sound;
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
  // @ifdef DEBUG
  testTone,
  // @endif
};
