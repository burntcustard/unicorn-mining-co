import './ui.css';
import { backdropBlur, hideUi } from './graphics';
import {
  playHoverSound,
  playNavigationSound,
  preloadSound,
  unlockAudio,
} from '../../audio/sound-loader';

declare global {
  interface HTMLElementEventMap {
    'ui-press': CustomEvent<PointerEvent | KeyboardEvent>;
  }
}

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

export const focusMenuTarget = (
  target: HTMLElement | undefined,
  key: string,
) => {
  if (!target || target === document.activeElement) return;

  const play = () => {
    playNavigationSound(key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0);
  };

  // Focus confirms the move before the docked focusin handler renders details.
  target.addEventListener('focus', play, { once: true });
  target.focus();
  target.removeEventListener('focus', play);
};

const root =
  document.querySelector<HTMLElement>('.hud') || document.createElement('div');

root.className = 'hud ui-surface';

const hudElement = document.createElement('div');

hudElement.className = 'hud-overlay';
root.append(hudElement);

if (!root.isConnected) document.body.append(root);

const notification =
  root.querySelector<HTMLElement>('.ui-notification') ||
  document.createElement('div');

notification.className =
  'ui-notification ui-surface ui-card text-center uppercase';
notification.setAttribute('role', 'status');
notification.hidden = true;
root.append(notification);

const updateGraphics = () => {
  hudElement.style.opacity = notification.style.opacity = hideUi ? '0' : '';
  root.style.setProperty(
    '--ui-backdrop-filter',
    backdropBlur ? 'blur(4px)' : 'none',
  );
};

updateGraphics();
window.addEventListener('ui-graphics', updateGraphics);

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

  const press = (event: PointerEvent | KeyboardEvent) => {
    const screen = stack.at(-1)?.element;
    const path = event.composedPath();
    const target = path[0];

    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !screen ||
      !path.includes(screen) ||
      !(target instanceof Element)
    ) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('button');

    if (button?.matches(':disabled, [aria-disabled="true"]')) return;

    if (event instanceof KeyboardEvent) {
      if (!button || event.isComposing || !['Enter', ' '].includes(event.key)) {
        return;
      }

      event.preventDefault();

      if (event.repeat) return;
    } else {
      if (!event.isPrimary || event.button !== 0) return;

      if (button) {
        event.preventDefault();
        const pointerFocus = { preventScroll: true, focusVisible: false };

        button.focus(pointerFocus);
      }
    }

    if (event.isTrusted) {
      void unlockAudio()?.catch(() => {});

      void preloadSound().catch(() => {});
    }

    (button || target).dispatchEvent(
      new CustomEvent('ui-press', { bubbles: true, detail: event }),
    );
  };

  element.addEventListener('pointerdown', press);
  element.addEventListener('keydown', press);

  element.addEventListener('pointerover', (event) => {
    const target = event.composedPath()[0];

    if (
      event.pointerType === 'touch' ||
      event.buttons ||
      !(target instanceof Element)
    ) {
      return;
    }

    const selector = 'button, a[href], input, select, textarea';
    const control = target.closest(selector);
    const related = event.relatedTarget;

    if (
      !control ||
      control.matches(':disabled') ||
      (related instanceof Element && related.closest(selector) === control)
    ) {
      return;
    }

    playHoverSound();
  });

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

    focusMenuTarget(buttons.at(next), event.key);
  });

  return {
    element,
    hudElement,
    push,
    back,
    clear,
    get current() {
      return stack.at(-1);
    },
  };
})();
