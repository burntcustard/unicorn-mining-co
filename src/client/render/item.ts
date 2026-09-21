import {
  circlePath,
  itemLineWidth,
  linesPath,
  shapePath,
  sparklePath,
} from '../../drawing';
import { colors } from '../../colors';
import { forget, game } from '../../game';
import { itemTypes } from '../../items';
import { type Item } from '../../shared/simulation/item';
import { type WorldObject } from '../../types';

type ItemRendering = Item & WorldObject & { networked: number };
type ItemRenderingData = {
  fillAlpha?: number;
  glint?: boolean;
  lines?: number[][][];
  points?: number[][];
  rainbow?: boolean;
  shades: readonly string[];
};

/** Add Canvas presentation to the shared item without copying its state. */
export const renderItem = ({ item }: { item: Item }): ItemRendering => {
  const rendered = item as ItemRendering;
  const data = itemTypes[item.resource] as ItemRenderingData;
  const path = data.points ? shapePath(data.points) : circlePath(item.radius);
  const lines = data.lines && linesPath(data.lines);
  const glint = data.glint && sparklePath(item.radius * 0.3);

  rendered.networked = 1;
  rendered.remove = () => forget(game.sprites, rendered);
  rendered.render = () => {
    const { ctx } = game;

    ctx.save();
    ctx.translate(rendered.position.x, rendered.position.y);
    ctx.rotate(rendered.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = itemLineWidth;
    ctx.strokeStyle = data.shades[2];
    ctx.fillStyle = data.shades[1] + (data.fillAlpha || '');
    if (data.rainbow) {
      const rainbow = ctx.createLinearGradient(-item.radius, 0, item.radius, 0);

      rainbow.addColorStop(0, colors.violet[2]);
      rainbow.addColorStop(0.5, colors.yellow[2]);
      rainbow.addColorStop(1, colors.cyan[2]);
      ctx.fillStyle = rainbow;
    }
    ctx.fill(path);
    ctx.stroke(path);
    if (lines) ctx.stroke(lines);
    if (glint) {
      ctx.translate(item.radius * 0.3, item.radius * -0.28);
      ctx.rotate(-rendered.rotation);
      ctx.fillStyle = colors.white[2];
      ctx.fill(glint);
    }
    ctx.restore();
  };
  game.sprites.push(rendered);
  return rendered;
};
