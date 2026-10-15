import type { Plugin } from 'vite';
import { buildPlugin } from '../../plugins/build-plugins';

/**
 * Transform test helpers that access runtime properties with the same shared
 * property cache as source modules in production fixtures.
 */
export function testBuildPlugin() {
  const plugin = buildPlugin();

  const fixturePlugin: Plugin = {
    ...plugin,
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
