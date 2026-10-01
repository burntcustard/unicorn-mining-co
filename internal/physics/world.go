// Port of src/shared/physics/world.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type World struct {
	Solver                           *Solver
	BroadPhase                       *collision.BroadPhase[*Fixture]
	ContactList                      *Contact
	toiCandidates                    *Contact
	collectingTOI                    bool
	nextContactOrder                 uint64
	BodyList                         *Body
	activeBodies                     []*Body
	NewFixture, Locked               bool
	preSolveListener                 func(*Contact)
	step                             TimeStep
	Rules                            specification.Simulation
	contactPoolHead, contactPoolTail *Contact
}

func NewWorld(rules specification.Simulation) *World {
	w := &World{Rules: rules}
	w.Solver = &Solver{World: w}
	w.BroadPhase = collision.NewBroadPhase[*Fixture](rules.Physics, func(f *Fixture) any { return f.Body })
	return w
}
func (w *World) addBody(b *Body) {
	if w.Locked {
		return
	}
	b.Prev = nil
	b.Next = w.BodyList
	if w.BodyList != nil {
		w.BodyList.Prev = b
	}
	w.BodyList = b
}
func (w *World) CreateBody() *Body {
	if w.Locked {
		panic("Cannot create a body during a step")
	}
	b := newBody(w)
	w.addBody(b)
	return b
}
func (w *World) DestroyBody(b *Body) bool {
	if w.Locked || b.Destroyed {
		return false
	}
	for ce := b.ContactList; ce != nil; {
		old := ce
		ce = ce.Next
		w.DestroyContact(old.Contact)
		b.ContactList = ce
	}
	b.ContactList = nil
	for f := b.FixtureList; f != nil; {
		old := f
		f = f.Next
		old.DestroyProxies(w.BroadPhase)
		b.FixtureList = f
	}
	b.FixtureList = nil
	if b.Prev != nil {
		b.Prev.Next = b.Next
	}
	if b.Next != nil {
		b.Next.Prev = b.Prev
	}
	if b == w.BodyList {
		w.BodyList = b.Next
	}
	b.Destroyed = true
	return true
}
func (w *World) Step(dt float64, velocityIterations, positionIterations int) {
	if w.NewFixture {
		w.FindNewContacts()
		w.NewFixture = false
	}
	w.Locked = true
	w.step = TimeStep{DT: dt, VelocityIterations: velocityIterations, PositionIterations: positionIterations}
	w.UpdateContacts()
	if dt > 0 {
		clear(w.activeBodies)
		w.activeBodies = w.activeBodies[:0]
		for b := w.BodyList; b != nil; b = b.Next {
			b.IslandFlag = false
			if b.Parked {
				b.Sweep.Alpha0 = 0
			} else {
				w.activeBodies = append(w.activeBodies, b)
			}
		}
		w.Solver.SolveWorld(w.step)
		for _, b := range w.activeBodies {
			if b.IslandFlag {
				b.SynchronizeFixtures()
			}
		}
		w.FindNewContacts()
		w.Solver.SolveWorldTOI(w.step)
	}
	w.Locked = false
}
func (w *World) FindNewContacts() { w.BroadPhase.UpdatePairs(w.CreateContact) }
func (w *World) CreateContact(a, b *Fixture) {
	bodyA, bodyB := a.Body, b.Body
	if bodyA == bodyB {
		return
	}
	for edge := bodyB.ContactList; edge != nil; edge = edge.Next {
		if edge.Other == bodyA {
			fa, fb := edge.Contact.FixtureA, edge.Contact.FixtureB
			if (fa == a && fb == b) || (fa == b && fb == a) {
				return
			}
		}
	}
	if !b.ShouldCollide(a) {
		return
	}
	contact := w.createContact(a, b)
	if contact == nil {
		return
	}
	w.nextContactOrder++
	contact.toiOrder = w.nextContactOrder
	contact.Prev = nil
	if w.ContactList != nil {
		contact.Next = w.ContactList
		w.ContactList.Prev = contact
	}
	w.ContactList = contact
	if w.collectingTOI {
		w.addTOICandidate(contact)
	}
}
func (w *World) UpdateContacts() {
	for c := w.ContactList; c != nil; {
		next := c.Next
		if !w.BroadPhase.TestOverlap(c.FixtureA.Proxy, c.FixtureB.Proxy) {
			w.DestroyContact(c)
		} else {
			c.Update(w)
		}
		c = next
	}
}
func (w *World) DestroyContact(c *Contact) {
	w.removeTOICandidate(c)
	if c.Prev != nil {
		c.Prev.Next = c.Next
	}
	if c.Next != nil {
		c.Next.Prev = c.Prev
	}
	if c == w.ContactList {
		w.ContactList = c.Next
	}
	c.destroy()
	if w.contactPoolTail == nil {
		w.contactPoolHead = c
	} else {
		w.contactPoolTail.Next = c
	}
	w.contactPoolTail = c
}
func (w *World) OnPreSolve(listener func(*Contact)) { w.preSolveListener = listener }
func (w *World) PreSolve(c *Contact) {
	if w.preSolveListener != nil {
		w.preSolveListener(c)
	}
}

// Keep the original contact order while excluding contacts whose continuous
// collision budget is exhausted. New contacts join at the same head position.
func (w *World) addTOICandidate(c *Contact) {
	if c.toiListed || c.TOICount > maxTOISubsteps {
		return
	}
	c.toiListed = true
	var previous *Contact
	next := w.toiCandidates
	for next != nil && next.toiOrder > c.toiOrder {
		previous = next
		next = next.TOINext
	}
	c.TOIPrev, c.TOINext = previous, next
	if previous == nil {
		w.toiCandidates = c
	} else {
		previous.TOINext = c
	}
	if next != nil {
		next.TOIPrev = c
	}
}
func (w *World) removeTOICandidate(c *Contact) {
	if !c.toiListed {
		return
	}
	if c.TOIPrev != nil {
		c.TOIPrev.TOINext = c.TOINext
	} else {
		w.toiCandidates = c.TOINext
	}
	if c.TOINext != nil {
		c.TOINext.TOIPrev = c.TOIPrev
	}
	c.TOIPrev, c.TOINext = nil, nil
	c.toiListed = false
}
