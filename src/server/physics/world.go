// Port of src/client/physics/world.ts.
package physics

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
)

type World struct {
	toiRevision                      uint64
	contacts                         []*Contact
	contactCount                     int
	toiUnsorted                      bool
	neighborEpoch                    uint64
	Solver                           *Solver
	BroadPhase                       *collision.BroadPhase[*Fixture]
	ContactList                      *Contact
	toiPending, toiReady             []*Contact
	collectingTOI                    bool
	nextContactOrder                 uint64
	BodyList                         *Body
	activeBodies                     []*Body
	NewFixture, Locked               bool
	preSolveListener                 func(*Contact)
	step                             TimeStep
	Rules                            definitions.Simulation
	contactPoolHead, contactPoolTail *Contact
	LimitCollisionNeighbors          bool
}

func NewWorld(rules definitions.Simulation) *World {
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
	if len(w.contacts) > 2*w.contactCount+128 {
		count := 0

		for _, c := range w.contacts {
			if c != nil {
				c.listIndex = count
				w.contacts[count] = c
				count++
			}
		}

		clear(w.contacts[count:])
		w.contacts = w.contacts[:count]
	}

	if w.NewFixture {
		w.FindNewContacts()
		w.NewFixture = false
	}

	w.Locked = true
	w.prepareActiveBodies()

	if w.LimitCollisionNeighbors {
		w.prepareCollisionNeighbors()
	}

	w.step = TimeStep{DT: dt, VelocityIterations: velocityIterations, PositionIterations: positionIterations}
	w.UpdateContacts()

	if dt > 0 {
		w.Solver.SolveWorld(w.step)

		for _, b := range w.activeBodies {
			if b.IslandFlag {
				b.SynchronizeFixtures()
			}
		}

		w.FindNewContacts()

		if w.LimitCollisionNeighbors {
			w.prepareCollisionNeighbors()
		}

		w.Solver.SolveWorldTOI(w.step)
	}

	w.Locked = false
}

func (w *World) FindNewContacts() { w.BroadPhase.UpdatePairs(w.CreateContact) }

func (w *World) prepareActiveBodies() {
	clear(w.activeBodies)
	w.activeBodies = w.activeBodies[:0]

	for b := w.BodyList; b != nil; b = b.Next {
		b.IslandFlag = false
		b.solverContacts, b.solverTail = nil, nil

		if b.Parked {
			b.Sweep.Alpha0 = 0
		} else {
			w.activeBodies = append(w.activeBodies, b)
		}
	}
}

// Rank body neighbors once, sharing the result across all their fixtures.
// Contacts remain cached so a deferred neighbor is reconsidered next update.
func (w *World) prepareCollisionNeighbors() {
	w.neighborEpoch++

	for _, body := range w.activeBodies {
		if body.neighborCount <= 8 {
			continue
		}

		if !body.neighborDirty && body.Neighborhood == nil {
			continue
		}

		if body.neighborDirty {
			body.neighborDirty = false
			body.Neighborhood = nil
			count := 0

			for pair := body.pairs; pair != nil; pair = pair.next {
				count++
			}

			body.neighborCount = min(count, 9)

			if count <= 8 {
				continue
			}

			if body.neighborhoodCache == nil {
				body.neighborhoodCache = &CollisionNeighborhood{}
			}

			body.Neighborhood = body.neighborhoodCache
		}

		*body.Neighborhood = CollisionNeighborhood{}

		for pair := body.pairs; pair != nil; pair = pair.next {
			other := pair.other

			dx, dy := body.Xf.P.X-other.Xf.P.X, body.Xf.P.Y-other.Xf.P.Y
			body.AddCollisionNeighbor(other, dx*dx+dy*dy)
		}
	}
}

