// Port of src/shared/physics/fixture.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/collision/shape"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

type FixtureOpt struct {
	UserData any
	Physics  *bool
}
type Fixture struct {
	Body        *Body
	Physics     bool
	Shape       shape.Shape
	Geometry    *collision.BaseShape
	Next        *Fixture
	Proxy       *collision.SpatialProxy[*Fixture]
	aabb        collision.AABB
	UserData    any
	ProxyMargin float64
}

func newFixture(body *Body, s shape.Shape, definition FixtureOpt) *Fixture {
	physics := true
	if definition.Physics != nil {
		physics = *definition.Physics
	}
	return &Fixture{Body: body, Physics: physics, Shape: s, Geometry: s.Base(), UserData: definition.UserData}
}
func (f *Fixture) CreateProxies(broad *collision.BroadPhase[*Fixture], xf Vec.TransformValue) {
	f.Geometry.ComputeAABB(&f.aabb, xf)
	f.Proxy = broad.CreateProxy(f.aabb, f)
}
func (f *Fixture) DestroyProxies(broad *collision.BroadPhase[*Fixture]) {
	if f.Proxy == nil {
		return
	}
	broad.DestroyProxy(f.Proxy)
	f.Proxy = nil
}
func (f *Fixture) Synchronize(broad *collision.BroadPhase[*Fixture], from, to Vec.TransformValue, motion float64) {
	if f.Proxy == nil || motion < f.ProxyMargin {
		return
	}
	if from == to {
		f.Geometry.ComputeAABB(&f.aabb, from)
	} else {
		var a, b collision.AABB
		f.Geometry.ComputeAABB(&a, from)
		f.Geometry.ComputeAABB(&b, to)
		f.aabb.Combine(a, b)
	}
	displacement := Vec.Subtract(to.P, from.P)
	broad.MoveProxy(f.Proxy, f.aabb, displacement)
	if motion < math.Inf(1) {
		fat, box := f.Proxy.AABB, f.aabb
		f.ProxyMargin = motion + 0.9*min(min(box.LowerBound.X-fat.LowerBound.X, box.LowerBound.Y-fat.LowerBound.Y), min(fat.UpperBound.X-box.UpperBound.X, fat.UpperBound.Y-box.UpperBound.Y))
	}
}
func (f *Fixture) ShouldCollide(that *Fixture) bool {
	a, _ := f.UserData.(*collision.Collider)
	b, _ := that.UserData.(*collision.Collider)
	return a == nil || b == nil || collision.CollidersCanContact(a, b)
}
