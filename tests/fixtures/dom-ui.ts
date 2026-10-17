import { player } from '../../src/client/player.ts';
import { init } from '../../src/client/core.ts';
import { game } from '../../src/client/game.ts';
import { ui, updateNotification } from '../../src/client/ui/dom/ui.ts';
import { syncDockedUi } from '../../src/client/ui/dom/docked-loader.ts';
import { setCraftActionDispatcher } from '../../src/client/network/craft-actions.ts';
import { Station } from '../../src/client/objects/station.ts';
import { Item } from '../../src/client/objects/item.ts';
import { diamond } from '../../src/specs/items';
import { cloneEntity } from '../../src/client/simulation/world-state';
import { Autogun, Laser } from '../../src/client/objects/modules/index.ts';
import { paintColors } from '../../src/specs/colors.ts';
import { type ShipPreview } from '../../src/client/ui/dom/identity.ts';
import { addEntity, createWorld } from '../../src/client/simulation/world.ts';
import {
  initKeys,
  setMenuInput,
  playerInput,
} from '../../src/client/input/input.ts';
import { packPlayerInput } from '../../src/client/protocol/input.ts';
import { createChat } from '../../src/client/ui/dom/chat';
import { JumpGate } from '../../src/client/objects/jump-gate';

export const checkChat = () => {
  const sent: (string | number)[][] = [];
  const typing: boolean[] = [];

  const network = {
    displayName: 'Pilot',
    chatMessages: [
      {
        type: 'chat' as const,
        channel: 0,
        sender: '<b>Pilot</b>',
        text: '<img src=x>',
      },
      { type: 'chat' as const, channel: 1, sender: 'Global', text: 'Hello' },
    ],
    sendChat: (channel: number, text: string) => sent.push([channel, text]),
    requestGateAccess: (id: number) => sent.push([id]),
  };

  const chat = createChat({ network, onTyping: (value) => typing.push(value) });
  const panel = document.querySelector<HTMLElement>('.game-chat')!;
  const log = panel.querySelector('.chat-log')!;
  const input = panel.querySelector<HTMLInputElement>('.game-chat input')!;
  const tabs = panel.querySelectorAll<HTMLButtonElement>('.chat-tabs button');
  const gate = new JumpGate({ id: 987, destinationName: 'Priamus' });

  chat.update(gate, true);
  const escaped =
    log.textContent === '<b>Pilot</b>: <img src=x>' &&
    !log.querySelector('b, img');
  const line = log.firstElementChild;

  chat.update(gate, true);
  const unchanged = line === log.firstElementChild;

  tabs[1].click();
  chat.update(gate, true);
  const global = log.textContent === 'Global: Hello';

  network.chatMessages = [
    ...network.chatMessages,
    { type: 'chat', channel: 1, sender: 'New', text: 'Message' },
  ];
  chat.update(gate, true);
  const updated = log.children.length === 2;

  chat.focus();
  input.value = '  Send this  ';
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
  panel.querySelector<HTMLButtonElement>('.chat-contact button')!.click();
  const actions =
    JSON.stringify(sent) === JSON.stringify([[1, 'Send this'], [987]]);

  chat.focus();
  chat.update(undefined, false);
  const hidden =
    !chat.focus() &&
    !panel.getClientRects().length &&
    document.activeElement !== input;

  document.body.removeChild(panel);

  return {
    escaped,
    unchanged,
    global,
    updated,
    actions,
    hidden,
    typing: typing.join() === 'true,false,true,false',
  };
};

const { canvas, context } = init();

Object.assign(game, { canvas, ctx: context });

// The standalone docking fixture does not load main.ts, which owns Escape.
window.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    !event.repeat &&
    !document.querySelector('dialog[open]')
  ) {
    event.preventDefault();
    ui.current?.escape();
  }
});

addEntity(createWorld(), player.ship);
const station = new Station({ id: 100, world: player.ship.world });

addEntity(player.ship.world, station);
player.ship.dockedTo = station.id;

setCraftActionDispatcher((ship, action) =>
  ship.applyDockAction(action, player),
);

