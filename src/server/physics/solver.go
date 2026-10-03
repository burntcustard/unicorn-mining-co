// Port of src/client/physics/solver.ts.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

const maxTOISubsteps = 8
const toiEndTolerance = 1e-8

type TimeStep struct {
	DT                                     float64
	VelocityIterations, PositionIterations int
}

type Solver struct {
	World         *World
	Stack, Bodies []*Body
	Contacts      []*Contact
	isolated      []*Body
}

func (s *Solver) Clear() {
	clear(s.Stack)
	s.Stack = s.Stack[:0]
	clear(s.Bodies)
	s.Bodies = s.Bodies[:0]
	clear(s.Contacts)
	s.Contacts = s.Contacts[:0]
}

func (s *Solver) AddBody(b *Body) { s.Bodies = append(s.Bodies, b) }

func (s *Solver) AddContact(c *Contact) { s.Contacts = append(s.Contacts, c) }

func separatedThroughout(shapeA *collision.BaseShape, sweepA *collision.Sweep, shapeB *collision.BaseShape, sweepB *collision.Sweep, linearSlop float64) bool {
	boundA, boundB := shapeA.GetBound(), shapeB.GetBound()
	rotA, rotB := sweepA.Rotation0(), sweepB.Rotation0()
	dx := sweepB.C0.X + rotB.Cos*boundB.X - rotB.Sin*boundB.Y - (sweepA.C0.X + rotA.Cos*boundA.X - rotA.Sin*boundA.Y)
	dy := sweepB.C0.Y + rotB.Sin*boundB.X + rotB.Cos*boundB.Y - (sweepA.C0.Y + rotA.Sin*boundA.X + rotA.Cos*boundA.Y)
	vx := (sweepB.C.X - sweepB.C0.X) - (sweepA.C.X - sweepA.C0.X)
	vy := (sweepB.C.Y - sweepB.C0.Y) - (sweepA.C.Y - sweepA.C0.Y)
	length := vx*vx + vy*vy
	fraction := 0.0

	if length > 0 {
		fraction = max(0, min(1, -(dx*vx+dy*vy)/length))
	}

	dx += fraction * vx
	dy += fraction * vy
	rotation := boundA.OffsetRadius*math.Abs(sweepA.A-sweepA.A0) + boundB.OffsetRadius*math.Abs(sweepB.A-sweepB.A0)
	target := max(linearSlop, shapeA.Radius+shapeB.Radius-3*linearSlop)
	radius := boundA.Radius + boundB.Radius + rotation + target + 1.25*linearSlop + 1e-7
	return dx*dx+dy*dy > radius*radius

}

func (s *Solver) SolveWorld(step TimeStep) {
	world := s.World

	clear(s.isolated)
	isolated := s.isolated[:0]

	for _, seed := range world.activeBodies {
		if seed.IslandFlag || seed.Parked {
			continue
		}

		if seed.solverContacts == nil {
			seed.IslandFlag = true
			isolated = append(isolated, seed)
			continue
		}

		s.Clear()
		s.Stack = append(s.Stack, seed)
		seed.IslandFlag = true

		for len(s.Stack) > 0 {
			last := len(s.Stack) - 1
			b := s.Stack[last]
			s.Stack[last] = nil
			s.Stack = s.Stack[:last]
			s.AddBody(b)

			for ce := b.solverContacts; ce != nil; ce = ce.solverNext {
				c := ce.Contact

				if c.IslandFlag || !c.EnabledFlag || !c.TouchingFlag {
					continue
				}

				if !c.physical {
					continue
				}

				s.AddContact(c)
				c.IslandFlag = true
				other := ce.Other

				if other.IslandFlag {
					continue
				}

				s.Stack = append(s.Stack, other)
				other.IslandFlag = true
			}
		}

		s.SolveIsland(step)
	}

	s.Clear()
	bodies := s.Bodies
	s.Bodies = isolated

	if len(isolated) > 0 {
		s.SolveIsland(step)
	}

	s.Bodies, s.isolated = bodies, isolated
}

