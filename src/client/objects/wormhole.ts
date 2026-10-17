import { Passage } from './passage';
import { wormholeSpec } from '../../specs/wormhole';

export class Wormhole extends Passage {
  kind = 'wormhole';
  name = 'Wormhole';
  radius = wormholeSpec.radius;
  travelRadius = wormholeSpec.travelRadius;
}