export const dock = () => syncDockedUi({ ship: player.ship, available: true });
export const inspect = () => [
  player.credits,
  player.ship.cargoContents.length,
  player.ship.mounts[0].module instanceof Autogun,
  Boolean(player.ship.launchRequested),
];

export const beamLaser = () => {
  const module = new Laser();

  player.ship.cargoContents.push(module);
  ui.current.update();
  return module.price;
};

export const replaceTradeCargo = () => {
  for (const craft of [player.ship, station]) {
    craft.cargoContents = craft.cargoContents.map((entity) =>
      cloneEntity({ entity }),
    );
  }

  ui.current.update();
};

export const tradeCargo = () => {
  player.ship.cargoContents.push(new Item(diamond));
  ui.current.update();
};

export const damage = () => {
  player.ship.mounts[0].health = 1;
  ui.current.update();
};

export const refresh = () => ui.current?.update();

let activityCount = 0;
let stopActivity: () => void;

export const watchDockActivity = () => {
  stopActivity = initKeys({ onActivity: () => activityCount++ });
  setMenuInput(true);
};

export const dockActivityState = () => [
  activityCount,
  packPlayerInput(playerInput),
];

export const stopDockActivity = () => {
  stopActivity();
  setMenuInput(false);
};

const observedPreview = { ship: player.ship };

export const watchDockPreview = async () => {
  const { Ship } = await import('../../src/client/objects/ship');
  // oxlint-disable-next-line typescript/unbound-method
  const updateModules = Ship.prototype.updateModules;

  Ship.prototype.updateModules = function (dt) {
    observedPreview.ship = this;
    updateModules.call(this, dt);
  };

  ui.current.update();
  await new Promise(requestAnimationFrame);
};

export const fittingPreviewState = () => {
  const ship = observedPreview.ship;
  const mount = ship.mounts[0];
  const segments = ship.segmentsAtMount(mount);

  return [
    mount.module ? mount.module.definitionId : null,
    segments.some((segment) => segment.active),
    Math.max(0, ...segments.map((segment) => segment.activationProgress)),
  ];
};

export const transactionState = () => [
  player.credits,
  player.ship.mounts.map((mount) => (mount.module ? mount.module.id : null)),
  player.ship.cargoContents.map((object) => object.id),
  station.cargoContents.map((object) => object.id),
];

export const navigationState = () => [
  transactionState(),
  player.ship.fuel,
  player.ship.shades,
  player.ship.hullHealth,
  player.ship.moduleStates,
  player.ship.cargoContents.map((object) => [
    object.id,
    object.health,
    object.shades,
  ]),
  player.unlockedPaints,
  Boolean(player.ship.launchRequested),
];

export const fillCargo = () => {
  while (player.ship.cargoContents.length < player.ship.cargoSpace) {
    player.ship.cargoContents.push(new Item(diamond));
  }

  ui.current.update();
};

export const moduleStock = () => {
  const modules = [new Laser(), new Laser()];

  station.cargoContents.push(...modules);
  ui.current.update();
  return modules.map((module) => module.id);
};

export const withdrawStock = (id: number) => {
  station.cargoContents = station.cargoContents.filter(
    (object) => object.id !== id,
  );
  ui.current.update();
};

export const rejectPurchase = (id: number) => {
  const object = player.ship.modules.find((object) => object.id === id);

  if (!object) throw new Error('Purchased module not found');

  if (object.mount) player.ship.fit(0, object.mount);

  player.ship.cargoContents = player.ship.cargoContents.filter(
    (entry) => entry !== object,
  );
  player.credits += object.price;
  ui.current.update();
};

export const previewState = () =>
  player.ship.moduleStates.map((module) => module.segments);

export const damageHull = () => {
  const health = player.ship.hullHealth;

  health[0] = 2;
  player.ship.hullHealth = health;
  ui.current.update();
};

export const hullHealth = () => player.ship.hullHealth;

