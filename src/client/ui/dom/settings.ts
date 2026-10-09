import html from './settings.html?raw';
import { createScreen, query, ui } from './ui';
import {
  bindingEntries,
  saveBindings,
  resetBindings,
} from '../../input/keybindings';
import { graphics, saveGraphics } from './graphics';

export const createSettings = () => {
  const screen = createScreen(html);
  const status = query(screen.element, '.ui-status');
  const dialog = query<HTMLDialogElement>(
    screen.element,
    '[data-binding-dialog]',
  );
  const prompt = query(dialog, '#binding-prompt');
  const feedback = query(dialog, '.ui-status');
  let capture = -1;
  const bindings = query(screen.element, '[data-bindings]');

  const buttons = bindingEntries.map(([label], i) => {
    const row = document.createElement('div');

    row.className = 'ui-binding';
    const text = document.createElement('span');

    text.textContent = label;
    const button = document.createElement('button');

    button.className = 'ui-choice';

    button.addEventListener(
      'click',
      () => {
        capture = i;
        prompt.textContent = `Press a new key for ${label}.`;
        feedback.textContent = '';
        dialog.returnValue = '';
        dialog.showModal();
      },
      { signal: screen.signal },
    );

    row.append(text, button);
    bindings.append(row);
    return button;
  });

  const update = () =>
    buttons.forEach((button, i) => {
      const [label, binding] = bindingEntries[i];
      const keys = binding.keys
        .map((key) => (key === ' ' ? 'SPACE' : key.toUpperCase()))
        .join(' / ');

      button.textContent = keys;
      button.setAttribute('aria-label', `${label}: ${keys}. Change binding`);
    });

  dialog.addEventListener(
    'keydown',
    (event) => {
      if (capture < 0) return;
      event.stopPropagation();

      if (event.repeat) {
        event.preventDefault();
        return;
      }

      if (['Tab', 'Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      const key = event.key.toLowerCase();

      if (
        ['shift', 'control', 'alt', 'meta'].includes(key) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        feedback.textContent =
          'That key is reserved for browser and menu navigation.';
        return;
      }

      const conflict = bindingEntries.findIndex(
        ([, binding], i) =>
          i !== capture &&
          binding.keys.some((bound) => bound.toLowerCase() === key),
      );

      if (conflict >= 0) {
        feedback.textContent = `Already assigned to ${bindingEntries[conflict][0]}. Choose another key.`;
        return;
      }

      bindingEntries[capture][1].keys = [event.key];
      capture = -1;
      saveBindings();
      update();
      dialog.close('saved');
    },
    { signal: screen.signal },
  );

  dialog.addEventListener(
    'close',
    () => {
      capture = -1;
      status.textContent =
        dialog.returnValue === 'saved'
          ? 'Binding saved.'
          : 'Binding unchanged.';
    },
    { signal: screen.signal },
  );

  query(screen.element, '[data-back]').addEventListener('click', ui.back, {
    signal: screen.signal,
  });

  query(screen.element, '[data-reset]').addEventListener(
    'click',
    () => {
      capture = -1;
      resetBindings();
      update();
      status.textContent = 'Default controls restored.';
    },
    { signal: screen.signal },
  );

  [false, true].forEach((isGraphics) => {
    const button = query(
      screen.element,
      isGraphics ? '[data-graphics]' : '[data-controls]',
    );

    button.addEventListener(
      'click',
      () => {
        capture = -1;
        status.textContent = '';
        query(screen.element, '[data-control-panel]').hidden = isGraphics;
        query(screen.element, '[data-graphics-panel]').hidden = !isGraphics;

        [false, true].forEach((tab) => {
          const control = query(
            screen.element,
            tab ? '[data-graphics]' : '[data-controls]',
          );

          control.setAttribute('aria-pressed', String(tab === isGraphics));
        });
      },
      { signal: screen.signal },
    );
  });

  screen.element
    .querySelectorAll<HTMLInputElement>('[data-graphic]')
    .forEach((input) => {
      const i = Number(input.getAttribute('data-graphic'));

      input.checked = Boolean(graphics[i]);

      input.addEventListener(
        'change',
        () => {
          graphics[i] = input.checked;
          saveGraphics();
        },
        { signal: screen.signal },
      );
    });

  const resolution = query<HTMLSelectElement>(
    screen.element,
    '[data-resolution]',
  );

  resolution.value = String(graphics[3]);

  resolution.addEventListener(
    'change',
    () => {
      graphics[3] = Number(resolution.value);
      saveGraphics();
    },
    { signal: screen.signal },
  );

  screen.update = update;
  return screen;
};
