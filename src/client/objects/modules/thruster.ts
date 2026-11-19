import { withAlpha } from '../../utilities/color';
import { approach } from '../../utilities/approach';
import { game } from '../../game';
import type { Segment } from '../../types';
import type { Ship } from '../ship';
import type { Craft } from '../craft';
import * as Vec from '../../utilities/vector';
import { Module, type ModuleRenderOptions } from './module';

export type ThrusterFlareState = {
  tip: Vec.Value;
  width: number;
  glowGain: number;
};

class Thruster extends Module {
  static category = 'core' as const;

  private flareTarget({
    segment,
    craft,
  }: ModuleRenderOptions): ThrusterFlareState {
    const progress = Math.max(segment.activationProgress, segment.phase || 0);
    const boost =
      craft?.kind === 'ship' ? (craft as Ship).thrustBoostFactor : 1;
    const turn =
      !segment.thrusterNozzleSide && craft?.kind === 'ship'
        ? (craft as Ship).turn || 0
        : 0;

    return {
      tip: Vec.create(-progress * boost, progress * boost * turn * 0.2),
      width: progress,
      glowGain: boost > 1 ? 1.5 : 1,
    };
  }

  updateVisual({
    dt,
    segments,
    craft,
  }: {
    dt: number;
    segments: Segment[];
    craft: Craft;
  }) {
    // One frame-rate-independent easing rule follows every geometry change.
    // A step settles by 95% over 200 ms, including reversals mid-transition.
    const blend = 1 - Math.exp((-dt * 1000 * 3) / 200);

    const follow = (value: number, target: number) => {
      const next = value + (target - value) * blend;

      return Math.abs(next - target) < 0.001 ? target : next;
    };

    segments.forEach((segment) => {
      // A half-height envelope makes gentle thrust and repeated pulses visible.
      // Full thrust's normal ramp and release always stay above this floor.
      segment.phase = approach(
        segment.phase || 0,
        segment.active > 0 ? 0.5 : 0,
        dt * segment.rate * (segment.active > 0 ? 1 : 0.5),
      );
      const target = this.flareTarget({ segment, craft });

      const previous: ThrusterFlareState = segment.flare ?? {
        tip: Vec.create(),
        width: 0,
        glowGain: 1,
      };

      segment.flare = {
        tip: Vec.create(
          follow(previous.tip.x, target.tip.x),
          follow(previous.tip.y, target.tip.y),
        ),
        width: follow(previous.width, target.width),
        glowGain: follow(previous.glowGain, target.glowGain),
      };
    });
  }

  render(options: ModuleRenderOptions) {
    const { segment } = options;
    const { tip, width }: ThrusterFlareState =
      segment.flare ?? this.flareTarget(options);

    if (width > 0) {
      const { flareSize, points } = segment;

      super.render({
        segment,
        points: Array.isArray(points)
          ? points.map(([x, y]) => [-x * tip.x, y * width - x * tip.y])
          : [
              [0, -flareSize * width],
              [flareSize * 2.5 * tip.x, flareSize * 2.5 * tip.y],
              [0, flareSize * width],
            ],
      });
    }
  }

  renderGlow(options: ModuleRenderOptions) {
    const { segment } = options;
    const { width, glowGain }: ThrusterFlareState =
      segment.flare ?? this.flareTarget(options);
    const { ctx } = game;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = width * 0.4 * glowGain;
    ctx.scale(width * 45, width * 45);
    gradient.addColorStop(0, segment.shades[2]);
    gradient.addColorStop(
      0.35,
      withAlpha({ color: segment.shades[2], alpha: 0.4 }),
    );
    gradient.addColorStop(1, withAlpha({ color: '#000', alpha: 0 }));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export const ThrusterSingleSm = Thruster.define('thrusterSingleSm');
export const ThrusterCrescent = Thruster.define('thrusterCrescent');
export const ThrusterSingleMd = Thruster.define('thrusterSingleMd');
export const ThrusterSingleLg = Thruster.define('thrusterSingleLg');
export const ThrusterSingleXl = Thruster.define('thrusterSingleXl');
export const ThrusterDualSm = Thruster.define('thrusterDualSm');
export const ThrusterDualMd = Thruster.define('thrusterDualMd');
export const ThrusterDualLg = Thruster.define('thrusterDualLg');
export const ThrusterDualXl = Thruster.define('thrusterDualXl');
export const ThrusterTriple = Thruster.define('thrusterTriple');
