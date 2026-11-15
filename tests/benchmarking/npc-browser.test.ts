import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { camera, followTarget } from '../../src/client/camera.ts';
import type { GameState } from '../../src/client/game.ts';
import { latencyBrowserPreload } from '../../benchmarking/latency/browser.ts';
import {
  installNPCCamera,
  installNPCMirror,
  npcBrowserCall,
} from '../../benchmarking/npc/browser.ts';

let openedConnections = 0;

const page = {
  EventTarget,
  Event,
  MessageEvent,
  CloseEvent: class extends Event {
    constructor(type: string, options: Record<string, unknown>) {
      super(type);
      Object.assign(this, options);
    }
  },
  atob,
  queueMicrotask,
  addEventListener() {},
  requestAnimationFrame(callback: (now: number) => void) {
    callback(123);
  },
  WebSocket: class {
    constructor() {
      openedConnections++;
    }
  },
} as Record<string, any>;

runInNewContext(latencyBrowserPreload(npcBrowserCall(installNPCMirror)), page);

assert.equal(page.__latencyRefs.length, 0);
assert.equal(page.__latencyErrors.length, 0);

page.requestAnimationFrame(() => {});

assert.equal(page.__latencyFrameNow, 123);

const first = Buffer.from([0, 1, 255, 128]);
const second = Buffer.from([7, 0, 8]);
const third = Buffer.from([9]);

assert.deepEqual(
  { ...page.npcMirror.push([first.toString('base64')]) },
  {
    received: 0,
    queued: 1,
    discarded: 0,
    fault: '',
  },
);

const socket = new page.WebSocket('ws://localhost:3000');
const received: Buffer[] = [];
let listenerCount = 0;
let opened = false;

socket.onopen = () => (opened = true);

socket.onmessage = (event: MessageEvent) => {
  received.push(Buffer.from(event.data));
};

socket.addEventListener('message', () => listenerCount++);
page.npcMirror.push([second.toString('base64')]);

await new Promise<void>((resolve) => queueMicrotask(resolve));

assert.equal(opened, true);
assert.equal(socket.readyState, page.WebSocket.OPEN);
assert.equal(page.__latencySockets.length, 1);
assert.equal(page.__latencySockets[0].opened, true);
assert.deepEqual(received, [first, second]);
socket.send(Buffer.from('discarded input'));
socket.send(Buffer.from('discarded hello'));
const status = page.npcMirror.push([third.toString('base64')]);

assert.equal(status.received, 3);
assert.equal(status.queued, 0);
assert.equal(status.discarded, 2);
assert.equal(listenerCount, 3);
assert.deepEqual(received, [first, second, third]);
assert.equal(openedConnections, 0);

socket.close(1000, 'case finished');
assert.equal(socket.readyState, page.WebSocket.CLOSED);
const closed = page.npcMirror.push([first.toString('base64')]);

assert.equal(closed.fault, 'Mirror closed: 1000 case finished');
assert.equal(closed.received, 3);
assert.equal(closed.queued, 1);
assert.deepEqual(received, [first, second, third]);

const ownShip = { id: 1, position: { x: 0, y: 0 } };

const worker = {
  id: 2,
  name: 'Collection finch',
  npcState: 'collecting',
  position: { x: 4000, y: -2300 },
};

const replacement = {
  id: 3,
  name: 'Collection finch',
  npcState: 'collecting',
  position: { x: -1800, y: 2000 },
};

const background = {
  id: 4,
  name: 'Unrelated collector',
  npcState: 'collecting',
  position: { x: -100, y: -200 },
};

const player = {
  started: true,
  ships: [ownShip],
  get ship() {
    return this.ships[0];
  },
};

const network = {
  shipId: ownShip.id,
  world: {
    entities: new Map([
      [background.id, background],
      [worker.id, worker],
    ]),
  },
  recordInput() {},
  updateFrame: () => {
    assert.equal(player.ship, ownShip);
    assert.equal(network.shipId, ownShip.id);
    return true;
  },
  predictFrame: () => {
    assert.equal(player.ship, ownShip);
    assert.equal(network.shipId, ownShip.id);
    return network.world;
  },
};

const predictFrame = network.predictFrame;
const updateFrame = network.updateFrame;

const game = {
  width: 1280,
  height: 800,
  camera,
  sprites: [ownShip, background, worker, replacement],
  crafts: [],
} as unknown as GameState & { camera: typeof camera };

let debugPanel: Record<string, any>;
let chatHeight = 112;

