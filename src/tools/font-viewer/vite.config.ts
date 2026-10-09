import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { defineConfig, type Plugin } from 'vite';

const root = new URL('../../../', import.meta.url);
const glyphSource = new URL('font/glyph-paths.ts', root);
const generator = new URL('scripts/generate-font.ts', root);
const fontFile = new URL('font/gemetric.woff2', root);
const sources = [
  glyphSource,
  generator,
  new URL('scripts/compact-font.ts', root),
].map((source) => fileURLToPath(source));

export default defineConfig(async ({ command }) => {
  if (command !== 'serve') {
    throw new Error('The Gemetric Font Viewer is a development-only tool.');
  }

  let revision = 0;

  const generate = async () => {
    // A fresh Node process reads edited TypeScript without a stale module cache.
    // Use the production generator and keep its checked-in output up to date.
    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(generator),
      '--json',
    ]);
    const buffer = await readFile(fontFile);

    return {
      buffer,
      metadata: {
        ...JSON.parse(stdout),
        revision: ++revision,
      },
    };
  };

  let current = await generate();
  let pending = Promise.resolve();

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { port: 3000, strictPort: true },
    plugins: [
      {
        name: 'gemetric-font-preview',
        configureServer(server) {
          server.watcher.add(sources);

          server.middlewares.use((request, response, next) => {
            const path = request.url?.split('?')[0];

            if (path !== '/gemetric.json' && path !== '/gemetric.woff2') {
              return next();
            }

            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
              'Content-Type',
              path.endsWith('.json') ? 'application/json' : 'font/woff2',
            );
            response.end(
              path.endsWith('.json')
                ? JSON.stringify(current.metadata)
                : current.buffer,
            );
          });
        },
        async hotUpdate({ file, server }) {
          if (!sources.includes(file)) return;

          // Serialize rapid saves so an older generation cannot replace a newer one.
          pending = pending.then(async () => {
            try {
              current = await generate();

              server.ws.send({
                type: 'custom',
                event: 'gemetric:updated',
                data: current.metadata,
              });
            } catch (error) {
              server.ws.send({
                type: 'custom',
                event: 'gemetric:error',
                data:
                  error instanceof Error
                    ? error.message
                    : JSON.stringify(error),
              });
            }
          });

          await pending;
          return [];
        },
      } satisfies Plugin,
    ],
  };
});
