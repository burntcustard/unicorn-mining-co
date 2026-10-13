import { withAlpha } from '../utilities/color';

export interface PathOutlineOptions {
  ctx: CanvasRenderingContext2D;
  path: Path2D;
  radius?: number;
  strokeStyle?: string;
}

export const pathOutline = ({
  ctx,
  path,
  radius = 1,
  strokeStyle = withAlpha({ color: '#000', alpha: 0.5 }),
}: PathOutlineOptions) => {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  // A wider round stroke covers the same small halo as translated copies,
  // without sending sixteen overlapping contours through the canvas stroker.
  ctx.lineWidth += radius * 2;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.stroke(path);
  ctx.restore();
};
