package regions

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"
)

func TestNavBeaconStreaming(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	sector := simulation.GenerateSector(123, "Patroclus", catalog)
	gate := simulation.SectorConnectionSite{ID: "test-gate", Position: Vec.Create(10000, 10000)}
	manager := New(123, catalog, sector)
	manager.GateSites = []simulation.SectorConnectionSite{gate}
	world := simulation.CreateWorld(float64(sector.Seed), catalog)
	world.ItemTypes = objects.ItemTypes(catalog)
	descriptions := manager.Procedural.NavBeacons(Vec.Create(9000, 9000), Vec.Create(11000, 11000), manager.GateSites)

	if len(descriptions) != 1 {
		t.Fatalf("got %d gate beacons", len(descriptions))
	}

	d := descriptions[0]
	id := int64(d.ID)
	manager.Sync(world, []Vec.Vector{gate.Position})
	entity, ok := world.Entities.Get(id)

	if !ok || entity.Base().Kind != "navBeacon" {
		t.Fatal("beacon did not stream in")
	}

	beacon, ok := entity.(*objects.NavBeacon)

	if !ok {
		t.Fatal("beacon must use its own craft type")
	}

	if beacon.Rotation != d.Rotation || beacon.Spin != d.Spin {
		t.Fatal("beacon motion does not match its seeded description")
	}

	// Every antenna and its tip must contribute a physical collider.
	for _, plan := range beacon.HullSegments[4:] {
		found := false

		for _, collider := range beacon.HitboxColliding() {
			if segment, ok := collider.Segment.(*simulation.Segment); ok && segment.HullPlan == plan && collider.Physics != nil && *collider.Physics {
				found = true
			}
		}

		if !found {
			t.Fatal("antenna segment has no physical collider")
		}
	}

	saved := objects.CaptureEntity(beacon)
	restored, err := objects.RestoreEntity(saved, world)

	if err != nil {
		t.Fatal(err)
	}

	if _, ok := restored.(*objects.NavBeacon); !ok {
		t.Fatal("saved beacon did not restore as a beacon")
	}

	if len(restored.(*objects.NavBeacon).Segments) != len(beacon.Segments) {
		t.Fatal("saved beacon hull changed")
	}

	manager.Sync(world, []Vec.Vector{Vec.Create(100000, 100000)})

	if world.Entities.Has(id) || !manager.Sleeping.Has(id) {
		t.Fatal("beacon did not sleep")
	}

	manager.Sync(world, []Vec.Vector{gate.Position})

	if restored, ok := world.Entities.Get(id); !ok || restored != entity {
		t.Fatal("beacon did not wake")
	}

	world.Entities.Delete(id)
	manager.Sync(world, []Vec.Vector{gate.Position})
	manager.Sync(world, []Vec.Vector{gate.Position})

	if world.Entities.Has(id) {
		t.Fatal("removed beacon respawned")
	}
}
