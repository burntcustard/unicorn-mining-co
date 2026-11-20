package objects

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/specs"
)

func TestFixedModuleModelMirrorsAtNegativeMount(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	points := []specs.Point{{0, 0}, {-3, -2}, {-5, -1}, {-4, 3}, {0, 2}}
	module := catalog.ModuleSpecs["thrusterSingleSm"]
	module.Model = []specs.ModelPart{{Points: points, MirrorWithMount: true}}
	catalog.ModuleSpecs["testMirroredThruster"] = module
	catalog.ModuleIDs = append(catalog.ModuleIDs, "testMirroredThruster")
	definition := catalog.ShipSpecs["mustang"]
	health := 100.0
	definition.HullSegments = []specs.HullSegment{{Health: &health, Core: true, Points: []specs.Point{{-30, -30}, {30, -30}, {30, 30}, {-30, 30}}, Mounts: [][]specs.MountPoint{{{Y: -20, Fits: []string{"testMirroredThruster"}}}, {{Y: 20, Fits: []string{"testMirroredThruster"}}}}}}
	definition.InitialLoadout = []specs.InitialModule{{Mount: 0, Module: "testMirroredThruster"}, {Mount: 1, Module: "testMirroredThruster"}}
	catalog.ShipSpecs["testMirroredShip"] = definition
	world := simulation.CreateWorld(1, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "testMirroredShip"})
	mounts := ship.Mounts()
	negativeEngine := mounts[0].Module

	check := func(mountIndex int, side float64) {
		t.Helper()
		segment := ship.SegmentsAtMount(mounts[mountIndex])[0]

		for index, point := range segment.Points.Points {
			if point[0] != points[index][0] || point[1] != points[index][1]*side {
				t.Fatal("fixed model did not follow its mount's handedness")
			}

			base := segment.Module.ModuleBase().Model[0].Points.Points[index]

			if base[0] != points[index][0] || base[1] != points[index][1] {
				t.Fatal("mirroring mutated the shared model")
			}
		}

		nearFlight(t, segment.Middle[0], -2.4)
		nearFlight(t, segment.Middle[1], .4*side)

		for _, collider := range ship.Hitbox() {
			if collider.Segment == segment {
				nearFlight(t, collider.LocalPosition.Y, mounts[mountIndex].LocalPosition.Y+.4*side)
			}
		}
	}

	check(0, -1)
	check(1, 1)
	ship.Fit(negativeEngine, mounts[1])
	check(1, 1)
	ship.Fit(negativeEngine, mounts[0])
	check(0, -1)
}
