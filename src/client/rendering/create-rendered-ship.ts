import { Ship } from '../objects/ship';
import { decorateGameObject } from './game-object';
import './craft/ship';

export const createRenderedShip = (
  properties: ConstructorParameters<typeof Ship>[0],
) => decorateGameObject({ sprite: new Ship(properties) });
