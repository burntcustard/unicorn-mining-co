// Fetch and execute the audio implementation only after a genuine user gesture.
// Calls made before that gesture retain the old behaviour and are ignored.
type SoundModule = (typeof import('./sound'))['default'];

let loading: Promise<SoundModule> | undefined;
let sound: SoundModule | undefined;

const loadSound = () =>
  (loading ||= import('./sound').then(
    ({ default: module }) => (sound = module),
  ));

export const unlockAudio = () =>
  loadSound().then((module) => module.unlockAudio());

export const playSound = (effect: number) => {
  if (sound) return sound.playSound(effect);

  return loading?.then((module) => module.playSound(effect));
};

export const continuousSound = (
  currentSound: Parameters<SoundModule['continuousSound']>[0],
  ...settings: [number, number?, number?]
) => (sound ? sound.continuousSound(currentSound, ...settings) : currentSound);

export const updateThrusterSound = (
  ...settings: Parameters<SoundModule['updateThrusterSound']>
) => sound?.updateThrusterSound(...settings);

// @ifdef DEBUG
export const testTone = () => loadSound().then((module) => module.testTone());
// @endif
