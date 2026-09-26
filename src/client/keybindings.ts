import { type PlayerInput } from '../shared/protocol/input';
import { type moduleControls } from '../shared/craft/control-ship';

export type KeyAction =
  | 'forwardThrust'
  | 'turnLeft'
  | 'turnRight'
  | 'hornDrill'
  | 'cargoHatch'
  | 'searchLight'
  | 'shieldGenerator'
  | 'menuLeft'
  | 'menuRight'
  | 'menuUp'
  | 'menuDown'
  | 'menuBack'
  | 'menuSelect';

export type KeyBinding = {
  keys: readonly string[];
  mode: 'hold' | 'toggle' | 'press';
};

export type Keybindings = Record<KeyAction, KeyBinding>;

// Keys use KeyboardEvent.key names, compared without case. Each action keeps
// an array so a later player profile can assign several keys to one action.
export const defaultKeybindings = {
  forwardThrust: { keys: ['ArrowUp'], mode: 'hold' },
  turnLeft: { keys: ['ArrowLeft'], mode: 'hold' },
  turnRight: { keys: ['ArrowRight'], mode: 'hold' },
  hornDrill: { keys: ['d'], mode: 'toggle' },
  cargoHatch: { keys: ['h'], mode: 'toggle' },
  searchLight: { keys: ['l'], mode: 'toggle' },
  shieldGenerator: { keys: ['s'], mode: 'toggle' },
  menuLeft: { keys: ['ArrowLeft'], mode: 'press' },
  menuRight: { keys: ['ArrowRight'], mode: 'press' },
  menuUp: { keys: ['ArrowUp'], mode: 'press' },
  menuDown: { keys: ['ArrowDown'], mode: 'press' },
  menuBack: { keys: ['Escape'], mode: 'press' },
  menuSelect: { keys: [' '], mode: 'press' },
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

  input.thrust = Number(held(defaultKeybindings.forwardThrust));
  input.turn =
    Number(held(defaultKeybindings.turnRight)) -
    Number(held(defaultKeybindings.turnLeft));
};
