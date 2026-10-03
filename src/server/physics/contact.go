// Port of src/client/physics/contact.ts.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// Match src/client/physics/contact.ts. This bounds impulse changes, not
// accumulated trajectory error; difficult islands retain all eight iterations.
const velocityImpulseTolerance = 1e-7

type Mat22 struct{ Ex, Ey Vec.Vector }

type ContactEdge struct {
	solverNext *ContactEdge
	Contact    *Contact
	Prev, Next *ContactEdge
	Other      *Body
}

type VelocityConstraintPoint struct {
	RA, RB                                                               Vec.Vector
	NormalImpulse, TangentImpulse, NormalMass, TangentMass, VelocityBias float64
}

type ContactConstraint struct {
	VNormal                          Vec.Vector
	VNormalMass, VK                  Mat22
	PLocalPoints                     [2]Vec.Vector
	PLocalNormal, PLocalPoint        Vec.Vector
	VPointCount                      int
	InvMassA, InvMassB, InvIA, InvIB float64
	PType                            string
	PRadiusA, PRadiusB               float64
	VPoints                          [2]VelocityConstraintPoint
	PPointCount                      int
}

type Contact struct {
	listIndex       int
	separationUntil float64
	physical        bool
	*ContactConstraint
	pair                                  *bodyPair
	pairPrev, pairNext                    *Contact
	separationCache                       [2]uint8
	NodeA, NodeB                          ContactEdge
	Manifold                              collision.Manifold
	FixtureA, FixtureB                    *Fixture
	Prev, Next                            *Contact
	toiIndex                              int
	toiQueue                              uint8
	toiOrder                              uint64
	TOI                                   float64
	TOIFlag                               bool
	Friction, Restitution, SurfaceSpeed   float64
	TOICount                              int
	EnabledFlag, IslandFlag, TouchingFlag bool
}

func (c *Contact) InitConstraint() {
	if c.ContactConstraint == nil {
		c.ContactConstraint = new(ContactConstraint)
	}

	a, b := c.FixtureA, c.FixtureB
	m := &c.Manifold
	c.InvMassA = c.NodeB.Other.InvMass
	c.InvMassB = c.NodeA.Other.InvMass
	c.InvIA = c.NodeB.Other.InvI
	c.InvIB = c.NodeA.Other.InvI
	c.VPointCount = m.PointCount
	c.PRadiusA = a.Geometry.Radius
	c.PRadiusB = b.Geometry.Radius
	c.PType = m.Type
	c.PLocalNormal = m.LocalNormal
	c.PLocalPoint = m.LocalPoint
	c.PPointCount = m.PointCount

	for j := 0; j < m.PointCount; j++ {
		c.VPoints[j].NormalImpulse = 0
		c.VPoints[j].TangentImpulse = 0
		c.PLocalPoints[j] = m.Points[j]
	}
}

func (c *Contact) GetWorldManifold(wm *collision.WorldManifold) *collision.WorldManifold {
	return c.Manifold.GetWorldManifold(wm, c.NodeB.Other.Xf, c.FixtureA.Geometry.Radius, c.NodeA.Other.Xf, c.FixtureB.Geometry.Radius)
}

func (c *Contact) Evaluate(manifold *collision.Manifold, xfA, xfB Vec.TransformValue) float64 {
	switch a := c.FixtureA.Shape.(type) {
	case *shape.CircleShape:
		shape.CollideCircles(manifold, a, xfA, c.FixtureB.Shape.(*shape.CircleShape), xfB)
	case *shape.PolygonShape:
		switch b := c.FixtureB.Shape.(type) {
		case *shape.CircleShape:
			shape.CollidePolygonCircle(manifold, a, xfA, b, xfB)
		case *shape.PolygonShape:
			return shape.CollidePolygonsCached(manifold, a, xfA, b, xfB, c.NodeB.Other.World.Rules.LinearSlop, &c.separationCache)
		}
	}

	return 0
}

