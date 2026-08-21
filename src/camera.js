/**
 * The camera is the top left corner of the viewport in world coordinates.
 * Everything in the world is drawn shifted by it, and the HUD is not.
 */
export const camera = { x: 0, y: 0 };

// How much of the viewport the oval the target is kept inside of spans
const deadzone = 0.4;

// How much of the ground it has left to make up the camera still has a second
// from now. Lower catches up harder, and 0 would snap straight to it
const lag = 0.0001;

export const centerCamera = (game, target) => {
  camera.x = target.x - game.width / 2;
  camera.y = target.y - game.height / 2;
};

/**
 * Shove the camera along only once its target has left the oval in the middle
 * of the screen, so that the view sits still while the ship pootles about in
 * there. Easing after it rather than snapping means a ship leaving the oval at
 * full pelt overruns it a little and is drawn back, instead of dragging the
 * whole world with it.
 *
 * @param {Object} game
 * @param {Object} target - Anything with a place in the world.
 * @param {Number} dt - Seconds since the last update.
 */
export const followTarget = (game, target, dt) => {
  const halfWidth = game.width * deadzone / 2;
  const halfHeight = game.height * deadzone / 2;
  const x = target.x - camera.x - game.width / 2;
  const y = target.y - camera.y - game.height / 2;
  // 1 on the edge of the oval and more than that outside of it
  const out = Math.sqrt((x / halfWidth) ** 2 + (y / halfHeight) ** 2);

  if (out > 1) {
    // Pulling the target back onto the edge is the same as pushing the camera
    // out by however far past it the target has drifted
    const ease = 1 - lag ** dt;

    camera.x += (x - x / out) * ease;
    camera.y += (y - y / out) * ease;
  }
};

// TODO: Drop this once the camera feels right
export const renderDeadzone = (game) => {
  const { ctx } = game;

  ctx.save();
  ctx.scale(game.scale, game.scale);
  ctx.beginPath();
  ctx.ellipse(
    game.width / 2,
    game.height / 2,
    game.width * deadzone / 2,
    game.height * deadzone / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f33';
  ctx.stroke();
  ctx.restore();
};
