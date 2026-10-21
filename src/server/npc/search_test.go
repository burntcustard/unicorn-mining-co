package npc

import (
	"fmt"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestSearchExpandsThroughRealShipPhysics(t *testing.T) {
	for _, velocity := range []Vec.Vector{Vec.Create(0, 0), Vec.Create(100, 0), Vec.Create(200, 0), Vec.Create(0, 100)} {
		t.Run(fmt.Sprint(velocity), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			ship.Velocity = velocity
			ship.SetModuleActive("cargoHatch", true)
			ship.SetModuleActive("cannonSm", true)
			search := Search{Origin: ship.Position, Heading: ship.Rotation}
			pilot := Pilot{}
			thrust, turn := 0.0, 0.0
			traveled, previousAngle, earlyRadius := 0.0, 0.0, 0.0

			for tick := range 30 * 100 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, search.Movement(ship))
				}

				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				offset := Vec.Subtract(ship.Position, search.Origin)
				angle := math.Atan2(offset.Y, offset.X)

				if tick > 30*5 {
					traveled += math.Remainder(angle-previousAngle, 2*math.Pi)
				}

				previousAngle = angle

				if tick == 30*25 {
					earlyRadius = Vec.Length(offset)
				}
			}

			radius := Vec.Distance(ship.Position, search.Origin)

			if traveled < 2*math.Pi || radius < 700 || radius < earlyRadius+250 {
				t.Fatalf("search stayed in small circles: turns=%g final radius=%g early radius=%g spiral angle=%g", traveled/(2*math.Pi), radius, earlyRadius, search.angle)
			}
		})
	}
}

func TestSearchExpandsPastAnObstructedSpiralWaypoint(t *testing.T) {
	ship := arrivalShip(t, "courser")
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(150, 0), Radius: new(90.0)}, PointCount: 8})
	simulation.AddEntity(ship.World, rock.LockGeometry())
	search := Search{Origin: ship.Position, Heading: ship.Rotation}
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0

	for tick := range 30 * 100 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, search.Movement(ship))
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
	}

	if radius := Vec.Distance(ship.Position, search.Origin); radius < 700 {
		t.Fatalf("obstructed search circled one waypoint: radius=%g spiral angle=%g", radius, search.angle)
	}

	if ship.Dead || ship.Stranded() {
		t.Fatal("search forced the ship through an obstacle")
	}
}
