import assert from 'node:assert/strict';
import { createSoundVisualizer } from '../../src/tools/sound-editor/visualizer.ts';

class Drawing {
  strokeStyle = '';
  fillStyle = '';
  fills: { color: string; rectangle: number[] }[] = [];
  paths: { color: string; points: number[][]; lineWidth: number }[] = [];
  points: number[][] = [];
  labels: string[] = [];
  transform: number[] = [];
  lineWidth = 0;

  setTransform(...values: number[]) {
    this.transform = values;
  }

  fillRect(...rectangle: number[]) {
    this.fills.push({ color: this.fillStyle, rectangle });
  }

  beginPath() {
    this.points = [];
  }

  moveTo(x: number, y: number) {
    this.points.push([x, y]);
  }

  lineTo(x: number, y: number) {
    this.points.push([x, y]);
  }

  stroke() {
    this.paths.push({
      color: this.strokeStyle,
      points: this.points,
      lineWidth: this.lineWidth,
    });
  }

  fillText(text: string) {
    this.labels.push(text);
  }
}

const drawing = new Drawing();
const attributes = new Map<string, string>();
const bounds = { width: 242.625, height: 146.375 };

const style = {
  borderLeftWidth: '1px',
  borderRightWidth: '1px',
  borderTopWidth: '1px',
  borderBottomWidth: '1px',
  paddingLeft: '1.5px',
  paddingRight: '0.25px',
  paddingTop: '0.5px',
  paddingBottom: '1.25px',
};

const initialContent = { width: 238.875, height: 142.625 };

const canvas = {
  width: 0,
  height: 0,
  getContext: () => drawing,
  getBoundingClientRect: () => bounds,
  setAttribute: (name: string, value: string) => attributes.set(name, value),
};

let animationRequests = 0;
let animationCancellations = 0;

let resize: (
  entries?: { contentRect: { width: number; height: number } }[],
) => void;

let observerDisconnections = 0;
let audioCreations = 0;

const resolutions: { query: string; listeners: Set<() => void> }[] = [];

const replacements = {
  devicePixelRatio: 1.25,
  getComputedStyle: () => style,
  matchMedia: (query: string) => {
    const listeners = new Set<() => void>();

    resolutions.push({ query, listeners });

    return {
      addEventListener(event: string, listener: () => void) {
        assert.equal(event, 'change');
        listeners.add(listener);
      },
      removeEventListener(event: string, listener: () => void) {
        assert.equal(event, 'change');
        listeners.delete(listener);
      },
    };
  },
  requestAnimationFrame: () => {
    animationRequests++;
    throw new Error('Static waveforms must not request animation frames.');
  },
  cancelAnimationFrame: () => {
    animationCancellations++;
  },
  ResizeObserver: class {
    constructor(callback: typeof resize) {
      resize = callback;
    }

    observe() {}

    disconnect() {
      observerDisconnections++;
    }
  },
  AudioContext: class {
    constructor() {
      audioCreations++;
    }
  },
  OfflineAudioContext: class {
    constructor() {
      audioCreations++;
    }
  },
};

const descriptors = new Map(
  Object.keys(replacements).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);

for (const [name, value] of Object.entries(replacements)) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

