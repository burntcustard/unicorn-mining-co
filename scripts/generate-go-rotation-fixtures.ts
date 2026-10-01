import { writeFileSync } from 'node:fs';
import { setRotAngle } from '../src/shared/vector-math';

const angles = [0, -64, 64, -Math.PI, Math.PI, 2 * Math.PI];

for (let i = -2600; i <= 2600; i += 13) {
  const angle = i * ((2 * Math.PI) / 256);

  angles.push(angle - 1e-11, angle, angle + 1e-11);
}

const values = angles.map((angle) => {
  const { s, c } = setRotAngle({ s: 0, c: 1 }, angle);

  return { angle, s, c };
});

writeFileSync('tests/go-fixtures/rotation.json', JSON.stringify(values) + '\n');
