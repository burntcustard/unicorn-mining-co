package gameplay

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/physics"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"
)

func TestInactivePhysicsRetainsBody(t *testing.T) {
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	g := NewGameCollisions(catalog)
	id := int64(1)
	station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &id, Position: Vec.Vector{X: 100}}}, catalog)
	simulation.AddEntity(world, station)
	g.CapturePoses(world.Entities)
	record, _ := g.bodies.Get(id)
	g.sync(station)
	var events []protocol.SimulationEvent
	other := g.world.CreateBody()
	fixture := other.CreateFixture(shape.NewCircle(Vec.Vector{}, 1), physics.FixtureOpt{})
	g.world.CreateContact(record.Fixtures[0], fixture)

	if record.Body.ContactList == nil {
		t.Fatal("missing initial contact")
	}

	station.InactivePhysics = true
	g.Step(world.Entities, 0, &events)

	if record.Body.ContactList != nil {
		t.Fatal("parked body retained contacts")
	}

	if !record.Body.Parked {
		t.Fatal("inactive body must be parked")
	}

	if !world.Entities.Has(id) {
		t.Fatal("marker entity disappeared")
	}

	retained, _ := g.bodies.Get(id)

	if retained != record {
		t.Fatal("body was discarded")
	}

	station.Position.X = 101
	station.InactivePhysics = false
	g.CapturePoses(world.Entities)

	if record.Previous.Position.X != 101 {
		t.Fatal("reactivation uses a stale sweep")
	}

	g.Step(world.Entities, 0, &events)
	retained, _ = g.bodies.Get(id)

	if retained != record {
		t.Fatal("reactivation replaced the body")
	}

	world.Entities.Delete(id)
	g.Step(world.Entities, 0, &events)

	if g.bodies.Has(id) || !record.Body.Destroyed {
		t.Fatal("removed entity retained a body")
	}
}