export const previewEquivalence = async () => {
  const { default: shipPreview } =
    await import('../../src/client/ui/dom/ship-preview');
  const target = document.createElement('canvas');
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;

  target.style.width = target.style.height = '512px';
  document.body.append(target);

  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };

  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  const preview = shipPreview.createShipPreview(target);
  const ship = player.ship;
  const snapshot: ShipPreview = [
    ship.definitionId,
    paintColors.findIndex((shades) => shades === ship.shades),
    ship.hullHealth,
    ship.moduleStates
      .filter((module) => module.mount >= 0)
      .map((module) => [
        module.type,
        module.mount,
        paintColors.findIndex((shades) => shades === module.shades),
        module.health ?? null,
      ]),
  ];

  const draw = () => {
    const pending = [...frames.values()];

    frames.clear();
    pending.forEach((callback) => callback(16));
    return target.toDataURL();
  };

  try {
    preview.update(ship);
    const live = draw();

    preview.update(snapshot);
    const saved = draw();
    const idle = !frames.size;

    preview.update(ship, { mount: 0 });
    draw();
    const animated = !!frames.size;

    preview.destroy();
    return [live === saved, idle, animated, !frames.size];
  } finally {
    preview.destroy();
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    document.body.removeChild(target);
  }
};

export const itemPreviewFraming = async () => {
  const { default: shipPreview } =
    await import('../../src/client/ui/dom/ship-preview');
  const target = document.createElement('canvas');

  target.style.width = target.style.height = '160px';
  document.body.append(target);

  const bodyBounds = () => {
    const pixels = target
      .getContext('2d')!
      .getImageData(0, 0, target.width, target.height).data;
    const xs: number[] = [],
      ys: number[] = [];

    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] > 200 &&
        pixels[index + 1] < 100 &&
        pixels[index + 2] < 100 &&
        pixels[index + 3] > 200
      ) {
        const pixel = index / 4;

        xs.push(pixel % target.width);
        ys.push(Math.floor(pixel / target.width));
      }
    }

    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };

  try {
    const spec = {
      resource: 999,
      name: 'Preview fixture',
      points: [
        [-5, -3],
        [5, -3],
        [5, 3],
        [-5, 3],
      ],
      shades: ['#f00', '#f00', '#00f'],
    };

    shipPreview.itemThumbnail(target, spec);
    const plain = bodyBounds();

    shipPreview.itemThumbnail(target, { ...spec, resource: 1000, glint: true });
    const sparkle = bodyBounds();
    const pixels = target
      .getContext('2d')!
      .getImageData(0, 0, target.width, target.height).data;
    const clipped = Array.from(
      { length: target.width },
      (_, index) => index,
    ).some((index) =>
      [
        index,
        index * target.width,
        index * target.width + target.width - 1,
        (target.height - 1) * target.width + index,
      ].some((pixel) => pixels[pixel * 4 + 3] > 0),
    );

    shipPreview.itemThumbnail(target, {
      ...spec,
      resource: 1001,
      lines: [
        [
          [-2, -10],
          [2, -10],
        ],
      ],
    });

    const strokes = bodyBounds();
    const topEdge = target
      .getContext('2d')!
      .getImageData(0, 0, target.width, 1).data;

    return [
      [plain, sparkle, strokes].every(
        ([left, right, top, bottom]) =>
          Math.abs((left + right + 1) / 2 - target.width / 2) < 1 &&
          Math.abs((top + bottom + 1) / 2 - target.height / 2) < 1,
      ),
      sparkle[1] - sparkle[0] < plain[1] - plain[0],
      !clipped,
      strokes[1] - strokes[0] < plain[1] - plain[0] &&
        !topEdge.some((value, index) => index % 4 === 3 && value > 0),
    ];
  } finally {
    document.body.removeChild(target);
  }
};

