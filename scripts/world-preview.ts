import { writeFile } from 'node:fs/promises';
import * as Vec from '../src/client/utilities/vector';
import {
  generateRegion,
  generateFields,
  generateStations,
  generateWrecks,
  fieldMessage,
} from '../src/client/simulation/region-generation';
import { generateSectorMap } from '../src/client/simulation/sector-generation';
import { regionSize } from '../src/specs/region-manager';

const seed = Number(process.argv[2] ?? 25);
const map = generateSectorMap({ worldSeed: seed });
const sector = map.sectors.find(
  ({ id }) => id === process.argv[3]?.toLowerCase(),
);

if (process.argv[3] && !sector) {
  throw new Error(`Unknown sector: ${process.argv[3]}`);
}

const worldRadius = sector
  ? Math.ceil((Math.max(sector.radiusX, sector.radiusY) * 1.5) / 2000) * 2000
  : 50000;
const size = 1000;
const scale = size / (worldRadius * 2);
const center = size / 2;
const point = (value: number) => center + value * scale;

const fields = generateFields({
  worldSeed: seed,
  sector,
  from: Vec.create(-worldRadius - 4000, -worldRadius - 4000),
  to: Vec.create(worldRadius + 4000, worldRadius + 4000),
});

const visibleFields = fields.filter(
  ({ position }) =>
    Math.abs(position.x) < worldRadius && Math.abs(position.y) < worldRadius,
);
const regions: ReturnType<typeof generateRegion>[] = [];

if (!sector) {
  for (let x = -worldRadius / regionSize; x < worldRadius / regionSize; x++) {
    for (let y = -worldRadius / regionSize; y < worldRadius / regionSize; y++) {
      regions.push(
        generateRegion({ worldSeed: seed, sector, region: Vec.create(x, y) }),
      );
    }
  }
}

const asteroids = regions.flatMap(({ asteroids }) => asteroids);

const bounds = {
  worldSeed: seed,
  sector,
  from: Vec.create(-worldRadius, -worldRadius),
  to: Vec.create(worldRadius, worldRadius),
};

const stations = sector
  ? generateStations(bounds)
  : regions.flatMap(({ stations }) => stations);
const wrecks: import('../src/client/protocol/regions').WreckDescription[] =
  sector ? generateWrecks(bounds) : regions.flatMap(({ wrecks }) => wrecks);

const fieldColors: Record<number, string> = {
  1: '#c86cff',
  2: '#ffd54a',
  4: '#8fb7ba',
};

const paintColors = ['#f32', '#fa3', '#fe4', '#3f7', '#4df'];

const circle = ({
  position,
  radius,
  fill,
  extra = '',
}: {
  position: Vec.Value;
  radius: number;
  fill: string;
  extra?: string;
}) =>
  `<circle cx="${point(position.x)}" cy="${point(position.y)}" ` +
  `r="${radius * scale}" fill="${fill}" ${extra}/>`;

const grid = Array.from(
  { length: 11 },
  (_, index) => -worldRadius + (index * worldRadius) / 5,
)
  .flatMap((offset) => [
    `<line x1="${point(offset)}" y1="0" x2="${point(offset)}" y2="${size}"/>`,
    `<line x1="0" y1="${point(offset)}" x2="${size}" y2="${point(offset)}"/>`,
  ])
  .join('');

const fieldCircles = fields
  .map((field) =>
    circle({
      ...field,
      fill: fieldColors[field.resource],
      extra:
        'fill-opacity=".09" stroke="' +
        fieldColors[field.resource] +
        '" stroke-opacity=".7"',
    }),
  )
  .join('');

const asteroidCircles = asteroids
  .map((asteroid) =>
    circle({
      ...asteroid,
      radius: Math.max(asteroid.radius, 65),
      fill: fieldColors[asteroid.resource],
      extra: 'fill-opacity=".7"',
    }),
  )
  .join('');

const stationCircles = stations
  .map((station) =>
    circle({
      ...station,
      radius: Math.max(station.radius, 250),
      fill: 'white',
    }),
  )
  .join('');

const wreckCircles = wrecks
  .map((wreck) =>
    circle({
      ...wreck,
      radius: 300,
      fill: paintColors[wreck.paint],
    }),
  )
  .join('');

const clueLines = wrecks
  .filter(({ clueField }) => clueField)
  .map(
    ({ position, clueField }) =>
      `<line x1="${point(position.x)}" y1="${point(position.y)}" ` +
      `x2="${point(clueField.position.x)}" y2="${point(clueField.position.y)}" ` +
      `stroke="${fieldColors[clueField.resource]}" stroke-opacity=".55">` +
      `<title>${fieldMessage(clueField)}</title></line>`,
  )
  .join('');

const startRings = [...stations]
  .sort((a, b) => Vec.length(a.position) - Vec.length(b.position))
  .slice(0, 3)
  .map((station) =>
    circle({
      ...station,
      radius: 900,
      fill: 'none',
      extra: 'stroke="#45d6c5" stroke-width="2"',
    }),
  )
  .join('');

const key = [
  ['white', 'Space station'],
  ['#fa3', 'Wreck (paint color)'],
  [fieldColors[4], 'Mixed asteroid field'],
  [fieldColors[2], 'gold field'],
  [fieldColors[1], 'amethyst field'],
  [fieldColors[2], 'gold clue line'],
  [fieldColors[1], 'amethyst clue line'],
  ['#45d6c5', 'Nearest starting stations'],
  ['#45d6c5', 'Jump Gate'],
  ['#b89aff', 'Wormhole'],
]
  .map(
    ([color, label], index) =>
      `<circle cx="30" cy="${30 + index * 22}" r="5" fill="${color}"/>` +
      `<text x="42" y="${34 + index * 22}">${label}</text>`,
  )
  .join('');

const connections = sector
  ? [
      {
        links: map.links,
        sites: sector.gateSites,
        label: 'Jump Gate',
        color: '#45d6c5',
      },
      {
        links: map.wormholeLinks,
        sites: sector.wormholeSites,
        label: 'Wormhole',
        color: '#b89aff',
      },
    ]
      .map(({ links, sites, label, color }) =>
        links
          .filter((link) => link.sectors.includes(sector.id))
          .map((link) => {
            const side = link.sectors.indexOf(sector.id);
            const site = sites[link.sites[side]];

            return `<g><title>${label} to ${link.sectors[1 - side]} at ${site.position.x}/${site.position.y}</title>${circle({ ...site, radius: 1000, fill: color })}</g>`;
          })
          .join(''),
      )
      .join('')
  : '';

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
  `style="background:#171326;font:14px sans-serif">` +
  `<g stroke="#fff" stroke-opacity=".08">${grid}</g>` +
  `${fieldCircles}${asteroidCircles}${clueLines}${stationCircles}${wreckCircles}${connections}` +
  `<circle cx="${center}" cy="${center}" r="${worldRadius * scale}" ` +
  `fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="2"/>` +
  `${startRings}` +
  `<rect x="15" y="12" width="255" height="300" fill="#100c1c" fill-opacity=".9"/>` +
  `<g fill="white">${key}<text x="20" y="258">${sector?.name || 'World'}; seed ${seed}</text>` +
  `<text x="20" y="278">${(worldRadius * 2) / 1000} km square${sector ? '; field overview' : ''}</text></g></svg>`;
const filename = `world-${seed}${sector ? `-${sector.id}` : ''}.svg`;

await writeFile(filename, svg);
console.log(
  `Wrote ${filename}: ${visibleFields.length} fields, ${asteroids.length} asteroids, ` +
    `${stations.length} stations, ${wrecks.length} wrecks`,
);
