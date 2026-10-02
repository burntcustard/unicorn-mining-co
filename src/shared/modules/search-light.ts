import { Module } from './module';
import { moduleSpecifications } from '../specification/modules';

// SearchLight
// A lamp slung under the nose that throws a cone of light out ahead of the
// ship. It sits below the hull so that what it falls on is whatever the ship
// is flying over, with the hull itself sat dark on top of it.

// Where the lens sits ahead of its mount, and how far the cone carries
const specification = moduleSpecifications.searchLight;
const lens = specification.lens;
const reach = specification.reach;
const far = lens + reach;
const mouth = specification.mouth;
const spread = specification.spread;
const corner = specification.corner;

export class SearchLight extends Module {
  static beam = specification.beam;
  static disablePhysics = specification.disablePhysics;
  static health = specification.health;
  static lens = lens;
  static mouth = mouth;
  static label = specification.label;
  static model: any[] = [
    {
      wreckage: {
        // The lamp housing is half the length of a cargo-hatch door.
        points: [
          [lens, -1.5],
          [lens + 8, -1.5],
          [lens + 8, 1.5],
          [lens, 1.5],
        ],
        fillShade: 2,
      },
      points: ({ activationProgress }: { activationProgress: number }) =>
        activationProgress
          ? [
              [lens, -mouth],
              [far - corner, -spread],
              [far, corner - spread],
              [far, spread - corner],
              [far - corner, spread],
              [lens, mouth],
            ]
          : [],
    },
  ];
  static price = specification.price;
  static reach = reach;
  static spread = spread;
  static zIndex = specification.zIndex;
}
