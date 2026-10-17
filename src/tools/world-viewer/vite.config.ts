import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    throw new Error('The World Viewer is a development-only tool.');
  }

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { port: 3000, strictPort: true },
    plugins: [
      {
        name: 'world-viewer-sources',
        configureServer(server) {
          server.watcher.add(
            ['specs', 'client'].map((directory) =>
              fileURLToPath(new URL(`../../${directory}`, import.meta.url)),
            ),
          );
        },
        hotUpdate({ type, server }) {
          if (type !== 'update') {
            server.ws.send({ type: 'full-reload' });
            return [];
          }
        },
      },
    ],
  };
});
