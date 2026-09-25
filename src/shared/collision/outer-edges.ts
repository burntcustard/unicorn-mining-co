import { type Outline } from './types';

/**
 * Mark outside polygon edges and return groups connected by shared edges.
 */
export const outerEdges = (outlines: Outline[]) => {
  // oxlint-disable-next-line typescript/require-array-sort-compare -- Endpoint strings canonicalize an undirected edge.
  const edge = (from: number[], to: number[]) => String([from, to].sort());
  const sides = outlines.map((points) =>
    points.map((from, index) =>
      edge(from, points[(index + 1) % points.length]),
    ),
  );
  const all = sides.flat();
  const left = outlines.map((_, index) => index);
  const groups: number[][] = [];

  outlines.forEach(
    (points, index) =>
      (points.edges = sides[index].map(
        (side) => !all.includes(side, all.indexOf(side) + 1),
      )),
  );

  while (left.length) {
    const group = [left.pop()!];

    for (let at = 0; at < group.length; at++) {
      for (let index = left.length; index--;) {
        if (
          sides[group[at]].some((side) => sides[left[index]].includes(side))
        ) {
          group.push(left.splice(index, 1)[0]);
        }
      }
    }
    groups.push(group);
  }
  return groups;
};
