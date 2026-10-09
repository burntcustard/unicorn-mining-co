import { withAlpha } from '../utilities/color';

export interface PathOutlineOptions {
  ctx: CanvasRenderingContext2D;
  path: Path2D;
  radius?: number;
  strokeStyle?: string;
}

const outlines = new WeakMap<Path2D, Map<number, Path2D>>();

export const pathOutline = ({
  ctx,
  path,
  radius = 1,
  strokeStyle = withAlpha({ color: '#000', alpha: 0.5 }),
}: PathOutlineOptions) => {
  let radii = outlines.get(path);

  if (!radii) {
    radii = new Map();
    outlines.set(path, radii);
  }

  let pathOutlinePath = radii.get(radius);

  if (!pathOutlinePath) {
    pathOutlinePath = new Path2D();

    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8;

      pathOutlinePath.addPath(path, {
        e: radius * Math.cos(angle),
        f: radius * Math.sin(angle),
      });
    }

    radii.set(radius, pathOutlinePath);
  }

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.stroke(pathOutlinePath);
  ctx.restore();
};
