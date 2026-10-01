import * as Vec from '../shared/vector';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { directionOf } from '../shared/geometry';
import { emptyPlayerInput, type PlayerInput } from '../shared/protocol/input';
import { type InputFrame } from '../shared/protocol/input-frame';
import {
  type ClientMessage,
  type PlayerInputMessage,
} from '../shared/protocol/network';
import { createShip } from '../shared/craft/create-ship';
import { updateWorld } from '../shared/simulation/update-world';
import {
  maxCatchUpTicks,
  simulationStep,
  worldRanges,
} from '../shared/settings';
import { addEntity, addPlayer, createWorld } from '../shared/simulation/world';
import { RegionManager } from './region-manager';
import { ReplicationView } from './replication-common';
import { Ship } from '../shared/craft/ship';
import { Station } from '../shared/craft/station';
import { encodeServerControl } from '../shared/protocol/binary-control';
import {
  BinaryReplicationManager,
  BinarySnapshotBatch,
} from './binary-replication';

// Let a slow receiver drain before sending another world state. The next
// snapshot is computed from the last one actually sent to that player.
const maxBufferedSnapshotBytes = 128 * 1024;
const maxSocketBufferBytes = 1024 * 1024;
// Bound snapshots beyond Node's buffer too (kernel, proxy and browser).
// Two in flight maintain 30 Hz up to a 67 ms round trip; slower receivers
// get fewer, current snapshots instead of a growing queue of stale ticks.
const maxPendingSnapshots = 2;
// Server regions reach 500 units past what receivers load; a ship at top
// speed covers about a seventh of that between regional refreshes.
const regionSyncEvery = 8;

type PlayerRecord = {
  snapshotSequence: number;
  pendingSnapshots: number[];
  needsLoad: boolean;
  inputLead?: number;
  inputs: Map<number, PlayerInputMessage[]>;
  frame: InputFrame;
  lastInput: PlayerInput;
  lastSequence: number;
  lastInputAt: number;
  hiddenShip: boolean;
  playerId: number;
  binaryReplication: BinaryReplicationManager;
  ship: Ship;
  shipId: number;
  socket?: WebSocket;
  disconnectedAt?: number;
  token: string;
};

const send = ({
  socket,
  packet,
}: {
  socket: WebSocket;
  packet: Uint8Array;
}) => {
  if (socket.readyState === WebSocket.OPEN) {
    if (socket.bufferedAmount > maxSocketBufferBytes) {
      socket.terminate();
      return;
    }
    socket.send(packet);
  }
};

