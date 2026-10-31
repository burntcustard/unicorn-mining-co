package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"math"
	"slices"
	"testing"
)

func TestContactForecastRespectsOwnCargoPickupDelay(t *testing.T) {
	ship := arrivalShip(t, "finch")
	_, throat := collectionThroat(t, ship)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: throat.Position}, ship.Catalog)
	item.DroppedBy, item.PickupAfter = ship.PlayerID, ship.World.Tick+3
	simulation.AddEntity(ship.World, item)
	primeContactForecast(ship)
	forecast := newContactForecast(ship, item, collectionCenters(ship, nil))
	prediction, ready := forecast.predict(0, 0, 6)

	if !ready || !prediction.safe || !prediction.arrived {
		t.Fatal("delayed pickup fixture must eventually enter its active hatch")
	}

	dt := ship.Catalog.Simulation.SimulationStep

	if math.Abs(prediction.seconds-4*dt) > .001 {
		t.Fatalf("forecast bypassed pickup cooldown: %.3fs", prediction.seconds)
	}

	for tick := range 4 {
		ship.Fly(0, 0)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
		collected := slices.Contains(ship.CargoContents, simulation.Entity(item))

		if collected != (tick == 3) {
			t.Fatalf("actual pickup cooldown differs at tick%d: collected=%v", tick, collected)
		}
	}
}
