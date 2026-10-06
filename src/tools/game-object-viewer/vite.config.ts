import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { buildPrePlugin } from '../../../plugins/build-plugins.ts';

export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    throw new Error('The GameObject Viewer is a development-only tool.');
  }

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { port: 3000, strictPort: true },
    plugins: [
      buildPrePlugin({ DEBUG: true, BENCHMARK: false }),
      {
        name: 'viewer-sources',
        enforce: 'post',
        configureServer(server) {
          // Shared sources are outside this standalone Vite root. Watch their
          // directories too so renderer edits and new specs reach HMR.
          server.watcher.add(
            ['specs', 'client'].map((directory) =>
              fileURLToPath(new URL(`../../${directory}`, import.meta.url)),
            ),
          );
        },
        hotUpdate({ type, modules }) {
          if (type === 'update') return;
          // Recreating a deleted file can leave a pruned module in Vite's
          // graph. Let its current glob importer handle the update instead.
          return modules.filter(
            (module) => module.isSelfAccepting || module.importers.size,
          );
        },
      },
    ],
  };
});
