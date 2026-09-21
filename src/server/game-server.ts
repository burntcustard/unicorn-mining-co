import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { Vector } from '../shared/vector';
import { emptyPlayerInput, type PlayerInput } from '../shared/protocol/input';
import {
  protocolVersion,
  type ClientMessage,
  type ServerMessage,
} from '../shared/protocol/network';
import { createShip } from '../shared/craft/create-ship';
import { updateWorld } from '../shared/simulation/update-world';
import { addEntity, addPlayer, createWorld } from '../shared/simulation/world';
import { RegionManager } from './region-manager';
import { ReplicationManager } from './replication';

type PlayerRecord = {
  /** How far ahead of the simulation this player's last input arrived. */
  inputLead?: number;
  inputSequences: Map<number, number>;
  inputs: Map<number, PlayerInput>;
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
  private interval?: ReturnType<typeof setInterval>;
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
          if (message.protocolVersion !== protocolVersion)
            socket.close(1002, 'Client/server protocol mismatch');
          else this.hello({ socket, token: message.playerToken });
        } else if (message.type === 'input') {
          const player = [...this.players.values()].find(
            (candidate) => candidate.socket === socket,
          );

          if (player) this.input({ message, player });
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
        player.inputSequences.clear();
      });
    });
    this.interval = setInterval(() => this.tick(), 1000 / 60);
    return this.server;
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;

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
        inputSequences: new Map(),
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
        protocolVersion,
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

    if (message.sequence > (player.inputSequences.get(message.tick) || -1)) {
      player.inputs.set(message.tick, message.input);
      player.inputSequences.set(message.tick, message.sequence);
    }
  }

  private tick() {
    const positions = [...this.players.values()]
      .map(({ shipId }) => this.world.entities.get(shipId)?.position)
      .filter((position) => position !== undefined);

    this.regions.sync({ world: this.world, positions });
    const tick = this.world.tick;
    const inputs = new Map<number, PlayerInput>();

    this.players.forEach((player) => {
      const input = player.inputs.get(tick);
      const sequence = player.inputSequences.get(tick);

      if (input && sequence !== undefined && sequence > player.lastSequence) {
        player.lastInput = input;
        player.lastSequence = Math.max(player.lastSequence, sequence);
      }
      // Whatever a player last said stands until they say otherwise, so
      // anything the simulation has reached has had its say and can go.
      player.inputs.forEach((_, stale) => {
        if (stale <= tick) {
          player.inputs.delete(stale);
          player.inputSequences.delete(stale);
        }
      });
      inputs.set(player.playerId, player.lastInput);
    });
    updateWorld(this.world, inputs);

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
