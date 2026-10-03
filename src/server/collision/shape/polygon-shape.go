// Port of src/client/collision/shape/polygon-shape.ts.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type PolygonShape struct {
	collision.BaseShape
	Centroid Vec.Vector
	Normals  []Vec.Vector
}

func NewPolygon(vertices []Vec.Vector, collisionMargin *float64, linearSlop float64) *PolygonShape {
	p := &PolygonShape{Type: "polygon", Radius: 2 * linearSlop}

	if collisionMargin != nil {
		p.Radius = *collisionMargin
	}

	if len(vertices) > 0 {
		p.Set(vertices, linearSlop)
	}

	return p
}

func (p *PolygonShape) Set(vertices []Vec.Vector, linearSlop float64) {
	if len(vertices) < 3 {
		p.SetAsBox(100, 100)
		return
	}

	var points [16]Vec.Vector
	ps := points[:0]

	for _, v := range vertices {
		unique := true

		for _, previous := range ps {
			if Vec.DistanceSquared(v, previous) < 0.25*(linearSlop*linearSlop) {
				unique = false
				break
			}
		}

		if unique {
			ps = append(ps, v)
		}
	}

	n := len(ps)

	if n < 3 {
		p.SetAsBox(100, 100)
		return
	}

	i0, x0 := 0, ps[0].X

	for i := 1; i < n; i++ {
		x := ps[i].X

		if x > x0 || (x == x0 && ps[i].Y < ps[i0].Y) {
			i0, x0 = i, x
		}
	}

	var indices [16]int
	hull := indices[:0]
	ih := i0

	for {
		hull = append(hull, ih)
		ie := 0
		origin := ps[ih]

		for j := 1; j < n; j++ {
			if ie == ih {
				ie = j
				continue
			}

			rx, ry := ps[ie].X-origin.X, ps[ie].Y-origin.Y
			vx, vy := ps[j].X-origin.X, ps[j].Y-origin.Y
			cross := rx*vy - ry*vx

			if cross < 0 {
				ie = j
			}

			if cross == 0 && vx*vx+vy*vy > rx*rx+ry*ry {
				ie = j
			}
		}

		ih = ie

		if ie == i0 {
			break
		}
	}

	m := len(hull)

	if m < 3 {
		p.SetAsBox(100, 100)
		return
	}

	p.Count = m
	data := make([]Vec.Vector, 2*m)
	p.Vertices, p.Normals = data[:m:m], data[m:]

	for i, index := range hull {
		p.Vertices[i] = ps[index]
	}

	for i, vertex := range p.Vertices {
		next := p.Vertices[(i+1)%m]
		p.Normals[i] = Vec.Normalize(Vec.Vector{X: next.Y - vertex.Y, Y: vertex.X - next.X})
	}

	p.Centroid = computeCentroid(p.Vertices, m)
}

func (p *PolygonShape) SetAsBox(hx, hy float64) {
	p.Vertices = []Vec.Vector{{X: hx, Y: -hy}, {X: hx, Y: hy}, {X: -hx, Y: hy}, {X: -hx, Y: -hy}}
	p.Normals = []Vec.Vector{{X: 1}, {Y: 1}, {X: -1}, {Y: -1}}
	p.Count = 4
}

func computeCentroid(vs []Vec.Vector, count int) Vec.Vector {
	var c, temp, pRef Vec.Vector
	area := 0.0
	inv3 := 1.0 / 3

	for i := range count {
		p2, p3 := vs[i], vs[(i+1)%count]
		d := Vec.Cross(p2, p3)
		triangleArea := 0.5 * d
		area += triangleArea
		Vec.Combine3Into(&temp, 1, pRef, 1, p2, 1, p3)
		c = Vec.AddScaled(c, temp, triangleArea*inv3)
	}

	return Vec.Scale(c, 1/area)
}
