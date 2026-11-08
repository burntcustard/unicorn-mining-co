import assert from 'node:assert/strict';
import {
  numberControl,
  type NumberParameter,
} from '../../src/tools/number-control.ts';

// Only the DOM surface used by these controls; this does not emulate layout.
class TestElement {
  children: TestElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  type = '';
  id = '';
  htmlFor = '';
  value = '';
  min = '';
  max = '';
  step = '';
  textContent = '';
  validityMessage = '';

  constructor(public tagName = 'div') {}

  get valueAsNumber() {
    return this.value === '' ? NaN : Number(this.value);
  }

  append(...children: TestElement[]) {
    this.children.push(...children);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);

    if (name === 'id') this.id = value;

    if (name === 'for') this.htmlFor = value;
  }

  setCustomValidity(message: string) {
    this.validityMessage = message;
  }

  addEventListener(name: string, listener: () => void) {
    const listeners = this.listeners.get(name) || [];

    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  input(value: string) {
    this.value = value;

    for (const listener of this.listeners.get('input') || []) listener();
  }
}

const documentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: (tagName: string) => new TestElement(tagName) },
});

const controlIds = new Set<string>();

const fixture = (parameter: NumberParameter, value: number) => {
  const changes: number[] = [];

  const controller = numberControl({
    parameter,
    value,
    change: (value) => changes.push(value),
  });

  const control = controller.element as unknown as TestElement;

  const number = control.children.find((child) => child.type === 'number')!;
  const slider = control.children.find((child) => child.type === 'range')!;
  const label = control.children.find((child) => child.tagName === 'label')!;

  assert(number, 'a precise number input is present');
  assert(slider, 'a slider is present');
  assert(label, 'the property has a visible native label');
  assert(label.id && number.id);
  assert.notEqual(label.id, number.id);

  for (const id of [label.id, number.id]) {
    assert(
      !controlIds.has(id),
      'each native label/control pair has unique IDs',
    );
    controlIds.add(id);
  }

  assert.equal(label.htmlFor, number.id);
  assert.equal(slider.attributes.get('aria-labelledby'), label.id);
  assert.equal(slider.attributes.has('aria-orientation'), false);
  assert.equal(
    control.children[0].textContent,
    `${parameter.label}${parameter.unit ? ` (${parameter.unit})` : ''}`,
  );
  assert.equal(
    control.children[1].textContent,
    `${parameter.min}-${parameter.max}, ${parameter.scale === 'log' ? 'logarithmic' : 'linear'}`,
    'range and scale appear immediately after the property title and units',
  );
  assert.equal(number.attributes.has('aria-label'), false);
  assert.equal(slider.attributes.has('aria-label'), false);
  assert.deepEqual(changes, [], 'creating a control does not edit the sound');

  return { number, slider, changes, setValue: controller.setValue };
};

