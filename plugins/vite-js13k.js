import { Packer, defaultSparseSelectors } from 'roadroller';
import JSZip from 'jszip';
import advzip from 'advzip-bin';
import { execFile } from 'child_process';
import fs from 'fs';
import { minify } from 'html-minifier-terser';

// generateBundle runs before Vite has written anything to disk
function ensureDistDir() {
  fs.mkdirSync('dist', { recursive: true });
}

async function zip(content) {
  const jszip = new JSZip();

  ensureDistDir();

  jszip.file(
    'index.html',
    content,
    {
      compression: 'DEFLATE',
      compressionOptions: {
        level: 9,
      },
    },
  );

  await new Promise((resolve) => {
    jszip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
      .pipe(fs.createWriteStream('dist/game.zip'))
      .on('finish', resolve);
  });
}

export async function replaceScript(
  html,
  scriptFilename,
  scriptCode,
  parameterOptimizationLevel = 2,
  numberOfContexts = 16,
) {
  const reScript = new RegExp(`<script([^>]*?) src="[./]*${scriptFilename}"([^>]*)></script>`);

  // First we have to move the script to the end of the body, because vite is
  // opinionated and otherwise just hoists it into <head>:
  // https://github.com/vitejs/vite/issues/7838
  const movedHtml = html
    .replace('</body>', html.match(reScript)[0] + '</body')
    .replace(html.match(reScript)[0], '');

  console.log(`\nJS size: ${new Blob([scriptCode]).size}B (pre-roadroller)`);
  ensureDistDir();
  fs.writeFileSync('dist/minified.js', scriptCode);

  const packer = new Packer([{
    action: 'eval',
    data: scriptCode,
    type: 'js',
  }], {
    allowFreeVars: true,
    maxMemoryMB: 150,
    sparseSelectors: defaultSparseSelectors(numberOfContexts),
  });

  await packer.optimize(parameterOptimizationLevel);

  const { firstLine, secondLine } = packer.makeDecoder();

  return movedHtml.replace(reScript, `<script>${firstLine + secondLine}</script>`);
}

async function replaceHtml(html) {
  const minifiedHtml = await minify(html, {
    collapseWhitespace: true,
    removeAttributeQuotes: true,
  });

  return minifiedHtml
    .replace('<!DOCTYPE html>', '')
    .replace('<meta charset=UTF-8>', '')
    .replace('"width=device-width,initial-scale=1"', 'width=device-width,initial-scale=1')
    .replace(/ lang=[^>]*/, '');
}

export function viteJs13k(buildLevel = 'full') {
  const buildLevelIndex = ['fast', 'slow', 'full'].indexOf(buildLevel);
  const numberOfContexts = (buildLevelIndex + 2) ** 2;
  const parameterOptimizationLevel = {
    fast: 0,
    slow: 1,
    full: 2,
  }[buildLevel];

  return {
    name: 'vite-js13k',
    enforce: 'post',
    generateBundle: async (_, bundle) => {
      const jsExtensionTest = /\.[mc]?js$/;
      const htmlFiles = Object.keys(bundle).filter((i) => i.endsWith('.html'));
      const jsAssets = Object.keys(bundle).filter((i) => jsExtensionTest.test(i));
      const bundlesToDelete = [];

      for (const name of htmlFiles) {
        const htmlChunk = bundle[name];
        let replacedHtml = htmlChunk.source;

        for (const jsName of jsAssets) {
          const jsChunk = bundle[jsName];

          if (jsChunk.code != null) {
            bundlesToDelete.push(jsName);
            replacedHtml = await replaceScript(
              replacedHtml,
              jsChunk.fileName,
              jsChunk.code,
              parameterOptimizationLevel,
              numberOfContexts,
            );
          }
        }

        replacedHtml = await replaceHtml(replacedHtml);
        htmlChunk.source = replacedHtml;
        await zip(replacedHtml);
      }

      for (const name of bundlesToDelete) {
        delete bundle[name];
      }
    },
    closeBundle: async () => {
      console.log(`\nZip size: ${fs.statSync('dist/game.zip').size}B`);

      if (buildLevel === 'fast') {
        return;
      }

      const args = [
        '--recompress',
        '--shrink-insane',
      ];

      if (buildLevel === 'full') {
        args.push('--iter=1000');
      }

      args.push('dist/game.zip');

      await new Promise((resolve, reject) => {
        execFile(advzip, args, (error) => error ? reject(error) : resolve());
      });

      console.log(`Zip size: ${fs.statSync('dist/game.zip').size}B (advzip)`);
    },
  };
}
