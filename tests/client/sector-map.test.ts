import assert from 'node:assert/strict';
import { renderSectorMap, mapRange } from '../../src/client/ui/sector-map';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { createWorld } from '../../src/client/simulation/world';
import * as Vec from '../../src/client/utilities/vector';

const ship = createPlayerShip(createWorld());
const labels: string[] = [];
const labelColors: string[] = [];
const arcs: number[][] = [];
const clips: number[][] = [];
const translations: number[][] = [];
let depth = 0;

const ctx = {
  clearRect() {},
  save() {
    depth++;
  },
  restore() {
    depth--;
  },
  beginPath() {},
  clip() {
    clips.push(arcs.at(-1)!);
  },
  stroke() {},
  fill() {},
  closePath() {},
  moveTo() {},
  lineTo() {},
  rotate() {},
  scale() {},
  strokeText() {},
  fillText(text: string) {
    labels.push(text);
    labelColors.push(ctx.fillStyle as string);
  },
  arc(x: number, y: number, radius: number) {
    arcs.push([x, y, radius]);
  },
  translate(x: number, y: number) {
    translations.push([x, y]);
  },
} as unknown as CanvasRenderingContext2D;

Vec.setXY(ship.position, 1000, 2000);
ship.dockedTo = 42;

const field = {
  kind: 'field' as const,
  id: 20,
  position: Vec.create(3000, 4000),
  radius: 2500,
  name: '',
  definitionId: '',
  color: '',
};

Object.defineProperty(field, 'shapeOutline', {
  get() {
    throw new Error('Map must not read asteroid geometry');
  },
});

const markers = [
  field,
  {
    kind: 'ship' as const,
    id: ship.id,
    position: ship.position,
    radius: 0,
    name: 'Stale own name',
    senderRole: 'owner',
    definitionId: '',
    color: '#fff',
  },
  {
    kind: 'ship' as const,
    id: 99,
    position: Vec.create(4000, 2000),
    radius: 0,
    name: 'Other Pilot',
    senderRole: 'admin',
    definitionId: '',
    color: '#3f7',
  },
  ...(['station', 'jumpGate', 'wormhole'] as const).map((kind, id) => ({
    kind,
    id: id + 30,
    position: Vec.create(2000, 3000),
    radius: 0,
    name: '',
    definitionId: 'corral-6',
    color: '',
  })),
];

const options = {
  ctx,
  ship,
  poses: new Map([[99, { position: Vec.create(5000, 2000), rotation: 0 }]]),
  mapCenter: Vec.clone(ship.position),
  mapMarkers: markers,
  displayName: 'Your Pilot',
  displayScale: 1,
};

renderSectorMap(options);
assert.deepEqual(
  clips,
  [[300, 300, 298]],
  'all map drawing is clipped to the circular viewport',
);
assert.deepEqual(
  labels,
  ['Other Pilot', 'Your Pilot'],
  'players are labeled once, including your docked ship',
);
assert.deepEqual(
  labelColors,
  ['#4df', '#ff0'],
  'labels use player roles, including your own',
);
assert(
  arcs.some(([, , radius]) => radius === (2500 * 296) / mapRange),
  'field circles show their real radius',
);
assert(
  translations.some(([x, y]) => x === (4000 * 296) / mapRange && y === 0),
  'nearby players use their smoothed poses',
);
assert.equal(
  depth,
  0,
  'map clipping and nested marker transforms are restored',
);
labels.length = arcs.length = translations.length = 0;
options.mapCenter.x += 6000;
renderSectorMap(options);
assert(
  translations.some(([x, y]) => x === (-6000 * 296) / mapRange && y === 0),
  'panning moves your own marker away from the map center',
);
assert.equal(depth, 0);

// Grid lines stay anchored to world coordinates as the viewport zooms.
for (const range of [mapRange, mapRange * 2]) {
  const lines: number[] = [];
  let grid = true;

  const gridContext = Object.assign(
    Object.create(ctx) as CanvasRenderingContext2D,
    {
      moveTo(x: number, y: number) {
        if (grid && y === -300) lines.push(x);
      },
      stroke() {
        grid = false;
      },
    },
  );

  renderSectorMap({
    ...options,
    ctx: gridContext,
    mapCenter: Vec.create(),
    range,
  });

  assert(lines.includes(0));
  assert(lines.includes((10000 * 296) / range));
}
