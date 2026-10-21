import { createHud } from '../../src/client/ui/dom/hud';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import {
  defaultKeybindings,
  moduleBinding,
} from '../../src/client/input/keybindings';
import { player } from '../../src/client/player.ts';
import { init } from '../../src/client/core.ts';
import { game } from '../../src/client/game.ts';
import { ui, updateNotification } from '../../src/client/ui/dom/ui.ts';
import { syncDockedUi } from '../../src/client/ui/dom/docked-loader.ts';
import { setCraftActionDispatcher } from '../../src/client/network/craft-actions.ts';
import { Station } from '../../src/client/objects/station.ts';
import { Item } from '../../src/client/objects/item.ts';
import { autogunAmmo, diamond } from '../../src/specs/items';
import { pirateDialog } from '../../src/specs/dialog/pirate';
import { cloneEntity } from '../../src/client/simulation/world-state';
import {
  Autogun,
  Laser,
  SearchLight,
} from '../../src/client/objects/modules/index.ts';
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
import { Wormhole } from '../../src/client/objects/wormhole';
import { jumpGateSpec } from '../../src/specs/jump-gate';
import { jumpGateDialog } from '../../src/specs/dialog/jump-gate';
import * as Vec from '../../src/client/utilities/vector';

const checkGateBeams = () => {
  const canvas = document.createElement('canvas');

  canvas.width = canvas.height = 800;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const gate = new JumpGate({
    position: Vec.create(400, 400),
    opening: 0.75,
    openingTarget: 1,
    blockedBeams: 2,
  });

  const pixels = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    gate.render({ ctx });
    return jumpGateSpec.beamOffsets.map((y) =>
      [...ctx.getImageData(400, Math.floor(400 + y), 1, 1).data].join(),
    );
  };

  const interrupted = pixels();

  gate.update(jumpGateSpec.openingDuration / 1000);
  const reopened = pixels();

  return {
    onlyInterruptedBeamChanges: interrupted.every((pixel, index) =>
      index === 1 ? pixel !== reopened[index] : pixel === reopened[index],
    ),
    beamsResetWhenFullyOpen: gate.opening === 1 && gate.blockedBeams === 0,
  };
};

