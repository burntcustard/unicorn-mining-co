import { minify } from 'terser';
import { replacePreTerser } from './replace-pre-terser.js';

export const maxChunkSize = 14 * 1024;

const scriptSourcePattern = /\.[cm]?[jt]sx?(?:\?|$)/;

export const terserMangleOptions = ({ nameCache = {}, reserved = [] } = {}) => ({
  compress: false,
  mangle: {
    properties: {
      // Quoted property syntax marks computed or external names as unmangleable.
      keep_quoted: true,
      reserved,
    },
  },
  module: true,
  nameCache,
});

const bytes = (source) => Buffer.byteLength(source);

const addPrefetch = (html, fileName) => html.replace(
  '</head>',
  `  <link rel="prefetch" href="./${fileName}" as="script" />\n  </head>`,
);

export function viteBuildPre(flags = {}) {
  return {
    name: 'vite-build-pre',
    enforce: 'pre',
    transform(source, id) {
      if (scriptSourcePattern.test(id) && !id.includes('/node_modules/')) {
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
        const mangled = mangleQueue.then(() => minify(code, terserMangleOptions({ nameCache })));

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
          const size = bytes(chunk.code);

          if (size > maxChunkSize) {
            this.warn(`${chunk.fileName} is ${size}B (over 14 KiB)`);
          }
        }

        for (const htmlAsset of Object.values(bundle).filter((item) =>
          item.type === 'asset' && item.fileName.endsWith('.html'))) {
          let html = String(htmlAsset.source);

          if (soundChunk) html = addPrefetch(html, soundChunk.fileName);
          htmlAsset.source = html;
        }
      },
    },
  };
}
