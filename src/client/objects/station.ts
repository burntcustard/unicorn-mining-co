import { renderingLayers } from '../../definitions/rendering-layers';
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
import { type StationDefinition } from '../../definitions/stations/types';

export class Station extends Craft {
  kind = 'station';

  constructor({
    stationType = 'corral',
    definition = stationDefinitionsById.get(stationType),
    ...properties
  }: ConstructorParameters<typeof Craft>[0] & {
    stationType?: StationId;
    definition?: StationDefinition;
  } = {}) {
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

  render({
    zIndex = renderingLayers.shipHull,
    ...options
  }: CraftRenderOptions = {}) {
    const { ctx } = game;

    super.render({
      ...options,
      zIndex,
      draw: () => {
        const glowLayer =
          zIndex === renderingLayers.glowBelowStations
            ? renderingLayers.stationFloor
            : zIndex === renderingLayers.glowAboveStations
              ? renderingLayers.modulesAboveStationHull
              : undefined;

        if (glowLayer !== undefined) {
          this.segments.forEach((segment) => {
            if (
              !segment.glow ||
              segment.zIndex !== glowLayer ||
              (segment.mount || segment).health < 1
            ) {
              return;
            }

            segment.glow.path ||= shapePath(segment.glow);
            ctx.save();
            ctx.translate(segment.localPosition.x, segment.localPosition.y);
            drawDockingBayGlow(
              ctx,
              segment.glow.path,
              segment.shades[2],
              segment.glow,
            );
            ctx.restore();
          });
        }

        if (
          zIndex !== renderingLayers.stationFloor ||
          !this.localMovementRadius
        ) {
          return;
        }

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
  }
}
