import { colors } from './colors';
import { init } from './core';

const { canvas, context } = init();

canvas.style = `display:block;width:100%;background:${colors.purple[0]}`;

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
