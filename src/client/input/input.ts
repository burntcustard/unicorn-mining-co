import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../protocol/input';
import {
  defaultKeybindings,
  bindingEntries,
  matchesBinding,
  moduleKeyControls,
  updateMovement,
  type KeyBinding,
} from './keybindings';
import { unlockAudio } from '../audio/sound-loader';

const callbacks = new Map<string, (event: KeyboardEvent) => void>();
const pressed = new Set<string>();
const actionCallbacks = new Map<KeyBinding, (event: KeyboardEvent) => void>();
let menuInput = false;

let notifyCargoRelease = (_active: boolean) => {};

export const cargoRelease = (active: boolean) => notifyCargoRelease(active);

let releaseInput = () => {};

export const setMenuInput = (visible: boolean) => {
  if (visible && !menuInput) releaseInput();
  menuInput = visible;
};

export const playerInput = emptyPlayerInput();

export const bindKeys = (
  key: string,
  callback: (event: KeyboardEvent) => void,
) => callbacks.set(key.toLowerCase(), callback);

export const bindAction = (
  binding: KeyBinding,
  callback: (event: KeyboardEvent) => void,
) => actionCallbacks.set(binding, callback);

export const initKeys = ({
  onChange = () => {},
  onActivity = () => {},
  onKeyDown,
}: {
  onChange?: (input: PlayerInput) => void;
  onActivity?: () => void;
  onKeyDown?: (event: KeyboardEvent) => boolean;
} = {}) => {
  const controller = new AbortController();
  const { signal } = controller;
  const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const consumedKeys = new Set<string>();

  const notify = (previous: PlayerInput) => {
    updateMovement(pressed, playerInput);

    if (!sameInput(previous, playerInput)) onChange({ ...playerInput });
  };

  notifyCargoRelease = (active) => {
    const previous = { ...playerInput };

    playerInput.cargoRelease = active;
    notify(previous);
  };

  const keyDown = (event: KeyboardEvent) => {
    if (
      menuInput ||
      event.defaultPrevented ||
      (event.composedPath()[0] as HTMLElement)?.closest?.(
        ':is(input, select, textarea, button, dialog, [contenteditable])',
      )
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 'tab') {
      event.preventDefault();
      return;
    }

    if (key.startsWith('arrow') || key === ' ') event.preventDefault();

    if (event.repeat || pressed.has(key)) return;

    if (onKeyDown?.(event)) {
      unlockAudio();
      return;
    }

    const previous = { ...playerInput };

    pressed.add(key);

    const bindings = bindingEntries.filter(([, binding]) =>
      matchesBinding(binding, key),
    );
    const toggled =
      bindings.length === 1
        ? moduleKeyControls.find(
            ({ binding }) =>
              binding === bindings[0][1] && binding.mode === 'toggle',
          )
        : undefined;

    if (toggled) {
      consumedKeys.add(key);
      toggled.writeInput(playerInput, !toggled.readInput(playerInput));
    }

    const holds = moduleKeyControls.filter(
      ({ binding }) => binding.mode === 'hold' && matchesBinding(binding, key),
    );

    if (holds.length) {
      const activate = () => {
        holdTimers.delete(key);
        // Completing a Hold cancels this key's pending Toggle actions.
        consumedKeys.add(key);
        holds.forEach(({ writeInput }) => writeInput(playerInput, true));
      };

      if (bindings.length > 1) {
        holdTimers.set(
          key,
          setTimeout(() => {
            const previous = { ...playerInput };

            activate();
            notify(previous);
          }, 500),
        );
      } else {
        activate();
      }
    }

    notify(previous);
    // Send controls before first-use audio setup can block this gesture.
    // Keep unlocking synchronous so browser autoplay policies still allow it.
    unlockAudio();
    callbacks.get(key)?.(event);

    actionCallbacks.forEach((callback, binding) => {
      if (
        (binding.mode !== 'toggle' || binding === toggled?.binding) &&
        matchesBinding(binding, key)
      ) {
        callback(event);
      }
    });
  };

  const keyUp = (event: KeyboardEvent) => {
    if (menuInput) return;
    const key = event.key.toLowerCase();

    if (!pressed.delete(key)) return;
    const previous = { ...playerInput };
    const consumed = consumedKeys.delete(key);

    clearTimeout(holdTimers.get(key));
    holdTimers.delete(key);

    moduleKeyControls.forEach(({ binding, readInput, writeInput }) => {
      if (binding.mode === 'toggle') {
        if (!consumed && matchesBinding(binding, key)) {
          writeInput(playerInput, !readInput(playerInput));
        }
      } else if (!binding.keys.some((key) => pressed.has(key.toLowerCase()))) {
        writeInput(playerInput, false);
      }
    });

    notify(previous);

    if (!consumed) {
      actionCallbacks.forEach((callback, binding) => {
        if (binding.mode === 'toggle' && matchesBinding(binding, key)) {
          callback(event);
        }
      });
    }
  };

  const blur = () => {
    const previous = { ...playerInput };

    holdTimers.forEach(clearTimeout);
    holdTimers.clear();
    pressed.clear();
    consumedKeys.clear();

    moduleKeyControls.forEach(({ binding, writeInput }) => {
      if (
        binding.mode === 'hold' ||
        binding === defaultKeybindings.cargoRelease
      ) {
        writeInput(playerInput, false);
      }
    });

    notify(previous);
  };

  releaseInput = () => {
    holdTimers.forEach(clearTimeout);
    holdTimers.clear();
    pressed.clear();
    consumedKeys.clear();

    Object.assign(playerInput, emptyPlayerInput(), {
      fire: false,
      cargoRelease: false,
      plasmaActive: false,
      autogunActive: false,
      laserActive: false,
    });

    onChange({ ...playerInput });
  };

  window.addEventListener('keydown', keyDown, { signal });
  window.addEventListener('keyup', keyUp, { signal });
  window.addEventListener('blur', blur, { signal });
  const activityEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel'];

  activityEvents.forEach((type) =>
    window.addEventListener(type, onActivity, {
      capture: true,
      passive: true,
      signal,
    }),
  );

  return () => {
    controller.abort();
    blur();
  };
};
