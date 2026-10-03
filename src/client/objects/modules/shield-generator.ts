import { type Segment } from '../../types';
import { game } from '../../game';
import { linesPath } from '../../utilities/drawing';
import { moduleDefinitions } from '../../../definitions/modules/index';
import { Module, type ModuleRenderOptions } from './module';

const specification = moduleDefinitions.shieldGenerator;

export class ShieldGenerator extends Module {
  static bounciness = specification.bounciness;
  static health = specification.health;
  static label = specification.label;
  static model: any[] = [
    { radius: () => specification.generatorRadius },
    {
      activationDuration: specification.coverDuration,
      covers: true,
      radius: ({ activationProgress }: { activationProgress: number }) =>
        specification.shieldRadius * activationProgress,
      fillAlpha: 2,
    },
  ];
  static price = specification.price;
  static shades = specification.shades;
  static unhurtWhen = specification.unhurtWhen;
  static zIndex = specification.zIndex;

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
