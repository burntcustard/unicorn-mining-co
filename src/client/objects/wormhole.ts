import { Portal } from './portal';
import { wormholeSpec } from '../../specs/wormhole';

export class Wormhole extends Portal {
  kind = 'wormhole';
  name = 'Wormhole';
  radius = wormholeSpec.radius;
  travelRadius = wormholeSpec.travelRadius;
}
