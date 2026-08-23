import { viteJs13k, viteJs13kPre } from './plugins/vite-js13k.js';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const buildLevels = {
    'fast': 1,
    'slow': 2,
    'full': 3,
    'full-random': 3,
  };
  const buildLevel = mode in buildLevels ? mode : 'full';
  const buildLevelNumber = buildLevels[buildLevel];

  return {
    server: {
      port: 3000,
    },
    plugins: [
      viteJs13kPre(),
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
        },
        mangle: { properties: {} },
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
