import { Vector, type Vector as VectorValue } from '../../vector';
import { type PlayerInput } from '../protocol/input';
import { type PlayerId, type ShipEntity } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld, entityId } from './world';
import { SimulationEntity } from './entity';

const thrustScale = 220;
const forwardThrust = 16;
const rotationalThrust = 16;
const turnRate = 3;
const mass = 9;

const approach = (value: number, target: number, step: number) =>
  value + Math.max(-step, Math.min(step, target - value));

class Ship extends SimulationEntity implements ShipEntity {
  cargo?: number[];
  drag = 5 / 9;
  dockedTo?: number;
  drill = false;
  hatch = false;
  health = 100;
  kind = 'ship' as const;
  launching?: number;
  light = false;
  maxSpeed = 17 * forwardThrust;
  paint?: number;
  playerId?: PlayerId;
  shield = false;
  thrust = 0;
  turn = 0;

  constructor({
    playerId,
    ...properties
  }: ConstructorParameters<typeof SimulationEntity>[0] & {
    playerId?: PlayerId;
  }) {
    super(properties);
    this.playerId = playerId;
  }

  update(dt: number) {
    if (this.launching) this.launching = Math.max(0, this.launching - dt);
    if (this.dockedTo !== undefined) return;

    const targetSpin = (this.turn * turnRate * rotationalThrust) / 16;

    this.spin = approach(this.spin, targetSpin, rotationalThrust * dt);

    const push = ((thrustScale * forwardThrust) / mass) * this.thrust * dt;

    this.velocity.x += Math.cos(this.rotation + this.spin * dt) * push;
    this.velocity.y += Math.sin(this.rotation + this.spin * dt) * push;
    super.update(dt);
  }
}

export const createShip = (
  world: SimulationWorld,
  {
    id = entityId(world),
    playerId,
    position = Vector(),
    rotation = 0,
    velocity = Vector(),
  }: {
    id?: number;
    playerId?: PlayerId;
    position?: VectorValue;
    rotation?: number;
    velocity?: VectorValue;
  } = {},
): ShipEntity =>
  new Ship({
    id,
    mass,
    playerId,
    position,
    radius: 40,
    rotation,
    velocity,
  });

export const controlShip = (
  ship: ShipEntity,
  input: PlayerInput,
  events: SimulationEvent[],
) => {
  if (input.launch) {
    ship.dockedTo = undefined;
    ship.launching = 3;
  }
  ship.thrust =
    ship.launching || input.launch ? 1 : Math.max(0, Math.min(1, input.thrust));
  ship.turn = Math.max(-1, Math.min(1, input.turn));

  for (const module of ['hatch', 'shield', 'light'] as const) {
    if (ship[module] === input[module]) continue;
    ship[module] = input[module];
    if (ship.playerId !== undefined)
      events.push({
        active: input[module],
        module,
        playerId: ship.playerId,
        type: 'moduleChanged',
      });
  }
  ship.drill = input.drill;
};
