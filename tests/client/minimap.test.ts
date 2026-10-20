import { colors } from '../../src/specs/colors';
import { type Ship } from '../../src/client/objects/ship';
import assert from 'node:assert/strict';
import { minimapRange, renderMinimap } from '../../src/client/ui/minimap';
import { type GameObject } from '../../src/client/objects/game-object';

const contacts: number[][] = [];
const rotations: number[] = [];
const scales: number[][] = [];
let depth = 0;
let points: number[][] = [];

const strokes: { points: number[][]; width: number; color: string }[] = [];

const fills: number[][][] = [];
const draws: string[] = [];

const arcs: {
  x: number;
  y: number;
  radius: number;
  color: string;
  fill: string;
}[] = [];

const ctx = {
  clearRect() {},
  save() {
    depth++;
  },
  restore() {
    depth--;
  },
  translate(x: number, y: number) {
    contacts.push([x, y]);
  },
  rotate(angle: number) {
    rotations.push(angle);
  },
  scale(x: number, y: number) {
    scales.push([x, y]);
  },
  beginPath() {
    points = [];
  },
  arc(this: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    arcs.push({
      x,
      y,
      radius,
      color: this.strokeStyle as string,
      fill: this.fillStyle as string,
    });
  },
  fill() {
    draws.push('fill');
    fills.push([...points]);
  },
  stroke(this: CanvasRenderingContext2D) {
    draws.push('stroke');

    strokes.push({
      points: [...points],
      width: this.lineWidth,
      color: this.strokeStyle as string,
    });
  },
  clip() {},
  moveTo(x: number, y: number) {
    points.push([x, y]);
  },
  lineTo(x: number, y: number) {
    points.push([x, y]);
  },
  closePath() {},
} as unknown as CanvasRenderingContext2D;

const object = (id: number, kind: string, x: number, extra = {}) =>
  ({
    id,
    kind,
    radius: 20,
    position: { x, y: 0 },
    rotation: 0,
    ...extra,
  }) as GameObject;

const hullPoints = [
  [-3, -5],
  [9, 0],
  [-3, 5],
  [-1, 0],
];

const secondHullPoints = [
  [-3, -5],
  [-3, 5],
  [-9, 0],
];

const ship = object(1, 'ship', 100, {
  segments: [
    {
      hull: true,
      module: {},
      health: 1,
      points: hullPoints,
      localPosition: { x: 0, y: 0 },
    },
    {
      hull: true,
      module: {},
      health: 1,
      points: secondHullPoints,
      localPosition: { x: 0, y: 0 },
    },
    {
      hull: false,
      module: { drillTip: {} },
      health: 1,
      points: [
        [0, 0],
        [50, 0],
        [0, 3],
      ],
      localPosition: { x: 0, y: 0 },
    },
  ],
}) as Ship;

const visible = object(2, 'asteroid', 200);

Object.defineProperties(visible, {
  shapeOutline: {
    get() {
      throw new Error('Radar must not read asteroid geometry');
    },
  },
  rotation: {
    get() {
      throw new Error('Radar must not read asteroid rotation');
    },
  },
});

const smoothed = object(3, 'ship', 10000);

renderMinimap({
  ctx,
  ship,
  objects: [
    ship,
    visible,
    smoothed,
    object(4, 'item', 200, { buried: true }),
    object(5, 'ship', 200, { dead: true }),
    object(6, 'projectile', 200),
    object(7, 'asteroid', 10000),
    object(8, 'station', 300, { definitionId: 'corral-6' }),
    object(9, 'item', 400),
    object(10, 'jumpGate', 500),
    object(11, 'asteroid', 150 + minimapRange - 1),
  ],
  poses: new Map([
    [ship.id, { position: { x: 150, y: 0 }, rotation: 1.5 }],
    [smoothed.id, { position: { x: 250, y: 0 }, rotation: 0.75 }],
  ]),
});

