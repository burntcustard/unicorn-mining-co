package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"
)

func TestStationPhysicsRange(t *testing.T) {
	t.Parallel()

	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	session := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	session.Receive(protocol.Control{Type: "hello"}, socket)
	player := session.playersBySocket[socket]
	id := int64(999999)
	station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &id}}, catalog)
	simulation.AddEntity(session.World, station)

	for _, distance := range []float64{2000, 2000.01, 1999} {
		player.ship.Position = Vec.Vector{X: distance}
		session.regionsSyncedAt = float64(session.World.Tick)
		session.Tick(1)

		if station.InactivePhysics != (distance > 2000) {
			t.Fatalf("distance %g inactive=%v", distance, station.InactivePhysics)
		}

		if !session.World.Entities.Has(id) {
			t.Fatal("station marker was removed")
		}
	}
}

func TestStationPhysicsUsesNPCObserverRange(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, definition := range []string{"courser", "finch"} {
		t.Run(definition, func(t *testing.T) {
			session := NewGameSession(25, catalog)
			world := session.World
			station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: new(simulation.EntityID(world))}}, catalog)
			simulation.AddEntity(world, station)
			id, observerID := simulation.EntityID(world), session.nextPlayerID
			ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: definition, ObjectProperties: simulation.ObjectProperties{ID: &id, PlayerID: &observerID}})
			simulation.AddEntity(world, ship)

			// Physics follows the observer's range without a role-specific controller.
			for _, radius := range []float64{1500, 750} {
				simulation.AddPlayer(world, simulation.Player{ID: observerID, ShipID: id, ObserverRange: radius})

				for _, distance := range []float64{radius, radius + 1, radius - 1} {
					ship.Position = Vec.Create(distance, 0)
					session.regionsSyncedAt = float64(world.Tick)
					session.Tick(1)

					if station.InactivePhysics != (distance > radius) {
						t.Fatalf("range %g, distance %g: inactive=%v", radius, distance, station.InactivePhysics)
					}
				}
			}

			world.Entities.Delete(id)
			session.regionsSyncedAt = float64(world.Tick)
			session.Tick(1)

			if !station.InactivePhysics {
				t.Fatal("an observer without a ship kept station physics active")
			}
		})
	}
}
