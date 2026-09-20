import { viteBackground, viteBuild, viteBuildPre } from './plugins/vite-build.js';
import { defineConfig } from 'vite';

export default defineConfig(({ mode, command }) => {
  // DEBUG code runs under any Vite dev server (dev, dev:host, and the
  // benchmark script's own dev server), but never survives a `vite build`.
  // BENCHMARK code only runs under the benchmark script's own dev server.
  const flags = {
    BENCHMARK: mode === 'benchmark' && command === 'serve',
    DEBUG: command === 'serve',
  };

  return {
    base: './',
    server: {
      port: 3000,
    },
    plugins: [
      viteBuildPre(flags),
      viteBackground(flags),
      viteBuild(),
    ],
    build: {
      minify: 'oxc',
      assetsInlineLimit: 0,
      modulePreload: {
        polyfill: false,
      },
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          // Keep chunk URLs relative so the output works from any path.
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: '[name]-[hash][extname]',
          codeSplitting: {
            groups: [{
              name: 'rendering-world',
              test: /[\\/]src[\\/](?:background|lighting|prism|drawing|polygon|colors|flare|world|distribute|seeded-random|items[\\/])/,
              includeDependenciesRecursively: false,
            }],
          },
        },
      },
    },
  };
});
