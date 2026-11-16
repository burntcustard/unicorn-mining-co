package main

import (
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"os"
	"slices"
)

func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	cases := []any{}

	for _, rotation := range []float64{0, math.Pi / 2} {
		world := simulation.CreateWorld(1, catalog)
		ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "crescent"})
		ship.Position, ship.Rotation = Vec.Create(18, -29), rotation
		colliders := []any{}

		for _, collider := range ship.Hitbox() {
			segment := collider.Segment.(*simulation.Segment)

			colliders = append(colliders, map[string]any{
				"position": collider.Position, "localPosition": collider.LocalPosition,
				"points": collider.ShapeOutline, "radius": collider.Radius,
				"hullIndex": slices.Index(ship.HullSegments, segment.HullPlan),
			})
		}

		cases = append(cases, map[string]any{"shipType": "crescent", "rotation": rotation, "colliders": colliders})
	}

	if err := json.NewEncoder(os.Stdout).Encode(cases); err != nil {
		panic(err)
	}
}
