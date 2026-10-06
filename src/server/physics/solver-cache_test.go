package physics

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"math/rand/v2"
	"testing"
)

func TestCachedSeparationAcrossMotion(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	random := rand.New(rand.NewPCG(17, 91))
	skipped := 0

	for trial := 0; trial < 200; trial++ {
		world := NewWorld(catalog.Simulation)
		a, b := world.CreateBody(), world.CreateBody()
		polygonA := shape.NewPolygon([]Vec.Vector{{X: -10, Y: -7}, {X: 13, Y: -5}, {X: 2, Y: 15}}, nil, .5)
		polygonB := shape.NewPolygon([]Vec.Vector{{X: -8, Y: -11}, {X: 8, Y: -11}, {X: 8, Y: 11}, {X: -8, Y: 11}}, nil, .5)
		fa, fb := a.CreateFixture(polygonA, FixtureOpt{}), b.CreateFixture(polygonB, FixtureOpt{})
		a.SetProxyRadius(30)
		b.SetProxyRadius(30)
		world.CreateContact(fa, fb)
		c := world.ContactList
		origin := float64(trial%3) * 1e7
		x, y, angle := 40+random.Float64()*60, random.Float64()*20, random.Float64()*6
		angleA := random.Float64() * 6
		a.SetTransform(Vec.Create(origin, origin), angleA)

		for step := 0; step < 200; step++ {
			x -= random.Float64()
			y += random.Float64() - .5
			angle += (random.Float64() - .5) * .03
			angleA += (random.Float64() - .5) * .03
			travel := float64(step) * 20
			a.SetTransform(Vec.Create(origin+travel, origin), angleA)
			b.SetTransform(Vec.Create(origin+travel+x, origin+y), angle)

			if c.separationUntil > c.pair.motion() {
				skipped++
			}

			c.Update(nil)
			var expected collision.Manifold
			shape.CollidePolygons(&expected, polygonA, a.Xf, polygonB, b.Xf, .5)

			if c.Manifold.PointCount != expected.PointCount || expected.PointCount > 0 && (c.Manifold.Type != expected.Type || c.Manifold.LocalNormal != expected.LocalNormal || c.Manifold.LocalPoint != expected.LocalPoint || c.Manifold.Points[0] != expected.Points[0] || expected.PointCount == 2 && c.Manifold.Points[1] != expected.Points[1]) {
				t.Fatalf("trial %d step %d: cached manifold %+v != %+v", trial, step, c.Manifold, expected)
			}
		}

		c.separationUntil = c.pair.motion() + 100
		a.SetProxyRadius(math.Inf(1))

		if c.separationUntil != 0 {
			t.Fatal("changing the motion radius retained a stale separation bound")
		}
	}

	if skipped < 1000 {
		t.Fatalf("only %d cached rejections exercised", skipped)
	}
}

func TestCachedSeparationRejectsNoContinuousImpact(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	random := rand.New(rand.NewPCG(31, 83))
	cached, relative := 0, 0

	for trial := 0; trial < 10000; trial++ {
		world := NewWorld(catalog.Simulation)
		a, b := world.CreateBody(), world.CreateBody()
		polygon := shape.NewPolygon([]Vec.Vector{{X: -10, Y: -7}, {X: 13, Y: -5}, {X: 2, Y: 15}}, nil, .5)
		fa, fb := a.CreateFixture(polygon, FixtureOpt{}), b.CreateFixture(polygon, FixtureOpt{})
		a.SetProxyRadius(30)
		b.SetProxyRadius(30)
		origin := float64(trial%3) * 1e7
		a.SetTransform(Vec.Create(origin, origin), random.Float64()*6)
		b.SetTransform(Vec.Create(origin+random.Float64()*160-80, origin+random.Float64()*160-80), random.Float64()*6)
		world.CreateContact(fa, fb)
		c := world.ContactList
		c.Update(nil)

		for _, body := range []*Body{a, b} {
			body.Sweep.C.X += random.Float64()*30 - 15
			body.Sweep.C.Y += random.Float64()*30 - 15
			body.Sweep.A += random.Float64() - .5
			body.SynchronizeTransform()
		}

		cachedReject := c.separationUntil > 0 && c.separationUntil+fa.Geometry.Radius+fb.Geometry.Radius > c.pair.motion()+c.pair.sweepMotion(1)+max(.5, fa.Geometry.Radius+fb.Geometry.Radius-1.5)+1.25*.5
		relativeReject := separatedThroughout(fa.Geometry, &a.Sweep, fb.Geometry, &b.Sweep, .5)

		if cachedReject {
			cached++
		}

		if relativeReject {
			relative++
		}

		if !cachedReject && !relativeReject {
			continue
		}

		sa, sb := a.Sweep, b.Sweep
		var output collision.TOIOutput
		collision.FindTimeOfImpact(&output, collision.TOIInput{ProxyA: fa.Geometry, ProxyB: fb.Geometry, SweepA: &sa, SweepB: &sb, TMax: 1}, .5)

		if output.Touching {
			t.Fatalf("trial %d rejected a continuous impact: cached=%v relative=%v", trial, cachedReject, relativeReject)
		}
	}

	if cached < 100 || relative < 100 {
		t.Fatalf("too few rejections: cached=%d relative=%d", cached, relative)
	}
}

