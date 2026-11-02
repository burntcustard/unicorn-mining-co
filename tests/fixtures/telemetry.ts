import { createTelemetry } from '../../src/client/ui/dom/telemetry';
import { addEntity, createWorld } from '../../src/client/simulation/world';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { GameObject } from '../../src/client/objects/game-object';
import { Station } from '../../src/client/objects/station';
import { simulationStep } from '../../src/specs/simulation';
import * as Vec from '../../src/client/utilities/vector';

export const checkTelemetry = () => {
  const element = document.createElement('div');

  document.body.append(element);
  const world = createWorld();
  const ship = createPlayerShip(world);
  const target = addEntity(world, new GameObject({ id: 1001 }));
  const station = addEntity(
    world,
    new Station({ id: 1002, spin: 0.123456789 }),
  );
  const other = addEntity(world, new Station({ id: 1003 }));

  addEntity(world, ship);
  world.tick = 42;
  Vec.setXY(ship.position, 12.3456789012345, -98.7654321098765);
  Vec.setXY(ship.velocity, 1.23456789, -2.3456789);
  ship.rotation = 0.123456789;
  ship.spin = -0.987654321;
  let targetId: number | undefined;
  let connected = true;
  let samples = 0;

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
  const parentSelector = '.telemetry-parent';
  const row = (selector: string) => panel.querySelector(selector)!;
  const field = (selector: string, prefix: string) =>
    Array.from(row(selector).children, (line) => line.textContent!)
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length);
  const clock = () =>
    Array.from(panel.firstElementChild!.children, (line) => line.textContent!);
  const snapshotAge = () => Number(clock()[2].replace(/\D/g, ''));
  const checks: Record<string, boolean> = {};
  let now = 1000;
  const update = () => telemetry.update({ now: (now += 100) });

  try {
    const observer = new MutationObserver(() => {});

    observer.observe(panel, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    update();
    checks['off by default, with no sampling or DOM updates'] =
      panel.hidden && samples === 0 && observer.takeRecords().length === 0;
    telemetry.toggle();
    update();
    checks['movement values are readable directly from the visible text'] =
      field(playerSelector, 'Position ') === '12.346\u2009/\u2009-98.765 wu' &&
      field(playerSelector, 'Rotation ') === '0.123 rad' &&
      field(playerSelector, 'Native velocity ') ===
        '1.235\u2009/\u2009-2.346 wu/s' &&
      field(playerSelector, 'Native spin ') === '-0.988 rad/s';
    checks['no telemetry values are duplicated in data attributes'] = [
      panel,
      ...panel.querySelectorAll('*'),
    ].every((element) =>
      element.getAttributeNames().every((name) => !name.startsWith('data-')),
    );
    checks['no selected target is explicit'] =
      row(targetSelector).textContent === 'Target: none selected';
    const count = samples;

    telemetry.update({ now: now + 50 });
    checks['updates limited to 10 Hz'] = samples === count;
    const [tick, time] = clock();
    const age = snapshotAge();

    update();
    checks['DOM refresh cannot advance simulation freshness'] =
      tick === 'Simulation tick 42' &&
      tick === clock()[0] &&
      time === 'Simulation time 1 s' &&
      time === clock()[1] &&
      snapshotAge() === age + 100;
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
      field(parentSelector, 'Position ') ===
        `${station.position.x.toFixed(3)}\u2009/\u2009${station.position.y.toFixed(3)} wu` &&
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
      field(targetSelector, 'Position ') ===
        `${target.position.x.toFixed(3)}\u2009/\u2009${target.position.y.toFixed(3)} wu` &&
      field(targetSelector, 'Rotation ') ===
        `${target.rotation.toFixed(3)} rad` &&
      field(targetSelector, 'Native velocity ') ===
        '0.000\u2009/\u20090.000 wu/s' &&
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
      field(playerSelector, 'Native velocity ') ===
        '0.000\u2009/\u20090.000 wu/s' &&
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
      field(targetSelector, 'Position ') === undefined;
    connected = false;
    update();
    checks['disconnection is explicit and clears movement records'] =
      row(playerSelector).textContent === 'Player: unavailable' &&
      row(targetSelector).textContent === 'Target: unavailable' &&
      !panel.querySelector(parentSelector);
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
    element.parentNode!.removeChild(element);
  }
};
