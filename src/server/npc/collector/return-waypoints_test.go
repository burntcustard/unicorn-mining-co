package collector

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestReturnWaypointsPredictBayRotation(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: s.World, ID: new(int64(987654321)), Position: Vec.Create(100, 200), Radius: new(400.), Rotation: .4, Spin: .03}}, s.World.Specification)
	simulation.AddEntity(s.World, station)
	elapsed := 7.
	waypoints := returnWaypoints(npc.ship, station.Position, elapsed, nil)
	expected := Vec.AddScaled(station.Position, simulation.DirectionOf(station.Rotation+station.DockingBays[0]+station.Spin*elapsed), station.Radius+150)

	if len(waypoints) != len(station.DockingBays) || Vec.Distance(waypoints[0], expected) > 1e-7 {
		t.Fatal("return departure ignored the bay's future position")
	}
}

func TestPickupDepartureWaypointsClearTheStationCircle(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: s.World, ID: new(int64(987654321)), Position: Vec.Create(100, 200), Radius: new(400.), Rotation: .4, Spin: .03}}, s.World.Specification)
	simulation.AddEntity(s.World, station)

	for _, distance := range []float64{350, 450, 800} {
		for index := range 32 {
			from := Vec.AddScaled(station.Position, simulation.DirectionOf(float64(index)*math.Pi/16), distance)

			for _, to := range returnWaypoints(npc.ship, station.Position, 7, &from) {
				line := Vec.Subtract(to, from)
				along := max(0, min(1, Vec.Dot(Vec.Subtract(station.Position, from), line)/Vec.LengthSquared(line)))
				clearance := Vec.Distance(Vec.AddScaled(from, line, along), station.Position)

				if clearance+1e-7 < min(distance, station.Radius+npc.ship.Radius) {
					t.Fatalf("departure from %v through %v crosses the station circle: clearance %g", from, to, clearance)
				}
			}
		}
	}
}