export const checkChat = () => {
  const restoreDialog = Object.entries(jumpGateDialog).map(([name, lines]) => {
    const length = lines.length;

    lines.push(`Test ${name}: {player} {destination}`);
    return () => lines.splice(length);
  });

  const sent: (string | number)[][] = [];
  const typing: boolean[] = [];

  const network: Parameters<typeof createChat>[0]['network'] = {
    displayName: 'Pilot',
    world: createWorld(),
    shipId: 1,
    sectorName: 'Patroclus',
    chatMessages: [
      {
        type: 'chat' as const,
        channel: 0,
        senderRole: 'user',
        sender: '<b>Pilot</b>',
        text: '<img src=x>',
      },
      {
        type: 'chat' as const,
        channel: 1,
        senderRole: 'user',
        sender: 'Global',
        text: 'Hello',
      },
    ],
    sendChat: (channel: number, text: string) => sent.push([channel, text]),
    requestGateAccess: (id: number) => sent.push([id]),
  };

  const ship = createPlayerShip(network.world, { id: network.shipId });

  network.world.entities.set(ship.id, ship);

  let releases = 0;
  let releasing = false;

  const chat = createChat({
    network,
    onTyping: (value) => typing.push(value),
    onCargoRelease: (active) => {
      releasing = active;

      if (active) releases++;
    },
  });

  const panel = document.querySelector<HTMLElement>('.chat-panel')!;
  const log = panel.querySelector<HTMLElement>('.chat-log')!;
  const input = panel.querySelector<HTMLInputElement>('.chat-panel input')!;
  const tabs = panel.querySelectorAll<HTMLButtonElement>('.chat-tabs button');

  chat.update(undefined, true);
  const release = panel.querySelector<HTMLButtonElement>('.cargo-release')!;
  const releaseRequiresCargo = release.disabled;

  ship.cargoContents.push(new Item(diamond));
  chat.update(undefined, true);
  release.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  const releaseRequiresDemand =
    release.disabled && releases === 0 && !release.getClientRects().length;

  const pirate = createPlayerShip(network.world, {
    id: 988,
    shipType: 'courser',
  });

  pirate.hostile = true;
  network.world.entities.set(pirate.id, pirate);

  network.chatMessages.push({
    type: 'chat',
    channel: 0,
    sender: 'Pirate',
    senderRole: 'hostile',
    text: pirateDialog.cargoDemand[0],
  });

  chat.update(undefined, true);
  const publicDemandIsNotPersonal = !release.getClientRects().length;

  network.chatMessages.push({
    type: 'chat',
    channel: 0,
    sender: 'Pirate',
    senderRole: 'hostile',
    text: '',
    cargoDemand: pirate.id,
  });

  chat.update(undefined, true);
  release.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  const releaseLabel = release.querySelector('kbd')!;
  const [releaseKey, releaseMode] = releaseLabel.children;
  const divider = getComputedStyle(releaseMode);
  const releaseAction =
    !release.disabled &&
    releases === 1 &&
    !!release.getClientRects().length &&
    releaseLabel.children.length === 2 &&
    releaseKey.textContent ===
      defaultKeybindings.cargoRelease.keys.join(' / ') &&
    releaseMode.textContent === 'Hold' &&
    divider.borderLeftWidth === '2px' &&
    divider.borderLeftColor ===
      getComputedStyle(releaseLabel).borderLeftColor &&
    release.querySelector(':scope > span')!.textContent === 'Release Cargo';

  release.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
  const releaseStopsOnKeyup = !releasing;

  ship.cargoContents = [
    new SearchLight(),
    new Item(autogunAmmo, { rounds: 117 }),
  ];
  chat.update(undefined, true);
  const releaseKeepsModulesAndOpenedAmmo = release.disabled;

  ship.cargoContents.push(new Item(autogunAmmo));
  chat.update(undefined, true);
  const releaseAllowsUnopenedAmmo = !release.disabled;

  const originalReleaseKeys = defaultKeybindings.cargoRelease.keys;

  defaultKeybindings.cargoRelease.keys = ['v'];
  chat.update(undefined, true);
  const reboundReleaseKey = releaseKey.textContent === 'v';

  const originalReleaseMode = defaultKeybindings.cargoRelease.mode;

  defaultKeybindings.cargoRelease.mode = 'toggle';
  chat.update(undefined, true);
  const toggleModeHidden = releaseMode.hasAttribute('hidden');

  defaultKeybindings.cargoRelease.mode = originalReleaseMode;
  defaultKeybindings.cargoRelease.keys = originalReleaseKeys;
  chat.update(undefined, true);
  const onlyHoldModeVisible =
    toggleModeHidden && !releaseMode.hasAttribute('hidden');

  network.chatMessages.push({
    type: 'chat',
    channel: 0,
    sender: 'Pirate',
    senderRole: 'hostile',
    text: '',
    cargoDemand: 0,
  });

  chat.update(undefined, true);
  const releaseEndsWithDemand =
    !release.getClientRects().length && !log.querySelectorAll('p:empty').length;

  network.chatMessages = network.chatMessages.slice(0, 2);
  chat.update(undefined, true);
  ship.cargoContents = [];

  const gate = new JumpGate({
    id: 987,
    name: 'PP-87',
    targetLabel: 'JUMP GATE\nPatroclus\u2009→\u2009Priamus',
    destinationName: 'Priamus',
  });

  network.world.entities.set(gate.id, gate);
  ship.position.x = jumpGateSpec.approachRadius + 1;
  chat.update(gate, true);
  chat.requestGateAccess();
  const distantGateSilent =
    !panel.querySelector('.chat-contact') && sent.length === 0;

  ship.position.x = 0;
  chat.update(gate, true);
  const gateName =
    panel.querySelector('.chat-contact strong')!.textContent === 'PP-87: ';
  const greeting = panel.querySelector('.chat-contact p > span')!.textContent!;
  const greetingPersonalized =
    greeting.includes(network.displayName) &&
    greeting.includes(gate.destinationName);
  const escaped =
    log.querySelector(':scope > p')?.textContent ===
      '<b>Pilot</b>: <img src=x>' && !log.querySelector('b, img');
  const messageFormat =
    !log.querySelector('time') &&
    panel.querySelector<HTMLElement>('.chat-contact p')!.innerText.trim() ===
      `PP-87: ${greeting}`;
  const line = log.firstElementChild;

  chat.update(gate, true);
  const unchanged = line === log.firstElementChild;

  const originalContact = panel.querySelector('.chat-contact')!;

  network.chatMessages = [
    ...network.chatMessages,
    {
      type: 'chat',
      channel: 0,
      senderRole: 'user',
      sender: 'Later',
      text: 'After the greeting',
    },
  ];

  chat.update(gate, true);
  const chronological =
    originalContact.nextElementSibling?.textContent?.endsWith(
      'Later: After the greeting',
    );

  tabs[1].click();
  chat.update(gate, true);
  const sectorGreeting = !log.querySelector('.chat-contact');
  const global = log
    .querySelector(':scope > p')
    ?.textContent?.endsWith('Global: Hello');

  network.chatMessages = [
    ...network.chatMessages,
    {
      type: 'chat',
      channel: 1,
      senderRole: 'user',
      sender: 'New',
      text: 'Message',
    },
  ];

  chat.update(gate, true);
  const updated = log.querySelectorAll(':scope > p').length === 2;

  network.chatMessages = ['user', 'owner', 'friendly', 'admin', 'hostile'].map(
    (senderRole) => ({
      type: 'chat' as const,
      channel: 1,
      senderRole,
      sender: senderRole,
      text: 'Hello',
    }),
  );

  chat.update(gate, true);
  const roleColors =
    [...log.querySelectorAll<HTMLElement>(':scope > p > strong')]
      .map((sender) => sender.style.getPropertyValue('--sender-color'))
      .join() === '#fff,#ff0,#3f7,#4df,#f44';

  network.chatMessages = network.chatMessages.map((message) => ({
    ...message,
    sender: network.displayName,
  }));

  chat.update(gate, true);
  const selfColors =
    [...log.querySelectorAll<HTMLElement>(':scope > p > strong')]
      .map((sender) => sender.style.getPropertyValue('--sender-color'))
      .join() === '#e6f,#ff0,#e6f,#4df,#e6f';

  tabs[0].click();

  network.chatMessages = network.chatMessages.map((message) => ({
    ...message,
    channel: 0,
  }));

  chat.update(gate, true);
  const contact = panel.querySelector<HTMLElement>('.chat-contact')!;
  const sharedScroll = contact.parentElement === log;
  const messageHistory = network.chatMessages;

  network.chatMessages = Array.from({ length: 20 }, (_, index) => ({
    ...messageHistory[0],
    text: `Message ${index}`,
  }));

  chat.update(gate, true);
  const contactKeepsPosition =
    log.firstElementChild === contact && log.lastElementChild !== contact;

  log.scrollTop = log.scrollHeight;
  const greetingScrolls =
    log.scrollHeight > log.clientHeight &&
    contact.getBoundingClientRect().bottom <= log.getBoundingClientRect().top;

  log.scrollTop = 40;
  const readingOffset = log.scrollTop;

  network.chatMessages = [
    ...network.chatMessages,
    {
      ...messageHistory[0],
      text: 'New while reading',
    },
  ];

  chat.update(gate, true);
  const preservesScroll = readingOffset > 0 && log.scrollTop === readingOffset;

  network.chatMessages = messageHistory;
  chat.update(gate, true);

  chat.focus();
  input.value = '  Send this  ';
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
  panel.querySelector<HTMLButtonElement>('.chat-contact button')!.click();
  const actions =
    JSON.stringify(sent) === JSON.stringify([[0, 'Send this'], [987]]);

  const access = panel.querySelector<HTMLButtonElement>(
    '.chat-contact button',
  )!;
  const immediatelyPending =
    access.disabled &&
    access.querySelector(':scope > span')!.textContent === 'Access pending';

  chat.requestGateAccess();

  network.chatMessages = [
    ...network.chatMessages,
    {
      type: 'chat',
      channel: 0,
      sender: gate.name,
      senderRole: 'friendly',
      text: jumpGateDialog.accessPending.at(-1)!,
    },
  ];

  chat.update(gate, true);
  const accessPending =
    immediatelyPending &&
    access.disabled &&
    access.querySelector(':scope > span')!.textContent === 'Access pending' &&
    sent.length === 2;

  ship.position.x = 10000;
  chat.update(gate, true);
  const accessRejected =
    access.disabled &&
    access.querySelector(':scope > span')!.textContent ===
      'Access unavailable' &&
    log.querySelectorAll('.chat-contact').length === 1;

  ship.position.x = 0;
  chat.update(gate, true);
  const retryContact = log.lastElementChild!;
  const retryAccess = retryContact.querySelector<HTMLButtonElement>('button')!;
  const freshRequestAfterRejection =
    retryContact !== contact &&
    retryContact.classList.contains('chat-contact') &&
    !retryContact.querySelector('p') &&
    !retryAccess.disabled &&
    access.disabled &&
    contact.parentElement === log &&
    retryAccess.querySelector(':scope > span')!.textContent ===
      'Request access';

  chat.update(gate, true);
  const noDuplicateGreeting =
    log.querySelectorAll('.chat-contact').length === 2;
  const originalAccessKeys = defaultKeybindings.requestGateAccess.keys;
  const moduleStyle =
    retryAccess.classList.contains('flex') &&
    retryAccess.parentElement!.classList.contains('ui-controls') &&
    retryAccess.querySelector('kbd')!.textContent ===
      originalAccessKeys.join(' / ');

  defaultKeybindings.requestGateAccess.keys = ['g'];
  chat.update(gate, true);
  const reboundAccessKey =
    retryAccess.querySelector('kbd')!.textContent === 'g';

  access.click();
  chat.requestGateAccess();
  const accessAction = sent.length === 3 && sent.at(-1)![0] === 987;

  gate.openingTarget = 1;
  chat.update(gate, true);
  chat.requestGateAccess();
  const accessDisabled =
    sent.length === 3 &&
    retryAccess.disabled &&
    retryAccess.querySelector(':scope > span')!.textContent ===
      'Access granted' &&
    access.querySelector(':scope > span')!.textContent ===
      'Access unavailable' &&
    Boolean(retryAccess.querySelector('kbd'));

  network.chatMessages = [
    ...network.chatMessages,
    {
      type: 'chat',
      channel: 0,
      sender: gate.name,
      senderRole: 'friendly',
      text: jumpGateDialog.closing.at(-1)!,
    },
  ];

  gate.openingTarget = 0;
  chat.update(gate, true);
  const closedContact = log.lastElementChild!;
  const closedAccess =
    closedContact.querySelector<HTMLButtonElement>('button')!;
  const freshRequestAfterClosing =
    closedContact !== retryContact &&
    closedContact.previousElementSibling?.textContent ===
      `${gate.name}: ${jumpGateDialog.closing.at(-1)!}` &&
    !closedContact.querySelector('p') &&
    !closedAccess.disabled &&
    retryAccess.disabled &&
    retryAccess.querySelector(':scope > span')!.textContent ===
      'Access granted' &&
    log.querySelectorAll('.chat-contact').length === 3;

  chat.update(gate, true);
  const noRepeatedClosingPrompt =
    log.lastElementChild === closedContact &&
    log.querySelectorAll('.chat-contact').length === 3;

  chat.update(undefined, true);
  chat.requestGateAccess();
  const noTargetAccess =
    sent.length === 3 && closedAccess.disabled && contact.parentElement === log;

  const otherGate = new JumpGate({
    id: 988,
    name: 'PA-00',
    destinationName: 'Acamas',
  });

  network.world.entities.set(otherGate.id, otherGate);
  chat.update(otherGate, true);
  const separateGreetings =
    log.querySelectorAll('.chat-contact').length === 4 &&
    log.lastElementChild?.querySelector('strong')!.textContent === 'PA-00: ' &&
    contact.querySelector('strong')!.textContent === 'PP-87: ' &&
    access.disabled;

  chat.update(gate, true);
  const returnedContact = log.lastElementChild!;
  const returnedAccess =
    returnedContact.querySelector<HTMLButtonElement>('button')!;
  const freshRequestOnReturn =
    log.querySelectorAll('.chat-contact').length === 5 &&
    returnedContact !== closedContact &&
    !returnedAccess.disabled &&
    closedAccess.disabled &&
    log.querySelectorAll('.chat-contact button:enabled').length === 1;

  closedAccess.click();
  retryAccess.click();
  access.click();
  const historicalRequestsStayDisabled = sent.length === 3;

  chat.requestGateAccess();
  ship.position.x = 10000;
  chat.update(gate, false);
  ship.position.x = 0;
  chat.update(gate, false);
  const noHiddenGreeting = log.querySelectorAll('.chat-contact').length === 5;

  chat.update(gate, true);
  const freshRequestAfterCancellation =
    noHiddenGreeting &&
    sent.length === 4 &&
    returnedAccess.disabled &&
    returnedAccess.querySelector(':scope > span')!.textContent ===
      'Access unavailable' &&
    log.querySelectorAll('.chat-contact').length === 6 &&
    log.querySelectorAll('.chat-contact button:enabled').length === 1;

  const observerChat = createChat({ network, onTyping: () => {} });

  const observerPanel = [...document.querySelectorAll('.chat-panel')].at(-1)!;

  observerChat.update(undefined, true);
  let targetOnlyAccess = !observerPanel.querySelector('.chat-contact button');

  chat.requestGateAccess();

  network.chatMessages = [
    ...network.chatMessages,
    ...[
      jumpGateDialog.closing.at(-1)!,
      jumpGateDialog.closingInterrupted.at(-1)!,
    ].map((text) => ({
      type: 'chat' as const,
      channel: 0,
      sender: gate.name,
      senderRole: 'friendly',
      text,
    })),
  ];

  observerChat.update(undefined, true);
  chat.update(gate, true);
  const warningsKeepAccessPending =
    log.querySelectorAll('.chat-contact').length === 6 &&
    log.querySelectorAll('.chat-contact button:enabled').length === 0 &&
    log.querySelector('.chat-contact:last-of-type button > span')
      ?.textContent === 'Access pending';

  targetOnlyAccess &&=
    !observerPanel.querySelector('.chat-contact button') &&
    observerPanel.textContent!.includes(jumpGateDialog.closing.at(-1)!) &&
    observerPanel.textContent!.includes(
      jumpGateDialog.closingInterrupted.at(-1)!,
    );
  observerChat.update(gate, true);
  const sharedGreeting =
    observerPanel.querySelector('.chat-contact p > span')!.textContent ===
    greeting;

  targetOnlyAccess &&=
    observerPanel.querySelectorAll('.chat-contact button:enabled').length === 1;

  network.chatMessages.push({
    type: 'chat',
    channel: 0,
    sender: gate.name,
    senderRole: 'friendly',
    text: jumpGateDialog.accessGranted.at(-1)!,
  });

  chat.update(gate, true);
  const accessGrantedVariant =
    log.querySelector('.chat-contact:last-of-type button > span')
      ?.textContent === 'Access granted';

  observerChat.update(undefined, true);
  observerChat.update(undefined, true);
  targetOnlyAccess &&=
    observerPanel.querySelectorAll('.chat-contact button:enabled').length === 0;
  observerPanel.parentNode!.removeChild(observerPanel);

  network.sectorName = 'Acamas';
  network.world.entities.clear();

  network.chatMessages = [
    {
      type: 'chat',
      channel: 0,
      sender: 'AP-24',
      senderRole: 'friendly',
      text: 'Welcome to Acamas, Pilot',
    },
  ];

  chat.update(gate, true);
  const sectorHistoryCleared =
    log.childElementCount === 1 &&
    log.textContent === 'AP-24: Welcome to Acamas, Pilot';

  chat.update(gate, true);
  chat.requestGateAccess();
  const staleGateIgnored =
    log.childElementCount === 1 &&
    !log.querySelector('.chat-contact') &&
    sent.length === 5;

  chat.focus();
  chat.update(gate, false);
  chat.requestGateAccess();
  const hiddenAccess = sent.length === 5;

  defaultKeybindings.requestGateAccess.keys = originalAccessKeys;
  const hidden =
    !chat.focus() &&
    !panel.getClientRects().length &&
    document.activeElement !== input;

  panel.parentNode!.removeChild(panel);
  restoreDialog.forEach((restore) => restore());

  return {
    ...checkGateBeams(),
    releaseRequiresCargo,
    releaseRequiresDemand,
    publicDemandIsNotPersonal,
    releaseEndsWithDemand,
    releaseAction,
    releaseKeepsModulesAndOpenedAmmo,
    releaseAllowsUnopenedAmmo,
    reboundReleaseKey,
    onlyHoldModeVisible,
    releaseStopsOnKeyup,
    gateName,
    distantGateSilent,
    greetingPersonalized,
    sharedScroll,
    chronological,
    sectorGreeting,
    contactKeepsPosition,
    preservesScroll,
    separateGreetings,
    sharedGreeting,
    accessGrantedVariant,
    noDuplicateGreeting,
    freshRequestAfterRejection,
    freshRequestAfterClosing,
    noRepeatedClosingPrompt,
    freshRequestOnReturn,
    historicalRequestsStayDisabled,
    freshRequestAfterCancellation,
    targetOnlyAccess,
    warningsKeepAccessPending,
    sectorHistoryCleared,
    staleGateIgnored,
    greetingScrolls,
    moduleStyle,
    reboundAccessKey,
    accessAction,
    accessPending,
    accessRejected,
    accessDisabled,
    noTargetAccess,
    hiddenAccess,
    messageFormat,
    roleColors,
    selfColors,
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
    const changedLoadout =
      observed.ship !== clone &&
      observed.ship.mounts[0].module instanceof Laser;

    let time = 192;

    const committedFittings = [false, true].flatMap((owned) =>
      [false, true].map((deployed) => {
        const source = new Ship();
        const ownedCandidate = owned
          ? new Laser({ shades: paintColors[2] })
          : undefined;
        const candidate = ownedCandidate || Laser;

        preview.update(source, { mount: 0, candidate });

        for (let frame = 0; frame < (deployed ? 50 : 8); frame++) {
          draw((time += 16));
        }

        const clone = observed.ship;
        const module = clone.mounts[0].module;
        const segments = clone.segmentsAtMount(clone.mounts[0]);
        const progress = segments.map((segment) => segment.activationProgress);

        source.fit(ownedCandidate || new Laser(), source.mounts[0]);
        preview.update(source, { mount: 0 });
        draw((time += 16));
        preview.update(source, { mount: 0 });
        draw((time += 16));

        return (
          progress.some((value) => value > 0) &&
          (!deployed || progress.every((value) => value === 1)) &&
          observed.ship === clone &&
          clone.mounts[0].module === module &&
          segments.every(
            (segment, index) =>
              clone.segmentsAtMount(clone.mounts[0])[index] === segment &&
              segment.active === 1 &&
              segment.activationProgress >= progress[index],
          )
        );
      }),
    );

    return [
      progress > 0,
      transientStable,
      visualStable,
      changedLoadout,
      ...committedFittings,
    ];
  } finally {
    preview.destroy();
    Ship.prototype.updateModules = updateModules;
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    document.body.removeChild(target);
  }
};

