import type { EffectSpec } from '../../client/effects/effect';
import type { RenderingLayer } from '../rendering-layers';

type ModuleValues = {
  name: string;
  health: number;
  price: number;
  zIndex: RenderingLayer;
  shades?: readonly string[];
  activationDuration?: number;
  bounciness?: number;
  friction?: number;
  damage?: number;
  fireInterval?: number;
  // Backwards impulse per shot, scaled by the firing ship's mass.
  recoil?: number;
  projectile?: {
    color: string;
    explosion?: {
      damage?: number;
      effect?: EffectSpec;
      impulse: number;
      // Cap the velocity added by the blast, before distance falloff.
      maxSpeed?: number;
      radius: number;
    };
    glow?: {
      alpha: number;
      color: string;
      radius: number;
    };
    lifetime: number;
    radius: number;
    speed: number;
  };

  ammunition?: number;
  barrelLength?: number;
  model?: {
    points: number[][];
    color?: number;
    rechargeDelay?: number;
    rechargeColor?: number;
    glow?: {
      radius: number;
      alpha: number;
      stops: [number, number | string, number?][];
    };
  }[];
  activationThreshold?: number;
  damageStepsPerSecond?: number;
  gripDecay?: number;
  gripScale?: number;
  disablePhysics?: boolean;
  forwardThrust?: number;
  rotationalThrust?: number;
  offset?: number;
  flareSizes?: readonly number[];
  nozzleSides?: readonly number[];
  collectsCargo?: boolean;
  grinds?: boolean;
  beam?: boolean;
  lens?: number;
  mouth?: number;
  reach?: number;
  spread?: number;
  corner?: number;
  shieldRadius?: number;
  coverDuration?: number;
  generatorRadius?: number;
  unhurtWhen?: number;
  drillTip?: { position: { x: number; y: number }; radius: number };
  points?: readonly (readonly number[])[];
  cargoGeometry?: {
    length: number;
    openAngle: number;
    doorWidth: number;
    doorRadius: number;
    openingThreshold: number;
    throatRadius: number;
  };
};

export type ModuleSpec = ModuleValues &
  (
    | {
        behavior: 'thruster';
        forwardThrust: number;
        rotationalThrust: number;
        flareSizes: readonly number[];
        nozzleSides: readonly number[];
      }
    | {
        behavior: 'cargoHatch';
        cargoGeometry: NonNullable<ModuleValues['cargoGeometry']>;
      }
    | {
        behavior: 'searchLight';
        lens: number;
        mouth: number;
        reach: number;
        spread: number;
        corner: number;
      }
    | {
        behavior: 'hornDrill';
        damage: number;
        drillTip: NonNullable<ModuleValues['drillTip']>;
        points: readonly (readonly number[])[];
      }
    | {
        behavior: 'weapon';
        damage: number;
        fireInterval: number;
        projectile: NonNullable<ModuleValues['projectile']>;
        barrelLength: number;
        model: NonNullable<ModuleValues['model']>;
      }
    | {
        behavior: 'shieldGenerator';
        generatorRadius: number;
        shieldRadius: number;
        coverDuration: number;
      }
  );
