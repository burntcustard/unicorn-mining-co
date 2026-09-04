import { viteJs13k, viteJs13kPre } from './plugins/vite-js13k.js';
import { defineConfig } from 'vite';

export default defineConfig(({ mode, command }) => {
  const buildLevels = {
    fast: 1,
    slow: 2,
    full: 3,
  };
  const buildLevel = mode in buildLevels ? mode : 'full';
  const buildLevelNumber = buildLevels[buildLevel];

  // DEBUG code runs under any Vite dev server (dev, dev:host, and the
  // benchmark script's own dev server), but never survives a `vite build`.
  // BENCHMARK code only runs under the benchmark script's own dev server.
  const flags = {
    BENCHMARK: mode === 'benchmark' && command === 'serve',
    DEBUG: command === 'serve',
  };

  return {
    server: {
      port: 3000,
    },
    plugins: [
      viteJs13kPre(flags),
      viteJs13k(buildLevel),
    ],
    build: {
      minify: 'terser',
      terserOptions: {
        toplevel: true,
        compress: {
          passes: buildLevelNumber ** 2,
          unsafe: true,
          unsafe_arrows: true,
          unsafe_comps: true,
          unsafe_math: true,
          pure_getters: true,
        },
        // downKeys is written with a computed key (event.key.slice(-2)),
        // so its literal reads in player.js must be reserved or property
        // mangling renames them out of sync with the data they're reading.
        mangle: { properties: { reserved: ['Up', 'ht', 'ft'] } },
        module: true,
      },
      assetsInlineLimit: 0,
      modulePreload: {
        polyfill: false,
      },
      reportCompressedSize: false,
      // Roadroller is meant to be slow, we don't need telling about it
      rollupOptions: {
        checks: {
          pluginTimings: false,
        },
      },
    },
  };
});
