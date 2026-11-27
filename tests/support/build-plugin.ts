import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import { stripIfdef } from '../../plugins/replace-pre-terser';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins';

const cache = process.env.TEST_BUILD_CACHE
  ? JSON.parse(readFileSync(process.env.TEST_BUILD_CACHE, 'utf8'))
  : undefined;
const plugin = buildPlugin({}, cache);
let initialized: Promise<void>;

/**
 * Transform test helpers that access runtime properties with the same shared
 * property cache as source modules in production fixtures.
 */
export function testBuildPlugin() {
  const fixturePlugin: Plugin = {
    ...plugin,
    buildStart() {
      // Source files stay fixed within a test process. Seed the real production
      // property cache once, then share it across that process's fixture builds.
      return (initialized ??= plugin.buildStart.call(this));
    },
    transform(code, id) {
      return plugin.transform.call(
        this,
        code,
        id.replace('/tests/support/', '/src/__test_support/'),
      );
    },
  };

  delete fixturePlugin.generateBundle;
  return fixturePlugin;
}

/**
 * Run a scenario with the production transforms and browser API stubs.
 */
export async function runProductionScenario({
  name,
  source,
  modules = {},
}: {
  name: string;
  source: string;
  modules?: Record<string, string>;
}) {
  const entry = `${process.cwd()}/src/__${name}_test.ts`;
  const replacements = Object.entries(modules);

  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name,
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? stripIfdef(
                source.replace(
                  /assert\.(\w+)/g,
                  (_, method) => `Reflect.get(assert, '${method}')`,
                ),
              )
            : replacements.find(([path]) => id.endsWith(path))?.[1],
      },
      buildPrePlugin(),
      testBuildPlugin(),
    ],
  });

  try {
    const { output } = await bundle.generate({ format: 'esm', minify: true });
    const code = output[0].code + `\n//# sourceURL=${name}.fixture.js`;

    return await import(
      `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    );
  } finally {
    await bundle.close();
  }
}
