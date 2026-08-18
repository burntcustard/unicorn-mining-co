import { colors } from './colors';
import { init } from 'kontra';

const { canvas, context } = init();

canvas.style = `display:block;width:100%;background:${colors.purple[0]}`;

export const game = {
  canvas,
  ctx: context,
  size: 1.5,
  // scale, width & height are set by setSizing()
};
