import { ui } from './ui/dom/ui';
import { createMainMenu } from './ui/dom/main-menu';
import { graphics, restoreGraphics } from './ui/dom/graphics';

window.addEventListener('ui-graphics', restoreGraphics);

type Gameplay = (typeof import('./gameplay'))['default'];
let gameplay: Gameplay;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;

const renderSky = () => {
  if (gameplay) return;
  canvas.width = innerWidth * graphics[3];
  canvas.height = innerHeight * graphics[3];

  const background = (
    globalThis as typeof globalThis & {
      background: {
        renderBackground: (
          canvas: HTMLCanvasElement,
          ctx: CanvasRenderingContext2D,
          scale: number,
        ) => void;
      };
    }
  ).background;

  background.renderBackground(
    canvas,
    canvas.getContext('2d')!,
    (Math.min(innerWidth, innerHeight) / 1080) * graphics[3],
  );
};

window.addEventListener('resize', renderSky);
window.addEventListener('ui-graphics', renderSky);

const navigate = async (destination: string) => {
  const menu = ui.current;
  const { default: screens } = await import('./ui/dom/menu-screens');

  if (ui.current !== menu) return;

  if (destination === 'settings') ui.push(screens.createSettings());

  if (destination === 'credits') ui.push(screens.createCredits());

  if (destination === 'saves') ui.push(screens.createSaves());
};

const showMainMenu = () =>
  ui.push(
    createMainMenu({
      running: Boolean(gameplay),
      identity: gameplay?.identityPreview(),
      onNavigate: navigate,
      onPlay: async () => {
        gameplay ||= (await import('./gameplay')).default;
        await gameplay.ready;
        ui.clear();
      },
    }),
  );

window.addEventListener('keydown', (event) => {
  // A held key repeats; only a fresh press should take another step.
  if (
    event.key !== 'Escape' ||
    event.repeat ||
    document.querySelector('dialog[open]')
  ) {
    return;
  }

  event.preventDefault();

  if (ui.current) {
    ui.current.escape();
  } else if (gameplay) {
    showMainMenu();
  }
});

showMainMenu();
renderSky();
