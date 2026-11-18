import { game } from '../../game';
import { withAlpha } from '../../utilities/color';
import { linesPath, shapePath } from '../../utilities/drawing';
import type { Segment } from '../../types';
import type { ModuleSpec } from '../../../specs/modules/types';
import { Module, type ModuleRenderOptions } from './module';

const readyRotationDuration = 200;

class ThrustBoosterModule extends Module {
  static category = 'core' as const;
  declare booster: NonNullable<ModuleSpec['booster']>;
  fireCooldown = 0;
  chargeCooldown = 0;

  private boosting(segment: Segment) {
    return (
      segment.active === 1 && this.fireCooldown > this.booster.cooldown + 1e-9
    );
  }

  private chargePhase(segment: Segment) {
    return this.boosting(segment)
      ? 0
      : Math.max(
          0,
          Math.min(1, (this.chargeCooldown * 1000) / readyRotationDuration),
        );
  }

  private litHalves(segment: Segment) {
    if (this.boosting(segment)) return 2;
    const step = this.booster.recharge / 7;

    return Math.max(
      0,
      Math.min(
        2,
        Math.floor(
          (this.booster.recharge -
            this.chargeCooldown -
            segment.rechargeDelay) /
            step +
            1 +
            1e-9,
        ),
      ),
    );
  }

  render(options: ModuleRenderOptions) {
    const { segment } = options;

    if (segment.rechargeDelay === undefined) {
      super.render(options);
      return;
    }

    super.render({
      ...options,
      draw: () => {
        const { ctx } = game;
        const shades = this.shades || segment.shades;
        const x = segment.glow.offset[0];
        const dot = new Path2D();

        ctx.save();
        ctx.translate(x, 0);
        ctx.rotate(((this.chargePhase(segment) - 1) * Math.PI) / 2);

        dot.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = shades[0];
        ctx.fill(dot);
        ctx.strokeStyle = shades[2];
        ctx.stroke(
          segment.shapeOutline ? linesPath(segment.shapeOutline) : dot,
        );
        ctx.clip(dot);
        ctx.fillStyle = shades[2];

        for (let half = 0; half < this.litHalves(segment); half++) {
          const path = new Path2D();
          const start = Math.PI / 2 + half * Math.PI;

          path.arc(0, 0, 2.5, start, start + Math.PI);
          path.closePath();
          ctx.fill(path);
        }

        ctx.strokeStyle = shades[0];
        ctx.lineWidth = 1;
        ctx.stroke(
          shapePath(
            [
              [0, -2.6],
              [0, 2.6],
            ],
            true,
          ),
        );
        ctx.restore();
      },
    });
  }

  renderGlow({ segment }: ModuleRenderOptions) {
    const { glow } = segment;
    const boosting = this.boosting(segment);

    if (!glow || glow.alpha === 0 || this.chargePhase(segment) > 1e-9) {
      return;
    }

    const { ctx } = game;
    const [x, y] = glow.offset;
    const radius = glow.radius * (boosting ? 2.5 : 1);
    const mask = new Path2D();

    mask.rect(x - radius, y - radius - 1.35, radius * 2, radius * 2 + 2.7);
    mask.rect(x - 2.5, y - 0.5, 5, 1);

    ctx.save();
    ctx.clip(mask, 'evenodd');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, glow.alpha * (boosting ? 3.5 : 1));

    for (const half of [-1.35, 1.35]) {
      const centerY = y + half;
      const gradient = ctx.createRadialGradient(
        x,
        centerY,
        0,
        x,
        centerY,
        radius,
      );

      glow.stops.forEach(
        ([offset, color, alpha = 1]: [number, string, number?]) =>
          gradient.addColorStop(
            offset,
            withAlpha({
              color: this.paintedColor(color, this.shades || segment.shades),
              alpha,
            }),
          ),
      );

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export const ThrustBooster = ThrustBoosterModule.define('thrustBooster');
