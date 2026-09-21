import { Vector, type Vector as VectorValue } from '../vector';
import { type Entity } from '../shared/protocol/entities';
import { type PlayerInput } from '../shared/protocol/input';
import {
  protocolVersion,
  type ClientMessage,
  type PlayerCheckpoint,
  type ReplicatedEntity,
  type ReplicatedStationMarker,
  type ServerMessage,
} from '../shared/protocol/network';
import { createRandom } from '../seeded-random';
import { addPlayer, createWorld } from '../shared/simulation/world';
import { createAsteroid } from '../shared/simulation/asteroid';
import { createItem } from '../shared/simulation/item';
import { createShip } from '../shared/simulation/ship';
import { createStation } from '../shared/simulation/station';
import { type SimulationWorld } from '../shared/simulation/world';
import { PredictionManager, type SimulationCheckpoint } from './prediction';

type ClientStationMarker = {
  id: number;
  position: VectorValue;
  radius: number;
};

// Split names rewritten by the game's pre-minification pass. These are wire
// keys, so they must keep the exact spelling used by the unbundled Node server.
const launchingKey = `launc${'hing'}` as 'launching';
const outlineKey = `out${'line'}` as 'outline';
const pointsKey = `poi${'nts'}` as 'points';
const positionKey = `posi${'tion'}` as 'position';
const radiusKey = `rad${'ius'}` as 'radius';
const resourceKey = `resou${'rce'}` as 'resource';
const rotationKey = `rota${'tion'}` as 'rotation';
const turnKey = `tu${'rn'}` as 'turn';

// The client simulates ahead of the server so its input lands on the tick it
// was stamped with rather than one the server has already left behind.
const startingTickLead = 6;
const minTickLead = 2;
const maxTickLead = 40;
// Ticks of room the server should still have when an input reaches it.
const minInputLead = 2;
// How far the clock may wander before it is worth nudging, since the tick a
// snapshot was sent on is only ever a latency-blurred reading of it.
const driftSlack = 3;
// Past this the clock is wrong rather than drifting, so it is simply reset.
const maxTickJump = 30;

const makeCheckpoint = ({
  checkpoint,
}: {
  checkpoint: PlayerCheckpoint;
}): SimulationCheckpoint => {
  const wirePosition = checkpoint[positionKey];
  const wireVelocity = checkpoint['velocity'];

  return {
    acknowledgedSequence: checkpoint['acknowledgedSequence'],
    dockedTo: checkpoint['dockedTo'],
    drill: checkpoint['drill'],
    entityId: checkpoint['entityId'],
    hatch: checkpoint['hatch'],
    health: checkpoint['health'],
    inputLead: checkpoint['inputLead'],
    launching: checkpoint[launchingKey],
    light: checkpoint['light'],
    playerId: checkpoint['playerId'],
    position: Vector(wirePosition.x, wirePosition.y),
    rotation: checkpoint[rotationKey],
    shield: checkpoint['shield'],
    spin: checkpoint['spin'],
    thrust: checkpoint['thrust'],
    tick: checkpoint['tick'],
    turn: checkpoint[turnKey],
    velocity: Vector(wireVelocity.x, wireVelocity.y),
  };
};

const makeEntity = ({
  entity,
  world,
}: {
  entity: ReplicatedEntity;
  world: SimulationWorld;
}): Entity => {
  const wirePosition = entity[positionKey];
  const wireVelocity = entity['velocity'];
  const common = {
    id: entity['id'],
    mass: entity['mass'],
    position: Vector(wirePosition.x, wirePosition.y),
    radius: entity[radiusKey],
    rotation: entity[rotationKey],
    spin: entity['spin'],
    velocity: Vector(wireVelocity.x, wireVelocity.y),
  };

  if (entity['kind'] === 'asteroid') {
    const wireSections = entity['sections'];

    return createAsteroid(world, {
      contents: entity['contents'] || [],
      decay: entity['decay'],
      health: entity['health'] ?? entity[radiusKey] * 2,
      id: common.id,
      mass: common.mass,
      maxHealth: entity['maxHealth'] || entity[radiusKey] * 2,
      outline: entity[outlineKey],
      points: entity[pointsKey],
      position: common.position,
      radius: common.radius,
      radiusEven: entity['radiusEven'],
      resource: entity[resourceKey],
      rotation: common.rotation,
      // A section's own outline is a wire key too, so it needs reading by the
      // spelling the unbundled server wrote it with.
      sections: wireSections?.every((section) =>
        Array.isArray(section[outlineKey]),
      )
        ? wireSections.map((section) => ({
            contents: section['contents'] || [],
            health: section['health'],
            mass: section['mass'],
            maxHealth: section['maxHealth'],
            outline: section[outlineKey],
          }))
        : undefined,
      spin: common.spin,
      velocity: common.velocity,
    });
  }
  if (entity['kind'] === 'station')
    return Object.assign(createStation(common), common);
  if (entity['kind'] === 'item')
    return Object.assign(
      createItem(world, {
        id: common.id,
        position: common.position,
        resource: entity[resourceKey] || 0,
        velocity: common.velocity,
      }),
      common,
    );
  return Object.assign(createShip(world, common), common, {
    cargo: entity['contents'],
    dockedTo: entity['dockedTo'],
    drill: entity['drill'] ?? false,
    hatch: entity['hatch'] ?? false,
    health: entity['health'] ?? 100,
    launching: entity[launchingKey],
    light: entity['light'] ?? false,
    maxSpeed: entity['maxSpeed'] ?? 272,
    paint: entity['paint'],
    playerId: entity['playerId'],
    shield: entity['shield'] ?? false,
    thrust: entity['thrust'] ?? 0,
    turn: entity[turnKey] ?? 0,
  });
};

