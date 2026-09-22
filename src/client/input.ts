import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../shared/protocol/input';
import { moduleControls } from '../shared/craft/control-ship';
import { unlockAudio } from './sound-loader';

const callbacks = new Map<string, (event: KeyboardEvent) => void>();
const pressed = new Set<string>();
export const playerInput = emptyPlayerInput();

export const bindKeys = (
  key: string,
  callback: (event: KeyboardEvent) => void,
) => callbacks.set(key.toLowerCase(), callback);

export const initKeys = ({
  onChange = () => {},
}: {
  onChange?: (input: PlayerInput) => void;
} = {}) => {
  const notify = (previous: PlayerInput) => {
    if (!sameInput(previous, playerInput)) onChange({ ...playerInput });
  };
  const updateMovement = () => {
    playerInput.thrust = Number(pressed.has('arrowup'));
    playerInput.turn =
      Number(pressed.has('arrowright')) - Number(pressed.has('arrowleft'));
  };
  const keyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key.startsWith('arrow') || key === ' ') event.preventDefault();
    if (event.repeat || pressed.has(key)) return;
    unlockAudio();
    const previous = { ...playerInput };
    pressed.add(key);
    updateMovement();
    moduleControls.forEach(({ Type, input }) => {
      if (key === Type.label[0].toLowerCase())
        playerInput[input] = !playerInput[input];
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
