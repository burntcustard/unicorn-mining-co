import { withAlpha } from '../../utilities/color';
import { approach } from '../../utilities/approach';
import { game } from '../../game';
import type { Segment } from '../../types';
import { Module, type ModuleRenderOptions } from './module';

class Thruster extends Module {
  updateVisual({ dt, segments }: { dt: number; segments: Segment[] }) {
    segments.forEach((segment) => {
      // A half-height envelope makes gentle thrust and repeated pulses visible.
      // Full thrust's normal ramp and release always stay above this floor.
      segment.phase = approach(
        segment.phase || 0,
        segment.active > 0 ? 0.5 : 0,
        dt * segment.rate * (segment.active > 0 ? 1 : 0.5),
      );
    });
  }

  render({ segment }: ModuleRenderOptions) {
    const progress = Math.max(segment.activationProgress, segment.phase || 0);

    if (progress > 0) {
      const { flareSize } = segment;

      super.render({
        segment,
        points: [
          [0, -flareSize],
          [-flareSize * 2.5 * progress, 0],
          [0, flareSize],
        ],
      });
    }
  }

  renderGlow({ segment }: ModuleRenderOptions) {
    const progress = Math.max(segment.activationProgress, segment.phase || 0);
    const { ctx } = game;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = progress * 0.4;
    ctx.scale(progress * 45, progress * 45);
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
export const ThrusterSingleMd = Thruster.define('thrusterSingleMd');
export const ThrusterSingleLg = Thruster.define('thrusterSingleLg');
export const ThrusterSingleXl = Thruster.define('thrusterSingleXl');
export const ThrusterDualSm = Thruster.define('thrusterDualSm');
export const ThrusterDualMd = Thruster.define('thrusterDualMd');
export const ThrusterDualLg = Thruster.define('thrusterDualLg');
export const ThrusterDualXl = Thruster.define('thrusterDualXl');
export const ThrusterTriple = Thruster.define('thrusterTriple');
