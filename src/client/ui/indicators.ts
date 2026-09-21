import { Vector, type Vector as VectorValue } from '../../shared/vector';
import { camera } from '../camera';
import { outline } from '../outline';
import { renderText } from '../text';

interface IndicatorTarget {
  position: VectorValue;
  radius: number;
}

export const renderIndicators = (
  game: GameState,
  targets: IndicatorTarget[],
  color: string,
  range: number,
) => {
  const { ctx, uiScale, uiWidth, uiHeight } = game;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'bevel';

  targets.forEach((target) => {
    const offset = Vector(
      target.position.x - camera.x - game.width / 2,
      target.position.y - camera.y - game.height / 2,
    );

    const dist =
      Math.max(
        Math.abs(offset.x) - game.width / 2,
        Math.abs(offset.y) - game.height / 2,
      ) - target.radius;

    if (dist > range || dist < 0) return;

    const indicatorsize = 10 - (9 * dist) / range;

    const edge = offset.scale(
      Math.min(
        (uiWidth / 2 - 20) / Math.abs(offset.x),
        (uiHeight / 2 - 20) / Math.abs(offset.y),
      ),
    );

    ctx.save();
    ctx.scale(uiScale, uiScale);
    ctx.translate(uiWidth / 2 + edge.x, uiHeight / 2 + edge.y);
    ctx.rotate(Math.atan2(offset.y, offset.x));
    const path = new Path2D();

    path.moveTo(indicatorsize, 0);
    path.lineTo(0, -indicatorsize);
    path.lineTo(0, indicatorsize);
    path.closePath();
    outline({ ctx, path });
    ctx.stroke(path);
    ctx.restore();

    renderText({
      game,
      text: `${Math.round(dist)}J`,
      x: uiWidth / 2 + edge.x,
      y:
        uiHeight / 2 +
        edge.y -
        (indicatorsize + 10) * Math.sign(offset.y || -1),
      size: 0.6,
      align: 0,
      color,
    });
  });

  ctx.restore();
};

import { type GameState } from '../game';
