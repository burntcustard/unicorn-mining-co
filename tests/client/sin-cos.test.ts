import assert from 'node:assert/strict';
import { sinCos } from '../../src/client/utilities/sin-cos';

// Ordinary angles keep native precision.
{
  const out = { sin: 0, cos: 1 };

  for (let i = 0; i <= 1024; i++) {
    const angle = -64 + (128 * i) / 1024;
    const { sin, cos } = sinCos(out, angle);

    assert(Math.abs(sin - Math.sin(angle)) < 1e-12, `sine at ${angle}`);
    assert(Math.abs(cos - Math.cos(angle)) < 1e-12, `cosine at ${angle}`);
    assert(
      Math.abs(sin * sin + cos * cos - 1) < 1e-12,
      `unit rotation at ${angle}`,
    );
  }
}

// Extreme operands use the wrapped argument and retain the output object.
{
  const out = { sin: 0, cos: 1 };

  for (const angle of [
    -Number.MAX_VALUE,
    -1e300,
    -1e20,
    -65,
    (-5 * Math.PI) / 2,
    (5 * Math.PI) / 2,
    65,
    1e20,
    1e300,
    Number.MAX_VALUE,
  ]) {
    assert.equal(sinCos(out, angle), out);
    const wrapped = angle % (2 * Math.PI);

    assert(Math.abs(out.sin - Math.sin(wrapped)) < 1e-12, `sine at ${angle}`);
    assert(Math.abs(out.cos - Math.cos(wrapped)) < 1e-12, `cosine at ${angle}`);
    assert(Math.abs(out.sin * out.sin + out.cos * out.cos - 1) < 1e-12);
  }
}

// Full turns preserve signed zero.
{
  for (const angle of [0, -0, 2 * Math.PI, -2 * Math.PI]) {
    const { sin, cos } = sinCos({ sin: 0, cos: 1 }, angle);

    assert.equal(sin, angle % (2 * Math.PI));
    assert.equal(cos, 1);
  }
}

// Nonfinite inputs yield NaN components.
{
  for (const angle of [-Infinity, Infinity, NaN]) {
    const { sin, cos } = sinCos({ sin: 0, cos: 1 }, angle);

    assert(Number.isNaN(sin));
    assert(Number.isNaN(cos));
  }
}
