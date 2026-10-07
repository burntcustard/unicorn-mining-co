import assert from 'node:assert/strict';
import { camera, zoomCamera } from '../../src/client/camera.ts';
import { type GameState } from '../../src/client/game.ts';
import { setSizing } from '../../src/client/ui/set-sizing.ts';

const viewport = { innerWidth: 1080, innerHeight: 1080 };

Object.assign(globalThis, { window: viewport });

const game = { size: 1.5, canvas: {}, ctx: {} } as GameState;

for (const [width, height] of [
  [1080, 1080],
  [3840, 1080],
  [1080, 3840],
  [540, 960],
]) {
  Object.assign(viewport, { innerWidth: width, innerHeight: height });
  setSizing(game);
  assert.equal(Math.min(game.width, game.height), 1080);
  assert.equal(game.width / game.height, width / height);
  assert.equal(game.canvas.width, width);
  assert.equal(game.canvas.height, height);
  assert.equal(game.ctx.imageSmoothingEnabled, false);
  assert.equal(Math.min(game.uiWidth, game.uiHeight), 720);
  assert.equal(
    game.uiWidth * game.uiScale,
    width,
    'HUD reaches the right edge',
  );
  assert.equal(
    game.uiHeight * game.uiScale,
    height,
    'HUD reaches the bottom edge',
  );
  assert.equal(game.uiScale, Math.min(width, height) / 720);
}

camera.x = 123;
camera.y = -456;
const center = () => [camera.x + game.width / 2, camera.y + game.height / 2];

const initialCenter = center();
const initialScale = game.scale;
const initialUI = [game.uiScale, game.uiWidth, game.uiHeight];

const press = (key: string, ctrlKey = true, repeat = false) => {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    key,
    ctrlKey,
    repeat,
  }) as KeyboardEvent;

  zoomCamera(game, event);
  return event;
};

assert.equal(press('-').defaultPrevented, true);
assert(game.scale < initialScale, 'zooming out shows more world');
assert.deepEqual(center(), initialCenter, 'zoom keeps the view centred');
assert.deepEqual([game.uiScale, game.uiWidth, game.uiHeight], initialUI);
assert.equal(press('+').defaultPrevented, true);
assert(Math.abs(game.scale - initialScale) < 1e-12);
assert.equal(press('=').defaultPrevented, true);
assert(game.scale > initialScale, 'Ctrl+= also zooms in without Shift');
const zoomedScale = game.scale;

assert.equal(press('=', true, true).defaultPrevented, true);
assert(game.scale > zoomedScale, 'held shortcuts keep zooming the game');
const size = game.size;

assert.equal(press('-', false).defaultPrevented, false);
assert.equal(press('+', false).defaultPrevented, false);
assert.equal(press('a').defaultPrevented, false);
assert.equal(game.size, size, 'unrelated keys leave zoom alone');

for (let index = 0; index < 200; index++) press('-');
assert.equal(game.size, 6, 'zooming out is bounded');

for (let index = 0; index < 200; index++) press('+');
assert.equal(game.size, 0.25, 'zooming in is bounded');
assert(
  center().every(
    (value, index) => Math.abs(value - initialCenter[index]) < 1e-9,
  ),
);

console.log('Square camera sizing, centred zoom, and zoom shortcuts passed');
