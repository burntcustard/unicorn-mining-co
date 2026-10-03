/**
 * Write sine and cosine into out after wrapping radians to one turn.
 * Evaluate the polynomials within [-pi/4, pi/4].
 * Keep coefficients and operation order identical to server/utilities/sin-cos.go.
 * For huge angles, results are defined by the remainder modulo float64 2*pi.
 */
export function sinCos(out: { sin: number; cos: number }, angle: number) {
  angle %= 2 * Math.PI;

  const index = Math.floor(angle * (2 / Math.PI) + 0.5);
  const residual = angle - index * (Math.PI / 2);
  const residualSquared = residual * residual;
  const sin =
    residual *
    (1 +
      residualSquared *
        (-1 / 6 +
          residualSquared *
            (1 / 120 +
              residualSquared *
                (-1 / 5040 +
                  residualSquared *
                    (1 / 362880 +
                      residualSquared *
                        (-1 / 39916800 +
                          residualSquared *
                            (1 / 6227020800 +
                              residualSquared * (-1 / 1307674368000))))))));
  const cos =
    1 +
    residualSquared *
      (-1 / 2 +
        residualSquared *
          (1 / 24 +
            residualSquared *
              (-1 / 720 +
                residualSquared *
                  (1 / 40320 +
                    residualSquared *
                      (-1 / 3628800 +
                        residualSquared *
                          (1 / 479001600 +
                            residualSquared * (-1 / 87178291200)))))));

  switch (index & 3) {
    case 0:
      out.sin = sin;
      out.cos = cos;

      break;

    case 1:
      out.sin = cos;
      out.cos = -sin;

      break;

    case 2:
      out.sin = -sin;
      out.cos = -cos;

      break;

    default:
      out.sin = -cos;
      out.cos = sin;
  }

  return out;
}
