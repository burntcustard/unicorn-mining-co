/* global process */
import { rolldown } from 'rolldown';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { numericExperiment } from './numeric-experiments.ts';

const directory = await mkdtemp(join(tmpdir(), 'unicorn-numeric-accuracy-'));
const variants = [
  'baseline',
  'grid1000',
  'grid1024',
  'grid1000-smi',
  'position1000',
  'vector-double',
];

type NumericSample = {
  offset: number;
  scenario: string;
  contactTicks: number;
  maxDepth: number;
  trace: number[][];
};

const runs: Record<string, NumericSample[]> = {};

try {
  for (const variant of variants) {
    const bundle = await rolldown({
      input: 'numeric-api',
      platform: 'node',
      plugins: [
        {
          name: 'numeric-api',
          resolveId: (id) =>
            id === 'numeric-api' ? '\0numeric-api' : undefined,
          load: (id) =>
            id === '\0numeric-api'
              ? `
export {GameObject} from '${resolve('src/client/objects/game-object.ts')}';
export {createWorld,addEntity} from '${resolve('src/client/simulation/world.ts')}';
export {updateWorld} from '${resolve('src/client/simulation/update-world.ts')}';
export {contactBetween} from '${resolve('src/client/collision/contact-between.ts')}';
export * as Vec from '${resolve('src/client/utilities/vector.ts')}';`
              : undefined,
          transform: (code, id) => numericExperiment(code, id, variant),
        },
      ],
    });

    const { output } = await bundle.generate({ format: 'esm' });

    await bundle.close();
    const file = join(directory, variant + '.mjs');

    await writeFile(file, output[0].code);

    const {
      GameObject,
      createWorld,
      addEntity,
      updateWorld,
      contactBetween,
      Vec,
    }: {
      GameObject: typeof import('../../src/client/objects/game-object').GameObject;
      createWorld: typeof import('../../src/client/simulation/world').createWorld;
      addEntity: typeof import('../../src/client/simulation/world').addEntity;
      updateWorld: typeof import('../../src/client/simulation/update-world').updateWorld;
      contactBetween: typeof import('../../src/client/collision/contact-between').contactBetween;
      Vec: typeof import('../../src/client/utilities/vector');
    } = await import(pathToFileURL(file).href);

    const samples = [];
    // A fast thin-wall crossing, oblique polygon impacts, circle contacts,
    // and slow sustained pushing, at small and large signed world coordinates.

    for (const offset of [0, 49999, -49999]) {
      for (const scenario of ['wall', 'oblique', 'circles', 'push']) {
        const world = createWorld();
        const polygon = scenario === 'oblique';

        const mover = addEntity(
          world,
          new GameObject({
            id: 1,
            position: Vec.create(offset - 60, offset + 3.123456),
            velocity: Vec.create(
              scenario === 'wall' ? 5000 : scenario === 'push' ? 5 : 100,
              polygon ? 17.2 : 0,
            ),
            radius: 10,
            mass: 10,
            drag: 0,
            maxSpeed: 10000,
            shapeOutline: polygon
              ? [
                  [-9, -7],
                  [9, 0],
                  [-9, 7],
                ]
              : undefined,
          }),
        );

        const obstacle = addEntity(
          world,
          new GameObject({
            id: 2,
            position: Vec.create(offset, offset),
            radius: scenario === 'circles' ? 10 : 101,
            mass: 1e9,
            drag: 0,
            maxSpeed: 10000,
            rotation: polygon ? 0.317 : 0,
            shapeOutline:
              scenario === 'circles'
                ? undefined
                : [
                    [-1, -100],
                    [1, -100],
                    [1, 100],
                    [-1, 100],
                  ],
          }),
        );

        let contactTicks = 0,
          maxDepth = 0;
        const trace = [];

        for (let tick = 0; tick < 600; tick++) {
          if (scenario === 'push') mover.velocity.x = 5;
          updateWorld({ world, inputs: new Map() });
          const contact = contactBetween(
            mover.hitbox()[0],
            obstacle.hitbox()[0],
          );

          if (contact) {
            contactTicks++;
            maxDepth = Math.max(maxDepth, contact.depth);
          }

          const state = [
            mover.position.x,
            mover.position.y,
            mover.rotation,
            mover.velocity.x,
            mover.velocity.y,
            contact?.depth || 0,
          ];

          if (!state.every(Number.isFinite)) {
            throw Error(`${variant} produced nonfinite state`);
          }

          trace.push(state);
        }

        samples.push({ offset, scenario, contactTicks, maxDepth, trace });
      }
    }

    runs[variant] = samples;
  }

  const baseline = runs.baseline;

  const result = Object.entries(runs).map(([variant, scenarios]) => ({
    variant,
    scenarios: scenarios.map((s, index) => {
      const reference = baseline[index];
      let maxPosition = 0,
        maxEdge = 0,
        maxDepthDifference = 0;

      s.trace.forEach((row, tick) => {
        const before = reference.trace[tick];
        const position = Math.hypot(row[0] - before[0], row[1] - before[1]);
        const edge = position + 10 * Math.abs(row[2] - before[2]);

        maxPosition = Math.max(maxPosition, position);
        maxEdge = Math.max(maxEdge, edge);
        maxDepthDifference = Math.max(
          maxDepthDifference,
          Math.abs(row[5] - before[5]),
        );
      });

      const { trace: _trace, ...rest } = s;

      return {
        ...rest,
        maxPosition,
        maxEdge,
        maxDepthDifference,
        maxExtraPixels3840: (maxEdge * 3840) / 1080,
      };
    }),
  }));

  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
