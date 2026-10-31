package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
Cross the rotating bay mouth near its center, including mirrored approaches.
Measure the real path before the docking trigger can hide an edge-cutting entry.
*/
func TestDockingCentersBayEntry(t *testing.T) {
	for _, hull := range []string{"courser", "finch"} {
		for _, spin := range []float64{-.03, 0, .03} {
			for _, side := range []float64{-1, 1} {
				t.Run(fmt.Sprintf("%s/spin%g/side%g", hull, spin, side), func(t *testing.T) {
					ship := arrivalShip(t, hull)
					ship.Position, ship.Velocity = Vec.Create(900, 180*side), Vec.Create(-140, 0)
					ship.Face(math.Pi)
					station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.), Spin: spin}}, ship.Catalog)
					simulation.AddEntity(ship.World, station)
					contacts := &stationWallContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), ship: ship.ID, station: station.ID}
					ship.World.Collisions = contacts
					pilot := Pilot{}
					input := protocol.Input{}
					entry := math.Inf(1)
					var events []protocol.SimulationEvent

					for tick := range 30 * 25 {
						if tick%steeringIntervalTicks(ship) == 0 {
							input.Thrust, input.Turn = pilot.Steer(ship, pilot.DockingMovement(ship, station))
						}

						ship.Control(input, &events)
						events = events[:0]
						simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
						relative := simulation.RotatePoint(Vec.Subtract(ship.Position, station.Position), -station.Rotation)

						if math.IsInf(entry, 1) && relative.X <= 300 && relative.X > 0 && math.Abs(relative.Y) < 120 {
							entry = math.Abs(relative.Y)
						}

						if ship.DockedTo != nil {
							t.Logf("entry offset=%.2f, docked in %.2fs", entry, float64(tick+1)/30)
							break
						}
					}

					if ship.DockedTo == nil || contacts.touches != 0 || entry > 30 {
						t.Fatalf("docking entry was incomplete, unsafe or off-center: docked=%v wallContacts=%d offset=%g", ship.DockedTo, contacts.touches, entry)
					}
				})
			}
		}
	}
}
