import html from './saves.html?raw';
import { createScreen, query, ui } from './ui';
import { verifyIdentity } from './identity';

export const createSaves = () => {
  const screen = createScreen(html);
  const privateId = query<HTMLInputElement>(
    screen.element,
    '[data-private-id]',
  );

  privateId.value = localStorage.getItem('playerToken') || '';
  const status = query(screen.element, '.ui-status');
  const reveal = query<HTMLButtonElement>(screen.element, '[data-reveal]');
  const copy = query<HTMLButtonElement>(screen.element, '[data-copy]');
  const clear = query<HTMLButtonElement>(screen.element, '[data-clear]');

  reveal.disabled = copy.disabled = clear.disabled = !privateId.value;

  if (!privateId.value) {
    status.textContent =
      'Play to create a pilot, or import an existing private ID.';
  }

  reveal.addEventListener(
    'click',
    () => {
      const visible = privateId.getAttribute('type') === 'password';

      privateId.setAttribute('type', visible ? 'text' : 'password');
      reveal.textContent = visible ? 'HIDE' : 'REVEAL';
      reveal.setAttribute('aria-pressed', String(visible));
    },
    { signal: screen.signal },
  );

  copy.addEventListener(
    'click',
    async () => {
      try {
        await navigator.clipboard.writeText(privateId.value);
        status.textContent = 'Private ID copied.';
      } catch {
        privateId.setAttribute('type', 'text');
        privateId.select();
        reveal.textContent = 'HIDE';
        reveal.setAttribute('aria-pressed', 'true');
        status.textContent =
          'Copy is unavailable. Select and copy your private ID manually.';
      }
    },
    { signal: screen.signal },
  );

  clear.addEventListener(
    'click',
    () => {
      try {
        localStorage.removeItem('playerToken');
        localStorage.removeItem('unicorn-preview');
        location.reload();
      } catch {
        status.textContent =
          'Unable to clear the save. Storage is unavailable.';
      }
    },
    { signal: screen.signal },
  );

  query(screen.element, '[data-back]').addEventListener('click', ui.back, {
    signal: screen.signal,
  });

  const input = query<HTMLInputElement>(screen.element, '[data-import-id]');
  const verify = query<HTMLButtonElement>(screen.element, '[data-verify]');
  const dialog = query<HTMLDialogElement>(screen.element, 'dialog');
  let verifiedId = '';

  query(screen.element, '[data-import]').addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      if (verify.disabled) return;
      verifiedId = '';
      verify.disabled = true;
      input.readOnly = true;
      status.textContent = 'Verifying with the server…';
      const candidate = input.value.trim().toLowerCase();

      try {
        const identity = await verifyIdentity(candidate, screen.signal);

        if (screen.signal.aborted) return;
        verifiedId = candidate;
        query(screen.element, '[data-preview]').textContent =
          `${identity[0]} · ${identity[2][0]} · $${identity[1]}`;
        status.textContent = 'Identity verified. Confirm to switch pilots.';
        dialog.showModal();
      } catch (error) {
        if (!screen.signal.aborted) {
          status.textContent =
            error instanceof Error ? error.message : 'Verification failed.';
        }
      } finally {
        verify.disabled = false;
        input.readOnly = false;
      }
    },
    { signal: screen.signal },
  );

  dialog.addEventListener(
    'close',
    () => {
      if (dialog.returnValue === 'confirm' && verifiedId) {
        try {
          localStorage.setItem('playerToken', verifiedId);
          location.reload();
        } catch {
          status.textContent =
            'Storage is unavailable. Your identity was not changed.';
        }
      } else {
        status.textContent = 'Import cancelled. Your identity is unchanged.';
      }

      verifiedId = '';
      dialog.returnValue = '';
    },
    { signal: screen.signal },
  );

  return screen;
};
