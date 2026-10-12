import html from './profile.html?raw';
import { createScreen, query, ui } from './ui';

export const createProfile = ({
  onSave,
}: {
  onSave: (displayName: string) => Promise<void>;
}) => {
  const screen = createScreen(html);
  const input = query<HTMLInputElement>(screen.element, 'input');
  const status = query(screen.element, '.ui-status');
  const buttons = screen.element.querySelectorAll<HTMLButtonElement>('button');
  let saving = false;

  const validate = () => {
    const length = Array.from(input.value).length;

    input.setCustomValidity(length > 16 ? 'Use at most 16 characters.' : '');
    return length > 0 && length <= 16;
  };

  input.addEventListener('input', validate, { signal: screen.signal });
  screen.update = () => input.focus();

  screen.escape = () => {
    if (!saving) ui.back();
  };

  query(screen.element, '[data-back]').addEventListener(
    'click',
    screen.escape,
    { signal: screen.signal },
  );

  query(screen.element, 'form').addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      if (saving || !validate()) return;
      saving = true;
      input.readOnly = true;

      buttons.forEach((button) => {
        button.disabled = true;
      });

      status.textContent = 'Saving profile…';

      try {
        await onSave(input.value);
      } catch (error) {
        if (!screen.signal.aborted) {
          status.textContent =
            error instanceof Error
              ? error.message
              : 'Unable to save. Please try again.';
        }
      } finally {
        saving = false;
        input.readOnly = false;

        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    },
    { signal: screen.signal },
  );

  return screen;
};
