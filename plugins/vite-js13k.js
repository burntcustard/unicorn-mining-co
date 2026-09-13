import { execFile, spawn } from 'child_process';
import JSZip from 'jszip';
import { Packer } from 'roadroller';
import advzip from 'advzip-bin';
import fs from 'fs';
import { minify } from 'html-minifier-terser';
import roadrollerArgs from './roadroller-args.js';

// Kontra-style compile-time flags. `@ifdef` keeps a block when its flag is
// truthy, while `@ifndef` keeps it when false; the other branch is removed
// entirely, so debug and benchmark-only code never reaches dist.
const ifdefPattern = /^[ \t]*\/\/ @(ifdef|ifndef) (\w+)\r?\n([\s\S]*?)^[ \t]*\/\/ @endif\r?\n?/gm;

const stripIfdef = (src, flags) => src.replace(
  ifdefPattern,
  (match, condition, flag, body) => ((condition === 'ifdef') === !!flags[flag] ? body : ''),
);

// Source-level rewrites that help Terser/Roadroller compress the JS further
const customReplacement = (src) => src
  // Whole-word matches only, so e.g. "pointsFor" and "moduleOption" are left
  // alone; (?<!/) then skips a match right after a slash, so import paths
  // like './message' keep their real file name instead of './_message'.
  .replace(new RegExp(`(?<!/)\\b(${[
    'actions',
    'active', // -29B
    'detach',
    'forward', // -11B
    'green', // -20B most colors are auto-mangled; green isn't
    'items', // -44B
    'item', // -9B
    'level',
    'lines', // -49B
    'mask', // -12B
    'message', // -7B
    'module', // -9B
    'mount', // -22B
    'name', // -34B
    // 'model', // +21B
    'normalize', // -21B
    'note', // -3B
    'object',
    // 'offset', // +19B
    'order', // -33B
    'outline', // -51B
    'pitch',
    'points', // -35B
    'position', // -13B
    'radius', // -28B
    // 'red', // +13B most colors are auto-mangled; red isn't
    'remove',
    'resource', // -12B
    'rotation', // -15B
    'segments', // -13B
    'span',
    'speed', // -4B
    'target',
    'toggle',
    'turn', // -3B
    'unlock',
    'update', // -19B
    'zIndex', // -31B
  ].join('|')})\\b`, 'g'), '_$1')
  // Dangerously replace strict equality with loose equality, saves 12B
  .replace(/===/g, '==')
  // Swap forEach with map with unused return values, saves 20B
  .replaceAll('.forEach(', '.map(')
  // Standardize 2 * Math.PI to Math.PI * 2, saves 1B, maybe
  .replaceAll('2 * Math.PI', 'Math.PI * 2')
  // Keep lexical declarations consistent before bundling and Terser, saves 48B
  .replaceAll('const ', 'let ');

export function viteJs13kPre(flags = {}) {
  return {
    name: 'vite-js13k-pre',
    enforce: 'pre',
    transform(src, id) {
      if (/\.js$/.test(id)) {
        return {
          code: customReplacement(stripIfdef(src, flags)),
          map: null,
        };
      }
    },
  };
}

