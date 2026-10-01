// Port of src/shared/collision/shape-distance.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package collision

import Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"

// Shape's distance-query surface avoids importing the shape child package.
type DistanceProxy interface {
	GetVertex(int) Vec.Vector
	GetSupport(Vec.Vector) int
}
type DistanceInput struct {
	ProxyA, ProxyB         DistanceProxy
	TransformA, TransformB Vec.TransformValue
}
type DistanceOutput struct {
	PointA, PointB Vec.Vector
	Distance       float64
}
type SimplexCache struct {
	Metric         float64
	IndexA, IndexB [3]int
	Count          int
}

func (s *SimplexCache) Recycle() { s.Count = 0 }
func ComputeDistance(output *DistanceOutput, cache *SimplexCache, input DistanceInput) {
	proxyA, proxyB, xfA, xfB := input.ProxyA, input.ProxyB, input.TransformA, input.TransformB
	var simplex simplex
	simplex.readCache(cache, proxyA, xfA, proxyB, xfB)
	var saveA, saveB [3]int
	var temp Vec.Vector
	for iter := 0; iter < 20; {
		saveCount := simplex.count
		for i := range saveCount {
			saveA[i] = simplex.v[i].indexA
			saveB[i] = simplex.v[i].indexB
		}
		simplex.solve()
		if simplex.count == 3 {
			break
		}
		d := simplex.getSearchDirection()
		if Vec.LengthSquared(d) < 1e-18 {
			break
		}
		vertex := &simplex.v[simplex.count]
		Vec.UnrotateInto(&temp, xfA.Q, Vec.Scale(d, -1))
		vertex.indexA = proxyA.GetSupport(temp)
		Vec.TransformInto(&vertex.wA, xfA, proxyA.GetVertex(vertex.indexA))
		Vec.UnrotateInto(&temp, xfB.Q, d)
		vertex.indexB = proxyB.GetSupport(temp)
		Vec.TransformInto(&vertex.wB, xfB, proxyB.GetVertex(vertex.indexB))
		vertex.w = Vec.Subtract(vertex.wB, vertex.wA)
		iter++
		duplicate := false
		for i := range saveCount {
			if vertex.indexA == saveA[i] && vertex.indexB == saveB[i] {
				duplicate = true
				break
			}
		}
		if duplicate {
			break
		}
		simplex.count++
	}
	simplex.getWitnessPoints(&output.PointA, &output.PointB)
	output.Distance = Vec.Distance(output.PointA, output.PointB)
	simplex.writeCache(cache)
}

type simplexVertex struct {
	wA     Vec.Vector
	indexA int
	wB     Vec.Vector
	indexB int
	w      Vec.Vector
	a      float64
}
type simplex struct {
	v     [3]simplexVertex
	count int
}

