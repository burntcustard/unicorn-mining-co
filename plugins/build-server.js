import { writeFile } from 'node:fs/promises';
import { minify } from 'terser';
import { rolldown } from 'rolldown';
import {
  terserMangleOptions,
  buildPlugin,
  buildPrePlugin,
} from './build-plugins.js';

const bundle = await rolldown({
  input: 'src/server/index.ts',
  platform: 'node',
  external: ['ws'],
  plugins: [
    { ...buildPrePlugin(), generateBundle: undefined },
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await bundle.write({
    dir: 'dist',
    format: 'esm',
    entryFileNames: 'server.js',
  });
  const server = output.find((item) => item.type === 'chunk');
  const compressed = await minify(server.code, {
    ...terserMangleOptions(),
    compress: { passes: 2 },
  });

  await writeFile('dist/server.js', compressed.code);
} finally {
  await bundle.close();
}
