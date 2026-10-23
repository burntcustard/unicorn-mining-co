// Runtime objects from independently emitted production chunks are heterogeneous.
type Value = Record<string, any>;

/*
 * Read existing production objects through the build's property map. Only
 * normal preparation controls and dock actions write game state. Measured
 * inputs always come from the browser's trusted keyboard automation path.
 */
export function installLatencyClient({
  properties,
  tags,
}: {
  properties: Record<string, string>;
  tags: Record<string, string>;
}) {
  const page = window as unknown as Value;

  if (page.latencyClient) return true;
  const refs = [...new Set(page.__latencyRefs || [])] as Value[];
  const get = (object: Value | undefined, name: string): any =>
    object?.[properties[name] || name];
  const literals = Object.fromEntries(
    Object.entries(tags).map(([name, value]) => [value, name]),
  );
  const name = (value: string) => literals[value] || value;
  const key = (name: string) => properties[name] || name;
  const network = refs.find(
    (value) =>
      value &&
      get(get(value, 'world'), 'entities') instanceof Map &&
      typeof get(value, 'recordInput') === 'function',
  );
  const game = refs.find(
    (value) =>
      value &&
      get(value, 'canvas') === document.querySelector('#canvas') &&
      get(value, 'ctx'),
  );
  const input = refs.find(
    (value) =>
      value &&
      typeof get(value, 'thrust') === 'number' &&
      typeof get(value, 'turn') === 'number' &&
      typeof get(value, 'hornDrill') === 'boolean' &&
      Object.keys(value).length < 20,
  );

  if (!network || !game || !input || !get(network, 'connected')) return false;
  const call = (object: Value, method: string, ...args: any[]) =>
    get(object, method).apply(object, args);
  const encode = (value: Value): Value =>
    Object.fromEntries(
      Object.entries(value).map(([field, value]) => [
        key(field),
        typeof value === 'string'
          ? tags[value] || value
          : value && typeof value === 'object' && !Array.isArray(value)
            ? encode(value)
            : value,
      ]),
    );
  const vec = (value: Value) =>
    value && { x: get(value, 'x'), y: get(value, 'y') };
  const entities = () =>
    get(get(network, 'world'), 'entities') as Map<number, Value>;
  const own = () => entities().get(get(network, 'shipId'));

  const summarize = (object: Value) => ({
    id: get(object, 'id'),
    kind: name(get(object, 'kind')),
    definitionId: name(get(object, 'definitionId')),
    position: vec(get(object, 'position')),
    velocity: vec(get(object, 'velocity')),
    rotation: get(object, 'rotation'),
    spin: get(object, 'spin'),
    radius: get(object, 'radius'),
    health: get(object, 'health'),
    dead: Boolean(get(object, 'dead')),
    playerId: get(object, 'playerId'),
    dockedTo: get(object, 'dockedTo'),
    launching: get(object, 'launching'),
    ...(get(object, 'modules') && {
      modules: get(object, 'modules').map((module: Value) => ({
        id: get(module, 'id'),
        definitionId: name(get(module, 'definitionId')),
        mount:
          get(module, 'mount') &&
          get(object, 'mounts').indexOf(get(module, 'mount')),
        fireCooldown: get(module, 'fireCooldown'),
        chargeCooldown: get(module, 'chargeCooldown'),
      })),
    }),
    ...(get(object, 'cargoContents') && {
      cargoContents: get(object, 'cargoContents').map((item: Value) => ({
        id: get(item, 'id'),
        definitionId: name(get(item, 'definitionId')),
        rounds: get(item, 'rounds'),
      })),
    }),
  });

  const control = (value: Value) => {
    Object.entries(encode(value)).forEach(([name, value]) => {
      input[name] = value;
    });

    call(network, 'recordInput', { [key('input')]: input });
  };

  const inspect = () => ({
    at: performance.now(),
    connected: get(network, 'connected'),
    shipId: get(network, 'shipId'),
    playerId: get(network, 'playerId'),
    own: own() && summarize(own()),
    entities: [...entities().values()]
      .filter((object) =>
        ['ship', 'station'].includes(name(get(object, 'kind'))),
      )
      .map(summarize),
    pendingDockActions: get(network, 'pendingDockActions').length,
    credits: get(get(network, 'player'), 'credits'),
    errors: page.__latencyErrors,
    sockets: page.__latencySockets,
  });

  page.latencyClient = {
    inspect,
    control,
    action(action: Value) {
      const ship = own();

      const encoded = encode(action);
      const applied = call(network, 'applyCraftAction', ship, encoded);

      if (!applied) {
        throw Error(
          'Normal dock action rejected: ' +
            JSON.stringify({
              action,
              encoded,
              ship: summarize(ship),
              mounts: get(ship, 'mounts').map((mount: Value) => ({
                health: get(mount, 'health'),
                module: get(get(mount, 'module'), 'definitionId'),
              })),
              properties: { action: key('action'), mount: key('mount') },
            }),
        );
      }

      return true;
    },
    launch() {
      const button = document.querySelector<HTMLButtonElement>('[data-launch]');

      if (button) {
        button.click();
        return true;
      }

      return false;
    },
    install(pilot: { shipId: number; playerId: number }) {
      if (page.latencyProbe) throw Error('Latency probe already installed');
      const Ship = refs.find(
        (value) =>
          typeof value === 'function' &&
          value.prototype &&
          typeof get(value.prototype, 'fireWeapons') === 'function',
      );
      const Projectile = refs.find(
        (value) =>
          typeof value === 'function' &&
          value.prototype &&
          Object.hasOwn(value.prototype, key('resolveHits')),
      );
      const Weapon = refs.find(
        (value) =>
          typeof value === 'function' &&
          value.prototype &&
          Object.hasOwn(value.prototype, key('presentShot')),
      );

      if (!Ship || !Projectile || !Weapon) {
        throw Error(
          'Production class/property discovery failed: rebuild matching dist/source',
        );
      }

      const ctx = get(game, 'ctx');

      const capture: Value = {
        shipId: get(network, 'shipId'),
        playerId: get(network, 'playerId'),
        pilot,
        startedAt: performance.now(),
        frames: [],
        messages: [],
        edges: [],
        shots: [],
        trials: [],
      };

      let activeTrial: Value | undefined;
      let craftDraw: Value | undefined;
      let projectileDraw: Value | undefined;
      let muzzleDraw: Value | undefined;
      let pilotDraw: Value | undefined;
      let frameActive = false;
      const projectiles: Value[] = [];
      const muzzles: Value[] = [];
      const seen = new Set<number>();
      const markedEffects = new WeakSet<object>();
      let effectSequence = 0;

      const viewport = (radius: number, position = { x: 0, y: 0 }) => {
        const matrix = ctx.getTransform?.() || ctx.matrix;

        if (!matrix) return { inView: false };
        const x = matrix.a * position.x + matrix.c * position.y + matrix.e;
        const y = matrix.b * position.x + matrix.d * position.y + matrix.f;
        const extent =
          radius *
          Math.max(
            Math.hypot(matrix.a, matrix.b),
            Math.hypot(matrix.c, matrix.d),
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

      for (const method of ['fill', 'stroke', 'fillRect', 'drawImage']) {
        const original = ctx[method];

        if (!original) continue;

        ctx[method] = function (...args: unknown[]) {
          const result = original.apply(this, args);

          if (capture.finished || this !== ctx || this.globalAlpha <= 0) {
            return result;
          }

          if (craftDraw) craftDraw.drawn = true;

          if (projectileDraw) projectileDraw.drawn = true;

          if (muzzleDraw) {
            muzzles.push({
              ...muzzleDraw,
              at: performance.now(),
              alpha: this.globalAlpha,
              ...viewport(muzzleDraw.radius),
            });
          }

          return result;
        };
      }

      const craftRender = get(Ship.prototype, 'render');

      Ship.prototype[key('render')] = function (...args: Value[]) {
        frameActive = true;
        const previous = craftDraw;
        const pose = get(args[0], 'pose') || this;
        const observe = get(this, 'id') === pilot.shipId;

        if (observe) {
          craftDraw = {
            rotation: get(pose, 'rotation'),
            position: vec(get(pose, 'position')),
            spin: get(this, 'spin'),
            ...viewport(get(this, 'radius'), vec(get(pose, 'position'))),
            drawn: false,
          };
        }

        const result = craftRender.apply(this, args);

        if (observe && craftDraw?.drawn) pilotDraw = craftDraw;
        craftDraw = previous;
        return result;
      };

      const projectileRender = get(Projectile.prototype, 'render');

      Projectile.prototype[key('render')] = function (...args: Value[]) {
        const previous = projectileDraw;
        const observe =
          get(this, 'playerId') === pilot.playerId &&
          name(get(this, 'definitionId')) === 'autogun';
        const pose = get(args[0], 'pose') || this;

        if (observe) {
          projectileDraw = {
            id: get(this, 'id'),
            at: performance.now(),
            ...viewport(get(this, 'renderRadius'), vec(get(pose, 'position'))),
            drawn: false,
          };
        }

        const result = projectileRender.apply(this, args);

        if (observe && projectileDraw?.drawn) {
          projectiles.push(projectileDraw);
          seen.add(projectileDraw.id);
        }

        projectileDraw = previous;
        return result;
      };

      const fireWeapons = get(Ship.prototype, 'fireWeapons');

      Ship.prototype[key('fireWeapons')] = function (...args: unknown[]) {
        const world = get(this, 'world');
        const observe =
          activeTrial?.kind === 'fire' && get(this, 'id') === pilot.shipId;
        const first = observe ? get(world, 'nextEntityId') : 0;
        const result = fireWeapons.apply(this, args);

        if (observe && !capture.finished) {
          const last = get(world, 'nextEntityId');

          for (let id = first; id < last; id++) {
            const entity = get(world, 'entities').get(id);

            if (
              entity &&
              name(get(entity, 'kind')) === 'projectile' &&
              get(entity, 'playerId') === pilot.playerId
            ) {
              capture.shots.push({
                id,
                at: performance.now(),
                trialId: activeTrial!.id,
                prediction: world !== get(network, 'world'),
              });
            }
          }
        }

        return result;
      };

      const presentShot = get(Weapon.prototype, 'presentShot');
      const arrays = refs.filter(Array.isArray);
      let effectArray: Value[] | undefined;

      Weapon.prototype[key('presentShot')] = function (...args: Value[]) {
        const craft = get(args[0], 'craft');
        const observe =
          activeTrial?.kind === 'fire' &&
          get(craft, 'id') === pilot.shipId &&
          name(get(this, 'definitionId')) === 'autogun';

        const lengths = observe
          ? (effectArray ? [effectArray] : arrays).map((array) => ({
              array,
              length: array.length,
            }))
          : [];

        const result = presentShot.apply(this, args);

        if (observe && !capture.finished) {
          for (const { array, length } of lengths) {
            for (let index = length; index < array.length; index++) {
              const effect = array[index];

              if (
                !effect ||
                get(get(effect, 'parent'), 'id') !== pilot.shipId ||
                !Array.isArray(get(effect, 'parts')) ||
                markedEffects.has(effect)
              ) {
                continue;
              }

              markedEffects.add(effect);
              effectArray = array;

              const marker = {
                id: ++effectSequence,
                trialId: activeTrial?.id,
                createdAt: performance.now(),
              };

              const parts = get(effect, 'parts');
              const iterate = parts[Symbol.iterator].bind(parts);

              parts[Symbol.iterator] = function* () {
                const previous = muzzleDraw;

                try {
                  for (const part of iterate()) {
                    const age = get(effect, 'age') - (get(part, 'delay') || 0);
                    const progress = age / get(part, 'duration');
                    const power = get(part, 'easeOut');
                    const eased = power
                      ? 1 - (1 - progress) ** power
                      : progress;
                    const [start, end] = get(part, 'scale') || [1, 1];

                    muzzleDraw = {
                      ...marker,
                      radius:
                        name(get(part, 'type')) === 'polygon'
                          ? 2
                          : get(part, 'radius') *
                              (start + (end - start) * eased) +
                            Math.max(
                              get(part, 'lineWidth') || 0,
                              get(part, 'endLineWidth') || 0,
                            ) /
                              2,
                    };

                    yield part;
                  }
                } finally {
                  muzzleDraw = previous;
                }
              };
            }
          }
        }

        return result;
      };

      const send = get(network, 'send');

      network[key('send')] = function (...args: Value[]) {
        const message = args[0];
        const type = name(get(message, 'type'));

        if (!capture.finished && ['input', 'snapshotAck'].includes(type)) {
          capture.messages.push({
            type,
            at: performance.now(),
            trialId: activeTrial?.id,
            sequence: get(message, 'sequence'),
            tick: get(message, 'tick'),
            input: get(message, 'input') && {
              turn: get(get(message, 'input'), 'turn'),
              thrust: get(get(message, 'input'), 'thrust'),
              fire: get(get(message, 'input'), 'fire'),
            },
          });
        }

        return send.apply(this, args);
      };

      const receive = get(network, 'receive');

      network[key('receive')] = function (...args: Value[]) {
        const message = get(args[0], 'message');
        const type = name(get(message, 'type'));

        if (!capture.finished && ['load', 'snapshot'].includes(type)) {
          capture.messages.push({
            type,
            at: performance.now(),
            serverTick: get(message, 'serverTick'),
            snapshotSequence: get(message, 'snapshotSequence'),
            acknowledgedSequence: get(message, 'acknowledgedSequence'),
            inputLead: get(message, 'inputLead'),
          });
        }

        return receive.apply(this, args);
      };

      const edge = (event: KeyboardEvent) => {
        if (
          !activeTrial ||
          capture.finished ||
          event.repeat ||
          !['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)
        ) {
          return;
        }

        capture.edges.push({
          trialId: activeTrial.id,
          type: event.type,
          code: event.code,
          trusted: event.isTrusted,
          at: event.timeStamp,
          handledAt: performance.now(),
        });
      };

      addEventListener('keydown', edge, true);
      addEventListener('keyup', edge, true);

      const state = () => {
        const ship = entities().get(pilot.shipId);
        const gun = get(ship, 'modules')?.find(
          (module: Value) => name(get(module, 'definitionId')) === 'autogun',
        );
        const parts = gun
          ? call(ship!, 'segmentsAtMount', get(gun, 'mount'))
          : [];
        const frames = capture.frames.slice(-3);
        const settled =
          frames.length === 3 &&
          frames.every(
            (frame: Value) =>
              frame.pilotDraw &&
              frame.inView &&
              Math.abs(frame.spin) <= 0.005 &&
              Math.abs(
                Math.atan2(
                  Math.sin(frame.rotation - frames[0].rotation),
                  Math.cos(frame.rotation - frames[0].rotation),
                ),
              ) <= 0.0001,
          );
        const ammo =
          get(ship, 'cargoContents')?.reduce(
            (sum: number, object: Value) => sum + (get(object, 'rounds') || 0),
            0,
          ) || 0;

        return {
          at: performance.now(),
          connected: get(network, 'connected'),
          hidden: document.hidden,
          visibility: document.visibilityState,
          settled,
          pilotInView:
            frames.length === 3 &&
            frames.every((frame: Value) => frame.pilotDraw && frame.inView),
          turn: get(input, 'turn'),
          fire: Boolean(get(input, 'fire')),
          ready: Boolean(
            ship &&
            !get(ship, 'dead') &&
            !get(ship, 'dockedTo') &&
            !get(ship, 'launching') &&
            gun &&
            get(get(gun, 'mount'), 'health') > 0 &&
            get(gun, 'fireCooldown') <= 1e-9 &&
            get(gun, 'chargeCooldown') <= 1e-9 &&
            parts.length &&
            parts.every(
              (part: Value) =>
                get(part, 'active') === 1 &&
                get(part, 'activationProgress') === 1,
            ) &&
            ammo > 0,
          ),
          ammunition: ammo,
          visibleProjectiles: frames
            .flatMap((frame: Value) => frame.projectileDraws)
            .filter((draw: Value) => draw.inView).length,
          lastCompletedAt: frames.at(-1)?.completedAt,
          own: own() && summarize(own()),
          canvas: { width: ctx.canvas.width, height: ctx.canvas.height },
          zoom: get(game, 'size'),
        };
      };

      page.__latencyComplete = (now: number) => {
        if (capture.finished || !frameActive) return;

        capture.frames.push({
          at: now,
          completedAt: performance.now(),
          hidden: document.hidden,
          tick: get(get(network, 'world'), 'tick'),
          serverTick: get(network, 'serverTick'),
          pilotDraw: Boolean(pilotDraw),
          ...(pilotDraw || { rotation: 0, spin: 0, inView: false }),
          projectileDraws: projectiles.splice(0),
          muzzleDraws: muzzles.splice(0),
        });

        pilotDraw = undefined;
        frameActive = false;
      };

      page.latencyProbe = {
        state,
        begin(trial: Value) {
          activeTrial = {
            ...trial,
            at: performance.now(),
            previousIds: [...seen],
            state: state(),
          };

          capture.trials.push(activeTrial);
          return activeTrial;
        },
        finish() {
          capture.finished = true;

          return {
            ...capture,
            finishedAt: performance.now(),
            state: state(),
            errors: page.__latencyErrors,
            sockets: page.__latencySockets,
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            devicePixelRatio,
            graphics: {
              saved: localStorage.getItem('unicorn-graphics'),
              renderer: localStorage.getItem('unicorn-renderer'),
              nativeHud: localStorage.getItem('unicorn-native-hud'),
            },
          };
        },
      };

      return state();
    },
  };

  return true;
}
