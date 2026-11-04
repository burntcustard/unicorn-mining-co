package simulation

import Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"

// Sample the same smooth ribbon sections that the browser draws as cubics.
// These outlines freeze into debris; intact collision uses the rectangular parts.
func RibbonSections(points []Vec.Vector, widths []float64) []*ShapeOutline {
	edges, controls := [2][]Vec.Vector{}, [2][]Vec.Vector{}

	for edge, side := range []float64{-1, 1} {
		for index, point := range points {
			tangent := Vec.Subtract(points[min(index+1, len(points)-1)], points[max(0, index-1)])
			normal := Vec.Normalize(Vec.Create(-tangent.Y, tangent.X))
			edges[edge] = append(edges[edge], Vec.AddScaled(point, normal, widths[index]*side))
		}

		for index := range points {
			controls[edge] = append(controls[edge], Vec.Scale(Vec.Subtract(edges[edge][min(index+1, len(points)-1)], edges[edge][max(0, index-1)]), 1.0/6))
		}
	}

	sample := func(outline *ShapeOutline, edge, from, to int, direction float64) {
		a, d := edges[edge][from], edges[edge][to]
		b := Vec.AddScaled(a, controls[edge][from], direction)
		c := Vec.AddScaled(d, controls[edge][to], -direction)

		for index := 1; index <= 8; index++ {
			t := float64(index) / 8
			u := 1 - t

			outline.Points = append(outline.Points, Point{
				u*u*u*a.X + 3*u*u*t*b.X + 3*u*t*t*c.X + t*t*t*d.X,
				u*u*u*a.Y + 3*u*u*t*b.Y + 3*u*t*t*c.Y + t*t*t*d.Y,
			})
		}
	}

	sections := make([]*ShapeOutline, len(points)-1)

	for index := range sections {
		near, far := edges[0][index], edges[1][index+1]
		outline := &ShapeOutline{Points: []Point{{near.X, near.Y}}}
		sample(outline, 0, index, index+1, 1)
		outline.Points = append(outline.Points, Point{far.X, far.Y})
		sample(outline, 1, index+1, index, -1)
		sections[index] = outline
	}

	return sections
}
