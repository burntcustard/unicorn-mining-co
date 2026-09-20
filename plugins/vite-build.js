import { minify } from 'terser';
import { replacePreTerser } from './replace-pre-terser.js';

export const terserMangleOptions = (nameCache = {}) => ({
  compress: false,
  mangle: {
    properties: {
      // Quoted property syntax marks computed or external names as unmangleable.
      keep_quoted: true,
    },
  },
  module: true,
  nameCache,
});

export function viteBuildPre(flags = {}) {
  return {
    name: 'vite-build-pre',
    enforce: 'pre',
    transform(source, id) {
      if (/\.[cm]?[jt]sx?(?:\?|$)/.test(id) && !id.includes('/node_modules/')) {
        return {
          code: replacePreTerser(source, flags),
          map: null,
        };
      }
    },
  };
}

/**
 * Keep JavaScript chunks as ordinary files and warn if any executable resource
 * exceeds the 14 KiB target.
 */
export function viteBuild() {
  // Oxc cannot yet mangle properties consistently across multiple chunks, so
  // Terser handles only mangling with one shared cache until Rolldown supports it:
  // https://github.com/rolldown/rolldown/issues/10771
  const nameCache = {};
  let mangleQueue = Promise.resolve();

  return {
    name: 'vite-build',
    enforce: 'post',
    renderChunk: {
      order: 'post',
      handler(code) {
        const mangled = mangleQueue.then(() => minify(code, terserMangleOptions(nameCache)));

        mangleQueue = mangled.then(() => undefined);
        return mangled;
      },
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
        const soundChunk = chunks.find((chunk) => chunk.name === 'sound');

        for (const chunk of chunks) {
          const size = Buffer.byteLength(chunk.code);

          if (size > 14 * 1024) {
            this.warn(`${chunk.fileName} is ${size}B (over 14 KiB)`);
          }
        }

        for (const htmlAsset of Object.values(bundle).filter((item) =>
          item.type === 'asset' && item.fileName.endsWith('.html'))) {
          let html = String(htmlAsset.source);

          if (soundChunk) {
            html = html.replace(
              '</head>',
              `  <link rel="prefetch" href="./${soundChunk.fileName}" as="script" />\n  </head>`,
            );
          }

          htmlAsset.source = html;
        }
      },
    },
  };
}
