import * as Vec from '../shared/vector';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { directionOf } from '../shared/geometry';
import { emptyPlayerInput, type PlayerInput } from '../shared/protocol/input';
import { type InputFrame } from '../shared/protocol/input-frame';
import {
  type ClientMessage,
  type PlayerInputMessage,
  type ServerMessage,
} from '../shared/protocol/network';
import { createShip } from '../shared/craft/create-ship';
import { updateWorld } from '../shared/simulation/update-world';
import { simulationStep, worldRanges } from '../shared/settings';
import { addEntity, addPlayer, createWorld } from '../shared/simulation/world';
import { RegionManager } from './region-manager';
import { ReplicationManager } from './replication';
import { Ship } from '../shared/craft/ship';
import { Station } from '../shared/craft/station';

type PlayerRecord = {
  inputLead?: number;
  inputs: Map<number, PlayerInputMessage[]>;
  lastInput: PlayerInput;
  lastSequence: number;
  lastInputAt: number;
  hiddenShip: boolean;
  playerId: number;
  replication: ReplicationManager;
  ship: Ship;
  shipId: number;
  socket?: WebSocket;
  disconnectedAt?: number;
  token: string;
};

const send = ({
  socket,
  message,
}: {
  socket: WebSocket;
  message: ServerMessage;
}) => {
  if (socket.readyState === WebSocket.OPEN) {
    if (socket.bufferedAmount > 1024 * 1024) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  }
};

export class GameSession {
  readonly world;
  private nextPlayerId = 1;
  private players = new Map<string, PlayerRecord>();
  private regions: RegionManager;
  private worldSeed: number;

  constructor({ worldSeed }: { worldSeed: number }) {
    this.worldSeed = worldSeed;
    this.world = createWorld({ seed: worldSeed });
    this.regions = new RegionManager({ worldSeed });
  }

  private nearestStation(position: Vec.Value) {
    let range = worldRanges.stationMarker;
    let stations = this.regions.view({ position }).stationMarkers;

    while (!stations.length) {
      range *= 2;
      stations = this.regions.view({
        position,
        ranges: { ...worldRanges, stationMarker: range },
      }).stationMarkers;
    }

    return stations.reduce((closest, station) =>
      Vec.distance(station.position, position) <
      Vec.distance(closest.position, position)
        ? station
        : closest,
    );
  }

  receive({ message, socket }: { message: ClientMessage; socket: WebSocket }) {
    if (message.type === 'hello') {
      this.hello({ socket, token: message.playerToken });
      return;
    }

    const player = [...this.players.values()].find(
      (candidate) => candidate.socket === socket,
    );

    if (!player) return;
    player.lastInputAt = Date.now();

    if (message.type === 'input') this.input({ message, player });
    else if (message.type === 'respawn') this.respawn(player);
    else if (message.type === 'dock') this.dock({ message, player });
  }

  disconnect({ socket }: { socket: WebSocket }) {
    const player = [...this.players.values()].find(
      (candidate) => candidate.socket === socket,
    );

    if (!player) return;
    player.socket = undefined;
    player.disconnectedAt = Date.now();
    player.hiddenShip = this.world.entities.delete(player.shipId);
    this.world.players.delete(player.playerId);
    player.ship.localMovementParent = 0;
    player.ship.localMovementRate = 0;
    Vec.set(player.ship.velocity, Vec.create());
    player.ship.spin = 0;
    player.ship.fly(0, 0);
    player.lastInput = emptyPlayerInput();
    player.inputs.clear();
    Vec.setXY(
      player.ship.position,
      Math.round(player.ship.position.x),
      Math.round(player.ship.position.y),
    );
  }