async function zip(content) {
  const jszip = new JSZip();

  // generateBundle runs before Vite has written anything to disk
  fs.mkdirSync('dist', { recursive: true });

  jszip.file(
    'index.html',
    content,
    {
      // A fixed ZIP timestamp makes byte comparisons reproducible.
      date: new Date('1980-01-01T00:00:00Z'),
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

function writeMinifiedJs(scriptCode) {
  console.log(`\nJS size: ${new Blob([scriptCode]).size}B (pre-roadroller)`);
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/minified.js', scriptCode);
}

function saveRoadrollerArgs(searchOutput) {
  const args = searchOutput.match(/use `([^`]+)` to replicate:/)?.[1]?.split(' ');
  if (!args) return;

  const options = {};

  for (const arg of args) {
    const [, option, value] = arg.match(
      /-(Zab|Zdy|Zlr|Zlp|Zmc|Zmd|Zpr|Zco|S)(.+)/,
    ) || [];

    if (option === 'S' && !value.startsWith('x')) {
      options.sparseSelectors = value.split(',').map(Number);
    } else if (option) {
      options[{
        Zab: 'numAbbreviations',
        Zdy: 'dynamicModels',
        Zlr: 'recipLearningRate',
        Zlp: 'pairRecipLearningRate',
        Zmc: 'modelMaxCount',
        Zmd: 'modelRecipBaseCount',
        Zpr: 'precision',
        Zco: 'contextBits',
      }[option]] = Number(value);
    }
  }

  if (args.includes('--sse') || roadrollerArgs.sse) {
    options.sse = true;
  }

  fs.writeFileSync(
    new URL('./roadroller-args.js', import.meta.url),
    `export default {\n${Object.entries(options)
      .map(([key, value]) => `  ${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value},`)
      .join('\n')}\n};\n`,
  );
  console.log('\nSaved matching Packer options to plugins/roadroller-args.js');
}

const roadrollerMarker = '__ROADROLLER__';

function replaceScriptTag(html, scriptFilename, content) {
  const reScript = new RegExp(`<script([^>]*?) src="[./]*${scriptFilename}"([^>]*)></script>`);

  const scriptTag = html.match(reScript)?.[0];

  if (!scriptTag) {
    throw new Error(`Could not find script ${scriptFilename}`);
  }

  const movedHtml = html
    .replace('</body>', scriptTag + '</body')
    .replace(scriptTag, '');

  return movedHtml.replace(
    reScript,
    `<script>${content}</script>`,
  );
}

export async function replaceScript(html, scriptFilename, scriptCode) {
  writeMinifiedJs(scriptCode);

  const packer = new Packer([{
    action: 'eval',
    data: scriptCode,
    type: 'js',
  }], {
    allowFreeVars: true,
    maxMemoryMB: 2000,
    ...roadrollerArgs,
  });

  const { firstLine, secondLine } = packer.makeDecoder();

  return replaceScriptTag(
    html,
    scriptFilename,
    firstLine + secondLine,
  );
}

async function replaceHtml(html) {
  const minifiedHtml = await minify(html, {
    collapseWhitespace: true,
    removeOptionalTags: true,
    removeAttributeQuotes: true,
  });

  return minifiedHtml
    .replace('<!DOCTYPE html>', '')
    .replace('<meta charset=UTF-8>', '')
    .replace(/<title>.*?<\/title>/, '')
    .replace('"width=device-width,initial-scale=1"', 'width=device-width,initial-scale=1')
    .replace(/ lang=[^>]*/, '')
    .replace('<html>', '')
    .replace('</body></html>', '');
}

function roadrollerSearchArgs() {
  const flags = {
    numAbbreviations: 'Zab',
    dynamicModels: 'Zdy',
    recipLearningRate: 'Zlr',
    pairRecipLearningRate: 'Zlp',
    modelMaxCount: 'Zmc',
    modelRecipBaseCount: 'Zmd',
    precision: 'Zpr',
    sparseSelectors: 'S',
    contextBits: 'Zco',
  };

  const args = Object.entries(flags).flatMap(([key, flag]) => {
    const value = roadrollerArgs[key];

    return value === undefined ?
        [] :
        [`-${flag}${Array.isArray(value) ? value.join(',') : value}`];
  });

  if (roadrollerArgs.sse) args.push('--sse');

  if (roadrollerArgs.contextBits === undefined) {
    args.push('-M2000');
  }

  return args;
}

export function viteJs13k(buildLevel = 'full') {
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

            if (buildLevel === 'search') {
              writeMinifiedJs(jsChunk.code);
              replacedHtml = replaceScriptTag(
                replacedHtml,
                jsChunk.fileName,
                roadrollerMarker,
              );
            } else {
              replacedHtml = await replaceScript(replacedHtml, jsChunk.fileName, jsChunk.code);
            }
          }
        }

        replacedHtml = await replaceHtml(replacedHtml);

        if (buildLevel === 'search') {
          fs.mkdirSync('dist', { recursive: true });
          fs.writeFileSync('dist/roadroller-wrapper.html', replacedHtml);
        } else {
          htmlChunk.source = replacedHtml;
          await zip(replacedHtml);
        }
      }

      for (const name of bundlesToDelete) {
        delete bundle[name];
      }
    },
    closeBundle: async () => {
      if (buildLevel === 'search') {
        console.log('\nSearching for optimal Roadroller parameters (Ctrl+C to stop)...');

        const searchOutput = [];

        const keepViteAlive = () => {};

        process.once('SIGINT', keepViteAlive);

        await new Promise((resolve, reject) => {
          const search = spawn(
            'npx',
            [
              'roadroller',
              '-OO',

              // Use the adaptive Zopfli fitness from our fork.
              '--zopfli',
              '--optimize-wrapper',
              'dist/roadroller-wrapper.html',

              '-D',

              // Start from the parameters from our last successful search.
              ...roadrollerSearchArgs(),

              '-v',
              'dist/minified.js',
              '-o',
              'dist/roadrolled.js',
            ],
            { stdio: ['inherit', 'pipe', 'pipe'] },
          );
          search.stdout.pipe(process.stdout);
          search.stderr.on('data', (chunk) => {
            searchOutput.push(chunk);
            process.stderr.write(chunk);
          });
          search.on('close', resolve);
          search.on('error', reject);
        });

        process.removeListener('SIGINT', keepViteAlive);
        saveRoadrollerArgs(Buffer.concat(searchOutput).toString());

        return;
      }

      console.log(`\nZip size: ${fs.statSync('dist/game.zip').size}B`);

      const args = [
        '--recompress',
        '--shrink-insane',
        `--iter=${buildLevel === 'fast' ? 10 : 6000}`,
      ];

      args.push('dist/game.zip');

      await new Promise((resolve, reject) => {
        execFile(advzip, args, (error) => error ? reject(error) : resolve());
      });

      console.log(`Zip size: ${fs.statSync('dist/game.zip').size}B (advzip)`);
    },
  };
}
