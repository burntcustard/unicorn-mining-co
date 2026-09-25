import { Asteroid } from '../../shared/simulation/asteroid';
import { colors } from '../../shared/colors';
import { game } from '../game';
import { giveRender } from '../give-render';
import { objectLineWidth } from '../drawing';
import { presentation } from './presentation';
import '../game-object';

giveRender({
  Type: Asteroid,
  render({ parent, pose }) {
    const { path } = presentation({ asteroid: this, pose });

    parent({
      pose,
      draw: () => {
        const { ctx } = game;

        ctx.lineJoin = 'round';
        ctx.lineWidth = objectLineWidth;
        ctx.strokeStyle =
          this.resource === 1 ? colors.violet[2] : colors.white[2];
        ctx.fillStyle = this.resource === 1 ? `${colors.purple[1]}9` : '#222';
        ctx.fill(path, 'evenodd');
        ctx.stroke(path);
      },
    });
  },
});
