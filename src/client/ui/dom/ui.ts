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

const nextMenuTarget = <T extends HTMLElement>(
  {
    group,
    direction,
    filter,
  }: {
    group: ParentNode;
    direction: number;
    filter?: (control: T) => boolean;
  },
  selector: string,
) => {
  const controls = [...group.querySelectorAll<T>(selector)].filter(
    (control) =>
      control.getClientRects().length && (!filter || filter(control)),
  );
  const index = controls.indexOf(document.activeElement as T);

  if (index < 0) return controls.at(direction > 0 ? 0 : -1);

  return controls[index + direction] || controls[index];
};

export const nextMenuButton = (options: {
  group: ParentNode;
  direction: number;
  filter?: (button: HTMLButtonElement) => boolean;
}) => nextMenuTarget(options, 'button:not(:disabled)');

export const menuRowFilter = (selector: string) => {
  const active = document.activeElement;
  const activeRow = active?.closest(selector);
  const rowButtons = (row: Element | null | undefined) =>
    row
      ? [
          ...row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ].filter((button) => button.getClientRects().length)
      : [];
  const activeButtons = rowButtons(activeRow);
  const activeIndex = activeButtons.indexOf(active as HTMLButtonElement);
  const seen = new Set<Element>();

  return (control: HTMLElement) => {
    const row = control.closest(selector);

    if (!row) return true;

    if (row === activeRow) return control === active;

    const selected = row.querySelector<HTMLElement>(
      '[aria-current="page"]:not(:disabled)',
    );

    if (selected?.getClientRects().length) return control === selected;

    if (activeIndex >= 0) {
      const buttons = rowButtons(row);
      const offset = activeButtons.length - 1 - activeIndex;

      if (buttons.length) {
        return control === buttons[Math.max(0, buttons.length - 1 - offset)];
      }
    }

    if (seen.has(row)) return false;

    seen.add(row);
    return true;
  };
};

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
      control.matches(':disabled, .chat-panel input') ||
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
    const focused = screen.querySelector<HTMLElement>(':focus');
    const vertical = ['ArrowUp', 'ArrowDown'].includes(event.key);

    if (
      focused?.matches('select') &&
      (!CSS.supports('selector(:open)') || focused.matches(':open'))
    ) {
      return;
    }

    if (
      focused &&
      !focused.matches('button') &&
      (!vertical ||
        event.shiftKey ||
        event.isComposing ||
        !focused.matches(
          'input.ui-input, input[type="checkbox"], select.ui-input',
        ))
    ) {
      return;
    }

    const group =
      focused?.closest(
        vertical
          ? 'dialog'
          : 'nav, [data-controls-panel], [data-action-group], dialog',
      ) ||
      (!focused && screen.querySelector('nav')) ||
      screen;

    const target = nextMenuTarget(
      {
        group,
        direction,
        filter: vertical
          ? menuRowFilter('.ui-tabs, [data-action-group]')
          : undefined,
      },
      vertical
        ? 'button:not(:disabled), input.ui-input:not(:disabled), input[type="checkbox"]:not(:disabled), select.ui-input:not(:disabled)'
        : 'button:not(:disabled)',
    );

    if (!target) return;
    event.preventDefault();
    element.classList.add('ui-arrow-navigation');

    focusMenuTarget(target, event.key);
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
