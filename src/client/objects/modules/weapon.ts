import { withAlpha } from '../../utilities/color';

// @ifdef BENCHMARK
import { benchmarkFlag } from '../../debug/benchmark';

// @endif
import { game } from '../../game';
import { shapeOutlineExtent } from '../../utilities/geometry';
import { radiusOf } from '../../utilities/polygon';
import { type WeaponId } from '../../../specs/modules';
import { type ModuleSpec } from '../../../specs/modules/types';
import { Module, type ModuleRenderOptions } from './module';
import { type Segment, type ShapeOutline } from '../../types';

export class Weapon extends Module {
  declare definitionId: WeaponId;
  fireCooldown = 0;

  static createModel(spec: Extract<ModuleSpec, { behavior: 'weapon' }>) {
    return spec.model.map((part) => {
      const radius = radiusOf(part.points);

      return {
        ...part,
        fillShade: part.color ?? 2,
        shapeOutline: [] as ShapeOutline,
        // Function-based points have no automatic bounds. Mirroring preserves
        // their distance from the mount, so one precomputed radius covers both sides.
        radius: () => radius,
        points: (segment: Segment) =>
          part.points.map(([x, y]) => [
            x,
            y * (segment.mount.localPosition.y < 0 ? -1 : 1),
          ]),
      };
    });
  }

  private charged(segment: Segment) {
    return (
      segment.rechargeDelay === undefined ||
      this.fireCooldown <= this.fireInterval - segment.rechargeDelay + 1e-9
    );
  }

  render(options: ModuleRenderOptions) {
    const { segment } = options;

    if (segment.rechargeDelay !== undefined) {
      segment.fillShade = this.charged(segment)
        ? (segment.color ?? 2)
        : segment.rechargeColor;
    }

    super.render(options);
  }

  renderGlow({ segment }: ModuleRenderOptions) {
    const { glow } = segment;

    if (!glow || !this.charged(segment)) return;

    // @ifdef BENCHMARK

    if (benchmarkFlag('noLighting') || benchmarkFlag('noHalos')) return;
    // @endif

    const { ctx } = game;
    const points =
      typeof segment.points === 'function'
        ? segment.points(segment)
        : segment.points;
    const [x, y] = shapeOutlineExtent(points).middle;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glow.radius);

    glow.stops.forEach(
      ([offset, color, alpha = 1]: [number, number | string, number?]) =>
        gradient.addColorStop(
          offset,
          withAlpha({
            color: typeof color === 'number' ? segment.shades[color] : color,
            alpha,
          }),
        ),
    );

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = glow.alpha;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, glow.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export const PlasmaAccelerator = Weapon.define('plasmaAccelerator');
export const Autocannon = Weapon.define('autocannon');
