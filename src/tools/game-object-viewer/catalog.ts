import { type ShipDefinition } from '../../definitions/ships/types';
import { type StationDefinition } from '../../definitions/stations/types';
import { type ItemDefinition } from '../../definitions/items/types';
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

const definitions = import.meta.glob<Record<string, unknown>>(
  [
    '../../definitions/{ships,stations,items}/*.ts',
    '!../../definitions/**/{index,types,defaults}.ts',
  ],
  { eager: true },
);

export type PreviewDefinition = {
  key: string;
  label: string;
  source: string;
  create: () => GameObject;
};

const discover = <T>({
  folder,
  create,
}: {
  folder: string;
  create: (definition: T) => GameObject;
}): PreviewDefinition[] =>
  Object.entries(definitions)
    .filter(([path]) => path.includes(`/${folder}/`))
    .flatMap(([path, exports]) =>
      Object.entries(exports)
        .filter(
          ([, definition]) =>
            definition &&
            typeof definition === 'object' &&
            ('hullSegments' in definition || 'resource' in definition),
        )
        .map(([name, definition]) => ({
          key: `${path}#${name}`,
          label:
            name === 'default' ? path.split('/').at(-1)!.slice(0, -3) : name,
          source: path.replace('../../', 'src/'),
          create: () => create(definition as T),
        })),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

export const catalog = {
  ship: discover({
    folder: 'ships',
    create: (definition: ShipDefinition) => new Ship({ definition }),
  }),
  station: discover({
    folder: 'stations',
    create: (definition: StationDefinition) => new Station({ definition }),
  }),
  item: discover({
    folder: 'items',
    create: (definition: ItemDefinition) => new Item(definition),
  }),
  // Asteroids have procedural variants rather than individual definition files.
  asteroid: [
    { label: 'Mixed rock', resource: 4 },
    { label: 'Spiky amethyst', resource: 1 },
    { label: 'Gold-rich rock', resource: 2 },
  ].map(({ label, resource }): PreviewDefinition => ({
    key: `asteroid:${resource}`,
    label,
    source: 'src/definitions/region-generation.ts',
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
      .map(([type, Type]) => ({ type, Type, label: Type.label as string }));

    if (!options.length) return [];
    const defaultOption = options.find(({ Type }) => Type === mount.fits[0])!;
    const { x, y } = mount.localPosition;
    const hull = craft.hullSegments.indexOf(mount.hull.module);
    const slot = mount.hull.mounts.indexOf(mount);

    return [
      {
        mount,
        options,
        defaultOption,
        key: `${defaultOption.type}:${hull}:${slot}`,
        label: `Mount ${index + 1} (${x}, ${y})`,
      },
    ];
  });
