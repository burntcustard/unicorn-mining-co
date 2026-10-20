package network

import (
	"bytes"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

/*
Build the canonical cargo field directly, without consulting its serialization
cache, to check that mutable contents retain the original wire representation.
*/
func uncachedCargo(t *testing.T, ship *objects.Ship, batch *BinarySnapshotBatch) []byte {
	t.Helper()
	states := readModules(ship.Craft, batch.prepared(ship))
	entries := make([]protocol.CargoEntry, len(ship.CargoContents))

	for i, object := range ship.CargoContents {
		if module, ok := object.(simulation.Module); ok {
			index := float64(states.indexes[module])
			entries[i].ModuleIndex = &index
		} else {
			entity := fullRecord(batch.prepared(object), -1, nil)
			entries[i].Entity = &entity
		}
	}

	value, err := protocol.AppendField(nil, batch.catalog.Protocol.BinaryFieldIDs.CargoContents, entries, batch.catalog.Protocol)

	if err != nil {
		t.Fatal(err)
	}

	return value
}

func TestCargoSerializationCacheRetainsMutableStateAndModuleIndexes(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)

	item := func(name string) *objects.Item {
		id := simulation.EntityID(world)
		return objects.NewItem(name, simulation.ObjectProperties{World: world, ID: &id}, catalog)
	}

	ship := objects.CreatePlayerShip(world, objects.Properties{})
	gold := item("gold")
	ammo := item("autogunAmmo")
	child := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser"})
	childGold := item("gold")
	child.CargoContents = []simulation.Entity{childGold}
	spare := modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog)
	ship.CargoContents = []simulation.Entity{gold, ammo, child, spare}
	batch := NewBinarySnapshotBatch(catalog)
	field := catalog.Protocol.BinaryFieldIDs.CargoContents
	var previous []byte
	var saved []simulation.Entity

	for _, step := range []struct {
		name   string
		mutate func()
	}{
		{"initial", func() {}},
		{"ammunition", func() { *ammo.Rounds = 117 }},
		{"item health", func() { gold.Health-- }},
		{"nested item", func() { childGold.Health-- }},
		{"nested cargo membership", func() {
			child.CargoContents = append(child.CargoContents, item("diamond"))
		}},
		{"reordering", func() { ship.CargoContents[0], ship.CargoContents[1] = ship.CargoContents[1], ship.CargoContents[0] }},
		{"same length replacement", func() {
			ship.CargoContents[0] = item("opal")
		}},
		{"module indexes", func() {
			before := batch.prepared(ship).modules.indexes[spare]
			ship.Fit(nil, ship.Modules()[0].ModuleBase().Mount)
			batch.Begin(NewReplicationView(world))

			if batch.prepared(ship).modules.indexes[spare] == before {
				t.Fatal("fixture did not change the carried module's index")
			}
		}},
		{"empty inventory", func() { saved, ship.CargoContents = slices.Clone(ship.CargoContents), nil }},
		{"restore inventory", func() { ship.CargoContents = saved }},
	} {
		t.Run(step.name, func(t *testing.T) {
			step.mutate()
			batch.Begin(NewReplicationView(world))
			record := batch.prepared(ship)
			var value []byte

			if wire := record.fields[field].wire; wire != nil {
				value = wire.([]byte)
			}

			if len(ship.CargoContents) == 0 {
				if value != nil {
					t.Fatal("empty cargo was not cleared")
				}
			} else if !bytes.Equal(value, uncachedCargo(t, ship, batch)) {
				t.Fatal("cached cargo differs from its canonical wire representation")
			}

			if bytes.Equal(value, previous) {
				t.Fatal("changed cargo did not update the replicated field")
			}

			previous = bytes.Clone(value)

			if len(value) != 0 {
				// Only scratch storage is changed; the replicated field owns a copy.
				record.nested[0] ^= 0xff
				sentinel := record.nested[0]
				batch.Begin(NewReplicationView(world))
				batch.prepared(ship)

				if record.nested[0] != sentinel {
					t.Fatal("unchanged cargo was serialized again")
				}
			}
		})
	}
}
