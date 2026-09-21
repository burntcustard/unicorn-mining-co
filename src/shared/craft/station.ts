import { Craft } from './craft';
import { type Vector } from '../vector';

export class Station extends Craft {
  kind = 'station';
  holds(child: { position: Vector }) {
    return child.position.distanceTo(this.position) <= this.localMovementRadius;
  }
}
