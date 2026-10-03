// Port of src/client/collision/time-of-impact.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type TOIInput struct {
	ProxyA, ProxyB *BaseShape
	SweepA, SweepB *Sweep
	TMax           float64
}
type TOIOutput struct {
	Touching bool
	T        float64
}

func FindTimeOfImpact(output *TOIOutput, input TOIInput, linearSlop float64) {
	output.Touching = false
	output.T = input.TMax
	proxyA, proxyB, sweepA, sweepB := input.ProxyA, input.ProxyB, input.SweepA, input.SweepB
	sweepA.Normalize()
	sweepB.Normalize()
	target := max(linearSlop, proxyA.Radius+proxyB.Radius-3*linearSlop)
	tolerance := 0.25 * linearSlop
	t1 := 0.0
	iter := 0
	var cache SimplexCache
	var distanceOutput DistanceOutput
	distanceInput := DistanceInput{ProxyA: proxyA, ProxyB: proxyB}
	var separationFunction separationFunction
	for {
		sweepA.GetTransform(&distanceInput.TransformA, t1)
		sweepB.GetTransform(&distanceInput.TransformB, t1)
		ComputeDistance(&distanceOutput, &cache, distanceInput)
		if distanceOutput.Distance <= 0 {
			output.T = 0
			break
		}
		if distanceOutput.Distance < target+tolerance {
			output.Touching = true
			output.T = t1
			break
		}
		separationFunction.initialize(cache, proxyA, sweepA, proxyB, sweepB, distanceInput.TransformA, distanceInput.TransformB)
		done := false
		t2 := input.TMax
		pushBackIter := 0
		maxPushBackIterations := max(12, proxyA.Count, proxyB.Count)
		for {
			s2 := separationFunction.findMinSeparation(t2)
			if s2 > target+tolerance {
				output.T = input.TMax
				done = true
				break
			}
			if s2 > target-tolerance {
				t1 = t2
				break
			}
			s1 := separationFunction.evaluate(t1)
			if s1 < target-tolerance {
				output.T = t1
				done = true
				break
			}
			if s1 <= target+tolerance {
				output.Touching = true
				output.T = t1
				done = true
				break
			}
			rootIterCount := 0
			a1, a2 := t1, t2
			for {
				var t float64
				if rootIterCount&1 != 0 {
					t = a1 + ((target-s1)*(a2-a1))/(s2-s1)
				} else {
					t = 0.5 * (a1 + a2)
				}
				rootIterCount++
				s := separationFunction.evaluate(t)
				if math.Abs(s-target) < tolerance {
					t2 = t
					break
				}
				if s > target {
					a1 = t
					s1 = s
				} else {
					a2 = t
					s2 = s
				}
				if rootIterCount == 50 {
					break
				}
			}
			pushBackIter++
			if pushBackIter == maxPushBackIterations {
				break
			}
		}
		iter++
		if done {
			break
		}
		if iter == 20 {
			output.T = t1
			break
		}
	}
}

type separationFunction struct {
	proxyA, proxyB   *BaseShape
	sweepA, sweepB   *Sweep
	kind             string
	localPoint, axis Vec.Vector
	indexA, indexB   int
}

