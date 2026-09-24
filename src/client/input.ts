import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../shared/protocol/input';
import {
  defaultKeybindings,
  matchesBinding,
  type KeyAction,
} from './keybindings';
import { unlockAudio } from './sound-loader';

const callbacks = new Map<string, (event: KeyboardEvent) => void>();
const pressed = new Set<string>();

export const playerInput = emptyPlayerInput();

export const bindKeys = (
  key: string,
  callback: (event: KeyboardEvent) => void,
) => callbacks.set(key.toLowerCase(), callback);

export const bindAction = (
  action: KeyAction,
  callback: (event: KeyboardEvent) => void,
) => defaultKeybindings[action].keys.forEach((key) => bindKeys(key, callback));

export const initKeys = ({
  onChange = () => {},
}: {
  onChange?: (input: PlayerInput) => void;
} = {}) => {
  const notify = (previous: PlayerInput) => {
    if (!sameInput(previous, playerInput)) onChange({ ...playerInput });
  };
  const updateMovement = () => {
    const held = (action: KeyAction) =>
      defaultKeybindings[action].keys.some((key) =>
        pressed.has(key.toLowerCase()),
      );

    playerInput.thrust = Number(held('forwardThrust'));
    playerInput.turn = Number(held('turnRight')) - Number(held('turnLeft'));
  };
  const keyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();

    if (key.startsWith('arrow') || key === ' ') event.preventDefault();

    if (event.repeat || pressed.has(key)) return;
    unlockAudio();
    const previous = { ...playerInput };

    pressed.add(key);
    updateMovement();
    (
      ['hornDrill', 'cargoHatch', 'searchLight', 'shieldGenerator'] as const
    ).forEach((action) => {
      if (matchesBinding(defaultKeybindings[action], key)) {
        playerInput[action] = !playerInput[action];
      }
    });
    notify(previous);
    callbacks.get(key)?.(event);
  };
  const keyUp = (event: KeyboardEvent) => {
    const previous = { ...playerInput };

    pressed.delete(event.key.toLowerCase());
    updateMovement();
    notify(previous);
  };
  const blur = () => {
    const previous = { ...playerInput };

    pressed.clear();
    updateMovement();
    notify(previous);
  };

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
    blur();
  };
};
