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
const circles = (objects, fill) => objects.map(({ x, y, radius, shades }) =>
  `<circle cx="${point(x)}" cy="${point(y)}" r="${Math.max(2, radius * scale)}" fill="${fill || shades[2]}"/>`).join('');
const grid = Array.from({ length: 11 }, (_, i) => -worldRadius + i * 10000)
  .flatMap((offset) => [
    `<line x1="${point(offset)}" y1="${point(-worldRadius)}" x2="${point(offset)}" y2="${point(worldRadius)}"/>`,
    `<line x1="${point(-worldRadius)}" y1="${point(offset)}" x2="${point(worldRadius)}" y2="${point(offset)}"/>`,
  ]).join('');
const fields = world.fields.map((field) =>
  `<circle cx="${point(field.x)}" cy="${point(field.y)}" r="${field.fieldRadius * scale}" ` +
  `fill="black" fill-opacity=".35" stroke="${fieldColors[field.resource] || 'white'}"/>`).join('');
const messageLines = world.wrecks.map((wreck) => {
  const clue = /^(AMETHYST CLUSTER|GOLD ORE) (-?\d+)\/(-?\d+)$/.exec(wreck.message);

  if (!clue) return '';

  const resource = clue[1] === 'AMETHYST CLUSTER' ? 1 : 2;
  const field = world.fields.find((candidate) => candidate.resource === resource &&
    Math.round(candidate.x) === Number(clue[2]) && Math.round(candidate.y) === Number(clue[3]));

  if (!field) throw Error(`No field matches wreck message: ${wreck.message}`);

  return `<line x1="${point(wreck.x)}" y1="${point(wreck.y)}" ` +
    `x2="${point(field.x)}" y2="${point(field.y)}" stroke="${fieldColors[resource]}"><title>${wreck.message}</title></line>`;
}).join('');
const key = [
  ['white', 'Space station'],
  ['#fa3', 'Ship wreck (ship color)'],
  ['white', 'Mixed asteroid field'],
  ['#ffd54a', 'Gold-rich'],
  ['#c86cff', 'Amethyst-rich'],
  ['#c86cff', 'Violet line: amethyst message'],
  ['#ffd54a', 'Yellow line: gold message'],
].map(([color, label], i) =>
  `<circle cx="30" cy="${30 + i * 22}" r="5" fill="${color}"/><text x="42" y="${34 + i * 22}">${label}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
  `style="background:#100c1c;font:14px sans-serif"><defs><clipPath id="world"><circle cx="${center}" ` +
  `cy="${center}" r="${worldRadius * scale}"/></clipPath></defs><circle cx="${center}" cy="${center}" ` +
  `r="${worldRadius * scale}" fill="#171326"/><g clip-path="url(#world)" stroke="#fff" ` +
  `stroke-opacity=".08">${grid}</g>` +
  `${fields}<g stroke-opacity=".55">${messageLines}</g>` +
  `${circles(world.stations, 'white')}${circles(world.wrecks)}` +
  `<g fill="white">${key}<text x="20" y="190">World diameter: 100,000 m</text></g></svg>`;
const filename = `world-${seed}.svg`;

await writeFile(filename, svg);
console.log(`Wrote ${filename}`);