try {
  const visualizer = createSoundVisualizer({
    canvas: canvas as unknown as HTMLCanvasElement,
  });

  assert.equal(
    audioCreations,
    0,
    'opening the visualizer creates no audio context',
  );
  assert.equal(
    animationRequests,
    0,
    'a static waveform does not run an animation loop',
  );
  assert.equal(
    canvas.width,
    Math.round(initialContent.width * 1.25),
    'backing pixels use the fractional content width without borders or padding',
  );
  assert.equal(canvas.height, Math.round(initialContent.height * 1.25));
  assert.deepEqual(
    drawing.transform,
    [
      canvas.width / initialContent.width,
      0,
      0,
      canvas.height / initialContent.height,
      0,
      0,
    ],
    'the exact backing-to-content transform avoids stretching the bitmap',
  );
  assert.deepEqual(drawing.fills.at(-2)!.rectangle, [
    0,
    0,
    initialContent.width,
    initialContent.height,
  ]);
  let sampleReads = 0;

  const samples = new Proxy(new Float32Array(10000), {
    get(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) sampleReads++;
      return Reflect.get(target, property, target);
    },
  });

  samples[123] = 0.5;
  samples[6789] = -0.75;

  visualizer.setBuffer({
    length: samples.length,
    sampleRate: 10000,
    getChannelData: () => samples,
  } as unknown as AudioBuffer);

  const overview = drawing.paths
    .filter(({ color }) => color === '#58e7ee')
    .at(-1)!;
  const heights = overview.points.map(([, y]) => y);

  assert(
    Math.max(...heights) - Math.min(...heights) > 20,
    'downsampling preserves narrow positive and negative transients',
  );
  assert.equal(
    audioCreations,
    0,
    'setting or resizing a buffer does not unlock audio',
  );
  assert.equal(animationRequests, 0);
  const beforeDensityReads = sampleReads;
  const previousResolution = resolutions.at(-1)!;

  Object.defineProperty(globalThis, 'devicePixelRatio', {
    configurable: true,
    value: 2,
  });

  for (const listener of previousResolution.listeners) listener();

  assert.equal(
    canvas.width,
    Math.round(initialContent.width * 2),
    'a density change redraws the canvas',
  );
  assert(
    sampleReads > beforeDensityReads,
    'density changes invalidate the selected waveform column cache',
  );
  const denserOverview = drawing.paths
    .filter(({ color }) => color === '#58e7ee')
    .at(-1)!;

  assert(
    denserOverview.points.length > overview.points.length,
    'higher density produces more waveform columns',
  );
  assert.equal(previousResolution.listeners.size, 0);
  assert.match(resolutions.at(-1)!.query, /2dppx/);
  assert.equal(resolutions.at(-1)!.listeners.size, 1);
  assert.equal(
    animationRequests,
    0,
    'density changes do not request animation',
  );

  const observedContent = { width: 173.375, height: 105.625 };

  resize([{ contentRect: observedContent }]);
  assert.equal(canvas.width, Math.round(observedContent.width * 2));
  assert.equal(canvas.height, Math.round(observedContent.height * 2));
  assert.deepEqual(
    drawing.transform,
    [
      canvas.width / observedContent.width,
      0,
      0,
      canvas.height / observedContent.height,
      0,
      0,
    ],
    'ResizeObserver content sizes are not rounded or reduced by borders again',
  );
  const axis = drawing.paths.filter(({ color }) => color === '#435').at(-1)!;
  const physicalCenter = axis.points[0][1] * drawing.transform[3];

  assert(
    Math.abs(physicalCenter - 0.5 - Math.round(physicalCenter - 0.5)) < 1e-10,
    'the one-pixel center line lands on physical pixel centers',
  );
  assert(Math.abs(axis.lineWidth * drawing.transform[3] - 1) < 1e-12);
  const trace = drawing.paths
    .filter(({ color }) => color === '#58e7ee')
    .at(-1)!;

  assert(
    Math.abs(
      trace.lineWidth * Math.min(drawing.transform[0], drawing.transform[3]) -
        1,
    ) < 1e-12,
  );
  resize([{ contentRect: { width: 18.25, height: 32.5 } }]);
  assert.equal(
    canvas.width,
    37,
    'small real content widths do not get an artificial minimum',
  );
  assert.equal(
    canvas.height,
    65,
    'small real content heights do not get inflated to 96 CSS pixels',
  );
  assert.deepEqual(drawing.transform, [37 / 18.25, 0, 0, 2, 0, 0]);

  for (const name of Object.keys(style) as (keyof typeof style)[]) {
    style[name] = '0px';
  }

  bounds.height = 144;
  bounds.width = 320;
  resize();
  assert.equal(canvas.width, 640, 'resizing redraws the selected waveform');
  const colors = ['#58e7ee', '#68df85', '#ffb35c'];
  let selectedSampleReads = 0;

  const layerBuffers = [
    { length: 10000, amplitude: 1 },
    { length: 2500, amplitude: 0.5 },
    { length: 5000, amplitude: 0.25 },
  ].map(({ length, amplitude }) => {
    const samples = new Proxy(new Float32Array(length).fill(amplitude), {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          selectedSampleReads++;
        }

        return Reflect.get(target, property, target);
      },
    });

    return {
      length,
      sampleRate: 10000,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
  });

  const beforeLayers = drawing.paths.length;
  const beforeLayerFills = drawing.fills.length;

  visualizer.setBuffers(layerBuffers);

  const layerPaths = drawing.paths
    .slice(beforeLayers)
    .filter(({ color }) => colors.includes(color));

  assert.deepEqual(
    layerPaths.map(({ color }) => color),
    colors,
    'each selected layer has its own cyan, green, or orange trace in event order',
  );
  assert.equal(
    drawing.fills
      .slice(beforeLayerFills)
      .filter(({ color }) => color === '#213').length,
    1,
    'the shared plot clears once before any layer is drawn',
  );
  assert.equal(
    drawing.paths.slice(beforeLayers).filter(({ color }) => color === '#435')
      .length,
    1,
    'all layer traces share one set of axes',
  );

  const horizontalSpans = layerPaths.map(
    ({ points }) =>
      Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)),
  );

  assert.equal(
    horizontalSpans[1] / horizontalSpans[0],
    0.25,
    'a shorter layer ends at its own timestamp',
  );
  assert.equal(horizontalSpans[2] / horizontalSpans[0], 0.5);

  const plot = drawing.fills
    .slice(beforeLayerFills)
    .find(({ color }) => color === '#213')!.rectangle;

  assert.equal(
    plot[1] + plot[3],
    bounds.height - 4,
    'the selected waveform uses the full available plot height',
  );
  const center = plot[1] + plot[3] / 2;
  const amplitudes = layerPaths.map(({ points }) =>
    Math.max(...points.map(([, y]) => Math.abs(y - center))),
  );

  assert(
    Math.abs(amplitudes[1] / amplitudes[0] - 0.5) < 1e-12,
    'layers share an amplitude scale',
  );
  assert(Math.abs(amplitudes[2] / amplitudes[0] - 0.25) < 1e-12);
  assert(
    drawing.labels.includes('Layer 1') &&
      drawing.labels.includes('Layer 2') &&
      drawing.labels.includes('Layer 3'),
  );

  const beforeRemove = drawing.paths.length;

  visualizer.setBuffers(layerBuffers.slice(0, 1));
  assert.deepEqual(
    drawing.paths
      .slice(beforeRemove)
      .filter(({ color }) => colors.includes(color))
      .map(({ color }) => color),
    [colors[0]],
    'removing layers clears their old traces',
  );

  const beforeEmpty = drawing.paths.length;

  visualizer.setBuffers([]);
  assert.equal(
    drawing.paths
      .slice(beforeEmpty)
      .filter(({ color }) => colors.includes(color)).length,
    0,
    'an empty layer list clears every selected trace',
  );
  visualizer.setBuffers(layerBuffers);
  const cachedReads = selectedSampleReads;

  resize();
  assert.equal(
    selectedSampleReads,
    cachedReads,
    'redraws at the same pixel width reuse cached selected-layer waveforms',
  );
  assert(!drawing.labels.includes('Live preview mix'));
  assert(!drawing.paths.some(({ color }) => color === '#d6d'));
  assert.equal(
    attributes.has('aria-label'),
    false,
    'waveform drawing does not add a second label over the visible caption',
  );
  assert.deepEqual(
    Object.keys(visualizer).sort(),
    ['dispose', 'setBuffer', 'setBuffers'],
    'the visualizer exposes only static rendering and cleanup',
  );
  visualizer.dispose();
  assert.equal(observerDisconnections, 1);
  assert(
    resolutions.every(({ listeners }) => listeners.size === 0),
    'disposing removes the density watcher',
  );
  const beforeDisposedUpdates = drawing.paths.length;

  visualizer.setBuffer();
  visualizer.setBuffers(layerBuffers);
  resize();
  assert.equal(
    drawing.paths.length,
    beforeDisposedUpdates,
    'disposed visualizers ignore further drawing requests',
  );
  assert.equal(
    animationRequests,
    0,
    'static visualization never starts an animation loop',
  );
  assert.equal(
    animationCancellations,
    0,
    'static visualization never manages playback animation',
  );
  assert.equal(
    audioCreations,
    0,
    'static visualization never creates an audio context',
  );
} finally {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
}

console.log(
  'Static sound visualizer preserves layer traces, crisp sizing, and cached redraws.',
);
