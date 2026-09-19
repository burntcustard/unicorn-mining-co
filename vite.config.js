import { viteBuild, viteBuildPre } from './plugins/vite-build.js';
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
          // Keep chunk URLs relative so the inlined entry works from any path.
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: '[name]-[hash][extname]',
          codeSplitting: {
            // Rolldown partitions before Terser, so this source-size target is
            // deliberately above the 14 KiB minified-output warning threshold.
            maxSize: 45 * 1024,
            groups: [
              {
                name: 'sound',
                test: /[\\/]sound\.[jt]s$/,
                priority: 10,
              },
              {
                name: 'interface',
                test: /[\\/]src[\\/](?:ui(?:[\\/]|\.js)|text|outline)/,
                priority: 5,
                includeDependenciesRecursively: false,
              },
              {
                name: 'rendering',
                test: /[\\/]src[\\/](?:background|lighting|prism|drawing|polygon|colors|flare)\.js$/,
                priority: 4,
                includeDependenciesRecursively: false,
              },
              {
                name: 'world',
                test: /[\\/]src[\\/](?:world|distribute|seeded-random|items[\\/])/,
                priority: 3,
                includeDependenciesRecursively: false,
              },
              {
                name: 'gameplay',
                test: /[\\/]src[\\/](?:ship|asteroid|mining|collisions|player|docking|resolve|scoop|shrapnel|item|station|modules[\\/])/,
                priority: 2,
                includeDependenciesRecursively: false,
              },
              {
                name: 'engine',
                tags: ['$initial'],
                includeDependenciesRecursively: false,
              },
            ],
          },
        },
      },
    },
  };
});
