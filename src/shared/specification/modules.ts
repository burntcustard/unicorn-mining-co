import { colors } from '../colors';

export const moduleIds = [
  'thrusterSingle',
  'thrusterDualMd',
  'thrusterDualXl',
  'thrusterTriple',
  'cargoHatch',
  'searchLight',
  'hornDrill',
  'shieldGenerator',
] as const;

export type ModuleId = (typeof moduleIds)[number];

type ModuleSpecification = {
  label: string;
  health: number;
  price: number;
  zIndex: number;
  shades?: readonly string[];
  activationDuration?: number;
  bounciness?: number;
  friction?: number;
  damage?: number;
  activationThreshold?: number;
  damageStepsPerSecond?: number;
  gripDecay?: number;
  gripScale?: number;
  disablePhysics?: boolean;
  forwardThrust?: number;
  rotationalThrust?: number;
  offset?: number;
  flareSizes?: readonly number[];
  nozzleSides?: readonly number[];
  collectsCargo?: boolean;
  grinds?: boolean;
  beam?: boolean;
  lens?: number;
  mouth?: number;
  reach?: number;
  spread?: number;
  corner?: number;
  shieldRadius?: number;
  coverDuration?: number;
  generatorRadius?: number;
  unhurtWhen?: number;
  drillTip?: { position: { x: number; y: number }; radius: number };
  points?: readonly (readonly number[])[];
  cargoGeometry?: {
    length: number;
    openAngle: number;
    doorWidth: number;
    doorRadius: number;
    openingThreshold: number;
    throatRadius: number;
  };
};

// Values consumed by both the client classes and the generated Go catalog.
export const moduleSpecifications = {
  thrusterSingle: {
    label: 'THRUSTERS *1 XL',
    health: 15,
    price: 200,
    zIndex: -1,
    shades: colors.violet,
    disablePhysics: true,
    forwardThrust: 22,
    rotationalThrust: 14,
    flareSizes: [7],
    nozzleSides: [0],
  },
  thrusterDualMd: {
    label: 'THRUSTERS *2',
    health: 20,
    price: 350,
    zIndex: -1,
    shades: colors.violet,
    disablePhysics: true,
    forwardThrust: 16,
    rotationalThrust: 16,
    offset: 10,
    flareSizes: [4, 4],
    nozzleSides: [-1, 1],
  },
  thrusterDualXl: {
    label: 'THRUSTERS *2 XL',
    health: 25,
    price: 800,
    zIndex: -1,
    shades: colors.violet,
    disablePhysics: true,
    forwardThrust: 22,
    rotationalThrust: 24,
    offset: 11,
    flareSizes: [6, 6],
    nozzleSides: [-1, 1],
  },
  thrusterTriple: {
    label: 'THRUSTERS *3',
    health: 30,
    price: 1800,
    zIndex: -1,
    shades: colors.violet,
    disablePhysics: true,
    forwardThrust: 28,
    rotationalThrust: 24,
    offset: 14,
    flareSizes: [3, 5, 3],
    nozzleSides: [-1, 0, 1],
  },
  cargoHatch: {
    label: 'CARGO HATCH',
    health: 4,
    price: 150,
    zIndex: -1,
    shades: colors.violet,
    activationDuration: 0.7,
    collectsCargo: true,
    unhurtWhen: 0,
    cargoGeometry: {
      length: 16,
      openAngle: 2.5,
      doorWidth: 1.5,
      doorRadius: 32,
      openingThreshold: 0.5,
      throatRadius: 12,
    },
  },
  searchLight: {
    label: 'SEARCH LIGHT',
    health: 10,
    price: 450,
    zIndex: -2,
    beam: true,
    disablePhysics: true,
    lens: 2,
    mouth: 5,
    reach: 400,
    spread: 35,
    corner: 10,
  },
  hornDrill: {
    label: 'HORN DRILL',
    health: 100,
    price: 350,
    zIndex: -1,
    shades: colors.yellow,
    activationDuration: 0.5,
    friction: 0.3,
    damage: 0.5,
    grinds: true,
    activationThreshold: 0.5,
    damageStepsPerSecond: 60,
    gripDecay: 0.9,
    gripScale: 0.1,
    drillTip: { position: { x: 26, y: 0 }, radius: 3 },
    points: [
      [3, -6],
      [27, 0],
      [3, 6],
    ],
  },
  shieldGenerator: {
    label: 'SHIELD GENERATOR',
    health: 40,
    price: 900,
    zIndex: 1,
    shades: colors.violet,
    bounciness: 0.8,
    generatorRadius: 7,
    shieldRadius: 50,
    coverDuration: 0.2,
    unhurtWhen: 1,
  },
} as const satisfies Record<ModuleId, ModuleSpecification>;
