package collector

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
A final pickup behind the station must leave room to turn toward its bay.
This approach previously collected the opal with unavoidable inward momentum.
*/
func TestLastPickupLeavesAStationClearReturn(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	catalog.CollectorSpec.Ship = "finch"
	s := newFixture(catalog)
	home := s.Host.NearestStation(Vec.Vector{})
	anchor := objects.CreateShip(s.World, objects.Properties{ObjectProperties: simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: home.Position, Radius: new(0.)}})
	anchor.Segments, anchor.Cockpit = nil, nil
	simulation.AddEntity(s.World, anchor)
	s.Host.Humans = append(s.Host.Humans, &testhost.Human{Craft: anchor})
	s.Host.SyncRegions()
	collectorClock(s, home).CheckAt = math.MaxUint64
	station := s.Environment.Entity(s.Environment.StationID(home)).(*objects.Station)
	station.Rotation, station.Spin = -.6290322542190552, -.025196373462677002
	item := objects.NewItem("opal", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: Vec.Add(home.Position, Vec.Create(-350.7980897426605, 358.096123218536)), Rotation: -.6168983578681946}, catalog)
	item.LocalMovementParent, item.LocalMovementRate = station, 1
	simulation.AddEntity(s.World, item)
	npc := s.spawn(home, []pickupItem{{ID: item.ID, Position: item.Position, Name: item.Name}})
	ship := npc.ship
	ship.Launching = 0
	ship.LocalMovementParent, ship.LocalMovementRate = nil, 0
	ship.Position = Vec.Add(home.Position, Vec.Create(-482.548824429512, 568.088806509972))
	ship.Velocity = Vec.Create(125.24715054035187, -161.02531254291534)
	ship.Rotation, ship.Spin = -1.0309815406799316, 0
	ship.SetModuleActive("cargoHatch", true)
	ship.UpdateModules(1)
	s.World.Tick = 750
	step := catalog.Simulation.SimulationStep
	npc.TargetID, npc.AttemptStartedAt, npc.ThinkAfter = item.ID, 750*step, 754*step
	npc.input = protocol.Input{Thrust: 1, CargoHatch: true}
	var events []protocol.SimulationEvent
	s.World.Collisions.CapturePoses(s.World.Entities)
	s.World.Collisions.Step(s.World.Entities, 0, &events)
	health := ship.HullHealthTotal()

	s.Host.After = func(events []protocol.SimulationEvent) {
		s.ItemsCollected(events)

		for _, event := range events {
			if contact, ok := event.(protocol.CollisionEvent); ok && (contact.A == ship.ID && contact.B == station.ID || contact.B == ship.ID && contact.A == station.ID) {
				t.Fatalf("last pickup carried its ship into a station wall: state=%s impact=%g", npc.State, contact.Impact)
			}
		}
	}

	for range int(20 / step) {
		s.Tick(1)

		if ship.HullHealthTotal() != health {
			t.Fatal("last pickup or return damaged its ship")
		}

		if ship.DockedTo != nil {
			break
		}
	}

	if ship.DockedTo == nil || *ship.DockedTo != station.ID {
		t.Fatal("last pickup did not finish its return")
	}
}
