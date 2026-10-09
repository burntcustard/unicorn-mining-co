import { ui } from './ui/dom/ui';
import { createMainMenu } from './ui/dom/main-menu';
import { createSettings } from './ui/dom/settings';
import { createCredits } from './ui/dom/credits';
import { createSaves } from './ui/dom/saves';
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

const navigate = (destination: string) => {
  if (destination === 'settings') ui.push(createSettings());

  if (destination === 'credits') ui.push(createCredits());

  if (destination === 'saves') ui.push(createSaves());
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

const menuButton = document.createElement('button');

menuButton.className = 'ui-choice ui-game-menu';
menuButton.textContent = 'MENU';
menuButton.hidden = true;
document.body.append(menuButton);
menuButton.addEventListener('click', showMainMenu);

window.addEventListener('ui-navigation', () => {
  menuButton.hidden = !gameplay || Boolean(ui.current);
});

window.addEventListener('ui-main-menu', showMainMenu);

window.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !ui.current &&
    gameplay
  ) {
    event.preventDefault();
    showMainMenu();
  }
});

showMainMenu();
renderSky();
