// Browser expressions used by the gameplay performance runner.
// The production fixture compiles these with the same property/tag transforms as the game.
import { summarizeFrameIntervals } from './frame-metrics.ts';

/*
 * Keep each combatant's evidence separate. Initial projectiles and a cooldown
 * already running at capture start cannot establish a new firing cycle.
 */
export function createCombatObservations() {
  type Ship = {
    id: number;
    playerId: number;
    role: string;
    definition: string;
    position: { x: number; y: number };
    visible: boolean;
    alive: boolean;
    firing: boolean;
    health?: number;
    ammunition: number;
    cooldowns: { id: number; remaining: number }[];
  };

  const records = new Map<
    number,
    {
      ship: Ship;
      origin: { x: number; y: number };
      previous: { x: number; y: number };
      samples: number;
      visible: number;
      alive: number;
      firing: number;
      movement: number;
      path: number;
      healthStart?: number;
      healthMin?: number;
      ammoStart: number;
      projectiles: Set<number>;
      cooldowns: Map<number, number>;
      cycles: number;
    }
  >();

  const initialProjectiles = new Set<number>();
  let started = false;

  return {
    observe({
      ships,
      projectiles,
    }: {
      ships: Ship[];
      projectiles: { id: number; playerId?: number }[];
    }) {
      if (!started) {
        projectiles.forEach((projectile) =>
          initialProjectiles.add(projectile.id),
        );
        started = true;
      }

      for (const ship of ships) {
        let record = records.get(ship.id);

        if (!record) {
          record = {
            ship,
            origin: { ...ship.position },
            previous: { ...ship.position },
            samples: 0,
            visible: 0,
            alive: 0,
            firing: 0,
            movement: 0,
            path: 0,
            healthStart: ship.health,
            healthMin: ship.health,
            ammoStart: ship.ammunition,
            projectiles: new Set(),
            cooldowns: new Map(),
            cycles: 0,
          };

          records.set(ship.id, record);
        }

        record.ship = ship;
        record.samples++;
        record.visible += Number(ship.visible);
        record.alive += Number(ship.alive);
        record.firing += Number(ship.firing);
        record.movement = Math.max(
          record.movement,
          Math.hypot(
            ship.position.x - record.origin.x,
            ship.position.y - record.origin.y,
          ),
        );
        record.path += Math.hypot(
          ship.position.x - record.previous.x,
          ship.position.y - record.previous.y,
        );
        record.previous = { ...ship.position };

        if (ship.health !== undefined) {
          record.healthStart ??= ship.health;
          record.healthMin = Math.min(
            record.healthMin ?? ship.health,
            ship.health,
          );
        }

        for (const projectile of projectiles) {
          if (
            projectile.playerId === ship.playerId &&
            !initialProjectiles.has(projectile.id)
          ) {
            record.projectiles.add(projectile.id);
          }
        }

        for (const cooldown of ship.cooldowns) {
          const previous = record.cooldowns.get(cooldown.id);

          if (previous !== undefined && cooldown.remaining > previous + 1e-6) {
            record.cycles++;
          }

          record.cooldowns.set(cooldown.id, cooldown.remaining);
        }
      }
    },
    summary: () =>
      [...records.values()].map((record) =>
        Object.fromEntries([
          ['ship-id', record.ship.id],
          ['player-id', record.ship.playerId],
          ['role', record.ship.role],
          ['ship-type', record.ship.definition],
          ['samples', record.samples],
          ['visible-samples', record.visible],
          ['alive-samples', record.alive],
          ['firing-samples', record.firing],
          ['movement', record.movement],
          ['path-distance', record.path],
          ['hp-start', record.healthStart ?? null],
          ['hp-end', record.ship.health ?? null],
          ['hp-min', record.healthMin ?? null],
          [
            'hp-decrease',
            record.healthStart === undefined || record.healthMin === undefined
              ? null
              : Math.max(0, record.healthStart - record.healthMin),
          ],
          ['ammo-start', record.ammoStart],
          ['ammo-end', record.ship.ammunition],
          [
            'rounds-used',
            Math.max(0, record.ammoStart - record.ship.ammunition),
          ],
          ['new-projectile-ids', [...record.projectiles]],
          ['new-cooldown-cycles', record.cycles],
        ]),
      ),
  };
}

