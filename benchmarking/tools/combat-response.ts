import {
  muzzleOnset,
  projectileOnset,
  steeringOnset,
  type ResponseFrame,
} from './input-response-metrics.ts';
import { summarizeSnapshotTraffic } from './snapshot-traffic-metrics.ts';

// Browser module exports and automation replies have heterogeneous shapes.
type BrowserValue = Record<string, any>;
type Send = (method: string, params?: object) => Promise<BrowserValue>;

/*
 * Provision the real server-owned weapon through the normal docking actions.
 * The launch helper used by historical steering tests launches too early to
 * buy equipment, so this path finishes its purchases before entering flight.
 */
export async function prepareCombatGameplay({ pilot }: { pilot: boolean }) {
  const page = window as unknown as BrowserValue;

  page.loadedGameModule = (name: string) =>
    import(
      performance
        .getEntriesByType('resource')
        .find((entry) =>
          new URL(entry.name).pathname.endsWith('/src/client/' + name),
        )?.name || '/src/client/' + name
    );
  const load = page.loadedGameModule;
  const { default: gameplay } = await load('gameplay.ts');
  const { network } = await load('network/network.ts');

  await network.authenticated;

  if (!network.displayName) await network.createProfile('Combat benchmark');
  await gameplay.start();
  const { ui } = await load('ui/dom/ui.ts');
  const { player } = await load('player.ts');
  const { playerInput } = await load('input/input.ts');
  let diagnostic = (): BrowserValue => ({});

  const wait = async (condition: () => boolean, name: string) => {
    const began = performance.now();

    while (!condition()) {
      if (performance.now() - began > 15000) {
        throw Error(name + ' timed out: ' + JSON.stringify(diagnostic()));
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  ui.clear();

  if (pilot) {
    // The local server fixture changes only fresh-player spawn to a docked
    // starter ship. Weapons and ammunition still use normal purchases below.
    await wait(
      () => Boolean(network.world.entities.get(network.shipId)?.dockedTo),
      'authoritative docked spawn fixture',
    );
    const { Autogun, moduleTypes } = await load('objects/modules/index.ts');
    const ship = () => network.world.entities.get(network.shipId);
    const confirmed = () => !Reflect.get(network, 'pendingDockActions').length;
    const packets: BrowserValue[] = [];
    const requests: BrowserValue[] = [];
    const receive = network.receive.bind(network);
    const send = network.send.bind(network);

    network.receive = (...args: BrowserValue[]) => {
      const [options] = args;
      const message = options.message;

      if (message.type === 'load' || message.type === 'snapshot') {
        packets.push({
          tick: message.serverTick,
          ack: message.acknowledgedDockSequence,
          own: message.fullEntities.find(
            (entity: BrowserValue) => entity.id === network.shipId,
          ),
        });
      }

      return receive(...args);
    };

    network.send = (...args: BrowserValue[]) => {
      const [message] = args;

      if (message.type === 'dock') requests.push(message);
      return send(...args);
    };

    diagnostic = () => {
      const authoritative = Reflect.get(network, 'authoritativeEntities').get(
        network.shipId,
      );

      const summarize = (value: BrowserValue) => ({
        id: value.id,
        dockedTo: value.dockedTo,
        cargo: value.cargoContents.map((item: BrowserValue) => ({
          id: item.id,
          definitionId: item.definitionId,
          gun: item instanceof Autogun,
        })),
        modules: value.moduleStates,
      });

      return {
        shipId: network.shipId,
        playerShipId: player.ship.id,
        credits: player.credits,
        moduleIndex: moduleTypes.indexOf(Autogun),
        pending: Reflect.get(network, 'pendingDockActions'),
        own: summarize(ship()),
        authoritative: summarize(authoritative),
        requests,
        packets: packets.filter((packet) => packet.own).slice(-3),
      };
    };

    const purchase = network.applyCraftAction(ship(), {
      action: 'buy',
      module: moduleTypes.indexOf(Autogun),
    });

    if (!purchase) throw Error('Could not buy the benchmark autogun');
    await wait(
      () =>
        confirmed() &&
        ship().cargoContents.some(
          (item: BrowserValue) => item instanceof Autogun,
        ),
      'authoritative weapon purchase',
    );
    const gun = ship().cargoContents.find(
      (item: BrowserValue) => item instanceof Autogun,
    );
    const mount = ship().mounts.findIndex((value: BrowserValue) =>
      value.fits.includes(Autogun),
    );

    if (
      !gun ||
      mount < 0 ||
      !network.applyCraftAction(ship(), {
        action: 'equip',
        moduleId: gun.id,
        mount,
      })
    ) {
      throw Error(
        'Could not equip the purchased autogun: ' +
          JSON.stringify({
            definitionId: ship().definitionId,
            gun: gun && { id: gun.id, definitionId: gun.definitionId },
            mount,
            cargo: ship().cargoContents.map((item: BrowserValue) => ({
              id: item.id,
              definitionId: item.definitionId,
              type: item.constructor.name,
            })),
            mounts: ship().mounts.map((value: BrowserValue) => ({
              fits: value.fits.map((Type: BrowserValue) => Type.definitionId),
              module: value.module?.definitionId,
            })),
          }),
      );
    }

    await wait(
      () => confirmed() && ship().mounts[mount].module instanceof Autogun,
      'authoritative weapon fitting',
    );

    if (!network.applyCraftAction(ship(), { action: 'buyAmmo' })) {
      throw Error('Could not buy benchmark ammunition from station stock');
    }

    await wait(
      () =>
        confirmed() &&
        ship().cargoContents.some((item: BrowserValue) => item.rounds > 0),
      'authoritative ammunition purchase',
    );

    if (
      !ship().modules.some(
        (module: BrowserValue) => module instanceof Autogun,
      ) ||
      !ship().cargoContents.some((item: BrowserValue) => item.rounds > 0)
    ) {
      throw Error('Server did not confirm the armed loadout');
    }

    network.receive = receive;
    network.send = send;
  }

  await wait(() => {
    playerInput.launch = Boolean(player.ship.dockedTo);
    network.recordInput({ input: playerInput });
    return !player.ship.dockedTo && !player.ship.launching;
  }, 'normal launch');

  playerInput.launch = false;
  network.recordInput({ input: playerInput });
  return { shipId: network.shipId, playerId: network.playerId };
}

/*
 * Observe completed game draws, trusted DOM edges, and the normal send path.
 * Render hooks preserve their arguments and return values. No gameplay state
 * or snapshot is synthesized for the measurement.
 */
export async function installCombatProbe({
  pilotShipId,
  pilotPlayerId,
}: {
  pilotShipId: number;
  pilotPlayerId: number;
}) {
  const page = window as unknown as BrowserValue;
  const load = page.loadedGameModule;
  const { network } = await load('network/network.ts');
  const { playerInput } = await load('input/input.ts');
  const { Ship } = await load('objects/ship.ts');
  const { Projectile } = await load('objects/projectile.ts');
  const { Autogun } = await load('objects/modules/index.ts');
  const { Weapon } = await load('objects/modules/weapon.ts');
  const { effects } = await load('effects/effect.ts');
  const { game } = await load('game.ts');

  if (network.shipId !== pilotShipId) {
    const { setSizing } = await load('ui/set-sizing.ts');

    game.size = 5;
    setSizing(game);
  }

  const timestamp = () => performance.timeOrigin + performance.now();

  const capture: BrowserValue = {
    startedAt: timestamp(),
    shipId: network.shipId,
    playerId: network.playerId,
    pilotShipId,
    pilotPlayerId,
    frames: [],
    edges: [],
    messages: [],
    shots: [],
    trials: [],
    finished: false,
  };

  let activeTrial: BrowserValue | undefined;
  let latest: BrowserValue | undefined;
  let serial = 0;
  const pendingDraws: BrowserValue[] = [];
  const pendingMuzzleDraws: BrowserValue[] = [];
  const seenProjectiles = new Set<number>();
  const markedEffects = new WeakSet<object>();
  let currentEffect: BrowserValue | undefined;
  let effectSequence = 0;

  const viewport = (
    ctx: BrowserValue,
    radius: number,
    point = { x: 0, y: 0 },
  ) => {
    const transform = ctx.getTransform?.() || ctx.matrix;

    if (!transform) return { inView: false };
    const x = transform.a * point.x + transform.c * point.y + transform.e;
    const y = transform.b * point.x + transform.d * point.y + transform.f;
    const extent =
      radius *
      Math.max(
        Math.hypot(transform.a, transform.b),
        Math.hypot(transform.c, transform.d),
      );

    return {
      inView:
        x + extent >= 0 &&
        y + extent >= 0 &&
        x - extent <= ctx.canvas.width &&
        y - extent <= ctx.canvas.height,
      screenX: x,
      screenY: y,
      screenRadius: extent,
    };
  };

  for (const method of ['updateVisual', 'presentShot']) {
    const original = Weapon.prototype[method];

    if (!original) continue;

    Weapon.prototype[method] = function (...args: BrowserValue[]) {
      const craft = args[0]?.craft;
      const observe =
        !capture.finished &&
        this.definitionId === 'autogun' &&
        craft?.id === pilotShipId;
      const previous = observe ? new Set(effects) : undefined;
      const result = original.apply(this, args);

      if (previous) {
        for (const effect of effects) {
          if (
            previous.has(effect) ||
            markedEffects.has(effect) ||
            effect.parent?.id !== pilotShipId
          ) {
            continue;
          }

          markedEffects.add(effect);

          const marker = {
            id: ++effectSequence,
            trialId: activeTrial?.id,
            createdAt: timestamp(),
          };

          const iterate = effect.parts[Symbol.iterator].bind(effect.parts);

          effect.parts[Symbol.iterator] = function* () {
            const previousEffect = currentEffect;

            try {
              for (const part of iterate()) {
                const age = effect.age - (part.delay ?? 0);
                const progress = age / part.duration;
                const eased = part.easeOut
                  ? 1 - (1 - progress) ** part.easeOut
                  : progress;
                const [start, end] = part.scale ?? [1, 1];
                const radius = part.radius * (start + (end - start) * eased);

                currentEffect = {
                  ...marker,
                  radius:
                    part.type === 'polygon'
                      ? 2
                      : radius +
                        Math.max(part.lineWidth ?? 0, part.endLineWidth ?? 0) /
                          2,
                };

                yield part;
              }
            } finally {
              currentEffect = previousEffect;
            }
          };
        }
      }

      return result;
    };
  }

  const drawingPrototypes = new Set([
    CanvasRenderingContext2D.prototype,
    Object.getPrototypeOf(game.ctx),
  ]);

  for (const prototype of drawingPrototypes) {
    for (const method of ['fill', 'stroke', 'fillRect']) {
      const original = prototype[method];

      if (!original) continue;

      prototype[method] = function (...args: unknown[]) {
        const result = original.apply(this, args);

        if (!capture.finished && currentEffect && this === game.ctx) {
          pendingMuzzleDraws.push({
            ...currentEffect,
            at: timestamp(),
            method,
            alpha: this.globalAlpha,
            ...viewport(this, currentEffect.radius),
          });
        }

        return result;
      };
    }
  }

  const state = () => {
    const ship = network.world.entities.get(pilotShipId);
    const gun = ship?.modules.find(
      (module: BrowserValue) => module instanceof Autogun,
    );
    const parts = gun ? ship.segmentsAtMount(gun.mount) : [];
    const frames = capture.frames.slice(-3);
    const angle = (value: number) =>
      Math.atan2(Math.sin(value), Math.cos(value));
    const settled =
      frames.length === 3 &&
      frames.every(
        (frame: BrowserValue) =>
          Math.abs(frame.spin) <= 0.005 &&
          Math.abs(angle(frame.rotation - frames[0].rotation)) <= 0.0001,
      );
    const ammunition =
      ship?.cargoContents.reduce(
        (total: number, item: BrowserValue) => total + (item.rounds || 0),
        0,
      ) || 0;
    const ready = Boolean(
      network.connected &&
      ship &&
      !ship.dead &&
      !ship.dockedTo &&
      !ship.launching &&
      gun &&
      gun.mount.health > 0 &&
      gun.fireCooldown <= 1e-9 &&
      gun.chargeCooldown <= 1e-9 &&
      parts.length &&
      parts.every(
        (part: BrowserValue) =>
          part.active === 1 && part.activationProgress === 1,
      ) &&
      ammunition > 0,
    );

    return {
      at: timestamp(),
      connected: network.connected,
      settled,
      turn: playerInput.turn,
      fire: Boolean(playerInput.fire),
      ready,
      ammunition,
      gun: gun && {
        id: gun.id,
        fireCooldown: gun.fireCooldown,
        chargeCooldown: gun.chargeCooldown,
        parts: parts.map((part: BrowserValue) => ({
          active: part.active,
          activationProgress: part.activationProgress,
        })),
      },
      frames: frames.length,
      // Wait for old rounds to leave the rendered view before a new firing
      // trial, avoiding a late first draw of an earlier shot being misattributed.
      visibleProjectiles: frames
        .flatMap((frame: BrowserValue) => frame.projectileDraws)
        .filter((draw: BrowserValue) => draw.inView !== false).length,
    };
  };

  const edge = (event: KeyboardEvent) => {
    if (capture.finished || !activeTrial || event.repeat) return;

    if (!['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) return;

    capture.edges.push({
      trialId: activeTrial.id,
      type: event.type,
      key: event.key,
      code: event.code,
      trusted: event.isTrusted,
      at: performance.timeOrigin + event.timeStamp,
      handledAt: timestamp(),
      state: state(),
    });
  };

  addEventListener('keydown', edge, true);
  addEventListener('keyup', edge, true);
  const send = network.send.bind(network);
  const receive = network.receive.bind(network);

  network.send = (...args: BrowserValue[]) => {
    const [message] = args;

    if (
      !capture.finished &&
      (message.type === 'input' || message.type === 'snapshotAck')
    ) {
      capture.messages.push({
        ...message,
        at: timestamp(),
        trialId: activeTrial?.id,
      });
    }

    return send(...args);
  };

  network.receive = (...args: BrowserValue[]) => {
    const [options] = args;
    const message = options.message;

    if (
      !capture.finished &&
      (message.type === 'snapshot' || message.type === 'load')
    ) {
      capture.messages.push({
        at: timestamp(),
        type: message.type,
        serverTick: message.serverTick,
        snapshotSequence: message.snapshotSequence,
        acknowledgedSequence: message.acknowledgedSequence,
        inputLead: message.inputLead,
      });
    }

    return receive(...args);
  };

  const fire = Ship.prototype.fireWeapons;

  Ship.prototype.fireWeapons = function (...args: unknown[]) {
    const observe =
      !capture.finished &&
      activeTrial?.kind === 'fire' &&
      this.id === pilotShipId;
    const before = observe ? new Set(this.world.entities.keys()) : undefined;
    const result = fire.apply(this, args);

    if (before) {
      this.world.entities.forEach((object: BrowserValue) => {
        if (
          object.kind === 'projectile' &&
          object.playerId === pilotPlayerId &&
          !before.has(object.id)
        ) {
          capture.shots.push({
            id: object.id,
            at: timestamp(),
            tick: this.world.tick,
            trialId: activeTrial!.id,
            prediction: this.world !== network.world,
          });
        }
      });
    }

    return result;
  };

  const render = Projectile.prototype.render;

  Projectile.prototype.render = function (...args: unknown[]) {
    const pose = (args[0] as BrowserValue | undefined)?.pose || this;
    const bounds = viewport(game.ctx, this.renderRadius, pose.position);
    const result = render.apply(this, args);

    if (
      !capture.finished &&
      this.playerId === pilotPlayerId &&
      this.definitionId === 'autogun'
    ) {
      pendingDraws.push({
        id: this.id,
        at: timestamp(),
        position: { ...this.position },
        ...bounds,
      });

      seenProjectiles.add(this.id);
    }

    return result;
  };

  const sample = network.remoteMotion.sample.bind(network.remoteMotion);

  network.remoteMotion.sample = (...args: BrowserValue[]) => {
    const [options] = args;
    const poses = sample(...args);
    const ship =
      options.predicted.entities.get(pilotShipId) ||
      options.world.entities.get(pilotShipId);
    const pose = poses.get(pilotShipId) || ship;
    const renderAt = timestamp();

    if (pose) {
      latest = {
        serial: ++serial,
        at: performance.timeOrigin + options.now,
        rotation: pose.rotation,
        spin: ship?.spin || 0,
        tick: network.world.tick,
        serverTick: network.serverTick,
        hidden: document.hidden,
        position: { ...pose.position },
        sampleStartedAt: renderAt,
        renderAt,
      };
    }

    return poses;
  };

  const record = () => {
    if (latest && latest.serial !== capture.frames.at(-1)?.serial) {
      capture.frames.push({
        ...latest,
        completedAt: timestamp(),
        projectileDraws: pendingDraws.splice(0),
        muzzleDraws: pendingMuzzleDraws.splice(0),
      });
    }

    if (!capture.finished) requestAnimationFrame(record);
  };

  requestAnimationFrame(record);

  page.combatProbe = {
    state,
    begin(trial: BrowserValue) {
      activeTrial = {
        ...trial,
        state: state(),
        at: timestamp(),
        previousIds: [...seenProjectiles],
      };

      capture.trials.push(activeTrial);
      return activeTrial;
    },
    finish() {
      capture.finishedAt = timestamp();
      capture.finished = true;

      return {
        ...capture,
        errors: page.inputBenchmarkErrors,
        userAgent: navigator.userAgent,
      };
    },
  };
}

/*
 * Run repeated from-rest steering and ready-weapon trials. A timeout still
 * produces a recorded trial and a real key edge, with its failed readiness
 * preserved beside any missing response.
 */
export async function runCombatResponse({
  clients,
  evaluate,
  active,
  delay,
  browserName,
}: {
  clients: Send[];
  evaluate: (send: Send, expression: string) => Promise<any>;
  active: { shipId: number; playerId: number }[];
  delay: number;
  browserName: string;
}) {
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const options = {
    pilotShipId: active[0].shipId,
    pilotPlayerId: active[0].playerId,
  };

  await Promise.all(
    clients.map((send) =>
      evaluate(
        send,
        `(${installCombatProbe.toString()})(${JSON.stringify(options)})`,
      ),
    ),
  );

  const key = (type: string, key: string) =>
    clients[0]('Input.dispatchKeyEvent', {
      type,
      key,
      code: key === ' ' ? 'Space' : key === 'a' ? 'KeyA' : key,
      ...(key === ' ' && {
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32,
      }),
    });

  await key('keyDown', 'a');
  await key('keyUp', 'a');
  // Move clear of the station before firing through the normal held-input path.
  await key('keyDown', 'ArrowUp');
  await pause(1400);
  await key('keyUp', 'ArrowUp');

  const trials: BrowserValue[] = [];

  for (const kind of ['steering', 'fire']) {
    for (let index = 0; index < 20; index++) {
      const began = performance.now();
      let states: BrowserValue[];
      let readiness: boolean;

      do {
        states = await Promise.all(
          clients.map((send) => evaluate(send, 'combatProbe.state()')),
        );
        readiness =
          states.every((state) => state.connected && state.settled) &&
          states[0].turn === 0 &&
          !states[0].fire &&
          (kind !== 'fire' ||
            (states[0].ready &&
              states.every((state) => state.visibleProjectiles === 0)));

        if (!readiness) await pause(50);
      } while (!readiness && performance.now() - began < 6000);

      const trial = {
        id: trials.length + 1,
        kind,
        direction: index % 2 ? 1 : -1,
        readiness,
        readinessWaitMs: performance.now() - began,
        states,
      };

      await Promise.all(
        clients.map((send) =>
          evaluate(send, `combatProbe.begin(${JSON.stringify(trial)})`),
        ),
      );
      const button =
        kind === 'fire'
          ? ' '
          : trial.direction > 0
            ? 'ArrowRight'
            : 'ArrowLeft';

      await key('keyDown', button);
      await pause(kind === 'fire' ? 80 : 150);
      await key('keyUp', button);
      await pause(200 + (index % 3) * 37);
      trials.push(trial);
    }
  }

  await pause(1500 + delay * 2);
  const results: BrowserValue[] = await Promise.all(
    clients.map((send) => evaluate(send, 'combatProbe.finish()')),
  );

  const completed = results[0].trials.map(
    (trial: BrowserValue, index: number) => {
      const edge = results[0].edges.find(
        (edge: BrowserValue) =>
          edge.trialId === trial.id && edge.type === 'keydown',
      );

      if (!edge) {
        return {
          ...trial,
          failure: 'missing-keydown',
          localMs: null as number | null,
          remoteMs: null as number | null,
        };
      }

      const next = results[0].trials[index + 1];
      const endAt = next?.at ?? results[0].frames.at(-1).completedAt;
      const sent = results[0].messages.find(
        (message: BrowserValue) =>
          message.type === 'input' &&
          message.trialId === trial.id &&
          message.at >= edge.at &&
          (trial.kind === 'fire'
            ? message.input.fire
            : message.input.turn === trial.direction),
      );
      const acknowledged =
        sent &&
        results[0].messages.find(
          (message: BrowserValue) =>
            message.acknowledgedSequence >= sent.sequence &&
            message.at >= sent.at,
        );

      const responses = results.map((result, client) => {
        const frames = result.frames as ResponseFrame[];

        return trial.kind === 'steering'
          ? steeringOnset({
              frames,
              edgeAt: edge.at,
              endAt,
              direction: trial.direction,
            })
          : projectileOnset({
              frames,
              edgeAt: edge.at,
              endAt,
              previousIds: result.trials[index].previousIds,
              ...(client === 0 && {
                births: result.shots.filter(
                  (shot: BrowserValue) =>
                    shot.trialId === trial.id && shot.at >= edge.at,
                ),
              }),
            });
      });

      const muzzles = results.map((result) =>
        trial.kind === 'fire'
          ? muzzleOnset({
              frames: result.frames,
              edgeAt: edge.at,
              endAt,
              trialId: trial.id,
            })
          : { ms: null as number | null, reason: null as string | null },
      );

      const feedback = responses.map((response, client) => {
        const values = [response.ms, muzzles[client].ms].filter(
          (value): value is number => value !== null,
        );

        return values.length ? Math.min(...values) : null;
      });

      const shot = results[0].shots.find(
        (shot: BrowserValue) => shot.trialId === trial.id && shot.at >= edge.at,
      );

      return {
        ...trial,
        edgeAt: edge.at,
        handledMs: edge.handledAt - edge.at,
        trusted: edge.trusted,
        inputSendMs: sent ? sent.at - edge.at : null,
        inputAckMs: acknowledged ? acknowledged.at - edge.at : null,
        localShotMs: shot ? shot.at - edge.at : null,
        localMs: responses[0].ms,
        remoteMs: responses[1].ms,
        localMuzzleMs: muzzles[0].ms,
        remoteMuzzleMs: muzzles[1].ms,
        localFeedbackMs: feedback[0],
        remoteFeedbackMs: feedback[1],
        muzzleFailures: muzzles.map((response) => response.reason),
        remoteAmbiguousOldDraws:
          trial.kind === 'fire'
            ? results[1].frames
                .filter(
                  (frame: ResponseFrame) =>
                    frame.completedAt >= edge.at && frame.completedAt <= endAt,
                )
                .flatMap((frame: ResponseFrame) => frame.projectileDraws)
                .filter(
                  (draw: { id: number; at: number }) =>
                    draw.at >= edge.at &&
                    results[1].trials[index].previousIds.includes(draw.id),
                ).length
            : 0,
        responseFailures: responses.map((response) => response.reason),
        endAt,
      };
    },
  );

  const distribution = (values: (number | null)[]) => {
    const observed = values
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    return {
      trials: values.length,
      observed: observed.length,
      missed: values.length - observed.length,
      p50: observed.length ? observed[Math.floor(observed.length / 2)] : null,
      p95: observed.length
        ? observed[Math.ceil(observed.length * 0.95) - 1]
        : null,
      p99: observed.length
        ? observed[Math.ceil(observed.length * 0.99) - 1]
        : null,
      max: observed.at(-1) ?? null,
    };
  };

  const summary = {
    mode: 'repeated-steering-onset-and-ready-autogun-draw',
    browser: browserName,
    clients: clients.length,
    oneWayDelayMs: delay,
    fixture:
      'Local server compiler overlay changes only fresh-player spawn to an authoritative docked starter ship at the nearest station. Autogun fitting and ammunition use normal dock actions; no client weapon or readiness state is injected.',
    timing:
      'Trusted DOM keydown to completed game draw submission; excludes hardware scanout. Steering starts neutral. Fire feedback is the first actual own projectile or nontransparent muzzle-flash draw; local projectile births match the current trial even if speculative IDs are reused. Only the observer zooms out to size5; pilot retains normal size1.5.',
    traffic: results.map((result) =>
      summarizeSnapshotTraffic({
        messages: result.messages,
        start: result.startedAt,
        end: result.finishedAt,
      }),
    ),
    phases: ['steering', 'fire'].map((kind) => {
      const phase = completed.filter(
        (trial: BrowserValue) => trial.kind === kind,
      );

      return {
        kind,
        trials: phase.length,
        readinessFailures: phase.filter(
          (trial: BrowserValue) => !trial.readiness,
        ).length,
        localMs: distribution(
          phase.map((trial: BrowserValue) => trial.localMs),
        ),
        remoteMs: distribution(
          phase.map((trial: BrowserValue) => trial.remoteMs),
        ),
        localMuzzleMs: distribution(
          phase.map((trial: BrowserValue) => trial.localMuzzleMs ?? null),
        ),
        remoteMuzzleMs: distribution(
          phase.map((trial: BrowserValue) => trial.remoteMuzzleMs ?? null),
        ),
        localFeedbackMs: distribution(
          phase.map((trial: BrowserValue) => trial.localFeedbackMs ?? null),
        ),
        remoteFeedbackMs: distribution(
          phase.map((trial: BrowserValue) => trial.remoteFeedbackMs ?? null),
        ),
        remoteAmbiguousTrials: phase.filter(
          (trial: BrowserValue) => trial.remoteAmbiguousOldDraws > 0,
        ).length,
        inputSendMs: distribution(
          phase.map((trial: BrowserValue) => trial.inputSendMs ?? null),
        ),
        inputAckMs: distribution(
          phase.map((trial: BrowserValue) => trial.inputAckMs ?? null),
        ),
        localShotMs: distribution(
          phase.map((trial: BrowserValue) => trial.localShotMs ?? null),
        ),
      };
    }),
    errors: results.map((result) => result.errors),
  };

  return { summary, trials: completed, results };
}