export class GameSession {
  readonly world;
  private nextPlayerId = 1;
  private players = new Map<string, PlayerRecord>();
  private playersBySocket = new Map<WebSocket, PlayerRecord>();
  private inputs = new Map<number, InputFrame>();
  private binaryBatch = new BinarySnapshotBatch();
  private regions: RegionManager;
  private regionsSyncedAt = -Infinity;
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
      this.hello({
        socket,
        token: message.playerToken,
      });
      return;
    }

    const player = this.playersBySocket.get(socket);

    if (!player) return;

    if (message.type === 'snapshotAck') {
      const index = player.pendingSnapshots.indexOf(message.sequence);

      // Only a sequence actually sent on this connection can free its window.
      // Acknowledgements are transport activity, not player input/idle activity.
      if (index >= 0) player.pendingSnapshots.splice(0, index + 1);
      return;
    }
    player.lastInputAt = Date.now();

    if (message.type === 'input') this.input({ message, player });
    else if (message.type === 'respawn') this.respawn(player);
    else if (message.type === 'dock') this.dock({ message, player });
  }

  disconnect({ socket }: { socket: WebSocket }) {
    const player = this.playersBySocket.get(socket);

    if (!player) return;
    this.playersBySocket.delete(socket);
    player.socket = undefined;
    player.binaryReplication = new BinaryReplicationManager();
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

  tick({ ticks = 1 }: { ticks?: number } = {}) {
    if (this.world.tick % 30 === 0 || (this.world.tick % 30) + ticks > 30) {
      const idleBefore = Date.now() - 5 * 60 * 1000;

      this.players.forEach((player) => {
        if (!player.socket) return;
        // Held movement sends no repeated transitions, but is still activity.

        if (player.lastInput.thrust || player.lastInput.turn) {
          player.lastInputAt = Date.now();
        }

        if (player.lastInputAt > idleBefore) return;
        const socket = player.socket;

        this.disconnect({ socket });
        socket.close(4002, 'Idle timeout');
      });
    }

    if (this.world.tick % 900 === 0 || (this.world.tick % 900) + ticks > 900) {
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

    if (this.world.tick - this.regionsSyncedAt >= regionSyncEvery) {
      const positions = [...this.players.values()]
        .filter(({ socket }) => socket)
        .map(({ ship }) => ship.position);

      this.regions.sync({ world: this.world, positions });
      this.regionsSyncedAt = this.world.tick;
    }
    const tick = this.world.tick;
    const inputs = this.inputs;

    inputs.clear();
    this.players.forEach((player) => {
      if (!player.socket) return;
      const frame = player.frame;

      frame.input = player.lastInput;
      frame.changes.length = 0;

      for (let index = 0; index < ticks; index++) {
        const changes = player.inputs.get(tick + index) || [];

        changes.forEach(({ input, sequence, offset = 0 }) => {
          if (sequence <= player.lastSequence) return;
          offset = Math.max(
            frame.changes.at(-1)?.offset || 0,
            index * simulationStep +
              Math.min(simulationStep - 1e-9, Math.max(0, offset)),
          );
          frame.changes.push({ input, offset });
          player.lastInput = input;
          player.lastSequence = sequence;
        });
      }
      player.inputs.forEach((_, stale) => {
        if (stale < tick + ticks) player.inputs.delete(stale);
      });
      inputs.set(player.playerId, frame);
    });
    updateWorld({
      world: this.world,
      inputs,
      dt: ticks * simulationStep,
      ticks,
    });

    // Send the completed simulation state once, including after a catch-up batch.
    // Positions are read lazily, so backpressure that skips every receiver
    // does not copy the world.
    const replicationView = new ReplicationView(this.world);
    const binaryBatch = this.binaryBatch.begin(replicationView);

    this.players.forEach((player) =>
      this.sendSnapshot({ player, replicationView, binaryBatch }),
    );
  }

  private sendSnapshot({
    player,
    replicationView,
    binaryBatch,
  }: {
    player: PlayerRecord;
    replicationView?: ReplicationView;
    binaryBatch?: BinarySnapshotBatch;
  }) {
    const { socket } = player;

    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (socket.bufferedAmount > maxSocketBufferBytes) {
      socket.terminate();
      return;
    }

    if (
      socket.bufferedAmount > maxBufferedSnapshotBytes ||
      player.pendingSnapshots.length >= maxPendingSnapshots
    ) {
      return;
    }

    // Skipped sends do not advance the observer's delta baseline.
    const sequence = ++player.snapshotSequence;
    const options = {
      world: this.world,
      shipId: player.shipId,
      position: player.ship.position,
      acknowledgedSequence: player.lastSequence,
      inputLead: player.inputLead,
      snapshotSequence: sequence,
      replicationView,
      binaryBatch,
    };
    const packet = player.needsLoad
      ? player.binaryReplication.initial(options)
      : player.binaryReplication.snapshot(options);

    player.needsLoad = false;
    player.inputLead = undefined;

    player.pendingSnapshots.push(sequence);
    send({ socket, packet });
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
        snapshotSequence: 0,
        pendingSnapshots: [],
        needsLoad: true,
        inputs: new Map(),
        frame: { input: emptyPlayerInput(), changes: [] },
        lastInput: emptyPlayerInput(),
        lastSequence: 0,
        lastInputAt: Date.now(),
        hiddenShip: false,
        playerId,
        binaryReplication: new BinaryReplicationManager(),
        ship,
        shipId: ship.id,
        token: playerToken,
      };
      this.players.set(playerToken, player);
    }

    if (player.socket) {
      this.playersBySocket.delete(player.socket);
      player.socket.close(4001, 'Session opened elsewhere');
    }

    if (player.hiddenShip) {
      addEntity(this.world, player.ship);
      player.hiddenShip = false;
    }

    addPlayer(this.world, { id: player.playerId, shipId: player.shipId });
    player.socket = socket;
    this.playersBySocket.set(socket, player);
    player.snapshotSequence = 0;
    player.pendingSnapshots = [];
    player.needsLoad = true;
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
      packet: encodeServerControl({
        playerId: player.playerId,
        playerToken: player.token,
        serverTick: this.world.tick,
        shipId: player.shipId,
        spawn: { x: ship.position.x, y: ship.position.y },
        type: 'welcome',
        worldSeed: this.worldSeed,
      }),
    });

    this.sendSnapshot({ player });
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

    ship.credits = player.ship.credits;
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
      packet: encodeServerControl({ shipId: ship.id, type: 'respawn' }),
    });
    player.needsLoad = true;
    this.sendSnapshot({ player });
  }

  private input({
    message,
    player,
  }: {
    message: Extract<ClientMessage, { type: 'input' }>;
    player: PlayerRecord;
  }) {
    const lead = message.tick - this.world.tick;

    player.inputLead = lead;

    // A pilot may keep predicting while snapshots are delayed. Do not park
    // their newer controls several seconds in the future (or discard them).
    if (lead < 0 || lead > maxCatchUpTicks) {
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

    this.sendSnapshot({ player });
  }
}
