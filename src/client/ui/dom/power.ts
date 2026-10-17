import { moduleCategories } from '../../../specs/modules/categories';
import { type Module } from '../../objects/modules/module';

/**
 * Shared stacked consumption segments for outfitting and flight instruments.
 */
export const powerParts = ({
  entries,
  scale,
}: {
  entries: { module: Module; value: number; highlighted?: boolean }[];
  scale: number;
}) =>
  entries
    .map(
      ({ module, value, highlighted = true }) =>
        `<span class="ui-power-part transition-width" title="${module.name.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}: ${value.toFixed(1)} MW" style="--ui-color:${moduleCategories.get(module.category)?.color || '#eef'};width:${(value / Math.max(scale, 1)) * 100}%;opacity:${highlighted ? 1 : 0.25}"></span>`,
    )
    .join('');
