import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import engineSettings from '../../src/specs/sounds/engine.ts';
import drillSettings from '../../src/specs/sounds/horn-drill.ts';
import {
  renderEffectBuffer,
  type SoundEffect,
} from '../../src/client/audio/synthesis.ts';
import {
  compactOptional,
  normalizeSoundName,
  soundId,
  soundEvents,
  soundIds,
  soundNames,
  type SoundDocument,
  type SoundName,
  type SoundValues,
} from '../../src/tools/sound-editor/parameters.ts';
import { TestAudioContext } from '../support/audio-context.ts';

type TestEvent = {
  key?: string;
  repeat?: boolean;
  target?: Element;
  preventDefault: () => void;
};

type Listener = (event: TestEvent) => void | Promise<void>;

const focusState: { element?: Element } = {};

// Exercise the real editor with its small DOM surface, without emulating layout.
class Element {
  children: Element[] = [];
  parent: Element | undefined;
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  type = '';
  id = '';
  htmlFor = '';
  title = '';
  name = '';
  value = '';
  disabled = false;
  hidden = false;
  checked = false;
  tabIndex = 0;
  scrolls = 0;

  constructor(public tagName = 'div') {}

  get valueAsNumber() {
    return this.value === '' ? NaN : Number(this.value);
  }

  append(...children: Element[]) {
    this.children.push(...children);
    children.forEach((child) => (child.parent = this));
  }

  replaceChildren(...children: Element[]) {
    this.children.forEach((child) => (child.parent = undefined));
    this.children = [];
    this.append(...children);

    if (this.tagName === 'select') this.value = children[0]?.value || '';
  }

  replaceWith(replacement: Element) {
    const parent = this.parent;

    if (!parent) return;
    const index = parent.children.indexOf(this);

    if (index < 0) return;
    parent.children.splice(index, 1, replacement);
    replacement.parent = parent;
    this.parent = undefined;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);

    if (name === 'id') this.id = value;

    if (name === 'for') this.htmlFor = value;

    if (name === 'title') this.title = value;
  }

  setCustomValidity() {}

  addEventListener(name: string, listener: Listener) {
    const listeners = this.listeners.get(name) || [];

    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  descendants(): Element[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelector(selector: string) {
    assert.equal(selector, '[aria-invalid="true"]');
    return this.descendants().find(
      (element) => element.attributes.get('aria-invalid') === 'true',
    );
  }

  focus() {
    focusState.element = this;
  }

  scrollIntoView() {
    this.scrolls++;
  }

  async emit(name: string, event: TestEvent = { preventDefault() {} }) {
    if (name === 'click' && this.disabled) return;
    event.target ||= this;

    await Promise.all(
      (this.listeners.get(name) || []).map((listener) =>
        Promise.resolve(listener(event)),
      ),
    );

    if ((name === 'input' || name === 'click') && this.parent) {
      await this.parent.emit(name, event);
    }
  }

  input(value: string) {
    this.value = value;
    return this.emit('input');
  }
}

class EditorAudioContext extends TestAudioContext {
  createBufferSource() {
    return Object.assign(super.createBufferSource(), {
      addEventListener() {},
      disconnect() {},
    });
  }

  createGain() {
    return Object.assign(super.createGain(), { disconnect() {} });
  }
}

class SampleContext {
  createBuffer(...settings: Parameters<TestAudioContext['createBuffer']>) {
    return TestAudioContext.prototype.createBuffer(...settings);
  }
}

const deferred = () => {
  let resolve: () => void;

  const promise = new Promise<void>((complete) => (resolve = complete));

  return { promise, resolve: () => resolve() };
};

const document = new Element('document');
const main = new Element('main');
const elements = new Map<string, Element>();
const html = readFileSync('src/tools/sound-editor/index.html', 'utf8');

for (const [, tag, attributes, id] of html.matchAll(
  /<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g,
)) {
  const element = new Element(tag);

  for (const [, key, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
    element.setAttribute(key, value);
  }

  element.hidden = /\bhidden\b/.test(attributes);
  element.disabled = /\bdisabled\b/.test(attributes);
  element.tabIndex = Number(element.attributes.get('tabindex') || 0);
  elements.set(id, element);
  document.append(element);
}

const get = (id: string) => elements.get(id)!;

const eventRadio = (name: SoundName) => {
  const radio = get('event')
    .descendants()
    .find((element) => element.type === 'radio' && element.value === name);

  assert(radio, `event radio ${name} exists`);
  return radio;
};

const visibleEvents = () =>
  get('event')
    .descendants()
    .filter((element) => element.type === 'radio' && !element.parent!.hidden)
    .map((radio) => radio.value);

const choose = async (group: string, value: SoundName) => {
  const radios = document
    .descendants()
    .filter((element) => element.type === 'radio' && element.name === group);
  const selected = radios.find((radio) => radio.value === value);

  assert(selected, `radio choice ${group}: ${value} exists`);

  if (group === 'sound-event') {
    await selected.parent!.children[1].emit('click');
  } else {
    radios.forEach((radio) => (radio.checked = radio === selected));
    await selected.emit('change');
  }
};

const layerCard = (name: string | number) => {
  const cards = get('layers').children.filter(
    (element) => element.tagName === 'article',
  );
  const card =
    typeof name === 'number'
      ? cards[name - 1]
      : cards.find((card) =>
          card
            .descendants()
            .some(
              (element) =>
                element.tagName === 'h3' && element.textContent === name,
            ),
        );

  assert(card, `layer card ${name} exists`);
  return card;
};

const propertyRow = (description: string) => {
  const [group, property] = description.split(': ');
  const eventGroup = group.match(/^(.+) layer (\d+)$/);

  if (!group.startsWith('Saved layer ') && eventGroup) {
    assert.equal(get('events-heading').textContent, eventGroup[1]);
  }

  const scope = group.startsWith('Saved layer ')
    ? layerCard(group.slice('Saved layer '.length))
    : / layer \d+$/.test(group)
      ? layerCard(Number(group.match(/ layer (\d+)$/)![1]))
      : get(
          group === 'Engine preview'
            ? 'engine-preview-controls'
            : 'continuous-parameters',
        );
  const label = property.replace(/ slider$/, '');
  const row = scope
    .descendants()
    .find(
      (element) =>
        element.className.split(' ').includes('number-control') &&
        element.children.some(
          (child) =>
            ['label', 'span'].includes(child.tagName) &&
            child.textContent === label,
        ),
    );

  assert(row, `visible property label ${description} exists in its group`);
  return row;
};

const input = (label: string, type = 'number') => {
  const row = propertyRow(label);
  const element = row.children.find((element) => element.type === type);
  const caption = row.children.find((element) => element.tagName === 'label')!;

  assert(element, `${type} input ${label} exists`);
  assert.equal(
    type === 'range'
      ? element.attributes.get('aria-labelledby')
      : caption.htmlFor,
    type === 'range' ? caption.id : element.id,
  );
  assert.equal(element.attributes.has('aria-label'), false);
  return element;
};

const choice = (label: string) => {
  const row = propertyRow(label);
  const element = row.children.find((element) => element.tagName === 'select');

  assert(element, `choice control ${label} exists`);
  assert.equal(row.tagName, 'label');
  assert.equal(element.attributes.has('aria-label'), false);
  return element;
};

const chooseValue = async (label: string, value: string) => {
  const element = choice(label);

  element.value = value;
  await element.emit('change');
};

const button = (label: string) => {
  const eventAction = label.match(
    /^(Duplicate|Remove|Reset|Save layer) (\d+)$/,
  );
  const savedAction = label.match(/^(Save|Reset) saved layer (.+)$/);
  const addAction = label.match(/^Add (.+) to event$/);
  const scope = eventAction
    ? layerCard(Number(eventAction[2]))
    : savedAction
      ? layerCard(savedAction[2])
      : addAction
        ? layerCard(addAction[1])
        : get('layers');
  const text =
    eventAction?.[1] ||
    (savedAction ? savedAction[1] : addAction ? 'Add to event' : '');
  const element = scope
    .descendants()
    .find(
      (element) =>
        element.tagName === 'button' &&
        (text ? element.textContent === text : element.title === label),
    );

  assert(element, `button ${label} exists`);
  assert.equal(element.attributes.has('aria-label'), false);

  if (text && text !== 'Reset') {
    assert.equal(
      element.title,
      '',
      'visible button text needs no duplicate tooltip',
    );
  }

  return element;
};

const pickerOption = (label: string) => {
  const text = label.replace(/^Add (?:saved layer |layer to )/, '');
  const element = get('layer-options')
    .descendants()
    .find(
      (element) => element.tagName === 'button' && element.textContent === text,
    );

  assert(element, `picker option ${label} exists`);
  assert.equal(element.attributes.has('aria-label'), false);
  return element;
};

get('save').disabled = true;

const globals = new Map(
  [
    'document',
    'window',
    'AudioContext',
    'OfflineAudioContext',
    'fetch',
    '__soundEditorHot',
    '__soundVisualizerTest',
  ].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  ),
);

const effectData = Object.fromEntries(
  await Promise.all(
    soundEvents.map(async (name) => [
      name,
      (
        await import(
          new URL(
            `../../src/specs/sounds/${soundIds[name]}.ts`,
            import.meta.url,
          ).href
        )
      ).default,
    ]),
  ),
) as SoundDocument['effectData'];

let disk: SoundDocument = structuredClone({
  effectData,
  continuousData: { engine: engineSettings, hornDrill: drillSettings },
  revisions: Object.fromEntries(
    soundNames.map((name) => [name, 'a'.repeat(64)]),
  ) as SoundDocument['revisions'],
  unassigned: {},
  layerRevisions: {},
});

let pendingGet: ReturnType<typeof deferred> | undefined;
let pendingPut: ReturnType<typeof deferred> | undefined;
let pendingCreation: ReturnType<typeof deferred> | undefined;
let failedGet: string | undefined;
let initialLoadFails = true;

let sourceUpdate: (event: {
  name: SoundName;
  kind?: 'event' | 'continuous' | 'layer';
}) => void | Promise<void>;

let disposeEditor: (() => void) | undefined;
const visualized: AudioBuffer[] = [];
const visualizedLayers: AudioBuffer[][] = [];

const assertDisplayedMix = () => {
  const traces = visualizedLayers.at(-1)!;
  const samples = TestAudioContext.instances[0].sources.at(-1)!.assignedSamples;

  for (let index = 0; index < samples.length; index++) {
    const sum = traces.reduce(
      (sum, buffer) => sum + (buffer.getChannelData(0)[index] || 0),
      0,
    );

    assert(
      Math.abs(samples[index] - sum) < 1e-6,
      'the played event uses every displayed layer sample',
    );
  }
};

const writes: {
  name: SoundName;
  data: SoundValues[SoundName];
  revision: string;
}[] = [];

const layerWrites: { name: string; data: SoundEffect; revision: string }[] = [];

const layerReads: string[] = [];

const creations: {
  kind: 'event' | 'layer';
  name: string;
  data: SoundEffect | SoundEffect[];
}[] = [];

const diskValue = (name: SoundName) =>
  name === 'engine'
    ? disk.continuousData.engine
    : name === 'hornDrill'
      ? disk.continuousData.hornDrill
      : disk.effectData[name];

const writeDisk = (name: SoundName, data: SoundValues[SoundName]) => {
  if (name === 'engine') {
    disk.continuousData.engine = data as SoundValues['engine'];
  } else if (name === 'hornDrill') {
    disk.continuousData.hornDrill = data as SoundValues['hornDrill'];
  } else {
    disk.effectData[name] = data as SoundEffect[];
  }
};

const fetchDocument = async (url: string, settings?: RequestInit) => {
  if (
    settings?.method === 'POST' &&
    (url === '/__sound-editor/sounds' || url === '/__sound-editor/layers')
  ) {
    const payload: { name: string; data: SoundEffect | SoundEffect[] } =
      JSON.parse(settings.body as string);

    const kind = url.endsWith('/layers') ? 'layer' : 'event';
    let name: string;

    try {
      name = normalizeSoundName(payload.name);
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 400 },
      );
    }

    if (
      kind === 'event' &&
      ['engine', 'hornDrill', 'unassigned'].includes(name)
    ) {
      return Response.json(
        { error: 'That event name is reserved.' },
        { status: 400 },
      );
    }

    if (
      Object.hasOwn(kind === 'event' ? disk.effectData : disk.unassigned, name)
    ) {
      return Response.json(
        { error: 'That name already exists.' },
        { status: 409 },
      );
    }

    const revision = String(20000 + creations.length).padStart(64, '0');

    creations.push({ kind, name, data: payload.data });

    if (kind === 'event') {
      disk.effectData[name] = payload.data as SoundEffect[];
      disk.revisions[name] = revision;
    } else {
      disk.unassigned[name] = payload.data as SoundEffect;
      disk.layerRevisions[name] = revision;
    }

    const wait = pendingCreation;

    pendingCreation = undefined;

    if (wait) await wait.promise;
    return Response.json(
      { name, data: payload.data, revision },
      { status: 201 },
    );
  }

  if (url === '/__sound-editor/sounds') {
    if (initialLoadFails) {
      initialLoadFails = false;
      return Response.json(
        { error: 'Invalid initial source' },
        { status: 500 },
      );
    }

    return Response.json(disk);
  }

  const library = url.startsWith('/__sound-editor/layers/');
  const name = (
    library
      ? Object.keys(disk.unassigned)
      : [...Object.keys(disk.effectData), 'engine', 'hornDrill']
  ).find(
    (name) =>
      url ===
      `/__sound-editor/${library ? 'layers' : 'sounds'}/${soundId(name)}`,
  );

  assert(name, `known sound endpoint ${url}`);

  if (library && settings?.method === 'PUT') {
    const payload: { data: SoundEffect; revision: string } = JSON.parse(
      settings.body as string,
    );

    const wait = pendingPut;

    pendingPut = undefined;
    layerWrites.push({ name, ...payload });

    if (wait) await wait.promise;

    if (payload.revision !== disk.layerRevisions[name]) {
      return Response.json(
        { error: 'Saved layer changed on disk.' },
        { status: 409 },
      );
    }

    disk.unassigned[name] = payload.data;
    disk.layerRevisions[name] = String(10000 + layerWrites.length).padStart(
      64,
      '0',
    );

    return Response.json({
      data: payload.data,
      revision: disk.layerRevisions[name],
    });
  }

  if (settings?.method === 'PUT') {
    const payload: { data: SoundValues[SoundName]; revision: string } =
      JSON.parse(settings.body as string);

    const wait = pendingPut;

    pendingPut = undefined;
    writes.push({ name, ...payload });

    if (wait) await wait.promise;

    if (payload.revision !== disk.revisions[name]) {
      return Response.json(
        { error: 'Sound changed on disk.' },
        { status: 409 },
      );
    }

    writeDisk(name, payload.data);
    disk.revisions[name] = String(writes.length).padStart(64, '0');

    return Response.json({
      data: diskValue(name),
      revision: disk.revisions[name],
    });
  }

  if (library) layerReads.push(name);

  const response = failedGet
    ? Response.json({ error: failedGet }, { status: 500 })
    : Response.json({
        data: library ? disk.unassigned[name] : diskValue(name),
        revision: library ? disk.layerRevisions[name] : disk.revisions[name],
      });

  failedGet = undefined;

  const wait = pendingGet;

  pendingGet = undefined;

  if (wait) await wait.promise;
  return response;
};

