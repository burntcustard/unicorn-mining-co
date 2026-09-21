import { type Asteroid } from '../shared/simulation/asteroid';
import { colors } from '../shared/colors';
import { decorateGameObject } from './game-object';
import { presentation } from './asteroids/presentation';
import './asteroids/asteroid';

export const renderAsteroid = ({ asteroid }: { asteroid: Asteroid }) => {
  Object.assign(asteroid, {
    fill: asteroid.resource === 1 ? `${colors.purple[1]}9` : '#222',
    stroke: asteroid.resource === 1 ? colors.violet[2] : colors.white[2],
    networked: 1,
    scenery: 1,
    zIndex: -2,
  });
  presentation({ asteroid });
  return decorateGameObject({ sprite: asteroid });
};