func (s *Solver) SolveIsland(step TimeStep) {
	h := step.DT
	rules := &s.World.Rules
	maxTranslation, maxRotation := rules.Physics.MaxTranslation, rules.Physics.MaxRotation

	for _, b := range s.Bodies {
		b.Sweep.C0 = b.Sweep.C
		b.Sweep.A0 = b.Sweep.A
		b.CPosition = Position{b.Sweep.C, b.Sweep.A}
		b.CVelocity = Velocity{b.LinearVelocity, b.AngularVelocity}
	}

	for _, c := range s.Contacts {
		c.InitConstraint()
	}

	for _, c := range s.Contacts {
		c.InitVelocityConstraint()
	}

	for range step.VelocityIterations {
		converged := true

		for _, contact := range s.Contacts {
			if !contact.SolveVelocityConstraint() {
				converged = false
			}
		}

		if converged {
			break
		}
	}

	for _, b := range s.Bodies {
		c, a, v, w := b.CPosition.C, b.CPosition.A, b.CVelocity.V, b.CVelocity.W
		translation := Vec.Scale(v, h)
		translationLengthSqr := Vec.LengthSquared(translation)

		if translationLengthSqr > maxTranslation*maxTranslation {
			ratio := maxTranslation / math.Sqrt(translationLengthSqr)
			v = Vec.Scale(v, ratio)
		}

		rotation := h * w

		if rotation*rotation > maxRotation*maxRotation {
			ratio := maxRotation / math.Abs(rotation)
			w *= ratio
		}

		c = Vec.AddScaled(c, v, h)
		a += h * w
		b.CPosition = Position{c, a}
		b.CVelocity = Velocity{v, w}
	}

	for i := 0; i < step.PositionIterations; i++ {
		minSeparation := 0.0

		for _, c := range s.Contacts {
			separation := c.SolvePositionConstraint()
			minSeparation = min(minSeparation, separation)
		}

		if minSeparation >= -3*rules.LinearSlop {
			break
		}
	}

	for _, b := range s.Bodies {
		b.Sweep.C = b.CPosition.C
		b.Sweep.A = b.CPosition.A
		b.LinearVelocity = b.CVelocity.V
		b.AngularVelocity = b.CVelocity.W
		b.SynchronizeTransform()
	}
}

func (s *Solver) SolveWorldTOI(step TimeStep) {
	world := s.World
	linearSlop := world.Rules.LinearSlop
	world.toiRevision++
	world.toiUnsorted = false
	clear(world.toiPending)
	clear(world.toiReady)
	world.toiPending = world.toiPending[:0]
	world.toiReady = world.toiReady[:0]
	world.collectingTOI = true

	defer func() { world.collectingTOI = false }()

	for _, b := range world.activeBodies {
		b.IslandFlag = false
		b.Sweep.Alpha0 = 0
	}

	for i := len(world.contacts) - 1; i >= 0; i-- {
		c := world.contacts[i]

		if c == nil {
			continue
		}

		c.TOIFlag = false
		c.IslandFlag = false
		c.TOICount = 0

		if c.TouchingFlag {
			c.TOICount = maxTOISubsteps + 1
		}

		c.TOI = 1
		c.toiQueue = 0

		if !c.allowsCollision(world) {
			c.EnabledFlag, c.TouchingFlag = false, false
			continue
		}

		if c.TOICount <= maxTOISubsteps {
			world.addTOICandidate(c)
		}
	}

	for {
		if world.toiUnsorted {
			slices.SortFunc(world.toiPending, func(a, b *Contact) int {
				if a.toiOrder > b.toiOrder {
					return -1
				}

				if a.toiOrder < b.toiOrder {
					return 1
				}

				return 0
			})
		}

		for _, c := range world.toiPending {
			c.toiQueue = 0

			if !c.EnabledFlag || c.TOICount > maxTOISubsteps {
				continue
			}

			alpha := 1.0

			if c.TOIFlag {
				alpha = c.TOI
			} else {
				fA, fB := c.FixtureA, c.FixtureB
				bA, bB := c.NodeB.Other, c.NodeA.Other
				alpha0 := bA.Sweep.Alpha0

				if bA.Sweep.Alpha0 < bB.Sweep.Alpha0 {
					alpha0 = bB.Sweep.Alpha0
					bA.Sweep.Advance(alpha0)
				} else if bB.Sweep.Alpha0 < bA.Sweep.Alpha0 {
					alpha0 = bA.Sweep.Alpha0
					bB.Sweep.Advance(alpha0)
				}

				radius := fA.Geometry.Radius + fB.Geometry.Radius
				target := max(linearSlop, radius-3*linearSlop)

				if !(c.separationUntil > 0 && c.separationUntil+radius > c.pair.motion()+c.pair.sweepMotion(world.toiRevision)+target+1.25*linearSlop) && !separatedThroughout(fA.Geometry, &bA.Sweep, fB.Geometry, &bB.Sweep, linearSlop) {
					sweepA, sweepB := collision.NewSweep(), collision.NewSweep()
					sweepA.Set(bA.Sweep)
					sweepB.Set(bB.Sweep)
					var output collision.TOIOutput
					collision.FindTimeOfImpact(&output, collision.TOIInput{ProxyA: fA.Geometry, ProxyB: fB.Geometry, SweepA: &sweepA, SweepB: &sweepB, TMax: 1}, linearSlop)

					if output.Touching {
						alpha = min(alpha0+(1-alpha0)*output.T, 1)
					}
				}

				c.TOI = alpha
				c.TOIFlag = true
			}

			if alpha < 1 {
				world.pushTOI(c)
			}
		}

		world.toiUnsorted = false
		clear(world.toiPending)
		world.toiPending = world.toiPending[:0]

		if len(world.toiReady) == 0 {
			break
		}

		minContact := world.toiReady[0]
		minAlpha := minContact.TOI
		world.removeTOICandidate(minContact)

		if minContact == nil || 1-toiEndTolerance < minAlpha {
			break
		}

		bA, bB := minContact.NodeB.Other, minContact.NodeA.Other
		backup1, backup2 := collision.NewSweep(), collision.NewSweep()
		backup1.Set(bA.Sweep)
		backup2.Set(bB.Sweep)
		bA.Advance(minAlpha)
		bB.Advance(minAlpha)
		minContact.Update(world)
		minContact.TOIFlag = false
		minContact.TOICount++

		if minContact.TOICount > maxTOISubsteps {
			world.removeTOICandidate(minContact)
		}

		if !minContact.EnabledFlag || !minContact.TouchingFlag {
			minContact.EnabledFlag = false
			bA.Sweep.Set(backup1)
			bB.Sweep.Set(backup2)
			bA.SynchronizeTransform()
			bB.SynchronizeTransform()
			continue
		}

		if !minContact.physical {
			minContact.TOI = 1
			minContact.TOIFlag = true
			world.removeTOICandidate(minContact)
			bA.Sweep.Set(backup1)
			bB.Sweep.Set(backup2)
			bA.SynchronizeTransform()
			bB.SynchronizeTransform()
			continue
		}

		s.Clear()
		s.AddBody(bA)
		s.AddBody(bB)
		s.AddContact(minContact)
		bA.IslandFlag = true
		bB.IslandFlag = true
		minContact.IslandFlag = true

		for _, body := range [2]*Body{bA, bB} {
			for ce := body.ContactList; ce != nil; ce = ce.Next {
				contact, other := ce.Contact, ce.Other

				if contact.IslandFlag {
					continue
				}

				if !contact.physical {
					continue
				}

				backup := collision.NewSweep()
				backup.Set(other.Sweep)

				if !other.IslandFlag {
					other.Advance(minAlpha)
				}

				contact.Update(world)

				if !contact.EnabledFlag || !contact.TouchingFlag {
					other.Sweep.Set(backup)
					other.SynchronizeTransform()
					continue
				}

				contact.IslandFlag = true
				s.AddContact(contact)

				if other.IslandFlag {
					continue
				}

				other.IslandFlag = true
				s.AddBody(other)
			}
		}

		subStep := TimeStep{DT: (1 - minAlpha) * step.DT, PositionIterations: 20, VelocityIterations: step.VelocityIterations}
		s.SolveIslandTOI(subStep, bA, bB)
		world.toiRevision++

		for _, body := range s.Bodies {
			body.IslandFlag = false
			body.SynchronizeFixtures()

			for ce := body.ContactList; ce != nil; ce = ce.Next {
				ce.Contact.TOIFlag = false
				world.addTOICandidate(ce.Contact)
				ce.Contact.IslandFlag = false
			}
		}

		world.FindNewContacts()
	}
}

