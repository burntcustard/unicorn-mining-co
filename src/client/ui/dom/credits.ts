import html from './credits.html?raw';
import { createScreen, query, ui } from './ui';

export const createCredits = () => {
  const screen = createScreen(html);

  query(screen.element, '[data-back]').addEventListener('ui-press', ui.back, {
    signal: screen.signal,
  });

  return screen;
};
