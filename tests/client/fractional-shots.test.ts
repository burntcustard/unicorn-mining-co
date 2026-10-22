import { readFile } from 'node:fs/promises';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins.ts';
import { testBuildPlugin } from '../support/build-plugin';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const root = process.cwd();
const entry = `${root}/src/__fractional_shots_test.ts`;
const source = (
  await readFile(
    new URL('../support/fractional-shots.ts', import.meta.url),
    'utf8',
  )
).replaceAll("'../../src/", `'${root}/src/`);

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'fractional-shots-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load(id) {
          if (id !== entry) return;

          return production
            ? stripIfdef(
                source.replace(
                  /assert\.(\w+)/g,
                  (_, method) => `Reflect.get(assert, '${method}')`,
                ),
              )
            : source;
        },
      },
      buildPrePlugin(),
      ...(production ? [testBuildPlugin()] : []),
    ],
  });

  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
