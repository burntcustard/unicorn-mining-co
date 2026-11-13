package network

import (
	"bytes"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestModuleCooldownCacheRetainsExactMutableWireState(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser"})
	gun := ship.Modules()[0]
	hull := gun.ModuleBase().Mount.Hull
	spare := modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog)
	ship.CargoContents = []simulation.Entity{spare}
	batch := NewBinarySnapshotBatch(catalog)
	field := catalog.Protocol.BinaryFieldIDs.Modules
	var previous []byte
	var revision int64
	var before *moduleRecord

	for _, step := range []struct {
		name   string
		mutate func()
	}{
		{"initial", func() {}},
		{"fire cooldown", func() { gun.ModuleBase().FireCooldown = .2 }},
		{"decreasing cooldown", func() { gun.ModuleBase().FireCooldown = .1 }},
		{"charge cooldown", func() { gun.ModuleBase().ChargeCooldown = .3 }},
		{"cleared cooldowns", func() { gun.ModuleBase().FireCooldown, gun.ModuleBase().ChargeCooldown = 0, 0 }},
		{"turret aim", func() { gun.ModuleBase().AimRotation = .75 }},
		{"reset turret state", func() { gun.ModuleBase().AimRotation = 0 }},
		{"mount health", func() { gun.ModuleBase().Mount.Health-- }},
		{"module health", func() { spare.Base().Health-- }},
		{"shades", func() { gun.Base().Shades = catalog.Colors["red"] }},
		{"activation", func() { ship.Segments[0].Active = 1; ship.Segments[0].ActivationProgress = .4 }},
		{"activation health", func() { gun.ModuleBase().Mount.HealthActivated = new(17.) }},
		{"empty mount insertion", func() { hull.Mounts = append(hull.Mounts, &simulation.Mount{Hull: hull}) }},
		{"mount reordering", func() { hull.Mounts[0], hull.Mounts[1] = hull.Mounts[1], hull.Mounts[0] }},
		{"module remounting", func() {
			mounts := ship.Mounts()
			ship.Fit(gun, mounts[len(mounts)-1])
		}},
		{"detachment", func() { ship.Fit(nil, gun.ModuleBase().Mount) }},
		{"cargo membership", func() { ship.CargoContents = nil }},
	} {
		t.Run(step.name, func(t *testing.T) {
			step.mutate()
			batch.Begin(NewReplicationView(world))
			record := batch.prepared(ship)
			got, err := protocol.AppendField(nil, field, record.fields[field].wire, catalog.Protocol)

			if err != nil {
				t.Fatal(err)
			}

			// A fresh record reconstructs every module from the simulation state.
			fresh := readModules(ship.Craft, &binaryRecord{})
			want, err := protocol.AppendField(nil, field, fresh.states, catalog.Protocol)

			if err != nil || !bytes.Equal(got, want) {
				t.Fatalf("cached modules differ from a fresh full record: %v", err)
			}

			if bytes.Equal(previous, got) || record.fields[field].revision <= revision {
				t.Fatal("changed modules did not update the replicated field")
			}

			if step.name == "decreasing cooldown" {
				for i, state := range record.modules.states {
					if state.ID != before.states[i].ID || state.Health != before.states[i].Health || &record.modules.modules[i] != &before.modules[i] {
						t.Fatal("cooldown update rebuilt stable module metadata")
					}
				}
			}

			previous, revision, before = got, record.fields[field].revision, record.modules
		})
	}
}

func TestModuleCooldownUpdatesAvoidMetadataAllocations(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser"})
	record := &binaryRecord{}
	readModules(ship.Craft, record)
	gun := ship.Modules()[0].ModuleBase()
	gun.FireCooldown = .2

	allocations := testing.AllocsPerRun(100, func() {
		gun.FireCooldown += .01
		readModules(ship.Craft, record)
	})

	if allocations > 3 {
		t.Fatalf("single cooldown update allocated %g objects", allocations)
	}
}

func TestModuleRevisionsTrackChangedEntriesAndAppearance(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser"})
	batch := NewBinarySnapshotBatch(catalog)
	batch.Begin(NewReplicationView(world))
	record := batch.prepared(ship)

	if len(record.modules.modules) < 2 {
		t.Fatal("fixture needs at least two modules")
	}

	first, second := record.modules.modules[0], record.modules.modules[1]
	initial, layoutRevision := record.revision, record.moduleLayoutRevision

	first.ModuleBase().FireCooldown = .25
	batch.Begin(NewReplicationView(world))
	record = batch.prepared(ship)

	if record.moduleLayoutRevision != layoutRevision || record.moduleRevisions[0] <= initial || record.moduleRevisions[1] > initial {
		t.Fatal("cooldown update should only change the first module revision")
	}

	middle := record.revision

	second.ModuleBase().AimRotation = .75
	batch.Begin(NewReplicationView(world))
	record = batch.prepared(ship)

	if record.moduleRevisions[0] > middle || record.moduleRevisions[1] <= middle {
		t.Fatal("observer baseline should distinguish changes across snapshots")
	}

	if record.moduleRevisions[0] <= initial || record.moduleRevisions[1] <= initial {
		t.Fatal("stale observer must receive both changed modules")
	}

	beforeHealth := record.revision
	first.ModuleBase().Mount.Health--
	batch.Begin(NewReplicationView(world))
	record = batch.prepared(ship)

	if record.moduleLayoutRevision != layoutRevision || record.moduleRevisions[0] <= beforeHealth || record.moduleRevisions[1] > beforeHealth || record.moduleShadeRevisions[0] > beforeHealth {
		t.Fatal("health changes must not resend unchanged colors or other modules")
	}

	beforePaint := record.revision
	first.Base().Shades = catalog.Colors["red"]
	batch.Begin(NewReplicationView(world))
	record = batch.prepared(ship)

	if record.moduleLayoutRevision != layoutRevision || record.moduleShadeRevisions[0] <= beforePaint || record.moduleShadeRevisions[1] > beforePaint {
		t.Fatal("repainting must update only that module's shades")
	}

	if record.moduleRevisions[0] <= beforePaint || record.moduleRevisions[1] > beforePaint {
		t.Fatal("repainting must only update the changed module")
	}
}
