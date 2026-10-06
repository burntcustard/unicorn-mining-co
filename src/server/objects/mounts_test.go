package objects

import (
	"reflect"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestReconciledMountOrder(t *testing.T) {
	catalog, _ := specs.Load()

	for id := range catalog.ShipSpecs {
		t.Run(id, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			authority := NewShip(id, Properties{World: world}, catalog)
			predicted := NewShip(id, Properties{World: world}, catalog)
			full := authority.HullHealth()
			indexes := []int{}

			for i, plan := range authority.HullSegments {
				if len(plan.Mounts) > 0 {
					indexes = append(indexes, i)
				}
			}

			if len(indexes) < 2 {
				return
			}

			damaged, other := slices.Clone(full), slices.Clone(full)
			damaged[indexes[0]], other[indexes[1]] = 0, 0
			authority.SetHullHealth(damaged)
			predicted.SetHullHealth(other)
			predicted.SetHullHealth(damaged)

			for i, mount := range authority.Mounts() {
				if !reflect.DeepEqual(mount.Fits, predicted.Mounts()[i].Fits) {
					t.Fatal("different damage histories changed serialized mount indexes")
				}
			}

			authority.SetHullHealth(full)
			fresh := NewShip(id, Properties{World: world}, catalog)

			for i, mount := range fresh.Mounts() {
				if !reflect.DeepEqual(mount.Fits, authority.Mounts()[i].Fits) {
					t.Fatal("repair did not restore canonical mount indexes")
				}
			}
		})
	}
}

func TestModuleMountCoordinates(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	health := 100.0

	hulls := []specs.HullSegment{{
		Health: &health,
		Points: []specs.Point{{-30, -30}, {30, -30}, {30, 30}, {-30, 30}},
		Mounts: [][]specs.MountPoint{{
			{X: 3, Y: -29, Fits: []string{"cargoHatch"}},
			{X: 9, Y: -6, Fits: []string{"autocannon"}},
			{X: 21, Y: -8, Fits: []string{"plasmaAccelerator"}},
		}},
	}}

	shipSpec := catalog.ShipSpecs["mustang"]
	shipSpec.HullSegments = hulls
	catalog.ShipSpecs["test"] = shipSpec
	stationSpec := catalog.StationSpecs["corral"]
	stationSpec.HullSegments = hulls
	catalog.StationSpecs["test"] = stationSpec
	world := simulation.CreateWorld(25, catalog)
	playerID := int64(1)
	props := Properties{ObjectProperties: simulation.ObjectProperties{World: world, PlayerID: &playerID}}
	ship := NewShip("test", props, catalog)
	station := NewStation("test", props, catalog)

	for _, craft := range []*Craft{ship.Craft, station.Craft} {
		mounts := craft.Mounts()

		if len(mounts) != 1 {
			t.Fatal("coordinate groups must share one mount slot")
		}

		mount := mounts[0]
		hatch := modules.Create("cargoHatch", simulation.ObjectProperties{World: world}, catalog)
		craft.Fit(hatch, nil)

		if mount.Module != hatch || mount.LocalPosition != Vec.Create(3, -29) {
			t.Fatal("automatic fitting must choose the compatible coordinate group")
		}

		for _, segment := range craft.SegmentsAtMount(mount) {
			if segment.LocalPosition != Vec.Create(3, -13) {
				t.Fatal("cargo offset must use the hatch group's position")
			}
		}

		cannon := modules.Create("autocannon", simulation.ObjectProperties{World: world}, catalog)
		craft.Fit(cannon, mount)

		if mount.LocalPosition != Vec.Create(9, -6) {
			t.Fatal("autocannon must use its own mount coordinates")
		}

		for _, segment := range craft.SegmentsAtMount(mount) {
			if segment.LocalPosition != Vec.Create(9, -6) {
				t.Fatal("all weapon segments must use the selected coordinates")
			}
		}

		states := craft.ModuleStates()
		craft.Fit(nil, mount)
		craft.SetModuleStates(states)

		if mount.LocalPosition != Vec.Create(9, -6) {
			t.Fatal("restoring module states must select the matching coordinates")
		}

		plasma := modules.Create("plasmaAccelerator", simulation.ObjectProperties{World: world}, catalog)
		craft.Fit(plasma, mount)

		if mount.LocalPosition != Vec.Create(21, -8) {
			t.Fatal("plasma accelerator must use its own coordinates")
		}
	}

	ship.SetModuleActive("plasmaAccelerator", true)
	ship.fireWeapons(0)

	for _, entity := range world.Entities.Values() {
		if projectile, ok := entity.(*Projectile); ok {
			spec := catalog.ModuleSpecs["plasmaAccelerator"]
			expected := Vec.Create(21+spec.BarrelLength+spec.Projectile.Radius+1, -8)

			if projectile.Position != expected {
				t.Fatal("projectiles must spawn from the weapon group's position")
			}

			return
		}
	}

	t.Fatal("expected a fired projectile")
}

func TestThrusterMountSpacing(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)

	for _, id := range []string{"thrusterDualMd", "thrusterDualLg"} {
		t.Run(id, func(t *testing.T) {
			wide := CreatePlayerShip(world, Properties{DefinitionID: "crotus"})
			standard := CreateShip(world, Properties{})
			thruster := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)
			offset := catalog.ModuleSpecs[id].Offset

			for _, target := range []struct {
				ship  *Ship
				extra float64
			}{{wide, 8}, {standard, 0}, {wide, 8}} {
				mountIndex := 1

				if target.ship == wide {
					mountIndex = 2
				}

				mount := target.ship.Mounts()[mountIndex]
				target.ship.Fit(thruster, mount)
				segments := target.ship.SegmentsAtMount(mount)

				if len(segments) != 2 || segments[0].LocalPosition.Y != -offset-target.extra || segments[1].LocalPosition.Y != offset+target.extra {
					t.Fatal("thruster spacing must follow the current ship mount")
				}
			}

			if thruster.ModuleBase().Spec.Offset != offset {
				t.Fatal("fitting must not change the module offset")
			}
		})
	}
}
