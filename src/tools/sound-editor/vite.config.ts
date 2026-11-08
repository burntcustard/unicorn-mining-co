import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import {
  createSoundStore,
  SoundDataError,
  validSoundId,
} from './persistence.ts';
import { normalizeSoundName } from './parameters.ts';

const directory = fileURLToPath(new URL('../../specs/sounds', import.meta.url));
const library = join(directory, 'unassigned');
const prefix = '/__sound-editor/';

export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    throw new Error('The Sound Editor is a development-only tool.');
  }

  const store = createSoundStore(directory);

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { port: 3100 },
    plugins: [
      {
        name: 'sound-editor-data',
        configureServer(server) {
          server.watcher.add(directory);

          server.middlewares.use(async (request, response, next) => {
            const path = request.url?.split('?')[0];

            if (!path?.startsWith(prefix)) return next();

            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', 'application/json');

            try {
              const match =
                /^\/__sound-editor\/(sounds|layers)(?:\/([^/]+))?$/.exec(path);

              if (!match || (match[2] && !validSoundId(match[2]))) {
                throw new SoundDataError('Unknown sound.', 404);
              }

              const [, collection, id] = match;
              const layer = collection === 'layers';

              if (request.method === 'GET' && (!layer || id)) {
                response.end(
                  JSON.stringify(
                    id
                      ? layer
                        ? await store.readLayer(id)
                        : await store.readSound(id)
                      : await store.read(),
                  ),
                );
                return;
              }

              if (
                !(
                  (request.method === 'PUT' && id) ||
                  (request.method === 'POST' && !id)
                )
              ) {
                response.setHeader(
                  'Allow',
                  id ? 'GET, PUT' : layer ? 'POST' : 'GET, POST',
                );
                throw new SoundDataError(
                  'Use POST to create a named sound, or GET and PUT for an individual sound.',
                  405,
                );
              }

              if (
                request.headers.origin &&
                new URL(request.headers.origin).host !== request.headers.host
              ) {
                throw new SoundDataError(
                  'Save sounds from the editor’s own origin.',
                  403,
                );
              }

              if (
                !request.headers['content-type']?.startsWith('application/json')
              ) {
                throw new SoundDataError(
                  'Save sounds using application/json.',
                  415,
                );
              }

              let body = '';

              for await (const chunk of request) {
                body += chunk;

                if (Buffer.byteLength(body) > 1024 * 1024) {
                  throw new SoundDataError(
                    'The saved sound data is too large.',
                    413,
                  );
                }
              }

              let document: unknown;

              try {
                document = JSON.parse(body);
              } catch {
                throw new SoundDataError(
                  'The saved sounds contain invalid JSON.',
                );
              }

              if (request.method === 'POST') {
                const created = layer
                  ? await store.createLayer(document)
                  : await store.createEvent(document);

                response.statusCode = 201;
                response.end(JSON.stringify(created));
                return;
              }

              response.end(
                JSON.stringify(
                  layer
                    ? await store.saveLayer(id, document)
                    : await store.save(id, document),
                ),
              );
            } catch (error) {
              response.statusCode =
                error instanceof SoundDataError ? error.status : 500;

              response.end(
                JSON.stringify({
                  error:
                    error instanceof Error
                      ? error.message
                      : JSON.stringify(error),
                }),
              );
            }
          });
        },
        hotUpdate({ file, server }) {
          const parent = dirname(file);

          if (
            (parent !== directory && parent !== library) ||
            !file.endsWith('.ts')
          ) {
            return;
          }

          const id = basename(file, '.ts');

          if (!validSoundId(id)) return [];
          const name = normalizeSoundName(id);
          const continuous = name === 'engine' || name === 'hornDrill';

          if (name === 'unassigned' || (parent === library && continuous)) {
            return [];
          }

          server.ws.send({
            type: 'custom',
            event: 'sound-editor:updated',
            data: {
              name,
              kind:
                parent === library
                  ? 'layer'
                  : continuous
                    ? 'continuous'
                    : 'event',
            },
          });

          return [];
        },
      } satisfies Plugin,
    ],
  };
});
