// Browser expressions used by the gameplay performance runner.
// The production fixture compiles these with the same property/tag transforms as the game.

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
  if (!network.displayName) await network.createProfile('Perf pilot');
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
      cargo: player.ship.cargoContents.map((o) => ({
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
  const { autogunAmmo } = await import('/src/specs/items/index.ts');
  const { simulationStep } = await import('/src/specs/simulation.ts');
  const { ui } = await module('ui/dom/ui.ts');
  ui.clear();
  network.socket.onmessage = network.socket.onclose = null;
  network.socket.close();
  network.connected = false;
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
  for (let i = 0; i < 10; i++)
    ship.cargoContents.push(new Item(autogunAmmo, { id: 500 + i }));
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
  const originalMessage = network.socket.onmessage;
  if (originalMessage) network.socket.onmessage = function (event) {
    const start = performance.now();
    originalMessage.call(this, event);
    messages.push(performance.now() - start);
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
    }
    if (frameStart !== undefined) work.push(performance.now() - frameStart);
    if (before !== undefined) {
      gaps.push(now - before);
      if(now-before>12.5) stalls.push([now-start,now-before,work.at(-2),work.at(-1),updates.at(-1),predictions.at(-1)]);
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
      network.remoteMotion.sample = original;
      network.updateFrame = originalUpdate;
      network.predictFrame = originalPredict;
      network.socket.onmessage = originalMessage;
      const stats = (values) => {
        const sorted = values.toSorted((a, b) => a - b);
        return {
          mean: values.reduce((s, x) => s + x, 0) / values.length,
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)],
          max: sorted.at(-1),
        };
      };
      const sorted = gaps.toSorted((a, b) => a - b);
      resolve({
        fps: (gaps.length * 1000) / gaps.reduce((s, x) => s + x, 0),
        frames: gaps.length,
        fpsWindows: [Math.min(...fpsWindows), ...fpsWindows],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        missed: gaps.filter((x) => x > 12.5).length,
        max: sorted.at(-1),
        stalls,
        cpu: stats(work),
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
      });
    }
  };
  requestAnimationFrame(frame);
})`;

export const measureGameplay = (milliseconds: number) =>
  measurement.replace('10000', String(milliseconds));