export const setupGameplay = `(async () => {
  window.loadedGameModule = (name) =>
    import(
      performance
        .getEntriesByType('resource')
        .find((entry) =>
          new URL(entry.name).pathname.endsWith('/src/client/' + name),
        ).name
    );
  const { default: gameplay } = await loadedGameModule('gameplay.ts');
  const { network } = await loadedGameModule('network/network.ts');
  await network.authenticated;
  if (!network.displayName) await network.createProfile(new URLSearchParams(location.search).get('scenario') === 'pirate' ? 'Render pirate' : 'Perf pilot');
  await gameplay.start();
  const { ui } = await loadedGameModule('ui/dom/ui.ts');
  ui.clear();
  return {
    viewport: [innerWidth, innerHeight],
    canvas: [game.canvas.width, game.canvas.height],
    zoom: game.size,
    ship: {
      id: player.ship.id,
      position: player.ship.position,
      modules: player.ship.moduleStates,
      cargoContents: player.ship.cargoContents.map((o) => ({
        id: o.id,
        definitionId: o.definitionId,
      })),
      credits: player.credits,
      docked: Boolean(player.ship.dockedTo),
    },
    kinds: game.sprites.reduce(
      (r, o) => ((r[o.kind] = (r[o.kind] || 0) + 1), r),
      {},
    ),
  };
})()`;

export const createGameplayWorkload = ({
  flight = false,
  large = false,
} = {}) => `(async () => {
  const module = (name) => loadedGameModule(name);
  const { createPlayerShip } = await module('objects/create-ship.ts');
  const { createAsteroid } = await module('objects/asteroid.ts');
  const { Item } = await module('objects/item.ts');
  const { Autogun } = await module('objects/modules/index.ts');
  const { Station } = await module('objects/station.ts');
  const { PredictionManager } = await module('prediction/prediction.ts');
  const { addEntity, addPlayer } = await module('simulation/world.ts');
  const { adoptPlayerShip } = await module('player.ts');
  const { centerCamera } = await module('camera.ts');
  const { effects } = await module('effects/effect.ts');
  const { sparks } = await module('effects/shrapnel.ts');
  const { autogunAmmo } = await import('/src/specs/items/index.ts');
  const { simulationStep } = await import('/src/specs/simulation.ts');
  const { ui } = await module('ui/dom/ui.ts');
  ui.clear();
  network.socket.onmessage = network.socket.onclose = null;
  network.socket.close();
  // Keep normal gameplay presentation, including the HUD, active offline.
  network.connected = true;
  network.asteroidPositions = [];
  network.entityRecords.clear();
  network.takeEvents();
  network.takeSounds();
  effects.splice(0);
  sparks.splice(0);
  game.sprites.splice(0);
  game.crafts.splice(0);
  const world = network.world;
  world.entities.clear();
  world.players.clear();
  world.tick = 0;
  world.nextEntityId = 1;
  world.random.state = 1;
  const ship = addEntity(
    world,
    createPlayerShip(world, { id: 1, playerId: 1 }),
  );
  addPlayer(world, { id: 1, shipId: 1 });
  ship.fit(new Autogun({ id: -100 }), ship.mounts[0]);
  ship.cargoContents.push(new Item(autogunAmmo, { id: 500 }));
  addEntity(
    world,
    new Station({ world, id: 2, position: { x: ${large ? 4000 : 1400}, y: ${flight || large ? 1800 : 0} }, spin: 0.01 }),
  );
  for (let i = 0; i < ${large ? 4 : 48}; i++) {
    const angle = i * 2.399963229728653;
    const radius = 230 + (i % 6) * 125;
    addEntity(
      world,
      createAsteroid(world, {
        id: 1000 + i,
        position: ${large ? '{x: [900,0,-1100,0][i], y: [0,800,0,-900][i]}' : '{ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }'},
        radius: ${large ? 'i % 2 ? 500 : 600' : '50 + (i % 4) * 20'},
        spin: ((i % 3) - 1) * 0.1,
        contents: [i % 5, (i + 1) % 5, (i + 2) % 5],
      }).lockGeometry(),
    );
  }
  if (${flight}) {
    const rocks = [...world.entities.values()].filter(object => object.kind === 'asteroid');
    const gap = ship.radius + 110 + 16;
    rocks.forEach((rock, index) => {
      const row = Math.floor(index / 8);
      rock.position.x = (index % 8) * 240 - 900;
      rock.position.y = (row % 2 ? 1 : -1) * (gap + Math.floor(row / 2) * 220);
    });
    ship.position.x = -1000;
  }
  centerCamera(game, ship);
  const manager = new PredictionManager({ world });
  manager.setLocalPlayer({ playerId: 1 });
  network.prediction = manager;
  network.shipId = network.playerId = 1;
  adoptPlayerShip({ ship });
  network.remoteMotion.reset();
  const input = {
    hornDrill: false,
    cargoHatch: false,
    searchLight: true,
    shieldGenerator: false,
    thrust: ${flight ? 1 : 0},
    turn: ${flight ? 0 : 1},
    fire: true,
    plasmaActive: false,
    autogunActive: true,
    laserActive: false,
    launch: false,
  };
  let pending = 0;
  window.perfFixture = { events: {}, input, wraps: 0 };
  network.recordInput = () => {};
  network.updateFrame = ({ dt }) => {
    pending += dt;
    let changed = false;
    while (pending >= simulationStep) {
      pending -= simulationStep;
      if (${flight}) {
        // Keep the finite test field beside the moving camera for the full run.
        // Recycle only rocks already outside the viewport, before pose capture.
        world.entities.forEach(rock => {
          if (rock.kind === 'asteroid' && rock.position.x + rock.radius < ship.position.x - 1000) {
            rock.position.x += 1920;
            perfFixture.wraps++;
          }
        });
      }
      const events = manager.step({ input, send: () => {} });
      network.events.push(...events);
      for (const e of events)
        perfFixture.events[e.type] = (perfFixture.events[e.type] || 0) + 1;
      changed = true;
    }
    if (changed) {
      network.asteroidPositions = [...world.entities.values()]
        .filter(object => object.kind === 'asteroid' && !object.dead)
        .map(object => object.position);
    }
    return changed;
  };
  network.predictFrame = () => manager.predictFrame({ elapsed: pending });
  return {
    objects: world.entities.size,
    zoom: game.size,
    ammo: ship.cargoContents[0].rounds,
  };
})()`;

