import { gzipSync } from 'node:zlib';
import { minify } from 'terser';
import { replacePreTerser } from './replace-pre-terser.js';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';

const gzipOptions = { level: 1 };
// Leave 600B for response overhead inside the 14,600B initial TCP window:
// ten 1,500B packets less 40B of TCP/IP headers each.
const gzipBudget = 14_000;

export const terserMangleOptions = () => ({
  compress: false,
  // Object properties cross lazy-chunk and network boundaries. Only shorten
  // lexical names; per-chunk property mangling cannot preserve those contracts.
  mangle: true,
  module: true,
});

export function viteBackground(flags = {}) {
  return {
    name: 'vite-background',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, context) {
        if (context.server) return;

        const bundle = await rolldown({
          input: resolve(process.cwd(), 'src/client/background-boot.ts'),
          plugins: [
            {
              name: 'background-flags',
              transform: (source) => ({
                code: replacePreTerser(source, flags),
                map: null,
              }),
            },
          ],
        });
        const { output } = await bundle.generate({
          format: 'iife',
          name: 'background',
          minify: true,
        });

        await bundle.close();
        return html.replace(
          '<script type="module" src="src/client/background-boot.ts"></script>',
          `<script>${output[0].code}</script>`,
        );
      },
    },
  };
}

export function viteBuildPre(flags = {}) {
  return {
    name: 'vite-build-pre',
    enforce: 'pre',
    transform(source, id) {
      if (id.includes('/src/') && /\.[cm]?[jt]sx?(?:\?|$)/.test(id)) {
        return {
          code: replacePreTerser(source, flags),
          map: null,
        };
      }
    },
  };
}

/**
 * Keep JavaScript chunks as ordinary files and warn when their gzip level 1
 * transfer size exceeds the 14 KB target.
 */
export function viteBuild() {
  return {
    name: 'vite-build',
    enforce: 'post',
    renderChunk: {
      order: 'post',
      handler(code) {
        return minify(code, terserMangleOptions());
      },
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const chunks = Object.values(bundle).filter(
          (item) => item.type === 'chunk',
        );

        for (const chunk of chunks) {
          const gzipSize = gzipSync(chunk.code, gzipOptions).length;

          if (gzipSize > gzipBudget) {
            this.warn(`${chunk.fileName} is ${gzipSize}B gzipped (over 14 KB)`);
          }
        }
      },
    },
  };
}
