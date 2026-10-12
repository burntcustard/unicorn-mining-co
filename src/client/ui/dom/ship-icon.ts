import { type Craft } from '../../objects/craft';
import { HornDrill } from '../../objects/modules/horn-drill';
import { rotatePoint, rotatePoints } from '../../utilities/geometry';

/**
 * Outline the current hull, horn drill, and thruster flares facing northeast.
 */
export const shipIcon = (ship: Craft) => {
  const angle = -Math.PI / 4;

  const outlines = ship.segments
    .filter(
      (segment) =>
        (segment.hull ||
          segment.module instanceof HornDrill ||
          segment.flareSize) &&
        !(segment.health < 1),
    )
    .map((segment) => {
      const size = segment.flareSize;
      const points = size
        ? [
            [0, -size],
            [-size * 2.5, 0],
            [0, size],
          ]
        : typeof segment.points === 'function'
          ? segment.points(segment)
          : segment.points;

      return rotatePoints(
        points || [],
        angle,
        rotatePoint(segment.localPosition, angle),
      );
    });

  const points = outlines.flat();

  if (!points.length) return '';
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  const left = Math.min(...xs) - 4,
    top = Math.min(...ys) - 4;
  const width = Math.max(...xs) + 4 - left,
    height = Math.max(...ys) + 4 - top;
  const path = outlines
    .filter((points) => points.length)
    .map((points) => `M${points.map((point) => point.join(',')).join('L')}Z`)
    .join('');

  return `<svg viewBox="${left} ${top} ${width} ${height}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>`;
};
