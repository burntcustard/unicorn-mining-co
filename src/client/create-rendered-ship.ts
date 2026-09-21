import { Mustang } from '../shared/craft/ships/mustang';
import { decorateGameObject } from './game-object';
import './craft/ship';

export const createRenderedShip = (
  properties: ConstructorParameters<typeof Mustang>[0],
) => decorateGameObject({ sprite: new Mustang(properties) });
