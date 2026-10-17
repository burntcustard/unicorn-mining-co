package main

import (
	"encoding/json"
	"os"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	results := []any{}

	for _, state := range [][4]float64{{0, 0, 0, 0}, {1, 1, 0, 0}, {0.5, 1, 0, 0}, {0.5, 0, 0, 0}, {0, 0, -1, 0}, {0, 0, 1, 0}, {0, 0, 0, .71}, {1, 1, 0, .71}, {.5, 1, 0, .71}, {.5, 0, 0, .71}} {
		world := simulation.CreateWorld(1, catalog)
		gate := objects.NewPassage(world, objects.PassageOptions{ID: 100, DestinationSector: "other", DestinationName: "Other"}).(*objects.JumpGate)
		gate.Opening, gate.OpeningTarget = state[0], state[1]
		gate.Rotation = state[3]
		id := int64(1)
		ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &id, Position: Vec.Create(-600, 50), Velocity: Vec.Create(200, 0)}})
		simulation.AddEntity(world, ship)
		simulation.AddEntity(world, gate)
		collisions := gameplay.NewGameCollisions(catalog)
		frames := []any{}

		for tick := range 90 {
			if state[2] != 0 && tick == 1 {
				ship.TransitTime = state[2]
				ship.Position = Vec.Create(-260, 50)
				ship.Velocity = Vec.Vector{}
			}

			if state[2] != 0 && tick == 4 {
				ship.TransitTime = 0
			}

			collisions.CapturePoses(world.Entities)
			dt := catalog.Simulation.SimulationStep
			ship.Position = Vec.AddScaled(ship.Position, ship.Velocity, dt)
			ship.Rotation += ship.Spin * dt
			gate.Update(dt)
			events := []protocol.SimulationEvent{}
			contacts := collisions.Step(world.Entities, dt, &events)
			frames = append(frames, map[string]any{"position": ship.Position, "velocity": ship.Velocity, "rotation": ship.Rotation, "spin": ship.Spin, "health": ship.HullHealth(), "contacts": len(contacts)})
		}

		results = append(results, frames)
	}

	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		panic(err)
	}
}
