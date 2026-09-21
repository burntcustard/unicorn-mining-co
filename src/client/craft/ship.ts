import { Ship } from '../../shared/craft/ship';
import { giveRender } from '../give-render';
import { drawSegment } from '../drawing';
import { game } from '../game';
import { type Segment } from '../../shared/types';
import './craft';

giveRender({
  Type: Ship,
  render({ parent, ...options }) {
    parent({
      ...options,
      drawHull: ({ segment, health }: { segment: Segment; health: number }) => {
        const { ctx } = game;
        const worn = health < segment.module.health / 2 ? 0 : +!!segment.hull;
        ctx.fillStyle = segment.fillAlpha
          ? segment.shades[2] + segment.fillAlpha
          : segment.shades[worn];
        ctx.strokeStyle = segment.shades[2];
        drawSegment({ ctx, segment });
      },
    });
  },
});
