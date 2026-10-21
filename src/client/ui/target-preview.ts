import { game } from '../game';
import { Craft } from '../objects/craft';
import { type GameObject } from '../objects/game-object';
import * as Vec from '../utilities/vector';
import { renderingLayers } from '../../specs/rendering-layers';
import { renderLandmarkIcon } from './landmark-icon';

/**
 * Render landmarks as map symbols and other targets with their actual artwork.
 */
export const renderTargetPreview = (
  canvas: HTMLCanvasElement,
  target: GameObject,
) => {
  canvas.width = 128;
  canvas.height = 144;
  canvas.style.width = canvas.style.height = '100%';
  const ctx = canvas.getContext('2d')!;

  ctx.translate(64, 72);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';

  if (renderLandmarkIcon({ ctx, object: target, radius: 48 })) return;

  const scale = 48 / Math.max(target.radius, 1);
  const previousContext = game.ctx;
  const previousScale = game.scale;
  const pose = { position: Vec.create(), rotation: -Math.PI / 4 };

  ctx.scale(scale, scale);

  try {
    game.ctx = ctx;
    game.scale = scale;

    if (target instanceof Craft) {
      Object.values(renderingLayers).forEach((zIndex) =>
        target.render({ zIndex, pose }),
      );
    } else {
      target.render({ ctx, pose });
    }
  } finally {
    game.ctx = previousContext;
    game.scale = previousScale;
  }
};
