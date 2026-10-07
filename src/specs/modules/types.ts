import type { EffectSpec } from '../../client/effects/effect';
import type { RenderingLayer } from '../rendering-layers';

type ModuleModelPart = {
  // Draw the normal edge outline; false draws only the fill and any markings.
  outline: boolean;
  catches?: boolean;
  flareSize?: number;
  thrusterNozzleSide?: number;
  points?: number[][];
  radius?: number;
  lines?: number[][][];
  covers?: boolean;
  fillAlpha?: number;
  color?: number;
  rechargeDelay?: number;
  rechargeColor?: number;
  glow?: {
    offset?: [number, number];
    radius: number;
    alpha: number;
    stops: [number, number | string, number?][];
  };
};

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
  chargeDuration?: number;
  retractionDistance?: number;
  muzzleFlash?: EffectSpec;
  // Backwards impulse per shot, scaled by the firing ship's mass.
  recoil?: number;
  projectile?: {
    color: string;
    effect?: EffectSpec;
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
  model: ModuleModelPart[];
  activationThreshold?: number;
  damageStepsPerSecond?: number;
  gripDecay?: number;
  gripScale?: number;
  disablePhysics?: boolean;
  forwardThrust?: number;
  rotationalThrust?: number;
  offset?: number;
  collectsCargo?: boolean;
  grinds?: boolean;
  beam?: boolean;
  reach?: number;
  spread?: number;
  corner?: number;
  shieldRadius?: number;
  coverDuration?: number;
  unhurtWhen?: number;
  drillTip?: { position: { x: number; y: number }; radius: number };
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
        model: (ModuleModelPart & {
          flareSize: number;
          thrusterNozzleSide: number;
        })[];
      }
    | {
        behavior: 'cargoHatch';
        cargoGeometry: NonNullable<ModuleValues['cargoGeometry']>;
      }
    | {
        behavior: 'searchLight';
        model: (ModuleModelPart & { points: number[][] })[];
        reach: number;
        spread: number;
        corner: number;
      }
    | {
        behavior: 'hornDrill';
        damage: number;
        drillTip: NonNullable<ModuleValues['drillTip']>;
        model: (ModuleModelPart & { points: number[][] })[];
      }
    | {
        behavior: 'weapon';
        damage: number;
        fireInterval: number;
        projectile: NonNullable<ModuleValues['projectile']>;
        barrelLength: number;
        model: (ModuleModelPart & { points: number[][] })[];
      }
    | {
        behavior: 'shieldGenerator';
        model: (ModuleModelPart &
          ({ radius: number; covers?: false } | { covers: true }))[];
        shieldRadius: number;
        coverDuration: number;
      }
  );
