package gameplay

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestTransitRestoresGateContactResolution(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, transit := range []float64{-1, 1} {
		world := simulation.CreateWorld(1, catalog)
		gate := objects.NewPortal(world, objects.PortalOptions{ID: 100}).(*objects.JumpGate)
		ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: new(int64(1)), Position: Vec.Create(-600, 50), Velocity: Vec.Create(200, 0)}})
		simulation.AddEntity(world, ship)
		simulation.AddEntity(world, gate)
		collisions := NewGameCollisions(catalog)
		dt := catalog.Simulation.SimulationStep

		for tick := range 5 {
			if tick == 1 {
				ship.TransitTime = transit
				ship.Position, ship.Velocity = Vec.Create(-260, 50), Vec.Vector{}
			} else if tick == 4 {
				ship.TransitTime = 0
			}

			collisions.CapturePoses(world.Entities)
			ship.Position = Vec.AddScaled(ship.Position, ship.Velocity, dt)
			ship.Rotation += ship.Spin * dt
			gate.Update(dt)
			events := []protocol.SimulationEvent{}
			contacts := collisions.Step(world.Entities, dt, &events)

			if tick > 0 && tick < 4 && (len(contacts) != 0 || ship.Position != Vec.Create(-260, 50)) {
				t.Fatal("transit retained the ship's hull contacts")
			}

			// The client resolves this same reappearing hull in gate-collisions.test.ts.
			if tick == 4 && (len(contacts) != 26 || Vec.Distance(ship.Position, Vec.Create(-301.495235249135, 70.9125652827912)) > 1e-6 || math.Abs(ship.Rotation-(-.5729154036690284)) > 1e-6) {
				t.Fatalf("transit %g changed restored gate contacts: position=%v rotation=%g contacts=%d", transit, ship.Position, ship.Rotation, len(contacts))
			}
		}
	}
}

func TestGateFixturesRefreshAfterSettledPoseAndOpeningChanges(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	gate := objects.NewPortal(world, objects.PortalOptions{ID: 100}).(*objects.JumpGate)
	collisions := NewGameCollisions(catalog)
	record := collisions.sync(gate)
	original := append(record.Fixtures[:0:0], record.Fixtures...)
	left := make([]float64, len(original))

	for i, fixture := range original {
		left[i] = math.Inf(1)

		for _, point := range fixture.Shape.Base().Vertices {
			left[i] = min(left[i], point.X)
		}
	}

	gate.Position, gate.Rotation = Vec.Create(1234, -5678), .71
	collisions.sync(gate)

	for i, fixture := range record.Fixtures {
		if fixture != original[i] {
			t.Fatal("changing the gate pose rebuilt its local hull")
		}
	}

	gate.Opening = .5
	collisions.sync(gate)

	for i, fixture := range record.Fixtures {
		position := math.Inf(1)

		for _, point := range fixture.Shape.Base().Vertices {
			position = min(position, point.X)
		}

		expected := left[i] + gate.Sides[i]*gate.Spec.HalfTravel*.5

		if math.Abs(position-expected) > 1e-8 {
			t.Fatal("opening the gate retained its closed physical hull")
		}
	}
}