func (s *Solver) SolveIslandTOI(subStep TimeStep, toiA, toiB *Body) {
	rules := &s.World.Rules

	for _, body := range s.Bodies {
		body.CPosition = Position{body.Sweep.C, body.Sweep.A}
		body.CVelocity = Velocity{body.LinearVelocity, body.AngularVelocity}
	}

	for _, contact := range s.Contacts {
		contact.InitConstraint()
	}

	for i := 0; i < subStep.PositionIterations; i++ {
		minSeparation := 0.0

		for _, contact := range s.Contacts {
			separation := contact.SolvePositionConstraintTOI(toiA, toiB)
			minSeparation = min(minSeparation, separation)
		}

		if minSeparation >= -1.5*rules.LinearSlop {
			break
		}
	}

	toiA.Sweep.C0 = toiA.CPosition.C
	toiA.Sweep.A0 = toiA.CPosition.A
	toiB.Sweep.C0 = toiB.CPosition.C
	toiB.Sweep.A0 = toiB.CPosition.A

	for _, contact := range s.Contacts {
		contact.InitVelocityConstraint()
	}

	for range subStep.VelocityIterations {
		converged := true

		for _, contact := range s.Contacts {
			if !contact.SolveVelocityConstraint() {
				converged = false
			}
		}

		if converged {
			break
		}
	}

	h := subStep.DT
	maxTranslation, maxRotation := rules.Physics.MaxTranslation, rules.Physics.MaxRotation

	for _, body := range s.Bodies {
		c, a, v, w := body.CPosition.C, body.CPosition.A, body.CVelocity.V, body.CVelocity.W
		translation := Vec.Scale(v, h)
		translationLengthSqr := Vec.LengthSquared(translation)

		if translationLengthSqr > maxTranslation*maxTranslation {
			ratio := maxTranslation / math.Sqrt(translationLengthSqr)
			v = Vec.Scale(v, ratio)
		}

		rotation := h * w

		if rotation*rotation > maxRotation*maxRotation {
			ratio := maxRotation / math.Abs(rotation)
			w *= ratio
		}

		c = Vec.AddScaled(c, v, h)
		a += h * w
		body.CPosition = Position{c, a}
		body.CVelocity = Velocity{v, w}
		body.Sweep.C = c
		body.Sweep.A = a
		body.LinearVelocity = v
		body.AngularVelocity = w
		body.SynchronizeTransform()
	}
}