assert.equal(
  contacts.length,
  7,
  'only visible supported contacts within radar range are drawn',
);
assert.deepEqual(
  contacts[1],
  [(50 * 148) / minimapRange, 0],
  'contacts are relative to rendered ship position',
);
assert.deepEqual(
  contacts[2],
  [(100 * 148) / minimapRange, 0],
  'remote contacts use smoothed positions',
);
assert(rotations.includes(0.75), 'remote ships use their rendered heading');
assert.equal(
  rotations.at(-1),
  1.5,
  'center arrow uses the rendered player heading',
);
assert.equal(depth, 0, 'map clipping and transforms are restored');
assert.deepEqual(
  strokes[0].points.slice(-4),
  [
    [-148, 0],
    [148, 0],
    [0, -148],
    [0, 148],
  ],
  'map guides include horizontal and vertical diameters in the ring stroke',
);
assert.equal(strokes[0].width, 2, 'map guides have a 2px stroke');

const iconRadius = Math.max(
  ...strokes
    .find(({ points, color }) => points.length === 6 && color === '#3f7')!
    .points.map(([x, y]) => Math.hypot(x, y)),
);

assert(
  arcs.some(
    ({ radius, fill }) =>
      radius < iconRadius * 0.85 && radius > 0 && fill === '#fff',
  ),
  'asteroids use white circles smaller than the previous outline markers',
);
assert(
  strokes.some(({ points, color }) => points.length === 6 && color === '#3f7'),
  'six-sided Corral stations retain their hexagonal icon',
);
assert(
  Math.max(
    ...[...hullPoints, ...secondHullPoints].map(([x, y]) => Math.hypot(x, y)),
  ) *
    scales.at(-1)![0] >
    iconRadius,
  'the player hull is larger than other contacts',
);
assert(
  strokes.some(
    (stroke) => stroke.points.length === 8 && stroke.color === '#fff',
  ),
  'jump gates have a white octagonal outline',
);
assert(
  new Set(arcs.filter(({ radius }) => radius < 30).map(({ color }) => color))
    .size > 1,
  'jump gates contain a multicolor ring',
);
assert.deepEqual(
  fills.at(-1),
  [...hullPoints, ...secondHullPoints],
  'the center marker fills all hull segments together without module geometry',
);
assert.deepEqual(
  strokes.at(-1)!.points,
  fills.at(-1),
  'the outline follows the full player hull',
);
assert(
  strokes.at(-1)!.color.startsWith('#000'),
  'the player hull has a dark outline',
);
assert(
  Math.abs((strokes.at(-1)!.width * scales.at(-1)![0]) / 2 - 2) < 1e-8,
  'the visible player outline matches other map outlines after scaling and filling',
);
assert.deepEqual(
  draws.slice(-2),
  ['stroke', 'fill'],
  'the outlined player hull is drawn above every map contact',
);

assert(
  contacts.at(-1)![0] > 147 && contacts.at(-1)![0] < 148,
  'retained contacts near the unload limit reach the map edge',
);

for (const kind of [
  'asteroid',
  'station',
  'ship',
  'craft',
  'item',
  'jumpGate',
  'wormhole',
]) {
  const contact = object(100, kind, 200, {
    rotation: 0.5,
    shapeOutline: [
      [20, 0],
      [5, 14],
      [-12, 10],
      [-15, -8],
      [7, -12],
    ],
  });

  const drawContact = (target?: GameObject) => {
    strokes.length = 0;
    fills.length = 0;
    arcs.length = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    renderMinimap({ ctx, ship, objects: [contact], poses: new Map(), target });
    return { strokes: [...strokes], arcs: [...arcs], fills: [...fills] };
  };

  const normal = drawContact();
  const targeted = drawContact(contact);

  if (kind === 'asteroid' || kind === 'item') {
    assert.equal(normal.strokes.length, 2, `${kind}: dots have no outline`);
    assert.equal(
      normal.fills[0].length,
      0,
      `${kind}: dots use no polygon vertices`,
    );
    assert.equal(normal.arcs.at(-1)!.radius, 4, `${kind}: dots share a size`);
    assert.equal(
      normal.arcs.at(-1)!.fill,
      kind === 'item' ? '#4df' : '#fff',
      `${kind}: item dots are cyan and asteroid dots are white`,
    );
  }

  const outline = normal.strokes
    .slice(1, -1)
    .find(({ points }) => points.length);
  const radius =
    kind === 'asteroid' || kind === 'item'
      ? normal.arcs.at(-1)!.radius
      : outline
        ? Math.max(...outline.points.map(([x, y]) => Math.hypot(x, y)))
        : normal.arcs.at(-1)!.radius;

  assert(
    kind === 'asteroid' || kind === 'item'
      ? radius > 0 && radius < iconRadius
      : Math.abs(radius - iconRadius) < 1e-8,
    `${kind}: asteroid and item dots are smaller than other contact icons`,
  );
  assert(
    normal.strokes.slice(1, -1).every(({ width }) => width === 2),
    `${kind}: contact outlines share a thickness`,
  );
  const highlight = targeted.strokes.filter(
    ({ points, color }) => points.length === 6 && color === '#e6f',
  );

  assert.equal(highlight.length, 1, `${kind}: target highlight is a hexagon`);
  assert.deepEqual(
    targeted.strokes.filter((stroke) => stroke !== highlight[0]),
    normal.strokes,
    `${kind}: targeting preserves the icon outline and color`,
  );
  assert.deepEqual(
    targeted.arcs,
    normal.arcs,
    `${kind}: targeting adds no circular highlight`,
  );
}