func (f *separationFunction) initialize(cache SimplexCache, proxyA *BaseShape, sweepA *Sweep, proxyB *BaseShape, sweepB *Sweep, xfA, xfB Vec.TransformValue) float64 {
	f.proxyA = proxyA
	f.proxyB = proxyB
	f.sweepA = sweepA
	f.sweepB = sweepB
	var pointA, pointB, normal Vec.Vector
	if cache.Count == 1 {
		f.kind = "points"
		Vec.TransformInto(&pointA, xfA, proxyA.GetVertex(cache.IndexA[0]))
		Vec.TransformInto(&pointB, xfB, proxyB.GetVertex(cache.IndexB[0]))
		f.axis = Vec.Subtract(pointB, pointA)
		s := Vec.Length(f.axis)
		f.axis = Vec.Normalize(f.axis)
		return s
	} else if cache.IndexA[0] == cache.IndexA[1] {
		f.kind = "faceB"
		localPointB1, localPointB2 := proxyB.GetVertex(cache.IndexB[0]), proxyB.GetVertex(cache.IndexB[1])
		Vec.CrossScalarInto(&f.axis, Vec.Subtract(localPointB2, localPointB1), 1)
		f.axis = Vec.Normalize(f.axis)
		Vec.RotateInto(&normal, xfB.Q, f.axis)
		Vec.Combine2Into(&f.localPoint, 0.5, localPointB1, 0.5, localPointB2)
		Vec.TransformInto(&pointB, xfB, f.localPoint)
		Vec.TransformInto(&pointA, xfA, proxyA.GetVertex(cache.IndexA[0]))
		s := Vec.Dot(pointA, normal) - Vec.Dot(pointB, normal)
		if s < 0 {
			f.axis = Vec.Scale(f.axis, -1)
			s = -s
		}
		return s
	} else {
		f.kind = "faceA"
		localPointA1, localPointA2 := proxyA.GetVertex(cache.IndexA[0]), proxyA.GetVertex(cache.IndexA[1])
		Vec.CrossScalarInto(&f.axis, Vec.Subtract(localPointA2, localPointA1), 1)
		f.axis = Vec.Normalize(f.axis)
		Vec.RotateInto(&normal, xfA.Q, f.axis)
		Vec.Combine2Into(&f.localPoint, 0.5, localPointA1, 0.5, localPointA2)
		Vec.TransformInto(&pointA, xfA, f.localPoint)
		Vec.TransformInto(&pointB, xfB, proxyB.GetVertex(cache.IndexB[0]))
		s := Vec.Dot(pointB, normal) - Vec.Dot(pointA, normal)
		if s < 0 {
			f.axis = Vec.Scale(f.axis, -1)
			s = -s
		}
		return s
	}
}
func (f *separationFunction) compute(find bool, t float64) float64 {
	var xfA, xfB Vec.TransformValue
	f.sweepA.GetTransform(&xfA, t)
	f.sweepB.GetTransform(&xfB, t)
	var axisA, axisB, pointA, pointB, normal Vec.Vector
	switch f.kind {
	case "points":
		if find {
			Vec.UnrotateInto(&axisA, xfA.Q, f.axis)
			Vec.UnrotateInto(&axisB, xfB.Q, Vec.Scale(f.axis, -1))
			f.indexA = f.proxyA.GetSupport(axisA)
			f.indexB = f.proxyB.GetSupport(axisB)
		}
		Vec.TransformInto(&pointA, xfA, f.proxyA.GetVertex(f.indexA))
		Vec.TransformInto(&pointB, xfB, f.proxyB.GetVertex(f.indexB))
		return Vec.Dot(pointB, f.axis) - Vec.Dot(pointA, f.axis)
	case "faceA":
		Vec.RotateInto(&normal, xfA.Q, f.axis)
		Vec.TransformInto(&pointA, xfA, f.localPoint)
		if find {
			Vec.UnrotateInto(&axisB, xfB.Q, Vec.Scale(normal, -1))
			f.indexA = -1
			f.indexB = f.proxyB.GetSupport(axisB)
		}
		Vec.TransformInto(&pointB, xfB, f.proxyB.GetVertex(f.indexB))
		return Vec.Dot(pointB, normal) - Vec.Dot(pointA, normal)
	case "faceB":
		Vec.RotateInto(&normal, xfB.Q, f.axis)
		Vec.TransformInto(&pointB, xfB, f.localPoint)
		if find {
			Vec.UnrotateInto(&axisA, xfA.Q, Vec.Scale(normal, -1))
			f.indexB = -1
			f.indexA = f.proxyA.GetSupport(axisA)
		}
		Vec.TransformInto(&pointA, xfA, f.proxyA.GetVertex(f.indexA))
		return Vec.Dot(pointA, normal) - Vec.Dot(pointB, normal)
	default:
		if find {
			f.indexA = -1
			f.indexB = -1
		}
		return 0
	}
}
func (f *separationFunction) findMinSeparation(t float64) float64 { return f.compute(true, t) }
func (f *separationFunction) evaluate(t float64) float64          { return f.compute(false, t) }
