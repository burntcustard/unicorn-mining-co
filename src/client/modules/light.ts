import { Light } from '../../shared/modules/light';
import { giveRender } from '../give-render';
import { game } from '../game';
import { shapePath } from '../drawing';
import { drawBeam } from '../lighting';
import { traceBeam, litPath } from '../prism';
import './module';

giveRender({
  Type: Light,
  render({ segment, craft, scenery, parent, pose = craft }) {
    if (!segment.activationProgress) return;
    const beam = segment.prism || traceBeam(pose, segment, scenery);

    parent({
      segment,
      draw: () =>
        drawBeam(
          game.ctx,
          shapePath(segment.points(segment)),
          segment.shades[2],
          this.reach,
          segment.activationProgress,
          litPath(beam),
        ),
    });
  },
});
