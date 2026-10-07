import { type Segment } from '../../types';
import { game } from '../../game';
import { linesPath } from '../../utilities/drawing';
import { type ModuleSpec } from '../../../specs/modules/types';
import { Module, type ModuleRenderOptions } from './module';

export class ShieldGeneratorModule extends Module {
  static createModel(
    spec: Extract<ModuleSpec, { behavior: 'shieldGenerator' }>,
  ) {
    return super.createModel(spec).map((part) => ({
      ...part,
      activationDuration: part.covers ? spec.coverDuration : undefined,
      radius: ({ activationProgress }: { activationProgress: number }) =>
        part.covers ? spec.shieldRadius * activationProgress : part.radius,
    }));
  }

  render({ segment }: ModuleRenderOptions) {
    super.render({ segment });

    if (!segment.lines) return;
    game.ctx.save();
    game.ctx.strokeStyle = this.shades[2];
    game.ctx.rotate(segment.phase || 0);
    game.ctx.stroke(linesPath(segment.lines));
    game.ctx.restore();
  }

  updateVisual({ dt, segments }: { dt: number; segments: Segment[] }) {
    segments.forEach(
      (segment) =>
        (segment.phase =
          ((segment.phase || 0) + dt * 3 * segment.activationProgress) %
          (Math.PI / 2)),
    );
  }
}

export const ShieldGenerator =
  ShieldGeneratorModule.define('shieldGeneratorSm');
export const ShieldGeneratorMd =
  ShieldGeneratorModule.define('shieldGeneratorMd');