func (c *Contact) Update(listener *World) {
	if !c.allowsCollision(c.NodeB.Other.World) {
		c.EnabledFlag, c.TouchingFlag = false, false
		c.Manifold.PointCount = 0
		return
	}

	c.EnabledFlag = true
	a, b := c.NodeB.Other, c.NodeA.Other

	if c.separationUntil > 0 && c.separationUntil > c.pair.motion() {
		c.Manifold.PointCount = 0
		c.TouchingFlag = false
		return
	}

	gap := c.Evaluate(&c.Manifold, a.Xf, b.Xf)
	c.separationUntil = 0

	if gap > 0 && a.proxyRadius < 1e100 && b.proxyRadius < 1e100 {
		motion := c.pair.motion()
		c.separationUntil = motion + gap*.9999999 - 1e-5 - 1e-12*motion
	}

	c.TouchingFlag = c.Manifold.PointCount > 0

	if c.TouchingFlag && listener != nil {
		listener.PreSolve(c)
	}
}

func (c *Contact) SolvePositionConstraint() float64 { return c.solvePositionConstraint(nil, nil) }

func (c *Contact) SolvePositionConstraintTOI(toiA, toiB *Body) float64 {
	return c.solvePositionConstraint(toiA, toiB)
}

func (c *Contact) solvePositionConstraint(toiA, toiB *Body) float64 {
	toi := toiA != nil && toiB != nil
	minSeparation := 0.0
	bodyA, bodyB := c.NodeB.Other, c.NodeA.Other
	positionA, positionB := &bodyA.CPosition, &bodyB.CPosition
	mA, iA, mB, iB := 0.0, 0.0, 0.0, 0.0

	if !toi || bodyA == toiA || bodyA == toiB {
		mA = c.InvMassA
		iA = c.InvIA
	}

	if !toi || bodyB == toiA || bodyB == toiB {
		mB = c.InvMassB
		iB = c.InvIB
	}

	cA, aA, cB, aB := positionA.C, positionA.A, positionB.C, positionB.A

	for j := 0; j < c.PPointCount; j++ {
		xfA, xfB := Vec.Transform(cA.X, cA.Y, aA), Vec.Transform(cB.X, cB.Y, aB)
		var normal, point, pointA, pointB, planePoint, clipPoint Vec.Vector
		var separation float64

		switch c.PType {
		case "circles":
			Vec.TransformInto(&pointA, xfA, c.PLocalPoint)
			Vec.TransformInto(&pointB, xfB, c.PLocalPoints[0])
			normal = Vec.Normalize(Vec.Subtract(pointB, pointA))
			Vec.Combine2Into(&point, 0.5, pointA, 0.5, pointB)
			separation = Vec.Dot(pointB, normal) - Vec.Dot(pointA, normal) - c.PRadiusA - c.PRadiusB
		case "faceA":
			Vec.RotateInto(&normal, xfA.Q, c.PLocalNormal)
			Vec.TransformInto(&planePoint, xfA, c.PLocalPoint)
			Vec.TransformInto(&clipPoint, xfB, c.PLocalPoints[j])
			separation = Vec.Dot(clipPoint, normal) - Vec.Dot(planePoint, normal) - c.PRadiusA - c.PRadiusB
			point = clipPoint
		case "faceB":
			Vec.RotateInto(&normal, xfB.Q, c.PLocalNormal)
			Vec.TransformInto(&planePoint, xfB, c.PLocalPoint)
			Vec.TransformInto(&clipPoint, xfA, c.PLocalPoints[j])
			separation = Vec.Dot(clipPoint, normal) - Vec.Dot(planePoint, normal) - c.PRadiusA - c.PRadiusB
			point = clipPoint
			normal = Vec.Scale(normal, -1)
		default:
			return minSeparation
		}

		rA, rB := Vec.Subtract(point, cA), Vec.Subtract(point, cB)
		minSeparation = min(minSeparation, separation)
		rules := &bodyA.World.Rules
		baumgarte := rules.Physics.PositionBaumgarte

		if toi {
			baumgarte = rules.Physics.TOIBaumgarte
		}

		correction := max(-rules.Physics.MaxLinearCorrection, min(baumgarte*(separation+rules.LinearSlop), 0))
		rnA, rnB := Vec.Cross(rA, normal), Vec.Cross(rB, normal)
		k := mA + mB + iA*rnA*rnA + iB*rnB*rnB
		impulse := 0.0

		if k > 0 {
			impulse = -correction / k
		}

		p := Vec.Scale(normal, impulse)
		cA = Vec.AddScaled(cA, p, -mA)
		aA -= iA * Vec.Cross(rA, p)
		cB = Vec.AddScaled(cB, p, mB)
		aB += iB * Vec.Cross(rB, p)
	}

	positionA.C = cA
	positionA.A = aA
	positionB.C = cB
	positionB.A = aB
	return minSeparation
}

