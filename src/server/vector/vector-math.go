// Port of src/client/utilities/vector-math.ts.
package vector

import "github.com/burntcustard/unicorn-mining-co/src/server/utilities"

type RotValue struct{ Sin, Cos float64 }

type TransformValue struct {
	P Vector
	Q RotValue
}

func RotateInto(out *Vector, q RotValue, v Vector) *Vector {
	*out = Vector{q.Cos*v.X - q.Sin*v.Y, q.Sin*v.X + q.Cos*v.Y}
	return out
}

func UnrotateInto(out *Vector, q RotValue, v Vector) *Vector {
	*out = Vector{q.Cos*v.X + q.Sin*v.Y, -q.Sin*v.X + q.Cos*v.Y}
	return out
}

func RerotateInto(out *Vector, before, after RotValue, v Vector) *Vector {
	x0 := before.Cos*v.X + before.Sin*v.Y
	y0 := -before.Sin*v.X + before.Cos*v.Y
	*out = Vector{after.Cos*x0 - after.Sin*y0, after.Sin*x0 + after.Cos*y0}
	return out
}

func Transform(x, y, a float64) TransformValue {
	sin, cos := utilities.SinCos(a)
	return TransformValue{Vector{x, y}, RotValue{sin, cos}}
}

func TransformInto(out *Vector, xf TransformValue, v Vector) *Vector {
	*out = Vector{xf.Q.Cos*v.X - xf.Q.Sin*v.Y + xf.P.X, xf.Q.Sin*v.X + xf.Q.Cos*v.Y + xf.P.Y}
	return out
}

func InverseTransformInto(out *Vector, xf TransformValue, v Vector) *Vector {
	px, py := v.X-xf.P.X, v.Y-xf.P.Y
	*out = Vector{xf.Q.Cos*px + xf.Q.Sin*py, -xf.Q.Sin*px + xf.Q.Cos*py}
	return out
}

func ChangeTransformInto(out *Vector, from, to TransformValue, v Vector) *Vector {
	x0 := from.Q.Cos*v.X - from.Q.Sin*v.Y + from.P.X
	y0 := from.Q.Sin*v.X + from.Q.Cos*v.Y + from.P.Y
	px, py := x0-to.P.X, y0-to.P.Y
	*out = Vector{to.Q.Cos*px + to.Q.Sin*py, -to.Q.Sin*px + to.Q.Cos*py}
	return out
}

func DetransformTransform(out *TransformValue, a, b TransformValue) *TransformValue {
	cos := a.Q.Cos*b.Q.Cos + a.Q.Sin*b.Q.Sin
	sin := a.Q.Cos*b.Q.Sin - a.Q.Sin*b.Q.Cos
	x := a.Q.Cos*(b.P.X-a.P.X) + a.Q.Sin*(b.P.Y-a.P.Y)
	y := -a.Q.Sin*(b.P.X-a.P.X) + a.Q.Cos*(b.P.Y-a.P.Y)
	*out = TransformValue{Vector{x, y}, RotValue{sin, cos}}
	return out
}

func SetTransform(out *TransformValue, position Vector, rotation float64) *TransformValue {
	out.P = position
	out.Q.Sin, out.Q.Cos = utilities.SinCos(rotation)
	return out
}
