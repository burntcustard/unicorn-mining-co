/**
 * Points spaced evenly around a circle, ready to be turned into a path.
 *
 * A plain hexagon, a jagged asteroid and a five pointed star are all the same
 * shape with different props: pull every other point in with `radiusEven` for
 * a star, and shove them all about with `variance` for an asteroid.
 *
 * @param {Object} props
 * @param {Number} props.points - How many points, and lines between them.
 * @param {Number} props.radius - How far each odd point sits from the middle.
 * @param {Number} [props.radiusEven] - Same for the even ones, which without
 *   one of its own is however far the odd ones sit.
 * @param {Number} [props.variance] - How far a point may wander in or out of
 *   where it would otherwise sit, as a fraction of its radius.
 * @returns {Number[][]}
 */
export const createPolygon = ({ points, radius, radiusEven = radius, variance = 0 }) => {
  return Array.from({ length: points }, (_, i) => {
    const angle = i / points * Math.PI * 2;
    const wander = 1 + (Math.random() - 0.5) * variance;
    const reach = (i % 2 ? radius : radiusEven) * wander;

    return [Math.cos(angle) * reach, Math.sin(angle) * reach];
  });
};

export const within = (points, { x, y }) => points.reduce((so, [pointX, pointY], i) => {
  const [nextX, nextY] = points[(i + 1) % points.length];
  const crosses = (pointY > y) !== (nextY > y) &&
    x < pointX + (y - pointY) / (nextY - pointY) * (nextX - pointX);

  return crosses ? !so : so;
}, false);
