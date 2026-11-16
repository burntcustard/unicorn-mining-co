/* global Buffer, process */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { testBuildPlugin } from '../support/build-plugin';

const entry = resolve('src/__npc_ships_test.ts');
const scenario = readFileSync('tests/client/npc-ships.test.ts', 'utf8')
  .replaceAll('../../src/', process.cwd() + '/src/')
  .replace(/assert\.(\w+)/g, (_, method) => `Reflect.get(assert, '${method}')`);

const bundle = await rolldown({
  input: entry,
  external: ['node:assert/strict'],
  plugins: [
    {
      name: 'npc-ships-test',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) => (id === entry ? scenario : undefined),
    },
    buildPrePlugin(),
    testBuildPlugin(),
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
await import(
  'data:text/javascript;base64,' +
    Buffer.from(output[0].code).toString('base64')
);
