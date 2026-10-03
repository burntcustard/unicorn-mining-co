// Runs before the deployed app. Observes its normal binary traffic without
// replacing the app, altering snapshots, or injecting server state.
export function installLiveProbe(clockFields) {
  const protocol = globalThis.liveBenchmarkProtocol;
  const Native = WebSocket;
  const records = new Map();
  const pending = new Map();
  let shipId,
    worldSeed,
    lastFrame,
    lastSnapshot,
    controls = {};
  let measuring = false;
  let frames = [],
    snapshots = [],
    inputs = [],
    acknowledgements = [],
    errors = [];
  let closes = [],
    decodeCosts = [],
    sockets = 0,
    start,
    firstTick,
    lastTick;
  let healthDrops = 0,
    asteroidHealthDrops = 0,
    closestPeer = Infinity;
  let nearPeerSamples = 0,
    stateSamples = 0,
    ownSamples = [],
    inputState = {};
  let receivedBytes = 0,
    sentBytes = 0,
    respawns = 0;

  globalThis.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      sockets++;
      this.addEventListener('message', ({ data }) => {
        const at = performance.now();
        const beforeDecode = performance.now();

        try {
          const bytes = new Uint8Array(data);
          const message =
            bytes[1] === 0x4d
              ? protocol.decodeBinarySnapshot(bytes)
              : protocol.decodeServerControl(bytes);

          if (message.type === 'welcome' || message.type === 'respawn') {
            if (measuring && message.type === 'respawn') respawns++;
            shipId = message.shipId;
            worldSeed = message.worldSeed ?? worldSeed;
          }

          if (message.type === 'load' || message.type === 'snapshot') {
            lastTick = message.serverTick;

            if (measuring) {
              firstTick ??= lastTick;
              snapshots.push({
                at,
                tick: lastTick,
                gap: lastSnapshot === undefined ? null : at - lastSnapshot,
                bytes: bytes.length,
                lead: message.inputLead,
              });
              receivedBytes += bytes.length;

              for (const [sequence, input] of pending) {
                if (message.acknowledgedSequence === undefined) break;

                if (sequence > message.acknowledgedSequence) continue;
                acknowledgements.push({
                  sequence,
                  ms: at - input.at,
                  input: input.input,
                });
                pending.delete(sequence);
              }
            }
            lastSnapshot = at;

            if (message.type === 'load') records.clear();

            for (const entity of message.fullEntities) {
              const previous = records.get(entity.id) || {};

              if (measuring && entity.health < previous.health) {
                if (entity.id === shipId) healthDrops++;

                if (previous.kind === 'asteroid') asteroidHealthDrops++;
              }
              const merged = { ...previous, ...entity };

              for (const [key, value] of Object.entries(merged)) {
                if (value === null) delete merged[key];
              }
              records.set(entity.id, merged);
            }

            if (message.entityIds) {
              const present = new Set(message.entityIds);

              for (const id of records.keys()) {
                if (!present.has(id)) records.delete(id);
              }
            }
          }
        } catch (error) {
          errors.push(String(error));
        } finally {
          if (measuring) decodeCosts.push(performance.now() - beforeDecode);
        }
      });
      this.addEventListener('close', ({ code, reason }) =>
        closes.push({ at: performance.now(), code, reason }),
      );
    }

    send(data) {
      const at = performance.now();

      if (measuring) sentBytes += data.byteLength || 0;

      // Only decode input frames. Never retain reconnect tokens.
      if (data[1] === 0x43 && data[3] === 1) {
        try {
          const message = protocol.decodeClientMessage(data);

          inputState = message.input;

          if (measuring) {
            const input = {
              at,
              sequence: message.sequence,
              tick: message.tick,
              input: message.input,
            };

            pending.set(message.sequence, input);
            inputs.push(input);
          }
        } catch (error) {
          errors.push(String(error));
        }
      }
      return super.send(data);
    }
  };
  addEventListener('error', (event) =>
    errors.push(event.error?.stack || event.message),
  );
  const frame = (at) => {
    if (measuring && lastFrame !== undefined) frames.push(at - lastFrame);
    lastFrame = at;
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
  const clock = () => {
    const network = globalThis.liveBenchmark?.network;

    if (!network?.[clockFields.world]) return;
    const applied = network[clockFields.applied];
    const predicted = network[clockFields.world][clockFields.tick];

    return {
      applied,
      predicted,
      received: lastTick,
      unappliedTicks: lastTick - applied,
      predictionLeadTicks: predicted - lastTick,
    };
  };
  const state = () => {
    const own = records.get(shipId);

    return {
      at: performance.now(),
      shipId,
      worldSeed,
      lastTick,
      sockets,
      own,
      clock: clock(),
      entities: [...records.values()],
      inputState,
      ready: !!own && document.getElementById('connection-status')?.hidden,
    };
  };
  const key = (name, pressed) => {
    const code = name.startsWith('Arrow')
      ? name
      : name === ' '
        ? 'Space'
        : 'Key' + name.toUpperCase();

    dispatchEvent(
      new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
        key: name,
        code,
        bubbles: true,
      }),
    );
  };
  const setControls = (next) => {
    for (const name of ['ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      if (!!controls[name] !== !!next[name]) key(name, !!next[name]);
    }

    for (const name of ['d', 'h', 'l']) {
      if (!!controls[name] !== !!next[name]) {
        key(name, true);
        key(name, false);
      }
    }
    controls = next;
  };

  globalThis.liveBenchmark = {
    state,
    control({ workload, index, players, peers, elapsed }) {
      const own = records.get(shipId);

      if (!own) {
        // Use the normal destroyed-ship keyboard path, retaining the player
        // identity while restoring this workload's active ship count.
        key(' ', true);
        key(' ', false);
        return state();
      }

      if (own.dockedTo) {
        key(' ', true);
        key(' ', false);
      }
      let targetAngle = -Math.PI / 2,
        thrust = true;

      if (workload === 'spread') {
        targetAngle = -Math.PI / 2 + (index * Math.PI * 2) / players;
      }

      if (workload === 'contact') {
        const peer = peers[index % 2 ? index - 1 : index + 1];

        if (peer?.position) {
          targetAngle = Math.atan2(
            peer.position.y - own.position.y,
            peer.position.x - own.position.x,
          );
        }
      }

      if (workload === 'module') {
        const asteroids = [...records.values()].filter(
          (entity) =>
            entity.kind === 'asteroid' && entity.position && entity.health > 0,
        );
        const distance = (entity) =>
          Math.hypot(
            entity.position.x - own.position.x,
            entity.position.y - own.position.y,
          );

        asteroids.sort((a, b) => distance(a) - distance(b));

        if (asteroids[0]) {
          targetAngle = Math.atan2(
            asteroids[0].position.y - own.position.y,
            asteroids[0].position.x - own.position.x,
          );
        }
      }
      const angle = Math.atan2(
        Math.sin(targetAngle - own.rotation),
        Math.cos(targetAngle - own.rotation),
      );

      thrust = Math.abs(angle) < (workload === 'contact' ? 1 : 0.6);
      // Periodic thrust pulses provide fresh acknowledgements in straight flight.

      if (workload === 'convoy' || workload === 'spread') {
        thrust &&= Math.floor(elapsed) % 4 !== 3;
      }

      setControls({
        ArrowUp: thrust,
        ArrowLeft: angle < -0.12,
        ArrowRight: angle > 0.12,
        d: workload === 'module',
        h: workload === 'module' && Math.floor(elapsed / 2) % 2 === 0,
        l: workload === 'module' && Math.floor(elapsed / 3) % 2 === 0,
      });

      if (measuring) {
        stateSamples++;
        ownSamples.push({
          shipId,
          at: performance.now(),
          tick: lastTick,
          position: own.position,
          rotation: own.rotation,
          health: own.health,
          dockedTo: own.dockedTo,
          entities: records.size,
          input: inputState,
          clock: clock(),
        });
        const distances = peers
          .filter((peer) => peer && peer.id !== own.id)
          .map((peer) =>
            Math.hypot(
              peer.position.x - own.position.x,
              peer.position.y - own.position.y,
            ),
          );
        const nearest = Math.min(...distances);

        closestPeer = Math.min(closestPeer, nearest);

        if (nearest < 100) nearPeerSamples++;
      }
      return {
        own: {
          id: own.id,
          position: own.position,
          rotation: own.rotation,
          health: own.health,
        },
        shipId,
        worldSeed,
        tick: lastTick,
        ready: state().ready,
      };
    },
    start() {
      frames = [];
      snapshots = [];
      inputs = [];
      acknowledgements = [];
      errors = [];
      closes = [];
      decodeCosts = [];
      ownSamples = [];
      receivedBytes =
        sentBytes =
        respawns =
        healthDrops =
        asteroidHealthDrops =
        nearPeerSamples =
        stateSamples =
          0;
      firstTick = undefined;
      closestPeer = Infinity;
      pending.clear();
      lastFrame = lastSnapshot = undefined;
      start = performance.now();
      measuring = true;
    },
    finish() {
      measuring = false;
      return {
        shipId,
        timeOrigin: performance.timeOrigin,
        worldSeed,
        start,
        end: performance.now(),
        frames,
        snapshots,
        inputs,
        acknowledgements,
        pendingInputs: pending.size,
        errors,
        closes,
        decodeCosts,
        receivedBytes,
        sentBytes,
        respawns,
        healthDrops,
        asteroidHealthDrops,
        closestPeer,
        nearPeerSamples,
        stateSamples,
        ownSamples,
        firstTick,
        lastTick,
        sockets,
        final: state().own,
      };
    },
  };
}
