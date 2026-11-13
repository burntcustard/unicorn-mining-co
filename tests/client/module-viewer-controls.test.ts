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
  onchange?: () => void;
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

  setAttribute() {}
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

class Path {
  moveTo() {}
  lineTo() {}
  closePath() {}
  arc() {}
  rect() {}
}

const controls = new Map(
  ['#category', '#folder', '#models', '#modules'].map((selector) => [
    selector,
    new Element(),
  ]),
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
  const ids = () => grid.children.map((card) => card.dataset.module);

  assert.equal(models.checked, false);
  assert.equal(observers, 0, 'models are not rendered initially');
  assert.equal(grid.children.length, catalog.length);
  assert(grid.children.every((card) => card.children.length === 1));
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