func (c *Contact) InitVelocityConstraint() {
	bodyA, bodyB := c.NodeB.Other, c.NodeA.Other
	cA, aA, vA, wA := bodyA.CPosition.C, bodyA.CPosition.A, bodyA.CVelocity.V, bodyA.CVelocity.W
	cB, aB, vB, wB := bodyB.CPosition.C, bodyB.CPosition.A, bodyB.CVelocity.V, bodyB.CVelocity.W
	mA, mB, iA, iB := c.InvMassA, c.InvMassB, c.InvIA, c.InvIB
	xfA, xfB := Vec.Transform(cA.X, cA.Y, aA), Vec.Transform(cB.X, cB.Y, aB)
	var wm collision.WorldManifold
	c.Manifold.GetWorldManifold(&wm, xfA, c.PRadiusA, xfB, c.PRadiusB)
	c.VNormal = wm.Normal
	var tangent, temp Vec.Vector

	for j := 0; j < c.VPointCount; j++ {
		vcp := &c.VPoints[j]
		wmp := wm.Points[j]
		vcp.RA = Vec.Subtract(wmp, cA)
		vcp.RB = Vec.Subtract(wmp, cB)
		rnA, rnB := Vec.Cross(vcp.RA, c.VNormal), Vec.Cross(vcp.RB, c.VNormal)
		kNormal := mA + mB + iA*rnA*rnA + iB*rnB*rnB
		vcp.NormalMass = 1 / kNormal
		Vec.CrossScalarInto(&tangent, c.VNormal, 1)
		rtA, rtB := Vec.Cross(vcp.RA, tangent), Vec.Cross(vcp.RB, tangent)
		kTangent := mA + mB + iA*rtA*rtA + iB*rtB*rtB
		vcp.TangentMass = 1 / kTangent
		vcp.VelocityBias = 0
		vRel := 0.0
		vRel += Vec.Dot(c.VNormal, vB)
		Vec.CrossScalarInto(&temp, vcp.RB, -wB)
		vRel += Vec.Dot(c.VNormal, temp)
		vRel -= Vec.Dot(c.VNormal, vA)
		Vec.CrossScalarInto(&temp, vcp.RA, -wA)
		vRel -= Vec.Dot(c.VNormal, temp)

		if c.SurfaceSpeed != 0 {
			vRel -= c.SurfaceSpeed
			vcp.VelocityBias = c.SurfaceSpeed
		}

		if vRel < -bodyA.World.Rules.ContactSpeedThreshold {
			vcp.VelocityBias -= c.Restitution * vRel
		}
	}

	if c.VPointCount == 2 {
		one, two := &c.VPoints[0], &c.VPoints[1]
		rn1A, rn1B, rn2A, rn2B := Vec.Cross(one.RA, c.VNormal), Vec.Cross(one.RB, c.VNormal), Vec.Cross(two.RA, c.VNormal), Vec.Cross(two.RB, c.VNormal)
		k11 := mA + mB + iA*rn1A*rn1A + iB*rn1B*rn1B
		k22 := mA + mB + iA*rn2A*rn2A + iB*rn2B*rn2B
		k12 := mA + mB + iA*rn1A*rn2A + iB*rn1B*rn2B

		if k11*k11 < 1000*(k11*k22-k12*k12) {
			c.VK.Ex = Vec.Create(k11, k12)
			c.VK.Ey = Vec.Create(k12, k22)
			a, b, d, e := c.VK.Ex.X, c.VK.Ey.X, c.VK.Ex.Y, c.VK.Ey.Y
			det := 1 / (a*e - b*d)
			c.VNormalMass.Ex.X = det * e
			c.VNormalMass.Ey.X = -det * b
			c.VNormalMass.Ex.Y = -det * d
			c.VNormalMass.Ey.Y = det * a
		} else {
			c.VPointCount = 1
		}
	}
}

