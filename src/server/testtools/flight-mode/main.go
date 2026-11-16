package main

import (
	"encoding/json"
	"math"
	"os"
	"slices"

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

	world := simulation.CreateWorld(1, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "crescent"})
	ship.Position, ship.Rotation = Vec.Create(18, -29), .37
	dt := 1.0 / 60

	stages := []struct {
		Frames int
		Active bool
		Thrust float64
		Turn   float64
	}{{18, true, 1, .5}, {18, true, 1, .5}, {9, false, 0, -.5}, {27, false, .6, 0}, {36, true, 1, -.25}}

	steps := []any{}

	for _, stage := range stages {
		for range stage.Frames {
			var events []protocol.SimulationEvent
			ship.Control(protocol.Input{FlightMode: stage.Active, Thrust: stage.Thrust, Turn: stage.Turn}, &events)
			ship.Update(dt)
			world.Tick++
		}

		progress := 0.0
		hulls, moduleParts, mounts, colliders := []any{}, []any{}, []any{}, []any{}
		allMounts := ship.Mounts()

		for _, segment := range ship.Segments {
			if segment.Hull {
				hulls = append(hulls, map[string]any{"index": slices.Index(ship.HullSegments, segment.HullPlan), "position": segment.LocalPosition})
			} else if segment.Mount != nil {
				moduleParts = append(moduleParts, map[string]any{"mount": slices.Index(allMounts, segment.Mount), "position": segment.LocalPosition})

				if segment.Module.ModuleBase().Spec.Behavior == "flightMode" {
					progress = math.Max(progress, segment.ActivationProgress)
				}
			}
		}

		for index, mount := range allMounts {
			mounts = append(mounts, map[string]any{"index": index, "position": mount.LocalPosition})
		}

		for _, collider := range ship.HitboxColliding() {
			segment := collider.Segment.(*simulation.Segment)
			colliders = append(colliders, map[string]any{"hullIndex": slices.Index(ship.HullSegments, segment.HullPlan), "position": collider.Position, "localPosition": *collider.LocalPosition, "radius": collider.Radius, "points": collider.ShapeOutline})
		}

		steps = append(steps, map[string]any{
			"frames": stage.Frames, "active": stage.Active, "thrust": stage.Thrust, "turn": stage.Turn,
			"position": ship.Position, "velocity": ship.Velocity, "rotation": ship.Rotation, "spin": ship.Spin, "fuel": ship.Fuel,
			"progress": progress, "forwardThrust": ship.ForwardThrust(), "rotationalThrust": ship.RotationalThrust(), "maxSpeed": ship.MaxSpeed(),
			"hulls": hulls, "mounts": mounts, "moduleParts": moduleParts, "colliders": colliders,
		})
	}

	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"dt": dt, "steps": steps}); err != nil {
		panic(err)
	}
}
