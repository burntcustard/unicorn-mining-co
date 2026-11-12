import assert from 'node:assert/strict';
import { installLatencyClient } from '../../benchmarking/latency/probe.ts';

// The dock UI translates a primary pointer press into its ui-press event; a
// programmatic click alone does not trigger that path.
class TestPointerEvent extends Event {
  isPrimary: boolean;
  button: number;

  constructor(type: string, options: PointerEventInit) {
    super(type, options);
    this.isPrimary = options.isPrimary ?? false;
    this.button = options.button ?? 0;
  }
}

const canvas = {};

const button = Object.assign(new EventTarget(), {
  disabled: false,
  visible: true,
  getClientRects() {
    return this.visible ? [1] : [];
  },
});

const network = {
  world: { entities: new Map() },
  connected: true,
  recordInput() {},
};

const page: Record<string, any> = {
  __latencyRefs: [
    network,
    { canvas, ctx: {} },
    { thrust: 0, turn: 0, hornDrill: false },
  ],
};

const documentStub = {
  querySelector(selector: string) {
    return selector === '#canvas' ? canvas : button;
  },
};

const keys = ['window', 'document', 'PointerEvent'] as const;
const originals = keys.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);
let launches = 0;

button.addEventListener('pointerdown', (event) => {
  const pointer = event as TestPointerEvent;

  if (pointer.isPrimary && pointer.button === 0 && pointer.bubbles) launches++;
});

try {
  for (const [index, value] of [
    page,
    documentStub,
    TestPointerEvent,
  ].entries()) {
    Object.defineProperty(globalThis, keys[index], {
      configurable: true,
      value,
    });
  }

  assert(installLatencyClient({ properties: {}, tags: {} }));
  assert.equal(page.latencyClient.launch(), true);
  assert.equal(launches, 1, 'Launch follows the dock UI primary-press path');
  button.disabled = true;
  assert.equal(page.latencyClient.launch(), false);
  button.disabled = false;
  button.visible = false;
  assert.equal(page.latencyClient.launch(), false);
  assert.equal(
    launches,
    1,
    'Disabled or hidden launch buttons are not pressed',
  );
} finally {
  keys.forEach((key, index) => {
    if (originals[index]) {
      Object.defineProperty(globalThis, key, originals[index]);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  });
}