Object.assign(document, {
  createElement: (tagName: string) => new Element(tagName),
  querySelector: (selector: string) =>
    selector.startsWith('#')
      ? elements.get(selector.slice(1))
      : selector === 'main'
        ? main
        : document
            .descendants()
            .find(
              (element) => element.attributes.get('aria-invalid') === 'true',
            ),
});

for (const [name, value] of Object.entries({
  document,
  window: new Element('window'),
  AudioContext: EditorAudioContext,
  OfflineAudioContext: SampleContext,
  fetch: fetchDocument,
  __soundEditorHot: {
    on(event: string, listener: typeof sourceUpdate) {
      assert.equal(event, 'sound-editor:updated');
      sourceUpdate = listener;
    },
    dispose(callback: () => void) {
      disposeEditor = callback;
    },
  },
  __soundVisualizerTest: {
    create({ canvas }: { canvas: Element }) {
      assert.equal(canvas, get('sound-visualizer'));

      return {
        setBuffer(buffer: AudioBuffer) {
          visualized.push(buffer);
        },
        setBuffers(buffers: AudioBuffer[]) {
          visualizedLayers.push([...buffers]);
        },
        dispose() {},
      };
    },
  },
})) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

try {
  const bundle = await rolldown({
    input: resolve('src/tools/sound-editor/main.ts'),
    plugins: [
      {
        name: 'editor-test-css',
        resolveId: (id, importer) =>
          id === './visualizer' &&
          importer === resolve('src/tools/sound-editor/main.ts')
            ? '\0test-visualizer'
            : undefined,
        load: (id) =>
          id === '\0test-visualizer'
            ? 'export const createSoundVisualizer = options => globalThis.__soundVisualizerTest.create(options);'
            : id.endsWith('.css')
              ? { code: '', moduleType: 'js' }
              : undefined,
        transform: (code, id) =>
          id === resolve('src/tools/sound-editor/main.ts')
            ? code.replaceAll('import.meta.hot', 'globalThis.__soundEditorHot')
            : undefined,
      },
    ],
  });

  try {
    const { output } = await bundle.generate({ format: 'esm' });
    const entry = output.find((item) => item.type === 'chunk')!;

    await import(
      `data:text/javascript;base64,${Buffer.from(`${entry.code}\n//# sourceURL=sound-editor-ui-fixture.js`).toString('base64')}`
    );
  } finally {
    await bundle.close();
  }

  assert.match(
    get('status').textContent,
    /Could not load sounds: Invalid initial source/,
  );
  assert.equal(get('event').disabled, true);
  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    get('status').dataset.error,
    'false',
    `a valid file save recovers from an initial load error without a reload button: ${get('status').textContent}`,
  );
  assert.equal(get('continuous-parameters').children.length, 15);
  assert.equal(get('layers').children.length, 1);
  assert.equal(
    get('layers')
      .descendants()
      .filter((element) => element.type === 'number').length,
    19,
  );
  assert.equal(get('engine-preview-controls').children.length, 2);
  assert.equal(elements.has('reload'), false);
  assert.equal(elements.has('stop-all'), false);
  assert.equal(get('event').tagName, 'fieldset');
  assert.equal(get('continuous-kind').tagName, 'fieldset');
  assert.equal(
    get('event')
      .descendants()
      .filter((element) => element.type === 'radio').length,
    soundEvents.length + 1,
  );
  assert.equal(
    get('continuous-kind')
      .descendants()
      .filter((element) => element.type === 'radio').length,
    2,
  );
  assert.equal(
    get('event')
      .descendants()
      .find((element) => element.checked)?.value,
    'hatchOpen',
  );
  assert.doesNotMatch(html, /<select\b|[•·]/);
  assert.doesNotMatch(
    document
      .descendants()
      .map((element) => element.textContent)
      .join(' '),
    /[•·]/,
  );
  assert(
    visualizedLayers.length > 0,
    'the selected event gets idle layer waveforms',
  );
  assert.equal(visualizedLayers.at(-1)!.length, 1);
  assert(
    visualizedLayers
      .at(-1)![0]
      .getChannelData(0)
      .some((sample) => sample !== 0),
  );
  assert.match(get('visualizer-caption').textContent, /Hatch Open, \d+ ms/);
  assert.doesNotMatch(html, /live (?:preview|playback|mix)/i);
  assert.equal(
    get('sound-visualizer').attributes.get('aria-labelledby'),
    'visualizer-caption',
  );
  assert.equal(get('sound-visualizer').attributes.has('aria-label'), false);
  assert.equal(
    TestAudioContext.instances.length,
    0,
    'loading waits for an audio gesture',
  );
  assert.equal(get('continuous').hidden, true);
  assert.equal(get('events').hidden, false);
  assert.equal(get('event').hidden, false);
  assert.equal(get('continuous-kind').hidden, true);
  assert.equal(get('events-tab').attributes.get('role'), 'tab');
  assert.equal(get('events').attributes.get('role'), 'tabpanel');
  assert.equal(get('event-search').attributes.get('type'), 'search');
  assert.equal(get('event-search').attributes.get('aria-controls'), 'event');
  assert.equal(get('event-search').disabled, false);
  assert.equal(get('event-picker').hidden, false);
  assert.equal(get('event-empty').hidden, true);
  disk.revisions.hatchOpen = 'q'.repeat(64);
  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    TestAudioContext.instances.length,
    0,
    'file updates before the first audio gesture stay silent',
  );
  await input('Hatch Open layer 1: Volume').input('');
  assert.equal(
    TestAudioContext.instances.length,
    0,
    'blank number entry stays silent',
  );
  await input('Hatch Open layer 1: Volume').input('2.25');
  assert.equal(
    TestAudioContext.instances.length,
    1,
    'completing a valid event property starts its preview',
  );
  const auditionAudio = TestAudioContext.instances[0];
  const firstAudition = auditionAudio.sources.at(-1)!;
  const beforeInvalid = auditionAudio.sources.length;

  assert.equal(firstAudition.starts, 1);
  await input('Hatch Open layer 1: Frequency (Hz)').input('');
  await input('Hatch Open layer 1: Volume').input('2.3');
  assert.equal(
    auditionAudio.sources.length,
    beforeInvalid,
    'another invalid property suppresses automatic playback',
  );
  await input('Hatch Open layer 1: Frequency (Hz)').input('0');
  assert.equal(auditionAudio.sources.length, beforeInvalid + 1);
  assert.equal(
    firstAudition.stops,
    1,
    'a fresh automatic audition retires the preceding one',
  );
  assert.equal(
    firstAudition.stopTimes.at(-1),
    auditionAudio.currentTime + 0.025,
  );
  const firstGain = firstAudition.destination as ReturnType<
    TestAudioContext['createGain']
  >;

  assert.equal(
    firstGain.destination,
    auditionAudio.destination,
    'automatic auditions route their fade gain directly to the audio destination',
  );
  assert.deepEqual(
    firstGain.gain.events.at(-1),
    ['ramp', 0, auditionAudio.currentTime + 0.02],
    'automatic auditions crossfade instead of accumulating',
  );
  const beforeSlider = auditionAudio.sources.length;

  await input('Hatch Open layer 1: Volume slider', 'range').input('0.125');
  assert.equal(
    auditionAudio.sources.length,
    beforeSlider + 1,
    'sliders audition valid property changes',
  );
  await input('Hatch Open layer 1: Volume').input('2.25');
  const beforeNavigation = auditionAudio.sources.length;

  await get('event-search').input('sHiElD-');
  assert.deepEqual(visibleEvents(), ['shieldBounce', 'shieldOn', 'shieldOff']);
  assert.equal(
    eventRadio('hatchOpen').checked,
    true,
    'filtering keeps the selected event and its draft',
  );
  assert.equal(input('Hatch Open layer 1: Volume').valueAsNumber, 2.25);
  await get('event-search').input('_SEARCH - LIGHT_');
  assert.deepEqual(
    visibleEvents(),
    ['searchLight'],
    'search accepts labels, identifiers, separators, and mixed case',
  );

  await get('event-search').emit('keydown', {
    key: 'Enter',
    preventDefault() {},
  });

  assert.equal(focusState.element, eventRadio('searchLight'));
  assert.equal(eventRadio('searchLight').checked, true);
  assert.equal(
    auditionAudio.sources.length,
    beforeNavigation + 1,
    'opening an event plays it once',
  );
  assert.equal(auditionAudio.sources.at(-1)!.starts, 1);
  assert(eventRadio('searchLight').parent!.scrolls > 0);
  await get('event-search').input('no matching event');
  assert.deepEqual(visibleEvents(), []);
  assert.equal(get('event-empty').hidden, false);

  await get('event-search').emit('keydown', {
    key: 'Enter',
    preventDefault() {},
  });

  assert.equal(
    eventRadio('searchLight').checked,
    true,
    'empty search results do not change selection',
  );

  await get('event-search').emit('keydown', {
    key: 'Escape',
    preventDefault() {},
  });

  assert.equal(get('event-search').value, '');
  assert.deepEqual(visibleEvents(), ['unassigned', ...soundEvents]);
  assert.equal(get('event-empty').hidden, true);
  await get('event-search').input('shield');

  await get('event-search').emit('keydown', {
    key: 'ArrowDown',
    preventDefault() {},
  });

  assert.equal(focusState.element, eventRadio('shieldBounce'));

  await eventRadio('shieldBounce').emit('keydown', {
    key: 'End',
    preventDefault() {},
  });

  assert.equal(focusState.element, eventRadio('shieldOff'));

  await eventRadio('shieldOff').emit('keydown', {
    key: 'ArrowDown',
    preventDefault() {},
  });

  assert.equal(
    focusState.element,
    eventRadio('shieldBounce'),
    'row navigation wraps through visible options only',
  );

  await eventRadio('shieldBounce').emit('keydown', {
    key: 'ArrowRight',
    preventDefault() {},
  });

  assert.equal(focusState.element, eventRadio('shieldOn'));

  await eventRadio('shieldOn').emit('keydown', {
    key: 'Home',
    preventDefault() {},
  });

  assert.equal(focusState.element, eventRadio('shieldBounce'));

  await get('event-search').emit('keydown', {
    key: 'Escape',
    preventDefault() {},
  });

  await choose('sound-event', 'hatchOpen');
  assert.equal(
    auditionAudio.sources.length,
    beforeNavigation + 7,
    'keyboard and radio event selections each play one preview',
  );
  assert.equal(
    focusState.element,
    eventRadio('hatchOpen'),
    'clicking visible row text focuses its radio',
  );
  const beforeRowKeys = auditionAudio.sources.length;
  let prevented = 0;

  await focusState.element!.emit('keydown', {
    key: 'ArrowDown',
    preventDefault() {
      prevented++;
    },
  });

  assert.equal(focusState.element, eventRadio('hatchClose'));

  await focusState.element!.emit('keydown', {
    key: 'ArrowUp',
    preventDefault() {
      prevented++;
    },
  });

  assert.equal(focusState.element, eventRadio('hatchOpen'));

  await focusState.element!.emit('keydown', {
    key: ' ',
    preventDefault() {
      prevented++;
    },
  });

  assert.equal(
    focusState.element,
    eventRadio('hatchOpen'),
    'Space preserves list focus',
  );
  assert.equal(
    auditionAudio.sources.length,
    beforeRowKeys + 3,
    'arrows select and Space replays exactly once',
  );

  await focusState.element!.emit('keydown', {
    key: ' ',
    repeat: true,
    preventDefault() {
      prevented++;
    },
  });

  assert.equal(
    auditionAudio.sources.length,
    beforeRowKeys + 4,
    'holding Space replays on each repeated key event',
  );
  assert.equal(
    prevented,
    4,
    'custom keys prevent native radio actions and page scrolling',
  );
  const beforeRepeat = auditionAudio.sources.length;

  await eventRadio('hatchOpen').emit('click');
  await eventRadio('hatchOpen').emit('change');
  assert.equal(
    auditionAudio.sources.length,
    beforeRepeat + 1,
    'clicking the current event replays it once',
  );
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    2.25,
    'keyboard selection preserves another event draft',
  );
  await get('event-search').input('shield');

  await get('event-search').emit('keydown', {
    key: 'ArrowUp',
    preventDefault() {},
  });

  assert.equal(
    focusState.element,
    eventRadio('shieldOff'),
    'ArrowUp enters at the last result when the selection is filtered out',
  );

  await get('event-search').emit('keydown', {
    key: 'Escape',
    preventDefault() {},
  });

  await choose('sound-event', 'hatchOpen');
  await input('Hatch Open layer 1: Volume').input('2');
  assert.equal(get('save').disabled, true);
  await get('event-search').input('hatch');
  await get('continuous-tab').emit('click');
  assert.equal(get('event-picker').hidden, true);
  await get('events-tab').emit('click');
  assert.equal(get('event-picker').hidden, false);
  assert.equal(
    get('event-search').value,
    'hatch',
    'tab changes retain the search query',
  );
  assert.deepEqual(visibleEvents(), ['hatchOpen', 'hatchClose']);

  await get('event-search').emit('keydown', {
    key: 'Escape',
    preventDefault() {},
  });

  await get('events-tab').emit('keydown', {
    key: 'End',
    preventDefault() {},
  });

  assert.equal(get('continuous').hidden, false);
  assert.equal(get('events').hidden, true);
  assert.equal(get('event').hidden, true);
  assert.equal(get('continuous-kind').hidden, false);
  assert.equal(get('continuous-tab').attributes.get('aria-selected'), 'true');
  assert.equal(get('events-tab').tabIndex, -1);
  assert.equal(focusState.element, get('continuous-tab'));

  await get('continuous-tab').emit('keydown', {
    key: 'Home',
    preventDefault() {},
  });

  assert.equal(get('events').hidden, false);
  assert.equal(get('event').hidden, false);
  assert.equal(get('continuous-kind').hidden, true);
  assert.equal(focusState.element, get('events-tab'));

  await get('events-tab').emit('keydown', {
    key: 'ArrowUp',
    preventDefault() {},
  });

  assert.equal(
    focusState.element,
    get('continuous-tab'),
    'arrow keys wrap between the two tabs',
  );

  await get('continuous-tab').emit('keydown', {
    key: 'ArrowDown',
    preventDefault() {},
  });

  assert.equal(focusState.element, get('events-tab'));
  await get('continuous-tab').emit('click');

  await get('continuous-play').emit('click');
  const audio = TestAudioContext.instances[0];
  const engine = audio.sources.at(-1)!;

  assert.equal(engine.starts, 1);
  assert.equal(Reflect.get(engine, 'loop'), true);
  assert.equal(engine.playbackRate.value, engineSettings.basePitch);
  assert.equal(
    (engine.destination as ReturnType<TestAudioContext['createGain']>)
      .destination,
    audio.destination,
    'continuous previews route their envelope gain directly to the audio destination',
  );
  const engineWaveform = visualized.at(-1);

  await input('Engine: Frequency (Hz)').input('55');
  assert.equal(engine.stops, 1, 'editing a loop replaces its buffer');
  assert.notEqual(
    visualized.at(-1),
    engineWaveform,
    'editing a sound updates its waveform',
  );
  await choose('continuous-sound', 'hornDrill');
  let drill = audio.sources.at(-1)!;

  assert.equal(get('continuous-parameters').children.length, 9);
  assert.equal(drill.playbackRate.value, drillSettings.activePitch);
  const previousDrill = drill;

  disk.continuousData.hornDrill.activePitch = 0.93;
  disk.revisions.hornDrill = 'r'.repeat(64);
  await sourceUpdate({ name: 'hornDrill' });
  drill = audio.sources.at(-1)!;
  assert.notEqual(drill, previousDrill);
  assert.equal(previousDrill.stops, 1);
  assert.equal(drill.playbackRate.value, 0.93);
  assert.equal(
    get('continuous-play').attributes.get('aria-pressed'),
    'true',
    'a source update rebuilds the loop while keeping the continuous preview active',
  );
  get('biting').checked = true;
  await get('biting').emit('change');
  assert.equal(audio.sources.at(-1), drill);
  assert.equal(drill.playbackRate.value, drillSettings.bitingPitch);
  await get('continuous-play').emit('click');
  assert.equal(drill.stops, 1);
  await choose('continuous-sound', 'engine');
  assert.equal(get('save').disabled, false);
  await get('events-tab').emit('click');
  assert.equal(
    get('save').disabled,
    true,
    'another sound draft does not enable Save for this clean sound',
  );
  assert.match(get('pending-changes').textContent, /1 other sound/);
  assert.equal(input('Hatch Open layer 1: Frequency (Hz)').valueAsNumber, 0);
  assert.equal(
    input('Hatch Open layer 1: End frequency (Hz)').valueAsNumber,
    0,
  );
  assert.equal(input('Hatch Open layer 1: High-pass (Hz)').valueAsNumber, 0);
  await input('Hatch Open layer 1: Volume').input('2.5');
  const beforeAdd = audio.sources.length;

  await get('add-layer').emit('click');
  assert.equal(
    audio.sources.length,
    beforeAdd,
    'adding a layer does not auto-audition',
  );
  assert.equal(visualizedLayers.at(-1)!.length, 2);
  const previousLayerWaveform = visualizedLayers
    .at(-1)![1]
    .getChannelData(0)
    .slice();

  await input('Hatch Open layer 2: Frequency (Hz)').input('660');
  assert.equal(
    audio.sources.length,
    beforeAdd + 1,
    'a frequency edit auditions once despite synchronizing its end frequency',
  );
  assert.equal(visualizedLayers.at(-1)!.length, 2);
  assertDisplayedMix();
  assert.notDeepEqual(
    visualizedLayers.at(-1)![1].getChannelData(0),
    previousLayerWaveform,
    'editing one layer updates its separate trace',
  );
  assert.equal(
    input('Hatch Open layer 2: End frequency (Hz)').valueAsNumber,
    660,
    'omitted end frequency follows a frequency-only edit',
  );
  await input('Hatch Open layer 2: End frequency (Hz)').input('700');
  await input('Hatch Open layer 2: Frequency (Hz)').input('770');
  assert.equal(
    input('Hatch Open layer 2: End frequency (Hz)').valueAsNumber,
    700,
    'an explicit sweep endpoint is preserved',
  );
  await input('Hatch Open layer 2: End frequency (Hz)').input('770');
  await input('Hatch Open layer 2: Frequency (Hz)').input('660');
  assert.equal(
    input('Hatch Open layer 2: End frequency (Hz)').valueAsNumber,
    660,
  );
  const beforeStructuralChanges = audio.sources.length;

  await button('Duplicate 2').emit('click');
  assert.equal(get('layers').children.length, 3);
  assert.equal(visualizedLayers.at(-1)!.length, 3);
  assert.deepEqual(
    visualizedLayers.at(-1)![1].getChannelData(0),
    visualizedLayers.at(-1)![2].getChannelData(0),
    'duplicated layers retain their ordered traces',
  );
  await button('Remove 3').emit('click');
  assert.equal(get('layers').children.length, 2);
  assert.equal(
    visualizedLayers.at(-1)!.length,
    2,
    'removing a layer removes its trace',
  );
  assert.equal(
    audio.sources.length,
    beforeStructuralChanges,
    'duplicating and removing layers do not auto-audition',
  );
  await choose('sound-event', 'hatchClose');
  assert.equal(
    visualizedLayers.at(-1)!.length,
    1,
    'changing events replaces the trace set',
  );
  assert.equal(input('Hatch Close layer 1: Volume').valueAsNumber, 4);
  assert.equal(get('save').disabled, true);
  await choose('sound-event', 'hatchOpen');
  assert.equal(
    audio.sources.length,
    beforeStructuralChanges + 2,
    'opening each event auditions it once',
  );
  assert.equal(visualizedLayers.at(-1)!.length, 2);
  assert.equal(input('Hatch Open layer 2: Frequency (Hz)').valueAsNumber, 660);
  await input('Hatch Open layer 1: Frequency (Hz)').input('');
  assert.equal(get('save').disabled, true);
  await get('continuous-tab').emit('click');
  assert.equal(
    get('save').disabled,
    false,
    'invalid fields in the hidden event panel do not block an engine save',
  );
  await input('Engine: Frequency (Hz)').input('');
  assert.equal(get('save').disabled, true);
  await get('events-tab').emit('click');
  assert.equal(
    get('save').disabled,
    false,
    'switching back rerenders valid stored event values',
  );
  const beforeEvent = audio.sources.length;
  const previousSingleViews = visualized.length;

  await get('event-play').emit('click');
  assert.equal(audio.sources.length, beforeEvent + 1);
  assert(audio.sources.at(-1)!.assignedSamples.some((sample) => sample !== 0));
  assert.equal(
    visualized.length,
    previousSingleViews,
    'event playback keeps its separate traces instead of replacing them with the mix',
  );
  assert.equal(visualizedLayers.at(-1)!.length, 2);
  assertDisplayedMix();
  const manualEvent = audio.sources.at(-1)!;

  assert.equal(manualEvent.destination, audio.destination);
  await button('Play layer 2').emit('click');
  assert.equal(
    visualizedLayers.at(-1)!.length,
    2,
    'solo playback keeps every event trace visible',
  );
  assert.equal(
    audio.sources.at(-1)!.buffer,
    visualizedLayers.at(-1)![1],
    'solo playback uses the selected displayed layer',
  );
  const manualLayer = audio.sources.at(-1)!;

  assert.equal(manualLayer.destination, audio.destination);
  await input('Hatch Open layer 1: Volume').input('2.5');
  assert.equal(
    manualEvent.stops,
    0,
    'automatic auditions preserve manually started event playback',
  );
  assert.equal(
    manualLayer.stops,
    0,
    'automatic auditions preserve manually started layer playback',
  );
  await get('continuous-tab').emit('click');
  assert.equal(audio.sources.at(-1)!.stops, 1);
  await get('events-tab').emit('click');

  const put = deferred();

  pendingPut = put;
  const saving = get('save').emit('click');

  assert.equal(get('save').disabled, true);
  const eventWrite = writes.at(-1)!;

  assert.equal(eventWrite.name, 'hatchOpen');
  assert.deepEqual(
    eventWrite.data,
    [
      { volume: 2.5, attack: 10, decay: 100, cutoff: 1000 },
      { volume: 0.2, frequency: 660, attack: 10, decay: 200 },
    ],
    'saving keeps omitted defaults out of the file',
  );
  await input('Hatch Open layer 1: Volume').input('2.8');
  await get('continuous-tab').emit('click');
  await input('Engine: Frequency (Hz)').input('66');
  disk.continuousData.hornDrill.activePitch = 0.85;
  disk.revisions.hornDrill = 'c'.repeat(64);
  await sourceUpdate({ name: 'hornDrill' });
  await sourceUpdate({ name: 'hatchOpen' });
  put.resolve();
  await saving;
  assert.equal(
    get('save').disabled,
    false,
    'edits made during saving remain unsaved',
  );
  await choose('continuous-sound', 'hornDrill');
  assert.equal(
    input('Horn drill: Active pitch').valueAsNumber,
    0.85,
    'an unrelated source update received during saving is applied afterward',
  );
  await choose('continuous-sound', 'engine');
  assert.equal(
    disk.continuousData.engine.frequency,
    22,
    'saving an event leaves the engine file alone',
  );
  await get('events-tab').emit('click');
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    2.8,
    'the save-generated source event preserves newer edits',
  );
  disk.effectData.hatchOpen[0].volume = 2.6;
  disk.revisions.hatchOpen = 'e'.repeat(64);
  const beforeSourceRefresh = audio.sources.length;

  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    2.6,
    'an external save replaces pending editor changes',
  );
  assert.equal(
    audio.sources.length,
    beforeSourceRefresh + 1,
    'refreshing the selected event from source auditions its new sound once',
  );
  const afterSourceReplay = audio.sources.length;

  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    audio.sources.length,
    afterSourceReplay,
    'duplicate file notifications do not replay an unchanged revision',
  );
  disk.revisions.hatchClose = 's'.repeat(64);
  await sourceUpdate({ name: 'hatchClose' });
  assert.equal(
    audio.sources.length,
    afterSourceReplay,
    'an unselected event refresh stays silent',
  );
  audio.state = 'suspended';
  disk.revisions.hatchOpen = 't'.repeat(64);
  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    audio.sources.length,
    afterSourceReplay,
    'file updates do not try to unlock a suspended audio context',
  );
  audio.state = 'running';
  assert.equal(get('save').disabled, true);
  await get('continuous-tab').emit('click');
  assert.equal(
    input('Engine: Frequency (Hz)').valueAsNumber,
    66,
    'refreshing an event preserves another sound draft',
  );
  const whileContinuous = audio.sources.length;

  disk.revisions.hatchOpen = '9'.repeat(64);
  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    audio.sources.length,
    whileContinuous,
    'event file changes stay silent while the continuous-sounds tab is open',
  );

  disk.effectData.hatchClose[0].volume = 5;
  disk.revisions.hatchClose = 'b'.repeat(64);
  await get('save').emit('click');
  assert.equal(writes.at(-1)!.name, 'engine');
  assert.equal(disk.continuousData.engine.frequency, 66);
  assert.equal(
    get('save').disabled,
    true,
    'an unrelated file change does not conflict with saving the engine',
  );
  await input('Engine: Frequency (Hz)').input('77');
  await get('events-tab').emit('click');
  await choose('sound-event', 'hatchClose');
  await input('Hatch Close layer 1: Volume').input('4.4');
  await get('save').emit('click');
  assert.equal(
    input('Hatch Close layer 1: Volume').valueAsNumber,
    5,
    'a conflicting save automatically refreshes authoritative file data',
  );
  assert.equal(disk.effectData.hatchClose[0].volume, 5);
  assert.equal(get('save').disabled, true);
  assert.match(get('pending-changes').textContent, /1 other sound/);
  await choose('sound-event', 'hatchOpen');

  const getRequest = deferred();

  disk.effectData.hatchOpen[0].volume = 3;
  disk.revisions.hatchOpen = 'f'.repeat(64);
  pendingGet = getRequest;
  const loading = sourceUpdate({ name: 'hatchOpen' });

  await input('Hatch Open layer 1: Volume').input('3.1');
  getRequest.resolve();
  await loading;
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    3,
    'file data wins even when a property changes during the refresh',
  );
  assert.equal(get('save').disabled, true);

  const olderGet = deferred();

  disk.effectData.hatchOpen[0].volume = 3.2;
  disk.revisions.hatchOpen = 'g'.repeat(64);
  pendingGet = olderGet;
  const olderUpdate = sourceUpdate({ name: 'hatchOpen' });

  disk.effectData.hatchOpen[0].volume = 3.3;
  disk.revisions.hatchOpen = 'h'.repeat(64);
  await sourceUpdate({ name: 'hatchOpen' });
  olderGet.resolve();
  await olderUpdate;
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    3.3,
    'a late response cannot restore an older file revision',
  );
  failedGet = 'Invalid sound source';
  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    3.3,
    'invalid source data keeps the last valid sound',
  );
  assert.match(
    get('status').textContent,
    /Could not refresh Hatch Open: Invalid sound source/,
  );
  disk.effectData.hatchOpen[0].volume = 3.4;
  disk.revisions.hatchOpen = 'i'.repeat(64);
  await sourceUpdate({ name: 'hatchOpen' });
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    3.4,
    'a later valid file save recovers without a reload button',
  );
  assert.equal(get('status').dataset.error, 'false');
  const failedOlderGet = deferred();

  failedGet = 'Outdated invalid source';
  pendingGet = failedOlderGet;
  const olderFailure = sourceUpdate({ name: 'hatchOpen' });

  disk.effectData.hatchOpen[0].volume = 3.5;
  disk.revisions.hatchOpen = 'j'.repeat(64);
  await sourceUpdate({ name: 'hatchOpen' });
  failedOlderGet.resolve();
  await olderFailure;
  assert.equal(input('Hatch Open layer 1: Volume').valueAsNumber, 3.5);
  assert.equal(
    get('status').dataset.error,
    'false',
    'a late error cannot replace the newer successful refresh status',
  );
  await get('continuous-tab').emit('click');
  assert.equal(input('Engine: Frequency (Hz)').valueAsNumber, 77);

  const automaticGet = deferred();

  pendingGet = automaticGet;
  const updating = sourceUpdate({ name: 'engine' });
  const laterPut = deferred();

  pendingPut = laterPut;
  const laterSaving = get('save').emit('click');

  await input('Engine: Frequency (Hz)').input('78');
  laterPut.resolve();
  await laterSaving;
  automaticGet.resolve();
  await updating;
  assert.equal(
    input('Engine: Frequency (Hz)').valueAsNumber,
    78,
    'a GET started before saving cannot overwrite newer edits after the save',
  );
  assert.equal(disk.continuousData.engine.frequency, 77);
  assert.equal(get('save').disabled, false);

  disk.effectData.ui = [
    { volume: 0.4, frequency: 220, attack: 10, decay: 100 },
    {
      volume: 0.2,
      frequency: 440,
      attack: 20,
      decay: 200,
      waveform: 'triangle',
    },
  ];

  disk.revisions.ui = 'k'.repeat(64);
  await sourceUpdate({ name: 'ui' });
  await get('events-tab').emit('click');
  await choose('sound-event', 'ui');
  await input('UI layer 2: Pitch duration (ms)').input('400');
  await input('UI layer 2: Filter duration (ms)').input('300');
  await input('UI layer 2: Attack (ms)').input('30');
  assert.equal(
    input('UI layer 2: Pitch duration (ms)').valueAsNumber,
    400,
    'an explicit pitch duration survives envelope editing before a sweep is enabled',
  );
  assert.equal(
    input('UI layer 2: Filter duration (ms)').valueAsNumber,
    300,
    'an explicit filter duration survives envelope editing before a sweep is enabled',
  );
  await input('UI layer 2: End frequency (Hz)').input('880');
  await input('UI layer 2: End low-pass (Hz)').input('400');
  assert.equal(input('UI layer 2: Pitch duration (ms)').valueAsNumber, 400);
  assert.equal(input('UI layer 2: Filter duration (ms)').valueAsNumber, 300);
  const prefix = 'UI layer 1: ';
  const waveforms = [
    'sine',
    'triangle',
    'square',
    'pulse',
    'sawtooth',
    'noise',
    'crackle',
  ];

  assert.deepEqual(
    choice(`${prefix}Waveform`).children.map((option) => option.value),
    waveforms,
  );

  for (const waveform of waveforms) {
    const before = audio.sources.length;

    await chooseValue(`${prefix}Waveform`, waveform);
    assert.equal(
      audio.sources.length,
      before + 1,
      'waveform choices audition the complete event',
    );
    assert(audio.sources.at(-1)!.assignedSamples.every(Number.isFinite));
    assert.equal(visualizedLayers.at(-1)!.length, 2);
    assertDisplayedMix();
  }

  await chooseValue(`${prefix}Waveform`, 'pulse');
  assert.equal(input(`${prefix}Pulse width`).parent!.hidden, false);
  await input(`${prefix}Pulse width`).input('0.25');
  const curves = ['linear', 'exponential', 'ease-in', 'ease-out'];

  for (const [label, value] of [
    ['Attack curve', 'ease-in'],
    ['Decay curve', 'linear'],
    ['Release curve', 'ease-out'],
    ['Pitch curve', 'ease-out'],
    ['Filter curve', 'exponential'],
  ]) {
    assert.deepEqual(
      choice(prefix + label).children.map((option) => option.value),
      curves,
    );
    const before = audio.sources.length;

    await chooseValue(prefix + label, value);
    assert.equal(audio.sources.length, before + 1);
  }

  await input(`${prefix}Frequency (Hz)`).input('440');
  assert.equal(input(`${prefix}End frequency (Hz)`).valueAsNumber, 440);
  await input(`${prefix}End frequency (Hz)`).input('880');
  await input(`${prefix}Frequency (Hz)`).input('660');
  assert.equal(input(`${prefix}End frequency (Hz)`).valueAsNumber, 880);
  await input(`${prefix}Low-pass (Hz)`).input('1200');
  assert.equal(input(`${prefix}End low-pass (Hz)`).valueAsNumber, 1200);
  await input(`${prefix}End low-pass (Hz)`).input('500');
  await input(`${prefix}Low-pass (Hz)`).input('1400');
  assert.equal(input(`${prefix}End low-pass (Hz)`).valueAsNumber, 500);
  await input(`${prefix}High-pass (Hz)`).input('10');
  assert.equal(input(`${prefix}End high-pass (Hz)`).valueAsNumber, 10);
  await input(`${prefix}End high-pass (Hz)`).input('100');
  await input(`${prefix}High-pass (Hz)`).input('20');
  assert.equal(input(`${prefix}End high-pass (Hz)`).valueAsNumber, 100);
  const beforeEnvelope = audio.sources.length;

  await input(`${prefix}Attack (ms)`).input('20');
  assert.equal(
    audio.sources.length,
    beforeEnvelope + 1,
    'implicit sweep-clock synchronization does not duplicate an audition',
  );
  await input(`${prefix}Hold (ms)`).input('60');
  await input(`${prefix}Release (ms)`).input('80');
  assert(
    Math.abs(input(`${prefix}Pitch duration (ms)`).valueAsNumber - 260) < 1e-12,
  );
  assert(
    Math.abs(input(`${prefix}Filter duration (ms)`).valueAsNumber - 260) <
      1e-12,
  );
  await input(`${prefix}Pitch duration (ms)`).input('250');
  await input(`${prefix}Filter duration (ms)`).input('150');
  await input(`${prefix}Decay (ms)`).input('200');
  assert.equal(input(`${prefix}Pitch duration (ms)`).valueAsNumber, 250);
  assert.equal(input(`${prefix}Filter duration (ms)`).valueAsNumber, 150);
  await input(`${prefix}Pitch duration (ms)`).input('360');
  await input(`${prefix}Hold (ms)`).input('70');
  assert(
    Math.abs(input(`${prefix}Pitch duration (ms)`).valueAsNumber - 370) < 1e-12,
    'a sweep duration resumes following the envelope when reset to its default',
  );
  assert.equal(input(`${prefix}Filter duration (ms)`).valueAsNumber, 150);
  await input(`${prefix}Pitch duration (ms)`).input('270');
  await input(`${prefix}Filter duration (ms)`).input('190');
  await input(`${prefix}Sustain level`).input('0.35');
  await input(`${prefix}Delay (ms)`).input('125');
  assert(
    Math.abs(input(`${prefix}Pitch duration (ms)`).valueAsNumber - 270) < 1e-12,
    'delay is outside the pitch and filter sweep clocks',
  );
  assert(
    visualizedLayers
      .at(-1)![0]
      .getChannelData(0)
      .slice(0, 5000)
      .every((sample) => sample === 0),
    'a layer delay creates leading silence in its displayed and played buffer',
  );
  const beforeBlank = audio.sources.length;

  await input(`${prefix}Delay (ms)`).input('');
  assert.equal(audio.sources.length, beforeBlank);
  await input(`${prefix}Delay (ms)`).input('0');
  assert.equal(
    audio.sources.length,
    beforeBlank + 1,
    'zero delay remains a valid audible edit',
  );
  assert(audio.sources.at(-1)!.assignedSamples.every(Number.isFinite));
  await input(`${prefix}Delay (ms)`).input('125');
  await input(`${prefix}Attack (ms)`).input('0');
  assert(audio.sources.at(-1)!.assignedSamples.every(Number.isFinite));
  await input(`${prefix}Attack (ms)`).input('20');
  await input(`${prefix}Frequency (Hz)`).input('');
  const beforeNoise = audio.sources.length;

  await chooseValue(`${prefix}Waveform`, 'noise');
  assert.equal(
    audio.sources.length,
    beforeNoise + 1,
    'switching to noise clears invalid unused pitch inputs',
  );
  assert.equal(input(`${prefix}Frequency (Hz)`).parent!.hidden, true);
  assert.equal(input(`${prefix}Frequency (Hz)`).valueAsNumber, 660);
  await chooseValue(`${prefix}Waveform`, 'pulse');
  await input(`${prefix}Pulse width`).input('');
  const beforeSine = audio.sources.length;

  await chooseValue(`${prefix}Waveform`, 'sine');
  assert.equal(
    audio.sources.length,
    beforeSine + 1,
    'switching away from pulse clears an invalid unused pulse width',
  );
  assert.equal(input(`${prefix}Pulse width`).parent!.hidden, true);
  await chooseValue(`${prefix}Waveform`, 'pulse');
  assert.equal(input(`${prefix}Pulse width`).valueAsNumber, 0.25);
  const enums = get('layers')
    .descendants()
    .filter((element) => element.tagName === 'select');

  assert.equal(enums.length, 12);
  assert(
    enums.every(
      (element) =>
        element.parent?.tagName === 'label' &&
        element.parent.children.some(
          (child) => child.tagName === 'span' && child.textContent,
        ),
    ),
    'choice controls use their visible native labels within each layer',
  );
  await get('save').emit('click');
  const editedUi = writes.at(-1)!;

  assert.equal(editedUi.name, 'ui');

  assert.deepEqual((editedUi.data as SoundEffect[])[0], {
    volume: 0.4,
    frequency: 660,
    attack: 20,
    decay: 200,
    waveform: 'pulse',
    pulseWidth: 0.25,
    delay: 125,
    hold: 70,
    sustain: 0.35,
    release: 80,
    attackCurve: 'ease-in',
    decayCurve: 'linear',
    releaseCurve: 'ease-out',
    endFrequency: 880,
    pitchDuration: 270,
    pitchCurve: 'ease-out',
    cutoff: 1400,
    endCutoff: 500,
    highpass: 20,
    endHighpass: 100,
    filterDuration: 190,
    filterCurve: 'exponential',
  });

  await input(`${prefix}Delay (ms)`).input('300');

  Object.assign(disk.effectData.ui[0], {
    delay: 200,
    waveform: 'triangle',
    pitchCurve: 'ease-in',
  });

  disk.revisions.ui = 'm'.repeat(64);
  const beforeExternal = audio.sources.length;

  await sourceUpdate({ name: 'ui' });
  assert.equal(
    audio.sources.length,
    beforeExternal + 1,
    'a selected event update replays the complete event',
  );
  assert.equal(choice(`${prefix}Waveform`).value, 'triangle');
  assert.equal(choice(`${prefix}Pitch curve`).value, 'ease-in');
  assert.equal(input(`${prefix}Delay (ms)`).valueAsNumber, 200);
  assert.equal(input(`${prefix}Pulse width`).parent!.hidden, true);
  assert.equal(get('save').disabled, true);
  await get('continuous-tab').emit('click');
  assert.equal(get('continuous-parameters').children.length, 15);
  assert.equal(
    get('continuous-parameters')
      .descendants()
      .filter((element) => element.tagName === 'select').length,
    0,
  );
  assert.equal(
    get('sound-visualizer').attributes.get('aria-labelledby'),
    'visualizer-caption',
  );
  await get('events-tab').emit('click');
  await choose('sound-event', 'ui');
  await input('UI layer 1: Delay (ms)').input('250');

  const librarySnapshot = compactOptional({
    ...disk.effectData.ui[0],
    delay: 250,
  });

  await button('Save layer 1').emit('click');
  assert.equal(get('layer-create').hidden, false);
  await get('layer-name').input('snare');
  await input('UI layer 1: Delay (ms)').input('300');
  await get('layer-create').emit('submit');
  assert.deepEqual(
    disk.unassigned.snare,
    librarySnapshot,
    'saving a layer persists the captured settings snapshot',
  );
  assert.equal(
    disk.effectData.ui[0].delay,
    200,
    'saving a library layer does not save the event draft',
  );
  assert.equal(input('UI layer 1: Delay (ms)').valueAsNumber, 300);
  assert.equal(get('layer-create').hidden, true);
  await choose('sound-event', 'unassigned');
  assert.equal(get('save').hidden, true);
  assert.equal(
    get('event-play').hidden,
    true,
    'Unassigned has no combined event playback',
  );
  assert.equal(input('Saved layer Snare: Delay (ms)').valueAsNumber, 250);
  await input('Saved layer Snare: Delay (ms)').input('');
  await get('add-layer').emit('click');
  await get('layer-name').input('snare');
  const beforeDuplicateLayer = creations.length;

  await get('layer-create').emit('submit');
  assert.equal(creations.length, beforeDuplicateLayer);
  assert.equal(get('layer-create').hidden, false);
  assert.equal(get('layer-name').value, 'snare');
  assert.match(get('status').textContent, /already exists/);
  await get('layer-name').input('spare tone');
  await get('layer-create').emit('submit');
  assert(Object.hasOwn(disk.unassigned, 'spareTone'));
  assert.equal(
    input('Saved layer Spare Tone: Volume').valueAsNumber,
    disk.unassigned.spareTone.volume,
  );
  assert.equal(
    input('Saved layer Snare: Delay (ms)').value,
    '',
    'creating a library layer preserves another card input',
  );
  await input('Saved layer Snare: Delay (ms)').input('250');
  const beforeLibraryAudition = audio.sources.length;

  await input('Saved layer Snare: Delay (ms)').input('350');
  assert.equal(audio.sources.length, beforeLibraryAudition + 1);
  const beforeLibrarySave = writes.length;

  await button('Save saved layer Snare').emit('click');
  assert.equal(layerWrites.at(-1)!.name, 'snare');
  assert.equal(disk.unassigned.snare.delay, 350);
  assert.equal(
    writes.length,
    beforeLibrarySave,
    'a library Save writes only that layer file',
  );
  await button('Play saved layer Snare').emit('click');

  const expectedLibraryPreview = renderEffectBuffer({
    context: new SampleContext() as unknown as Pick<
      BaseAudioContext,
      'createBuffer'
    >,
    layers: [disk.unassigned.snare],
  });

  assert.deepEqual(
    audio.sources.at(-1)!.assignedSamples,
    expectedLibraryPreview.getChannelData(0),
    'library playback contains only that named layer',
  );
  await get('new-event').emit('click');
  assert.equal(get('event-create').hidden, false);
  await get('event-name').input('hatchOpen');
  const beforeDuplicateEvent = creations.length;

  await get('event-create').emit('submit');
  assert.equal(creations.length, beforeDuplicateEvent);
  assert.equal(get('event-create').hidden, false);
  assert.equal(get('event-name').value, 'hatchOpen');
  await get('event-name').input('../invalid');
  await get('event-create').emit('submit');
  assert.equal(creations.length, beforeDuplicateEvent);
  await get('event-name').input('engine');
  await get('event-create').emit('submit');
  assert.equal(creations.length, beforeDuplicateEvent);
  await get('event-create-cancel').emit('click');
  assert.equal(get('event-create').hidden, true);
  await get('event-search').input('ui');
  await get('new-event').emit('click');
  await get('event-name').input('cargo warning');
  const beforeEmptyEvent = audio.sources.length;

  await get('event-create').emit('submit');
  assert.equal(
    audio.sources.length,
    beforeEmptyEvent,
    'opening a new empty event does not start a preview',
  );
  assert.deepEqual(disk.effectData.cargoWarning, []);
  assert.equal(get('event-create').hidden, true);
  assert.equal(get('event-search').value, '');
  assert.equal(eventRadio('cargoWarning').checked, true);
  assert.equal(get('layers').children.length, 0);
  assert.equal(
    get('save').disabled,
    true,
    'creating an event immediately persists its empty source file',
  );
  await get('load-layer').emit('click');
  assert.equal(get('layer-picker').hidden, false);
  await get('layer-search').input('sNa-re');
  await pickerOption('Add saved layer Snare').emit('click');
  assert.equal(get('layer-picker').hidden, true);
  assert.equal(get('layers').children.length, 1);
  assert.equal(input('Cargo Warning layer 1: Delay (ms)').valueAsNumber, 350);
  await input('Cargo Warning layer 1: Delay (ms)').input('400');
  await choose('sound-event', 'unassigned');
  assert.equal(
    input('Saved layer Snare: Delay (ms)').valueAsNumber,
    350,
    'editing an event copy does not edit the library layer',
  );
  await input('Saved layer Snare: Delay (ms)').input('450');
  await button('Save saved layer Snare').emit('click');
  assert.deepEqual(
    disk.effectData.cargoWarning,
    [],
    'saving a library layer leaves another event draft unsaved',
  );
  await choose('sound-event', 'cargoWarning');
  assert.equal(input('Cargo Warning layer 1: Delay (ms)').valueAsNumber, 400);
  const beforeEventSave = layerWrites.length;
  const beforeSaveAudio = audio.sources.length;

  await get('save').emit('click');
  await sourceUpdate({ name: 'cargoWarning' });
  assert.equal(
    audio.sources.length,
    beforeSaveAudio,
    'the editor Save and its file notification do not add a replay',
  );
  assert.equal(writes.at(-1)!.name, 'cargoWarning');
  assert.equal(disk.effectData.cargoWarning[0].delay, 400);
  assert.equal(layerWrites.length, beforeEventSave);
  await choose('sound-event', 'ui');
  assert.equal(
    input('UI layer 1: Delay (ms)').valueAsNumber,
    300,
    'new event and library authoring retain existing event drafts',
  );
  await choose('sound-event', 'unassigned');
  await button('Add Snare to event').emit('click');
  await get('layer-search').input('cargo');
  await pickerOption('Add layer to Cargo Warning').emit('click');
  assert.equal(eventRadio('cargoWarning').checked, true);
  assert.equal(get('layers').children.length, 2);
  assert.equal(input('Cargo Warning layer 1: Delay (ms)').valueAsNumber, 400);
  assert.equal(input('Cargo Warning layer 2: Delay (ms)').valueAsNumber, 450);
  await get('save').emit('click');
  await choose('sound-event', 'unassigned');
  await input('Saved layer Snare: Delay (ms)').input('500');
  await input('Saved layer Spare Tone: Volume').input('0.33');
  const blankOtherLayer = input('Saved layer Spare Tone: Attack (ms)');

  await button('Play saved layer Snare').emit('click');
  await blankOtherLayer.input('');
  blankOtherLayer.focus();
  const beforeLibraryRefresh = audio.sources.length;

  disk.unassigned.snare.delay = 600;
  disk.layerRevisions.snare = 'n'.repeat(64);
  await sourceUpdate({ name: 'snare', kind: 'layer' });
  assert.equal(
    audio.sources.length,
    beforeLibraryRefresh + 1,
    'an external edit replays the previewed library layer',
  );
  assert.equal(
    input('Saved layer Snare: Delay (ms)').valueAsNumber,
    600,
    'library source edits replace only that layer draft',
  );
  assert.equal(input('Saved layer Spare Tone: Volume').valueAsNumber, 0.33);
  assert.equal(input('Saved layer Spare Tone: Attack (ms)'), blankOtherLayer);
  assert.equal(
    blankOtherLayer.value,
    '',
    'refreshing one saved layer preserves another card incomplete input',
  );
  assert.equal(focusState.element, blankOtherLayer);
  assert.equal(button('Save saved layer Snare').disabled, true);
  assert.equal(button('Save saved layer Spare Tone').disabled, true);
  await blankOtherLayer.input(String(disk.unassigned.spareTone.attack));
  assert.equal(button('Save saved layer Spare Tone').disabled, false);
  assert.deepEqual(
    disk.effectData.cargoWarning.map((effect) => effect.delay),
    [400, 450],
    'library changes leave copied event layers independent',
  );
  await input('Saved layer Snare: Delay (ms)').input('650');
  const libraryPut = deferred();

  pendingPut = libraryPut;
  const savingLibrary = button('Save saved layer Snare').emit('click');

  await input('Saved layer Snare: Delay (ms)').input('675');
  await sourceUpdate({ name: 'snare', kind: 'layer' });
  libraryPut.resolve();
  await savingLibrary;
  assert.equal(disk.unassigned.snare.delay, 650);
  assert.equal(
    input('Saved layer Snare: Delay (ms)').valueAsNumber,
    675,
    'a library save notification preserves newer layer edits',
  );
  assert.equal(button('Save saved layer Snare').disabled, false);
  disk.unassigned.snare.delay = 700;
  disk.layerRevisions.snare = 'o'.repeat(64);
  await button('Save saved layer Snare').emit('click');
  assert.equal(
    input('Saved layer Snare: Delay (ms)').valueAsNumber,
    700,
    'a library save conflict refreshes the authoritative layer file',
  );
  assert.equal(button('Save saved layer Snare').disabled, true);
  disk.effectData.externalPing = [
    { volume: 0.2, frequency: 880, attack: 10, decay: 100 },
  ];
  disk.revisions.externalPing = 'p'.repeat(64);
  await sourceUpdate({ name: 'externalPing', kind: 'event' });
  await get('event-search').input('external-ping');
  assert.deepEqual(
    visibleEvents(),
    ['externalPing'],
    'new source-authored event files appear in the searchable event list',
  );

  await get('event-search').emit('keydown', {
    key: 'Enter',
    preventDefault() {},
  });

  assert.equal(
    input('External Ping layer 1: Frequency (Hz)').valueAsNumber,
    880,
  );
  assert.equal(get('save').disabled, true);

  await get('event-search').emit('keydown', {
    key: 'Escape',
    preventDefault() {},
  });

  await get('new-event').emit('click');
  await get('event-name').input('late hatch');
  const eventPost = deferred();

  pendingCreation = eventPost;
  const creatingNewEvent = get('event-create').emit('submit');

  assert(Object.hasOwn(disk.effectData, 'lateHatch'));
  await sourceUpdate({ name: 'lateHatch', kind: 'event' });
  await choose('sound-event', 'lateHatch');
  await get('add-layer').emit('click');
  await input('Late Hatch layer 1: Delay (ms)').input('80');
  const pendingEventInput = input('Late Hatch layer 1: Attack (ms)');

  await pendingEventInput.input('');
  pendingEventInput.focus();
  eventPost.resolve();
  await creatingNewEvent;
  assert.equal(
    input('Late Hatch layer 1: Delay (ms)').valueAsNumber,
    80,
    'an event POST response preserves edits made after HMR discovery',
  );
  assert.equal(input('Late Hatch layer 1: Attack (ms)'), pendingEventInput);
  assert.equal(pendingEventInput.value, '');
  assert.equal(focusState.element, pendingEventInput);
  assert.deepEqual(disk.effectData.lateHatch, []);
  await pendingEventInput.input('10');
  await get('save').emit('click');
  await choose('sound-event', 'unassigned');
  await get('add-layer').emit('click');
  await get('layer-name').input('late layer');
  const layerPost = deferred();

  pendingCreation = layerPost;
  const creatingNewLayer = get('layer-create').emit('submit');

  assert(Object.hasOwn(disk.unassigned, 'lateLayer'));
  await sourceUpdate({ name: 'lateLayer', kind: 'layer' });
  await input('Saved layer Late Layer: Delay (ms)').input('90');
  const pendingLayerInput = input('Saved layer Late Layer: Attack (ms)');

  await pendingLayerInput.input('');
  pendingLayerInput.focus();
  layerPost.resolve();
  await creatingNewLayer;
  assert.equal(
    input('Saved layer Late Layer: Delay (ms)').valueAsNumber,
    90,
    'a layer POST response preserves edits made after HMR discovery',
  );
  assert.equal(input('Saved layer Late Layer: Attack (ms)'), pendingLayerInput);
  assert.equal(pendingLayerInput.value, '');
  assert.equal(focusState.element, pendingLayerInput);
  assert.equal(disk.unassigned.lateLayer.delay, undefined);
  await pendingLayerInput.input('10');
  await button('Save saved layer Late Layer').emit('click');
  await input('Saved layer Snare: Delay (ms)').input('710');
  const firstLibraryPut = deferred();

  pendingPut = firstLibraryPut;
  const savingFirstLayer = button('Save saved layer Snare').emit('click');
  const staleOtherGet = deferred();

  pendingGet = staleOtherGet;
  const updatingOtherLayer = sourceUpdate({ name: 'spareTone', kind: 'layer' });
  const secondLibraryPut = deferred();

  pendingPut = secondLibraryPut;
  const savingSecondLayer = button('Save saved layer Spare Tone').emit('click');
  const otherReads = layerReads.filter((name) => name === 'spareTone').length;

  await input('Saved layer Spare Tone: Volume').input('0.34');
  firstLibraryPut.resolve();
  await savingFirstLayer;
  assert.equal(
    layerReads.filter((name) => name === 'spareTone').length,
    otherReads,
    'finishing one layer save does not restart source GETs for another pending save',
  );
  staleOtherGet.resolve();
  await updatingOtherLayer;
  secondLibraryPut.resolve();
  await savingSecondLayer;
  assert.equal(disk.unassigned.spareTone.volume, 0.33);
  assert.equal(
    input('Saved layer Spare Tone: Volume').valueAsNumber,
    0.34,
    'a concurrent layer save and stale GET preserve newer edits',
  );
  assert.equal(button('Save saved layer Spare Tone').disabled, false);
  assert.equal(
    layerReads.filter((name) => name === 'spareTone').length,
    otherReads + 1,
  );
  await button('Reset saved layer Spare Tone').emit('click');
  assert.equal(input('Saved layer Spare Tone: Volume').valueAsNumber, 0.33);
  assert.equal(button('Save saved layer Spare Tone').disabled, true);

  disk.effectData.hatchOpen = [
    {
      volume: 0.2,
      attack: 1,
      decay: 100,
      frequency: 440,
      gainPoints: [0, 1, 0],
    },
    { volume: 0.3, attack: 2, decay: 120, frequency: 880 },
  ];

  disk.revisions.hatchOpen = 'reset-fixture';
  await sourceUpdate({ name: 'hatchOpen' });
  await choose('sound-event', 'hatchOpen');
  const writesBeforeReset = writes.length;

  await input('Hatch Open layer 1: Volume').input('0.7');
  await input('Hatch Open layer 2: Volume').input('0.8');
  const otherInvalidInput = input('Hatch Open layer 2: Attack (ms)');

  await otherInvalidInput.input('');
  await button('Reset 1').emit('click');
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    0.2,
    'reset restores the saved layer',
  );
  assert.equal(
    input('Hatch Open layer 2: Volume').valueAsNumber,
    0.8,
    'reset leaves other layer edits intact',
  );
  assert.equal(
    input('Hatch Open layer 2: Attack (ms)'),
    otherInvalidInput,
    'reset preserves other in-progress input elements',
  );
  assert.equal(
    otherInvalidInput.value,
    '',
    'reset preserves invalid edits in other layers',
  );
  await button('Reset 2').emit('click');
  assert.equal(
    input('Hatch Open layer 2: Attack (ms)').valueAsNumber,
    2,
    'reset clears invalid input in its own layer',
  );
  assert.equal(
    get('save').disabled,
    true,
    'resetting all edits clears dirty state',
  );
  assert.equal(
    writes.length,
    writesBeforeReset,
    'reset never writes a sound file',
  );
  await input('Hatch Open layer 2: Volume').input('0.9');
  await button('Remove 1').emit('click');
  await button('Reset 1').emit('click');
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    0.3,
    'reset tracks the surviving layer after indices shift',
  );
  await button('Duplicate 1').emit('click');
  await button('Reset 2').emit('click');
  assert.equal(
    get('layers').children.length,
    1,
    'reset discards an unsaved duplicate',
  );
  await get('add-layer').emit('click');
  await button('Reset 2').emit('click');
  assert.equal(
    get('layers').children.length,
    1,
    'reset discards an unsaved new layer',
  );
  await input('Hatch Open layer 1: Volume').input('0.6');
  const resetPut = deferred();

  pendingPut = resetPut;
  const savingResetFixture = get('save').emit('click');

  await input('Hatch Open layer 1: Volume').input('0.9');
  resetPut.resolve();
  await savingResetFixture;
  await button('Reset 1').emit('click');
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    0.6,
    'reset uses the successful save snapshot, not subsequent edits',
  );
  assert.equal(get('save').disabled, true);
  const eventResetWrites = writes.length;

  await input('Hatch Open layer 1: Volume').input('0.8');
  await button('Duplicate 1').emit('click');
  await get('add-layer').emit('click');
  await button('Remove 1').emit('click');
  await input('Hatch Open layer 1: Attack (ms)').input('');
  await choose('sound-event', 'hatchClose');
  await input('Hatch Close layer 1: Volume').input('0.67');
  await choose('sound-event', 'hatchOpen');
  await get('event-reset').emit('click');
  assert.equal(
    get('layers').children.length,
    1,
    'event reset restores the saved layer count and order',
  );
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    0.6,
    'event reset restores the latest saved event',
  );
  assert.equal(
    input('Hatch Open layer 1: Attack (ms)').valueAsNumber,
    2,
    'event reset clears incomplete input',
  );
  assert.equal(
    get('save').disabled,
    true,
    'event reset clears the current event dirty state',
  );
  await input('Hatch Open layer 1: Volume').input('0.9');
  await button('Reset 1').emit('click');
  assert.equal(
    input('Hatch Open layer 1: Volume').valueAsNumber,
    0.6,
    'per-layer reset still works after event reset',
  );
  await choose('sound-event', 'hatchClose');
  assert.equal(
    input('Hatch Close layer 1: Volume').valueAsNumber,
    0.67,
    'event reset preserves other event drafts',
  );
  assert.equal(
    writes.length,
    eventResetWrites,
    'event reset does not save to disk',
  );
  await choose('sound-event', 'unassigned');
  assert.equal(
    get('event-reset').hidden,
    true,
    'library layers use their own reset buttons',
  );
  await get('continuous-tab').emit('click');
  assert.equal(get('event-reset').hidden, true);
  await get('events-tab').emit('click');
  await choose('sound-event', 'hatchOpen');
  assert.equal(get('event-reset').hidden, false);
  assert.deepEqual(
    get('event-actions').children.slice(-2),
    [get('save'), get('event-reset')],
    'event reset stays after Save when switching tabs',
  );

  await input('Hatch Open layer 1: Volume').input('0.8');
  const gainInput = propertyRow(
    'Hatch Open layer 1: Gain points',
  ).children.find((element) => element.type === 'text')!;
  const writesBeforeInvalidGain = writes.length;

  await gainInput.input('0, invalid, 1');
  assert.equal(gainInput.attributes.get('aria-invalid'), 'true');
  assert.equal(get('save').disabled, true);
  await get('save').emit('click');
  await button('Save layer 1').emit('click');
  assert.equal(writes.length, writesBeforeInvalidGain);
  assert.equal(
    get('layer-create').hidden,
    true,
    'invalid gain points block copying a layer as well as saving the event',
  );
  const previewsBeforeInvalidGain =
    TestAudioContext.instances[0].sources.length;

  await input('Hatch Open layer 1: Volume').input('0.9');
  assert.equal(
    TestAudioContext.instances[0].sources.length,
    previewsBeforeInvalidGain,
    'invalid gain points suppress automatic previews of other edits',
  );
  await gainInput.input('0, 1, 0');
  assert.equal(gainInput.attributes.get('aria-invalid'), 'false');
  assert.equal(get('save').disabled, false);
  await get('save').emit('click');
  assert.deepEqual(disk.effectData.hatchOpen[0].gainPoints, [0, 1, 0]);
  assert.equal(disk.effectData.hatchOpen[0].volume, 0.9);

  await choose('sound-event', 'unassigned');
  await input('Saved layer Snare: Volume').input('0.41');
  const savedGainInput = propertyRow(
    'Saved layer Snare: Gain points',
  ).children.find((element) => element.type === 'text')!;
  const writesBeforeInvalidSavedGain = layerWrites.length;

  await savedGainInput.input('0, 2');
  assert.equal(button('Save saved layer Snare').disabled, true);
  await button('Save saved layer Snare').emit('click');
  assert.equal(layerWrites.length, writesBeforeInvalidSavedGain);
  await savedGainInput.input('');
  assert.equal(savedGainInput.attributes.get('aria-invalid'), 'false');
  assert.equal(button('Save saved layer Snare').disabled, false);
  await button('Save saved layer Snare').emit('click');
  assert.equal(disk.unassigned.snare.gainPoints, undefined);
  assert.equal(disk.unassigned.snare.volume, 0.41);
} finally {
  disposeEditor?.();

  for (const [name, descriptor] of globals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
}

console.log(
  'Sound editor layers, continuous previews, saving, and async edit protection passed.',
);
