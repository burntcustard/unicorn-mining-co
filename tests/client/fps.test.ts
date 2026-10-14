import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { type GameState } from '../../src/client/game';

const bundle = await rolldown({
  input: 'src/client/ui/fps.ts',
  plugins: [
    {
      name: 'fps-text-fixture',
      load: (id) => {
        if (id.endsWith('/src/client/ui/text.ts')) {
          return 'export const renderText = ({ game, text }) => game.ctx.fillText(text);';
        }
      },
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const clock = globalThis.performance;
let now = 0;
let readings = 0;
const labels: string[] = [];

const game = {
  ctx: { fillText: (text: string) => labels.push(text) },
} as unknown as GameState;

globalThis.performance = {
  now: () => {
    readings++;
    return now;
  },
} as Performance;

try {
  const { renderFps, toggleFps }: typeof import('../../src/client/ui/fps') =
    await import(
      `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
    );
  const render = () => renderFps({ game, x: 20 });

  render();
  assert.equal(labels.at(-1), 'FPS:0', 'FPS starts enabled');

  for (now = 100; now <= 500; now += 100) render();
  assert.equal(labels.at(-1), 'FPS:10', 'FPS uses its 200 ms sampling window');
  toggleFps();
  const before = { readings, labels: labels.length };

  for (now = 1000; now <= 10000; now += 1000) render();
  assert.equal(readings, before.readings, 'hidden FPS never reads the clock');
  assert.equal(labels.length, before.labels, 'hidden FPS never renders text');
  toggleFps();
  assert.equal(readings, before.readings, 'toggling does not sample FPS');
  render();
  assert.equal(labels.at(-1), 'FPS:0', 'enabling clears the old reading');
  now += 100;
  render();
  assert.equal(labels.at(-1), 'FPS:0', 'FPS waits for a fresh sampling window');
  now += 100;
  render();
  assert.equal(
    labels.at(-1),
    'FPS:15',
    'enabling counts fresh frames and excludes time while hidden',
  );
} finally {
  globalThis.performance = clock;
}
