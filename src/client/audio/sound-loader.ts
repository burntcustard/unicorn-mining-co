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

export const unlockAudio = () =>
  sound
    ? sound.unlockAudio()
    : preloadSound().then((module) => module.unlockAudio());

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

// @ifdef DEBUG
export const testTone = () =>
  preloadSound().then((module) => module.testTone());
// @endif