export const previewOcclusion = async () => {
  const { Ship } = await import('../../src/client/objects/ship');
  const { default: shipPreview } =
    await import('../../src/client/ui/dom/ship-preview');
  const target = document.createElement('canvas');
  const descriptors = Object.getOwnPropertyDescriptors(Ship.prototype);
  const request = window.requestAnimationFrame;
  let draw: FrameRequestCallback;

  target.style.width = target.style.height = '64px';
  document.body.append(target);

  window.requestAnimationFrame = (callback) => {
    draw = callback;
    return 0;
  };

  Ship.prototype.render = function ({ zIndex } = {}) {
    const ctx = game.ctx;
    const hull = (index: number) =>
      this.segments.some(
        (segment) =>
          segment.hull && segment.module === this.hullSegments[index],
      );
    const selectedModule = this.segments.some(
      (segment) => segment.mount === this.mounts[0],
    );

    ctx.resetTransform();

    if (zIndex === 2 && selectedModule) {
      ctx.fillStyle = '#f0f';
      ctx.fillRect(8, 8, 32, 32);
    }

    if (zIndex === 4) {
      if (hull(0)) {
        ctx.fillStyle = '#0f0';
        ctx.fillRect(20, 8, 12, 32);
      }

      if (hull(2)) {
        ctx.fillStyle = '#00f';
        ctx.fillRect(20, 20, 12, 12);
      }

      if (hull(1)) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(40, 8, 12, 12);
      }
    }

    if (zIndex === 5 && selectedModule) {
      ctx.fillStyle = '#0ff';
      ctx.fillRect(20, 34, 12, 6);
    }
  };

  const preview = shipPreview.createShipPreview(target);

  try {
    preview.update(player.ship, { hull: 1 });
    draw(16);
    return [
      [10, 10],
      [24, 12],
      [24, 24],
      [44, 12],
      [24, 36],
      [56, 56],
    ].map(([x, y]) =>
      Array.from(target.getContext('2d').getImageData(x, y, 1, 1).data),
    );
  } finally {
    preview.destroy();

    Object.defineProperties(Ship.prototype, descriptors);
    window.requestAnimationFrame = request;
    document.body.removeChild(target);
  }
};

export const setFuel = (fuel: number, credits: number) => {
  player.ship.fuel = fuel;
  player.credits = credits;
  ui.current.update();
};

export const fuelState = () => [player.ship.fuel, player.credits];

export const notification = (message: string) => updateNotification(message);

export const previewStability = async () => {
  const { Ship } = await import('../../src/client/objects/ship');
  const { default: shipPreview } =
    await import('../../src/client/ui/dom/ship-preview');
  const target = document.createElement('canvas');
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  // oxlint-disable-next-line typescript/unbound-method
  const updateModules = Ship.prototype.updateModules;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const observed = { ship: undefined as InstanceType<typeof Ship> };

  target.style.width = target.style.height = '512px';
  document.body.append(target);

  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };

  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  Ship.prototype.updateModules = function (dt) {
    observed.ship = this;
    updateModules.call(this, dt);
  };

  const preview = shipPreview.createShipPreview(target);
  const source = new Ship();
  const fitted = new Autogun();

  source.fit(fitted, source.mounts[0]);

  const draw = (time: number) => {
    const pending = [...frames.values()];

    frames.clear();
    pending.forEach((callback) => callback(time));
  };

  try {
    preview.update(source, { mount: 0 });

    for (let time = 16; time <= 128; time += 16) draw(time);
    const clone = observed.ship;
    const segment = clone.segmentsAtMount(clone.mounts[0])[0];
    const progress = segment.activationProgress;

    fitted.chargeCooldown = 1;
    source.segmentsAtMount(source.mounts[0])[0].activationProgress = 0.8;
    source.cargoContents.push(new Laser());
    preview.update(source, { mount: 0 });
    draw(144);
    const transientStable =
      observed.ship === clone && segment.activationProgress >= progress;

    source.shades = paintColors[0];
    fitted.shades = paintColors[3];
    source.mounts[0].health = 1;
    const hull = source.hullHealth;

    hull[0] = 2;
    source.hullHealth = hull;
    const before = segment.activationProgress;

    preview.update(source, { mount: 0 });
    draw(160);
    const visualStable =
      observed.ship === clone &&
      segment.activationProgress >= before &&
      clone.shades === source.shades &&
      clone.mounts[0].health === 1 &&
      clone.hullHealth[0] === 2;

    source.fit(new Laser(), source.mounts[0]);
    preview.update(source, { mount: 0 });
    draw(176);
    return [
      progress > 0,
      transientStable,
      visualStable,
      observed.ship !== clone &&
        observed.ship.mounts[0].module instanceof Laser,
    ];
  } finally {
    preview.destroy();
    Ship.prototype.updateModules = updateModules;
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    document.body.removeChild(target);
  }
};