func TestBodyPairsFollowContactOrderThroughReuse(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := NewWorld(catalog.Simulation)
	random := rand.New(rand.NewPCG(5, 71))
	var bodies []*Body
	var fixtures []*Fixture

	for range 12 {
		b := world.CreateBody()
		bodies = append(bodies, b)

		for range 3 {
			fixtures = append(fixtures, b.CreateFixture(shape.NewCircle(Vec.Create(0, 0), 10), FixtureOpt{}))
		}
	}

	for step := 0; step < 3000; step++ {
		if random.IntN(3) == 0 && world.ContactList != nil {
			c := world.ContactList

			for i := 0; i < random.IntN(12) && c.Next != nil; i++ {
				c = c.Next
			}

			world.DestroyContact(c)
		} else {
			world.CreateContact(fixtures[random.IntN(len(fixtures))], fixtures[random.IntN(len(fixtures))])
		}

		for _, body := range bodies {
			seen := map[*Body]bool{}
			edge := body.pairs

			for ce := body.ContactList; ce != nil; ce = ce.Next {
				if seen[ce.Other] {
					continue
				}

				seen[ce.Other] = true

				if edge == nil || edge.other != ce.Other || edge.pair.contacts != ce.Contact {
					t.Fatalf("step %d: body pair order differs from contact order", step)
				}

				for c := edge.pair.contacts; c != nil; c = c.pairNext {
					if c.pair != edge.pair || c.pairNext != nil && c.pairNext.pairPrev != c {
						t.Fatal("broken pair links")
					}
				}

				edge = edge.next
			}

			if edge != nil {
				t.Fatal("stale body pair")
			}
		}
	}

	for _, body := range bodies {
		world.DestroyBody(body)

		if body.pairs != nil {
			t.Fatal("destroyed body retains pairs")
		}
	}
}

func TestTOIHeapInvalidationAndTies(t *testing.T) {
	world := &World{}
	random := rand.New(rand.NewPCG(8, 61))
	contacts := make([]*Contact, 200)

	for i := range contacts {
		contacts[i] = &Contact{toiOrder: uint64(i + 1)}
	}

	for range 10000 {
		c := contacts[random.IntN(len(contacts))]
		world.removeTOICandidate(c)

		if random.IntN(4) != 0 {
			c.TOI = float64(random.IntN(16)) / 16
			world.pushTOI(c)
		}

		var expected *Contact

		for _, c := range contacts {
			if c.toiQueue == 2 && (expected == nil || toiBefore(c, expected)) {
				expected = c
			}
		}

		if expected == nil {
			if len(world.toiReady) != 0 {
				t.Fatal("nonempty heap")
			}
		} else if world.toiReady[0] != expected {
			t.Fatal("incorrect time/order priority")
		}

		for i, c := range world.toiReady {
			if c.toiIndex != i {
				t.Fatal("stale heap index")
			}
		}
	}

	for _, c := range contacts {
		c.TOIFlag = false
		world.addTOICandidate(c)
		world.addTOICandidate(c)
	}

	if len(world.toiReady) != 0 || len(world.toiPending) != len(contacts) {
		t.Fatal("invalidation duplicated or retained ready contacts")
	}

	for _, c := range contacts {
		world.removeTOICandidate(c)
	}

	if len(world.toiPending) != 0 {
		t.Fatal("pending removal retained contacts")
	}
}

func TestAdvanceInvalidatesCachedSeparation(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := NewWorld(catalog.Simulation)
	a, b := world.CreateBody(), world.CreateBody()
	polygon := shape.NewPolygon([]Vec.Vector{{X: -10, Y: -10}, {X: 10, Y: -10}, {X: 10, Y: 10}, {X: -10, Y: 10}}, nil, .5)
	fa, fb := a.CreateFixture(polygon, FixtureOpt{}), b.CreateFixture(polygon, FixtureOpt{})
	a.SetProxyRadius(20)
	b.SetProxyRadius(20)
	b.SetTransform(Vec.Create(60, 0), 0)
	world.CreateContact(fa, fb)
	c := world.ContactList
	c.Update(nil)

	if c.separationUntil <= c.pair.motion() {
		t.Fatal("test did not establish a separation cache")
	}

	b.Sweep.C0 = Vec.Create(15, 0)
	b.Advance(0)
	c.Update(nil)

	if !c.TouchingFlag {
		t.Fatal("TOI advance reused separation from the end pose")
	}
}

func TestDenseContactsCompactWithoutChangingOrder(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := NewWorld(catalog.Simulation)
	a, b := world.CreateBody(), world.CreateBody()
	fa := a.CreateFixture(shape.NewCircle(Vec.Create(0, 0), 10), FixtureOpt{})
	fb := b.CreateFixture(shape.NewCircle(Vec.Create(0, 0), 10), FixtureOpt{})

	for range 200 {
		world.CreateContact(fa, fb)
		world.DestroyContact(world.ContactList)
	}

	world.CreateContact(fa, fb)
	live := world.ContactList

	if len(world.contacts) <= 128 {
		t.Fatal("compaction was not exercised")
	}

	world.Step(0, 8, 3)

	if len(world.contacts) != 1 || world.contacts[0] != live || live.listIndex != 0 || world.ContactList != live || world.contactCount != 1 {
		t.Fatal("compaction changed live contact identity or indexing")
	}

	world.DestroyBody(a)

	if world.contactCount != 0 || world.ContactList != nil || world.contacts[0] != nil {
		t.Fatal("destroy after compaction retained contact")
	}
}