func (s *simplex) readCache(cache *SimplexCache, proxyA DistanceProxy, xfA Vec.TransformValue, proxyB DistanceProxy, xfB Vec.TransformValue) {
	s.count = cache.Count
	for i := 0; i < s.count; i++ {
		v := &s.v[i]
		v.indexA = cache.IndexA[i]
		v.indexB = cache.IndexB[i]
		Vec.TransformInto(&v.wA, xfA, proxyA.GetVertex(v.indexA))
		Vec.TransformInto(&v.wB, xfB, proxyB.GetVertex(v.indexB))
		v.w = Vec.Subtract(v.wB, v.wA)
		v.a = 0
	}
	if s.count > 1 {
		metric1, metric2 := cache.Metric, s.getMetric()
		if metric2 < 0.5*metric1 || 2*metric1 < metric2 || metric2 < 1e-9 {
			s.count = 0
		}
	}
	if s.count == 0 {
		v := &s.v[0]
		v.indexA = 0
		v.indexB = 0
		Vec.TransformInto(&v.wA, xfA, proxyA.GetVertex(0))
		Vec.TransformInto(&v.wB, xfB, proxyB.GetVertex(0))
		v.w = Vec.Subtract(v.wB, v.wA)
		v.a = 1
		s.count = 1
	}
}
func (s *simplex) writeCache(cache *SimplexCache) {
	cache.Metric = s.getMetric()
	cache.Count = s.count
	for i := 0; i < s.count; i++ {
		cache.IndexA[i] = s.v[i].indexA
		cache.IndexB[i] = s.v[i].indexB
	}
}
func (s *simplex) getSearchDirection() Vec.Vector {
	switch s.count {
	case 1:
		return Vec.Vector{X: -s.v[0].w.X, Y: -s.v[0].w.Y}
	case 2:
		e12 := Vec.Subtract(s.v[1].w, s.v[0].w)
		sgn := -Vec.Cross(e12, s.v[0].w)
		if sgn > 0 {
			return Vec.Vector{X: -e12.Y, Y: e12.X}
		}
		return Vec.Vector{X: e12.Y, Y: -e12.X}
	default:
		return Vec.Vector{}
	}
}
func (s *simplex) getWitnessPoints(pA, pB *Vec.Vector) {
	v1, v2, v3 := &s.v[0], &s.v[1], &s.v[2]
	switch s.count {
	case 1:
		*pA = v1.wA
		*pB = v1.wB
	case 2:
		Vec.Combine2Into(pA, v1.a, v1.wA, v2.a, v2.wA)
		Vec.Combine2Into(pB, v1.a, v1.wB, v2.a, v2.wB)
	case 3:
		Vec.Combine3Into(pA, v1.a, v1.wA, v2.a, v2.wA, v3.a, v3.wA)
		*pB = *pA
	}
}
func (s *simplex) getMetric() float64 {
	switch s.count {
	case 2:
		return Vec.Distance(s.v[0].w, s.v[1].w)
	case 3:
		return Vec.Cross(Vec.Subtract(s.v[1].w, s.v[0].w), Vec.Subtract(s.v[2].w, s.v[0].w))
	default:
		return 0
	}
}
func (s *simplex) solve() {
	switch s.count {
	case 2:
		s.solve2()
	case 3:
		s.solve3()
	}
}
func (s *simplex) solve2() {
	w1, w2 := s.v[0].w, s.v[1].w
	e12 := Vec.Subtract(w2, w1)
	d12_2 := -Vec.Dot(w1, e12)
	if d12_2 <= 0 {
		s.v[0].a = 1
		s.count = 1
		return
	}
	d12_1 := Vec.Dot(w2, e12)
	if d12_1 <= 0 {
		s.v[1].a = 1
		s.count = 1
		s.v[0] = s.v[1]
		return
	}
	inv_d12 := 1 / (d12_1 + d12_2)
	s.v[0].a = d12_1 * inv_d12
	s.v[1].a = d12_2 * inv_d12
	s.count = 2
}
func (s *simplex) solve3() {
	w1, w2, w3 := s.v[0].w, s.v[1].w, s.v[2].w
	e12 := Vec.Subtract(w2, w1)
	w1e12, w2e12 := Vec.Dot(w1, e12), Vec.Dot(w2, e12)
	d12_1, d12_2 := w2e12, -w1e12
	e13 := Vec.Subtract(w3, w1)
	w1e13, w3e13 := Vec.Dot(w1, e13), Vec.Dot(w3, e13)
	d13_1, d13_2 := w3e13, -w1e13
	e23 := Vec.Subtract(w3, w2)
	w2e23, w3e23 := Vec.Dot(w2, e23), Vec.Dot(w3, e23)
	d23_1, d23_2 := w3e23, -w2e23
	n123 := Vec.Cross(e12, e13)
	d123_1, d123_2, d123_3 := n123*Vec.Cross(w2, w3), n123*Vec.Cross(w3, w1), n123*Vec.Cross(w1, w2)
	if d12_2 <= 0 && d13_2 <= 0 {
		s.v[0].a = 1
		s.count = 1
		return
	}
	if d12_1 > 0 && d12_2 > 0 && d123_3 <= 0 {
		inv_d12 := 1 / (d12_1 + d12_2)
		s.v[0].a = d12_1 * inv_d12
		s.v[1].a = d12_2 * inv_d12
		s.count = 2
		return
	}
	if d13_1 > 0 && d13_2 > 0 && d123_2 <= 0 {
		inv_d13 := 1 / (d13_1 + d13_2)
		s.v[0].a = d13_1 * inv_d13
		s.v[2].a = d13_2 * inv_d13
		s.count = 2
		s.v[1] = s.v[2]
		return
	}
	if d12_1 <= 0 && d23_2 <= 0 {
		s.v[1].a = 1
		s.count = 1
		s.v[0] = s.v[1]
		return
	}
	if d13_1 <= 0 && d23_1 <= 0 {
		s.v[2].a = 1
		s.count = 1
		s.v[0] = s.v[2]
		return
	}
	if d23_1 > 0 && d23_2 > 0 && d123_1 <= 0 {
		inv_d23 := 1 / (d23_1 + d23_2)
		s.v[1].a = d23_1 * inv_d23
		s.v[2].a = d23_2 * inv_d23
		s.count = 2
		s.v[0] = s.v[2]
		return
	}
	inv_d123 := 1 / (d123_1 + d123_2 + d123_3)
	s.v[0].a = d123_1 * inv_d123
	s.v[1].a = d123_2 * inv_d123
	s.v[2].a = d123_3 * inv_d123
	s.count = 3
}
