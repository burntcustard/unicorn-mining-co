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
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { Ship } from './ship';

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

  handleContacts({
    contacts,
    events,
  }: {
    contacts: Contact[];
    events: SimulationEvent[];
  }) {
    contacts.forEach(({ collider, other }) => {
      const bay =
        collider.owner === this
          ? collider
          : other.owner === this
            ? other
            : undefined;

      if (!bay?.dockSegment) return;
      const ship = (bay === collider ? other : collider).owner;

      if (
        !(ship instanceof Ship) ||
        !ship.cockpit ||
        ship.dockedTo ||
        ship.launching
      ) {
        return;
      }

      ship.dockedTo = this.id;
      Vec.set(ship.position, this.position);
      ship.rotation = this.rotation;
      Vec.set(ship.velocity, Vec.create());
      ship.spin = 0;

      if (ship.playerId !== undefined) {
        events.push({
          playerId: ship.playerId,
          stationId: this.id,
          type: 'docked',
        });
      }
    });
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
