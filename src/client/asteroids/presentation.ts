import {
  centerOf,
  outlineOf,
  type Asteroid,
} from '../../shared/simulation/asteroid';
import { Vector } from '../../shared/vector';
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
    state = {
      key,
      path: shapePath(outlineOf(asteroid)),
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
      const cosine = Math.cos(pose.rotation),
        sine = Math.sin(pose.rotation);

      item.position.set(
        pose.position.add(
          Vector(
            localPosition.x * cosine - localPosition.y * sine,
            localPosition.x * sine + localPosition.y * cosine,
          ),
        ),
      );
      item.rotation = rotation + pose.rotation;
      return item;
    },
  );
  return state;
};
