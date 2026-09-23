import { Horn } from '../../shared/modules/horn';
import { giveRender } from '../give-render';
import { game } from '../game';
import { linesPath, shapePath } from '../drawing';
import './module';

giveRender({
  Type: Horn,
  render({ segment, parent }) {
    parent({ segment });
    const { ctx } = game;

    ctx.save();
    ctx.strokeStyle = (this.shades || segment.shades)[2];
    ctx.clip(shapePath(segment.points));
    ctx.stroke(
      linesPath(
        Array.from({ length: 6 }, (_, index) => {
          const middle = 3 + (index - 1 + (segment.phase || 0)) * 6;

          return [
            [middle - 3, -6],
            [middle + 3, 6],
          ];
        }),
      ),
    );
    ctx.restore();
  },
  updateVisual({ dt, segments }) {
    segments.forEach((segment: any) => {
      segment.phase =
        ((segment.phase || 0) + dt * 1.5 * segment.activationProgress) % 1;
    });
  },
});
