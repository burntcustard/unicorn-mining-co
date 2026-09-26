import { gzipSync } from 'node:zlib';
import { minify } from 'terser';
import { replacePreTerser, stripIfdef } from './replace-pre-terser.js';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { readFileSync, readdirSync } from 'node:fs';
import { parseAst } from 'rolldown/parseAst';
import { transformWithOxc } from 'vite';

const gzipOptions = { level: 1 };
// Leave 600B for response overhead inside the 14,600B initial TCP window:
// ten 1,500B packets minus 40B of TCP/IP headers each.
const gzipBudget = 14_000;

export const terserMangleOptions = () => ({
  compress: false,
  mangle: true,
  module: true,
});

const propertyMangleOptions = (nameCache, reserved) => ({
  compress: false,
  mangle: { properties: { reserved } },
  nameCache,
});

const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    );

    return entry.isDirectory()
      ? sourceFiles(url)
      : entry.name.endsWith('.ts')
        ? [url]
        : [];
  });

const reservedProperties = () => {
  const reserved = new Set();
  const reserve = (name) => {
    reserved.add(name);
    // Keep the Vec.distance export literal; its unrelated _distance field may mangle.

    if (name !== 'distance') reserved.add(replacePreTerser(name));
  };
  const sourceRoot = new URL('../src/', import.meta.url);

  for (const url of sourceFiles(sourceRoot)) {
    const source = parseAst(
      readFileSync(url, 'utf8'),
      { lang: 'ts' },
      url.pathname,
    );
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;

      if (node.type === 'ExportNamedDeclaration') {
        const declaration = node.declaration;

        if (declaration?.id?.name) reserve(declaration.id.name);
        declaration?.declarations?.forEach(({ id }) => {
          if (id.name) reserve(id.name);
        });
        node.specifiers?.forEach(({ exported }) => {
          if (exported.name) reserve(exported.name);
        });
      }
      Object.values(node).forEach((value) => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      });
    };

    visit(source);
  }

  return [...reserved];
};

const annotateStateKeys = (code, id) => {
  if (!id.endsWith('/simulation/entity-state.ts')) return code;

  const starts = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ArrayExpression') {
      node.elements.forEach((element) => {
        if (element?.type === 'Literal' && typeof element.value === 'string') {
          starts.push(element.start);
        }
      });
    }

    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    });
  };

  visit(parseAst(code, { lang: 'js' }, id));
  return starts
    .sort((a, b) => b - a)
    .reduce(
      (source, start) =>
        source.slice(0, start) + '/*@__KEY__*/' + source.slice(start),
      code,
    );
};

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
                code: stripIfdef(source, flags),
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

export function buildPrePlugin(flags = {}) {
  return {
    name: 'vite-build-pre',
    enforce: 'pre',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'LICENSE.txt',
        source: readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
      });
    },
    transform(source, id) {
      if (id.includes('/src/') && /\.ts(?:\?|$)/.test(id)) {
        return {
          code: stripIfdef(source, flags),
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
export function buildPlugin(flags = {}) {
  const nameCache = {};
  let reserved;
  let mangleQueue = Promise.resolve();

  return {
    name: 'vite-build',
    apply: 'build',
    enforce: 'post',
    async buildStart() {
      reserved = reservedProperties();

      // Seed the cache in source-path order. Rolldown's parallel transform
      // order otherwise changes the chosen short names between builds.
      const files = sourceFiles(new URL('../src/', import.meta.url)).sort(
        (a, b) => a.pathname.localeCompare(b.pathname),
      );

      for (const url of files) {
        const code = stripIfdef(readFileSync(url, 'utf8'), flags);
        const javascript = annotateStateKeys(
          replacePreTerser((await transformWithOxc(code, url.pathname)).code),
          url.pathname,
        );

        await minify(javascript, propertyMangleOptions(nameCache, reserved));
      }
    },
    async transform(code, id) {
      if (!id.includes('/src/') || !/\.ts(?:\?|$)/.test(id)) return;

      // Direct Rolldown consumers can reach this hook with TypeScript intact.
      const javascript = annotateStateKeys(
        replacePreTerser((await transformWithOxc(code, id)).code),
        id,
      );

      // Transform modules before Rolldown assigns them to chunks. One cache
      // gives every use of a property the same spelling across lazy imports.
      const result = mangleQueue.then(() =>
        minify(javascript, propertyMangleOptions(nameCache, reserved)),
      );

      mangleQueue = result.then(() => {});
      return result;
    },
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
