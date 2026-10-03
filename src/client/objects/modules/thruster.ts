import { Module } from './module';
import {
  moduleDefinitionList,
  moduleIds,
  type ModuleId,
} from '../../../definitions/modules';
import type { ModuleDefinition } from '../../../definitions/modules/types';

const defineThruster = (
  definition: Extract<ModuleDefinition, { behavior: 'thruster' }>,
) => {
  class Thruster extends Module {}
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
