import { type PlayerInput } from '../protocol/input';
import { type moduleControls } from '../objects/control-ship';
import {
  plasmaAcceleratorName,
  autogunName,
  laserName,
  hornDrillName,
  cargoHatchName,
  searchLightName,
  shieldGeneratorName,
} from '../../specs/modules/names';

export type KeyAction =
  | 'fire'
  | 'plasmaActive'
  | 'autogunActive'
  | 'laserActive'
  | 'forwardThrust'
  | 'turnLeft'
  | 'turnRight'
  | 'hornDrill'
  | 'cargoHatch'
  | 'searchLight'
  | 'shieldGenerator';

export type KeyBinding = {
  keys: readonly string[];
  mode: 'hold' | 'toggle';
};

export type Keybindings = Record<KeyAction, KeyBinding>;

// Keys use KeyboardEvent.key names, compared without case. Each action keeps
// an array so a later player profile can assign several keys to one action.
export const defaultKeybindings = {
  fire: { keys: [' '], mode: 'hold' },
  plasmaActive: { keys: ['p'], mode: 'toggle' },
  autogunActive: { keys: ['a'], mode: 'toggle' },
  laserActive: { keys: ['b'], mode: 'toggle' },
  forwardThrust: { keys: ['ArrowUp'], mode: 'hold' },
  turnLeft: { keys: ['ArrowLeft'], mode: 'hold' },
  turnRight: { keys: ['ArrowRight'], mode: 'hold' },
  hornDrill: { keys: ['d'], mode: 'toggle' },
  cargoHatch: { keys: ['h'], mode: 'toggle' },
  searchLight: { keys: ['l'], mode: 'toggle' },
  shieldGenerator: { keys: ['s'], mode: 'toggle' },
} satisfies Keybindings;

// Module actions are one-byte protocol tags; binding fields are mangled
// properties. Resolve the tag before accessing a field.
export const moduleBinding = (
  action: (typeof moduleControls)[number]['input'],
): KeyBinding => {
  switch (action) {
    case 'cargoHatch':
      return defaultKeybindings.cargoHatch;

    case 'searchLight':
      return defaultKeybindings.searchLight;

    case 'shieldGenerator':
      return defaultKeybindings.shieldGenerator;

    case 'plasmaActive':
      return defaultKeybindings.plasmaActive;

    case 'laserActive':
      return defaultKeybindings.laserActive;

    case 'autogunActive':
      return defaultKeybindings.autogunActive;

    case 'hornDrill':
      return defaultKeybindings.hornDrill;
  }
};

export const matchesBinding = (binding: KeyBinding, key: string) =>
  binding.keys.some((boundKey) => boundKey.toLowerCase() === key);

export const updateMovement = (
  pressed: ReadonlySet<string>,
  input: PlayerInput,
) => {
  const held = (binding: KeyBinding) =>
    binding.keys.some((key) => pressed.has(key.toLowerCase()));

  input.fire = held(defaultKeybindings.fire);
  input.thrust = Number(held(defaultKeybindings.forwardThrust));
  input.turn =
    Number(held(defaultKeybindings.turnRight)) -
    Number(held(defaultKeybindings.turnLeft));
};

export const bindingEntries: [string, KeyBinding][] = [
  ['Forward thrust', defaultKeybindings.forwardThrust],
  ['Turn left', defaultKeybindings.turnLeft],
  ['Turn right', defaultKeybindings.turnRight],
  ['Fire weapons', defaultKeybindings.fire],
  [plasmaAcceleratorName, defaultKeybindings.plasmaActive],
  [autogunName, defaultKeybindings.autogunActive],
  [laserName, defaultKeybindings.laserActive],
  [hornDrillName, defaultKeybindings.hornDrill],
  [cargoHatchName, defaultKeybindings.cargoHatch],
  [searchLightName, defaultKeybindings.searchLight],
  [shieldGeneratorName, defaultKeybindings.shieldGenerator],
];
const originalKeys = bindingEntries.map(([, binding]) => [...binding.keys]);

export const saveBindings = () => {
  try {
    localStorage.setItem(
      'unicorn-controls',
      JSON.stringify(bindingEntries.map(([, binding]) => binding.keys)),
    );
  } catch {
    /* Keep this visit's bindings. */
  }
};

export const resetBindings = () => {
  bindingEntries.forEach(
    ([, binding], i) => (binding.keys = [...originalKeys[i]]),
  );
  saveBindings();
};

try {
  const saved = JSON.parse(localStorage.getItem('unicorn-controls') || 'null');

  if (
    Array.isArray(saved) &&
    saved.length === bindingEntries.length &&
    saved.every(
      (keys) =>
        Array.isArray(keys) &&
        keys.length &&
        keys.every((key) => typeof key === 'string' && key.length < 30),
    )
  ) {
    bindingEntries.forEach(([, binding], i) => (binding.keys = saved[i]));
  }
} catch {
  /* Defaults work without storage. */
}
