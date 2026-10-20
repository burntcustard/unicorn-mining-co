package npc

import (
	"fmt"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
Approach with lateral momentum while the station already carries the ship around
its center. Applying that rotation again in guidance used to scrape the hull.
*/
func TestDockingAccountsForInheritedStationRotation(t *testing.T) {
	for _, spin := range []float64{-.0252, 0, .0252} {
		for _, side := range []float64{-1, 1} {
			t.Run(fmt.Sprintf("spin%g/side%g", spin, side), func(t *testing.T) {
				ship := flightShip(t)
				ship.Position = Vec.Create(500, -200*side)
				ship.Velocity = Vec.Create(-75, -67*side)
				ship.Face(-1.63 * side)
				ship.Spin = .4 * side
				station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.), Spin: spin, Rotation: -.5 * side}}, ship.Catalog)
				simulation.AddEntity(ship.World, station)
				ship.LocalMovementParent, ship.LocalMovementRate = station, 1
				ship.World.Collisions = gameplay.NewGameCollisions(ship.Catalog)
				pilot := Pilot{}
				health := ship.HullHealthTotal()
				var events []protocol.SimulationEvent
				thrust, turn := 0., 0.
				dockedAt := math.Inf(1)

				for tick := range 30 * 30 {
					if tick%steeringIntervalTicks(ship) == 0 {
						thrust, turn = pilot.Steer(ship, pilot.DockingMovement(ship, station))
					}

					ship.Control(protocol.Input{Thrust: thrust, Turn: turn, CargoHatch: true}, &events)
					events = events[:0]
					simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

					if ship.DockedTo != nil {
						dockedAt = float64(tick) / 30
						break
					}
				}

				if math.IsInf(dockedAt, 1) || *ship.DockedTo != station.ID || ship.HullHealthTotal() != health {
					t.Fatalf("ship failed safe docking: time=%g health=%g/%g position=%v velocity=%v", dockedAt, ship.HullHealthTotal(), health, ship.Position, ship.Velocity)
				}
			})
		}
	}
}
