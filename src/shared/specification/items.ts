import { colors } from '../colors';
import { createPolygon } from '../polygon';

export const itemIds = [
  'diamond',
  'amethyst',
  'gold',
  'opal',
  'message',
] as const;
export type ItemId = (typeof itemIds)[number];

type ItemSpecification = {
  resource: number;
  label?: string;
  price?: number;
  points?: number[][];
  radius?: number;
  lines?: number[][][];
  shades: readonly string[];
  glint?: boolean;
  rainbow?: boolean;
  fillAlpha?: number;
  unlock?: string;
};

export const itemDefaults = {
  mass: 6,
  angularDrag: 0.15,
  radius: 8,
  bounciness: 0.2,
  health: 100,
} as const satisfies Record<string, number>;

export const itemSpecifications = {
  diamond: {
    resource: 0,
    label: 'DIAMOND',
    price: 80,
    points: [
      [-3, -4],
      [3, -4],
      [6, -2],
      [0, 6],
      [-6, -2],
    ],
    fillAlpha: 6,
    shades: colors.cyan,
    glint: true,
  },
  amethyst: {
    resource: 1,
    label: 'AMETHYST',
    price: 45,
    points: createPolygon({ pointCount: 6, radius: 7 }),
    fillAlpha: 6,
    shades: colors.violet,
    glint: true,
  },
  gold: {
    resource: 2,
    label: 'GOLD',
    price: 30,
    points: [
      [-7, -4],
      [7, -4],
      [5, 3],
      [-5, 3],
    ],
    lines: [
      [
        [-5, -1],
        [5, -1],
      ],
    ],
    shades: colors.yellow,
    glint: true,
  },
  opal: {
    resource: 3,
    label: 'OPAL',
    price: 45,
    radius: 6,
    rainbow: true,
    shades: colors.white,
    glint: true,
  },
  message: {
    resource: 4,
    unlock: 'ORANGE',
    points: [
      [-7, -5],
      [7, -5],
      [7, 5],
      [-7, 5],
    ],
    lines: [
      [
        [-4, -1],
        [4, -1],
      ],
      [
        [-4, 2],
        [2, 2],
      ],
    ],
    shades: colors.orange,
  },
} satisfies Record<ItemId, ItemSpecification>;
