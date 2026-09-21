import { Corral } from './stations/corral';

export const createStation = (
  properties: ConstructorParameters<typeof Corral>[0],
) => new Corral(properties);
