import { portalSpec } from '../../src/specs/portal';
import assert from 'node:assert/strict';
import { camera, followTarget, holeZoom } from '../../src/client/camera.ts';
import { type GameState } from '../../src/client/game.ts';
import { setSizing } from '../../src/client/ui/set-sizing.ts';
import { graphics } from '../../src/client/ui/dom/graphics.ts';

const viewport = { innerWidth: 1080, innerHeight: 1080, devicePixelRatio: 1 };

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

Object.assign(viewport, {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 2,
});

graphics[3] = 0.75;
setSizing(game);
assert.equal(game.canvas.width, 1200);
assert.equal(game.canvas.height, 900);
assert.equal(game.width, 1440, 'pixel density does not change the world view');
assert.equal(game.uiWidth, 960, 'pixel density does not change the HUD layout');
assert.equal(game.uiScale, 1.25);
graphics[3] = 1;
viewport.devicePixelRatio = 1;
setSizing(game);

camera.x = 123;
camera.y = -456;
const center = () => [camera.x + game.width / 2, camera.y + game.height / 2];

console.log('Square camera sizing passed');

const portal = { position: { x: 2000, y: -500 }, dockedTo: 123 };
const cameraBefore = { ...camera };

followTarget(game, portal, 0.5, 1);
assert.notDeepEqual(camera, cameraBefore, 'portal capture pans the camera');
assert.notDeepEqual(center(), [2000, -500], 'portal pan is gradual');
followTarget(game, portal, 0.5, 1);
assert.deepEqual(
  center(),
  [2000, -500],
  'portal is centered before the shrink completes',
);
const arrival = { position: { x: -3000, y: 1000 }, dockedTo: 456 };

camera.x = 0;
camera.y = 0;
followTarget(game, arrival, 0, 0);
assert.deepEqual(
  center(),
  [-3000, 1000],
  'arrival starts centered without panning across sectors',
);

const duration = portalSpec.transitScaleDuration / 1000;
const hold = portalSpec.arrivalHoldDuration / 1000;
const sizing = [
  game.size,
  game.scale,
  game.width,
  game.height,
  game.canvas.width,
  game.canvas.height,
];
const poseBeforeZoom = { ...camera };

assert.equal(holeZoom(-duration * 2), 1, 'pull-in retains normal zoom');
assert.equal(holeZoom(-duration), 1, 'zoom begins when shrinking begins');
assert(holeZoom(-duration / 2) > 1, 'shrinking magnifies the foreground');
assert(
  holeZoom(-duration / 4) > holeZoom(-duration / 2),
  'zoom increases toward disappearance',
);
assert(
  Math.abs(holeZoom(-1e-9) - holeZoom(hold + duration)) < 1e-8,
  'zoom is continuous across sector transfer',
);
assert.equal(
  holeZoom(hold + duration / 2),
  holeZoom(-duration / 2),
  'arrival reverses the zoom',
);
assert.equal(holeZoom(hold), 1, 'normal zoom returns once growing finishes');
assert.equal(holeZoom(0), 1);
assert.deepEqual(
  [
    game.size,
    game.scale,
    game.width,
    game.height,
    game.canvas.width,
    game.canvas.height,
  ],
  sizing,
  'portal zoom never resizes the viewport or canvases',
);
assert.deepEqual(
  camera,
  poseBeforeZoom,
  'zoom does not move the background camera',
);
