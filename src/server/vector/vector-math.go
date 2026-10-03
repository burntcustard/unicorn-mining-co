// Port of src/client/utilities/vector-math.ts.
// Copyright (c) Ali Shakiba (Planck.js), MIT. See LICENSE.
package vector

type RotValue struct{ S, C float64 }
type TransformValue struct {
	P Vector
	Q RotValue
}

func SetRotAngle(out *RotValue, a float64) *RotValue {
	out.S, out.C = SinCos(a)
	return out
}
func RotateInto(out *Vector, q RotValue, v Vector) *Vector {
	*out = Vector{q.C*v.X - q.S*v.Y, q.S*v.X + q.C*v.Y}
	return out
}
func UnrotateInto(out *Vector, q RotValue, v Vector) *Vector {
	*out = Vector{q.C*v.X + q.S*v.Y, -q.S*v.X + q.C*v.Y}
	return out
}
func RerotateInto(out *Vector, before, after RotValue, v Vector) *Vector {
	x0 := before.C*v.X + before.S*v.Y
	y0 := -before.S*v.X + before.C*v.Y
	*out = Vector{after.C*x0 - after.S*y0, after.S*x0 + after.C*y0}
	return out
}
func Transform(x, y, a float64) TransformValue {
	sin, cos := SinCos(a)
	return TransformValue{Vector{x, y}, RotValue{sin, cos}}
}
func TransformInto(out *Vector, xf TransformValue, v Vector) *Vector {
	*out = Vector{xf.Q.C*v.X - xf.Q.S*v.Y + xf.P.X, xf.Q.S*v.X + xf.Q.C*v.Y + xf.P.Y}
	return out
}
func InverseTransformInto(out *Vector, xf TransformValue, v Vector) *Vector {
	px, py := v.X-xf.P.X, v.Y-xf.P.Y
	*out = Vector{xf.Q.C*px + xf.Q.S*py, -xf.Q.S*px + xf.Q.C*py}
	return out
}
func ChangeTransformInto(out *Vector, from, to TransformValue, v Vector) *Vector {
	x0 := from.Q.C*v.X - from.Q.S*v.Y + from.P.X
	y0 := from.Q.S*v.X + from.Q.C*v.Y + from.P.Y
	px, py := x0-to.P.X, y0-to.P.Y
	*out = Vector{to.Q.C*px + to.Q.S*py, -to.Q.S*px + to.Q.C*py}
	return out
}
func DetransformTransform(out *TransformValue, a, b TransformValue) *TransformValue {
	c := a.Q.C*b.Q.C + a.Q.S*b.Q.S
	s := a.Q.C*b.Q.S - a.Q.S*b.Q.C
	x := a.Q.C*(b.P.X-a.P.X) + a.Q.S*(b.P.Y-a.P.Y)
	y := -a.Q.S*(b.P.X-a.P.X) + a.Q.C*(b.P.Y-a.P.Y)
	*out = TransformValue{Vector{x, y}, RotValue{s, c}}
	return out
}
func SetTransform(out *TransformValue, position Vector, rotation float64) *TransformValue {
	out.P = position
	SetRotAngle(&out.Q, rotation)
	return out
}
