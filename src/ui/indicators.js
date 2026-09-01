import { Vector } from '../vector';
import { camera } from '../camera';
import { outline } from '../outline';
import { renderText } from '../text';

/**
 * @param {Object} game
 * @param {Array} targets
 * @param {String} color
 * @param {Number} range
 */
export const renderIndicators = (game, targets, color, range) => {
  const { ctx, uiScale, uiWidth, uiHeight } = game;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'bevel';
  ctx.strokeStyle = color;

  targets.forEach((target) => {
    const offset = Vector(
      target.x - camera.x - game.width / 2,
      target.y - camera.y - game.height / 2,
    );

    const dist = Math.max(
      Math.abs(offset.x) - game.width / 2,
      Math.abs(offset.y) - game.height / 2,
    ) - target.radius;

    if (dist > range || dist < 0) return;

    const indicatorsize = 10 - 9 * dist / range;

    const edge = offset.scale(Math.min(
      (uiWidth / 2 - 20) / Math.abs(offset.x),
      (uiHeight / 2 - 20) / Math.abs(offset.y),
    ));

    ctx.save();
    ctx.scale(uiScale, uiScale);
    ctx.translate(uiWidth / 2 + edge.x, uiHeight / 2 + edge.y);
    ctx.rotate(Math.atan2(offset.y, offset.x));
    const path = new Path2D();

    path.moveTo(indicatorsize, 0);
    path.lineTo(0, -indicatorsize);
    path.lineTo(0, indicatorsize);
    path.closePath();
    outline(ctx, path);
    ctx.stroke(path);
    ctx.restore();

    renderText(game, `${Math.round(dist)}m`, uiWidth / 2 + edge.x,
      uiHeight / 2 + edge.y - (indicatorsize + 10) * Math.sign(offset.y || -1), 0.5, color, 1);
  });

  ctx.restore();
};
