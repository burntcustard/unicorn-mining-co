import { type GameObject } from '../objects/game-object';
import { colors } from '../../specs/colors';

/**
 * Draw the same landmark symbol at map and target-panel sizes.
 */
export const renderLandmarkIcon = ({
  ctx,
  object,
  radius,
}: {
  ctx: CanvasRenderingContext2D;
  object: GameObject;
  radius: number;
}) => {
  if (!['station', 'jumpGate', 'wormhole'].includes(object.kind!)) return false;
  const sides =
    object.kind === 'station'
      ? object.definitionId === 'corral-6'
        ? 6
        : 5
      : object.kind === 'jumpGate'
        ? 8
        : 4;

  ctx.strokeStyle =
    object.kind === 'station'
      ? colors.green[2]
      : object.kind === 'jumpGate'
        ? '#fff'
        : '#eef';
  ctx.beginPath();

  for (let i = 0; i < sides; i++) {
    const angle = (i * Math.PI * 2) / sides - Math.PI / 2;

    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }

  ctx.closePath();
  ctx.stroke();

  if (object.kind === 'jumpGate') {
    [
      colors.red,
      colors.orange,
      colors.yellow,
      colors.green,
      colors.cyan,
      colors.violet,
    ].forEach((shades, index) => {
      ctx.beginPath();
      ctx.strokeStyle = shades[2];
      ctx.arc(
        0,
        0,
        radius * 0.45,
        (index * Math.PI) / 3,
        ((index + 1) * Math.PI) / 3,
      );
      ctx.stroke();
    });
  }

  return true;
};
