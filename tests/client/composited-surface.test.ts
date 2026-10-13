import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';

// These DOM methods remain outside the production transform, like the browser.
class Canvas {
  className = '';
  width = 300;
  height = 150;
  isConnected = false;
  style = { transform: '' };
  parentNode?: { removeChild: (canvas: Canvas) => void };
  options?: CanvasRenderingContext2DSettings;
  matrix = {
    a: 2,
    b: 0,
    c: 0,
    d: 2,
    e: 10,
    f: 20,
    inverse() {
      const { a, b, c, d, e, f } = this;
      const determinant = a * d - b * c;

      return {
        transformPoint({ x, y }: { x: number; y: number }) {
          return {
            x: (d * (x - e) - c * (y - f)) / determinant,
            y: (-b * (x - e) + a * (y - f)) / determinant,
          };
        },
      };
    },
  };
  draws = 0;
  context = {
    canvas: this,
    getTransform: () => this.matrix,
    resetTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    fillRect: () => this.draws++,
    createPattern() {},
  };

  getContext(_kind: string, options?: CanvasRenderingContext2DSettings) {
    this.options = options;
    return this.context;
  }

  setAttribute() {}
}

for (const browser of ['Firefox', 'Chrome']) {
  for (const production of [false, true]) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: browser },
      configurable: true,
    });

    const foreground = new Canvas();
    const children: Canvas[] = [];
    const created: Canvas[] = [];

    const parent = {
      removeChild(canvas: Canvas) {
        canvas.isConnected = false;
        children.splice(children.indexOf(canvas), 1);
      },
    };

    foreground.isConnected = true;
    foreground.width = 2560;

    Object.assign(foreground, {
      before(canvas: Canvas) {
        children.push(canvas);
        canvas.isConnected = true;
        canvas.parentNode = parent;
      },
    });

    Object.assign(globalThis, {
      innerWidth: 1280,
      document: {
        createElement() {
          const canvas = new Canvas();

          created.push(canvas);
          return canvas;
        },
      },
    });

    Reflect.set(globalThis, 'surface-foreground', foreground);
    const entry = `${process.cwd()}/src/__surface_test.ts`;
    const source = `
import {game} from '${process.cwd()}/src/client/game.ts';
import {beginSurfaces, endSurfaces, renderSurface} from '${process.cwd()}/src/client/utilities/composited-surface.ts';
game.canvas = Reflect.get(globalThis, 'surface-foreground');
game.scale = 1;
const key = {}, other = {}, spectrum = {}, cache = {};
const bounds = {left:-10, top:-10, right:10, bottom:10};
Reflect.set(globalThis, 'surface-test', action => {
  beginSurfaces();
  if (action === 'scale') game.scale = 2;
  let drawn = false;
  if (action !== 'hide') drawn = renderSurface({
    ctx: game.canvas.getContext('2d'), key: action === 'spectrum' ? spectrum : action === 'other' ? other : key, bounds,
    cache: action === 'change' ? {} : ['dynamic-surface', 'spectrum'].includes(action) ? undefined : cache,
    floor: ['dynamic-surface', 'spectrum'].includes(action),
    additive: action === 'spectrum',
    draw: paint => {
      paint.fillRect(-10, -10, 20, 20);
      Reflect.set(globalThis, 'surface-fallback', renderSurface({
        ctx: paint, key: {}, bounds, draw() {},
      }));
    },
  });
  endSurfaces();
  return drawn;
});`;

    const bundle = await rolldown({
      input: entry,
      plugins: [
        {
          name: 'surface-test',
          resolveId: (id) => (id === entry ? entry : undefined),
          load: (id) => (id === entry ? source : undefined),
        },
        buildPrePlugin(),
        ...(production
          ? [{ ...buildPlugin(), generateBundle: undefined }]
          : []),
      ],
    });

    const { output } = await bundle.generate({ format: 'esm' });

    await bundle.close();
    await import(
      'data:text/javascript;base64,' +
        Buffer.from(output[0].code).toString('base64') +
        '#' +
        browser
    );
    const run = Reflect.get(globalThis, 'surface-test');

    Reflect.set(foreground.context, 'createPattern', undefined);
    assert.equal(
      run('show'),
      false,
      'contexts without the native pattern API skip composited surfaces',
    );

    Reflect.set(foreground.context, 'createPattern', () => {});

    assert(run('show'));
    assert.equal(created.length, 1);
    assert.equal(created[0].draws, 1);
    assert.deepEqual(created[0].options, { willReadFrequently: true });
    assert.equal(created[0].style.transform, 'matrix(1,0,0,1,-6,-1)');
    assert.equal(Reflect.get(globalThis, 'surface-fallback'), false);
    foreground.matrix.e += 40;
    assert(run('move'));
    assert.equal(
      created[0].draws,
      1,
      'movement does not repaint fixed artwork',
    );
    assert.equal(created[0].style.transform, 'matrix(1,0,0,1,14,-1)');
    run('hide');
    assert.equal(children.length, 0, 'expired world surfaces leave the DOM');
    run('show');
    assert.equal(children.length, 1);
    assert.equal(created.length, 1, 'returning bodies reuse their surface');
    run('scale');
    assert.equal(created[0].draws, 2, 'zoom rebuilds at the new pixel scale');
    run('change');
    assert.equal(created[0].draws, 3, 'a replaced model rebuilds its artwork');
    run('dynamic-surface');
    assert.equal(
      created.length,
      2,
      'floors and objects have independent surfaces',
    );
    assert.equal(children.length, 1, 'inactive layers are removed');
    assert.equal(
      created[1].draws,
      1,
      'dynamic surfaces draw through native matrix APIs',
    );
    assert.deepEqual(
      created[1].options,
      { willReadFrequently: false },
      'dynamic surfaces allow accelerated drawing at their native pixel size',
    );

    run('show');
    run('hide');
    const beforeReuse = created[0].draws;

    run('other');
    assert.equal(created.length, 2, 'new objects can reuse retired canvases');
    assert.equal(
      created[0].draws,
      beforeReuse + 1,
      'reused canvases repaint the new object',
    );
    run('hide');
    run('show');
    assert.equal(
      created[0].draws,
      beforeReuse + 2,
      'an old object cannot reuse artwork now owned by another',
    );

    Reflect.set(foreground.context, 'createPattern', undefined);
    assert(run('spectrum'), 'WebGL additive light uses a sky-blending surface');
    assert.equal(children.length, 1);
    assert.equal(
      children[0].className,
      'world-surface world-floor world-spectrum',
    );
    assert.equal(
      Reflect.get(globalThis, 'surface-fallback'),
      false,
      'the native paint callback cannot recursively create world surfaces',
    );
    run('hide');
    assert.equal(children.length, 0, 'inactive WebGL spectra leave the DOM');
    foreground.isConnected = false;
    assert.equal(
      run('spectrum'),
      false,
      'detached previews keep direct drawing',
    );
  }
}
