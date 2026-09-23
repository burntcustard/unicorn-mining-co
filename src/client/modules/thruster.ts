import { Thruster } from '../../shared/modules/thruster';
import { giveRender } from '../give-render';
import { flare } from '../flare';
import './module';

giveRender({
  Type: Thruster,
  render({ segment, parent }) {
    if (segment.activationProgress > 0) {
      parent({ segment, points: flare(segment.flareSize)(segment) });
    }
  },
});
