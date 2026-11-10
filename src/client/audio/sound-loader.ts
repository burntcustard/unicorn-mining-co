import { audio, unlockAudio } from './audio-context';

export { unlockAudio };

// Prepare audio code in the menu; create its context only on a user gesture.
type SoundModule = (typeof import('./sound'))['default'];

let loading: Promise<SoundModule> | undefined;
let sound: SoundModule | undefined;

export const preloadSound = () =>
  (loading ||= import('./sound')
    .then(({ default: module }) => (sound = module))
    .catch((error) => {
      loading = undefined;
      throw error;
    }));

export const playNavigationSound = (
  cue: Parameters<SoundModule['playNavigationSound']>[0],
) => {
  if (!sound) {
    void preloadSound()
      .then((module) => module.playNavigationSound(cue))
      .catch(() => {});
  }

  void unlockAudio()?.catch(() => {});

  sound?.playNavigationSound(cue);
};

export const playHoverSound = () => {
  if (audio && audio.state === 'running') sound?.playNavigationSound(0);
};

export const playSound = (
  ...settings: Parameters<SoundModule['playSound']>
) => {
  if (sound) return sound.playSound(...settings);

  return loading?.then((module) => module.playSound(...settings));
};

export const continuousSound = (
  currentSound: Parameters<SoundModule['continuousSound']>[0],
  ...settings: [number, number?, number?]
) => (sound ? sound.continuousSound(currentSound, ...settings) : currentSound);

export const updateThrusterSound = (
  ...settings: Parameters<SoundModule['updateThrusterSound']>
) => sound?.updateThrusterSound(...settings);

export const updateAutogunSound = (
  ...settings: Parameters<SoundModule['updateAutogunSound']>
) => (sound ? sound.updateAutogunSound(...settings) : settings[0]);

// @ifdef DEBUG
export const testTone = () =>
  preloadSound().then((module) => module.testTone());
// @endif
