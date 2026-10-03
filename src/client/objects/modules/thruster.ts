// @ifdef BENCHMARK
import { benchmarkFlag } from '../../debug/benchmark';

// @endif
// @ifdef DEBUG
import { glows } from '../../utilities/lighting';

// @endif
import { game } from '../../game';
import { Module, type ModuleRenderOptions } from './module';
import {
  moduleDefinitionList,
  moduleIds,
  type ModuleId,
} from '../../../definitions/modules';
import type { ModuleDefinition } from '../../../definitions/modules/types';

const defineThruster = (
  definition: Extract<ModuleDefinition, { behavior: 'thruster' }>,
) => {
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
      ctx.scale(
        segment.activationProgress * 45,
        segment.activationProgress * 45,
      );
      gradient.addColorStop(0, segment.shades[2]);
      gradient.addColorStop(0.35, `${segment.shades[2]}6`);
      gradient.addColorStop(1, '#0000');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  return Object.assign(Thruster, definition, {
    model: definition.flareSizes.map((flareSize, index) => ({
      flareSize,
      thrusterNozzleSide: definition.nozzleSides[index],
    })),
  });
};

export const thrusterTypesById = new Map<ModuleId, typeof Module>(
  moduleIds.flatMap((id, index) => {
    const definition = moduleDefinitionList[index];

    return definition.behavior === 'thruster'
      ? [[id, defineThruster(definition)] as const]
      : [];
  }),
);

export const ThrusterSingle = thrusterTypesById.get('thrusterSingle')!;
export const ThrusterDualMd = thrusterTypesById.get('thrusterDualMd')!;
export const ThrusterDualXl = thrusterTypesById.get('thrusterDualXl')!;
export const ThrusterTriple = thrusterTypesById.get('thrusterTriple')!;
