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

  hud.update({
    ship,
    target: selected,
    credits: 1998,
    displayName: 'Test Pilot',
    sectorName: 'Patroclus',
    objects: [ship, target],
    asteroidPositions: [],
    poses: new Map(),
    shown: mode !== 4,
  });

  chat.update(selected, true);

  if (mode === 3) {
    ship.localMovementParent = target.localMovementParent = station;
    ship.localMovementRate = target.localMovementRate = 0.5;

    const telemetry = createTelemetry({
      element: ui.element,
      readSample: () => ({
        world,
        shipId: ship.id,
        targetId: target.id,
        connected: true,
        snapshotReceivedAt: 900,
      }),
    });

    telemetry.toggle();
    telemetry.update({ now: 1000 });
  }

  clear = () => {
    hud.destroy();
    ui.element
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
    const element = ui.element.querySelector(selector);

    if (!element) return [selector, null];
    const { x, y, width, height } = element.getBoundingClientRect();

    return [selector, x, y, width, height];
  });
