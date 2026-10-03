package physics

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// One record per body pair avoids repeating neighbor and relative-motion work
// for every fixture pair. Contact order follows the newest live fixture contact.
type bodyPair struct {
	motionA, motionB  uint64
	motionBound       float64
	relative, reverse Vec.TransformValue
	motionReady       bool
	sweepRevision     uint64
	sweepBound        float64
	neighborEpoch     uint64
	allowed           bool
	contacts          *Contact
	a, b              bodyPairEdge
}
type bodyPairEdge struct {
	other      *Body
	pair       *bodyPair
	prev, next *bodyPairEdge
}

func unlinkPairEdge(body *Body, edge *bodyPairEdge) {
	if edge.prev != nil {
		edge.prev.next = edge.next
	} else {
		body.pairs = edge.next
	}
	if edge.next != nil {
		edge.next.prev = edge.prev
	}
	edge.prev, edge.next = nil, nil
}
func insertPairEdge(body *Body, edge *bodyPairEdge) {
	var previous *bodyPairEdge
	next := body.pairs
	for next != nil && next.pair.contacts.toiOrder > edge.pair.contacts.toiOrder {
		previous = next
		next = next.next
	}
	edge.prev, edge.next = previous, next
	if previous == nil {
		body.pairs = edge
	} else {
		previous.next = edge
	}
	if next != nil {
		next.prev = edge
	}
}
func (w *World) linkPair(c *Contact, pair *bodyPair) {
	a, b := c.FixtureA.Body, c.FixtureB.Body
	if pair == nil {
		pair = &bodyPair{}
		pair.a = bodyPairEdge{other: b, pair: pair}
		pair.b = bodyPairEdge{other: a, pair: pair}
	} else {
		a, b = pair.b.other, pair.a.other
		unlinkPairEdge(a, &pair.a)
		unlinkPairEdge(b, &pair.b)
	}
	c.pair = pair
	c.pairPrev = nil
	c.pairNext = pair.contacts
	if pair.contacts != nil {
		pair.contacts.pairPrev = c
	}
	pair.contacts = c
	insertPairEdge(a, &pair.a)
	insertPairEdge(b, &pair.b)
}
func (w *World) unlinkPair(c *Contact) {
	pair := c.pair
	a, b := pair.b.other, pair.a.other
	if c.pairNext != nil {
		c.pairNext.pairPrev = c.pairPrev
	}
	if c.pairPrev != nil {
		c.pairPrev.pairNext = c.pairNext
	} else {
		unlinkPairEdge(a, &pair.a)
		unlinkPairEdge(b, &pair.b)
		pair.contacts = c.pairNext
		if pair.contacts != nil {
			insertPairEdge(a, &pair.a)
			insertPairEdge(b, &pair.b)
		}
	}
	c.pair, c.pairPrev, c.pairNext = nil, nil, nil
}

func (c *Contact) allowsCollision(w *World) bool {
	if w.LimitCollisionNeighbors && c.pair != nil && c.pair.neighborEpoch == w.neighborEpoch && w.neighborEpoch != 0 {
		return c.pair.allowed
	}
	return c.refreshAllowed(w)
}
func (c *Contact) refreshAllowed(w *World) bool {
	pair := c.pair
	if pair == nil || !w.LimitCollisionNeighbors {
		return c.FixtureA.Body.AllowsCollision(c.FixtureB.Body) && c.FixtureB.Body.AllowsCollision(c.FixtureA.Body)
	}
	if pair.neighborEpoch != w.neighborEpoch || w.neighborEpoch == 0 {
		pair.neighborEpoch = w.neighborEpoch
		pair.allowed = pair.a.other.AllowsCollision(pair.b.other) && pair.b.other.AllowsCollision(pair.a.other)
	}
	return pair.allowed
}

func (p *bodyPair) motion() float64 {
	a, b := p.b.other, p.a.other
	if !p.motionReady || p.motionA != a.poseVersion || p.motionB != b.poseVersion {
		p.updateMotion(a, b)
	}
	return p.motionBound
}

// Bound translation and rotation in both reference frames: the last separating
// axis can belong to either body. Common world translation consumes no budget.
func (p *bodyPair) updateMotion(a, b *Body) {
	var relative, reverse Vec.TransformValue
	Vec.DetransformTransform(&relative, b.Xf, a.Xf)
	Vec.DetransformTransform(&reverse, a.Xf, b.Xf)
	if p.motionReady {
		change := math.Abs(relative.P.X-p.relative.P.X) + math.Abs(relative.P.Y-p.relative.P.Y) + a.proxyRadius*(math.Abs(relative.Q.S-p.relative.Q.S)+math.Abs(relative.Q.C-p.relative.Q.C))
		change = max(change, math.Abs(reverse.P.X-p.reverse.P.X)+math.Abs(reverse.P.Y-p.reverse.P.Y)+b.proxyRadius*(math.Abs(reverse.Q.S-p.reverse.Q.S)+math.Abs(reverse.Q.C-p.reverse.Q.C)))
		if change > 0 {
			p.motionBound = math.Nextafter(p.motionBound+change, math.Inf(1))
		}
	}
	p.motionA, p.motionB, p.relative, p.reverse, p.motionReady = a.poseVersion, b.poseVersion, relative, reverse, true
}

// Sweep.Advance only shortens the remaining interval. Physical TOI resolution
// increments the world revision because it can change the remaining trajectory.
func (p *bodyPair) sweepMotion(revision uint64) float64 {
	if p.sweepRevision != revision {
		p.sweepRevision = revision
		a, b := p.b.other, p.a.other
		sa, sb := &a.Sweep, &b.Sweep
		dx := (sa.C.X - sa.C0.X) - (sb.C.X - sb.C0.X)
		dy := (sa.C.Y - sa.C0.Y) - (sb.C.Y - sb.C0.Y)
		distance := math.Abs(sa.C.X-sb.C.X) + math.Abs(sa.C.Y-sb.C.Y)
		p.sweepBound = math.Abs(dx) + math.Abs(dy) + max(a.proxyRadius*math.Abs(sa.A-sa.A0)+(a.proxyRadius+distance)*math.Abs(sb.A-sb.A0), b.proxyRadius*math.Abs(sb.A-sb.A0)+(b.proxyRadius+distance)*math.Abs(sa.A-sa.A0))
	}
	return p.sweepBound
}
