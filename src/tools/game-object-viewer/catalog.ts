import { type ShipSpec } from '../../specs/ships/types';
import { type StationSpec } from '../../specs/stations/types';
import { type ItemSpec } from '../../specs/items/types';
import { Ship } from '../../client/objects/ship';
import { Station } from '../../client/objects/station';
import { Item } from '../../client/objects/item';
import { Asteroid } from '../../client/objects/asteroid';
import { Craft } from '../../client/objects/craft';
import { moduleTypesById } from '../../client/objects/modules';
import { makeAsteroid } from '../../client/simulation/region-generation';
import { createRandom } from '../../client/utilities/seeded-random';
import * as Vec from '../../client/utilities/vector';
import { type GameObject } from '../../client/objects/game-object';

const specs = import.meta.glob<Record<string, unknown>>(
  [
    '../../specs/{ships,stations,items}/*.ts',
    '!../../specs/**/{index,types,defaults}.ts',
  ],
  { eager: true },
);

export type PreviewSpec = {
  key: string;
  name: string;
  source: string;
  create: () => GameObject;
};

const discover = <T>({
  folder,
  create,
}: {
  folder: string;
  create: (spec: T) => GameObject;
}): PreviewSpec[] =>
  Object.entries(specs)
    .filter(([path]) => path.includes(`/${folder}/`))
    .flatMap(([path, exports]) =>
      Object.entries(exports)
        .filter(
          ([, spec]) =>
            spec &&
            typeof spec === 'object' &&
            ('hullSegments' in spec || 'resource' in spec),
        )
        .map(([name, spec]) => ({
          key: `${path}#${name}`,
          name: (spec as { name: string }).name,
          source: path.replace('../../', 'src/'),
          create: () => create(spec as T),
        })),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'en-US'));

export const catalog = {
  ship: discover({
    folder: 'ships',
    create: (spec: ShipSpec) => new Ship({ spec }),
  }),
  station: discover({
    folder: 'stations',
    create: (spec: StationSpec) => new Station({ spec }),
  }),
  item: discover({
    folder: 'items',
    create: (spec: ItemSpec) => new Item(spec),
  }),
  // Asteroids have procedural variants rather than individual spec files.
  asteroid: [
    { name: 'Mixed rock', resource: 4 },
    { name: 'Spiky amethyst', resource: 1 },
    { name: 'Gold-rich rock', resource: 2 },
  ].map(({ name, resource }): PreviewSpec => ({
    key: `asteroid:${resource}`,
    name,
    source: 'src/specs/region-generation.ts',
    create: () => {
      const description = makeAsteroid({
        seed: 1,
        index: 0,
        random: createRandom(1),
        region: Vec.create(),
        resource,
      });

      return new Asteroid({
        ...description,
        position: Vec.create(),
        rotation: 0,
        spin: 0,
        health: description.radius * 2,
        maxHealth: description.radius * 2,
      });
    },
  })),
};

export type ObjectType = keyof typeof catalog;

/**
 * Identify a mount by its authored hull/mount slot, so module replacements
 * and edits to geometry and coordinates preserve its controls.
 */
export const previewMounts = (craft: Craft) =>
  craft.mounts.flatMap((mount, index) => {
    const options = [...moduleTypesById]
      .filter(([, Type]) => mount.fits.includes(Type))
      .map(([type, Type]) => ({ type, Type, name: Type.name }));

    if (!options.length) return [];
    const defaultOption = options.find(({ Type }) => Type === mount.fits[0])!;
    const hull = craft.hullSegments.indexOf(mount.hull.module);
    const slot = mount.hull.mounts.indexOf(mount);

    return [
      {
        mount,
        options,
        defaultOption,
        key: `${defaultOption.type}:${hull}:${slot}`,
        label: `Mount ${index + 1}`,
      },
    ];
  });
