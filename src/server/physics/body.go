// Port of src/client/physics/body.ts.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type Velocity struct {
	V Vec.Vector
	W float64
}

type Position struct {
	C Vec.Vector
	A float64
}

type Body struct {
	poseVersion                           uint64
	pairs                                 *bodyPairEdge
	solverContacts, solverTail            *ContactEdge
	World                                 *World
	IslandFlag, Destroyed, Parked         bool
	InvMass, InvI                         float64
	CVelocity                             Velocity
	CPosition                             Position
	LinearVelocity                        Vec.Vector
	AngularVelocity                       float64
	ContactList                           *ContactEdge
	FixtureList                           *Fixture
	Prev, Next                            *Body
	proxyRadius, proxyMotion, proxyMargin float64
	proxyTransform                        Vec.TransformValue
	Xf                                    Vec.TransformValue
	Sweep                                 collision.Sweep
	Neighborhood                          *CollisionNeighborhood
	neighborhoodCache                     *CollisionNeighborhood
	neighborDirty                         bool
	neighborCount                         int
}

// Allocated only for bodies with more than eight potential object neighbors.
type CollisionNeighborhood struct {
	Bodies    [8]*Body
	Distances [8]float64
	Count     int
}

func (b *Body) AllowsCollision(other *Body) bool {
	if b.Neighborhood == nil {
		return true
	}

	for _, candidate := range b.Neighborhood.Bodies[:b.Neighborhood.Count] {
		if candidate == other {
			return true
		}
	}

	return false
}

func (b *Body) AddCollisionNeighbor(other *Body, distance float64) {
	n := b.Neighborhood
	at := n.Count

	if at == len(n.Bodies) {
		if distance >= n.Distances[at-1] {
			return
		}

		at--
	} else {
		n.Count++
	}

	for at > 0 && distance < n.Distances[at-1] {
		n.Bodies[at], n.Distances[at] = n.Bodies[at-1], n.Distances[at-1]
		at--
	}

	n.Bodies[at], n.Distances[at] = other, distance
}

func newBody(world *World) *Body {
	return &Body{World: world, proxyRadius: math.Inf(1), proxyTransform: Vec.Transform(0, 0, 0), Xf: Vec.Transform(0, 0, 0), Sweep: collision.NewSweep()}
}

func (b *Body) SetTransform(position Vec.Vector, angle float64) {
	if b.World.Locked {
		return
	}

	Vec.SetTransform(&b.Xf, position, angle)
	b.poseVersion++

	if angle >= -math.Pi && angle <= math.Pi {
		b.Sweep.C, b.Sweep.C0 = position, position
		b.Sweep.A, b.Sweep.A0 = angle, angle
	} else {
		b.Sweep.SetTransform(b.Xf)
	}

	if !b.Parked {
		b.synchronizeProxies(b.Xf, b.Xf)
	}
}

func (b *Body) Park() {
	for b.ContactList != nil {
		b.World.DestroyContact(b.ContactList.Contact)
	}

	b.Parked = true

	for f := b.FixtureList; f != nil; f = f.Next {
		f.DestroyProxies(b.World.BroadPhase)
	}
}

func (b *Body) Unpark() {
	b.Parked = false
	b.proxyMotion = 0
	b.proxyMargin = 0
	b.proxyTransform = b.Xf

	for f := b.FixtureList; f != nil; f = f.Next {
		f.ProxyMargin = 0
		f.CreateProxies(b.World.BroadPhase, b.Xf)
	}

	b.World.NewFixture = true
}

func (b *Body) SynchronizeTransform() {
	b.Sweep.GetTransform(&b.Xf, 1)
	b.poseVersion++
}

func (b *Body) SynchronizeFixtures() {
	var xf Vec.TransformValue
	b.Sweep.GetTransform(&xf, 0)
	b.synchronizeProxies(xf, b.Xf)
}

