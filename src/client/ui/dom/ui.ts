import './ui.css';

export type Screen = {
  element: HTMLElement;
  update(): void;
  destroy(): void;
};

export const createScreen = (html: string) => {
  const template = document.createElement('template');

  template.innerHTML = html;
  const element = template.content.firstElementChild as HTMLElement;
  const controller = new AbortController();

  return {
    element,
    signal: controller.signal,
    update() {},
    destroy: () => controller.abort(),
  };
};

export const query = <T extends Element = HTMLElement>(
  element: ParentNode,
  selector: string,
) => element.querySelector<T>(selector)!;

export const ui = (() => {
  const element = document.createElement('div');

  element.setAttribute('id', 'ui-root');
  document.body.append(element);

  const stack: Screen[] = [];

  const notify = () => window.dispatchEvent(new Event('ui-navigation'));

  const push = (screen: Screen) => {
    const previous = stack.at(-1);

    if (previous) previous.element.hidden = true;
    stack.push(screen);
    element.append(screen.element);
    screen.update();
    notify();
  };

  const back = () => {
    const entry = stack.pop();

    if (!entry) return;
    entry.destroy();
    element.removeChild(entry.element);
    const previous = stack.at(-1);

    if (previous) {
      previous.element.hidden = false;
      previous.update();
    }

    notify();
  };

  const clear = () => {
    while (stack.length) back();
  };

  element.addEventListener('pointerover', (event) => {
    if (
      !(event.composedPath()[0] as Element).closest('button:not(:disabled)')
    ) {
      return;
    }

    (document.activeElement as HTMLElement)?.blur();
    element.removeAttribute('data-arrow-navigation');
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') element.removeAttribute('data-arrow-navigation');

    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;
    const screen = stack.at(-1)?.element;

    if (!direction || !screen) return;
    const focused = screen.querySelector<HTMLButtonElement>(':focus');

    if (focused && !focused.matches('button')) return;

    const group =
      focused?.closest('nav, [data-bindings], .ui-actions, .ui-paints') ||
      screen.querySelector('nav') ||
      screen;

    const buttons = Array.from(
      group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter((button) => button.getClientRects().length);
    const index = buttons.indexOf(focused);

    if (!buttons.length) return;
    event.preventDefault();
    element.setAttribute('data-arrow-navigation', '');
    const next =
      index < 0
        ? direction > 0
          ? 0
          : -1
        : (index + direction) % buttons.length;

    buttons.at(next)?.focus();
  });

  window.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      document.querySelector('dialog[open]')
    ) {
      return;
    }

    if (stack.length > 1) {
      event.preventDefault();
      back();
    }
  });

  return {
    element,
    push,
    back,
    clear,
    get current() {
      return stack.at(-1);
    },
  };
})();
