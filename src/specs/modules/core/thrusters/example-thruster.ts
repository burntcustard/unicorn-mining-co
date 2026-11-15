import { renderingLayers } from '../../../rendering-layers';
import { colors } from '../../../colors';
import type { ModuleSpec } from '../../types';

export const exampleThruster = {
  icon: './thruster.svg',
  description: 'Synthetic thruster for fuel and movement tests.',
  behavior: 'thruster',
  mass: 235,
  name: 'Example Thruster',
  health: 15,
  power: 0.15,
  powerActivated: 1.2,
  price: 200,
  fuelUsage: 0.04,
  forwardThrust: 22,
  rotationalThrust: 14,
  zIndex: renderingLayers.modulesBelowShipHull,
  shades: colors.violet,
  disablePhysics: true,
  model: [{ outline: true, flareSize: 7, thrusterNozzleSide: 0 }],
} satisfies ModuleSpec;

export const exampleTripleThruster = {
  ...exampleThruster,
  mass: 1060,
  name: 'Example Triple Thruster',
  fuelUsage: 0.07,
  forwardThrust: 28,
  rotationalThrust: 24,
  offset: 14,
  model: [
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: -1,
    },
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 0,
    },
    {
      outline: true,
      flareSize: 5,
      thrusterNozzleSide: 1,
    },
  ],
} satisfies ModuleSpec;

export const exampleSmallThruster = {
  ...exampleThruster,
  mass: 120,
  name: 'Example Small Thruster',
  health: 15,
  power: 0.1,
  powerActivated: 0.8,
  price: 200,
  fuelUsage: 0.04,
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
  mass: 350,
  name: 'Example Large Thruster',
  health: 15,
  power: 0.2,
  powerActivated: 1.6,
  price: 200,
  fuelUsage: 0.05,
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
  mass: 470,
  name: 'Example Extra Large Thruster',
  health: 15,
  power: 0.25,
  powerActivated: 2,
  price: 200,
  fuelUsage: 0.05,
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
  mass: 470,
  name: 'Example Dual Thruster',
  health: 20,
  power: 0.3,
  powerActivated: 2.4,
  price: 350,
  fuelUsage: 0.06,
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
  mass: 705,
  name: 'Example Large Dual Thruster',
  health: 22,
  power: 0.4,
  powerActivated: 3.2,
  price: 575,
  fuelUsage: 0.06,
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
  mass: 940,
  name: 'Example Extra Large Dual Thruster',
  health: 25,
  power: 0.5,
  powerActivated: 4,
  price: 800,
  fuelUsage: 0.07,
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
