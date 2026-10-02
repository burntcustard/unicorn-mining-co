// Port of src/shared/physics/motion-sweep.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

type Sweep struct {
	C                                          Vec.Vector
	A, Alpha0                                  float64
	C0                                         Vec.Vector
	A0                                         float64
	trigAngle, cosA0, sinA0                    float64
	transformAngle, transformCos, transformSin float64
}

func NewSweep() Sweep { return Sweep{trigAngle: math.NaN(), transformAngle: math.NaN(), cosA0: 1} }
func (s *Sweep) Rotation0() Vec.RotValue {
	if s.trigAngle != s.A0 || s.cosA0 == 0 && s.sinA0 == 0 {
		s.trigAngle = s.A0
		s.sinA0, s.cosA0 = Vec.SinCos(s.A0)
	}
	return Vec.RotValue{S: s.sinA0, C: s.cosA0}
}
func (s *Sweep) SetTransform(xf Vec.TransformValue) {
	s.C = xf.P
	s.C0 = xf.P
	s.A = math.Atan2(xf.Q.S, xf.Q.C)
	s.A0 = s.A
}
func (s *Sweep) GetTransform(xf *Vec.TransformValue, beta float64) {
	angle := (1-beta)*s.A0 + beta*s.A
	if angle == s.A0 {
		xf.Q = s.Rotation0()
	} else {
		if s.transformAngle != angle || s.transformCos == 0 && s.transformSin == 0 {
			s.transformAngle = angle
			s.transformSin, s.transformCos = Vec.SinCos(angle)
		}
		xf.Q = Vec.RotValue{S: s.transformSin, C: s.transformCos}
	}
	Vec.Combine2Into(&xf.P, 1-beta, s.C0, beta, s.C)
}
func (s *Sweep) Advance(alpha float64) {
	beta := (alpha - s.Alpha0) / (1 - s.Alpha0)
	Vec.Combine2Into(&s.C0, beta, s.C, 1-beta, s.C0)
	s.A0 = beta*s.A + (1-beta)*s.A0
	s.Alpha0 = alpha
}
func (s *Sweep) Normalize() {
	wrapped := s.A0 + math.Pi
	if !(wrapped >= 0 && wrapped < 2*math.Pi) {
		wrapped = math.Mod(wrapped, 2*math.Pi)
	}
	a0 := wrapped - math.Pi
	if wrapped < 0 {
		a0 = wrapped + math.Pi
	}
	s.A -= s.A0 - a0
	s.A0 = a0
}
func (s *Sweep) Set(that Sweep) {
	*s = that
}
