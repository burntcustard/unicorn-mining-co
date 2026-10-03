import { sinCos } from '../../../src/client/utilities/sin-cos';

const angles = [0, -64, 64, -65, 65];

// Exercise quadrant, polynomial-reduction and full-turn boundaries on both sides.
for (let i = -256; i <= 256; i++) {
  const angle = i * (Math.PI / 4);

  angles.push(angle - 1e-11, angle, angle + 1e-11);
}

// Cover subnormal inputs and large exponents without overflowing finite float64.
for (let exponent = -1074; exponent <= 1023; exponent += 17) {
  for (const fraction of [1, 1.25, 1.5, 1.9999999999999998]) {
    const angle = fraction * 2 ** exponent;

    angles.push(-angle, angle);
  }
}

for (const angle of [1e6, 1e20, 1e100, 1e300, Number.MAX_VALUE]) {
  angles.push(-angle, angle);
}

const values = angles.map((angle) => {
  const { sin, cos } = sinCos({ sin: 0, cos: 1 }, angle);

  return { angle, sin, cos };
});

export default values;
