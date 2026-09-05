import { execFile, spawn } from 'child_process';
import JSZip from 'jszip';
import { Packer } from 'roadroller';
import advzip from 'advzip-bin';
import fs from 'fs';
import { minify } from 'html-minifier-terser';
import roadrollerArgs from './roadroller-args.js';

// Kontra-style compile-time flags. Whatever sits between "// @ifdef NAME" and
// "// @endif" is kept only when that flag is truthy, and removed entirely
// otherwise - so debug and benchmark-only code never reaches dist.
const ifdefPattern = /^[ \t]*\/\/ @ifdef (\w+)\r?\n([\s\S]*?)^[ \t]*\/\/ @endif\r?\n?/gm;

const stripIfdef = (src, flags) => src.replace(
  ifdefPattern,
  (match, flag, body) => (flags[flag] ? body : ''),
);

// Replacements which match file names require (?<!\/) to prevent import failure.
const customReplacement = (src) => src
  // Give this repeated Kontra property a more compression-friendly spelling (~6B).
  .replace(/acceleration/g, '_acceleration')
  .replace(/active/g, '_active')
  .replace(/angle/g, '_angle')
  // .replace(/forward/g, '_forward') // Increases size
  .replace(/(?<!\/)message/g, '_message')
  .replace(/(?<!\/)module/g, '_module')
  // .replace(/model/g, '_model') // Increases size
  // .replace(/mount/g, '_mount') // Increases size
  .replace(/normalize/g, '_normalize')
  // .replace(/offset/g, '_offset') // Increases size by 2 B
  .replace(/(?<!\/)outline/g, '_outline')
  .replace(/points/g, '_points')
  .replace(/position/g, '_position')
  .replace(/rotation/g, '_rotation')
  .replace(/segments/g, '_segments')
  .replace(/update/g, '_update')
  .replace(/zIndex/g, '_zIndex')
  // For some reason all other color names are mangled, but green isn't.
  // This actually cost more bytes for some reason???
  // .replace(/red/g, '_red')
  // .replace(/green/g, '_green')
  // Let Terser combine declarations without preserving const semantics (~19B).
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
    const [, option, value] = arg.match(/-(Zab|Zdy|Zlr|Zmc|Zmd|Zpr|S)(.+)/) || [];

    if (option === 'S' && !value.startsWith('x')) {
      options.sparseSelectors = value.split(',').map(Number);
    } else if (option) {
      options[{
        Zab: 'numAbbreviations',
        Zdy: 'dynamicModels',
        Zlr: 'recipLearningRate',
        Zmc: 'modelMaxCount',
        Zmd: 'modelRecipBaseCount',
        Zpr: 'precision',
      }[option]] = Number(value);
    }
  }

  fs.writeFileSync(
    new URL('./roadroller-args.js', import.meta.url),
    `export default ${JSON.stringify(options, null, 2)};\n`,
  );
  console.log('\nSaved matching Packer options to plugins/roadroller-args.js');
}

export async function replaceScript(html, scriptFilename, scriptCode) {
  const reScript = new RegExp(`<script([^>]*?) src="[./]*${scriptFilename}"([^>]*)></script>`);

  // First we have to move the script to the end of the body, because vite is
  // opinionated and otherwise just hoists it into <head>:
  // https://github.com/vitejs/vite/issues/7838
  const movedHtml = html
    .replace('</body>', html.match(reScript)[0] + '</body')
    .replace(html.match(reScript)[0], '');

  writeMinifiedJs(scriptCode);

  const packer = new Packer([{
    action: 'eval',
    data: scriptCode,
    type: 'js',
  }], {
    allowFreeVars: true,
    maxMemoryMB: 192, // We hit the 150 MB default so 192 MB helps
    ...roadrollerArgs,
  });

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
    .replace(/<title>.*?<\/title>/, '')
    .replace('"width=device-width,initial-scale=1"', 'width=device-width,initial-scale=1')
    .replace(/ lang=[^>]*/, '')
    .replace('</body></html>', '');
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
            } else {
              replacedHtml = await replaceScript(replacedHtml, jsChunk.fileName, jsChunk.code);
            }
          }
        }

        if (buildLevel !== 'search') {
          replacedHtml = await replaceHtml(replacedHtml);
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
            ['roadroller', '-OO', '-M', '192', '-v', 'dist/minified.js', '-o', 'dist/roadrolled.js'],
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
