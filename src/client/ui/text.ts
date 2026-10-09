import { withAlpha } from '../utilities/color';
import characters from 'virtual:font-characters';

export interface RenderTextProps {
  game: any; // Supplies the UI canvas context and scale.
  text: string; // The glyphs to draw.
  x: number; // The text's horizontal anchor.
  y: number; // The text's vertical anchor.
  size?: number; // The glyph scale, defaulting to 0.6.
  align?: number; // Horizontal alignment: -1 left, 0 centre, 1 right.
  color?: string; // The glyph colour, defaulting to '#fff'.
}

export function renderText({
  game,
  text,
  x,
  y,
  size = 0.6,
  align = -1,
  color = '#fff',
}: RenderTextProps) {
  const { ctx, uiScale } = game;
  const glyphs = Array.from(text, (character) =>
    character === ' ' || characters.includes(character) ? character : '□',
  );
  const displayText = glyphs.join('');

  ctx.save();
  ctx.scale(uiScale, uiScale);
  ctx.translate(x - (align + 1) * glyphs.length * 6.5 * size, y);
  ctx.scale(size, size);
  ctx.font = '16px Gemetric';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha({ color: '#000', alpha: 0.5 });
  ctx.fillStyle = color;
  ctx.strokeText(displayText, 0, 13);
  ctx.fillText(displayText, 0, 13);
  ctx.restore();
}
