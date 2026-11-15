import {
  viteBackground,
  buildHtmlPlugin,
  buildPlugin,
  buildPrePlugin,
} from './plugins/build-plugins.ts';
import { defineConfig } from 'vite';
import purgeCSS from '@fullhuman/postcss-purgecss';

export default defineConfig(({ command }) => {
  const flags = { DEBUG: command === 'serve' };

  const proxy = {
    '/api': { target: 'http://127.0.0.1:3001' },
    '/game-socket': {
      target: process.env.GAME_SERVER_URL || 'ws://127.0.0.1:3001',
      ws: true,
    },
  };

  return {
    base: './',
    css: {
      postcss: {
        plugins:
          command === 'build'
            ? [
                purgeCSS({
                  content: [
                    'index.html',
                    'src/client/**/*.{html,ts,svg}',
                    'src/specs/**/*.ts',
                  ],
                  // Interaction states are supplied by the browser, not markup.
                  safelist: [/^:/],
                }),
              ]
            : [],
      },
    },
    preview: {
      proxy,
    },
    server: {
      port: 3000,
      proxy,
      watch: { ignored: ['**/benchmarking/_local/**'] },
    },
    plugins: [
      buildHtmlPlugin(),
      buildPrePlugin(flags),
      viteBackground(flags),
      buildPlugin(flags),
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
        },
      },
    },
  };
});
