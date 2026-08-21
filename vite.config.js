import { viteJs13k, viteJs13kPre } from './plugins/vite-js13k.js';
import { defineConfig } from 'vite';
import kontra from 'rollup-plugin-kontra';

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
      kontra({
        gameObject: {
          acceleration: true,
          anchor: true,
          group: true,
          opacity: true,
          radius: true,
          rotation: true,
          scale: true,
          ttl: true,
          velocity: true,
        },
        sprite: {
          animation: true,
          image: true,
        },
        text: {
          align: true,
          autoNewline: true,
          newline: true,
          rtl: true,
          stroke: true,
        },
        tileEngine: {
          camera: true,
          dynamic: true,
          query: true,
          tiled: true,
        },
        vector: {
          angle: true,
          clamp: true,
          direction: true,
          distance: true,
          dot: true,
          length: true,
          normalize: true,
          scale: true,
          subtract: true,
        },
      }),
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
