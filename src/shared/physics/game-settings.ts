import { Settings } from './Settings';

// Convert model coordinates to metres inside the solver. Linear gameplay
// velocities and masses keep their existing units and drag law.
export const physicsScale = 0.01;
export const contactSpeedThreshold = 5;

Settings.velocityThreshold = contactSpeedThreshold * physicsScale;
