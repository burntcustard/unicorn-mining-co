import { Ship } from '../../objects/ship';
import { moduleTypes, moduleTypesById } from '../../objects/modules';
import { mustang, type ShipId } from '../../../specs/ships';
import { paintColors, colors } from '../../../specs/colors';
import { renderingLayers } from '../../../specs/rendering-layers';
import { game } from '../../game';
import { type ShipPreview } from './identity';

const mountPreview = (canvas: HTMLCanvasElement, data?: ShipPreview) => {
  const ship = new Ship({
    shipType: data?.[0] as ShipId,
    shades: (data && paintColors[data[1]]) || colors.white,
    rotation: -0.4,
  });

  if (data) {
    ship.hullHealth = data[2];

    data[3].forEach(([id, mount, paint, health]) => {
      const Type = moduleTypes[id];

      if (!Type || !ship.mounts[mount]) return;
      ship.fit(
        new Type({ shades: paintColors[paint] || colors.violet }),
        ship.mounts[mount],
      );

      if (health !== null) ship.mounts[mount].health = health;
    });
  } else {
    mustang.initialLoadout.forEach(({ module, mount }) => {
      const Type = moduleTypesById.get(module)!;

      ship.fit(new Type(), ship.mounts[mount]);
    });
  }

  const draw = () => {
    const box = canvas.getBoundingClientRect();

    if (!box.width || !box.height) return;
    const ratio = Math.min(devicePixelRatio, 2);

    canvas.width = box.width * ratio;
    canvas.height = box.height * ratio;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.min(canvas.width, canvas.height) / 105;
    const previousContext = game.ctx,
      previousScale = game.scale;

    try {
      game.ctx = ctx;
      game.scale = scale;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      Object.values(renderingLayers).forEach((zIndex) =>
        ship.render({ zIndex }),
      );
    } finally {
      game.ctx = previousContext;
      game.scale = previousScale;
    }
  };

  const observer = new ResizeObserver(draw);

  observer.observe(canvas);
  return () => observer.unobserve(canvas);
};

export default { mountPreview };
