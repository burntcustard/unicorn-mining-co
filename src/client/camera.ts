import * as Vec from '../shared/vector';
import { ease } from '../shared/utilities/ease';
import { type GameObject } from '../shared/game-object';

/**
 * The camera is the top left corner of the viewport in world coordinates.
 * Everything in the world is drawn shifted by it, and the HUD is not.
 */
export const camera = Vec.create();

// How much of the viewport the oval the target is kept inside of spans
const deadzone = 0.3;

// How much of the ground it has left to make up the camera still has a second
// from now. Lower catches up harder, and 0 would snap straight to it
const lag = 0.0001;

export const dockDuration = 4;
let dockedTo: GameObject | number | undefined;
let dockEase: ReturnType<typeof ease>;
let dockTo = Vec.create();

export const centerCamera = (
  game: GameState,
  target: Pick<GameObject, 'position'>,
) => {
  Vec.set(
    camera,
    Vec.subtract(target.position, Vec.create(game.width / 2, game.height / 2)),
  );
};

/**
 * Shove the camera along only once its target has left the oval in the middle
 * of the screen, so that the view sits still while the ship pootles about in
 * there. Easing after it rather than snapping means a ship leaving the oval at
 * full pelt overruns it a little and is drawn back, instead of dragging the
 * whole world with it.
 *
 * target: Anything with a place in the world.
 * dt: Seconds since the last update.
 */
export const followTarget = (
  game: GameState,
  target: Pick<GameObject, 'position'> & { dockedTo?: GameObject | number },
  dt: number,
) => {
  if (target.dockedTo) {
    if (target.dockedTo !== dockedTo) {
      dockedTo = target.dockedTo;
      dockTo = Vec.create();
      dockEase = ease({ duration: dockDuration, from: camera, to: dockTo });
    }

    Vec.set(
      dockTo,
      Vec.subtract(
        target.position,
        Vec.create(game.width / 2, game.height / 2),
      ),
    );
    Vec.set(camera, dockEase(dt));
    return;
  }

  dockedTo = 0;
  const halfWidth = (game.width * deadzone) / 2;
  const halfHeight = (game.height * deadzone) / 2;
  const offset = Vec.create(
    target.position.x - camera.x - game.width / 2,
    target.position.y - camera.y - game.height / 2,
  );
  // 1 on the edge of the oval and more than that outside of it
  const out = Math.hypot(offset.x / halfWidth, offset.y / halfHeight);
  const followEase = 1 - lag ** dt;
  const factor = out > 1 ? 1 - 1 / out : 0;

  const step = factor * followEase;

  Vec.addScaled(camera, offset, step, camera);
};

export const renderDeadzone = (game: GameState) => {
  const { ctx } = game;

  ctx.save();
  ctx.scale(game.scale, game.scale);
  ctx.beginPath();
  ctx.ellipse(
    game.width / 2,
    game.height / 2,
    (game.width * deadzone) / 2,
    (game.height * deadzone) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f33';
  ctx.stroke();
  ctx.restore();
};

import { type GameState } from './game';
