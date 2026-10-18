import { Passage, type PassageRenderOptions } from './passage';
import { makeSegment } from './hull-segments';
import { drawHullSegment } from './hull-rendering';
import {
  jumpGateSpec,
  jumpGateHull,
  jumpGateFlareDurationOuter,
  jumpGateFlareDurationInner,
  jumpGateThrustStartDelay,
  jumpGateThrustEndLead,
} from '../../specs/jump-gate';
import { ThrusterSingleMd } from './modules/thruster';
import { game } from '../game';
import { colors } from '../../specs/colors';
import { renderingLayers } from '../../specs/rendering-layers';
import { objectLineWidth } from '../utilities/drawing';
import { withAlpha } from '../utilities/color';
import { easeProgress } from '../utilities/ease';
import { approach } from '../utilities/approach';
import { rotatePoint } from '../utilities/geometry';
import { type Collider } from '../collision/types';
import * as Vec from '../utilities/vector';

// Presentation fades must survive prediction refreshing an entity's mechanics.
const flares = new WeakMap<
  JumpGate,
  { progress: number[]; targets: number[]; updatedAt: number }
>();

export class JumpGate extends Passage {
  kind = 'jumpGate';
  physics = true;
  name = 'Jump Gate';
  radius = jumpGateSpec.radius;
  travelRadius = jumpGateSpec.travelRadius;
  opening = 0;
  openingTarget = 0;
  blockedBeams = 0;
  shades = colors.white;
  segments = jumpGateHull.map((plan) => makeSegment(this, plan, plan));
  private engines = [new ThrusterSingleMd(), new ThrusterSingleMd()];

  constructor(properties: ConstructorParameters<typeof Passage>[0] = {}) {
    super(properties);
    Object.assign(this, properties);
  }

  update(dt: number) {
    const duration = this.openingTarget
      ? jumpGateSpec.openingDuration
      : jumpGateSpec.closingDuration;
    const change = (dt * 1000) / duration;

    this.opening += Math.max(
      -change,
      Math.min(change, this.openingTarget - this.opening),
    );

    if (this.opening === 1) this.blockedBeams = 0;
  }

  hitbox(): Collider[] {
    // Two passes through the existing curve prolong the gentle start and stop.
    const distance =
      jumpGateSpec.halfTravel * easeProgress(easeProgress(this.opening));

    return this.segments.map((segment) => {
      const offset = segment.side * distance;

      const collider = (segment.collider ||= {
        owner: this,
        segment,
        physics: true,
        collides: true,
        position: Vec.create(),
        localPosition: Vec.create(),
        shapeOutline: (segment.points as number[][]).map(([x, y]: number[]) => [
          x - segment.middle[0],
          y - segment.middle[1],
        ]),
        radius: segment.radius(segment),
        rotation: 0,
        friction: this.friction,
      });

      Vec.setXY(
        collider.localPosition,
        offset + segment.middle[0],
        segment.middle[1],
      );
      Vec.add(
        this.position,
        rotatePoint(collider.localPosition, this.rotation),
        collider.position,
      );
      collider.rotation = this.rotation;
      return collider;
    });
  }

  render({
    ctx = game.ctx,
    pose = this,
    zIndex = renderingLayers.stationHull,
  }: PassageRenderOptions = {}) {
    super.render({ ctx, pose, zIndex });
    ctx.save();
    ctx.translate(pose.position.x, pose.position.y);
    ctx.rotate(pose.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = objectLineWidth;
    const distance =
      jumpGateSpec.halfTravel * easeProgress(easeProgress(this.opening));

    if (zIndex === renderingLayers.stationHull) {
      // The four soft beams span the moving locks, leaving the portal fixed.
      ctx.lineWidth = 2;
      ctx.fillStyle = colors.gray[0];

      jumpGateSpec.beamOffsets.forEach((y, index) => {
        ctx.strokeStyle = withAlpha({
          color: (this.blockedBeams & (1 << index)
            ? colors.red
            : colors.green)[2],
          alpha: 0.35,
        });

        ctx.beginPath();
        ctx.moveTo(-distance - jumpGateSpec.beamInset, y);
        ctx.lineTo(distance + jumpGateSpec.beamInset, y);
        ctx.stroke();

        // Emitters tuck beneath the hull and meet at the seam when closed.
        ctx.fillRect(-distance - 18, y - 3, 18, 6);
        ctx.fillRect(distance, y - 3, 18, 6);
      });

      ctx.lineWidth = objectLineWidth;

      this.segments.forEach((segment) => {
        ctx.save();
        ctx.translate(segment.side * distance, 0);
        drawHullSegment({ ctx, segment, health: segment.health, pose });
        ctx.restore();
      });
    }

    if (
      zIndex === renderingLayers.modulesBelowStationHull ||
      zIndex === renderingLayers.glowBelowStations
    ) {
      const moving = Math.abs(this.openingTarget - this.opening) > 0.001;
      const opening = this.openingTarget > this.opening;
      const duration = opening
        ? jumpGateSpec.openingDuration
        : jumpGateSpec.closingDuration;
      const movementTime =
        (opening ? this.opening : 1 - this.opening) * duration;
      const now = performance.now();
      let state = flares.get(this);

      if (!state) {
        state = { progress: [0, 0], targets: [0, 0], updatedAt: now };
        flares.set(this, state);
      }

      const elapsed = Math.max(0, now - state.updatedAt);

      // Advance the previous targets before changing direction. Independent
      // presentation state lets one set fade while the other ramps up.
      state.updatedAt = now;

      this.engines.forEach((engine, index) => {
        const inner = index === 1;
        const fade = inner
          ? jumpGateFlareDurationInner
          : jumpGateFlareDurationOuter;
        // Keep the short midpoint handoff separate from the start and end offsets.
        const firing =
          opening === inner
            ? movementTime >= jumpGateThrustStartDelay &&
              movementTime < duration / 2 - fade
            : movementTime >= duration / 2 + fade &&
              movementTime < duration - jumpGateThrustEndLead;
        const progress = approach(
          state.progress[index],
          state.targets[index],
          elapsed / fade,
        );

        state.progress[index] = progress;
        state.targets[index] = +(moving && firing);

        if (!progress) return;
        const part = makeSegment(this, engine, engine.model[0]);

        part.shades = colors.violet;
        part.activationProgress = progress;

        for (const side of [-1, 1]) {
          for (const vertical of [-1, 1]) {
            ctx.save();
            // Mirror the upper-left mount and its flare together on both axes.
            ctx.translate(side * distance, 0);
            ctx.scale(-side, -vertical);
            ctx.translate(inner ? -138 : -259.5, inner ? -151.5 : -57);
            ctx.rotate(inner ? (Math.PI * 5) / 4 : 0);

            if (zIndex === renderingLayers.glowBelowStations) {
              engine.renderGlow({ segment: part });
            } else {
              engine.render({ segment: part });
            }

            ctx.restore();
          }
        }
      });
    }

    ctx.restore();
  }
}
