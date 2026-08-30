import { generateWorld, worldRadius } from '../src/world.js';
import { writeFile } from 'node:fs/promises';

const seed = Number(process.argv[2] ?? 0);
const world = generateWorld(seed);
const size = 1000;
const padding = 80;
const scale = (size - padding * 2) / (worldRadius * 2);
const center = size / 2;
const point = (value) => center + value * scale;
const fieldColors = ['#62e8ff', '#c86cff', '#ffd54a', '#45d6c5'];
const circles = (objects, fill) => objects.map(({ x, y, radius }) =>
  `<circle cx="${point(x)}" cy="${point(y)}" r="${Math.max(2, radius * scale)}" fill="${fill}"/>`).join('');
const grid = Array.from({ length: 9 }, (_, i) => -40000 + i * 10000)
  .flatMap((offset) => [
    `<line x1="${point(offset)}" y1="${point(-40000)}" x2="${point(offset)}" y2="${point(40000)}"/>`,
    `<line x1="${point(-40000)}" y1="${point(offset)}" x2="${point(40000)}" y2="${point(offset)}"/>`,
  ]).join('');
const fields = world.fields.map((field) =>
  `<circle cx="${point(field.x)}" cy="${point(field.y)}" r="${field.fieldRadius * scale}" ` +
  `fill="black" fill-opacity=".35" stroke="${fieldColors[field.resource] || 'white'}"/>`).join('');
const key = [
  ['white', 'Space station'],
  ['#ff8a38', 'Ship wreck'],
  ['white', 'Mixed asteroid field'],
  ['#45d6c5', 'Opal-rich'],
  ['#ffd54a', 'Gold-rich'],
  ['#c86cff', 'Amethyst-rich'],
  ['#62e8ff', 'Diamond-rich'],
].map(([color, label], i) =>
  `<circle cx="30" cy="${30 + i * 22}" r="5" fill="${color}"/><text x="42" y="${34 + i * 22}">${label}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
  `style="background:#100c1c;font:14px sans-serif"><defs><clipPath id="world"><circle cx="${center}" ` +
  `cy="${center}" r="${worldRadius * scale}"/></clipPath></defs><circle cx="${center}" cy="${center}" ` +
  `r="${worldRadius * scale}" fill="#171326"/><g clip-path="url(#world)" stroke="#fff" ` +
  `stroke-opacity=".08">${grid}</g>` +
  `${fields}${circles(world.stations, 'white')}${circles(world.wrecks, '#ff8a38')}` +
  `<g fill="white">${key}<text x="20" y="190">World diameter: 80,000 m</text></g></svg>`;
const filename = `world-${seed}.svg`;

await writeFile(filename, svg);
console.log(`Wrote ${filename}`);
