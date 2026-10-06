import type { ModuleId } from './modules';

export type MountPointSpec = {
  x: number;
  y: number;
  // Extra outward distance per thruster nozzle along the local Y axis.
  thrusterOffset?: number;
  fits: ModuleId[];
};
