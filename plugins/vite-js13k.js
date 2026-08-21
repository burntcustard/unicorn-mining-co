import { Packer, defaultSparseSelectors } from 'roadroller';
import JSZip from 'jszip';
import advzip from 'advzip-bin';
import { execFile } from 'child_process';
import fs from 'fs';
import { minify } from 'html-minifier-terser';

const roadrollerSeed = 13312;
const zipDate = new Date(1980, 0, 1);
const fileRegex = /\.js$/;

const customReplacement = (src) => src
  // Give this repeated Kontra property a more compression-friendly spelling (~6B).
  .replace(/acceleration/g, '_acceleration')
  // Let Terser combine declarations without preserving const semantics (~19B).
  .replaceAll('const ', 'let ');

const customBundleReplacement = (src) => src
  // The game always provides its canvas, so omit Kontra's defensive error (~5B).
  .replace(/throw Error\(['"]You must provide a canvas element for the game['"]\)/, '')
  // The canvas ID is fixed, so skip Kontra's generic element fallbacks (~19B).
  .replace(
    /document\.getElementById\(canvas\)\s*\|\|\s*canvas\s*\|\|\s*document\.querySelector\(['"]canvas['"]\)/,
    'document.getElementById(\'c\')',
  );

export function viteJs13kPre() {
  return {
    name: 'vite-js13k-pre',
    enforce: 'pre',
    transform(src, id) {
      if (fileRegex.test(id)) {
        return {
          code: customReplacement(src),
          map: null,
        };
      }
    },
  };
}

const seededRandom = (seed) => {
  let state = seed;

  return () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;

    return state / 4294967296;
  };
};

const withRandomSeed = async (seed, action) => {
  if (seed === null) return action();

  const random = Math.random;

  Math.random = seededRandom(seed);

  try {
    return await action();
  } finally {
    Math.random = random;
  }
};

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
      date: zipDate,
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
  randomSeed = roadrollerSeed,
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

  const { firstLine, secondLine } = await withRandomSeed(randomSeed, async () => {
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

    return packer.makeDecoder();
  });

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
  const buildLevelNumber = { 'fast': 1, 'slow': 2, 'full': 3, 'full-random': 3 }[buildLevel];
  const numberOfContexts = (buildLevelNumber + 1) ** 2;
  const parameterOptimizationLevel = buildLevelNumber - 1;
  const randomSeed = buildLevel === 'full-random' ? null : roadrollerSeed;

  return {
    name: 'vite-js13k',
    enforce: 'post',
    renderChunk: customBundleReplacement,
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
              randomSeed,
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

      if (buildLevel === 'full' || buildLevel === 'full-random') {
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
