import type { EffectSpec } from '../../client/effects/effect';
import type { BeamEffectSpec } from '../../client/effects/beam-effect';
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
  // Milliseconds after a shot before this part lights again.
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
  // Optional separate health pool for the exposed active module or shield bubble.
  healthActivated?: number;
  // Milliseconds to restore the active pool while inactive; blocks activation until full.
  rechargeDuration?: number;
  price: number;
  zIndex: RenderingLayer;
  shades?: readonly string[];
  // Fixed model palette for modules whose paint colours their output.
  modelShades?: readonly string[];
  // Milliseconds spent moving between retracted and extended positions.
  activationDuration?: number;
  bounciness?: number;
  friction?: number;
  damage?: number;
  // Milliseconds between shots.
  fireInterval?: number;
  // Milliseconds spent becoming ready after extension.
  chargeDuration?: number;
  // Milliseconds spent shutting down before retraction begins.
  dischargeDuration?: number;
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
    // Milliseconds to fade before expiry, replacing expiry explosions and sparks.
    fadeOut?: number;
    // Milliseconds before expiry.
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
  // Milliseconds to expand the shield cover.
  coverDuration?: number;
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
        behavior: 'beam';
        beamEffect: BeamEffectSpec;
        damage: number;
        damageStepsPerSecond: number;
        barrelLength: number;
        reach: number;
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