try {
  const milliseconds = fixture(
    {
      label: 'Loop length',
      unit: 'ms',
      min: 1,
      max: 10000,
      step: 1,
      scale: 'log',
      integer: true,
    },
    10,
  );

  milliseconds.number.input('12.49');
  assert.equal(milliseconds.changes.at(-1), 12);
  assert.equal(milliseconds.number.value, '12');
  milliseconds.number.input('12.5');
  assert.equal(milliseconds.changes.at(-1), 13);
  milliseconds.number.input('');
  assert.equal(
    milliseconds.changes.length,
    2,
    'empty timing edits stay silent',
  );
  milliseconds.slider.input('0.5');
  assert(Number.isInteger(milliseconds.changes.at(-1)));

  const shortAttack = fixture(
    { label: 'Attack', unit: 'ms', min: 0, max: 250, step: 1, scale: 'log' },
    1,
  );

  shortAttack.number.input('0.5');
  assert.equal(shortAttack.changes.at(-1), 0.5);
  assert.equal(shortAttack.number.value, '0.5');

  const linear = fixture({ label: 'Volume', min: 0, max: 16, step: 0.01 }, 2);

  linear.number.input('0.123456789');
  assert.equal(linear.changes.at(-1), 0.123456789);
  assert.equal(linear.number.value, '0.123456789');
  assert.equal(linear.slider.valueAsNumber, 0.123456789 / 16);
  linear.slider.input('0.5');
  assert.equal(linear.changes.at(-1), 8);
  assert.equal(linear.number.valueAsNumber, 8);
  const previousLinearChanges = linear.changes.length;

  linear.setValue(0.23456789);
  assert.equal(linear.number.valueAsNumber, 0.23456789);
  assert.equal(linear.slider.valueAsNumber, 0.23456789 / 16);
  assert.equal(linear.slider.attributes.get('aria-valuetext'), '0.23456789');
  assert.equal(
    linear.changes.length,
    previousLinearChanges,
    'synchronizing a dependent control does not emit an edit',
  );

  const frequency = fixture(
    {
      label: 'Frequency',
      unit: 'Hz',
      min: 0,
      max: 22050,
      step: 1,
      scale: 'log',
    },
    0,
  );

  assert.equal(
    frequency.slider.valueAsNumber,
    0,
    'zero is valid on a log scale',
  );
  frequency.number.input('440.123456789');
  assert.equal(frequency.changes.at(-1), 440.123456789);
  assert.equal(frequency.number.value, '440.123456789');
  assert(Number.isFinite(frequency.slider.valueAsNumber));
  assert(
    frequency.slider.valueAsNumber > 0 && frequency.slider.valueAsNumber < 1,
  );
  assert.equal(
    frequency.slider.attributes.get('aria-valuetext'),
    '440.123456789',
  );
  frequency.slider.input(frequency.slider.value);
  assert.equal(frequency.changes.at(-1), 440, 'slider movement uses its step');
  frequency.slider.input('0');
  assert.equal(frequency.changes.at(-1), 0);
  frequency.slider.input('1');
  assert.equal(frequency.changes.at(-1), 22050);
  frequency.slider.input('0.5');
  assert(frequency.number.valueAsNumber > 0);
  assert(
    frequency.number.valueAsNumber < 22050 / 2,
    'log scale gives low frequencies more room',
  );

  const attack = fixture(
    { label: 'Attack', unit: 's', min: 0, max: 10, step: 0.001, scale: 'log' },
    0.01,
  );

  attack.number.input('0.000123456789');
  assert.equal(
    attack.changes.at(-1),
    0.000123456789,
    'typed precision is independent of slider step',
  );
  assert(Number.isFinite(attack.slider.valueAsNumber));
  attack.slider.input('0');
  assert.equal(attack.changes.at(-1), 0);
  attack.slider.input('1');
  assert.equal(attack.changes.at(-1), 10);

  const duration = fixture(
    {
      label: 'Loop length',
      unit: 's',
      min: 0.001,
      max: 10,
      step: 0.001,
      scale: 'log',
    },
    1 / 30,
  );

  assert.equal(duration.number.valueAsNumber, 1 / 30);
  duration.slider.input('0');
  assert.equal(duration.changes.at(-1), 0.001);
  duration.slider.input('1');
  assert.equal(duration.changes.at(-1), 10);

  const previousPosition = duration.slider.value;
  const previousChanges = duration.changes.length;

  for (const invalid of ['', 'NaN', 'Infinity', '-1', '0', '10.0001']) {
    duration.number.input(invalid);
    assert.equal(
      duration.changes.length,
      previousChanges,
      'invalid input does not edit the sound',
    );
    assert.equal(
      duration.slider.value,
      previousPosition,
      'invalid input does not move the slider',
    );
    assert.equal(duration.number.attributes.get('aria-invalid'), 'true');
    assert(duration.number.validityMessage);
  }

  duration.number.input('0.125');
  assert.equal(duration.changes.at(-1), 0.125);
  assert.equal(duration.number.attributes.get('aria-invalid'), 'false');
  assert.equal(duration.number.validityMessage, '');
  duration.number.input('');
  duration.slider.input('0');
  assert.equal(duration.changes.at(-1), 0.001);
  assert.equal(duration.number.valueAsNumber, 0.001);
  assert.equal(duration.number.attributes.get('aria-invalid'), 'false');
  assert.equal(duration.number.validityMessage, '');
} finally {
  if (documentDescriptor) {
    Object.defineProperty(globalThis, 'document', documentDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }
}

console.log(
  'Number controls preserve precision, scale sliders, and reject invalid edits.',
);
