import { createTelemetry } from '../../src/client/ui/dom/telemetry';
import { addEntity, createWorld } from '../../src/client/simulation/world';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { GameObject } from '../../src/client/objects/game-object';
import { Station } from '../../src/client/objects/station';
import { simulationStep } from '../../src/specs/simulation';
import { ui } from '../../src/client/ui/dom/ui';
import { hideUi, saveHideUi } from '../../src/client/ui/dom/graphics';
import * as Vec from '../../src/client/utilities/vector';

export const checkTelemetry = () => {
  const element = document.createElement('div');

  ui.hudElement.append(element);
  const previousHideUi = hideUi;
  const world = createWorld();
  const ship = createPlayerShip(world);
  const target = addEntity(world, new GameObject({ id: 1001, radius: 12.5 }));
  const station = addEntity(
    world,
    new Station({ id: 1002, spin: 0.123456789 }),
  );
  const other = addEntity(world, new Station({ id: 1003 }));

  addEntity(world, ship);
  world.tick = 42;
  Vec.setXY(ship.position, 12.3456789012345, -98.7654321098765);
  Vec.setXY(target.position, ship.position.x + 30, ship.position.y + 40);

  const nearby = addEntity(
    world,
    new GameObject({
      id: 1004,
      position: Vec.create(ship.position.x - 3, ship.position.y - 4),
      radius: 1.25,
    }),
  );

  Vec.setXY(ship.velocity, 1.23456789, -2.3456789);
  ship.rotation = 0.123456789;
  ship.spin = -0.987654321;
  let targetId: number | undefined;
  let connected = true;
  let samples = 0;
  let closestScans = 0;
  const values = world.entities.values.bind(world.entities);

  world.entities.values = () => {
    closestScans++;
    return values();
  };

  const telemetry = createTelemetry({
    element,
    readSample: () => {
      samples++;

      return {
        world,
        shipId: ship.id,
        targetId,
        connected,
        snapshotReceivedAt: 100,
      };
    },
  });

  const panel = element.querySelector<HTMLElement>('.hud-telemetry')!;
  const playerSelector = '.telemetry-player';
  const targetSelector = '.telemetry-target';
  const closestSelector = '.telemetry-closest';
  const parentSelector = '.telemetry-parent';
  const row = (selector: string) => panel.querySelector(selector)!;
  const field = (selector: string, prefix: string) =>
    Array.from(row(selector).children, (line) => line.textContent!)
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length);
  const clock = () =>
    Array.from(
      panel.querySelectorAll('.telemetry-clock > div, .telemetry-frame > div'),
      (line) => line.textContent!,
    );
  const snapshotAge = () => Number(clock()[2].replace(/\D/g, ''));
  const checks: Record<string, boolean> = {};
  let now = 1005;
  const update = () => telemetry.update({ now: (now += 100) });

  try {
    saveHideUi(false);

    const observer = new MutationObserver(() => {});

    observer.observe(panel, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    update();
    checks['off by default, with no sampling or DOM updates'] =
      panel.hidden &&
      samples === 0 &&
      closestScans === 0 &&
      observer.takeRecords().length === 0;
    telemetry.toggle();
    update();
    checks['movement values are readable directly from the visible text'] =
      field(playerSelector, 'Pos ') === '12.346/-98.765' &&
      field(playerSelector, 'Rotation ') === '0.123 rad' &&
      field(playerSelector, 'Native velocity ') === '1.235/-2.346 m/s' &&
      field(playerSelector, 'Native spin ') === '-0.988 rad/s';
    checks['no telemetry values are duplicated in data attributes'] = [
      panel,
      ...panel.querySelectorAll('*'),
    ].every((element) =>
      element.getAttributeNames().every((name) => !name.startsWith('data-')),
    );
    checks[
      'missing presentation omits rendered values instead of inventing zeroes'
    ] =
      panel.querySelector<HTMLElement>('.telemetry-rendered')!.hidden &&
      panel.querySelector('.telemetry-frame')!.childElementCount === 0;
    checks['no target record when nothing is selected'] =
      !panel.querySelector(targetSelector);
    checks[
      'closest object excludes the ship and displays distance and radius'
    ] =
      field(closestSelector, 'Closest object #') === String(nearby.id) &&
      field(closestSelector, 'Distance ') === '5.000 m' &&
      field(closestSelector, 'Radius ') === '1.250 m';
    const count = samples;
    const scans = closestScans;

    const [tick, time] = clock();
    const age = snapshotAge();

    for (let frame = 1; frame <= 60; frame++) {
      telemetry.update({ now: now + (frame * 1000) / 60 + (frame % 2) });
    }

    now += 1000;
    checks[
      'irregular 60 FPS frames produce 30 updates and closest-object scans per second'
    ] = samples === count + 30 && closestScans === scans + 30;
    checks['DOM refresh cannot advance simulation freshness'] =
      tick === 'Simulation tick 42' &&
      tick === clock()[0] &&
      time === 'Simulation time 1 s' &&
      time === clock()[1] &&
      snapshotAge() === age + 1000;

    const visibleSamples = samples;
    const visibleScanCount = closestScans;

    element.hidden = true;
    update();
    checks['hidden HUD skips sampling and closest-object scans'] =
      samples === visibleSamples && closestScans === visibleScanCount;
    element.hidden = false;
    const canvas = document.createElement('canvas');

    canvas.width = 640;
    canvas.height = 400;
    canvas.style.cssText =
      'position:fixed;left:30px;top:40px;width:1280px;height:600px';
    document.body.append(canvas);
    now += 100;

    let frameTime = 16.6666666667;
    let renderTime = 2.3456789;

    targetId = target.id;

    const readPresentation = () => ({
      frameTime,
      renderTime,
      canvas,
      transform: new DOMMatrix([3, 0, 0, 4, -60, 80]),
      playerPose: { position: Vec.create(20, 30), rotation: 0.75 },
      targetPose: { position: Vec.create(-10, 50), rotation: -0.75 },
    });

    telemetry.update({ now, readPresentation });

    checks[
      'timing and transform use CSS viewport pixels independently of world state'
    ] =
      clock().includes('Frame time 16.6666666667 ms') &&
      clock().includes('Render time (CPU) 2.3456789 ms') &&
      clock().includes('Scale 6.000000 px/m') &&
      clock().includes('Offset pos -90.000/160.000 px') &&
      field('.telemetry-rendered .telemetry-player', 'Screen pos ') ===
        '30.000/340.000 px' &&
      field('.telemetry-rendered .telemetry-player', 'Pos ') ===
        '20.000/30.000' &&
      field(playerSelector, 'Pos ') === '12.346/-98.765';
    checks[
      'bold headings separate rendered and simulation poses for both entities'
    ] =
      panel.querySelector('.telemetry-simulation > strong')?.textContent ===
        'Simulation' &&
      panel.querySelector('.telemetry-rendered > strong')?.textContent ===
        'Rendered' &&
      field('.telemetry-simulation .telemetry-player', 'Rotation ') ===
        '0.123 rad' &&
      field('.telemetry-rendered .telemetry-player', 'Rotation ') ===
        '0.750 rad' &&
      field('.telemetry-simulation .telemetry-target', 'Rotation ') ===
        '0.000 rad' &&
      field('.telemetry-rendered .telemetry-target', 'Rotation ') ===
        '-0.750 rad' &&
      field('.telemetry-rendered .telemetry-target', 'Pos ') ===
        '-10.000/50.000' &&
      field('.telemetry-rendered .telemetry-target', 'Screen pos ') ===
        '-150.000/460.000 px';
    checks['target distance uses simulation positions and its own radius'] =
      field(targetSelector, 'Distance ') === '50.000 m' &&
      field(targetSelector, 'Radius ') === '12.500 m' &&
      field(closestSelector, 'Closest object #') === String(nearby.id);
    nearby.dead = true;
    frameTime = 17;
    renderTime = 2.5;
    now += 100;
    telemetry.update({ now, readPresentation });
    checks['timings omit trailing zeros while retaining measured fractions'] =
      clock().includes('Frame time 17 ms') &&
      clock().includes('Render time (CPU) 2.5 ms');
    checks['closest object updates when the previous closest dies'] =
      field(closestSelector, 'Closest object #') === String(target.id) &&
      field(closestSelector, 'Distance ') === '50.000 m' &&
      field(closestSelector, 'Radius ') === '12.500 m';
    canvas.parentNode!.removeChild(canvas);
    saveHideUi(true);
    const content = panel.textContent;

    checks['hide UI preserves readable telemetry and layout in the DOM'] =
      getComputedStyle(ui.hudElement).opacity === '0' &&
      !panel.hidden &&
      panel.isConnected &&
      panel.textContent === content &&
      panel.getClientRects().length > 0;
    checks['menus and docked UI remain outside the transparent HUD'] =
      getComputedStyle(ui.element).opacity === '1' &&
      Boolean(ui.current && ui.current.element.parentElement === ui.element) &&
      ui.current!.element.closest('.hud-overlay') === null &&
      getComputedStyle(ui.current!.element).opacity === '1';
    const visibleScans = closestScans;

    update();
    checks['transparent telemetry continues updating'] =
      snapshotAge() === now - 100;
    checks['transparent HUD omits object measurements and skips the scan'] =
      closestScans === visibleScans &&
      !panel.querySelector(closestSelector) &&
      field(targetSelector, 'Distance ') === undefined &&
      field(targetSelector, 'Radius ') === undefined;
    saveHideUi(false);
    checks['UI opacity can be restored'] =
      getComputedStyle(ui.hudElement).opacity === '1';
    targetId = target.id;
    update();
    checks['target changes use simulation entity IDs'] =
      field(targetSelector, 'Target #') === String(target.id);
    ship.localMovementParent = target.localMovementParent = station;
    ship.localMovementRate = 0.543210987;
    target.localMovementRate = 0.765432109;
    update();
    checks['shared parent appears once with its movement values'] =
      panel.querySelectorAll(parentSelector).length === 1 &&
      field(parentSelector, 'Parent #') === String(station.id) &&
      field(parentSelector, 'Pos ') ===
        `${station.position.x.toFixed(3)}/${station.position.y.toFixed(3)}` &&
      field(parentSelector, 'Rotation ') ===
        `${station.rotation.toFixed(3)} rad` &&
      field(parentSelector, 'Native spin ') ===
        `${station.spin.toFixed(3)} rad/s` &&
      field(playerSelector, 'localMovementRate ') ===
        ship.localMovementRate.toFixed(3) &&
      field(targetSelector, 'Carrier #') === String(station.id);
    targetId = station.id;
    update();
    checks['selected parent reuses target record'] =
      !panel.querySelector(parentSelector) &&
      field(targetSelector, 'Target #') === field(playerSelector, 'Carrier #');
    targetId = target.id;
    target.localMovementParent = other;
    update();
    checks['distinct parents have separate records'] =
      panel.querySelectorAll(parentSelector).length === 2;

    target.localMovementParent = station;
    Vec.setXY(target.position, 100, 0);
    const targetRotation = target.rotation;

    target.update(simulationStep);
    world.tick++;
    update();
    checks[
      'station-relative drift is visible with zero native velocity and spin'
    ] =
      target.position.y !== 0 &&
      target.rotation !== targetRotation &&
      field(targetSelector, 'Pos ') ===
        `${target.position.x.toFixed(3)}/${target.position.y.toFixed(3)}` &&
      field(targetSelector, 'Rotation ') ===
        `${target.rotation.toFixed(3)} rad` &&
      field(targetSelector, 'Native velocity ') === '0.000/0.000 m/s' &&
      field(targetSelector, 'Native spin ') === '0.000 rad/s' &&
      field(targetSelector, 'Carrier #') === String(station.id);

    ship.dockedTo = station.id;
    Vec.set(ship.position, station.position);
    Vec.setXY(ship.velocity, 0, 0);
    ship.spin = 0;
    const rotation = ship.rotation;

    ship.update(simulationStep);
    world.tick++;
    update();
    checks['docked station motion stays distinct from zero native motion'] =
      field(playerSelector, 'Native spin ') === '0.000 rad/s' &&
      field(playerSelector, 'Native velocity ') === '0.000/0.000 m/s' &&
      field(playerSelector, 'Carrier #') === String(station.id) &&
      ship.rotation !== rotation &&
      field(playerSelector, 'Rotation ') === `${ship.rotation.toFixed(3)} rad`;
    ship.launch();
    ship.update(simulationStep);
    update();
    checks['undocking retains local motion while still inside station'] =
      !ship.dockedTo &&
      field(playerSelector, 'Carrier #') === String(station.id);
    Vec.setXY(ship.position, 1e6, 1e6);
    ship.update(simulationStep);
    update();
    checks['leaving station removes parent and rate'] =
      field(playerSelector, 'Carrier #') === undefined &&
      field(playerSelector, 'localMovementRate ') === undefined;
    target.dead = true;
    update();
    checks['removed target cannot leak stale coordinates'] =
      row(targetSelector).textContent === 'Target: unavailable' &&
      field(targetSelector, 'Pos ') === undefined;
    connected = false;
    update();
    checks['disconnection is explicit and clears movement records'] =
      row(playerSelector).textContent === 'Player: unavailable' &&
      row(targetSelector).textContent === 'Target: unavailable' &&
      !panel.querySelector(parentSelector) &&
      !panel.querySelector(closestSelector);
    telemetry.toggle();
    observer.takeRecords();
    const stopped = samples;

    update();
    checks['disabling stops all sampling and DOM updates'] =
      panel.hidden &&
      samples === stopped &&
      observer.takeRecords().length === 0;
    observer.disconnect();
    return checks;
  } finally {
    saveHideUi(previousHideUi);
    element.parentNode!.removeChild(element);
  }
};
