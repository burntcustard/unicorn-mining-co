import { Craft } from '../shared/craft/craft';
import { game } from './game';
import { GameObject } from '../shared/game-object';
import { giveRender } from './give-render';

giveRender({
  Type: GameObject,
  render(this: GameObject, { draw, pose = this }) {
    const { ctx } = game;
    ctx.save();
    ctx.translate(pose.position.x, pose.position.y);
    ctx.rotate(pose.rotation);
    draw?.();
    ctx.restore();
  },
});

export const decorateGameObject = <T extends GameObject>({
  sprite,
}: {
  sprite: T;
}): T => {
  sprite.collections = [
    game.sprites,
    ...(sprite instanceof Craft ? [game.crafts] : []),
  ];
  sprite.add();
  return sprite;
};
