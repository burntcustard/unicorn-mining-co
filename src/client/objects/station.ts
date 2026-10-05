import { drawSegment, shapePath } from '../utilities/drawing';
import { game } from '../game';
import { colors } from '../../definitions/colors';
import { type Pose, type Segment } from '../types';
import { drawDockingBayGlow, hullSegmentFill } from '../utilities/lighting';
import {
  stationDefinitionsById,
  type StationId,
} from '../../definitions/stations';
import * as Vec from '../utilities/vector';
import { Craft, type CraftRenderOptions } from './craft';

export class Station extends Craft {
  kind = 'station';

  constructor({
    stationType = 'corral',
    ...properties
  }: ConstructorParameters<typeof Craft>[0] & {
    stationType?: StationId;
  } = {}) {
    const definition = stationDefinitionsById.get(stationType);

    if (!definition) {
      throw new Error(`Unknown station definition: ${stationType}`);
    }

    super({ ...definition, ...properties });
    this.definitionId = stationType === 'corral' ? undefined : stationType;
  }

  holds(child: { position: Vec.Value }) {
    return (
      Vec.distanceSquared(child.position, this.position) <=
      this.localMovementRadius ** 2
    );
  }

  render({ zIndex = 0, ...options }: CraftRenderOptions = {}) {
    const { ctx } = game;

    super.render({
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
  }
}
