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
      local: Vector;
      rotation: number;
    }[];
  }
>();

export const presentation = ({ asteroid }: { asteroid: Asteroid }) => {
  const sections = asteroid.sections || [
    { outline: outlineOf(asteroid), contents: asteroid.contents },
  ];
  const key = JSON.stringify([
    outlineOf(asteroid),
    sections.map(({ outline, contents }) => ({ outline, contents })),
  ]);
  let state = cache.get(asteroid);
  if (!state || state.key !== key) {
    state = {
      key,
      path: shapePath(outlineOf(asteroid)),
      buried:
        sections.flatMap((section) =>
          section.contents.map((resource, index) => ({
            item: createRenderedItem({ add: false, resource }),
            local: centerOf(section.outline),
            rotation: (asteroid.id + section.outline.length + index) % 6,
          })),
        ) || [],
    };
    cache.set(asteroid, state);
  }
  asteroid.parts = asteroid.sections;
  asteroid.renderContents = state.buried.map(({ item, local, rotation }) => {
    const cosine = Math.cos(asteroid.rotation),
      sine = Math.sin(asteroid.rotation);
    item.position.set(
      asteroid.position.add(
        Vector(
          local.x * cosine - local.y * sine,
          local.x * sine + local.y * cosine,
        ),
      ),
    );
    item.rotation = rotation + asteroid.rotation;
    return item;
  });
  return state;
};
