import { init } from './core';

const { canvas, context } = init();

export const forget = (list, entry) => list.splice(list.indexOf(entry), 1);

export const game = {
  canvas,
  crafts: [],
  ctx: context,
  items: [],
  // @ifdef DEBUG
  physicsOn: true,
  // @endif
  size: 1.5,
  sprites: [],
  // scale, width & height are set by setSizing()
};
