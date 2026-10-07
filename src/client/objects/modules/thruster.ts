import { withAlpha } from '../../utilities/color';

// @ifdef BENCHMARK
import { benchmarkFlag } from '../../debug/benchmark';

// @endif
// @ifdef DEBUG
import { glows } from '../../utilities/lighting';

// @endif
import { game } from '../../game';
import { Module, type ModuleRenderOptions } from './module';

class Thruster extends Module {
  render({ segment }: ModuleRenderOptions) {
    if (segment.activationProgress > 0) {
      const { flareSize, activationProgress } = segment;

      super.render({
        segment,
        points: [
          [0, -flareSize],
          [-flareSize * 2.5 * activationProgress, 0],
          [0, flareSize],
        ],
      });
    }
  }

  renderGlow({ segment }: ModuleRenderOptions) {
    // @ifdef DEBUG
    if (!glows) return;
    // @endif
    // @ifdef BENCHMARK

    if (benchmarkFlag('noLighting') || benchmarkFlag('noHalos')) return;
    // @endif

    const { ctx } = game;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = segment.activationProgress * 0.4;
    ctx.scale(segment.activationProgress * 45, segment.activationProgress * 45);
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
export const ThrusterDualMd = Thruster.define('thrusterDualMd');
export const ThrusterDualLg = Thruster.define('thrusterDualLg');
export const ThrusterDualXl = Thruster.define('thrusterDualXl');
export const ThrusterTriple = Thruster.define('thrusterTriple');
