import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { buildPlugin } from '../../plugins/build-plugins';

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