func (b *Body) SetProxyRadius(radius float64) {
	if radius != b.proxyRadius {
		for edge := b.ContactList; edge != nil; edge = edge.Next {
			edge.Contact.separationUntil = 0

			if edge.Contact.pair != nil {
				edge.Contact.pair.motionReady = false
				edge.Contact.pair.sweepRevision = 0
			}
		}
	}

	b.proxyRadius = radius
	b.proxyMotion = 0
	b.proxyMargin = 0

	for f := b.FixtureList; f != nil; f = f.Next {
		f.ProxyMargin = 0
	}
}

func (b *Body) synchronizeProxies(from, to Vec.TransformValue) {
	cached := b.proxyTransform

	motion := func(pose Vec.TransformValue) float64 {
		sin, cos := pose.Q.Sin-cached.Q.Sin, pose.Q.Cos-cached.Q.Cos
		return max(math.Abs(pose.P.X-cached.P.X), math.Abs(pose.P.Y-cached.P.Y)) + b.proxyRadius*math.Sqrt(sin*sin+cos*cos)
	}

	if b.proxyRadius < math.Inf(1) {
		b.proxyMotion += max(motion(from), motion(to))
	}

	b.proxyTransform = to

	if b.proxyRadius < math.Inf(1) && b.proxyMotion < b.proxyMargin {
		return
	}

	margin := math.Inf(1)

	for f := b.FixtureList; f != nil; f = f.Next {
		motion := math.Inf(1)

		if b.proxyRadius < math.Inf(1) {
			motion = b.proxyMotion
		}

		f.Synchronize(b.World.BroadPhase, from, to, motion)
		margin = min(margin, f.ProxyMargin)
	}

	b.proxyMargin = margin
}

func (b *Body) Advance(alpha float64) {
	b.Sweep.Advance(alpha)
	b.Sweep.C = b.Sweep.C0
	b.Sweep.A = b.Sweep.A0
	b.SynchronizeTransform()
}

func (b *Body) GetPosition() Vec.Vector { return b.Xf.P }

func (b *Body) GetAngle() float64 { return b.Sweep.A }

func (b *Body) GetLinearVelocityFromWorldPoint(point Vec.Vector) Vec.Vector {
	center, spin := b.Sweep.C, b.AngularVelocity
	return Vec.Vector{X: b.LinearVelocity.X - spin*(point.Y-center.Y), Y: b.LinearVelocity.Y + spin*(point.X-center.X)}
}

func (b *Body) SetMass(mass, inertia float64) {
	if b.World.Locked {
		return
	}

	b.InvMass = 1 / mass
	b.InvI = 0

	if inertia > 0 {
		b.InvI = 1 / inertia
	}
}

func (b *Body) addFixture(f *Fixture) *Fixture {
	if b.World.Locked {
		return nil
	}

	if !b.Parked {
		f.CreateProxies(b.World.BroadPhase, b.Xf)
	}

	f.Next = b.FixtureList
	b.FixtureList = f
	b.World.NewFixture = true
	return f
}

func (b *Body) CreateFixture(s shape.Shape, definition FixtureOpt) *Fixture {
	b.SetProxyRadius(math.Inf(1))

	if b.World.Locked {
		return nil
	}

	f := newFixture(b, s, definition)
	b.addFixture(f)
	return f
}

func (b *Body) DestroyFixture(fixture *Fixture) {
	b.SetProxyRadius(math.Inf(1))

	if b.World.Locked {
		return
	}

	if b.FixtureList == fixture {
		b.FixtureList = fixture.Next
	} else {
		for node := b.FixtureList; node != nil; node = node.Next {
			if node.Next == fixture {
				node.Next = fixture.Next
				break
			}
		}
	}

	for edge := b.ContactList; edge != nil; {
		c := edge.Contact
		edge = edge.Next

		if fixture == c.FixtureA || fixture == c.FixtureB {
			b.World.DestroyContact(c)
		}
	}

	fixture.DestroyProxies(b.World.BroadPhase)
	fixture.Body = nil
	fixture.Next = nil
}
