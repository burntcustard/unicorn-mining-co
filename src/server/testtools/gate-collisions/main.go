package main

import (
	"encoding/json"
	"os"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	results := []any{}

	var states [][9]float64

	if err := json.NewDecoder(os.Stdin).Decode(&states); err != nil {
		panic(err)
	}

	for _, state := range states {
		world := simulation.CreateWorld(1, catalog)
		gate := objects.NewPassage(world, objects.PassageOptions{ID: 100, DestinationSector: "other", DestinationName: "Other"}).(*objects.JumpGate)
		gate.Opening, gate.OpeningTarget = state[0], state[1]
		gate.Rotation = state[3]
		gate.RequestOpening(state[1])
		id := int64(1)
		ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &id, Position: Vec.Create(-600, 50), Velocity: Vec.Create(200, 0)}})

		if state[4] != 0 {
			gate.Position = Vec.Create(1234, -5678)
			ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(state[5], state[4]), state[3]))
			ship.Velocity = Vec.Vector{}
			ship.Rotation = state[3] + .4
		}

		if state[6] != 0 {
			gate.Position = Vec.Create(1234, -5678)
			side := math.Copysign(1, state[6])
			ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, -side*(329-math.Abs(state[6]))), state[3]))
			ship.Velocity = Vec.Vector{}
			ship.Rotation = state[3] + side*math.Pi/2
		}

		if state[8] != 0 {
			faces := [][4]float64{{378, 0, 1, 0}, {319.5, 144, math.Sqrt(.5), math.Sqrt(.5)}, {225, 202.5, 0, 1}, {319.5, -144, math.Sqrt(.5), -math.Sqrt(.5)}, {225, -202.5, 0, -1}}
			index := int(math.Abs(state[8])) - 1
			x, y, nx, ny := faces[index%5][0], faces[index%5][1], faces[index%5][2], faces[index%5][3]

			if index < 5 {
				x, nx = -x, -nx
			}

			direction := math.Copysign(1, state[8])
			distance := 150.0

			if direction > 0 {
				distance = -91
			}

			gate.Position = Vec.Create(1234, -5678)
			ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(x+nx*distance, y+ny*distance), state[3]))
			ship.Velocity = simulation.RotatePoint(Vec.Create(nx*direction*200, ny*direction*200), state[3])
			ship.Rotation = state[3] + math.Atan2(ny*direction, nx*direction)
		}

		simulation.AddEntity(world, ship)
		simulation.AddEntity(world, gate)
		var body simulation.Entity = ship

		if state[7] != 0 {
			for _, mount := range ship.Mounts() {
				if mount.Module != nil && mount.Module.ModuleBase().Spec.Grinds {
					ship.Detach(mount)
					break
				}
			}

			world.Entities.ForEach(func(e simulation.Entity, _ int64) {
				if e != ship && e != gate {
					body = e
				}
			})

			world.Entities.Delete(ship.ID)
			body.Base().Velocity = Vec.Vector{}
			body.Base().Spin = 0
		}

		craft := body.(interface{ CraftBase() *objects.Craft }).CraftBase()

		object := body.Base()
		collisions := gameplay.NewGameCollisions(catalog)
		frames := []any{}

		ticks := 90

		if state[4] != 0 || state[6] != 0 {
			ticks = 600
		}

		if state[8] != 0 {
			ticks = 45
		}

		for tick := range ticks {
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
			object.Position = Vec.AddScaled(object.Position, object.Velocity, dt)
			object.Rotation += object.Spin * dt
			gate.Update(dt)
			events := []protocol.SimulationEvent{}
			contacts := collisions.Step(world.Entities, dt, &events)
			depth := 0.0

			if state[4] != 0 || state[6] != 0 || state[8] != 0 {
				for _, a := range body.Hitbox() {
					if a.Collides != nil && !*a.Collides || a.Physics != nil && !*a.Physics {
						continue
					}

					for _, b := range gate.Hitbox() {
						c, ok := query.ContactBetween(query.ShapeData{Position: a.GetPosition(), Rotation: a.GetRotation(), Radius: a.GetRadius(), Outline: a.ShapeOutline, CollisionMargin: a.CollisionMargin}, query.ShapeData{Position: b.GetPosition(), Rotation: b.GetRotation(), Radius: b.GetRadius(), Outline: b.ShapeOutline, CollisionMargin: b.CollisionMargin}, catalog.Simulation.LinearSlop)

						if ok {
							depth = math.Max(depth, c.Depth)
						}
					}
				}
			}

			frames = append(frames, map[string]any{"position": object.Position, "velocity": object.Velocity, "rotation": object.Rotation, "spin": object.Spin, "health": craft.HullHealth(), "contacts": len(contacts), "depth": depth})
		}

		results = append(results, frames)
	}

	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		panic(err)
	}
}
