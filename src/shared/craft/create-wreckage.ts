import { Craft } from './craft';
import { Vector } from '../vector';
import { type WreckagePart } from './wreckage-part';

export const createWreckage = ({
  properties,
  parts,
}: {
  properties: ConstructorParameters<typeof Craft>[0];
  parts: WreckagePart[];
}) =>
  new Craft(properties, {
    hullSegments: parts.map((part) => ({
      points: part.outline,
      radius: () => part.radius,
      localPosition: Vector(part.offset.x, part.offset.y),
      health: part.health,
      fillShade: part.fillShade,
      outline: part.stroke,
    })),
  });
