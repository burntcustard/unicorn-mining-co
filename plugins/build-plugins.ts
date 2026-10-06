import { gzipSync } from 'node:zlib';
import { minify } from 'terser';
import { replacePreTerser, stripIfdef } from './replace-pre-terser.ts';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { readFileSync, readdirSync } from 'node:fs';
import { parseAst } from 'rolldown/parseAst';
import {
  transformWithOxc,
  type Plugin,
  type IndexHtmlTransformContext,
} from 'vite';
import type { Node } from '@oxc-project/types';
import type { MinifyOptions } from 'terser';

const gzipOptions = { level: 1 };
// Leave 600B for response overhead inside the 14,600B initial TCP window:
// ten 1,500B packets minus 40B of TCP/IP headers each.
const gzipBudget = 14_000;

const propertyMangleOptions = (
  nameCache: object,
  reserved: string[],
): MinifyOptions => ({
  compress: false,
  mangle: { properties: { reserved } },
  nameCache,
});

const sourceFiles = (directory: URL): URL[] =>
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

const reservedProperties = (files: URL[]) => {
  const reserved = new Set(['background', 'bufferedAmount']);

  const reserve = (name: string) => {
    reserved.add(name);
    // Keep the Vec.distance export literal; its unrelated _distance field may mangle.

    if (name !== 'distance') reserved.add(replacePreTerser(name));
  };

  for (const url of files) {
    const source = parseAst(
      readFileSync(url, 'utf8'),
      { lang: 'ts' },
      url.pathname,
    );

    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const node = value as Node;

      if (node.type === 'ExportNamedDeclaration') {
        const declaration = node.declaration;

        if (
          declaration &&
          'id' in declaration &&
          declaration.id &&
          'name' in declaration.id
        ) {
          reserve(declaration.id.name);
        }

        if (declaration?.type === 'VariableDeclaration') {
          declaration.declarations.forEach(({ id }) => {
            if (id.type === 'Identifier') reserve(id.name);
          });
        }

        node.specifiers?.forEach(({ exported }) => {
          if (exported.type === 'Identifier') reserve(exported.name);
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

const annotateStateKeys = (code: string, id: string) => {
  if (!id.endsWith('/simulation/entity-state.ts')) return code;

  const starts: number[] = [];

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Node;

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

export function viteBackground(flags: Record<string, boolean> = {}) {
  return {
    name: 'vite-background',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      async handler(
        this: void,
        html: string,
        context: Pick<IndexHtmlTransformContext, 'server'>,
      ) {
        if (context.server) return;

        const bundle = await rolldown({
          input: resolve(
            process.cwd(),
            'src/client/background/background-boot.ts',
          ),
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
          /<script\s+type="module"\s+src="src\/client\/background\/background-boot\.ts"\s*>\s*<\/script>/,
          `<script>${output[0].code}</script>`,
        );
      },
    },
  } satisfies Plugin;
}

export function buildPrePlugin(flags: Record<string, boolean> = {}) {
  return {
    name: 'vite-build-pre',
    enforce: 'pre',
    transform(source, id) {
      if (id.includes('/src/') && /\.ts(?:\?|$)/.test(id)) {
        return {
          code: stripIfdef(source, flags),
          map: null,
        };
      }
    },
  } satisfies Plugin;
}

/**
 * Keep JavaScript chunks as ordinary files and warn when their gzip level 1
 * transfer size exceeds the 14 KB target.
 */
export function buildPlugin(flags: Record<string, boolean> = {}) {
  const nameCache = {};
  let reserved: string[];
  let mangleQueue = Promise.resolve();

  return {
    name: 'vite-build',
    apply: 'build',
    enforce: 'post',
    async buildStart() {
      // Seed the cache in source-path order. Rolldown's parallel transform
      // order otherwise changes the chosen short names between builds.
      const files = ['client', 'specs']
        .flatMap((directory) =>
          sourceFiles(new URL(`../src/${directory}/`, import.meta.url)),
        )
        .sort((a, b) => a.pathname.localeCompare(b.pathname));

      reserved = reservedProperties(files);

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

      return result.then(({ code }) => ({ code }));
    },
    renderChunk: {
      order: 'post',
      handler(code) {
        return minify(code, {
          compress: false,
          mangle: true,
          module: true,
        }).then(({ code }) => ({ code }));
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
  } satisfies Plugin;
}
