package simulation

import "math"

// Decompose concave wreckage without adding another replicated geometry format.
func ConvexParts(points []Point) [][][]float64 {
	cross := func(a, b, c Point) float64 { return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]) }

	positive, negative := false, false

	for index, a := range points {
		turn := cross(a, points[(index+1)%len(points)], points[(index+2)%len(points)])
		positive, negative = positive || turn > 1e-9, negative || turn < -1e-9
	}

	if !positive || !negative {
		return nil
	}

	list := make([]int, len(points))

	for index := range list {
		list[index] = index
	}

	if math.Hypot(points[0][0]-points[len(points)-1][0], points[0][1]-points[len(points)-1][1]) < 1e-7 {
		list = list[:len(list)-1]
	}

	area := 0.0

	for index, at := range list {
		next := points[list[(index+1)%len(list)]]
		area += points[at][0]*next[1] - points[at][1]*next[0]
	}

	if area < 0 {
		for left, right := 0, len(list)-1; left < right; left, right = left+1, right-1 {
			list[left], list[right] = list[right], list[left]
		}
	}

	result := [][][]float64{}

	triangle := func(a, b, c int) {
		part := [][]float64{}

		for _, at := range []int{a, b, c} {
			part = append(part, []float64{float64(float32(points[at][0])), float64(float32(points[at][1]))})
		}

		result = append(result, part)
	}

	for len(list) > 3 {
		found := false

		for index, b := range list {
			a, c := list[(index+len(list)-1)%len(list)], list[(index+1)%len(list)]

			if cross(points[a], points[b], points[c]) <= 1e-9 {
				continue
			}

			inside := false

			for _, at := range list {
				sameCorner := false

				for _, corner := range []int{a, b, c} {
					sameCorner = sameCorner || math.Hypot(points[at][0]-points[corner][0], points[at][1]-points[corner][1]) < 1e-8
				}

				if !sameCorner && cross(points[a], points[b], points[at]) >= -1e-9 && cross(points[b], points[c], points[at]) >= -1e-9 && cross(points[c], points[a], points[at]) >= -1e-9 {
					inside = true
					break
				}
			}

			if inside {
				continue
			}

			triangle(a, b, c)
			list = append(list[:index], list[index+1:]...)
			found = true
			break
		}

		if !found {
			return nil
		}
	}

	if len(list) == 3 {
		triangle(list[0], list[1], list[2])
	}

	return result
}