func (c *Contact) SolveVelocityConstraint() bool {
	bodyA, bodyB := c.NodeB.Other, c.NodeA.Other
	vA, wA, vB, wB := bodyA.CVelocity.V, bodyA.CVelocity.W, bodyB.CVelocity.V, bodyB.CVelocity.W
	mA, iA, mB, iB := c.InvMassA, c.InvIA, c.InvMassB, c.InvIB
	converged := true
	normal := c.VNormal
	var tangent, temp Vec.Vector
	Vec.CrossScalarInto(&tangent, normal, 1)

	relative := func(vcp *VelocityConstraintPoint) Vec.Vector {
		dv := Vec.Vector{}
		dv = Vec.Add(dv, vB)
		Vec.CrossScalarInto(&temp, vcp.RB, -wB)
		dv = Vec.Add(dv, temp)
		dv = Vec.Subtract(dv, vA)
		Vec.CrossScalarInto(&temp, vcp.RA, -wA)
		dv = Vec.Subtract(dv, temp)
		return dv
	}

	for j := 0; j < c.VPointCount; j++ {
		vcp := &c.VPoints[j]
		dv := relative(vcp)
		vt := Vec.Dot(dv, tangent)
		lambda := vcp.TangentMass * -vt
		maxFriction := c.Friction * vcp.NormalImpulse
		newImpulse := max(-maxFriction, min(vcp.TangentImpulse+lambda, maxFriction))
		lambda = newImpulse - vcp.TangentImpulse
		converged = converged && math.Abs(lambda) <= velocityImpulseTolerance*(1+math.Abs(newImpulse))
		vcp.TangentImpulse = newImpulse
		p := Vec.Scale(tangent, lambda)
		vA = Vec.AddScaled(vA, p, -mA)
		wA -= iA * Vec.Cross(vcp.RA, p)
		vB = Vec.AddScaled(vB, p, mB)
		wB += iB * Vec.Cross(vcp.RB, p)
	}

	if c.VPointCount == 1 {
		vcp := &c.VPoints[0]
		dv := relative(vcp)
		vn := Vec.Dot(dv, normal)
		lambda := -vcp.NormalMass * (vn - vcp.VelocityBias)
		newImpulse := max(vcp.NormalImpulse+lambda, 0)
		lambda = newImpulse - vcp.NormalImpulse
		converged = converged && math.Abs(lambda) <= velocityImpulseTolerance*(1+math.Abs(newImpulse))
		vcp.NormalImpulse = newImpulse
		p := Vec.Scale(normal, lambda)
		vA = Vec.AddScaled(vA, p, -mA)
		wA -= iA * Vec.Cross(vcp.RA, p)
		vB = Vec.AddScaled(vB, p, mB)
		wB += iB * Vec.Cross(vcp.RB, p)
	} else {
		one, two := &c.VPoints[0], &c.VPoints[1]
		a := Vec.Create(one.NormalImpulse, two.NormalImpulse)
		dv1, dv2 := relative(one), relative(two)
		vn1, vn2 := Vec.Dot(dv1, normal), Vec.Dot(dv2, normal)
		b := Vec.Create(vn1-one.VelocityBias, vn2-two.VelocityBias)
		b.X -= c.VK.Ex.X*a.X + c.VK.Ey.X*a.Y
		b.Y -= c.VK.Ex.Y*a.X + c.VK.Ey.Y*a.Y

		apply := func(x Vec.Vector) {
			d := Vec.Subtract(x, a)
			converged = converged && math.Abs(d.X) <= velocityImpulseTolerance*(1+math.Abs(x.X)) && math.Abs(d.Y) <= velocityImpulseTolerance*(1+math.Abs(x.Y))
			p1, p2 := Vec.Scale(normal, d.X), Vec.Scale(normal, d.Y)
			Vec.Combine3Into(&vA, -mA, p1, -mA, p2, 1, vA)
			wA -= iA * (Vec.Cross(one.RA, p1) + Vec.Cross(two.RA, p2))
			Vec.Combine3Into(&vB, mB, p1, mB, p2, 1, vB)
			wB += iB * (Vec.Cross(one.RB, p1) + Vec.Cross(two.RB, p2))
			one.NormalImpulse = x.X
			two.NormalImpulse = x.Y
		}

		for {
			x := Vec.Create(-(c.VNormalMass.Ex.X*b.X + c.VNormalMass.Ey.X*b.Y), -(c.VNormalMass.Ex.Y*b.X + c.VNormalMass.Ey.Y*b.Y))

			if x.X >= 0 && x.Y >= 0 {
				apply(x)
				break
			}

			x.X = -one.NormalMass * b.X
			x.Y = 0
			vn2 = c.VK.Ex.Y*x.X + b.Y

			if x.X >= 0 && vn2 >= 0 {
				apply(x)
				break
			}

			x.X = 0
			x.Y = -two.NormalMass * b.Y
			vn1 = c.VK.Ey.X*x.Y + b.X

			if x.Y >= 0 && vn1 >= 0 {
				apply(x)
				break
			}

			x = Vec.Vector{}
			vn1 = b.X
			vn2 = b.Y

			if vn1 >= 0 && vn2 >= 0 {
				apply(x)
				break
			}

			break
		}
	}

	bodyA.CVelocity = Velocity{vA, wA}
	bodyB.CVelocity = Velocity{vB, wB}
	return converged
}

