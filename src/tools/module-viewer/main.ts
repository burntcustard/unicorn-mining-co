import '../style.css';
import '../../../font/font.css';
import '../../client/ui/dom/ui.css';
import '../../client/ui/dom/docked.css';
import './style.css';
import {
  Module,
  moduleMaximumHealth,
} from '../../client/objects/modules/module';
import { moduleCategories } from '../../specs/modules/categories';
import {
  modulePowerMarkup,
  moduleThrusterMarkup,
  moduleWeaponDps,
  moduleWeaponMarkup,
} from '../../client/ui/dom/module-details';
import { catalog } from './catalog';
import { createModulePreview } from './model-preview';

const category = document.querySelector<HTMLSelectElement>('#category')!;
const folder = document.querySelector<HTMLSelectElement>('#folder')!;
const models = document.querySelector<HTMLInputElement>('#models')!;
const grid = document.querySelector<HTMLDivElement>('#modules')!;
let cleanups: (() => void)[] = [];

const title = (name: string) =>
  name
    .split('/')
    .map((part) => part.replaceAll('-', ' '))
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' / ');

const populateFolders = () => {
  const folders = [
    ...new Set(
      catalog
        .filter((entry) => !category.value || entry.category === category.value)
        .map((entry) => entry.folder)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'en-US'));

  folder.replaceChildren(
    new Option('All subfolders', ''),
    ...folders.map((name) => new Option(title(name), name)),
  );
  folder.disabled = !folders.length;
};

const rebuild = () => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];

  const previews: {
    canvas: HTMLCanvasElement;
    module: Module;
  }[] = [];

  const cards = catalog
    .filter(
      (entry) =>
        (!category.value || entry.category === category.value) &&
        (!folder.value || entry.folder === folder.value),
    )
    .map(({ id, Type }) => {
      const card = document.createElement('article');
      const panel = document.createElement('div');
      const categoryInfo = moduleCategories.get(Type.category)!;
      const maximum = moduleMaximumHealth(Type);

      card.className = 'module-viewer-card';
      card.dataset.module = id;
      panel.className = 'dock-detail ui-card ui-scroll';
      panel.style.setProperty('--ui-color', categoryInfo.color);
      panel.innerHTML = `
        <div class="flex items-center justify-between gap-3 text-muted text-sm mb-6 uppercase">
          <span></span><span class="text-color" data-category></span>
        </div>
        <h2 class="leading-tight text-lg uppercase" data-title></h2>
        <p class="mt-4" data-description></p>
        <div class="mt-6" data-weapon-stats></div>
        <div class="mt-6" data-module-power></div>
        <div data-thruster-stats></div>
        <div class="flex items-center justify-between gap-3 text-muted text-sm mt-6" data-weapon-dps title="Maximum direct-hit damage per second while firing continuously">
          <span class="uppercase">DPS</span><span data-dps></span>
        </div>
        <div class="flex items-center justify-between gap-3 text-muted text-sm mt-6" data-weight-panel>
          <span class="uppercase">Weight</span><span data-weight></span>
        </div>
        <div class="flex items-center justify-between gap-3 text-muted text-sm mt-6" data-health-panel>
          <span class="uppercase">Health</span><span data-health></span>
        </div>
        <div class="flex items-center justify-between gap-3 text-muted text-sm mt-6">
          <span class="uppercase">Price</span><span data-price></span>
        </div>`;
      panel.querySelector('[data-category]')!.textContent = categoryInfo.name;
      panel.querySelector('[data-title]')!.textContent = Type.name;
      const description =
        panel.querySelector<HTMLElement>('[data-description]')!;

      description.textContent = Type.description || '';
      description.hidden = !description.textContent;
      const weaponStats = panel.querySelector<HTMLElement>(
        '[data-weapon-stats]',
      )!;

      weaponStats.innerHTML = moduleWeaponMarkup(Type);
      weaponStats.hidden = !weaponStats.innerHTML;
      const power = panel.querySelector<HTMLElement>('[data-module-power]')!;

      power.innerHTML = modulePowerMarkup(Type);
      power.hidden = Boolean(Type.forwardThrust);
      panel.querySelector<HTMLElement>('[data-thruster-stats]')!.innerHTML =
        moduleThrusterMarkup(Type);
      const dps = moduleWeaponDps(Type);

      panel.querySelector<HTMLElement>('[data-weapon-dps]')!.hidden = !dps;
      panel.querySelector('[data-dps]')!.textContent = dps;
      panel.querySelector('[data-weight]')!.textContent = `${Type.weight} KG`;
      const healthPanel = panel.querySelector<HTMLElement>(
        '[data-health-panel]',
      )!;

      healthPanel.hidden = !maximum;
      panel.querySelector('[data-health]')!.textContent =
        `${maximum}/${maximum}`;
      panel.querySelector('[data-price]')!.textContent =
        `${Type.price.toLocaleString('en-US')}$`;

      if (models.checked) {
        const canvas = document.createElement('canvas');

        canvas.className = 'module-viewer-model';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${Type.name} model`);
        card.append(canvas);
        previews.push({ canvas, module: new Type() });
      }

      card.append(panel);
      return card;
    });

  grid.replaceChildren(...cards);
  cleanups = previews.map((preview) => createModulePreview(preview));
};

category.replaceChildren(
  new Option('All categories', ''),
  ...[...new Set(catalog.map((entry) => entry.category))]
    .sort((a, b) => a.localeCompare(b, 'en-US'))
    .map((name) => new Option(title(name), name)),
);

category.onchange = () => {
  populateFolders();
  rebuild();
};

folder.onchange = rebuild;
models.onchange = rebuild;
populateFolders();
rebuild();

import.meta.hot?.dispose(() => cleanups.forEach((cleanup) => cleanup()));
