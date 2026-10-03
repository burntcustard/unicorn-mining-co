import { Ship } from '../../objects/ship';
import { giveRender } from '../give-render';
import { drawSegment } from '../drawing';
import { game } from '../../game';
import { type Pose, type Segment } from '../../types';
import { hullSegmentFill } from '../lighting';
import './craft';

giveRender({
  Type: Ship,
  render({ parent, ...options }) {
    parent({
      ...options,
      drawHull: ({
        segment,
        health,
        pose,
      }: {
        segment: Segment;
        health: number;
        pose: Pose;
      }) => {
        const { ctx } = game;
        const worn = health < segment.module.health / 2 ? 0 : +!!segment.hull;

        ctx.fillStyle = hullSegmentFill({
          ctx,
          segment,
          worn,
          rotation: pose.rotation,
        });
        ctx.strokeStyle = segment.shades[2];
        drawSegment({ ctx, segment });
      },
    });
  },
});