arcs.length = 0;
fills.length = 0;
contacts.length = 0;

renderMinimap({
  ctx,
  ship,
  objects: [visible],
  poses: new Map(),
  asteroidPositions: [
    { x: ship.position.x + minimapRange - 1, y: 0 },
    { x: ship.position.x + minimapRange + 1, y: 0 },
    { x: ship.position.x + minimapRange * (153 / 148), y: 0 },
  ],
});

const radarContacts = arcs.filter(({ radius }) => radius < 10);

assert.equal(
  radarContacts.length,
  2,
  'position-only contacts remain until their entire dot clears the map',
);
assert(
  radarContacts[0].x > 147,
  'unloaded asteroid positions reach the radar edge',
);
assert(
  radarContacts[1].x > 148,
  'asteroid dots whose centers are outside the map still reach the clip',
);
assert.equal(
  contacts.length,
  1,
  'full asteroid entities do not duplicate position-only contacts',
);

for (const clientWidth of [300, 150]) {
  Object.defineProperty(ctx, 'canvas', {
    value: { clientWidth },
    configurable: true,
  });

  const displayScale = 300 / clientWidth;

  for (const kind of ['asteroid', 'item', 'ship', 'station']) {
    for (const targeted of [false, true]) {
      const markerRadius =
        (targeted ? 14 : kind === 'asteroid' || kind === 'item' ? 4 : 8) *
        displayScale;

      for (const overlap of [-0.5, 0.5]) {
        const contact = object(
          100,
          kind,
          ship.position.x +
            ((148 + markerRadius + overlap) * minimapRange) / 148,
        );

        contacts.length = 0;

        renderMinimap({
          ctx,
          ship,
          objects: [contact],
          poses: new Map(),
          target: targeted ? contact : undefined,
        });

        assert.equal(
          contacts.length,
          overlap < 0 ? 2 : 1,
          `${clientWidth}px ${kind}${targeted ? ' target' : ''}: only fully outside markers are culled`,
        );
      }
    }
  }

  arcs.length = 0;
  const padding = (4 * displayScale * minimapRange) / 148;

  renderMinimap({
    ctx,
    ship,
    objects: [],
    poses: new Map(),
    asteroidPositions: [
      { x: ship.position.x + minimapRange + padding / 2, y: 0 },
      { x: ship.position.x + minimapRange + padding + 1, y: 0 },
    ],
  });

  assert.equal(
    arcs.filter(({ radius }) => radius < 10).length,
    1,
    `${clientWidth}px: streamed asteroid dots retain their overlapping edge`,
  );
}

renderMinimap({
  ctx,
  ship,
  objects: [object(99, 'ship', 200, { hostile: true })],
  poses: new Map(),
});

assert(
  strokes.some(
    ({ points, color }) => points.length === 3 && color === colors.red[2],
  ),
  'hostile ships use red triangles',
);