Object.assign(page, {
  Map,
  __latencyRefs: [network, player, game],
  document: {
    querySelector(selector: string) {
      if (selector === '.chat-panel') {
        return {
          getBoundingClientRect: () => ({
            left: 20,
            top: 24,
            bottom: 24 + chatHeight,
            width: 384,
          }),
        };
      }
    },
    createElement: () => ({ style: {} }),
    body: {
      append(panel: Record<string, any>) {
        debugPanel = panel;
      },
    },
  },
});

const initial = runInNewContext(
  npcBrowserCall(installNPCCamera, {
    properties: {},
    scenario: 'collection-finch',
    targetName: worker.name,
    repetition: 2,
    repetitions: 9,
    seed: 42,
  }),
  page,
);

assert.equal(
  initial.ready,
  false,
  'a menu/start flag is insufficient without a rendered frame',
);
assert.equal(initial.targetID, worker.id);
assert.equal(debugPanel.className, 'ui-surface ui-card');
assert.match(debugPanel.style.cssText, /font:14px\/1.5 .*monospace/);
assert.equal(debugPanel.style.left, '20px');
assert.equal(debugPanel.style.top, '160px');
assert.equal(debugPanel.style.width, '384px');
assert.deepEqual(debugPanel.textContent.split('\n'), [
  'Benchmark: collection-finch',
  'Run: 2/9',
  'Seed: 42',
  'Ship: Collection finch',
  'State: collecting',
  'Visible NPCs: 1',
]);
chatHeight = 200;
page.npcCamera();
assert.equal(
  debugPanel.style.top,
  '248px',
  'expanded chat retains the same screen-edge-sized gap',
);
assert.equal(initial.workers, 1, 'the earlier background NPC is excluded');
assert.equal(game.viewShip, worker);
assert.equal(player.ship, ownShip);
assert.deepEqual(player.ships, [ownShip]);
assert.deepEqual(
  [camera.x, camera.y],
  [worker.position.x - 640, worker.position.y - 400],
);
assert.equal(
  network.predictFrame,
  predictFrame,
  'watching does not replace prediction',
);
assert.equal(
  network.updateFrame,
  updateFrame,
  'watching does not replace snapshot updates',
);

await new Promise<void>((resolve) => queueMicrotask(resolve));

assert.equal(
  game.viewShip,
  worker,
  'the view target persists through update and render phases',
);
assert.equal(network.updateFrame(), true);
assert.equal(network.predictFrame(), network.world);
assert.equal(player.ship, ownShip);

for (let frame = 1; frame <= 180; frame++) {
  worker.position.x += 8;
  worker.position.y += 2;
  followTarget(game, game.viewShip || player.ship, 1 / 60);
  page.__latencyComplete((frame * 1000) / 60);
}

const moved = page.npcCamera();

assert.equal(moved.ready, true);
assert.equal(moved.frames, 180);
assert.equal(moved.lastFrame.targetID, worker.id);
assert.equal(
  moved.lastFrame.onScreen,
  true,
  'the actual camera keeps the moving NPC in the viewport',
);
assert.equal(moved.lastFrame.inScene, true);
assert(
  camera.x > initial.camera.x + 500,
  'the actual world-to-screen camera advances with the NPC',
);
assert.equal(moved.screenPosition.x, worker.position.x - camera.x);
assert.equal(moved.screenPosition.y, worker.position.y - camera.y);
assert.equal(player.ship, ownShip);
assert.equal(network.shipId, ownShip.id);

network.world.entities.set(replacement.id, replacement);
assert.equal(
  game.viewShip,
  worker,
  'a new worker does not steal the current view',
);
network.world.entities.delete(worker.id);
assert.equal(
  game.viewShip,
  replacement,
  'a removed target hands off to a live NPC',
);
assert.deepEqual(
  [camera.x, camera.y],
  [replacement.position.x - 640, replacement.position.y - 400],
);
network.world.entities.delete(replacement.id);
assert.equal(
  game.viewShip,
  replacement,
  'the camera holds its last NPC until the case closes',
);
assert.deepEqual(
  [camera.x, camera.y],
  [replacement.position.x - 640, replacement.position.y - 400],
);
assert.equal(player.ship, ownShip);
const idle = page.npcCamera();

assert.equal(idle.targetID, replacement.id);
assert.equal(idle.workers, 0);
assert.equal(idle.ready, true, 'idle scenes remain ready without an NPC');
assert(
  !game.sprites.includes(ownShip as any),
  'the protocol anchor never appears in the scene',
);

const ordinary = runInNewContext(
  npcBrowserCall(installNPCCamera, {
    properties: {},
    scenario: 'collector',
  }),
  { ...page, npcCamera: undefined, __latencyComplete: undefined },
);

assert.equal(
  ordinary.targetID,
  background.id,
  'ordinary CPU scenes still follow any available NPC',
);
assert.equal(ordinary.workers, 1);
