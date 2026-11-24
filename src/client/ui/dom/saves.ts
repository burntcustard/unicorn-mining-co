import html from './saves.html?raw';
import { createScreen, query, ui } from './ui';
import { playerIdStorageKey, verifyIdentity } from './identity';

export const createSaves = () => {
  const screen = createScreen(html);
  const playerIdInput = query<HTMLInputElement>(
    screen.element,
    '[data-private-id]',
  );

  playerIdInput.value = localStorage.getItem(playerIdStorageKey) || '';
  const saveStatus = query(screen.element, '[data-save-status]');
  const importStatus = query(screen.element, '[data-import-status]');
  const reveal = query<HTMLButtonElement>(screen.element, '[data-reveal]');
  const copy = query<HTMLButtonElement>(screen.element, '[data-copy]');
  const clear = query<HTMLButtonElement>(screen.element, '[data-clear]');
  const clearDialog = query<HTMLDialogElement>(
    screen.element,
    '[data-clear-dialog]',
  );

  reveal.disabled = copy.disabled = clear.disabled = !playerIdInput.value;

  if (!playerIdInput.value) {
    saveStatus.textContent =
      'Connecting to create a pilot, or import an existing private ID.';
  }

  const setVisible = (visible: boolean) => {
    playerIdInput.setAttribute('type', visible ? 'text' : 'password');
    reveal.children[0].setAttribute('aria-hidden', String(visible));
    reveal.children[1].setAttribute('aria-hidden', String(!visible));
    reveal.setAttribute('aria-pressed', String(visible));
  };

  reveal.addEventListener(
    'ui-press',
    () => {
      setVisible(playerIdInput.getAttribute('type') === 'password');
    },
    { signal: screen.signal },
  );

  copy.addEventListener(
    'ui-press',
    async () => {
      try {
        await navigator.clipboard.writeText(playerIdInput.value);
        saveStatus.textContent = 'Private ID copied.';
      } catch {
        setVisible(true);
        playerIdInput.select();
        saveStatus.textContent =
          'Copy is unavailable. Select and copy your private ID manually.';
      }
    },
    { signal: screen.signal },
  );

  clear.addEventListener('ui-press', () => clearDialog.showModal(), {
    signal: screen.signal,
  });

  clearDialog.querySelectorAll('button').forEach((button) => {
    button.addEventListener('ui-press', () => clearDialog.close(button.value), {
      signal: screen.signal,
    });
  });

  clearDialog.addEventListener(
    'close',
    () => {
      if (clearDialog.returnValue !== 'confirm') return;
      clearDialog.returnValue = '';

      try {
        localStorage.removeItem(playerIdStorageKey);
        localStorage.removeItem('unicorn-preview');
        location.reload();
      } catch {
        saveStatus.textContent =
          'Unable to clear the save. Storage is unavailable.';
      }
    },
    { signal: screen.signal },
  );

  query(screen.element, '[data-back]').addEventListener('ui-press', ui.back, {
    signal: screen.signal,
  });

  const input = query<HTMLInputElement>(screen.element, '[data-import-id]');
  const verify = query<HTMLButtonElement>(screen.element, '[data-verify]');
  const dialog = query<HTMLDialogElement>(
    screen.element,
    '[data-import-dialog]',
  );
  const form = query<HTMLFormElement>(screen.element, '[data-import]');
  let verifiedPlayerId = '';

  verify.addEventListener('ui-press', () => form.requestSubmit(), {
    signal: screen.signal,
  });

  form.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      if (verify.disabled) return;
      verifiedPlayerId = '';
      verify.disabled = true;
      input.readOnly = true;
      importStatus.textContent = 'Verifying with the server…';
      const candidate = input.value.trim().toLowerCase();

      try {
        const identity = await verifyIdentity(candidate, screen.signal);

        if (screen.signal.aborted) return;
        verifiedPlayerId = candidate;
        query(screen.element, '[data-preview]').textContent =
          `${identity[0]} · ${identity[2][0]} · ${identity[1]}$`;
        importStatus.textContent =
          'Identity verified. Confirm to switch pilots.';
        dialog.showModal();
      } catch (error) {
        if (!screen.signal.aborted) {
          importStatus.textContent =
            error instanceof Error ? error.message : 'Verification failed.';
        }
      } finally {
        verify.disabled = false;
        input.readOnly = false;
      }
    },
    { signal: screen.signal },
  );

  dialog.querySelectorAll('button').forEach((button) => {
    button.addEventListener('ui-press', () => dialog.close(button.value), {
      signal: screen.signal,
    });
  });

  dialog.addEventListener(
    'close',
    () => {
      if (dialog.returnValue === 'confirm' && verifiedPlayerId) {
        try {
          localStorage.setItem(playerIdStorageKey, verifiedPlayerId);
          location.reload();
        } catch {
          importStatus.textContent =
            'Storage is unavailable. Your identity was not changed.';
        }
      } else {
        importStatus.textContent =
          'Import canceled. Your identity is unchanged.';
      }

      verifiedPlayerId = '';
      dialog.returnValue = '';
    },
    { signal: screen.signal },
  );

  return screen;
};
