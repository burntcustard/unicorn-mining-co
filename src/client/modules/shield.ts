import { Shield } from '../../shared/modules/shield';
import { giveRender } from '../give-render';
import { game } from '../game';
import { linesPath } from '../drawing';
import './module';

giveRender({
  Type: Shield,
  render({ segment, parent }) {
    parent({ segment });
    if (segment.covers) return;
    game.ctx.stroke(
      linesPath(
        [segment.phase || 0, (segment.phase || 0) + Math.PI / 2].map(
          (angle) => {
            const x = Math.cos(angle) * 7,
              y = Math.sin(angle) * 7;
            return [
              [-x, -y],
              [x, y],
            ];
          },
        ),
      ),
    );
  },
  updateVisual({ dt, segments }) {
    segments.forEach(
      (segment: any) =>
        (segment.phase =
          ((segment.phase || 0) + dt * 3 * segment.activationProgress) %
          (Math.PI / 2)),
    );
  },
});
