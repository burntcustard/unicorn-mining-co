import { rolldown } from 'rolldown';
import { writeFile } from 'node:fs/promises';

const bundle = await rolldown({
  input: 'world-entry',
  plugins: [
    {
      name: 'world-entry',
      load: (id) =>
        id === '\0world-entry'
          ? `
            export { generateRegion, generateFields, fieldMessage } from '${process.cwd()}/src/shared/simulation/region-generation.ts';
            export * as Vec from '${process.cwd()}/src/shared/vector.ts';
          `
          : undefined,
      resolveId: (id) => (id === 'world-entry' ? '\0world-entry' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();

const { generateRegion, generateFields, fieldMessage, Vec } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const seed = Number(process.argv[2] ?? 25);
const worldRadius = 50000;
const regionSize = 2000;
const size = 1000;
const scale = size / (worldRadius * 2);
const center = size / 2;
const point = (value) => center + value * scale;
const fields = generateFields({
  worldSeed: seed,
  from: Vec.create(-worldRadius - 4000, -worldRadius - 4000),
  to: Vec.create(worldRadius + 4000, worldRadius + 4000),
});
const visibleFields = fields.filter(
  ({ position }) =>
    Math.abs(position.x) < worldRadius && Math.abs(position.y) < worldRadius,
);
const regions = [];

for (let x = -worldRadius / regionSize; x < worldRadius / regionSize; x++) {
  for (let y = -worldRadius / regionSize; y < worldRadius / regionSize; y++) {
    regions.push(generateRegion({ worldSeed: seed, region: Vec.create(x, y) }));
  }
}

const asteroids = regions.flatMap(({ asteroids }) => asteroids);
const stations = regions.flatMap(({ stations }) => stations);
const wrecks = regions.flatMap(({ wrecks }) => wrecks);
const fieldColors = { 1: '#c86cff', 2: '#ffd54a', 4: '#8fb7ba' };
const paintColors = ['#f32', '#fa3', '#fe4', '#3f7', '#4df'];
const circle = ({ position, radius, fill, extra = '' }) =>
  `<circle cx="${point(position.x)}" cy="${point(position.y)}" ` +
  `r="${radius * scale}" fill="${fill}" ${extra}/>`;
const grid = Array.from(
  { length: 11 },
  (_, index) => -worldRadius + index * 10000,
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
  ['#fa3', 'Wreck (paint colour)'],
  [fieldColors[4], 'Mixed asteroid field'],
  [fieldColors[2], 'Gold field'],
  [fieldColors[1], 'Amethyst field'],
  [fieldColors[2], 'Gold clue line'],
  [fieldColors[1], 'Amethyst clue line'],
  ['#45d6c5', 'Nearest starting stations'],
]
  .map(
    ([color, label], index) =>
      `<circle cx="30" cy="${30 + index * 22}" r="5" fill="${color}"/>` +
      `<text x="42" y="${34 + index * 22}">${label}</text>`,
  )
  .join('');
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
  `style="background:#171326;font:14px sans-serif">` +
  `<g stroke="#fff" stroke-opacity=".08">${grid}</g>` +
  `${fieldCircles}${asteroidCircles}${clueLines}${stationCircles}${wreckCircles}` +
  `<circle cx="${center}" cy="${center}" r="${worldRadius * scale}" ` +
  `fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="2"/>` +
  `${startRings}` +
  `<rect x="15" y="12" width="255" height="256" fill="#100c1c" fill-opacity=".9"/>` +
  `<g fill="white">${key}<text x="20" y="214">Seed ${seed}; 100 km square</text>` +
  `<text x="20" y="234">Circle: old 50 km world radius</text></g></svg>`;
const filename = `world-${seed}.svg`;

await writeFile(filename, svg);
console.log(
  `Wrote ${filename}: ${visibleFields.length} fields, ${asteroids.length} asteroids, ` +
    `${stations.length} stations, ${wrecks.length} wrecks`,
);
