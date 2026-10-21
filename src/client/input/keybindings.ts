import { type PlayerInput } from '../protocol/input';
import { type moduleControls } from '../objects/control-ship';
import { plasmaAccelerator } from '../../specs/modules/offense/plasma-accelerator';
import { autogun } from '../../specs/modules/offense/autogun';
import { laser } from '../../specs/modules/offense/laser';
import { hornDrill } from '../../specs/modules/offense/horn-drill';
import { cargoHatch } from '../../specs/modules/utility/cargo-hatch';
import { searchLight } from '../../specs/modules/utility/search-light';
import { shield } from '../../specs/modules/utility/shield';

export type KeyAction =
  | 'fire'
  | 'cargoRelease'
  | 'plasmaActive'
  | 'autogunActive'
  | 'laserActive'
  | 'forwardThrust'
  | 'turnLeft'
  | 'turnRight'
  | 'hornDrill'
  | 'cargoHatch'
  | 'searchLight'
  | 'shieldGenerator'
  | 'targetNext'
  | 'fpsCounter'
  | 'requestGateAccess';

export const bindingModes = ['hold', 'toggle'] as const;
// Keep saved mode IDs stable: 1 was the old module Press option.
const savedBindingModes = ['hold', 'press', 'toggle'] as const;

export type KeyBinding = {
  keys: readonly string[];
  mode: (typeof savedBindingModes)[number];
};

export type Keybindings = Record<KeyAction, KeyBinding>;

export const bindingModeLabel = (mode: KeyBinding['mode']) =>
  ['Hold', 'Press', 'Toggle'][savedBindingModes.indexOf(mode)];

// Keys use KeyboardEvent.key names, compared without case. Each action keeps
// an array so a later player profile can assign several keys to one action.
export const defaultKeybindings: Keybindings = {
  fire: { keys: [' '], mode: 'hold' },
  cargoRelease: { keys: ['h'], mode: 'hold' },
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
  targetNext: { keys: ['t'], mode: 'press' },
  fpsCounter: { keys: ['f'], mode: 'toggle' },
  requestGateAccess: { keys: ['r'], mode: 'press' },
};

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
  [plasmaAccelerator.name, defaultKeybindings.plasmaActive],
  [autogun.name, defaultKeybindings.autogunActive],
  [laser.name, defaultKeybindings.laserActive],
  [hornDrill.name, defaultKeybindings.hornDrill],
  [cargoHatch.name, defaultKeybindings.cargoHatch],
  [searchLight.name, defaultKeybindings.searchLight],
  [shield.name, defaultKeybindings.shieldGenerator],
  ['Target next object', defaultKeybindings.targetNext],
  ['Toggle FPS counter', defaultKeybindings.fpsCounter],
  ['Request access', defaultKeybindings.requestGateAccess],
  ['Release cargo', defaultKeybindings.cargoRelease],
];

// Derive input property names from object keys so production property mangling
// stays consistent without using gameplay tag strings as property names.
const moduleBindings = {
  plasmaActive: defaultKeybindings.plasmaActive,
  autogunActive: defaultKeybindings.autogunActive,
  laserActive: defaultKeybindings.laserActive,
  hornDrill: defaultKeybindings.hornDrill,
  cargoHatch: defaultKeybindings.cargoHatch,
  searchLight: defaultKeybindings.searchLight,
  shieldGenerator: defaultKeybindings.shieldGenerator,
  cargoRelease: defaultKeybindings.cargoRelease,
};

export const moduleKeyControls = Object.entries(moduleBindings).map(
  ([key, binding]) => {
    const property = key as keyof typeof moduleBindings;

    return {
      binding,
      readInput: (input: PlayerInput) => !!input[property],
      writeInput: (input: PlayerInput, active: boolean) => {
        input[property] = active;
      },
    };
  },
);

export const hasBindingMode = (binding: KeyBinding) =>
  moduleKeyControls.some((control) => control.binding === binding);

const originalBindings = bindingEntries.map(([, binding]) => ({
  keys: [...binding.keys],
  mode: binding.mode,
}));

export const saveBindings = () => {
  try {
    localStorage.setItem(
      'unicorn-controls',
      JSON.stringify(
        bindingEntries.map(([, binding]) => [
          binding.keys,
          savedBindingModes.indexOf(binding.mode),
        ]),
      ),
    );
  } catch {
    /* Keep this visit's bindings. */
  }
};

export const resetBindings = () => {
  bindingEntries.forEach(([, binding], i) => {
    binding.keys = [...originalBindings[i].keys];
    binding.mode = originalBindings[i].mode;
  });

  saveBindings();
};

try {
  const saved = JSON.parse(localStorage.getItem('unicorn-controls') || 'null');

  if (
    Array.isArray(saved) &&
    saved.length >= bindingEntries.length - 4 &&
    saved.length <= bindingEntries.length &&
    saved.every((entry) => {
      const keys = Array.isArray(entry?.[0]) ? entry[0] : entry;

      return (
        Array.isArray(keys) &&
        keys.length &&
        keys.every((key) => typeof key === 'string' && key.length < 30) &&
        (!Array.isArray(entry[0]) ||
          (Number.isInteger(entry[1]) &&
            entry[1] >= 0 &&
            entry[1] < savedBindingModes.length))
      );
    })
  ) {
    saved.forEach((entry, i) => {
      const binding = bindingEntries[i][1];

      if (Array.isArray(entry[0])) {
        binding.keys = entry[0];

        if (hasBindingMode(binding)) {
          binding.mode = entry[1] === 2 ? bindingModes[1] : 'hold';
        }
      } else {
        binding.keys = entry;
      }
    });
  }
} catch {
  /* Defaults work without storage. */
}

const keyLabels = new Map([
  [' ', 'Space'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
]);

/**
 * Human-readable keyboard labels shared by settings and flight instruments.
 */
export const keyLabel = (key: string) => keyLabels.get(key) || key;
