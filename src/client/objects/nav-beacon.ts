import { navBeaconAntennae, navBeaconSpec } from '../../specs/nav-beacon';
import { colors } from '../../specs/colors';
import { renderingLayers } from '../../specs/rendering-layers';
import { withAlpha } from '../utilities/color';
import { shapePath } from '../utilities/drawing';
import { game } from '../game';
import { Craft, type CraftRenderOptions } from './craft';
import { drawHullSegment } from './hull-rendering';

export class NavBeacon extends Craft {
  kind = 'navBeacon';

  constructor(properties: ConstructorParameters<typeof Craft>[0] = {}) {
    super({ ...navBeaconSpec, ...properties });
  }

  render(options: CraftRenderOptions = {}) {
    const { ctx } = game;
    const pose = options.pose || this;

    super.render({
      ...options,
      drawHull: (options) => {
        const { segment } = options;
        const index = this.hullSegments.indexOf(segment.module);

        if (index < 4) {
          drawHullSegment({ ctx, ...options });
        } else {
          ctx.fillStyle = index < 8 ? colors.gray[1] : colors.violet[2];
          ctx.fill(shapePath(segment.points as number[][]));
        }
      },
      draw: () => {
        options.draw?.();

        if (options.zIndex !== renderingLayers.glowAboveShips) return;

        const time = performance.now() * 0.003;
        const phase = ((this.id % 997) / 997) * Math.PI * 2;
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

        gradient.addColorStop(0, colors.violet[2]);
        gradient.addColorStop(
          0.35,
          withAlpha({ color: colors.violet[2], alpha: 0.4 }),
        );
        gradient.addColorStop(
          1,
          withAlpha({ color: colors.violet[2], alpha: 0 }),
        );

        const glow = (index: number, x: number, y: number, radius: number) => {
          if (
            !this.segments.some(
              (segment) =>
                segment.module === this.hullSegments[index] &&
                segment.health >= 1,
            )
          ) {
            return;
          }

          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const pulse = (1 + Math.sin(time + phase + index * 1.3)) / 2;

          ctx.globalAlpha = 0.3 + pulse * 0.3;
          ctx.translate(x, y);
          ctx.scale(radius, radius);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };

        glow(3, 0, 0, 38);
        navBeaconAntennae.forEach(([x, , end], index) =>
          glow(8 + index, x, end - Math.sign(end) * 1.5, 14),
        );
      },
      pose,
    });
  }
}
