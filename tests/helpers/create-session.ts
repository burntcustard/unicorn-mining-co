import { mock } from 'node:test';
import { GameSession } from '../../src/server/game-session';
import { RegionManager } from '../../src/shared/simulation/region-manager';

// Network fixtures need local regions, not the production startup cache covering
// a 50 km radius. Keep on-demand generation and restore the method immediately.
export const createTestSession = (options: { worldSeed: number }) => {
  const preGenerate = mock.method(
    RegionManager.prototype,
    'preGenerate',
    () => {},
  );

  try {
    return new GameSession(options);
  } finally {
    preGenerate.mock.restore();
  }
};
