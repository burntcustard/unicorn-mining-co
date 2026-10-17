import { type Craft } from '../../objects/craft';
import { shipOutlines } from '../ship-outline';

/**
 * Outline the current hull, horn drill, and thruster flares facing northeast.
 */
export const shipIcon = (ship: Craft) => {
  const outlines = shipOutlines({ ship, rotation: -Math.PI / 4 });

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
