import { withAlpha } from '../utilities/color';
import { renderingLayers } from '../../specs/rendering-layers';
import { drawSegment, shapePath } from '../utilities/drawing';
import { game } from '../game';
import { colors } from '../../specs/colors';
import { type Pose, type Segment } from '../types';
import { drawDockingBayGlow, hullSegmentFill } from '../utilities/lighting';
import { stationSpecsById, type StationId } from '../../specs/stations';
import * as Vec from '../utilities/vector';
import { Craft, type CraftRenderOptions } from './craft';
import { type StationSpec } from '../../specs/stations/types';

export class Station extends Craft {
  kind = 'station';
  dockingBays: number[];

  constructor({
    stationType = 'corral-5',
    spec = stationSpecsById.get(stationType),
    ...properties
  }: ConstructorParameters<typeof Craft>[0] & {
    stationType?: StationId;
    spec?: StationSpec;
  } = {}) {
    if (!spec) {
      throw new Error(`Unknown station spec: ${stationType}`);
    }

    super({ ...spec, ...properties });
    this.dockingBays = spec.dockingBays;
    this.definitionId = stationType === 'corral-5' ? undefined : stationType;
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
        // Keep the lower glow beneath both translucent bay halves so their
        // compositing matches at the seam.
        const glowLayer =
          zIndex === renderingLayers.stationFloor
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

        ctx.strokeStyle = withAlpha({ color: colors.cyan[2], alpha: 0.4 });
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
