import * as Vec from '../../shared/vector';
import {
  centerOf,
  shapeOutlineOf,
  shapeOutlinesFrom,
  type Asteroid,
} from '../../shared/simulation/asteroid';
import { rotatePoint } from '../../shared/geometry';
import { type Pose } from '../../shared/types';
import { createRenderedItem } from '../create-rendered-item';
import { shapePath } from '../drawing';

const cache = new WeakMap<
  Asteroid,
  {
    key: string;
    path: Path2D;
    buried: {
      item: ReturnType<typeof createRenderedItem>;
      localPosition: Vec.Value;
      rotation: number;
    }[];
  }
>();

export const presentation = ({
  asteroid,
  pose = asteroid,
}: {
  asteroid: Asteroid;
  pose?: Pose;
}) => {
  const segments = asteroid.segments || [
    { shapeOutline: shapeOutlineOf(asteroid), contents: asteroid.contents },
  ];
  const key = JSON.stringify([
    shapeOutlineOf(asteroid),
    segments.map(({ shapeOutline, contents }) => ({ shapeOutline, contents })),
  ]);
  let state = cache.get(asteroid);

  if (!state || state.key !== key) {
    const path = new Path2D();
    const shapeOutlines = asteroid.segments?.length
      ? shapeOutlinesFrom(asteroid.segments)
      : [shapeOutlineOf(asteroid)];

    shapeOutlines.forEach((shapeOutline) =>
      path.addPath(shapePath(shapeOutline)),
    );
    state = {
      key,
      path,
      buried:
        segments.flatMap((asteroidSegment) =>
          asteroidSegment.contents.map((resource, index) => ({
            item: createRenderedItem({ add: false, resource }),
            localPosition: centerOf(asteroidSegment.shapeOutline),
            rotation:
              (asteroid.id + asteroidSegment.shapeOutline.length + index) % 6,
          })),
        ) || [],
    };
    cache.set(asteroid, state);
  }
  asteroid.renderContents = state.buried.map(
    ({ item, localPosition, rotation }) => {
      Vec.set(
        item.position,
        Vec.add(pose.position, rotatePoint(localPosition, pose.rotation)),
      );
      item.rotation = rotation + pose.rotation;
      return item;
    },
  );
  return state;
};