  tick() {
    if (this.world.tick % 30 === 0) {
      const idleBefore = Date.now() - 5 * 60 * 1000;

      this.players.forEach((player) => {
        if (!player.socket || player.lastInputAt > idleBefore) return;
        const socket = player.socket;

        this.disconnect({ socket });
        socket.close(4002, 'Idle timeout');
      });
    }

    if (this.world.tick % 900 === 0) {
      const expired = Date.now() - 30 * 60 * 1000;

      this.players.forEach((player, token) => {
        if (
          player.disconnectedAt === undefined ||
          player.disconnectedAt > expired
        ) {
          return;
        }
        this.players.delete(token);
        this.world.players.delete(player.playerId);
        this.world.entities.delete(player.shipId);
      });
    }
    const positions = [...this.players.values()]
      .filter(({ socket }) => socket)
      .map(({ ship }) => ship.position);

    this.regions.sync({ world: this.world, positions });
    const tick = this.world.tick;
    const inputs = new Map<number, InputFrame>();

    this.players.forEach((player) => {
      if (!player.socket) return;
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
      player.inputs.forEach((_, stale) => {
        if (stale <= tick) player.inputs.delete(stale);
      });
      inputs.set(player.playerId, frame);
    });
    updateWorld({ world: this.world, inputs });

    this.players.forEach((player) => {
      const { socket } = player;

      if (!socket) return;
      send({
        socket,
        message: player.replication.snapshot({
          world: this.world,
          shipId: player.shipId,
          position: player.ship.position,
          acknowledgedSequence: player.lastSequence,
          inputLead: player.inputLead,
        }),
      });
      player.inputLead = undefined;
    });
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
      const station = this.nearestStation(Vec.create());
      const spawnAngle = playerId * 2.4;
      const spawn = Vec.addScaled(
        station.position,
        directionOf(spawnAngle),
        station.radius + 250,
      );

      Vec.setXY(spawn, Math.round(spawn.x), Math.round(spawn.y));
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
        lastInputAt: Date.now(),
        hiddenShip: false,
        playerId,
        replication: new ReplicationManager(),
        ship,
        shipId: ship.id,
        token: playerToken,
      };
      this.players.set(playerToken, player);
    }

    player.socket?.close(4001, 'Session opened elsewhere');

    if (player.hiddenShip) {
      addEntity(this.world, player.ship);
      player.hiddenShip = false;
    }

    addPlayer(this.world, { id: player.playerId, shipId: player.shipId });
    player.socket = socket;
    player.lastInputAt = Date.now();
    player.disconnectedAt = undefined;
    player.inputs.clear();
    player.lastInput = emptyPlayerInput();
    player.lastSequence = 0;
    player.inputLead = undefined;

    const ship = player.ship;

    Vec.setXY(
      ship.position,
      Math.round(ship.position.x),
      Math.round(ship.position.y),
    );

    this.regions.sync({
      world: this.world,
      positions: [...this.players.values()]
        .filter(({ socket }) => socket)
        .map(({ ship }) => ship.position),
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
        position: player.ship.position,
        acknowledgedSequence: player.lastSequence,
        inputLead: player.inputLead,
      }),
    });
  }

  private respawn(player: PlayerRecord) {
    if (this.world.entities.has(player.shipId)) return;

    const position = player.ship.position;
    const nearest = this.nearestStation(position);

    this.regions.sync({
      world: this.world,
      positions: [
        ...[...this.players.values()]
          .filter(({ socket }) => socket)
          .map(({ ship }) => ship.position),
        nearest.position,
      ],
    });
    const station = this.world.entities.get(nearest.id);

    if (!(station instanceof Station)) return;
    const ship = createShip(this.world, {
      playerId: player.playerId,
      position: Vec.clone(station.position),
      rotation: station.rotation,
    });

    ship.dockedTo = station.id;
    addEntity(this.world, ship);
    this.world.players.get(player.playerId)!.shipId = ship.id;
    player.ship = ship;
    player.shipId = ship.id;
    player.inputs.clear();
    player.lastInput = emptyPlayerInput();
    player.inputLead = undefined;

    if (!player.socket) return;
    send({
      socket: player.socket,
      message: { shipId: ship.id, type: 'respawn' },
    });
    send({
      socket: player.socket,
      message: player.replication.initial({
        world: this.world,
        shipId: ship.id,
        acknowledgedSequence: player.lastSequence,
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

    if (!ship.applyDockAction(message)) return;

    if (player.socket) {
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
  }
}
