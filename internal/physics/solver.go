// Port of src/shared/physics/solver.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
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
func (s *Solver) AddBody(b *Body)       { s.Bodies = append(s.Bodies, b) }
func (s *Solver) AddContact(c *Contact) { s.Contacts = append(s.Contacts, c) }
func separatedThroughout(shapeA *collision.BaseShape, sweepA *collision.Sweep, shapeB *collision.BaseShape, sweepB *collision.Sweep, linearSlop float64) bool {
	boundA, boundB := shapeA.GetBound(), shapeB.GetBound()
	rotA, rotB := sweepA.Rotation0(), sweepB.Rotation0()
	dx := sweepB.C0.X + rotB.C*boundB.X - rotB.S*boundB.Y - (sweepA.C0.X + rotA.C*boundA.X - rotA.S*boundA.Y)
	dy := sweepB.C0.Y + rotB.S*boundB.X + rotB.C*boundB.Y - (sweepA.C0.Y + rotA.S*boundA.X + rotA.C*boundA.Y)
	ax, ay, bx, by := sweepA.C.X-sweepA.C0.X, sweepA.C.Y-sweepA.C0.Y, sweepB.C.X-sweepB.C0.X, sweepB.C.Y-sweepB.C0.Y
	motion := math.Sqrt(ax*ax+ay*ay) + boundA.OffsetRadius*math.Abs(sweepA.A-sweepA.A0) + math.Sqrt(bx*bx+by*by) + boundB.OffsetRadius*math.Abs(sweepB.A-sweepB.A0)
	target := max(linearSlop, shapeA.Radius+shapeB.Radius-3*linearSlop)
	return math.Sqrt(dx*dx+dy*dy)-motion-boundA.Radius-boundB.Radius > target+1.25*linearSlop
}
func (s *Solver) SolveWorld(step TimeStep) {
	world := s.World
	for c := world.ContactList; c != nil; c = c.Next {
		c.IslandFlag = false
	}
	clear(s.isolated)
	isolated := s.isolated[:0]
	for _, seed := range world.activeBodies {
		if seed.IslandFlag || seed.Parked {
			continue
		}
		if seed.ContactList == nil {
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
			for ce := b.ContactList; ce != nil; ce = ce.Next {
				c := ce.Contact
				if c.IslandFlag || !c.EnabledFlag || !c.TouchingFlag {
					continue
				}
				if !c.FixtureA.Physics || !c.FixtureB.Physics {
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
	for i := 0; i < step.VelocityIterations; i++ {
		for _, c := range s.Contacts {
			c.SolveVelocityConstraint()
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
	world.toiCandidates = nil
	world.collectingTOI = true
	defer func() { world.collectingTOI = false }()
	var tail *Contact
	for _, b := range world.activeBodies {
		b.IslandFlag = false
		b.Sweep.Alpha0 = 0
	}
	for c := world.ContactList; c != nil; c = c.Next {
		c.TOIFlag = false
		c.IslandFlag = false
		c.TOICount = 0
		if c.TouchingFlag {
			c.TOICount = maxTOISubsteps + 1
		}
		c.TOI = 1
		c.TOIPrev, c.TOINext = nil, nil
		c.toiListed = false
		if c.TOICount <= maxTOISubsteps {
			c.toiListed = true
			c.TOIPrev = tail
			if tail == nil {
				world.toiCandidates = c
			} else {
				tail.TOINext = c
			}
			tail = c
		}
	}
	for {
		var minContact *Contact
		minAlpha := 1.0
		for c := world.toiCandidates; c != nil; {
			next := c.TOINext
			if !c.EnabledFlag || c.TOICount > maxTOISubsteps {
				c = next
				continue
			}
			alpha := 1.0
			if c.TOIFlag {
				alpha = c.TOI
			} else {
				fA, fB := c.FixtureA, c.FixtureB
				bA, bB := fA.Body, fB.Body
				alpha0 := bA.Sweep.Alpha0
				if bA.Sweep.Alpha0 < bB.Sweep.Alpha0 {
					alpha0 = bB.Sweep.Alpha0
					bA.Sweep.Advance(alpha0)
				} else if bB.Sweep.Alpha0 < bA.Sweep.Alpha0 {
					alpha0 = bA.Sweep.Alpha0
					bB.Sweep.Advance(alpha0)
				}
				if !separatedThroughout(fA.Geometry, &bA.Sweep, fB.Geometry, &bB.Sweep, linearSlop) {
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
			if alpha < minAlpha {
				minContact = c
				minAlpha = alpha
			}
			if alpha >= 1 {
				world.removeTOICandidate(c)
			}
			c = next
		}
		if minContact == nil || 1-toiEndTolerance < minAlpha {
			break
		}
		fA, fB := minContact.FixtureA, minContact.FixtureB
		bA, bB := fA.Body, fB.Body
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
		if !fA.Physics || !fB.Physics {
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
				if !contact.FixtureA.Physics || !contact.FixtureB.Physics {
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
	for i := 0; i < subStep.VelocityIterations; i++ {
		for _, contact := range s.Contacts {
			contact.SolveVelocityConstraint()
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
