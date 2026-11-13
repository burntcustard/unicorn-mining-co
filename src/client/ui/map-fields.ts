import { generateFieldCell } from '../simulation/region-generation';
import { generateSector } from '../simulation/sector-generation';
import { regionGeneration } from '../../specs/region-generation';
import { type MapMarker } from '../protocol/network';
import * as Vec from '../utilities/vector';

/**
 * Generate and cache field outlines synchronously as the viewport moves.
 */
export const createMapFields = ({
  worldSeed,
  sectorName,
}: {
  worldSeed: number;
  sectorName: string;
}) => {
  const sector = generateSector({ worldSeed, name: sectorName });
  const size = regionGeneration.features[0].size;
  const cache = new Map<string, MapMarker[]>();
  let previousBounds = '';
  let visible: MapMarker[] = [];

  return (center: Vec.Value, range: number) => {
    // The viewport clip extends slightly beyond the nominal range and field
    // circles can overlap it even when their centers are outside the map.
    const reach =
      range * (298 / 296) +
      regionGeneration.fieldRadius +
      regionGeneration.fieldRadiusRange +
      200;
    const minX = Math.floor((center.x - reach) / size);
    const maxX = Math.floor((center.x + reach) / size);
    const minY = Math.floor((center.y - reach) / size);
    const maxY = Math.floor((center.y + reach) / size);
    const bounds = `${minX},${minY},${maxX},${maxY}`;

    if (bounds === previousBounds) return visible;
    previousBounds = bounds;
    visible = [];

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        let fields = cache.get(key);

        if (!fields) {
          const field = generateFieldCell({
            worldSeed,
            sector,
            cell: Vec.create(x, y),
          });

          fields = field
            ? [
                {
                  kind: 'field',
                  id: field.id,
                  position: field.position,
                  radius: field.radius,
                  name: '',
                  definitionId: '',
                  color: '',
                },
              ]
            : [];

          if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
          cache.set(key, fields);
        }

        visible.push(...fields);
      }
    }

    return visible;
  };
};
