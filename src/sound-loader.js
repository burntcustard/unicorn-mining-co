// Fetch and execute the audio implementation only after a genuine user gesture.
// Calls made before that gesture retain the old behaviour and are ignored.
let loading;
let sound;

const loadSound = () => loading ||= import('./sound').then(
  (module) => sound = module.default,
);

export const unlockAudio = () => loadSound().then((module) => module.unlockAudio());

export const playSound = (effect) => {
  if (sound) return sound.playSound(effect);

  return loading?.then((module) => module.playSound(effect));
};

export const continuousSound = (currentSound, ...settings) =>
  sound ? sound.continuousSound(currentSound, ...settings) : currentSound;

export const updateThrusterSound = (...settings) =>
  sound?.updateThrusterSound(...settings);

// @ifdef DEBUG
export const testTone = () => loadSound().then((module) => module.testTone());
// @endif
