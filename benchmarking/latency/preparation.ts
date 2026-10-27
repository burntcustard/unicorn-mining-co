import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import {
  dockingControls,
  approachControls,
  stationSafeTarget,
  compatibleWeaponMount,
  neutralInput,
} from '../utilities/ship-controls.ts';
import { installLatencyClient } from './probe.ts';
import type { LatencyPage } from './browser.ts';
import type { ProtocolCatalog } from '../utilities/protocol-runtime.ts';

type Value = Record<string, any>;

/**
 * Enter a deployed game through its normal menu without importing local code.
 */
function advanceBenchmarkMenu() {
  const input = document.querySelector<HTMLInputElement>('#profile-name');

  if (input) {
    if (!input.readOnly) {
      input.value = 'Benchmark pilot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form.requestSubmit();
    }

    return;
  }

  const play = document.querySelector<HTMLButtonElement>(
    '[data-action="play"]',
  );

  if (play && !play.disabled && play.getClientRects().length) {
    play.click();
  }
}

export async function prepareLatencyClients({
  pages,
  properties,
  tags,
  catalog,
  fire,
  timeoutMs,
  progress,
}: {
  pages: LatencyPage[];
  properties: Record<string, string>;
  tags: Record<string, string>;
  catalog: ProtocolCatalog;
  fire: boolean;
  timeoutMs: number;
  progress: (message: string) => void;
}) {
  const began = performance.now();
  const startedAt = new Date().toISOString();
  const deadline = began + timeoutMs;
  let stage = 'normal profile/play and production discovery';

  const evaluate = (page: LatencyPage, expression: string) => {
    const remaining = deadline - performance.now();

    assert(
      remaining > 0,
      `The ${timeoutMs / 1000}s preparation budget expired during ${stage} for client ${pages.indexOf(page)}`,
    );
    return page.evaluate(expression, { timeoutMs: Math.min(5000, remaining) });
  };

  const execute = (page: LatencyPage, method: string, argument?: object) =>
    evaluate(
      page,
      `latencyClient.${method}(${argument ? JSON.stringify(argument) : ''})`,
    );
  const loaded = [false, false, false, false];

  while (!loaded.every(Boolean)) {
    for (let index = 0; index < pages.length; index++) {
      if (loaded[index]) continue;
      await evaluate(pages[index], `(${advanceBenchmarkMenu.toString()})()`);
      loaded[index] = await evaluate(
        pages[index],
        `(${installLatencyClient.toString()})(${JSON.stringify({ properties, tags })})`,
      );
    }

    await pause(150);
  }

  progress(
    'Four real browser identities entered through the normal profile/play menu.',
  );
  const pilot = (await execute(pages[0], 'inspect')) as Value;

  assert(pilot.own, 'The actor has no authoritative ship');

  const preparation: Value = {
    startedAt,
    timeoutMs,
    identities: await Promise.all(
      pages.map((page) => execute(page, 'inspect')),
    ),
    actions: [],
  };

  const until = async (
    page: LatencyPage,
    condition: (state: Value) => boolean,
    label: string,
  ) => {
    stage = label;
    let state: Value;

    while (true) {
      state = await execute(page, 'inspect');

      if (condition(state)) return state;

      if (performance.now() >= deadline) {
        throw Error(`${label}: ${JSON.stringify(state)}`);
      }

      await pause(80);
    }
  };

  const control = (page: LatencyPage, input: object) =>
    execute(page, 'control', input);

  const action = async (
    value: Value,
    materialized: (state: Value) => boolean,
  ) => {
    assert(
      await execute(pages[0], 'action', value),
      `Normal station action rejected locally: ${JSON.stringify(value)}`,
    );
    const confirmed = await until(
      pages[0],
      (state) => state.pendingDockActions === 0 && materialized(state),
      `Station action did not materialize: ${JSON.stringify(value)}`,
    );

    preparation.actions.push({
      action: value,
      confirmed: confirmed.own,
      credits: confirmed.credits,
    });

    return confirmed;
  };

  if (fire) {
    stage = 'physical station docking';
    progress(
      'Navigating the actor into a real station bay to purchase an autogun and ammunition.',
    );
    let entering = false;
    let state = await execute(pages[0], 'inspect');

    while (!state.own.dockedTo) {
      const station = state.entities
        .filter((entity: Value) => entity.kind === 'station')
        .toSorted(
          (a: Value, b: Value) =>
            Math.hypot(
              a.position.x - state.own.position.x,
              a.position.y - state.own.position.y,
            ) -
            Math.hypot(
              b.position.x - state.own.position.x,
              b.position.y - state.own.position.y,
            ),
        )[0];

      assert(station, 'No real station replicated near the actor');
      const definition = catalog.stations[station.definitionId || 'corral-5'];

      assert(
        definition?.dockingBays.length,
        `Unknown station catalog: ${station.definitionId} (client/server catalog mismatch)`,
      );

      const navigation = dockingControls({
        ship: state.own,
        station,
        bayAngles: definition.dockingBays,
        entering,
      });

      entering = navigation.entering;
      await control(pages[0], navigation.input);
      await pause(80);
      state = await execute(pages[0], 'inspect');
    }

    await control(pages[0], neutralInput());
    const ship = state.own;
    const definition = catalog.ships[ship.definitionId || 'mustang'];

    assert(definition, `Unknown ship catalog: ${ship.definitionId}`);

    const mount = compatibleWeaponMount({
      mounts: definition.mounts,
      weapon: 'autogun',
      occupied: ship.modules.map((module: Value) => module.mount),
    });

    assert(mount !== undefined, 'No compatible autogun mount');

    if (ship.modules.some((module: Value) => module.mount === mount)) {
      await action(
        { action: 'remove', mount },
        (state) =>
          !state.own.modules.some((module: Value) => module.mount === mount),
      );
    }

    await action(
      { action: 'buy', module: catalog.moduleIds.indexOf('autogun'), mount },
      (state) =>
        state.own.modules.some(
          (module: Value) =>
            module.mount === mount && module.definitionId === 'autogun',
        ),
    );
    assert(
      catalog.ammoRounds === 200,
      'Latency preparation requires the normal 200-round ammunition item',
    );
    const before = await execute(pages[0], 'inspect');

    assert(
      !before.own.cargoContents.some((object: Value) => object.rounds > 0),
      'The fresh actor unexpectedly already has ammunition',
    );
    const purchased = await action({ action: 'buyAmmo' }, (state) =>
      state.own.cargoContents.some((object: Value) => object.rounds > 0),
    );
    const ammunition = purchased.own.cargoContents.filter(
      (object: Value) => object.rounds > 0,
    );

    assert(
      ammunition.length === 1 && ammunition[0].rounds === 200,
      'The server did not confirm exactly one normal 200-round ammunition item',
    );

    preparation.ammunition = {
      confirmedItems: ammunition.length,
      confirmedRounds: ammunition[0].rounds,
      itemId: ammunition[0].id,
      refill: false,
    };

    progress(
      'Server confirmed the equipped autogun and one normal 200-round ammunition item.',
    );
    // Use the docking screen's own launch action, then its ordinary launch input.
    assert(
      await execute(pages[0], 'launch'),
      'The normal docking screen did not expose Launch',
    );
    await until(
      pages[0],
      (state) => !state.own.dockedTo && !state.own.launching,
      'Normal station launch did not complete',
    );
  }

  const actor = (await execute(pages[0], 'inspect')).own;

  stage = 'launch clearance and observer gathering';
  // Continue out of the launch corridor and then let normal drag settle the
  // actor. Steering/fire trials do not force positions, velocities, or cameras.
  await control(pages[0], { ...neutralInput(), thrust: 1 });
  await pause(1200);
  await control(pages[0], neutralInput());
  await pause(1500);
  const offsets = [
    { x: 0, y: 0 },
    { x: -100, y: -110 },
    { x: -120, y: 0 },
    { x: -100, y: 110 },
  ];

  while (true) {
    const states = await Promise.all(
      pages.map((page) => execute(page, 'inspect')),
    );
    const own = states[0].own;

    assert(own && !own.dead, 'Actor lost its ship during preparation');
    let gathered = true;

    for (let index = 1; index < 4; index++) {
      const ship = states[index].own;

      assert(
        ship && !ship.dead && !ship.dockedTo,
        `Observer ${index} is unavailable`,
      );
      const offset = offsets[index];
      const angle = own.rotation;

      const target = {
        x:
          own.position.x +
          offset.x * Math.cos(angle) -
          offset.y * Math.sin(angle),
        y:
          own.position.y +
          offset.x * Math.sin(angle) +
          offset.y * Math.cos(angle),
      };

      const distance = Math.hypot(
        ship.position.x - target.x,
        ship.position.y - target.y,
      );
      const speed = Math.hypot(ship.velocity?.x || 0, ship.velocity?.y || 0);

      if (distance > 45 || speed > 14) {
        gathered = false;

        await control(
          pages[index],
          approachControls({
            ship,
            target: stationSafeTarget({
              ship,
              target,
              entities: states[index].entities,
            }),
            maxSpeed: 100,
          }),
        );
      } else {
        await control(pages[index], neutralInput());
      }
    }

    if (gathered) break;
    await pause(80);
  }

  await Promise.all(pages.map((page) => control(page, neutralInput())));
  await pause(2000);
  preparation.finishedAt = new Date().toISOString();
  preparation.beforeCapture = await Promise.all(
    pages.map((page) => execute(page, 'inspect')),
  );
  preparation.initialActorPosition = actor.position;
  preparation.elapsedMs = performance.now() - began;

  return {
    preparation,
    pilot: { shipId: pilot.shipId, playerId: pilot.playerId },
  };
}
