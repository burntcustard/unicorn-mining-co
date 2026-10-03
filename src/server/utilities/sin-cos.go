package utilities

import "math"

// SinCos returns sine, then cosine, after wrapping radians to one turn.
// Evaluate the polynomials within [-pi/4, pi/4].
// Keep coefficients and operation order identical to client/utilities/sin-cos.ts sinCos.
// For huge angles, results are defined by the remainder modulo float64 2*pi.
func SinCos(angle float64) (float64, float64) {
	angle = math.Mod(angle, 2*math.Pi)

	index := int(math.Floor(angle*(2/math.Pi) + 0.5))
	residual := angle - float64(index)*(math.Pi/2)
	residualSquared := residual * residual
	sin := residual * (1 + residualSquared*(-1.0/6+residualSquared*(1.0/120+residualSquared*(-1.0/5040+residualSquared*(1.0/362880+residualSquared*(-1.0/39916800+residualSquared*(1.0/6227020800+residualSquared*(-1.0/1307674368000))))))))
	cos := 1 + residualSquared*(-1.0/2+residualSquared*(1.0/24+residualSquared*(-1.0/720+residualSquared*(1.0/40320+residualSquared*(-1.0/3628800+residualSquared*(1.0/479001600+residualSquared*(-1.0/87178291200)))))))

	switch index & 3 {
	case 0:
		return sin, cos
	case 1:
		return cos, -sin
	case 2:
		return -sin, -cos
	default:
		return -cos, sin
	}
}
