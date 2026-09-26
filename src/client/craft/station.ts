import { Station } from '../../shared/craft/station';
import { giveRender } from '../give-render';
import { drawSegment, shapePath } from '../drawing';
import { game } from '../game';
import { colors } from '../../shared/colors';
import { type Pose, type Segment } from '../../shared/types';
import { drawDockingBayGlow, hullSegmentFill } from '../lighting';
import './craft';

giveRender({
  Type: Station,
  render({ parent, zIndex = 0, ...options }) {
    const { ctx } = game;

    parent({
      ...options,
      zIndex,
      draw: () => {
        if (zIndex !== -3 || !this.localMovementRadius) return;
        ctx.strokeStyle = `${colors.cyan[2]}6`;
        ctx.setLineDash([12, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, this.localMovementRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      },
      drawHull: ({
        segment,
        health,
        pose,
      }: {
        segment: Segment;
        health: number;
        pose: Pose;
      }) => {
        if (segment.glow) segment.glow.path ||= shapePath(segment.glow);

        if (segment.glow && zIndex < 0) {
          drawDockingBayGlow(
            ctx,
            segment.glow.path,
            segment.shades[2],
            segment.glow,
          );
        }

        const worn = health < segment.module.health / 2 ? 0 : +!!segment.hull;

        ctx.fillStyle = hullSegmentFill({
          ctx,
          segment,
          worn,
          rotation: pose.rotation,
        });
        ctx.strokeStyle = segment.shades[2];
        drawSegment({ ctx, segment });

        if (segment.glow && zIndex > 0) {
          drawDockingBayGlow(
            ctx,
            segment.glow.path,
            segment.shades[2],
            segment.glow,
          );
        }
      },
    });
  },
});
