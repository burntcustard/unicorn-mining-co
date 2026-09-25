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
            export { RegionManager } from '${process.cwd()}/src/shared/simulation/region-manager.ts';
            export * as Vec from '${process.cwd()}/src/shared/vector.ts';
          `
          : undefined,
      resolveId: (id) => (id === 'world-entry' ? '\0world-entry' : undefined),
    },
  ],
});
const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();

const { RegionManager, Vec } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const seed = Number(process.argv[2] ?? 25);
const worldRadius = 10000;
const manager = new RegionManager({ worldSeed: seed });
const world = manager.query({ position: Vec.create() });
const size = 1000;
const padding = 80;
const scale = (size - padding * 2) / (worldRadius * 2);
const center = size / 2;
const point = (value) => center + value * scale;
const circles = ({ objects, fill }) =>
  objects
    .map(
      ({ position, radius }) =>
        `<circle cx="${point(position.x)}" cy="${point(position.y)}" ` +
        `r="${Math.max(2, radius * scale)}" fill="${fill}"/>`,
    )
    .join('');
const grid = Array.from(
  { length: 11 },
  (_, index) => -worldRadius + index * 2000,
)
  .flatMap((offset) => [
    `<line x1="${point(offset)}" y1="${point(-worldRadius)}" x2="${point(offset)}" y2="${point(worldRadius)}"/>`,
    `<line x1="${point(-worldRadius)}" y1="${point(offset)}" x2="${point(worldRadius)}" y2="${point(offset)}"/>`,
  ])
  .join('');
const startingStations = [...world.stationMarkers]
  .sort((a, b) => Vec.length(a.position) - Vec.length(b.position))
  .slice(0, 3);
const startRings = startingStations
  .map(
    ({ position, radius }) =>
      `<circle cx="${point(position.x)}" cy="${point(position.y)}" ` +
      `r="${Math.max(2, radius * scale) + 4}" fill="none" ` +
      `stroke="#45d6c5" stroke-width="2"/>`,
  )
  .join('');
const key = [
  ['white', 'Station description'],
  ['#fa3', 'Wreck description'],
  ['#555', 'Asteroid description'],
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
  `style="background:#100c1c;font:14px sans-serif"><defs><clipPath id="world">` +
  `<circle cx="${center}" cy="${center}" r="${worldRadius * scale}"/>` +
  `</clipPath></defs><circle cx="${center}" cy="${center}" ` +
  `r="${worldRadius * scale}" fill="#171326"/><g clip-path="url(#world)" ` +
  `stroke="#fff" stroke-opacity=".08">${grid}</g>` +
  `${circles({ objects: world.asteroids, fill: '#555' })}` +
  `${circles({ objects: world.stationMarkers, fill: 'white' })}` +
  `${circles({ objects: world.wrecks, fill: '#fa3' })}${startRings}` +
  `<g fill="white">${key}<text x="20" y="130">20 km regional preview</text>` +
  `<text x="20" y="150">No simulation entities constructed</text></g></svg>`;
const filename = `world-${seed}.svg`;

await writeFile(filename, svg);
console.log(`Wrote ${filename}`);
