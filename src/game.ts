import { init } from './core';
import { type GameState } from './types';

const { canvas, context } = init();

export const forget = <Entry>(list: Entry[], entry: Entry) => {
  const index = list.indexOf(entry);

  if (index >= 0) list.splice(index, 1);
};

export const game = {
  canvas,
  crafts: [],
  ctx: context,
  // @ifdef DEBUG
  physicsOn: true,
  // @endif
  size: 1.5,
  sprites: [],
  uiAlpha: 0,
  uiVisible: 0,
  // scale, width & height are set by setSizing()
} as GameState;
