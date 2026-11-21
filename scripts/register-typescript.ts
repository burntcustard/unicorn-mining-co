import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import ts from 'typescript';

/*
 * Load shared TypeScript modules in Node using the same relative import
 * conventions as the browser bundler.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (
        (code !== 'ERR_MODULE_NOT_FOUND' &&
          code !== 'ERR_UNSUPPORTED_DIR_IMPORT') ||
        !(specifier.startsWith('./') || specifier.startsWith('../')) ||
        extname(specifier)
      ) {
        throw error;
      }

      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch (fallbackError) {
          if (
            (fallbackError as NodeJS.ErrnoException).code !==
            'ERR_MODULE_NOT_FOUND'
          ) {
            throw fallbackError;
          }
        }
      }

      throw error;
    }
  },

  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) {
      return nextLoad(url, context);
    }

    const path = new URL(url);
    const source = readFileSync(path, 'utf8');

    const { outputText } = ts.transpileModule(source, {
      fileName: path.pathname,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        inlineSourceMap: true,
        inlineSources: true,
      },
    });

    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