export const checkHud = () => {
  let toggled: unknown;

  const hud = createHud({
    onToggle: (Type) => {
      toggled = Type;
    },
  });

  const element = ui.element;
  const panels = Array.from(
    element.querySelectorAll<HTMLElement>(':scope > .hud-widget'),
  );
  const ship = createPlayerShip(createWorld());
  const target = new Item(diamond, { position: { x: 300, y: 400 } });

  const options = {
    ship,
    target,
    credits: 1998,
    displayName: 'Pilot',
    sectorName: 'Patroclus',
    objects: [ship, target],
    poses: new Map(),
    shown: true,
    alpha: 1,
  };

  const text = (selector: string) =>
    element.querySelector(selector)?.textContent;

  hud.update(options);
  const readouts =
    text('[data-credits]') === '1,998$' &&
    text('[data-pilot]') === 'Pilot' &&
    text('[data-sector]') === 'Patroclus' &&
    text('[data-coordinate-x]') === '0' &&
    text('[data-coordinate-y]') === '0' &&
    text('[data-coordinates] .text-muted') === '\u2009/\u2009';

  const details = {
    ['target name: ' + text('[data-name]')]: text('[data-name]') === 'Diamond',
    ['target distance: ' + text('[data-distance]')]:
      text('[data-distance]') === '500\u2009m',
    ['target value: ' + text('[data-value]')]: text('[data-value]') === '80$',
    ['target kind: ' + text('[data-kind]')]: text('[data-kind]') === 'Resource',
    'target icon': Boolean(element.querySelector('.hud-target-icon canvas')),
  };

  const keys = element.querySelectorAll('kbd').length > 0;

  element.querySelector<HTMLButtonElement>('.hud-modules > button')!.click();
  const clickable = Boolean(toggled);
  const compactModuleControls = Array.from(
    element.querySelectorAll('.hud-modules > button'),
  ).every(
    (button) =>
      button.children.length === 2 &&
      button.firstElementChild!.tagName === 'KBD',
  );

  const storeTooltips =
    element.querySelector('[aria-label="Power"] > [aria-hidden]')
      ?.textContent === '🗲' &&
    Array.from(element.querySelectorAll('.hud-stores button')).every(
      (button) => {
        const tooltip = element.querySelector(
          '#' + button.getAttribute('aria-describedby'),
        );

        return Boolean(
          tooltip?.textContent && tooltip.classList.contains('ui-card'),
        );
      },
    );

  const card = document.createElement('aside');

  card.className = 'ui-card';
  element.append(card);
  const cardStyle = getComputedStyle(card);

  const sharedPanels =
    [...element.querySelectorAll('.ui-card')].every((panel) => {
      const style = getComputedStyle(panel);
      const padding = panel.classList.contains('hud-map')
        ? [0, 0, 0, 0]
        : panel.classList.contains('hud-credits')
          ? [8, 18, 6, 18]
          : [16, 16, 16, 16];

      if (panel.classList.contains('hud-stores-panel')) {
        return (
          style.backgroundColor === cardStyle.backgroundColor &&
          style.backdropFilter === cardStyle.backdropFilter
        );
      }

      return (
        style.backgroundColor === cardStyle.backgroundColor &&
        style.backdropFilter === cardStyle.backdropFilter &&
        style.borderTopWidth === cardStyle.borderTopWidth &&
        style.borderTopColor === cardStyle.borderTopColor &&
        [
          'padding-top',
          'padding-right',
          'padding-bottom',
          'padding-left',
        ].every(
          (side, index) =>
            style.getPropertyValue(side) === `${padding[index]}px`,
        )
      );
    }) && cardStyle.borderTopColor === cardStyle.borderLeftColor;

  element.removeChild(card);

  const meter = element.querySelector('[data-power-usage-bar]')!;
  const storage = element.querySelector<HTMLElement>('[data-power-storage]')!;
  const storageFill = storage.querySelector<HTMLElement>('.ui-power-part')!;
  const storedPower = ship.storedPower;
  const solidStorage = getComputedStyle(storageFill).boxShadow === 'none';

  ship.storedPower = ship.powerCapacity / 2;
  hud.update(options);
  const streamingPower =
    storageFill.style.width === '50%' &&
    text('[data-power-label]') ===
      `${Math.round(ship.storedPower)}/${Math.round(ship.powerCapacity)}` &&
    storage.getBoundingClientRect().height === 12 &&
    meter.getBoundingClientRect().height === 4 &&
    meter.getBoundingClientRect().top >
      storage.getBoundingClientRect().bottom &&
    text('[data-power-usage]') === ship.powerUsage.toFixed(1) &&
    text('[data-power-generation]') === ship.powerGeneration.toFixed(1);
  const generationReadout = element.querySelector<HTMLElement>(
    '[data-power-generation]',
  )!;
  const usageReadout =
    element.querySelector<HTMLElement>('[data-power-usage]')!;
  const netReadout = element.querySelector<HTMLElement>('[data-power-net]')!;
  const barCenter =
    (storage.getBoundingClientRect().top +
      meter.getBoundingClientRect().bottom) /
    2;

  const powerReadouts =
    [generationReadout.parentElement!, netReadout.parentElement!].every(
      (readout) => {
        const { top, bottom } = readout.getBoundingClientRect();

        return Math.abs((top + bottom) / 2 - barCenter) < 1;
      },
    ) &&
    generationReadout.getBoundingClientRect().bottom <=
      usageReadout.getBoundingClientRect().top &&
    netReadout.getBoundingClientRect().left >
      generationReadout.getBoundingClientRect().right &&
    getComputedStyle(generationReadout).fontSize === '12px' &&
    parseFloat(getComputedStyle(netReadout).fontSize) > 12 &&
    netReadout.textContent ===
      `+${(ship.powerGeneration - ship.powerUsage).toFixed(1)}` &&
    getComputedStyle(netReadout).getPropertyValue('--ui-color') ===
      getComputedStyle(storageFill).getPropertyValue('--ui-color');

  const chargedColor =
    getComputedStyle(netReadout).getPropertyValue('--ui-color');

  ship.storedPower = 0;
  hud.update(options);
  const emptyStorage =
    storageFill.style.width === '0%' &&
    text('[data-power-label]') === `0/${Math.round(ship.powerCapacity)}` &&
    getComputedStyle(netReadout).getPropertyValue('--ui-color') !==
      chargedColor &&
    getComputedStyle(storageFill).getPropertyValue('--ui-color') ===
      chargedColor &&
    getComputedStyle(netReadout).getPropertyValue('--ui-color') ===
      getComputedStyle(usageReadout).getPropertyValue('--ui-color');

  ship.storedPower = storedPower;
  hud.update(options);
  const consumption = Number(meter.getAttribute('aria-valuenow'));
  const powerScale = meter.getAttribute('aria-valuemax');
  const generated = ship.mounts.reduce(
    (sum, { module, health }) =>
      sum + (health >= 1 && module ? module.powerGenerated || 0 : 0),
    0,
  );

  const proportionalPower =
    Number(powerScale) === generated * 1.5 &&
    Array.from(meter.children).every((part) => {
      const value = Number(
        part.getAttribute('title')!.match(/: ([\d.]+) MW$/)![1],
      );

      return (
        Math.abs(
          parseFloat((part as HTMLElement).style.width) -
            (value / (generated * 1.5)) * 100,
        ) < 0.1
      );
    });

  const fuelBar = element.querySelector<HTMLElement>(
    '[data-store="fuel"] .ui-power-track',
  )!;
  const filledFuelSegments = () => fuelBar.querySelectorAll('.filled').length;
  const noCargoBar = !element.querySelector(
    '[data-store="cargo"] [role="meter"], .ui-segmented-bar',
  );
  const storeDisplay =
    fuelBar.children.length === 8 && filledFuelSegments() === 8 && noCargoBar;
  const fuelLabels = Array.from(
    element.querySelectorAll<HTMLElement>('.hud-fuel > span'),
  );
  const labeledFuel =
    fuelLabels.map((label) => label.textContent).join('') === 'EF' &&
    fuelLabels.every((label) =>
      getComputedStyle(label).fontFamily.startsWith('Gemetric'),
    ) &&
    fuelLabels[0].getBoundingClientRect().right <
      fuelBar.getBoundingClientRect().left &&
    fuelLabels[1].getBoundingClientRect().left >
      fuelBar.getBoundingClientRect().right;
  const cargoReadout =
    getComputedStyle(element.querySelector('[data-store="cargo"] output')!)
      .alignItems === 'baseline' &&
    text('[data-cargo-current]') === '0' &&
    text('[data-cargo-capacity]') === String(ship.cargoSpace) &&
    parseFloat(
      getComputedStyle(element.querySelector('[data-cargo-current]')!).fontSize,
    ) >
      parseFloat(
        getComputedStyle(element.querySelector('[data-cargo-capacity]')!)
          .fontSize,
      );
  const cargoStyles = [
    '[data-cargo-current]',
    '[data-store="cargo"] output > span:last-child',
    '[data-cargo-capacity]',
  ].map((selector) => getComputedStyle(element.querySelector(selector)!));
  const sharedTextStyle = cargoStyles.every(
    (style) =>
      style.color ===
        getComputedStyle(element.querySelector('.hud-credits')!).color &&
      parseFloat(style.getPropertyValue('-webkit-text-stroke-width')) > 0 &&
      style.getPropertyValue('paint-order').startsWith('stroke'),
  );
  const storeOrder =
    Array.from(element.querySelectorAll('.hud-stores > [data-store]'))
      .map((store) => store.getAttribute('data-store'))
      .join(' / ') === 'cargo / fuel / power';
  const fuelCapacity = ship.fuelCapacity;
  const cargoCapacity = ship.cargoSpace;
  const fuelWidth = fuelBar.getBoundingClientRect().width;

  ship.fuelCapacity += 100;
  ship.cargoSpace += 4;
  hud.update(options);
  const capacityGrowth =
    fuelBar.getBoundingClientRect().width > fuelWidth &&
    text('[data-cargo-capacity]') === String(cargoCapacity + 4) &&
    filledFuelSegments() === Math.ceil((ship.fuel / ship.fuelCapacity) * 8);
  const storesPanel = element.querySelector<HTMLElement>('.hud-stores')!;

  ship.fuelCapacity = fuelCapacity * 10;
  ship.cargoSpace = cargoCapacity * 10;
  hud.update(options);
  const largeCapacityReadout =
    text('[data-cargo-capacity]') === String(cargoCapacity * 10) &&
    fuelBar.children.length === 8 &&
    fuelBar.getBoundingClientRect().width > fuelWidth;

  const containedPower =
    meter.getBoundingClientRect().right <
    storesPanel.getBoundingClientRect().right;

  ship.fuelCapacity = fuelCapacity;
  ship.cargoSpace = 0;
  hud.update(options);
  const emptyCargoCapacity =
    text('[data-cargo-current]') === '0' &&
    text('[data-cargo-capacity]') === '0';

  ship.cargoSpace = cargoCapacity;
  hud.update(options);
  const fullLabel = element.querySelector<HTMLElement>('[data-cargo-full]')!;
  const initiallyNotFull = fullLabel.hidden;

  ship.cargoContents = Array.from({ length: cargoCapacity }, () => target);
  hud.update(options);
  const cargoFull =
    initiallyNotFull &&
    !fullLabel.hidden &&
    fullLabel.textContent === '\u00a0Full' &&
    getComputedStyle(fullLabel).animationName !== 'none';

  ship.cargoContents = [];
  hud.update(options);
  const cargoFullCleared = fullLabel.hidden;
  const tooltips =
    text('#hud-fuel-tooltip')?.includes(
      `${ship.fuel.toFixed(1)} / ${fuelCapacity} L`,
    ) &&
    text('#hud-cargo-tooltip') === `Cargo: 0 / ${cargoCapacity} slots` &&
    Boolean(text('#hud-power-tooltip')?.includes(generated.toFixed(1)));
  const groupedMeters =
    Array.from(element.querySelectorAll('[role="meter"]')).length === 3 &&
    Array.from(element.querySelectorAll('[role="meter"]')).every((bar) =>
      bar.closest('.hud-stores'),
    );

  const originalFuel = ship.fuel;

  ship.fuel = ship.fuelCapacity / 2;
  ship.cargoContents.push(target);
  hud.update(options);
  const storeUpdates =
    filledFuelSegments() === 4 && text('[data-cargo-current]') === '1';

  ship.fuel = ship.fuelCapacity / 8 + 0.01;
  hud.update(options);
  const aboveReserve =
    filledFuelSegments() === 2 && !fuelBar.classList.contains('hud-fuel-low');

  ship.fuel = ship.fuelCapacity / 8;
  hud.update(options);
  const reserveWarning =
    aboveReserve &&
    filledFuelSegments() === 1 &&
    fuelBar.classList.contains('hud-fuel-low') &&
    getComputedStyle(fuelBar.firstElementChild!).animationName !== 'none';

  ship.fuel = 0;
  hud.update(options);
  const emptyFuel =
    filledFuelSegments() === 0 && fuelBar.classList.contains('hud-fuel-low');

  ship.fuel = originalFuel;
  ship.cargoContents.pop();
  hud.update(options);
  const fuelRecovered = !fuelBar.classList.contains('hud-fuel-low');
  const sharedRoot =
    panels.length === 4 &&
    panels.every((panel) => panel.parentElement === element) &&
    document.querySelectorAll('.hud').length === 1 &&
    !document.querySelector('#ui-root, .hud-instruments');
  const naturalCase = getComputedStyle(element).textTransform === 'none';

  ship.fly(1, 0);
  hud.update(options);
  const constantThrusterPower =
    Number(meter.getAttribute('aria-valuenow')) === consumption;

  ship.fly(0, 0);

  meter
    .getAnimations({ subtree: true })
    .forEach((animation) => animation.finish());
  const usageParts = Array.from(meter.children) as HTMLElement[];
  const previousWidths = usageParts.map(
    (part) => part.getBoundingClientRect().width,
  );

  const binding = moduleBinding('searchLight');
  const original = [...binding.keys];

  binding.keys = ['ArrowUp'];

  ship.segments.forEach((segment) => {
    if (segment.module instanceof SearchLight) segment.active = 1;
  });

  hud.update({ ...options, sectorName: 'Hippokoon' });
  const animations = meter.getAnimations({ subtree: true });

  animations.forEach((animation) => {
    animation.pause();
    animation.currentTime = 100;
  });

  const retainedSegments = usageParts.every(
    (part, index) => meter.children[index] === part,
  );

  const animatedUsage =
    retainedSegments &&
    animations.length > 0 &&
    usageParts.some((part, index) => {
      const width = part.getBoundingClientRect().width;
      const targetWidth =
        (parseFloat(part.style.width) * meter.getBoundingClientRect().width) /
        100;

      return (
        targetWidth > previousWidths[index] + 1 &&
        width > previousWidths[index] &&
        width < targetWidth &&
        getComputedStyle(part).getPropertyValue('transition-property') ===
          'width' &&
        getComputedStyle(part).getPropertyValue('transition-duration') ===
          '0.2s'
      );
    });

  animations.forEach((animation) => animation.finish());
  const settledUsage = usageParts.every(
    (part) =>
      Math.abs(
        part.getBoundingClientRect().width -
          (parseFloat(part.style.width) * meter.getBoundingClientRect().width) /
            100,
      ) < 0.1,
  );

  const wholePixelPower =
    Math.abs(meter.getBoundingClientRect().width - Number(powerScale) * 30) <
      0.1 &&
    usageParts.every((part) => {
      const width = part.getBoundingClientRect().width;

      return Math.abs(width - Math.round(width)) < 0.02;
    });

  const matchingDividers = usageParts.every(
    (part) =>
      getComputedStyle(part).boxShadow !== 'none' &&
      getComputedStyle(part).boxShadow ===
        getComputedStyle(usageParts[0]).boxShadow,
  );

  const rebinding = [...element.querySelectorAll('kbd')].some(
    (key) => key.textContent === '↑',
  );
  const activation = Boolean(
    element.querySelector('.hud-modules > button[aria-pressed="true"]'),
  );
  const powerChanges =
    Number(meter.getAttribute('aria-valuenow')) > consumption;
  const powerScaleStable = meter.getAttribute('aria-valuemax') === powerScale;
  const meterWidth = meter.getBoundingClientRect().width;
  const enginePower = ship.engine.powerActivated;

  ship.engine.powerActivated = Number(powerScale) * 3;
  hud.update(options);
  meter
    .getAnimations({ subtree: true })
    .forEach((animation) => animation.finish());

  const meterBox = meter.getBoundingClientRect();
  const marker = getComputedStyle(meter, '::after');
  const markerX = meterBox.left + parseFloat(marker.left) - 1;
  const clippedPower =
    Number(meter.getAttribute('aria-valuenow')) > Number(powerScale) &&
    meter.getAttribute('aria-valuemax') === powerScale &&
    meterBox.width === meterWidth &&
    getComputedStyle(meter).overflowX === 'clip' &&
    getComputedStyle(meter).overflowY === ' visible '.trim() &&
    usageParts.some(
      (part) => part.getBoundingClientRect().right > meterBox.right,
    ) &&
    !document
      .elementsFromPoint(meterBox.right + 1, meterBox.top + 2)
      .some((element) => element.classList.contains('ui-power-part'));
  const visiblePowerMarker =
    marker.backgroundColor === 'rgb(255, 255, 255)' &&
    marker.boxShadow !== 'none' &&
    document.elementFromPoint(markerX, meterBox.top - 2) === meter &&
    document.elementFromPoint(markerX, meterBox.bottom + 2) === meter;

  ship.engine.powerActivated = enginePower;
  hud.update({ ...options, sectorName: 'Hippokoon' });
  const activeKey = element.querySelector(
    '.hud-modules > button[aria-pressed="true"] > kbd',
  )!;
  const keyStyle = getComputedStyle(activeKey);
  const insetFill =
    keyStyle.backgroundImage.startsWith('linear-gradient(') &&
    keyStyle.backgroundSize === 'calc(100% - 6px) calc(100% - 6px)' &&
    keyStyle.getPropertyValue(' color '.trim()) === 'rgb(0, 0, 0)';
  const travel = text('[data-sector]') === 'Hippokoon';

  binding.keys = original;

  const gate = new JumpGate({
    name: 'PA-87',
    targetLabel: 'JUMP GATE\nPatroclus\u2009→\u2009Acamas',
  });

  hud.update({ ...options, target: gate });
  const gateRoute =
    text('[data-name]') === gate.name &&
    text('[data-description]') === gate.targetLabel!.split('\n').at(-1) &&
    !element.querySelector<HTMLElement>('[data-description]')!.hidden;

  gate.position.x = 1000;
  hud.update({ ...options, target: gate });
  const gateApproach =
    text('[data-description]') === 'Move closer to request access';

  gate.position.x = 0;
  hud.update({ ...options, target: gate });
  const gateApproachCleared =
    text('[data-description]') === gate.targetLabel!.split('\n').at(-1);

  const targetArtwork = [
    new Station({ stationType: 'corral-5' }),
    new Station({ stationType: 'corral-6' }),
    gate,
    new Wormhole(),
    ship,
  ].every((target) => {
    hud.update({ ...options, target });
    const canvas = element.querySelector<HTMLCanvasElement>(
      '.hud-target-icon canvas',
    );

    if (!canvas || element.querySelector('.hud-target-icon svg')) return false;
    const pixels = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data;

    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  });

  hud.update({ ...options, target: undefined, shown: false });
  const hidden =
    panels.every((panel) => !panel.getClientRects().length) &&
    element.getClientRects().length > 0;

  hud.update({ ...options, target: undefined });
  const cleared = element.querySelector<HTMLElement>('.hud-target')!.hidden;

  hud.destroy();

  return Object.fromEntries([
    ['readouts', readouts],
    ['sharedRoot', sharedRoot],
    ['naturalCase', naturalCase],
    ['storeDisplay', storeDisplay],
    ['labeledFuel', labeledFuel],
    ['cargoReadout', cargoReadout],
    ['cargoFull', cargoFull],
    ['cargoFullCleared', cargoFullCleared],
    ['gateApproach', gateApproach],
    ['gateApproachCleared', gateApproachCleared],
    ['storeOrder', storeOrder],
    ['noCargoBar', noCargoBar],
    ['sharedTextStyle', sharedTextStyle],
    ['capacityGrowth', capacityGrowth],
    ['largeCapacityReadout', largeCapacityReadout],
    ['containedPower', containedPower],
    ['emptyCargoCapacity', emptyCargoCapacity],
    ['tooltips', tooltips],
    ['groupedMeters', groupedMeters],
    ['storeUpdates', storeUpdates],
    ['emptyFuel', emptyFuel],
    ['reserveWarning', reserveWarning],
    ['fuelRecovered', fuelRecovered],
    ['proportionalPower', proportionalPower],
    ['streamingPower', streamingPower],
    ['solidStorage', solidStorage],
    ['powerReadouts', powerReadouts],
    ['emptyStorage', emptyStorage],
    ['powerScaleStable', powerScaleStable],
    ['clippedPower', clippedPower],
    ['visiblePowerMarker', visiblePowerMarker],
    ['insetFill', insetFill],
    ['keys', keys],
    ['clickable', clickable],
    ['compactModuleControls', compactModuleControls],
    ['storeTooltips', storeTooltips],
    ['sharedPanels', sharedPanels],
    ['rebinding', rebinding],
    ['activation', activation],
    ['powerChanges', powerChanges],
    ['constantThrusterPower', constantThrusterPower],
    ['animatedUsage', animatedUsage],
    ['settledUsage', settledUsage],
    ['wholePixelPower', wholePixelPower],
    ['matchingDividers', matchingDividers],
    ['travel', travel],
    ['gateRoute', gateRoute],
    ['targetArtwork', targetArtwork],
    ['hidden', hidden],
    ['cleared', cleared],
    ...Object.entries(details),
  ]);
};
