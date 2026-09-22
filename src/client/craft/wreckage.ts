import { type Segment } from '../../shared/types';
import { drawSegment } from '../drawing';
import { game } from '../game';

/*
 * Detached hulls are bare Craft objects, without ship or station presentation.
 */
export const renderWreckage = ({
  segment,
  health,
}: {
  segment: Segment;
  health: number;
}) => {
  const { ctx } = game;
  const worn =
    segment.fillShade ?? (health < segment.module.health / 2 ? 0 : +!!segment.hull);
  ctx.fillStyle = segment.fillAlpha
    ? segment.shades[2] + segment.fillAlpha
    : segment.shades[worn];
  ctx.strokeStyle = segment.shades[2];
  drawSegment({ ctx, segment });
};
