import { emptyPlayerInput, type PlayerInput } from '../shared/protocol/input';
import { unlockAudio } from './sound-loader';

let callbacks: Record<string, (event: KeyboardEvent) => void> = {};
let start: ((event: KeyboardEvent) => void) | undefined;

export const downKeys: Record<string, number | boolean> = {
  ['ht']: 0,
  ['ft']: 0,
};

export const playerInput: PlayerInput = emptyPlayerInput();
const toggled: Record<string, boolean> = {
  ['d']: false,
  ['l']: false,
  ['h']: false,
  ['s']: false,
};

const readInput = () => {
  playerInput.thrust = downKeys['Up'] ? 1 : 0;
  playerInput.turn = Number(downKeys['ht']) - Number(downKeys['ft']);
  playerInput.drill = toggled['d'];
  playerInput.hatch = toggled['h'];
  playerInput.shield = toggled['s'];
  playerInput.light = toggled['l'];
};

const keyEventHandler = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase() === 'f' ? 'l' : event.key.slice(-2);

  unlockAudio();
  downKeys[key] = event.type === 'keydown';
  if (downKeys[key] && !event.repeat && key in toggled)
    toggled[key] = !toggled[key];
  readInput();

  if (downKeys[key] && !event.repeat) {
    start?.(event);
    callbacks[key]?.(event);
  }
};

export const initKeys = () =>
  (window.onkeyup = window.onkeydown = keyEventHandler);

export const bindKeys = (
  key: string,
  callback: (event: KeyboardEvent) => void,
) => (callbacks[key] = callback);

export const bindStart = (callback: (event: KeyboardEvent) => void) =>
  (start = callback);
