import { GameObject, type RenderOptions } from './game-object';
import { game } from '../game';
import { colors } from '../../specs/colors';
import {
  renderingLayers,
  type RenderingLayer,
} from '../../specs/rendering-layers';
import { withAlpha } from '../utilities/color';
import { objectLineWidth } from '../utilities/drawing';
import { simulationStep } from '../../specs/simulation';
import * as Vec from '../utilities/vector';

export interface PassageRenderOptions extends RenderOptions {
  zIndex?: RenderingLayer;
}

/**
 * Fixed sector passages share a circular travel area and portal presentation.
 * The server alone authorizes travel; clients predict only their appearance.
 */
export class Passage extends GameObject {
  destinationName = '';
  declare travelRadius: number;
  opening = 1;
  openingTarget = 1;
  static mass = Infinity;
  static physics = false;

  constructor(properties: ConstructorParameters<typeof GameObject>[0] = {}) {
    super(properties);
    Object.assign(this, properties);
    this.spin = 0;
    Vec.setXY(this.velocity, 0, 0);
    this.health = undefined;
  }

  update(_dt: number) {}

  hitbox(): import('../collision/types').Collider[] {
    return [];
  }

  render({
    ctx = game.ctx,
    pose = this,
    zIndex = renderingLayers.scenery,
  }: PassageRenderOptions = {}) {
    if (zIndex !== renderingLayers.scenery) return;

    super.render({ ctx, pose, draw: () => this.renderPortal(ctx) });
  }

  protected renderPortal(ctx: CanvasRenderingContext2D) {
    const radius = this.travelRadius;
    const time =
      (this.world?.tick ?? performance.now() / (simulationStep * 1000)) *
      simulationStep;
    const palette = [
      colors.violet[2],
      colors.indigo[2],
      colors.cyan[2],
      colors.green[2],
      colors.yellow[2],
      colors.orange[2],
      colors.red[2],
      colors.violet[2],
    ];
    const turn = Math.PI * 2;
    const outer = radius * 1.65;

    ctx.save();
    const halo = ctx.createRadialGradient(0, 0, radius, 0, 0, outer);

    halo.addColorStop(0, withAlpha({ color: colors.violet[2], alpha: 0.45 }));
    halo.addColorStop(0.45, withAlpha({ color: colors.indigo[2], alpha: 0.2 }));
    halo.addColorStop(1, withAlpha({ color: colors.indigo[2], alpha: 0 }));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, outer, 0, turn);
    ctx.fill();

    // Broad ribbons wind inward, with tapered tails and moving folds. Source-over
    // blending keeps the spectrum saturated instead of adding it into white.
    for (let layer = 0; layer < 3; layer++) {
      const rotation = time * (0.2 + layer * 0.07) + layer * 0.65;
      const spectrum = ctx.createConicGradient(rotation, 0, 0);

      palette.forEach((shade, index) =>
        spectrum.addColorStop(index / (palette.length - 1), shade),
      );
      ctx.fillStyle = spectrum;
      ctx.globalAlpha = 0.5 + layer * 0.2;

      for (let arm = 0; arm < 7; arm++) {
        const start = (arm / 7) * turn + rotation;

        ctx.beginPath();

        for (const edge of [-1, 1]) {
          for (let sample = 0; sample <= 32; sample++) {
            const progress = (edge === -1 ? sample : 32 - sample) / 32;
            const angle = start + progress * 2.2;
            const fold = Math.sin(progress * Math.PI);
            const reach =
              radius *
              (1.04 +
                (1 - progress) * (0.48 - layer * 0.1) +
                Math.sin(progress * 8 - time + arm) * 0.025 * fold +
                edge * fold * (0.07 + layer * 0.015));
            const x = Math.cos(angle) * reach;
            const y = Math.sin(angle) * reach;

            if (edge === -1 && sample === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
        }

        ctx.closePath();
        ctx.fill();
      }
    }

    // A continuous luminous lip joins the swirls around the dark aperture.
    ctx.globalAlpha = 1;
    ctx.beginPath();

    for (let sample = 0; sample <= 128; sample++) {
      const angle = (sample / 128) * turn;
      const reach = radius * (1.07 + Math.sin(angle * 3 - time * 1.1) * 0.02);
      const x = Math.cos(angle) * reach;
      const y = Math.sin(angle) * reach;

      if (sample) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
      }
    }

    ctx.closePath();
    ctx.fill();
    // Fill the aperture with its continuous spectrum, then fade it toward black
    // using one concentric radial gradient. The solid rim stays independent.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, turn);
    ctx.fill();
    const shadow = ctx.createRadialGradient(0, 0, radius * 0.35, 0, 0, radius);

    shadow.addColorStop(0, colors.black[0]);
    shadow.addColorStop(
      0.5,
      withAlpha({ color: colors.black[0], alpha: 0.97 }),
    );
    shadow.addColorStop(1, withAlpha({ color: colors.black[0], alpha: 0.8 }));
    ctx.fillStyle = shadow;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = objectLineWidth;
    ctx.stroke();
    ctx.strokeStyle = withAlpha({ color: colors.white[2], alpha: 0.4 });
    ctx.stroke();
    ctx.restore();
  }
}
