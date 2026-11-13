import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const directory = await mkdtemp(resolve('.module-viewer-layout-'));
const browser = process.env.CHROME_BIN || 'chromium';
const run = promisify(execFile);
const stylesheet = (path: string) =>
  `<link rel="stylesheet" href="${pathToFileURL(resolve(path)).href}">`;
const gameStyles = [
  'src/client/style.css',
  'src/client/ui/dom/ui.css',
  'src/client/ui/dom/docked.css',
]
  .map(stylesheet)
  .join('');
const viewerStyles = [
  'src/tools/style.css',
  'font/font.css',
  'src/client/ui/dom/ui.css',
  'src/client/ui/dom/docked.css',
  'src/tools/module-viewer/style.css',
]
  .map(stylesheet)
  .join('');
const gameMarkup = await readFile('src/client/ui/dom/docked.html', 'utf8');
const viewerMarkup = `<div class="viewer-controls"></div><main class="module-viewer-main ui-surface"><div class="module-viewer-grid"><article class="module-viewer-card"><div class="dock-detail ui-card ui-scroll"></div></article><article class="module-viewer-card"><div class="dock-detail ui-card ui-scroll"></div></article></div></main>`;

try {
  await writeFile(
    `${directory}/game.html`,
    `<!doctype html><html><head>${gameStyles}</head><body><div class="hud">${gameMarkup}</div></body></html>`,
  );
  await writeFile(
    `${directory}/viewer.html`,
    `<!doctype html><html><head>${viewerStyles}</head><body>${viewerMarkup}</body></html>`,
  );
  await writeFile(
    `${directory}/index.html`,
    `<!doctype html><html><body>
      <iframe id="game" src="game.html" style="width:1440px;height:900px"></iframe>
      <iframe id="viewer" src="viewer.html" style="width:1440px;height:900px"></iframe>
      <script>
        window.onload = async () => {
          const game = document.querySelector('#game');
          const viewer = document.querySelector('#viewer');
          await Promise.all([game.contentDocument.fonts.ready, viewer.contentDocument.fonts.ready]);
          const gameCard = game.contentDocument.querySelector('.dock-detail');
          const cards = [...viewer.contentDocument.querySelectorAll('.dock-detail')];
          const render = (long) => {
            const text = long ? 'Detailed module description. '.repeat(180) : 'Short description.';
            const markup = '<h2 class="leading-tight text-lg uppercase">Module</h2><p class="mt-4">' + text + '</p><div class="mt-6">Power consumption</div>';
            gameCard.innerHTML = markup;
            cards.forEach(card => card.innerHTML = markup);
          };
          const measure = () => ({
            game: { width: gameCard.getBoundingClientRect().width, height: gameCard.getBoundingClientRect().height, scroll: gameCard.scrollHeight, client: gameCard.clientHeight },
            viewer: cards.map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height, scroll: card.scrollHeight, client: card.clientHeight })),
          });
          render(false);
          const short = measure();
          render(true);
          const long = measure();
          game.style.height = viewer.style.height = '600px';
          const shortViewport = measure();
          viewer.style.width = '2100px';
          const wideGrid = measure();
          document.body.setAttribute('data-result', JSON.stringify({ short, long, shortViewport, wideGrid }));
        };
      </script>
    </body></html>`,
  );
  const { stdout } = await run(
    browser,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--virtual-time-budget=5000',
      '--dump-dom',
      pathToFileURL(`${directory}/index.html`).href,
    ],
    { maxBuffer: 5_000_000 },
  );
  const encoded = stdout.match(/data-result="([^"]+)"/)?.[1];

  assert(encoded, 'browser did not report the layout measurements');
  const results = JSON.parse(
    encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'),
  );

  const equal = (actual: number, expected: number) =>
    assert(
      Math.abs(actual - expected) < 1,
      `${actual} differs from ${expected}`,
    );

  for (const sample of [results.short, results.long, results.shortViewport]) {
    for (const card of sample.viewer) {
      equal(card.width, sample.game.width);
      equal(card.height, sample.game.height);
    }
  }

  assert(
    results.long.game.scroll > results.long.game.client,
    'game card scrolls',
  );
  assert(
    results.long.viewer[0].scroll > results.long.viewer[0].client,
    'viewer card scrolls',
  );

  for (const card of results.wideGrid.viewer) {
    equal(card.width, results.short.game.width);
  }

  console.log(
    'Module viewer cards match the game at 900px and 600px heights and retain their width in a wider grid.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
