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
