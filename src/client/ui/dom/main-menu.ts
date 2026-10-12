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
  onNavigate: (destination: string) => Promise<void>;
}) => {
  const screen = createScreen(html);
  const play = query<HTMLButtonElement>(screen.element, '[data-action="play"]');

  query(screen.element, '.ui-version').textContent = `v${version}`;
  query(play, 'span').textContent = running ? 'Resume' : 'Play';
  query(screen.element, '[data-resume-hint]').hidden = !running;
  query(screen.element, '[data-action="saves"]').hidden = running;
  query(screen.element, '[data-action="disconnect"]').hidden = !running;

  screen.element.classList.toggle('ui-running', running);

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

      button.disabled = true;

      if (destination === 'play') cancelPreview();

      try {
        if (destination === 'play') await onPlay();
        else await onNavigate(destination);
      } catch {
        /* Leave the menu available if a chunk cannot load. */
      } finally {
        button.disabled = false;

        if (destination === 'play') schedulePreview();
      }
    },
    { signal: screen.signal },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' &&
        !event.repeat &&
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

  let shipPreview: ReturnType<
    (typeof import('./ship-preview'))['default']['createShipPreview']
  >;

  const showPreview = async (identity?: Identity) => {
    const { default: preview } = await import('./ship-preview');

    if (screen.signal.aborted) return;
    query(screen.element, '.ui-preview').hidden = false;
    shipPreview ||= preview.createShipPreview(query(screen.element, 'canvas'));
    shipPreview.update(identity?.[2]);

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

  let previewFrame = 0;
  let previewTimer = 0;
  let previewRequested = false;
  let previewLoaded = false;

  const cancelPreview = () => {
    cancelAnimationFrame(previewFrame);
    clearTimeout(previewTimer);
  };

  const schedulePreview = () => {
    cancelPreview();

    if (
      previewRequested ||
      previewLoaded ||
      screen.signal.aborted ||
      screen.element.hidden ||
      play.disabled
    ) {
      return;
    }

    previewFrame = requestAnimationFrame(() => {
      previewTimer = window.setTimeout(() => {
        previewRequested = true;

        void loadPreview()
          .then(() => {
            previewLoaded = true;
          })
          .catch(() => {
            /* Keep any cached preview; a later navigation can retry. */
          })
          .finally(() => {
            previewRequested = false;
          });
      });
    });
  };

  window.addEventListener('ui-navigation', schedulePreview, {
    signal: screen.signal,
  });

  const destroy = screen.destroy;

  screen.destroy = () => {
    destroy();
    cancelPreview();
    shipPreview?.destroy();
  };

  return screen;
};
