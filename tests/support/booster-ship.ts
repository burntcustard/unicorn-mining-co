import { createPlayerShip } from '../../src/client/objects/create-ship';
import { moduleTypesById } from '../../src/client/objects/modules';
import { createWorld } from '../../src/client/simulation/world';
import { shipSpecsById, type ShipId } from '../../src/specs/ships';
import type { ShipSpec } from '../../src/specs/ships/types';

const modules = [
  'thrusterSingleSm',
  'thrustBooster',
  'thrustBooster',
  'powerPlant1E',
] as const;
const shipType = 'boosterFixture' as ShipId;

export const boosterShipSpec: ShipSpec = {
  name: 'Booster fixture',
  price: 100,
  fuelCapacity: 100,
  cargoSpace: 8,
  drag: 100,
  hullMass: 1000,
  angularThrust: 1000,
  radius: 60,
  turnRate: 3,
  initialLoadout: modules.map((module, mount) => ({ module, mount })),
  hullSegments: modules.map((module, index) => ({
    core: index === 0,
    health: 100,
    points: [
      [index * 12 - 6, -6],
      [index * 12 + 6, -6],
      [index * 12 + 6, 6],
      [index * 12 - 6, 6],
    ],
    mounts: [
      [
        {
          x: index * 12,
          y: 0,
          fits:
            index === 0
              ? [...moduleTypesById]
                  .filter(([, Type]) => Type.forwardThrust)
                  .map(([id]) => id)
              : module === 'powerPlant1E'
                ? [...moduleTypesById]
                    .filter(([, Type]) => Type.behavior === 'powerPlant')
                    .map(([id]) => id)
                : [module],
        },
      ],
    ],
  })),
};

shipSpecsById.set(shipType, boosterShipSpec);

export const createBoosterShip = ({
  world = createWorld(),
  playerNumber,
}: {
  world?: ReturnType<typeof createWorld>;
  playerNumber?: number;
} = {}) => createPlayerShip(world, { shipType, playerNumber });
