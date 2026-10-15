import { renderingLayers } from '../../rendering-layers';
import { colors } from '../../colors';
import type { ModuleSpec } from '../types';

export const exampleThruster = {
  icon: './thruster.svg',
  description: 'Synthetic thruster for fuel and movement tests.',
  behavior: 'thruster',
  name: 'Example Thruster',
  health: 15,
  power: 0.15,
  powerActivated: 1.2,
  price: 200,
  fuelUsage: 2.5 / 60,
  forwardThrust: 22,
  rotationalThrust: 14,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: [{ outline: true, flareSize: 7, thrusterNozzleSide: 0 }],
} satisfies ModuleSpec;

export const exampleTripleThruster = {
  ...exampleThruster,
  name: 'Example Triple Thruster',
  fuelUsage: 4.4 / 60,
  forwardThrust: 28,
  rotationalThrust: 24,
  offset: 14,
  model: [-1, 0, 1].map((thrusterNozzleSide) => ({
    outline: true,
    flareSize: 5,
    thrusterNozzleSide,
  })),
} satisfies ModuleSpec;

export const exampleSmallThruster = {
  ...exampleThruster,
  name: 'Example Small Thruster',
  health: 15,
  power: 0.1,
  powerActivated: 0.8,
  price: 200,
  fuelUsage: 2.2 / 60,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;

export const exampleLargeThruster = {
  ...exampleThruster,
  name: 'Example Large Thruster',
  health: 15,
  power: 0.2,
  powerActivated: 1.6,
  price: 200,
  fuelUsage: 2.8 / 60,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 9,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;

export const exampleExtraLargeThruster = {
  ...exampleThruster,
  name: 'Example Extra Large Thruster',
  health: 15,
  power: 0.25,
  powerActivated: 2,
  price: 200,
  fuelUsage: 3.1 / 60,
  forwardThrust: 22,
  rotationalThrust: 14,
  model: [
    {
      outline: true,
      flareSize: 11,
      thrusterNozzleSide: 0,
    },
  ],
} satisfies ModuleSpec;

export const exampleDualThruster = {
  ...exampleThruster,
  name: 'Example Dual Thruster',
  health: 20,
  power: 0.3,
  powerActivated: 2.4,
  price: 350,
  fuelUsage: 3.3 / 60,
  forwardThrust: 16,
  rotationalThrust: 16,
  offset: 10,
  model: [
    {
      outline: true,
      flareSize: 4,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 4,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;

export const exampleLargeDualThruster = {
  ...exampleThruster,
  name: 'Example Large Dual Thruster',
  health: 22,
  power: 0.4,
  powerActivated: 3.2,
  price: 575,
  fuelUsage: 3.6 / 60,
  forwardThrust: 19,
  rotationalThrust: 20,
  offset: 10.5,
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;

export const exampleExtraLargeDualThruster = {
  ...exampleThruster,
  name: 'Example Extra Large Dual Thruster',
  health: 25,
  power: 0.5,
  powerActivated: 4,
  price: 800,
  fuelUsage: 4 / 60,
  forwardThrust: 22,
  rotationalThrust: 24,
  offset: 11,
  model: [
    {
      outline: true,
      flareSize: 6,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 6,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;
