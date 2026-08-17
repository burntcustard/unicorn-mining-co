import { init } from 'kontra';

const { canvas, context } = init();

canvas.style = 'width:100%;background:#000';

export const game = {
  canvas,
  ctx: context,
  size: 1,
  // scale, width & height are set by setSizing()
};
