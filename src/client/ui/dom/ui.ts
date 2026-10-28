import './ui.css';
import { backdropBlur } from './graphics';

export type Screen = {
  element: HTMLElement;
  update(): void;
  escape(): void;
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
    escape: () => ui.back(),
    destroy: () => controller.abort(),
  };
};

export const query = <T extends Element = HTMLElement>(
  element: ParentNode,
  selector: string,
) => element.querySelector<T>(selector)!;

const root =
  document.querySelector<HTMLElement>('.hud') || document.createElement('div');

root.className = 'hud ui-surface';

const updateBackdropBlur = () =>
  root.style.setProperty(
    '--ui-backdrop-filter',
    backdropBlur ? 'blur(4px)' : 'none',
  );

updateBackdropBlur();
window.addEventListener('ui-graphics', updateBackdropBlur);

if (!root.isConnected) document.body.append(root);

const notification =
  root.querySelector<HTMLElement>('.ui-notification') ||
  document.createElement('div');

notification.className =
  'ui-notification ui-surface ui-card text-center uppercase';
notification.setAttribute('role', 'status');
notification.hidden = true;
root.append(notification);

export const updateNotification = (message: string) => {
  if (notification.textContent !== message) notification.textContent = message;
  notification.hidden = !message;
};

export const ui = (() => {
  const element = root;

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

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') element.classList.remove('ui-arrow-navigation');

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
      focused?.closest('nav, [data-bindings], [data-action-group]') ||
      screen.querySelector('nav') ||
      screen;

    const buttons = Array.from(
      group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter((button) => button.getClientRects().length);
    const index = buttons.indexOf(focused);

    if (!buttons.length) return;
    event.preventDefault();
    element.classList.add('ui-arrow-navigation');
    const next =
      index < 0
        ? direction > 0
          ? 0
          : -1
        : (index + direction) % buttons.length;

    buttons.at(next)?.focus();
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
