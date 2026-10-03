import * as Vec from '../../../src/client/utilities/vector';
import {
  generateRegion,
  generateStations,
  fieldMessage,
} from '../../../src/client/simulation/region-generation';

const regions = [0, 25, 4294967295].flatMap((worldSeed) =>
  [-12, -2, 0, 1, 9].flatMap((x) =>
    [-8, 0, 7].map((y) => {
      const region = Vec.create(x, y);

      return {
        worldSeed,
        region,
        description: generateRegion({ worldSeed, region }),
      };
    }),
  ),
);
const from = Vec.create(-50000, -50000);
const to = Vec.create(50000, 50000);
const stations = [0, 25, 4294967295].map((worldSeed) => ({
  worldSeed,
  from,
  to,
  stations: generateStations({ worldSeed, from, to }),
}));
const messages = [Vec.create(1000000, -2000000), Vec.create(-0, 3)].map(
  (position) => ({
    position,
    resource: 1,
    message: fieldMessage({ position, resource: 1 }),
  }),
);

export default { regions, stations, messages };
