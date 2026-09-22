import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { Vector } from '../shared/vector';
import { emptyPlayerInput, type PlayerInput } from '../shared/protocol/input';
import { type InputFrame } from '../shared/protocol/input-frame';
import {
  type ClientMessage,
  type PlayerInputMessage,
  type ServerMessage,
} from '../shared/protocol/network';
import { createShip } from '../shared/craft/create-ship';
import { updateWorld } from '../shared/simulation/update-world';
import { simulationStep } from '../shared/simulation/update-tier';
import { addEntity, addPlayer, createWorld } from '../shared/simulation/world';
import { RegionManager } from './region-manager';
import { ReplicationManager } from './replication';
import { moduleTypes } from '../shared/modules';
import { Ship } from '../shared/craft/ship';
import { paintColors } from '../shared/colors';

type PlayerRecord = {
  /** How far ahead of the simulation this player's last input arrived. */
  inputLead?: number;
  inputs: Map<number, PlayerInputMessage[]>;
  lastInput: PlayerInput;
  lastSequence: number;
  playerId: number;
  replication: ReplicationManager;
  shipId: number;
  socket?: WebSocket;
  token: string;
};

const send = ({
  socket,
  message,
}: {
  socket: WebSocket;
  message: ServerMessage;
}) => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
};

export class GameServer {
  readonly worldSeed: number;
  readonly world;
  private timer?: ReturnType<typeof setTimeout>;
  private nextPlayerId = 1;
  private players = new Map<string, PlayerRecord>();
  private port: number;
  private regions: RegionManager;
  private server?: WebSocketServer;

  constructor({
    port = 3001,
    worldSeed = 25,
  }: { port?: number; worldSeed?: number } = {}) {
    this.port = port;
    this.worldSeed = worldSeed;
    // Client and server use the same distance-based simulation schedule.
    this.world = createWorld({ seed: worldSeed });
    this.regions = new RegionManager({ worldSeed });
  }