func (w *World) createContact(a, b *Fixture) *Contact {
	typeA, typeB := a.Geometry.Type, b.Geometry.Type

	if typeA == "circle" && typeB == "polygon" {
		a, b = b, a
	} else if !((typeA == "circle" && typeB == "circle") || (typeA == "polygon" && (typeB == "polygon" || typeB == "circle"))) {
		return nil
	}

	var c *Contact

	if w.contactPoolHead != nil {
		c = w.contactPoolHead
		w.contactPoolHead = c.Next

		if w.contactPoolHead == nil {
			w.contactPoolTail = nil
		}

		c.Next = nil
	} else {
		c = &Contact{TOI: 1, EnabledFlag: true}
	}

	c.separationCache = [2]uint8{}
	c.separationUntil = 0
	c.physical = a.Physics && b.Physics
	c.FixtureA = a
	c.FixtureB = b
	c.NodeA = ContactEdge{Contact: c, Other: b.Body, Next: a.Body.ContactList}

	if a.Body.ContactList != nil {
		a.Body.ContactList.Prev = &c.NodeA
	}

	a.Body.ContactList = &c.NodeA
	c.NodeB = ContactEdge{Contact: c, Other: a.Body, Next: b.Body.ContactList}

	if b.Body.ContactList != nil {
		b.Body.ContactList.Prev = &c.NodeB
	}

	b.Body.ContactList = &c.NodeB
	return c
}

func (c *Contact) destroy() {
	bodyA, bodyB := c.NodeB.Other, c.NodeA.Other

	if c.NodeA.Prev != nil {
		c.NodeA.Prev.Next = c.NodeA.Next
	}

	if c.NodeA.Next != nil {
		c.NodeA.Next.Prev = c.NodeA.Prev
	}

	if &c.NodeA == bodyA.ContactList {
		bodyA.ContactList = c.NodeA.Next
	}

	if c.NodeB.Prev != nil {
		c.NodeB.Prev.Next = c.NodeB.Next
	}

	if c.NodeB.Next != nil {
		c.NodeB.Next.Prev = c.NodeB.Prev
	}

	if &c.NodeB == bodyB.ContactList {
		bodyB.ContactList = c.NodeB.Next
	}

	// Solver fields are refreshed by InitConstraint, as in Contact.recycle.
	c.NodeA = ContactEdge{Contact: c}
	c.NodeB = ContactEdge{Contact: c}
	c.FixtureA = nil
	c.FixtureB = nil
	c.Manifold.Recycle()
	c.Prev = nil
	c.Next = nil
	c.TOI = 1
	c.TOICount = 0
	c.TOIFlag = false
	c.Friction = 0
	c.Restitution = 0
	c.SurfaceSpeed = 0
	c.EnabledFlag = true
	c.IslandFlag = false
	c.TouchingFlag = false
}
