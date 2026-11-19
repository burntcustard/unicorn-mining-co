import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};

const context = new Proxy(
  {
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
  },
  { get: (target, key) => Reflect.get(target, key) ?? noop },
);

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  classList = { add: noop };
  style = { setProperty: noop };
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  className = '';
  textContent = '';
  clientWidth = 160;
  width = 0;
  height = 0;
  tabIndex = 0;
  focused = false;
  onchange?: () => void;
  onclick?: () => void;
  onkeydown?: (event: { key: string; preventDefault: () => void }) => void;
  private descendants = new Map<string, Element>();

  set innerHTML(html: string) {
    this.descendants = new Map(
      [...html.matchAll(/data-([\w-]+)/g)].map(([, name]) => [
        `[data-${name}]`,
        new Element(),
      ]),
    );
  }

  append(...children: Element[]) {
    this.children.push(...children);
  }

  replaceChildren(...children: Element[]) {
    this.children = children;
    this.value = children[0]?.value || '';
  }

  querySelector(selector: string) {
    return this.descendants.get(selector);
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  focus() {
    this.focused = true;
  }
  getContext() {
    return context;
  }
}

class OptionElement extends Element {
  constructor(text: string, value: string) {
    super();
    this.textContent = text;
    this.value = value;
  }
}

const pressKey = (element: Element, key: string) => {
  let prevented = false;

  element.onkeydown!({
    key,
    preventDefault: () => {
      prevented = true;
    },
  });

  assert(prevented);
};

class Path {
  moveTo() {}
  lineTo() {}
  closePath() {}
  arc() {}
  rect() {}
}

const controls = new Map(
  [
    '#category',
    '#folder',
    '#models',
    '#modules',
    '#modules-tab',
    '#comparison-tab',
    '#power-plant-comparison-tab',
    '#modules-panel',
    '#comparison-panel',
    '#power-plant-comparison-panel',
    '#module-controls',
    '#thruster-comparison',
    '#power-plant-comparison',
  ].map((selector) => [selector, new Element()]),
);
let observers = 0;

Object.assign(globalThis, {
  document: {
    querySelector: (selector: string) => controls.get(selector),
    createElement: () => new Element(),
  },
  Option: OptionElement,
  Path2D: Path,
  devicePixelRatio: 1,
  ResizeObserver: class {
    observe() {
      observers++;
    }
    disconnect() {
      observers--;
    }
  },
});

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});

try {
  await server.ssrLoadModule('/src/tools/module-viewer/main.ts');
  const { catalog } = (await server.ssrLoadModule(
    '/src/tools/module-viewer/catalog.ts',
  )) as typeof import('../../src/tools/module-viewer/catalog');
  const category = controls.get('#category')!;
  const folder = controls.get('#folder')!;
  const models = controls.get('#models')!;
  const grid = controls.get('#modules')!;
  const moduleTab = controls.get('#modules-tab')!;
  const comparisonTab = controls.get('#comparison-tab')!;
  const powerPlantTab = controls.get('#power-plant-comparison-tab')!;
  const modulePanel = controls.get('#modules-panel')!;
  const comparisonPanel = controls.get('#comparison-panel')!;
  const powerPlantPanel = controls.get('#power-plant-comparison-panel')!;
  const moduleControls = controls.get('#module-controls')!;
  const comparison = controls.get('#thruster-comparison')!;
  const powerPlantComparison = controls.get('#power-plant-comparison')!;
  const ids = () => grid.children.map((card) => card.dataset.module);

  assert.equal(models.checked, false);
  assert.equal(observers, 0, 'models are not rendered initially');
  assert.equal(grid.children.length, catalog.length);
  assert(grid.children.every((card) => card.children.length === 1));
  assert.equal(comparison.children.length, 0);
  assert.equal(powerPlantComparison.children.length, 0);
  category.value = 'core';
  category.onchange!();
  assert.deepEqual(
    ids(),
    catalog.filter((entry) => entry.category === 'core').map(({ id }) => id),
  );
  assert(folder.children.some((option) => option.value === 'power-plants'));
  assert(folder.children.some((option) => option.value === 'thrusters'));

  folder.value = 'thrusters';
  folder.onchange!();
  assert.deepEqual(
    ids(),
    catalog
      .filter(
        (entry) => entry.category === 'core' && entry.folder === 'thrusters',
      )
      .map(({ id }) => id),
  );

  comparisonTab.onclick!();
  assert.equal(modulePanel.hidden, true);
  assert.equal(moduleControls.hidden, true);
  assert.equal(comparisonPanel.hidden, false);
  assert.equal(powerPlantPanel.hidden, true);
  assert.equal(comparisonTab.attributes['aria-selected'], 'true');
  assert.equal(moduleTab.tabIndex, -1);
  assert(comparison.children.length > 0, 'comparison is rendered');
  const thrusterHeading = comparison.children[0];

  pressKey(comparisonTab, 'ArrowRight');
  assert.equal(comparisonPanel.hidden, true);
  assert.equal(powerPlantPanel.hidden, false);
  assert.equal(powerPlantTab.attributes['aria-selected'], 'true');
  assert.equal(powerPlantTab.tabIndex, 0);
  assert.equal(powerPlantTab.focused, true);
  assert(powerPlantComparison.children.length > 0);
  const powerPlantHeading = powerPlantComparison.children[0];

  pressKey(powerPlantTab, 'Home');
  assert.equal(modulePanel.hidden, false);
  assert.equal(moduleControls.hidden, false);
  assert.equal(comparisonPanel.hidden, true);
  assert.equal(powerPlantPanel.hidden, true);
  assert.equal(moduleTab.attributes['aria-selected'], 'true');
  assert.equal(moduleTab.focused, true);
  assert.equal(folder.value, 'thrusters', 'switching tabs preserves filters');

  pressKey(moduleTab, 'End');
  assert.equal(powerPlantPanel.hidden, false);
  assert.equal(powerPlantComparison.children[0], powerPlantHeading);
  pressKey(powerPlantTab, 'ArrowRight');
  assert.equal(modulePanel.hidden, false, 'forward navigation wraps');
  pressKey(moduleTab, 'ArrowLeft');
  assert.equal(powerPlantPanel.hidden, false, 'backward navigation wraps');
  comparisonTab.onclick!();
  assert.equal(comparison.children[0], thrusterHeading);
  moduleTab.onclick!();

  models.checked = true;
  models.onchange!();
  assert.equal(observers, grid.children.length);
  assert(grid.children.every((card) => card.children.length === 2));
  assert(grid.children.every((card) => card.children[0].width > 0));

  category.value = 'utility';
  category.onchange!();
  assert.equal(folder.value, '', 'changing category clears the old folder');
  assert.equal(folder.disabled, true);
  assert.deepEqual(
    ids(),
    catalog.filter((entry) => entry.category === 'utility').map(({ id }) => id),
  );
  assert.equal(
    observers,
    grid.children.length,
    'old previews are disconnected',
  );
  models.checked = false;
  models.onchange!();
  assert.equal(observers, 0, 'disabling models disconnects every preview');
  assert(grid.children.every((card) => card.children.length === 1));
} finally {
  await server.close();
}
