import { objectLineWidth, shapePath } from '../../drawing';
import { forget, game } from '../../game';
import { itemTypes } from '../../items';
import { Item as RenderedItem } from '../../item';
import { outlineOf, type Asteroid } from '../../shared/simulation/asteroid';
import { colors } from '../../colors';
import { Vector, type Vector as VectorValue } from '../../vector';
import { type WorldObject } from '../../types';

type AsteroidRendering = Asteroid &
  WorldObject & {
    fill: string;
    networked: number;
    parts?: Asteroid['sections'];
    renderContents: RenderedItem[];
    scenery: number;
    stroke: string;
    zIndex: number;
  };

const centerOf = (outline: number[][]) => {
  let area = 0;
  let x = 0;
  let y = 0;

  outline.forEach(([atX, atY], index) => {
    const [nextX, nextY] = outline[(index + 1) % outline.length];
    const cross = atX * nextY - nextX * atY;

    area += cross;
    x += (atX + nextX) * cross;
    y += (atY + nextY) * cross;
  });
  return Vector(x / (area * 3), y / (area * 3));
};

/**
 * Add Canvas-only presentation to the exact asteroid instance simulated by
 * the shared client world. No gameplay state is copied or reconstructed here.
 */
export const renderAsteroid = ({
  asteroid,
}: {
  asteroid: Asteroid;
}): AsteroidRendering => {
  const rendered = asteroid as AsteroidRendering;
  const fill = asteroid.resource === 1 ? `${colors.purple[1]}9` : '#222';
  const stroke = asteroid.resource === 1 ? colors.violet[2] : colors.white[2];
  let shapeKey = '';
  let contentsKey = '';
  let path = shapePath(outlineOf(asteroid));
  let buried: {
    item: RenderedItem;
    local: VectorValue;
    rotation: number;
  }[] = [];
  const syncRendering = () => {
    const outline = outlineOf(asteroid);
    const nextShapeKey = JSON.stringify(outline);
    const nextContentsKey = JSON.stringify(
      asteroid.sections?.map(({ contents, outline }) => ({
        contents,
        outline,
      })),
    );

    if (shapeKey !== nextShapeKey) {
      shapeKey = nextShapeKey;
      path = shapePath(outline);
    }
    if (contentsKey === nextContentsKey) return;
    contentsKey = nextContentsKey;
    buried =
      asteroid.sections?.flatMap((section) =>
        section.contents.map((resource, index) => {
          const item = new RenderedItem({ itemData: itemTypes[resource] });

          item.remove();
          return {
            item,
            local: centerOf(section.outline),
            rotation: (asteroid.id + section.outline.length + index) % 6,
          };
        }),
      ) || [];
    rendered.renderContents = buried.map(({ item }) => item);
    rendered.parts = asteroid.sections;
  };

  syncRendering();

  Object.assign(rendered, {
    fill,
    networked: 1,
    parts: asteroid.sections,
    renderContents: buried.map(({ item }) => item),
    scenery: 1,
    stroke,
    zIndex: -2,
  });
  rendered.hitboxes = () => [rendered];
  rendered.remove = () => forget(game.sprites, rendered);
  rendered.render = () => {
    const { ctx } = game;

    syncRendering();
    buried.forEach(({ item, local, rotation }) => {
      const cosine = Math.cos(rendered.rotation);
      const sine = Math.sin(rendered.rotation);

      item.position.set(
        rendered.position.add(
          Vector(
            local.x * cosine - local.y * sine,
            local.x * sine + local.y * cosine,
          ),
        ),
      );
      item.rotation = rotation + rendered.rotation;
    });
    ctx.save();
    ctx.translate(rendered.position.x, rendered.position.y);
    ctx.rotate(rendered.rotation);
    ctx.lineJoin = 'round';
    ctx.lineWidth = objectLineWidth;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.fill(path);
    ctx.stroke(path);
    ctx.restore();
  };
  game.sprites.push(rendered);
  return rendered;
};
