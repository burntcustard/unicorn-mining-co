package objects_test

import (
	"math"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestCargoHatchOffset(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	for _, segment := range ship.Segments {
		if segment.Module == nil || !segment.Module.ModuleBase().Spec.CollectsCargo {
			continue
		}

		side := math.Copysign(1, segment.Mount.LocalPosition.Y)

		if segment.Mount.LocalPosition.Y != side*29 || segment.LocalPosition.Y != side*13 {
			t.Fatal("door and pickup geometry must stay 16 units inward from the mount")
		}

		if segment.Catches {
			continue
		}

		for _, progress := range []float64{0, .5, 1} {
			segment.ActivationProgress = progress
			expected := modules.CargoHatchDoorShapeOutline(catalog.ModuleSpecs["cargoHatch"], progress, side)

			if !reflect.DeepEqual(segment.Outline().Points, expected.Points) {
				t.Fatal("offset must preserve the hatch door geometry")
			}
		}
	}
}
