import { laser } from '../../specs/modules/laser';

const scytheShades = [
  '#343b42',
  '#cebb26',
  '#ffeb42',
  '#a9b2ba',
  '#d85837',
] as const;

// Review alternatives rendered with the production module geometry and beam.
export const laserDesigns = [
  {
    name: 'A / Layered wedge',
    description: 'Scythe-style casing, inset panels, compact power cell.',
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [14, -3],
          [18, -3],
          [18, 3],
          [14, 3],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [14, -1],
          [17, -5],
          [27, -1],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [14, 1],
          [27, 1],
          [17, 5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [17, -2],
          [18, -4],
          [25, -2],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [17, 2],
          [25, 2],
          [18, 4],
        ],
      },
    ],
  },
  {
    name: 'B / Capacitor housing',
    description: 'Fallout-style block housing and a visible rear power cell.',
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [14, -4],
          [18, -4],
          [18, 4],
          [14, 4],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [16, -1],
          [16, -5],
          [22, -5],
          [27, -1],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [16, 1],
          [27, 1],
          [22, 5],
          [16, 5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [18, -2],
          [18, -4],
          [21, -4],
          [24, -2],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [18, 2],
          [24, 2],
          [21, 4],
          [18, 4],
        ],
      },
    ],
  },
  {
    name: 'C / Split cooling rails',
    description:
      'Slim industrial rails, stepped muzzle and exposed inner channels.',
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [14, -2.5],
          [19, -2.5],
          [19, 2.5],
          [14, 2.5],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [14, -1],
          [17, -4],
          [25, -4],
          [27, -2],
          [27, -1],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [14, 1],
          [27, 1],
          [27, 2],
          [25, 4],
          [17, 4],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [19, -1],
          [20, -2.5],
          [25, -2.5],
          [26, -1],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [19, 1],
          [26, 1],
          [25, 2.5],
          [20, 2.5],
        ],
      },
    ],
  },
  {
    name: 'D / Long wedge',
    description:
      'Two plain triangles, extended back to the mount; the widest point sits beyond the hull edge.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 2,
        points: [
          [0, -1],
          [20, -5],
          [34, -1],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [0, 1],
          [34, 1],
          [20, 5],
        ],
      },
    ],
  },
  {
    name: 'E / Wedge with spine',
    description:
      'Two simple tips on a dark mounting spine; three shapes and no inset detail.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -2],
          [22, -2],
          [22, 2],
          [0, 2],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [12, -1],
          [22, -5],
          [34, -1],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [12, 1],
          [34, 1],
          [22, 5],
        ],
      },
    ],
  },
  {
    name: 'F / Slim fork',
    description:
      'Two long, flat rails with tapered tips; the simplest and narrowest silhouette.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 2,
        points: [
          [0, -1],
          [0, -3],
          [26, -3],
          [34, -1],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [0, 1],
          [34, 1],
          [26, 3],
          [0, 3],
        ],
      },
    ],
  },
  {
    name: 'G / Magnetron fork',
    description:
      'A narrow mounting neck ends in a square tuning fork, with a wide open beam channel.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -1.5],
          [24, -1.5],
          [24, 1.5],
          [0, 1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [20, -6],
          [24, -6],
          [24, 6],
          [20, 6],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [24, -6],
          [34, -6],
          [34, -3],
          [24, -3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [24, 3],
          [34, 3],
          [34, 6],
          [24, 6],
        ],
      },
    ],
  },
  {
    name: 'H / Split lens',
    description:
      'An open octagonal lens on a slim stem; the beam passes between two solid curved jaws.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -1.5],
          [25, -1.5],
          [25, 1.5],
          [0, 1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, -1.5],
          [24, -6],
          [31, -6],
          [34, -1.5],
          [31, -1.5],
          [29, -3.5],
          [26, -3.5],
          [24, -1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, 1.5],
          [24, 1.5],
          [26, 3.5],
          [29, 3.5],
          [31, 1.5],
          [34, 1.5],
          [31, 6],
          [24, 6],
        ],
      },
    ],
  },
  {
    name: 'I / Staged focuser',
    description:
      'Two chunky capacitor blocks followed by two smaller focusing plates. Only rectangles.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -1.5],
          [31, -1.5],
          [31, 1.5],
          [0, 1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [18, -5],
          [24, -5],
          [24, -1.5],
          [18, -1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [18, 1.5],
          [24, 1.5],
          [24, 5],
          [18, 5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [30, -3.5],
          [34, -3.5],
          [34, -1.5],
          [30, -1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [30, 1.5],
          [34, 1.5],
          [34, 3.5],
          [30, 3.5],
        ],
      },
    ],
  },
  {
    name: 'J / Scythe shroud',
    description:
      'A continuous yellow barrel housing with a small tapered muzzle opening. Three solid shapes.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -3],
          [27, -3],
          [27, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [7, -1],
          [7, -4],
          [28, -4],
          [34, -1],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [7, 1],
          [34, 1],
          [28, 4],
          [7, 4],
        ],
      },
    ],
  },
  {
    name: 'K / Armoured wedge',
    description:
      'A compact wedge casing around one broad power panel; a narrow split only at the nose.',
    barrelLength: 34,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -3],
          [26, -3],
          [26, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [7, -1],
          [11, -5],
          [24, -5],
          [34, -1],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [7, 1],
          [34, 1],
          [24, 5],
          [11, 5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [13, -3],
          [24, -3],
          [30, 0],
          [24, 3],
          [13, 3],
        ],
      },
    ],
  },
  {
    name: 'L / Bare shroud',
    description:
      'Long yellow casing, silver rear coupling, and a thin metal muzzle frame.',
    barrelLength: 34,
    shades: scytheShades,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -3],
          [33, -3],
          [33, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [9, -4],
          [12, -4],
          [12, 4],
          [9, 4],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [12, -4],
          [30, -4],
          [30, 4],
          [12, 4],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [31, -4],
          [34, -4],
          [34, -1],
          [31, -1],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [31, 1],
          [34, 1],
          [34, 4],
          [31, 4],
        ],
      },
    ],
  },
  {
    name: 'M / Cooling stripe',
    description:
      "A longer yellow housing with the reference weapon's single dark cooling stripe.",
    barrelLength: 34,
    shades: scytheShades,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -3],
          [33, -3],
          [33, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [8, -3],
          [10, -4],
          [31, -4],
          [31, 4],
          [10, 4],
          [8, 3],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [32, -4],
          [34, -4],
          [34, -1],
          [32, -1],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [32, 1],
          [34, 1],
          [34, 4],
          [32, 4],
        ],
      },
      {
        outline: false,
        color: 0,
        points: [
          [15, -3],
          [27, -3],
          [27, -2],
          [15, -2],
        ],
      },
    ],
  },
  {
    name: 'N / Power conduit',
    description:
      'An exposed rear power feed, a plain yellow box, and a compact silver emitter.',
    barrelLength: 34,
    shades: scytheShades,
    model: [
      {
        outline: false,
        color: 0,
        points: [
          [0, -3],
          [33, -3],
          [33, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [14, -4],
          [31, -4],
          [31, 4],
          [14, 4],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [32, -4],
          [34, -4],
          [34, -1],
          [32, -1],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [32, 1],
          [34, 1],
          [34, 4],
          [32, 4],
        ],
      },
      {
        outline: false,
        color: 4,
        points: [
          [7, -2],
          [16, -4],
          [16, -3],
          [7, -1],
        ],
      },
    ],
  },
  {
    name: 'O / End band',
    description:
      'Straight grey rails with a yellow muzzle band and a small grey tip.',
    barrelLength: 28,
    model: [
      {
        outline: false,
        color: 3,
        points: [
          [0, -0.5],
          [0, -1.5],
          [28, -1.5],
          [28, -0.5],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [0, 0.5],
          [28, 0.5],
          [28, 1.5],
          [0, 1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [25, -0.5],
          [25, -1.5],
          [27, -1.5],
          [27, -0.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [25, 0.5],
          [27, 0.5],
          [27, 1.5],
          [25, 1.5],
        ],
      },
    ],
  },
  {
    name: 'P / Sloped cap',
    description:
      'The same slender body with a yellow band behind a chamfered grey nose.',
    barrelLength: 28,
    model: [
      {
        outline: false,
        color: 3,
        points: [
          [0, -0.5],
          [0, -1.5],
          [25, -1.5],
          [28, -0.5],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [0, 0.5],
          [28, 0.5],
          [25, 1.5],
          [0, 1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [23, -0.5],
          [23, -1.5],
          [25, -1.5],
          [25, -0.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [23, 0.5],
          [25, 0.5],
          [25, 1.5],
          [23, 1.5],
        ],
      },
    ],
  },
  {
    name: 'Q / Flush cap',
    description:
      'A shorter grey body with a yellow band extending right to the muzzle.',
    barrelLength: 24,
    model: [
      {
        outline: false,
        color: 3,
        points: [
          [0, -0.5],
          [2, -1.5],
          [24, -1.5],
          [24, -0.5],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [0, 0.5],
          [24, 0.5],
          [24, 1.5],
          [2, 1.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [22, -0.5],
          [22, -1.5],
          [24, -1.5],
          [24, -0.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [22, 0.5],
          [24, 0.5],
          [24, 1.5],
          [22, 1.5],
        ],
      },
    ],
  },
  {
    name: 'R / Yellow housing',
    description:
      'A narrow glowing channel, solid yellow collar, flush grey section, and thick yellow cap.',
    barrelLength: laser.barrelLength,
    model: laser.model,
  },
  {
    name: 'S / Bevelled housing',
    description:
      'Clipped rear corners and a bevelled yellow cap, keeping the straight grey band.',
    barrelLength: 28,
    model: [
      {
        outline: false,
        color: 3,
        points: [
          [23, -3],
          [26, -3],
          [26, 3],
          [23, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [0, -2],
          [1, -3],
          [23, -3],
          [23, -0.5],
          [14, -0.5],
          [14, 0.5],
          [23, 0.5],
          [23, 3],
          [1, 3],
          [0, 2],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, -3],
          [23, -3],
          [23, 3],
          [21, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [26, -3],
          [27, -3],
          [28, -2],
          [28, 2],
          [27, 3],
          [26, 3],
        ],
      },
    ],
  },
  {
    name: 'T / Slanted collar',
    description:
      'A diagonal yellow collar and grey band, with a simple square end cap.',
    barrelLength: 28,
    model: [
      {
        outline: false,
        color: 3,
        points: [
          [23, -3],
          [26, -3],
          [26, 3],
          [23, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [0, -3],
          [24, -3],
          [24, -0.5],
          [14, -0.5],
          [14, 0.5],
          [23, 0.5],
          [23, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, -3],
          [24, -3],
          [23, 3],
          [21, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [26, -3],
          [28, -3],
          [28, 3],
          [26, 3],
        ],
      },
    ],
  },
  {
    name: 'U / Stepped housing',
    description:
      'A slimmer rear section opening into a wider yellow body and a longer beam channel.',
    barrelLength: 28,
    model: [
      {
        outline: false,
        color: 3,
        points: [
          [23, -3],
          [26, -3],
          [26, 3],
          [23, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [0, -2],
          [8, -2],
          [10, -3],
          [23, -3],
          [23, -0.5],
          [12, -0.5],
          [12, 0.5],
          [23, 0.5],
          [23, 3],
          [10, 3],
          [8, 2],
          [0, 2],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, -3],
          [23, -3],
          [23, 3],
          [21, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [26, -3],
          [28, -3],
          [28, 3],
          [26, 3],
        ],
      },
    ],
  },
  {
    name: 'V / Twin rails',
    description:
      'Two separate yellow rails, a grey rear block, and a long exposed beam channel.',
    barrelLength: 28,
    shades: [
      laser.shades[0],
      laser.shades[1],
      laser.shades[2],
      laser.shades[3],
      '#99a',
    ],
    model: [
      {
        outline: false,
        color: 4,
        points: [
          [0, -3],
          [8, -3],
          [8, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [8, -3],
          [23, -3],
          [23, -0.5],
          [8, -0.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [8, 0.5],
          [23, 0.5],
          [23, 3],
          [8, 3],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [21, -3],
          [23, -3],
          [23, 3],
          [21, 3],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [23, -3],
          [26, -3],
          [26, 3],
          [23, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [26, -3],
          [28, -3],
          [28, 3],
          [26, 3],
        ],
      },
    ],
  },
  {
    name: 'W / Square neck',
    description:
      'A full yellow receiver stepping into a narrow yellow neck before the wide grey muzzle section.',
    barrelLength: 28,
    shades: [
      laser.shades[0],
      laser.shades[1],
      laser.shades[2],
      laser.shades[3],
      '#99a',
    ],
    model: [
      {
        outline: false,
        color: 2,
        points: [
          [0, -3],
          [21, -3],
          [21, -0.5],
          [14, -0.5],
          [14, 0.5],
          [21, 0.5],
          [21, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [0, -3],
          [6, -3],
          [6, 3],
          [0, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, -1.5],
          [23, -1.5],
          [23, 1.5],
          [21, 1.5],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [23, -3],
          [26, -3],
          [26, 3],
          [23, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [26, -3],
          [28, -3],
          [28, 3],
          [26, 3],
        ],
      },
    ],
  },
  {
    name: 'X / Offset housing',
    description:
      'A heavy upper yellow housing, slim lower rail, and square full-width muzzle block.',
    barrelLength: 28,
    shades: [
      laser.shades[0],
      laser.shades[1],
      laser.shades[2],
      laser.shades[3],
      '#99a',
    ],
    model: [
      {
        outline: false,
        color: 2,
        points: [
          [0, -3],
          [23, -3],
          [23, -0.5],
          [14, -0.5],
          [14, 0.5],
          [23, 0.5],
          [23, 1.5],
          [0, 1.5],
        ],
      },
      {
        outline: false,
        color: 1,
        points: [
          [9, -3],
          [12, -3],
          [12, -0.5],
          [9, -0.5],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [21, -3],
          [23, -3],
          [23, 3],
          [21, 3],
        ],
      },
      {
        outline: false,
        color: 3,
        points: [
          [23, -3],
          [26, -3],
          [26, 3],
          [23, 3],
        ],
      },
      {
        outline: false,
        color: 2,
        points: [
          [26, -3],
          [28, -3],
          [28, 3],
          [26, 3],
        ],
      },
    ],
  },
  {
    name: 'Y / Grey emitter',
    description:
      'A single yellow frame with short grey inserts and a dark emitter between light grey edges.',
    barrelLength: laser.barrelLength,
    model: laser.model,
  },
].map((design) => ({
  ...design,
  spec: {
    ...laser,
    shades: laser.shades,
    modelShades: design.shades ?? laser.modelShades,
    barrelLength: design.barrelLength ?? laser.barrelLength,
    model: design.model,
  },
}));
