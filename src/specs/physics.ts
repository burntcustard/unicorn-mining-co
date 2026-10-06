export const linearSlop = 0.5;

export const contactSpeedThreshold = 5;

export const physics = {
  maxTranslation: 200,
  maxRotation: Math.PI / 2,
  velocityIterations: 8,
  positionIterations: 3,
  wakeMargin: 10,
  aabbExtension: 10,
  aabbMultiplier: 2,
  positionBaumgarte: 0.2,
  toiBaumgarte: 0.75,
  maxLinearCorrection: 20,
  damageBase: 700,
  damageScale: 600,
} as const;
