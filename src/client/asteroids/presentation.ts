import {
  centerOf,
  outlineOf,
  outlinesFrom,
  type Asteroid,
} from '../../shared/simulation/asteroid';
import { Vector } from '../../shared/vector';
import { rotatePoint } from '../../shared/geometry';
import { createRenderedItem } from '../create-rendered-item';
import { shapePath } from '../drawing';

const cache = new WeakMap<
  Asteroid,
  {
    key: string;
    path: Path2D;
    buried: {
      item: ReturnType<typeof createRenderedItem>;
      localPosition: Vector;
      rotation: number;
    }[];
  }
>();

export const presentation = ({
  asteroid,
  pose = asteroid,
}: {
  asteroid: Asteroid;
  pose?: Pick<Asteroid, 'position' | 'rotation'>;
}) => {
  const segments = asteroid.segments || [
    { outline: outlineOf(asteroid), contents: asteroid.contents },
  ];
  const key = JSON.stringify([
    outlineOf(asteroid),
    segments.map(({ outline, contents }) => ({ outline, contents })),
  ]);
  let state = cache.get(asteroid);

  if (!state || state.key !== key) {
    const path = new Path2D();
    const outlines = asteroid.segments?.length
      ? outlinesFrom(asteroid.segments)
      : [outlineOf(asteroid)];

    outlines.forEach((outline) => path.addPath(shapePath(outline)));
    state = {
      key,
      path,
      buried:
        segments.flatMap((asteroidSegment) =>
          asteroidSegment.contents.map((resource, index) => ({
            item: createRenderedItem({ add: false, resource }),
            localPosition: centerOf(asteroidSegment.outline),
            rotation:
              (asteroid.id + asteroidSegment.outline.length + index) % 6,
          })),
        ) || [],
    };
    cache.set(asteroid, state);
  }
  asteroid.renderContents = state.buried.map(
    ({ item, localPosition, rotation }) => {
      item.position.set(
        pose.position.add(rotatePoint(localPosition, pose.rotation)),
      );
      item.rotation = rotation + pose.rotation;
      return item;
    },
  );
  return state;
};
