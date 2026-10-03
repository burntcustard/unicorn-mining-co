package gameplay

import (
	"fmt"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestStationExitSlowdown(t *testing.T) {
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, rotation := range []float64{0, 0.5, 1, 1.3} {
		t.Run(fmt.Sprint(rotation), func(t *testing.T) {
			world := simulation.CreateWorld(1, catalog)
			world.Collisions = NewGameCollisions(catalog)
			stationID, playerID := int64(100), int64(7)
			station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &stationID, Spin: 0.1}}, catalog)
			simulation.AddEntity(world, station)
			ship := objects.CreateShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID, Position: Vec.Create(station.LocalMovementRadius-1, 0), Rotation: rotation}})
			simulation.AddEntity(world, ship)
			simulation.AddPlayer(world, simulation.Player{ID: playerID, ShipID: ship.ID})
			ship.LocalMovementParent = station
			ship.LocalMovementRate = 1
			ship.Velocity = Vec.Create(ship.MaxSpeed()*math.Cos(rotation), ship.MaxSpeed()*math.Sin(rotation))
			inputs := map[int64]protocol.InputFrame{playerID: {Input: protocol.Input{Thrust: 1}}}
			simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: inputs})

			if ship.LocalMovementParent != nil || ship.LocalMovementRate != 0 {
				t.Fatal("the ship did not leave the station area")
			}

			exitSpeed := Vec.Length(ship.Velocity)
			inputs[playerID] = protocol.InputFrame{}

			for range 90 {
				simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: inputs})
			}

			if ship.Forward != 0 {
				t.Fatal("thrust was not released")
			}

			if speed := Vec.Length(ship.Velocity); speed >= exitSpeed/2 {
				t.Fatalf("the ship did not slow after releasing thrust: exit speed %g, final speed %g", exitSpeed, speed)
			}
		})
	}
}
