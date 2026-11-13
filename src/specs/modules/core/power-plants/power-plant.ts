import { renderingLayers } from '../../../rendering-layers';
import type { ModuleSpec } from '../../types';

const powerPlantDefaults = {
  icon: './power-plant.svg',
  behavior: 'powerPlant',
  health: 80,
  power: 0,
  powerActivated: 0,
  zIndex: renderingLayers.modulesAboveShipHull,
  model: [],
} satisfies Partial<ModuleSpec>;

const powerPlantDescription = ({
  size,
  rating,
}: {
  size: 1 | 2 | 3 | 4;
  rating: 'a' | 'h' | 'v' | 'l';
}) => {
  const sizes = {
    1: 'a small ship with a few fitted modules',
    2: 'a medium ship with a modest loadout',
    3: 'a large ship with a substantial loadout',
    4: 'an extra-large ship with a demanding loadout',
  };

  const ratings = {
    a: [
      'advanced',
      'It offers the most power for its size and a good balance of output and weight, at a premium price.',
    ],
    h: [
      'heavy-duty',
      'It is heavier and cheaper than an advanced plant, with slightly less output.',
    ],
    v: ['value', 'It is the most affordable rating, with modest output.'],
    l: [
      'lightweight',
      'It is the lightest rating, with more output than a value plant but less than advanced and heavy-duty models.',
    ],
  };

  const [name, tradeoff] = ratings[rating];

  return `This size ${size} ${name} power plant suits ${sizes[size]}. ${tradeoff}`;
};

export const powerPlant1A = {
  ...powerPlantDefaults,
  name: 'Power Plant 1a',
  description: powerPlantDescription({ size: 1, rating: 'a' }),
  weight: 1,
  price: 1500,
  powerGenerated: 3.6,
  powerCapacity: 32,
  model: [],
} satisfies ModuleSpec;

export const powerPlant1H = {
  ...powerPlantDefaults,
  name: 'Power Plant 1h',
  description: powerPlantDescription({ size: 1, rating: 'h' }),
  weight: 1.6,
  price: 550,
  powerGenerated: 3.3,
  powerCapacity: 32,
  model: [],
} satisfies ModuleSpec;

export const powerPlant1V = {
  ...powerPlantDefaults,
  name: 'Power Plant 1v',
  description: powerPlantDescription({ size: 1, rating: 'v' }),
  weight: 1.1,
  price: 375,
  powerGenerated: 2.9,
  powerCapacity: 32,
  model: [],
} satisfies ModuleSpec;

export const powerPlant1L = {
  ...powerPlantDefaults,
  name: 'Power Plant 1l',
  description: powerPlantDescription({ size: 1, rating: 'l' }),
  weight: 0.7,
  price: 950,
  powerGenerated: 3.1,
  powerCapacity: 32,
  model: [],
} satisfies ModuleSpec;

export const powerPlant2A = {
  ...powerPlantDefaults,
  name: 'Power Plant 2a',
  description: powerPlantDescription({ size: 2, rating: 'a' }),
  weight: 2,
  price: 3000,
  powerGenerated: 7.2,
  powerCapacity: 64,
  model: [],
} satisfies ModuleSpec;

export const powerPlant2H = {
  ...powerPlantDefaults,
  name: 'Power Plant 2h',
  description: powerPlantDescription({ size: 2, rating: 'h' }),
  weight: 3.2,
  price: 1125,
  powerGenerated: 6.7,
  powerCapacity: 64,
  model: [],
} satisfies ModuleSpec;

export const powerPlant2V = {
  ...powerPlantDefaults,
  name: 'Power Plant 2v',
  description: powerPlantDescription({ size: 2, rating: 'v' }),
  weight: 2.3,
  price: 750,
  powerGenerated: 5.8,
  powerCapacity: 64,
  model: [],
} satisfies ModuleSpec;

export const powerPlant2L = {
  ...powerPlantDefaults,
  name: 'Power Plant 2l',
  description: powerPlantDescription({ size: 2, rating: 'l' }),
  weight: 1.3,
  price: 1875,
  powerGenerated: 6.3,
  powerCapacity: 64,
  model: [],
} satisfies ModuleSpec;

export const powerPlant3A = {
  ...powerPlantDefaults,
  name: 'Power Plant 3a',
  description: powerPlantDescription({ size: 3, rating: 'a' }),
  weight: 3,
  price: 6000,
  powerGenerated: 14.5,
  powerCapacity: 128,
  model: [],
} satisfies ModuleSpec;

export const powerPlant3H = {
  ...powerPlantDefaults,
  name: 'Power Plant 3h',
  description: powerPlantDescription({ size: 3, rating: 'h' }),
  weight: 4.8,
  price: 2250,
  powerGenerated: 13.3,
  powerCapacity: 128,
  model: [],
} satisfies ModuleSpec;

export const powerPlant3V = {
  ...powerPlantDefaults,
  name: 'Power Plant 3v',
  description: powerPlantDescription({ size: 3, rating: 'v' }),
  weight: 3.4,
  price: 1500,
  powerGenerated: 11.6,
  powerCapacity: 128,
  model: [],
} satisfies ModuleSpec;

export const powerPlant3L = {
  ...powerPlantDefaults,
  name: 'Power Plant 3l',
  description: powerPlantDescription({ size: 3, rating: 'l' }),
  weight: 2.0,
  price: 3750,
  powerGenerated: 12.5,
  powerCapacity: 128,
  model: [],
} satisfies ModuleSpec;

export const powerPlant4A = {
  ...powerPlantDefaults,
  name: 'Power Plant 4a',
  description: powerPlantDescription({ size: 4, rating: 'a' }),
  weight: 4,
  price: 12000,
  powerGenerated: 29.0,
  powerCapacity: 256,
  model: [],
} satisfies ModuleSpec;

export const powerPlant4H = {
  ...powerPlantDefaults,
  name: 'Power Plant 4h',
  description: powerPlantDescription({ size: 4, rating: 'h' }),
  weight: 6.4,
  price: 4500,
  powerGenerated: 26.7,
  powerCapacity: 256,
  model: [],
} satisfies ModuleSpec;

export const powerPlant4V = {
  ...powerPlantDefaults,
  name: 'Power Plant 4v',
  description: powerPlantDescription({ size: 4, rating: 'v' }),
  weight: 4.6,
  price: 3000,
  powerGenerated: 23.2,
  powerCapacity: 256,
  model: [],
} satisfies ModuleSpec;

export const powerPlant4L = {
  ...powerPlantDefaults,
  name: 'Power Plant 4l',
  description: powerPlantDescription({ size: 4, rating: 'l' }),
  weight: 2.6,
  price: 7500,
  powerGenerated: 25.1,
  powerCapacity: 256,
  model: [],
} satisfies ModuleSpec;
