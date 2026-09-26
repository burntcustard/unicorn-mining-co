import { Module } from '../../shared/modules/module';
import { giveRender } from '../give-render';
import { game } from '../game';
import { circlePath, shapePath, linesPath } from '../drawing';
import '../game-object';

giveRender({
  Type: Module,
  render({ segment, points, draw, parent }) {
    parent({
      draw: () => {
        if (draw) {
          draw();
          return;
        }
        const { ctx } = game;
        const shapeOutline =
          points ??
          (typeof segment.points === 'function'
            ? segment.points(segment)
            : segment.points);
        const shape = shapeOutline?.length
          ? shapePath(shapeOutline, segment.unclosed)
          : segment.radius
            ? circlePath(segment.radius(segment))
            : undefined;

        if (!shape) return;
        const shades = this.shades || segment.shades;

        // Modules wear their darkest shade, a step below the hull's.
        ctx.fillStyle = segment.fillAlpha
          ? shades[2] + segment.fillAlpha
          : shades[0];
        ctx.strokeStyle = shades[2];
        ctx.fill(shape);
        ctx.stroke(
          segment.shapeOutline ? linesPath(segment.shapeOutline) : shape,
        );
      },
    });
  },
});