export class NetworkClient {
  readonly ready: Promise<void>;
  readonly stationMarkers = new Map<number, ClientStationMarker>();
  readonly world = createWorld();
  playerId?: number;
  serverTick = 0;
  shipId?: number;
  worldSeed?: number;
  private compatible = true;
  private resolveReady!: () => void;
  private prediction = new PredictionManager({ world: this.world });
  private socket: WebSocket;
  // Ticks still owed to (or borrowed from) the clock, paid off one per update.
  private tickAdjust = 0;
  private tickLead = startingTickLead;
  private welcomed = false;

  constructor({ url }: { url: string }) {
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    this.socket = new WebSocket(url);
    this.socket.onopen = () =>
      this.send({
        playerToken: localStorage.getItem('playerToken'),
        protocolVersion,
        type: 'hello',
      });
    this.socket.onmessage = ({ data }) =>
      this.receive({ message: JSON.parse(String(data)) as ServerMessage });
  }

  update({ input }: { input: PlayerInput }) {
    if (this.playerId === undefined) return;
    let steps = 1;

    if (this.tickAdjust > 0) {
      steps = 2;
      this.tickAdjust--;
    } else if (this.tickAdjust < 0) {
      steps = 0;
      this.tickAdjust++;
    }
    // A launch is said once, so a skipped tick must not swallow it.
    if (input.launch) steps ||= 1;

    while (steps--) {
      this.prediction.step({
        input,
        send: ({ input, sequence, tick }) =>
          this.send({ input, sequence, tick, type: 'input' }),
      });
      input.launch = false;
    }
    input.launch = false;
  }

  /**
   * Keep the client's clock the measured lead ahead of the server's, and keep
   * that lead big enough for input to arrive before its tick is simulated.
   */
  private retune({ checkpoints }: { checkpoints: SimulationCheckpoint[] }) {
    const lead = checkpoints.find(
      ({ entityId }) => entityId === this.shipId,
    )?.inputLead;

    if (lead !== undefined) {
      if (lead < minInputLead)
        this.tickLead = Math.min(
          maxTickLead,
          this.tickLead + minInputLead - lead,
        );
      else if (lead > minInputLead + 4)
        this.tickLead = Math.max(minTickLead, this.tickLead - 1);
    }

    const drift = this.serverTick + this.tickLead - this.world.tick;

    if (Math.abs(drift) > maxTickJump) {
      this.world.tick += drift;
      this.prediction.reset();
      this.tickAdjust = 0;
    } else if (Math.abs(drift) > driftSlack)
      // One tick at a time: a snapshot arrives ten times a second, so even a
      // long drift is walked off without the pilot seeing a jump.
      this.tickAdjust = Math.sign(drift);
  }

  private send(message: ClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const wireMessage =
      message['type'] === 'hello'
        ? {
            playerToken: message['playerToken'],
            protocolVersion: message['protocolVersion'],
            type: 'hello',
          }
        : {
            input: {
              drill: message['input']['drill'],
              hatch: message['input']['hatch'],
              light: message['input']['light'],
              launch: message['input']['launch'],
              shield: message['input']['shield'],
              thrust: message['input']['thrust'],
              [turnKey]: message['input'].turn,
            },
            sequence: message['sequence'],
            tick: message['tick'],
            type: 'input',
          };

    this.socket.send(JSON.stringify(wireMessage));
  }

  private receive({ message }: { message: ServerMessage }) {
    if (!this.compatible) return;
    if (message['type'] === 'welcome') {
      if (message['protocolVersion'] !== protocolVersion) {
        this.compatible = false;
        this.socket.close();
        console.error(
          'Client/server protocol mismatch: restart both the game server and client',
        );
        return;
      }
      localStorage.setItem('playerToken', message['playerToken']);
      this.playerId = message['playerId'];
      this.shipId = message['shipId'];
      this.worldSeed = message['worldSeed'];
      this.serverTick = message['serverTick'];
      this.world.tick = message['serverTick'] + this.tickLead;
      this.world.random = createRandom(message['worldSeed']);
      addPlayer(this.world, {
        id: message['playerId'],
        shipId: message['shipId'],
      });
      this.prediction.setLocalPlayer({ playerId: message['playerId'] });
      this.welcomed = true;
      return;
    }

    this.serverTick = message['serverTick'];
    if (message['type'] === 'load') {
      this.stationMarkers.clear();
      this.prediction.reset();
      this.world.tick = this.serverTick;
    }

    message['stationMarkers'].forEach((marker: ReplicatedStationMarker) => {
      const wirePosition = marker[positionKey];

      this.stationMarkers.set(marker['id'], {
        id: marker['id'],
        position: Vector(wirePosition.x, wirePosition.y),
        radius: marker[radiusKey],
      });
    });

    if (message['type'] === 'snapshot')
      message['unloadedStationMarkerIds'].forEach((id) =>
        this.stationMarkers.delete(id),
      );

    // Every replicated entity is described as of the server's tick, so the
    // prediction rolls back to that tick before taking any of it.
    const checkpoints = message['checkpoints'].map((checkpoint) =>
      makeCheckpoint({ checkpoint }),
    );

    this.prediction.reconcile({
      checkpoints,
      entities: message['fullEntities'].map((entity) =>
        makeEntity({ entity, world: this.world }),
      ),
      tick: this.serverTick,
    });

    if (message['type'] === 'load') {
      this.world.tick = this.serverTick + this.tickLead;
      this.tickAdjust = 0;
      if (this.welcomed) this.resolveReady();
    } else this.retune({ checkpoints });
  }
}

const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

export const network = new NetworkClient({
  url: `${socketProtocol}//${location.host}/game-socket`,
});