func (w *World) CreateContact(a, b *Fixture) {
	bodyA, bodyB := a.Body, b.Body

	if bodyA == bodyB {
		return
	}

	var pair *bodyPair

	for edge := bodyB.pairs; edge != nil; edge = edge.next {
		if edge.other == bodyA {
			pair = edge.pair
			break
		}
	}

	if pair != nil {
		for c := pair.contacts; c != nil; c = c.pairNext {
			if c.FixtureA == a && c.FixtureB == b || c.FixtureA == b && c.FixtureB == a {
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

	if w.LimitCollisionNeighbors && pair == nil {
		for _, body := range [2]*Body{bodyA, bodyB} {
			body.neighborCount = min(body.neighborCount+1, 9)

			if body.neighborCount == 9 {
				body.neighborDirty = true
			}
		}
	}

	w.nextContactOrder++
	contact.toiOrder = w.nextContactOrder
	contact.listIndex = len(w.contacts)
	w.contacts = append(w.contacts, contact)
	w.contactCount++
	w.linkPair(contact, pair)
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
	for i := len(w.contacts) - 1; i >= 0; i-- {
		c := w.contacts[i]

		if c == nil {
			continue
		}

		if !w.BroadPhase.TestOverlap(c.FixtureA.Proxy, c.FixtureB.Proxy) {
			w.DestroyContact(c)
		} else {
			c.Update(w)
			c.IslandFlag = false

			if c.EnabledFlag && c.TouchingFlag && c.physical {
				for _, edge := range [2]*ContactEdge{&c.NodeA, &c.NodeB} {
					body := edge.Other

					// Node A is linked to A and names B as Other.
					if edge == &c.NodeA {
						body = c.FixtureA.Body
					} else {
						body = c.FixtureB.Body
					}

					edge.solverNext = nil

					if body.solverTail == nil {
						body.solverContacts = edge
					} else {
						body.solverTail.solverNext = edge
					}

					body.solverTail = edge
				}
			}
		}
	}
}

func (w *World) DestroyContact(c *Contact) {
	w.contacts[c.listIndex] = nil
	w.contactCount--

	if w.LimitCollisionNeighbors {
		for _, body := range [2]*Body{c.FixtureA.Body, c.FixtureB.Body} {
			if body.neighborCount == 9 {
				body.neighborDirty = true
			}
		}
	}

	w.removeTOICandidate(c)
	w.unlinkPair(c)

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

// Pending contacts are evaluated in original contact order; ready contacts are
// ordered by impact time, breaking ties by that same contact order.
func (w *World) addTOICandidate(c *Contact) {
	if c.TOICount > maxTOISubsteps || c.toiQueue == 1 {
		return
	}

	w.removeTOICandidate(c)
	c.toiQueue = 1
	c.toiIndex = len(w.toiPending)

	if len(w.toiPending) > 0 && w.toiPending[len(w.toiPending)-1].toiOrder < c.toiOrder {
		w.toiUnsorted = true
	}

	w.toiPending = append(w.toiPending, c)
}

func toiBefore(a, b *Contact) bool {
	return a.TOI < b.TOI || (a.TOI == b.TOI && a.toiOrder > b.toiOrder)
}

func (w *World) toiUp(index int) int {
	c := w.toiReady[index]

	for index > 0 {
		parent := (index - 1) / 2

		if !toiBefore(c, w.toiReady[parent]) {
			break
		}

		w.toiReady[index] = w.toiReady[parent]
		w.toiReady[index].toiIndex = index
		index = parent
	}

	w.toiReady[index] = c
	c.toiIndex = index
	return index
}

func (w *World) toiDown(index int) {
	c := w.toiReady[index]

	for {
		child := 2*index + 1

		if child >= len(w.toiReady) {
			break
		}

		if child+1 < len(w.toiReady) && toiBefore(w.toiReady[child+1], w.toiReady[child]) {
			child++
		}

		if !toiBefore(w.toiReady[child], c) {
			break
		}

		w.toiReady[index] = w.toiReady[child]
		w.toiReady[index].toiIndex = index
		index = child
	}

	w.toiReady[index] = c
	c.toiIndex = index
}

func (w *World) pushTOI(c *Contact) {
	c.toiQueue = 2
	c.toiIndex = len(w.toiReady)
	w.toiReady = append(w.toiReady, c)
	w.toiUp(c.toiIndex)
}

func (w *World) removeTOICandidate(c *Contact) {
	index := c.toiIndex

	switch c.toiQueue {
	case 1:
		w.toiUnsorted = true
		last := len(w.toiPending) - 1
		w.toiPending[index] = w.toiPending[last]
		w.toiPending[index].toiIndex = index
		w.toiPending[last] = nil
		w.toiPending = w.toiPending[:last]
	case 2:
		last := len(w.toiReady) - 1
		w.toiReady[index] = w.toiReady[last]
		w.toiReady[index].toiIndex = index
		w.toiReady[last] = nil
		w.toiReady = w.toiReady[:last]

		if index < last && w.toiUp(index) == index {
			w.toiDown(index)
		}
	}

	c.toiQueue = 0
}
