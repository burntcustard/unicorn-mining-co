import { drawHullSegment } from './hull-rendering';
import { withAlpha } from '../utilities/color';
import { renderingLayers } from '../../specs/rendering-layers';
import { shapePath } from '../utilities/drawing';
import { game } from '../game';
import { colors } from '../../specs/colors';
import { drawDockingBayGlow } from '../utilities/lighting';
import { stationSpecsById, type StationId } from '../../specs/stations';
import * as Vec from '../utilities/vector';
import { Craft, type CraftRenderOptions } from './craft';
import { type StationSpec } from '../../specs/stations/types';
import { Item } from './item';
import { itemSpecs } from '../../specs/items';
import { entityId } from '../simulation/world';
import {
  composedSurfaces,
  renderSurface,
} from '../utilities/composited-surface';

const guides = new WeakMap<Station, { radius: number }>();

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

    if (!properties.cargoContents && this.world) {
      this.world.nextEntityId = Math.max(this.world.nextEntityId, this.id + 1);

      this.cargoContents = spec.initialCargoContents.flatMap(
        ({ item, count }) =>
          Array.from(
            { length: count },
            () =>
              new Item(itemSpecs[item], {
                world: this.world,
                id: entityId(this.world!),
              }),
          ),
      );
    }
  }

  holds(child: { position: Vec.Value }) {
    return (
      Vec.distanceSquared(child.position, this.position) <=
      this.localMovementRadius ** 2
    );
  }

  render({
    zIndex = renderingLayers.shipHull,
    guide = true,
    ...options
  }: CraftRenderOptions & { guide?: boolean } = {}) {
    const { ctx } = game;

    if (
      composedSurfaces(ctx) &&
      zIndex === renderingLayers.stationFloor &&
      ctx.canvas === game.canvas &&
      game.canvas?.isConnected
    ) {
      const pose = options.pose || this;

      ctx.save();
      ctx.translate(pose.position.x, pose.position.y);
      ctx.rotate(pose.rotation);

      if (guide && this.localMovementRadius) {
        const radius = this.localMovementRadius;
        let cached = guides.get(this);

        if (cached?.radius !== radius) {
          cached = { radius };
          guides.set(this, cached);
        }

        guide = !renderSurface({
          ctx,
          key: cached,
          cache: cached,
          floor: true,
          bounds: {
            left: -radius - 3,
            right: radius + 3,
            top: -radius - 3,
            bottom: radius + 3,
          },
          draw: (paint) => {
            paint.strokeStyle = withAlpha({
              color: colors.cyan[2],
              alpha: 0.4,
            });

            paint.lineWidth = 3;
            paint.setLineDash([12, 12]);
            paint.beginPath();
            paint.arc(0, 0, radius, 0, Math.PI * 2);
            paint.stroke();
          },
        });
      }

      ctx.restore();

      // Previews draw the guide below when no composed world frame is active.
      // Bay halves and their glows always stay on the foreground canvas.
    }

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
          !this.localMovementRadius ||
          !guide
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
      drawHull: (options) => drawHullSegment({ ctx, ...options }),
    });
  }
}
