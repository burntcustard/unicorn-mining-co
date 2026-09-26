import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../shared/protocol/input';
import {
  defaultKeybindings,
  matchesBinding,
  updateMovement,
  type KeyBinding,
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
  binding: KeyBinding,
  callback: (event: KeyboardEvent) => void,
) => binding.keys.forEach((key) => bindKeys(key, callback));

export const initKeys = ({
  onChange = () => {},
  onKeyDown,
}: {
  onChange?: (input: PlayerInput) => void;
  onKeyDown?: (event: KeyboardEvent) => boolean;
} = {}) => {
  const notify = (previous: PlayerInput) => {
    updateMovement(pressed, playerInput);

    if (!sameInput(previous, playerInput)) onChange({ ...playerInput });
  };

  const keyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();

    if (key.startsWith('arrow') || key === ' ') event.preventDefault();

    if (event.repeat || pressed.has(key)) return;
    unlockAudio();

    if (onKeyDown?.(event)) return;
    const previous = { ...playerInput };

    pressed.add(key);

    if (matchesBinding(defaultKeybindings.hornDrill, key)) {
      playerInput.hornDrill = !playerInput.hornDrill;
    }

    if (matchesBinding(defaultKeybindings.cargoHatch, key)) {
      playerInput.cargoHatch = !playerInput.cargoHatch;
    }

    if (matchesBinding(defaultKeybindings.searchLight, key)) {
      playerInput.searchLight = !playerInput.searchLight;
    }

    if (matchesBinding(defaultKeybindings.shieldGenerator, key)) {
      playerInput.shieldGenerator = !playerInput.shieldGenerator;
    }
    notify(previous);
    callbacks.get(key)?.(event);
  };

  const keyUp = (event: KeyboardEvent) => {
    const previous = { ...playerInput };

    pressed.delete(event.key.toLowerCase());
    notify(previous);
  };

  const blur = () => {
    const previous = { ...playerInput };

    pressed.clear();
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
