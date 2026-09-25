// @ifdef BENCHMARK
import { benchmarkFlag } from '../benchmark';

// @endif
// @ifdef DEBUG
import { glows } from '../lighting';

// @endif
import { thrusters } from '../../shared/modules';
import { type Segment } from '../../shared/types';
import { giveRender } from '../give-render';
import { flare } from '../flare';
import './module';

thrusters.forEach((Type) =>
  giveRender({
    Type,
    render({ segment, parent }) {
      if (segment.activationProgress > 0) {
        parent({ segment, points: flare(segment.flareSize)(segment) });
      }
    },
  }),
);

export const drawThrusterGlow = (
  ctx: CanvasRenderingContext2D,
  nozzle: Segment,
) => {
  // @ifdef DEBUG
  if (!glows) return;
  // @endif
  // @ifdef BENCHMARK

  if (benchmarkFlag('noLighting') || benchmarkFlag('noHalos')) return;
  // @endif

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = nozzle.activationProgress * 0.4;
  ctx.scale(nozzle.activationProgress * 45, nozzle.activationProgress * 45);
  gradient.addColorStop(0, nozzle.shades[2]);
  gradient.addColorStop(0.35, `${nozzle.shades[2]}6`);
  gradient.addColorStop(1, '#0000');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};
