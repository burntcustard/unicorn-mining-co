import html from './main-menu.html?raw';
import { createScreen, query, ui } from './ui';
import { verifyIdentity, type Identity } from './identity';
import { version } from '../../../../package.json';

export const createMainMenu = ({
  running,
  identity,
  onPlay,
  onNavigate,
}: {
  running: boolean;
  identity?: Identity;
  onPlay: () => Promise<void>;
  onNavigate: (destination: string) => void;
}) => {
  const screen = createScreen(html);
  const play = query<HTMLButtonElement>(screen.element, '[data-action="play"]');

  query(screen.element, '.ui-version').textContent = `v${version}`;
  query(play, 'span').textContent = running ? 'RESUME' : 'PLAY';
  query(screen.element, '[data-resume-hint]').hidden = !running;
  query(screen.element, '[data-action="saves"]').hidden = running;
  query(screen.element, '[data-action="disconnect"]').hidden = !running;

  if (running) screen.element.className += ' is-running';

  screen.element.addEventListener(
    'click',
    async (event) => {
      const button = (event.composedPath()[0] as Element).closest('button');

      if (!button) return;
      const destination = button.getAttribute('data-action');

      if (destination === 'disconnect') {
        location.reload();
        return;
      }

      if (destination !== 'play') {
        onNavigate(destination);
        return;
      }

      play.disabled = true;

      try {
        await onPlay();
      } catch {
        play.disabled = false;
      }
    },
    { signal: screen.signal },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        running &&
        ui.current === screen
      ) {
        event.preventDefault();
        play.click();
      }
    },
    { capture: true, signal: screen.signal },
  );

  const privateId = localStorage.getItem('playerToken');

  let disposePreview = () => {};

  const showPreview = async (identity?: Identity) => {
    const { default: preview } = await import('./ship-preview');

    if (screen.signal.aborted) return;
    disposePreview();
    query(screen.element, '.ui-preview').hidden = false;
    disposePreview = preview.mountPreview(
      query(screen.element, 'canvas'),
      identity?.[2],
    );

    if (!identity) return;
    query(screen.element, '.ui-pilot').hidden = false;
    query(screen.element, '[data-pilot]').textContent = identity[0];

    try {
      localStorage.setItem(
        'unicorn-preview',
        JSON.stringify([privateId, identity]),
      );
    } catch {
      /* The current preview works without storage. */
    }
  };

  const loadPreview = async () => {
    if (identity || !privateId) {
      return showPreview(identity);
    }

    try {
      const saved = JSON.parse(
        localStorage.getItem('unicorn-preview') || 'null',
      );

      if (saved?.[0] === privateId) await showPreview(saved[1]);
    } catch {
      /* Ignore an old or invalid preview and fetch the saved ship. */
    }

    if (screen.signal.aborted) return;
    await showPreview(await verifyIdentity(privateId, screen.signal));
  };

  void loadPreview().catch(() => {
    /* Keep any cached preview if refreshing fails. */
  });

  const destroy = screen.destroy;

  screen.destroy = () => {
    destroy();
    disposePreview();
  };

  return screen;
};
