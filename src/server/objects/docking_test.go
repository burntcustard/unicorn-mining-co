package objects_test

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func TestDockingBayOnGenericCraft(t *testing.T) {
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	world.Collisions = gameplay.NewGameCollisions(catalog)
	// Reuse the station's hull definition, but expose only a generic Craft.
	craft := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog).Craft
	craft.Self, craft.Kind = craft, "craft"
	simulation.AddEntity(world, craft)
	playerID := int64(7)
	ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID, Position: Vec.Create(150, 0)}})
	simulation.AddEntity(world, ship)
	events := simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Ticks: 1})

	if ship.DockedTo == nil || *ship.DockedTo != craft.ID {
		t.Fatal("ship did not dock to the generic craft")
	}

	for _, event := range events {
		if docked, ok := event.(protocol.Docked); ok && docked.PlayerID == playerID && docked.DockedTo == craft.ID {
			return
		}
	}

	t.Fatal("docking did not report the target craft ID")
}