  start() {
    if (this.server) return this.server;

    this.server = new WebSocketServer({ port: this.port });
    this.server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = JSON.parse(
          Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(
                data instanceof ArrayBuffer ? new Uint8Array(data) : data,
              ).toString('utf8'),
        ) as ClientMessage;

        if (message.type === 'hello') {
          this.hello({ socket, token: message.playerToken });
        } else if (message.type === 'input') {
          const player = [...this.players.values()].find(
            (candidate) => candidate.socket === socket,
          );

          if (player) this.input({ message, player });
        } else if (message.type === 'dock') {
          const player = [...this.players.values()].find(
            (candidate) => candidate.socket === socket,
          );

          if (player) this.dock({ message, player });
        }
      });
      socket.on('close', () => {
        const player = [...this.players.values()].find(
          (candidate) => candidate.socket === socket,
        );

        if (!player) return;
        player.socket = undefined;
        // Nobody is at the controls any more, so the ship coasts to a stop
        // instead of holding whatever was last pressed forever.
        player.lastInput = emptyPlayerInput();
        player.inputs.clear();
      });
    });
    const period = simulationStep * 1000;
    let nextTick = performance.now() + period;
    const tick = () => {
      this.tick();
      // Schedule against a deadline: repeating a rounded 33 ms interval runs
      // faster than 30 Hz and makes clients periodically jump a whole tick.
      // Drop old debt after a stall instead of scheduling an unbounded replay.
      nextTick = Math.max(nextTick + period, performance.now());
      this.timer = setTimeout(
        tick,
        Math.max(1, Math.ceil(nextTick - performance.now())),
      );
    };
    this.timer = setTimeout(tick, Math.ceil(period));
    return this.server;
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;

    const server = this.server;

    this.server = undefined;
    if (!server) return;
    server.clients.forEach((socket) => socket.close());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private hello({
    socket,
    token,
  }: {
    socket: WebSocket;
    token: string | null;
  }) {
    let player = token ? this.players.get(token) : undefined;

    if (!player) {
      const playerToken = randomUUID();
      const playerId = this.nextPlayerId++;
      const originView = this.regions.view({ position: Vector() });
      const station = [...originView.stationMarkers].sort(
        (a, b) => a.position.length() ** 2 - b.position.length() ** 2,
      )[0];
      const spawnAngle = playerId * 2.4;
      const spawn = station
        ? station.position.add(
            Vector(Math.cos(spawnAngle), Math.sin(spawnAngle)).scale(
              station.radius + 250,
            ),
          )
        : Vector();
      const ship = createShip(this.world, {
        playerId,
        position: spawn,
      });

      addEntity(this.world, ship);
      addPlayer(this.world, { id: playerId, shipId: ship.id });
      player = {
        inputs: new Map(),
        lastInput: emptyPlayerInput(),
        lastSequence: 0,
        playerId,
        replication: new ReplicationManager(),
        shipId: ship.id,
        token: playerToken,
      };
      this.players.set(playerToken, player);
    }

    player.socket?.close();
    player.socket = socket;
    // Input sequences belong to a connection, not the persistent player.
    player.inputs.clear();
    player.lastInput = emptyPlayerInput();
    player.lastSequence = 0;
    player.inputLead = undefined;

    const ship = this.world.entities.get(player.shipId)!;

    this.regions.sync({
      world: this.world,
      positions: [...this.players.values()]
        .map((player) => this.world.entities.get(player.shipId)?.position)
        .filter((position) => position !== undefined),
    });
    send({
      socket,
      message: {
        playerId: player.playerId,
        playerToken: player.token,
        serverTick: this.world.tick,
        shipId: player.shipId,
        spawn: { x: ship.position.x, y: ship.position.y },
        type: 'welcome',
        worldSeed: this.worldSeed,
      },
    });
    send({
      socket,
      message: player.replication.initial({
        world: this.world,
        shipId: player.shipId,
        acknowledgedSequence: player.lastSequence,
        inputLead: player.inputLead,
      }),
    });
  }

  private input({
    message,
    player,
  }: {
    message: Extract<ClientMessage, { type: 'input' }>;
    player: PlayerRecord;
  }) {
    const lead = message.tick - this.world.tick;

    if (Math.abs(lead) > 120) return;
    player.inputLead = lead;

    // An input for a tick already simulated cannot be put back where it
    // belongs, so it stands in for the player from here on instead.
    if (lead < 0) {
      if (message.sequence > player.lastSequence) {
        player.lastInput = message.input;
        player.lastSequence = message.sequence;
      }
      return;
    }

    const changes = player.inputs.get(message.tick) || [];
    if (message.sequence > (changes.at(-1)?.sequence ?? player.lastSequence)) {
      changes.push(message);
      player.inputs.set(message.tick, changes);
    }
  }

  private dock({
    message,
    player,
  }: {
    message: Extract<ClientMessage, { type: 'dock' }>;
    player: PlayerRecord;
  }) {
    const ship = this.world.entities.get(player.shipId);

    if (!(ship instanceof Ship) || !ship.dockedTo) return;
    const mount = 'mount' in message ? ship.mounts[message.mount] : undefined;

    if (message.action === 'buy') {
      const Type = moduleTypes[message.module];

      if (
        !Type ||
        ship.credits < Type.price ||
        ship.cargoContents.length >= ship.cargoSpace
      )
        return;
      ship.credits -= Type.price;
      ship.cargoContents.push(new Type({ id: message.moduleId }));
    } else if (message.action === 'equip') {
      const module = ship.modules.find(({ id }) => id === message.moduleId);

      if (!mount || !module || !mount.fits.includes(module.constructor)) return;
      ship.fit(module, mount);
    } else if (message.action === 'paint') {
      const shades = paintColors[message.paint];
      const module =
        message.mount === undefined
          ? ship.modules.find(({ id }) => id === message.moduleId)
          : ship.mounts[message.mount]?.module;

      if (!shades || (message.moduleId !== undefined && !module)) return;
      if (module) module.shades = shades;
      else ship.shades = shades;
      ship.segments
        .filter((segment) =>
          module ? segment.module === module : segment.hull,
        )
        .forEach((segment) => (segment.shades = shades));
    } else if (mount) ship.fit(0, mount);

    if (player.socket)
      send({
        socket: player.socket,
        message: player.replication.snapshot({
          world: this.world,
          shipId: player.shipId,
          acknowledgedSequence: player.lastSequence,
          inputLead: player.inputLead,
        }),
      });
  }

  private tick() {
    const positions = [...this.players.values()]
      .map(({ shipId }) => this.world.entities.get(shipId)?.position)
      .filter((position) => position !== undefined);

    this.regions.sync({ world: this.world, positions });
    const tick = this.world.tick;
    const inputs = new Map<number, InputFrame>();

    this.players.forEach((player) => {
      const changes = (player.inputs.get(tick) || []).filter(
        ({ sequence }) => sequence > player.lastSequence,
      );
      const frame: InputFrame = { input: player.lastInput, changes: [] };
      changes.forEach(({ input, sequence, offset = 0 }) => {
        offset = Math.max(
          frame.changes.at(-1)?.offset || 0,
          Math.min(simulationStep - 1e-9, Math.max(0, offset)),
        );
        frame.changes.push({ input, offset });
        player.lastInput = input;
        player.lastSequence = sequence;
      });
      // Whatever a player last said stands until they say otherwise, so
      // anything the simulation has reached has had its say and can go.
      player.inputs.forEach((_, stale) => {
        if (stale <= tick) {
          player.inputs.delete(stale);
        }
      });
      inputs.set(player.playerId, frame);
    });
    updateWorld({ world: this.world, inputs: inputs });

    this.players.forEach((player) => {
      const { socket } = player;
      const ship = this.world.entities.get(player.shipId);

      if (!socket || !ship) return;
      send({
        socket,
        message: player.replication.snapshot({
          world: this.world,
          shipId: player.shipId,
          acknowledgedSequence: player.lastSequence,
          inputLead: player.inputLead,
        }),
      });
      // Timing feedback describes one received input, not every later snapshot.
      player.inputLead = undefined;
    });
  }
}