const measurement = `new Promise((resolve) => {
  const captureStartedEpochMs = performance.timeOrigin + performance.now();
  const combat = (${createCombatObservations.toString()})();
  const refreshRate = Reflect.get(window, 'perf-refresh-rate');
  const framePeriod = 1000 / refreshRate;
  let hidden = document.hidden;
  const visibility = () => { hidden ||= document.hidden; };
  document.addEventListener('visibilitychange', visibility);
  const gaps = [],
    durations = [],
    work = [],
    updates = [],
    predictions = [],
    messages = [],
    visibleRocks = [],
    stalls = [],
    fpsWindows = [];
  const fromPosition = {...player.ship.position};
  const fromCamera = {...camera};
  const fromRounds = player.ship.cargoContents.filter(object => object.rounds).reduce((sum, object) => sum + object.rounds, 0);
  const piratePositions = new Map();
  const pirateAmmunition = new Map();
  const predictionDiagnostics = {replays:0,steps:0,mismatchedInputSamples:0,motion:[]};
  const originalReplay = network.prediction.replayTo;
  const originalSimulate = network.prediction.simulate;
  network.prediction.replayTo = function(options){predictionDiagnostics.replays++;return originalReplay.call(this,options)};
  network.prediction.simulate = function(options){predictionDiagnostics.steps++;return originalSimulate.call(this,options)};
  let lastMotionSample = 0;
  let pirateSamples = 0, fightingSamples = 0, pirateFiringSamples = 0, projectileSamples = 0, pirateMovement = 0, pirateProjectileSamples = 0, pirateRoundsUsed = 0, livingPirateSamples = 0;
  const inspectPirates = () => {
    if(performance.now()-lastMotionSample>=100){
      lastMotionSample=performance.now();
      const input=m12.playerInput,wire=m14.unpackPlayerInput(m14.packPlayerInput(input)),server=network.entityRecords.get(network.shipId);
      if(input.thrust!==wire.thrust || input.turn!==wire.turn)predictionDiagnostics.mismatchedInputSamples++;
      predictionDiagnostics.motion.push({at:lastMotionSample,tick:network.world.tick,position:{...player.ship.position},velocity:{...player.ship.velocity},input:{thrust:input.thrust,turn:input.turn,fire:input.fire},wire:{thrust:wire.thrust,turn:wire.turn,fire:wire.fire},server:server&&{position:server.position,thrust:server.thrust,turn:server.turn}});
    }
    const pirates = [...network.world.entities.values()].filter(object => object.kind === 'ship' && object.hostile);
    const projectiles = [...network.world.entities.values()].filter(object => object.kind === 'projectile');
    combat.observe({
      ships: [player.ship, ...pirates].map(ship => {
        const authoritative = network.entityRecords.get(ship.id);
        const position = authoritative?.position || ship.position;
        const health = authoritative?.hullHealth?.reduce((sum, value) => sum + value, 0);
        return {
          id: ship.id,
          playerId: ship.playerId,
          role: ship.id === player.ship.id ? 'player' : 'pirate',
          definition: ship.definitionId === 'courser' ? 'Courser' : ship.definitionId === 'arrow' ? 'Arrow' : !ship.definitionId || ship.definitionId === 'mustang' ? 'Mustang' : ship.name,
          position,
          visible: ship.position.x + ship.radius >= camera.x && ship.position.x - ship.radius <= camera.x + game.width && ship.position.y + ship.radius >= camera.y && ship.position.y - ship.radius <= camera.y + game.height,
          alive: !ship.dead,
          firing: authoritative?.firing ?? ship.firing,
          health,
          ammunition: (authoritative?.cargoContents || ship.cargoContents).reduce((sum, item) => sum + (item.rounds || 0), 0),
          cooldowns: (authoritative?.modules || ship.moduleStates).map(module => ({id: module.id ?? module.mount, remaining: module.fireCooldown || 0})),
        };
      }),
      projectiles: [...network.entityRecords.values()].filter(object => object.kind === 'projectile'),
    });
    if (!pirates.length) return;
    const ids = new Set(pirates.map(object => object.playerId));
    pirateSamples++;
    if (pirates.some(object => !object.dead)) livingPirateSamples++;
    if (pirates.some(object => object.npcState === 'Fighting')) fightingSamples++;
    if (pirates.some(object => object.firing)) pirateFiringSamples++;
    if (projectiles.length) projectileSamples++;
    if (projectiles.some(object => ids.has(object.playerId))) pirateProjectileSamples++;
    for (const pirate of pirates) {
      if (!piratePositions.has(pirate.id)) piratePositions.set(pirate.id, {...pirate.position});
      const before = piratePositions.get(pirate.id);
      pirateMovement = Math.max(pirateMovement, Math.hypot(pirate.position.x-before.x,pirate.position.y-before.y));
      const rounds = pirate.cargoContents.reduce((sum, object) => sum + (object.rounds || 0), 0);
      if (!pirateAmmunition.has(pirate.id)) pirateAmmunition.set(pirate.id, rounds);
      pirateRoundsUsed = Math.max(pirateRoundsUsed, pirateAmmunition.get(pirate.id)-rounds);
    }
  };
  inspectPirates();
  const originalMessage = network.socket.onmessage;
  if (originalMessage) network.socket.onmessage = function (event) {
    const start = performance.now();
    originalMessage.call(this, event);
    messages.push(performance.now() - start);
    inspectPirates();
  };
  let frameStart;
  const originalUpdate = network.updateFrame;
  const originalPredict = network.predictFrame;
  network.updateFrame = function (options) {
    frameStart = performance.now();
    const result = originalUpdate.call(this, options);
    updates.push(performance.now() - frameStart);
    return result;
  };
  network.predictFrame = function (options) {
    const start = performance.now();
    const result = originalPredict.call(this, options);
    predictions.push(performance.now() - start);
    return result;
  };
  const original = network.remoteMotion.sample;
  network.remoteMotion.sample = function (options) {
    const start = performance.now();
    const result = original.call(this, options);
    durations.push(performance.now() - start);
    return result;
  };
  let before, start, windowStart, windowFrames = 0;
  const frame = (now) => {
    if (gaps.length % 30 === 0) {
      visibleRocks.push(game.sprites.filter(rock => rock.kind === 'asteroid'
        && rock.position.x + rock.radius >= camera.x
        && rock.position.x - rock.radius <= camera.x + game.width
        && rock.position.y + rock.radius >= camera.y
        && rock.position.y - rock.radius <= camera.y + game.height).length);
      inspectPirates();
    }
    if (frameStart !== undefined) work.push(performance.now() - frameStart);
    if (before !== undefined) {
      gaps.push(now - before);
      if(now-before>=framePeriod*1.5) stalls.push([now-start,now-before,work.at(-2),work.at(-1),updates.at(-1),predictions.at(-1)]);
    }
    start ??= now;
    windowStart ??= now;
    if (before !== undefined) windowFrames++;
    if (now - windowStart >= 1000) {
      fpsWindows.push(windowFrames * 1000 / (now - windowStart));
      windowStart = now;
      windowFrames = 0;
    }
    before = now;
    if (now - start < 10000) requestAnimationFrame(frame);
    else {
      document.removeEventListener('visibilitychange', visibility);
      network.remoteMotion.sample = original;
      network.updateFrame = originalUpdate;
      network.predictFrame = originalPredict;
      network.socket.onmessage = originalMessage;
      network.prediction.replayTo = originalReplay;
      network.prediction.simulate = originalSimulate;
      const stats = (values) => {
        const sorted = values.toSorted((a, b) => a - b);
        return {
          mean: values.reduce((s, x) => s + x, 0) / values.length,
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)],
          max: sorted.at(-1),
        };
      };
      const timing = (${summarizeFrameIntervals.toString()})({intervals:gaps,refreshRate});
      resolve({
        hidden,
        ...timing,
        fpsWindows: [Math.min(...fpsWindows), ...fpsWindows],
        stalls,
        frameWorkMs: stats(work),
        update: stats(updates),
        prediction: stats(predictions),
        messages: stats(messages),
        messageCount: messages.length,
      visibleRocks: [Math.min(...visibleRocks), visibleRocks.reduce((a,b)=>a+b,0)/visibleRocks.length, visibleRocks.at(-1)],
      viewport: [innerWidth, innerHeight],
        canvas: [game.canvas.width, game.canvas.height],
        zoom: game.size,
        position: player.ship.position,
        movement: Math.hypot(player.ship.position.x - fromPosition.x, player.ship.position.y - fromPosition.y),
        cameraMovement: Math.hypot(camera.x - fromCamera.x, camera.y - fromCamera.y),
        alive: !player.ship.dead,
        kinds: game.sprites.reduce(
          (r, o) => ((r[o.kind] = (r[o.kind] || 0) + 1), r),
          {},
        ),
        events: window.perfFixture?.events,
        rounds: player.ship.cargoContents
          .filter((o) => o.rounds)
          .reduce((sum, o) => sum + o.rounds, 0),
        roundsUsed: fromRounds-player.ship.cargoContents.filter(object => object.rounds).reduce((sum, object) => sum + object.rounds, 0),
        ammunitionExhausted: fromRounds>0 && !player.ship.cargoContents.some(object => object.rounds>0),
        pirateRoundsRemaining: Math.min(...[...network.world.entities.values()].filter(object => object.kind === 'ship' && object.hostile).map(pirate=>pirate.cargoContents.reduce((sum, object) => sum + (object.rounds || 0), 0))),
        pirateSamples, fightingSamples, pirateFiringSamples, projectileSamples, pirateMovement, pirateProjectileSamples, pirateRoundsUsed, livingPirateSamples,
        networkOpen: network.socket.readyState === WebSocket.OPEN,
        predictionDiagnostics: Object.fromEntries([
          ['full-replays', predictionDiagnostics.replays],
          ['simulation-steps', predictionDiagnostics.steps],
          ['mismatched-input-samples', predictionDiagnostics.mismatchedInputSamples],
          ['motion-columns', ['page-time-ms', 'world-tick', 'predicted-x', 'predicted-y', 'velocity-x', 'velocity-y', 'input-thrust', 'input-turn', 'input-fire', 'wire-thrust', 'wire-turn', 'wire-fire', 'server-x', 'server-y', 'server-thrust', 'server-turn']],
          ['motion-samples', predictionDiagnostics.motion.map(sample => [sample.at, sample.tick, sample.position.x, sample.position.y, sample.velocity.x, sample.velocity.y, sample.input.thrust, sample.input.turn, Boolean(sample.input.fire), sample.wire.thrust, sample.wire.turn, Boolean(sample.wire.fire), sample.server?.position?.x ?? null, sample.server?.position?.y ?? null, sample.server?.thrust ?? null, sample.server?.turn ?? null])],
        ]),
        combatants: combat.summary(),
        captureStartedEpochMs,
        captureEndedEpochMs: performance.timeOrigin + performance.now(),
      });
    }
  };
  requestAnimationFrame(frame);
})`;

export const measureGameplay = (milliseconds: number) =>
  measurement.replace('10000', String(milliseconds));
