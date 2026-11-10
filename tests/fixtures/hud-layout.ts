import { createHud } from '../../src/client/ui/dom/hud';
import { createChat } from '../../src/client/ui/dom/chat';
import { createTelemetry } from '../../src/client/ui/dom/telemetry';
import { ui } from '../../src/client/ui/dom/ui';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { addEntity, createWorld } from '../../src/client/simulation/world';
import { Item } from '../../src/client/objects/item';
import { Station } from '../../src/client/objects/station';
import { diamond } from '../../src/specs/items';
import * as Vec from '../../src/client/utilities/vector';

let clear = () => {};

let completeMap = () => {};

/**
 * Static HUD scenes for comparing layout and pixels across structural changes.
 * No game loop, server state, or elapsed animation time enters these captures.
 */
export const showHudLayout = (mode: number) => {
  clear();
  ui.clear();
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world));
  const target = addEntity(world, new Item(diamond, { id: 1001 }));
  const station = addEntity(world, new Station({ id: 1002, spin: 0.01 }));

  Vec.setXY(ship.position, 1161, -45760);
  Vec.setXY(target.position, 1461, -45360);
  ship.fuel = ship.fuelCapacity * 0.75;
  world.tick = 42;
  const hud = createHud();

  const chat = createChat({
    network: {
      world,
      shipId: ship.id,
      sectorName: 'Patroclus',
      displayName: 'Test Pilot',
      chatMessages:
        mode === 2
          ? [
              {
                type: 'chat',
                channel: 0,
                sender: 'Patrol',
                senderRole: 'friendly',
                text: 'Welcome to Patroclus.',
              },
            ]
          : [],
      sendChat() {},
      requestGateAccess() {},
    },
    onTyping() {},
  });

  const selected = mode ? target : undefined;

  const updateHud = (mapReady: boolean) =>
    hud.update({
      ship,
      target: selected,
      credits: 1998,
      displayName: 'Test Pilot',
      sectorName: 'Patroclus',
      worldSeed: 25,
      mapReady,
      objects: [ship, target],
      asteroidPositions: [],
      mapMarkers: [
        {
          kind: 'ship',
          id: 2002,
          position: Vec.create(5000, -47000),
          radius: 0,
          name: 'Other Pilot',
          definitionId: '',
          color: '#3f7',
        },
        {
          kind: 'station',
          id: 2003,
          position: Vec.create(7000, -41000),
          radius: 0,
          name: '',
          definitionId: 'corral-6',
          color: '',
        },
        {
          kind: 'jumpGate',
          id: 2004,
          position: Vec.create(-6000, -51000),
          radius: 0,
          name: '',
          definitionId: '',
          color: '',
        },
        {
          kind: 'wormhole',
          id: 2005,
          position: Vec.create(8000, -53000),
          radius: 0,
          name: '',
          definitionId: '',
          color: '',
        },
      ],
      poses: new Map(),
      shown: mode !== 4,
    });

  updateHud(mode !== 7);
  completeMap = () => updateHud(true);
  chat.update(selected, true);

  if (mode === 6 || mode === 7) hud.toggleMap();

  if (mode === 3) {
    ship.localMovementParent = target.localMovementParent = station;
    ship.localMovementRate = target.localMovementRate = 0.5;

    const telemetry = createTelemetry({
      element: ui.hudElement,
      readSample: () => ({
        world,
        shipId: ship.id,
        targetId: target.id,
        connected: true,
        snapshotReceivedAt: 900,
      }),
    });

    telemetry.toggle();
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;

    telemetry.update({
      now: 1000,
      readPresentation: () => ({
        frameTime: 16.667,
        renderTime: 1.25,
        canvas,
        transform: new DOMMatrix()
          .scale(canvas.width / 1280, canvas.height / 900)
          .translate(640 - ship.position.x, 450 - ship.position.y),
        playerPose: { position: ship.position, rotation: ship.rotation + 0.1 },
        targetPose: {
          position: target.position,
          rotation: target.rotation - 0.1,
        },
      }),
    });
  }

  clear = () => {
    hud.destroy();
    ui.hudElement
      .querySelectorAll('.chat-panel, .hud-telemetry')
      .forEach((panel) => panel.parentNode!.removeChild(panel));
  };
};

export const hideHudLayout = () => {
  clear();

  clear = () => {};
};

export const hudLayoutBounds = () =>
  [
    '.hud-sector',
    '.hud-credits',
    '.hud-target',
    '.hud-map',
    '.hud-map canvas',
    '.hud-modules',
    '.hud-modules > button',
    '.hud-stores',
    '.hud-stores-panel',
    '[data-store="cargo"]',
    '[data-cargo-current]',
    '[data-store="fuel"]',
    '[data-store="fuel"] .ui-power-track',
    '[data-store="power"]',
    '[data-power-storage]',
    '[data-power-usage-bar]',
    '[data-power-generation]',
    '[data-power-usage]',
    '[data-power-net]',
    '[data-pilot]',
    '[data-credits]',
    '[data-sector]',
    '[data-coordinates]',
    '[data-name]',
    '[data-kind]',
    '[data-distance]',
    '[data-description]',
    '[data-value]',
    '.chat-panel',
    '.chat-tabs',
    '.chat-log',
    '.chat-panel input',
    '.hud-telemetry',
    '.telemetry-player',
    '.telemetry-target',
    '.telemetry-parent',
  ].map((selector) => {
    const element = ui.hudElement.querySelector(selector);

    if (!element) return [selector, null];
    const { x, y, width, height } = element.getBoundingClientRect();

    return [selector, x, y, width, height];
  });

export const completeHudMap = () => completeMap();
