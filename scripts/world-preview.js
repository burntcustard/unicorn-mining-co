import { generateWorld } from '../src/world.js';
import { writeFile } from 'node:fs/promises';

const seed = Number(process.argv[2] ?? 0);
const world = generateWorld(seed);
const size = 1000;
const padding = 80;
const scale = (size - padding * 2) / (world.radius * 2);
const center = size / 2;
const point = (value) => center + value * scale;
const fieldColors = {
  ordinary: 'white',
  gold: '#ffd54a',
  amethyst: '#c86cff',
  opal: '#45d6c5',
  diamond: '#62e8ff',
};
const circles = (objects, fill) => objects.map(({ x, y, radius }) =>
  `<circle cx="${point(x)}" cy="${point(y)}" r="${Math.max(2, radius * scale)}" fill="${fill}"/>`).join('');
const grid = Array.from({ length: 9 }, (_, i) => -40000 + i * 10000)
  .flatMap((offset) => [
    `<line x1="${point(offset)}" y1="${point(-40000)}" x2="${point(offset)}" y2="${point(40000)}"/>`,
    `<line x1="${point(-40000)}" y1="${point(offset)}" x2="${point(40000)}" y2="${point(offset)}"/>`,
  ]).join('');
const fields = world.fields.map((field) =>
  `<ellipse cx="${point(field.x)}" cy="${point(field.y)}" ` +
  `rx="${field.fieldRadius * scale}" ry="${field.fieldRadius * field.aspectRatio * scale}" ` +
  `transform="rotate(${field.rotation * 180 / Math.PI} ${point(field.x)} ${point(field.y)})" ` +
  `fill="black" fill-opacity=".35" stroke="${fieldColors[field.resource]}"/>`).join('');
const key = [
  ['white', 'Space station'],
  ['#ff8a38', 'Ship wreck'],
  ['white', 'Ordinary asteroid field (10)'],
  ['#ffd54a', 'Gold-rich (3)'],
  ['#c86cff', 'Amethyst-rich (2)'],
  ['#45d6c5', 'Opal-rich (4)'],
  ['#62e8ff', 'Diamond-rich (1)'],
].map(([color, label], i) =>
  `<circle cx="30" cy="${30 + i * 22}" r="5" fill="${color}"/><text x="42" y="${34 + i * 22}">${label}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
  `style="background:#100c1c;font:14px sans-serif"><defs><clipPath id="world"><circle cx="${center}" ` +
  `cy="${center}" r="${world.radius * scale}"/></clipPath></defs><circle cx="${center}" cy="${center}" ` +
  `r="${world.radius * scale}" fill="#171326"/><g clip-path="url(#world)" stroke="#fff" ` +
  `stroke-opacity=".08">${grid}</g>` +
  `${fields}${circles(world.stations, 'white')}${circles(world.wrecks, '#ff8a38')}` +
  `<g fill="white">${key}<text x="20" y="190">World diameter: 80,000 m</text></g></svg>`;
const filename = `world-${seed}.svg`;

await writeFile(filename, svg);
console.log(`Wrote ${filename}`);
