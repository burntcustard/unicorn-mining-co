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
 * @param {Number} [props.variance] - How far a point may wander in towards
 *   the middle from where it would otherwise sit, as a fraction of its radius.
 * @param {Function} [props.random] - Where the wander comes from, so a shape
 *   every player has to agree on can be cut from a seeded source.
 * @returns {Number[][]}
 */
export const createPolygon = ({
  points,
  radius,
  radiusEven = radius,
  variance = 0,
  random = Math.random,
}: {
  points: number;
  radius: number;
  radiusEven?: number;
  variance?: number;
  random?: () => number;
}) =>
  Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    // Only ever inwards, so no point reaches past the radius the rest of the
    // world bounds this shape by.
    const wander = 1 - random() * variance;
    const reach = (i % 2 ? radius : radiusEven) * wander;

    return [Math.cos(angle) * reach, Math.sin(angle) * reach];
  });

export const radiusOf = (points: number[][]) =>
  Math.max(...points.map(([x, y]) => Math.hypot(x, y)));
