import { withAlpha } from '../../utilities/color';

// @ifdef BENCHMARK
import { benchmarkFlag } from '../../debug/benchmark';

// @endif
import { game } from '../../game';
import { shapeOutlineExtent } from '../../utilities/geometry';
import * as Vec from '../../utilities/vector';
import { addEffect } from '../../effects/effect';
import { type Craft } from '../craft';
import { radiusOf } from '../../utilities/polygon';
import { type WeaponId } from '../../../specs/modules';
import { type ModuleSpec } from '../../../specs/modules/types';
import { simulationStep } from '../../../specs/simulation';
import { Module, type ModuleRenderOptions } from './module';
import { type Segment, type ShapeOutline } from '../../types';

// Presentation history survives snapshot-driven module reconstruction.
// Entries retain the next firing deadline and last observed simulation tick.
const shownShots = new WeakMap<Craft, Map<number, [number, number]>>();

export class Weapon extends Module {
  declare definitionId: WeaponId;
  fireCooldown = 0;
  chargeCooldown = this.chargeDuration ?? 0;

  updateVisual({ craft }: { dt: number; segments: Segment[]; craft: Craft }) {
    let shots = shownShots.get(craft);

    if (!shots) {
      shots = new Map();
      shownShots.set(craft, shots);
    }

    const tick = craft.world?.tick ?? 0;
    const previous = shots.get(this.id) ?? [-Infinity, tick];
    const deadline = tick * simulationStep + this.fireCooldown;

    // Cooldown counts down against simulation time, leaving the deadline fixed
    // until another shot. This also observes server shots after prediction is
    // corrected, without depending on a local marker absent from snapshots.
    if (tick < previous[1]) previous[0] = -Infinity;

    if (
      this.muzzleFlash &&
      this.mount?.health > 0 &&
      this.fireCooldown > 0 &&
      deadline - previous[0] > this.fireInterval / 2
    ) {
      addEffect({
        effect: this.muzzleFlash,
        parent: craft,
        position: Vec.add(
          this.mount.localPosition,
          Vec.create(this.barrelLength, 0),
        ),
        rotation: 0,
      });

      previous[0] = deadline;
    }

    previous[1] = tick;
    shots.set(this.id, previous);
  }

  static createModel(
    spec: Extract<ModuleSpec, { behavior: 'weapon' | 'beam' }>,
  ) {
    return super.createModel(spec).map((part) => {
      const radius = Math.max(
        radiusOf(part.points),
        radiusOf(
          (part.points as ShapeOutline).map(([x, y]) => [
            x - (spec.retractionDistance ?? 0),
            y,
          ]),
        ),
      );

      return {
        ...part,
        // Function-based points have no automatic bounds. Cover both ends of
        // the deployment slide; mirroring preserves distance from the mount.
        radius: () => radius,
        points: (segment: Segment) => {
          const progress = Math.min(
            1,
            segment.activationProgress *
              (segment.active !== 1 && spec.dischargeDuration
                ? 1 + spec.dischargeDuration / spec.activationDuration
                : 1),
          );

          return (part.points as ShapeOutline).map(([x, y]) => [
            x - (spec.retractionDistance ?? 0) * (1 - progress),
            y * (segment.mount.localPosition.y < 0 ? -1 : 1),
          ]);
        },
      };
    });
  }

  private charged(segment: Segment) {
    return (
      segment.active === 1 &&
      segment.activationProgress === 1 &&
      (segment.rechargeDelay === undefined ||
        Math.max(this.fireCooldown, this.chargeCooldown) <=
          this.fireInterval - segment.rechargeDelay + 1e-9)
    );
  }

  render(options: ModuleRenderOptions) {
    const { segment } = options;

    if (segment.rechargeDelay !== undefined) {
      const color = this.charged(segment)
        ? segment.color
        : segment.rechargeColor;
      const shade = this.paintShade(color);

      segment.fillShade = shade < 0 ? undefined : shade;

      super.render({
        ...options,
        segment: {
          ...segment,
          color: this.paintedColor(color, segment.shades),
          fillShade: undefined,
        },
      });

      return;
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
    const [middleX, middleY] = shapeOutlineExtent(points).middle;
    const x = middleX + (glow.offset?.[0] ?? 0);
    const y =
      middleY +
      (glow.offset?.[1] ?? 0) * (segment.mount.localPosition.y < 0 ? -1 : 1);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glow.radius);

    glow.stops.forEach(
      ([offset, color, alpha = 1]: [number, string, number?]) =>
        gradient.addColorStop(
          offset,
          withAlpha({
            color: this.paintedColor(color, segment.shades),
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

class AutogunModule extends Weapon {
  private firingPhase(segment: Segment) {
    return segment.active === 1 &&
      segment.activationProgress === 1 &&
      this.chargeCooldown <= 1e-9 &&
      this.fireCooldown > 0
      ? 0.5 - this.fireCooldown / this.fireInterval
      : undefined;
  }

  updateVisual(options: Parameters<Weapon['updateVisual']>[0]) {
    super.updateVisual(options);
    const { dt, segments } = options;

    segments.forEach((segment) => {
      if (segment.active !== 1) {
        const phase = segment.phase || 0;
        const remaining = Math.max(
          0,
          segment.activationProgress *
            (this.activationDuration + (this.dischargeDuration ?? 0)) -
            this.activationDuration,
        );

        // Finish at the next stacked position before the deployment slide.
        segment.phase =
          phase +
          (Math.ceil(phase) - phase) *
            (1 - (remaining / (remaining + dt || 1)) ** 2);
        return;
      }

      segment.phase =
        this.firingPhase(segment) ??
        ((segment.phase || 0) +
          (dt *
            (segment.active === 1 && segment.activationProgress === 1
              ? Math.max(0, 1 - this.chargeCooldown / this.chargeDuration)
              : 0)) /
            this.fireInterval) %
          4;
    });
  }

  render(options: ModuleRenderOptions) {
    const { segment } = options;

    // Keep the authored barrel shapes for collision and detached wreckage.
    // Draw the rear pair first and the front pair second, before the collar.
    const pair = this.model.findIndex((part) => part.points === segment.points);

    if (
      this.model.length !== 3 ||
      pair < 0 ||
      pair > 1 ||
      typeof segment.points !== 'function'
    ) {
      super.render(options);
      return;
    }

    const points = this.model[0].points(segment) as ShapeOutline;
    const { middle } = shapeOutlineExtent(points);
    const radius = Math.abs(middle[1]) * Math.SQRT2;
    // A quarter turn per shot puts a barrel on the centre line whenever the
    // cooldown wraps. At rest the 45-degree start stacks four into two.
    const phase = this.firingPhase(segment) ?? (segment.phase || 0);
    const angle = Math.PI / 4 + (phase * Math.PI) / 2;

    const barrels = Array.from({ length: 4 }, (_, index) => {
      const rotation = angle + (index * Math.PI) / 2;

      return [Math.sin(rotation) * radius, Math.cos(rotation)];
    }).sort((a, b) => a[1] - b[1]);

    barrels.slice(pair * 2, pair * 2 + 2).forEach(([offset, depth]) => {
      super.render({
        ...options,
        segment: {
          ...segment,
          fillShade: depth > 0 ? 2 : 0,
        },
        points: points.map(([x, y]) => [x, y - middle[1] + offset]),
      });
    });
  }
}

export const Autogun = AutogunModule.define('autogun');
