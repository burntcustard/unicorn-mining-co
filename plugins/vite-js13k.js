import JSZip from 'jszip';
import { Packer } from 'roadroller';
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

export async function replaceScript(html, scriptFilename, scriptCode) {
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
    allowFreeVars: true,
    data: scriptCode,
    maxMemoryMB: 200,
    type: 'js',
  }], {});

  const parameterOptimizationLevel = 2; // Takes 10x longer than the default level 0

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

export function viteJs13k() {
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
            replacedHtml = await replaceScript(replacedHtml, jsChunk.fileName, jsChunk.code);
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
    closeBundle: () => {
      console.log(`\nZip size: ${fs.statSync('dist/game.zip').size}B`);

      execFile(advzip, [
        '--recompress',
        '--shrink-insane',
        '--iter=8000',
        'dist/game.zip',
      ], () => {
        console.log(`Zip size: ${fs.statSync('dist/game.zip').size}B (advzip)`);
      });
    },
  };
}
