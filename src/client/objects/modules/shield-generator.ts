import { type Segment } from '../../types';
import { game } from '../../game';
import { linesPath } from '../../utilities/drawing';
import { type ModuleSpec } from '../../../specs/modules/types';
import { Module, type ModuleRenderOptions } from './module';

export class ShieldGeneratorModule extends Module {
  static createModel(
    spec: Extract<ModuleSpec, { behavior: 'shieldGenerator' }>,
  ) {
    return [
      { radius: () => spec.generatorRadius },
      {
        activationDuration: spec.coverDuration,
        covers: true,
        radius: ({ activationProgress }: { activationProgress: number }) =>
          spec.shieldRadius * activationProgress,
        fillAlpha: 2 / 15,
      },
    ];
  }

  render({ segment }: ModuleRenderOptions) {
    super.render({ segment });

    if (segment.covers) return;
    game.ctx.save();
    game.ctx.strokeStyle = this.shades[2];

    game.ctx.stroke(
      linesPath(
        [segment.phase || 0, (segment.phase || 0) + Math.PI / 2].map(
          (angle) => {
            const x = Math.cos(angle) * 7,
              y = Math.sin(angle) * 7;

            return [
              [-x, -y],
              [x, y],
            ];
          },
        ),
      ),
    );

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
